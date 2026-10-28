import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createReportAutomation} from '../server/report-automation.mjs';
import {createLiveReportSync} from '../server/live-report-sync.mjs';
import {createSystemSettings} from '../server/system-settings.mjs';
import {createPerformance} from '../server/performance.mjs';
await mkdir('outputs/tests',{recursive:true});const dir=await mkdtemp(path.resolve('outputs/tests/report-automation-')),db=dir+'/test.sqlite';
const sql=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const run=(input,json=false)=>{const r=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input,encoding:'utf8'});if(r.status)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout;};
const query=async s=>run(s,true),exec=async s=>run(s);run(await readFile('db/schema.sql','utf8'));
let now=new Date('2026-10-27T02:00:00Z'),aiCalls=0,queries=0,fail=false,lock=false,status;
const config={sessionSecret:'test-key',dataDir:dir,feishuAppId:'cli_test',feishuAppSecret:'test-secret',moonshotApiKey:'test-ai-key',moonshotBaseUrl:'https://ai.example.test/v1',kimiFollowupModel:'test-model',larkReportAutoSyncEnabled:false};
const settings=createSystemSettings({query,exec,sql,config,now:()=>now});
const item={task_id:'test-task',from_user_id:'test-staff',from_user_name:'测试员工',department_name:'测试部门',rule_id:'test-rule',rule_name:'周报（聚焦结果与协作）',commit_time:Math.floor(Date.parse('2026-10-23T19:00:00+08:00')/1000),form_contents:[{field_name:'本周成果',field_value:'完成3项验收'},{field_name:'问题与挑战',field_value:'接口待确认'},{field_name:'下周工作计划与目标',field_value:'完成接口验证'},{field_name:'思考与复盘',field_value:'提前确认验收口径'}]};
const fetcher=async url=>{
 let result;if(url.includes('tenant_access_token'))result={code:0,tenant_access_token:'fake-token'};
 else if(url.includes('tasks/query')){queries++;result={code:0,data:{items:[item],has_more:false}};}
 else{aiCalls++;if(fail)return {ok:false,status:429,json:async()=>({error:{type:'test-rate-limit'}})};result={choices:[{message:{content:JSON.stringify({scores:[90,80,85,75],summary:'真实输入链路的模拟AI点评',questions:['如何验证交付？'],anomalies:[],tasks:[]})}}]};}
 return {ok:true,status:200,json:async()=>result};
};
const managerReviews={snapshot:async()=>({plans:new Map(),scores:[],bossScores:[]}),progress:()=>({kind:'unassigned',expected:0,submitted:0,complete:false,score:null})};
const performance=createPerformance({query,exec,sql,managerReviews,policyFor:settings.policyFor,readData:name=>JSON.parse(readFileSync(path.join(dir,name+'.json'),'utf8')),now:()=>now});
let published=0;
const sync=createLiveReportSync({query,exec,sql,config,settings,refreshDirectory:async()=>{},writeStatus:async value=>{status=value;},pause:async()=>{},fetcher,onComplete:async()=>{published++;await performance.overview();}});
const options={query,exec,sql,getConfig:settings.reportAutomationConfig,isRunning:()=>lock,start:async range=>{await sync.run(range);return true;},now:()=>now};
const scheduler=createReportAutomation(options);
assert.equal((await scheduler.tick()).skipped,'disabled');assert.equal(aiCalls,0);
await assert.rejects(settings.saveReportAutomation({enabled:true,intervalMinutes:1},{userId:'admin',name:'管理员'}),/invalid_report_automation/);
await settings.saveReportAutomation({enabled:true,intervalMinutes:5},{userId:'admin',name:'管理员'});
const results=await Promise.all([scheduler.tick(),createReportAutomation(options).tick()]);assert.equal(results.filter(r=>r.status==='started').length,1);assert.equal(aiCalls,1);assert.equal(queries,1);assert.equal(published,1);
let personal=await performance.personal('测试员工','test-staff');assert.equal(personal.history[0].quality,83.3);assert.equal(personal.history[0].timeliness.rate,100);assert.equal(personal.history[0].collaboration,null,'AI must not generate collaboration ratings');
assert.equal((await createReportAutomation(options).tick()).skipped,'not_due','restart uses persisted interval');
const generatedAt=JSON.parse(run('SELECT content_json FROM weekly_reports;',true)[0].content_json).aiGeneratedAt;assert(generatedAt);now=new Date('2026-10-27T02:05:00Z');await scheduler.tick();assert.equal(JSON.parse(run('SELECT content_json FROM weekly_reports;',true)[0].content_json).aiGeneratedAt,generatedAt,'cache retains original AI generation time');assert.equal(queries,2);assert.equal(aiCalls,1,'unchanged report content/model reuses analysis');
item.form_contents[0].field_value='新增验收结果，内容发生变化';now=new Date('2026-10-27T02:10:00Z');fail=true;await scheduler.tick();assert.equal(status.failed,1);assert.equal(run('SELECT count(*) AS n FROM weekly_reports;',true)[0].n,1,'AI failure retains report source');assert.equal((await performance.personal('测试员工','test-staff')).history[0].quality,null,'failed AI analysis must not invent or reuse stale scores');
fail=false;now=new Date('2026-10-27T02:15:00Z');await scheduler.tick();assert.equal((await performance.personal('测试员工','test-staff')).history[0].quality,83.3);assert.equal(status.failed,0);
const before=aiCalls;lock=true;now=new Date('2026-10-27T02:20:00Z');assert.equal((await scheduler.tick()).skipped,'sync_running');assert.equal(aiCalls,before);lock=false;
// Corrupt/incomplete cached analysis is retried instead of trusted as a complete grade.
run("UPDATE weekly_reports SET content_json=json_set(content_json,'$.ai.scores',json('[90]'));");await scheduler.tick();assert.equal(aiCalls,before+1);
const state=await scheduler.overview();assert.equal(state.config.enabled,true);assert.equal(state.config.intervalMinutes,5);assert(state.lastAttemptAt);assert(state.nextCheckAt);
await settings.saveReportAutomation({enabled:false,intervalMinutes:5},{userId:'admin',name:'管理员'});assert.equal((await scheduler.tick()).skipped,'disabled');assert.equal((await scheduler.overview()).nextCheckAt,null);
assert.equal(run('SELECT count(*) AS n FROM scoring360_responses;',true)[0].n,0);assert.equal(run('SELECT count(*) AS n FROM monthly_score_reminder_deliveries;',true)[0].n,0);
assert.equal(run('PRAGMA integrity_check;').trim(),'ok');
console.log('Passed: Feishu submission → timed collection → source storage → AI analysis → automatic quality/statistics, changed-content reanalysis, invalid-cache retry, failure retry, no fabricated collaboration, persisted/restart/concurrent interval and no messages.');console.log('Artifacts retained:',dir);
