import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createPerformance} from '../server/performance.mjs';
import {decodeAutomaticEvidence} from '../server/automatic-evidence-storage.mjs';
import {createPersonalWorkspace} from '../server/personal-workspace.mjs';
import {createLiveReportSync} from '../server/live-report-sync.mjs';
import {performanceClientOverview,performanceClientEmployeeMonth} from '../server/performance-client-data.mjs';
import {REPORT_QUALITY_VERSION,validateReportQualityAnalysis} from '../server/report-quality-scoring.mjs';
import {makeReportQualityAnalysis} from './report-quality-test-fixtures.mjs';

// Every source, database and result in this test is synthetic. Keep artifacts
// for inspection and reject any accidental provider request or task creation.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/report-quality-publication-'));
const db=path.join(dir,'test.sqlite'),month='2026-09';
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{
 const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:16*1024*1024});
 assert.equal(result.status,0,result.stderr);
 return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();
};
let beforeQualityConfirm;
const query=async statement=>run(statement,true),exec=async statement=>{
 if(statement.includes('月度周报质量最终分已确认'))beforeQualityConfirm?.();
 return run(statement);
};
run(await readFile('db/schema.sql','utf8'));
run("INSERT INTO employees(user_id,name,department,is_active) VALUES('staff','评分测试员工','测试团队',1),('other','另一位测试员工','其他团队',1); INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES('staff-hire','staff','2026-08-31','manager'),('other-hire','other','2026-08-31','manager');");
const weights=[30,25,25,20],policyFor=async()=>({weights:[...weights],deadlineTime:'20:00'});
const data={meta:{collectionStartDate:'2026-08-31',periods:[{id:'period-2026-09-04',start:'2026-08-31',end:'2026-09-04'}]},employee_summary:[{user_id:'staff','姓名':'评分测试员工','部门':'测试团队'},{user_id:'other','姓名':'另一位测试员工','部门':'其他团队'}],weekly_scores:[]};
const readData=name=>name==='prototypeData'?data:{};
const managerReviews={snapshot:async()=>({plans:new Map(),scores:[],bossScores:[]}),progress:()=>({kind:'unassigned',expected:0,submitted:0,complete:false,score:null})};
let currentTime='2026-09-30T23:59:59+08:00';
const now=()=>new Date(currentTime);
const performance=createPerformance({query,exec,sql,readData,policyFor,managerReviews,now});
let outboundRequests=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{outboundRequests++;throw Error('test_external_network_disabled');};
const blockedIntegration=async()=>{throw Error('test_external_integration_disabled');};
const personal=createPersonalWorkspace({performance,readData,query,exec,sql,config:{taskCreateEnabled:false},askAi:blockedIntegration,createTask:blockedIntegration,policyFor});
const facts={results:'完成两项交付，验收记录还需补齐。',problems:'接口数据前后不一致，已收集日志并等待定位。',nextPlan:'下周先定位接口问题，周四前交付修复及验证记录。',reflection:'本周缺少统一验收口径，下次先确认检查清单。'};
const otherFacts={results:'OTHER_EMPLOYEE_PRIVATE_QUOTE：完成专属样本交付。',problems:'另一位员工的专属问题。',nextPlan:'另一位员工计划周五前验收。',reflection:'另一位员工的专属复盘。'};
function contentFor(source,{scores=[40,50,30,20],confidence=.12,anomalies=['样本标记：数据矛盾','样本标记：分数波动较大']}={}){
 const payload=makeReportQualityAnalysis(source,{scores,confidence,anomalies,summary:'测试点评：低分和异常仅作改进和复核提示。'});
 const assessed=validateReportQualityAnalysis(payload,source);
 return {...source,'本周成果摘要':source.results,'问题摘要':source.problems,'下周计划摘要':source.nextPlan,'思考与复盘摘要':source.reflection,sourceHash:'synthetic-publication-source',ai:{...payload,...assessed},aiModel:'synthetic-quality-model',aiGeneratedAt:'2026-09-04T11:00:00.000Z',aiPromptVersion:REPORT_QUALITY_VERSION,...Object.fromEntries(['成果分','问题分','计划分','复盘分'].map((key,index)=>[key,assessed.scores[index]]))};
}
function store(id,userId,start,end,content){
 const name=userId==='staff'?'评分测试员工':'另一位测试员工';
 const report={...content,'周期ID':'period-'+end};
 run(`INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,source_hash,submitted_at) VALUES(${sql(id)},${sql(userId)},${sql(name)},'测试团队',${sql('测试周报-'+end)},${sql(start)},${sql(end)},'准时',${sql(JSON.stringify(report))},'synthetic-publication-source',${sql(end+'T10:00:00Z')});`);
}
const qualityRow=view=>view.results.find(row=>row.employee_user_id==='staff'&&row.month===month&&row.kind==='quality');
const ownMonth=view=>view.monthly.find(row=>row.userId==='staff'&&row.month===month);
const latestCandidate=()=>run("SELECT * FROM automatic_performance_results WHERE employee_user_id='staff' AND month='2026-09' AND kind='quality' ORDER BY rowid DESC LIMIT 1;",true)[0];
try{
 store('low-score','staff','2026-08-31','2026-09-04',contentFor(facts));
 store('other-report','other','2026-08-31','2026-09-04',contentFor(otherFacts,{scores:[95,95,95,95],confidence:.95,anomalies:[]}));
 let view=await performance.overview(),quality=ownMonth(view).quality;
 assert.equal(quality.currentAverage,36,'the analyzed weekly score remains visible during the open month');
 assert.equal(quality.pendingAnalysis,0,'future or unsubmitted reports are excluded from analysis counts');
 assert.equal(quality.status,'pending_ai');
 assert.equal(quality.confirmationBlockedReason,'month_open');
 assert.equal(quality.candidateScore,null);
 assert.equal(quality.canConfirm,false);
 assert.equal(quality.version,undefined);
 await assert.rejects(()=>performance.confirm({month,userId:'staff',kind:'quality',version:'a'.repeat(64)},{userId:'manager'}),/quality_month_open/);
 assert.equal(run("SELECT count(*) FROM performance_results WHERE kind='quality';"),'0');
 currentTime='2026-10-01T00:00:00+08:00';
 view=await performance.overview();quality=ownMonth(view).quality;
 assert.equal(quality.candidateScore,36,'low quality can be presented for human review');
 assert.equal(quality.status,'pending_confirmation');
 assert.equal(qualityRow(view),undefined,'AI cannot publish the final result');
 const firstCandidate=latestCandidate();
 const firstSnapshot=decodeAutomaticEvidence(firstCandidate.evidence_json);
 const snapshot=JSON.parse(firstSnapshot),assessment=ownMonth(view).reports[0].qualityAssessment;
 assert(assessment,'structured score details must enter performance report responses');
 assert.equal(assessment.modules[0].confidence,.12,'low self-rated confidence does not block a candidate');
 assert.equal(assessment.model,'synthetic-quality-model');
 assert.equal(assessment.promptVersion,REPORT_QUALITY_VERSION);
 assert.equal(assessment.generatedAt,'2026-09-04T11:00:00.000Z');
 assert.deepEqual(snapshot.reports[0].qualityAssessment,assessment,'published monthly snapshots retain the scoring explanation');
 assert(snapshot.reports[0].anomalies.includes('样本标记：数据矛盾'));
 for(const module of assessment.modules){
  assert(module.reason);
  for(const criterion of module.criteria){
   assert(criterion.reason);
   for(const evidence of criterion.evidence)assert.equal(facts[module.id].slice(evidence.start,evidence.end),evidence.quote,'saved citation offsets must resolve to the exact original passage');
  }
 }
 const headers=performanceClientOverview(view,{reportMode:'headers'});
 assert(headers.monthly.every(row=>row.reports.every(report=>!Object.hasOwn(report,'qualityAssessment'))),'overview headers must not transfer detailed scoring evidence');
 const detail=performanceClientEmployeeMonth(view,'staff',month);
 assert.deepEqual(detail.monthly.reports[0].qualityAssessment,assessment);
 assert(!JSON.stringify(detail).includes('OTHER_EMPLOYEE_PRIVATE_QUOTE'),'employee details are limited to the chosen employee');
 await assert.rejects(()=>performance.confirm({month,userId:'staff',kind:'quality',score:99},{userId:'manager'}),/quality_version_required/);
 await assert.rejects(()=>performance.confirm({month,userId:'staff',kind:'quality',score:99,version:quality.version},{userId:'manager'}),/quality_adjustment_reason_required/);
 let workspace=await personal.workspace({userId:'staff',name:'评分测试员工'},month,'period-2026-09-04');
 const ownWeek=workspace.weeks.find(week=>week.end==='2026-09-04');
 assert.deepEqual(ownWeek.qualityAssessment,assessment);
 assert.deepEqual(ownWeek.scoringWeights,weights);
 assert.equal(ownWeek.qualityReference,36);
 assert(!JSON.stringify(workspace).includes('OTHER_EMPLOYEE_PRIVATE_QUOTE'),'personal scoring details must never contain another employee’s evidence');
 const reviewer={userId:'manager',name:'质量审核人'};
 let other= view.monthly.find(row=>row.userId==='other'&&row.month===month);
 const otherReview={month,userId:'other',reportId:'other-report',reason:'测试：排除确认后再恢复'};
 const evidenceReview={...otherReview,action:'validate_evidence',moduleId:'results',criterionId:'evidence',version:other.reports[0].qualityReviewVersion};
 await assert.rejects(()=>performance.reviewQuality({...evidenceReview,quote:'不存在的原文'},reviewer),/invalid_quality_evidence/);
 await performance.reviewQuality({...evidenceReview,quote:otherFacts.results},reviewer);
 view=await performance.overview();other=view.monthly.find(row=>row.userId==='other'&&row.month===month);
 assert.notEqual(other.reports[0].qualityReviewVersion,evidenceReview.version,'notes-only review changes the review token');
 await performance.reviewQuality({...otherReview,action:'mark_not_applicable',moduleId:'results',criterionId:'evidence',version:other.reports[0].qualityReviewVersion},reviewer);
 view=await performance.overview();other=view.monthly.find(row=>row.userId==='other'&&row.month===month);
 assert.equal(other.reports[0].reviewedModuleScores[0],95,'manual exclusion of a criterion renormalizes the remaining points');
 await performance.reviewQuality({...otherReview,action:'exclude_report',version:other.reports[0].qualityReviewVersion},reviewer);
 view=await performance.overview();other=view.monthly.find(row=>row.userId==='other'&&row.month===month);
 assert.equal(other.quality.status,'no_reports');assert.equal(other.quality.currentAverage,null);
 assert.equal(other.quality.expectedCount,0);assert.equal(other.quality.canConfirm,false);
 assert.equal(other.timeliness.submitted,1,'exclusion affects quality only');
 await performance.reviewQuality({...otherReview,action:'restore_report',version:other.reports[0].qualityReviewVersion},reviewer);
 assert.equal(run("SELECT count(*) FROM system_operation_logs WHERE action='周报质量复核已记录';"),'4');
 const originalLegacyScore=71.8;
 store('legacy-import','staff','2026-07-06','2026-07-10',{...facts,source:{provider:'legacy-reportos'},'成果分':98,'问题分':92,'计划分':95,'复盘分':80,'总分':originalLegacyScore});
 const archiveView=await performance.overview();
 const archiveMonth=archiveView.monthly.find(row=>row.month==='2026-07'&&row.userId==='staff');
 assert.equal(archiveMonth.reports[0].candidate,originalLegacyScore,'the old total is preserved even when the new weights would produce a different score');
 assert.equal(archiveMonth.reports[0].qualityAssessment,undefined,'the archive has no invented AI evidence');
 const archiveWorkspace=await personal.workspace({userId:'staff',name:'评分测试员工'},'2026-07','period-2026-07-10');
 assert.equal(archiveWorkspace.weeks.find(week=>week.end==='2026-07-10').qualityReference,originalLegacyScore);
 const projection=createLiveReportSync({query,exec,sql,config:{dataDir:dir},settings:{policyFor},fetcher:blockedIntegration});
 await projection.project();
 const projected=JSON.parse(await readFile(path.join(dir,'prototypeData.json'),'utf8')).weekly_scores.find(report=>report['源记录ID']==='legacy-import');
 assert.equal(projected['总分'],originalLegacyScore,'refreshing the dashboard projection retains the original historical total');
 assert.equal(run("SELECT start_date FROM employee_employment_periods WHERE id='staff-hire';"),'2026-08-31','historical display does not rewrite employee start dates');
 const firstPublicationId=firstCandidate.id;
 const firstStoredSnapshot=run(`SELECT evidence_json FROM automatic_performance_results WHERE id=${sql(firstPublicationId)};`);
 assert.equal(decodeAutomaticEvidence(firstStoredSnapshot),firstSnapshot,'storage encoding preserves the complete original explanation bytes');

 // Existing records without structured details remain usable and are not
 // assigned invented citations by the new presentation contract.
 const legacy={...facts,'成果分':85,'问题分':85,'计划分':85,'复盘分':85,ai:{scores:[85,85,85,85],summary:'历史评分，仅有四模块分值。'}};
 store('legacy-score','staff','2026-09-07','2026-09-11',legacy);
 view=await performance.overview();
 assert.equal(ownMonth(view).quality.candidateScore,60.5,'monthly mean includes valid legacy module scores');
 assert.equal(Object.hasOwn(ownMonth(view).reports.find(report=>report.id==='legacy-score'),'qualityAssessment'),false,'legacy response shape stays unchanged without invented scoring evidence');

 // A newly submitted report awaiting analysis leaves a current average and no monthly candidate.
 store('pending-score','staff','2026-09-14','2026-09-18',{...facts,results:'新提交的样本，等待AI分析。'});
 view=await performance.overview();quality=ownMonth(view).quality;
 assert.equal(quality.candidateScore,null);
 assert.equal(quality.currentAverage,60.5);
 assert.equal(quality.status,'pending_ai');
 assert.equal(quality.pendingAnalysis,1);
 assert.equal(ownMonth(view).reports.find(report=>report.id==='pending-score').candidate,null);
 workspace=await personal.workspace({userId:'staff',name:'评分测试员工'},month,'period-2026-09-18');
 assert.equal(workspace.weeks.find(week=>week.end==='2026-09-18').qualityReference,null);
 assert.equal(Object.hasOwn(workspace.weeks.find(week=>week.end==='2026-09-18'),'qualityAssessment'),false,'pending personal reports have no invented assessment');

 // An invalid current-version citation cannot fall back to the separately
 // stored numeric fields and appear as a valid automatically published score.
 const forged=contentFor(facts,{scores:[88,88,88,88]});
 forged.ai.modules[0].criteria[0].evidence[0].quote='这段证据从未出现在原文';
 run(`UPDATE weekly_reports SET content_json=${sql(JSON.stringify({...forged,'周期ID':'period-2026-09-18'}))} WHERE id='pending-score';`);
 view=await performance.overview();
 assert.equal(ownMonth(view).quality.candidateScore,null,'rejected structured evidence must not use stale numeric score fields');
 assert.equal(ownMonth(view).quality.status,'pending_ai');
 assert.equal(Object.hasOwn(ownMonth(view).reports.find(report=>report.id==='pending-score'),'qualityAssessment'),false);

 // Valid zero is a real result, in contrast to an absent or rejected analysis.
 const zero=contentFor(facts,{scores:[0,0,0,0],confidence:0});
 run(`UPDATE weekly_reports SET content_json=${sql(JSON.stringify({...zero,'周期ID':'period-2026-09-18'}))} WHERE id='pending-score';`);
 view=await performance.overview();quality=ownMonth(view).quality;
 assert.equal(quality.candidateScore,40.3);
 assert.equal(quality.status,'pending_confirmation');
 assert.equal(ownMonth(view).reports.find(report=>report.id==='pending-score').candidate,0);
 assert.equal(run(`SELECT evidence_json FROM automatic_performance_results WHERE id=${sql(firstPublicationId)};`),firstStoredSnapshot,'later automatic publications retain the original stored explanation bytes');
 assert.equal(decodeAutomaticEvidence(firstStoredSnapshot),firstSnapshot,'the original complete explanation remains readable after later publications');

 // Historical weekly references are available during a rescore. Each employee's
 // monthly candidate uses only the analyses completed for the active cycle.
 const updateContent=(id,update)=>{
  const row=run(`SELECT content_json FROM weekly_reports WHERE id=${sql(id)};`,true)[0];
  const next=update(JSON.parse(row.content_json));
  run(`UPDATE weekly_reports SET content_json=${sql(JSON.stringify(next))} WHERE id=${sql(id)};`);
 };
 const queue=id=>updateContent(id,content=>{
  const {ai,...body}=content;
  const previousQuality={ai,aiModel:content.aiModel,aiPromptVersion:content.aiPromptVersion,aiGeneratedAt:content.aiGeneratedAt,sourceHash:content.sourceHash||'synthetic-publication-source',facts:{results:content.results,problems:content.problems,nextPlan:content.nextPlan,reflection:content.reflection},scoringWeights:weights};
  return {...body,previousQuality,qualityRefresh:{state:'queued',targetVersion:REPORT_QUALITY_VERSION,attempts:0}};
 });
 const complete=(id,score)=>updateContent(id,content=>({...content,...contentFor(facts,{scores:[score,score,score,score]}),qualityRefresh:{...content.qualityRefresh,state:'ready'}}));
 for(const id of ['low-score','legacy-score','pending-score','other-report'])queue(id);
 view=await performance.overview();quality=ownMonth(view).quality;
 assert.equal(quality.currentAverage,null,'the previous automatic aggregate does not become a current candidate');
 assert.equal(quality.status,'pending_ai');assert.equal(quality.pendingAnalysis,3);
 const oldWeek=ownMonth(view).reports.find(report=>report.id==='legacy-score');
 assert.equal(oldWeek.candidate,null,'previous weekly scores are not candidates for new monthly publication');
 assert.equal(oldWeek.displayQualityScore,85);assert.equal(oldWeek.qualityDisplaySource,'previous');
 workspace=await personal.workspace({userId:'staff',name:'评分测试员工'},month,'period-2026-09-11');
 const displayedWeek=workspace.weeks.find(week=>week.end==='2026-09-11');
 assert.equal(displayedWeek.qualityReference,85);assert.equal(displayedWeek.qualityCandidate,null);assert.equal(displayedWeek.qualityDisplaySource,'previous');
 assert.equal(workspace.history.find(row=>row.month===month).qualityRefresh.status,'rescoring');
 complete('low-score',100);view=await performance.overview();
 assert.equal(ownMonth(view).quality.currentAverage,100,'current average includes the one newly scored report');
 assert.equal(ownMonth(view).quality.pendingAnalysis,2);
 updateContent('legacy-score',content=>({...content,qualityRefresh:{...content.qualityRefresh,state:'failed',attempts:4}}));
 view=await performance.overview();quality=ownMonth(view).quality;
 assert.equal(quality.currentAverage,100);assert.equal(quality.status,'pending_ai');
 assert.equal((await performance.personal('评分测试员工','staff')).history.find(row=>row.month===month).qualityRefresh.failedAnalysis,1);
 complete('legacy-score',60);complete('pending-score',20);view=await performance.overview();quality=ownMonth(view).quality;
 assert.equal(quality.candidateScore,60,'all completed reports provide a monthly candidate');
 assert.equal(quality.status,'pending_confirmation');assert.equal(quality.pendingAnalysis,0);
 const otherQuality=view.monthly.find(row=>row.userId==='other'&&row.month===month).quality;
 assert.equal(otherQuality.finalScore,null);assert.equal(otherQuality.status,'pending_ai','another employee can remain in progress without blocking the ready employee');
 beforeQualityConfirm=()=>run("UPDATE weekly_reports SET submitted_at='2026-09-18T11:00:00Z' WHERE id='pending-score';");
 await assert.rejects(()=>performance.confirm({month,userId:'staff',kind:'quality',version:quality.version},reviewer),/quality_candidate_changed/);
 beforeQualityConfirm=undefined;
 assert.equal(run('SELECT count(*) FROM performance_results;'),'0','concurrent report changes block confirmation');
 run("UPDATE weekly_reports SET submitted_at='2026-09-18T10:00:00Z' WHERE id='pending-score';");
 const confirmed=await performance.confirm({month,userId:'staff',kind:'quality',version:quality.version},reviewer);
 assert.equal(confirmed.score,60);assert.equal(confirmed.confirmedBy,reviewer.name);
 view=await performance.overview();
 assert.equal(qualityRow(view).scoring_rule,'management_confirmed');
 assert.equal(ownMonth(view).quality.finalScore,60);
 complete('low-score',95);view=await performance.overview();
 assert.equal(ownMonth(view).quality.currentAverage,60,'subsequent AI changes do not alter confirmed monthly summary');
 assert.equal((await performance.personal('评分测试员工','staff')).history.find(row=>row.month===month).quality,60);
 await assert.rejects(()=>performance.confirm({month,userId:'staff',kind:'quality',version:quality.version},reviewer),/result_locked/);
 // Recover the deployed pre-fix form: ai was removed but its archived snapshot
 // and a previously published month still exist behind later pending rows.
 const otherContent=run("SELECT content_json FROM weekly_reports WHERE id='other-report';",true)[0];
 const archivedOther=JSON.parse(otherContent.content_json),archived=archivedOther.previousQuality;
 const {qualityRefresh,previousQuality,...unmarked}=archivedOther;
 run(`UPDATE weekly_reports SET content_json=${sql(JSON.stringify({...unmarked,aiAnalysisHistory:[{ai:archived.ai,model:archived.aiModel,promptVersion:archived.aiPromptVersion,generatedAt:archived.aiGeneratedAt,sourceHash:archived.sourceHash,facts:archived.facts}]}))} WHERE id='other-report';`);
 view=await performance.overview();
 const archivedReport=view.monthly.find(row=>row.userId==='other'&&row.month===month).reports[0];
 assert.equal(archivedReport.displayQualityScore,95,'archived previous AI restores the weekly reference for already blanked records');
 assert.equal(view.monthly.find(row=>row.userId==='other'&&row.month===month).quality.status,'pending_ai');
 assert.equal(run(`SELECT evidence_json FROM automatic_performance_results WHERE id=${sql(firstPublicationId)};`),firstStoredSnapshot,'rescore preserves every historical stored publication byte');
 assert.equal(decodeAutomaticEvidence(firstStoredSnapshot),firstSnapshot,'rescore preserves the complete original explanation');

 // Having an earlier weekly snapshot is not a previously published monthly
 // final. A first-time employee still waits for a complete valid new result.
 run("INSERT INTO employees(user_id,name,department,is_active) VALUES('new-staff','首次评分测试','测试团队',1); INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES('new-staff-hire','new-staff','2026-08-31','manager');");
 store('new-staff-report','new-staff','2026-08-31','2026-09-04',{...facts,previousQuality:{ai:{scores:[73,73,73,73],summary:'原周报参考分'},facts,scoringWeights:weights},qualityRefresh:{state:'failed',targetVersion:REPORT_QUALITY_VERSION,attempts:4}});
 view=await performance.overview();
 const firstMonthly=view.monthly.find(row=>row.userId==='new-staff'&&row.month===month).quality;
 assert.equal(firstMonthly.finalScore,null,'do not invent a monthly final from one previous weekly reference');
 assert.equal(firstMonthly.status,'pending_ai');
 // A pre-existing manually confirmed final remains authoritative even when a
 // report in that same month is queued for automatic rescore.
 run("INSERT INTO performance_results VALUES('2026-08','staff','评分测试员工','quality','{\"score\":77}','{\"reviewNote\":\"历史人工确认，不可改写\"}','历史确认人','2026-08-31');");
 store('manual-month-report','staff','2026-08-24','2026-08-28',{...facts,qualityRefresh:{state:'failed',targetVersion:REPORT_QUALITY_VERSION}});
 const manualBefore=run("SELECT * FROM performance_results WHERE month='2026-08';",true);
 view=await performance.overview();
 assert.equal(view.results.find(row=>row.employee_user_id==='staff'&&row.month==='2026-08'&&row.kind==='quality').result.score,77);
 assert.deepEqual(run("SELECT * FROM performance_results WHERE month='2026-08';",true),manualBefore,'rescore never edits historical human-confirmed results');
 assert.equal(run('SELECT count(*) FROM performance_results;'),'2');
 assert.equal(run('SELECT count(*) FROM scoring360_responses;'),'0');
 assert.equal(run('SELECT count(*) FROM monthly_manager_scores;'),'0');
 assert.equal(run('SELECT count(*) FROM feishu_tasks;'),'0');

 // A make-up workday can move the final Friday period into the next month.
 const october='2026-10';
 const calendar=()=>({year:2026,workdayOverrides:['2026-11-01']});
 let collectingMonth;
 const withCalendar=createPerformance({query,exec,sql,readData,policyFor,managerReviews,now,calendar,
  isCollectingReports:requestedMonth=>requestedMonth===collectingMonth});
 store('october-score','staff','2026-10-26','2026-10-30',contentFor(facts));
 const octoberQuality=async()=>{
  const overview=await withCalendar.overview({employeeUserId:'staff',month:october});
  return overview.monthly.find(row=>row.month===october).quality;
 };
 currentTime='2026-11-01T19:59:59+08:00';
 const waitingCollection=await octoberQuality();
 assert.equal(waitingCollection.currentAverage,36);
 assert.equal(waitingCollection.status,'pending_ai');
 assert.equal(waitingCollection.confirmationBlockedReason,'collection_pending');
 assert.equal(waitingCollection.canConfirm,false);
 await assert.rejects(()=>withCalendar.confirm({month:october,userId:'staff',kind:'quality',version:'a'.repeat(64)},reviewer),/quality_collection_pending/);
 currentTime='2026-11-02T10:00:00+08:00';
 collectingMonth=october;
 assert.equal((await octoberQuality()).confirmationBlockedReason,'collection_pending');
 await assert.rejects(()=>withCalendar.confirm({month:october,userId:'staff',kind:'quality',version:'a'.repeat(64)},reviewer),/quality_collection_pending/);
 collectingMonth='2026-11';
 const collectionEnded=await octoberQuality();
 assert.equal(collectionEnded.status,'pending_confirmation');
 assert.equal(collectionEnded.candidateScore,36);
 assert.equal(collectionEnded.canConfirm,true);
 assert.equal(collectionEnded.confirmationBlockedReason,undefined);

 assert.equal(run('PRAGMA integrity_check;'),'ok');
 assert.equal(outboundRequests,0);
 const result={ok:true,shanghaiMonthEndGate:true,crossMonthDeadlineGate:true,lowScoreAvailableForReview:true,lowConfidenceAndAnomaliesDoNotBlockCandidate:true,exactEvidenceAndReasonsPreserved:true,monthlySnapshotsRetained:true,pendingExcludedFromCurrentAverage:true,forgedStoredEvidenceRejected:true,validZeroIncluded:true,legacyScoresCompatible:true,individualEmployeeConfirmedIndependently:true,archivedBlankedScoreRecovered:true,noInventedFirstMonthlyFinal:true,manualHistoricalFinalImmutable:true,personalEvidenceScoped:true,overviewHeadersRemainLean:true,humanApprovalRequired:true,externalRequests:outboundRequests,messagesSent:0,artifacts:dir};
 await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{
 globalThis.fetch=originalFetch;
 console.log('Test artifacts retained:',dir);
}
