import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createDirectorySync} from '../server/directory-sync.mjs';
import {createEmployeeLifecycle} from '../server/employee-lifecycle.mjs';
import {createSsoRoster} from '../server/sso-roster.mjs';

// Every write is confined to retained, isolated fixtures under outputs/tests.
// All upstream responses are provided in memory; no real Feishu calls occur.
await mkdir('outputs/tests',{recursive:true});
const directory=await mkdtemp(path.resolve('outputs/tests/company-directory-'));
const schema=await readFile('db/schema.sql','utf8');
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const results=[];

async function fixture(name,mode='complete') {
  const db=path.join(directory,name+'.sqlite'),requests=[],identities=[],employment=[],writes=[];
  const run=(statement,json=false)=>{
    const response=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8'});
    assert.equal(response.status,0,response.stderr);
    return json?JSON.parse(response.stdout||'[]'):response.stdout.trim();
  };
  run(schema);
  run(`INSERT INTO employees(user_id,name,department,manager_user_id,is_active) VALUES
    ('existing','原同事','旧部门','old-manager',1),
    ('stopped','旧停用名','旧部门','old-manager',0),
    ('not-returned','本地历史人员','历史部门','old-manager',1);
    INSERT INTO app_settings(key,value_json) VALUES
      ('boss_view_members','{"members":[{"userId":"existing","name":"原同事"}]}'),
      ('scoring360_admin_members','{"members":[]}'),
      ('identity_name_cache','{"members":[{"userId":"cached-leader","name":"缓存负责人"}]}');
    INSERT INTO employee_sso_logins(user_id,last_login_at,sync_note) VALUES('existing','2026-10-01T01:00:00Z','原SSO记录');
    INSERT INTO scoring360_cycles(id,label,start_date,end_date,status) VALUES('history','历史月度','2026-09-01','2026-09-30','closed');
    INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES('history-assignment','history','原同事','本地历史人员','existing','not-returned');
    INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('history-response','history-assignment','history','原同事','本地历史人员',90,'历史评分不可变化');
    INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('local-a','部门甲','cached-leader',datetime('now')),('local-b','部门乙','',datetime('now'));
    INSERT INTO feishu_department_links(open_department_id,department_id,parent_open_department_id,aliases_json,leader_name,synced_at,raw_json) VALUES
      ('od-a','local-a','0','[]','缓存负责人',datetime('now'),'{"name":"部门甲","leader_user_id":"cached-leader"}'),
      ('od-b','local-b','0','[]','',datetime('now'),'{"name":"部门乙","leader_user_id":""}');`);
  if(mode==='cached-names')run(`UPDATE app_settings SET value_json='{"members":[{"userId":"unknown","name":"缓存人员姓名"}]}' WHERE key='identity_name_cache';`);
  const originalRoles=run("SELECT key,value_json FROM app_settings WHERE key IN ('boss_view_members','scoring360_admin_members') ORDER BY key;",true);
  let originalSso=run('SELECT * FROM employee_sso_logins ORDER BY user_id;',true);
  const originalScoring={cycles:run('SELECT * FROM scoring360_cycles;',true),assignments:run('SELECT * FROM scoring360_assignments;',true),responses:run('SELECT * FROM scoring360_responses;',true)};
  let currentMode=mode,concurrentSsoApplied=false;
  const profiles={
    existing:{user_id:'existing',name:'已同步同事',department_ids:['od-a'],leader_user_id:'root-person'},
    stopped:{user_id:'stopped',name:'飞书中的停用同事',department_ids:['od-a'],status:{is_resigned:false}},
    'same-1':{user_id:'same-1',name:'同名同事',department_ids:['od-a'],join_time:'2026-10-01'},
    'same-2':{user_id:'same-2',name:'同名同事',department_ids:['od-b']},
    'root-person':{user_id:'root-person',name:'未登录负责人',department_ids:['0']},
    'scope-only':{user_id:'scope-only',name:'直接授权范围员工',department_ids:['od-b']},
    unknown:{user_id:'unknown',open_id:'ou_fixture_unknown',union_id:'on_fixture_unknown'},
  };
  function person(id){
    const value=structuredClone(profiles[id]);if(!value)throw Error('Unknown fixture user: '+id);
    if(id==='unknown'&&!['missing-names','cached-names','concurrent-sso'].includes(currentMode))value.name='后来补齐的姓名';
    if(id==='existing'&&currentMode==='cached-names')delete value.name;
    if(['existing','unknown'].includes(id)&&currentMode==='concurrent-sso')return {user_id:id,department_ids:['od-unresolved']};
    if(id==='same-2'&&currentMode==='upstream-inactive')value.status={is_resigned:true};return value;
  }
  const response=value=>({ok:true,status:200,json:async()=>value});
  const fetcher=async (input,options={})=>{
    const url=new URL(String(input));
    assert.equal(url.origin,'https://open.feishu.cn','only fixture Feishu routes are allowed');
    requests.push({pathname:url.pathname,query:Object.fromEntries(url.searchParams),method:options.method||'GET'});
    if(requests.length>100)throw Error('fixture_request_limit');
    if(url.pathname==='/open-apis/auth/v3/tenant_access_token/internal')return response({code:0,tenant_access_token:'fixture-tenant-token'});
    assert.equal(url.searchParams.get('user_id_type'),'user_id','all directory user references must use user_id');
    assert.equal(url.searchParams.get('department_id_type'),'open_department_id','all department references must use open_department_id');
    const page=url.searchParams.get('page_token')||'';
    if(url.pathname==='/open-apis/contact/v3/scopes') {
      if(currentMode==='concurrent-sso'&&!concurrentSsoApplied) {
        concurrentSsoApplied=true;
        // Simulate verified SSO writes after the synchronizer's initial SELECT,
        // plus a concurrent manual stop. Only this isolated fixture is changed.
        run(`INSERT INTO employees(user_id,name,department,email,manager_user_id,is_active) VALUES('unknown','SSO新员工真名','SSO新部门','new@example.invalid','sso-manager',1);
          UPDATE employees SET name='SSO最新姓名',department='SSO当前部门',email='current@example.invalid',manager_user_id='current-manager',is_active=0 WHERE user_id='existing';
          INSERT INTO employee_sso_logins(user_id,last_login_at,sync_note) VALUES('unknown','2026-10-28T01:00:00Z','并发SSO来源');
          UPDATE employee_sso_logins SET last_login_at='2026-10-28T01:00:00Z',sync_note='本次SSO核验' WHERE user_id='existing';`);
        originalSso=run('SELECT * FROM employee_sso_logins ORDER BY user_id;',true);
      }
      if(!page)return response({code:0,data:{department_ids:['od-a'],user_ids:[],has_more:true,page_token:'scope-second'}});
      assert.equal(page,'scope-second');
      return response({code:0,data:{department_ids:['od-b'],user_ids:['scope-only'],has_more:false}});
    }
    if(url.pathname==='/open-apis/contact/v3/departments/0')return response({code:0,data:{department:{open_department_id:'0',name:'公司',member_count:currentMode==='mismatch-count'?6:7}}});
    if(url.pathname==='/open-apis/contact/v3/departments/0/children') {
      assert.equal(url.searchParams.get('fetch_child'),'true');
      if(currentMode==='repeated-page')return response({code:0,data:{items:[{open_department_id:'od-a',name:'部门甲',parent_department_id:'0'}],has_more:true,page_token:'repeated-token'}});
      if(!page)return response({code:0,data:{items:[{open_department_id:'od-a',name:'部门甲',parent_department_id:'0'}],has_more:true,page_token:'departments-second'}});
      assert.equal(page,'departments-second');
      const hasEmptyParent=['empty-parent-items','empty-parent-data','malformed-parent-items'].includes(currentMode);
      return response({code:0,data:{items:[
        ...(hasEmptyParent?[{open_department_id:'od-empty',name:'无直属成员的上级部门',parent_department_id:'0'}]:[]),
        {open_department_id:'od-b',name:'部门乙',parent_department_id:hasEmptyParent?'od-empty':'0'},
      ],has_more:false}});
    }
    if(url.pathname==='/open-apis/contact/v3/users/find_by_department') {
      const id=url.searchParams.get('department_id');
      if(id==='0')return response({code:0,data:{items:[person('root-person')],has_more:false}});
      if(id==='od-a') {
        if(!page)return response({code:0,data:{items:[person('existing'),person('same-1')],has_more:true,page_token:'users-second'}});
        assert.equal(page,'users-second');
        return response({code:0,data:{items:[person('existing'),person('stopped')],has_more:false}});
      }
      if(id==='od-b') {
        if(currentMode==='partial-scope')return {ok:false,status:403,json:async()=>({code:99991672,msg:'fixture permission required'})};
        return response({code:0,data:{items:[person('same-2'),person('unknown'),person('root-person')],has_more:false}});
      }
      if(id==='od-empty') {
        if(currentMode==='empty-parent-data')return response({code:0});
        if(currentMode==='malformed-parent-items')return response({code:0,data:{items:null,has_more:false}});
        return response({code:0,data:{has_more:false}});
      }
      throw Error('Unexpected department: '+id);
    }
    const user=url.pathname.match(/^\/open-apis\/contact\/v3\/users\/([^/]+)$/);
    if(user)return response({code:0,data:{user:person(decodeURIComponent(user[1]))}});
    throw Error('Unexpected external route blocked: '+url.pathname);
  };
  const realLifecycle=createEmployeeLifecycle({query:async statement=>run(statement,true),exec:async statement=>run(statement),sql,now:()=>new Date('2026-10-28T02:00:00Z')});
  const service=createDirectorySync({
    query:async statement=>run(statement,true),
    exec:async statement=>{assert(!/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i.test(statement),'synchronization must not delete historical data');writes.push(statement);return run(statement);},
    sql,config:{feishuAppId:'cli_directory_fixture',feishuAppSecret:'fixture-secret'},fetcher,
    registerIdentity:async identity=>identities.push(identity),
    lifecycle:{
      profile:async (...args)=>{employment.push({kind:'profile',args});if(mode==='upstream-inactive')return realLifecycle.profile(...args);},
      observe:async (...args)=>{employment.push({kind:'observe',args});if(mode==='upstream-inactive')return realLifecycle.observe(...args);},
      stop:async (...args)=>{employment.push({kind:'stop',args});if(mode==='upstream-inactive')return realLifecycle.stop(...args);},
    },
  });
  function unchangedHistory({allowSso=false}={}){
    assert.deepEqual(run("SELECT key,value_json FROM app_settings WHERE key IN ('boss_view_members','scoring360_admin_members') ORDER BY key;",true),originalRoles);
    if(!allowSso)assert.deepEqual(run('SELECT * FROM employee_sso_logins ORDER BY user_id;',true),originalSso);
    assert.deepEqual(run('SELECT * FROM scoring360_cycles;',true),originalScoring.cycles);
    assert.deepEqual(run('SELECT * FROM scoring360_assignments;',true),originalScoring.assignments);
    assert.deepEqual(run('SELECT * FROM scoring360_responses;',true),originalScoring.responses);
  }
  return {service,run,requests,identities,employment,writes,unchangedHistory,setMode:value=>{currentMode=value;}};
}

