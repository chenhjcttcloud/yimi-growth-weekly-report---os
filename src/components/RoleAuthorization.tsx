import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ArrowRight, Check, ChevronDown, Crown, Plus, Search, ShieldCheck, UsersRound, X} from 'lucide-react';
import '../styles/role-authorization.css';

type Role = 'boss' | 'admin';
interface Person {userId:string; name:string; department:string; active?:boolean; authorizationOnly?:boolean; source?:string}
interface Grants {members:Person[]; configuredMembers:Person[]; revision:string; currentUserId:string}
interface Snapshot {boss:Grants; admin:Grants; employees:Person[]; candidates:Person[]}
interface AuthorizedPerson extends Person {key:string; roles:Role[]; fixed:Role[]}
const roles:Role[] = ['boss', 'admin'];
const labels:Record<Role,string> = {boss:'老板', admin:'管理员'};
const endpoints:Record<Role,string> = {boss:'/api/boss-view-members', admin:'/api/scoring360-admin-members'};
const keyOf = (person:Person) => person.userId || `legacy:${person.name}`;
const displayName = (person:Person) => person.name || person.userId || '未命名账号';

function AuthorizationDrawer({title, children, footer, onClose}:{title:string; children:ReactNode; footer:ReactNode; onClose:()=>void}) {
  const panel = useRef<HTMLDivElement>(null), close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement|null;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[data-autofocus],button')?.focus());
    function keyboard(event:KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {event.preventDefault(); close.current(); return;}
      if (event.key !== 'Tab') return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') || []).filter(el => el.offsetParent !== null);
      const first = items[0], last = items.at(-1);
      if (!first) return;
      if (!panel.current?.contains(document.activeElement)) {event.preventDefault(); (event.shiftKey ? last : first)?.focus();}
      else if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
    }
    document.addEventListener('keydown', keyboard);
    return () => {cancelAnimationFrame(frame); document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus({preventScroll:true});};
  }, []);
  return createPortal(<div className="ra-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="ra-drawer" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
      <header className="ra-drawer-head"><div><span className="ra-eyebrow"><ShieldCheck size={14}/>角色与权限</span><h2>{title}</h2></div><button type="button" className="ra-icon" aria-label="关闭授权面板" onClick={onClose}><X size={20}/></button></header>
      <div className="ra-drawer-body">{children}</div><footer className="ra-drawer-footer">{footer}</footer>
    </div>
  </div>, document.body);
}

