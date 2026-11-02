import {useEffect,useRef,useState} from 'react';
import {AlertCircle,ArrowDown,CalendarClock,CheckCircle2,Pause,Play,RefreshCw,Repeat2} from 'lucide-react';
import {AppSelect} from './AppSelect';
import '../styles/recurring-scoring-plan.css';

type Source={month:string;status:string;pairCount:number;targetCount:number;cycleId?:string};
type Issue={type:string;label:string;name?:string;userId?:string};
type Plan={configured:boolean;config:{enabled:boolean;sourceMonth:string;startMonth:string;versionId:string;pairCount:number;targetCount:number;updatedAt:string};sources:Source[];current:{month:string;state:string;label?:string;status?:string;createdPairs:number;missingEmployeesCount:number;issueCount:number;issues:Issue[]}};
const monthNow=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
const monthLabel=(value:string)=>/^\d{4}-\d{2}$/.test(value)?`${value.slice(0,4)}年${Number(value.slice(5))}月`:value;
const errors:Record<string,string>={invalid_recurring_month:'请选择有效的来源月份和起始月份，起始月份不能早于本月。',invalid_recurring_config:'请检查自动沿用设置。',recurring_source_empty:'这个月份没有可用的评分关系，请先在下方完成配评。',recurring_source_invalid:'来源名单缺少人员身份，请先核对评分关系。',recurring_source_too_large:'名单超过可保存范围，请联系系统维护人员。',recurring_plan_required:'请先确认一份固定评分名单。',recurring_plan_changed:'人员或配评刚刚发生变化，请刷新后核对名单再保存。',recurring_plan_busy:'固定名单正在处理，请稍候重试。',self_scoring_forbidden:'来源名单存在自评关系，请先在配评工作台调整。'};