async function check(name,callback){const started=Date.now();await callback();results.push({name,ok:true,milliseconds:Date.now()-started});console.log('PASS '+name);}

await check('all-company enumeration includes root users, paginated departments, user pages, and explicit scope users',async()=>{
  const test=await fixture('all-company'),result=await test.service.run();
  assert.equal(result.total,7,'count must be unique remote user_id values');
  assert.equal(result.created,5);assert.equal(result.updated,2);
  assert.equal(result.scopeComplete,true);assert.equal(result.coverage,'company');assert.equal(result.expectedCompanyTotal,7);assert.equal(result.incomplete,false);
  const rows=test.run('SELECT user_id,name,department,is_active,manager_user_id FROM employees ORDER BY user_id;',true);
  assert.equal(rows.length,8,'seven visible users plus one retained local historical user');
  assert(rows.some(person=>person.user_id==='root-person'&&person.name==='未登录负责人'));
  assert(rows.some(person=>person.user_id==='scope-only'&&person.name==='直接授权范围员工'));
  assert.equal(rows.filter(person=>person.name==='同名同事').length,2,'same names must not merge different user_id values');
  assert.equal(rows.find(person=>person.user_id==='existing').manager_user_id,'root-person');
  assert.equal(rows.find(person=>person.user_id==='stopped').is_active,0,'manual stop must never be undone');
  assert.equal(rows.find(person=>person.user_id==='not-returned').is_active,1,'absence is not proof of resignation');
  assert(test.requests.some(request=>request.query.page_token==='scope-second'));
  assert(test.requests.some(request=>request.query.page_token==='departments-second'));
  assert(test.requests.some(request=>request.query.page_token==='users-second'));
  test.unchangedHistory();
  const status=await test.service.status();assert.equal(status.lastSync.total,7);assert.equal(status.lastSync.coverage,'company');
  const again=await test.service.run();assert.equal(again.created,0);assert.equal(test.run('SELECT count(*) FROM employees;'),'8');test.unchangedHistory();
  assert.equal(test.run('PRAGMA integrity_check;'),'ok');
});

