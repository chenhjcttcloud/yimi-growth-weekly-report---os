import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createLiveReportSync} from '../server/live-report-sync.mjs';
import {createPerformance} from '../server/performance.mjs';
import {REPORT_QUALITY_VERSION,REPORT_QUALITY_PROMPT_VERSION,validateReportQualityAnalysis} from '../server/report-quality-scoring.mjs';
import {makeReportQualityAnalysis} from './report-quality-test-fixtures.mjs';

// Entire engine + real monthly publication, with synthetic retained SQLite and
// mocked providers only. No Feishu credential, real AI, employee data or cleanup.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/report-rescore-')),db=dir+'/test.sqlite';
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{const result=spawnSync('sqlite3',['-bail','-cmd','.timeout 10000',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:64*1024*1024});assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();};
const query=async statement=>run(statement,true),exec=async statement=>run(statement);
run(await readFile('db/schema.sql','utf8'));
run("INSERT INTO employees(user_id,name,department,is_active) VALUES('A','虚构甲','测试团队',1),('B','虚构乙','测试团队',1),('C','虚构丙','测试团队',1),('inactive','虚构停用','测试团队',0); INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES('A-hire','A','2026-09-01','manager'),('B-hire','B','2026-09-01','manager'),('C-hire','C','2026-09-01','manager'),('inactive-hire','inactive','2026-09-01','manager');");
const weights=[30,25,25,20],model='synthetic-repair-model';
const initial={meta:{collectionStartDate:'2026-09-01',periods:[]},employee_summary:[],weekly_scores:[]};
await writeFile(dir+'/prototypeData.json',JSON.stringify(initial));
const readData=name=>{try{return JSON.parse(readFileSync(dir+'/'+name+'.json','utf8'));}catch{return {};}};
const policyFor=async()=>({weights:[...weights],deadlineTime:'20:00'});
const managerReviews={snapshot:async()=>({plans:new Map(),scores:[],bossScores:[]}),progress:()=>({kind:'unassigned',expected:0,submitted:0,complete:false,score:null})};
const performance=createPerformance({query,exec,sql,readData,policyFor,managerReviews,now:()=>new Date('2026-11-02T09:00:00Z')});
const factsFor=id=>({results:`【虚构${id}】完成3项验收，输出可定位的交付记录。`,problems:`【虚构${id}】接口范围存在争议，已约双方确认。`,nextPlan:`【虚构${id}】优先在周五前交付3项通过的验收记录。`,reflection:`【虚构${id}】先确认范围可以减少返工，下次复用检查清单。`});
const sources=new Map();
function store(id,userId,end,score,{current=false,status='准时',unhashed=false}={}){
 const facts=status==='未交'?{}:factsFor(id),hash=unhashed?null:'source-'+id;
 const payload=current?makeReportQualityAnalysis(facts,{scores:[score,score,score,score]}):{scores:[score,score,score,score],summary:'旧版虚构评分',questions:[],anomalies:[],tasks:[]};
 const ai=current?{...payload,...validateReportQualityAnalysis(payload,facts),promptVersion:REPORT_QUALITY_VERSION}:payload;
 const content={...facts,'周期ID':'period-'+end,source:{provider:'feishu-report',taskId:id,ruleName:'测试周报'},sourceHash:hash,...(status==='未交'?{}:{ai,aiModel:current?model:'old-synthetic-model',aiPromptVersion:current?REPORT_QUALITY_VERSION:'legacy',aiGeneratedAt:'2026-10-31T01:00:00Z',...Object.fromEntries(['成果分','问题分','计划分','复盘分'].map(key=>[key,score]))})};
 const start=end==='2026-09-25'?'2026-09-21':end==='2026-10-09'?'2026-10-05':'2026-10-12';
 run(`INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,source_hash,submitted_at) VALUES(${sql(id)},${sql(userId)},${sql('虚构'+userId)},'测试团队',${sql('周报-'+end)},${sql(start)},${sql(end)},${sql(status)},${sql(JSON.stringify(content))},${sql(hash)},${sql(status==='未交'?null:end+'T10:00:00Z')});`);
 sources.set(id,{facts,hash});
}
store('A1','A','2026-10-09',60);store('A2','A','2026-10-16',60);store('B1','B','2026-10-09',80);store('C1','C','2026-10-09',90,{current:true});store('SEP','A','2026-09-25',55);store('STOP','inactive','2026-10-09',70);store('MISSING','A','2026-10-23',0,{status:'未交'});
const stored=id=>run(`SELECT * FROM weekly_reports WHERE id=${sql(id)};`,true)[0];
const content=id=>JSON.parse(stored(id).content_json);
const untouched=new Map(['SEP','STOP','MISSING','C1'].map(id=>[id,stored(id)]));
const initialView=await performance.overview();
const monthly=(view,userId)=>view.results.find(row=>row.month==='2026-10'&&row.employee_user_id===userId&&row.kind==='quality').result;
assert.equal(monthly(initialView,'A').score,60);assert.equal(monthly(initialView,'B').score,80);
let releaseB;const bGate=new Promise(resolve=>{releaseB=resolve;});
let phase='first',bNetworkRemaining=0,calls=[],status,observations=[],transientPublicationFailure=true,independentPublication=false;
const perPhaseCalls=new Map();
const fetcher=async(url,options)=>{
 assert.equal(url,'https://fixture.invalid/v1/chat/completions','rescore must never read Feishu or any real provider');
 const request=JSON.parse(options.body),input=JSON.parse(request.messages.find(message=>message.role==='user').content);
 const id=[...sources].find(([,source])=>source.facts.results===input.report.results)?.[0];assert(id,'only known synthetic source may reach model');
 calls.push({id,phase,messages:request.messages});const key=phase+':'+id,count=(perPhaseCalls.get(key)||0)+1;perPhaseCalls.set(key,count);
 if(phase==='first'&&id==='B1')await bGate;
 if(phase==='retry'&&id==='B1'&&bNetworkRemaining-->0)throw new TypeError('PRIVATE_NETWORK_MESSAGE_MUST_NOT_BE_LOGGED');
 const score=id==='A1'?90:id==='A2'?100:id==='B1'?(phase==='retry'?88:85):92;
 const result=makeReportQualityAnalysis(input.report,{scores:[score,score,score,score],summary:'虚构重评已完成'});
 if((phase==='first'&&id==='A1'&&count===1)||(phase==='fail'&&id==='B1'))result.modules[0].criteria[0].evidence=[{quote:'PRIVATE_FORGED_QUOTE_MUST_NOT_REACH_DIAGNOSTIC',type:'reported_fact'}];
 if(phase==='source-change'&&id==='C1'){
  const current=content('C1'),newFacts={...input.report,results:'【虚构新版本】刚修改的周报，不能用旧请求结果覆盖。'};
  const next={...current,...newFacts,'本周成果摘要':newFacts.results,sourceHash:'source-C1-newer'};
  run(`UPDATE weekly_reports SET source_hash='source-C1-newer',content_json=${sql(JSON.stringify(next))} WHERE id='C1';`);
 }
 return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]})};
};
const sync=createLiveReportSync({query,exec,sql,config:{dataDir:dir,moonshotApiKey:'synthetic-key',moonshotBaseUrl:'https://fixture.invalid/v1',kimiFollowupModel:model,feishuAppId:'',feishuAppSecret:''},settings:{policyFor,overview:async()=>{throw Error('rescore_must_not_read_feishu_settings');}},refreshDirectory:async()=>{},writeStatus:async value=>{status=structuredClone(value);},pause:async()=>{},fetcher,onComplete:async()=>{
 if(transientPublicationFailure){transientPublicationFailure=false;throw Error('synthetic_temporary_publication_failure');}
 const view=await performance.overview(),a=monthly(view,'A'),b=monthly(view,'B');observations.push({a,b});
 if(phase==='first'&&a.score===95&&a.status==='ready'&&b.score===80&&b.status==='rescoring'){independentPublication=true;releaseB();}
}});
const options={mode:'rescore',targetMonth:'2026-10'};
let timer;
try{
 const firstJob=sync.run(options);
 await Promise.race([firstJob,new Promise((_,reject)=>{timer=setTimeout(()=>{releaseB();reject(Error('one_employee_publication_waited_for_other_employee'));},20000);})]);clearTimeout(timer);
 assert(independentPublication,'A publishes its complete October mean while B is still processing with its prior final visible');
 assert.equal(status.ok,true);assert.equal(status.analyzed,3);assert.equal(status.cached,1);assert.equal(status.failed,0);assert.equal(status.rowCount,4);assert.equal(status.remaining,0);
 assert.equal(status.publicationPending,false);assert.equal(status.publicationFailures,1,'transient monthly publication error is recorded and later updates recover');
 assert.equal(monthly(await performance.overview(),'A').score,95);assert.equal(monthly(await performance.overview(),'B').score,85);
 assert.equal(perPhaseCalls.get('first:A1'),2);assert.equal(perPhaseCalls.get('first:A2'),1);assert.equal(perPhaseCalls.get('first:B1'),1);
 const corrected=calls.find(call=>call.id==='A1'&&call.messages.some(message=>message.role==='user'&&message.content.includes('validationFeedback')));assert(corrected);
 const feedback=JSON.parse(corrected.messages.at(-1).content).validationFeedback;
 assert.deepEqual(feedback,{code:'evidence_not_in_source',path:'modules.results.criteria.result.evidence[0].quote',moduleId:'results',criterionId:'result',retryable:true});
 assert(!JSON.stringify(feedback).includes('PRIVATE_'),'retry diagnostics must contain schema locations only');
 assert(content('A1').aiAnalysisAttempts.some(attempt=>attempt.code==='evidence_not_in_source'));
 for(const id of ['A1','A2','B1']){assert(content(id).aiAnalysisHistory.length);assert.equal(content(id).aiPromptVersion,REPORT_QUALITY_PROMPT_VERSION);}
 for(const [id,row] of untouched)assert.deepEqual(stored(id),row,'cached, outside-month, inactive and unsubmitted rows stay byte-compatible: '+id);
 assert.equal(run('SELECT count(*) FROM import_batches;'),'0','stored-source repair does not create a Feishu import');

 // Fail only one stale result; already validated employees must not rerun.
 phase='fail';run("UPDATE weekly_reports SET content_json=json_set(content_json,'$.aiModel','stale-B-model') WHERE id='B1';");
 await sync.run(options);assert.equal(status.phase,'partial');assert.equal(status.failed,1);assert.equal(status.cached,3);assert.equal(perPhaseCalls.get('fail:B1'),4);assert.equal(calls.filter(call=>call.phase==='fail').length,4);
 const bFailed=monthly(await performance.overview(),'B');assert.equal(bFailed.score,85);assert.equal(bFailed.status,'rescore_failed');assert.equal(content('B1').qualityRefresh.diagnostic.code,'evidence_not_in_source');
 assert(!JSON.stringify(content('B1').aiAnalysisAttempts).includes('PRIVATE_'),'persisted diagnostics cannot expose provider output');
 const successfulA=stored('A1'),successfulA2=stored('A2');
 phase='retry';bNetworkRemaining=1;await sync.run(options);
 assert.equal(status.ok,true);assert.equal(status.analyzed,1);assert.equal(status.cached,3);assert.equal(calls.filter(call=>call.phase==='retry').length,2);assert.equal(monthly(await performance.overview(),'B').score,88);
 assert(content('B1').aiAnalysisAttempts.some(attempt=>attempt.code==='upstream_network_error'));
 assert.deepEqual(stored('A1'),successfulA);assert.deepEqual(stored('A2'),successfulA2);

 // A newer source wins even when an old model request finishes later.
 phase='source-change';run("UPDATE weekly_reports SET content_json=json_set(content_json,'$.aiModel','stale-C-model') WHERE id='C1';");
 await sync.run(options);assert.equal(calls.filter(call=>call.phase==='source-change').length,1);assert.equal(status.skippedSourceChanged,1);assert.equal(status.skippedInactiveAnalysis,0);assert.equal(status.analyzed,0);
 assert.equal(stored('C1').source_hash,'source-C1-newer');assert(content('C1').results.includes('刚修改'));assert.equal(content('C1').ai,undefined,'response for older content must never be applied');
 // Old imported records without a source hash acquire a stable identity once,
 // so a completed repair is skipped on the following run.
 phase='unhashed';
 const changedC=content('C1');sources.set('C1',{facts:{results:changedC.results,problems:changedC.problems,nextPlan:changedC.nextPlan,reflection:changedC.reflection},hash:'source-C1-newer'});
 store('UNHASHED','C','2026-10-30',72,{unhashed:true});
 assert.equal(stored('UNHASHED').source_hash,null);
 await sync.run(options);assert.equal(status.analyzed,2);assert.equal(status.ok,true);
 assert(/^[a-f0-9]{64}$/.test(stored('UNHASHED').source_hash));
 assert.equal(content('UNHASHED').sourceHash,stored('UNHASHED').source_hash);
 const unhashedComplete=stored('UNHASHED'),afterUnhashedCalls=calls.length;
 await sync.run(options);assert.equal(status.cached,5);assert.equal(status.analyzed,0);assert.equal(calls.length,afterUnhashedCalls);assert.deepEqual(stored('UNHASHED'),unhashedComplete);
 const beforeInvalid=calls.length;
 for(const targetMonth of ['2026-13','2026-00','2999-01','2026-1','not-a-month'])await assert.rejects(sync.run({mode:'rescore',targetMonth}),/invalid_rescore_month/);
 assert.equal(calls.length,beforeInvalid);
 assert.equal(run('PRAGMA integrity_check;'),'ok');
 for(const table of ['scoring360_responses','monthly_manager_scores','feishu_tasks','weekly_reminder_sends'])assert.equal(run('SELECT count(*) FROM '+table+';'),'0');
 const result={ok:true,storedMonthOnly:true,noFeishuCredentialsRequired:true,oldPromptCacheReused:true,unsubmittedInactiveAndOtherMonthUntouched:true,correctiveValidationFeedback:true,noDiagnosticPayloadLeaks:true,oldMonthlyFinalRetained:true,individualEmployeePublication:true,transientPublicationRecovery:true,failedOnlyRetry:true,transientNetworkRetry:true,staleSourceResponseDiscarded:true,invalidMonthBeforeModelCall:true,externalRequests:0,realNotifications:0,artifacts:dir};
 await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{clearTimeout(timer);releaseB();console.log('Artifacts retained:',dir);}
