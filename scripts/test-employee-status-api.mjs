import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import path from 'node:path';
import {createEmployeeLifecycle,employedOn} from '../server/employee-lifecycle.mjs';
import {createDirectorySync} from '../server/directory-sync.mjs';
import {createSsoRoster} from '../server/sso-roster.mjs';

// Every database, projection and log remains in this isolated retained folder.
// Feishu authentication is exercised with fixture-signed sessions; no external
// services or real credentials are used, and server-side fetch is blocked.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/employee-status-')),db=dir+'/test.sqlite',data=dir+'/data';
await mkdir(data);
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{
 const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stderr);
 return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();
};
const query=async statement=>run(statement,true),exec=async statement=>run(statement);
const periods=id=>run(`SELECT * FROM employee_employment_periods WHERE employee_user_id=${sql(id)} ORDER BY start_date,id;`,true);
const active=id=>run(`SELECT is_active FROM employees WHERE user_id=${sql(id)};`,true)[0]?.is_active;
run(await readFile('db/schema.sql','utf8'));
run(`INSERT INTO employees(user_id,name,department,is_active) VALUES
 ('fixture-admin','测试管理员','管理部',1),('fixture-boss','测试老板','管理部',1),
 ('fixture-staff','普通同事','研发部',1),('fixture-stopped','待恢复同事','研发部',0),
 ('fixture-concurrent','并发恢复同事','研发部',0),('fixture-unit','区间测试同事','研发部',0),
 ('fixture-rollback','回滚测试同事','研发部',0),('atomic-fail','API回滚测试同事','研发部',0);
 INSERT INTO employee_employment_periods(id,employee_user_id,start_date,end_date,source) VALUES
 ('stopped-history','fixture-stopped','2026-09-01','2026-09-30','manager'),
 ('concurrent-history','fixture-concurrent','2026-09-01','2026-09-30','manager'),
 ('unit-history','fixture-unit','2026-09-01','2026-09-30','feishu'),
 ('rollback-history','fixture-rollback','2026-09-01','2026-09-30','manager'),
 ('atomic-history','atomic-fail','2026-09-01','2026-09-30','manager');
 INSERT INTO scoring360_cycles(id,label,start_date,end_date,status) VALUES
 ('history-cycle','历史评分','2026-09-01','2026-09-30','closed'),
 ('pending-cycle','未完成评分','2026-10-01','2026-10-31','open');
 INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id,status) VALUES
 ('historical-assignment','history-cycle','待恢复同事','普通同事','fixture-stopped','fixture-staff','inactive'),
 ('inactive-assignment','pending-cycle','待恢复同事','普通同事','fixture-stopped','fixture-staff','inactive'),
 ('pending-assignment','pending-cycle','普通同事','待恢复同事','fixture-staff','fixture-stopped','active');
 INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment)
 VALUES('historical-response','historical-assignment','history-cycle','待恢复同事','普通同事',88,'历史评价保持原样');
 INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at)
 VALUES('2026-09','fixture-stopped','待恢复同事','quality','{"score":91}','{"note":"历史结果"}','历史系统','2026-10-01T01:00:00Z');`);

