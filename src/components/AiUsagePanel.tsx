import {useEffect,useState} from 'react';

const moduleLabels={
 report_scoring:'周报 AI 评分',
 management_summary:'管理摘要',
 personal_coach:'个人 AI 教练',
 task_followup:'任务追问',
};

type UsageModule={
 module:keyof typeof moduleLabels;
 requests:number;
 failed:number;
 unreported:number;
 inputTokens:number;
 outputTokens:number;
 cachedInputTokens:number;
 totalTokens:number;
};
type UsageRange=7|30;
type UsageResult={ok:true;days:UsageRange;startDate:string;endDate:string;modules:UsageModule[]};
const formatCount=new Intl.NumberFormat('zh-CN');

export function AiUsagePanel(){
 const [days,setDays]=useState<UsageRange>(30);
 const [reload,setReload]=useState(0);
 const [result,setResult]=useState<UsageResult|null>(null);
 const [error,setError]=useState(false);

 useEffect(()=>{
  const controller=new AbortController();
  setResult(null);setError(false);
  async function load(){
   try{
    const response=await fetch(`/api/system-settings/ai/usage?days=${days}`,{signal:controller.signal});
    if(!response.ok)throw Error();
    const data=await response.json() as UsageResult;
    if(data.ok!==true||data.days!==days||!Array.isArray(data.modules))throw Error();
    if(!controller.signal.aborted)setResult(data);
   }catch{if(!controller.signal.aborted)setError(true);}
  }
  void load();
  return()=>controller.abort();
 },[days,reload]);

 const current=result?.days===days?result:null;
 const rows=current?[...current.modules].sort((a,b)=>b.totalTokens-a.totalTokens):[];
 const mostTokens=rows[0]?.totalTokens??0;
 const mostUsed=mostTokens>0?rows.filter(row=>row.totalTokens===mostTokens):[];
 const loading=!current&&!error;

 return <section className="ai-settings-section" aria-label="AI 用量统计" aria-busy={loading}>
  <div className="ai-settings-heading">
   <div><h3>AI 用量统计</h3><p className="pf-caption">按模块汇总，按已报告的 Token 总量从高到低排列。</p></div>
   <div className="ai-settings-actions" role="group" aria-label="AI 用量统计范围">
    {([7,30] as const).map(range=><button key={range} type="button" className="secondary-button" aria-pressed={days===range} onClick={()=>setDays(range)}>近 {range} 天</button>)}
    <button type="button" className="secondary-button" disabled={loading} onClick={()=>setReload(value=>value+1)}>刷新用量</button>
   </div>
  </div>
  {loading&&<p className="pf-caption" role="status">正在读取 AI 用量…</p>}
  {error&&<p className="pf-error" role="alert">无法读取 AI 用量，请刷新重试。</p>}
  {current&&<>
   <p className="pf-caption">{current.startDate} 至 {current.endDate}（北京时间）</p>
   {mostUsed.length>0?<p className="pf-notice">{mostUsed.map(row=>moduleLabels[row.module]).join('、')}{mostUsed.length===1?'用量最多':'并列用量最多'}，{mostUsed.length>1?'各 ':''}{formatCount.format(mostTokens)} Token。</p>:<p className="pf-notice">{rows.some(row=>row.requests>0)?'所选时段暂无可统计的 Token 用量。':'所选时段暂无调用记录。'}</p>}
   <div className="ai-usage-grid">
    {rows.map(row=><article className="ai-usage-module" key={row.module}>
     <div className="ai-settings-heading"><h4>{moduleLabels[row.module]}</h4><span><strong>{formatCount.format(row.totalTokens)}</strong> Token</span></div>
     <dl>{([
      ['请求次数',row.requests],['接口失败',row.failed],['用量不完整（次）',row.unreported],
      ['输入 Token',row.inputTokens],['输出 Token',row.outputTokens],['缓存命中 Token',row.cachedInputTokens],
     ] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatCount.format(value)}</dd></div>)}</dl>
    </article>)}
   </div>
  </>}
  <p className="pf-caption">仅统计用量功能上线后的调用。Token 合计按上游已报告的用量计算，输入或输出缺失的请求另列次数。缓存命中属于输入 Token。接口失败包括网络、HTTP 或响应解析错误。评分结果未通过业务校验时，已报告的用量仍计入。</p>
 </section>;
}
