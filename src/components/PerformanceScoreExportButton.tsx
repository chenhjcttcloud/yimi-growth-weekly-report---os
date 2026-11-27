import {useRef,useState} from 'react';
import {Download} from 'lucide-react';
import type {EmployeeEntry,ResultEmployeeFilterSnapshot} from './ResultEmployeeDirectory';
import {buildPerformanceScoreExport,type PerformanceScoreExportKind,type PerformanceScoreExportOptions} from '../lib/performanceScoreExport.mjs';
import {createXlsxWorkbook} from '../lib/xlsxWorkbook.mjs';
import '../styles/performance-export.css';

type Props={
 kind:PerformanceScoreExportKind;month:string;rows:PerformanceScoreExportOptions['rows'];results:PerformanceScoreExportOptions['results'];
 contextKey:string;directorySource:readonly EmployeeEntry[];selection:ResultEmployeeFilterSnapshot|null;disabled?:boolean;
};

export function PerformanceScoreExportButton({kind,month,rows,results,contextKey,directorySource,selection,disabled=false}:Props){
 const building=useRef(false);
 const [message,setMessage]=useState<{selection:ResultEmployeeFilterSnapshot;kind:PerformanceScoreExportKind;error:boolean;text:string}|null>(null);
 const current=selection?.source===directorySource&&selection.contextKey===contextKey?selection:null;
 const ready=!disabled&&Boolean(month&&current&&current.employeeUserIds.length);
 const label=kind==='quality'?'导出周报质量Excel':kind==='collaboration'?'导出360协同得分Excel':'导出周报质量和360协同分数Excel';
 const visibleMessage=current&&message?.selection===current&&message.kind===kind?message:null;

 function download(){
  if(!ready||!current||building.current)return;
  building.current=true;
  let url:string|undefined,link:HTMLAnchorElement|undefined;
  try{
   const model=buildPerformanceScoreExport({kind,month,rows,results,employeeUserIds:current.employeeUserIds,department:current.department,query:current.query});
   const bytes=Uint8Array.from(createXlsxWorkbook(model));
   const blob=new Blob([bytes.buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
   url=URL.createObjectURL(blob);link=document.createElement('a');link.href=url;link.download=model.fileName;
   document.body.appendChild(link);link.click();
   const createdUrl=url;window.setTimeout(()=>URL.revokeObjectURL(createdUrl),30_000);url=undefined;
   setMessage({selection:current,kind,error:false,text:`已开始下载${model.employeeCount}人的Excel表格。`});
  }catch(error){
   const cancelled=error instanceof DOMException&&error.name==='AbortError';
   setMessage({selection:current,kind,error:!cancelled,text:cancelled?'已取消导出。':'导出失败，请重试。'});
  }finally{
   link?.remove();if(url)URL.revokeObjectURL(url);building.current=false;
  }
 }

 return <div className="pf-export">
  <span className="pf-export-scope">{disabled||!current?'加载月度结果后可导出':current.employeeUserIds.length?`当前筛选 ${current.employeeUserIds.length} 人 · 含其他页`:'当前筛选无员工'}</span>
  <button type="button" className="secondary-button" aria-label={label} disabled={!ready} onClick={download} title="导出所选月份、部门及搜索条件下的全部匹配员工"><Download size={15}/>导出Excel</button>
  {visibleMessage&&<p role={visibleMessage.error?'alert':'status'} className={visibleMessage.error?'pf-error pf-export-message':'pf-caption pf-export-message'}>{visibleMessage.text}</p>}
 </div>;
}
