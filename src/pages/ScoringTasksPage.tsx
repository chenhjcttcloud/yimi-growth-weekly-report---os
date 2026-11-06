import {ManagerReviewsPanel} from '../components/ManagerReviewsPanel';
import { useEffect, useRef, useState } from 'react';
import { Send, UsersRound } from 'lucide-react';
import { ResultEmpty, ResultStatus } from '../components/PerformanceUI';
import { ReviewMonthPicker } from '../components/ReviewMonthPicker';
type Task={id:string;evaluee:string;score:number|null;comment:string;submitted:boolean;locked:boolean};
type Tasks={selection:string;month:string;cycleId:string;cycle:{id:string;status:string;launchAt?:string}|null;tasks:Task[]};
export function ScoringTasksPage({previewEmployeeId,showManagerReviews=true,month:sharedMonth}:{previewEmployeeId?:string;showManagerReviews?:boolean;month?:string}){
 const current=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 const [localMonth,setMonth]=useState(current),[data,setData]=useState<Tasks|null>(null),[draft,setDraft]=useState<Record<string,{score:string|number;comment:string}>>({}),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const month=sharedMonth||localMonth,selection=(previewEmployeeId||'self')+'|'+month,currentSelection=useRef(selection);currentSelection.current=selection;
 const visible=data?.selection===selection&&data.month===month?data:null,tasks=visible?.tasks||[];
 async function load(signal?:AbortSignal){
  const params=new URLSearchParams({month});if(previewEmployeeId)params.set('employeeId',previewEmployeeId);
  const r=await fetch((previewEmployeeId?'/api/admin/employee-preview/scoring-tasks?':'/api/scoring360/my-tasks?')+params,{signal}),j=await r.json();
  if(!r.ok||j.month!==month||!Array.isArray(j.tasks))throw Error('加载失败，请刷新重试。');
  if(!signal?.aborted&&currentSelection.current===selection)setData({...j,selection});
 }
 useEffect(()=>{const controller=new AbortController();setData(null);setDraft({});setMessage('');setLoading(true);void load(controller.signal).catch(e=>{if(!controller.signal.aborted&&currentSelection.current===selection)setMessage(e instanceof Error?e.message:'加载失败，请刷新重试。');}).finally(()=>{if(!controller.signal.aborted&&currentSelection.current===selection)setLoading(false);});return()=>controller.abort();},[month,previewEmployeeId]);
 async function submit(){
  if(previewEmployeeId||busy||loading||!visible?.cycleId)return;setBusy(true);
  try{
   const scores=tasks.filter(t=>draft[t.id]&&!t.locked).map(t=>({assignmentId:t.id,score:draft[t.id].score,comment:draft[t.id].comment}));
   if(!scores.length||scores.some(s=>s.score==null||s.score===''||!s.comment?.trim()))throw Error('请填写每项分数与评价。');
   const r=await fetch('/api/scoring360/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cycleId:visible.cycleId,scores})}),j=await r.json();
   if(!r.ok||j.skipped?.length)throw Error(j.error||'部分评分未保存，请检查填写内容或评分任务状态。');
   if(currentSelection.current!==selection)return;
   setMessage('评分已提交，同事互评占70%；负责人或老板评分占30%，两部分完成后自动发布最终分。');setDraft({});await load();
  }catch(e){if(currentSelection.current===selection)setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 const emptyTitle=visible?.cycle?.status==='draft'?'所选月份尚未开放评分':visible?.cycle?.status==='closed'?'所选月份评分已关闭':'所选月份暂无需要你完成的评分任务';
 return <>{showManagerReviews&&<ManagerReviewsPanel previewEmployeeId={previewEmployeeId} month={sharedMonth}/>}<section className="v2-card pf-scoring pf-page"><div className="v2-card-head"><div><span className="v2-eyebrow"><UsersRound size={14}/>协作与支持</span><h2 className="v2-card-title">我的协作评分任务</h2><p className="v2-card-sub">按月份为协作伙伴填写分数与评价；已开放的历史月份也可补评。</p></div>{sharedMonth===undefined&&<ReviewMonthPicker aria-label="协作评分月份" value={month} max={current} disabled={busy} onChange={setMonth}/>}</div>{loading?<p role="status" className="pf-notice">正在读取所选月份评分任务…</p>:!tasks.length&&<ResultEmpty title={emptyTitle} description={visible?.cycle?.status==='draft'?'请联系老板或配评管理员，在月度配评工作台检查并开放该月份。':'可切换月份查看自己的评分任务；已提交和已发布的结果继续保留。'}/>}<div className="pf-evidence-list">{tasks.map(t=><article className="pf-evidence" key={t.id}><div className="pf-evidence-head"><h3>{t.evaluee}</h3><ResultStatus confirmed={t.submitted} label={t.locked?'已锁定':t.submitted?'已提交':'待评分'}/></div><div className="pf-form"><label>协作评分<div className="pf-input-unit"><input type="number" min="0" max="100" disabled={Boolean(previewEmployeeId)||t.locked||busy} placeholder="请填写" value={draft[t.id]?.score??t.score??''} onChange={e=>setDraft(d=>({...d,[t.id]:{score:e.target.value,comment:d[t.id]?.comment??t.comment??''}}))}/><span>分 / 100</span></div></label><label className="pf-span-full">协作评价<textarea disabled={Boolean(previewEmployeeId)||t.locked||busy} placeholder="记录具体的协作表现与贡献" value={draft[t.id]?.comment??t.comment??''} onChange={e=>setDraft(d=>({...d,[t.id]:{score:d[t.id]?.score??t.score??'',comment:e.target.value}}))}/></label></div></article>)}</div>{!previewEmployeeId&&tasks.some(t=>!t.locked)&&<div className="pf-scoring-footer"><p className="pf-caption">评分提交后，同事互评70%＋负责人或老板30%，两部分完成即自动发布，无需人工确认。</p><button className="primary-button" disabled={busy||loading} onClick={()=>void submit()}><Send size={14}/>{busy?'正在提交…':'提交积分'}</button></div>}{message&&<p role="status" className="pf-notice">{message}</p>}</section></>;
}
