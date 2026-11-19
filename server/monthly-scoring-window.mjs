const validMonth=month=>/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'');

// The final natural week begins on the Monday containing the month's last day.
// Store an explicit Shanghai offset so the host/server timezone never changes it.
export function monthlyScoringOpensAt(month){
 if(!validMonth(month))throw Error('invalid_month');
 const end=new Date(month+'-01T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1,0);
 const day=end.getUTCDate()-(end.getUTCDay()+6)%7;
 return month+'-'+String(day).padStart(2,'0')+'T00:00:00+08:00';
}

const timestamp=value=>{
 const text=String(value||'').trim();
 if(!text)return NaN;
 // SQLite datetime('now') values are UTC even when the process timezone is not.
 return Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)?text.replace(' ','T')+'Z':text);
};

export function createMonthlyScoringWindow({query,sql,now=()=>new Date()}){
 const cycleSelection=month=>`SELECT id FROM scoring360_cycles WHERE substr(start_date,1,7)=${sql(month)} ORDER BY CASE WHEN id=${sql(month+'-360')} THEN 0 ELSE 1 END,created_at DESC LIMIT 1`;
 function guardSql(month,cycleId){
  const opensAt=monthlyScoringOpensAt(month),clock=now(),current=clock.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
  if(month>current||month===current&&clock.getTime()<Date.parse(opensAt))return '0';
  return `EXISTS(SELECT 1 FROM scoring360_cycles WHERE id=(${cycleSelection(month)}) ${cycleId?`AND id=${sql(cycleId)}`:''} AND status IN('open','active') AND julianday(NULLIF(launch_at,''))<=julianday(${sql(clock.toISOString())}))`;
 }
 async function status(month){
  const opensAt=monthlyScoringOpensAt(month),clock=now(),current=clock.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
  const rows=await query(`SELECT id,status,launch_at FROM scoring360_cycles WHERE substr(start_date,1,7)=${sql(month)} ORDER BY CASE WHEN id=${sql(month+'-360')} THEN 0 ELSE 1 END,created_at DESC LIMIT 1;`);
  const cycle=rows[0],launchAt=cycle?.launch_at||'';
  const reason=month>current?'future_month':month===current&&clock.getTime()<Date.parse(opensAt)?'before_window':!cycle?'missing_cycle':!['open','active'].includes(cycle.status)?cycle.status||'not_open':!Number.isFinite(timestamp(launchAt))?'missing_launch':timestamp(launchAt)>clock.getTime()?'launch_pending':'';
  return {month,opensAt,isOpen:!reason,reason,cycleId:cycle?.id||'',status:cycle?.status||'',launchAt};
 }
 async function assertOpen(month){const value=await status(month);if(!value.isOpen)throw Error('scoring_cycle_not_open');return value;}
 return {status,assertOpen,guardSql};
}