await check('missing names are explicit and do not impersonate IDs or block full ID enrollment',async()=>{
  const test=await fixture('missing-names','missing-names'),result=await test.service.run();
  assert.equal(result.total,7);assert.equal(result.created,5);assert.equal(result.missingNames,1);assert.equal(result.incomplete,true);
  assert.equal(test.run("SELECT name FROM employees WHERE user_id='unknown';"),'待同步姓名');
  assert.equal(test.run("SELECT name_missing FROM employee_directory_profiles WHERE user_id='unknown';"),'1');
  assert.equal(test.run("SELECT count(*) FROM employee_sso_logins WHERE user_id='unknown';"),'0');
  test.setMode('complete');const repaired=await test.service.run();assert.equal(repaired.missingNames,0);assert.equal(repaired.created,0);
  assert.equal(test.run("SELECT name FROM employees WHERE user_id='unknown';"),'后来补齐的姓名');
  assert.equal(test.run("SELECT name_missing FROM employee_directory_profiles WHERE user_id='unknown';"),'0');
  test.unchangedHistory();
});

await check('partial visibility or upstream refusal is not reported as complete company coverage',async()=>{
  const test=await fixture('partial-scope','partial-scope'),result=await test.service.run();
  assert.equal(result.scopeComplete,false);assert.equal(result.coverage,'visible_scope');assert.equal(result.incomplete,true);assert(result.failed>0||result.failedDepartments?.length>0);
  assert.equal(result.expectedCompanyTotal,7);assert(result.total<7);
  assert.equal(test.run("SELECT is_active FROM employees WHERE user_id='not-returned';"),'1');
  assert.equal(test.run("SELECT is_active FROM employees WHERE user_id='stopped';"),'0');
  test.unchangedHistory();
});

