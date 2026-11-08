import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createReportAutomation} from '../server/report-automation.mjs';
import {createLiveReportSync} from '../server/live-report-sync.mjs';
import {createSystemSettings} from '../server/system-settings.mjs';
import {createPerformance} from '../server/performance.mjs';
import {REPORT_QUALITY_PROMPT_VERSION,REPORT_QUALITY_VERSION} from '../server/report-quality-scoring.mjs';
import {makeReportQualityAnalysis} from './report-quality-test-fixtures.mjs';
await mkdir('outputs/tests',{recursive:true});const dir=await mkdtemp(path.resolve('outputs/tests/report-automation-')),db=dir+'/test.sqlite';
const sql=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const run=(input,json=false)=>{const r=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input,encoding:'utf8'});if(r.status)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout;};
const query=async s=>run(s,true),exec=async s=>run(s);run(await readFile('db/schema.sql','utf8'));
let now=new Date('2026-10-27T02:00:00Z'),aiCalls=0,queries=0,fail=false,invalidQuality=false,lock=false,status,availableRequests=null;
const config={sessionSecret:'test-key',dataDir:dir,feishuAppId:'cli_test',feishuAppSecret:'test-secret',moonshotApiKey:'test-ai-key',moonshotBaseUrl:'https://ai.example.test/v1',kimiFollowupModel:'test-model',larkReportAutoSyncEnabled:false};
const settings=createSystemSettings({query,exec,sql,config,now:()=>now});
const item={task_id:'test-task',from_user_id:'test-staff',from_user_name:'测试员工',department_name:'测试部门',rule_id:'test-rule',rule_name:'周报（聚焦结果与协作）',commit_time:Math.floor(Date.parse('2026-10-23T19:00:00+08:00')/1000),form_contents:[{field_name:'本周成果',field_value:'完成3项验收'},{field_name:'问题与挑战',field_value:'接口待确认'},{field_name:'下周工作计划与目标',field_value:'完成接口验证'},{field_name:'思考与复盘',field_value:'提前确认验收口径'}]};
const fetcher=async(url,options)=>{
 let result;if(url.includes('tenant_access_token'))result={code:0,tenant_access_token:'fake-token'};
 else if(url.includes('tasks/query')){queries++;result={code:0,data:{items:[item],has_more:false}};}
 else{
  aiCalls++;
  if(fail)return {ok:false,status:429,json:async()=>({error:{type:'test-rate-limit'}})};
  const facts=JSON.parse(JSON.parse(options.body).messages.find(message=>message.role==='user').content).report;
  const quality=makeReportQualityAnalysis(facts,{summary:'真实输入链路的模拟AI点评',questions:['如何验证交付？']});
  if(invalidQuality)quality.modules[0].criteria[0].evidence=[{quote:'测试用的无效引文',type:'reported_fact'}];
  result={choices:[{message:{content:JSON.stringify(quality)}}]};
 }
 return {ok:true,status:200,json:async()=>result};
};
const managerReviews={snapshot:async()=>({plans:new Map(),scores:[],bossScores:[]}),progress:()=>({kind:'unassigned',expected:0,submitted:0,complete:false,score:null})};
const performance=createPerformance({query,exec,sql,managerReviews,policyFor:settings.policyFor,readData:name=>JSON.parse(readFileSync(path.join(dir,name+'.json'),'utf8')),now:()=>now});
let published=0,useStoredBudget=false;
const reserveAiRequest=async()=>{
 if(useStoredBudget)return settings.reserveReportAiRequest();
 if(availableRequests===null)return true;
 if(availableRequests===0)return false;
 availableRequests--;
 return true;
};
const createSync=()=>createLiveReportSync({query,exec,sql,config,settings,refreshDirectory:async()=>{},writeStatus:async value=>{status=value;},pause:async()=>{},fetcher,reserveAiRequest,onComplete:async()=>{published++;await performance.overview();}});
let sync=createSync();
const options={query,exec,sql,getConfig:settings.reportAutomationConfig,getAiRequestsToday:settings.reportAiRequestsToday,isRunning:()=>lock,start:async range=>{await sync.run(range);return true;},now:()=>now};
const scheduler=createReportAutomation(options);
assert.equal((await scheduler.tick()).skipped,'disabled');assert.equal(aiCalls,0);
await assert.rejects(settings.saveReportAutomation({enabled:true,intervalMinutes:1},{userId:'admin',name:'管理员'}),/invalid_report_automation/);
await settings.saveReportAutomation({enabled:true,intervalMinutes:5},{userId:'admin',name:'管理员'});
const results=await Promise.all([scheduler.tick(),createReportAutomation(options).tick()]);assert.equal(results.filter(r=>r.status==='started').length,1);assert.equal(aiCalls,1);assert.equal(queries,1);assert.equal(published,3,'initial queue, each completed report and final state publish independently');
let personal=await performance.personal('测试员工','test-staff');assert.equal(personal.history[0].quality,83.3);assert.equal(personal.history[0].timeliness.rate,100);assert.equal(personal.history[0].collaboration,null,'AI must not generate collaboration ratings');
assert.equal((await createReportAutomation(options).tick()).skipped,'not_due','restart uses persisted interval');
const generatedAt=JSON.parse(run('SELECT content_json FROM weekly_reports;',true)[0].content_json).aiGeneratedAt;assert(generatedAt);now=new Date('2026-10-27T02:05:00Z');await scheduler.tick();assert.equal(JSON.parse(run('SELECT content_json FROM weekly_reports;',true)[0].content_json).aiGeneratedAt,generatedAt,'cache retains original AI generation time');assert.equal(queries,2);assert.equal(aiCalls,1,'unchanged report content/model reuses analysis');
item.form_contents[0].field_value='新增验收结果，内容发生变化';now=new Date('2026-10-27T02:10:00Z');fail=true;await scheduler.tick();assert.equal(status.failed,1);assert.equal(run('SELECT count(*) AS n FROM weekly_reports;',true)[0].n,1,'AI failure retains report source');const duringFailure=(await performance.personal('测试员工','test-staff')).history[0];assert.equal(duringFailure.quality,83.3,'failed reanalysis retains the last published score');assert.equal(duringFailure.qualityStatus,'rescore_failed','retained score is explicitly marked as old, never presented as a new result');
fail=false;now=new Date('2026-10-27T02:15:00Z');await scheduler.tick();assert.equal((await performance.personal('测试员工','test-staff')).history[0].quality,83.3);assert.equal(status.failed,0);
const before=aiCalls;lock=true;now=new Date('2026-10-27T02:20:00Z');assert.equal((await scheduler.tick()).skipped,'sync_running');assert.equal(aiCalls,before);lock=false;
// Corrupt/incomplete cached analysis is retried instead of trusted as a complete grade.
run("UPDATE weekly_reports SET content_json=json_set(content_json,'$.ai.modules',json('[]'));");await scheduler.tick();assert.equal(aiCalls,before+1);

