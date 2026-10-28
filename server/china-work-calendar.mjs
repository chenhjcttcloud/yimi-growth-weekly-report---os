import {createHash} from 'node:crypto';

const DAY=86400000;
export const calendarSources=year=>[
 `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
 `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
];

export function validateAnnualCalendar(data,year){
 if(!data||data.year!==year||!Array.isArray(data.papers)||!Array.isArray(data.days))throw Error('invalid_calendar');
 if(!data.papers.length&&!data.days.length)throw Error('not_published');
 const official=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='gov.cn'||u.hostname.endsWith('.gov.cn'));}catch{return false;}};
 if(!data.papers.length||data.papers.some(p=>!official(p))||data.days.length<20||data.days.length>100)throw Error('invalid_calendar');
 const names=new Set(),dates=new Map();
 for(const d of data.days){
  if(typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||typeof d.isOffDay!=='boolean'||typeof d.name!=='string')throw Error('invalid_calendar');
  const date=new Date(d.date+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==d.date||!(d.date.startsWith(year+'-')||d.date.startsWith(`${year-1}-12-`)))throw Error('invalid_calendar');
  if(dates.has(d.date))throw Error('invalid_calendar');
  dates.set(d.date,d.isOffDay);names.add(d.name);
 }
 // An empty/partial next-year placeholder must never be treated as a complete calendar.
 if(['元旦','春节','清明节','劳动节','端午节','中秋节','国庆节'].some(n=>![...names].some(v=>v.includes(n))))throw Error('incomplete_calendar');
 return {year,papers:[...data.papers],days:data.days.map(({date,isOffDay,name})=>({date,isOffDay,name}))};
}

export function createChinaWorkCalendar({query,exec,sql,bundled,onChange=()=>{},fetchImpl=fetch,now=()=>new Date(),enabled=true}){
 const annual=new Map(),checks=new Map();let inflight=null;
 function snapshot(){
  const days=new Map();
  for(const d of bundled.holidayDates||[])if(!annual.has(Number(d.slice(0,4))))days.set(d,true);
  for(const d of bundled.workdayOverrides||[])if(!annual.has(Number(d.slice(0,4))))days.set(d,false);
  // The next year's New Year holiday can change the preceding December's workdays.
  for(const [,entry] of [...annual].sort((a,b)=>a[0]-b[0]))for(const d of entry.data.days)days.set(d.date,d.isOffDay);
  const years=[...new Set([...(bundled.years||[]),...(bundled.year?[bundled.year]:[]),...annual.keys()])].sort();
  return {...bundled,years,autoManaged:true,holidayDates:[...days].filter(([,off])=>off).map(([d])=>d).sort(),workdayOverrides:[...days].filter(([,off])=>!off).map(([d])=>d).sort(),automaticUpdate:{enabled,source:'holiday-cn（整理国务院通知）',sourceUrl:'https://github.com/NateScarlet/holiday-cn',checkIntervalHours:24,years:[...checks].map(([year,state])=>({year,...state,available:years.includes(year)})),cachedYears:years}};
 }
 async function initialize(){
  const rows=await query("SELECT key,value_json FROM app_settings WHERE key LIKE 'china_work_calendar_data_%' OR key LIKE 'china_work_calendar_check_%' ORDER BY updated_at,rowid;");
  const versions=new Map();
  for(const row of rows){
   try{
    const record=JSON.parse(row.value_json);
    if(row.key.startsWith('china_work_calendar_data_')){const data=validateAnnualCalendar(record.data,record.year);const value={...record,data};annual.set(data.year,value);versions.set(row.key,value);}
    else if(Number.isInteger(record.year)&&record.checkedAt&&Number.isFinite(Date.parse(record.checkedAt)))checks.set(record.year,record);
   }catch{/* Preserve invalid cache records for diagnosis; use the last validated version. */}
  }
  for(const [year,state] of checks)if(versions.get(state.dataKey)?.year===year)annual.set(year,versions.get(state.dataKey));
  onChange(snapshot());
 }
 async function download(year){
  let error;
  for(const url of calendarSources(year)){
   try{
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(8000),redirect:'error',headers:{accept:'application/json'}});
    if(response.status===404)throw Error('not_published');
    if(!response.ok)throw Error('download_failed');
    let raw='',size=0;
    const decoder=new TextDecoder();
    if(response.body){for await(const chunk of response.body){size+=chunk.byteLength;if(size>262144)throw Error('calendar_too_large');raw+=decoder.decode(chunk,{stream:true});}raw+=decoder.decode();}
    else {raw=await response.text();if(Buffer.byteLength(raw)>262144)throw Error('calendar_too_large');}
    return {data:validateAnnualCalendar(JSON.parse(raw),year),sourceUrl:url};
   }catch(e){error=e;if(e.message==='not_published')throw e;}
  }
  throw error||Error('download_failed');
 }
 async function refresh(){
  if(!enabled)return snapshot();
  if(inflight)return inflight;
  inflight=(async()=>{
   const year=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric'}).format(now()));
   for(const target of [year,year+1]){
    const previous=checks.get(target),last=Date.parse(previous?.checkedAt||'');
    if(Number.isFinite(last)&&now().getTime()-last>=0&&now().getTime()-last<DAY)continue;
    let state={year:target,checkedAt:now().toISOString(),status:'updated',lastSuccessAt:previous?.lastSuccessAt||'',dataKey:previous?.dataKey||'',error:''};
    try{
     const record=await download(target),hash=createHash('sha256').update(JSON.stringify(record.data)).digest('hex');
     const value={...record,year:target,loadedAt:now().toISOString()};
     state.dataKey=`china_work_calendar_data_${target}_${hash}`;
     // Append each distinct validated annual version; never erase prior calendar data.
     await exec(`INSERT OR IGNORE INTO app_settings(key,value_json,updated_at) VALUES(${sql(state.dataKey)},${sql(JSON.stringify(value))},${sql(value.loadedAt)});`);
     annual.set(target,value);state.lastSuccessAt=now().toISOString();
    }catch(e){state.status=e.message==='not_published'?'not_published':'failed';state.error=['not_published','incomplete_calendar','invalid_calendar','calendar_too_large'].includes(e.message)?e.message:'download_failed';}
    await exec(`INSERT INTO app_settings(key,value_json,updated_at) VALUES(${sql(`china_work_calendar_check_${target}`)},${sql(JSON.stringify(state))},${sql(now().toISOString())}) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at;`);
    checks.set(target,state);onChange(snapshot());
   }
   return snapshot();
  })();
  try{return await inflight;}finally{inflight=null;}
 }
 return {initialize,refresh,snapshot};
}
