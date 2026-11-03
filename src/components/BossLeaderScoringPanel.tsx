import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Building2,CheckCheck,Clock3,LockKeyhole,Search,Send,ShieldCheck,UserRoundCheck} from 'lucide-react';
import {ReviewMonthPicker} from './ReviewMonthPicker';
import {monthText,scoreText} from './PerformanceUI';
import '../styles/boss-leader-scoring.css';

type Department={id:string;name:string;leader_user_id?:string;leaderName?:string;is_active?:number;feishu_deleted?:boolean;feishu_id?:string};
type Person={userId:string;name:string};
type SavedScore={department_id:string;leader_user_id:string;month:string;score:number|string;comment:string;scorer_name?:string;created_at?:string};
type ScoreTarget={departmentId:string;leaderUserId?:string;name?:string;active?:boolean;frozen?:boolean;ratingRequired?:boolean;unavailableReason?:string};
type Data={month?:string;departments:Department[];archivedDepartments?:Department[];employees:Person[];scores:SavedScore[];scoreTargets?:ScoreTarget[];canScore:boolean;currentUserId:string};
type Draft={score:string;comment:string;submitted?:boolean};
type Row={department:Department;leaderId:string;name:string;saved?:SavedScore;past:SavedScore[];state:'pending'|'done'|'blocked'|'exempt';reason:string;statusLabel:string;frozen:boolean};
type Filter=Row['state']|'all';
const errors:Record<string,string>={department_removed:'部门已从飞书移除，请刷新名单。',department_inactive:'部门已停用，不能新增评分。',rating_scope_frozen:'本月评分范围已变化，请刷新名单后核对角色与评分关系。',rating_responsibility_changed:'负责人已变化，请刷新名单后核对评分对象。',self_scoring_forbidden:'不能给自己评分。',score_and_comment_required:'请填写0–100分和具体评价。',result_locked:'本月评分已经提交并锁定，请刷新查看结果。',boss_only:'负责人评分仅可由老板本人提交。',leader_inactive:'负责人已停用，请刷新名单。',leader_not_registered:'负责人身份尚未同步，请先同步在职人员。',employee_not_employed:'负责人在所选月份未在职，不能评分。',invalid_month:'请选择有效月份。',account_inactive:'当前账号已停用，不能提交评分。'};
const draftKey=(month:string,departmentId:string,leaderId:string)=>JSON.stringify([month,departmentId,leaderId]);
const scoreKey=(score:SavedScore)=>draftKey(score.month,score.department_id,score.leader_user_id);
function rowsFor(data:Data,month:string,receipts:Record<string,SavedScore>):Row[]{
 const records=[...(data.scores||[])];
 for(const receipt of Object.values(receipts))if(!records.some(score=>scoreKey(score)===scoreKey(receipt)))records.push(receipt);
 return (data.departments||[]).map(department=>{
  const target=data.scoreTargets?.find(item=>item.departmentId===department.id),leaderId=target?.leaderUserId||department.leader_user_id||'';
  const person=data.employees?.find(employee=>employee.userId===leaderId);
  const name=leaderId?([person?.name,target?.name,department.leader_user_id===leaderId?department.leaderName:undefined].find(value=>value?.trim()&&!['姓名待同步','负责人待配置','负责人未设置'].includes(value.trim()))||'姓名待同步'):'负责人未设置';
  const saved=records.find(score=>score.department_id===department.id&&score.month===month&&score.leader_user_id===leaderId),past=records.filter(score=>score.department_id===department.id&&score.month===month&&score.leader_user_id!==leaderId);
  let reason='',statusLabel='待评分',exempt=false;
  if(!leaderId){reason=department.feishu_id?'尚未设置部门负责人，请在飞书完善负责人后同步。':'尚未设置部门负责人，请先在部门管理完善负责人。';statusLabel='负责人未设置';}
  else if(department.feishu_deleted||department.is_active===0){reason='部门已停用，历史评分保留，不能新增评分。';statusLabel='部门已停用';}
  else if(target?.unavailableReason==='boss_exempt'){reason='该负责人已配置为老板，不属于老板评分对象。';statusLabel='老板无需评分';exempt=true;}
  else if(leaderId===data.currentUserId){reason='该部门由你本人负责，不能给自己评分。';statusLabel='不能自评';}
  else if(target?.unavailableReason==='leader_inactive'){reason='负责人当前已停用，不能新增评分；历史记录继续保留。';statusLabel='负责人已停用';}
  else if(target?.unavailableReason==='leader_not_registered'||!person){reason='已设置负责人，但在职人员身份尚未同步，请先核对人员信息。';statusLabel='身份待同步';}
  else if(target?.active===false){reason='负责人未在职或身份尚未同步，请先核对在职人员。';statusLabel='身份待核实';}
  else if(target?.unavailableReason==='employee_not_employed'){reason='按已记录的在职日期，该负责人在所选月份未在职，无需本月评分。';statusLabel='本月未在职';exempt=true;}
  else if(target?.unavailableReason==='not_required'){reason='该负责人不在本月老板评分范围，无需本项评分。';statusLabel='本月无需评分';exempt=true;}
  else if(target?.ratingRequired===false){reason=target.unavailableReason==='rating_scope_frozen'||target.frozen||past.length?'本月沿用已提交的原评分关系，新岗位从下月开始评分。':'该负责人不在本月老板评分范围，请核对角色、在职月份或评分关系。';statusLabel=target.unavailableReason==='rating_scope_frozen'||target.frozen||past.length?'本月关系已锁定':'评分范围待核实';}
  return {department,leaderId,name,saved,past,state:saved?'done':exempt?'exempt':reason?'blocked':'pending',reason,statusLabel:saved?'已完成':statusLabel,frozen:Boolean(target?.frozen)} as Row;
 }).sort((a,b)=>({pending:0,done:1,blocked:2,exempt:3}[a.state]-{pending:0,done:1,blocked:2,exempt:3}[b.state])||a.department.name.localeCompare(b.department.name,'zh-CN'));
}
function readDrafts(owner:string):Record<string,Draft>{
 try{const raw=JSON.parse(sessionStorage.getItem('boss-leader-drafts:'+owner)||'{}');if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};return Object.fromEntries(Object.entries(raw).filter(([,value])=>value&&typeof value==='object').map(([key,value])=>{const item=value as Partial<Draft>;return [key,{score:typeof item.score==='string'?item.score:'',comment:typeof item.comment==='string'?item.comment.slice(0,4000):'',submitted:item.submitted===true}];}));}catch{return {};}
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
 const visible=rows.filter(row=>(filter==='all'||row.state===filter)&&(!search.trim()||(row.name+' '+row.department.name).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
 const row=rows.find(item=>item.department.id===selected);
 const value=row?drafts[draftKey(month,row.department.id,row.leaderId)]||{score:'',comment:''}:{score:'',comment:''};
 const dirty=Object.values(drafts).some(draft=>!draft.submitted&&(draft.score.trim()||draft.comment.trim()));
 useEffect(()=>{if(!owner)return;try{sessionStorage.setItem('boss-leader-drafts:'+owner,JSON.stringify(drafts));}catch{}},[drafts,owner]);
 useEffect(()=>{if(!active)return;const leave=(event:Event)=>{if(busy)event.preventDefault();};const unload=(event:BeforeUnloadEvent)=>{if(busy||dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('organization-before-leave',leave);window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener('organization-before-leave',leave);window.removeEventListener('beforeunload',unload);};},[active,busy,dirty]);
 async function load(requestedMonth=month,{initial=false}:{initial?:boolean}={}):Promise<Data|null>{
  controller.current?.abort();const abort=new AbortController();controller.current=abort;const sequence=++requestSequence.current;
  setLoading(true);setLoadError('');
  try{
   const response=await fetch('/api/departments?month='+encodeURIComponent(requestedMonth),{signal:abort.signal}),result=await response.json();
   if(!response.ok)throw Error(errors[result.error]||'负责人名单读取失败，请重试。');
   if(abort.signal.aborted||sequence!==requestSequence.current||monthRef.current!==requestedMonth||!mounted.current)return null;
   if(!Array.isArray(result.departments)||!Array.isArray(result.scores)||!Array.isArray(result.employees))throw Error('负责人名单暂不可用，请重试。');
   const next=result as Data;setData(next);setLoadedMonth(requestedMonth);
   if(ownerRef.current!==next.currentUserId){ownerRef.current=next.currentUserId;setOwner(next.currentUserId);setDrafts(readDrafts(next.currentUserId));setReceipts({});}
   const nextRows=rowsFor(next,requestedMonth,{});
   if(initial){const first=nextRows.find(item=>item.state==='pending')||nextRows.find(item=>item.state==='done')||nextRows[0];setSelected(first?.department.id||'');setFilter(first?.state||'pending');}
   return next;
  }catch(error){if(!abort.signal.aborted&&sequence===requestSequence.current&&mounted.current){setLoadError(error instanceof Error?error.message:'负责人名单读取失败，请重试。');}return null;}
  finally{if(!abort.signal.aborted&&sequence===requestSequence.current&&mounted.current)setLoading(false);}
 }
 useEffect(()=>{setData(null);setLoadedMonth('');setSelected('');setSearch('');setMessage('');setNextNotice('');void load(month,{initial:true});return()=>controller.current?.abort();},[month]);
 function chooseFilter(next:Filter){if(busy||loading)return;setFilter(next);setMessage('');const first=rows.find(item=>(next==='all'||item.state===next)&&(!search.trim()||(item.name+' '+item.department.name).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));setSelected(first?.department.id||'');}
 function update(field:'score'|'comment',text:string){if(!row||busy||loading)return;const key=draftKey(month,row.department.id,row.leaderId);setDrafts(previous=>({...previous,[key]:{...(previous[key]||{score:'',comment:''}),[field]:text,submitted:false}}));setMessage('');setNextNotice('');}
 async function submit(advance:boolean){
  if(!latest||!row||row.state!=='pending'||!latest.canScore||busy||loading)return;
  const submittedMonth=month,target=row,key=draftKey(submittedMonth,target.department.id,target.leaderId),draft=draftsRef.current[key]||{score:'',comment:''};
  if(!draft.score.trim()||!Number.isFinite(Number(draft.score))||Number(draft.score)<0||Number(draft.score)>100||!draft.comment.trim()){setMessageKind('error');setMessage('请填写0–100分和具体评价。');return;}
  setBusy(true);onBusyChange?.(true);setMessage('');setNextNotice('');
  try{
   const response=await fetch('/api/departments/score',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({departmentId:target.department.id,leaderUserId:target.leaderId,month:submittedMonth,score:draft.score,comment:draft.comment})}),result=await response.json();
   if(!response.ok)throw Error(errors[result.error]||'提交失败，草稿已保留，请刷新名单后重试。');
   const receipt:SavedScore={department_id:target.department.id,leader_user_id:target.leaderId,month:submittedMonth,score:Number(draft.score),comment:draft.comment.trim(),scorer_name:'本人',created_at:new Date().toISOString()};
   if(!mounted.current)return;
   setReceipts(previous=>({...previous,[key]:receipt}));setDrafts(previous=>({...previous,[key]:{...draft,submitted:true}}));
   if(monthRef.current!==submittedMonth)return;
   const refreshed=await load(submittedMonth);
   if(!mounted.current||monthRef.current!==submittedMonth)return;
   if(!refreshed){setSelected(target.department.id);setFilter('done');setMessageKind('warning');setMessage('评分已提交并锁定，名单暂未刷新。请重试读取，避免重复提交。');return;}
   setMessageKind('success');setMessage('老板评分已保存，占30%；同事互评完成后自动合成最终分');
   if(advance){
    const pending=rowsFor(refreshed,submittedMonth,{[key]:receipt}).filter(item=>item.state==='pending');
    const position=rows.findIndex(item=>item.department.id===target.department.id),following=rows.slice(position+1).find(item=>pending.some(next=>next.department.id===item.department.id)),next=following||pending[0];
    if(next){setFilter('pending');setSearch('');setSelected(next.department.id);setNextNotice('已进入下一位：'+next.name+' · '+next.department.name+'。');}
    else{setFilter('done');setSelected(target.department.id);setNextNotice('本月待评负责人已全部完成，可在“已完成”查看记录。');}
   }else{setFilter('done');setSelected(target.department.id);}
  }catch(error){if(mounted.current&&monthRef.current===submittedMonth){setMessageKind('error');setMessage(error instanceof Error?error.message:'提交失败，草稿已保留，请重试。');}}
  finally{if(mounted.current){setBusy(false);onBusyChange?.(false);}}
 }
 const archived=(latest?.archivedDepartments||[]).map(department=>({department,scores:(latest?.scores||[]).filter(score=>score.department_id===department.id&&score.month===month)})).filter(item=>item.scores.length);
 const nameFor=(id:string)=>latest?.employees.find(person=>person.userId===id)?.name||id;
 const locked=loading||busy||!latest?.canScore||row?.state!=='pending';
 return <section className="boss-leader-panel v2-card" aria-label="负责人评分" aria-busy={loading}>
  {sharedMonth===undefined&&<header className="bl-heading"><div><h3>负责人月度评分</h3><p>选择负责人，记录本月评分与评价。</p></div><ReviewMonthPicker aria-label="负责人评分月份" value={month} max={current} disabled={busy} onChange={setLocalMonth}/></header>}
  <div className="bl-overview"><div className="bl-counts" aria-label="负责人评分进度">{([{key:'pending',label:'待评分'},{key:'done',label:'已完成'},{key:'blocked',label:'待处理'},{key:'exempt',label:'无需评分'}] as const).map(item=><div className={'bl-metric is-'+item.key} key={item.key}><span><i aria-hidden="true"/>{item.label}</span><strong>{loading?'—':counts[item.key]}<small>项</small></strong></div>)}</div><div className="bl-rule"><span>月度综合分构成</span><p>老板评分 <b>30%</b><em>＋</em>同事互评 <b>70%</b></p><div className="bl-weight-bar" aria-hidden="true"><span/><span/></div><small>两部分完成后自动发布</small></div></div>
  {latest&&!latest.canScore&&<p className="bl-permission"><ShieldCheck size={14}/>当前为只读查看，负责人评分由老板本人提交。</p>}
  {message&&<p className={`bl-message is-${messageKind}`} role={messageKind==='error'?'alert':'status'}>{messageKind==='success'?<CheckCheck size={15}/>:<Clock3 size={15}/>}<span>{message}</span></p>}
  {nextNotice&&<p className="bl-next-notice" role="status">{nextNotice}</p>}
  {loadError&&<div className="bl-error" role="alert"><p>{loadError}</p><button type="button" className="secondary-button" disabled={busy} onClick={()=>void load(month,{initial:!latest})}>重试读取名单</button></div>}
  <div className="bl-workspace"><aside className="bl-directory"><label className="bl-search"><Search size={15}/><input aria-label="搜索负责人或部门" placeholder="搜索负责人或部门" value={search} disabled={busy||loading} onChange={event=>{const text=event.target.value;setSearch(text);const first=rows.find(item=>(filter==='all'||item.state===filter)&&(item.name+' '+item.department.name).toLocaleLowerCase().includes(text.trim().toLocaleLowerCase()));setSelected(first?.department.id||'');}}/></label>
   <nav className="bl-filters" role="tablist" aria-label="负责人评分筛选">{([{id:'pending',label:'待评分'},{id:'done',label:'已完成'},{id:'blocked',label:'待处理'},{id:'exempt',label:'无需评分'},{id:'all',label:'全部'}] as const).map(item=><button type="button" role="tab" aria-selected={filter===item.id} key={item.id} disabled={busy||loading} onClick={()=>chooseFilter(item.id)}>{item.label}<span>{loading?'—':counts[item.id]}</span></button>)}</nav>
   <div className="bl-person-list">{loading?<p className="bl-loading" role="status"><Clock3 size={17}/>正在读取本月负责人名单…</p>:visible.length?visible.map(item=><button type="button" key={item.department.id} className={`bl-person is-${item.state}${selected===item.department.id?' is-selected':''}`} data-department-id={item.department.id} aria-label={'选择负责人 '+item.name+' · '+item.department.name} aria-pressed={selected===item.department.id} disabled={busy} onClick={()=>{setSelected(item.department.id);setMessage('');setNextNotice('');}}><span className="bl-avatar">{!item.leaderId||item.name==='姓名待同步'?<UserRoundCheck size={15}/>:item.name.slice(-2)}</span><span className="bl-person-copy"><strong>{item.name}</strong><span className="bl-person-meta"><small>{item.department.name}</small><em>{item.statusLabel}</em></span></span>{item.saved?<b className="bl-list-score">{scoreText(Number(item.saved.score))}</b>:<ArrowRight size={14}/>}</button>):<div className="bl-list-empty"><UserRoundCheck size={23}/><strong>{search?'没有匹配的负责人':filter==='pending'?'本月没有待评分项目':filter==='done'?'本月暂无已完成评分':filter==='blocked'?'当前没有待处理项目':filter==='exempt'?'本月没有无需评分项目':'所选月份暂无评分对象'}</strong><p>{search?'换一个姓名或部门关键词试试。':'可以切换筛选查看其他记录。'}</p></div>}</div>
  </aside><div className="bl-detail">{loading?<div className="bl-empty-editor" role="status">正在整理所选月份的评分资料…</div>:row?<article className="bl-editor" data-department-id={row.department.id}>
   <div className="bl-editor-heading"><div className="bl-editor-identity"><span className="bl-editor-avatar">{!row.leaderId||row.name==='姓名待同步'?<UserRoundCheck size={23}/>:row.name.slice(-2)}</span><div><span className="bl-month">{monthText(month)}</span><h4>{row.name}</h4><p><Building2 size={14}/>{row.department.name}</p></div></div><span className={`bl-status is-${row.state}`}>{row.state==='done'?<LockKeyhole size={13}/>:<Clock3 size={13}/>}<span>{row.state==='done'?'已提交锁定':row.statusLabel}</span></span></div>
   {row.frozen&&row.leaderId!==row.department.leader_user_id&&<p className="bl-frozen">本月沿用已冻结的负责人评分对象；当前岗位变更不覆盖本月历史记录。</p>}
   {row.saved?<div className="bl-saved"><div><span>老板评分 · 占30%</span><strong>{scoreText(Number(row.saved.score))}<small>分</small></strong></div><div><span>评分说明</span><p>{row.saved.comment}</p><small>{row.saved.scorer_name||'已记录评分人'}{row.saved.created_at?' · '+row.saved.created_at:''}</small></div></div>:row.state==='blocked'||row.state==='exempt'?<div className="bl-blocked"><ShieldCheck size={22}/><h5>{row.state==='exempt'?'本项无需评分':'本项暂不可评分'}</h5><p>{row.reason}</p><small>已有评分及历史负责人记录继续保留。</small></div>:<>
    <p className="bl-guidance">结合本月交付、团队管理与协作表现给出评价。此项为老板评分，与AI周报质量分分别记录。</p>
    <div className="bl-form"><label className="bl-score-field"><span>老板评分 <small>0–100分</small></span><div><input type="number" min="0" max="100" step="0.1" aria-label={row.name+'老板评分'} placeholder="0–100" value={value.score} disabled={locked} onChange={event=>update('score',event.target.value)}/><b>/ 100</b></div></label><label className="bl-comment-field"><span>评分说明 <small>必填</small></span><textarea aria-label={row.name+'评分说明'} value={value.comment} maxLength={4000} rows={5} disabled={locked} placeholder="写清具体成果、管理或协作表现，以及下一步建议。" onChange={event=>update('comment',event.target.value)}/><small>{value.comment.length} / 4000</small></label></div>
    <footer className="bl-submit-bar"><p><LockKeyhole size={12}/>提交后锁定；切换负责人或月份会保留草稿。</p><div><button type="button" className="secondary-button" disabled={locked} onClick={()=>void submit(false)}><Send size={13}/>{busy?'提交中…':'提交评分'}</button><button type="button" className="primary-button" disabled={locked} onClick={()=>void submit(true)}>提交并评下一位 <ArrowRight size={14}/></button></div></footer>
   </>}
   {row.leaderId&&row.state!=='exempt'&&<p className="bl-multiple-note">同一负责人兼任多个部门时，各部门分别评分，系统按既有规则汇总老板分。</p>}
   {!!row.past.length&&<details className="bl-history"><summary>本月历任负责人评分（{row.past.length}）</summary>{row.past.map(score=><article key={score.leader_user_id}><strong>{nameFor(score.leader_user_id)} · {scoreText(Number(score.score))} 分</strong><p>{score.comment}</p><small>{score.scorer_name||'历史评分人'}{score.created_at?' · '+score.created_at:''}</small></article>)}</details>}
  </article>:<div className="bl-empty-editor"><UserRoundCheck size={29}/><h4>选择一项负责人评分</h4><p>左侧按负责人和部门列出任务，待评分项目优先展示。</p></div>}</div></div>
  {!!archived.length&&<details className="bl-archived" aria-label="已移除部门历史评分"><summary>已移除部门历史评分（{archived.length}）</summary><p>仅展示所选月份已保存的历史评分，当前组织不再包含这些部门。</p>{archived.map(item=><article key={item.department.id}><h4>{item.department.name}</h4>{item.scores.map(score=><div key={score.leader_user_id}><strong>{nameFor(score.leader_user_id)} · {scoreText(Number(score.score))} 分</strong><p>{score.comment}</p><small>{score.scorer_name||'历史评分人'}{score.created_at?' · '+score.created_at:''}</small></div>)}</article>)}</details>}
 </section>;
}
