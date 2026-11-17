import {useEffect,useRef,useState} from 'react';
import {Building2,ChevronLeft,ChevronRight,Search,X} from 'lucide-react';
import '../styles/result-employee-directory.css';

type EmployeeEntry={userId:string;name:string;department?:string|null;summary:string};
type DirectoryEntry=EmployeeEntry & {departments:string[]};
const PAGE_SIZE=8;
const pageFor=(rows:EmployeeEntry[],userId?:string)=>Math.floor(Math.max(0,rows.findIndex(row=>row.userId===userId))/PAGE_SIZE)+1;
const unassignedDepartment='未分配部门';

function employeeDepartments(department?:string|null) {
 const names=(department??'').split(/[,，、]|\s+\/\s+/).map(name=>name.trim()).filter(Boolean);
 return names.length?[...new Set(names)]:[unassignedDepartment];
}

function groupEmployees(entries:DirectoryEntry[], includeAllMemberships=false) {
 const groups=new Map<string,DirectoryEntry[]>();
 for(const entry of entries) {
  const names=includeAllMemberships?entry.departments:entry.departments.slice(0,1);
  for(const name of names){
   const group=groups.get(name);
   if(group)group.push(entry);
   else groups.set(name,[entry]);
  }
 }
 return groups;
}

export function ResultEmployeeDirectory({employees,selectedUserId,contextKey,onSelect}:{
 employees:EmployeeEntry[];selectedUserId?:string;contextKey:string;onSelect:(userId:string)=>void;
}){
 const [search,setSearch]=useState(''),[department,setDepartment]=useState('');
 const entries=employees.map(employee=>({...employee,departments:employeeDepartments(employee.department)}));
 const departmentMembers=groupEmployees(entries,true);
 const selectedDepartment=departmentMembers.has(department)?department:'';
 const allEmployees=[...groupEmployees(entries).values()].flat();
 const [page,setPage]=useState(()=>pageFor(allEmployees,selectedUserId));
 const query=search.trim().toLocaleLowerCase();
 const departmentEmployees=departmentMembers.get(selectedDepartment)??allEmployees;
 const matching=departmentEmployees.filter(employee=>!query||`${employee.name} ${employee.departments.join(' ')}`.toLocaleLowerCase().includes(query));
 const pageCount=Math.max(1,Math.ceil(matching.length/PAGE_SIZE)),currentPage=Math.min(page,pageCount);
 const visible=matching.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
 const previousContext=useRef(contextKey);
 // An employee reached from another screen must be visible in the directory.
 // Searching and paging do not change the selected employee.
 useEffect(()=>{
  const contextChanged=previousContext.current!==contextKey;
  previousContext.current=contextKey;
  if(contextChanged){setSearch('');setDepartment('');setPage(pageFor(allEmployees,selectedUserId));return;}
  if(!allEmployees.some(employee=>employee.userId===selectedUserId))return;
  if(matching.some(employee=>employee.userId===selectedUserId))setPage(pageFor(matching,selectedUserId));
  else{setSearch('');setDepartment('');setPage(pageFor(allEmployees,selectedUserId));}
 },[contextKey,selectedUserId]);
 function updateSearch(value:string){setSearch(value);setPage(1);}
 function switchDepartment(next:string){
  if(next===selectedDepartment)return;
  const members=departmentMembers.get(next)??allEmployees;
  const keepsSelection=members.some(employee=>employee.userId===selectedUserId);
  const nextUserId=keepsSelection?selectedUserId:members[0]?.userId;
  setDepartment(next);setSearch('');setPage(pageFor(members,nextUserId));
  if(!keepsSelection&&nextUserId)onSelect(nextUserId);
 }
 function renderEmployee(employee:DirectoryEntry){
  const description=employee.departments.length>1?`${employee.departments.join(' / ')} · ${employee.summary}`:employee.summary;
  return <button type="button" key={employee.userId} className={`pf-person ${selectedUserId===employee.userId?'is-active':''}`} aria-pressed={selectedUserId===employee.userId} onClick={()=>onSelect(employee.userId)}>
   <span className="pf-avatar">{employee.name.slice(-2)}</span>
   <span className="pf-person-info"><strong>{employee.name}</strong><small>{description}</small></span>
   <ChevronRight size={15} aria-hidden="true"/>
  </button>;
 }
 return <>
  {employees.length>0&&<div className="pf-department-switcher" role="group" aria-label="按部门筛选">
   <div className="pf-department-switcher-label"><Building2 size={15} aria-hidden="true"/>部门</div>
   <div className="pf-department-options">
    <button type="button" aria-pressed={!selectedDepartment} aria-description={`${employees.length} 位员工`} onClick={()=>switchDepartment('')}>
     <span>全部部门</span><small aria-hidden="true">{employees.length}</small>
    </button>
    {[...departmentMembers].map(([name,members])=><button type="button" key={name} aria-pressed={name===selectedDepartment} aria-description={`${members.length} 位员工`} onClick={()=>switchDepartment(name)}>
     <span>{name}</span><small aria-hidden="true">{members.length}</small>
    </button>)}
   </div>
  </div>}
  <aside className="pf-people pf-employee-directory" aria-label="选择查看员工">
  <label className="pf-employee-search"><Search size={14} aria-hidden="true"/><input type="search" aria-label="搜索员工或部门" placeholder="搜索员工或部门" value={search} onChange={event=>updateSearch(event.target.value)}/>{search&&<button type="button" aria-label="清除员工搜索" onClick={()=>updateSearch('')}><X size={13}/></button>}</label>
  <p className="pf-employee-count" role="status">{query?`匹配 ${matching.length} / ${departmentEmployees.length} 人`:`共 ${departmentEmployees.length} 人 · 每页 ${PAGE_SIZE} 人`}</p>
  {employees.length>0&&<nav className="pf-employee-pagination" aria-label="员工列表分页"><button type="button" aria-label="上一页员工" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}><ChevronLeft size={16}/></button><span aria-live="polite">第 {currentPage} / {pageCount} 页</span><button type="button" aria-label="下一页员工" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}><ChevronRight size={16}/></button></nav>}
  <div className="pf-employee-list">
   {selectedDepartment?visible.map(renderEmployee):[...groupEmployees(visible)].map(([name,members])=><section key={name} className="pf-employee-department" aria-label={name}>
    <h4>{name}</h4>
    {members.map(renderEmployee)}
   </section>)}
   {!matching.length&&<div className="pf-employee-empty"><Search size={20} aria-hidden="true"/><strong>{query?'未找到匹配员工':'本月暂无员工数据'}</strong>{query&&<button type="button" className="text-button" onClick={()=>updateSearch('')}>清除搜索</button>}</div>}
  </div>
  </aside>
 </>;
}
