import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSsoRoster} from '../server/sso-roster.mjs';
import {createEmployeeLifecycle} from '../server/employee-lifecycle.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'sso-roster-')),db=path.join(dir,'test.sqlite');
function run(sql,json=false){const r=spawnSync('sqlite3',[...(json?['-json']:[]),db,sql],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout;}
const sql=v=>"'"+String(v).replaceAll("'","''")+"'";
try {
 run(await readFile('db/schema.sql','utf8'));
 let deny=false;
 const sync=createSsoRoster({query:async s=>run(s,true),exec:async s=>run(s),sql,getJson:async url=>{
  if(deny)throw Error('permission_denied');
  return url.includes('/users/')?{data:{user:{user_id:decodeURIComponent(url.split('/users/')[1].split('?')[0]),department_ids:['od_team'],leader_user_id:'ou_manager'}}}:{data:{department:{name:'研发部'}}};
 }});
 const user={userId:'ou_new',name:'新同事',email:'new@example.invalid'};
 const first=await sync(user,'test-token');assert(first.active);assert.equal(first.employee.department,'研发部');
 run("INSERT INTO employee_directory_profiles(user_id,name_missing,synced_at) VALUES('ou_new',1,datetime('now')); UPDATE employees SET name='待同步姓名' WHERE user_id='ou_new';");
 await sync({...user,name:'更新姓名'},'test-token');assert.equal(run('SELECT COUNT(*) AS count FROM employees',true)[0].count,1);
 assert.equal(run('SELECT name FROM employees',true)[0].name,'更新姓名');
 assert.equal(run("SELECT name_missing FROM employee_directory_profiles WHERE user_id='ou_new';",true)[0].name_missing,0,'verified SSO clears stale directory name warnings');
 run("UPDATE employees SET is_active=0 WHERE user_id='ou_new'");
 deny=true;const stopped=await sync(user,'test-token');assert.equal(stopped.active,false);assert.equal(stopped.employee.department,'研发部');
 assert(run('SELECT sync_note FROM employee_sso_logins',true)[0].sync_note.includes('权限'));
 const sameName=await sync({userId:'ou_other',name:'新同事'},'test-token');assert(sameName.active);assert.equal(run('SELECT COUNT(*) AS count FROM employees',true)[0].count,2);
 await assert.rejects(sync({name:'无身份'},'test-token'),/invalid_sso_identity/);
 const lifecycle=createEmployeeLifecycle({query:async s=>run(s,true),exec:async s=>run(s),sql});
 for(const flag of ['is_resigned','is_frozen','is_unjoined']){
  const id='sso-'+flag;
  const guarded=createSsoRoster({query:async s=>run(s,true),exec:async s=>run(s),sql,lifecycle,getJson:async()=>({data:{user:{user_id:id,status:{[flag]:true}}}})});
  assert.equal((await guarded({userId:id,name:'停用状态测试'},'fixture-token')).active,false,'new verified identity cannot enter while Feishu explicitly reports inactive');
  assert(run(`SELECT end_date FROM employee_employment_periods WHERE employee_user_id=${sql(id)};`,true)[0].end_date);
  const before=run(`SELECT * FROM employee_employment_periods WHERE employee_user_id=${sql(id)};`,true);
  await guarded({userId:id,name:'停用状态测试'},'fixture-token');
  assert.deepEqual(run(`SELECT * FROM employee_employment_periods WHERE employee_user_id=${sql(id)};`,true),before,'repeated inactive login preserves closed history');
 }
 run("INSERT INTO employees(user_id,name,is_active) VALUES('sso-existing','在职转停用',1);");
 await lifecycle.observe('sso-existing','2026-09-01','manager');
 const departmentFailure=createSsoRoster({query:async s=>run(s,true),exec:async s=>run(s),sql,lifecycle,getJson:async url=>{if(!url.includes('/users/'))throw Error('department_permission_denied');return {data:{user:{user_id:'sso-existing',status:{is_resigned:true},department_ids:['failing-department']}}};}});
 assert.equal((await departmentFailure({userId:'sso-existing',name:'在职转停用'},'fixture-token')).active,false,'a later department failure does not discard the exact explicit inactive status');
 assert(run("SELECT end_date FROM employee_employment_periods WHERE employee_user_id='sso-existing';",true)[0].end_date);
 for(const [id,profile] of [['absent-status',{user_id:'absent-status'}],['string-status',{user_id:'string-status',status:{is_resigned:'true'}}],['missing-profile-id',{status:{is_resigned:true}}]]){
  const unknown=createSsoRoster({query:async s=>run(s,true),exec:async s=>run(s),sql,getJson:async()=>({data:{user:profile}})});
  assert.equal((await unknown({userId:id,name:'无明确停用状态'},'fixture-token')).active,true,'absence or malformed status is not departure evidence');
 }
 const mismatch=createSsoRoster({query:async s=>run(s,true),exec:async s=>run(s),sql,getJson:async()=>({data:{user:{user_id:'other-id',status:{is_resigned:true}}}})});
 await assert.rejects(mismatch({userId:'mismatched-id',name:'不能串号'},'fixture-token'),/identity_mismatch/);
 assert.equal(run("SELECT count(*) AS n FROM employees WHERE user_id='mismatched-id';",true)[0].n,0);
 assert.equal(run('PRAGMA integrity_check;').trim(),'ok');
 console.log('SSO roster tests passed: first login, user_id identity, permissions, sticky inactive, exact explicit departure on new/existing login, closed history, malformed/missing status and identity mismatch');
} finally {console.log('Test artifacts retained:',dir);}
