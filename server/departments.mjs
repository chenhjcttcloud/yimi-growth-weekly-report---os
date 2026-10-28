import {randomUUID,createHash} from 'node:crypto';
import {employedInMonth} from './employee-lifecycle.mjs';
export const departmentNames=value=>[...new Set(String(value||'').split(/[,，、]|\s+\/\s+/).map(x=>x.trim()).filter(Boolean))];
export function createDepartments({query,exec,sql,employees,beforeScore,resolveScoreTarget}) {
 let layoutSaving=false;
 const leaderName=(d,roster)=>!d.leader_user_id?'':d.feishu_id?(d.synced_leader_name||roster.find(e=>e.userId===d.leader_user_id)?.name||''):(roster.find(e=>e.userId===d.leader_user_id)?.name||'');
 async function overview(){
  const roster=await employees();
  const aliases=new Set((await query('SELECT aliases_json FROM feishu_department_links;')).flatMap(r=>JSON.parse(r.aliases_json||'[]')));
  for(const r of await query('SELECT aliases_json FROM department_local_settings;'))for(const name of JSON.parse(r.aliases_json))aliases.add(name);
  for(const name of [...new Set(roster.flatMap(e=>departmentNames(e.department)))].filter(n=>!aliases.has(n)))await exec(`INSERT OR IGNORE INTO organization_departments(id,name,updated_at) VALUES(${sql(randomUUID())},${sql(name)},datetime('now'));`);
  const all=await query("SELECT d.*,COALESCE(h.parent_id,'') AS parent_id,f.open_department_id AS feishu_id,f.leader_name AS synced_leader_name,f.member_count AS feishu_member_count,f.synced_at,f.aliases_json,COALESCE(l.sort_order,0) AS sort_order,COALESCE(l.leader_mode,'primary') AS leader_mode,COALESCE(l.is_active,1) AS is_active,l.aliases_json AS local_aliases_json,l.department_id AS local_override FROM organization_departments d LEFT JOIN department_hierarchy h ON h.department_id=d.id LEFT JOIN feishu_department_links f ON f.department_id=d.id LEFT JOIN department_local_settings l ON l.department_id=d.id ORDER BY sort_order,d.name;");
  for(const d of all){d.sort_order=Number(d.sort_order);d.is_active=Number(d.is_active);d.aliases_json=JSON.stringify([...new Set([...JSON.parse(d.aliases_json||'[]'),...JSON.parse(d.local_aliases_json||'[]')])]);}
  const scores=await query('SELECT * FROM all_department_leader_scores ORDER BY month DESC;');
  // Hide only unused composite labels produced by the old automatic importer; retain their records.
  const departments=all.filter(d=>departmentNames(d.name).length<=1||d.leader_user_id||d.parent_id||all.some(x=>x.parent_id===d.id)||scores.some(x=>x.department_id===d.id));
  return {layoutRevision:createHash('sha256').update(JSON.stringify(departments)).digest('hex'),departments:departments.map(d=>({...d,leaderName:leaderName(d,roster),leaderNamePending:Boolean(d.leader_user_id&&!leaderName(d,roster)),leaderSource:d.feishu_id?'feishu':'local'})),employees:roster.map(e=>{
   const names=departmentNames(e.department),direct=departments.filter(d=>names.includes(d.name)||e.department===d.name||JSON.parse(d.aliases_json||'[]').some(n=>names.includes(n))).map(d=>d.id),ids=new Set(direct);
   for(const id of direct){let p=departments.find(d=>d.id===id)?.parent_id;const visited=new Set([id]);while(p&&!visited.has(p)){visited.add(p);ids.add(p);p=departments.find(d=>d.id===p)?.parent_id;}}
   return {...e,directDepartmentIds:direct,departmentIds:[...ids]};
  }),scores};
 }
 async function save(body){
  const name=String(body.name||'').trim(),leader=String(body.leaderUserId||'');
  if(!name||name.length>80||(departmentNames(name).length!==1&&!body.id))throw Error('invalid_department');
  if(body.id){const official=(await query(`SELECT d.leader_user_id FROM organization_departments d JOIN feishu_department_links f ON f.department_id=d.id WHERE d.id=${sql(body.id)};`))[0];if(official&&leader!==official.leader_user_id)throw Error('department_leader_managed_by_feishu');}
  if(leader){const v=await overview(),target=v.departments.find(d=>d.id===body.id||(!body.id&&d.name===name)),trusted=target?.feishu_id&&target.leader_user_id===leader;if(!trusted&&!v.employees.some(e=>e.userId===leader&&(target?e.departmentIds.includes(target.id):departmentNames(e.department).includes(name))))throw Error('leader_must_be_department_member');}
  const id=body.id||randomUUID();
  if(body.id&&!(await query(`SELECT id FROM organization_departments WHERE id=${sql(id)};`)).length)throw Error('department_not_found');
  const parent=String(body.parentId||'');
  if(parent){
    const all=await query("SELECT d.id,COALESCE(h.parent_id,'') AS parent_id FROM organization_departments d LEFT JOIN department_hierarchy h ON h.department_id=d.id;");
    if(!all.some(d=>d.id===parent))throw Error('invalid_parent_department');
    const visited=new Set([id]);let cursor=parent;
    while(cursor){if(visited.has(cursor))throw Error('department_hierarchy_cycle');visited.add(cursor);cursor=all.find(d=>d.id===cursor)?.parent_id||'';}
  }
  await exec(`BEGIN; INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES(${sql(id)},${sql(name)},COALESCE(${sql(leader)},''),datetime('now')) ON CONFLICT(id) DO UPDATE SET name=excluded.name,leader_user_id=excluded.leader_user_id,updated_at=excluded.updated_at; INSERT INTO department_hierarchy(department_id,parent_id) VALUES(${sql(id)},COALESCE(${sql(parent)},'')) ON CONFLICT(department_id) DO UPDATE SET parent_id=excluded.parent_id; COMMIT;`);
 }
 async function saveLayout(body){
  if(layoutSaving)throw Error('department_layout_conflict');
  layoutSaving=true;
  try{return await saveLayoutUnlocked(body);}finally{layoutSaving=false;}
 }
 async function saveLayoutUnlocked(body){
  const current=await overview();
  if(body.revision!==current.layoutRevision)throw Error('department_layout_conflict');
  if(!Array.isArray(body.departments)||body.departments.length>1000)throw Error('invalid_department');
  const rows=body.departments,byId=new Map(rows.map(d=>[d.id,d]));
  if(byId.size!==rows.length||current.departments.some(d=>!byId.has(d.id)))throw Error('invalid_department');
  const names=new Set(),statements=['BEGIN IMMEDIATE;'];
  for(const d of rows){
   const old=current.departments.find(x=>x.id===d.id),name=String(d.name||'').trim(),parent=String(d.parent_id||''),leader=String(d.leader_user_id||'');
   if(old?.feishu_id&&leader!==old.leader_user_id)throw Error('department_leader_managed_by_feishu');
   if(typeof d.id!=='string'||!d.id||d.id.length>100||!name||name.length>80||departmentNames(name).length!==1||names.has(name)||!['primary','concurrent'].includes(d.leader_mode)||![0,1].includes(d.is_active)||!Number.isSafeInteger(d.sort_order)||d.sort_order<0)throw Error('invalid_department');
   names.add(name);
   const visited=new Set([d.id]);let cursor=parent;
   while(cursor){if(visited.has(cursor))throw Error('department_hierarchy_cycle');visited.add(cursor);const p=byId.get(cursor);if(!p||!p.is_active)throw Error('invalid_parent_department');cursor=p.parent_id;}
   const employee=current.employees.find(e=>e.userId===leader),trusted=old?.feishu_id&&old.leader_user_id===leader;
   if(leader&&!employee&&!trusted)throw Error('leader_not_registered');
   if(leader&&d.leader_mode==='primary'&&!trusted){
    const member=employee&&current.departments.some(x=>employee.directDepartmentIds.includes(x.id)&&(()=>{let p=x.id;const seen=new Set();while(p&&!seen.has(p)){if(p===d.id)return true;seen.add(p);p=byId.get(p)?.parent_id;}return false;})());
    if(!member)throw Error('leader_must_be_department_member');
   }
   if(!d.is_active&&(rows.some(x=>x.parent_id===d.id)||current.employees.some(e=>e.directDepartmentIds.includes(d.id))))throw Error('department_not_empty');
   const aliases=[...new Set([...JSON.parse(old?.aliases_json||'[]'),...(old&&old.name!==name?[old.name]:[])])];
   statements.push(`INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES(${sql(d.id)},${sql(name)},COALESCE(${sql(leader)},''),datetime('now')) ON CONFLICT(id) DO UPDATE SET name=excluded.name,leader_user_id=excluded.leader_user_id,updated_at=excluded.updated_at; INSERT INTO department_hierarchy(department_id,parent_id) VALUES(${sql(d.id)},COALESCE(${sql(parent)},'')) ON CONFLICT(department_id) DO UPDATE SET parent_id=excluded.parent_id;`);
   // Untouched Feishu departments remain sync-managed.
   if(!old||['name','parent_id','leader_user_id','leader_mode','sort_order','is_active'].some(k=>d[k]!==old[k]))statements.push(`INSERT INTO department_local_settings VALUES(${sql(d.id)},${d.sort_order},${sql(d.leader_mode)},${d.is_active},${sql(JSON.stringify(aliases))}) ON CONFLICT(department_id) DO UPDATE SET sort_order=excluded.sort_order,leader_mode=excluded.leader_mode,is_active=excluded.is_active,aliases_json=excluded.aliases_json;`);
  }
  statements.push('COMMIT;');await exec(statements.join('\n'));
 }
 async function score(body,user){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month||'')||body.month>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7))throw Error('invalid_month');
  const value=Number(body.score),comment=String(body.comment||'').trim();
  if(body.score===''||body.score==null||!Number.isFinite(value)||value<0||value>100||!comment||comment.length>4000)throw Error('score_and_comment_required');
  const current=(await query(`SELECT * FROM organization_departments WHERE id=${sql(body.departmentId)};`))[0],target=await resolveScoreTarget?.(body.month,body.departmentId),department=current?{...current,leader_user_id:target?.leaderUserId||current.leader_user_id}:null;
  if(!department?.leader_user_id)throw Error('department_leader_required');
  if(body.leaderUserId&&body.leaderUserId!==department.leader_user_id)throw Error('rating_responsibility_changed');
  if(department.leader_user_id===user.userId)throw Error('self_scoring_forbidden');
  const leader=(await overview()).employees.find(e=>e.userId===department.leader_user_id);
  const source=(await query(`SELECT raw_json FROM feishu_department_links WHERE department_id=${sql(department.id)};`))[0];
  const officialLeader=source&&JSON.parse(source.raw_json).leader_user_id===department.leader_user_id;
  if(!leader){const identity=(await query(`SELECT is_active FROM employees WHERE user_id=${sql(department.leader_user_id)};`))[0];throw Error(identity&&Number(identity.is_active)===0?'leader_inactive':'leader_not_registered');}
  const periods=await query(`SELECT * FROM employee_employment_periods WHERE employee_user_id=${sql(leader.userId)};`);
  if(periods.length&&!employedInMonth(periods,body.month))throw Error('employee_not_employed');
  if(target?.ratingRequired===false)throw Error('rating_scope_frozen');
  const local=(await query(`SELECT leader_mode,is_active FROM department_local_settings WHERE department_id=${sql(department.id)};`))[0];
  if(local&&Number(local.is_active)===0)throw Error('department_inactive');
  if(!target?.frozen&&!leader.departmentIds.includes(department.id)&&!officialLeader&&local?.leader_mode!=='concurrent')throw Error('leader_must_be_department_member');
  if((await query(`SELECT 1 FROM all_department_leader_scores WHERE department_id=${sql(department.id)} AND month=${sql(body.month)} AND leader_user_id=${sql(department.leader_user_id)};`)).length)throw Error('result_locked');
  await beforeScore?.(body.month,leader.userId);
  await exec(`INSERT INTO department_person_scores VALUES(${sql(department.id)},${sql(body.month)},${sql(department.leader_user_id)},${value},${sql(comment)},${sql(user.userId)},${sql(user.name)},datetime('now'));`);
 }
 async function dashboard(month,performance){
  const current=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
  month=month||current;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month>current)throw Error('invalid_month');
  const data=await overview();
  const average=xs=>xs.length?Math.round(xs.reduce((a,b)=>a+b,0)/xs.length*10)/10:null;
  function summarize(department,targetMonth){
   const members=data.employees.filter(e=>e.departmentIds.includes(department.id)),ids=new Set(members.map(e=>e.userId));
   const rows=performance.monthly.filter(r=>r.month===targetMonth&&ids.has(r.userId));
   const snapshots=performance.results.filter(r=>r.month===targetMonth&&ids.has(JSON.parse(r.evidence_json||'{}').userId));
   const result=kind=>snapshots.filter(r=>r.kind===kind&&Number.isFinite(r.result.score)).map(r=>r.result.score);
   const sum=key=>rows.reduce((n,r)=>n+(r.timeliness[key]||0),0),expected=sum('expected'),submitted=sum('submitted'),onTime=sum('onTime');
   return {headcount:members.length,expected,submitted,onTime,late:sum('late'),missing:sum('missing'),submissionRate:expected?Math.round(submitted/expected*1000)/10:null,onTimeRate:expected?Math.round(onTime/expected*1000)/10:null,quality:average(result('quality')),collaboration:average(result('collaboration')),qualityPublished:result('quality').length,collaborationPublished:result('collaboration').length,qualityReference:average(rows.flatMap(r=>r.reports.filter(x=>x.submitted&&x.candidate!==null).map(x=>x.candidate))),pendingRatings:rows.filter(r=>r.collaborationExpected>r.collaborationSubmitted).length};
  }
  const months=[...new Set([current,...performance.months])].filter(m=>m<=current).sort().reverse();
  return {...data,month,months,departments:data.departments.map(d=>({...d,members:data.employees.filter(e=>e.departmentIds.includes(d.id)),metrics:summarize(d,month),trend:months.filter(m=>m<=month).slice(0,6).map(m=>({month:m,...summarize(d,m)})),leaderScore:data.scores.find(s=>s.department_id===d.id&&s.month===month&&s.leader_user_id===d.leader_user_id)||null})),memberCount:data.employees.filter(e=>e.departmentIds.length>0).length,multiDepartmentCount:data.employees.filter(e=>e.directDepartmentIds.length>1).length};
 }
 async function personal(user){return query(`SELECT s.month,s.score,d.name AS department,s.created_at FROM all_department_leader_scores s JOIN organization_departments d ON d.id=s.department_id WHERE s.leader_user_id=${sql(user.userId)} ORDER BY s.month DESC;`);}
  return {overview,save,saveLayout,score,personal,dashboard};
}
