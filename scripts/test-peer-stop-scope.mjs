import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createEmployeeLifecycle} from '../server/employee-lifecycle.mjs';
import {createDepartments} from '../server/departments.mjs';
import {createManagerReviews} from '../server/manager-reviews.mjs';
import {createPerformance} from '../server/performance.mjs';

// Retained, isolated databases only. No network, real identities or cleanup.
await mkdir('outputs/tests',{recursive:true});
const directory=await mkdtemp(path.resolve('outputs/tests/peer-stop-scope-'));
const schema=await readFile('db/schema.sql','utf8'),month='2026-10';
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const cases=[];
async function fixture(name,target='staff'){
 const dir=directory+'/'+name;await mkdir(dir);const db=dir+'/test.sqlite';
 const run=(statement,json=false)=>{const r=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout.trim();};
 let statusWriteHook;
 const query=async statement=>run(statement,true).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==null?'':String(value)]))),exec=async statement=>{if(statusWriteHook&&statement.includes('UPDATE employees SET is_active=0')){const hook=statusWriteHook;statusWriteHook=null;hook();}return run(statement);};
 run(schema);run(`INSERT INTO employees(user_id,name,department,manager_user_id) VALUES('boss','测试老板','管理',''),('head','测试负责人','团队',''),('staff','测试员工','团队','head'),('other','另一员工','团队','head'),('p1','测试同事甲','团队',''),('p2','测试同事乙','团队','');
  INSERT INTO organization_departments VALUES('team','团队','head',datetime('now'));
  INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) SELECT 'period-'||user_id,user_id,'2026-08-01','manager' FROM employees;
  INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES('oct','十月互评','2026-10-01','2026-10-31','open','2026-10-01T00:00:00Z');
  INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES('a','oct','测试对象','测试同事甲',${sql(target)},'p1'),('b','oct','测试对象','测试同事乙',${sql(target)},'p2');`);
 const now=()=>new Date('2026-10-30T02:00:00Z'),employees=async()=>(await query('SELECT * FROM employees WHERE is_active=1;')).map(e=>({userId:e.user_id,name:e.name,department:e.department,managerUserId:e.manager_user_id}));
 const departments=createDepartments({query,exec,sql,employees,beforeScore:(m,id)=>reviews.freezeBossPlan(m,id),resolveScoreTarget:(m,id)=>reviews.bossTarget(m,id)});
 const reviews=createManagerReviews({query,exec,sql,organization:departments.overview,reports:async()=>[],isBossUserId:id=>id==='boss',now});
 const performance=createPerformance({query,exec,sql,readData:()=>({meta:{periods:[]},weekly_scores:[],employee_summary:[]}),managerReviews:reviews,now});
 const lifecycle=createEmployeeLifecycle({query,exec,sql,now}),actor={userId:'boss',name:'测试老板'};
 const response=(assignment='a',score=90)=>{const a=run(`SELECT * FROM scoring360_assignments WHERE id=${sql(assignment)};`,true)[0];run(`INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES(${sql('response-'+assignment)},${sql(assignment)},${sql(a.cycle_id)},${sql(a.evaluee_name)},${sql(a.evaluator_name)},${score},'具体协作交付证据');`);};
 const snapshot=()=>Object.fromEntries(['scoring360_responses','monthly_review_plans','monthly_manager_scores','department_person_scores','performance_results','all_monthly_weighted_results'].map(table=>[table,run('SELECT * FROM '+table+' ORDER BY '+(table==='all_monthly_weighted_results'?'month,employee_user_id,kind':'rowid')+';',true)]));
 const overview=async()=>(await performance.overview()).monthly.find(row=>row.month===month&&row.userId===target);
 const stop=async(id='p2')=>lifecycle.setStatus(id,false,actor);
 const state=id=>run(`SELECT status FROM scoring360_assignments WHERE id=${sql(id)};`,true)[0]?.status;
 const published=()=>run(`SELECT * FROM all_monthly_weighted_results WHERE month=${sql(month)} AND employee_user_id=${sql(target)};`,true);
 return {name,dir,target,run,query,exec,departments,reviews,performance,lifecycle,actor,response,snapshot,overview,stop,state,published,beforeStatusWrite:hook=>{statusWriteHook=hook;}};
}
const managerRating={month,employeeUserId:'staff',score:80,comment:'负责人已核对本月交付'};

