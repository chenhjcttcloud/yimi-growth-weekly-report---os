import {randomUUID} from 'node:crypto';
import {fridayOfWeek,isCalendarWorkday,shiftDate,weeklyReportSchedule} from './weekly-report-schedule.mjs';

const shanghaiDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'});
const MINUTE=60_000;
const CATCH_UP=24*60*MINUTE;
const CLAIM_RETRY=5*MINUTE;
const LOOKBACK_DAYS=45;

function nextWorkday(date,calendar){
 for(let day=shiftDate(date,1),offset=1;offset<=31;day=shiftDate(day,1),offset++){
  const year=Number(day.slice(0,4));
  if(calendar.autoManaged&&Number(calendar.year)!==year&&!(calendar.years||[]).includes(year))return null;
  if(isCalendarWorkday(day,calendar))return day;
 }
 return null;
}

export function createReportAutomation({query,exec,sql,getConfig,isRunning,start,getAiRequestsToday=async()=>0,calendar=()=>({}),policyFor=async()=>({deadlineTime:'20:00'}),now=()=>new Date()}){
 let busy=false;
 async function state(){return JSON.parse((await query("SELECT value_json FROM app_settings WHERE key='report_automation_state';"))[0]?.value_json||'{}');}
 async function collectionSlots(today){
  const friday=fridayOfWeek(today),workCalendar=calendar(),policies=new Map(),slots=[];
  // Include prior weeks for follow-ups after a long holiday, and upcoming
  // weeks so the settings page can show the next slot during an exempt week.
  for(let offset=-35;offset<=28;offset+=7){
   const weekEnd=shiftDate(friday,offset),month=weekEnd.slice(0,7);
   if(!policies.has(month))policies.set(month,await policyFor(month));
   const deadline=weeklyReportSchedule(weekEnd,workCalendar,policies.get(month)?.deadlineTime);
   if(deadline.exempt||deadline.calendarPending)continue;
   slots.push({kind:'deadline',time:Date.parse(deadline.dueAt)+5*MINUTE});
   const followup=nextWorkday(deadline.deadlineDate,workCalendar);
   if(followup)slots.push({kind:'followup',time:Date.parse(followup+'T09:00:00+08:00')});
  }
  return slots.sort((left,right)=>left.time-right.time);
 }
 function dueSlot(slots,time,saved){
  const slot=slots.findLast(slot=>slot.time<=time&&slot.time>time-CATCH_UP);
  if(!slot)return null;
  const last=Date.parse(saved.slotAt);
  if(!Number.isFinite(last)||slot.time>last)return slot;
  return slot.time===last&&saved.status!=='started'&&Date.parse(saved.lastAttemptAt)<=time-CLAIM_RETRY?slot:null;
 }
 async function overview(){
  const instant=now(),config=await getConfig(),saved=await state();
  const slots=config.enabled?await collectionSlots(shanghaiDate.format(instant)):[];
  const time=instant.getTime(),next=dueSlot(slots,time,saved)||slots.find(slot=>slot.time>time);
  return {config,aiRequestsToday:await getAiRequestsToday(),lastAttemptAt:saved.lastAttemptAt||null,nextCheckAt:next?new Date(next.time).toISOString():null,nextCheckKind:next?.kind||null,lastStatus:saved.status||'idle',running:isRunning(),lookbackDays:LOOKBACK_DAYS};
 }
 async function tick(){
  if(busy)return {skipped:'running'};
  busy=true;
  try{
   const config=await getConfig();
   if(!config.enabled)return {skipped:'disabled'};
   if(!config.feishuConfigured||!config.aiConfigured)return {skipped:'not_configured'};
   if(isRunning())return {skipped:'sync_running'};
   const instant=now(),end=shanghaiDate.format(instant),time=instant.getTime();
   const slot=dueSlot(await collectionSlots(end),time,await state());
   if(!slot)return {skipped:'not_due'};
   const stamp=instant.toISOString(),slotAt=new Date(slot.time).toISOString(),retryBefore=new Date(time-CLAIM_RETRY).toISOString();
   const range={start:shiftDate(end,1-LOOKBACK_DAYS),end},claim=randomUUID();
   const value={lastAttemptAt:stamp,slotAt,slotKind:slot.kind,status:'claimed',claim,range};
   const storedSlot="julianday(json_extract(app_settings.value_json,'$.slotAt'))",requestedSlot=`julianday(${sql(slotAt)})`;
   await exec(`INSERT INTO app_settings(key,value_json,updated_at) VALUES('report_automation_state',${sql(JSON.stringify(value))},${sql(stamp)})
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at
    WHERE ${storedSlot} IS NULL OR ${storedSlot}<${requestedSlot} OR (
      ${storedSlot}=${requestedSlot} AND json_extract(app_settings.value_json,'$.status')<>'started'
      AND julianday(json_extract(app_settings.value_json,'$.lastAttemptAt'))<=julianday(${sql(retryBefore)}));`);
   if((await state()).claim!==claim)return {skipped:'not_due'};
   let status='failed';
   try{
    if(!(await getConfig()).enabled)status='disabled';
    else status=await start(range)?'started':'sync_running';
   }catch{/* Do not store upstream keys, payloads or tokens in scheduler status. */}
   await exec(`UPDATE app_settings SET value_json=${sql(JSON.stringify({...value,status}))},updated_at=${sql(now().toISOString())} WHERE key='report_automation_state' AND json_extract(value_json,'$.claim')=${sql(claim)};`);
   return {status,slotAt,kind:slot.kind,...range};
  }finally{busy=false;}
 }
 return {tick,overview};
}
