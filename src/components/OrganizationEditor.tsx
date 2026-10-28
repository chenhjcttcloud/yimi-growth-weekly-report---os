import {locationValue,rememberLocation} from '../lib/navigation';
import {useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {AppSelect} from './AppSelect';
import {ArrowDown, ArrowUp, Building2, Check, CheckCheck, ChevronDown, ChevronRight, GitBranch, GripVertical, Info, Network, Plus, RefreshCw, RotateCcw, Save, Search, ShieldCheck, UserRoundCheck, UsersRound, X} from 'lucide-react';

type Department = {id:string; name:string; parent_id:string; leader_user_id:string; leader_mode:'primary'|'concurrent'; sort_order:number; is_active:number; leaderName?:string; feishu_id?:string; local_override?:string};
type Employee = {userId:string; name:string; department:string; directDepartmentIds:string[]};
type Organization = {departments:Department[]; employees:Employee[]; layoutRevision:string};
const errors:Record<string,string> = {
 department_leader_managed_by_feishu:'该部门负责人以飞书通讯录为准，请同步飞书后重试。',
 department_layout_conflict:'组织架构已被更新，请先记录当前修改，再刷新页面重新设置。',
 department_hierarchy_cycle:'不能将部门移动到自己或下级部门中。',
 invalid_parent_department:'上级部门不存在或已停用。',
 leader_must_be_department_member:'跨部门负责人请勾选“兼任负责人”。',
 leader_not_registered:'请选择系统内的在职员工。', department_not_empty:'请先移走成员和下级部门，再停用此部门。',
 department_exists:'部门名称已存在，请更换名称。', invalid_department:'请检查部门名称、层级和负责人设置。',
};
const payload = (rows:Department[]) => rows.map(({id,name,parent_id,leader_user_id,leader_mode,sort_order,is_active})=>({id,name,parent_id,leader_user_id,leader_mode,sort_order,is_active}));

export function OrganizationEditor(){
 const [data,setData]=useState<Organization|null>(null),[rows,setRows]=useState<Department[]>([]),[selected,setSelected]=useState(()=>locationValue('departmentId'));
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(false),[search,setSearch]=useState('');
 const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
 const [dragging,setDragging]=useState(false);
 const dragged=useRef('');
 const setDragged=(id:string)=>{dragged.current=id;setDragging(Boolean(id));};
 async function load(){
  try{const r=await fetch('/api/departments');if(!r.ok)throw Error();const j:Organization=await r.json();setData(j);setRows(j.departments);setSelected(id=>j.departments.some(d=>d.id===id)?id:j.departments[0]?.id||'');}
  catch{setMessage('部门数据加载失败，请刷新重试。');}
 }
 useEffect(()=>{void load();},[]);
 useEffect(()=>{if(data&&selected)rememberLocation('departmentId',selected);},[data,selected]);
 const dirty=Boolean(data&&JSON.stringify(payload(rows))!==JSON.stringify(payload(data.departments)));
 async function syncLeaders(){
  if(dirty&&!window.confirm('同步飞书将刷新当前页面，是否放弃尚未保存的组织架构修改？'))return;
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/departments/sync-feishu',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),result=await response.json();
   if(!response.ok)throw Error(errors[result.error]||(result.error==='feishu_not_configured'?'请先在系统设置中配置飞书应用。':'同步失败，请检查飞书通讯录权限和可见范围后重试。'));
   await load();setMessage(`已同步 ${result.departmentCount} 个部门、${result.leaders} 个部门负责人。${result.unresolvedLeaderNames?' '+result.unresolvedLeaderNames+' 位负责人未返回姓名，已标记“姓名待同步”；请开通“获取用户基本信息” contact:user.base:readonly 后重新同步。':''}`);
  }catch(error){setMessage(error instanceof Error?error.message:'同步失败，请重试。');}finally{setBusy(false);}
 }
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};const leave=(e:Event)=>{if(!window.confirm('组织架构有未保存修改，确定放弃并离开？'))e.preventDefault();};window.addEventListener('beforeunload',warn);window.addEventListener('organization-before-leave',leave);return()=>{window.removeEventListener('beforeunload',warn);window.removeEventListener('organization-before-leave',leave);};},[dirty]);
 useEffect(()=>{if(!preview)return;const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)setPreview(false);if(e.key==='Tab'){const buttons=document.querySelectorAll<HTMLButtonElement>('.org-preview button:not(:disabled):not([tabindex="-1"])');const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[preview,busy]);
 const selectedDepartment=rows.find(d=>d.id===selected);
 const leaderLabel=(d:Department)=>!d.leader_user_id?'':d.feishu_id?(d.leaderName||data?.employees.find(e=>e.userId===d.leader_user_id)?.name||''):(data?.employees.find(e=>e.userId===d.leader_user_id)?.name||'');
 const siblings=(parent:string)=>rows.filter(d=>d.parent_id===parent).sort((a,b)=>a.sort_order-b.sort_order||a.name.localeCompare(b.name,'zh-CN'));
 function isDescendant(id:string,ancestor:string){const seen=new Set<string>();let p=id;while(p&&!seen.has(p)){if(p===ancestor)return true;seen.add(p);p=rows.find(d=>d.id===p)?.parent_id||'';}return false;}
 function update(change:Partial<Department>){setRows(v=>v.map(d=>d.id===selected?{...d,...change}:d));setMessage('');}
 function add(parent:string){const id=crypto.randomUUID();setRows(v=>[...v,{id,name:'',parent_id:parent,leader_user_id:'',leader_mode:'primary',sort_order:siblings(parent).length?Math.max(...siblings(parent).map(d=>d.sort_order))+1:0,is_active:1}]);setSelected(id);setCollapsed(v=>{const next=new Set(v);next.delete(parent);return next;});setMessage('');}
 function reorder(id:string,direction:number){const item=rows.find(d=>d.id===id);if(!item)return;const group=siblings(item.parent_id),i=group.findIndex(d=>d.id===id),other=i+direction;if(other<0||other>=group.length)return;[group[i],group[other]]=[group[other],group[i]];setRows(v=>v.map(d=>{const index=group.findIndex(x=>x.id===d.id);return index<0?d:{...d,sort_order:index};}));}
 function drop(target:string,before=false,sourceId=dragged.current){
  const source=rows.find(d=>d.id===sourceId),dest=rows.find(d=>d.id===target);setDragged('');
  if(!source||source.id===target)return;
  const parent=before?dest?.parent_id||'':target;
  if(parent&&(!rows.find(d=>d.id===parent)?.is_active||isDescendant(parent,source.id))){setMessage('不能移动到自己、下级部门或已停用部门中。');return;}
  const group=siblings(parent).filter(d=>d.id!==source.id),index=before?group.findIndex(d=>d.id===target):group.length;
  group.splice(index<0?group.length:index,0,{...source,parent_id:parent});
  setRows(v=>v.map(d=>{const index=group.findIndex(x=>x.id===d.id);return index<0?d:{...group[index],sort_order:index};}));
  setCollapsed(v=>{const n=new Set(v);n.delete(parent);return n;});
 }
 function validate(){
  const names=rows.map(d=>d.name.trim());if(names.some(n=>!n)||new Set(names).size!==names.length){setMessage('请填写不重复的部门名称。');return false;}
  return true;
 }
 async function save(){
  if(!data||!validate())return;setBusy(true);setMessage('');
  try{const r=await fetch('/api/departments/layout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:data.layoutRevision,departments:payload(rows).map(d=>({...d,name:d.name.trim()}))})});const j=await r.json();if(!r.ok)throw Error(errors[j.error]||'保存失败，请检查设置后重试。');setPreview(false);await load();setMessage('组织架构已保存；员工主部门和数据权限未改变。');}
  catch(e){setMessage(e instanceof Error?e.message:'保存失败，请重试。');}finally{setBusy(false);}
 }
 function tree(parent='',depth=0):ReactNode{
  return siblings(parent).map(d=>{
   const children=rows.some(x=>x.parent_id===d.id),matches=preview||!search||d.name.includes(search)||rows.some(x=>x.name.includes(search)&&isDescendant(x.id,d.id));
   if(!matches)return null;
   const group=siblings(parent),leader=leaderLabel(d),count=data?.employees.filter(e=>e.directDepartmentIds.includes(d.id)).length||0;
   return <div className="org-tree-node" key={d.id}>
    {!preview&&<div className="org-drop-before" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();e.stopPropagation();drop(d.id,true);}}/>}
    <div className={`org-tree-row ${selected===d.id&&!preview?'is-active':''} ${!d.is_active?'is-inactive':''}`} draggable={!preview&&!busy} onDragStart={e=>{e.dataTransfer.setData('text/plain',d.id);e.dataTransfer.effectAllowed='move';setDragged(d.id);}} onDragEnd={()=>setDragged('')} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add('is-drop-target');}} onDragLeave={e=>e.currentTarget.classList.remove('is-drop-target')} onDrop={e=>{e.preventDefault();e.stopPropagation();e.currentTarget.classList.remove('is-drop-target');drop(d.id);}}>
     {!preview&&<GripVertical className="org-drag-grip" size={13} aria-hidden="true"/>}
     <button type="button" className="org-toggle" aria-label={(collapsed.has(d.id)?'展开':'收起')+d.name} disabled={!children||preview} onClick={()=>setCollapsed(v=>{const n=new Set(v);n.has(d.id)?n.delete(d.id):n.add(d.id);return n;})}>{children?(collapsed.has(d.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>):<span className="org-leaf-dot"/>}</button>
     <span className={`org-department-icon ${depth?'is-child':''}`} aria-hidden="true">{depth?<GitBranch size={16}/>:<Building2 size={17}/>}</span>
     <button type="button" className="org-tree-select" tabIndex={preview?-1:0} onClick={()=>!preview&&setSelected(d.id)} aria-pressed={selected===d.id}><span className="org-tree-name"><strong>{d.name||'未命名部门'}</strong>{!d.is_active&&<span className="org-mini-tag is-muted">已停用</span>}</span><small><span>{depth===0?'一级部门':`${depth+1}级部门`}</span><span className="org-text-dot">·</span><span>{leader||(d.leader_user_id?'姓名待同步':d.feishu_id?'飞书未设置负责人':'待设置负责人')}</span>{leader&&d.leader_mode==='concurrent'&&<span className="org-mini-tag is-concurrent">兼任</span>}</small></button>
     {!preview&&<><span className="org-tree-count" title="直属成员人数">{count}<UsersRound size={12}/></span><span className="org-row-actions"><button type="button" aria-label={'上移'+d.name} disabled={busy||group[0]?.id===d.id} onClick={()=>reorder(d.id,-1)}><ArrowUp size={13}/></button><button type="button" aria-label={'下移'+d.name} disabled={busy||group.at(-1)?.id===d.id} onClick={()=>reorder(d.id,1)}><ArrowDown size={13}/></button></span></>}
    </div>{(!collapsed.has(d.id)||search||preview)&&children&&<div className="org-children">{tree(d.id,depth+1)}</div>}
   </div>;
  });
 }
 if(!data)return <section className="v2-card org-loading"><span className="org-title-icon"><Network size={22}/></span><p role="status">{message||'正在加载组织架构…'}</p>{message&&<button className="secondary-button" onClick={()=>void load()}>重试</button>}</section>;
 const directMembers=data.employees.filter(e=>e.directDepartmentIds.includes(selected));
 const blocked=rows.some(d=>d.parent_id===selected)||directMembers.length>0;
 const changes=rows.filter(d=>JSON.stringify(payload([d]))!==JSON.stringify(payload(data.departments.filter(x=>x.id===d.id))));
 const parentName=rows.find(d=>d.id===selectedDepartment?.parent_id)?.name;
 const currentLeader=selectedDepartment?leaderLabel(selectedDepartment):'';
 const concurrentCount=rows.filter(d=>d.is_active&&d.leader_user_id&&d.leader_mode==='concurrent').length;
 return <section className={`org-editor ${dragging?'is-dragging':''}`}>
  <header className="org-heading"><div className="org-heading-title"><span className="org-title-icon"><Network size={22}/></span><div><h3>组织架构设置</h3><p>调整团队结构，让每一份职责都有归属。</p></div></div><div className="org-actions"><span className={`org-save-state ${dirty?'is-dirty':''}`}>{dirty?<span className="org-state-dot"/>:<CheckCheck size={14}/>}<span>{dirty?`${changes.length} 个部门待保存`:'所有修改已保存'}</span></span><button type="button" className="secondary-button" disabled={busy} onClick={()=>void syncLeaders()}><RefreshCw size={14}/>{busy?'处理中…':'同步飞书负责人'}</button><button className="secondary-button org-undo" aria-label="撤销修改" disabled={!dirty||busy} onClick={()=>{if(window.confirm('放弃尚未保存的组织架构修改？')){setRows(data.departments);setPreview(false);setMessage('');}}}><RotateCcw size={14}/><span>撤销修改</span></button><button className="primary-button" disabled={!dirty||busy} onClick={()=>{if(validate())setPreview(true);}}><Save size={15}/>预览并保存</button></div></header>
  <div className="org-summary-strip" aria-label="组织架构概况"><span><Building2 size={14}/>部门总数<strong>{rows.length}</strong></span><span><GitBranch size={14}/>一级部门<strong>{rows.filter(d=>!d.parent_id).length}</strong></span><span><UsersRound size={14}/>在职成员<strong>{data.employees.length}</strong></span><span><UserRoundCheck size={14}/>兼任负责人<strong>{concurrentCount}</strong></span></div>
  {message&&<div className="org-feedback" role="status"><Info size={16}/><span>{message}</span></div>}
  <div className="org-workspace">
   <aside className="org-directory"><div className="org-directory-head"><div><h3>部门目录</h3><span>选择部门，编辑组织与职责</span></div><button className="org-add-button" aria-label="新增一级部门" title="新增一级部门" disabled={busy} onClick={()=>add('')}><Plus size={17}/><span>新建</span></button></div>
    <div className="org-search"><Search size={16} aria-hidden="true"/><input type="search" aria-label="搜索组织部门" placeholder="搜索部门名称…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <div className="org-company-root"><span className="org-company-icon"><Network size={17}/></span><div><strong>公司组织</strong><small>{rows.filter(d=>d.is_active).length} 个使用中部门</small></div><span className="org-mini-tag">组织树</span></div>
    <nav aria-label="组织部门树">{tree()}</nav>
    {(!rows.length||Boolean(search&&!rows.some(d=>d.name.includes(search))))&&<div className="org-tree-empty"><Search size={22}/><p>{rows.length?'未找到匹配的部门':'从第一个部门开始'}</p><span>{rows.length?'试试其他部门名称':'点击右上角“新建”搭建组织'}</span></div>}
    <div className="org-root-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();drop('');}}><Plus size={14}/><span>拖到此处设为一级部门</span></div>
    <div className="org-tree-help"><GripVertical size={14}/><p>拖拽调整层级与顺序，也可使用上移、下移按钮。</p></div>
   </aside>
   <article className="org-detail">{selectedDepartment?<>
    <header className="org-detail-head"><div className="org-detail-title"><span className="org-detail-icon"><Building2 size={23}/></span><div><div className="org-breadcrumb">公司组织<ChevronRight size={11}/>{parentName&&<>{parentName}<ChevronRight size={11}/></>}<span>部门配置</span></div><h3>{selectedDepartment.name||'新部门'}<span className={`org-status-pill ${selectedDepartment.is_active?'':'is-muted'}`}><span/>{selectedDepartment.is_active?'使用中':'已停用'}</span></h3></div></div><div className="org-detail-actions"><button className="secondary-button" disabled={busy} onClick={()=>add(selectedDepartment.parent_id)}><Plus size={13}/>新增同级</button><button className="secondary-button" disabled={busy||!selectedDepartment.is_active} onClick={()=>add(selected)}><GitBranch size={13}/>新增子部门</button></div></header>
    <fieldset disabled={busy} className="org-fields">
     <section className="org-form-section"><div className="org-section-title"><span><Building2 size={15}/>基本信息</span><small>定义部门的名称与位置</small></div><div className="org-field-grid"><label className="org-field-wide">部门名称<input aria-label="部门名称" value={selectedDepartment.name} maxLength={80} onChange={e=>update({name:e.target.value})} placeholder="为部门起一个清晰的名称"/></label><label>上级部门<AppSelect aria-label="上级部门" value={selectedDepartment.parent_id} onValueChange={value=>update({parent_id:value,sort_order:Math.max(-1,...siblings(value).map(d=>d.sort_order))+1})}><option value="">无（一级部门）</option>{rows.filter(d=>d.is_active&&!isDescendant(d.id,selected)).map(d=><option key={d.id} value={d.id}>{d.name||'未命名部门'}</option>)}</AppSelect></label><label>部门状态<AppSelect aria-label="部门状态" value={selectedDepartment.is_active} onValueChange={value=>update({is_active:Number(value)})}><option value={1}>使用中</option><option value={0} disabled={blocked}>已停用{blocked?'（须先移走成员和下级部门）':''}</option></AppSelect></label></div></section>
     <section className="org-form-section"><div className="org-section-title"><span><UserRoundCheck size={15}/>负责人设置</span><small>{selectedDepartment.feishu_id?'来自飞书通讯录':'支持跨部门兼任'}</small></div>
      {selectedDepartment.feishu_id?<div className="org-feishu-leader"><label>部门负责人<input aria-label="飞书部门负责人" value={currentLeader||(selectedDepartment.leader_user_id?'姓名待同步':'飞书未设置负责人')} readOnly/></label><p className="pf-caption">{selectedDepartment.leader_user_id?'user_id：'+selectedDepartment.leader_user_id+' · ':''}{selectedDepartment.leader_user_id&&!currentLeader?'负责人已关联，姓名待同步。':''}负责人由飞书直接同步；如需调整，请在飞书组织架构中修改后再次同步。</p></div>:<>
      <label>部门负责人<AppSelect aria-label="部门负责人" searchPlaceholder="搜索姓名或部门…" value={selectedDepartment.leader_user_id} onValueChange={value=>{const employee=data.employees.find(x=>x.userId===value);update({leader_user_id:value,leader_mode:employee&&!employee.directDepartmentIds.some(id=>isDescendant(id,selected))?'concurrent':selectedDepartment.leader_mode});}}><option value="">暂不设置</option>{selectedDepartment.leader_user_id&&!data.employees.some(e=>e.userId===selectedDepartment.leader_user_id)&&<option value={selectedDepartment.leader_user_id}>{selectedDepartment.leaderName||'飞书同步负责人'}</option>}{data.employees.map(e=><option key={e.userId} value={e.userId}>{e.name} · {e.department||'未分配部门'}</option>)}</AppSelect></label>
      <div className={`org-concurrent-card ${selectedDepartment.leader_mode==='concurrent'?'is-on':''}`}><span className="org-concurrent-icon"><UsersRound size={19}/></span><div><label className="org-switch-label" htmlFor="org-concurrent">兼任负责人</label><p>保留原部门归属，独立记录本部门职责与评分。</p></div><label className="org-switch"><input id="org-concurrent" aria-label="兼任负责人" type="checkbox" checked={selectedDepartment.leader_mode==='concurrent'} onChange={e=>update({leader_mode:e.target.checked?'concurrent':'primary'})}/><span aria-hidden="true"/></label></div>
      </>}
      {currentLeader&&<p className="org-leader-note"><span className="org-person-avatar">{currentLeader.slice(0,1)}</span><span><strong>{currentLeader}</strong>{selectedDepartment.feishu_id?' · 飞书同步':selectedDepartment.leader_mode==='concurrent'?' 正在兼任此部门负责人':' 为此部门负责人'}</span></p>}
     </section>
    </fieldset>
    <section className="org-members"><div className="org-section-title"><span><UsersRound size={15}/>直属成员<span className="org-count-badge">{directMembers.length}</span></span><small>成员信息来自飞书</small></div>{directMembers.length?<div className="org-member-list">{directMembers.map(e=><span className="org-member-chip" key={e.userId}><span className="org-person-avatar">{e.name.slice(0,1)}</span>{e.name}{e.userId===selectedDepartment.leader_user_id&&<span className="org-mini-tag">负责人</span>}</span>)}</div>:<div className="org-member-empty"><UsersRound size={20}/><div><strong>暂无直属成员</strong><p>飞书成员同步后，将在这里显示。</p></div></div>}</section>
    <footer className="org-detail-foot"><ShieldCheck size={15}/><p>{selectedDepartment.feishu_id?'负责人以飞书通讯录为准；本地名称、层级和排序调整仍会保留。':'结构调整不会改变员工主部门，也不会自动扩大数据权限。'}</p></footer>
   </>:<div className="org-detail-empty"><span className="org-title-icon"><Building2 size={25}/></span><h3>从一个部门开始</h3><p>选择左侧部门，或新建一个部门，<br/>让团队的组织和职责逐步清晰。</p><button className="primary-button" disabled={busy} onClick={()=>add('')}><Plus size={15}/>创建部门</button></div>}</article>
  </div>
  {preview&&createPortal(
   <div className="org-modal-backdrop">
    <section className="org-preview" role="dialog" aria-modal="true" aria-labelledby="org-preview-title">
     <header className="org-preview-head">
      <span className="org-title-icon"><CheckCheck size={23}/></span>
      <div><h3 id="org-preview-title">确认组织架构调整</h3><p>本次涉及 <strong>{changes.length}</strong> 个部门，确认后统一生效。</p></div>
      <button className="org-close-button" aria-label="关闭预览" disabled={busy} onClick={()=>setPreview(false)}><X size={19}/></button>
     </header>
     <div className="org-preview-body">
      <div className="org-section-title"><span><Network size={15}/>调整后的组织结构</span></div>
      <div className="org-preview-tree">{tree()}</div>
      <div className="org-section-title"><span>本次变更</span><span className="org-count-badge">{changes.length}</span></div>
      <ul className="org-change-list">{changes.map(d=>{const old=data.departments.find(x=>x.id===d.id);return <li key={d.id}><span className="org-change-icon">{old?<Check size={15}/>:<Plus size={15}/>}</span><div><strong>{d.name}<span className="org-mini-tag">{old?'更新配置':'新增部门'}</span></strong><p>{rows.find(x=>x.id===d.parent_id)?.name||'一级部门'}<span>·</span>{leaderLabel(d)||'未设置负责人'}{d.leader_mode==='concurrent'?'（兼任）':''}<span>·</span>{d.is_active?'使用中':'已停用'}</p></div></li>;})}</ul>
      <p className="org-preview-note"><ShieldCheck size={15}/>员工主部门与访问权限保持不变；上级统计仍包含下级成员。</p>
     </div>
     <footer className="org-preview-foot"><button autoFocus className="secondary-button" disabled={busy} onClick={()=>setPreview(false)}>返回编辑</button><button className="primary-button" disabled={busy} onClick={()=>void save()}><Check size={15}/>{busy?'保存中…':'确认保存组织架构'}</button></footer>
    </section>
   </div>,document.body)}
 </section>;
}