const actor={userId:'fixture-admin',name:'测试管理员'};
let clock=new Date('2026-11-02T02:00:00Z');
const lifecycle=createEmployeeLifecycle({query,exec,sql,now:()=>clock});
const unitHistory=periods('fixture-unit');
await lifecycle.setStatus('fixture-unit',true,actor);
assert.equal(active('fixture-unit'),1);
let unitPeriods=periods('fixture-unit');
assert.deepEqual(unitPeriods.filter(period=>period.id==='unit-history'),unitHistory,'restoration does not reopen or edit the old closed period');
assert.equal(unitPeriods.filter(period=>!period.end_date).length,1);
assert.equal(unitPeriods.find(period=>!period.end_date).start_date,'2026-11-02');
assert.equal(unitPeriods.find(period=>!period.end_date).source,'manager_restore');
assert.equal(employedOn(unitPeriods,'2026-10-16'),false,'the suspended interval does not become an expected report period');
assert.equal(employedOn(unitPeriods,'2026-11-02'),true);
await lifecycle.profile('fixture-unit',Date.parse('2026-09-01T00:00:00+08:00')/1000);
assert.deepEqual(periods('fixture-unit'),unitPeriods,'later SSO hire dates do not overwrite the restored period');
await lifecycle.setStatus('fixture-unit',true,actor);
assert.deepEqual(periods('fixture-unit'),unitPeriods,'repeated restore creates no duplicate interval');
clock=new Date('2026-11-03T02:00:00Z');await lifecycle.setStatus('fixture-unit',false,actor);
const closedUnitPeriods=periods('fixture-unit');
clock=new Date('2026-11-10T02:00:00Z');await lifecycle.setStatus('fixture-unit',true,actor);
unitPeriods=periods('fixture-unit');
assert.deepEqual(unitPeriods.filter(period=>period.end_date),closedUnitPeriods,'a second restore preserves all prior periods');
assert.equal(employedOn(unitPeriods,'2026-11-06'),false);
assert.equal(employedOn(unitPeriods,'2026-11-10'),true);

// An injected audit-write failure proves the whole transition rolls back.
run(`CREATE TRIGGER fixture_status_audit_failure BEFORE INSERT ON system_operation_logs
 WHEN json_extract(NEW.details_json,'$.userId') IN('fixture-rollback','atomic-fail')
 BEGIN SELECT RAISE(ABORT,'fixture_status_audit_failure'); END;`);
const rollbackHistory=periods('fixture-rollback');
await assert.rejects(lifecycle.setStatus('fixture-rollback',true,actor),/fixture_status_audit_failure/);
assert.equal(active('fixture-rollback'),0);assert.deepEqual(periods('fixture-rollback'),rollbackHistory);

