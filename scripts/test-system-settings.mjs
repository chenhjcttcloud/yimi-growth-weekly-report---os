import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPerformance} from '../server/performance.mjs';
import {createSystemSettings} from '../server/system-settings.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'system-settings-')),db=path.join(dir,'db.sqlite');
function run(s,json=false){const r=spawnSync('sqlite3',[...(json?['-json']:[]),db,s],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout;}
const sql=v=>"'"+String(v).replaceAll("'","''")+"'";
const config={sessionSecret:'test-session-secret',moonshotBaseUrl:'https://api.moonshot.cn/v1',kimiFollowupModel:'model',moonshotApiKey:'',authMode:'mock'};
const dependencies={query:async s=>run(s,true),exec:async s=>run(s),sql,config,now:()=>new Date('2026-10-23T00:00:00Z')};
try{
 run(await readFile('db/schema.sql','utf8'));
 const service=createSystemSettings(dependencies),user={userId:'admin',name:'管理员'};
 await service.saveReport({appId:'cli_test123',appSecret:'report-secret-test',templateName:'周报（聚焦结果与协作）',ruleId:'weekly',startDate:'2026-10-01'},user);
 assert(!JSON.stringify(await service.overview()).includes('report-secret-test'));assert(!run("SELECT value_json FROM app_settings WHERE key='feishu_report'").includes('report-secret-test'));
 const restoredReport={sessionSecret:'test-session-secret'};await createSystemSettings({...dependencies,config:restoredReport}).initialize();assert.equal(restoredReport.feishuAppSecret,'report-secret-test');
 await service.saveReport({appId:'cli_test123',templateName:'周报（聚焦结果与协作）'},user);assert.equal(config.feishuAppSecret,'report-secret-test');
 await assert.rejects(service.saveReport({appId:'cli_other',templateName:'周报'},user),/report_secret_required/);
 const policy={weights:[40,20,20,20],deadlineTime:'19:30',reminderWaitHours:48,reminderCooldownHours:12};
 await assert.rejects(service.savePolicy({effectiveMonth:'2026-10',policy},user),/future_cycle_required/);
 await assert.rejects(service.savePolicy({effectiveMonth:'2026-11',policy:{...policy,weights:[50,50,50,50]}},user),/invalid_weights/);
 await service.savePolicy({effectiveMonth:'2026-11',policy},user);
 assert.deepEqual((await service.policyFor('2026-10')).weights,[30,25,25,20]);assert.equal((await service.policyFor('2026-11')).deadlineTime,'19:30');
 await assert.rejects(service.savePolicy({effectiveMonth:'2026-11',policy},user),/policy_version_exists/);
 await assert.rejects(service.saveAI({baseUrl:'http://localhost/v1',model:'test'},user),/invalid_ai_url/);
 await service.saveAI({baseUrl:'https://api.example.com/v1',model:'test-model',apiKey:'secret-test-api-key'},user);
 const exposed=JSON.stringify(await service.overview())+JSON.stringify(await service.logs());assert(!exposed.includes('secret-test-api-key'));assert(!run("SELECT value_json FROM app_settings WHERE key='ai_runtime'").includes('secret-test-api-key'));
 const nextConfig={sessionSecret:'test-session-secret'};await createSystemSettings({...dependencies,config:nextConfig}).initialize();assert.equal(nextConfig.moonshotApiKey,'secret-test-api-key');
 await service.saveAI({baseUrl:'https://api.example.com/v1',model:'next'},user);assert.equal(config.moonshotApiKey,'secret-test-api-key');
 await service.saveAI({baseUrl:'https://api.example.com/v1',model:'next',clearKey:true},user);assert.equal(config.moonshotApiKey,'');
 const restoredClear={sessionSecret:'test-session-secret',moonshotApiKey:'environment-key'};await createSystemSettings({...dependencies,config:restoredClear}).initialize();assert.equal(restoredClear.moonshotApiKey,'');
 const performance=createPerformance({query:async q=>run(q,true).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v===null?'':v]))),exec:async q=>run(q),sql,policyFor:service.policyFor,readData:()=>({weekly_scores:[{'姓名':'员工','结束日期':'2026-10-30','开始日期':'2026-10-26','提交时间':'2026-10-30 19:45:00','本周成果摘要':'成果','问题摘要':'问题','下周计划摘要':'计划','思考与复盘摘要':'复盘','成果分':100,'问题分':0,'计划分':0,'复盘分':0},{'姓名':'员工','结束日期':'2026-11-06','开始日期':'2026-11-02','提交时间':'2026-11-06 19:45:00','本周成果摘要':'成果','问题摘要':'问题','下周计划摘要':'计划','思考与复盘摘要':'复盘','成果分':100,'问题分':0,'计划分':0,'复盘分':0}]})});
 const reports=await performance.reports();assert.equal(reports[0].candidate,30);assert.equal(reports[0].onTime,true);assert.equal(reports[1].candidate,40);assert.equal(reports[1].late,true);
 assert((await service.logs()).length>=4);
 console.log('system settings tests passed: future-cycle policy, immutable versions, encrypted secret, no secret disclosure, runtime restore, audit trail');
}finally{await rm(dir,{recursive:true,force:true});}
