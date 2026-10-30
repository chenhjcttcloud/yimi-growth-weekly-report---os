import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import path from 'node:path';
import {createDirectorySync} from '../server/directory-sync.mjs';
import {createEmployeeLifecycle} from '../server/employee-lifecycle.mjs';

// Isolated fixtures only. Network requests from the server fail closed; every
// database, backup and log is retained, with no real Feishu message delivery.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/employee-departure-api-')),db=dir+'/test.sqlite',data=dir+'/data';await mkdir(data);
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
function run(statement,json=false){const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();}
const query=async statement=>run(statement,true),exec=async statement=>run(statement);
const month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
run(await readFile('db/schema.sql','utf8'));
const names={admin:'测试管理员',manager:'测试负责人',departed:'离职同事',live:'在职同事',rater:'待评同事',scored:'已评同事'};
for(const [id,name] of Object.entries(names))run(`INSERT INTO employees(user_id,name,department,manager_user_id,is_active) VALUES(${sql(id)},${sql(name)},'测试部门',${sql(id==='departed'||id==='live'?'manager':'')},1);`);
run(`INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('team','测试部门','manager',datetime('now'));
 INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) SELECT 'period-'||user_id,user_id,'2026-08-01','manager' FROM employees;
 INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES('cycle','本月评分','${month}-01','${month}-28','open',datetime('now'));
 INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id,status) VALUES
 ('departure-pending','cycle','离职同事','待评同事','departed','rater','active'),
 ('departure-saved','cycle','离职同事','已评同事','departed','scored','active'),
 ('live-pending','cycle','在职同事','待评同事','live','rater','active'),
 ('departed-rater','cycle','在职同事','离职同事','live','departed','active');
 INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('saved','departure-saved','cycle','离职同事','已评同事',83,'历史评价保留');
 INSERT INTO monthly_review_plans(month,employee_user_id,plan_json) VALUES('${month}','departed',${sql(JSON.stringify({kind:'manager',expectedIds:['manager'],employee:{userId:'departed',name:'离职同事'},frozenAt:'2026-10-01T00:00:00Z'}))});
 INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES('2026-08','departed','离职同事','quality','{"score":88}','{"note":"保留历史"}','系统','2026-09-01T00:00:00Z');`);
