import {useEffect,useState} from 'react';
import {ReportRescorePanel} from './ReportRescorePanel';
type Status={config:{enabled:boolean;dailyAiRequestLimit?:number;scoringStartMonth?:string};aiRequestsToday?:number;lastAttemptAt:string|null;nextCheckAt:string|null;nextCheckKind?:'deadline'|'followup'|null;running:boolean};
const defaultDailyAiRequestLimit=60;
const maxDailyAiRequestLimit=500;
const dailyAiRequestLimitError=`每日 AI 评分请求上限须为 0–${maxDailyAiRequestLimit} 的整数。`;
const scoringStartMonthError='请选择有效的 AI 评分起始月。';
export function ReportAutomationSettings(){
 const [status,setStatus]=useState<Status|null>(null),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [dailyAiRequestLimit,setDailyAiRequestLimit]=useState(String(defaultDailyAiRequestLimit));
 const [scoringStartMonth,setScoringStartMonth]=useState('');
 const savedLimit=status?.config.dailyAiRequestLimit??defaultDailyAiRequestLimit;
 const scoringPaused=savedLimit===0;
 async function load(){const r=await fetch('/api/system-settings/report-automation');if(!r.ok)throw Error('无法读取自动收集设置');const j=await r.json() as Status;setStatus(j);setEnabled(j.config.enabled);setDailyAiRequestLimit(String(j.config.dailyAiRequestLimit??defaultDailyAiRequestLimit));setScoringStartMonth(j.config.scoringStartMonth??'');}
 useEffect(()=>{void load().catch(e=>setMessage(e.message));},[]);
 async function save(){
  const limit=Number(dailyAiRequestLimit);
  if(!dailyAiRequestLimit.trim()||!Number.isInteger(limit)||limit<0||limit>maxDailyAiRequestLimit){setMessage(dailyAiRequestLimitError);return;}
  if(status?.config.scoringStartMonth&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(scoringStartMonth)){setMessage(scoringStartMonthError);return;}
  setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/system-settings/report-automation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled,dailyAiRequestLimit:limit,scoringStartMonth:scoringStartMonth||undefined})}),j=await r.json();
   if(!r.ok)throw Error(({feishu_required:'请先配置飞书应用凭证',ai_required:'请先在「AI 配置」配置模型和密钥',invalid_ai_request_limit:dailyAiRequestLimitError,invalid_report_scoring_start_month:scoringStartMonthError} as Record<string,string>)[j.error]||'保存失败');
   await load();
   const collectionMessage=enabled?'已开启按截止日自动收集飞书周报。':'自动收集已关闭，仍可手动同步周报。';
   setMessage(limit===0?`周报 AI 评分已暂停。${collectionMessage}`:`每日周报 AI 评分请求上限已设为 ${limit} 次。${collectionMessage}`);
  }catch(e){setMessage(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
 }
 const format=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 const nextCheckLabel=status?.nextCheckKind==='deadline'?'（截止后收集）':status?.nextCheckKind==='followup'?'（工作日补拉）':'';
 return <article className="panel system-config" aria-label="周报自动收集与AI评分"><div className="panel-heading"><div><span className="v2-eyebrow">按截止日收集</span><h2>周报自动收集与 AI 评分</h2><p className="pf-caption">飞书周报同步后，AI 分析四个模块并汇总月度候选分。最终分由管理人员确认。</p></div><span className="pf-subtle-tag">{scoringPaused?'周报 AI 评分已暂停':status?.running?'正在收集与分析':status?.config.enabled?'自动收集已开启':'自动收集未开启'}</span></div>
  {message&&<p role="status" className="pf-notice">{message}</p>}
  {status?<>
   <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} disabled={busy}/> 开启周报自动收集</label>
   <p className="pf-caption">周报实际截止后 5 分钟拉取，通常为周五 20:05，节假日按工作日历调整。下一个工作日 09:00 补拉迟交和更新的周报。时间均为北京时间。</p>
   <div className="pf-form">
    <label>每日 AI 评分请求上限<input type="number" min="0" max={maxDailyAiRequestLimit} step="1" value={dailyAiRequestLimit} disabled={busy} onChange={e=>setDailyAiRequestLimit(e.target.value)}/></label>
    <label>AI 评分起始月<input type="month" value={scoringStartMonth} disabled={busy} onChange={e=>setScoringStartMonth(e.target.value)}/></label>
    <div className="pf-caption">最近自动收集：{status.lastAttemptAt?format(status.lastAttemptAt):'尚未运行'}<br/>下次自动收集：{!status.config.enabled?'自动收集已关闭':status.nextCheckAt?`${format(status.nextCheckAt)}${nextCheckLabel}`:'待排期'}</div>
    <div className="pf-caption">
     {typeof status.aiRequestsToday==='number'&&<><strong>今日已用 {status.aiRequestsToday}{scoringPaused?'':` / ${savedLimit}`} 次</strong><br/></>}
     设为 0 会持续暂停自动评分和手动补跑，设为正数后可恢复。自动评分和手动补跑共用请求上限，重试也计数。请求次数每天北京时间 0 点重置。
    </div>
   </div>
   <p className="pf-caption">系统检查近 45 天提交的汇报，按周次结束日期判断是否达到评分起始月。更早的周报保留历史分数。已通过的同版本评分会复用。每轮最多重试 1 次，同一版本累计 2 次返回校验失败或请求异常后停止自动重试。飞书提醒独立设置。</p>
   <div className="sync-actions"><button type="button" className="primary-button" disabled={busy} onClick={()=>void save()}>保存自动收集设置</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>void load().catch(e=>setMessage(e.message))}>刷新收集状态</button></div>
  </>:<p>正在读取配置…</p>}
 <ReportRescorePanel scoringPaused={status ? scoringPaused : undefined} scoringStartMonth={status?.config.scoringStartMonth}/>
 </article>;
}
