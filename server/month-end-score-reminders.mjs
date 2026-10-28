import {createHash, randomUUID} from 'node:crypto';

export function shanghaiClock(date) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,month:`${parts.year}-${parts.month}`,time:`${parts.hour}:${parts.minute}`};
}
export function lastTwoWorkingDays(month,calendar={}) {
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('invalid_month');
 const [year,m]=month.split('-').map(Number),holidays=new Set(calendar.holidayDates||[]),overrides=new Set(calendar.workdayOverrides||[]),dates=[];
 for(let day=new Date(Date.UTC(year,m,0)).getUTCDate();day>0&&dates.length<2;day--){
  const date=`${month}-${String(day).padStart(2,'0')}`,weekday=new Date(date+'T00:00:00Z').getUTCDay();
  if(overrides.has(date)||!holidays.has(date)&&weekday!==0&&weekday!==6)dates.unshift(date);
 }
 return dates;
}

// Only the scheduler calls tick. Preview never reserves a delivery or sends a message.
export function createMonthEndScoreReminders({query,exec,sql,managerReviews,bossMembers=()=>[],getSettings,calendar=()=>({}),deliver,baseUrl,now=()=>new Date()}) {
 let running=false;
 const validMonth=month=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('invalid_month');return month;};
 async function pending(month) {
  validMonth(month);
  const people=await query('SELECT user_id,name,is_active FROM employees;'),byId=new Map(people.map(p=>[p.user_id,p]));
  const active=id=>!!id&&Number(byId.get(id)?.is_active)===1;
  const published=new Set((await query(`SELECT employee_user_id FROM monthly_weighted_results WHERE month=${sql(month)} UNION SELECT employee_user_id FROM performance_results WHERE month=${sql(month)} AND kind='collaboration';`)).map(p=>p.employee_user_id));
  const groups=new Map();
  function add(id,kind,key,name='') {
   if(!id||byId.has(id)&&!active(id))return;
   if(!groups.has(id))groups.set(id,{userId:id,name:byId.get(id)?.name||name||id,peer:[],manager:[],boss:[]});
   const list=groups.get(id)[kind];if(!list.includes(key))list.push(key);
  }
  const assignments=await query(`SELECT a.id,a.evaluee_user_id,a.evaluator_user_id FROM scoring360_assignments a JOIN scoring360_cycles c ON c.id=a.cycle_id LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE substr(c.start_date,1,7)=${sql(month)} AND c.status IN ('open','active') AND COALESCE(c.launch_at,'')<>'' AND COALESCE(a.status,'active')='active' AND (r.id IS NULL OR r.score IS NULL OR r.score<0 OR r.score>100 OR trim(COALESCE(r.comment,''))='');`);
  for(const a of assignments)if(active(a.evaluee_user_id)&&active(a.evaluator_user_id)&&a.evaluee_user_id!==a.evaluator_user_id&&!published.has(a.evaluee_user_id))add(a.evaluator_user_id,'peer',a.id);
  const state=await managerReviews.snapshot();
  const bosses=await bossMembers();
  for(const [id,plan] of state.plans){
   if(!active(id)||published.has(id))continue;
   const progress=managerReviews.progress(state,month,id);
   for(const expected of progress.expectedIds){
    if(progress.records?.some(r=>(plan.kind==='boss'?r.department_id:r.evaluator_user_id)===expected))continue;
    if(plan.kind==='boss'){
     for(const boss of bosses)if(boss.userId!==id)add(boss.userId,'boss',`${id}:${expected}`,boss.name);
    }else if(active(expected))add(expected,'manager',id);
   }
  }
  return [...groups.values()].map(g=>({...g,counts:{peer:g.peer.length,manager:g.manager.length,boss:g.boss.length},total:g.peer.length+g.manager.length+g.boss.length})).sort((a,b)=>a.userId.localeCompare(b.userId));
 }
 async function preview(month) {
  const settings=await getSettings(),currentMonth=shanghaiClock(now()).month;
  month=month||[currentMonth,settings.startMonth||''].sort().at(-1);
  validMonth(month);
  const cal=calendar(),dates=lastTwoWorkingDays(month,cal),recipients=await pending(month);
  const year=Number(month.slice(0,4)),calendarCovered=Number(cal.year)===year||(cal.years||[]).includes(year);
  const deliveries=await query(`SELECT reminder_date,recipient_user_id,recipient_name,status,attempts,message_id,last_error,sent_at,updated_at FROM monthly_score_reminder_deliveries WHERE month=${sql(month)} ORDER BY reminder_date DESC,recipient_user_id;`);
  return {month,settings,activeInMonth:!settings.startMonth||month>=settings.startMonth,dates,timezone:'Asia/Shanghai',calendarCovered,calendarSource:cal.source||'',calendarUpdate:cal.automaticUpdate||null,calendarWarning:calendarCovered?'':cal.autoManaged?`${year} 年完整节假日与调休安排尚未取得，系统会自动重试；以下日期为周一至周五估算，取得日历前暂停当年自动评分提醒。`:`${year} 年节假日与调休表尚未维护，当前按周一至周五计算工作日。`,recipients:recipients.map(({peer,manager,boss,...rest})=>rest),deliveries};
 }
 function message(recipient,clock,dates) {
  const lines=[`【成长 OS 月度评分提醒】${recipient.name}，你还有 ${clock.month} 月评分未完成。`];
  if(recipient.counts.peer)lines.push(`同事互评：${recipient.counts.peer} 项待评（占最终分70%）。`);
  if(recipient.counts.manager)lines.push(`下属月度评分：${recipient.counts.manager} 项待评（占最终分30%）。`);
  if(recipient.counts.boss)lines.push(`部门负责人评分：${recipient.counts.boss} 项待评（占最终分30%）。`);
  lines.push('请提交分数和评价；所有必需评分完成后，系统自动合成发布最终分。',`本月最后两个工作日为 ${dates.join('、')}，每天仅提醒仍未完成的人员。`);
  if(recipient.counts.peer||recipient.counts.manager)lines.push(`评分工作台：${baseUrl}/?page=scores`);
  if(recipient.counts.boss)lines.push(`部门负责人评分：${baseUrl}/?page=departments`);
  return lines.join('\n');
 }
 async function tick() {
  if(running)return {skipped:'running'};
  running=true;
  try {
   const clock=shanghaiClock(now()),settings=await getSettings(),cal=calendar(),dates=lastTwoWorkingDays(clock.month,cal);
   if(!settings.enabled)return {skipped:'disabled'};
   if(settings.startMonth&&clock.month<settings.startMonth)return {skipped:'not_started'};
   if(settings.configured===false)return {skipped:'not_configured'};
   if(cal.autoManaged&&Number(cal.year)!==Number(clock.month.slice(0,4))&&!(cal.years||[]).includes(Number(clock.month.slice(0,4))))return {skipped:'calendar_unavailable'};
   if(!dates.includes(clock.date)||clock.time<settings.time)return {skipped:'not_due'};
   let sent=0,failed=0;
   const stale=new Date(now().getTime()-15*60000).toISOString(),retryWindow=new Date(now().getTime()-40*60000).toISOString();
   // An interrupted send may have reached Feishu. Do not blindly resend it after restart.
   await exec(`UPDATE monthly_score_reminder_deliveries SET status='uncertain',last_error='delivery_status_unknown' WHERE month=${sql(clock.month)} AND reminder_date=${sql(clock.date)} AND (status='pending' AND updated_at<=${sql(stale)} OR status='failed' AND first_attempt_at<${sql(retryWindow)});`);
   for(const recipient of await pending(clock.month)){
    const claim=randomUUID(),stamp=now().toISOString(),retryBefore=new Date(now().getTime()-15*60000).toISOString();
    const key=`month=${sql(clock.month)} AND reminder_date=${sql(clock.date)} AND recipient_user_id=${sql(recipient.userId)}`;
    // Reserve atomically in SQLite across processes. Stable Feishu UUID also deduplicates retries.
    await exec(`INSERT OR IGNORE INTO monthly_score_reminder_deliveries(month,reminder_date,recipient_user_id,recipient_name,status,updated_at) VALUES(${sql(clock.month)},${sql(clock.date)},${sql(recipient.userId)},${sql(recipient.name)},'ready',${sql(stamp)});
UPDATE monthly_score_reminder_deliveries SET status='pending',claim_token=${sql(claim)},attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,${sql(stamp)}),updated_at=${sql(stamp)} WHERE ${key} AND attempts<3 AND (status IN ('ready','cancelled') OR status='failed' AND updated_at<=${sql(retryBefore)} AND first_attempt_at>=${sql(retryWindow)});`);
    if(!(await query(`SELECT 1 FROM monthly_score_reminder_deliveries WHERE ${key} AND claim_token=${sql(claim)} AND status='pending';`)).length)continue;
    const owned=`${key} AND claim_token=${sql(claim)}`;
    let delivered=false;
    try {
     // Work may have been completed (or notifications disabled) since the initial scan.
     const current=(await pending(clock.month)).find(p=>p.userId===recipient.userId),freshClock=shanghaiClock(now());
     const freshSettings=await getSettings();
     if(!current||!freshSettings.enabled||freshSettings.startMonth&&clock.month<freshSettings.startMonth||freshClock.date!==clock.date){
      await exec(`UPDATE monthly_score_reminder_deliveries SET status='cancelled',updated_at=${sql(now().toISOString())} WHERE ${owned};`);continue;
     }
     const text=message(current,clock,dates),uuid=createHash('sha256').update(`${clock.date}:${current.userId}`).digest('hex').slice(0,32);
     await exec(`UPDATE monthly_score_reminder_deliveries SET message=${sql(text)},pending_json=${sql(JSON.stringify(current.counts))} WHERE ${owned};`);
     const messageId=await deliver(current.userId,text,uuid);
     if(!messageId)throw Error('missing_message_id');
     delivered=true;
     await exec(`UPDATE monthly_score_reminder_deliveries SET status='sent',message_id=${sql(messageId)},sent_at=${sql(now().toISOString())},last_error='',updated_at=${sql(now().toISOString())} WHERE ${owned};`);sent++;
    }catch{
     // Upstream responses may contain sensitive request data; keep a bounded generic error.
     await exec(`UPDATE monthly_score_reminder_deliveries SET status=${sql(delivered?'uncertain':'failed')},last_error=${sql(delivered?'delivery_status_unknown':'delivery_failed')},updated_at=${sql(now().toISOString())} WHERE ${owned};`);failed++;
    }
   }
   return {sent,failed};
  }finally{running=false;}
 }
 return {pending,preview,tick};
}
