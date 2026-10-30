import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createFeishuDepartmentSync} from '../server/feishu-department-sync.mjs';
import {createDepartments} from '../server/departments.mjs';

// All provider responses and identities are fixtures. No application endpoint,
// production database or real network client is used by this suite.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/department-mirror-sync-'));
const schema=await readFile('db/schema.sql','utf8');
const quote=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const root={open_department_id:'od-root',name:'事业群',parent_department_id:'0',leader_user_id:'boss',member_count:2};
const child={open_department_id:'od-child',name:'产品部',parent_department_id:'od-root',leader_user_id:'leader',member_count:2};
const month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
const cases=[];
let fixtureCount=0;

async function fixture(label,{initialSync=true}={}){
  const folder=dir+'/'+String(++fixtureCount).padStart(2,'0')+'-'+label;await mkdir(folder);
  const db=folder+'/fixture.sqlite',statements=[],calls=[];
  function run(statement,json=false){
    const value=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:8*1024*1024});
    assert.equal(value.status,0,value.stderr);return json?JSON.parse(value.stdout||'[]'):value.stdout.trim();
  }
  run(schema);
  run("INSERT INTO employees(user_id,name,department,is_active) VALUES('leader','测试负责人','产品部',1),('member','测试成员','产品部',1),('boss','测试老板','事业群',1);\n"+
    "INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('old-child','产品部','leader','2026-01-01T00:00:00Z'),('manual','本地手工部门','','2026-01-01T00:00:00Z');\n"+
    "INSERT INTO department_leader_scores(department_id,month,leader_user_id,score,comment,scorer_user_id,scorer_name,created_at) VALUES('old-child','2026-08','leader',92,'保留的历史评价','boss','测试老板','2026-08-31T10:00:00Z');");
  const people=[{userId:'leader',name:'测试负责人',department:'产品部'},{userId:'member',name:'测试成员',department:'产品部'},{userId:'boss',name:'测试老板',department:'事业群'}];
  const remote={pages:[[root],[child]],listFailure:null,details:new Map()};
  const api=value=>({ok:true,status:200,json:async()=>value});
  const fetcher=async(url,options={})=>{
    const u=new URL(url);assert.equal(u.origin,'https://open.feishu.cn');calls.push({path:u.pathname,query:u.search,method:options.method||'GET'});
    if(u.pathname.endsWith('/tenant_access_token/internal'))return api({code:0,tenant_access_token:'fixture-token'});
    if(u.pathname.includes('/contact/v3/users/')){const id=decodeURIComponent(u.pathname.split('/').at(-1));return api({code:0,data:{user:{user_id:id,name:people.find(p=>p.userId===id)?.name||'测试人员'}}});}
    assert.equal(u.searchParams.get('department_id_type'),'open_department_id');assert.equal(u.searchParams.get('user_id_type'),'user_id');
    if(u.pathname==='/open-apis/contact/v3/departments/0/children'){
      const index=u.searchParams.has('page_token')?Number(u.searchParams.get('page_token')):0;
      const failure=remote.listFailure?.(index);if(failure)return failure;
      const values=remote.pages[index];assert(Array.isArray(values),'unexpected_fixture_page');
      return api({code:0,data:{items:values,has_more:index<remote.pages.length-1,...(index<remote.pages.length-1?{page_token:String(index+1)}:{})}});
    }
    if(u.pathname.startsWith('/open-apis/contact/v3/departments/')){
      const id=decodeURIComponent(u.pathname.split('/').at(-1)),detail=remote.details.get(id);
      if(typeof detail==='function')return detail();
      if(detail)return detail;
      return api({code:0,data:{department:{...(id===root.open_department_id?root:child),status:{is_deleted:false}}}});
    }
    throw Error('unexpected_fixture_provider_path');
  };
  const query=async statement=>run(statement,true),exec=async statement=>{statements.push(statement);return run(statement);};
  const service=createFeishuDepartmentSync({query,exec,sql:quote,config:{feishuAppId:'fixture-app',feishuAppSecret:'fixture-secret'},fetcher});
  const departments=createDepartments({query,exec,sql:quote,employees:async()=>people});
  if(initialSync){const value=await service.sync();assert.equal(value.departmentCount,2);assert.equal(value.created,1);assert.equal(value.updated,1);assert.equal(Number(value.removed||0),0);}
  const history=()=>run('SELECT * FROM department_leader_scores ORDER BY department_id,month;',true);
  const business=()=>({departments:run('SELECT * FROM organization_departments ORDER BY id;',true),links:run('SELECT * FROM feishu_department_links ORDER BY department_id;',true),hierarchy:run('SELECT * FROM department_hierarchy ORDER BY department_id;',true),states:run('SELECT * FROM feishu_department_sync_states ORDER BY department_id;',true),history:history()});
  return {folder,db,run,remote,service,departments,calls,statements,history,business};
}