export function RecurringScoringPlan({viewMonth,workbenchVersion=0,disabled=false,onChanged,onBusyChange,onReviewIssues}:{viewMonth:string;workbenchVersion?:number;disabled?:boolean;onChanged:()=>void|Promise<void>;onBusyChange?:(busy:boolean)=>void;onReviewIssues:()=>void}){
 const [data,setData]=useState<Plan|null>(null),[unavailable,setUnavailable]=useState(false),[loadError,setLoadError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[sourceMonth,setSourceMonth]=useState(''),[startMonth,setStartMonth]=useState(monthNow),[confirmed,setConfirmed]=useState(false);
 const mounted=useRef(false),requestId=useRef(0),controller=useRef<AbortController|null>(null),saving=useRef(false),lastWorkbenchVersion=useRef(workbenchVersion),onBusy=useRef(onBusyChange);onBusy.current=onBusyChange;
 function accept(plan:Plan,preserveSource=false){setData(plan);setUnavailable(false);setLoadError('');setSourceMonth(old=>preserveSource&&old?old:plan.sources.some(s=>s.month===old&&s.pairCount>0)?old:plan.config.sourceMonth||plan.sources.find(s=>s.pairCount>0&&s.month<monthNow())?.month||plan.sources.find(s=>s.pairCount>0)?.month||'');}
 async function load(preserveSource=false){
  const id=++requestId.current;controller.current?.abort();const c=new AbortController();controller.current=c;setLoadError('');
  try{const r=await fetch('/api/scoring360/recurring-plan',{signal:c.signal});if(id!==requestId.current||!mounted.current)return;if([403,404].includes(r.status)){setUnavailable(true);return;}if(!r.ok)throw Error();const j=await r.json();if(id!==requestId.current||!mounted.current)return;if(!j.config||!j.current||!Array.isArray(j.sources)){setUnavailable(true);return;}accept(j,preserveSource);}
  catch(e){if(id===requestId.current&&mounted.current&&!(e instanceof Error&&e.name==='AbortError'))setLoadError('固定评分名单暂时读取失败，可以继续使用下方配评工作台。');}
 }
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;requestId.current++;controller.current?.abort();onBusy.current?.(false);};},[]);
 useEffect(()=>{if(lastWorkbenchVersion.current===workbenchVersion)return;lastWorkbenchVersion.current=workbenchVersion;if(mounted.current&&!saving.current)void load(true);},[workbenchVersion]);
 useEffect(()=>{if(!busy)return;const leave=(event:Event)=>{event.preventDefault();setMessage('正在保存固定名单，请完成后再切换页面。');},unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('organization-before-leave',leave);window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener('organization-before-leave',leave);window.removeEventListener('beforeunload',unload);};},[busy]);
 const source=data?.sources.find(s=>s.month===sourceMonth),formVisible=Boolean(data&&(!data.configured||editing)),locked=disabled||busy;
 async function act(action:string,extra:Record<string,unknown>={}){
  if(saving.current||disabled)return;saving.current=true;setBusy(true);onBusy.current?.(true);setMessage('');controller.current?.abort();requestId.current++;
  try{
   const r=await fetch('/api/scoring360/recurring-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...extra})}),j=await r.json();if(!r.ok)throw Error(errors[j.error]||'固定名单未保存，请稍后重试。');if(!j.config||!j.current||!Array.isArray(j.sources))throw Error('固定名单状态暂时无法读取，请刷新确认。');if(!mounted.current)return;accept(j);setEditing(false);setConfirmed(false);
   setMessage(action==='setEnabled'&&!j.config.enabled?'已暂停自动沿用；已生成的任务和历史评分保留。':action==='adoptMonth'?(j.current.state==='existing_manual'?'固定名单已保存。本月已有人工安排，后续未生成的月份会自动沿用。':j.current.state==='needs_attention'?'固定名单已保存，本月有待处理项目，请在下方工作台核对。':j.current.state==='not_started'?`固定名单已保存，将从${monthLabel(j.config.startMonth)}开始每月沿用。`:`固定名单已启用。${j.current.label||'以后每月自动生成新的评分任务。'}`):action==='run'?`已检查：${j.current.label||'本月状态已更新'}。`:`已恢复每月自动沿用。${j.current.label||''}`);
   await onChanged();
  }catch(e){if(mounted.current)setMessage(e instanceof Error?e.message:'操作未完成，请重试。');}finally{saving.current=false;if(mounted.current)setBusy(false);onBusy.current?.(false);}
 }
 function editTemplate(){if(locked||!data)return;setEditing(true);setConfirmed(false);setMessage('');setStartMonth(monthNow());setSourceMonth(data.sources.find(s=>s.month===viewMonth&&s.pairCount>0)?.month||data.sources.find(s=>s.pairCount>0)?.month||data.config.sourceMonth);}
 if(unavailable)return null;
 if(!data)return <section className="recurring-plan recurring-plan-loading" aria-label="固定评分关系">{loadError?<><span role="alert">{loadError}</span><button type="button" className="text-button" onClick={()=>void load()}>重新读取固定名单</button></>:<span role="status"><Repeat2 size={15}/>正在读取固定评分关系…</span>}</section>;
 const enabled=data.configured&&data.config.enabled,needsAttention=data.current.state==='needs_attention';
 return <section className="recurring-plan" aria-label="固定评分关系">
  <header className="recurring-plan-head"><span className="recurring-plan-symbol"><Repeat2 size={19}/></span><div><h3>固定评分关系<span className={enabled?'is-enabled':''}>{enabled?'每月自动沿用':data.configured?'已暂停':'设置一次，每月沿用'}</span></h3><p>评分人通常保持不变。每月自动生成新任务，分数和评价由评分人重新填写。</p></div>{data.configured&&<button type="button" className="text-button" disabled={locked||editing} onClick={editTemplate}>更新固定名单</button>}</header>
  {data.configured&&<div className="recurring-plan-summary"><div><strong>{monthLabel(data.config.sourceMonth)}</strong><span>固定名单来源</span></div><div><strong>{data.config.targetCount}<small> 人</small> · {data.config.pairCount}<small> 条关系</small></strong><span>每月沿用的同事评分关系</span></div><div><strong><CalendarClock size={14}/>{monthLabel(data.config.startMonth)}起</strong><span>只用于尚未生成任务的月份</span></div><div className="recurring-plan-controls"><button type="button" className="secondary-button" disabled={locked||editing||!enabled} onClick={()=>void act('run')}><RefreshCw size={13}/>检查本月任务</button><button type="button" className="secondary-button" disabled={locked||editing} onClick={()=>void act('setEnabled',{enabled:!enabled})}>{enabled?<Pause size={13}/>:<Play size={13}/>} {enabled?'暂停自动沿用':'恢复自动沿用'}</button></div></div>}
  {data.configured&&<div className={`recurring-plan-current ${needsAttention?'is-warning':''}`} role="status">{needsAttention?<AlertCircle size={16}/>:<CheckCircle2 size={16}/>}<div><strong>{monthLabel(data.current.month)} · {data.current.label||'本月任务状态已更新'}</strong>{data.current.state==='existing_manual'?<p>本月按已有安排执行。固定名单不会覆盖人工配置或已提交评分。</p>:needsAttention?<p>新增员工、停用评分人或组织责任变化需要核对。处理后在本月工作台检查并开放评分。</p>:<p>{enabled?'以后每月自动检查并生成任务，无需重新选择评分人。':'暂停不会撤回本月任务；恢复后继续为未生成的月份创建任务。'}</p>}</div>{needsAttention&&<button type="button" className="text-button" disabled={locked||editing} onClick={onReviewIssues}>处理本月配评<ArrowDown size={13}/></button>}</div>}
  {data.current.issues.length>0&&data.configured&&<details className="recurring-plan-issues"><summary>查看待处理项目（{data.current.issueCount}）{data.current.missingEmployeesCount>0&&` · ${data.current.missingEmployeesCount} 人待设置同事评分人`}</summary><ul>{data.current.issues.map((issue,index)=><li key={`${issue.type}-${issue.userId||index}`}><strong>{issue.name||'评分安排'}</strong><span>{issue.label}</span></li>)}</ul></details>}
  {formVisible&&<form className="recurring-plan-form" onSubmit={event=>{event.preventDefault();if(!source?.pairCount||!confirmed||locked)return;void act('adoptMonth',{sourceMonth,startMonth,enabled:true});}}>
   <fieldset disabled={locked}><div className="recurring-plan-fields"><label>沿用哪一个月的评分关系<AppSelect aria-label="固定名单来源月份" value={sourceMonth} onValueChange={value=>{setSourceMonth(value);setConfirmed(false);}} placeholder="选择已配置的月份"><option value="" disabled>选择已配置的月份</option>{data.sources.map(s=><option value={s.month} key={s.month} disabled={!s.pairCount}>{monthLabel(s.month)} · {s.pairCount} 条关系{s.status==='draft'?'（草稿）':''}</option>)}</AppSelect></label><label>从哪个月份开始<input type="month" aria-label="固定名单起始月份" min={monthNow()} max={`${Number(monthNow().slice(0,4))+1}${monthNow().slice(4)}`} required value={startMonth} onChange={event=>setStartMonth(event.target.value)}/></label><div className="recurring-plan-adopt"><button type="submit" className="primary-button" disabled={!source?.pairCount||!confirmed||locked}>{busy?'正在保存…':data.configured?'更新固定名单并开启沿用':'设为固定名单并开启每月沿用'}</button>{data.configured&&<button type="button" className="text-button" onClick={()=>{setEditing(false);setConfirmed(false);}}>取消更新</button>}</div></div>
   {source?.status==='draft'&&<p className="recurring-plan-draft"><AlertCircle size={13}/>所选月份仍为草稿，确认后会将其中的评分关系作为长期固定名单。</p>}
   <label className="recurring-plan-confirm"><input type="checkbox" checked={confirmed} disabled={!source?.pairCount} onChange={event=>setConfirmed(event.target.checked)}/><span>我已核对这份评分人名单，确认以后每月沿用。只带入评分关系，不复制任何分数或评价。</span></label>
   {!data.sources.some(s=>s.pairCount>0)&&<p className="recurring-plan-help">还没有可用名单。先在下方配置一次评分人，再将本月设置为固定名单。</p>}
   {data.configured&&<p className="recurring-plan-help">更新固定名单只影响尚未生成任务的月份；已有任务在下方工作台单独处理。</p>}
   </fieldset>
  </form>}
  {message&&<p className="recurring-plan-message" role="status">{message}</p>}
  {loadError&&<p className="recurring-plan-message" role="alert">{loadError} <button type="button" className="text-button" disabled={locked} onClick={()=>void load()}>重新读取</button></p>}
 </section>;
}
