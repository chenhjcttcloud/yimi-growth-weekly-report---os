import {Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent, ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown, Search, X} from 'lucide-react';

interface SelectOption {value:string; label:string; disabled:boolean; group?:string}
interface Props {
 children?:ReactNode;
 value?:string|number;
 defaultValue?:string|number;
 onValueChange?:(value:string)=>void;
 id?:string;
 name?:string;
 disabled?:boolean;
 required?:boolean;
 className?:string;
 style?:CSSProperties;
 'aria-label'?:string;
 'aria-labelledby'?:string;
 'aria-describedby'?:string;
 searchable?:boolean;
 searchPlaceholder?:string;
 placeholder?:string;
 allowCustomValue?:boolean;
}

function text(children:ReactNode):string {
 return Children.toArray(children).map(child=>isValidElement<{children?:ReactNode}>(child)?text(child.props.children):String(child??'')).join('').replace(/\s+/g,' ').trim();
}

function readOptions(children:ReactNode,group?:string,disabled=false):SelectOption[] {
 const options:SelectOption[]=[];
 Children.forEach(children,child=>{
  if(!isValidElement<{children?:ReactNode; value?:string|number; label?:string; disabled?:boolean}>(child))return;
  if(child.type==='option')options.push({value:String(child.props.value??text(child.props.children)),label:child.props.label??text(child.props.children),disabled:disabled||Boolean(child.props.disabled),group});
  else if(child.type==='optgroup'||child.type===Fragment)options.push(...readOptions(child.props.children,child.type==='optgroup'?child.props.label:group,disabled||Boolean(child.props.disabled)));
 });
 return options;
}

