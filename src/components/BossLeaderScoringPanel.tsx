import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Building2,CheckCheck,Clock3,LockKeyhole,Search,Send,ShieldCheck,UserRoundCheck} from 'lucide-react';
import {ReviewMonthPicker} from './ReviewMonthPicker';
import {monthText,scoreText} from './PerformanceUI';
import '../styles/boss-leader-scoring.css';

type Department={id:string;name:string;leader_user_id?:string;feishu_id?:string};
type Person={userId:string;name:string};
type SavedScore={leader_user_id:string;month:string;score:number|string;comment:string;scorer_name?:string;created_at?:string};
type DepartmentScore=SavedScore&{department_id:string};
type LeaderTarget={leaderUserId:string;departmentIds:string[];name:string;ratingRequired:boolean;legacyScore?:number|null;unavailableReason?:string};
type Data={departments:Department[];archivedDepartments?:Department[];employees:Person[];scores:DepartmentScore[];personScores:SavedScore[];leaderScoreTargets:LeaderTarget[];canScore:boolean;currentUserId:string};
type Draft={score:string;comment:string;submitted?:boolean};
type Row={key:string;leaderId:string;name:string;departments:Department[];saved?:SavedScore;legacyScore?:number|null;state:'pending'|'done'|'blocked'|'exempt';reason:string;statusLabel:string};
type Filter=Row['state']|'all';
const errors:Record<string,string>={department_removed:'部门已从飞书移除，请刷新名单。',department_inactive:'部门已停用，不能新增评分。',rating_scope_frozen:'本月评分范围已变化，请刷新名单后核对角色与评分关系。',rating_responsibility_changed:'负责人已变化，请刷新名单后核对评分对象。',self_scoring_forbidden:'不能给自己评分。',score_and_comment_required:'请填写0–100分和具体评价。',result_locked:'本月评分已经提交并锁定，请刷新查看结果。',boss_only:'负责人评分仅可由老板本人提交。',leader_inactive:'负责人已停用，请刷新名单。',leader_not_registered:'负责人身份尚未同步，请先同步在职人员。',employee_not_employed:'负责人在所选月份未在职，不能评分。',invalid_month:'请选择有效月份。',account_inactive:'当前账号已停用，不能提交评分。'};
const draftKey=(month:string,leaderId:string)=>JSON.stringify([month,leaderId]);
const draftStoreKey=(owner:string)=>'boss-leader-person-drafts:'+owner;
const priority={pending:0,done:1,blocked:2,exempt:3};
const unavailable:Record<string,[Row['state'],string,string]>={
 boss_exempt:['exempt','老板无需评分','该负责人已配置为老板，不属于老板评分对象。'],
 leader_inactive:['blocked','负责人已停用','负责人当前已停用，历史记录仍可查看。'],
 leader_not_registered:['blocked','身份待同步','已设置负责人，但在职人员身份尚未同步，请先核对人员信息。'],
 employee_not_employed:['exempt','本月未在职','按已记录的在职日期，该负责人在所选月份未在职，无需本月评分。'],
 not_required:['exempt','本月无需评分','该负责人不在本月老板评分范围。'],
 rating_scope_frozen:['blocked','本月关系已锁定','本月沿用已提交的原评分关系，新岗位从下月开始评分。'],
 result_locked:['done','已完成','本月综合分已发布，评分已锁定。'],
 department_removed:['blocked','评分范围待核实','原评分部门已移除，请核对本月评分范围。'],
 department_inactive:['blocked','部门已停用','所负责的部门已停用，历史评分仍可查看。'],
 leader_must_be_department_member:['blocked','评分关系待核实','请在部门管理核对该负责人的部门归属。'],
};
const departmentText=(row:Row)=>row.departments.map(department=>department.name).join('、');
function rowsFor(data:Data,month:string,receipts:Record<string,SavedScore>):Row[]{
 const departments=new Map([...data.departments,...(data.archivedDepartments||[])].map(department=>[department.id,department]));
 const rows=data.leaderScoreTargets.map((target):Row=>{
  const leaderId=target.leaderUserId,key=draftKey(month,leaderId);
  const saved=data.personScores.find(score=>score.month===month&&score.leader_user_id===leaderId)||receipts[key];
  const name=[data.employees.find(person=>person.userId===leaderId)?.name,target.name].find(value=>value?.trim()&&!['姓名待同步','负责人待配置','负责人未设置'].includes(value.trim()))||'姓名待同步';
  const [state,statusLabel,reason]=saved||target.legacyScore!=null?['done','已完成',''] as const:
   target.ratingRequired&&leaderId!==data.currentUserId?['pending','待评分',''] as const:
   unavailable[target.unavailableReason||'']||['blocked','评分范围待核实','该负责人本月暂不可评分，请核对评分关系。'];
  return {key,leaderId,name,departments:target.departmentIds.flatMap(id=>departments.get(id)||[]),saved,legacyScore:target.legacyScore,state,statusLabel,reason};
 });
 for(const department of data.departments){
  if(department.leader_user_id)continue;
  rows.push({key:JSON.stringify([month,'department',department.id]),leaderId:'',name:'负责人未设置',departments:[department],state:'blocked',statusLabel:'负责人未设置',reason:department.feishu_id?'尚未设置部门负责人，请在飞书完善负责人后同步。':'尚未设置部门负责人，请先在部门管理完善负责人。'});
 }
 return rows.sort((a,b)=>priority[a.state]-priority[b.state]||a.name.localeCompare(b.name,'zh-CN')||a.key.localeCompare(b.key));
}
function visibleRows(rows:Row[],filter:Filter,search:string):Row[]{
 const query=search.trim().toLocaleLowerCase();
 return rows.filter(row=>(filter==='all'||row.state===filter)&&(row.name+' '+departmentText(row)).toLocaleLowerCase().includes(query));
}
function readDrafts(owner:string):Record<string,Draft>{
 try{const raw=JSON.parse(sessionStorage.getItem(draftStoreKey(owner))||'{}');if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};return Object.fromEntries(Object.entries(raw).filter(([,value])=>value&&typeof value==='object').map(([key,value])=>{const item=value as Partial<Draft>;return [key,{score:typeof item.score==='string'?item.score:'',comment:typeof item.comment==='string'?item.comment.slice(0,4000):'',submitted:item.submitted===true}];}));}catch{return {};}
}
export function BossLeaderScoringPanel({month:sharedMonth,onBusyChange,active=true}:{month?:string;onBusyChange?:(busy:boolean)=>void;active?:boolean}){
 const current=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7);
 const [localMonth,setLocalMonth]=useState(current),month=sharedMonth||localMonth;
 const [data,setData]=useState<Data|null>(null),[loadedMonth,setLoadedMonth]=useState(''),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const [filter,setFilter]=useState<Filter>('pending'),[search,setSearch]=useState(''),[selected,setSelected]=useState('');
 const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[receipts,setReceipts]=useState<Record<string,SavedScore>>({}),[owner,setOwner]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[messageKind,setMessageKind]=useState<'success'|'error'|'warning'>('success'),[nextNotice,setNextNotice]=useState('');
 const requestSequence=useRef(0),controller=useRef<AbortController|null>(null),mounted=useRef(false),monthRef=useRef(month),ownerRef=useRef(''),draftsRef=useRef(drafts);
 monthRef.current=month;draftsRef.current=drafts;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;requestSequence.current++;controller.current?.abort();};},[]);
 useEffect(()=>()=>onBusyChange?.(false),[onBusyChange]);
 const latest=data&&loadedMonth===month?data:null,rows=latest?rowsFor(latest,month,receipts):[];
 const counts={pending:rows.filter(row=>row.state==='pending').length,done:rows.filter(row=>row.state==='done').length,blocked:rows.filter(row=>row.state==='blocked').length,exempt:rows.filter(row=>row.state==='exempt').length,all:rows.length};
 const visible=visibleRows(rows,filter,search);
 const row=rows.find(item=>item.key===selected);
 const value=drafts[selected]||{score:'',comment:''};
 const dirty=Object.values(drafts).some(draft=>!draft.submitted&&(draft.score.trim()||draft.comment.trim()));
 useEffect(()=>{if(!owner)return;try{sessionStorage.setItem(draftStoreKey(owner),JSON.stringify(drafts));}catch{}},[drafts,owner]);
 useEffect(()=>{if(!active)return;const leave=(event:Event)=>{if(busy)event.preventDefault();};const unload=(event:BeforeUnloadEvent)=>{if(busy||dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('organization-before-leave',leave);window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener('organization-before-leave',leave);window.removeEventListener('beforeunload',unload);};},[active,busy,dirty]);
 async function load(requestedMonth=month,{initial=false}:{initial?:boolean}={}):Promise<Data|null>{
  controller.current?.abort();const abort=new AbortController();controller.current=abort;const sequence=++requestSequence.current;
  setLoading(true);setLoadError('');
  try{
   const response=await fetch('/api/departments?month='+encodeURIComponent(requestedMonth),{signal:abort.signal}),result=await response.json();
   if(!response.ok)throw Error(errors[result.error]||'负责人名单读取失败，请重试。');
   if(abort.signal.aborted||sequence!==requestSequence.current||monthRef.current!==requestedMonth||!mounted.current)return null;
   if(!Array.isArray(result.departments)||!Array.isArray(result.scores)||!Array.isArray(result.employees)||!Array.isArray(result.leaderScoreTargets)||!Array.isArray(result.personScores))throw Error('负责人名单暂不可用，请重试。');
   const next=result as Data;setData(next);setLoadedMonth(requestedMonth);
   if(ownerRef.current!==next.currentUserId){ownerRef.current=next.currentUserId;setOwner(next.currentUserId);setDrafts(readDrafts(next.currentUserId));setReceipts({});}
   if(initial){const first=rowsFor(next,requestedMonth,{})[0];setSelected(first?.key||'');setFilter(first?.state||'pending');}
   return next;
  }catch(error){if(!abort.signal.aborted&&sequence===requestSequence.current&&mounted.current){setLoadError(error instanceof Error?error.message:'负责人名单读取失败，请重试。');}return null;}
  finally{if(!abort.signal.aborted&&sequence===requestSequence.current&&mounted.current)setLoading(false);}
 }
 useEffect(()=>{setData(null);setLoadedMonth('');setSelected('');setSearch('');setMessage('');setNextNotice('');void load(month,{initial:true});return()=>controller.current?.abort();},[month]);
 function select(key:string){setSelected(key);setMessage('');setNextNotice('');}
 function chooseFilter(next:Filter){if(busy||loading)return;setFilter(next);select(visibleRows(rows,next,search)[0]?.key||'');}
 function changeSearch(text:string){setSearch(text);select(visibleRows(rows,filter,text)[0]?.key||'');}
 function update(field:'score'|'comment',text:string){if(!row||busy||loading)return;setDrafts(previous=>({...previous,[row.key]:{...(previous[row.key]||{score:'',comment:''}),[field]:text,submitted:false}}));setMessage('');setNextNotice('');}
 async function submit(advance:boolean){
  if(!latest||!row||row.state!=='pending'||!latest.canScore||busy||loading)return;
  const submittedMonth=month,target=row,key=target.key,draft=draftsRef.current[key]||{score:'',comment:''};
  if(!draft.score.trim()||!Number.isFinite(Number(draft.score))||Number(draft.score)<0||Number(draft.score)>100||!draft.comment.trim()){setMessageKind('error');setMessage('请填写0–100分和具体评价。');return;}
  setBusy(true);onBusyChange?.(true);setMessage('');setNextNotice('');
  try{
   const response=await fetch('/api/departments/score',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({leaderUserId:target.leaderId,month:submittedMonth,score:draft.score,comment:draft.comment})}),result=await response.json();
   if(!response.ok)throw Error(errors[result.error]||'提交失败，草稿已保留，请刷新名单后重试。');
   const receipt:SavedScore={leader_user_id:target.leaderId,month:submittedMonth,score:Number(draft.score),comment:draft.comment.trim(),scorer_name:'本人',created_at:new Date().toISOString()};
   if(!mounted.current)return;
   setReceipts(previous=>({...previous,[key]:receipt}));setDrafts(previous=>({...previous,[key]:{...draft,submitted:true}}));
   if(monthRef.current!==submittedMonth)return;
   const refreshed=await load(submittedMonth);
   if(!mounted.current||monthRef.current!==submittedMonth)return;
   if(!refreshed){setSelected(key);setFilter('done');setMessageKind('warning');setMessage('评分已提交并锁定，名单暂未刷新。请重试读取，避免重复提交。');return;}
   setMessageKind('success');setMessage('老板评分已保存，占30%；同事互评完成后自动合成最终分');
   if(advance){
    const pending=rowsFor(refreshed,submittedMonth,{...receipts,[key]:receipt}).filter(item=>item.state==='pending');
    const position=rows.findIndex(item=>item.key===key),following=rows.slice(position+1).find(item=>pending.some(next=>next.key===item.key)),next=following||pending[0];
    if(next){setFilter('pending');setSearch('');setSelected(next.key);setNextNotice('已切换至 '+next.name+'。');return;}
    setNextNotice('本月待评负责人已全部完成，可在“已完成”查看记录。');
   }
   setFilter('done');setSelected(key);
  }catch(error){if(mounted.current&&monthRef.current===submittedMonth){setMessageKind('error');setMessage(error instanceof Error?error.message:'提交失败，草稿已保留，请重试。');}}
  finally{if(mounted.current){setBusy(false);onBusyChange?.(false);}}
 }
 const departmentScores=(latest?.scores||[]).filter(score=>score.month===month&&score.department_id);
 const ownHistory=row?.leaderId?departmentScores.filter(score=>score.leader_user_id===row.leaderId):[];
 const otherHistory=row?departmentScores.filter(score=>score.leader_user_id!==row.leaderId&&row.departments.some(department=>department.id===score.department_id)):[];
 const archived=(latest?.archivedDepartments||[]).map(department=>({department,scores:departmentScores.filter(score=>score.department_id===department.id)})).filter(item=>item.scores.length);
 const nameFor=(id:string)=>latest?.employees.find(person=>person.userId===id)?.name||id;
 const departmentName=(id:string)=>[...(latest?.departments||[]),...(latest?.archivedDepartments||[])].find(department=>department.id===id)?.name||'历史部门';
 const locked=loading||busy||!latest?.canScore||row?.state!=='pending';
 return <section className="boss-leader-panel v2-card" aria-label="负责人评分" aria-busy={loading}>
  {sharedMonth===undefined&&<header className="bl-heading"><div><h3>负责人月度评分</h3><p>选择负责人，记录本月评分与评价。</p></div><ReviewMonthPicker aria-label="负责人评分月份" value={month} max={current} disabled={busy} onChange={setLocalMonth}/></header>}
  <div className="bl-overview"><div className="bl-counts" aria-label="负责人评分进度">{([{key:'pending',label:'待评分'},{key:'done',label:'已完成'},{key:'blocked',label:'待处理'},{key:'exempt',label:'无需评分'}] as const).map(item=><div className={'bl-metric is-'+item.key} key={item.key}><span><i aria-hidden="true"/>{item.label}</span><strong>{loading?'—':counts[item.key]}<small>项</small></strong></div>)}</div><div className="bl-rule"><span>月度综合分构成</span><p>老板评分 <b>30%</b><em>＋</em>同事互评 <b>70%</b></p><div className="bl-weight-bar" aria-hidden="true"><span/><span/></div><small>两部分完成后自动发布</small></div></div>
  {latest&&!latest.canScore&&<p className="bl-permission"><ShieldCheck size={14}/>当前为只读查看，负责人评分由老板本人提交。</p>}
  {message&&<p className={`bl-message is-${messageKind}`} role={messageKind==='error'?'alert':'status'}>{messageKind==='success'?<CheckCheck size={15}/>:<Clock3 size={15}/>}<span>{message}</span></p>}
  {nextNotice&&<p className="bl-next-notice" role="status">{nextNotice}</p>}
  {loadError&&<div className="bl-error" role="alert"><p>{loadError}</p><button type="button" className="secondary-button" disabled={busy} onClick={()=>void load(month,{initial:!latest})}>重试读取名单</button></div>}
  <div className="bl-workspace"><aside className="bl-directory"><label className="bl-search"><Search size={15}/><input aria-label="搜索负责人或部门" placeholder="搜索负责人或部门" value={search} disabled={busy||loading} onChange={event=>changeSearch(event.target.value)}/></label>
   <nav className="bl-filters" role="tablist" aria-label="负责人评分筛选">{([{id:'pending',label:'待评分'},{id:'done',label:'已完成'},{id:'blocked',label:'待处理'},{id:'exempt',label:'无需评分'},{id:'all',label:'全部'}] as const).map(item=><button type="button" role="tab" aria-selected={filter===item.id} key={item.id} disabled={busy||loading} onClick={()=>chooseFilter(item.id)}>{item.label}<span>{loading?'—':counts[item.id]}</span></button>)}</nav>
   <div className="bl-person-list">{loading?<p className="bl-loading" role="status"><Clock3 size={17}/>正在读取本月负责人名单…</p>:visible.length?visible.map(item=>{
    const score=item.saved?.score??item.legacyScore;
    return <button type="button" className={`bl-person is-${item.state}${selected===item.key?' is-selected':''}`} key={item.key} data-target-key={item.key} data-leader-user-id={item.leaderId||undefined} aria-pressed={selected===item.key} disabled={busy} onClick={()=>select(item.key)}>
     <span className="bl-avatar" aria-hidden="true">{!item.leaderId||item.name==='姓名待同步'?<UserRoundCheck size={15}/>:item.name.slice(-2)}</span>
     <span className="bl-person-copy"><strong className="bl-person-name">{item.name}</strong><span className="bl-person-meta">{item.departments.length>0&&<small>{departmentText(item)}</small>}<em>{item.statusLabel}</em></span></span>
     {score!=null?<b className="bl-list-score">{scoreText(Number(score))}</b>:<ArrowRight size={14}/>}
    </button>;
   }):<div className="bl-list-empty"><UserRoundCheck size={23}/><strong>{search?'没有匹配的负责人':filter==='pending'?'本月没有待评负责人':filter==='done'?'本月暂无已完成评分':filter==='blocked'?'当前没有待处理项目':filter==='exempt'?'本月没有无需评分项目':'所选月份暂无评分对象'}</strong><p>{search?'换一个姓名或部门关键词试试。':'可以切换筛选查看其他记录。'}</p></div>}</div>
  </aside><div className="bl-detail">{loading?<div className="bl-empty-editor" role="status">正在整理所选月份的评分资料…</div>:row?<article className="bl-editor" data-target-key={row.key} data-leader-user-id={row.leaderId||undefined}>
   <div className="bl-editor-heading"><div className="bl-editor-identity"><span className="bl-editor-avatar" aria-hidden="true">{!row.leaderId||row.name==='姓名待同步'?<UserRoundCheck size={23}/>:row.name.slice(-2)}</span><div><span className="bl-month">{monthText(month)}</span><h4>{row.name}</h4>{row.departments.length>0&&<p><Building2 size={14}/>{departmentText(row)}</p>}</div></div><span className={`bl-status is-${row.state}`}>{row.state==='done'?<LockKeyhole size={13}/>:<Clock3 size={13}/>}<span>{row.state==='done'?'已提交锁定':row.statusLabel}</span></span></div>
   {row.saved?<div className="bl-saved"><div><span>老板评分 · 占30%</span><strong>{scoreText(Number(row.saved.score))}<small>分</small></strong></div><div><span>评分说明</span><p>{row.saved.comment}</p><small>{row.saved.scorer_name||'已记录评分人'}{row.saved.created_at?' · '+row.saved.created_at:''}</small></div></div>:row.legacyScore!=null?<div className="bl-saved"><div><span>老板评分 · 占30%</span><strong>{scoreText(row.legacyScore)}<small>分</small></strong></div><div><span>历史评分</span><p>本月沿用已锁定的老板评分。</p></div></div>:row.state!=='pending'?<div className="bl-blocked"><ShieldCheck size={22}/><h5>{row.state==='done'?'本月评分已锁定':row.state==='exempt'?'本项无需评分':'本项暂不可评分'}</h5><p>{row.reason}</p></div>:<>
    <p className="bl-guidance">每位负责人每月评一次。请结合其本月的整体交付、团队管理与协作表现给出评价。</p>
    <div className="bl-form"><label className="bl-score-field"><span>老板评分 <small>0–100分</small></span><div><input type="number" min="0" max="100" step="0.1" aria-label={row.name+'老板评分'} placeholder="0–100" value={value.score} disabled={locked} onChange={event=>update('score',event.target.value)}/><b>/ 100</b></div></label><label className="bl-comment-field"><span>评分说明 <small>必填</small></span><textarea aria-label={row.name+'评分说明'} value={value.comment} maxLength={4000} rows={5} disabled={locked} placeholder="写清具体成果、管理或协作表现，以及下一步建议。" onChange={event=>update('comment',event.target.value)}/><small>{value.comment.length} / 4000</small></label></div>
    <footer className="bl-submit-bar"><p><LockKeyhole size={12}/>提交后锁定。切换负责人或月份会保留草稿。</p><div><button type="button" className="secondary-button" disabled={locked} onClick={()=>void submit(false)}><Send size={13}/>{busy?'提交中…':'提交评分'}</button><button type="button" className="primary-button" disabled={locked} onClick={()=>void submit(true)}>提交并评下一位 <ArrowRight size={14}/></button></div></footer>
   </>}
   {[{label:'历史部门评分',scores:ownHistory},{label:'所负责部门的历任评分',scores:otherHistory}].filter(history=>history.scores.length).map(history=><details className="bl-history" key={history.label}><summary>{history.label}（{history.scores.length}）</summary>{history.scores.map(score=><article key={JSON.stringify([score.department_id,score.leader_user_id])}><strong>{departmentName(score.department_id)} · {nameFor(score.leader_user_id)} · {scoreText(Number(score.score))} 分</strong><p>{score.comment}</p><small>{score.scorer_name||'历史评分人'}{score.created_at?' · '+score.created_at:''}</small></article>)}</details>)}
  </article>:<div className="bl-empty-editor"><UserRoundCheck size={29}/><h4>选择一位负责人</h4><p>左侧优先展示本月待评负责人。</p></div>}</div></div>
  {!!archived.length&&<details className="bl-archived" aria-label="已移除部门历史评分"><summary>已移除部门历史评分（{archived.length}）</summary><p>仅展示所选月份已保存的历史评分，当前组织不再包含这些部门。</p>{archived.map(item=><article key={item.department.id}><h4>{item.department.name}</h4>{item.scores.map(score=><div key={score.leader_user_id}><strong>{nameFor(score.leader_user_id)} · {scoreText(Number(score.score))} 分</strong><p>{score.comment}</p><small>{score.scorer_name||'历史评分人'}{score.created_at?' · '+score.created_at:''}</small></div>)}</article>)}</details>}
 </section>;
}
