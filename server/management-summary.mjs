import {createHash,randomUUID} from 'node:crypto';
export function createManagementSummary({query,exec,sql,readData,model,ask}){
 const pending=new Map();
 const rows=async where=>(await query(`SELECT source_hash,model,created_at,hex(summary) AS summary_hex FROM management_summaries ${where}`)).map(r=>({...r,summary:Buffer.from(r.summary_hex,'hex').toString('utf8')}));
 function source(periodId){
  const data=readData(),period=(data.meta?.periods||[]).find(p=>p.id===periodId);
  if(!period)throw Error('period_not_found');
  const reports=(data.weekly_scores||[]).filter(r=>r['周期ID']===periodId||r['结束日期']===period.end).map(r=>({userId:r.user_id,name:r['姓名'],department:r['部门'],submittedAt:r['提交时间'],results:r['本周成果摘要']||r.results||'',problems:r['问题摘要']||r.problems||'',plan:r['下周计划摘要']||r.nextPlan||'',reflection:r['思考与复盘摘要']||r.reflection||''}));
  const hash=createHash('sha256').update(JSON.stringify({version:1,period,reports})).digest('hex');return {period,reports,hash};
 }
 async function read(periodId){const input=source(periodId),saved=await rows(`WHERE period_id=${sql(periodId)} ORDER BY created_at DESC,rowid DESC LIMIT 1;`);return saved[0]?{text:saved[0].summary,createdAt:saved[0].created_at,stale:saved[0].source_hash!==input.hash||saved[0].model!==model(),reportCount:input.reports.length}:null;}
 async function generate(periodId,actor){
  const input=source(periodId);if(!input.reports.length)throw Error('no_reports');
  const key=input.hash+':'+model(),cached=(await rows(`WHERE period_id=${sql(periodId)} AND source_hash=${sql(input.hash)} AND model=${sql(model())};`))[0];
  if(cached)return {text:cached.summary,createdAt:cached.created_at,cached:true,reportCount:input.reports.length};
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{const selectedModel=model(),text=String(await ask(input)).trim();if(!text||text.length>12000)throw Error('invalid_summary');
   await exec(`INSERT OR IGNORE INTO management_summaries(id,period_id,source_hash,model,summary,created_by) VALUES(${sql(randomUUID())},${sql(periodId)},${sql(input.hash)},${sql(selectedModel)},${sql(text)},${sql(actor.userId)});`);
   return {text,cached:false,reportCount:input.reports.length};})();pending.set(key,task);
  try{return await task;}finally{pending.delete(key);}
 }
 return {read,generate};
}
