import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPerformance} from '../server/performance.mjs';
import {createPersonalWorkspace} from '../server/personal-workspace.mjs';
import {createManagerReviews} from '../server/manager-reviews.mjs';

// All SQL and mutations stay inside retained fixture databases. No provider,
// Feishu request, application server, real employee data or production is used.
await mkdir('outputs/tests',{recursive:true});
const directory=await mkdtemp(path.resolve('outputs/tests/personal-loading-scope-'));
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const people=[
 {user_id:'a',name:'同名员工',department:'测试部门',manager_user_id:'m'},
 {user_id:'b',name:'同名员工',department:'测试部门',manager_user_id:'m'},
 {user_id:'m',name:'负责人',department:'测试部门',manager_user_id:'boss'},
 {user_id:'boss',name:'老板',department:'公司'},
];
const reportContent=(id,end)=>({results:`${id}本人真实验收事实 ${end}`,problems:`${id}本人卡点`,nextPlan:`${id}下期计划 ${end}`,reflection:`${id}本人复盘`,'成果分':90,'问题分':50,'计划分':70,'复盘分':60});
const raw=freeze({meta:{collectionStartDate:'2026-08-01',periods:[
 {id:'aug-first',start:'2026-08-03',end:'2026-08-07',label:'八月第一周'},
 {id:'aug-second',start:'2026-08-10',end:'2026-08-14',label:'八月第二周'},
 {id:'sep-first',start:'2026-08-31',end:'2026-09-04',label:'九月第一周'},
 {id:'oct-first',start:'2026-09-28',end:'2026-10-02',label:'十月第一周'},
 {id:'oct-fourth',start:'2026-10-19',end:'2026-10-23',label:'十月第四周'},
 ]},employee_summary:people.map(e=>({user_id:e.user_id,'姓名':e.name,'部门':e.department})),weekly_scores:[
 {user_id:'a','姓名':'同名员工','部门':'测试部门','开始日期':'2026-08-03','结束日期':'2026-08-07','源记录ID':'prototype-a','状态':'准时','提交时间':'2026-08-07T19:00:00+08:00',...reportContent('prototype-a','2026-08-07')},
 // An ambiguous name without a verified user_id must never become either user.
 {'姓名':'同名员工','开始日期':'2026-06-01','结束日期':'2026-06-05','源记录ID':'ambiguous','状态':'准时','提交时间':'2026-06-05T19:00:00+08:00',...reportContent('AMBIGUOUS_PRIVATE','2026-06-05')},
 ]});
const insights=freeze({'oct-first':{meta:{provider:'isolated-fixture'},employeeInsights:[
 {userId:'a',coachSummary:'a本人的存档点评',taskCandidates:[{title:'a本人计划',description:'a本人行动',evidence:'a本人事实'}]},
 {userId:'b',coachSummary:'B_PRIVATE_COACH',taskCandidates:[{title:'B_PRIVATE_TASK',description:'B_PRIVATE_TASK_BODY'}]},
 ]}});
