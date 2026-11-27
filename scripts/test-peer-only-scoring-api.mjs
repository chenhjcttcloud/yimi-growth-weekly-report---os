import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,createHmac} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,symlink} from 'node:fs/promises';
import {createServer} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
import path from 'node:path';

// All requests go to one isolated service with synthetic sessions and data.
// Ambient provider credentials cannot escape the child-process fetch guard.
await mkdir('outputs/tests',{recursive:true});
const artifacts=await mkdtemp(path.resolve('outputs/tests/peer-only-scoring-api-')),data=path.join(artifacts,'data'),db=path.join(artifacts,'test.sqlite');
await mkdir(data);
const binary=process.env.SQLITE3_BIN?path.resolve(process.env.SQLITE3_BIN):'sqlite3';let childPath=process.env.PATH;
if(process.env.SQLITE3_BIN){const bin=path.join(artifacts,'bin');await mkdir(bin);await symlink(binary,path.join(bin,'sqlite3'));childPath=bin+path.delimiter+childPath;}
const quote=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
function sql(statement,json=false){const child=spawnSync(binary,['-bail','-cmd','.timeout 5000',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(child.status,0,child.stderr);return json?JSON.parse(child.stdout||'[]'):child.stdout.trim();}
const month='2026-11',at=Date.parse('2026-11-30T10:00:00+08:00'),secret='synthetic-peer-only-test-session';
const names={boss:'合成老板',admin:'合成管理员',head:'合成负责人',staff:'合成被评员工',zero:'合成零分员工',partial:'合成缺评员工',none:'合成无配评员工',orphan:'合成无负责人员工',self:'合成自评旧关系员工',p0:'合成同事甲',p1:'合成同事乙'};
const privateMarker='PRIVATE_SYNTHETIC_PEER_COMMENT';
sql(await readFile('db/schema.sql','utf8'));
for(const [id,name] of Object.entries(names))sql(`INSERT INTO employees(user_id,name,department,manager_user_id,is_active) VALUES(${quote(id)},${quote(name)},${quote(id==='orphan'?'无负责人团队':'合成团队')},${quote(['boss','head','orphan'].includes(id)?'':'head')},1);`);
sql(`INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('team','合成团队','head',datetime('now')),('orphan','无负责人团队','',datetime('now'));
 INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) SELECT 'hire-'||user_id,user_id,'2026-01-01','synthetic' FROM employees;
 INSERT INTO app_settings(key,value_json) VALUES
 ('business_boss_members','{"members":[{"userId":"boss","name":"合成老板"}]}'),
 ('report_automation_config','{"enabled":false}'),
 ('operations_config','{"backupEnabled":false,"alertsEnabled":false,"backupTime":"03:00","recipientUserIds":[],"diskWarningPercent":85}'),
 ('scoring360_recurring_config','{"enabled":false}');
 INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES
 ('nov','合成十一月','2026-11-01','2026-11-30','open','2026-11-30T00:00:00+08:00'),
 ('oct','合成十月','2026-10-01','2026-10-31','open','2026-10-20T00:00:00+08:00');`);
function assignment(cycle,target,rater){const id=`${cycle}-${target}-${rater}`;sql(`INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id,status) VALUES(${quote(id)},${quote(cycle)},${quote(names[target])},${quote(names[rater])},${quote(target)},${quote(rater)},'active');`);return id;}
for(const [target,raters] of [['staff',['p0','p1']],['zero',['p0']],['partial',['p0','p1']],['orphan',['p1']],['self',['self']]])for(const rater of raters)assignment('nov',target,rater);
assignment('oct','staff','p0');assignment('oct','staff','p1');
for(const source of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights'])await writeFile(path.join(data,source+'.json'),JSON.stringify(source==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:source==='scoring360'?{cycles:[],assignments:[],responses:[]}:{}));
const guard=path.join(artifacts,'network-guard.mjs'),externalLog=path.join(artifacts,'external.log');
await writeFile(guard,`import {appendFileSync} from 'node:fs';const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[${at}]));}static now(){return ${at};}};globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(externalLog)},'blocked\\n');throw Error('synthetic_fixture_external_forbidden');};`);
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base='http://127.0.0.1:'+port;
const cookie=id=>{const body=Buffer.from(JSON.stringify({user:{userId:id,name:names[id]},issuedAt:at,sessionId:'synthetic-peer-'+id,expiresAt:new Date(at+3600000).toISOString()})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
const server=spawn(process.execPath,['--import',guard,'server/index.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:childPath,AUTH_MODE:'feishu',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:path.join(artifacts,'uploads'),BACKUP_DIR:path.join(artifacts,'backups'),LARK_REPORT_SYNC_STATUS_PATH:path.join(artifacts,'sync.json'),
 SCORING360_CONFIG_MANAGER_USER_IDS:'admin',SCORING360_CONFIG_MANAGER_NAMES:'',BOSS_VIEW_USER_IDS:'boss',BOSS_VIEW_NAMES:'',DEV_VIEW_SWITCH_ENABLED:'false',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_TASK_CREATE_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:'',
}});
let logs='',requests=0;server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
async function api(route,id='admin',body){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(id?{cookie:'wos_session='+cookie(id)}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});requests++;return {status:response.status,body:await response.json()};}
const ok=async(route,id,body)=>{const response=await api(route,id,body);assert.equal(response.status,200,JSON.stringify(response));return response.body;};
const overview=month=>ok('/api/performance/manage?view=overview&month='+month);
const submit=(user,cycle,scores)=>api('/api/scoring360/submit',user,{cycleId:cycle,scores});
function fingerprint(){const tables=sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",true);return createHash('sha256').update(JSON.stringify(tables.map(({name})=>[name,sql(`SELECT * FROM "${name.replaceAll('"','""')}";`,true).map(row=>JSON.stringify(row)).sort()]))).digest('hex');}
const scoreCount=()=>sql('SELECT count(*) AS n FROM scoring360_responses;',true)[0].n;
const checks=[];
try{
 let ready=false;for(let n=0;n<150;n++){if(server.exitCode!==null)throw Error('synthetic service exited');try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await pause(100);}assert(ready);await pause(150);
 assert.equal((await api('/api/performance/manage?view=overview&month='+month,null)).status,401);
 assert.equal((await api('/api/performance/manage?view=overview&month='+month,'p0')).status,403);
 assert.equal((await api('/api/performance/me?employeeId=staff','p0')).status,403);
 assert.equal((await api('/api/performance/employee-month?month='+month+'&employeeId=staff','p0')).status,403);
 const initial=await overview(month);assert(initial.monthly.every(row=>!['staff','zero','orphan'].includes(row.userId)||row.collaborationCandidate===null));
 const deniedBefore=fingerprint();
 const manager=await api('/api/manager-reviews','head',{month,employeeUserId:'staff',score:80,comment:privateMarker});
 assert.equal(manager.status,409);assert.equal(manager.body.error,'collaboration_peer_only');
 const boss=await api('/api/departments/score','boss',{month,leaderUserId:'head',score:90,comment:privateMarker});
 assert.equal(boss.status,409);assert.equal(boss.body.error,'collaboration_peer_only');assert.equal(fingerprint(),deniedBefore,'retired thirty-percent writes must not mutate any table');
 const managerTasks=await ok('/api/manager-reviews?month='+month,'head');assert.deepEqual(managerTasks.tasks,[]);
 checks.push('new_manager_and_boss_posts_409_zero_writes','new_month_has_no_manager_tasks','identity_scope_and_authentication');
 const forbiddenBefore=scoreCount();
 const bossPeer=await submit('boss','nov',[{assignmentId:'nov-staff-p0',score:100}]);assert.equal(bossPeer.status,403);assert.equal(bossPeer.body.error,'boss_peer_forbidden');
 const self=await submit('self','nov',[{assignmentId:'nov-self-self',score:100}]);assert.equal(self.status,200);assert.equal(self.body.saved,0);assert.equal(self.body.skipped[0].reason,'self_scoring_forbidden');
 const forged=await submit('p0','nov',[{assignmentId:'nov-staff-p1',score:100}]);assert.equal(forged.status,200);assert.equal(forged.body.saved,0);assert.equal(forged.body.skipped[0].reason,'assignment_not_found');assert.equal(scoreCount(),forbiddenBefore);
 const selfAssign=await api('/api/scoring360/assignments','admin',{cycleId:'nov',evalueeUserId:'none',evaluatorUserId:'none'});assert.equal(selfAssign.status,409);assert.equal(selfAssign.body.error,'self_scoring_forbidden');
 const bossAssign=await api('/api/scoring360/assignments','admin',{cycleId:'nov',evalueeUserId:'none',evaluatorUserId:'boss'});assert.equal(bossAssign.status,409);assert.equal(bossAssign.body.error,'boss_peer_forbidden');
 const sameDepartment=await api('/api/scoring360/assignments','admin',{cycleId:'nov',evalueeUserId:'partial',evaluatorUserId:'head'});assert.equal(sameDepartment.status,200,'ordinary colleagues in the same department remain eligible raters');
 const beforeReminderPreview=fingerprint();
 const reminderPreview=await ok('/api/system-settings/monthly-reminders?month='+month);
 assert(reminderPreview.recipients.length>0);assert(reminderPreview.recipients.every(recipient=>recipient.counts.manager===0&&recipient.counts.boss===0));
 assert(!reminderPreview.recipients.some(recipient=>recipient.userId==='boss'));assert.equal(fingerprint(),beforeReminderPreview,'reminder preview cannot reserve or send deliveries');
 checks.push('new_month_reminder_preview_only_peers_and_zero_writes');
 checks.push('boss_and_self_cannot_submit_or_be_new_raters','forged_evaluator_cannot_submit_other_assignment');

 const first=await submit('p0','nov',[{assignmentId:'nov-staff-p0',score:95,comment:privateMarker},{assignmentId:'nov-zero-p0',score:0},{assignmentId:'nov-partial-p0',score:80}]);assert.equal(first.status,200);assert.equal(first.body.saved,3);
 let view=await overview(month),results=view.results.filter(row=>row.kind==='collaboration');
 assert.equal(results.find(row=>row.employee_user_id==='zero').result.score,0);assert.equal(results.find(row=>row.employee_user_id==='staff'),undefined);
 const second=await submit('p1','nov',[{assignmentId:'nov-staff-p1',score:96},{assignmentId:'nov-orphan-p1',score:70}]);assert.equal(second.status,200);assert.equal(second.body.saved,2);
 view=await overview(month);results=view.results.filter(row=>row.kind==='collaboration');
 const final=results.find(row=>row.employee_user_id==='staff');assert.equal(final.result.score,95.5);assert.equal(final.scoring_rule,'peers_100');assert.equal(final.result.managerScore,null);assert.deepEqual(final.result.weights,{manager:0,peers:100});
 assert.equal(results.find(row=>row.employee_user_id==='orphan').result.score,70,'a missing manager does not block complete peer feedback');
 assert.equal(results.find(row=>row.employee_user_id==='partial'),undefined);assert.equal(results.find(row=>row.employee_user_id==='none'),undefined);
 for(const role of ['admin','boss']){const managed=await ok('/api/performance/manage?view=overview&month='+month,role);assert.equal(managed.results.find(row=>row.kind==='collaboration'&&row.employee_user_id==='staff').result.score,95.5);}
 const own=await ok('/api/performance/me','staff');assert.equal(own.history.find(row=>row.month===month).collaboration,95.5);assert(!JSON.stringify(own).includes(privateMarker));
 const detail=await ok('/api/performance/employee-month?month='+month+'&employeeId=staff','admin');assert.equal(detail.results.find(row=>row.kind==='collaboration').result.score,95.5);
 checks.push('all_peers_publish_without_manager_or_boss','valid_zero_and_same_score_all_authorized_views','partial_and_unassigned_not_published','personal_comments_private');
 const saved=sql('SELECT * FROM monthly_peer_results ORDER BY rowid;',true);
 const repeated=await submit('p0','nov',[{assignmentId:'nov-staff-p0',score:1}]);assert.equal(repeated.status,200);assert.equal(repeated.body.saved,0);assert.equal(repeated.body.skipped[0].reason,'result_locked');
 await overview(month);await ok('/api/performance/me','staff');assert.deepEqual(sql('SELECT * FROM monthly_peer_results ORDER BY rowid;',true),saved);
 assert.equal(sql("SELECT count(*) AS n FROM monthly_manager_scores WHERE month='2026-11';",true)[0].n,0);
 assert.equal(sql("SELECT count(*) AS n FROM all_department_leader_scores WHERE month='2026-11';",true)[0].n,0);
 checks.push('published_peer_submission_and_repeat_get_idempotent');

 await submit('p0','oct',[{assignmentId:'oct-staff-p0',score:90}]);await submit('p1','oct',[{assignmentId:'oct-staff-p1',score:100}]);
 let old=await overview('2026-10');assert.equal(old.results.find(row=>row.month==='2026-10'&&row.kind==='collaboration'&&row.employee_user_id==='staff'),undefined);
 const oldManager=await api('/api/manager-reviews','head',{month:'2026-10',employeeUserId:'staff',score:80,comment:'合成旧十月负责人评价'});assert.equal(oldManager.status,200,JSON.stringify(oldManager));
 old=await overview('2026-10');assert.equal(old.results.find(row=>row.month==='2026-10'&&row.kind==='collaboration'&&row.employee_user_id==='staff').result.score,90.5);
 const oldRows=sql("SELECT * FROM all_monthly_weighted_results WHERE month='2026-10';",true),oldHash=createHash('sha256').update(JSON.stringify(oldRows)).digest('hex');
 await overview(month);assert.deepEqual(sql("SELECT * FROM all_monthly_weighted_results WHERE month='2026-10';",true),oldRows);checks.push('october_still_requires_and_preserves_old_weighted_result');
 assert.equal(sql('PRAGMA integrity_check;'),'ok');assert.equal(sql('PRAGMA foreign_key_check;'),'');
 const blocked=await readFile(externalLog,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});assert.equal(blocked,'');
 const result={ok:true,sqliteVersion:sql('SELECT sqlite_version() AS version;',true)[0].version,requests,checks,oldWeightedHash:oldHash,newResultCount:saved.length,externalRequests:0,productionWrites:0,deletions:0,artifacts};
 await writeFile(path.join(artifacts,'result.json'),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));
}catch(error){await writeFile(path.join(artifacts,'failure-server.log'),logs,{mode:0o600,flag:'wx'});throw error;}
finally{if(server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}console.log('Synthetic artifacts retained:',artifacts);}
