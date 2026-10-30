import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createManagerReviews} from '../server/manager-reviews.mjs';
import {createScoringSetup} from '../server/scoring-setup.mjs';
import {createScoringWorkbench} from '../server/scoring-workbench.mjs';
import {createPerformance} from '../server/performance.mjs';

// Isolated business fixture only: no real identities, network or messages.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/department-mirror-scoring-')),db=dir+'/test.sqlite';
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{const r=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return json?JSON.parse(r.stdout||'[]').map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==null?'':String(value)]))):r.stdout.trim();};
const query=async statement=>run(statement,true),exec=async statement=>run(statement);
run(await readFile('db/schema.sql','utf8'));
// Also permits a focused run while the additive schema change is being edited.
run(`CREATE TABLE IF NOT EXISTS feishu_department_sync_states(department_id TEXT PRIMARY KEY,state TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',checked_at TEXT NOT NULL,deleted_at TEXT);
INSERT INTO employees(user_id,name,department,manager_user_id) VALUES('boss','测试老板','管理',''),('head','待完成负责人','甲部,乙部',''),('published','已完成负责人','丙部,丁部',''),('peer','测试同事','其他','head');
INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) SELECT user_id,user_id,'2026-01-01','manager' FROM employees;
INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('a','甲部','head',datetime('now')),('b','乙部','head',datetime('now')),('c','丙部','published',datetime('now')),('d','丁部','published',datetime('now'));
INSERT INTO feishu_department_sync_states(department_id,state,reason,checked_at) SELECT id,'active','snapshot','2026-10-30T00:00:00Z' FROM organization_departments;
INSERT INTO scoring360_cycles(id,label,start_date,end_date,status) VALUES('oct','十月','2026-10-01','2026-10-31','open');
INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES('head-peer','oct','待完成负责人','测试同事','head','peer'),('published-peer','oct','已完成负责人','测试同事','published','peer');
INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('head-response','head-peer','oct','待完成负责人','测试同事',70,'可核对的协作成果'),('published-response','published-peer','oct','已完成负责人','测试同事',70,'已完成协作评价');`);

let now=new Date('2026-10-30T02:00:00Z');
// Mirror the organization service's public contract, keeping archived identity
// rows available separately while current department membership is filtered.
const organization=async()=>{
 const all=(await query("SELECT d.*,COALESCE(s.state,'active') AS source_state,s.deleted_at FROM organization_departments d LEFT JOIN feishu_department_sync_states s ON s.department_id=d.id ORDER BY d.id;")).map(d=>({...d,is_active:d.source_state==='deleted'?0:1,feishu_deleted:d.source_state==='deleted',parent_id:''}));
 const departments=all.filter(d=>!d.feishu_deleted),archivedDepartments=all.filter(d=>d.feishu_deleted);
 const employees=(await query('SELECT user_id,name,department FROM employees;')).map(e=>({userId:e.user_id,name:e.name,department:e.department,directDepartmentIds:departments.filter(d=>d.leader_user_id===e.user_id).map(d=>d.id)}));
 return {departments,archivedDepartments,employees,scores:await query('SELECT * FROM all_department_leader_scores ORDER BY month,department_id;')};
};
const reviews=createManagerReviews({query,exec,sql,organization,isBossUserId:id=>id==='boss',now:()=>now});
const setup=createScoringSetup({query,exec,sql,isBoss:id=>id==='boss',now:()=>now});
const wb=createScoringWorkbench({query,exec,sql,setup,managerReviews:reviews,bossMembers:()=>[{userId:'boss',name:'测试老板'}],now:()=>now});
const performance=createPerformance({query,exec,sql,managerReviews:reviews,readData:()=>({meta:{periods:[]},employee_summary:[],weekly_scores:[]}),now:()=>now});

await reviews.freezeBossPlan('2026-10','head');
await reviews.freezeBossPlan('2026-10','published');
run(`INSERT INTO department_person_scores(department_id,month,leader_user_id,score,comment,scorer_user_id,scorer_name,created_at) VALUES('a','2026-10','head',80,'甲部评分','boss','测试老板','2026-10-29T02:00:00Z'),('c','2026-10','published',90,'丙部评分','boss','测试老板','2026-10-29T02:00:00Z'),('d','2026-10','published',70,'丁部评分','boss','测试老板','2026-10-29T02:00:00Z');`);
await performance.overview();
assert.equal((await performance.personal('已完成负责人','published')).history.find(row=>row.month==='2026-10').collaboration,73);
const frozenBefore=run('SELECT * FROM monthly_review_plans ORDER BY employee_user_id;'),scoresBefore=run('SELECT * FROM department_person_scores ORDER BY department_id;'),publishedBefore=run('SELECT * FROM all_monthly_weighted_results ORDER BY employee_user_id;');
const oldWorkbench=await wb.overview('2026-10');
run("UPDATE feishu_department_sync_states SET state='deleted',reason='confirmed_absent',deleted_at='2026-10-30T02:01:00Z',checked_at='2026-10-30T02:01:00Z' WHERE department_id IN ('b','d');");

