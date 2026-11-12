import '../styles/scoring-workbench.css';
import {locationValue,rememberLocation,scoreTargetFromLocation,useLocationSection} from '../lib/navigation';
import {ManagerReviewsPanel} from '../components/ManagerReviewsPanel';
import {ResultEmployeeDirectory} from '../components/ResultEmployeeDirectory';
import {DepartmentScoreTrends} from '../components/DepartmentScoreTrends';
import {BossLeaderScoringPanel} from '../components/BossLeaderScoringPanel';
import {ReviewMonthPicker} from '../components/ReviewMonthPicker';
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {DeferredEvidence} from '../components/DeferredEvidence';
import {ManagedQualityReport} from '../components/ManagedQualityReport';
import {MonthlyQualityResultRow, monthlyQualityView, qualityDate, qualityReviewNotice, type MonthlyQualitySummary} from '../components/MonthlyQuality';
const ManualScoringSetup=lazy(()=>import('../components/ManualScoringSetup').then(module=>({default:module.ManualScoringSetup})));
import { AppSelect } from '../components/AppSelect';
import { CalendarDays, ChevronRight, Clock3, FileCheck2, History, ShieldCheck, UsersRound } from 'lucide-react';
import { monthText, ResultEmpty, ResultMetric, ResultStatus, scoreText, SubmissionCounts } from '../components/PerformanceUI';
import { ScoringTasksPage } from './ScoringTasksPage';
export function PerformanceManagementPage({isBoss=false}:{isBoss?:boolean}={}){
 const [tab,setTab]=useLocationSection('scoreTab',['leaders','results','setup'] as const,isBoss&&!scoreTargetFromLocation()?'leaders':'results');
 const lastCompleteMonth=()=>{const current=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7),date=new Date(current+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7);};
 const [leaderMonth,setLeaderMonth]=useState(()=>locationValue('scoreMonth')||lastCompleteMonth());
 const [leaderBusy,setLeaderBusy]=useState(false),[leadersOpened,setLeadersOpened]=useState(tab==='leaders');
 const currentMonth=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7);
 useEffect(()=>{if(tab==='leaders'){setLeadersOpened(true);const requestedMonth=locationValue('scoreMonth');if(requestedMonth)setLeaderMonth(requestedMonth);else rememberLocation('scoreMonth',leaderMonth);}},[tab]);
 useEffect(()=>{const restore=()=>setLeaderMonth(locationValue('scoreMonth')||lastCompleteMonth());window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[]);
 useEffect(()=>{
  const open=()=>setTab('results'),openLeaders=()=>{if(isBoss){setLeaderMonth(locationValue('scoreMonth')||lastCompleteMonth());setTab('leaders');}};
  window.addEventListener('score-result-target',open);window.addEventListener('score-leaders-target',openLeaders);
  return()=>{window.removeEventListener('score-result-target',open);window.removeEventListener('score-leaders-target',openLeaders);};
 },[isBoss]);
 function changeTab(next:'leaders'|'results'|'setup'){
  if(leaderBusy||next===tab)return;
  if(!window.dispatchEvent(new Event('organization-before-leave',{cancelable:true})))return;
  if(next==='leaders')setLeaderMonth(locationValue('scoreMonth')||leaderMonth);
  setTab(next);
 }
 return <div className="scoring-management-shell">
  <nav className="scoring-workbench-tabs" role="tablist" aria-label="评分工作台模块">{([['leaders','负责人评分'],['results','得分结果'],['setup','月度配评']] as const).map(([key,label])=><button type="button" role="tab" key={key} aria-selected={tab===key} disabled={leaderBusy} onClick={()=>changeTab(key)}>{label}</button>)}</nav>
  {leadersOpened&&<div hidden={tab!=='leaders'}><div className="boss-score-intro"><div><h2>负责人评分</h2><p>选择月份与负责人，记录本月表现与改进建议。</p></div><div className="boss-score-month"><span>评分月份</span><ReviewMonthPicker aria-label="负责人评分月份" value={leaderMonth} max={currentMonth} disabled={leaderBusy} onChange={value=>{rememberLocation('scoreMonth',value);setLeaderMonth(value);}}/></div></div><BossLeaderScoringPanel month={leaderMonth} onBusyChange={setLeaderBusy} active={tab==='leaders'}/></div>}
  {tab==='setup'?<Suspense fallback={<p role="status">正在加载月度配评…</p>}><ManualScoringSetup/></Suspense>:tab==='results'?<PerformanceResults/>:null}
 </div>;
}

