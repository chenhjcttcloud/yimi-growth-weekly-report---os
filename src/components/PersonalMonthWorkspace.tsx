import { useState } from 'react';
import { ArrowRight, BookOpen, Brain, CheckCheck, CircleHelp, Crosshair, History, LockKeyhole, MessageSquare, Send, Sparkles, Target, ThumbsUp, TrendingUp } from 'lucide-react';
import { RadarChart } from './SimpleCharts';
import type { PersonalModule } from '../lib/types';
import { ResultEmpty, scoreText } from './PerformanceUI';

const errors: Record<string,string> = {
  ai_not_configured:'尚未配置 AI 服务，当前可查看周报辅助整理与执行方案。',
  report_not_submitted:'这周尚未提交周报，暂不能添加互动或分析。',
  task_already_created:'这个任务已经创建，请通过飞书继续管理。',
  task_creation_in_progress:'任务正在创建中，请稍候刷新查看。',
  task_content_required:'请填写任务标题和说明。',
  invalid_due_date:'请填写有效的日期。',
  invalid_comment:'评论不能为空，最多 4000 字。',
  personal_service_failed:'服务暂未完成，请稍后重试。',
};
const safeUrl = (value:string) => { try { const u=new URL(value); return ['https:','http:'].includes(u.protocol)?u.href:undefined; } catch { return undefined; } };
const dateTime = (value:string) => { if(!value)return '—'; const d=new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value)?value:value.replace(' ','T')+'Z'); return Number.isFinite(d.getTime())?d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):value; };
const deadlineText=(week:any)=>week.status==='免交'?'本周免交':week.schedule?.calendarPending?'等待工作日日历':week.dueAt?`${week.dueAt.slice(0,10)} ${week.dueAt.slice(11,16)}`:'尚未确定';

