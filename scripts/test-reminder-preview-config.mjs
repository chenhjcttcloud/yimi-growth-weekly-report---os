import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import path from 'node:path';

await mkdir('outputs/tests',{recursive:true});const dir=await mkdtemp(path.resolve('outputs/tests/reminder-preview-config-')),db=dir+'/test.sqlite',data=dir+'/data';await mkdir(data);
const run=(statement,json=false)=>{const r=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout.trim();};
run(await readFile('db/schema.sql','utf8'));
run("INSERT INTO employees(user_id,name,department) VALUES('admin','管理员','团队'),('staff','员工','团队'),('peer','同事','团队'); INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES('oct','十月','2026-10-01','2026-10-31','open','2026-10-01T00:00:00Z'); INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES('old-a','oct','员工','同事','staff','peer');");
for(const name of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights'])await writeFile(data+'/'+name+'.json',JSON.stringify(name==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:name==='scoring360'?{cycles:[],assignments:[],responses:[]}:{}));
await writeFile(dir+'/guard.mjs',`import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(dir+'/network.log')},'unexpected');throw Error('fixture_external_network_forbidden');};`);
const port=17000+Math.floor(Math.random()*350),base='http://127.0.0.1:'+port,secret='isolated-reminder-config-secret';
const cookie=id=>{const b=Buffer.from(JSON.stringify({user:{userId:id,name:id==='admin'?'管理员':'员工'},sessionId:randomUUID(),issuedAt:Date.now(),expiresAt:new Date(Date.now()+3600000).toISOString()})).toString('base64url');return 'wos_session='+b+'.'+createHmac('sha256',secret).update(b).digest('base64url');};
const snapshot=()=>JSON.stringify(['scoring360_cycles','scoring360_assignments','scoring360_responses','monthly_review_plans'].map(t=>run('SELECT * FROM '+t+' ORDER BY rowid;',true)));
let server,logs='';const send=async(route,body,id='admin')=>{const r=await fetch(base+route,{method:'POST',headers:{cookie:cookie(id),'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
try{
 server=spawn(process.execPath,['--import',dir+'/guard.mjs','server/index.mjs'],{env:{...process.env,AUTH_MODE:'feishu',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',BACKUP_DIR:dir+'/backups',SCORING360_ACTIVE_DATE:'2026-11-01T10:00:00+08:00',SCORING360_CONFIG_MANAGER_USER_IDS:'admin',SCORING360_CONFIG_MANAGER_NAMES:'',BOSS_VIEW_USER_IDS:'',BOSS_VIEW_NAMES:'',DEV_VIEW_SWITCH_ENABLED:'false',LARK_REPORT_SYNC_STATUS_PATH:dir+'/sync.json',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:''},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let n=0;n<140;n++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);
 const endpoint='/api/scoring360/reminders/send',before=snapshot();
 assert.equal((await send(endpoint,{kind:'launch',dryRun:true},'staff')).status,403);
 for(const body of [{kind:'launch',dryRun:true},{kind:'launch',dryRun:true,cycleId:'unknown-cycle'}]){
  const r=await send(endpoint,body);assert.equal(r.status,200);assert.equal(r.body.requiresConfiguration,true);assert.equal(r.body.cycle,null);assert.equal(r.body.count,0);assert.equal(snapshot(),before,'preview never prepares or copies a cycle and never falls back to another month');
 }
 const noCycle=await send(endpoint,{kind:'launch',dryRun:false});assert.equal(noCycle.status,409);assert.equal(noCycle.body.error,'scoring_cycle_not_prepared');assert.equal(snapshot(),before);
 const prepared=await send('/api/scoring360/cycle',{action:'prepare'});assert.equal(prepared.status,200);assert.equal(prepared.body.cycle.id,'2026-11-360');assert.equal(run("SELECT count(*) AS n FROM scoring360_assignments WHERE cycle_id='2026-11-360';",true)[0].n,0);
 const empty=snapshot(),preview=await send(endpoint,{kind:'launch',dryRun:true});assert.equal(preview.status,200);assert.equal(preview.body.count,0);assert.equal(snapshot(),empty);
 const assigned=await send('/api/scoring360/assignments',{cycleId:'2026-11-360',evalueeUserId:'staff',evaluatorUserId:'peer'});assert.equal(assigned.status,200);
 const configured=snapshot(),selected=await send(endpoint,{kind:'launch',dryRun:true,cycleId:'2026-11-360'});assert.equal(selected.status,200);assert.equal(selected.body.count,1);assert.equal(selected.body.sent,0);assert.equal(selected.body.results[0].recipient.evaluatorUserId,'peer');assert.equal(snapshot(),configured,'preview preserves explicit manual assignments and cycle dates');
 await send(endpoint,{kind:'launch',dryRun:true});assert.equal(snapshot(),configured);
 assert.equal(run("SELECT count(*) AS n FROM scoring360_reminder_sends WHERE status IN('sent','pending','uncertain');",true)[0].n,0);
 assert.equal(await readFile(dir+'/network.log','utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;}),'');assert.equal(run('PRAGMA integrity_check;'),'ok');
 const result={ok:true,previewWithoutCycleReadOnly:true,unknownCycleDoesNotFallBack:true,actualSendRequiresPreparedCycle:true,manualPrepareDoesNotCopy:true,configuredPreviewPreservesRelations:true,ordinaryEmployeeDenied:true,realMessagesSent:0,externalRequests:0,artifacts:dir};await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(logs);throw error;}finally{if(server?.exitCode===null){server.kill('SIGTERM');if(server.exitCode===null)await new Promise(r=>server.once('exit',r));}await writeFile(dir+'/server.log',logs);console.log('Artifacts retained:',dir);}