type PerformanceOverview={scopeMonth?:string;months:string[];employees:any[];monthly:any[];collaborations:any[];results:any[]};

function scoreMonthFromLocation(){
 const month=locationValue('scoreMonth');
 return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:'';
}

export function PerformanceResults({scoreFocus}:{scoreFocus?:'quality'|'collaboration'}={}){
 const resultTabs=([['review','结果概览'],['reports','周报与证据'],['collaboration','协作明细'],['history','结果记录']] as const).filter(([key])=>!scoreFocus||key!==(scoreFocus==='quality'?'collaboration':'reports'));
 const restoredTab=(value?:'review'|'reports'|'collaboration'|'history')=>resultTabs.some(([key])=>key===value)?value!:'review';
 const requested=scoreTargetFromLocation();
 const [request,setRequest]=useState(()=>({month:scoreMonthFromLocation()}));
 const [overview,setOverview]=useState<{request:typeof request;data:PerformanceOverview}|null>(null);
 const [failedRequest,setFailedRequest]=useState<typeof request|null>(null);
 // A legacy response contains every month. A scoped response belongs to a
 // single selection, even if the user switches away and back before it loads.
 const data=overview&&(overview.data.scopeMonth===undefined||overview.request===request)?overview.data:null;
 const needsOverview=data===null;
 const month=data?.scopeMonth??(request.month||data?.months[0]||'');
 const error=failedRequest===request?'读取月度结果失败，请重试。':'';
 const availableMonths=overview?.data.months||[];
 const monthOptions=month&&!availableMonths.includes(month)?[...availableMonths,month].sort().reverse():availableMonths;
 const [managerReviewBusy,setManagerReviewBusy]=useState(false);
 useEffect(()=>{
  if(!managerReviewBusy)return;
  const stay=(event:Event)=>event.preventDefault();
  window.addEventListener('organization-before-leave',stay);
  return()=>window.removeEventListener('organization-before-leave',stay);
 },[managerReviewBusy]);
 const [selectedName,setSelectedName]=useState(()=>requested?.userId||''),[legacyName,setLegacyName]=useState(()=>requested?.name||''),[explicitTarget,setExplicitTarget]=useState(Boolean(requested));
 const [weekId,setWeekId]=useState(()=>requested?.weekId||locationValue('scoreWeekId'));
 const [tab,setTab]=useState<'review'|'reports'|'collaboration'|'history'>(()=>restoredTab(requested?.tab));
 const [tasksOpened,setTasksOpened]=useState(false),[detailRetry,setDetailRetry]=useState(0);
 const [detailState,setDetailState]=useState<{key:string;source:any;status:'loading'|'ready'|'error';value?:any;error?:string}|null>(null);
 const detailCache=useRef(new Map<string,{source:any;value:any}>());
 useEffect(()=>{
  if(!needsOverview)return;
  const controller=new AbortController();
  const requestedMonth=request.month;
  const params=new URLSearchParams({view:'overview',month:requestedMonth||'latest'});
  void fetch('/api/performance/manage?'+params,{signal:controller.signal}).then(async response=>{
   const result=await response.json();
   if(!response.ok||!Array.isArray(result.months)||!Array.isArray(result.monthly)||!Array.isArray(result.collaborations)||!Array.isArray(result.results)||!Array.isArray(result.employees)||
      (result.scopeMonth!==undefined&&(typeof result.scopeMonth!=='string'||(requestedMonth&&result.scopeMonth!==requestedMonth))))throw Error('invalid_performance_overview');
   if(!controller.signal.aborted)setOverview({request,data:result});
  }).catch(()=>{if(!controller.signal.aborted)setFailedRequest(request);});
  return()=>controller.abort();
 },[request,needsOverview]);
 useEffect(()=>{
  const restore=()=>{
   const target=scoreTargetFromLocation();
   const requestedMonth=scoreMonthFromLocation();
   setRequest(current=>current.month===requestedMonth||(current===request&&month===requestedMonth)?current:{month:requestedMonth});
   setSelectedName(target?.userId||'');setLegacyName(target?.name||'');setExplicitTarget(Boolean(target));
   setWeekId(target?.weekId||locationValue('scoreWeekId'));setTab(restoredTab(target?.tab));setDetailState(null);
  };
  window.addEventListener('score-result-target',restore);window.addEventListener('popstate',restore);
  return()=>{window.removeEventListener('score-result-target',restore);window.removeEventListener('popstate',restore);};
 },[scoreFocus,request,month]);
 const rows:any[]=(data?.monthly||[]).filter((r:any)=>r.month===month);
 const matchingNames=legacyName?rows.filter((r:any)=>r.name===legacyName):[];
 const selected=selectedName?rows.find((r:any)=>r.userId===selectedName):explicitTarget?(matchingNames.length===1?matchingNames[0]:undefined):rows[0];
 const requestedWeekEnd=/\d{4}-\d{2}-\d{2}/.exec(weekId)?.[0]||'';
 useEffect(()=>{if(!month)return;rememberLocation('scoreTarget',explicitTarget?'1':'');rememberLocation('scoreMonth',month);rememberLocation('scoreEmployeeId',selected?.userId||selectedName);rememberLocation('scoreEmployeeName',selected?.name||legacyName);rememberLocation('scoreDetailTab',tab);rememberLocation('scoreWeekId',weekId);},[month,selected?.userId,selectedName,legacyName,explicitTarget,tab,weekId]);
 const activeCycles:any[]=(data?.collaborations||[]).filter((c:any)=>c.month===month);
 const reportDetailsNeeded=Boolean(selected?.reports?.some((report:any)=>!Array.isArray(report.evidence)));
 const collaborationDetailsNeeded=activeCycles.some((cycle:any)=>!Array.isArray(cycle.assignments));
 const needsDetails=tab==='reports'&&reportDetailsNeeded||tab==='collaboration'&&collaborationDetailsNeeded;
 const detailKey=selected?month+'|'+selected.userId:'';
 useEffect(()=>{detailCache.current.clear();},[data]);
 useEffect(()=>{
  if(!data||!selected||!detailKey||!needsDetails)return;
  const cached=detailCache.current.get(detailKey);
  if(cached&&cached.source===data){setDetailState({key:detailKey,source:data,status:'ready',value:cached.value});return;}
  const controller=new AbortController(),userId=selected.userId,requestedMonth=month;
  setDetailState({key:detailKey,source:data,status:'loading'});
  const params=new URLSearchParams({employeeId:userId,month:requestedMonth});
  void fetch('/api/performance/employee-month?'+params,{signal:controller.signal}).then(async response=>{
   const result=await response.json();
   if(!response.ok)throw Error(response.status===403?'没有查看该员工月度资料的权限。':'读取该员工本月资料失败，请重试。');
   if(result.monthly?.userId!==userId||result.monthly?.month!==requestedMonth||!Array.isArray(result.monthly?.reports)||result.monthly.reports.some((report:any)=>!Array.isArray(report.evidence)||!Array.isArray(report.anomalies))||!Array.isArray(result.collaborations)||result.collaborations.some((cycle:any)=>!Array.isArray(cycle.assignments)))throw Error('所选员工的月度资料暂不可用，请重试。');
   if(controller.signal.aborted)return;
   detailCache.current.set(detailKey,{source:data,value:result});
   setDetailState({key:detailKey,source:data,status:'ready',value:result});
  }).catch(reason=>{if(!controller.signal.aborted)setDetailState({key:detailKey,source:data,status:'error',error:reason instanceof Error?reason.message:'读取该员工本月资料失败，请重试。'});});
  return()=>controller.abort();
 },[data,detailKey,needsDetails,detailRetry]);
 const cachedDetail=detailCache.current.get(detailKey);
 const currentDetail=detailState?.key===detailKey&&detailState.source===data?detailState:null;
 const loadedDetail=currentDetail?.status==='ready'?currentDetail.value:cachedDetail&&cachedDetail.source===data?cachedDetail.value:null;
 const detailError=currentDetail?.status==='error'?currentDetail.error:'';
 const reportRows=reportDetailsNeeded?loadedDetail?.monthly?.reports||[]:selected?.reports||[];
 const collaborationRows=collaborationDetailsNeeded?loadedDetail?.collaborations||[]:activeCycles;
 const detailPlaceholder=<div className="pf-evidence-list">{detailError?<div role="alert" className="pf-error"><p>{detailError}</p><button type="button" className="secondary-button" onClick={()=>setDetailRetry(value=>value+1)}>重试读取资料</button></div>:<p role="status" className="pf-caption">正在读取{selected?.name||'所选员工'}的本月资料…</p>}</div>;
 useEffect(()=>{if(tab==='reports'&&requestedWeekEnd&&(!reportDetailsNeeded||loadedDetail))document.querySelector(`[data-report-week="${requestedWeekEnd}"]`)?.scrollIntoView({block:'nearest'});},[tab,requestedWeekEnd,selected?.userId,loadedDetail,reportDetailsNeeded]);
 const totals=rows.reduce((a:any,r:any)=>{for(const k of ['expected','submitted','onTime','late','missing'])a[k]=(a[k]||0)+r.timeliness[k];return a;},{});
 const published=(data?.results||[]).filter((r:any)=>r.month===month&&(!scoreFocus||r.kind===scoreFocus));
 const mean=(kind:string)=>{const xs=published.filter((r:any)=>r.kind===kind&&r.result.score!=null);return xs.length?(xs.reduce((n:number,r:any)=>n+r.result.score,0)/xs.length).toFixed(1):'—';};
 const summaries:MonthlyQualitySummary[]=rows.flatMap(row=>row.quality?[row.quality]:[]);
 const pending=summaries.reduce((n,quality)=>n+quality.pendingAnalysis,0);
 const scoredSummaries=summaries.filter(quality=>quality.currentAverage!=null||quality.finalScore!=null);
 const allQualityConfirmed=Boolean(scoredSummaries.length)&&pending===0&&scoredSummaries.every(quality=>monthlyQualityView(quality).confirmed);
 const analyzed=summaries.reduce((n,quality)=>n+quality.analyzedCount,0);
 const qualityMean=allQualityConfirmed?mean('quality'):scoreText(analyzed?summaries.reduce((sum,quality)=>sum+(quality.currentAverage??0)*quality.analyzedCount,0)/analyzed:null);
 const kinds=[['quality','周报质量'],['timeliness','提交及时率'],['collaboration','月度综合评分']].filter(([kind])=>!scoreFocus||kind===scoreFocus);
 const selectedQuality=monthlyQualityView(selected?.quality);
 const reloadOverview=()=>{setOverview(null);setFailedRequest(null);setRequest(current=>current===request?{month}:{...current});};
 const pendingPeople=[...new Set(activeCycles.flatMap((c:any)=>c.pending))] as string[];
 const locked=(kind:string)=>published.find((x:any)=>x.employee_user_id===selected?.userId&&x.kind===kind);
 const pct=totals.expected?(totals.submitted/totals.expected*100).toFixed(1):'—';
 const timePct=rows.some((r:any)=>r.timeliness.pendingTimestamp||r.timeliness.pendingCalendar)?'—':totals.expected?(totals.onTime/totals.expected*100).toFixed(1):'—';
 return <div className="v2-page v2-page-wide pf-page">
  <section className="pf-intro"><div><span className="v2-eyebrow"><ShieldCheck size={14}/>月度得分</span><h2>{scoreFocus==='quality'?'周报质量':scoreFocus==='collaboration'?'360 协同得分':'让每一份结果，都有据可依。'}</h2><p>{scoreFocus==='quality'?'按员工复核 AI 评分依据，分析和汇总完成后确认月度最终分。':scoreFocus==='collaboration'?'按月份和员工查看协同最终分、评分进度与协作明细。':'查看周报质量、提交及时率和协作评分。'}</p></div>{overview&&monthOptions.length>0&&<label className="pf-month pf-month-select"><CalendarDays size={16}/><AppSelect aria-label="选择绩效月份" disabled={managerReviewBusy} value={month} placeholder="最新月份" onValueChange={value=>{setRequest({month:value});setSelectedName('');setLegacyName('');setExplicitTarget(false);setWeekId('');setDetailState(null);}}>{monthOptions.map(m=><option value={m} key={m}>{monthText(m)}</option>)}</AppSelect></label>}</section>
  {!data?<section className="v2-card pf-workspace" role={error?'alert':'status'}>
   <ResultEmpty title={error?'暂时无法加载得分数据':'正在整理月度数据'} description={error||(month?`正在读取${monthText(month)}的月度结果…`:'请稍候，月度结果即将就绪。')}/>
   {error&&<button type="button" className="secondary-button" onClick={()=>setRequest({month:request.month})}>重试读取结果</button>}
  </section>:<>
  {!scoreFocus&&month&&<ManagerReviewsPanel month={month} onBusyChange={setManagerReviewBusy}/>}
  {scoreFocus!=='collaboration'&&<p className="pf-notice">{qualityReviewNotice}</p>}
  <section className={`pf-metrics ${scoreFocus?'pf-metrics-focused':''}`}>
   {scoreFocus!=='collaboration'&&<ResultMetric icon={Clock3} label="全员周报提交率" value={pct} unit="%" description={`准时提交率 ${timePct}${timePct==='—'?'':'%'}`}><span className="pf-caption">迟交 <b>{rows.filter((r:any)=>r.timeliness.late>0).length}</b> 人</span><span className="pf-caption">未交 <b>{rows.filter((r:any)=>r.timeliness.missing>0).length}</b> 人</span></ResultMetric>}
   {scoreFocus!=='collaboration'&&<ResultMetric icon={FileCheck2} label={allQualityConfirmed?'周报质量最终均分':pending>0?'当前已完成分析均分':analyzed?'月度质量候选均分':'月度周报质量'} value={qualityMean} unit="分" description={allQualityConfirmed?'管理人员已确认的员工质量最终分':pending>0?'汇总已完成分析的有效周报 · 暂定':analyzed?'汇总已完成分析的有效周报 · 待管理人员确认':'本月暂无可评分周报'}><span className="pf-caption">本月待完成 AI 分析</span><span className="pf-status">{pending} 份</span></ResultMetric>}
   {scoreFocus!=='quality'&&<ResultMetric icon={UsersRound} label="月度综合最终均分" value={mean('collaboration')} unit="分" description="负责人/老板30%＋同事70%，全部完成后发布"><span className="pf-caption">同事待评 / 负责人待评</span><span className={`pf-status ${pendingPeople.length?'is-warning':'is-confirmed'}`}>{pendingPeople.length} / {rows.filter((r:any)=>r.managerProgress.expected>0&&!r.managerProgress.complete).length} 人</span></ResultMetric>}
  </section>
  {scoreFocus!=='collaboration'&&<div className="pf-policy"><span><Clock3 size={14}/>周五或放假前最后一个工作日 20:00 截止</span><span>直属上级点评、协同部门反馈：周一 12:00 前</span><span>北京时间</span></div>}
  <section className="v2-card pf-workspace">
   <div className="v2-card-head"><div><h3 className="v2-card-title">{scoreFocus==='quality'?'员工周报质量':scoreFocus==='collaboration'?'员工协同得分':'员工月度结果'}</h3><p className="v2-card-sub">{scoreFocus==='quality'?'在「周报与证据」查看逐周评分依据和人工复核记录。':scoreFocus==='collaboration'?'选择员工查看最终分和完成进度，并在「协作明细」查看评分记录。':'选择员工查看月度结果和周报评分依据。'}</p></div><span className="pf-subtle-tag">{rows.length} 位员工</span></div>
   <div className="pf-review-layout">
    <ResultEmployeeDirectory contextKey={(scoreFocus||'all')+'|'+month} selectedUserId={selected?.userId} employees={rows.map((r:any)=>{
     const count=published.filter((p:any)=>p.employee_user_id===r.userId).length,focusedResult=scoreFocus?published.find((p:any)=>p.employee_user_id===r.userId&&p.kind===scoreFocus):undefined;
     const focusedScore=focusedResult?.result.score,quality=monthlyQualityView(r.quality);
     const scoreLabel=scoreFocus==='quality'?`${quality.value!=null?`${scoreText(quality.value)} 分 · `:''}${quality.status}`:focusedScore!=null?`${scoreText(focusedScore)} 分`:'待评分';
     return {userId:r.userId,name:r.name,department:r.department,summary:scoreFocus?scoreLabel:`${count}/3 项已生成`};
    })} onSelect={userId=>{setSelectedName(userId);setLegacyName('');setExplicitTarget(false);setWeekId('');setTab('review');setDetailState(null);}}/>
    {selected ? <div className="pf-review-main">
     <div className="pf-person-heading"><div><h3>{selected.name}<span>{selected.department}</span></h3><p>月度结果 · {monthText(month)}{requestedWeekEnd&&` · 来源周次 ${requestedWeekEnd}`}</p></div><ResultStatus confirmed={scoreFocus==='quality'?selectedQuality.confirmed:Boolean(locked('collaboration'))} label={scoreFocus==='quality'?selectedQuality.status:locked('collaboration')?'月度评分已发布':'等待评分完成'}/></div>
     <div className="pf-tabs" role="tablist" aria-label="月度资料">{resultTabs.map(([k,label])=><button type="button" role="tab" aria-selected={tab===k} key={k} className={tab===k?'is-active':''} onClick={()=>setTab(k)}>{label}</button>)}</div>
     {tab==='review'&&<>
      {scoreFocus!=='quality'&&<p className="pf-review-hint">月度最终分＝负责人或老板评分30%＋同事互评均分70%，两部分完成后自动发布。</p>}
      <div className="pf-confirm-list">
       {scoreFocus!=='collaboration'&&<MonthlyQualityResultRow key={detailKey} quality={selected.quality} target={{userId:selected.userId,month,onUpdated:reloadOverview}}/>}
       {kinds.filter(([kind])=>kind!=='quality').map(([kind,label])=>{
        const saved=locked(kind),value=kind==='timeliness'?saved?.result.rate:saved?.result.score,ready=value!=null;
        const note=kind==='timeliness'?'按原始提交时间自动统计，无需审核或确认':'负责人或老板30%＋同事70%，全部必需评分完成后自动发布';
        return <div className="pf-confirm-row" key={kind}><span><strong>{label} · {scoreText(value)}{ready?(kind==='timeliness'?'%':' 分'):''}</strong><small>{saved?.scoring_rule==='legacy'?'历史已发布结果，保留原值':note}</small></span><ResultStatus confirmed={ready} label={ready?(saved.scoring_rule==='legacy'?'历史已发布':kind==='collaboration'?'已自动发布':'已自动生成'):kind==='timeliness'?(selected.timeliness.pendingCalendar?'等待工作日日历':selected.timeliness.pendingTimestamp?'等待提交时间补齐':'暂无到期周报'):'等待评分完成'}/></div>;
       })}
      </div>
      {scoreFocus!=='quality'&&<div className="pf-review-stats"><div><span>同事互评均分（70%）</span><strong>{scoreText(selected.peerCandidate)}<small> 分</small></strong></div><div><span>该员工协作评分进度</span><strong>{selected.collaborationSubmitted}<small> / {selected.collaborationExpected}</small></strong></div></div>}
      {scoreFocus!=='quality'&&<p className="pf-notice">{selected.managerProgress.kind==='boss'?'老板':'负责人'}评分（30%）：{selected.managerProgress.submitted}/{selected.managerProgress.expected} 已完成 · {scoreText(selected.managerProgress.score)} 分。{selected.managerProgress.handoffRequired?'原负责人已停用或身份缺失，请到「系统设置 → 月度评分交接」指定接任负责人。':!selected.managerProgress.expected&&'请先同步飞书部门负责人或直属上级。'}</p>}{scoreFocus!=='collaboration'&&<SubmissionCounts stats={selected.timeliness}/>}
      {scoreFocus!=='collaboration'&&<p className="pf-caption pf-rule">周报质量权重：{(selected.reports[0]?.scoringPolicy?.weights||[30,25,25,20]).map((w:number,i:number)=>`${['成果','问题','计划','复盘'][i]} ${w}%`).join(' · ')}。及时率独立统计。</p>}
      {scoreFocus!=='collaboration'&&!!selected.timeliness.pendingTimestamp&&<div className="pf-error">{selected.timeliness.pendingTimestamp} 份周报提交时间待核实，原始时间补齐后系统自动重算，当前不展示不准确的及时率。</div>}
     </>}
     {tab==='reports'&&(reportDetailsNeeded&&!loadedDetail?detailPlaceholder:<div className="pf-evidence-list">
      {reportRows.map((report:any)=><ManagedQualityReport key={report.id+':'+(report.qualityReviewVersion||'')} report={report} userId={selected.userId} month={month} editable={!selectedQuality.confirmed} onUpdated={reloadOverview}/>)}
      {!reportRows.length&&<ResultEmpty title="暂无周报记录" description="导入本月周报后，可在这里核实内容与提交时间。"/>}
     </div>)}
     {tab==='collaboration'&&(collaborationDetailsNeeded&&!loadedDetail?detailPlaceholder:<div className="pf-evidence-list">{collaborationRows.map((c:any)=><article className="pf-evidence" key={c.id}><div className="pf-evidence-head"><h4>{c.label}</h4><span className="pf-subtle-tag">全轮 {c.submitted} / {c.expected} 已完成</span></div><div className="pf-progress"><i style={{width:`${c.expected?c.submitted/c.expected*100:0}%`}}/></div><p className="pf-caption">未完成评分：{[...new Set(c.pending)].join('、')||'全部完成'}</p>{c.assignments.filter((a:any)=>a.evaluee_user_id===selected.userId).map((a:any)=><div className="pf-assignment" key={a.id}><div><strong>{a.evaluator_name}</strong><span className="pf-tabular">{a.score===''?'待评分':`${a.score} 分`}</span></div><p>{a.comment||'尚未提交评价'}</p><small>{a.submitted_at?`提交于 ${qualityDate(a.submitted_at)}`:'等待本人完成评分与评价'}</small></div>)}</article>)}{!collaborationRows.length&&<ResultEmpty title="本月尚无协作评分记录" description="发起月度评分后，可在这里查看任务进度与评价。"/>}</div>)}
     {tab==='history'&&<div className="pf-evidence-list">{published.filter((x:any)=>x.employee_user_id===selected.userId).map((x:any)=>{const snapshot=x.evidenceSummary??JSON.parse(x.evidence_json);return <article className="pf-evidence" key={x.kind}><div className="pf-evidence-head"><h4><History size={16}/>{kinds.find(([k])=>k===x.kind)?.[1]}</h4><ResultStatus confirmed label={x.scoring_rule==='management_confirmed'?'管理人员已确认':x.scoring_rule==='automatic_report'?'系统自动生成':'已发布'}/></div><dl className="pf-audit"><div><dt>最终结果</dt><dd>{x.result.score!=null?`${scoreText(x.result.score)} 分`:x.kind==='quality'?'等待 AI 分析':`准时率 ${scoreText(x.result.rate)}${x.result.rate!=null?'%':''}`}</dd></div><div><dt>确认人或生成方式</dt><dd>{x.confirmed_by}</dd></div><div><dt>结果时间</dt><dd>{qualityDate(x.confirmed_at)}</dd></div><div><dt>记录说明</dt><dd>{snapshot.reviewNote||'—'}</dd></div>{x.kind==='quality'&&snapshot.qualityCandidate!=null&&<div><dt>候选 → 最终</dt><dd>{scoreText(snapshot.qualityCandidate)} → {scoreText(x.result.score)}</dd></div>}{x.kind==='timeliness'&&x.scoring_rule==='legacy'&&<><div><dt>正当理由</dt><dd>{snapshot.legitimateReason||'无'}</dd></div><div><dt>人工确认扣分</dt><dd>{snapshot.deduction??0} 分</dd></div></>}</dl><DeferredEvidence key={month+':'+x.employee_user_id+':'+x.kind} label="查看结果计算依据" url={'/api/performance/result-evidence?month='+encodeURIComponent(month)+'&employeeId='+encodeURIComponent(x.employee_user_id)+'&kind='+encodeURIComponent(x.kind)+'&confirmedAt='+encodeURIComponent(x.confirmed_at)+'&rule='+encodeURIComponent(x.scoring_rule)} initialValue={x.evidenceDeferred?undefined:snapshot}/></article>;})}{!published.some((x:any)=>x.employee_user_id===selected.userId)&&<ResultEmpty title="暂无结果记录" description="管理人员确认质量分后，可在这里查看最终分和审核依据。"/>}</div>}
    </div> : <ResultEmpty title={explicitTarget?"未找到指定员工的月度数据":"本月暂无结果数据"} description={explicitTarget?(matchingNames.length>1?"存在同名员工，请从左侧按部门选择要查看的人员。":"请核对员工身份和月份，或从左侧选择人员；系统不会自动打开其他员工。"):"同步周报或完成评分后，可在这里查看月度结果。"}/>}
   </div>
  </section>
  </>}
  {overview&&<DepartmentScoreTrends key={scoreFocus||'all'} months={overview.data.months} employees={overview.data.employees} results={overview.data.results} scoreFocus={scoreFocus}/>}
  {overview&&!scoreFocus&&<details className="v2-card pf-task-disclosure" onToggle={event=>{if(event.currentTarget.open)setTasksOpened(true);}}><summary><UsersRound size={17}/><span>我的协作评分任务<small>以本人身份完成分数与评价</small></span><ChevronRight size={16}/></summary>{tasksOpened&&data&&month&&<ScoringTasksPage showManagerReviews={false} month={month}/>}</details>}
 </div>;
}
