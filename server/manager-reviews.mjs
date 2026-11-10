import {randomUUID} from 'node:crypto';
import {employedInMonth} from './employee-lifecycle.mjs';
const round=value=>Math.round(value*10)/10;
const average=values=>values.length?round(values.reduce((sum,value)=>sum+Number(value),0)/values.length):null;
const key=(month,id)=>JSON.stringify([month,id]);
export function createManagerReviews({query,exec,sql,organization,reports,isBossUserId=()=>false,now=()=>new Date()}){
 const monthNow=()=>now().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 const validMonth=month=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||month>monthNow())throw Error('invalid_month');return month;};
 async function snapshot(organizationData){
  const data=organizationData||await organization(),departments=data.departments.filter(d=>Number(d.is_active)!==0),byId=new Map(departments.map(d=>[d.id,d]));
  const inactiveDepartments=data.departments.filter(d=>Number(d.is_active)===0&&!d.feishu_deleted);
  const archivedDepartments=(data.archivedDepartments||[]).filter(d=>d.feishu_deleted===true);
  const roster=await query('SELECT user_id,name,department,manager_user_id,is_active FROM employees;'),periods=await query('SELECT * FROM employee_employment_periods;');
  const people=new Map(roster.map(e=>[e.user_id,{userId:e.user_id,name:e.name,department:e.department,managerUserId:e.manager_user_id,active:Number(e.is_active)===1,employmentPeriods:periods.filter(p=>p.employee_user_id===e.user_id)}]));
  const plans=new Map();
  for(const entry of data.employees){
   const employee={...entry,...people.get(entry.userId)};if(isBossUserId(employee.userId))continue;
   const led=departments.filter(d=>d.leader_user_id===employee.userId),managers=new Map();
   if(!led.length){
    if(employee.managerUserId&&employee.managerUserId!==employee.userId)managers.set(employee.managerUserId,{userId:employee.managerUserId,departments:[]});
    else for(const direct of employee.directDepartmentIds||[]){
     const visited=new Set();let cursor=direct;
     while(cursor&&!visited.has(cursor)){visited.add(cursor);const d=byId.get(cursor);if(!d)break;if(d.leader_user_id&&d.leader_user_id!==employee.userId){const entry=managers.get(d.leader_user_id)||{userId:d.leader_user_id,departments:[]};entry.departments.push(d.id);managers.set(d.leader_user_id,entry);break;}cursor=d.parent_id;}
    }
   }
   plans.set(employee.userId,{employee,kind:led.length?'boss':'manager',expectedIds:led.length?led.map(d=>d.id):[...managers.keys()],managers:[...managers.values()]});
  }
  const scores=await query('SELECT * FROM monthly_manager_scores ORDER BY created_at,rowid;'),frozen=new Map();
  const bossScores=data.scores.filter(score=>score.department_id!==''),bossPersonScores=data.personScores||data.scores.filter(score=>score.department_id==='');
  for(const row of await query('SELECT month,employee_user_id,plan_json,created_at FROM monthly_review_plans;'))frozen.set(key(row.month,row.employee_user_id),{...JSON.parse(row.plan_json),frozenAt:row.created_at});
  // Recover the original scope of scores submitted before monthly plans were introduced.
  for(const score of scores){const k=key(score.month,score.employee_user_id);if(frozen.has(k))continue;const saved=JSON.parse(score.snapshot_json||'{}'),base=plans.get(score.employee_user_id),employee=people.get(score.employee_user_id)||saved.employee;
   if(employee)frozen.set(k,{...base,employee,kind:'manager',expectedIds:saved.expectedIds?.length?saved.expectedIds:[score.evaluator_user_id],frozenAt:score.created_at});
  }
  for(const score of [...bossScores,...bossPersonScores]){const k=key(score.month,score.leader_user_id);if(frozen.has(k))continue;const base=plans.get(score.leader_user_id),employee=people.get(score.leader_user_id);if(employee)frozen.set(k,{...base,employee,kind:'boss',expectedIds:[...new Set([...bossScores.filter(s=>s.month===score.month&&s.leader_user_id===score.leader_user_id).map(s=>s.department_id),...(base?.kind==='boss'?base.expectedIds:[])])],frozenAt:score.created_at});}
  const handoffs=await query('SELECT * FROM monthly_manager_handoffs ORDER BY rowid;');
  const eligibleIds=new Set([...departments.map(d=>d.leader_user_id),...roster.map(e=>e.manager_user_id),...roster.filter(e=>isBossUserId(e.user_id)).map(e=>e.user_id)]);
  return {plans,people,departments,inactiveDepartments,archivedDepartments,frozen,handoffs,scores,bossScores,bossPersonScores,eligibleManagers:[...people.values()].filter(e=>e.active&&eligibleIds.has(e.userId))};
 }
 function planFor(state,month,userId){
  const original=state.frozen.get(key(month,userId))||state.plans.get(userId);if(!original)return null;
  const employee=state.people.get(userId)||original.employee,periods=employee.employmentPeriods||[];
  if(periods.length&&!employedInMonth(periods,month))return null;
  let expectedIds=[...original.expectedIds];const taskStartById={};
  // An archived Feishu department disappears from new organizational plans.
  // A monthly plan already locked by a submitted score keeps its original
  // denominator: removing an ungraded department must not complete the month.
  if(original.kind==='boss')expectedIds=[...new Set([...state.bossScores.filter(s=>s.month===month&&s.leader_user_id===userId).map(s=>s.department_id),...expectedIds.filter(id=>state.departments.some(d=>d.id===id&&d.leader_user_id===userId)||Boolean(original.frozenAt)&&(state.archivedDepartments||[]).some(d=>d.id===id))])];
  if(original.kind==='manager')for(const h of state.handoffs.filter(h=>h.month===month&&h.employee_user_id===userId)){expectedIds=expectedIds.map(id=>id===h.from_user_id?h.to_user_id:id);taskStartById[h.to_user_id]=h.created_at;}
  const start=periods.filter(p=>p.start_date<=month+'-31'&&(!p.end_date||p.end_date>=month+'-01')).map(p=>p.start_date).sort().at(-1);
  return {...original,employee,expectedIds:[...new Set(expectedIds)],taskStartById,taskStartedAt:(start&&start>month+'-01'?start:month+'-01')+'T00:00:00+08:00'};
 }
 function progress(state,month,userId){
  const plan=planFor(state,month,userId);if(!plan)return {kind:'unassigned',expectedIds:[],expected:0,submitted:0,complete:false,score:null,records:[],blockedIds:[],handoffRequired:false};
  let expectedIds=plan.expectedIds,records;
  if(plan.kind==='boss'){
   records=state.bossScores.filter(s=>s.month===month&&s.leader_user_id===userId&&expectedIds.includes(s.department_id));
   const personScore=state.bossPersonScores?.find(s=>s.month===month&&s.leader_user_id===userId);
   const legacyComplete=expectedIds.length>0&&records.length===expectedIds.length;
   if(personScore||!legacyComplete&&state.departments.some(d=>d.leader_user_id===userId)){
    // The reserved scope key lets the publication guard validate this one score
    // against the same immutable score source as historical department rows.
    expectedIds=[''];records=personScore?[{...personScore,department_id:''}]:[];
   }
  }else records=state.scores.filter(s=>s.month===month&&s.employee_user_id===userId&&expectedIds.includes(s.evaluator_user_id));
  const complete=expectedIds.length>0&&records.length===expectedIds.length,blockedIds=plan.kind==='manager'?expectedIds.filter(id=>!records.some(r=>r.evaluator_user_id===id)&&!state.people.get(id)?.active):[];
  const blockedDepartmentIds=plan.kind==='boss'?expectedIds.filter(id=>!records.some(r=>r.department_id===id)&&(state.archivedDepartments||[]).some(d=>d.id===id)):[];
  return {kind:plan.kind,expectedIds,expected:expectedIds.length,submitted:records.length,complete,score:complete?average(records.map(r=>r.score)):null,records,blockedIds,...(blockedDepartmentIds.length?{blockedDepartmentIds,departmentReviewBlocked:true}:{}),handoffRequired:blockedIds.length>0,taskStartedAt:plan.taskStartedAt,taskStartById:plan.taskStartById,frozen:Boolean(plan.frozenAt)};
 }
 async function freeze(month,userId,kind){
  const state=await snapshot(),plan=planFor(state,month,userId);if(!plan)throw Error('employee_not_employed');if(kind&&plan.kind!==kind)throw Error('not_your_subordinate');
  await exec(`INSERT OR IGNORE INTO monthly_review_plans(month,employee_user_id,plan_json) VALUES(${sql(month)},${sql(userId)},${sql(JSON.stringify(plan))});`);
 }
 const frozenIds=(state,month)=>[...state.frozen.keys()].map(k=>JSON.parse(k)).filter(([m])=>m===month).map(([,id])=>id);
 async function tasks(user,month){
  month=validMonth(month||monthNow());const state=await snapshot(),mine=[...new Set([...state.plans.keys(),...frozenIds(state,month)])].map(id=>planFor(state,month,id)).filter(p=>p?.kind==='manager'&&p.expectedIds.includes(user.userId)&&state.people.get(user.userId)?.active&&(p.employee.active||state.scores.some(s=>s.month===month&&s.employee_user_id===p.employee.userId&&s.evaluator_user_id===user.userId)));
  const ids=new Set(mine.map(p=>p.employee.userId)),evidence=ids.size&&reports?await reports():[];
  const published=await query(`SELECT employee_user_id FROM all_monthly_weighted_results WHERE month=${sql(month)} UNION SELECT employee_user_id FROM performance_results WHERE month=${sql(month)} AND kind='collaboration';`);
  return {month,canReview:mine.length>0,hasResponsibilities:state.handoffs.some(h=>h.to_user_id===user.userId)||[...state.plans.values(),...state.frozen.values()].some(p=>p.kind==='manager'&&p.expectedIds.includes(user.userId)),weights:{manager:30,peers:70},tasks:mine.map(p=>{const saved=state.scores.find(s=>s.month===month&&s.employee_user_id===p.employee.userId&&s.evaluator_user_id===user.userId);return {employeeUserId:p.employee.userId,name:p.employee.name,department:p.employee.department,score:saved?.score??null,comment:saved?.comment||'',submitted:Boolean(saved),locked:Boolean(saved)||published.some(r=>r.employee_user_id===p.employee.userId),frozen:Boolean(p.frozenAt),reports:evidence.filter(r=>r.employeeUserId===p.employee.userId&&r.month===month).map(r=>({id:r.id,start:r.start,end:r.end,facts:r.evidence,aiReference:r.candidate,status:r.status}))};})};
 }
 async function submit(user,body){
  const month=validMonth(body.month),value=Number(body.score),comment=String(body.comment||'').trim();
  if(body.score==null||body.score===''||!Number.isFinite(value)||value<0||value>100||!comment||comment.length>4000)throw Error('score_and_comment_required');
  if(body.employeeUserId===user.userId)throw Error('self_scoring_forbidden');
  let state=await snapshot(),plan=planFor(state,month,body.employeeUserId);
  if(!plan)throw Error('employee_not_employed');
  if(!state.people.get(body.employeeUserId)?.active)throw Error('employee_inactive');
  if(!state.people.get(user.userId)?.active||plan.kind!=='manager'||!plan.expectedIds.includes(user.userId))throw Error('not_your_subordinate');
  await freeze(month,body.employeeUserId,'manager');state=await snapshot();plan=planFor(state,month,body.employeeUserId);
  if(!state.people.get(body.employeeUserId)?.active)throw Error('employee_inactive');
  if(!plan)throw Error('employee_not_employed');
  if(!state.people.get(user.userId)?.active||!plan.expectedIds.includes(user.userId))throw Error('not_your_subordinate');
  const locked=await query(`SELECT 1 FROM monthly_manager_scores WHERE month=${sql(month)} AND employee_user_id=${sql(body.employeeUserId)} AND evaluator_user_id=${sql(user.userId)} UNION SELECT 1 FROM all_monthly_weighted_results WHERE month=${sql(month)} AND employee_user_id=${sql(body.employeeUserId)} UNION SELECT 1 FROM performance_results WHERE month=${sql(month)} AND employee_user_id=${sql(body.employeeUserId)} AND kind='collaboration';`);if(locked.length)throw Error('result_locked');
  const evidence={employee:plan.employee,evaluatorUserId:user.userId,evaluatorName:user.name,expectedIds:plan.expectedIds,weights:{manager:30,peers:70}};
  // Preserve frozen scopes and submitted history, but an account stopped while
  // this request was loading must not receive a new grade.
  await exec(`INSERT INTO monthly_manager_scores(month,employee_user_id,evaluator_user_id,score,comment,snapshot_json) SELECT ${sql(month)},${sql(body.employeeUserId)},${sql(user.userId)},${round(value)},${sql(comment)},${sql(JSON.stringify(evidence))} WHERE EXISTS(SELECT 1 FROM employees WHERE user_id=${sql(body.employeeUserId)} AND is_active=1) AND EXISTS(SELECT 1 FROM employees WHERE user_id=${sql(user.userId)} AND is_active=1);`);
  if(!(await query(`SELECT 1 FROM monthly_manager_scores WHERE month=${sql(month)} AND employee_user_id=${sql(body.employeeUserId)} AND evaluator_user_id=${sql(user.userId)};`)).length){
   if(!(await query(`SELECT 1 FROM employees WHERE user_id=${sql(body.employeeUserId)} AND is_active=1;`)).length)throw Error('employee_inactive');
   throw Error('not_your_subordinate');
  }
 }
 async function handoffOverview(month=monthNow()){
  validMonth(month);const state=await snapshot(),published=new Set((await query(`SELECT employee_user_id FROM all_monthly_weighted_results WHERE month=${sql(month)} UNION SELECT employee_user_id FROM performance_results WHERE month=${sql(month)} AND kind='collaboration';`)).map(r=>r.employee_user_id));
  const tasks=[...new Set([...state.plans.keys(),...frozenIds(state,month)])].map(id=>{const plan=planFor(state,month,id),p=progress(state,month,id);if(!plan||published.has(id)||!p.handoffRequired)return null;return {employeeUserId:id,name:plan.employee.name,department:plan.employee.department,pending:p.blockedIds.map(userId=>({userId,name:state.people.get(userId)?.name||state.departments.find(d=>d.leader_user_id===userId)?.leaderName||'身份待同步'})),submitted:p.submitted};}).filter(Boolean);
  return {month,tasks,candidates:state.eligibleManagers.map(e=>({userId:e.userId,name:e.name,department:e.department})),history:state.handoffs.filter(h=>h.month===month).slice(-50).reverse().map(h=>({...h,employeeName:state.people.get(h.employee_user_id)?.name||'姓名待同步',fromName:state.people.get(h.from_user_id)?.name||'姓名待同步',toName:state.people.get(h.to_user_id)?.name||'姓名待同步'}))};
 }
 async function handoff(body,actor){
  const month=validMonth(body.month),id=String(body.employeeUserId||''),from=String(body.fromUserId||''),to=String(body.toUserId||''),reason=String(body.reason||'').trim();
  if(!reason||reason.length>1000)throw Error('handoff_reason_required');
  const state=await snapshot(),plan=planFor(state,month,id),p=progress(state,month,id);
  if(!plan||plan.kind!=='manager'||!p.blockedIds.includes(from))throw Error('handoff_not_required');
  if(to===id||to===from||plan.expectedIds.includes(to)||!state.eligibleManagers.some(e=>e.userId===to))throw Error('invalid_handoff_manager');
  await freeze(month,id,'manager');
  await exec(`INSERT INTO monthly_manager_handoffs(id,month,employee_user_id,from_user_id,to_user_id,reason,actor_user_id,actor_name,created_at) VALUES(${sql(randomUUID())},${sql(month)},${sql(id)},${sql(from)},${sql(to)},${sql(reason)},${sql(actor.userId)},${sql(actor.name)},${sql(now().toISOString())});`);
  return handoffOverview(month);
 }
 async function freezeBossPlan(month,userId){validMonth(month);await freeze(month,userId,'boss');}
 const publishedForMonth=async month=>new Set((await query(`SELECT employee_user_id FROM all_monthly_weighted_results WHERE month=${sql(month)} UNION SELECT employee_user_id FROM performance_results WHERE month=${sql(month)} AND kind='collaboration';`)).map(row=>row.employee_user_id));
 function leaderTargetFor(state,month,leaderUserId,published){
  const current=state.departments.filter(d=>d.leader_user_id===leaderUserId),person=state.people.get(leaderUserId);
  const inactive=state.inactiveDepartments.filter(d=>d.leader_user_id===leaderUserId);
  const saved=state.bossPersonScores.find(score=>score.month===month&&score.leader_user_id===leaderUserId);
  const history=state.bossScores.filter(score=>score.month===month&&score.leader_user_id===leaderUserId);
  if(!current.length&&!inactive.length&&!saved&&!history.length)return undefined;
  const frozen=state.frozen.get(key(month,leaderUserId)),plan=planFor(state,month,leaderUserId),p=progress(state,month,leaderUserId);
  const legacyScore=!saved&&p.kind==='boss'&&p.complete?p.score:undefined;
  let unavailableReason='';
  if(saved||legacyScore!==undefined||published.has(leaderUserId))unavailableReason='result_locked';
  else if(!current.length&&inactive.length)unavailableReason='department_inactive';
  else if(!person)unavailableReason='leader_not_registered';
  else if(!person.active)unavailableReason='leader_inactive';
  else if(isBossUserId(leaderUserId))unavailableReason='boss_exempt';
  else if(!plan)unavailableReason='employee_not_employed';
  else if(plan.kind!=='boss'||!current.length)unavailableReason=frozen?'rating_scope_frozen':'not_required';
  const context=current.length?current:inactive;
  const departmentIds=[...new Set([...context.map(d=>d.id),...(saved&&frozen?.kind==='boss'?frozen.expectedIds:[]),...history.map(score=>score.department_id)])];
  return {leaderUserId,departmentIds,name:person?.name||context.find(d=>d.leaderName)?.leaderName||frozen?.employee?.name||'姓名待同步',active:person?.active===true,ratingRequired:!unavailableReason,unavailableReason,frozen:Boolean(frozen),...(legacyScore===undefined?{}:{legacyScore})};
 }
 async function leaderScoreTarget(month,leaderUserId){
  validMonth(month);const [state,published]=await Promise.all([snapshot(),publishedForMonth(month)]);
  return leaderTargetFor(state,month,leaderUserId,published);
 }
 async function bossTargets(month=monthNow(),organizationData){
  validMonth(month);const [state,published]=await Promise.all([snapshot(organizationData),publishedForMonth(month)]);
  const ids=new Set([...[...state.departments,...state.inactiveDepartments].map(d=>d.leader_user_id),...[...state.bossScores,...state.bossPersonScores].filter(score=>score.month===month).map(score=>score.leader_user_id)]);
  const leaderScoreTargets=[...ids].filter(Boolean).map(id=>leaderTargetFor(state,month,id,published));
  const leaderById=new Map(leaderScoreTargets.map(target=>[target.leaderUserId,target]));
  const savedIds=new Set(state.bossPersonScores.filter(score=>score.month===month).map(score=>score.leader_user_id));
  return {month,leaderScoreTargets,scoreTargets:state.departments.map(d=>{
   const leaderUserId=d.leader_user_id,person=state.people.get(leaderUserId),saved=state.bossScores.find(s=>s.month===month&&s.department_id===d.id&&s.leader_user_id===leaderUserId),plan=planFor(state,month,leaderUserId);
   const target=leaderById.get(leaderUserId),ratingRequired=target?.ratingRequired===true&&plan?.kind==='boss'&&plan.expectedIds.includes(d.id);
   const unavailableReason=!leaderUserId?'missing_leader':target?.unavailableReason||(!ratingRequired?(state.frozen.has(key(month,leaderUserId))?'rating_scope_frozen':'not_required'):'');
   return {departmentId:d.id,leaderUserId,name:leaderUserId?(person?.name||d.leaderName||'姓名待同步'):'负责人未设置',frozen:Boolean(saved)||savedIds.has(leaderUserId),ratingRequired,active:person?.active===true,unavailableReason};
  })};
 }
 async function bossTarget(month,id){return (await bossTargets(month)).scoreTargets.find(t=>t.departmentId===id);}
 return {snapshot,progress,tasks,submit,handoffOverview,handoff,freezeBossPlan,bossTargets,bossTarget,leaderScoreTarget};
}