export function RoleAuthorization() {
  const [data, setData] = useState<Snapshot|null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<'all'|Role>('all');
  const [mode, setMode] = useState<'add'|'manage'|null>(null), [target, setTarget] = useState<AuthorizedPerson|null>(null);
  const [role, setRole] = useState<Role>('admin'), [search, setSearch] = useState(''), [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<{role:Role; revoke:boolean}|null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [discard, setDiscard] = useState(false);
  const request = useRef(0), busyRef = useRef(false), dirty = selected.length > 0 || Boolean(confirmation);

  async function load() {
    const id = ++request.current;
    setLoading(true); setLoadError('');
    try {
      const responses = await Promise.all([fetch(endpoints.boss), fetch(endpoints.admin), fetch('/api/employees/manage'), fetch('/api/role-authorization/candidates')]);
      if (responses.some(response=>!response.ok)) throw Error();
      const [boss, admin, roster, directory] = await Promise.all(responses.map(response=>response.json()));
      if (!boss.ok || !admin.ok || !roster.ok || !directory.ok || !Array.isArray(directory.candidates) || !Array.isArray(roster.employees) || [boss,admin].some(item=>!Array.isArray(item.members)||!Array.isArray(item.configuredMembers)||!item.revision)) throw Error();
      if (id === request.current) setData({boss, admin, employees:roster.employees, candidates:directory.candidates});
    } catch {if (id === request.current) setLoadError('授权信息暂时加载失败，请重试。加载完成前无法更改权限。');}
    finally {if (id === request.current) setLoading(false);}
  }
  useEffect(() => {void load(); return () => {request.current++;};}, []);
  useEffect(() => {
    const leave = (event:Event) => {if (mode && (dirty || busy)) {event.preventDefault(); if (!busy) setDiscard(true);}};
    window.addEventListener('organization-before-leave', leave);
    return () => window.removeEventListener('organization-before-leave', leave);
  }, [mode, dirty, busy]);

  const people = useMemo(() => {
    if (!data) return [];
    const all = new Map<string,AuthorizedPerson>();
    for (const currentRole of roles) {
      for (const person of [...data[currentRole].members, ...data[currentRole].configuredMembers]) {
        const key = keyOf(person), roster = data.employees.find(employee=>employee.userId && employee.userId === person.userId) || data.candidates.find(employee=>employee.userId === person.userId);
        const row = all.get(key) || {...person, ...roster, key, roles:[], fixed:[]};
        if (!row.roles.includes(currentRole)) row.roles.push(currentRole);
        if (data[currentRole].configuredMembers.some(item=>keyOf(item) === key) && !row.fixed.includes(currentRole)) row.fixed.push(currentRole);
        all.set(key,row);
      }
    }
    return [...all.values()].sort((a,b)=>displayName(a).localeCompare(displayName(b),'zh-CN'));
  }, [data]);
  const visible = people.filter(person=>(filter === 'all' || person.roles.includes(filter)) && `${person.name} ${person.department} ${person.userId}`.toLowerCase().includes(query.trim().toLowerCase()));
  const currentTarget = people.find(person=>person.key === target?.key) || target;
  const granted = (person:Person, currentRole:Role) => people.some(row=>row.key === keyOf(person) && row.roles.includes(currentRole));
  const selectedPeople = (data?.candidates || []).filter(person=>selected.includes(person.userId));
  const candidates = (data?.candidates || []).filter(person=>person.active && person.userId && `${person.name} ${person.department} ${person.userId}`.toLowerCase().includes(search.trim().toLowerCase()));
  const canEdit = Boolean(data && !loading && !loadError && !busy);

  function reset() {setMode(null); setTarget(null); setSelected([]); setSearch(''); setConfirmation(null); setDiscard(false); setError('');}
  function close() {if (busy) return; if (dirty) setDiscard(true); else reset();}
  function openAdd() {reset(); setRole('admin'); setMode('add');}
  function openManage(person:AuthorizedPerson) {reset(); setTarget(person); setMode('manage');}
  function toggle(id:string) {setError(''); setSelected(items=>items.includes(id)?items.filter(item=>item!==id):[...items,id]);}

  async function save(currentRole:Role, revoke:boolean) {
    if (!data || !canEdit || busyRef.current) return;
    const affected = mode === 'add' ? selectedPeople : currentTarget ? [currentTarget] : [];
    if (!affected.length) return;
    const keys = new Set(affected.map(keyOf));
    const members = revoke ? data[currentRole].members.filter(person=>!keys.has(keyOf(person)))
      : [...data[currentRole].members, ...affected.filter(person=>!granted(person,currentRole)).map(({userId,name,department})=>({userId,name,department}))];
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoints[currentRole], {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({members, expectedRevision:data[currentRole].revision})});
      const result = await response.json();
      if (response.status === 409) {
        reset(); await load(); setMessage('授权刚刚发生变化，已刷新。请核对最新名单后重新操作。'); return;
      }
      if (!response.ok || !result.ok) {
        const errors:Record<string,string> = {authorization_candidate_inactive:'该账号已停用或在飞书中的状态已变化，请刷新后重新选择。',authorization_candidate_not_found:'该人员已不在授权候选中，请刷新后重新选择。',authorization_candidate_unavailable:'无法核实飞书负责人身份，请检查通讯录权限与可见范围后重试。'};
        throw Error(errors[result.error] || '未能完成保存，请重试。若网络中断，可关闭面板后刷新名单核对。');
      }
      setData(previous=>previous?{...previous,[currentRole]:result}:previous);
      reset(); setMessage(`已${revoke?'撤销':'添加'}${affected.length}人的${labels[currentRole]}授权。受影响账号刷新页面后更新视角。`);
      if (affected.some(person=>person.userId === data[currentRole].currentUserId)) window.location.reload();
    } catch (failure) {setError(failure instanceof Error ? failure.message : '未能完成保存，请重试。');}
    finally {busyRef.current = false; setBusy(false);}
  }

  return <section className="ra-workspace" aria-label="角色授权管理">
    <div className="ra-heading"><div><span className="ra-eyebrow"><ShieldCheck size={14}/>访问管理</span><h2>把权限，交给合适的人。</h2><p>这里仅列出拥有管理权限的人员。普通员工通过飞书登录，自动拥有个人视角。</p></div><button type="button" className="primary-button" disabled={!canEdit} onClick={openAdd}><Plus size={16}/>添加授权</button></div>
    <div className="ra-card">
      <div className="ra-toolbar"><div className="ra-filters" aria-label="筛选授权角色">{(['all',...roles] as const).map(item=><button type="button" key={item} aria-pressed={filter===item} onClick={()=>setFilter(item)}>{item==='all'?'全部授权':labels[item]}<span>{item==='all'?people.length:people.filter(person=>person.roles.includes(item)).length}</span></button>)}</div><label className="ra-search"><Search size={16}/><input type="search" aria-label="搜索已授权人员" placeholder="搜索姓名、部门或 user_id" value={query} onChange={event=>setQuery(event.target.value)}/></label><button type="button" className="ra-text-button" disabled={loading||busy} onClick={()=>void load()}>刷新</button></div>
      {message&&<p className="ra-notice" role="status">{message}</p>}
      {loadError?<div className="ra-empty" role="alert"><strong>{loadError}</strong><button type="button" className="secondary-button" onClick={()=>void load()}>重新加载</button></div>:loading?<div className="ra-empty" role="status">正在读取授权名单…</div>:<>
        {visible.length?<div className="ra-table-scroll"><table className="ra-table"><thead><tr><th>授权人员</th><th>所属部门</th><th>角色权限</th><th><span className="ra-sr-only">操作</span></th></tr></thead><tbody>{visible.map(person=><tr key={person.key}>
          <td><div className="ra-person"><span className="ra-avatar">{displayName(person).slice(0,1)}</span><div><strong>{displayName(person)}{person.userId===data?.boss.currentUserId&&<small className="ra-you">你</small>}</strong><small className="ra-user-id">{person.userId||'历史姓名授权 · 请核对身份'}</small>{person.active===false&&<small className="ra-inactive">账号已停用</small>}{person.authorizationOnly&&<small className="ra-directory-only">飞书负责人 · 尚未入册</small>}</div></div></td><td>{person.department||'未填部门'}</td>
          <td><div className="ra-badges">{person.roles.map(currentRole=><span key={currentRole} className={`ra-badge ra-${currentRole}`}>{currentRole==='boss'?<Crown size={13}/>:<ShieldCheck size={13}/>} {labels[currentRole]}</span>)}</div>{person.fixed.length>0&&<small className="ra-configured">含服务配置授权</small>}</td><td><button type="button" className="ra-text-button" disabled={!canEdit} aria-label={`管理${displayName(person)}的授权`} onClick={()=>openManage(person)}>管理<ArrowRight size={14}/></button></td>
        </tr>)}</tbody></table></div>:<div className="ra-empty"><UsersRound size={28}/><strong>{people.length?'没有匹配的授权人员':'还没有通过此处授权的人员'}</strong><span>{people.length?'试试其他姓名、部门或角色。':'点击「添加授权」，为员工授予老板或管理员角色。'}</span></div>}
        <div className="ra-table-foot"><span>共 {people.length} 位授权人员</span><span>授权按飞书 user_id 识别</span></div>
      </>}
    </div>
    <details className="ra-guide"><summary><ShieldCheck size={16}/>老板和管理员有什么区别？<ChevronDown size={15}/></summary><div><p><strong>老板</strong><span>查看全公司管理看板与评分、维护组织和系统设置；侧栏不显示个人成长模块。</span></p><p><strong>管理员</strong><span>拥有相同管理功能，同时保留本人的分数、周报和评分任务。</span></p><p><strong>普通员工</strong><span>查看本人的结果与周报，完成分配给自己的评分任务，无需在此授权。</span></p><small>同时具有两种角色时，系统优先进入老板视角。服务配置赋予的角色需由维护人员调整配置。</small></div></details>

    {mode&&data&&<AuthorizationDrawer title={mode==='add'?'添加角色授权':`管理${currentTarget?displayName(currentTarget):''}的授权`} onClose={close} footer={discard?<div className="ra-discard"><strong>当前选择尚未保存</strong><div><button type="button" className="secondary-button" onClick={()=>setDiscard(false)}>继续编辑</button><button type="button" className="ra-danger-button" onClick={reset}>放弃本次选择</button></div></div>:<>
      {error&&<p className="ra-error" role="alert">{error}</p>}
      {mode==='add'?<div className="ra-footer-row"><span>已选 <strong>{selected.length}</strong> 人 · {labels[role]}</span><button type="button" className="primary-button" disabled={!canEdit||!selected.length} onClick={()=>void save(role,false)}>{busy?'保存中…':'确认添加授权'}</button></div>:confirmation?<div className="ra-confirm"><strong>{confirmation.revoke?'确认撤销':'确认添加'}{labels[confirmation.role]}授权？</strong><p>{currentTarget?.userId===data.boss.currentUserId?'正在修改你自己的权限，保存后将刷新当前页面。':`仅调整${currentTarget?displayName(currentTarget):''}的这一项角色，其他授权保持原样。`}</p><div><button type="button" className="secondary-button" disabled={busy} onClick={()=>{setConfirmation(null);setError('');}}>取消调整</button><button type="button" className={confirmation.revoke?'ra-danger-button':'primary-button'} disabled={!canEdit} onClick={()=>void save(confirmation.role,confirmation.revoke)}>{busy?'保存中…':confirmation.revoke?'确认撤销授权':'确认添加授权'}</button></div></div>:<div className="ra-footer-row"><span>选择上方角色操作后确认保存</span><button type="button" className="secondary-button" onClick={close}>完成</button></div>}
    </>}>
      {mode==='add'?<>
        <div className="ra-role-choice" aria-label="选择授权角色">{roles.map(currentRole=><button type="button" key={currentRole} aria-pressed={role===currentRole} disabled={busy} onClick={()=>{setRole(currentRole);setSelected(ids=>ids.filter(id=>!people.some(person=>person.userId===id&&person.roles.includes(currentRole))));setError('');}}>{currentRole==='boss'?<Crown size={18}/>:<ShieldCheck size={18}/>}<span><strong>{labels[currentRole]}</strong><small>{currentRole==='boss'?'公司管理视角':'管理功能＋个人成长'}</small></span>{role===currentRole&&<Check size={16}/>}</button>)}</div>
        <p className="ra-help">可选择花名册员工或已同步的飞书负责人。未入册人员的授权不会创建员工或评分任务，原有角色保持不变。</p>
        <label className="ra-search"><Search size={16}/><input data-autofocus type="search" aria-label="搜索可授权员工" placeholder="搜索姓名、部门或 user_id" disabled={busy} value={search} onChange={event=>setSearch(event.target.value)}/></label>
        <div className="ra-selection"><span>已选 {selected.length} 人</span>{selectedPeople.map(person=><button type="button" key={person.userId} disabled={busy} aria-label={`取消选择${displayName(person)}`} onClick={()=>toggle(person.userId)}>{displayName(person)}<X size={12}/></button>)}</div>
        <div className="ra-candidate-list" aria-label="可授权员工">{candidates.map(person=>{
          const existing = granted(person,role), other = people.find(row=>row.userId===person.userId)?.roles.filter(item=>item!==role);
          return <label className={`ra-candidate ${existing?'is-granted':''}`} key={person.userId}><input type="checkbox" aria-label={`授权${displayName(person)}为${labels[role]}`} disabled={busy||existing} checked={existing||selected.includes(person.userId)} onChange={()=>toggle(person.userId)}/><span className="ra-avatar">{displayName(person).slice(0,1)}</span><span><strong>{displayName(person)}</strong><small>{person.department||'未填部门'} · {person.userId}</small>{person.authorizationOnly&&<small className="ra-directory-only">飞书负责人 · 尚未入册</small>}</span>{existing?<em>已授权</em>:other?.length?<em>已有{other.map(item=>labels[item]).join('、')}</em>:null}</label>;
        })}{!candidates.length&&<div className="ra-empty">没有匹配人员，请确认已同步飞书部门或该员工已登录系统。</div>}</div>
      </>:currentTarget&&<>
        <div className="ra-target"><span className="ra-avatar">{displayName(currentTarget).slice(0,1)}</span><div><strong>{displayName(currentTarget)}</strong><small>{currentTarget.department||'未填部门'} · {currentTarget.userId||'历史姓名授权'}</small></div></div>
        <p className="ra-help">按角色单独调整，确认后才会保存。普通员工的个人视角无需授权。</p>
        {roles.map(currentRole=>{
          const fixed = currentTarget.fixed.includes(currentRole), has = currentTarget.roles.includes(currentRole);
          return <div className="ra-manage-role" key={currentRole}><div className="ra-manage-title">{currentRole==='boss'?<Crown size={19}/>:<ShieldCheck size={19}/>}<strong>{labels[currentRole]}</strong><span>{has?'已授权':'未授权'}</span></div><p>{currentRole==='boss'?'全公司看板、组织与系统管理；进入老板视角。':'完整管理功能，并保留本人的分数与成长记录。'}</p>{fixed?<small>来自服务配置，请联系维护人员调整。</small>:<button type="button" className={has?'ra-text-button ra-danger':'ra-text-button'} disabled={busy||(!has&&(!currentTarget.userId||!currentTarget.active))} onClick={()=>{setConfirmation({role:currentRole,revoke:has});setError('');}}>{has?'撤销此项授权':'添加此项授权'}<ArrowRight size={14}/></button>}</div>;
        })}
        {currentTarget.roles.length>1&&<p className="ra-notice">当前同时拥有两种角色，系统优先进入老板视角。</p>}
      </>}
    </AuthorizationDrawer>}
  </section>;
}