function providerError(code,status=400){return {ok:false,status,json:async()=>({code,msg:'fixture-provider-error'})};}
const absent=()=>providerError(40015);
const payload=view=>view.departments.map(({id,name,parent_id,leader_user_id,leader_mode,sort_order,is_active})=>({id,name,parent_id,leader_user_id,leader_mode,sort_order,is_active}));
async function currentAndHistory(f){
  const view=await f.departments.overview();
  assert(view.departments.some(d=>d.id==='manual'),'manual departments are outside Feishu deletion reconciliation');
  assert.equal(f.history()[0].score,92);assert.equal(f.history()[0].comment,'保留的历史评价');
  return view;
}

{
  const f=await fixture('confirmed-removal'),originalHistory=digest(f.history()),before=await f.departments.overview();
  f.remote.pages=[[root]];f.remote.details.set('od-child',absent());
  const result=await f.service.sync();assert.equal(result.removed,1);assert.equal(result.unverifiedMissing,0);
  const state=f.run("SELECT * FROM feishu_department_sync_states WHERE department_id='old-child';",true)[0];assert.equal(state.state,'deleted');assert(state.deleted_at);
  let view=await currentAndHistory(f);assert(!view.departments.some(d=>d.id==='old-child'));assert(view.archivedDepartments.some(d=>d.id==='old-child'&&d.name==='产品部'));assert(!view.employees.some(e=>e.departmentIds.includes('old-child')),'old roster strings cannot recreate removed department membership');
  assert.equal(f.run("SELECT count(*) AS count FROM organization_departments WHERE id='old-child';",true)[0].count,1);assert.equal(f.run("SELECT department_id FROM feishu_department_links WHERE open_department_id='od-child';",true)[0].department_id,'old-child');
  assert.equal((await f.departments.personal({userId:'leader'}))[0].score,92);
  await assert.rejects(f.departments.save({id:'old-child',name:'产品部',leaderUserId:'leader'}),/department_removed/);
  await assert.rejects(f.departments.score({departmentId:'old-child',month,leaderUserId:'leader',score:90,comment:'不得新增到移除部门'},{userId:'boss',name:'测试老板'}),/department_removed/);
  await assert.rejects(f.departments.saveLayout({revision:before.layoutRevision,departments:payload(before)}),/department_layout_conflict|department_removed/);
  await f.departments.saveLayout({revision:view.layoutRevision,departments:payload(view)});
  assert.equal(digest(f.history()),originalHistory,'archiving and saving remaining departments cannot rewrite history');
  view=await f.departments.overview();assert(!view.departments.some(d=>d.id==='old-child'));
  const repeated=await f.service.sync();assert.equal(repeated.removed,0,'repeated synchronization must not count an already removed department again');
  f.remote.pages=[[root],[child]];
  const restored=await f.service.sync();assert.equal(restored.restored,1);assert.equal(f.run("SELECT department_id FROM feishu_department_links WHERE open_department_id='od-child';",true)[0].department_id,'old-child');
  view=await currentAndHistory(f);assert(view.departments.some(d=>d.id==='old-child'));assert(!view.archivedDepartments.some(d=>d.id==='old-child'));assert.equal(digest(f.history()),originalHistory);
  assert(!f.statements.some(s=>/\bDELETE\s+FROM\b/i.test(s)),'reconciliation must retain business rows');
  assert(f.calls.some(c=>c.path.endsWith('/od-child')&&c.method==='GET'));assert(f.calls.some(c=>c.query.includes('page_token=1')));
  cases.push({name:'confirmed-removal-restore',ok:true,currentListMirrored:true,historyPreserved:true,rosterDoesNotRevive:true,remainingLayoutEditable:true,archivedWritesRejected:true,stableIdRestored:true});
}

