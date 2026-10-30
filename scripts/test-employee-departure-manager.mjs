import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createDepartments} from '../server/departments.mjs';
import {createManagerReviews} from '../server/manager-reviews.mjs';
import {createEmployeeLifecycle} from '../server/employee-lifecycle.mjs';

// Retain every isolated fixture and result. This suite uses no network or live DB.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/employee-departure-manager-')),db=dir+'/test.sqlite';
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
function run(statement,json=false){
 const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();
}
const query=async statement=>run(statement,true);
let stopBeforeInsert='',stopBeforeDepartment='';
const exec=async statement=>{
 if(stopBeforeInsert&&statement.startsWith('INSERT INTO monthly_manager_scores')){
  run(`UPDATE employees SET is_active=0 WHERE user_id=${sql(stopBeforeInsert)};`);stopBeforeInsert='';
 }
 if(stopBeforeDepartment&&statement.startsWith('INSERT INTO department_person_scores')){
  run(`UPDATE employees SET is_active=0 WHERE user_id=${sql(stopBeforeDepartment)};`);stopBeforeDepartment='';
 }
 return run(statement);
};
run(await readFile('db/schema.sql','utf8'));
run(`INSERT INTO employees(user_id,name,department,manager_user_id) VALUES
 ('boss','测试老板','管理',''),('h1','第一负责人','团队一',''),('h2','第二负责人','团队二',''),
 ('staff','停用测试员工','团队一 / 团队二',''),('active','在职测试员工','团队二','h2'),
 ('race','并发停用员工','团队一','h1');
 INSERT INTO organization_departments VALUES('team-1','团队一','h1',datetime('now')),('team-2','团队二','h2',datetime('now'));
 INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source)
 SELECT 'period-'||user_id,user_id,'2026-09-01','feishu' FROM employees;
 INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES('oct','十月','2026-10-01','2026-10-31','open','2026-10-01T00:00:00Z');
 INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES('peer-a','oct','停用测试员工','第二负责人','staff','h2');`);
const employees=async()=>(await query('SELECT * FROM employees WHERE is_active=1;')).map(e=>({userId:e.user_id,name:e.name,department:e.department,managerUserId:e.manager_user_id}));
const departments=createDepartments({query,exec,sql,employees,beforeScore:(month,id)=>reviews.freezeBossPlan(month,id),resolveScoreTarget:(month,id)=>reviews.bossTarget(month,id)});
const reviews=createManagerReviews({query,exec,sql,organization:departments.overview,reports:async()=>[],isBossUserId:id=>id==='boss',now:()=>new Date('2026-10-30T02:00:00Z')});
const lifecycle=createEmployeeLifecycle({query,exec,sql,now:()=>new Date('2026-10-30T02:00:00Z')});
const user=id=>({userId:id,name:id});
const rating=id=>({month:'2026-10',employeeUserId:id,score:88,comment:'本月完成交付，协作反馈明确。'});
const tasks=async id=>(await reviews.tasks(user(id),'2026-10')).tasks;
assert((await tasks('h2')).some(task=>task.employeeUserId==='staff'));
await reviews.submit(user('h1'),rating('staff'));
const scoreHistory=run('SELECT * FROM monthly_manager_scores ORDER BY month,employee_user_id,evaluator_user_id;',true);
const planHistory=run("SELECT * FROM monthly_review_plans WHERE employee_user_id='staff';",true);
const assignmentHistory=run('SELECT * FROM scoring360_assignments ORDER BY id;',true);
run("UPDATE employees SET is_active=0 WHERE user_id='staff';");await lifecycle.stop('staff');
assert(!(await tasks('h2')).some(task=>task.employeeUserId==='staff'),'inactive targets have no unsubmitted manager task');
const retained=(await tasks('h1')).find(task=>task.employeeUserId==='staff');
assert(retained?.submitted&&retained.locked,'submitted manager history remains visible and locked');assert.equal(retained.score,88);
await assert.rejects(reviews.submit(user('h2'),rating('staff')),/employee_inactive/);
let progress=reviews.progress(await reviews.snapshot(),'2026-10','staff');
assert.deepEqual(progress.expectedIds,['h1','h2']);assert.equal(progress.submitted,1);assert.equal(progress.complete,false);assert.equal(progress.score,null);
assert.deepEqual(run('SELECT * FROM monthly_manager_scores ORDER BY month,employee_user_id,evaluator_user_id;',true),scoreHistory);
assert.deepEqual(run("SELECT * FROM monthly_review_plans WHERE employee_user_id='staff';",true),planHistory);
assert.deepEqual(run('SELECT * FROM scoring360_assignments ORDER BY id;',true),assignmentHistory);

