import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Search,X} from 'lucide-react';
import '../styles/result-employee-directory.css';

type EmployeeEntry={userId:string;name:string;department?:string;summary:string};
const PAGE_SIZE=8;
const pageFor=(rows:EmployeeEntry[],userId?:string)=>Math.floor(Math.max(0,rows.findIndex(row=>row.userId===userId))/PAGE_SIZE)+1;

export function ResultEmployeeDirectory({employees,selectedUserId,contextKey,onSelect}:{
 employees:EmployeeEntry[];selectedUserId?:string;contextKey:string;onSelect:(userId:string)=>void;
}){
 const [search,setSearch]=useState(''),[page,setPage]=useState(()=>pageFor(employees,selectedUserId));
 const query=search.trim().toLocaleLowerCase();
 const matching=employees.filter(employee=>!query||(employee.name+' '+(employee.department||'')).toLocaleLowerCase().includes(query));
 const pageCount=Math.max(1,Math.ceil(matching.length/PAGE_SIZE)),currentPage=Math.min(page,pageCount);
 const visible=matching.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
 const previousContext=useRef(contextKey);
 // Month/module changes clear filters; deep links and restored selections reveal
 // their employee without resetting a page the user is only browsing.
 useEffect(()=>{
  const contextChanged=previousContext.current!==contextKey;
  previousContext.current=contextKey;
  if(contextChanged){setSearch('');setPage(pageFor(employees,selectedUserId));return;}
  if(!employees.some(employee=>employee.userId===selectedUserId))return;
  if(matching.some(employee=>employee.userId===selectedUserId))setPage(pageFor(matching,selectedUserId));
  else{setSearch('');setPage(pageFor(employees,selectedUserId));}
 },[contextKey,selectedUserId]);
 function updateSearch(value:string){setSearch(value);setPage(1);}
 return <aside className="pf-people pf-employee-directory" aria-label="选择查看员工">
  <label className="pf-employee-search"><Search size={14} aria-hidden="true"/><input type="search" aria-label="搜索员工或部门" placeholder="搜索员工或部门" value={search} onChange={event=>updateSearch(event.target.value)}/>{search&&<button type="button" aria-label="清除员工搜索" onClick={()=>updateSearch('')}><X size={13}/></button>}</label>
  <p className="pf-employee-count" role="status">{query?`匹配 ${matching.length} / ${employees.length} 人`:`共 ${employees.length} 人 · 每页 ${PAGE_SIZE} 人`}</p>
  {employees.length>0&&<nav className="pf-employee-pagination" aria-label="员工列表分页"><button type="button" aria-label="上一页员工" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}><ChevronLeft size={16}/></button><span aria-live="polite">第 {currentPage} / {pageCount} 页</span><button type="button" aria-label="下一页员工" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}><ChevronRight size={16}/></button></nav>}
  <div className="pf-employee-list">
   {visible.map(employee=><button type="button" key={employee.userId} className={`pf-person ${selectedUserId===employee.userId?'is-active':''}`} aria-pressed={selectedUserId===employee.userId} onClick={()=>onSelect(employee.userId)}><span className="pf-avatar">{employee.name.slice(-2)}</span><span className="pf-person-info"><strong>{employee.name}</strong><small>{employee.department}{employee.department?' · ':''}{employee.summary}</small></span><ChevronRight size={15} aria-hidden="true"/></button>)}
   {!matching.length&&<div className="pf-employee-empty"><Search size={20} aria-hidden="true"/><strong>{query?'未找到匹配员工':'本月暂无员工数据'}</strong>{query&&<button type="button" className="text-button" onClick={()=>updateSearch('')}>清除搜索</button>}</div>}
  </div>
 </aside>;
}