const reportContent=()=>JSON.parse(run('SELECT content_json FROM weekly_reports;',true)[0].content_json);
const tickAt=async minute=>{
 now=new Date(`2026-10-27T02:${minute}:00Z`);
 assert.equal((await createReportAutomation(options).tick()).status,'started');
};
item.form_contents[0].field_value='更新周报，模拟评分引文失败';
invalidQuality=true;
availableRequests=2;
const beforeValidationFailures=aiCalls;
await tickAt(25);
assert.equal(aiCalls,beforeValidationFailures+2);
assert.equal(status.blockedReason,'daily_ai_request_limit');
sync=createSync();
availableRequests=5;
await tickAt(30);
assert.equal(aiCalls,beforeValidationFailures+4,'only the two remaining automatic validation attempts are used after restarting');
assert.equal(status.retryHeld,1,'the run that reaches four validation failures immediately reports the held item');
assert.equal(status.failed,0);
assert.equal(status.remaining,0);
sync=createSync();
await tickAt(35);
assert.equal(aiCalls,beforeValidationFailures+4,'automatic polling holds the same failed report after four total attempts');
assert.equal(status.retryHeld,1);
assert.equal(status.byMonth['2026-10'].retryHeld,1);
assert.equal(reportContent().qualityRefresh.state,'failed');
assert.equal(reportContent().qualityRefresh.retryHeld,true);
await sync.run({start:'2026-10-01',end:'2026-10-27'});
assert.equal(aiCalls,beforeValidationFailures+4,'immediate sync also holds a report that exhausted its automatic attempts');
assert.equal(status.retryHeld,1);

invalidQuality=false;
availableRequests=0;
await sync.run({mode:'rescore',targetMonth:'2026-10'});
assert.equal(aiCalls,beforeValidationFailures+4,'manual continuation still respects the daily cap');
assert.equal(status.blockedReason,'daily_ai_request_limit');
availableRequests=1;
await sync.run({mode:'rescore',targetMonth:'2026-10'});
assert.equal(aiCalls,beforeValidationFailures+5);
assert.equal(status.analyzed,1);
assert.equal(reportContent().qualityRefresh.state,'ready');
await tickAt(40);
assert.equal(aiCalls,beforeValidationFailures+5);
assert.equal(status.cached,1,'successful manual recovery is reused by automation');

