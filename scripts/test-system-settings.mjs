import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPerformance} from '../server/performance.mjs';
import {createSystemSettings} from '../server/system-settings.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'system-settings-')),db=path.join(dir,'db.sqlite');
function run(s,json=false){const r=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:s+'\n',encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout;}
const sql=v=>"'"+String(v).replaceAll("'","''")+"'";
const environmentKey='fixture-environment-key',replacementKey='fixture-replacement-key';
const config={sessionSecret:'test-session-secret',moonshotBaseUrl:'https://api.moonshot.cn/v1',kimiFollowupModel:'model',moonshotApiKey:environmentKey,authMode:'mock'};
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
 const connection={baseUrl:'https://api.moonshot.cn/v2',model:'test-model'};
 const otherConnection={baseUrl:'https://api.example.com/v1',model:'other-model'};
 const readAiRow=()=>run("SELECT value_json FROM app_settings WHERE key='ai_runtime'").trim();
 const auditCount=(await service.logs()).length;
 await assert.rejects(service.saveAI({...connection,apiKey:replacementKey},user),/ai_key_action_required/);
 await assert.rejects(service.saveAI({...connection,clearKey:true},user),/ai_key_action_required/);
 await assert.rejects(service.saveAI(otherConnection,user),/ai_key_host_change_requires_clear/);
 await assert.rejects(service.saveAIKey({action:'replace',apiKey:replacementKey,expectedBaseUrl:otherConnection.baseUrl},user),/ai_key_service_address_changed/);
 assert.equal(readAiRow(),'','rejected saves leave environment credentials and settings alone');
 assert.equal(config.moonshotApiKey,environmentKey);
 assert.equal((await service.logs()).length,auditCount,'rejected saves are never audited as successful changes');

 await service.saveAI({...connection,apiKey:' ',clearKey:false},user);
 const initialCiphertext=JSON.parse(readAiRow()).encryptedKey;
 assert(initialCiphertext);
 const nextConfig={sessionSecret:config.sessionSecret,moonshotApiKey:'different-environment-key'};
 const nextService=createSystemSettings({...dependencies,config:nextConfig});
 await nextService.initialize();
 assert.equal(nextConfig.moonshotApiKey,environmentKey,'first connection save preserves the active key across restarts');
 await service.saveAI({...connection,model:'next'},user);
 assert.equal(JSON.parse(readAiRow()).encryptedKey,initialCiphertext,'model changes preserve the original ciphertext');
 await assert.rejects(service.saveAI({...connection,apiKey:replacementKey},user),/ai_key_action_required/);
 await assert.rejects(service.saveAI({...connection,clearKey:true},user),/ai_key_action_required/);
 await assert.rejects(service.saveAI(otherConnection,user),/ai_key_host_change_requires_clear/);
 assert.equal(JSON.parse(readAiRow()).encryptedKey,initialCiphertext);
 assert.equal(config.moonshotBaseUrl,connection.baseUrl);

 await assert.rejects(service.saveAIKey({action:'set',apiKey:replacementKey},user),/invalid_ai_key_action/);
 await assert.rejects(service.saveAIKey({action:'replace',apiKey:'  '},user),/invalid_ai_key/);
 await assert.rejects(service.saveAIKey({action:'replace',apiKey:'x'.repeat(4001)},user),/invalid_ai_key/);
 for(const apiKey of ['fixture key','fixture\nkey','fixture\u0000key']){
  await assert.rejects(service.saveAIKey({action:'replace',apiKey},user),/invalid_ai_key/);
 }
 await assert.rejects(service.saveAIKey({action:'clear',apiKey:replacementKey},user),/invalid_ai_key/);
 const concurrentConnection={baseUrl:'https://api.moonshot.cn:443/v3',model:'concurrent-model'};
 const [replaced]=await Promise.all([
  service.saveAIKey({action:'replace',apiKey:` ${replacementKey} `},user),
  nextService.saveAI(concurrentConnection,user),
 ]);
 assert.deepEqual(replaced,{keyConfigured:true});
 await nextService.initialize();
 assert.equal(nextConfig.moonshotApiKey,replacementKey);
 assert.equal(nextConfig.kimiFollowupModel,concurrentConnection.model);
 assert.equal(nextConfig.moonshotBaseUrl,concurrentConnection.baseUrl);
 const replacedRow=readAiRow();
 const replacementCiphertext=JSON.parse(replacedRow).encryptedKey;
 assert.notEqual(replacementCiphertext,initialCiphertext);
 assert(!replacedRow.includes(replacementKey),'replacement key is stored encrypted');

 const auditDenied={userId:'audit-denied',name:'测试审计失败'};
 run(`CREATE TRIGGER fail_fixture_ai_audit BEFORE INSERT ON system_operation_logs
  WHEN NEW.actor_user_id=${sql(auditDenied.userId)} BEGIN SELECT RAISE(ABORT,'fixture_audit_write_failed'); END;`);
 const beforeAuditFailure={...config};
 await assert.rejects(service.saveAI({...connection,model:'rolled-back'},auditDenied),/fixture_audit_write_failed/);
 await assert.rejects(service.saveAIKey({action:'replace',apiKey:'rolled-back-key'},auditDenied),/fixture_audit_write_failed/);
 await assert.rejects(service.saveAIKey({action:'clear'},auditDenied),/fixture_audit_write_failed/);
 assert.equal(readAiRow(),replacedRow,'audit failure rolls back the settings write');
 assert.deepEqual(config,beforeAuditFailure,'the process retains its previous configuration when the transaction fails');
 assert(!(await service.logs()).some(log=>log.actor_name===auditDenied.name));

 assert.deepEqual(await service.saveAIKey({action:'clear'},user),{keyConfigured:false});
 assert.equal(config.moonshotApiKey,'');
 assert.equal(config.kimiFollowupModel,concurrentConnection.model,'clearing credentials retains connection settings');
 await service.saveAI(otherConnection,user);
 assert.equal(config.moonshotBaseUrl,otherConnection.baseUrl,'the service origin can change after explicit clear');
 const restoredClear={sessionSecret:config.sessionSecret,moonshotApiKey:environmentKey};
 await createSystemSettings({...dependencies,config:restoredClear}).initialize();
 assert.equal(restoredClear.moonshotApiKey,'','an explicit clear persists across a restart with an environment key');
 const keyAudits=(await service.logs()).filter(log=>log.action.startsWith('AI 服务密钥'));
 assert.deepEqual(keyAudits.map(log=>log.details),[{action:'clear',keyConfigured:false},{action:'replace',keyConfigured:true}]);
 const exposed=JSON.stringify(await service.overview())+JSON.stringify(await service.logs())+readAiRow();
 for(const secret of [environmentKey,replacementKey,initialCiphertext,replacementCiphertext])assert(!exposed.includes(secret));

 const staleConfig={...config};
 const staleKeyService=createSystemSettings({...dependencies,config:staleConfig,query:async statement=>{
  if(statement.includes('RETURNING'))await service.saveAI(connection,user);
  return run(statement,true);
 }});
 const beforeKeyRace=(await service.logs()).length;
 await assert.rejects(staleKeyService.saveAIKey({action:'replace',apiKey:replacementKey,expectedBaseUrl:otherConnection.baseUrl},user),/ai_key_service_address_changed/);
 assert.equal(JSON.parse(readAiRow()).baseUrl,connection.baseUrl,'another session changed the address before the key write acquired its lock');
 assert.equal(JSON.parse(readAiRow()).encryptedKey,'','a stale form cannot add a credential to the new provider');
 assert.equal(staleConfig.moonshotApiKey,'','a rejected key never reaches the running configuration');
 assert.equal((await service.logs()).length,beforeKeyRace+1,'only the address change is audited');
 assert.deepEqual(await service.saveAIKey({action:'replace',apiKey:replacementKey,expectedBaseUrl:connection.baseUrl},user),{keyConfigured:true});
 await assert.rejects(service.saveAIKey({action:'clear',expectedBaseUrl:otherConnection.baseUrl},user),/ai_key_service_address_changed/);
 assert.equal(config.moonshotApiKey,replacementKey,'a stale form cannot clear a credential for the new provider');
 await service.saveAIKey({action:'clear',expectedBaseUrl:connection.baseUrl},user);
 await service.saveAI(otherConnection,user);

 const beforeGuardRace=(await service.logs()).length;
 const guardedService=createSystemSettings({...dependencies,config:{...restoredClear},query:async statement=>{
  if(statement.includes('RETURNING')&&statement.includes("'$.baseUrl'")){
   await service.saveAIKey({action:'replace',apiKey:replacementKey},user);
  }
  return run(statement,true);
 }});
 await guardedService.initialize();
 await assert.rejects(guardedService.saveAI(connection,user),/ai_key_host_change_requires_clear/);
 assert.equal(JSON.parse(readAiRow()).baseUrl,otherConnection.baseUrl,'a concurrently added key blocks the pending provider switch');
 assert.equal((await service.logs()).length,beforeGuardRace+1,'only the concurrent key replacement is audited');

 const performance=createPerformance({query:async q=>run(q,true).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v===null?'':v]))),exec:async q=>run(q),sql,policyFor:service.policyFor,readData:()=>({weekly_scores:[{'姓名':'员工','结束日期':'2026-10-30','开始日期':'2026-10-26','提交时间':'2026-10-30 19:45:00','本周成果摘要':'成果','问题摘要':'问题','下周计划摘要':'计划','思考与复盘摘要':'复盘','成果分':100,'问题分':0,'计划分':0,'复盘分':0},{'姓名':'员工','结束日期':'2026-11-06','开始日期':'2026-11-02','提交时间':'2026-11-06 19:45:00','本周成果摘要':'成果','问题摘要':'问题','下周计划摘要':'计划','思考与复盘摘要':'复盘','成果分':100,'问题分':0,'计划分':0,'复盘分':0}]})});
 const reports=await performance.reports();assert.equal(reports[0].candidate,30);assert.equal(reports[0].onTime,true);assert.equal(reports[1].candidate,40);assert.equal(reports[1].late,true);
 assert((await service.logs()).length>=4);
 console.log('system settings tests passed: future-cycle policy, immutable versions, explicit AI key management, concurrent settings, provider origin guard, runtime restore and audit trail');
}finally{console.log('Test artifacts retained:',dir);}