for(const [name,detail] of [
  ['permission',providerError(40004,403)],['rate-limit',providerError(99991400,429)],['upstream',providerError(40003,500)],
  ['contradictory-5xx',providerError(40015,500)],['contradictory-403',providerError(40015,403)],
  ['generic-404',providerError(404,404)],['network',()=>{throw Error('fixture-network-unavailable');}],
  ['invalid-json',{ok:true,status:200,json:async()=>{throw new SyntaxError('fixture-invalid-json');}}],
  ['empty-body',{ok:true,status:200,json:async()=>null}],['missing-department',{ok:true,status:200,json:async()=>({code:0,data:{}})}],
  ['wrong-identity',{ok:true,status:200,json:async()=>({code:0,data:{department:{...child,open_department_id:'od-other',status:{is_deleted:true}}}})}],
  ['malformed-status',{ok:true,status:200,json:async()=>({code:0,data:{department:{...child,status:{is_deleted:'true'}}}})}],
  ['still-exists',{ok:true,status:200,json:async()=>({code:0,data:{department:{...child,status:{is_deleted:false}}}})}],
]){
  const f=await fixture('uncertain-'+name),history=digest(f.history());f.remote.pages=[[root]];f.remote.details.set('od-child',detail);
  const result=await f.service.sync();assert.equal(result.removed,0,name);assert.equal(result.unverifiedMissing,1,name);
  const view=await currentAndHistory(f);assert(view.departments.some(d=>d.id==='old-child'),name+' must retain last known department');assert(!view.archivedDepartments.some(d=>d.id==='old-child'));assert.equal(digest(f.history()),history);
  cases.push({name:'uncertain-'+name,ok:true,notArchived:true});
}

