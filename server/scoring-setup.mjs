import {randomUUID} from 'node:crypto';
export function createScoringSetup({query,exec,sql,isBoss=()=>false,now=()=>new Date()}){
 const current=()=>now().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 function validate(month,write=false){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('invalid_month');if(write&&(month<current()||month>String(Number(current().slice(0,4))+1)+current().slice(4)))throw Error('editable_month_required');}
 async function overview(month=current()){
  validate(month);const people=(await query('SELECT user_id,name,department,is_active FROM employees WHERE is_active=1;')).map(e=>({userId:e.user_id,name:e.name,department:e.department||''})),targets=people.filter(e=>!isBoss(e.userId));
  const cycles=await query(`SELECT * FROM scoring360_cycles WHERE substr(start_date,1,7)=${sql(month)} ORDER BY CASE WHEN id=${sql(month+'-360')} THEN 0 ELSE 1 END,created_at DESC;`),cycle=cycles[0]||null;
  const assignments=cycle?await query(`SELECT a.id,a.evaluee_user_id,a.evaluator_user_id,a.evaluee_name,a.evaluator_name,a.status,r.score,r.id AS response_id FROM scoring360_assignments a LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE a.cycle_id=${sql(cycle.id)} AND COALESCE(a.status,'active')='active';`):[];
  const missing=targets.filter(e=>!assignments.some(a=>a.evaluee_user_id===e.userId));return {month,cycle,people,targets,assignments,missing,configured:targets.length-missing.length,editable:month>=current()&&month<=String(Number(current().slice(0,4))+1)+current().slice(4)&&cycle?.status!=='closed'};
 }
 async function prepare(month){validate(month,true);const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);await exec(`INSERT OR IGNORE INTO scoring360_cycles(id,label,mode,start_date,end_date,status) VALUES(${sql(month+'-360')},${sql(month+' 月同事互评')},'monthly',${sql(month+'-01')},${sql(end)},'draft');`);return overview(month);}
 async function assign(month,pairs){
  validate(month,true);if(!Array.isArray(pairs)||!pairs.length||pairs.length>500)throw Error('invalid_assignment_batch');
  const state=await overview(month);if(!state.cycle)throw Error('prepare_cycle_first');if(state.cycle.status==='closed')throw Error('result_locked');
  const people=new Map(state.people.map(e=>[e.userId,e])),targets=new Set(state.targets.map(e=>e.userId)),seen=new Set(),statements=[];
  const locked=new Set((await query(`SELECT employee_user_id FROM all_monthly_weighted_results WHERE month=${sql(month)} UNION SELECT employee_user_id FROM performance_results WHERE month=${sql(month)} AND kind='collaboration';`)).map(r=>r.employee_user_id));
  for(const pair of pairs){const a=String(pair.evalueeUserId||''),b=String(pair.evaluatorUserId||'');if(a===b)throw Error('self_scoring_forbidden');if(!targets.has(a)||!people.has(b))throw Error('active_employee_required');if(locked.has(a))throw Error('result_locked');if(seen.has(a+':'+b))continue;seen.add(a+':'+b);
   const existing=(await query(`SELECT a.id,a.status,r.id AS response_id FROM scoring360_assignments a LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE a.cycle_id=${sql(state.cycle.id)} AND a.evaluee_user_id=${sql(a)} AND a.evaluator_user_id=${sql(b)};`))[0];
   if(existing?.response_id||existing?.status==='active')continue;
   statements.push(`INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id,status) VALUES(${sql(randomUUID())},${sql(state.cycle.id)},${sql(people.get(a).name)},${sql(people.get(b).name)},${sql(a)},${sql(b)},'active') ON CONFLICT(cycle_id,evaluee_user_id,evaluator_user_id) DO UPDATE SET status='active',updated_at=datetime('now');`);
  }
  if(statements.length)await exec(`BEGIN IMMEDIATE;${statements.join('\n')}COMMIT;`);return {...await overview(month),added:statements.length};
 }
 async function open(month){validate(month,true);const state=await overview(month);if(!state.cycle||!state.assignments.length)throw Error('scoring_assignments_required');if(state.cycle.status==='closed')throw Error('result_locked');const scheduled=month>current();await exec(`UPDATE scoring360_cycles SET status=${sql(scheduled?'scheduled':'open')},launch_at=${sql(scheduled?month+'-01T00:00:00+08:00':now().toISOString())},updated_at=datetime('now') WHERE id=${sql(state.cycle.id)};`);return overview(month);}
 async function deactivate(month,id){validate(month,true);const state=await overview(month),assignment=state.assignments.find(a=>a.id===id);if(!assignment)throw Error('assignment_not_found');if(assignment.response_id)throw Error('result_locked');const published=await query(`SELECT 1 FROM all_monthly_weighted_results WHERE month=${sql(month)} AND employee_user_id=${sql(assignment.evaluee_user_id)} UNION SELECT 1 FROM performance_results WHERE month=${sql(month)} AND employee_user_id=${sql(assignment.evaluee_user_id)} AND kind='collaboration';`);if(published.length)throw Error('result_locked');await exec(`UPDATE scoring360_assignments SET status='inactive',updated_at=datetime('now') WHERE id=${sql(id)};`);return overview(month);}
 async function activateDue(){await exec(`UPDATE scoring360_cycles SET status='open',updated_at=datetime('now') WHERE status='scheduled' AND substr(start_date,1,7)=${sql(current())} AND datetime(launch_at)<=datetime(${sql(now().toISOString())}) AND EXISTS(SELECT 1 FROM scoring360_assignments a WHERE a.cycle_id=scoring360_cycles.id AND a.status='active');`);}
 return {overview,prepare,assign,open,deactivate,activateDue};
}