// Primary regression: the former stop changed 2 expected peers into 1 and
// irreversibly published 87. It must wait for the second explicit response.
{
 const f=await fixture('partial-peer-and-manager');f.response();await f.reviews.submit({userId:'head',name:'测试负责人'},managerRating);
 const before=await f.overview();assert.equal(before.collaborationExpected,2);assert.equal(before.collaborationSubmitted,1);assert.equal(f.published().length,0);const saved=f.snapshot();
 await f.stop();let after=await f.overview();assert.equal(after.collaborationExpected,2,'manual stop must preserve the begun monthly denominator');assert.equal(after.collaborationSubmitted,1);assert.equal(after.collaborationComplete,false);assert.equal(f.published().length,0);assert.equal(f.state('b'),'active');assert.deepEqual(f.snapshot(),saved);
 const periods=f.run("SELECT * FROM employee_employment_periods WHERE employee_user_id='p2' ORDER BY id;",true);assert(periods.every(p=>p.end_date));assert.equal((await f.stop()).changed,false);assert.deepEqual(f.run("SELECT * FROM employee_employment_periods WHERE employee_user_id='p2' ORDER BY id;",true),periods);
 await f.lifecycle.setStatus('p2',true,f.actor);after=await f.overview();assert.equal(after.collaborationExpected,2);assert.equal(after.collaborationComplete,false);assert.equal(f.published().length,0);assert.deepEqual(f.snapshot(),saved);
 f.response('b',70);after=await f.overview();assert.equal(after.collaborationComplete,true);assert.equal(f.published().length,1);assert.equal(JSON.parse(f.published()[0].result_json).score,80);
 const final=f.snapshot();await f.stop();assert.deepEqual(f.snapshot(),final,'published scores and evidence remain immutable');cases.push({name:f.name,preservedExpected:2,publishedOnlyAfterSecondResponse:true,finalScore:80});
}
// A peer response alone freezes the peer scope, even before the manager grades.
{
 const f=await fixture('partial-peer-only');f.response();const saved=f.snapshot();await f.stop();const row=await f.overview();assert.equal(row.collaborationExpected,2);assert.equal(row.collaborationComplete,false);assert.equal(f.published().length,0);assert.deepEqual(f.snapshot(),saved);cases.push({name:f.name,preservedExpected:2});
}
// A frozen managerial plan must preserve peers even if no peer has responded.
{
 const f=await fixture('frozen-manager-plan-only');const plan=(await f.reviews.snapshot()).plans.get('staff');f.run(`INSERT INTO monthly_review_plans(month,employee_user_id,plan_json) VALUES(${sql(month)},'staff',${sql(JSON.stringify(plan))});`);const saved=f.snapshot();await f.stop();assert.equal(f.state('b'),'active');assert.equal((await f.overview()).collaborationExpected,2);assert.deepEqual(f.snapshot(),saved);cases.push({name:f.name,preservedExpected:2});
}
{
 const f=await fixture('frozen-boss-plan-only','head');await f.reviews.freezeBossPlan(month,'head');const saved=f.snapshot();await f.stop();assert.equal(f.state('b'),'active');assert.equal((await f.overview()).collaborationExpected,2);assert.deepEqual(f.snapshot(),saved);cases.push({name:f.name,preservedExpected:2});
}
// Scores saved by earlier versions can predate monthly_review_plans.
{
 const f=await fixture('legacy-manager-score');f.run(`INSERT INTO monthly_manager_scores(month,employee_user_id,evaluator_user_id,score,comment,snapshot_json) VALUES(${sql(month)},'staff','head',80,'保留旧负责人评分','{}');`);const saved=f.snapshot();await f.stop();assert.equal(f.state('b'),'active');assert.equal((await f.overview()).collaborationExpected,2);assert.equal(f.published().length,0);assert.deepEqual(f.snapshot(),saved);cases.push({name:f.name,preservedExpected:2});
}
{
 const f=await fixture('legacy-boss-score','head');f.run(`INSERT INTO department_person_scores VALUES('team',${sql(month)},'head',80,'保留旧老板评分','boss','测试老板',datetime('now'));`);const saved=f.snapshot();await f.stop();assert.equal(f.state('b'),'active');assert.equal((await f.overview()).collaborationExpected,2);assert.equal(f.published().length,0);assert.deepEqual(f.snapshot(),saved);cases.push({name:f.name,preservedExpected:2});
}
// Peer results are combined per month across cycles. Stopping cannot discard
// a pending peer in another cycle of that same month.
{
 const f=await fixture('same-month-multiple-cycles');f.run("INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES('oct-2','十月补充','2026-10-20','2026-10-31','open','2026-10-20T00:00:00Z'); UPDATE scoring360_assignments SET cycle_id='oct-2' WHERE id='b';");f.response();await f.stop();assert.equal(f.state('b'),'active');assert.equal((await f.overview()).collaborationExpected,2);cases.push({name:f.name,preservedExpected:2});
}
{
 const f=await fixture('response-before-atomic-stop');f.beforeStatusWrite(()=>f.response());await f.stop();assert.equal(f.state('b'),'active');assert.equal((await f.overview()).collaborationExpected,2);assert.equal(f.published().length,0);cases.push({name:f.name,lateResponseProtected:true,preservedExpected:2});
}
// The target being stopped must also retain unfinished scope; it is not a way
// to complete its month. Pending manager tasks disappear while facts survive.
{
 const f=await fixture('stopped-target');f.response();const saved=f.snapshot();await f.stop('staff');assert.equal(f.state('b'),'active');assert.equal((await f.overview()).collaborationExpected,2);assert.equal(f.published().length,0);assert(!(await f.reviews.tasks({userId:'head',name:'测试负责人'},month)).tasks.some(t=>t.employeeUserId==='staff'));assert.deepEqual(f.snapshot(),saved);cases.push({name:f.name,preservedExpected:2,pendingManagerTaskHidden:true});
}
// Current publication guards retain legacy final-result relationships too.
{
 const f=await fixture('legacy-published');f.response('a',90);f.response('b',84);f.run(`INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES(${sql(month)},'staff','测试员工','collaboration','{"score":87}','{}','旧系统',datetime('now'));`);const saved=f.snapshot();await f.stop();assert.equal(f.state('b'),'active');await f.overview();assert.deepEqual(f.snapshot(),saved);cases.push({name:f.name,historyPreserved:true});
}
// Unused scopes still cancel as before; another employee's grade and a prior
// month's response must not freeze this employee's unstarted October scope.
{
 const f=await fixture('unstarted-and-person-isolation');f.run("INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES('other-a','oct','另一员工','测试同事甲','other','p1');");f.response('other-a');await f.stop();assert.equal(f.state('b'),'inactive');await f.lifecycle.setStatus('p2',true,f.actor);assert.equal(f.state('b'),'inactive','restore must not reactivate canceled unused relationships');assert.equal(f.run('SELECT count(*) AS n FROM scoring360_assignments;',true)[0].n,3);cases.push({name:f.name,unusedRelationshipCanceled:true,restoreDoesNotRevive:true});
}
{
 const f=await fixture('month-isolation');f.run("INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES('sep','九月','2026-09-01','2026-09-30','open','2026-09-01T00:00:00Z'); INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES('sep-a','sep','测试员工','测试同事甲','staff','p1');");f.response('sep-a');await f.stop();assert.equal(f.state('b'),'inactive');cases.push({name:f.name,priorMonthDoesNotFreezeNewScope:true});
}
for(const name of cases.map(c=>c.name)){const r=spawnSync('sqlite3',[directory+'/'+name+'/test.sqlite','PRAGMA integrity_check;'],{encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stdout.trim(),'ok');}
const result={ok:true,cases:cases.length,results:cases,originalPartialStopBugPrevented:true,partialManagerAndBossScopePreserved:true,multiCycleMonthProtected:true,unusedRelationshipBehaviorPreserved:true,historyPreserved:true,realMessagesSent:0,productionWrites:0,artifacts:directory};await writeFile(directory+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
