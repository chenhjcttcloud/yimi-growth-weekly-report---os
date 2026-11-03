import {useEffect,useRef,useState} from 'react';
import '../styles/report-rescore.css';

type ProgressCounts={total?:number;completed?:number;failed?:number;cached?:number;remaining?:number;active?:number};
type Diagnostic={reportId?:string;weekEnd?:string;code?:string;path?:string;moduleId?:string;criterionId?:string;attempt?:number};
type SyncStatus={mode?:string;targetMonth?:string;rowCount?:number;analyzed?:number;failed?:number;cached?:number;remaining?:number;active?:number;phase?:string;running?:boolean;updatedAt?:string;diagnostics?:Diagnostic[];byMonth?:Record<string,ProgressCounts>};
type SyncOverview={status?:SyncStatus|null;processRunning?:boolean};

const chinaMonth=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7);
function previousMonth(){const date=new Date(chinaMonth()+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7);}
const monthLabel=(value:string)=>`${value.slice(0,4)}年${Number(value.slice(5))}月`;
const count=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?String(value):'—';
const safePath=(value?:string)=>typeof value==='string'&&/^[A-Za-z0-9_.\[\]-]{1,180}$/.test(value)?value:'';
const safeCode=(value?:string)=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(value)?value:'';
const moduleNames:Record<string,string>={results:'本周成果',problems:'问题与挑战',nextPlan:'下周计划',reflection:'思考与复盘'};
function diagnosticLabel(value:Diagnostic){
 const code=safeCode(value.code);
 if(/quote|evidence/.test(code))return '原文证据未通过校验';
 if(/score|range|point/.test(code))return '细项分数未通过校验';
 if(/reason/.test(code))return '评分理由不完整';
 if(/timeout/.test(code))return 'AI 请求超时';
 if(/truncat|parse|json/.test(code))return 'AI 返回内容不完整';
 return '评分结果待修正';
}

