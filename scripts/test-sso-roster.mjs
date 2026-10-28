import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSsoRoster} from '../server/sso-roster.mjs';
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
 console.log('SSO roster tests passed: first login, profile updates, user_id identity, department permissions, inactive account remains inactive');
} finally {console.log('Test artifacts retained:',dir);}
