import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {BookOpen,CheckCheck,ChevronDown,Clock3,FileText,LockKeyhole,Send,UserRoundCheck,UsersRound} from 'lucide-react';
import {scoreText} from './PerformanceUI';
import {ReviewMonthPicker} from './ReviewMonthPicker';
import '../styles/manager-reviews.css';

const errors:Record<string,string>={not_your_subordinate:'该员工不在你的评分范围，请刷新名单。',result_locked:'本月评分已提交并锁定。',score_and_comment_required:'请填写 0–100 分和具体评价。',invalid_month:'请选择有效月份。',employee_not_employed:'员工在所选月份未在职，不能录入评分。',employee_inactive:'员工已停用，不能继续评分，请刷新名单。',self_scoring_forbidden:'不能给自己评分。'};
type Filter='all'|'pending'|'done';
export function ManagerReviewsPanel({previewEmployeeId,month:sharedMonth,onBusyChange}:{previewEmployeeId?:string;month?:string;onBusyChange?:(busy:boolean)=>void}){
 const current=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 const [localMonth,setMonth]=useState(current),[data,setData]=useState<any>(null),[draft,setDraft]=useState<Record<string,any>>({}),[message,setMessage]=useState(''),[busy,setBusy]=useState('');
 const month=sharedMonth||localMonth;
 const [filter,setFilter]=useState<Filter>('all'),[messageKind,setMessageKind]=useState<'success'|'error'>('success');
 const [loading,setLoading]=useState(true),[relevantTarget,setRelevantTarget]=useState<string|null>(null),[loadingHeight,setLoadingHeight]=useState(180);
 const listRef=useRef<HTMLDivElement>(null),lastListHeight=useRef(180),target=previewEmployeeId||'self';
 useEffect(()=>()=>onBusyChange?.(false),[onBusyChange]);
 useLayoutEffect(()=>{const list=listRef.current;if(loading||data?.month!==month||!list)return;const measure=()=>{lastListHeight.current=list.offsetHeight||180;};measure();const observer=new ResizeObserver(measure);observer.observe(list);return()=>observer.disconnect();},[loading,data,month,filter]);
 async function load(signal?:AbortSignal){const response=await fetch(previewEmployeeId?'/api/admin/employee-preview/manager-reviews?employeeId='+encodeURIComponent(previewEmployeeId)+'&month='+month:'/api/manager-reviews?month='+month,{signal});const result=await response.json();if(!response.ok)throw Error(errors[result.error]||'负责人月度评分加载失败');if(!signal?.aborted){setData(result);if(result.canReview||result.hasResponsibilities)setRelevantTarget(target);}}
 useEffect(()=>{const controller=new AbortController();setLoadingHeight(lastListHeight.current);setLoading(true);setData(null);setDraft({});setMessage('');setFilter('all');void load(controller.signal).catch(e=>{if(e.name!=='AbortError'){setMessageKind('error');setMessage(e.message);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[month,previewEmployeeId]);
 async function submit(employeeUserId:string){if(previewEmployeeId||busy||loading||data?.month!==month)return;const value=draft[employeeUserId]||{};setBusy(employeeUserId);onBusyChange?.(true);setMessage('');try{const response=await fetch('/api/manager-reviews',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({month,employeeUserId,score:value.score,comment:value.comment})});const result=await response.json();if(!response.ok)throw Error(errors[result.error]||'提交失败，请刷新后重试');await load();setMessageKind('success');setMessage('负责人评分已保存，占月度最终分的30%；同事互评全部完成后自动合成发布。');}catch(e){setMessageKind('error');setMessage(e instanceof Error?e.message:'提交失败');}finally{setBusy('');onBusyChange?.(false);}}
 if(relevantTarget!==target&&!data?.canReview&&!data?.hasResponsibilities&&!message)return null;
 const tasks:any[]=data?.month===month?data.tasks||[]:[],done=tasks.filter(task=>task.submitted||task.locked).length,pending=tasks.length-done;
 const visible=tasks.filter(task=>filter==='all'||(filter==='done'?task.submitted||task.locked:!task.submitted&&!task.locked));
 return <section className="v2-card pf-page manager-reviews-panel">
  <header className="mr-panel-heading">
   <div className="mr-heading-copy"><span className="v2-eyebrow"><UserRoundCheck size={15}/>负责人月度评分</span><h3>给下属的投入与成长一个明确反馈</h3><p>结合本月交付与协作表现，留下具体、可行动的反馈。</p></div>
   {sharedMonth===undefined&&<ReviewMonthPicker aria-label="负责人评分月份" value={month} max={current} disabled={!!busy} onChange={setMonth}/>}
  </header>
  <div className="mr-overview">
   <div className="mr-completion"><span className="mr-completion-icon"><UsersRound size={17}/></span><div><strong>已完成 <b>{loading?'—':done}</b><span> / {loading?'—':tasks.length} 人</span></strong><div className="mr-progress" role="progressbar" aria-label="负责人月度评分进度" aria-valuemin={0} aria-valuemax={tasks.length||1} aria-valuenow={loading?undefined:done}><i style={{width:`${tasks.length?done/tasks.length*100:0}%`}}/></div></div></div>
   <div className="mr-weight-rule"><span><b>30%</b> 负责人评分</span><span className="mr-weight-plus">＋</span><span><b>70%</b> 同事互评</span><small>两部分完成后自动发布</small></div>
   <div className="mr-filters" role="tablist" aria-label="负责人评分筛选">{([{id:'all',label:'全部',count:tasks.length},{id:'pending',label:'待评分',count:pending},{id:'done',label:'已完成',count:done}] as const).map(item=><button type="button" role="tab" key={item.id} disabled={loading} aria-selected={filter===item.id} onClick={()=>setFilter(item.id)}>{item.label}<span>{loading?'—':item.count}</span></button>)}</div>
  </div>
  {previewEmployeeId&&<p className="mr-preview-note"><LockKeyhole size={13}/>当前为只读预览，评分内容不可修改或提交。</p>}
  {message&&<p role={messageKind==='error'?'alert':'status'} className={`mr-message ${messageKind==='error'?'is-error':''}`}>{messageKind==='error'?<Clock3 size={15}/>:<CheckCheck size={15}/>}<span>{message}</span></p>}
  <div className="mr-review-list" ref={listRef} aria-busy={loading} style={loading?{minHeight:loadingHeight}:undefined}>
   {loading&&<div className="mr-loading" role="status"><Clock3 size={18}/><span>正在读取本月评分任务…</span></div>}
   {data&&!visible.length&&<div className="mr-empty"><UserRoundCheck size={24}/><strong>{!tasks.length?'所选月份暂无需要你评分的在职下属。':filter==='pending'?'本月负责人评分已全部完成':'暂时没有已完成的评分'}</strong><span>{tasks.length?'可切换上方筛选，查看其他评分记录。':'切换月份可查看其他月度记录。'}</span></div>}
   {visible.map((task:any)=>{const value=draft[task.employeeUserId]||{},disabled=Boolean(previewEmployeeId)||task.locked||!!busy;return <article className={`mr-review-card${task.submitted?' is-submitted':''}`} key={task.employeeUserId}>
    <div className="mr-person-heading"><div className="mr-person"><span className="mr-avatar" aria-hidden="true">{task.name.slice(-2)}</span><div><h4>{task.name}</h4><span className="mr-department">{task.department||'部门待补全'}</span></div></div><span className={`mr-state ${task.submitted?'is-done':task.locked?'is-locked':'is-pending'}`}>{task.submitted?<CheckCheck size={13}/>:task.locked?<LockKeyhole size={13}/>:<Clock3 size={13}/>}<span>{task.submitted?'已提交锁定':task.locked?'结果已锁定':'待负责人评分'}</span></span></div>
    <details className="mr-reference"><summary><BookOpen size={14}/><span>查看本月周报与 AI 参考（{task.reports.length} 份）</span><ChevronDown size={14} className="mr-disclosure-arrow"/></summary><div className="mr-reference-body">{task.reports.map((report:any,index:number)=><details className="mr-report-reference" key={report.id} open={index===0}><summary><FileText size={14}/><span>{report.start} — {report.end}</span><span className="mr-ai-score">AI 参考 <b>{scoreText(report.aiReference)}</b></span><ChevronDown size={13} className="mr-disclosure-arrow"/></summary><dl>{report.facts.map((fact:any)=><div key={fact.module}><dt>{fact.module.replace('摘要','')}</dt><dd>{fact.text||'未填写'}</dd></div>)}</dl></details>)}{!task.reports.length&&<p className="mr-reference-empty">本月暂无周报，请结合实际工作给出评价。</p>}</div></details>
    {task.submitted?<div className="mr-submitted-result"><div className="mr-saved-score"><strong>{scoreText(Number(task.score))}</strong><span>分 · 负责人评分</span></div><div className="mr-saved-comment"><span>月度评价</span><p>{task.comment}</p></div></div>:<>
     <div className="mr-edit-grid">
      <label className="mr-score-field"><span className="mr-field-label">负责人评分 <small>占30%</small></span><div className="mr-score-input"><input type="number" min="0" max="100" step="0.1" placeholder="0–100" aria-label={task.name+'负责人评分'} disabled={disabled} value={value.score??''} onChange={e=>setDraft(d=>({...d,[task.employeeUserId]:{...value,score:e.target.value}}))}/><span>/ 100</span></div><small className="mr-field-hint">按本月实际表现评分</small></label>
      <label className="mr-comment-field"><span className="mr-field-label">月度评价 <small>必填</small></span><textarea aria-label={task.name+'月度评价'} disabled={disabled} rows={3} maxLength={4000} placeholder="记录具体成果、协作表现，以及下一步改进建议。" value={value.comment||''} onChange={e=>setDraft(d=>({...d,[task.employeeUserId]:{...value,comment:e.target.value}}))}/><span className="mr-character-count">{(value.comment||'').length} / 4000</span></label>
     </div>
     <footer className="mr-card-footer"><p><LockKeyhole size={12}/>{task.locked?'本月结果已锁定，历史记录已保留。':'提交后锁定留档，请先核对分数与评价。'}</p><button type="button" className="primary-button mr-submit" disabled={disabled} onClick={()=>void submit(task.employeeUserId)}><Send size={13}/>{busy===task.employeeUserId?'提交中…':'提交积分'}</button></footer>
    </>}
   </article>;})}
  </div>
 </section>;
}
