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
const run=(input,json=false,database=db)=>{const r=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),database],{input,encoding:'utf8'});if(r.status)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout;};
const schema=await readFile('db/schema.sql','utf8');
const query=async s=>run(s,true),exec=async s=>run(s);run(schema);
let now=new Date('2026-10-23T19:59:00+08:00'),aiCalls=0,queries=0,providerFailure='',invalidQuality=false,lock=false,status,availableRequests=null;
const config={sessionSecret:'test-key',dataDir:dir,feishuAppId:'cli_test',feishuAppSecret:'test-secret',moonshotApiKey:'test-ai-key',moonshotBaseUrl:'https://ai.example.test/v1',kimiFollowupModel:'test-model',larkReportAutoSyncEnabled:false};
const settings=createSystemSettings({query,exec,sql,config,now:()=>now});
const item={task_id:'test-task',from_user_id:'test-staff',from_user_name:'测试员工',department_name:'测试部门',rule_id:'test-rule',rule_name:'周报（聚焦结果与协作）',commit_time:Math.floor(Date.parse('2026-10-23T19:00:00+08:00')/1000),form_contents:[{field_name:'本周成果',field_value:'完成3项验收'},{field_name:'问题与挑战',field_value:'接口待确认'},{field_name:'下周工作计划与目标',field_value:'完成接口验证'},{field_name:'思考与复盘',field_value:'提前确认验收口径'}]};
let incoming=[item];
const modelWeeks=[];
const fetcher=async(url,options)=>{
 let result;if(url.includes('tenant_access_token'))result={code:0,tenant_access_token:'fake-token'};
 else if(url.includes('tasks/query')){queries++;result={code:0,data:{items:incoming,has_more:false}};}
 else{
  aiCalls++;
  const {week,report:facts}=JSON.parse(JSON.parse(options.body).messages.find(message=>message.role==='user').content);
  modelWeeks.push(week);
  if(providerFailure==='network')throw new TypeError('synthetic network failure');
  if(providerFailure==='permission')return {ok:false,status:403,json:async()=>({error:{type:'permission_denied_error'}})};
  if(providerFailure==='rate_limit')return {ok:false,status:429,json:async()=>({error:{type:'rate_limit_reached_error'}})};
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
const options={query,exec,sql,getConfig:settings.reportAutomationConfig,getAiRequestsToday:settings.reportAiRequestsToday,calendar:()=>({}),policyFor:settings.policyFor,isRunning:()=>lock,start:async range=>{await sync.run(range);return true;},now:()=>now};
const scheduler=createReportAutomation(options);
const admin={userId:'admin',name:'管理员'};
const nextCheck=async(scheduler,date,kind)=>{
 const overview=await scheduler.overview();
 assert.equal(overview.nextCheckAt,new Date(date).toISOString());
 assert.equal(overview.nextCheckKind,kind);
};
const tickAt=async date=>{
 now=new Date(date);
 return scheduler.tick();
};
assert.equal((await scheduler.tick()).skipped,'disabled');assert.equal(aiCalls,0);
assert.equal((await settings.reportAutomationConfig()).scoringStartMonth,'2026-11');
await assert.rejects(settings.saveReportAutomation({enabled:true,intervalMinutes:1},admin),/invalid_report_automation/);
await settings.saveReportAutomation({enabled:true,scoringStartMonth:'2026-10'},admin);
const oldState={lastAttemptAt:'2026-10-23T11:58:00.000Z',status:'started'};
run(`INSERT INTO app_settings(key,value_json) VALUES('report_automation_state',${sql(JSON.stringify(oldState))});`);
await nextCheck(scheduler,'2026-10-23T20:05:00+08:00','deadline');
assert.equal((await tickAt('2026-10-23T20:04:59+08:00')).skipped,'not_due');
assert.equal(queries,0,'no Feishu query before the deadline collection slot');
now=new Date('2026-10-23T20:05:00+08:00');
lock=true;
assert.equal((await scheduler.tick()).skipped,'sync_running');
lock=false;
const results=await Promise.all([scheduler.tick(),createReportAutomation(options).tick()]);assert.equal(results.filter(r=>r.status==='started').length,1);assert.equal(aiCalls,1);assert.equal(queries,1);assert.equal(published,3,'initial queue, each completed report and final sync state project independently');
const history=async()=>(await performance.personal('测试员工','test-staff')).history[0];
const personal=await history();
assert.equal(personal.quality,null);assert.equal(personal.qualityStatus,'pending_confirmation');
assert.equal(personal.monthlyQuality.candidateScore,83.3);assert.equal(personal.timeliness.rate,100);
assert.equal(personal.collaboration,null,'AI must not generate collaboration ratings');
assert.equal((await createReportAutomation(options).tick()).skipped,'not_due','restart preserves the completed slot');
await nextCheck(scheduler,'2026-10-26T09:00:00+08:00','followup');
await settings.saveReportAutomation({enabled:true,intervalMinutes:5},admin);
assert.equal((await tickAt('2026-10-23T20:10:00+08:00')).skipped,'not_due','the old saved polling interval no longer triggers a collection');
assert.equal((await tickAt('2026-10-25T09:00:00+08:00')).skipped,'not_due','Sunday does not trigger a collection');
assert.equal((await tickAt('2026-10-26T08:59:00+08:00')).skipped,'not_due');
assert.equal(queries,1,'only the deadline collection has queried Feishu');
const reportContent=()=>JSON.parse(run("SELECT content_json FROM weekly_reports WHERE id='lark-report-test-task';",true)[0].content_json);
const generatedAt=reportContent().aiGeneratedAt;
assert(generatedAt);
const lateItem={...item,task_id:'test-late-task',from_user_id:'late-staff',from_user_name:'迟交测试员工',commit_time:Date.parse('2026-10-26T08:58:00+08:00')/1000};
incoming=[item,lateItem];
const followup=await tickAt('2026-10-26T09:00:00+08:00');
assert.equal(followup.status,'started');
assert.equal(followup.start,'2026-09-12','the existing 45-day lookback still covers earlier late reports');
assert.equal(followup.end,'2026-10-26','the follow-up covers submissions made after the original deadline');
assert.equal(reportContent().aiGeneratedAt,generatedAt,'cache retains original AI generation time');
assert.equal(queries,2);assert.equal(aiCalls,2,'only the newly submitted late report gets scored');
assert.deepEqual(run("SELECT week_end,is_late FROM weekly_reports WHERE id='lark-report-test-late-task';",true),[{week_end:'2026-10-23',is_late:1}]);
incoming=[item];
await nextCheck(scheduler,'2026-10-30T20:05:00+08:00','deadline');
assert.equal((await tickAt('2026-10-26T09:15:00+08:00')).skipped,'not_due');
assert.equal(queries,2);

// Drive repeat sync directly to exercise AI failure and recovery independently of collection slots.
const octoberRange={start:'2026-10-01',end:'2026-10-27'};
const syncAt=async minute=>{
 now=new Date(`2026-10-27T02:${minute}:00Z`);
 await sync.run(octoberRange);
};
item.form_contents[0].field_value='新增验收结果，内容发生变化';providerFailure='rate_limit';await syncAt(10);assert.equal(status.failed,1);assert.equal(run("SELECT count(*) AS n FROM weekly_reports WHERE id='lark-report-test-task';",true)[0].n,1,'AI failure retains report source');
const duringFailure=await history(),[previousReport]=await performance.reports({employeeUserId:'test-staff',month:'2026-10'});
assert.equal(duringFailure.quality,null);assert.equal(duringFailure.qualityStatus,'pending_ai');assert.equal(duringFailure.qualityRefresh.status,'rescore_failed');
assert.equal(duringFailure.monthlyQuality.currentAverage,null,'failed reanalysis does not mix old weekly points into the current mean');
assert.equal(previousReport.displayQualityScore,83.3);assert.equal(previousReport.qualityDisplaySource,'previous');
providerFailure='';await syncAt(15);
const recovered=await history();assert.equal(recovered.quality,null);assert.equal(recovered.monthlyQuality.candidateScore,83.3);assert.equal(status.failed,0);
const before=aiCalls;
// Corrupt/incomplete cached analysis is retried instead of trusted as a complete grade.
run("UPDATE weekly_reports SET content_json=json_set(content_json,'$.ai.modules',json('[]')) WHERE id='lark-report-test-task';");await syncAt(20);assert.equal(aiCalls,before+1);

item.form_contents[0].field_value='更新周报，模拟评分引文失败';
invalidQuality=true;
availableRequests=1;
const beforeValidationFailures=aiCalls;
await syncAt(25);
assert.equal(aiCalls,beforeValidationFailures+1);
assert.equal(status.blockedReason,'daily_ai_request_limit');
sync=createSync();
availableRequests=5;
await syncAt(30);
assert.equal(aiCalls,beforeValidationFailures+2,'only the remaining automatic validation attempt is used after restarting');
assert.equal(status.retryHeld,1,'the run that reaches two validation failures immediately reports the held item');
assert.equal(status.failed,0);
assert.equal(status.remaining,0);
sync=createSync();
await syncAt(35);
assert.equal(aiCalls,beforeValidationFailures+2,'sync holds the same failed report after two total attempts');
assert.equal(status.retryHeld,1);
assert.equal(status.byMonth['2026-10'].retryHeld,1);
assert.equal(reportContent().qualityRefresh.state,'failed');
assert.equal(reportContent().qualityRefresh.retryHeld,true);
await sync.run({start:'2026-10-01',end:'2026-10-27'});
assert.equal(aiCalls,beforeValidationFailures+2,'immediate sync also holds a report that exhausted its automatic attempts');
assert.equal(status.retryHeld,1);

invalidQuality=false;
availableRequests=0;
await sync.run({mode:'rescore',targetMonth:'2026-10'});
assert.equal(aiCalls,beforeValidationFailures+2,'manual continuation still respects the daily cap');
assert.equal(status.blockedReason,'daily_ai_request_limit');
availableRequests=1;
await sync.run({mode:'rescore',targetMonth:'2026-10'});
assert.equal(aiCalls,beforeValidationFailures+3);
assert.equal(status.analyzed,1);
assert.equal(reportContent().qualityRefresh.state,'ready');
await syncAt(40);
assert.equal(aiCalls,beforeValidationFailures+3);
assert.equal(status.cached,1,'successful manual recovery is reused by collection');

const {ai, ...legacyReport}=reportContent();
const legacyDiagnostic={code:'evidence_not_in_source',path:'modules.results.criteria.result.evidence.0.quote',retryable:true};
// Four failures were possible in the old version and must still block another automatic attempt.
legacyReport.aiAnalysisAttempts=Array.from({length:4},(_,index)=>({at:`2026-10-27T01:00:0${index}Z`,targetVersion:REPORT_QUALITY_VERSION,promptVersion:REPORT_QUALITY_PROMPT_VERSION,sourceHash:legacyReport.sourceHash,attempt:index+1,...legacyDiagnostic}));
legacyReport.qualityRefresh={state:'failed',targetVersion:REPORT_QUALITY_VERSION,model:config.kimiFollowupModel,sourceHash:legacyReport.sourceHash,jobId:'old-job',attempts:4,diagnostic:legacyDiagnostic};
run(`UPDATE weekly_reports SET content_json=${sql(JSON.stringify(legacyReport))} WHERE id='lark-report-test-task';`);
sync=createSync();
availableRequests=1;
await syncAt(45);
assert.equal(aiCalls,beforeValidationFailures+3,'legacy matching validation failures are held without issuing another request');
assert.equal(status.retryHeld,1);
item.form_contents[0].field_value='再次更新周报，触发新的评分';
await syncAt(50);
assert.equal(aiCalls,beforeValidationFailures+4,'a different source hash starts a new validation budget');
assert.equal(status.analyzed,1);

const state=await scheduler.overview();assert.equal(state.config.enabled,true);assert.equal(state.lastAttemptAt,'2026-10-26T01:00:00.000Z');assert(state.nextCheckAt);

await assert.rejects(settings.saveReportAutomation({enabled:true,intervalMinutes:5,dailyAiRequestLimit:-1},admin),/invalid_ai_request_limit/);
await settings.saveReportAutomation({enabled:true,intervalMinutes:5,dailyAiRequestLimit:3},admin);
await settings.saveReportAutomation({enabled:true},admin);
assert.equal((await settings.reportAutomationConfig()).dailyAiRequestLimit,3,'omitting the limit preserves the existing setting');
assert.equal((await settings.reportAutomationConfig()).scoringStartMonth,'2026-10','omitting the start month preserves the existing setting');
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
await sync.run(octoberRange);
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

const octoberBoundary={...item,task_id:'test-october-boundary',commit_time:Date.parse('2026-10-30T19:00:00+08:00')/1000,form_contents:structuredClone(item.form_contents)};
incoming=[octoberBoundary];
await sync.run({start:'2026-10-30',end:'2026-10-30'});
assert.equal(status.analyzed,1);
const readOctober=()=>run("SELECT * FROM weekly_reports WHERE substr(week_end,1,7)='2026-10' ORDER BY id;",true);
const octoberBefore=readOctober();
assert(octoberBefore.some(report=>report.week_end==='2026-10-30'));
const lateOctober={...octoberBoundary,commit_time:Date.parse('2026-11-02T19:00:00+08:00')/1000,form_contents:structuredClone(octoberBoundary.form_contents)};
lateOctober.form_contents[0].field_value='十一月提交，仍属于十月周报';
const november={...item,task_id:'test-november',commit_time:Date.parse('2026-11-06T19:00:00+08:00')/1000,form_contents:structuredClone(item.form_contents)};
incoming=[lateOctober,november];
await assert.rejects(settings.saveReportAutomation({enabled:true,intervalMinutes:5,scoringStartMonth:'2026-13'},admin));
await settings.saveReportAutomation({enabled:true,intervalMinutes:5,scoringStartMonth:'2026-11'},admin);
now=new Date('2026-11-10T02:00:00Z');
const beforeNovember=aiCalls;
await sync.run({start:'2026-10-01',end:'2026-11-10'});
assert.deepEqual(modelWeeks.slice(beforeNovember),['2026-11-06'],'a November submission belonging to October cannot trigger scoring');
assert.deepEqual(readOctober(),octoberBefore,'the scoring start month preserves all existing October report rows');
await assert.rejects(sync.run({mode:'rescore',targetMonth:'2026-10'}),/rescore_before_start_month/);
assert.equal(aiCalls,beforeNovember+1,'a historical rescore before the start month cannot consume an AI request');
assert.deepEqual(readOctober(),octoberBefore);

const novemberRange={start:'2026-11-01',end:'2026-11-10'};
useStoredBudget=false;
availableRequests=1;
providerFailure='network';
november.form_contents[0].field_value='模拟同一份周报跨批次发生网络错误';
const beforeNetworkFailures=aiCalls;
await sync.run(novemberRange);
assert.equal(aiCalls,beforeNetworkFailures+1);
assert.equal(status.blockedReason,'daily_ai_request_limit');
sync=createSync();
availableRequests=null;
await sync.run(novemberRange);
assert.equal(aiCalls,beforeNetworkFailures+2);
assert.equal(status.retryHeld,1,'two ambiguous network failures count across runs');
await sync.run(novemberRange);
assert.equal(aiCalls,beforeNetworkFailures+2,'another run does not issue requests for the held report');

providerFailure='permission';
november.form_contents[0].field_value='模拟权限错误后修复并完成评分';
const beforePermissionFailures=aiCalls;
for(let attempt=0;attempt<2;attempt++){
 await sync.run(novemberRange);
 assert.equal(status.failed,1);
 assert.equal(status.retryHeld,0,'explicit provider permission errors do not consume the permanent retry allowance');
}
assert.equal(aiCalls,beforePermissionFailures+2,'explicit permission errors do not retry in the same run');
providerFailure='';
await sync.run(novemberRange);
assert.equal(aiCalls,beforePermissionFailures+3);
assert.equal(status.analyzed,1,'the same source can recover after provider permissions are fixed');

await settings.saveReportAutomation({enabled:false,intervalMinutes:5},admin);assert.equal((await scheduler.tick()).skipped,'disabled');assert.equal((await scheduler.overview()).nextCheckAt,null);
assert.equal(run('SELECT count(*) AS n FROM scoring360_responses;',true)[0].n,0);assert.equal(run('SELECT count(*) AS n FROM monthly_score_reminder_deliveries;',true)[0].n,0);
assert.equal(run('PRAGMA integrity_check;').trim(),'ok');

function scheduleFixture(name,calendar={},deadlineTime='20:00',onStart=()=>true){
 const database=path.join(dir,name+'.sqlite');
 run(schema,false,database);
 let clock;
 const calls=[];
 const make=()=>createReportAutomation({
  query:async statement=>run(statement,true,database),exec:async statement=>run(statement,false,database),sql,
  getConfig:async()=>({enabled:true,feishuConfigured:true,aiConfigured:true,intervalMinutes:5}),
  calendar:()=>calendar,policyFor:async()=>({deadlineTime}),isRunning:()=>false,
  start:async range=>{calls.push(range);return onStart(range);},now:()=>clock,
 });
 const collector=make();
 return {collector,calls,make,at:date=>{clock=new Date(date);}};
}

const holiday=scheduleFixture('holiday',{year:2026,autoManaged:true,holidayDates:['2026-10-23','2026-10-24','2026-10-25','2026-10-26']});
holiday.at('2026-10-22T20:04:59+08:00');
await nextCheck(holiday.collector,'2026-10-22T20:05:00+08:00','deadline');
assert.equal((await holiday.collector.tick()).skipped,'not_due');
holiday.at('2026-10-22T20:05:00+08:00');
assert.equal((await holiday.collector.tick()).status,'started');
await nextCheck(holiday.collector,'2026-10-27T09:00:00+08:00','followup');
for(const date of ['2026-10-23T20:05:00+08:00','2026-10-26T09:00:00+08:00','2026-10-27T08:59:59+08:00']){
 holiday.at(date);
 assert.equal((await holiday.collector.tick()).skipped,'not_due');
}
holiday.at('2026-10-27T09:00:00+08:00');
assert.equal((await holiday.make().tick()).status,'started','the next workday skips the entire holiday');
assert.deepEqual(holiday.calls.map(range=>range.end),['2026-10-22','2026-10-27']);

const makeup=scheduleFixture('makeup-workday',{year:2026,autoManaged:true,holidayDates:['2026-10-23'],workdayOverrides:['2026-10-24']});
makeup.at('2026-10-22T20:05:00+08:00');
assert.equal((await makeup.collector.tick()).status,'started');
await nextCheck(makeup.collector,'2026-10-24T09:00:00+08:00','followup');
makeup.at('2026-10-24T09:00:00+08:00');
assert.equal((await makeup.collector.tick()).status,'started','a Saturday makeup workday can host the follow-up');
assert.deepEqual(makeup.calls.map(range=>range.end),['2026-10-22','2026-10-24']);

const exempt=scheduleFixture('exempt-week',{year:2026,autoManaged:true,holidayDates:Array.from({length:7},(_,i)=>`2026-11-0${i+2}`)});
exempt.at('2026-11-06T20:05:00+08:00');
assert.equal((await exempt.collector.tick()).skipped,'not_due');
assert.equal(exempt.calls.length,0,'a week with no workdays has no deadline collection');

const calendarPending=scheduleFixture('unknown-calendar',{year:2025,autoManaged:true});
calendarPending.at('2026-10-23T20:05:00+08:00');
assert.equal((await calendarPending.collector.tick()).skipped,'not_due');
assert.equal((await calendarPending.collector.overview()).nextCheckAt,null);
assert.equal(calendarPending.calls.length,0,'an unknown work calendar must not fall back to a speculative Friday');

const restarted=scheduleFixture('restart-catchup');
restarted.at('2026-10-23T22:10:00+08:00');
assert.equal((await restarted.make().tick()).status,'started','restart after the deadline catches the most recent missed slot');
assert.equal((await restarted.make().tick()).skipped,'not_due','a second restart does not collect the same slot');
assert.equal(restarted.calls.length,1);

let readyToStart=false;
const retry=scheduleFixture('retry-claim',{},'20:00',()=>readyToStart);
retry.at('2026-10-23T20:05:00+08:00');
assert.equal((await retry.collector.tick()).status,'sync_running','a concurrent manual sync can win after the scheduler claim');
readyToStart=true;
retry.at('2026-10-23T20:09:59+08:00');
assert.equal((await retry.make().tick()).skipped,'not_due');
retry.at('2026-10-23T20:10:00+08:00');
assert.equal((await retry.make().tick()).status,'started','the slot is retried after the manual sync clears');
assert.equal((await retry.collector.tick()).skipped,'not_due');
assert.equal(retry.calls.length,2);

const missed=scheduleFixture('expired-slot');
missed.at('2026-10-24T20:06:00+08:00');
assert.equal((await missed.collector.tick()).skipped,'not_due','a missed slot older than 24 hours does not trigger a catch-up');
missed.at('2026-10-26T09:01:00+08:00');
assert.equal((await missed.collector.tick()).status,'started');
assert.equal(missed.calls.length,1,'the follow-up collects once without replaying the missed deadline slot');

const custom=scheduleFixture('configured-cutoff',{},'18:30');
custom.at('2026-10-23T18:34:59+08:00');
await nextCheck(custom.collector,'2026-10-23T18:35:00+08:00','deadline');
assert.equal((await custom.collector.tick()).skipped,'not_due');
custom.at('2026-10-23T18:35:00+08:00');
assert.equal((await custom.collector.tick()).status,'started');

console.log('Passed: deadline and next-workday collection, holiday and exempt weeks, configured deadlines, persisted and concurrent slot claims, restart catch-up, November scoring start, AI cache/retry/budget, manual recovery and no messages.');console.log('Artifacts retained:',dir);
