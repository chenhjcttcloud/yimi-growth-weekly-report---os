import { CalendarClock, RefreshCw } from 'lucide-react';
import {useEffect,useId,useState} from 'react';
import {ReportRescorePanel} from './ReportRescorePanel';
import '../styles/feishu-settings.css';
import '../styles/feishu-automation.css';
type Status={config:{enabled:boolean;scoringPaused?:boolean;dailyAiRequestLimit?:number;scoringStartMonth?:string};aiRequestsToday?:number;lastAttemptAt:string|null;nextCheckAt:string|null;nextCheckKind?:'deadline'|'followup'|null;running:boolean};
const scoringStartMonthError='请选择有效的 AI 评分起始月。';
export function ReportAutomationSettings(){
 const [status,setStatus]=useState<Status|null>(null),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [scoringPaused,setScoringPaused]=useState(false);
 const [scoringStartMonth,setScoringStartMonth]=useState('');
 const controlId=useId();
 const savedScoringPaused=status?.config.scoringPaused??(status?.config.dailyAiRequestLimit===0);
 async function load(){const r=await fetch('/api/system-settings/report-automation');if(!r.ok)throw Error('无法读取自动收集设置');const j=await r.json() as Status;setStatus(j);setEnabled(j.config.enabled);setScoringPaused(j.config.scoringPaused??(j.config.dailyAiRequestLimit===0));setScoringStartMonth(j.config.scoringStartMonth??'');}
 useEffect(()=>{void load().catch(e=>setMessage(e.message));},[]);
 async function save(){
  if(status?.config.scoringStartMonth&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(scoringStartMonth)){setMessage(scoringStartMonthError);return;}
  setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/system-settings/report-automation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled,scoringPaused,scoringStartMonth:scoringStartMonth||undefined})}),j=await r.json();
   if(!r.ok)throw Error(({feishu_required:'请先配置飞书应用凭证',ai_required:'请先在「AI 配置」配置模型和密钥',invalid_report_scoring_pause:'请选择是否暂停周报 AI 评分。',invalid_report_scoring_start_month:scoringStartMonthError} as Record<string,string>)[j.error]||'保存失败');
   await load();
   const collectionMessage=enabled?'已开启按截止日自动收集飞书周报。':'自动收集已关闭，仍可手动同步周报。';
   setMessage(scoringPaused?`周报 AI 评分已暂停。${collectionMessage}`:collectionMessage);
  }catch(e){setMessage(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
 }
 const format=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 const nextCheckLabel=status?.nextCheckKind==='deadline'?'（截止后收集）':status?.nextCheckKind==='followup'?'（工作日补拉）':'';
 return (
  <article className="panel system-config feishu-settings-panel fi-automation" aria-label="周报自动收集与AI评分">
   <div className="panel-heading feishu-settings-heading">
    <div className="feishu-settings-title">
     <span className="feishu-settings-icon"><CalendarClock size={18} aria-hidden="true"/></span>
     <div>
      <h2>周报自动收集与 AI 评分</h2>
      <p className="feishu-settings-note">飞书周报同步后，AI 分析四个模块并汇总月度候选分。最终分由管理人员确认。</p>
     </div>
    </div>
    {status&&<span className="pf-subtle-tag fi-automation-status" data-active={status.config.enabled&&!savedScoringPaused}>
     {savedScoringPaused?'周报 AI 评分已暂停':status.running?'正在收集与分析':status.config.enabled?'自动收集已开启':'自动收集未开启'}
    </span>}
   </div>
   {status?(
    <div className="fi-automation-body">
     <div className="fi-automation-grid">
      <div className="feishu-settings-toggle fi-automation-toggle">
       <div className="fi-automation-toggle-copy">
        <label htmlFor={`${controlId}-collect`}>开启周报自动收集</label>
        <p id={`${controlId}-collect-note`}>截止后 5 分钟收集，通常为周五 20:05，节假日按工作日历调整。下一个工作日 09:00 补拉迟交和更新的周报。</p>
       </div>
       <input id={`${controlId}-collect`} type="checkbox" checked={enabled} aria-describedby={`${controlId}-collect-note`} onChange={e=>setEnabled(e.target.checked)} disabled={busy}/>
      </div>
      <div className="feishu-settings-toggle fi-automation-toggle">
       <div className="fi-automation-toggle-copy">
        <label htmlFor={`${controlId}-pause`}>暂停周报 AI 评分</label>
        <p id={`${controlId}-pause-note`}>暂停时仍可收集周报，取消暂停后可继续评分和补跑。</p>
       </div>
       <input id={`${controlId}-pause`} type="checkbox" checked={scoringPaused} aria-describedby={`${controlId}-pause-note`} onChange={e=>setScoringPaused(e.target.checked)} disabled={busy}/>
      </div>
     </div>
     <div className="fi-automation-grid fi-automation-details">
      <div className="fi-automation-month">
       <label className="feishu-settings-field fi-automation-month-field">
        AI 评分起始月
        <input type="month" value={scoringStartMonth} disabled={busy} aria-describedby={`${controlId}-month-note`} onChange={e=>setScoringStartMonth(e.target.value)}/>
       </label>
       <p id={`${controlId}-month-note`}>系统检查近 45 天提交的周报，按周次结束日期判断是否达到评分起始月。更早的周报保留历史分数。</p>
      </div>
      <div className="fi-automation-activity">
       <div className="fi-automation-activity-heading">
        <h3>收集与评分状态</h3>
        <span>北京时间</span>
       </div>
       <dl className="fi-automation-schedule">
        <div>
         <dt>最近自动收集</dt>
         <dd>{status.lastAttemptAt?format(status.lastAttemptAt):'尚未运行'}</dd>
        </div>
        <div>
         <dt>下次自动收集</dt>
         <dd>{!status.config.enabled?'自动收集已关闭':status.nextCheckAt?`${format(status.nextCheckAt)}${nextCheckLabel}`:'待排期'}</dd>
        </div>
       </dl>
       {typeof status.aiRequestsToday==='number'&&<strong className="fi-automation-requests">今日评分请求 {status.aiRequestsToday} 次</strong>}
      </div>
     </div>
     <p className="fi-automation-policy">每批请求数按实际待评分的有效周报计算，已通过的同版本评分直接复用。每份周报首次评分失败后最多重试 1 次，同一版本累计 2 次校验失败或普通请求异常后停止自动重试。飞书提醒另行设置。</p>
     <div className="feishu-settings-actions fi-automation-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={()=>void save()}>保存自动收集设置</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>void load().catch(e=>setMessage(e.message))}>
       <RefreshCw size={14} aria-hidden="true"/> 刷新收集状态
      </button>
     </div>
    </div>
   ):!message&&<p className="pf-caption">正在读取配置…</p>}
   {message&&<p role="status" className="pf-notice">{message}</p>}
   <ReportRescorePanel scoringPaused={status?savedScoringPaused:undefined} scoringStartMonth={status?.config.scoringStartMonth}/>
  </article>
 );
}