{
  const f=await fixture('deleted-detail');f.remote.pages=[[root]];f.remote.details.set('od-child',{ok:true,status:200,json:async()=>({code:0,data:{department:{...child,status:{is_deleted:true}}}})});
  const result=await f.service.sync();assert.equal(result.removed,1);assert.equal(result.unverifiedMissing,0);assert(!(await currentAndHistory(f)).departments.some(d=>d.id==='old-child'));
  cases.push({name:'explicit-deleted-detail',ok:true});
}
{
  const f=await fixture('deleted-list'),marker=f.calls.length;f.remote.pages=[[root,{...child,status:{is_deleted:true}}]];
  const result=await f.service.sync();assert.equal(result.departmentCount,1);assert.equal(result.removed,1);assert(!(await currentAndHistory(f)).departments.some(d=>d.id==='old-child'));assert(!f.calls.slice(marker).some(call=>call.path.endsWith('/od-child')),'a matching explicit deleted list record is already authoritative');
  cases.push({name:'explicit-deleted-list',ok:true});
}
{
  const f=await fixture('all-remote-removed'),history=digest(f.history());f.remote.pages=[[]];f.remote.details.set('od-child',absent());f.remote.details.set('od-root',absent());
  const result=await f.service.sync();assert.equal(result.departmentCount,0);assert.equal(result.removed,2);assert.equal(result.unverifiedMissing,0);
  const view=await currentAndHistory(f);assert.deepEqual(view.departments.map(d=>d.id),['manual']);assert.equal(view.archivedDepartments.length,2);assert.equal(digest(f.history()),history);
  cases.push({name:'empty-list-with-confirmed-last-deletions',ok:true});
}
{
  const f=await fixture('empty-initial-scope',{initialSync:false}),before=digest(f.business());f.remote.pages=[[]];await assert.rejects(f.service.sync(),/department_scope_empty/);assert.equal(digest(f.business()),before);
  cases.push({name:'empty-initial-scope-no-writes',ok:true});
}
for(const mode of ['second-page-permission','malformed-list','incomplete-tree']){
  const f=await fixture(mode),before=digest(f.business());
  if(mode==='second-page-permission'){f.remote.pages=[[{...root,status:{is_deleted:true}}],[child]];f.remote.listFailure=index=>index===1?providerError(40004,403):null;}
  else if(mode==='malformed-list')f.remote.listFailure=()=>({ok:true,status:200,json:async()=>({code:0,data:{has_more:false}})});
  else f.remote.pages=[[{...child,parent_department_id:'od-unknown'}]];
  await assert.rejects(f.service.sync(),/department_scope_required|department_upstream_failed|department_incomplete_tree|department_invalid_pagination/);assert.equal(digest(f.business()),before,'failed snapshots must not partially apply statuses or departments');
  cases.push({name:mode+'-atomicity',ok:true});
}
{
  const f=await fixture('new-id-same-name'),history=digest(f.history());f.remote.pages=[[root],[{...child,open_department_id:'od-recreated-child'}]];f.remote.details.set('od-child',absent());
  const result=await f.service.sync();assert.equal(result.removed,1);assert.equal(result.created,1);
  const link=f.run("SELECT department_id FROM feishu_department_links WHERE open_department_id='od-recreated-child';",true)[0];assert(link);assert.notEqual(link.department_id,'old-child','new Feishu identities cannot inherit old department IDs or scores');
  const view=await currentAndHistory(f),current=view.departments.filter(d=>d.name==='产品部');assert.equal(current.length,1);assert.equal(current[0].id,link.department_id);assert(view.archivedDepartments.some(d=>d.id==='old-child'&&d.name==='产品部'));assert.equal(digest(f.history()),history);assert(view.scores.every(score=>score.department_id!==link.department_id));
  const personalHistory=await f.departments.personal({userId:'leader'});assert.equal(personalHistory[0].department,'产品部','history display must preserve the original friendly name, never its private storage suffix');assert.equal(personalHistory[0].score,92);
  cases.push({name:'new-id-same-name-history-isolation',ok:true});
}
{
  const f=await fixture('removed-parent-retained-child'),parent=f.run("SELECT department_id FROM feishu_department_links WHERE open_department_id='od-root';",true)[0].department_id;
  f.run("INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('manual-child','本地子团队','','2026-01-01T00:00:00Z');INSERT INTO department_hierarchy(department_id,parent_id) VALUES('manual-child',"+quote(parent)+");");
  f.remote.pages=[[{...child,parent_department_id:'0'}]];f.remote.details.set('od-root',absent());
  const result=await f.service.sync();assert.equal(result.removed,1);
  const view=await currentAndHistory(f);assert(!view.departments.some(d=>d.id===parent));assert.equal(view.departments.find(d=>d.id==='old-child').parent_id,'');assert.equal(view.departments.find(d=>d.id==='manual-child').parent_id,'','local children cannot disappear beneath a removed parent');
  await f.departments.saveLayout({revision:view.layoutRevision,departments:payload(view)});
  cases.push({name:'removed-parent-keeps-current-children-visible-and-editable',ok:true});
}

const result={ok:true,fixtures:fixtureCount,cases,confirmedRemovalOnly:true,lastDepartmentRemovalSupported:true,reappearanceUsesSameIdentity:true,newIdentityDoesNotInheritHistory:true,permissionsAndFailuresDoNotRemove:true,partialSnapshotsDoNotWrite:true,currentOrganizationAndArchivedHistorySeparated:true,historyAndManualDepartmentsPreserved:true,archivedWritesRejected:true,realProviderRequests:0,realMessagesSent:0,productionWrites:0,artifacts:dir};
await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
