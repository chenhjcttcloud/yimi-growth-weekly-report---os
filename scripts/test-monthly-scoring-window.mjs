import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createMonthlyScoringWindow,monthlyScoringOpensAt} from '../server/monthly-scoring-window.mjs';
import {createManagerReviews} from '../server/manager-reviews.mjs';
import {createDepartments} from '../server/departments.mjs';

await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/monthly-scoring-window-')),db=path.join(dir,'test.sqlite');
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{
 const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return json?JSON.parse(result.stdout||'[]'):result.stdout;
};
const query=async statement=>run(statement,true);
let writes=0;
const exec=async statement=>{writes++;return run(statement);};
run(await readFile('db/schema.sql','utf8'));
run(`INSERT INTO employees(user_id,name,department) VALUES('boss','测试老板','管理组'),('head','测试负责人','测试组'),('staff','测试员工','测试组'),('saved','已评员工','测试组');
INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('team','测试组','head',datetime('now')),('owners','管理组','boss',datetime('now'));
INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES('2026-10-360','十月评分','2026-10-01','2026-10-30','open','2026-10-01T00:00:00+08:00'),('2026-10-other','十月其他周期','2026-10-01','2026-10-30','open','2026-10-01T00:00:00+08:00');
INSERT INTO monthly_manager_scores(month,employee_user_id,evaluator_user_id,score,comment,snapshot_json) VALUES('2026-10','saved','head',89,'原有真实评分保留','{}');`);
let clock=new Date('2026-10-25T15:59:59.999Z');
const now=()=>clock,window=createMonthlyScoringWindow({query,sql,now});
const employees=async()=>(await query('SELECT * FROM employees WHERE is_active=1;')).map(row=>({userId:row.user_id,name:row.name,department:row.department,managerUserId:row.manager_user_id,active:true}));
let reviews;
const departments=createDepartments({query,exec,sql,employees,now,ratingWindow:window,beforeScore:(month,id)=>reviews.freezeBossPlan(month,id),resolveLeaderScoreTarget:(month,id)=>reviews.leaderScoreTarget(month,id)});
reviews=createManagerReviews({query,exec,sql,organization:departments.overview,isBossUserId:id=>id==='boss',now,ratingWindow:window});
const managerBody={month:'2026-10',employeeUserId:'staff',score:80,comment:'测试实际交付'};
const bossBody={month:'2026-10',leaderUserId:'head',score:90,comment:'测试负责人表现'};
const manager={userId:'head',name:'测试负责人'},boss={userId:'boss',name:'测试老板'};
const storedBefore=run('SELECT * FROM monthly_manager_scores ORDER BY month,employee_user_id;',true);
async function assertBlocked(){
 const before=writes;
 await assert.rejects(reviews.submit(manager,managerBody),/scoring_cycle_not_open/);
 await assert.rejects(departments.score(bossBody,boss),/scoring_cycle_not_open/);
 assert.equal(writes,before,'closed rating attempts must not freeze plans or write any rows');
 assert.deepEqual(run('SELECT * FROM monthly_manager_scores ORDER BY month,employee_user_id;',true),storedBefore);
 assert.equal(run('SELECT count(*) FROM monthly_review_plans;').trim(),'0');
 assert.equal(run('SELECT count(*) FROM department_person_scores;').trim(),'0');
}
async function matchesSql(month,expected){
 assert.equal((await window.status(month)).isOpen,expected);
 assert.equal(Number(run(`SELECT (${window.guardSql(month)});`).trim()),Number(expected),'atomic insert guard must match the read status');
}

