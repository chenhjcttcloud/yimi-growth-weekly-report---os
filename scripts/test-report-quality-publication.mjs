import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createPerformance} from '../server/performance.mjs';
import {createPersonalWorkspace} from '../server/personal-workspace.mjs';
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
const query=async statement=>run(statement,true),exec=async statement=>run(statement);
run(await readFile('db/schema.sql','utf8'));
run("INSERT INTO employees(user_id,name,department,is_active) VALUES('staff','评分测试员工','测试团队',1),('other','另一位测试员工','其他团队',1); INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES('staff-hire','staff','2026-08-31','manager'),('other-hire','other','2026-08-31','manager');");
const weights=[30,25,25,20],policyFor=async()=>({weights:[...weights],deadlineTime:'20:00'});
const data={meta:{collectionStartDate:'2026-08-31',periods:[{id:'period-2026-09-04',start:'2026-08-31',end:'2026-09-04'}]},employee_summary:[{user_id:'staff','姓名':'评分测试员工','部门':'测试团队'},{user_id:'other','姓名':'另一位测试员工','部门':'其他团队'}],weekly_scores:[]};
const readData=name=>name==='prototypeData'?data:{};
const managerReviews={snapshot:async()=>({plans:new Map(),scores:[],bossScores:[]}),progress:()=>({kind:'unassigned',expected:0,submitted:0,complete:false,score:null})};
const now=()=>new Date('2026-09-30T15:00:00Z');
const performance=createPerformance({query,exec,sql,readData,policyFor,managerReviews,now});
let outboundRequests=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{outboundRequests++;throw Error('test_external_network_disabled');};
const blockedIntegration=async()=>{throw Error('test_external_integration_disabled');};
const personal=createPersonalWorkspace({performance,readData,query,exec,sql,config:{taskCreateEnabled:false},askAi:blockedIntegration,createTask:blockedIntegration,policyFor});
const facts={results:'完成两项交付，验收记录还需补齐。',problems:'接口数据前后不一致，已收集日志并等待定位。',nextPlan:'下周先定位接口问题，周四前交付修复及验证记录。',reflection:'本周缺少统一验收口径，下次先确认检查清单。'};
const otherFacts={results:'OTHER_EMPLOYEE_PRIVATE_QUOTE：完成专属样本交付。',problems:'另一位员工的专属问题。',nextPlan:'另一位员工计划周五前验收。',reflection:'另一位员工的专属复盘。'};
function contentFor(source,{scores=[40,50,30,20],confidence=.12,anomalies=['样本标记：数据矛盾','样本标记：分数波动较大']}={}){
 const payload=makeReportQualityAnalysis(source,{scores,confidence,anomalies,summary:'测试点评：低分和异常仅作改进提示，自动发布。'});
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
try{
 store('low-score','staff','2026-08-31','2026-09-04',contentFor(facts));
 store('other-report','other','2026-08-31','2026-09-04',contentFor(otherFacts,{scores:[95,95,95,95],confidence:.95,anomalies:[]}));
 let view=await performance.overview(),quality=qualityRow(view);
 assert.equal(quality.result.score,36,'low quality must publish automatically without a human approval');
 assert.equal(quality.result.status,'ready');
 assert.equal(quality.scoring_rule,'automatic_report');
 const snapshot=JSON.parse(quality.evidence_json),assessment=ownMonth(view).reports[0].qualityAssessment;
 assert(assessment,'structured score details must enter performance report responses');
 assert.equal(assessment.modules[0].confidence,.12,'low self-rated confidence does not block publication');
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
 await assert.rejects(()=>performance.confirm({month,userId:'staff',kind:'quality',score:99},{userId:'manager'}),/results_auto_published/);
 let workspace=await personal.workspace({userId:'staff',name:'评分测试员工'},month,'period-2026-09-04');
 const ownWeek=workspace.weeks.find(week=>week.end==='2026-09-04');
 assert.deepEqual(ownWeek.qualityAssessment,assessment);
 assert.deepEqual(ownWeek.scoringWeights,weights);
 assert.equal(ownWeek.qualityReference,36);
 assert(!JSON.stringify(workspace).includes('OTHER_EMPLOYEE_PRIVATE_QUOTE'),'personal scoring details must never contain another employee’s evidence');
 const firstPublicationId=run("SELECT id FROM automatic_performance_results WHERE employee_user_id='staff' AND month='2026-09' AND kind='quality' ORDER BY rowid LIMIT 1;"),firstSnapshot=quality.evidence_json;

 // Existing records without structured details remain usable and are not
 // assigned invented citations by the new presentation contract.
 const legacy={...facts,'成果分':85,'问题分':85,'计划分':85,'复盘分':85,ai:{scores:[85,85,85,85],summary:'历史评分，仅有四模块分值。'}};
 store('legacy-score','staff','2026-09-07','2026-09-11',legacy);
 view=await performance.overview();
 assert.equal(qualityRow(view).result.score,60.5,'monthly mean includes valid legacy module scores');
 assert.equal(Object.hasOwn(ownMonth(view).reports.find(report=>report.id==='legacy-score'),'qualityAssessment'),false,'legacy response shape stays unchanged without invented scoring evidence');

 // A newly submitted report awaiting analysis withdraws the incomplete monthly
 // score instead of publishing zero or keeping the previous partial average.
 store('pending-score','staff','2026-09-14','2026-09-18',{...facts,results:'新提交的样本，等待AI分析。'});
 view=await performance.overview();quality=qualityRow(view);
 assert.equal(quality.result.score,null);
 assert.equal(quality.result.status,'pending_ai');
 assert.equal(quality.result.pendingAnalysis,1);
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
 assert.equal(qualityRow(view).result.score,null,'rejected structured evidence must not use stale numeric score fields');
 assert.equal(qualityRow(view).result.status,'pending_ai');
 assert.equal(Object.hasOwn(ownMonth(view).reports.find(report=>report.id==='pending-score'),'qualityAssessment'),false);

 // Valid zero is a real result, in contrast to an absent or rejected analysis.
 const zero=contentFor(facts,{scores:[0,0,0,0],confidence:0});
 run(`UPDATE weekly_reports SET content_json=${sql(JSON.stringify({...zero,'周期ID':'period-2026-09-18'}))} WHERE id='pending-score';`);
 view=await performance.overview();quality=qualityRow(view);
 assert.equal(quality.result.score,40.3);
 assert.equal(quality.result.status,'ready');
 assert.equal(ownMonth(view).reports.find(report=>report.id==='pending-score').candidate,0);
 assert.equal(run(`SELECT evidence_json FROM automatic_performance_results WHERE id=${sql(firstPublicationId)};`),firstSnapshot,'later automatic publications retain the original explanation snapshot');
 assert.equal(run('SELECT count(*) FROM performance_results;'),'0');
 assert.equal(run('SELECT count(*) FROM scoring360_responses;'),'0');
 assert.equal(run('SELECT count(*) FROM monthly_manager_scores;'),'0');
 assert.equal(run('SELECT count(*) FROM feishu_tasks;'),'0');
 assert.equal(run('PRAGMA integrity_check;'),'ok');
 assert.equal(outboundRequests,0);
 const result={ok:true,lowScoreAutomaticallyPublished:true,lowConfidenceAndAnomaliesDoNotBlock:true,exactEvidenceAndReasonsPreserved:true,monthlySnapshotsRetained:true,pendingAnalysisIsNull:true,forgedStoredEvidenceRejected:true,validZeroPublished:true,legacyScoresCompatible:true,personalEvidenceScoped:true,overviewHeadersRemainLean:true,humanApprovalRequired:false,externalRequests:outboundRequests,messagesSent:0,artifacts:dir};
 await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{
 globalThis.fetch=originalFetch;
 console.log('Test artifacts retained:',dir);
}