let weights=[30,25,25,20];
const fixedNow=()=>new Date('2026-10-29T12:00:00+08:00');
const calendar=()=>({});
const initialDb=path.join(directory,'baseline.sqlite');
function run(db,statement,json=false){
 const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:64*1024*1024});
 assert.equal(result.status,0,result.stderr);
 return json?JSON.parse(result.stdout.trim()||'[]'):result.stdout;
}
run(initialDb,await readFile('db/schema.sql','utf8'));
for(const person of people)run(initialDb,`INSERT INTO employees(user_id,name,department,manager_user_id) VALUES(${sql(person.user_id)},${sql(person.name)},${sql(person.department)},${sql(person.manager_user_id)});`);
run(initialDb,"INSERT INTO employee_employment_periods(id,employee_user_id,start_date,end_date,source) VALUES('a-1','a','2026-01-01','2026-08-14','manager'),('a-2','a','2026-09-01',NULL,'manager'),('b','b','2026-01-01',NULL,'manager'),('m','m','2026-01-01',NULL,'manager'),('boss','boss','2026-01-01',NULL,'manager');");
const ends={a:['2026-07-31','2026-08-07','2026-08-14','2026-08-21','2026-09-04','2026-10-02','2026-10-23'],b:['2026-08-07','2026-09-11'],m:['2026-10-02']};
for(const [id,dates] of Object.entries(ends))for(const end of dates){
 const start=new Date(end+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-4);
 const content=reportContent(id,end);if(id==='b'){content.results='B_PRIVATE_REPORT';content['成果分']=10;}
 run(initialDb,`INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,submitted_at) VALUES(${sql(id+end)},${sql(id)},${sql(people.find(p=>p.user_id===id).name)},'测试部门',${sql(end)},${sql(start.toISOString().slice(0,10))},${sql(end)},'准时',${sql(JSON.stringify(content))},${sql(end+'T19:00:00+08:00')});`);
}
run(initialDb,"INSERT INTO performance_results VALUES('2026-04','a','同名员工','quality','{\"score\":77}','{\"reviewNote\":\"历史人工结果\",\"private\":\"A_LEGACY_EVIDENCE\"}','历史审核','2026-05-01'),('2026-05','b','同名员工','quality','{\"score\":64}','{\"private\":\"B_PRIVATE_LEGACY\"}','历史审核','2026-06-01');");
for(const month of ['2026-08','2026-09','2026-10'])run(initialDb,`INSERT INTO scoring360_cycles(id,label,start_date,end_date) VALUES(${sql(month)},${sql(month)},${sql(month+'-01')},${sql(month+'-28')});`);
run(initialDb,"INSERT INTO scoring360_assignments(id,cycle_id,evaluee_user_id,evaluator_user_id,evaluee_name,evaluator_name) VALUES('a-peer-b','2026-10','a','b','同名员工','同名员工'),('a-peer-m','2026-10','a','m','同名员工','负责人'),('b-peer-a','2026-10','b','a','同名员工','同名员工'),('b-peer-m','2026-10','b','m','同名员工','负责人');");
run(initialDb,`INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('r-a-b','a-peer-b','2026-10','同名员工','同名员工',90,'有事实评价'),('r-a-m','a-peer-m','2026-10','同名员工','负责人',80,'有事实评价'),('r-b-m','b-peer-m','2026-10','同名员工','负责人',60,${sql('\u00a0\n\t')});`);
run(initialDb,"INSERT INTO monthly_manager_scores(month,employee_user_id,evaluator_user_id,score,comment,snapshot_json) VALUES('2026-10','a','m',80,'月度反馈','{}');");

