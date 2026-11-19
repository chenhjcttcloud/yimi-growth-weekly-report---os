import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import path from 'node:path';

// Fictional identities, isolated files and a controllable clock. Retain every artifact.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/monthly-scoring-window-api-'));
const db=dir+'/test.sqlite',data=dir+'/data',clockFile=dir+'/clock.txt';await mkdir(data);
const run=(statement,json=false)=>{
 const result=spawnSync('sqlite3',['-bail','-cmd','.timeout 10000',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();
};
run(await readFile('db/schema.sql','utf8'));
run(`INSERT INTO employees(user_id,name,department,manager_user_id) VALUES
 ('boss','测试老板','管理',''),('admin','测试管理员','管理','boss'),
 ('head','测试负责人','团队',''),('staff','测试员工','团队','head'),
 ('saved','已有评分员工','团队','head'),('peer','测试同事','团队','head');
 INSERT INTO organization_departments VALUES('team','团队','head',datetime('now')),('management','管理','boss',datetime('now'));
 INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) SELECT 'employment-'||user_id,user_id,'2026-08-01','fixture' FROM employees;`);
for(const month of ['2026-10','2026-11']){
 run(`INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES('${month}-360','${month}测试评分','${month}-01','${month}-28','open','${month}-01T00:00:00+08:00');
 INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES
 ('${month}-staff','${month}-360','测试员工','测试同事','staff','peer'),
 ('${month}-saved','${month}-360','已有评分员工','测试同事','saved','peer'),
 ('${month}-head','${month}-360','测试负责人','测试同事','head','peer'),
 ('${month}-peer','${month}-360','测试同事','测试员工','peer','staff'),
 ('${month}-admin','${month}-360','测试管理员','测试同事','admin','peer');`);
}
run(`INSERT INTO monthly_manager_scores(month,employee_user_id,evaluator_user_id,score,comment,snapshot_json,created_at)
 VALUES('2026-11','saved','head',78,'原有提前提交的真实历史必须保留','{"employee":{"userId":"saved","name":"已有评分员工","department":"团队"},"expectedIds":["head"]}','2026-11-19 03:14:32');`);
for(const name of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights']){
 const value=name==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:name==='scoring360'?{cycles:[],assignments:[],responses:[]}:{};
 await writeFile(data+'/'+name+'.json',JSON.stringify(value));
}
let at=Date.parse('2026-11-29T23:59:59+08:00');await writeFile(clockFile,String(at));
await writeFile(dir+'/guard.mjs',`import {readFileSync,appendFileSync} from 'node:fs';const RealDate=Date;const clock=()=>Number(readFileSync(${JSON.stringify(clockFile)},'utf8'));globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock()]));}static now(){return clock();}};globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(dir+'/network.log')},'unexpected external request\\n');throw Error('monthly_scoring_fixture_network_forbidden');};`);
const names={boss:'测试老板',admin:'测试管理员',head:'测试负责人',staff:'测试员工',saved:'已有评分员工',peer:'测试同事'};
const port=20600+Math.floor(Math.random()*400),base='http://127.0.0.1:'+port,secret='monthly-window-api-isolated-secret';
let server,logs='';const checks=[];
const cookie=id=>{
 const body=Buffer.from(JSON.stringify({user:{userId:id,name:names[id]},sessionId:randomUUID(),issuedAt:at,expiresAt:new Date(at+3600000).toISOString()})).toString('base64url');
 return 'wos_session='+body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
};
async function call(route,id,body){
 const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{cookie:cookie(id),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:response.status,body:await response.json()};
}
const humanState=()=>JSON.stringify(['monthly_review_plans','monthly_manager_scores','department_person_scores','scoring360_responses'].map(table=>run('SELECT * FROM '+table+' ORDER BY rowid;',true)));
const originalScore=()=>run("SELECT * FROM monthly_manager_scores WHERE month='2026-11' AND employee_user_id='saved';",true);
const ratingRequests=month=>[
 ['/api/manager-reviews','head',{month,employeeUserId:'staff',score:81,comment:'核对本月交付'}],
 ['/api/departments/score','boss',{month,leaderUserId:'head',score:83,comment:'核对负责人本月表现'}],
 ['/api/scoring360/submit','peer',{cycleId:month+'-360',scores:[{assignmentId:month+'-staff',score:88,comment:''}]}],
];
async function rejectAll(label){
 const before=humanState();
 for(const request of ratingRequests('2026-11')){
  const result=await call(...request);assert.equal(result.status,409,label+': '+JSON.stringify(result));assert.equal(result.body.error,'scoring_cycle_not_open');
 }
 assert.equal(humanState(),before,label+' must not freeze plans, save human scores or peer responses');checks.push(label);
}
try{
 server=spawn(process.execPath,['--import',dir+'/guard.mjs','server/index.mjs'],{env:{...process.env,AUTH_MODE:'feishu',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',BACKUP_DIR:dir+'/backups',LARK_REPORT_SYNC_STATUS_PATH:dir+'/sync.json',SCORING360_CONFIG_MANAGER_USER_IDS:'admin',SCORING360_CONFIG_MANAGER_NAMES:'',BOSS_VIEW_USER_IDS:'boss',BOSS_VIEW_NAMES:'',DEV_VIEW_SWITCH_ENABLED:'false',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:''},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',value=>logs+=value);server.stderr.on('data',value=>logs+=value);
 let ready=false;for(let attempt=0;attempt<140;attempt++){
  if(server.exitCode!==null)throw Error(logs);
  try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }assert(ready,'isolated server failed to start');
 const preserved=originalScore();
 await rejectAll('last_week_boundary_minus_one_second_denies_all_three');
 const manager=(await call('/api/manager-reviews?month=2026-11','head')).body;
 const boss=(await call('/api/departments?month=2026-11','boss')).body;
 const peer=(await call('/api/scoring360/my-tasks?month=2026-11','peer')).body;
 const preview=(await call('/api/admin/employee-preview/scoring-tasks?employeeId=peer&month=2026-11','admin')).body;
 for(const view of [manager,boss,peer,preview]){
  assert.equal(view.reviewWindow?.month,'2026-11');assert.equal(view.reviewWindow.isOpen,false);assert.equal(Date.parse(view.reviewWindow.opensAt),Date.parse('2026-11-30T00:00:00+08:00'));
 }
 assert.equal(peer.reviewWindow.reason,preview.reviewWindow.reason);
 const saved=manager.tasks.find(task=>task.employeeUserId==='saved');assert(saved?.submitted);assert.equal(Number(saved.score),78);assert.deepEqual(originalScore(),preserved);
 checks.push('all_task_views_share_window_and_existing_score_stays_visible');
 at=Date.parse('2026-11-30T00:00:00+08:00');await writeFile(clockFile,String(at));
 for(const status of ['draft','closed']){
  run(`UPDATE scoring360_cycles SET status='${status}' WHERE id='2026-11-360';`);
  await rejectAll(status+'_cycle_denies_all_three');
 }
 run("UPDATE scoring360_cycles SET status='open',launch_at='2026-11-30T00:00:01+08:00' WHERE id='2026-11-360';");
 await rejectAll('future_launch_timestamp_denies_all_three');
 run("UPDATE scoring360_cycles SET status='open',launch_at='2026-11-30T00:00:00+08:00' WHERE id='2026-11-360';");
 const openView=(await call('/api/manager-reviews?month=2026-11','head')).body;assert.equal(openView.reviewWindow.isOpen,true);
 for(const request of ratingRequests('2026-11')){const result=await call(...request);assert.equal(result.status,200,JSON.stringify(result));}
 assert.equal(run("SELECT count(*) AS n FROM monthly_manager_scores WHERE month='2026-11' AND employee_user_id='staff';",true)[0].n,1);
 assert.equal(run("SELECT count(*) AS n FROM all_department_leader_scores WHERE month='2026-11' AND leader_user_id='head';",true)[0].n,1);
 assert.equal(run("SELECT count(*) AS n FROM scoring360_responses WHERE cycle_id='2026-11-360';",true)[0].n,1);checks.push('exact_shanghai_open_boundary_allows_all_three');
 for(const request of ratingRequests('2026-10')){const result=await call(...request);assert.equal(result.status,200,JSON.stringify(result));}
 checks.push('already_open_historical_month_still_accepts_supplement');
 assert.deepEqual(originalScore(),preserved,'new policy must retain the exact preexisting human score');
 assert.equal(run('PRAGMA integrity_check;'),'ok');
 assert.equal(await readFile(dir+'/network.log','utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;}),'');
 for(const table of ['scoring360_reminder_sends','monthly_score_reminder_deliveries'])assert.equal(run(`SELECT count(*) AS n FROM ${table} WHERE status IN('sent','pending','uncertain');`,true)[0].n,0);
 const result={ok:true,checks,externalRequests:0,realMessagesSent:0,artifacts:dir};await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
 await writeFile(dir+'/failure.json',JSON.stringify({error:error.stack},null,2));console.error(logs);throw error;
}finally{
 if(server?.exitCode===null){server.kill('SIGTERM');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));}
 await writeFile(dir+'/server.log',logs);console.log('Artifacts retained:',dir);
}
