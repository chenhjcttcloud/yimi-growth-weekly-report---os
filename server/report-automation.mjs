import {randomUUID} from 'node:crypto';

// Poll Feishu's report query API because the current integration has no submission webhook.
// It never creates reminders or ratings, and reuses the sync engine's content/model cache.
export function createReportAutomation({query,exec,sql,getConfig,isRunning,start,now=()=>new Date()}){
 let busy=false;
 async function state(){return JSON.parse((await query("SELECT value_json FROM app_settings WHERE key='report_automation_state';"))[0]?.value_json||'{}');}
 async function overview(){
  const config=await getConfig(),saved=await state(),next=saved.lastAttemptAt?new Date(Date.parse(saved.lastAttemptAt)+config.intervalMinutes*60000).toISOString():null;
  return {config,lastAttemptAt:saved.lastAttemptAt||null,nextCheckAt:config.enabled?next:null,lastStatus:saved.status||'idle',running:isRunning(),lookbackDays:45};
 }
 async function tick(){
  if(busy)return {skipped:'running'};
  busy=true;
  try{
   const config=await getConfig();
   if(!config.enabled)return {skipped:'disabled'};
   if(!config.feishuConfigured||!config.aiConfigured)return {skipped:'not_configured'};
   if(isRunning())return {skipped:'sync_running'};
   const stamp=now().toISOString(),cutoff=new Date(now().getTime()-config.intervalMinutes*60000).toISOString();
   const end=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now()),from=new Date(end+'T00:00:00Z');from.setUTCDate(from.getUTCDate()-44);
   const range={start:from.toISOString().slice(0,10),end},claim=randomUUID(),value={lastAttemptAt:stamp,status:'claimed',claim,range};
   await exec(`INSERT INTO app_settings(key,value_json,updated_at) VALUES('report_automation_state',${sql(JSON.stringify(value))},${sql(stamp)}) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at WHERE julianday(json_extract(app_settings.value_json,'$.lastAttemptAt'))<=julianday(${sql(cutoff)}) OR json_extract(app_settings.value_json,'$.lastAttemptAt') IS NULL;`);
   if((await state()).claim!==claim)return {skipped:'not_due'};
   let status='failed';
   try{
    if(!(await getConfig()).enabled)status='disabled';
    else status=await start(range)?'started':'sync_running';
   }catch{/* Do not store upstream keys, payloads or tokens in scheduler status. */}
   await exec(`UPDATE app_settings SET value_json=${sql(JSON.stringify({...value,status}))},updated_at=${sql(now().toISOString())} WHERE key='report_automation_state' AND json_extract(value_json,'$.claim')=${sql(claim)};`);
   return {status,...range};
  }finally{busy=false;}
 }
 return {tick,overview};
}