// When available, compare against the known deployed pre-optimization commit.
// A shallow CI checkout may not contain it: permanent scope/behavior assertions
// below still run against real SQL, without requiring historical git objects.
const baselineRef=process.env.PERSONAL_LOADING_BASELINE_REF||'9e27427';
async function baselineModule(file){
 const result=spawnSync('git',['show',baselineRef+':server/'+file],{encoding:'utf8'});if(result.status!==0)return null;
 const source=result.stdout.replaceAll(/from '\.\/([^']+)'/g,(_,relative)=>`from '${pathToFileURL(path.resolve('server',relative)).href}'`);
 const target=path.join(directory,'baseline-'+file);await writeFile(target,source);
 return import(pathToFileURL(target).href);
}
const baselinePerformance=(await baselineModule('performance.mjs'))?.createPerformance;
const baselineWorkspace=(await baselineModule('personal-workspace.mjs'))?.createPersonalWorkspace;
function harness(db,performanceFactory=createPerformance,workspaceFactory=createPersonalWorkspace){
 const log={queries:[],writes:[],reads:{},policies:[]};
 const query=async statement=>{const rows=run(db,statement,true).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==null?'':String(value)])));log.queries.push({statement,rows});return rows;};
 const exec=async statement=>{log.writes.push(statement);run(db,statement);};
 const readData=key=>{log.reads[key]=(log.reads[key]||0)+1;return key==='prototypeData'?raw:insights;};
 const policyFor=async month=>{log.policies.push(month);return {weights:[...weights],deadlineTime:'20:00'};};
 const organization=async()=>({departments:[{id:'unit',name:'测试部门',leader_user_id:'m',is_active:'1'}],employees:people.map(e=>({userId:e.user_id,name:e.name,department:e.department,directDepartmentIds:e.user_id==='boss'?[]:['unit']})),scores:await query('SELECT * FROM all_department_leader_scores;')});
 const managerReviews=createManagerReviews({query,exec,sql,organization,isBossUserId:id=>id==='boss',now:fixedNow});
 const performance=performanceFactory({query,exec,sql,readData,policyFor,managerReviews,calendar,now:fixedNow});
 const workspace=workspaceFactory({performance,query,exec,sql,readData,policyFor,calendar,config:{moonshotApiKey:'',taskCreateEnabled:false},askAi:()=>{throw Error('provider_forbidden_in_test');},createTask:()=>{throw Error('feishu_forbidden_in_test');}});
 const reset=()=>{log.queries=[];log.writes=[];log.reads={};log.policies=[];};
 return {performance,workspace,log,reset,db};
}
const user={name:'同名员工',userId:'a'},other={name:'同名员工',userId:'b'};
const counts=log=>({prototypeReads:log.reads.prototypeData||0,insightReads:log.reads.kimiInsightsByPeriod||0,reportBodyQueries:log.queries.filter(q=>q.statement.startsWith('SELECT * FROM weekly_reports')).length,reportBodiesReturned:log.queries.filter(q=>q.statement.startsWith('SELECT * FROM weekly_reports')).reduce((n,q)=>n+q.rows.length,0),selects:log.queries.length,writeTransactions:log.writes.length,writeSqlBytes:log.writes.reduce((n,s)=>n+Buffer.byteLength(s),0),policyReads:log.policies.length});
let before=null,beforeWorkspace=null,globalBefore=null;
if(baselinePerformance&&baselineWorkspace){const baseline=harness(initialDb,baselinePerformance,baselineWorkspace);beforeWorkspace=await baseline.workspace.workspace(user,'2026-10','oct-first');before=counts(baseline.log);globalBefore=await baseline.performance.overview();}
const db=path.join(directory,'scoped.sqlite');await copyFile(initialDb,db);
const current=harness(db);
const full=await current.performance.overview();
if(globalBefore)assert.deepEqual(full,globalBefore,'default global/full response must remain byte-for-byte structurally compatible');
current.reset();assert.deepEqual(await current.performance.overview(),full,'default global/full remains stable on repeated reads');
assert.equal(current.log.writes.length,0,'unchanged global results must not acquire a write transaction');
current.reset();
const afterWorkspace=await current.workspace.workspace(user,'2026-10','oct-first');
const after=counts(current.log);
if(beforeWorkspace)assert.deepEqual(afterWorkspace,beforeWorkspace,'the complete personal workspace response must match the deployed behavior');
assert.equal(after.prototypeReads,1);assert.equal(after.insightReads,1);assert.equal(after.reportBodyQueries,1);assert.equal(after.reportBodiesReturned,ends.a.length);
if(before)assert(after.reportBodiesReturned<before.reportBodiesReturned);
assert.equal(after.writeTransactions,0,'unchanged personal results must not acquire a write transaction');
assert.equal(new Set(current.log.policies).size,current.log.policies.length,'each month policy is read once within the shared request');
assert.equal(afterWorkspace.weeks.find(w=>w.id==='oct-first').closure.previousWeek,'2026-09-04');
assert.equal(afterWorkspace.weeks.find(w=>w.id==='oct-first').closure.previousPlan,'a下期计划 2026-09-04','the selected month must not truncate the previous plan');
assert.equal(afterWorkspace.history.find(r=>r.month==='2026-04').quality,77,'all personal history is retained');
assert.equal(afterWorkspace.rollingMonths,3);
assert(!JSON.stringify(afterWorkspace).includes('B_PRIVATE'));assert(!JSON.stringify(afterWorkspace).includes('AMBIGUOUS_PRIVATE'));
for(const entry of current.log.queries){
 const q=entry.statement;
 if(q.startsWith('SELECT * FROM weekly_reports'))assert.equal(q,"SELECT * FROM weekly_reports WHERE employee_user_id='a';");
 if(q.startsWith('SELECT user_id,name,department,is_active FROM employees'))assert(q.includes("WHERE user_id='a'"));
 // managerReviews has a separate global responsibility snapshot; the scoped
 // calculation and weeks lookup must both use exact employee employment rows.
 if(q.startsWith('SELECT * FROM employee_employment_periods WHERE'))assert(q.includes("employee_user_id='a'"));
 if(q.startsWith('SELECT a.*,r.score'))assert(q.includes("a.evaluee_user_id='a'"));
 if(q.includes("'legacy' AS scoring_rule")){
  if(q.includes('ORDER BY month DESC'))for(const alias of ['p','w','a'])assert(q.includes(`${alias}.employee_user_id='a'`));
  else {assert.equal((q.match(/WHERE employee_user_id='a'/g)||[]).length,2);assert(q.includes("a.employee_user_id='a'"));}
 }
}
current.reset();
const scoped=await current.performance.overview({employeeUserId:'a',clientSummary:true});
assert.equal(scoped.employees.length,1);assert(scoped.monthly.every(r=>r.userId==='a'));assert(scoped.results.every(r=>r.employee_user_id==='a'));
assert.deepEqual(scoped.months,full.months,'global publication/period month boundaries remain available without other employees scores');
assert.deepEqual(scoped.monthly,full.monthly.filter(r=>r.userId==='a'));
for(const cycle of scoped.collaborations){const original=full.collaborations.find(c=>c.id===cycle.id);assert.equal(cycle.expected,original.expected);assert.equal(cycle.submitted,original.submitted);assert.deepEqual(cycle.pending,original.pending);assert(cycle.assignments.every(a=>a.evaluee_user_id==='a'));}
assert.equal(scoped.collaborations.find(c=>c.id==='2026-10').expected,4,'whole-cycle progress must not become single-person totals');
assert(scoped.collaborations.find(c=>c.id==='2026-10').pending.includes('负责人'),'Unicode-only comments are still incomplete');
const historyFrom=view=>{const rows=view.results.filter(r=>r.employee_user_id==='a'),months=[...new Set(rows.map(r=>r.month))].sort().reverse();const history=months.map(month=>{const get=kind=>rows.find(r=>r.month===month&&r.kind===kind)?.result;return {month,quality:get('quality')?.score??null,qualityStatus:get('quality')?.status||null,timeliness:get('timeliness')??null,collaboration:get('collaboration')?.score??null,collaborationRule:rows.find(r=>r.month===month&&r.kind==='collaboration')?.scoring_rule||null};});const scores=history.filter(r=>r.quality!==null).slice(0,3).map(r=>r.quality);return {history,ratingProgress:view.monthly.filter(r=>r.userId==='a').map(r=>({month:r.month,peerComplete:r.peerComplete,managerKind:r.managerProgress.kind,managerExpected:r.managerProgress.expected,managerSubmitted:r.managerProgress.submitted,managerComplete:r.managerProgress.complete})),rollingQuality:scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*10)/10:null,rollingMonths:scores.length};};
assert.deepEqual(await current.performance.personal(user.name,'a'),historyFrom(full),'global and scoped personal results are identical');
const august=await current.workspace.workspace(user,'2026-08','aug-first');
assert.equal(august.weeks.find(w=>w.end==='2026-08-21').status,'不在职');
assert.equal(august.weeks.find(w=>w.end==='2026-08-28').status,'不在职');
const september=await current.workspace.workspace(user,'2026-09','sep-first');
assert.equal(september.weeks.find(w=>w.id==='sep-first').status,'准时','restored employment counts subsequent reports normally');
const augustRow=scoped.monthly.find(r=>r.month==='2026-08');assert.equal(augustRow.timeliness.expected,2,'inactive dates must not add missing submissions');