await check('ID-only profiles use exact-user_id caches instead of erasing known names',async()=>{
  const test=await fixture('cached-names','cached-names'),result=await test.service.run();
  assert.equal(result.total,7);assert.equal(result.missingNames,0);
  assert.equal(test.run("SELECT name FROM employees WHERE user_id='existing';"),'原同事');
  assert.equal(test.run("SELECT name FROM employees WHERE user_id='unknown';"),'缓存人员姓名');
  test.unchangedHistory();
});

await check('a root member count mismatch is not mistaken for complete company coverage',async()=>{
  const test=await fixture('mismatch-count','mismatch-count'),result=await test.service.run();
  assert.equal(result.total,7);assert.equal(result.expectedCompanyTotal,6);
  assert.equal(result.scopeComplete,false);assert.equal(result.coverage,'visible_scope');assert.equal(result.incomplete,true);
  test.unchangedHistory();
});

for(const mode of ['empty-parent-items','empty-parent-data'])await check(`an empty parent department may omit ${mode==='empty-parent-data'?'the entire data object':'items'} without hiding its child employees`,async()=>{
  const test=await fixture(mode,mode),result=await test.service.run();
  assert.equal(result.total,7);assert.equal(result.expectedCompanyTotal,7);
  assert.equal(result.scopeComplete,true);assert.equal(result.coverage,'company');assert.equal(result.incomplete,false);
  assert.deepEqual(result.failedDepartments,[]);
  assert(test.requests.some(request=>request.pathname==='/open-apis/contact/v3/users/find_by_department'&&request.query.department_id==='od-empty'));
  assert.equal(test.run("SELECT count(*) FROM employees WHERE user_id IN ('same-2','unknown');"),'2','members of the child department remain included');
  test.unchangedHistory();
});

await check('an explicit null items list is malformed rather than a successful empty department',async()=>{
  const test=await fixture('malformed-parent-items','malformed-parent-items'),result=await test.service.run();
  assert.equal(result.total,7);assert.equal(result.scopeComplete,false);assert.equal(result.coverage,'visible_scope');assert.equal(result.incomplete,true);
  assert(result.failedDepartments.includes('od-empty'));
  test.unchangedHistory();
});

