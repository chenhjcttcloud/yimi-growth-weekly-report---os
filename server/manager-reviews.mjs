const round=value=>Math.round(value*10)/10;
const average=values=>values.length?round(values.reduce((sum,value)=>sum+Number(value),0)/values.length):null;
export function createManagerReviews({query,exec,sql,organization,reports,isBossUserId=()=>false,now=()=>new Date()}){
 const monthNow=()=>now().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 const validMonth=month=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||month>monthNow())throw Error('invalid_month');return month;};
 async function snapshot(){
  const data=await organization(),departments=data.departments.filter(d=>d.is_active!==0),byId=new Map(departments.map(d=>[d.id,d]));
  const plans=new Map();
  for(const employee of data.employees){
   if(isBossUserId(employee.userId))continue;
   const led=departments.filter(d=>d.leader_user_id===employee.userId);
   const managers=new Map();
   if(!led.length){
    if(employee.managerUserId&&employee.managerUserId!==employee.userId)managers.set(employee.managerUserId,{userId:employee.managerUserId,departments:[]});
    else for(const direct of employee.directDepartmentIds||[]){
     const visited=new Set();let cursor=direct;
     while(cursor&&!visited.has(cursor)){visited.add(cursor);const d=byId.get(cursor);if(!d)break;if(d.leader_user_id&&d.leader_user_id!==employee.userId){const entry=managers.get(d.leader_user_id)||{userId:d.leader_user_id,departments:[]};entry.departments.push(d.id);managers.set(d.leader_user_id,entry);break;}cursor=d.parent_id;}
    }
   }
   plans.set(employee.userId,{employee,kind:led.length?'boss':'manager',expectedIds:led.length?led.map(d=>d.id):[...managers.keys()],managers:[...managers.values()]});
  }
  return {plans,scores:await query('SELECT * FROM monthly_manager_scores;'),bossScores:data.scores};
 }
 function progress(state,month,userId){
  const plan=state.plans.get(userId);if(!plan)return {kind:'unassigned',expectedIds:[],expected:0,submitted:0,complete:false,score:null};
  const records=plan.kind==='boss'?state.bossScores.filter(s=>s.month===month&&s.leader_user_id===userId&&plan.expectedIds.includes(s.department_id)):state.scores.filter(s=>s.month===month&&s.employee_user_id===userId&&plan.expectedIds.includes(s.evaluator_user_id));
  const complete=plan.expectedIds.length>0&&records.length===plan.expectedIds.length;
  return {kind:plan.kind,expectedIds:plan.expectedIds,expected:plan.expectedIds.length,submitted:records.length,complete,score:complete?average(records.map(r=>r.score)):null,records};
 }
 async function tasks(user,month){
  month=validMonth(month||monthNow());const state=await snapshot();const mine=[...state.plans.values()].filter(p=>p.kind==='manager'&&p.expectedIds.includes(user.userId));
  const ids=new Set(mine.map(p=>p.employee.userId)),evidence=ids.size&&reports?await reports():[];
  const published=await query(`SELECT employee_user_id FROM monthly_weighted_results WHERE month=${sql(month)} UNION SELECT employee_user_id FROM performance_results WHERE month=${sql(month)} AND kind='collaboration';`);
  return {month,canReview:mine.length>0,weights:{manager:30,peers:70},tasks:mine.map(p=>{const saved=state.scores.find(s=>s.month===month&&s.employee_user_id===p.employee.userId&&s.evaluator_user_id===user.userId);return {employeeUserId:p.employee.userId,name:p.employee.name,department:p.employee.department,score:saved?.score??null,comment:saved?.comment||'',submitted:Boolean(saved),locked:Boolean(saved)||published.some(r=>r.employee_user_id===p.employee.userId),reports:evidence.filter(r=>r.employeeUserId===p.employee.userId&&r.month===month).map(r=>({id:r.id,start:r.start,end:r.end,facts:r.evidence,aiReference:r.candidate,status:r.status}))};})};
 }
 async function submit(user,body){
  const month=validMonth(body.month),value=Number(body.score),comment=String(body.comment||'').trim();
  if(body.score==null||body.score===''||!Number.isFinite(value)||value<0||value>100||!comment||comment.length>4000)throw Error('score_and_comment_required');
  if(body.employeeUserId===user.userId)throw Error('self_scoring_forbidden');
  const state=await snapshot(),plan=state.plans.get(body.employeeUserId);
  if(!plan||plan.kind!=='manager'||!plan.expectedIds.includes(user.userId))throw Error('not_your_subordinate');
  const locked=await query(`SELECT 1 FROM monthly_manager_scores WHERE month=${sql(month)} AND employee_user_id=${sql(body.employeeUserId)} AND evaluator_user_id=${sql(user.userId)} UNION SELECT 1 FROM monthly_weighted_results WHERE month=${sql(month)} AND employee_user_id=${sql(body.employeeUserId)} UNION SELECT 1 FROM performance_results WHERE month=${sql(month)} AND employee_user_id=${sql(body.employeeUserId)} AND kind='collaboration';`);if(locked.length)throw Error('result_locked');
  const evidence={employee:plan.employee,evaluatorUserId:user.userId,evaluatorName:user.name,expectedIds:plan.expectedIds,weights:{manager:30,peers:70}};
  await exec(`INSERT INTO monthly_manager_scores(month,employee_user_id,evaluator_user_id,score,comment,snapshot_json) VALUES(${sql(month)},${sql(body.employeeUserId)},${sql(user.userId)},${round(value)},${sql(comment)},${sql(JSON.stringify(evidence))});`);
 }
 return {snapshot,progress,tasks,submit};
}