// The dates distinguish the final natural week from a rolling seven-day window.
assert.equal(monthlyScoringOpensAt('2026-11'),'2026-11-30T00:00:00+08:00','Monday month-end opens on that Monday');
assert.equal(monthlyScoringOpensAt('2026-10'),'2026-10-26T00:00:00+08:00');
assert.equal(monthlyScoringOpensAt('2026-05'),'2026-05-25T00:00:00+08:00','Sunday month-end includes the full final week');
assert.equal(monthlyScoringOpensAt('2028-02'),'2028-02-28T00:00:00+08:00','leap-year month-end');
assert.equal(monthlyScoringOpensAt('2027-02'),'2027-02-22T00:00:00+08:00');
assert.throws(()=>monthlyScoringOpensAt('2026-13'),/invalid_month/);
assert.throws(()=>monthlyScoringOpensAt('2026-1'),/invalid_month/);
for(const tz of ['UTC','Asia/Shanghai','America/Los_Angeles']){
 process.env.TZ=tz;
 assert.equal(monthlyScoringOpensAt('2026-11'),'2026-11-30T00:00:00+08:00');
 assert.equal((await window.status('2026-10')).reason,'before_window');
 await matchesSql('2026-10',false);
}
await assertBlocked();
let tasks=await reviews.tasks(manager,'2026-10');
assert.equal(tasks.reviewWindow.isOpen,false);
assert.equal(tasks.tasks.find(task=>task.employeeUserId==='staff').blocked,true);
const savedTask=tasks.tasks.find(task=>task.employeeUserId==='saved');
assert.equal(savedTask.submitted,true);assert.equal(savedTask.locked,true);assert.equal(savedTask.score,89);
assert.equal(savedTask.blocked,false,'submitted history remains distinct from an unopened task');
assert.equal((await reviews.bossTargets('2026-10')).reviewWindow.isOpen,false);

// The retained October rule opens both thirty-percent channels at Shanghai midnight.
clock=new Date('2026-10-25T16:00:00.000Z');
await matchesSql('2026-10',true);
assert.equal((await window.status('2026-10')).reason,'');
for(const status of ['draft','scheduled','closed']){
 run(`UPDATE scoring360_cycles SET status=${sql(status)} WHERE id='2026-10-360';`);
 await matchesSql('2026-10',false);
 assert.equal((await window.status('2026-10')).reason,status,'an alternate open cycle must not bypass the preferred monthly cycle');
 // Task reads above may materialize unchanged department labels; only the
 // submit attempts below are required to have no database writes.
 const before=writes;
 await assert.rejects(reviews.submit(manager,managerBody),/scoring_cycle_not_open/);
 await assert.rejects(departments.score(bossBody,boss),/scoring_cycle_not_open/);
 assert.equal(writes,before);
}
run("UPDATE scoring360_cycles SET status='open',launch_at=NULL WHERE id='2026-10-360';");
await matchesSql('2026-10',false);
run("UPDATE scoring360_cycles SET launch_at='2026-10-26T00:00:00.001+08:00' WHERE id='2026-10-360';");
await matchesSql('2026-10',false);
assert.equal((await window.status('2026-10')).reason,'launch_pending');
run("UPDATE scoring360_cycles SET launch_at='2026-10-25 16:00:00' WHERE id='2026-10-360';");
await matchesSql('2026-10',true,'SQLite timestamps are interpreted as UTC');
await matchesSql('2026-11',false);
assert.equal((await window.status('2026-11')).reason,'future_month');
await matchesSql('2026-09',false);
assert.equal((await window.status('2026-09')).reason,'missing_cycle');

await reviews.submit(manager,managerBody);
await departments.score(bossBody,boss);
assert.equal(run("SELECT count(*) FROM monthly_manager_scores WHERE month='2026-10';").trim(),'2');
assert.equal(run("SELECT count(*) FROM department_person_scores WHERE month='2026-10';").trim(),'1');
assert.equal(run("SELECT score FROM monthly_manager_scores WHERE employee_user_id='saved';").trim(),'89.0');
tasks=await reviews.tasks(manager,'2026-10');
assert.equal(tasks.tasks.find(task=>task.employeeUserId==='staff').submitted,true);
assert.equal((await reviews.bossTargets('2026-10')).leaderScoreTargets.find(task=>task.leaderUserId==='head').unavailableReason,'result_locked');