export function ReportRescorePanel(){
 const [month,setMonth]=useState(previousMonth),[overview,setOverview]=useState<SyncOverview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const sequence=useRef(0),mounted=useRef(false);
 async function load(){
  const request=++sequence.current;
  try{const response=await fetch('/api/lark-report-sync');if(!response.ok)throw Error('评分进度暂时读取失败，请刷新重试。');const result=await response.json() as SyncOverview;if(mounted.current&&sequence.current===request){setOverview(result);setError('');}}
  catch(value){if(mounted.current&&sequence.current===request)setError(value instanceof Error?value.message:'评分进度暂时读取失败，请刷新重试。');}
 }
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;sequence.current++;};},[]);
 const status=overview?.status,processing=typeof overview?.processRunning==='boolean'?overview.processRunning:Boolean(status?.running);
 const interrupted=overview?.processRunning===false&&status?.running===true;
 useEffect(()=>{if(!processing)return;const timer=window.setInterval(()=>void load(),5000);return()=>window.clearInterval(timer);},[processing]);
 const validMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&month<=chinaMonth();
 const matches=status?.targetMonth===month;
 const counts:ProgressCounts|undefined=status?.byMonth?.[month]||(matches?{total:status.rowCount,completed:status.analyzed,failed:status.failed,cached:status.cached,remaining:status.remaining,active:status.active}:undefined);
 const diagnostics=(Array.isArray(status?.diagnostics)?status.diagnostics:[]).filter(item=>item&&typeof item==='object'&&(item.weekEnd?.startsWith(month)||matches&&!item.weekEnd)).slice(0,30);
 const label=processing?(matches||counts?'正在补跑评分':'已有周报任务运行中'):interrupted?'上次任务已中断，可继续补跑':counts?(Number(counts.failed)>0?'本次补跑有失败项':Number(counts.remaining)>0?'仍有未完成评分':'本次补跑已完成'):'尚未开始补跑';
 const phaseLabel=({queued:'排队中',pull:'准备任务',analysis:'分析中',done:'已完成',partial:'部分失败',failed:'启动失败'} as Record<string,string>)[status?.phase||''];
 async function start(){
  if(!validMonth||busy||processing)return;
  setBusy(true);setNotice('');setError('');sequence.current++;
  try{
   const response=await fetch('/api/lark-report-sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'rescore',targetMonth:month})}),result=await response.json();
   if(response.status===409){setOverview({status:result.status||overview?.status,processRunning:true});setNotice('已有周报任务运行中，本次未重复创建任务；完成后可补跑所选月份。');await load();return;}
   if(!response.ok)throw Error(({invalid_rescore_month:'请选择有效的评分月份。',invalid_target_month:'请选择有效的评分月份。',ai_not_configured:'请先配置 AI 模型和密钥。',boss_only:'当前账号没有补跑评分权限。'} as Record<string,string>)[result.error]||'评分补跑未启动，请刷新状态后重试。');
   if(result.status)setOverview({status:result.status,processRunning:result.status.running===true});
   setNotice(`已启动${monthLabel(month)}未完成评分补跑。已通过的评分会复用，旧版分数继续保留。`);await load();
  }catch(value){setError(value instanceof Error?value.message:'评分补跑未启动，请刷新状态后重试。');}
  finally{if(mounted.current)setBusy(false);}
 }
 return <section className="report-rescore" aria-label="按月补跑周报评分">
  <div className="report-rescore-heading"><div><h3>按月补跑周报评分</h3><p>使用系统中已保存的周报原文，只处理所选月份未完成或需要更新的评分。</p></div><span className={`pf-status ${Number(counts?.failed)>0?'is-warning':''}`} role="status">{label}</span></div>
  <form className="report-rescore-controls" onSubmit={event=>{event.preventDefault();void start();}}>
   <label>评分月份<input type="month" aria-label="补跑评分月份" max={chinaMonth()} value={month} disabled={busy} onChange={event=>{setMonth(event.target.value);setNotice('');}}/></label>
   <button type="submit" className="primary-button" disabled={!overview||!validMonth||busy||processing}>{busy?'正在启动…':'补跑本月未完成评分'}</button>
   <button type="button" className="secondary-button" disabled={busy} onClick={()=>void load()}>刷新评分进度</button>
  </form>
  <p className="report-rescore-note">旧版分数继续展示并标记重评状态；每位员工当月评分全部通过后自动更新月分。原本没有分数的记录保持待分析，无需人工审核。</p>
  {notice&&<p className="pf-notice" role="status">{notice}</p>}
  {error&&<p className="pf-error" role="alert">{error}</p>}
  {counts?<dl className="report-rescore-progress" aria-label={`${monthLabel(month)}评分进度`}>
   {([['范围内周报',counts.total],['本次新完成',counts.completed],['已完成复用',counts.cached],['失败',counts.failed],['正在分析',interrupted?0:counts.active],['剩余',counts.remaining]] as const).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{count(value)}</dd></div>)}
  </dl>:<p className="report-rescore-note">尚无{validMonth?monthLabel(month):'所选月份'}的补跑记录。选择月份后点击补跑，已成功的记录不会重复评分。</p>}
  {counts&&phaseLabel&&<p className="report-rescore-note">当前阶段：{interrupted?'待续跑':phaseLabel}</p>}
  {!!diagnostics.length&&<details className="report-rescore-diagnostics" open><summary>失败原因与自动修正记录（{diagnostics.length}项）</summary><ul>{diagnostics.map((item,index)=><li key={`${item.reportId||''}:${safePath(item.path)}:${index}`}><strong>{/^\d{4}-\d{2}-\d{2}$/.test(item.weekEnd||'')?item.weekEnd:'所选月份'} · {moduleNames[item.moduleId||'']||'周报评分'}</strong><p>{diagnosticLabel(item)}{Number.isInteger(item.attempt)&&Number(item.attempt)>0?` · 第${item.attempt}次尝试`:''}</p>{(safeCode(item.code)||safePath(item.path))&&<small>{safeCode(item.code)}{safePath(item.path)?` · ${safePath(item.path)}`:''}</small>}</li>)}</ul><p>系统会带着具体校验问题自动修正；失败不会覆盖旧分，后续补跑会继续处理未完成项。</p></details>}
 </section>;
}
