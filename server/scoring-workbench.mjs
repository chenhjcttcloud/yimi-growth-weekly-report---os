import {createHash,randomUUID} from 'node:crypto';
import {employedInMonth} from './employee-lifecycle.mjs';
import {monthlyScoringOpensAt,createMonthlyScoringWindow} from './monthly-scoring-window.mjs';
import {collaborationPolicy} from './collaboration-policy.mjs';

// Daily configuration is separate from the scoring engine. Changes are additive:
// unchecked ungraded relationships become inactive; responses and history stay.
export function createScoringWorkbench({query,exec,sql,setup,managerReviews,bossMembers=()=>[],now=()=>new Date(),ratingWindow=createMonthlyScoringWindow({query,sql,now})}){
 let busy=false;
 const current=()=>now().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 const previous=month=>{const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
 const collection=(table,columns,where='1',order=columns)=>`(SELECT json_group_array(json_object(${columns.split(',').flatMap(k=>[sql(k),k]).join(',')})) FROM (SELECT ${columns} FROM ${table} WHERE ${where} ORDER BY ${order}))`;
 function fingerprint(month){
  const months=`(${sql(month)},${sql(previous(month))})`,scope=`substr(start_date,1,7) IN ${months}`;
  return `json_object('people',${collection('employees','user_id,name,department,manager_user_id,is_active')},'periods',${collection('employee_employment_periods','id,employee_user_id,start_date,end_date')},'departments',${collection('organization_departments','id,name,leader_user_id')},'hierarchy',${collection('department_hierarchy','department_id,parent_id')},'layout',${collection('department_local_settings','department_id,is_active,leader_mode')},'departmentSyncStates',${collection('feishu_department_sync_states','department_id,state')},'roles',${collection('app_settings','key,value_json',"key IN('boss_view_members','scoring360_admin_members','business_boss_members')")},'cycles',${collection('scoring360_cycles','id,start_date,end_date,status,launch_at',scope)},'assignments',${collection('scoring360_assignments','id,cycle_id,evaluee_user_id,evaluator_user_id,status',`cycle_id IN(SELECT id FROM scoring360_cycles WHERE ${scope})`)},'responses',${collection('scoring360_responses','id,assignment_id,score,comment',`cycle_id IN(SELECT id FROM scoring360_cycles WHERE ${scope})`)},'published',${collection('all_collaboration_results','month,employee_user_id,kind',`month=${sql(month)}`)},'legacy',${collection('performance_results','month,employee_user_id,kind',`month=${sql(month)} AND kind='collaboration'`)},'plans',${collection('monthly_review_plans','month,employee_user_id,plan_json',`month=${sql(month)}`)},'handoffs',${collection('monthly_manager_handoffs','id,month,employee_user_id,from_user_id,to_user_id',`month=${sql(month)}`)})`;
 }
 async function signature(month){return (await query(`SELECT ${fingerprint(month)} AS value;`))[0].value;}
 async function overview(month=current()){
  // Existing setup validates both viewing and editing month boundaries.
  for(let attempt=0;attempt<3;attempt++){
   const managerial=await managerReviews.snapshot(),before=await signatureChecked(month),base=await setup.overview(month);
   const allPeople=await query('SELECT user_id,name,department,is_active FROM employees;'),peopleById=new Map(allPeople.map(e=>[e.user_id,e]));
   const periods=await query('SELECT * FROM employee_employment_periods;');
   const targets=base.targets.filter(e=>{const own=periods.filter(p=>p.employee_user_id===e.userId);return !own.length||employedInMonth(own,month);});
   const assignments=base.cycle?await query(`SELECT a.id,a.evaluee_user_id,a.evaluator_user_id,a.evaluee_name,a.evaluator_name,a.status,r.id AS response_id FROM scoring360_assignments a LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE a.cycle_id=${sql(base.cycle.id)} AND (COALESCE(a.status,'active')='active' OR r.id IS NOT NULL) ORDER BY a.id;`):[];
   const published=new Set((await query(`SELECT employee_user_id FROM all_collaboration_results WHERE month=${sql(month)} UNION SELECT employee_user_id FROM performance_results WHERE month=${sql(month)} AND kind='collaboration';`)).map(r=>r.employee_user_id));
   const existingActive=assignments.filter(a=>a.status==='active');
   const historicalOpenReason=month>=current()?'historical_month_required':!base.cycle?'historical_cycle_required':base.cycle.status!=='draft'||base.cycle.launch_at?'historical_draft_required':published.size?'result_locked':!existingActive.length?'scoring_assignments_required':existingActive.some(a=>!(base.raters||base.people).some(p=>p.userId===a.evaluator_user_id)||a.evaluee_user_id===a.evaluator_user_id||Number(peopleById.get(a.evaluee_user_id)?.is_active)!==1||Number(peopleById.get(a.evaluator_user_id)?.is_active)!==1||(()=>{const own=periods.filter(p=>p.employee_user_id===a.evaluee_user_id);return own.length&&!employedInMonth(own,month);})())?'historical_assignment_invalid':'';
   const policy=collaborationPolicy(month),peerOnly=policy.rule==='peers_100',bosses=bossMembers(),raters=base.raters||base.people,eligibleRaters=new Set(raters.map(p=>p.userId));
   const rows=targets.map(employee=>{
    const links=assignments.filter(a=>a.evaluee_user_id===employee.userId).map(a=>({...a,evaluator_name:peopleById.get(a.evaluator_user_id)?.name||a.evaluator_name,department:peopleById.get(a.evaluator_user_id)?.department||'',active:Number(peopleById.get(a.evaluator_user_id)?.is_active)===1,submitted:Boolean(a.response_id)}));
    const manager=managerReviews.progress(managerial,month,employee.userId),issues=[],locked=published.has(employee.userId);
    const reviewers=manager.kind==='boss'?bosses.map(b=>({userId:b.userId,name:peopleById.get(b.userId)?.name||b.name||'老板',active:Number(peopleById.get(b.userId)?.is_active)===1})):manager.expectedIds.map(id=>({userId:id,name:peopleById.get(id)?.name||'身份待同步',active:Number(peopleById.get(id)?.is_active)===1}));
    if(!locked){
     if(!links.length)issues.push({type:'peers',label:'尚未选择同事评分人'});
     if(!peerOnly&&manager.blockedDepartmentIds?.length)issues.push({type:'department',label:'本月已锁定的部门已从飞书移除，评分范围待核查',href:'/?page=settings&settingsTab=organization'});
     if(links.some(a=>a.evaluee_user_id===a.evaluator_user_id))issues.push({type:'self',label:'存在自评关系，需要核实'});
     if(links.some(a=>!eligibleRaters.has(a.evaluator_user_id)&&a.active&&!a.submitted))issues.push({type:'bossPeer',label:peerOnly?'老板不参加同事互评，未提交的老板互评关系待调整':'老板只负责30%评分，未提交的老板互评关系待调整'});
     if(links.some(a=>!a.active&&!a.submitted))issues.push({type:'inactive',label:'未评分人员已停用或身份缺失'});
     if(!peerOnly&&!manager.complete&&(!manager.expectedIds.length||!reviewers.length||(manager.kind==='boss'?!reviewers.some(p=>p.active):reviewers.some(p=>!p.active))))issues.push({type:'manager',label:manager.kind==='boss'?'老板评分身份待配置或同步':'负责人身份或评分责任待处理',href:manager.kind==='boss'?'/?page=settings&settingsTab=permissions':!manager.expectedIds.length?'/?page=settings&settingsTab=organization':'/?page=settings&settingsTab=handoffs'});
    }
    return {...employee,collaborationPolicy:policy,assignments:links,locked,configured:links.length>0||locked,submitted:links.filter(a=>a.submitted).length,manager:peerOnly?{kind:'none',required:false,reviewers:[],complete:true,frozen:false,expected:0,reviewUrl:''}:{kind:manager.kind,required:true,reviewers,complete:manager.complete,frozen:manager.frozen===true,expected:manager.expectedIds.length,reviewUrl:manager.kind==='boss'?'/?page=settings&settingsTab=permissions':!manager.expectedIds.length?'/?page=settings&settingsTab=organization':'/?page=settings&settingsTab=handoffs'},issues};
   }).sort((a,b)=>Number(a.configured)-Number(b.configured)||a.name.localeCompare(b.name,'zh-CN'));
   const prior=await setup.overview(previous(month)),byTarget=new Map(rows.map(r=>[r.userId,r])),active=new Map(raters.map(p=>[p.userId,p])),pairs=[],skipped={alreadyConfigured:0,inactive:0,self:0,duplicate:0};
   const seen=new Set();
   for(const link of prior.assignments){
    const row=byTarget.get(link.evaluee_user_id),pair={evalueeUserId:link.evaluee_user_id,evaluatorUserId:link.evaluator_user_id},key=JSON.stringify(pair);
    if(!row||!active.has(pair.evaluatorUserId)){skipped.inactive++;continue;}
    if(row.configured){skipped.alreadyConfigured++;continue;}
    if(pair.evalueeUserId===pair.evaluatorUserId){skipped.self++;continue;}
    if(seen.has(key)){skipped.duplicate++;continue;}seen.add(key);pairs.push(pair);
   }
   const after=await signature(month);if(before!==after)continue;
   const copyGroups=rows.filter(r=>pairs.some(p=>p.evalueeUserId===r.userId)).map(r=>({employee:r,raters:pairs.filter(p=>p.evalueeUserId===r.userId).map(p=>active.get(p.evaluatorUserId))}));
   return {month,collaborationPolicy:policy,cycle:base.cycle,reviewWindow:await ratingWindow.status(month),editable:base.editable,canOpenHistorical:!historicalOpenReason,historicalOpenReason,people:raters,excludedPeerRaterIds:base.people.filter(p=>!eligibleRaters.has(p.userId)).map(p=>p.userId),rows,revision:createHash('sha256').update(before).digest('hex'),counts:{total:rows.length,configured:rows.filter(r=>r.configured).length,pending:rows.filter(r=>!r.configured).length,issues:rows.filter(r=>r.issues.some(i=>i.type!=='peers')).length,ready:rows.filter(r=>!r.issues.length).length},checks:rows.flatMap(r=>r.issues.map(i=>({...i,userId:r.userId,name:r.name}))),copy:{sourceMonth:previous(month),sourceCount:prior.assignments.length,pairs,groups:copyGroups,skipped},_signature:before};
  }
  throw Error('setup_changed');
 }
 async function signatureChecked(month){await setup.overview(month);return signature(month);}
 const publicState=state=>{const {_signature,...visible}=state;return visible;};
 function revision(state,body){if(!state.editable)throw Error('editable_month_required');if(body.revision!==state.revision)throw Error('setup_changed');}
 function ids(value){if(!Array.isArray(value)||value.length>100||value.some(v=>typeof v!=='string'||!v))throw Error('invalid_selection');return [...new Set(value)];}
 function cycleId(state){return state.cycle?.id||state.month+'-360';}
 function startCycle(state,guard){const end=new Date(Date.UTC(Number(state.month.slice(0,4)),Number(state.month.slice(5)),0)).toISOString().slice(0,10);return `INSERT INTO scoring360_cycles(id,label,mode,start_date,end_date,status) SELECT ${sql(cycleId(state))},${sql(state.month+' 月同事互评')},'monthly',${sql(state.month+'-01')},${sql(end)},'draft' WHERE ${guard} ON CONFLICT(id) DO NOTHING;`;}
 function addLink(state,pair,guard){const a=state.rows.find(r=>r.userId===pair.evalueeUserId),b=state.people.find(r=>r.userId===pair.evaluatorUserId);if(state.excludedPeerRaterIds.includes(pair.evaluatorUserId))throw Error('boss_peer_forbidden');if(!a||!b)throw Error('active_employee_required');if(a.locked)throw Error('result_locked');if(a.userId===b.userId)throw Error('self_scoring_forbidden');return `INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id,status) SELECT ${sql(randomUUID())},${sql(cycleId(state))},${sql(a.name)},${sql(b.name)},${sql(a.userId)},${sql(b.userId)},'active' WHERE ${guard} ON CONFLICT(cycle_id,evaluee_user_id,evaluator_user_id) DO UPDATE SET status='active',updated_at=datetime('now') WHERE NOT EXISTS(SELECT 1 FROM scoring360_responses r WHERE r.assignment_id=scoring360_assignments.id);`;}
 async function commit(state,actor,action,build,details,extraGuard='1'){
  const id=randomUUID(),guard=`EXISTS(SELECT 1 FROM system_operation_logs WHERE id=${sql(id)})`,statements=build(guard);
  await exec(`BEGIN IMMEDIATE; INSERT INTO system_operation_logs(id,actor_user_id,actor_name,action,details_json,created_at) SELECT ${sql(id)},${sql(actor.userId)},${sql(actor.name)},${sql(action)},${sql(JSON.stringify({month:state.month,...details}))},${sql(now().toISOString())} WHERE (${fingerprint(state.month)})=${sql(state._signature)} AND (${extraGuard});${statements.join('\n')}COMMIT;`);
  if(!(await query(`SELECT id FROM system_operation_logs WHERE id=${sql(id)};`)).length)throw Error('setup_changed');
 }
 async function mutate(body,actor){
  if(busy)throw Error('setup_busy');busy=true;
  try{
   const state=await overview(body.month);let saved=0;
   if(body.action==='openHistorical'){
    if(body.confirmed!==true)throw Error('historical_confirmation_required');
    if(body.revision!==state.revision)throw Error('setup_changed');
    if(!state.canOpenHistorical)throw Error(state.historicalOpenReason);
    if(body.cycleId!==state.cycle.id)throw Error('setup_changed');
    const guard=`EXISTS(SELECT 1 FROM scoring360_cycles WHERE id=${sql(state.cycle.id)} AND substr(start_date,1,7)=${sql(state.month)} AND status='draft' AND NULLIF(launch_at,'') IS NULL) AND EXISTS(SELECT 1 FROM scoring360_assignments WHERE cycle_id=${sql(state.cycle.id)} AND status='active') AND NOT EXISTS(SELECT 1 FROM all_collaboration_results WHERE month=${sql(state.month)}) AND NOT EXISTS(SELECT 1 FROM performance_results WHERE month=${sql(state.month)} AND kind='collaboration')`;
    await commit(state,actor,'月度配评：历史草稿开放补评',owned=>[`UPDATE scoring360_cycles SET status='open',launch_at=${sql(now().toISOString())},updated_at=datetime('now') WHERE id=${sql(state.cycle.id)} AND ${owned} AND (${guard});`],{cycleId:state.cycle.id,previousStatus:'draft',status:'open',existingRelationshipsOnly:true,messagesSent:0},guard);
    return {...publicState(await overview(state.month)),saved:0,messagesSent:0};
   }
   revision(state,body);
   if(body.action==='saveEmployee'){
    const row=state.rows.find(r=>r.userId===body.employeeUserId),chosen=ids(body.evaluatorUserIds);if(!row)throw Error('active_employee_required');if(row.locked)throw Error('result_locked');
    const fixed=row.assignments.filter(a=>a.submitted);if(fixed.some(a=>!chosen.includes(a.evaluator_user_id)))throw Error('submitted_relationship_locked');
    if(chosen.includes(row.userId))throw Error('self_scoring_forbidden');
    if(chosen.some(id=>state.excludedPeerRaterIds.includes(id)&&!fixed.some(a=>a.evaluator_user_id===id)))throw Error('boss_peer_forbidden');
    const additions=chosen.filter(id=>!row.assignments.some(a=>a.evaluator_user_id===id));
    for(const id of additions)if(!state.people.some(p=>p.userId===id))throw Error('active_employee_required');
    const inactive=row.assignments.filter(a=>!a.submitted&&!chosen.includes(a.evaluator_user_id));
    saved=additions.length;
    await commit(state,actor,'月度配评：保存员工评分关系',guard=>[...(chosen.length?[startCycle(state,guard)]:[]),...inactive.map(a=>`UPDATE scoring360_assignments SET status='inactive',updated_at=datetime('now') WHERE id=${sql(a.id)} AND ${guard};`),...additions.map(id=>addLink(state,{evalueeUserId:row.userId,evaluatorUserId:id},guard))],{employeeUserId:row.userId,evaluatorUserIds:chosen,deactivated:inactive.length,added:additions.length});
   }else if(body.action==='batch'||body.action==='copyPrevious'){
    let pairs;
    if(body.action==='copyPrevious')pairs=state.copy.pairs;
    else {const targets=ids(body.employeeUserIds),raters=ids(body.evaluatorUserIds);if(!targets.length||!raters.length)throw Error('invalid_selection');if(targets.some(id=>!state.rows.some(row=>row.userId===id)))throw Error('active_employee_required');pairs=targets.flatMap(evalueeUserId=>raters.filter(id=>id!==evalueeUserId).map(evaluatorUserId=>({evalueeUserId,evaluatorUserId})));}
    pairs=pairs.filter(p=>!state.rows.find(r=>r.userId===p.evalueeUserId)?.assignments.some(a=>a.evaluator_user_id===p.evaluatorUserId));
    if(!pairs.length)throw Error('no_new_relationships');if(pairs.length>500)throw Error('too_many_relationships');saved=pairs.length;
    await commit(state,actor,body.action==='batch'?'月度配评：批量追加关系':'月度配评：沿用上月待配置关系',guard=>[startCycle(state,guard),...pairs.map(p=>addLink(state,p,guard))],{added:pairs.length,sourceMonth:body.action==='copyPrevious'?state.copy.sourceMonth:undefined});
   }else if(body.action==='launch'){
    if(state.checks.length||!state.rows.length||!state.cycle)throw Error('setup_incomplete');
    if(!['open','active','scheduled'].includes(state.cycle.status)){
     const opensAt=monthlyScoringOpensAt(state.month),scheduled=now().getTime()<Date.parse(opensAt);await commit(state,actor,'月度配评：检查并开放',guard=>[`UPDATE scoring360_cycles SET status=${sql(scheduled?'scheduled':'open')},launch_at=${sql(scheduled?opensAt:now().toISOString())},updated_at=datetime('now') WHERE id=${sql(state.cycle.id)} AND ${guard};`],{scheduled,opensAt});
    }
   }else throw Error('invalid_setup_action');
   return {...publicState(await overview(state.month)),saved,messagesSent:0};
  }finally{busy=false;}
 }
 async function activateDue(){
  const month=current();
  if(now().getTime()<Date.parse(monthlyScoringOpensAt(month)))return {skipped:'before_window'};
  if(busy)return {skipped:'running'};
  busy=true;
  try{
   const cycle=(await query(`SELECT id,status,launch_at FROM scoring360_cycles WHERE substr(start_date,1,7)=${sql(month)} ORDER BY CASE WHEN id=${sql(month+'-360')} THEN 0 ELSE 1 END,created_at DESC LIMIT 1;`))[0];
   if(!cycle||!['draft','scheduled'].includes(cycle.status))return {skipped:'no_pending_cycle'};
   if(cycle.status==='scheduled'&&cycle.launch_at&&Date.parse(cycle.launch_at)>now().getTime())return {skipped:'not_due'};
   const state=await overview(month);
   if(!state.cycle||state.cycle.id!==cycle.id||!['draft','scheduled'].includes(state.cycle.status))return {skipped:'changed'};
   if(state.checks.length||!state.rows.length)return {skipped:'setup_incomplete',issues:state.checks};
   await commit(state,{userId:'system',name:'系统自动开放'},'月度配评：最后一周自动开放',guard=>[`UPDATE scoring360_cycles SET status='open',launch_at=${sql(now().toISOString())},updated_at=datetime('now') WHERE id=${sql(cycle.id)} AND ${guard};`],{opensAt:monthlyScoringOpensAt(month),messagesSent:0});
   return {month,cycleId:cycle.id,status:'open',messagesSent:0};
  }finally{busy=false;}
 }
 return {overview:async month=>publicState(await overview(month)),mutate,activateDue};
}