// The final INSERT rechecks the cycle if it closes after the read assertion.
run("INSERT INTO employees(user_id,name,department) VALUES('race','并发测试员工','测试组');");
let closeOnInsert=true;
const racedExec=async statement=>{
 if(closeOnInsert&&statement.startsWith('INSERT INTO monthly_manager_scores')){
  closeOnInsert=false;run("UPDATE scoring360_cycles SET status='closed' WHERE id='2026-10-360';");
 }
 return exec(statement);
};
const racedReviews=createManagerReviews({query,exec:racedExec,sql,organization:departments.overview,isBossUserId:id=>id==='boss',now,ratingWindow:window});
await assert.rejects(racedReviews.submit(manager,{...managerBody,employeeUserId:'race'}),/scoring_cycle_not_open/);
assert.equal(run("SELECT count(*) FROM monthly_manager_scores WHERE employee_user_id='race';").trim(),'0','concurrent closing cannot produce a rating');

run("UPDATE scoring360_cycles SET status='open' WHERE id='2026-10-360'; INSERT INTO employees(user_id,name,department) VALUES('head-race','并发负责人','并发组'); INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('race-team','并发组','head-race',datetime('now'));");
let closeBossOnInsert=true;
const racedDepartments=createDepartments({query,exec:async statement=>{
 if(closeBossOnInsert&&statement.startsWith('INSERT INTO department_person_scores')){
  closeBossOnInsert=false;run("UPDATE scoring360_cycles SET status='closed' WHERE id='2026-10-360';");
 }
 return exec(statement);
},sql,employees,now,ratingWindow:window,beforeScore:(month,id)=>reviews.freezeBossPlan(month,id),resolveLeaderScoreTarget:(month,id)=>reviews.leaderScoreTarget(month,id)});
await assert.rejects(racedDepartments.score({...bossBody,leaderUserId:'head-race'},boss),/scoring_cycle_not_open/);
assert.equal(run("SELECT count(*) FROM department_person_scores WHERE leader_user_id='head-race';").trim(),'0','boss scoring also rechecks an intervening cycle closure');

// Previous-month supplementation keeps the explicit open/closed cycle check.
run("UPDATE scoring360_cycles SET status='open',launch_at='2026-10-26T00:00:00+08:00' WHERE id='2026-10-360';");
clock=new Date('2026-11-01T00:00:00+08:00');
await matchesSql('2026-10',true);
await matchesSql('2026-11',false);
assert.equal((await window.status('2026-11')).reason,'before_window');
run("UPDATE scoring360_cycles SET status='closed' WHERE id='2026-10-360';");
await matchesSql('2026-10',false);
// November keeps the shared peer opening window, but both old thirty-percent
// write paths stay disabled on either side of that boundary and never freeze a plan.
run("INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES('2026-11-360','十一月互评100%','2026-11-01','2026-11-30','open','2026-11-01T00:00:00+08:00');");
const priorOctober=JSON.stringify(['monthly_manager_scores','department_person_scores','monthly_review_plans'].map(table=>run('SELECT * FROM '+table+' ORDER BY rowid;',true)));
for(const [at,open] of [['2026-11-29T15:59:59.999Z',false],['2026-11-29T16:00:00.000Z',true]]){
 clock=new Date(at);await matchesSql('2026-11',open);
 const before=writes;
 await assert.rejects(()=>reviews.submit(manager,{...managerBody,month:'2026-11'}),/collaboration_peer_only/);
 await assert.rejects(()=>departments.score({...bossBody,month:'2026-11'},boss),/collaboration_peer_only/);
 assert.equal(writes,before,'retired thirty-percent paths never write, even when the peer window opens');
 assert.deepEqual((await reviews.tasks(manager,'2026-11')).tasks,[]);
 assert.equal(run("SELECT count(*) FROM monthly_manager_scores WHERE month='2026-11';").trim(),'0');
 assert.equal(run("SELECT count(*) FROM department_person_scores WHERE month='2026-11';").trim(),'0');
 assert.equal(JSON.stringify(['monthly_manager_scores','department_person_scores','monthly_review_plans'].map(table=>run('SELECT * FROM '+table+' ORDER BY rowid;',true))),priorOctober,'new policy leaves all October scores and plans byte-for-byte intact');
}
assert.equal(run('PRAGMA integrity_check;').trim(),'ok');
console.log('Monthly scoring window passed: Shanghai final-week boundaries, October manager/boss submissions gated; November peer-only rejects both retired channels without writes; draft/closed/future checks, canonical cycle, SQL race guard, saved scores and historical supplementation.');
console.log('Artifacts retained:',dir);