await check('new departed Feishu accounts are retained without joining active employee statistics',async()=>{
  const test=await fixture('upstream-inactive','upstream-inactive');await test.service.run();
  assert.equal(test.run("SELECT count(*) FROM employees WHERE user_id='same-2';"),'1');
  assert.equal(test.run("SELECT is_active FROM employees WHERE user_id='same-2';"),'0');
  assert(test.employment.some(event=>event.kind==='observe'&&event.args[0]==='same-2'));
  assert(test.employment.some(event=>event.kind==='stop'&&event.args[0]==='same-2'));
  const periods=test.run("SELECT * FROM employee_employment_periods WHERE employee_user_id='same-2';",true);
  assert.equal(periods.length,1);assert.equal(periods[0].start_date,'2026-10-28');assert.equal(periods[0].end_date,'2026-10-28');
  const restart=createEmployeeLifecycle({query:async statement=>test.run(statement,true),exec:async statement=>test.run(statement),sql,now:()=>new Date('2026-11-02T02:00:00Z')});
  await restart.initialize({});
  assert.deepEqual(test.run("SELECT * FROM employee_employment_periods WHERE employee_user_id='same-2';",true),periods,'a November restart cannot shift an October inactive discovery into November');
  test.unchangedHistory();
});

await check('concurrent SSO profiles and manual stop survive ID-only synchronization',async()=>{
  const test=await fixture('concurrent-sso','concurrent-sso'),result=await test.service.run();
  const rows=test.run("SELECT user_id,name,department,email,manager_user_id,is_active FROM employees WHERE user_id IN ('existing','unknown') ORDER BY user_id;",true);
  assert.deepEqual(rows,[
    {user_id:'existing',name:'SSO最新姓名',department:'SSO当前部门',email:'current@example.invalid',manager_user_id:'current-manager',is_active:0},
    {user_id:'unknown',name:'SSO新员工真名',department:'SSO新部门',email:'new@example.invalid',manager_user_id:'sso-manager',is_active:1},
  ]);
  assert.equal(result.missingNames,0,'name completeness must use committed employee names, not the stale pre-SSO snapshot');
  assert.equal(test.run("SELECT name_missing FROM employee_directory_profiles WHERE user_id='unknown';"),'0');
  assert.equal(test.run("SELECT name_missing FROM employee_directory_profiles WHERE user_id='existing';"),'0');
  assert(!test.employment.some(event=>event.kind==='profile'&&event.args[0]==='existing'),'concurrent stop must be respected by lifecycle updates');
  test.unchangedHistory();
});

await check('a later verified SSO login clears a directory missing-name flag',async()=>{
  const test=await fixture('later-sso','missing-names');await test.service.run();
  assert.equal(test.run("SELECT name_missing FROM employee_directory_profiles WHERE user_id='unknown';"),'1');
  const syncLogin=createSsoRoster({query:async statement=>test.run(statement,true),exec:async statement=>test.run(statement),sql,
    getJson:async route=>{
      if(route.startsWith('/open-apis/contact/v3/users/unknown?'))return {data:{user:{user_id:'unknown',department_ids:['od-b']}}};
      if(route.startsWith('/open-apis/contact/v3/departments/od-b?'))return {data:{department:{name:'部门乙'}}};
      throw Error('Unexpected SSO fixture route');
    },registerIdentity:async()=>{},lifecycle:{profile:async()=>{}},
  });
  await syncLogin({userId:'unknown',name:'本人SSO验证姓名'},'fixture-user-token');
  assert.equal(test.run("SELECT name FROM employees WHERE user_id='unknown';"),'本人SSO验证姓名');
  assert.equal(test.run("SELECT name_missing FROM employee_directory_profiles WHERE user_id='unknown';"),'0');
  assert.equal(test.run("SELECT count(*) FROM employee_sso_logins WHERE user_id='unknown';"),'1');
  test.unchangedHistory({allowSso:true});
});

await check('repeated pagination tokens terminate without deleting or clearing existing data',async()=>{
  const test=await fixture('repeated-page','repeated-page');
  let value,error,timer;
  try {value=await Promise.race([test.service.run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('pagination_did_not_terminate')),5000);})]);}
  catch(failure){error=failure;}finally{clearTimeout(timer);}
  if(error)assert.notEqual(error.message,'pagination_did_not_terminate');
  else {assert(value.incomplete);assert.equal(value.scopeComplete,false);}
  assert(test.requests.length<100,'pagination should be bounded before fixture circuit breaker');
  assert.equal(test.run("SELECT count(*) FROM employees WHERE user_id='not-returned';"),'1');
  test.unchangedHistory();
});

const result={ok:true,checks:results.length,results,realFeishuCalls:0,realMessagesSent:0,artifacts:directory};
await writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
