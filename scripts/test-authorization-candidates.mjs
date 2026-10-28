import assert from 'node:assert/strict';
import {createAuthorizationCandidates} from '../server/authorization-candidates.mjs';

// In-memory, read-only fixtures: no live Feishu calls, employee enrollment,
// authorization changes, database files, or cleanup operations.
const employees = [
  {user_id:'active',name:'在职同事',department:'研发部',is_active:1},
  {user_id:'same-name',name:'谭健荣',department:'产品部',is_active:1},
  {user_id:'stopped',name:'停用负责人',department:'运营部',is_active:0},
];
const localPeople = employees.map(person=>({userId:person.user_id,name:person.name,department:person.department,active:person.is_active===1}));
const leaderLink = (id, name, departmentName, departmentId=id) => ({
  open_department_id:'od_'+departmentId,department_id:departmentId,
  department_name:departmentName,leader_name:name,
  raw_json:JSON.stringify({open_department_id:'od_'+departmentId,name:departmentName,leader_user_id:id}),
});
const links = [
  leaderLink('director','谭健荣','公司综合协同部','company'),
  leaderLink('director','谭健荣','经营管理部','management'),
  leaderLink('stopped','停用负责人','运营部'),
  leaderLink('active','旧姓名','研发部'),
  leaderLink('no-name','','其他部门'),
  leaderLink('','无负责人部门','支持部'),
];
const originalEmployees = structuredClone(employees), originalLinks=structuredClone(links);
const profileCalls = [], queries=[];
let answer = id=>({user_id:id,name:'谭健荣',status:{is_resigned:false,is_frozen:false,is_unjoined:false}});
const service=createAuthorizationCandidates({
  query:async statement=>{
    assert.match(statement,/^\s*SELECT\b/i,'candidate operations must not mutate the database');
    queries.push(statement);
    if(statement.includes('feishu_department_links'))return structuredClone(links);
    if(/\bemployees\b/i.test(statement))return structuredClone(employees);
    throw Error('Unexpected query: '+statement);
  },
  profile:async id=>{profileCalls.push(id);return answer(id);},
});
const member=(userId,name=userId,department='')=>({userId,name,department});
let checks=0;
async function check(name, fn){await fn();checks++;console.log('PASS '+name);}

await check('local active employees and cached, unenrolled department leaders are discoverable',async()=>{
  const result=await service.list(localPeople);
  assert.equal(result.filter(person=>person.userId==='director').length,1,'same leader in two departments must not duplicate a person');
  const director=result.find(person=>person.userId==='director');
  assert.equal(director.name,'谭健荣');assert.equal(director.active,true);
  assert.equal(director.authorizationOnly,true);assert.equal(director.source,'feishu_department');
  assert.equal(result.find(person=>person.userId==='active').name,'在职同事','verified local name takes precedence over stale leader cache');
  assert(result.some(person=>person.userId==='same-name'),'same names are distinct user_id identities');
  assert(!result.some(person=>person.userId==='stopped'),'cached leader must not resurrect stopped employee');
  assert(!result.some(person=>person.userId==='no-name'),'no verified cached name means no directory-only candidate');
  assert(!result.some(person=>!person.userId));
  assert.deepEqual(profileCalls,[],'viewing candidates must not call Feishu');
});

await check('existing authorizations are retained without upstream lookup',async()=>{
  const previous=[member('former','历史授权人','旧部门'),member('stopped','停用负责人','运营部')];
  const result=await service.validate(previous,previous);
  assert.deepEqual(result.map(person=>person.userId).sort(),['former','stopped']);
  assert.deepEqual(profileCalls,[]);
});

await check('adding an active enrolled employee needs no remote lookup',async()=>{
  const result=await service.validate([member('active','在职同事','研发部')],[]);
  assert.equal(result[0].userId,'active');assert.deepEqual(profileCalls,[]);
});

await check('new stopped employee cannot receive authorization',async()=>{
  await assert.rejects(()=>service.validate([member('stopped')],[]),/authorization_candidate_inactive/);
  assert.deepEqual(profileCalls,[]);
});

await check('arbitrary unknown identity cannot bypass the candidate scope',async()=>{
  await assert.rejects(()=>service.validate([member('arbitrary','谭健荣')],[]),/authorization_candidate_not_found/);
  assert.deepEqual(profileCalls,[],'unknown identity must not cause arbitrary profile lookup');
});

await check('a cached leader is verified by exact user_id before a new grant',async()=>{
  const result=await service.validate([member('director','客户端姓名','客户端部门')],[]);
  assert.equal(result[0].userId,'director');assert.equal(result[0].name,'谭健荣');
  assert.deepEqual(profileCalls,['director']);
});

await check('an ID-only Feishu profile may use the verified cached leader name',async()=>{
  answer=id=>({user_id:id});
  const result=await service.validate([member('director')],[]);
  assert.equal(result[0].name,'谭健荣');assert.equal(result[0].userId,'director');
});

for(const status of ['is_resigned','is_frozen','is_unjoined'])await check('new cached leader rejected for '+status,async()=>{
  answer=id=>({user_id:id,status:{[status]:true}});
  await assert.rejects(()=>service.validate([member('director')],[]),/authorization_candidate_inactive/);
});

await check('mismatched Feishu identity cannot be accepted',async()=>{
  answer=()=>({user_id:'different-user',name:'谭健荣'});
  await assert.rejects(()=>service.validate([member('director')],[]),/authorization_candidate_unavailable/);
});

await check('upstream failures are explicit and do not change any stored data',async()=>{
  answer=()=>{throw Error('provider_permission_denied');};
  await assert.rejects(()=>service.validate([member('director')],[]),/authorization_candidate_unavailable/);
  assert.deepEqual(employees,originalEmployees);assert.deepEqual(links,originalLinks);
});

await check('existing cached-leader authorization survives an unavailable profile',async()=>{
  const before=profileCalls.length,previous=[member('director','谭健荣','公司综合协同部')];
  const result=await service.validate([...previous,member('active','在职同事','研发部')],previous);
  assert(result.some(person=>person.userId==='director'));
  assert.equal(profileCalls.length,before,'only newly added user_id values are verified');
  assert.deepEqual(employees,originalEmployees);assert.deepEqual(links,originalLinks);
});

await check('invalid and non-object department caches are ignored without hiding valid candidates',async()=>{
  const malformedLinks=['null','[]','42','{"leader_user_id":'].map((raw_json,index)=>({
    department_name:'无效缓存部门'+index,leader_name:'无效缓存负责人'+index,raw_json,
  }));
  const mixed=createAuthorizationCandidates({
    query:async statement=>{
      assert.match(statement,/^\s*SELECT\b/i);
      if(statement.includes('feishu_department_links'))return structuredClone([...malformedLinks,...links]);
      if(/\bemployees\b/i.test(statement))return structuredClone(employees);
      throw Error('Unexpected query: '+statement);
    },
    profile:async()=>{throw Error('viewing malformed caches must not query profiles');},
  });
  const result=await mixed.list(localPeople);
  assert.equal(result.filter(person=>person.userId==='director').length,1);
  assert(result.some(person=>person.userId==='active'));
  assert(!result.some(person=>person.name?.startsWith('无效缓存负责人')));
  assert.deepEqual(employees,originalEmployees);assert.deepEqual(links,originalLinks);
});

console.log(JSON.stringify({ok:true,checks,readOnlyQueries:queries.length,profileLookups:profileCalls.length,realFeishuCalls:0,employeeEnrollments:0,authorizationWrites:0}));