export function PersonalMonthWorkspace({ data, onSelectWeek, onRefresh, module, onOpenModule, readOnly=false }: { readOnly?:boolean; module?: PersonalModule; onOpenModule:(module:PersonalModule)=>void; data:any; onSelectWeek:(id:string)=>void; onRefresh:()=>void }) {
  const tab = module;
  const [comment,setComment]=useState('');
  const [question,setQuestion]=useState('');
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [drafts,setDrafts]=useState<Record<string,any>>({});
  const [selected,setSelected]=useState<Record<string,boolean>>(()=>Object.fromEntries((data.tasks||[]).map((t:any)=>[t.id,!t.created])));
  const [openPlan,setOpenPlan]=useState('');
  const week=data.weeks?.find((w:any)=>w.id===data.selectedWeekId);
  const currentFinal=data.history?.find((h:any)=>h.month===data.month);
  const tasks=data.tasks||[];
  const edited=(t:any)=>({...t,...drafts[t.id]});
  const update=(id:string,key:string,value:string)=>setDrafts(d=>({...d,[id]:{...d[id],[key]:value}}));
  async function post(path:string,body:any) {
    if(readOnly)throw Error('当前为员工视角只读预览，不能代替本人操作。');
    const response=await fetch(`/api/personal/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({month:data.month,weekId:week.id,...body})});
    const payload=await response.json();
    if(!response.ok)throw Error(errors[payload.error]||'操作未完成，请检查输入后重试。');
    return payload;
  }
  async function run(key:string,action:()=>Promise<string|void>) {
    if(busy)return;
    setBusy(key);setMessage('');
    try { const result=await action();setMessage(result||'已保存');onRefresh(); }
    catch(error){setMessage(error instanceof Error?error.message:'操作未完成');onRefresh();}
    finally{setBusy('');}
  }
  async function saveTasks(create:boolean) {
    const chosen=tasks.filter((t:any)=>selected[t.id]&&!t.created);
    if(!chosen.length)throw Error('请至少选择一个尚未创建的任务。');
    for(const task of chosen)await post('tasks/save',edited(task));
    if(!create)return `已保存 ${chosen.length} 项任务草稿，刷新后仍可继续编辑。`;
    const result=await post('tasks/create',{ids:chosen.map((t:any)=>t.id)});
    return result.taskCreateEnabled?`已处理 ${result.results.filter((r:any)=>r.created).length} 项飞书任务。`:`已保存并校验 ${chosen.length} 项任务；当前未开启飞书创建，没有向飞书写入任务。`;
  }
  if(!week)return <section className="v2-card"><ResultEmpty title="还没有关联到你的周报" description="请确认员工身份与花名册；开发时可在右上角切换到员工视角查看。"/></section>;
  const focus=tasks[0];
  const questions=data.analysis?.questions||[];
  return <section className="personal-workspace">
    <div className="v2-card-head"><div><span className="v2-eyebrow"><BookOpen size={14}/>月内周报与成长</span><h3 className="v2-card-title">一周一份记录，把成长串成轨迹</h3><p className="v2-card-sub">本月 {data.weeks.length} 个周次 · 已提交 {data.monthSummary.submitted} 份 · 迟交 {data.monthSummary.late} 份 · 未交 {data.monthSummary.missing} 份 · 未到期 {data.monthSummary.upcoming} 份</p></div><span className="pf-subtle-tag">按周五所属月份归档</span></div>
    <nav className="personal-week-nav" aria-label="选择月内周报">{data.weeks.map((w:any,index:number)=><button type="button" key={w.id} className={w.id===week.id?'is-active':''} aria-current={w.id===week.id?'date':undefined} onClick={()=>onSelectWeek(w.id)}><strong>第 {index+1} 周<span className={`personal-week-status ${w.status==='未交'?'is-warning':''}`}>{w.status}</span></strong><span>{w.start.slice(5).replace('-','/')} — {w.end.slice(5).replace('-','/')}</span>{w.qualityReference!=null&&<small>质量参考 {scoreText(w.qualityReference)}</small>}</button>)}</nav>
    <div className="personal-week-heading"><h3>{week.label} <span>{week.start} — {week.end}</span></h3><span className="pf-subtle-tag">{week.status} · {deadlineText(week)}{week.schedule?.reason==='pre_holiday'?' 截止（假前调整）':week.schedule?.reason==='adjusted_workday'?' 截止（调休调整）':week.dueAt?' 截止':''}</span></div>
    {!module && (week.submitted ? <>
      <section className="v2-card personal-focus"><span className="v2-eyebrow"><Crosshair size={14}/>本周焦点 · 最重要的一件事</span><h3>{focus?.title||'把本周成果转成下周可验证的行动'}</h3><p>{focus?.description||week.facts.plan}</p><div className="personal-focus-grid">{[['第一步怎么做',focus?.firstStep],['验收口径',focus?.metric],['需要谁支持',focus?.supportNeeded]].map(([label,value])=><div key={label}><strong>{label}</strong><p>{value||'请结合实际情况补充。'}</p></div>)}</div><div className="personal-focus-footer"><button type="button" className="secondary-button" onClick={()=>{onOpenModule('actions');setOpenPlan(focus?.id||'');}}><Sparkles size={14}/>展开执行方案</button><span>{focus?.source||'周报辅助整理'} · 建议闭环 {focus?.dueDate||'待确认'}</span></div></section>
      <div className="personal-insight-grid">
        <section className="v2-card"><span className="v2-eyebrow"><ArrowRight size={14}/>承诺与证据</span><h3 className="v2-card-title">上期说的，这周回应了吗</h3><div className="personal-closure-status"><span className="pf-status">{week.closure.status}</span><small>依据原文对照，闭环结论需结合实际交付核实</small></div><div className="personal-closure-pair"><div><strong>上期承诺 {week.closure.previousWeek&&`· ${week.closure.previousWeek}`}</strong><p>{week.closure.previousPlan}</p></div><ArrowRight size={17}/><div><strong>本周证据</strong><p>{week.closure.evidence}</p></div></div><p className="personal-closure-note">{week.closure.summary}</p></section>
        <section className="v2-card"><span className="v2-eyebrow"><TrendingUp size={14}/>成长画像</span><h3 className="v2-card-title">从周报内容，看见能力的形状</h3><div className="personal-radar-layout">{week.radar.length?<div><RadarChart axes={week.radar}/><p className="pf-caption">四模块 AI 参考，不代表月度最终分</p></div>:<ResultEmpty title="暂无完整的模块参考值" description="补齐四模块分析后，这里会展示周报参考画像。"/>}<div><article><strong>月度综合最终分</strong><p>{currentFinal?.collaboration!=null?`${scoreText(currentFinal.collaboration)} 分`:'评分全部完成后自动显示'}</p><small>不展示评分人及单条评分</small></article><article><strong>本月周报状态</strong><p>已交 {data.monthSummary.submitted} 份 · 准时 {data.monthSummary.onTime} 份</p><small>质量、及时率与月度综合分分别计算</small></article></div></div></section>
      </div>
    </> : <section className="v2-card"><ResultEmpty title={week.status==='未到期'?'这一周，还在等待你的新进展':week.status==='免交'?'本周已标记为免交':week.status==='未收集'?'本周尚未纳入采集范围':'本周周报尚未提交'} description={`截止时间：${deadlineText(week)}（北京时间）。当前没有周报正文，不会生成虚构的分析、证据或任务。`}/></section>)}
    {message&&<div className="pf-notice" role="status">{message}</div>}
    {tab==='reports'&&<section className="v2-card"><div className="v2-card-head"><div><span className="v2-eyebrow"><BookOpen size={14}/>本周周报</span><h3 className="v2-card-title">{week.label}的完整记录</h3><p className="v2-card-sub">{week.submittedAt?`提交于 ${week.submittedAt}`:`截止时间 ${deadlineText(week)}`}{week.qualityReference!=null&&` · AI 质量参考 ${scoreText(week.qualityReference)} 分`}</p></div><div className="personal-report-actions"><span className="pf-subtle-tag"><LockKeyhole size={12}/>仅本人可见</span><button type="button" className={`secondary-button ${data.liked?'personal-liked':''}`} disabled={readOnly||!week.submitted||!!busy} onClick={()=>void run('like',async()=>{await post('like',{liked:!data.liked});return data.liked?'已取消点赞':'已点赞';})}><ThumbsUp size={14}/>{data.likeCount} 个赞</button></div></div>
      {week.submitted?<><div className="personal-report-grid">{[['results','本周成果'],['problems','问题与挑战'],['plan','下周计划与目标'],['reflection','思考与复盘']].map(([key,title])=><article key={key}><strong>{title}</strong><p>{week.facts[key]||'本模块尚未填写。'}</p></article>)}</div><div className="personal-comments"><h4><MessageSquare size={14}/>周报互动 <span>{data.comments?.length||0}</span></h4>{!data.comments?.length&&<p className="pf-caption">暂无评论。可以补充本周的结果证据或下一步行动。</p>}{data.comments?.map((c:any)=><article key={c.id}><div><strong>{c.authorName}</strong><small>{dateTime(c.createdAt)}</small></div><p>{c.body}</p></article>)}<div className="personal-composer"><textarea disabled={readOnly} aria-label="周报评论" value={comment} maxLength={4000} onChange={e=>setComment(e.target.value)} placeholder="补充一条评论：记录进展、问题或新的验证证据。"/><button type="button" className="primary-button" disabled={readOnly||!!busy||!comment.trim()} onClick={()=>void run('comment',async()=>{await post('comment',{body:comment});setComment('');return '评论已保存';})}><Send size={14}/>发布评论</button></div></div></>:<ResultEmpty title="这一周暂无正文" description="周次会保留在月度节点中，提交后即可查看完整内容与互动。"/>}
    </section>}
    {tab==='coach'&&<section className="v2-card"><span className="v2-eyebrow"><Brain size={14}/>AI 教练</span><h3 className="v2-card-title">本周点评与追问</h3>{data.analysis?<><p className="personal-analysis-label">{data.analysis.label}</p><p className="personal-coach-summary">{data.analysis.summary}</p><div className="personal-questions">{questions.map((q:any,index:number)=><article key={index}><span>{typeof q==='string'?['教练提问','自我对照','支持请求'][index%3]:q.title}</span><p>{typeof q==='string'?q:q.text}</p></article>)}</div><div className="personal-chat"><h4><CircleHelp size={15}/>继续追问</h4><p className="pf-caption">{data.aiConfigured?'仅带入本人的周报、所选任务和已有对话。':'尚未配置实时 AI 服务。你可以先阅读辅助整理和展开任务执行方案，配置后即可继续追问。'}</p>{data.messages?.map((m:any,index:number)=><article className={m.role==='user'?'is-user':''} key={index}><strong>{m.role==='user'?'我':'AI 教练'}</strong><p>{m.body}</p></article>)}<div className="personal-composer"><textarea aria-label="AI 教练追问" disabled={readOnly||!data.aiConfigured||!!busy} value={question} onChange={e=>setQuestion(e.target.value)} maxLength={4000} placeholder={data.aiConfigured?'问问：如何验证这个计划？需要谁支持？':'配置模型服务后，可在这里继续追问。'}/><button type="button" className="primary-button" disabled={readOnly||!data.aiConfigured||!!busy||!question.trim()} onClick={()=>void run('coach',async()=>{await post('coach',{question});setQuestion('');return 'AI 教练已回复';})}><Send size={14}/>{busy==='coach'?'思考中…':'发送追问'}</button></div></div></>:<ResultEmpty title="等待本周周报" description="没有已提交的周报时，不生成点评和任务建议。"/>}</section>}
    {tab==='actions'&&<section className="v2-card"><div className="v2-card-head"><div><span className="v2-eyebrow"><Target size={14}/>行动清单</span><h3 className="v2-card-title">从本周周报拆出可验证的行动</h3><p className="v2-card-sub">勾选、编辑并保存草稿；确认后可将任务创建到飞书。</p></div><button type="button" className="secondary-button" disabled={readOnly||!tasks.length} onClick={()=>setOpenPlan(openPlan?'':tasks[0]?.id)}><Sparkles size={14}/>{openPlan?'收起执行方案':'展开执行方案'}</button></div>
      {!tasks.length?<ResultEmpty title="暂无任务候选" description="提交本周周报后，可根据计划、问题与复盘整理行动。"/>:<><div className="pf-notice">已选 {tasks.filter((t:any)=>selected[t.id]&&!t.created).length} 项 · 已创建 {tasks.filter((t:any)=>t.created).length} 项 · {data.taskCreateEnabled?'飞书任务创建已开启':'飞书创建未开启，可保存草稿并校验'}</div><div className="personal-task-list">{tasks.map((task:any)=>{const t=edited(task);return <article className={`personal-task ${selected[t.id]?'is-selected':''}`} key={t.id}><div className="personal-task-heading"><input type="checkbox" aria-label={`选择任务 ${task.title}`} disabled={readOnly||task.created||!!busy} checked={!!selected[t.id]&&!task.created} onChange={e=>setSelected(s=>({...s,[t.id]:e.target.checked}))}/><span className="pf-subtle-tag">{t.priority}</span><input aria-label={`任务标题 ${task.title}`} value={t.title} disabled={readOnly||task.created} onChange={e=>update(t.id,'title',e.target.value)} maxLength={240}/><span className="pf-status">{task.created?'已创建':task.savedAt?'草稿已保存':'待确认'}</span></div><label className="personal-task-description">任务说明<textarea aria-label={`任务说明 ${task.title}`} value={t.description} disabled={readOnly||task.created} onChange={e=>update(t.id,'description',e.target.value)} maxLength={10000}/></label><div className="personal-task-meta"><span>负责人：{t.owner}</span><label>建议闭环 <input type="date" value={t.dueDate} disabled={readOnly||task.created} onChange={e=>update(t.id,'dueDate',e.target.value)}/></label><button className="personal-plan-button" type="button" onClick={()=>setOpenPlan(openPlan===t.id?'':t.id)}><Sparkles size={13}/>执行方案</button><small>{t.source}</small></div><div className="pf-form"><label>衡量指标<textarea value={t.metric} disabled={readOnly||task.created} onChange={e=>update(t.id,'metric',e.target.value)} maxLength={2000}/></label><label>证据<textarea value={t.evidence} disabled={readOnly||task.created} onChange={e=>update(t.id,'evidence',e.target.value)} maxLength={8000}/></label></div>{openPlan===t.id&&<div className="personal-plan"><span className="v2-eyebrow"><Sparkles size={14}/>执行方案 · 请结合实际情况核实</span><div className="personal-focus-grid"><article><strong>第一步</strong><p>{t.firstStep}</p></article><article><strong>需要的支持</strong><p>{t.supportNeeded}</p></article><article><strong>验收结果</strong><p>{t.metric}</p></article></div><p className="pf-caption">上下文仅来自 {week.label}本人的周报。可到「AI 教练」继续追问。</p><button type="button" className="secondary-button" onClick={()=>onOpenModule('coach')}>进入 AI 教练</button></div>}{task.created&&safeUrl(task.url)&&<a href={safeUrl(task.url)} target="_blank" rel="noreferrer">在飞书查看任务 ↗</a>}</article>;})}</div><div className="personal-task-footer"><p>当前编辑内容会保存为本人草稿；已确认的月度分数不会被修改。</p><div><button type="button" className="secondary-button" disabled={readOnly||!!busy} onClick={()=>void run('save',()=>saveTasks(false))}>保存选中草稿</button><button type="button" className="primary-button" disabled={readOnly||!!busy} onClick={()=>void run('create',()=>saveTasks(true))}><Send size={14}/>{busy==='create'?'处理中…':data.taskCreateEnabled?'创建选中飞书任务':'校验选中任务'}</button></div></div></>}
    </section>}
    {tab==='timeline'&&<section className="v2-card"><span className="v2-eyebrow"><History size={14}/>成长时间线</span><h3 className="v2-card-title">本月每一周的足迹</h3><div className="personal-timeline">{[...data.weeks].reverse().map((w:any)=><article key={w.id}><div className="personal-timeline-head"><strong>{w.label} <small>{w.start} — {w.end}</small></strong><span className="pf-status">{w.status}</span>{w.qualityReference!=null&&<span className="personal-reference-score">AI 参考 {scoreText(w.qualityReference)} 分</span>}</div>{w.submitted?<><p>{w.facts.results}</p><p className="pf-caption">{w.facts.problems}</p><details><summary>展开本周全文</summary>{[['plan','下周计划'],['reflection','思考与复盘']].map(([key,label])=><div className="pf-fact" key={key}><span>{label}</span><p>{w.facts[key]||'未填写'}</p></div>)}</details><button className="personal-plan-button" type="button" onClick={()=>{onSelectWeek(w.id);onOpenModule('reports');}}>查看这一周的完整工作区 <ArrowRight size={13}/></button></>:<p className="pf-caption">{w.status==='未到期'?`尚未到提交截止：${deadlineText(w)}`:'本周暂无已提交的周报，保留周次以便补充。'}</p>}</article>)}</div></section>}
  </section>;
}
