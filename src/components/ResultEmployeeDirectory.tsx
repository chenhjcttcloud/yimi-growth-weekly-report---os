import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Search,X} from 'lucide-react';
import {AppSelect} from './AppSelect';
import '../styles/result-employee-directory.css';

type EmployeeEntry={userId:string;name:string;department?:string|null;summary:string};
type DirectoryEntry=EmployeeEntry & {departments:string[]};
const PAGE_SIZE=8;
const pageFor=(rows:EmployeeEntry[],userId?:string)=>Math.floor(Math.max(0,rows.findIndex(row=>row.userId===userId))/PAGE_SIZE)+1;
const unassignedDepartment='未分配部门';

function employeeDepartments(department?:string|null) {
 const names=(department??'').split(/[,，、]|\s+\/\s+/).map(name=>name.trim()).filter(Boolean);
 return names.length?names:[unassignedDepartment];
}

function groupEmployees(entries:DirectoryEntry[], department='') {
 const groups=new Map<string,DirectoryEntry[]>();
 for(const entry of entries) {
  const label=department||entry.departments[0];
  const group=groups.get(label);
  if(group)group.push(entry);
  else groups.set(label,[entry]);
 }
 return groups;
}

export function ResultEmployeeDirectory({employees,selectedUserId,contextKey,groupByDepartment=false,onSelect}:{
 employees:EmployeeEntry[];selectedUserId?:string;contextKey:string;groupByDepartment?:boolean;onSelect:(userId:string)=>void;
}){
 const [search,setSearch]=useState(''),[department,setDepartment]=useState('');
 const entries=employees.map(employee=>({...employee,departments:employeeDepartments(employee.department)}));
 const departments=[...new Set(entries.flatMap(employee=>employee.departments))];
 const selectedDepartment=groupByDepartment&&departments.includes(department)?department:'';
 const allEmployees=groupByDepartment?[...groupEmployees(entries).values()].flat():entries;
 const [page,setPage]=useState(()=>pageFor(allEmployees,selectedUserId));
 const query=search.trim().toLocaleLowerCase();
 const departmentEmployees=selectedDepartment?entries.filter(employee=>employee.departments.includes(selectedDepartment)):allEmployees;
 const matching=departmentEmployees.filter(employee=>!query||`${employee.name} ${groupByDepartment?employee.departments.join(' '):employee.department||''}`.toLocaleLowerCase().includes(query));
 const pageCount=Math.max(1,Math.ceil(matching.length/PAGE_SIZE)),currentPage=Math.min(page,pageCount);
 const visible=matching.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
 const visibleGroups=groupByDepartment?[...groupEmployees(visible,selectedDepartment)]:[];
 const previousContext=useRef(contextKey);
 // An employee reached from another screen must be visible in the directory.
 // Changing a directory filter keeps the detail selection and starts at page one.
 useEffect(()=>{
  const contextChanged=previousContext.current!==contextKey;
  previousContext.current=contextKey;
  if(contextChanged){setSearch('');setDepartment('');setPage(pageFor(allEmployees,selectedUserId));return;}
  if(!allEmployees.some(employee=>employee.userId===selectedUserId))return;
  if(matching.some(employee=>employee.userId===selectedUserId))setPage(pageFor(matching,selectedUserId));
  else{setSearch('');setDepartment('');setPage(pageFor(allEmployees,selectedUserId));}
 },[contextKey,selectedUserId]);
 function updateSearch(value:string){setSearch(value);setPage(1);}
 function renderEmployee(employee:DirectoryEntry,groupName?:string){
  const departmentLabel=groupName&&employee.departments.length===1?'':employee.department?.trim();
  const description=departmentLabel?`${departmentLabel} · ${employee.summary}`:employee.summary;
  return <button type="button" key={employee.userId} className={`pf-person ${selectedUserId===employee.userId?'is-active':''}`} aria-pressed={selectedUserId===employee.userId} onClick={()=>onSelect(employee.userId)}>
   <span className="pf-avatar">{employee.name.slice(-2)}</span>
   <span className="pf-person-info"><strong>{employee.name}</strong><small>{description}</small></span>
   <ChevronRight size={15} aria-hidden="true"/>
  </button>;
 }
 return <aside className="pf-people pf-employee-directory" aria-label="选择查看员工">
  <label className="pf-employee-search"><Search size={14} aria-hidden="true"/><input type="search" aria-label="搜索员工或部门" placeholder="搜索员工或部门" value={search} onChange={event=>updateSearch(event.target.value)}/>{search&&<button type="button" aria-label="清除员工搜索" onClick={()=>updateSearch('')}><X size={13}/></button>}</label>
  {groupByDepartment&&departments.length>0&&<AppSelect aria-label="按部门筛选" value={selectedDepartment} onValueChange={value=>{setDepartment(value);setPage(1);}}>
   <option value="">全部部门</option>
   {departments.map(name=><option key={name} value={name}>{name}</option>)}
  </AppSelect>}
  <p className="pf-employee-count" role="status">{query?`匹配 ${matching.length} / ${departmentEmployees.length} 人`:`共 ${departmentEmployees.length} 人 · 每页 ${PAGE_SIZE} 人`}</p>
  {employees.length>0&&<nav className="pf-employee-pagination" aria-label="员工列表分页"><button type="button" aria-label="上一页员工" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}><ChevronLeft size={16}/></button><span aria-live="polite">第 {currentPage} / {pageCount} 页</span><button type="button" aria-label="下一页员工" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}><ChevronRight size={16}/></button></nav>}
  <div className="pf-employee-list">
   {groupByDepartment?visibleGroups.map(([name,members])=><section key={name} className="pf-employee-department" aria-label={name}>
    <h4>{name}</h4>
    {members.map(employee=>renderEmployee(employee,name))}
   </section>):visible.map(employee=>renderEmployee(employee))}
   {!matching.length&&<div className="pf-employee-empty"><Search size={20} aria-hidden="true"/><strong>{query?'未找到匹配员工':'本月暂无员工数据'}</strong>{query&&<button type="button" className="text-button" onClick={()=>updateSearch('')}>清除搜索</button>}</div>}
  </div>
 </aside>;
}
