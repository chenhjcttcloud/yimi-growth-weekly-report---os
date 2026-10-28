import { useEffect, useState } from 'react';
import { AppSelect } from '../components/AppSelect';
import { CalendarDays, CheckCheck, Clock3, FileCheck2, Sprout, UsersRound } from 'lucide-react';
import type { PersonalModule } from '../lib/types';
import { PersonalMonthWorkspace } from '../components/PersonalMonthWorkspace';
import { monthText, ResultEmpty, ResultMetric, ResultStatus, scoreText, SubmissionCounts } from '../components/PerformanceUI';

export function FinalResultsPage({ module, onOpenModule, previewEmployeeId }: { previewEmployeeId?:string; module?: PersonalModule; onOpenModule: (module: PersonalModule) => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState(false);
  const [month, setMonth] = useState('');
  const [weekId, setWeekId] = useState('');
  const [revision, setRevision] = useState(0);
  const [reminderBusy,setReminderBusy]=useState(false),[reminderMessage,setReminderMessage]=useState('');
  async function remind(){if(previewEmployeeId)return;setReminderBusy(true);setReminderMessage('');try{const r=await fetch('/api/personal/collaboration/remind',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({month:selectedMonth})});const j=await r.json();if(!r.ok)throw Error(j.error==='reminder_not_due'?'尚未达到提醒时间或仍在冷却期，请稍后重试。':'提醒未完成，请稍后重试。');setReminderMessage(j.dryRun?`提醒预览：将通知 ${j.recipientCount} 位尚未评分的人员。当前未开启飞书发送，未发送消息。`:`已发送 ${j.sent} 条提醒${j.failed?`，${j.failed} 条失败，可稍后重试`:''}。`);setRevision(v=>v+1);}catch(e){setReminderMessage(e instanceof Error?e.message:'提醒未完成');}finally{setReminderBusy(false);}}
  const currentMonth = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit' }).format(new Date());
  const selectedMonth=month||currentMonth;
  useEffect(() => {
    const controller=new AbortController();setError(false);
    const params=new URLSearchParams({month:selectedMonth});if(weekId)params.set('weekId',weekId);
    if(previewEmployeeId)params.set('employeeId',previewEmployeeId);
    fetch(`${previewEmployeeId?'/api/admin/employee-preview/workspace':'/api/personal/workspace'}?${params}`,{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(setData).catch(error=>{if(error.name!=='AbortError')setError(true);});
    return ()=>controller.abort();
  },[selectedMonth,weekId,revision,previewEmployeeId]);
  if (!data || data.month!==selectedMonth) return <section className="v2-card pf-page"><ResultEmpty title={error ? '暂时无法加载结果' : '正在整理你的月度结果'} description={error ? '请刷新页面后重试。' : '已确认的成长记录即将呈现。'}/></section>;
  const current = data.history.find((r:any) => r.month === selectedMonth);
  const relevantHistory=data.history.filter((r:any)=>r.month<=selectedMonth);
  const rolling=relevantHistory.filter((r:any)=>r.quality!=null).slice(0,3);
  const rollingQuality=rolling.length?rolling.reduce((sum:number,r:any)=>sum+r.quality,0)/rolling.length:null;
  return <div className="v2-page v2-page-wide pf-page">
    <section className="pf-intro">
      <div><span className="v2-eyebrow"><Sprout size={14}/>我的成长记录</span><h2>{module ? {reports:"周报与互动",coach:"AI 教练",actions:"行动任务",timeline:"成长轨迹"}[module] : "每一份投入，都成为成长的刻度。"}</h2><p>{module ? "选择月份与周次，查看并推进自己的成长记录。" : "在这里，回看自己的月度成果与长期变化。"}</p></div>
      <label className="pf-month pf-month-select"><CalendarDays size={15}/><AppSelect aria-label="选择个人月份" value={selectedMonth} onValueChange={value=>{setMonth(value);setWeekId('');setReminderMessage('');}}>{data.months.map((m:string)=><option key={m} value={m}>{monthText(m)}</option>)}</AppSelect></label>
    </section>
    {!module && <><div className="pf-notice"><CheckCheck size={16}/><span>周报质量与提交统计自动计算，无需人工确认；月度综合评分按负责人或老板30%＋同事70%，全部完成后自动发布。每周周报、AI 建议和行动任务用于回看与推进。</span></div>
    <section className="pf-metrics">
      <ResultMetric icon={FileCheck2} label="周报质量分" value={scoreText(current?.quality)} unit="分" description={current?.quality == null ? '所选月份周报分析尚未完成' : '所选月份自动汇总的周报质量分'}>
        <span className="pf-caption">近 {rolling.length} 个月份滚动均分</span><strong className="pf-inline-number">{scoreText(rollingQuality)}<small> 分</small></strong>
      </ResultMetric>
      <ResultMetric icon={Clock3} label="周报提交及时率" value={scoreText(current?.timeliness?.rate)} unit="%" description={current?.timeliness?.pendingCalendar ? '工作日日历待更新，系统将自动重算' : current?.timeliness?.pendingTimestamp ? '原始提交时间待补齐，系统将自动重算' : current?.timeliness ? '所选月份准时提交 / 应提交次数' : '所选月份提交统计尚未发布'}><SubmissionCounts stats={current?.timeliness}/></ResultMetric>
      <ResultMetric icon={UsersRound} label="月度综合最终分" value={scoreText(current?.collaboration)} unit="分" description={current?.collaboration == null ? '所选月份结果尚未发布' : current?.collaborationRule==='legacy'?'历史已发布结果，保留原评分口径':'负责人或老板30%＋同事互评70%'}><span className="pf-caption">负责人或老板评分及同事互评全部完成后发布</span><ResultStatus confirmed={current?.collaboration != null} label={current?.collaboration!=null?'已发布':'等待评分完成'}/></ResultMetric>
    </section>
    {current?.collaboration==null&&data.ratingProgress&&<p className="pf-notice">同事互评（70%）：{data.ratingProgress.peerComplete?'已完成':'待完成'} · {data.ratingProgress.managerKind==='boss'?'老板':'负责人'}评分（30%）：{data.ratingProgress.managerComplete?'已完成':'待完成'}。两部分全部完成后才显示最终分。</p>}
    {data.collaborationProgress?.pending>0&&<section className="v2-card personal-rating-progress"><div><h3>月度评分进度 {data.collaborationProgress.submitted} / {data.collaborationProgress.expected}</h3><p>还有 {data.collaborationProgress.pending} 项评分未完成，负责人或老板30%与同事互评70%全部完成后才会合成最终分，无需人工确认。</p><p className="pf-caption">评分任务发起满 {data.collaborationProgress.waitHours} 小时后可提醒；同一评分人 {data.collaborationProgress.cooldownHours} 小时内最多提醒一次。{!data.collaborationProgress.reminderEnabled&&'当前飞书发送未开启，可先预览提醒。'}{!data.collaborationProgress.canRemind&&(data.collaborationProgress.reason==='cooldown'?' 当前仍在提醒冷却期。':data.collaborationProgress.reason==='missing_identity'?' 部分评分人飞书身份缺失，请联系管理员。':' 尚未达到提醒时间或评分周期未开放。')}</p></div><button className="primary-button" disabled={Boolean(previewEmployeeId)||reminderBusy||!data.collaborationProgress.canRemind} onClick={()=>void remind()}>{reminderBusy?'处理中…':data.collaborationProgress.reminderEnabled?'提醒未评分人员':'预览评分提醒'}</button></section>}
    {reminderMessage&&<p role="status" className="pf-notice">{reminderMessage}</p>}
    </>}
    <div id="personal-week-workspace"><PersonalMonthWorkspace readOnly={Boolean(previewEmployeeId)} module={module} onOpenModule={onOpenModule} key={data.selectedWeekId||data.month} data={data} onSelectWeek={setWeekId} onRefresh={()=>setRevision(v=>v+1)}/></div>

  </div>;
}