// A context can only be issued by this performance instance for its own user.
const context=await current.performance.createReportContext('a');
assert.deepEqual(JSON.parse(JSON.stringify(context)),{userId:'a'});
await assert.rejects(()=>current.performance.personal(other.name,'b',{reportContext:context}),/invalid_report_context/);
await assert.rejects(()=>current.performance.overview({reportContext:context}),/invalid_report_context/);
await assert.rejects(()=>current.performance.personal(user.name,'a',{reportContext:{userId:'a',data:raw,reports:context.reports}}),/invalid_report_context/);
for(const invalid of ['',null,' a','a ','a'.repeat(201)])await assert.rejects(()=>current.performance.overview({employeeUserId:invalid}),/invalid_employee_identity/);
const pretender=await current.workspace.workspace({name:user.name,userId:'not-in-directory'},'2026-10');assert.equal(pretender.weeks.length,0);

// Real SQL verifies changing policy takes effect on the next request, and the
// latest (not any historical) calculation hash handles A -> B -> A correctly.
const versions=()=>run(db,"SELECT COUNT(*) AS n FROM automatic_performance_results WHERE employee_user_id='a';",true)[0].n;
const versionA=versions();weights=[100,0,0,0];current.reset();
const changed=await current.performance.personal(user.name,'a');
assert.equal(changed.history.find(r=>r.month==='2026-10').quality,90);assert(versions()>versionA);
assert.deepEqual(changed.history.find(r=>r.month==='2026-10').collaboration,83.5,'published collaboration remains immutable');
assert.equal(changed.history.find(r=>r.month==='2026-04').quality,77,'legacy human results remain authoritative');
const versionB=versions();await current.performance.personal(user.name,'a');assert.equal(versions(),versionB,'same inputs must not append a revision');
weights=[30,25,25,20];await current.performance.personal(user.name,'a');assert(versions()>versionB,'A -> B -> A must append the restored revision');
assert.deepEqual(await current.performance.personal(user.name,'a'),historyFrom(await current.performance.overview()),'global/scoped equality also holds after rule revisions');