for(const name of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights'])
 await writeFile(data+'/'+name+'.json',JSON.stringify(name==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:name==='scoring360'?{cycles:[],assignments:[],responses:[],results:[]}:{}));
const guard=dir+'/network-guard.mjs';
await writeFile(guard,`import {appendFileSync} from 'node:fs';\nglobalThis.fetch=async()=>{appendFileSync(${JSON.stringify(dir+'/blocked-outbound.log')},'blocked\\n');throw Error('external_network_forbidden_in_employee_status_fixture');};\n`);
const secret='isolated-employee-status-secret',port=14600+Math.floor(Math.random()*300),base='http://127.0.0.1:'+port;
const names={'fixture-admin':'测试管理员','fixture-boss':'测试老板','fixture-staff':'普通同事','fixture-stopped':'待恢复同事'};
const cookie=id=>{const body=Buffer.from(JSON.stringify({user:{userId:id,name:names[id]||id},issuedAt:Date.now(),sessionId:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString()})).toString('base64url');return 'wos_session='+body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
let logs='',server;
const env={...process.env,AUTH_MODE:'feishu',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',LARK_REPORT_SYNC_STATUS_PATH:dir+'/sync-status.json',BACKUP_DIR:dir+'/backups',BOSS_VIEW_USER_IDS:'fixture-boss',BOSS_VIEW_NAMES:'',SCORING360_CONFIG_MANAGER_USER_IDS:'fixture-admin',SCORING360_CONFIG_MANAGER_NAMES:'',DEV_VIEW_SWITCH_ENABLED:'false',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',FEISHU_EVENT_VERIFICATION_TOKEN:'',FEISHU_EVENT_ENCRYPT_KEY:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:''};
async function request(route,id,body,extraHeaders={}){
 const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(id?{cookie:cookie(id)}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...extraHeaders},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
const change=(id,body,headers)=>request('/api/employees/manage/status',id,body,headers);
try{
 server=spawn(process.execPath,['--import',guard,'server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',text=>logs+=text);server.stderr.on('data',text=>logs+=text);
 let ready=false;for(let attempt=0;attempt<150;attempt++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'isolated server becomes healthy');
 const originalHistory=periods('fixture-stopped');
 const historicalResults=run('SELECT * FROM performance_results ORDER BY month,employee_user_id,kind;',true),historicalResponses=run('SELECT * FROM scoring360_responses ORDER BY id;',true);
 assert.equal((await change(null,{userId:'fixture-stopped',active:true})).status,401);
 assert.equal((await change('fixture-staff',{userId:'fixture-stopped',active:true})).status,403);
 assert.equal((await request('/api/me','fixture-stopped')).status,403,'inactive sessions cannot enter the system');
 for(const value of [undefined,null,'true','false',0,1,{},[]]){
  const result=await change('fixture-admin',{userId:'fixture-stopped',...(value===undefined?{}:{active:value})});
  assert.equal(result.status,400,JSON.stringify(result));assert.equal(result.body.error,'invalid_employee_status');
 }
 assert.equal(active('fixture-stopped'),0,'invalid requests never activate an account');
 assert.equal((await change('fixture-admin',{userId:'unknown-fixture',active:true})).status,404);
 assert.equal((await change('fixture-admin',{userId:'fixture-stopped',active:true},{origin:'https://untrusted.example'})).status,403);
 const atomicHistory=periods('atomic-fail');
 assert.equal((await change('fixture-admin',{userId:'atomic-fail',active:true})).status,500,'an injected audit failure is reported as failed');
 assert.equal(active('atomic-fail'),0,'the API executor rolls back the flag after an audit failure');
 assert.deepEqual(periods('atomic-fail'),atomicHistory,'the API executor also rolls back the new open interval');
 const beforeWeekly=await request('/api/weekly-reminders','fixture-admin');assert.equal(beforeWeekly.status,200);assert(!beforeWeekly.body.recipients.some(person=>person.userId==='fixture-stopped'));
 const restored=await change('fixture-admin',{userId:'fixture-stopped',active:true});
 assert.equal(restored.status,200,JSON.stringify(restored));assert.equal(restored.body.active,true);
 assert.equal(active('fixture-stopped'),1);assert.equal((await request('/api/me','fixture-stopped')).status,200);
 const restoredPeriods=periods('fixture-stopped');
 assert.deepEqual(restoredPeriods.filter(period=>period.id==='stopped-history'),originalHistory);
 assert.equal(restoredPeriods.filter(period=>!period.end_date).length,1);
 assert.equal(restoredPeriods.find(period=>!period.end_date).source,'manager_restore');
 assert.equal(restoredPeriods.find(period=>!period.end_date).start_date,new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}));
 assert.equal(run("SELECT status FROM scoring360_assignments WHERE id='inactive-assignment';",true)[0].status,'inactive','restoring an account does not revive old canceled assignments');
 assert((await request('/api/weekly-reminders','fixture-admin')).body.recipients.some(person=>person.userId==='fixture-stopped'),'restored active user is eligible for future report reminders');
 assert.equal((await change('fixture-boss',{userId:'fixture-stopped',active:true})).status,200,'boss can restore using the same authorized endpoint');
 assert.deepEqual(periods('fixture-stopped'),restoredPeriods,'repeated API restore keeps intervals unchanged');
 const parallel=await Promise.all(Array.from({length:6},()=>change('fixture-admin',{userId:'fixture-concurrent',active:true})));
 assert(parallel.every(result=>result.status===200),JSON.stringify(parallel));
 assert.equal(periods('fixture-concurrent').filter(period=>!period.end_date).length,1,'parallel restores create one open interval');
 const stoppedAgain=await change('fixture-admin',{userId:'fixture-stopped',active:false});assert.equal(stoppedAgain.status,200,JSON.stringify(stoppedAgain));
 assert.equal(active('fixture-stopped'),0);assert.equal((await request('/api/me','fixture-stopped')).status,403);
 assert.equal(run("SELECT status FROM scoring360_assignments WHERE id='pending-assignment';",true)[0].status,'inactive','stopping also disables unfinished unlocked scoring relationships');
 assert(!((await request('/api/weekly-reminders','fixture-admin')).body.recipients.some(person=>person.userId==='fixture-stopped')));
 const stoppedPeriods=periods('fixture-stopped');
 assert.deepEqual(stoppedPeriods.filter(period=>period.id==='stopped-history'),originalHistory);
 assert.equal((await change('fixture-admin',{userId:'fixture-stopped',active:false})).status,200);
 assert.deepEqual(periods('fixture-stopped'),stoppedPeriods,'repeating stop preserves the previous date');

 // Feishu sync can refresh profile details, but only a management action may
 // restore the account. All responses here are fixed in-memory fixtures.
 let providerCalls=0;
 const directory=createDirectorySync({query,exec,sql,config:{feishuAppId:'cli_fixture',feishuAppSecret:'fixture-secret'},lifecycle:createEmployeeLifecycle({query,exec,sql}),fetcher:async input=>{
  providerCalls++;const url=new URL(input);let value;
  if(url.pathname.includes('tenant_access_token'))value={code:0,tenant_access_token:'fixture-token'};
  else if(url.pathname.endsWith('/scopes'))value={code:0,data:{department_ids:['0'],user_ids:[],has_more:false}};
  else if(url.pathname.endsWith('/departments/0'))value={code:0,data:{department:{member_count:1}}};
  else if(url.pathname.endsWith('/children'))value={code:0,data:{items:[],has_more:false}};
  else if(url.pathname.endsWith('/find_by_department'))value={code:0,data:{items:[{user_id:'fixture-stopped',name:'待恢复同事',status:{is_resigned:false},department_ids:['0']}],has_more:false}};
  else throw Error('Unexpected fixture directory request');
  return {ok:true,status:200,json:async()=>value};
 }});
 await directory.run();assert(providerCalls>0);assert.equal(active('fixture-stopped'),0);assert.deepEqual(periods('fixture-stopped'),stoppedPeriods);
 const sso=createSsoRoster({query,exec,sql,lifecycle:createEmployeeLifecycle({query,exec,sql}),getJson:async()=>({data:{user:{user_id:'fixture-stopped',name:'待恢复同事'}}})});
 assert.equal((await sso({userId:'fixture-stopped',name:'待恢复同事'},'fixture-user-token')).active,false);
 assert.equal(active('fixture-stopped'),0);assert.deepEqual(periods('fixture-stopped'),stoppedPeriods);
 assert.deepEqual(run('SELECT * FROM performance_results ORDER BY month,employee_user_id,kind;',true),historicalResults);
 assert.deepEqual(run('SELECT * FROM scoring360_responses ORDER BY id;',true),historicalResponses);
 assert.equal(run('SELECT count(*) AS n FROM employees;',true)[0].n,8,'no duplicate or deleted employee records');
 for(const table of ['weekly_reminder_sends','monthly_score_reminder_deliveries','scoring360_reminder_sends'])assert.equal(run(`SELECT count(*) AS n FROM ${table};`,true)[0].n,0);
 assert.equal(run('PRAGMA integrity_check;'),'ok');
 const blocked=await readFile(dir+'/blocked-outbound.log','utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});assert.equal(blocked,'','no real outbound fetches were attempted');
 const result={ok:true,feishuModeManagementRestore:true,permissionChecks:true,strictBooleanValidation:true,historyPreserved:true,suspensionGapExcluded:true,transactionRollback:true,apiTransactionRollback:true,parallelRestoreOneOpenPeriod:true,oldAssignmentsRemainInactive:true,restoredLoginAndReminderEligibility:true,syncDoesNotRestore:true,realUpstreamRequests:0,messagesSent:0,artifacts:dir};
 await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(logs);throw error;}
finally{if(server?.exitCode===null){server.kill('SIGTERM');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));}await writeFile(dir+'/server.log',logs);console.log('Artifacts retained:',dir);}
