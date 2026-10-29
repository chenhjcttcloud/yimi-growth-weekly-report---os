import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {CalendarDays,Check,ChevronDown,ChevronLeft,ChevronRight} from 'lucide-react';
import '../styles/review-month-picker.css';

interface Props {
 value:string;
 max:string;
 disabled?:boolean;
 onChange:(month:string)=>void;
 'aria-label'?:string;
}
const parse=(value:string)=>{
 const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
 return match&&Number(match[1])>0?{year:Number(match[1]),month:Number(match[2])}:null;
};
const monthValue=(year:number,month:number)=>`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}`;
const monthLabel=(year:number,month:number)=>`${year} 年 ${month} 月`;

/** Application-owned month calendar; historical years remain available. */
export function ReviewMonthPicker({value,max,disabled=false,onChange,'aria-label':label='选择评分月份'}:Props){
 const fallback=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 const limit=parse(max)||parse(fallback)!;
 const selected=parse(value)||limit;
 const [open,setOpen]=useState(false),[year,setYear]=useState(Math.min(selected.year,limit.year));
 const [activeMonth,setActiveMonth]=useState(selected.month);
 const [position,setPosition]=useState({top:0,left:0,width:288,maxHeight:286});
 const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const uid=useId(),lastMonth=year===limit.year?limit.month:12;
 const available=(month:number)=>year>=1&&year<=limit.year&&month>=1&&month<=lastMonth;
 const focusMonth=(month:number)=>document.getElementById(`${uid}-month-${month}`)?.focus({preventScroll:true});
 function close(restoreFocus=false){setOpen(false);if(restoreFocus)trigger.current?.focus({preventScroll:true});}
 function show(){
  if(disabled)return;
  const nextYear=Math.min(selected.year,limit.year),nextMonth=nextYear===limit.year?Math.min(selected.month,limit.month):selected.month;
  setYear(nextYear);setActiveMonth(nextMonth);setOpen(true);
 }
 function choose(month:number){
  if(disabled||!available(month))return;
  const next=monthValue(year,month);close(true);if(next!==value)onChange(next);
 }
 function changeYear(next:number,moveFocus=false){
  if(next<1||next>limit.year)return;
  const nextMonth=Math.min(activeMonth,next===limit.year?limit.month:12);
  setYear(next);setActiveMonth(nextMonth);
  if(moveFocus)requestAnimationFrame(()=>focusMonth(nextMonth));
 }
 useEffect(()=>{if(disabled&&open)close();},[disabled,open]);
 useLayoutEffect(()=>{
  if(!open)return;
  function reposition(){
   const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
   const viewport=window.visualViewport,leftEdge=(viewport?.offsetLeft||0)+10,topEdge=(viewport?.offsetTop||0)+10;
   const rightEdge=(viewport?.offsetLeft||0)+(viewport?.width||window.innerWidth)-10,bottomEdge=(viewport?.offsetTop||0)+(viewport?.height||window.innerHeight)-10;
   if(rect.bottom<topEdge||rect.top>bottomEdge){close();return;}
   const width=Math.min(288,rightEdge-leftEdge),desired=(panel.current?.scrollHeight||282)+2;
   const below=bottomEdge-rect.bottom-7,above=rect.top-topEdge-7,down=below>=desired||below>=above;
   const maxHeight=Math.min(desired,Math.max(0,down?below:above));
   if(maxHeight<80){close();return;}
   setPosition({width,maxHeight,left:Math.max(leftEdge,Math.min(rect.right-width,rightEdge-width)),top:down?rect.bottom+7:Math.max(topEdge,rect.top-7-maxHeight)});
  }
  const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!panel.current?.contains(event.target))reposition();};
  reposition();window.addEventListener('resize',reposition);window.addEventListener('scroll',scroll,true);
  window.visualViewport?.addEventListener('resize',reposition);window.visualViewport?.addEventListener('scroll',reposition);
  return()=>{window.removeEventListener('resize',reposition);window.removeEventListener('scroll',scroll,true);window.visualViewport?.removeEventListener('resize',reposition);window.visualViewport?.removeEventListener('scroll',reposition);};
 },[open,year,max]);
 useEffect(()=>{
  if(!open)return;
  const frame=requestAnimationFrame(()=>focusMonth(activeMonth));
  const outside=(event:Event)=>{if(event.target instanceof Node&&!trigger.current?.contains(event.target)&&!panel.current?.contains(event.target))close();};
  document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);};
 },[open]);
 function navigate(event:KeyboardEvent<HTMLElement>){
  if(event.nativeEvent.isComposing)return;
  if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);return;}
  if(event.key==='Tab'&&open){close(true);return;}
  if(!open&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();show();return;}
  if(!open)return;
  if(event.key==='PageUp'||event.key==='PageDown'){event.preventDefault();changeYear(year+(event.key==='PageUp'?-1:1),true);return;}
  if(!(event.target instanceof HTMLElement)||!event.target.dataset.month)return;
  const steps:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-3,ArrowDown:3};
  if(event.key==='Home'||event.key==='End'||event.key in steps){
   event.preventDefault();const next=event.key==='Home'?1:event.key==='End'?lastMonth:Math.max(1,Math.min(lastMonth,activeMonth+steps[event.key]));setActiveMonth(next);focusMonth(next);
  }
 }
 return <div className="review-month-picker">
  <button ref={trigger} type="button" className={`review-month-trigger${open?' is-open':''}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?`${uid}-dialog`:undefined} disabled={disabled} onClick={()=>open?close():show()} onKeyDown={navigate}>
   <CalendarDays size={15} aria-hidden="true"/><span>{monthLabel(selected.year,selected.month)}</span><ChevronDown size={14} className="review-month-chevron" aria-hidden="true"/>
  </button>
  {open&&!disabled&&createPortal(<div id={`${uid}-dialog`} ref={panel} role="dialog" aria-label={label+'选择面板'} className="review-month-popover" style={position} onKeyDown={navigate}>
   <div className="review-month-year"><button type="button" aria-label="上一年" disabled={year<=1} onClick={()=>changeYear(year-1)}><ChevronLeft size={16}/></button><strong aria-live="polite">{year} 年</strong><button type="button" aria-label="下一年" disabled={year>=limit.year} onClick={()=>changeYear(year+1)}><ChevronRight size={16}/></button></div>
   <div className="review-month-grid" aria-label={`${year} 年的月份`}>{Array.from({length:12},(_,index)=>index+1).map(month=><button id={`${uid}-month-${month}`} data-month={month} key={month} type="button" aria-label={monthLabel(year,month)} aria-pressed={selected.year===year&&selected.month===month} tabIndex={month===Math.min(activeMonth,lastMonth)?0:-1} disabled={!available(month)} onFocus={()=>setActiveMonth(month)} onClick={()=>choose(month)}><span>{month} 月</span>{selected.year===year&&selected.month===month&&<Check size={12} aria-hidden="true"/>}</button>)}</div>
   <div className="review-month-footer"><span>最晚 {monthLabel(limit.year,limit.month)}</span><button type="button" onClick={()=>{close(true);if(value!==monthValue(limit.year,limit.month))onChange(monthValue(limit.year,limit.month));}}>最新月份</button></div>
  </div>,document.body)}
 </div>;
}