// Week selection, personal comments/reactions, task draft edits and disabled
// external task creation retain the existing ownership checks and stable IDs.
const payload={month:'2026-10',weekId:'oct-first'},task=afterWorkspace.tasks[0];
await current.workspace.saveTask(user,{...payload,id:task.id,title:'本人草稿',description:'本人正文\n第二行'});
await current.workspace.interact(user,{...payload,body:'本人评论\n证据'},'comment');
await current.workspace.interact(user,{...payload,liked:true},'like');
const edited=await current.workspace.workspace(user,payload.month,payload.weekId);
assert.equal(edited.selectedWeekId,'oct-first');assert.equal(edited.tasks[0].id,task.id);assert.equal(edited.tasks[0].title,'本人草稿');assert.equal(edited.comments[0].body,'本人评论\n证据');assert.equal(edited.likeCount,1);
const beta=await current.workspace.workspace(other,payload.month,payload.weekId);assert.equal(beta.comments.length,0);assert(!beta.tasks.some(t=>t.id===task.id));assert(!JSON.stringify(beta).includes('a本人'));
await assert.rejects(()=>current.workspace.saveTask(other,{...payload,id:task.id,title:'非法草稿',description:'非法正文'}),/task_not_found/);
const dryRun=await current.workspace.createTasks(user,{}, {...payload,ids:[task.id]});assert.equal(dryRun.results[0].dryRun,true);
current.reset();const upcoming=await current.workspace.workspace(user,'2026-10','period-2026-10-30');assert.equal(upcoming.tasks.length,0);assert.equal(current.log.reads.kimiInsightsByPeriod||0,0);
assert.equal(run(db,'SELECT COUNT(*) AS n FROM feishu_tasks;',true)[0].n,0);
assert.equal(run(db,'SELECT COUNT(*) AS n FROM personal_coach_messages;',true)[0].n,0);
assert.equal(raw.weekly_scores[0]['源记录ID'],'prototype-a','frozen source snapshots remain intact');
const result={ok:true,artifacts:directory,baselineRef,baselineAvailable:Boolean(before),baseline:before,scoped:after,globalFullResponseEqual:globalBefore?true:'baseline-unavailable',personalWorkspaceResponseEqual:beforeWorkspace?true:'baseline-unavailable',globalAndScopedPersonalEqual:true,sameNameIsolation:true,onlyOwnReportBodiesRead:true,contextOwnerVerified:true,freshPolicies:true,latestHashAvoidsUnchangedWrites:true,restoredPolicyRevisionRetained:true,employmentStopRestore:true,allHistoryAndPreviousPlanRetained:true,wholeCycleProgressRetained:true,taskCommentWeekFlowsRetained:true,realProviderRequests:0,messagesSent:0,productionWrites:0};
await writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
