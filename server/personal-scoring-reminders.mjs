import {randomUUID} from 'node:crypto';
import {employedInMonth} from './employee-lifecycle.mjs';
export function createPersonalScoringReminders({query,exec,sql,enabled,deliver,policyFor,managerReviews,bossUserIds=()=>[],now=()=>Date.now()}) {
 const inflight=new Set();
 const isEnabled=async month=>Boolean(typeof enabled==='function'?await enabled(month):enabled);
 const rules=async month=>{const p=policyFor?await policyFor(month):{};return {waitHours:p.reminderWaitHours||24,cooldownHours:p.reminderCooldownHours||24};};
 const timestamp=value=>Date.parse(String(value||'').replace(' ','T')+(/(?:Z|[+-]\d\d:\d\d)$/.test(value||'')?'':'Z'));
 async function details(user,month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('invalid_month');
  const {waitHours,cooldownHours}=await rules(month),waitMs=waitHours*3600000,cooldownMs=cooldownHours*3600000;
  const periods=await query(`SELECT * FROM employee_employment_periods WHERE employee_user_id=${sql(user.userId)};`);
  const roster=new Map((await query('SELECT user_id,is_active FROM employees;')).map(e=>[e.user_id,Number(e.is_active)===1])),bosses=new Set(bossUserIds());
  const active=id=>id!==user.userId&&(roster.has(id)?roster.get(id):bosses.has(id));
  if(periods.length&&!employedInMonth(periods,month))return {assignments:[],pending:[],aged:[],eligible:[],sends:[],handoffRequired:false};
  let handoffRequired=false;
  const assignments=await query(`SELECT a.id,a.evaluator_user_id,a.evaluator_name,a.created_at,c.launch_at,c.status,c.created_at AS cycle_created_at,r.score,r.comment FROM scoring360_assignments a JOIN scoring360_cycles c ON c.id=a.cycle_id LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE substr(c.start_date,1,7)=${sql(month)} AND a.evaluee_user_id=${sql(user.userId)} AND (COALESCE(a.status,'active')='active' OR r.id IS NOT NULL);`);
  if(managerReviews){
   const state=await managerReviews.snapshot(),manager=managerReviews.progress(state,month,user.userId);
   const missing=manager.expectedIds.filter(id=>!manager.records?.some(r=>(manager.kind==='boss'?r.department_id:r.evaluator_user_id)===id));
   handoffRequired=manager.handoffRequired===true;
   const recipients=manager.kind==='boss'?(missing.length?bossUserIds():[]):missing;
   for(const id of new Set(recipients))assignments.push({id:'manager:'+id,evaluator_user_id:id,score:'',comment:'',created_at:manager.taskStartById?.[id]||manager.taskStartedAt||month+'-01T00:00:00Z',launch_at:manager.taskStartById?.[id]||manager.taskStartedAt||month+'-01T00:00:00Z',status:'active'});
   const published=await query(`SELECT 1 FROM all_monthly_weighted_results WHERE month=${sql(month)} AND employee_user_id=${sql(user.userId)} UNION SELECT 1 FROM performance_results WHERE month=${sql(month)} AND employee_user_id=${sql(user.userId)} AND kind='collaboration';`);
   if(published.length)return {assignments,pending:[],aged:[],eligible:[],sends:[],handoffRequired:false};
  }
  const pending=assignments.filter(a=>a.score===''||!String(a.comment||'').trim());
  const aged=pending.filter(a=>active(a.evaluator_user_id)&&['open','active'].includes(a.status)&&now()-Math.max(timestamp(a.launch_at||a.cycle_created_at)||now(),timestamp(a.created_at)||0)>=waitMs);
  const sends=await query(`SELECT recipient_user_id,created_at,status FROM personal_scoring_reminders WHERE requester_user_id=${sql(user.userId)} AND month=${sql(month)} AND status IN ('pending','sent','uncertain','failed');`);
  const eligible=aged.filter(a=>a.evaluator_user_id&&!sends.some(s=>s.recipient_user_id===a.evaluator_user_id&&now()-timestamp(s.created_at)<cooldownMs));
  return {assignments,pending,aged,eligible,sends,handoffRequired,cooldownMs};
 }
 async function status(user,month){const d=await details(user,month);return {expected:d.assignments.length,submitted:d.assignments.length-d.pending.length,pending:d.pending.length,complete:!!d.assignments.length&&!d.pending.length,canRemind:!!d.eligible.length,reminderEnabled:await isEnabled(month),eligibleCount:new Set(d.eligible.map(a=>a.evaluator_user_id)).size,...await rules(month),handoffRequired:d.handoffRequired,reason:!d.pending.length?'complete':d.eligible.length?'ready':d.sends?.some(s=>['uncertain','failed'].includes(s.status)&&now()-timestamp(s.created_at)<(d.cooldownMs||86400000))?'uncertain':d.handoffRequired?'handoff':d.aged.some(a=>!a.evaluator_user_id)?'missing_identity':d.aged.length?'cooldown':'waiting'};}
 async function send(user,month){
  const key=`${user.userId}:${month}`;if(inflight.has(key))throw Error('reminder_in_progress');inflight.add(key);
  try {
   const {cooldownHours}=await rules(month),cooldownMs=cooldownHours*3600000;
   const d=await details(user,month);if(!d.eligible.length)throw Error('reminder_not_due');
   const recipients=[...new Set(d.eligible.map(a=>a.evaluator_user_id))];
   if(!await isEnabled(month))return {dryRun:true,sent:0,recipientCount:recipients.length,failed:0};
   let sent=0,failed=0;
   for(const recipient of recipients){
    // Reserve in SQLite as well as memory so simultaneous requests cannot double-send.
    const id=randomUUID(),created=new Date(now()).toISOString(),cutoff=new Date(now()-cooldownMs).toISOString();
    await exec(`INSERT INTO personal_scoring_reminders(id,requester_user_id,month,recipient_user_id,status,created_at) SELECT ${sql(id)},${sql(user.userId)},${sql(month)},${sql(recipient)},'pending',${sql(created)} WHERE NOT EXISTS(SELECT 1 FROM personal_scoring_reminders WHERE requester_user_id=${sql(user.userId)} AND month=${sql(month)} AND recipient_user_id=${sql(recipient)} AND status IN ('pending','sent','uncertain','failed') AND julianday(created_at)>julianday(${sql(cutoff)}));`);
    if(!(await query(`SELECT id FROM personal_scoring_reminders WHERE id=${sql(id)};`)).length)continue;
    let delivered=false;
    try {
     // Recheck after reserving: do not notify a rater who completed in the meantime.
     const current=await details(user,month);
     if(!await isEnabled(month)||!current.aged.some(a=>a.evaluator_user_id===recipient)){await exec(`UPDATE personal_scoring_reminders SET status='cancelled' WHERE id=${sql(id)};`);continue;}
     const text=`【成长 OS 协作评分提醒】${user.name}提醒你：${month} 月对其的月度评分尚未完成，请登录成长 OS 的「评分工作台」提交分数和评价。负责人或老板占30%，同事互评占70%；全部完成后系统自动公布最终分。`;
     const messageId=await deliver(recipient,text,id);if(!messageId)throw Error('missing_message_id');delivered=true;
     await exec(`UPDATE personal_scoring_reminders SET status='sent',message_id=${sql(messageId||'')} WHERE id=${sql(id)};`);sent++;
    }catch(error){const status=!delivered&&error.retryable===false?'rejected':'uncertain';await exec(`UPDATE personal_scoring_reminders SET status=${sql(status)} WHERE id=${sql(id)};`);failed++;}
   }
   return {dryRun:false,sent,failed,recipientCount:recipients.length};
  }finally{inflight.delete(key);}
 }
 return {status,send};
}
