import {useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,History,Search,X} from 'lucide-react';
import {AppSelect} from './AppSelect';
import {monthText,scoreText} from './PerformanceUI';
import '../styles/department-score-trends.css';

type Employee={userId:string;department:string};
type Result={month:string;employee_user_id:string;kind:string;result:{score?:number|null}};
const PAGE_SIZE=8;

export function DepartmentScoreTrends({months,employees,results,scoreFocus}:{
 months:string[];employees:Employee[];results:Result[];scoreFocus?:'quality'|'collaboration';
}){
 const [search,setSearch]=useState(''),[monthFilter,setMonthFilter]=useState(''),[page,setPage]=useState(1);
 const rows=useMemo(()=>{
  const departments=[...new Set(employees.map(employee=>employee.department))].map(department=>({
   name:department,userIds:new Set(employees.filter(employee=>employee.department===department).map(employee=>employee.userId)),
  }));
  return months.flatMap(month=>departments.map(department=>{
   const average=(kind:string)=>{
    const scores=results.filter(result=>result.month===month&&result.kind===kind&&result.result.score!=null&&department.userIds.has(result.employee_user_id));
    return scores.length?scores.reduce((sum,result)=>sum+result.result.score!,0)/scores.length:null;
   };
   return {month,department:department.name,quality:average('quality'),collaboration:average('collaboration')};
  }));
 },[months,employees,results]);
 const activeMonth=months.includes(monthFilter)?monthFilter:'';
 const query=search.trim().toLocaleLowerCase();
 const filtered=rows.filter(row=>(!activeMonth||row.month===activeMonth)&&(!query||(row.department||'未分配部门').toLocaleLowerCase().includes(query)));
 const pageCount=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)),currentPage=Math.min(page,pageCount);
 const visible=filtered.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE),columns=scoreFocus?3:4;
 function searchDepartments(value:string){setSearch(value);setPage(1);}
 return <section className="v2-card pf-table-card pf-department-trends" aria-label="部门得分趋势">
  <div className="v2-card-head"><div><span className="v2-eyebrow"><History size={14}/>组织成长档案</span><h3 className="v2-card-title">{scoreFocus==='quality'?'部门周报质量趋势':scoreFocus==='collaboration'?'部门协同得分趋势':'部门质量与历史月度趋势'}</h3><p className="v2-card-sub">汇总自动计算和历史已发布结果，数据未齐全时以「—」呈现</p></div></div>
  <div className="pf-trend-filters">
   <label className="pf-trend-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="搜索趋势部门" placeholder="搜索部门" value={search} onChange={event=>searchDepartments(event.target.value)}/>{search&&<button type="button" aria-label="清除趋势部门搜索" onClick={()=>searchDepartments('')}><X size={14}/></button>}</label>
   <label className="pf-trend-month"><span>趋势月份</span><AppSelect aria-label="筛选趋势月份" value={activeMonth} onValueChange={value=>{setMonthFilter(value);setPage(1);}}><option value="">全部月份</option>{months.map(month=><option value={month} key={month}>{monthText(month)}</option>)}</AppSelect></label>
  </div>
  <nav className="pf-trend-pagination" aria-label="部门趋势分页"><span className="pf-trend-range" role="status">{filtered.length?`第 ${(currentPage-1)*PAGE_SIZE+1}–${Math.min(currentPage*PAGE_SIZE,filtered.length)} 条，共 ${filtered.length} 条`:'共 0 条'} · 每页 {PAGE_SIZE} 条</span><div className="pf-trend-pagination-controls"><button type="button" aria-label="上一页部门趋势" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}><ChevronLeft size={16}/></button><span aria-live="polite">第 {currentPage} / {pageCount} 页</span><button type="button" aria-label="下一页部门趋势" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}><ChevronRight size={16}/></button></div></nav>
  <div className="pf-table-scroll"><table className="pf-table" aria-label="部门趋势记录"><thead><tr><th>月份</th><th>部门</th>{scoreFocus!=='collaboration'&&<th>周报质量均分</th>}{scoreFocus!=='quality'&&<th>协作能力均分</th>}</tr></thead><tbody>{visible.map(row=><tr key={JSON.stringify([row.month,row.department])}><td>{monthText(row.month)}</td><td className="pf-table-name">{row.department||'未分配部门'}</td>{scoreFocus!=='collaboration'&&<td className="pf-tabular">{scoreText(row.quality)}</td>}{scoreFocus!=='quality'&&<td className="pf-tabular">{scoreText(row.collaboration)}</td>}</tr>)}{!visible.length&&<tr><td colSpan={columns}><div className="pf-trend-empty"><Search size={22}/><strong>{query||activeMonth?'未找到匹配的部门趋势':'暂无部门趋势数据'}</strong>{(query||activeMonth)&&<button type="button" className="text-button" onClick={()=>{setSearch('');setMonthFilter('');setPage(1);}}>清除筛选</button>}</div></td></tr>}</tbody></table></div>
 </section>;
}