/** Application-owned dropdown; the hidden select only preserves form/reset semantics. */
export function AppSelect({children,value,defaultValue,onValueChange,id,name,disabled=false,required=false,className='',style,'aria-label':ariaLabel,'aria-labelledby':ariaLabelledBy,'aria-describedby':ariaDescribedBy,searchable,searchPlaceholder='搜索选项…',placeholder='请选择',allowCustomValue=false}:Props){
 const uid=useId(),listId=`${uid}-list`;
 const options=readOptions(children);
 const [internalValue,setInternalValue]=useState(String(defaultValue??options.find(o=>!o.disabled)?.value??''));
 const current=String(value??internalValue);
 const selected=options.find(o=>o.value===current);
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1),[invalid,setInvalid]=useState(false);
 const [labelText,setLabelText]=useState('选择选项');
 const [position,setPosition]=useState({top:0,left:0,width:240,maxHeight:360});
 const trigger=useRef<HTMLButtonElement>(null),native=useRef<HTMLSelectElement>(null),panel=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
 const typeahead=useRef({text:'',time:0});
 const hasSearch=searchable??(allowCustomValue||options.length>=8);
 const term=query.trim().toLocaleLowerCase();
 const filtered=options.filter(option=>`${option.label} ${option.group??''}`.toLocaleLowerCase().includes(term));
 const canCreate=allowCustomValue&&Boolean(query.trim())&&!options.some(o=>o.value===query.trim()||o.label===query.trim());
 const visible:SelectOption[]=canCreate?[...filtered,{value:query.trim(),label:`使用“${query.trim()}”`,disabled:false}]:filtered;
 const label=ariaLabel||labelText;

 function close(restoreFocus=false){setOpen(false);setQuery('');if(restoreFocus)trigger.current?.focus();}
 function choose(option:SelectOption){
  if(disabled||trigger.current?.matches(':disabled')||option.disabled)return;
  setInvalid(false);
  if(option.value!==current){setInternalValue(option.value);onValueChange?.(option.value);}
  close(true);
 }
 function show(){
  if(disabled||trigger.current?.matches(':disabled')||(!options.length&&!allowCustomValue))return;
  const selectedIndex=options.findIndex(o=>o.value===current&&!o.disabled);
  setQuery('');setActive(selectedIndex>=0?selectedIndex:options.findIndex(o=>!o.disabled));setOpen(true);
 }

 useLayoutEffect(()=>{
  if(ariaLabel)return;
  const parent=trigger.current?.labels?.[0]||trigger.current?.closest('label');
  if(!parent)return;
  const clone=parent.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.app-select').forEach(el=>el.remove());
  setLabelText(clone.textContent?.trim()||'选择选项');
 },[ariaLabel,children,id]);
 useLayoutEffect(()=>{if(open&&trigger.current?.matches(':disabled'))close();});

 useLayoutEffect(()=>{
  if(!open)return;
  if(disabled||trigger.current?.matches(':disabled')){close();return;}
  function reposition(){
   const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
   const viewport=window.visualViewport,topEdge=(viewport?.offsetTop??0)+10,bottomEdge=(viewport?.offsetTop??0)+(viewport?.height??window.innerHeight)-10;
   if(rect.bottom<topEdge||rect.top>bottomEdge){close();return;}
   const width=Math.min(Math.max(rect.width,220),420,window.innerWidth-20);
   const below=bottomEdge-rect.bottom-6,above=rect.top-topEdge-6;
   const desired=Math.min(380,visible.length*42+(hasSearch?60:10)+32);
   const down=below>=desired||below>=above;
   const maxHeight=Math.max(60,Math.min(desired,down?below:above));
   setPosition({top:down?rect.bottom+6:Math.max(topEdge,rect.top-6-maxHeight),left:Math.max(10,Math.min(rect.left,window.innerWidth-width-10)),width,maxHeight});
  }
  const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!panel.current?.contains(event.target))reposition();};
  reposition();
  if(hasSearch)search.current?.focus();
  window.addEventListener('resize',reposition);window.addEventListener('scroll',scroll,true);
  window.visualViewport?.addEventListener('resize',reposition);
  window.visualViewport?.addEventListener('scroll',reposition);
  return()=>{window.removeEventListener('resize',reposition);window.removeEventListener('scroll',scroll,true);window.visualViewport?.removeEventListener('resize',reposition);window.visualViewport?.removeEventListener('scroll',reposition);};
 },[open,disabled,hasSearch,visible.length]);

 useEffect(()=>{
  if(!open)return;
  function outside(event:Event){if(event.target instanceof Node&&!trigger.current?.contains(event.target)&&!panel.current?.contains(event.target))close();}
  document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);};
 },[open]);

 useEffect(()=>{
  if(!open)return;
  const index=visible.findIndex(o=>o.value===current&&!o.disabled);
  setActive(index>=0?index:visible.findIndex(o=>!o.disabled));
 },[query,current,children]);

 useEffect(()=>{if(open&&active>=0)document.getElementById(`${uid}-option-${active}`)?.scrollIntoView({block:'nearest'});},[active,open,uid]);
 useEffect(()=>{
  const form=native.current?.form;if(!form)return;
  let frame=0;
  // Run after the browser's reset default action so the hidden field and visible value agree.
  const reset=(event:Event)=>{frame=requestAnimationFrame(()=>{
   if(event.defaultPrevented)return;
   const next=String(value??defaultValue??options.find(o=>!o.disabled)?.value??'');
   if(value===undefined)setInternalValue(next);
   if(native.current)native.current.value=next;
   setInvalid(false);close();
  });};
  form.addEventListener('reset',reset);return()=>{form.removeEventListener('reset',reset);cancelAnimationFrame(frame);};
 },[value,defaultValue,children]);

 function navigate(event:KeyboardEvent<HTMLElement>){
  if(event.nativeEvent.isComposing)return;
  if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);return;}
  if(event.key==='Tab'&&open){close(true);return;}
  if(!open&&['Enter',' ','ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();show();if(event.key==='End'||event.key==='ArrowUp')setActive(options.map(o=>!o.disabled).lastIndexOf(true));else if(event.key==='Home')setActive(options.findIndex(o=>!o.disabled));return;}
  if(open&&['Enter',' '].includes(event.key)&&event.target!==search.current){event.preventDefault();if(visible[active])choose(visible[active]);return;}
  if(open&&event.key==='Enter'){event.preventDefault();if(visible[active])choose(visible[active]);return;}
  const inputActive=event.target===search.current;
  if(open&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&!(inputActive&&['Home','End'].includes(event.key))){
   event.preventDefault();
   const enabled=visible.flatMap((option,index)=>option.disabled?[]:[index]);if(!enabled.length)return;
   const currentIndex=enabled.indexOf(active);
   const next=event.key==='Home'?0:event.key==='End'?enabled.length-1:event.key==='ArrowDown'?(currentIndex+1)%enabled.length:(currentIndex-1+enabled.length)%enabled.length;
   setActive(enabled[next]);return;
  }
  if(!inputActive&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
   event.preventDefault();
   if(!open)show();
   const now=Date.now(),next=(now-typeahead.current.time<700?typeahead.current.text:'')+event.key.toLocaleLowerCase();
   typeahead.current={text:next,time:now};
   const index=visible.findIndex(o=>!o.disabled&&o.label.toLocaleLowerCase().startsWith(next));if(index>=0)setActive(index);
  }
 }

 return <span className="app-select">
  <button ref={trigger} id={id||uid} type="button" role="combobox" className={`app-select-trigger ${className} ${open?'is-open':''} ${invalid?'is-invalid':''}`} style={style} disabled={disabled} aria-label={ariaLabel||(!ariaLabelledBy?label:undefined)} aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} aria-expanded={open} aria-haspopup="listbox" aria-controls={open?listId:undefined} aria-activedescendant={open&&!hasSearch&&active>=0?`${uid}-option-${active}`:undefined} aria-required={required||undefined} aria-invalid={invalid||undefined} onClick={()=>open?close():show()} onKeyDown={navigate}>
   <span className={`app-select-value ${!selected&&!allowCustomValue?'is-placeholder':''}`}>{selected?.label||(allowCustomValue&&current?current:placeholder)}</span><ChevronDown size={15} className="app-select-chevron"/>
  </button>
  <select ref={native} hidden aria-hidden="true" tabIndex={-1} name={name} value={selected||allowCustomValue?current:''} disabled={disabled} required={required} onChange={event=>{setInternalValue(event.target.value);onValueChange?.(event.target.value);}} onInvalid={event=>{event.preventDefault();setInvalid(true);trigger.current?.focus();}}>
   {children}{!selected&&(allowCustomValue?<option value={current}>{current}</option>:<option value="" hidden>{placeholder}</option>)}
  </select>
  {open&&createPortal(<div ref={panel} className="app-select-panel" style={position} onKeyDown={navigate}>
   {hasSearch&&<div className="app-select-search"><Search size={15}/><input ref={search} type="search" aria-label={`搜索${label}`} placeholder={searchPlaceholder} value={query} onChange={event=>setQuery(event.target.value)} aria-controls={listId} aria-activedescendant={active>=0?`${uid}-option-${active}`:undefined} autoComplete="off"/>{query&&<button type="button" tabIndex={-1} aria-label="清空选项搜索" onClick={()=>{setQuery('');search.current?.focus();}}><X size={14}/></button>}</div>}
   <div id={listId} role="listbox" aria-label={label} className="app-select-options">
    {visible.map((option,index)=>{const parts=option.label.split(/\s+[·・]\s+/),description=parts.length>1?parts.slice(1).join(' · '):'';return <div key={option.value} id={`${uid}-option-${index}`} role="option" aria-selected={option.value===current} aria-disabled={option.disabled||undefined} className={`app-select-option ${option.value===current?'is-selected':''} ${active===index?'is-highlighted':''} ${option.disabled?'is-disabled':''}`} onPointerMove={()=>!option.disabled&&setActive(index)} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(option)}><span className="app-select-option-check">{option.value===current&&<Check size={15}/>}</span><span className="app-select-option-copy"><span>{parts[0]}</span>{description&&<small>{description}</small>}{option.group&&<small>{option.group}</small>}</span></div>;})}
    {!visible.length&&<div className="app-select-empty"><Search size={22}/><strong>没有匹配的选项</strong><span>试试其他关键词</span></div>}
   </div>
   {hasSearch&&<div className="app-select-footer"><span>{term?`${filtered.length} / ${options.length}`:`${options.length} 个选项`}</span><span>↑↓ 选择 · Enter 确认</span></div>}
  </div>,document.body)}
 </span>;
}