let state=await reviews.snapshot(),progress=reviews.progress(state,'2026-10','head');
assert.deepEqual(progress.expectedIds,['a','b']);
assert.equal(progress.expected,2);assert.equal(progress.submitted,1);assert.equal(progress.complete,false);assert.equal(progress.score,null);
assert.deepEqual(progress.blockedDepartmentIds,['b']);assert.equal(progress.departmentReviewBlocked,true);
assert.deepEqual(progress.records.map(row=>row.department_id),['a']);
assert(!state.plans.get('head').expectedIds.includes('b'),'new organizational plans must not include an archived department');
assert.deepEqual(state.archivedDepartments.map(d=>d.id),['b','d']);
const completed=reviews.progress(state,'2026-10','published');
assert.equal(completed.complete,true);assert.equal(completed.score,80);assert.deepEqual(completed.expectedIds,['c','d']);
assert(!completed.blockedDepartmentIds,'already-submitted archived records do not block a complete historical result');
assert(!(await reviews.bossTargets('2026-10')).scoreTargets.some(row=>['b','d'].includes(row.departmentId)),'removed departments cannot create new score targets');

const changedWorkbench=await wb.overview('2026-10');
assert.notEqual(changedWorkbench.revision,oldWorkbench.revision,'archive state must invalidate the scoring configuration revision');
assert(changedWorkbench.checks.some(issue=>issue.userId==='head'&&issue.type==='department'));
await assert.rejects(()=>wb.mutate({month:'2026-10',revision:oldWorkbench.revision,action:'saveEmployee',employeeUserId:'head',evaluatorUserIds:['peer']},{userId:'boss',name:'测试老板'}),/setup_changed/);
run("UPDATE feishu_department_sync_states SET checked_at='2026-10-30T02:02:00Z' WHERE department_id='b';");
assert.equal((await wb.overview('2026-10')).revision,changedWorkbench.revision,'a timestamp-only recheck does not invalidate edits');

await performance.overview();
assert.equal((await performance.personal('已完成负责人','published')).history.find(row=>row.month==='2026-10').collaboration,73);
assert(!(await performance.personal('待完成负责人','head')).history.some(row=>row.month==='2026-10'&&row.collaboration!=null),'archive cannot auto-publish an incomplete weighted score');
assert.equal(run('SELECT * FROM monthly_review_plans ORDER BY employee_user_id;'),frozenBefore);
assert.equal(run('SELECT * FROM department_person_scores ORDER BY department_id;'),scoresBefore);
assert.equal(run('SELECT * FROM all_monthly_weighted_results ORDER BY employee_user_id;'),publishedBefore);

now=new Date('2026-11-02T02:00:00Z');state=await reviews.snapshot();progress=reviews.progress(state,'2026-11','head');
assert.deepEqual(progress.expectedIds,['a']);assert.equal(progress.frozen,false);assert.equal(progress.expected,1);
assert(!(await reviews.bossTargets('2026-11')).scoreTargets.some(row=>['b','d'].includes(row.departmentId)));
assert.equal(reviews.progress(state,'2026-10','head').expected,2,'old frozen scope remains intact when viewing a new month');
assert.equal(run('SELECT count(*) FROM organization_departments;'),'4','all department identity rows are retained');
assert.equal(run('SELECT count(*) FROM monthly_score_reminder_deliveries;'),'0');
assert.equal(run('PRAGMA integrity_check;'),'ok');
const result={ok:true,frozenDenominatorPreserved:true,ungradedArchiveDoesNotCompleteMonth:true,archivedPendingIdentified:true,newTargetsExcludeArchived:true,completedScoreAndWeightedHistoryPreserved:true,newMonthUsesCurrentOrganization:true,plansAndScoresUnchanged:true,archiveStateInvalidatesRevision:true,recheckTimestampDoesNotInvalidateRevision:true,staleRevisionBlocked:true,departmentRowsRetained:true,realMessagesSent:0,externalRequests:0,artifacts:dir};
await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
