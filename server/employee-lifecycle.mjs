import {randomUUID} from 'node:crypto';
const day=value=>{if(!value)return '';const s=String(value).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s?s:'';};
export const employedOn=(periods,date)=>periods.some(p=>p.start_date<=date&&(!p.end_date||p.end_date>=date));
export const employedInMonth=(periods,month)=>periods.some(p=>p.start_date<=month+'-31'&&(!p.end_date||p.end_date>=month+'-01'));

export function createEmployeeLifecycle({query,exec,sql,now=()=>new Date()}){
 const today=()=>now().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
 async function observe(userId,start,source='report'){
  start=day(start)||today();
  const rows=await query(`SELECT * FROM employee_employment_periods WHERE employee_user_id=${sql(userId)};`);
  if(!rows.length)await exec(`INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES(${sql(randomUUID())},${sql(userId)},${sql(start)},${sql(source)});`);
  else if(source==='report'&&rows.length===1&&!rows[0].end_date&&['report','first_seen','sso'].includes(rows[0].source)&&start<rows[0].start_date){
   // Earlier verified report collection can refine a discovery-only start.
   // Recheck the source and interval in SQL so concurrent manager edits or
   // a stop/restore cannot turn this inference into a rewrite of history.
   await exec(`UPDATE employee_employment_periods SET start_date=${sql(start)},source='report',updated_at=datetime('now')
    WHERE id=${sql(rows[0].id)} AND start_date>${sql(start)} AND end_date IS NULL
      AND source IN('report','first_seen','sso')
      AND (SELECT COUNT(*) FROM employee_employment_periods WHERE employee_user_id=${sql(userId)})=1;`);
  }
 }
 async function initialize(data={}){
  const rows=await query('SELECT user_id,is_active FROM employees;'),reports=await query('SELECT employee_user_id,MIN(week_start) AS first_week,MAX(week_end) AS last_week FROM weekly_reports GROUP BY employee_user_id;');
  for(const e of rows){
   if((await query(`SELECT 1 FROM employee_employment_periods WHERE employee_user_id=${sql(e.user_id)} LIMIT 1;`)).length)continue;
   const first=[reports.find(r=>r.employee_user_id===e.user_id)?.first_week,...(data.weekly_scores||[]).filter(r=>r.user_id===e.user_id).map(r=>r['开始日期'])].filter(Boolean).sort()[0];
   await observe(e.user_id,first||today(),first?'report':'first_seen');
   if(Number(e.is_active)===0)await exec(`UPDATE employee_employment_periods SET end_date=${sql(today())} WHERE employee_user_id=${sql(e.user_id)} AND end_date IS NULL;`);
  }
 }
 async function profile(userId,joinTime){
  const seconds=Number(joinTime),date=new Date(seconds>1e12?seconds:seconds*1000),hired=joinTime?day(Number.isFinite(seconds)&&seconds>0&&!Number.isNaN(date.getTime())?date.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}):joinTime):'';
  await observe(userId,hired||today(),'sso');
  const periods=await query(`SELECT * FROM employee_employment_periods WHERE employee_user_id=${sql(userId)} ORDER BY start_date;`);
  if(hired&&periods.length===1&&['report','first_seen','sso','feishu'].includes(periods[0].source))await exec(`UPDATE employee_employment_periods SET start_date=${sql(hired)},source='feishu' WHERE id=${sql(periods[0].id)};`);
 }
 async function setDates(userId,body,actor){
  const start=day(body.startDate),end=body.endDate?day(body.endDate):'';
  if(!start||body.endDate&&!end||end&&end<start||start>today())throw Error('invalid_employment_dates');
  const employee=(await query(`SELECT is_active FROM employees WHERE user_id=${sql(userId)};`))[0];
  if(!employee)throw Error('employee_not_found');
  if(end&&Number(employee.is_active)===1)throw Error('stop_employee_before_setting_end_date');
  const periods=await query(`SELECT * FROM employee_employment_periods WHERE employee_user_id=${sql(userId)} ORDER BY start_date;`);
  if(periods.length>1)throw Error('multiple_employment_periods_require_review');
  const change=periods.length?`UPDATE employee_employment_periods SET start_date=${sql(start)},end_date=${sql(end||null)},source='manager',updated_at=datetime('now') WHERE id=${sql(periods[0].id)};`:`INSERT INTO employee_employment_periods(id,employee_user_id,start_date,end_date,source) VALUES(${sql(randomUUID())},${sql(userId)},${sql(start)},${sql(end||null)},'manager');`;
  await exec(`BEGIN IMMEDIATE;${change} INSERT INTO system_operation_logs(id,actor_user_id,actor_name,action,details_json,created_at) VALUES(${sql(randomUUID())},${sql(actor.userId)},${sql(actor.name)},'员工在职日期已核实',${sql(JSON.stringify({userId,startDate:start,endDate:end,previous:periods}))},datetime('now'));COMMIT;`);
 }
 async function stop(userId,date=today()){
  if(!day(date)||date>today())throw Error('invalid_employment_dates');
  await exec(`UPDATE employee_employment_periods SET end_date=CASE WHEN start_date>${sql(date)} THEN start_date ELSE ${sql(date)} END,updated_at=datetime('now') WHERE employee_user_id=${sql(userId)} AND end_date IS NULL;`);
 }
 async function setStatus(userId,active,actor,lastWorkingDate){
  if(typeof active!=='boolean')throw Error('invalid_employee_status');
  const effectiveDate=active?today():lastWorkingDate||today();
  if(typeof effectiveDate!=='string'||day(effectiveDate)!==effectiveDate||effectiveDate>today())throw Error('invalid_employment_dates');
  const snapshot=await query(`SELECT e.is_active,p.* FROM employees e LEFT JOIN employee_employment_periods p ON p.employee_user_id=e.user_id WHERE e.user_id=${sql(userId)} ORDER BY p.start_date,p.id;`);
  const employee=snapshot[0];
  if(!employee)throw Error('employee_not_found');
  const periods=snapshot.filter(period=>period.id);
  const open=periods.filter(period=>!period.end_date);
  if(active&&(open.length>1||open.some(period=>period.start_date>effectiveDate)||periods.some(period=>period.end_date>effectiveDate)||Number(employee.is_active)===0&&open.length))throw Error('employment_periods_require_review');
  if(Number(employee.is_active)===(active?1:0)&&(active?open.length===1:open.length===0))return {active,effectiveDate,changed:false};
  const periodChange=active?`
    INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source)
    SELECT ${sql(randomUUID())},${sql(userId)},${sql(effectiveDate)},'manager_restore'
    WHERE EXISTS(SELECT 1 FROM employees WHERE user_id=${sql(userId)})
      AND NOT EXISTS(SELECT 1 FROM employee_employment_periods WHERE employee_user_id=${sql(userId)} AND end_date IS NULL);`
   :`UPDATE employee_employment_periods SET end_date=CASE WHEN start_date>${sql(effectiveDate)} THEN start_date ELSE ${sql(effectiveDate)} END,updated_at=datetime('now') WHERE employee_user_id=${sql(userId)} AND end_date IS NULL;`;
  const assignmentChange=active?'':`
    UPDATE scoring360_assignments SET status='inactive',updated_at=datetime('now')
    WHERE status='active' AND (evaluee_user_id=${sql(userId)} OR evaluator_user_id=${sql(userId)})
      AND NOT EXISTS(SELECT 1 FROM scoring360_responses r WHERE r.assignment_id=scoring360_assignments.id)
      AND NOT EXISTS(SELECT 1 FROM performance_results p JOIN scoring360_cycles c ON p.month=substr(c.start_date,1,7) WHERE c.id=scoring360_assignments.cycle_id AND p.kind='collaboration' AND p.employee_user_id=scoring360_assignments.evaluee_user_id)
      AND NOT EXISTS(SELECT 1 FROM all_monthly_weighted_results p JOIN scoring360_cycles c ON p.month=substr(c.start_date,1,7) WHERE c.id=scoring360_assignments.cycle_id AND p.employee_user_id=scoring360_assignments.evaluee_user_id);`;
  // Keep state, employment dates, pending assignments and the audit in one
  // transaction. The in-transaction guard prevents concurrent restores from
  // creating multiple open periods; closed history is never reopened.
  await exec(`BEGIN IMMEDIATE;${periodChange}
    UPDATE employees SET is_active=${active?1:0},updated_at=datetime('now') WHERE user_id=${sql(userId)};
    ${assignmentChange}
    INSERT INTO system_operation_logs(id,actor_user_id,actor_name,action,details_json,created_at)
    VALUES(${sql(randomUUID())},${sql(actor.userId)},${sql(actor.name)},'员工状态已更新',${sql(JSON.stringify({userId,active,effectiveDate,previousActive:Number(employee.is_active)===1}))},datetime('now'));
    COMMIT;`);
  return {active,effectiveDate,changed:true};
 }
 return {initialize,observe,profile,setDates,stop,setStatus};
}