await lifecycle.setStatus('staff',true,user('boss'));
assert((await tasks('h2')).some(task=>task.employeeUserId==='staff'),'explicit restore permits still-current frozen pending work');
assert((await tasks('h1')).find(task=>task.employeeUserId==='staff')?.locked);
assert.deepEqual(run("SELECT * FROM monthly_review_plans WHERE employee_user_id='staff';",true),planHistory);

// An inactive reviewer remains in the frozen denominator until explicit handoff;
// it must neither receive tasks nor silently complete another employee's month.
run(`INSERT INTO monthly_review_plans(month,employee_user_id,plan_json) VALUES('2026-10','active',${sql(JSON.stringify((await reviews.snapshot()).plans.get('active')))});`);
run("UPDATE employees SET is_active=0 WHERE user_id='h2';");await lifecycle.stop('h2');
progress=reviews.progress(await reviews.snapshot(),'2026-10','active');
assert.deepEqual(progress.expectedIds,['h2']);assert.equal(progress.handoffRequired,true);assert.equal(progress.complete,false);
assert.equal((await tasks('h2')).length,0);await assert.rejects(reviews.submit(user('h2'),rating('active')),/not_your_subordinate/);
assert((await reviews.handoffOverview('2026-10')).tasks.some(task=>task.employeeUserId==='active'));
await assert.rejects(departments.score({departmentId:'team-2',month:'2026-10',score:85,comment:'不应给停用负责人新评分'},user('boss')),/leader_inactive/);

stopBeforeInsert='race';
await assert.rejects(reviews.submit(user('h1'),rating('race')),/employee_inactive/);
assert.equal(run("SELECT count(*) AS n FROM monthly_manager_scores WHERE employee_user_id='race';",true)[0].n,0,'stop between read and insert cannot save a new grade');
assert.deepEqual(run('SELECT * FROM monthly_manager_scores ORDER BY month,employee_user_id,evaluator_user_id;',true),scoreHistory);
assert.deepEqual(run("SELECT * FROM monthly_review_plans WHERE employee_user_id='staff';",true),planHistory);
const bossRating={departmentId:'team-1',month:'2026-10',score:85,comment:'负责人本月交付与协作评价'};
stopBeforeDepartment='h1';
await assert.rejects(departments.score(bossRating,user('boss')),/leader_inactive/);
assert.equal(run('SELECT count(*) AS n FROM department_person_scores;',true)[0].n,0,'target stopped before the boss write receives no grade');
const frozenBossPlan=run("SELECT * FROM monthly_review_plans WHERE employee_user_id='h1';",true);
await lifecycle.stop('h1');
await lifecycle.setStatus('h1',true,user('boss'));
stopBeforeDepartment='boss';
await assert.rejects(departments.score(bossRating,user('boss')),/account_inactive/);
assert.equal(run('SELECT count(*) AS n FROM department_person_scores;',true)[0].n,0,'stopped boss cannot create a grade after the scope read');
assert.deepEqual(run("SELECT * FROM monthly_review_plans WHERE employee_user_id='h1';",true),frozenBossPlan,'failed retries preserve the frozen boss scope');
await lifecycle.stop('boss');
await lifecycle.setStatus('boss',true,user('h1'));
await departments.score(bossRating,user('boss'));
const bossHistory=run('SELECT * FROM department_person_scores;',true);
assert.equal(bossHistory.length,1);assert.equal(bossHistory[0].score,85);
run("UPDATE employees SET is_active=0 WHERE user_id IN('boss','h1');");
assert.deepEqual(run('SELECT * FROM department_person_scores;',true),bossHistory,'later stops preserve the submitted boss score');
assert.deepEqual(run('SELECT * FROM monthly_manager_scores ORDER BY month,employee_user_id,evaluator_user_id;',true),scoreHistory);
assert.equal(run('SELECT count(*) AS n FROM employees;',true)[0].n,6);assert.equal(run('PRAGMA integrity_check;'),'ok');
const result={ok:true,inactivePendingTargetHidden:true,inactiveTargetSubmissionBlocked:true,submittedHistoryReadonly:true,frozenDenominatorPreserved:true,restorePreservesScope:true,inactiveReviewerRequiresHandoff:true,inactiveBossTargetBlocked:true,concurrentStopBlocksInsert:true,concurrentBossTargetStopBlocksInsert:true,concurrentBossActorStopBlocksInsert:true,submittedBossHistoryPreserved:true,realMessagesSent:0,artifacts:dir};
await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