const {ai, ...legacyReport}=reportContent();
const legacyDiagnostic={code:'evidence_not_in_source',path:'modules.results.criteria.result.evidence.0.quote',retryable:true};
legacyReport.aiAnalysisAttempts=Array.from({length:4},(_,index)=>({at:`2026-10-27T01:00:0${index}Z`,targetVersion:REPORT_QUALITY_VERSION,promptVersion:REPORT_QUALITY_PROMPT_VERSION,sourceHash:legacyReport.sourceHash,attempt:index+1,...legacyDiagnostic}));
legacyReport.qualityRefresh={state:'failed',targetVersion:REPORT_QUALITY_VERSION,model:config.kimiFollowupModel,sourceHash:legacyReport.sourceHash,jobId:'old-job',attempts:4,diagnostic:legacyDiagnostic};
run(`UPDATE weekly_reports SET content_json=${sql(JSON.stringify(legacyReport))};`);
sync=createSync();
availableRequests=1;
await tickAt(45);
assert.equal(aiCalls,beforeValidationFailures+5,'legacy matching validation failures are held without issuing another request');
assert.equal(status.retryHeld,1);
item.form_contents[0].field_value='再次更新周报，触发新的评分';
await tickAt(50);
assert.equal(aiCalls,beforeValidationFailures+6,'a different source hash starts a new validation budget');
assert.equal(status.analyzed,1);

const state=await scheduler.overview();assert.equal(state.config.enabled,true);assert.equal(state.config.intervalMinutes,5);assert(state.lastAttemptAt);assert(state.nextCheckAt);

const admin={userId:'admin',name:'管理员'};
await assert.rejects(settings.saveReportAutomation({enabled:true,intervalMinutes:5,dailyAiRequestLimit:-1},admin),/invalid_ai_request_limit/);
await settings.saveReportAutomation({enabled:true,intervalMinutes:5,dailyAiRequestLimit:3},admin);
await settings.saveReportAutomation({enabled:true,intervalMinutes:10},admin);
assert.equal((await settings.reportAutomationConfig()).dailyAiRequestLimit,3,'omitting the limit preserves the existing setting');
now=new Date('2026-10-27T15:59:59Z');
const restartedSettings=createSystemSettings({query,exec,sql,config,now:()=>now});
const reservations=await Promise.all([
 settings.reserveReportAiRequest(),restartedSettings.reserveReportAiRequest(),settings.reserveReportAiRequest(),
 restartedSettings.reserveReportAiRequest(),settings.reserveReportAiRequest(),
]);
assert.equal(reservations.filter(result=>result===true).length,3);
assert.equal(await restartedSettings.reportAiRequestsToday(),3,'usage is shared by all settings instances');
assert.equal(await restartedSettings.reserveReportAiRequest(),false,'denied reservations do not advance the counter');
assert.equal((await scheduler.overview()).aiRequestsToday,3);

useStoredBudget=true;
await settings.saveReportAutomation({enabled:true,intervalMinutes:10,dailyAiRequestLimit:0},admin);
assert.equal((await scheduler.overview()).config.dailyAiRequestLimit,0);
assert.equal(await restartedSettings.reserveReportAiRequest(),'ai_scoring_paused');
const beforePause=aiCalls;
item.form_contents[0].field_value='评分暂停期间提交的新周报内容';
assert.equal((await scheduler.tick()).status,'started');
assert.equal(reportContent().results,item.form_contents[0].field_value,'collection still stores the source while scoring is paused');
assert.equal(aiCalls,beforePause);
assert.equal(status.phase,'paused');
assert.equal(status.blockedReason,'ai_scoring_paused');
assert.equal(status.remaining,1);

now=new Date('2026-10-27T16:00:00Z');
assert.equal(await settings.reportAiRequestsToday(),0,'the allowance resets at midnight in Shanghai');
assert.equal(await settings.reserveReportAiRequest(),'ai_scoring_paused','zero stays paused on the new day');
await sync.run({mode:'rescore',targetMonth:'2026-10'});
assert.equal(aiCalls,beforePause,'manual rescoring stays paused across midnight');
assert.equal(status.blockedReason,'ai_scoring_paused');
assert.equal(await restartedSettings.reportAiRequestsToday(),0);

await settings.saveReportAutomation({enabled:true,intervalMinutes:10,dailyAiRequestLimit:3},admin);
await sync.run({mode:'rescore',targetMonth:'2026-10'});
assert.equal(aiCalls,beforePause+1,'restoring a positive limit resumes pending scoring');
assert.equal(status.analyzed,1);
assert.equal(await restartedSettings.reportAiRequestsToday(),1);

await settings.saveReportAutomation({enabled:false,intervalMinutes:5},admin);assert.equal((await scheduler.tick()).skipped,'disabled');assert.equal((await scheduler.overview()).nextCheckAt,null);
assert.equal(run('SELECT count(*) AS n FROM scoring360_responses;',true)[0].n,0);assert.equal(run('SELECT count(*) AS n FROM monthly_score_reminder_deliveries;',true)[0].n,0);
assert.equal(run('PRAGMA integrity_check;').trim(),'ok');
console.log('Passed: Feishu submission → timed collection → source storage → AI analysis → automatic quality/statistics, changed-content reanalysis, invalid-cache retry, persisted validation retry hold and manual recovery, no fabricated collaboration, persisted/restart/concurrent interval and no messages.');console.log('Artifacts retained:',dir);
