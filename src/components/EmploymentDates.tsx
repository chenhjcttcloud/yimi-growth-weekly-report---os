import {useState} from 'react';
export type EmploymentPeriod={start_date:string;end_date?:string|null;source:string};
export function EmploymentDates({userId,active,periods,onSaved}:{userId:string;active:boolean;periods:EmploymentPeriod[];onSaved:()=>Promise<void>}){
 const ordered=[...periods].sort((a,b)=>b.start_date.localeCompare(a.start_date));
 const period=ordered.find(item=>!item.end_date)||ordered[0];const [start,setStart]=useState(period?.start_date||''),[end,setEnd]=useState(period?.end_date||''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function save(){setBusy(true);setMessage('');try{const r=await fetch('/api/employees/employment-dates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId,startDate:start,endDate:active?'':end})}),j=await r.json();if(!r.ok)throw Error(j.error==='invalid_employment_dates'?'请检查起止日期，入职日期不能晚于今天':'日期未保存，请检查人员状态后重试');await onSaved();setMessage('在职日期已保存，提交统计将按在职期间计算。');}catch(e){setMessage(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}}
 const restored=period?.source==='manager_restore';
 const verified=Boolean(period&&['manager','feishu','manager_restore'].includes(period.source));
 const origin=period?.source==='report'?'最早周报记录':period&&['sso','first_seen'].includes(period.source)?'首次发现日期':'统计起始日期';
 return <details className="employment-dates">
  <summary>{restored?'恢复日期':verified?'在职日期':origin} · {period?.start_date||'待核实'}{verified?' 起':''}{period?.end_date?` 至 ${period.end_date}`:''}{!verified?'（待核实）':''}</summary>
  <p className="pf-caption">{restored?'从恢复当天起参与后续统计，停用期间不补记缺交；历史结果保留。':verified?'入职前和离职后的周报不计为缺交；已有发布结果保留。':'该日期仅作为暂定统计起点，可能来自首次收录或最早周报记录，并非已核实的入职日期。请核实后保存；已有发布结果保留。'}</p>
  {periods.length>1||restored?<>
   <ol className="employment-period-history" aria-label="在职区间记录">{ordered.map((item,index)=><li key={`${item.start_date}-${item.end_date||''}-${index}`}><span>{item.start_date} — {item.end_date||'至今'}</span><small>{item.source==='manager_restore'?'恢复使用':item.end_date?'历史区间':'当前区间'}</small></li>)}</ol>
   <p className="pf-caption">已保留 {periods.length} 段在职记录，停用间隔不计缺交。在职区间在此只读展示。</p>
  </>:<div className="month-end-controls"><label>入职日期<input aria-label="入职日期" type="date" max={new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})} value={start} onChange={e=>setStart(e.target.value)}/></label>{!active&&<label>最后工作日<input aria-label="最后工作日" type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>}<button type="button" className="secondary-button" disabled={busy||!start} onClick={()=>void save()}>保存在职日期</button></div>}
  {message&&<p role="status">{message}</p>}
 </details>;
}
