import {randomUUID} from 'node:crypto';
import {employedInMonth} from './employee-lifecycle.mjs';

const CONFIG='scoring360_recurring_config',VERSION='scoring360_recurring_plan_version_',MONTH='scoring360_recurring_month_';
const validMonth=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value||'');

// A confirmed relationship template is permanent; each month gets fresh tasks.
// Versions, monthly provenance, existing cycles and every submitted score stay.
export function createScoringRecurrence({query,exec,sql,setup,managerReviews,bossMembers=()=>[],now=()=>new Date()}){
 let busy=false;
 const current=()=>now().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 const stamp=()=>now().toISOString();
 const valueOf=rows=>rows[0]?.value_json||'';
 async function stored(){
  const raw=valueOf(await query(`SELECT value_json FROM app_settings WHERE key=${sql(CONFIG)};`));
  let config={},version=null;
  try{config=raw?JSON.parse(raw):{};}catch{/* A damaged pointer never enables a template. */}
  if(typeof config.versionId==='string')try{version=JSON.parse(valueOf(await query(`SELECT value_json FROM app_settings WHERE key=${sql(VERSION+config.versionId)};`))||'null');}catch{}
  const configured=Boolean(version&&Array.isArray(version.pairs)&&version.pairs.length&&version.id===config.versionId);
  return {raw,config,version,configured};
 }
 const collection=(table,columns,where='1')=>`(SELECT json_group_array(json_object(${columns.split(',').flatMap(k=>[sql(k),k]).join(',')})) FROM (SELECT ${columns} FROM ${table} WHERE ${where} ORDER BY ${columns}))`;
 function fingerprint(month){
  const scope=`substr(start_date,1,7)=${sql(month)}`;
  return `json_object('people',${collection('employees','user_id,name,department,manager_user_id,is_active')},'employment',${collection('employee_employment_periods','id,employee_user_id,start_date,end_date')},'departments',${collection('organization_departments','id,name,leader_user_id')},'hierarchy',${collection('department_hierarchy','department_id,parent_id')},'layout',${collection('department_local_settings','department_id,is_active,leader_mode')},'departmentStates',${collection('feishu_department_sync_states','department_id,state')},'roles',${collection('app_settings','key,value_json',"key IN('boss_view_members','scoring360_admin_members')")},'cycles',${collection('scoring360_cycles','id,start_date,end_date,status,launch_at',scope)},'assignments',${collection('scoring360_assignments','id,cycle_id,evaluee_user_id,evaluator_user_id,status',`cycle_id IN(SELECT id FROM scoring360_cycles WHERE ${scope})`)},'plans',${collection('monthly_review_plans','month,employee_user_id,plan_json',`month=${sql(month)}`)},'handoffs',${collection('monthly_manager_handoffs','id,month,employee_user_id,from_user_id,to_user_id',`month=${sql(month)}`)},'scores',${collection('monthly_manager_scores','month,employee_user_id,evaluator_user_id,score',`month=${sql(month)}`)},'bossScores',${collection('all_department_leader_scores','month,department_id,leader_user_id,score',`month=${sql(month)}`)},'published',${collection('all_monthly_weighted_results','month,employee_user_id,kind',`month=${sql(month)}`)},'legacy',${collection('performance_results','month,employee_user_id,kind',`month=${sql(month)} AND kind='collaboration'`)})`;
 }
 const signature=async month=>(await query(`SELECT ${fingerprint(month)} AS value;`))[0].value;
 const configGuard=record=>record.raw?`(SELECT value_json FROM app_settings WHERE key=${sql(CONFIG)})=${sql(record.raw)}`:`NOT EXISTS(SELECT 1 FROM app_settings WHERE key=${sql(CONFIG)})`;
 const actorFields=actor=>({userId:String(actor?.userId||'system'),name:String(actor?.name||'系统自动沿用')});
 function logInsert(id,actor,action,details,guard){const user=actorFields(actor);return `INSERT INTO system_operation_logs(id,actor_user_id,actor_name,action,details_json,created_at) SELECT ${sql(id)},${sql(user.userId)},${sql(user.name)},${sql(action)},${sql(JSON.stringify(details))},${sql(stamp())} WHERE ${guard};`;}
 const owned=id=>`EXISTS(SELECT 1 FROM system_operation_logs WHERE id=${sql(id)})`;
 async function sources(){
  const rows=await query("SELECT c.id,substr(c.start_date,1,7) AS month,c.status,COUNT(CASE WHEN COALESCE(a.status,'active')='active' THEN 1 END) AS pair_count,COUNT(DISTINCT CASE WHEN COALESCE(a.status,'active')='active' THEN a.evaluee_user_id END) AS target_count FROM scoring360_cycles c LEFT JOIN scoring360_assignments a ON a.cycle_id=c.id GROUP BY c.id ORDER BY month DESC,CASE WHEN c.id=substr(c.start_date,1,7)||'-360' THEN 0 ELSE 1 END,c.created_at DESC;");
  const seen=new Set();return rows.filter(r=>validMonth(r.month)&&r.month<=current()&&!seen.has(r.month)&&seen.add(r.month)).map(r=>({month:r.month,cycleId:r.id,status:r.status,pairCount:Number(r.pair_count),targetCount:Number(r.target_count)}));
 }
 async function projection(record,month,existing=false){
  for(let attempt=0;attempt<3;attempt++){
   const before=await signature(month),state=await managerReviews.snapshot(),base=await setup.overview(month),periods=await query('SELECT employee_user_id,start_date,end_date FROM employee_employment_periods;');
   const targets=base.targets.filter(p=>{const own=periods.filter(x=>x.employee_user_id===p.userId);return !own.length||employedInMonth(own,month);}),targetIds=new Set(targets.map(p=>p.userId)),people=new Map(base.people.map(p=>[p.userId,p]));
   const issues=[],pairs=[],seen=new Set();let skippedInactive=0;
   const links=existing?base.assignments.map(a=>({evalueeUserId:a.evaluee_user_id,evaluatorUserId:a.evaluator_user_id})):record.version.pairs;
   const addIssue=(type,label,userId)=>{if(!issues.some(i=>i.type===type&&i.userId===userId))issues.push({type,label,userId,name:people.get(userId)?.name||''});};
   for(const pair of links){
    if(!targetIds.has(pair.evalueeUserId)){skippedInactive++;continue;}
    if(!people.has(pair.evaluatorUserId)){skippedInactive++;addIssue('inactiveRater','固定评分人已停用或身份缺失，请调整固定名单',pair.evalueeUserId);continue;}
    if(pair.evalueeUserId===pair.evaluatorUserId){addIssue('self','存在自评关系，请调整固定名单',pair.evalueeUserId);continue;}
    const key=JSON.stringify([pair.evalueeUserId,pair.evaluatorUserId]);if(seen.has(key))continue;seen.add(key);pairs.push(pair);
   }
   const bosses=await bossMembers();
   for(const person of targets){
    if(!pairs.some(p=>p.evalueeUserId===person.userId))addIssue('peers','尚未设置固定同事评分人',person.userId);
    const p=managerReviews.progress(state,month,person.userId),reviewers=p.kind==='boss'?bosses.map(b=>b.userId):p.expectedIds;
    if(p.blockedDepartmentIds?.length)addIssue('department','原评分部门已移除，评分责任待核查',person.userId);
    if(!p.complete&&(!p.expectedIds.length||!reviewers.length||(p.kind==='boss'?!reviewers.some(id=>people.has(id)):reviewers.some(id=>!people.has(id)))))addIssue('manager','负责人或老板评分责任待配置',person.userId);
   }
   if(!targets.length)issues.push({type:'empty','label':'没有可参与评分的在职员工'});
   const after=await signature(month);if(before===after)return {base,targets,pairs,issues,skippedInactive,signature:before};
  }
  throw Error('recurring_plan_changed');
 }
 async function currentState(record){
  const month=current(),base=await setup.overview(month),raw=valueOf(await query(`SELECT value_json FROM app_settings WHERE key=${sql(MONTH+month)};`));let marker=null;try{marker=raw?JSON.parse(raw):null;}catch{}
  const summary={month,cycleId:base.cycle?.id||'',status:base.cycle?.status||'',createdPairs:Number(marker?.createdPairs||0),missingEmployeesCount:0,issueCount:0,issues:[]};
  if(base.cycle){
   if(!marker)return {...summary,state:'existing_manual',label:'本月已有人工配置，自动沿用不会覆盖'};
   const p=await projection(record,month,true),people=new Map(p.base.people.map(person=>[person.userId,person])),targetIds=new Set(p.targets.map(person=>person.userId));
   // Skipping a stopped rater must remain visible even if another valid peer
   // remains. Otherwise the draft would appear fixed while the permanent
   // template would pause every following month for the same missing person.
   for(const pair of record.version?.pairs||[])if(targetIds.has(pair.evalueeUserId)&&!people.has(pair.evaluatorUserId)&&!p.issues.some(i=>i.type==='templateInactiveRater'&&i.userId===pair.evalueeUserId))p.issues.push({type:'templateInactiveRater',label:'固定名单中有已停用评分人，请将调整后的本月配置更新为固定名单',userId:pair.evalueeUserId,name:people.get(pair.evalueeUserId)?.name||''});
   return {...summary,state:base.cycle.status==='draft'?'needs_attention':'generated',label:base.cycle.status==='draft'?(p.issues.length?'本月任务已生成，有人员变动待处理':'本月配置已补齐，请在工作台检查并开放'):'本月任务已自动生成',missingEmployeesCount:p.issues.filter(i=>i.type==='peers').length,issueCount:p.issues.length,issues:p.issues,versionId:marker.versionId};
  }
  if(!record.configured)return {...summary,state:'not_configured',label:'尚未设置固定评分名单'};
  if(!record.config.enabled)return {...summary,state:'disabled',label:'每月自动沿用已暂停'};
  if(record.config.startMonth>month)return {...summary,state:'not_started',label:'将在设置的月份开始沿用'};
  const p=await projection(record,month);return {...summary,state:p.issues.length?'needs_attention':'ready',label:p.issues.length?'固定名单有人员变动待处理':'固定名单已准备好',createdPairs:p.pairs.length,missingEmployeesCount:p.issues.filter(i=>i.type==='peers').length,issueCount:p.issues.length,issues:p.issues,skippedInactive:p.skippedInactive};
 }
 async function overview(){
  const record=await stored(),v=record.version,c=record.config;
  return {configured:record.configured,config:{enabled:record.configured&&c.enabled===true,sourceMonth:v?.sourceMonth||'',startMonth:c.startMonth||'',versionId:c.versionId||'',pairCount:v?.pairs?.length||0,targetCount:new Set((v?.pairs||[]).map(p=>p.evalueeUserId)).size,updatedAt:c.updatedAt||''},sources:await sources(),current:await currentState(record)};
 }
 async function generate(){
  const record=await stored(),month=current();
  if(!record.configured||!record.config.enabled)return {skipped:'disabled',month};
  if(!validMonth(record.config.startMonth)||record.config.startMonth>month)return {skipped:'not_started',month};
  if((await setup.overview(month)).cycle)return {skipped:'existing_cycle',month};
  const p=await projection(record,month),id=randomUUID(),cycleId=month+'-360',status=p.issues.length?'draft':'open',createdAt=stamp();
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  const guard=`${configGuard(record)} AND (${fingerprint(month)})=${sql(p.signature)} AND NOT EXISTS(SELECT 1 FROM scoring360_cycles WHERE substr(start_date,1,7)=${sql(month)}) AND NOT EXISTS(SELECT 1 FROM all_monthly_weighted_results WHERE month=${sql(month)}) AND NOT EXISTS(SELECT 1 FROM performance_results WHERE month=${sql(month)} AND kind='collaboration')`;
  const statements=[logInsert(id,null,'固定配评：自动生成本月任务',{month,versionId:record.version.id,status,pairCount:p.pairs.length,issueCount:p.issues.length},guard),`INSERT INTO scoring360_cycles(id,label,mode,start_date,end_date,status,launch_at,total_employees,total_evaluees) SELECT ${sql(cycleId)},${sql(month+' 月同事互评')},'monthly',${sql(month+'-01')},${sql(end)},${sql(status)},${status==='open'?sql(createdAt):'NULL'},${p.targets.length},${p.targets.length} WHERE ${owned(id)};`];
  for(const pair of p.pairs){const a=p.base.people.find(x=>x.userId===pair.evalueeUserId),b=p.base.people.find(x=>x.userId===pair.evaluatorUserId);statements.push(`INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id,status) SELECT ${sql(randomUUID())},${sql(cycleId)},${sql(a.name)},${sql(b.name)},${sql(a.userId)},${sql(b.userId)},'active' WHERE ${owned(id)};`);}
  const marker={month,cycleId,versionId:record.version.id,sourceMonth:record.version.sourceMonth,createdAt,createdPairs:p.pairs.length,status,issues:p.issues};
  statements.push(`INSERT INTO app_settings(key,value_json,updated_at) SELECT ${sql(MONTH+month)},${sql(JSON.stringify(marker))},${sql(createdAt)} WHERE ${owned(id)};`);
  await exec(`BEGIN IMMEDIATE;${statements.join('\n')}COMMIT;`);
  if(!(await query(`SELECT id FROM system_operation_logs WHERE id=${sql(id)};`)).length)return {skipped:'changed',month};
  return {month,state:status==='open'?'generated':'needs_attention',cycleId,status,createdPairs:p.pairs.length,issues:p.issues,messagesSent:0};
 }
 async function tick(){if(busy)return {skipped:'running'};busy=true;try{return await generate();}finally{busy=false;}}
 async function mutate(body,actor){
  if(busy)throw Error('recurring_plan_busy');busy=true;
  try{
   const record=await stored();
   if(body.action==='adoptMonth'){
    const sourceMonth=String(body.sourceMonth||''),startMonth=String(body.startMonth||current()),enabled=body.enabled===undefined?true:body.enabled;
    if(!validMonth(sourceMonth)||sourceMonth>current()||!validMonth(startMonth)||startMonth<current()||startMonth>String(Number(current().slice(0,4))+1)+current().slice(4)||typeof enabled!=='boolean')throw Error('invalid_recurring_month');
    const before=await signature(sourceMonth),base=await setup.overview(sourceMonth);if(!base.cycle)throw Error('recurring_source_empty');
    const pairs=[],seen=new Set();for(const row of base.assignments){const pair={evalueeUserId:row.evaluee_user_id,evaluatorUserId:row.evaluator_user_id};if(!pair.evalueeUserId||!pair.evaluatorUserId)throw Error('recurring_source_invalid');if(pair.evalueeUserId===pair.evaluatorUserId)throw Error('self_scoring_forbidden');const k=JSON.stringify(pair);if(!seen.has(k)){seen.add(k);pairs.push(pair);}}
    if(!pairs.length)throw Error('recurring_source_empty');if(pairs.length>5000)throw Error('recurring_source_too_large');
    const version={id:randomUUID(),sourceMonth,sourceCycleId:base.cycle.id,sourceStatus:base.cycle.status,pairs,createdAt:stamp(),confirmedBy:actorFields(actor).userId},config={enabled,startMonth,versionId:version.id,updatedAt:stamp()},logId=randomUUID();
    const guard=`${configGuard(record)} AND (${fingerprint(sourceMonth)})=${sql(before)}`;
    await exec(`BEGIN IMMEDIATE;${logInsert(logId,actor,'固定配评：确认长期评分名单',{sourceMonth,startMonth,versionId:version.id,pairCount:pairs.length,enabled},guard)}INSERT INTO app_settings(key,value_json,updated_at) SELECT ${sql(VERSION+version.id)},${sql(JSON.stringify(version))},${sql(version.createdAt)} WHERE ${owned(logId)};INSERT INTO app_settings(key,value_json,updated_at) SELECT ${sql(CONFIG)},${sql(JSON.stringify(config))},${sql(config.updatedAt)} WHERE ${owned(logId)} ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at;COMMIT;`);
    if(!(await query(`SELECT id FROM system_operation_logs WHERE id=${sql(logId)};`)).length)throw Error('recurring_plan_changed');
    await generate();
   }else if(body.action==='setEnabled'){
    if(typeof body.enabled!=='boolean')throw Error('invalid_recurring_config');if(body.enabled&&!record.configured)throw Error('recurring_plan_required');
    const config={...record.config,enabled:body.enabled,updatedAt:stamp()},logId=randomUUID();
    await exec(`BEGIN IMMEDIATE;${logInsert(logId,actor,body.enabled?'固定配评：开启每月沿用':'固定配评：暂停每月沿用',{enabled:body.enabled,versionId:config.versionId||''},configGuard(record))}INSERT INTO app_settings(key,value_json,updated_at) SELECT ${sql(CONFIG)},${sql(JSON.stringify(config))},${sql(config.updatedAt)} WHERE ${owned(logId)} ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at;COMMIT;`);
    if(!(await query(`SELECT id FROM system_operation_logs WHERE id=${sql(logId)};`)).length)throw Error('recurring_plan_changed');if(body.enabled)await generate();
   }else if(body.action==='run')await generate();
   else throw Error('invalid_recurring_action');
   return {...await overview(),messagesSent:0};
  }finally{busy=false;}
 }
 return {overview,mutate,tick};
}