for(const name of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights'])await writeFile(data+'/'+name+'.json',JSON.stringify(name==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:name==='scoring360'?{cycles:[],assignments:[],responses:[],results:[]}:{}));
const guard=dir+'/network-guard.mjs';await writeFile(guard,`import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(dir+'/blocked-network.log')},'blocked\\n');throw Error('departure_fixture_network_forbidden');};`);
const secret='departure-fixture-secret',port=14900+Math.floor(Math.random()*200),base='http://127.0.0.1:'+port;
const cookie=id=>{const body=Buffer.from(JSON.stringify({user:{userId:id,name:names[id]},issuedAt:Date.now(),sessionId:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString()})).toString('base64url');return 'wos_session='+body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
const call=async(route,id,body)=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{cookie:cookie(id),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
let logs='',server;
try{
 server=spawn(process.execPath,['--import',guard,'server/index.mjs'],{env:{...process.env,AUTH_MODE:'feishu',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',LARK_REPORT_SYNC_STATUS_PATH:dir+'/sync-status.json',BACKUP_DIR:dir+'/backups',BOSS_VIEW_USER_IDS:'',BOSS_VIEW_NAMES:'',SCORING360_CONFIG_MANAGER_USER_IDS:'admin',SCORING360_CONFIG_MANAGER_NAMES:'',DEV_VIEW_SWITCH_ENABLED:'false',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:''},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let n=0;n<160;n++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready);
 assert((await call('/api/scoring360/my-tasks?cycleId=cycle','rater')).body.tasks.some(t=>t.id==='departure-pending'));
 const preserved={assignments:run('SELECT * FROM scoring360_assignments ORDER BY id;',true),responses:run('SELECT * FROM scoring360_responses ORDER BY id;',true),plans:run('SELECT * FROM monthly_review_plans ORDER BY month,employee_user_id;',true),history:run("SELECT * FROM performance_results WHERE month='2026-08';",true)};
 const visible=Object.entries(names).filter(([id])=>id!=='departed').map(([user_id,name])=>({user_id,name,department_ids:['0']}));
 const sync=createDirectorySync({query,exec,sql,lifecycle:createEmployeeLifecycle({query,exec,sql}),config:{feishuAppId:'fixture',feishuAppSecret:'fixture'},fetcher:async input=>{const url=new URL(input);let value;if(url.pathname.includes('tenant_access_token'))value={code:0,tenant_access_token:'fixture'};else if(url.pathname.endsWith('/scopes'))value={code:0,data:{department_ids:['0'],has_more:false}};else if(url.pathname.endsWith('/departments/0'))value={code:0,data:{department:{member_count:visible.length}}};else if(url.pathname.endsWith('/children'))value={code:0,data:{items:[],has_more:false}};else if(url.pathname.endsWith('/find_by_department'))value={code:0,data:{items:visible,has_more:false}};else if(url.pathname.endsWith('/users/departed'))value={code:0,data:{user:{user_id:'departed',status:{is_resigned:true}}}};else throw Error('Unexpected directory fixture request');return {ok:true,status:200,json:async()=>value};}});
 const result=await sync.run();assert.equal(result.confirmedInactiveCount,1);assert.equal(result.unverifiedMissingCount,0);
 assert.equal(run("SELECT is_active FROM employees WHERE user_id='departed';",true)[0].is_active,0);
 assert.equal((await call('/api/me','departed')).status,403,'existing signed session is immediately blocked');
 const tasks=(await call('/api/scoring360/my-tasks?cycleId=cycle','rater')).body.tasks;assert(!tasks.some(t=>t.id==='departure-pending'));assert(tasks.some(t=>t.id==='live-pending'));
 const saved=(await call('/api/scoring360/my-tasks?cycleId=cycle','scored')).body.tasks.find(t=>t.id==='departure-saved');assert(saved?.locked);assert.equal(saved.score,83);
 const rejected=await call('/api/scoring360/submit','rater',{cycleId:'cycle',scores:[{assignmentId:'departure-pending',score:90,comment:'旧页面不得继续评分'}]});assert.equal(rejected.body.saved,0);assert.equal(rejected.body.skipped[0].reason,'employee_inactive');
 assert.equal((await call('/api/scoring360/submit','departed',{cycleId:'cycle',scores:[{assignmentId:'departed-rater',score:90,comment:'停用评分人不能提交'}]})).status,403);
 const preview=(await call('/api/scoring360/reminders?cycleId=cycle','admin')).body;assert(!preview.pending.some(p=>p.evaluatorUserId==='departed'));assert(!preview.pending.some(p=>p.pendingNames?.includes('离职同事')));
 assert(!(await call('/api/weekly-reminders','admin')).body.recipients.some(p=>p.userId==='departed'));
 const manager=(await call('/api/manager-reviews?month='+month,'manager')).body;assert(!manager.tasks.some(t=>t.employeeUserId==='departed'));
 const managerSubmit=await call('/api/manager-reviews','manager',{month,employeeUserId:'departed',score:90,comment:'旧入口不得继续评分'});assert.equal(managerSubmit.status,409);assert.equal(managerSubmit.body.error,'employee_inactive');
 for(const [key,statement] of Object.entries({assignments:'SELECT * FROM scoring360_assignments ORDER BY id;',responses:'SELECT * FROM scoring360_responses ORDER BY id;',plans:'SELECT * FROM monthly_review_plans ORDER BY month,employee_user_id;',history:"SELECT * FROM performance_results WHERE month='2026-08';"}))assert.deepEqual(run(statement,true),preserved[key],key+' remain unchanged');
 assert.equal(run(`SELECT count(*) AS n FROM all_monthly_weighted_results WHERE employee_user_id='departed' AND month=${sql(month)};`,true)[0].n,0,'stopping does not shrink the denominator or publish a partial result');
 const accepted=await call('/api/scoring360/submit','rater',{cycleId:'cycle',scores:[{assignmentId:'live-pending',score:91,comment:'在职员工正常提交'}]});assert.equal(accepted.body.saved,1);assert.deepEqual(accepted.body.skipped,[]);
 assert.equal(run("SELECT score FROM scoring360_responses WHERE assignment_id='live-pending';",true)[0].score,91,'guard still accepts and accurately reports a normal active score');
 assert.equal(run('SELECT count(*) AS n FROM employees;',true)[0].n,6);
 for(const table of ['weekly_reminder_sends','monthly_score_reminder_deliveries','scoring360_reminder_sends'])assert.equal(run(`SELECT count(*) AS n FROM ${table};`,true)[0].n,0);
 assert.equal(await readFile(dir+'/blocked-network.log','utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;}),'');assert.equal(run('PRAGMA integrity_check;'),'ok');
 const output={ok:true,explicitDirectoryDeparture:true,existingSessionBlocked:true,pendingPeerAndManagerTasksStopped:true,savedPeerTaskReadOnly:true,staleSubmissionBlocked:true,reportAndScoringRemindersExcludeInactive:true,frozenDenominatorAndHistoryPreserved:true,employeesDeleted:0,realMessagesSent:0,artifacts:dir};await writeFile(dir+'/result.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));
}catch(error){console.error(logs);throw error;}finally{if(server?.exitCode===null){server.kill('SIGTERM');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));}await writeFile(dir+'/server.log',logs);console.log('Artifacts retained:',dir);}
