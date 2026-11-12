import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {weeklyReportSchedule,fridayOfWeek} from './weekly-report-schedule.mjs';
import {REPORT_QUALITY_VERSION,REPORT_QUALITY_PROMPT_VERSION,REPORT_QUALITY_WEIGHTS,buildReportQualityPrompt,reportQualityTotal,validateReportQualityAnalysis,qualityAnalysisDiagnostic,isReportQualityValidationFailure} from './report-quality-scoring.mjs';
import {reportFacts,previousQualitySnapshot,currentQualityCached,archivedQuality,legacyReportScore} from './report-rescore-state.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const date=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(d);
const shift=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const MAX_MODEL_COOLDOWN_MS=24*60*60*1000,DEFAULT_MODEL_COOLDOWN_MS=60000,ANALYSIS_DEFERRED=Symbol('analysis-deferred');
const MAX_ANALYSIS_ATTEMPTS=2,ANALYSIS_RETRY_HELD=Symbol('analysis-retry-held');
const countsAgainstAutomaticAttempts=code=>isReportQualityValidationFailure(code)||['upstream_timeout','upstream_network_error','upstream_error'].includes(code);
const HTTP_DATE=/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
const upstreamFailures=new WeakMap();
function retryAfter(response){
 let raw;try{raw=response.headers?.get?.('retry-after');}catch{}
 if(typeof raw!=='string'||!raw.trim())return DEFAULT_MODEL_COOLDOWN_MS;
 raw=raw.trim();
 // A valid digit string can exceed Number's range. Keep it beyond the
 // automatic-wait bound so it pauses the batch instead of falling back to 60s.
 if(/^\d+$/.test(raw)){const delay=Number(raw)*1000;return Number.isFinite(delay)?delay:Infinity;}
 const delay=HTTP_DATE.test(raw)?Date.parse(raw)-Date.now():NaN;
 return Number.isFinite(delay)?Math.max(0,delay):DEFAULT_MODEL_COOLDOWN_MS;
}
function upstreamFailure(response,value,model){
 const status=response.status,type=model?(value?.error?.type||value?.error?.code):null;
 let code=status===400?'upstream_bad_request':status===401?'upstream_auth_failed':status===403?'upstream_forbidden':status===429?'upstream_rate_limit':'upstream_error';
 let retryable=status===429||status>=500;
 if(model&&type==='exceeded_current_quota_error'){code='upstream_quota_exhausted';retryable=false;}
 else if(model&&type==='engine_overloaded_error'){code='upstream_overloaded';retryable=true;}
 else if(model&&type==='rate_limit_reached_error'){code='upstream_rate_limit';retryable=true;}
 const cooldown=status===429||code==='upstream_overloaded'||code==='upstream_rate_limit'?retryAfter(response):null;
 const diagnostic={code,path:'$',retryable,...(cooldown===null?{}:{retryAfterMs:Math.min(MAX_MODEL_COOLDOWN_MS,cooldown),...(cooldown>MAX_MODEL_COOLDOWN_MS?{retryAfterExceeded:true}:{})})};
 const error=Error('upstream_request_failed');upstreamFailures.set(error,{diagnostic,cooldown});return error;
}
function analysisDiagnostic(error){
 const upstream=upstreamFailures.get(error);if(upstream)return {...upstream.diagnostic};
 return error?.code==='invalid_summary'?{code:'invalid_summary',path:'summary',retryable:true}:error?.code==='response_truncated'?{code:'response_truncated',path:'$',retryable:true}:error?.code==='upstream_network_error'?{code:'upstream_network_error',path:'$',retryable:true}:qualityAnalysisDiagnostic(error);
}
export function normalizeLiveReport(item,calendar={}){
 const time=Number(item.commit_time);if(!item.from_user_id||!item.task_id||!Number.isFinite(time)||time<=0)throw Error('invalid_report_identity_or_time');
 const day=date(new Date(time*1000)),weekday=new Date(day+'T00:00:00Z').getUTCDay()||7;
 // A Monday/weekend submission normally belongs to the preceding working week.
 const currentEnd=fridayOfWeek(day),holidayMonday=weekday===1&&weeklyReportSchedule(currentEnd,calendar).deadlineDate===day;
 const end=weekday===1&&!holidayMonday?shift(day,-3):currentEnd,start=shift(end,-4);
 const fields=Array.isArray(item.form_contents)?item.form_contents:[];
 const get=pattern=>{const f=fields.find(f=>pattern.test(String(f.field_name)));return typeof f?.field_value==='string'?f.field_value:JSON.stringify(f?.field_value??'');};
 const facts={results:get(/^本周成果/),problems:get(/^问题与挑战/),nextPlan:get(/^下周工作计划|^下周计划/),reflection:get(/^思考与复盘/)};
 return {id:'lark-report-'+item.task_id,userId:item.from_user_id,name:item.from_user_name,department:item.department_name||'',start,end,weekId:'period-'+end,label:`${end.slice(0,4)}年${Number(end.slice(5,7))}月第${Math.ceil(Number(end.slice(8))/7)}周`,submittedAt:new Date(time*1000).toISOString(),facts,sourceHash:digest({task:item.task_id,time,facts}),source:{provider:'feishu-report',taskId:item.task_id,ruleId:item.rule_id,ruleName:item.rule_name,commitTime:time,formContents:fields,weekInference:holidayMonday?'假前最后工作日为周一，归属当前工作周':'提交日期推定；普通周一归属上一工作周，周末按本周周五归档'}};
}
export function validateAnalysis(value,facts){
 const a=value;if(!a||typeof a.summary!=='string'||!a.summary.trim())throw Object.assign(Error('invalid_ai_analysis'),{code:'invalid_summary'});
 const quality=facts?validateReportQualityAnalysis(a,facts):{scores:a.scores};
 if(!Array.isArray(quality.scores)||quality.scores.length!==4||quality.scores.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>100))throw Error('invalid_ai_analysis');
 return {...quality,summary:a.summary.slice(0,6000),questions:(Array.isArray(a.questions)?a.questions:[]).filter(x=>typeof x==='string').slice(0,5),anomalies:(Array.isArray(a.anomalies)?a.anomalies:[]).filter(x=>typeof x==='string').slice(0,10),tasks:(Array.isArray(a.tasks)?a.tasks:[]).filter(x=>x&&typeof x.title==='string'&&typeof x.description==='string').slice(0,4).map(x=>({title:x.title.slice(0,240),description:x.description.slice(0,6000),evidence:String(x.evidence||'').slice(0,4000),metric:String(x.metric||'').slice(0,2000),firstStep:String(x.firstStep||'').slice(0,2000),supportNeeded:String(x.supportNeeded||'').slice(0,2000),priority:['P0','P1','P2'].includes(x.priority)?x.priority:'P2'}))};
}
export function createLiveReportSync({query,exec,sql,config,settings,refreshDirectory,writeStatus,reserveAiRequest=async()=>true,measureAiRequest=(_model,operation)=>operation(),onComplete=async()=>{},observeEmployee=async()=>{},calendar=()=>({}),fetcher=fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 let running=false,statusWrites=Promise.resolve(),projection=Promise.resolve(),collectionStartDate='';
 let modelQueue=Promise.resolve(),modelCooldownUntil=0;
 const emit=state=>{statusWrites=statusWrites.catch(()=>{}).then(()=>writeStatus(state));return statusWrites;};
 const jsonFile=async name=>{try{return JSON.parse(await readFile(path.join(config.dataDir,name+'.json'),'utf8'));}catch{return {};}};
 const saveFile=async(name,value)=>{await mkdir(config.dataDir,{recursive:true});const p=path.join(config.dataDir,name+'.json'),tmp=p+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2));await rename(tmp,p);};
 const inactive=async userId=>Number((await query(`SELECT is_active FROM employees WHERE user_id=${sql(userId)};`))[0]?.is_active)===0;
 async function request(url,body,token,model=false,receive){
  let response;try{response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});}catch(error){if(['AbortError','TimeoutError'].includes(error?.name))throw error;throw Object.assign(Error('upstream_network_error'),{code:'upstream_network_error'});}
  let value;try{value=await response.json();}catch(error){if(!response.ok)throw upstreamFailure(response,null,model);throw error;}
  const ok=response.ok&&(!value?.code||value.code===0);
  receive?.(ok,value?.usage);
  if(!ok)throw upstreamFailure(response,value,model);
  return value;
 }
 async function waitForModel(attempt){
  let remaining=Math.max(attempt>1?Math.min(30000,5000*2**(attempt-2)):1200,modelCooldownUntil-Date.now());
  // Avoid setTimeout overflow, and allow synthetic pauses to advance each
  // requested interval without waiting in wall-clock time.
  while(remaining>0){const step=Math.min(60000,remaining);await pause(step);remaining-=step;}
  modelCooldownUntil=0;
 }
 function aiConfigurationChanged(batch){
  return config.kimiFollowupModel!==batch.model||config.moonshotBaseUrl!==batch.baseUrl||config.moonshotApiKey!==batch.apiKey;
 }
 function analyze(report,canProcess,weights,onAttempt,batch,automaticAttemptsLeft){
  const job=modelQueue.then(()=>{
   if(batch.blockedReason)return ANALYSIS_DEFERRED;
   if(modelCooldownUntil-Date.now()>MAX_MODEL_COOLDOWN_MS){batch.blockedReason='upstream_retry_after_too_long';return ANALYSIS_DEFERRED;}
   return analyzeSerial(report,canProcess,weights,onAttempt,batch,automaticAttemptsLeft);
  });
  modelQueue=job.catch(()=>{});return job;
 }
 async function analyzeSerial(report,canProcess,weights,onAttempt,batch,automaticAttemptsLeft){
  const previous=(await query(`SELECT content_json FROM weekly_reports WHERE employee_user_id=${sql(report.userId)} AND week_end<${sql(report.end)} ORDER BY week_end DESC LIMIT 1;`))[0];
  const previousContent=previous?JSON.parse(previous.content_json):{},previousPlan=previousContent.nextPlan||'';
  let failure,feedback=null,lastOutput='';
  for(let attempt=1;attempt<=MAX_ANALYSIS_ATTEMPTS;attempt++){
   await waitForModel(attempt);
   if(!await canProcess(report))return null;
   if(aiConfigurationChanged(batch)){batch.blockedReason='ai_model_changed';return ANALYSIS_DEFERRED;}
   try{
    const reservation=await reserveAiRequest();
    if(reservation!==true){batch.blockedReason=reservation==='ai_scoring_paused'?reservation:'ai_request_budget_unavailable';return ANALYSIS_DEFERRED;}
   }catch{batch.blockedReason='ai_request_budget_unavailable';return ANALYSIS_DEFERRED;}
   if(await onAttempt(attempt,null)===false)return null;
   if(aiConfigurationChanged(batch)){batch.blockedReason='ai_model_changed';return ANALYSIS_DEFERRED;}
   try{
    const messages=[{role:'system',content:buildReportQualityPrompt()},{role:'user',content:JSON.stringify({week:report.end,report:report.facts,department:report.department,previousPlan})}];
    if(feedback){
     if(lastOutput)messages.push({role:'assistant',content:lastOutput.slice(0,100000)});
     messages.push({role:'user',content:JSON.stringify({validationFeedback:feedback,instruction:'上一份结果未通过程序校验。请针对指定字段修正，保持原评分细则和原文证据要求，重新输出完整JSON；不得编造引文。'})});
    }
    const value=await measureAiRequest(batch.model,receive=>{
     batch.requests++;
     return request(batch.baseUrl+'/chat/completions',
      {model:batch.model,max_completion_tokens:10000,thinking:{type:'disabled'},response_format:{type:'json_object'},messages},batch.apiKey,true,receive);
    });
    lastOutput=value.choices?.[0]?.message?.content||'';
    if(value.choices?.[0]?.finish_reason==='length')throw Object.assign(Error('response_truncated'),{code:'response_truncated'});
    const ai=validateAnalysis(JSON.parse(lastOutput.replace(/^```(?:json)?\s*|\s*```$/g,'')),report.facts);
    const flags=ai.modules.flatMap(module=>!report.facts[module.id]?.trim()?[`${module.module}缺失，自动记0分`]:module.confidence!==null&&module.confidence<0.6?[`${module.module}模型自评置信度较低，仅作提示`]:[]);
    if(ai.totalScore<60)flags.push('内容质量分低于60分，仅作改进提示');
    if(previousContent.ai?.version===REPORT_QUALITY_VERSION&&previousContent.aiModel===batch.model&&Array.isArray(previousContent.ai.scores)&&previousContent.ai.scores.length===4&&previousContent.ai.scores.every(Number.isFinite)&&Math.abs(ai.totalScore-reportQualityTotal(previousContent.ai.scores,weights))>=15)flags.push('内容质量分较上期变化达到15分，仅作趋势提示');
    ai.anomalies=[...new Set([...flags,...ai.anomalies])].slice(0,10);
    const sources=Object.values(report.facts).filter(Boolean);
    for(const task of ai.tasks)if(!task.evidence||!sources.some(source=>source.includes(task.evidence)))task.evidence=report.facts.problems||report.facts.nextPlan||report.facts.results||report.facts.reflection;
    return ai;
   }catch(error){
    failure=error;
    const diagnostic=analysisDiagnostic(error),upstream=upstreamFailures.get(error);
    if(upstream?.cooldown!==null&&upstream?.cooldown!==undefined)modelCooldownUntil=Date.now()+upstream.cooldown;
    if(diagnostic.code==='upstream_quota_exhausted')batch.blockedReason='upstream_quota_exhausted';
    else if(diagnostic.retryAfterExceeded)batch.blockedReason='upstream_retry_after_too_long';
    await onAttempt(attempt,diagnostic);
    feedback=diagnostic;
    if(countsAgainstAutomaticAttempts(diagnostic.code)&&--automaticAttemptsLeft===0)return ANALYSIS_RETRY_HELD;
    if(!diagnostic.retryable||batch.blockedReason)break;
   }
  }
  throw failure;
 }
 async function project(){
  const old=await jsonFile('prototypeData'),byPeriod={};const stored=await query('SELECT * FROM weekly_reports ORDER BY week_end,submitted_at;');const roster=await query('SELECT * FROM employees WHERE is_active=1;');const rows=[];const periods=new Map();
  for(const r of stored){
   const c=JSON.parse(r.content_json),legacy=c.source?.provider==='legacy-reportos';
   if(!legacy&&c.source?.provider!=='feishu-report')continue;
   const a=legacy?null:c.ai;
   const weights=a?.version===REPORT_QUALITY_VERSION?REPORT_QUALITY_WEIGHTS:a?c.scoringWeights||(await settings.policyFor(r.week_end.slice(0,7))).weights||REPORT_QUALITY_WEIGHTS:REPORT_QUALITY_WEIGHTS;
   const score=legacy?legacyReportScore(c):a?reportQualityTotal(a.scores,weights):null;
   const p={id:c['周期ID']||'period-'+r.week_end,label:r.week_label,start:r.week_start,end:r.week_end,range:r.week_start+' — '+r.week_end,exempt_people:[],status:'历史'};
   periods.set(p.end,p);
   rows.push({...c,user_id:r.employee_user_id,'姓名':r.employee_name,'部门':r.department,'源记录ID':r.id,'周次':r.week_label,'开始日期':r.week_start,'结束日期':r.week_end,'提交时间':r.submitted_at,'状态':r.status,'总分':score});
   byPeriod[p.id]??={meta:{provider:'moonshot',model:config.kimiFollowupModel,generatedAt:new Date().toISOString(),source:'feishu-report'},executiveSummary:[],collectiveFocus:[],attentionQueue:[],mustReadReports:[],themes:[],employeeInsights:[],feishuTaskPlan:{}};
   if(a)byPeriod[p.id].employeeInsights.push({userId:r.employee_user_id,name:r.employee_name,coachSummary:typeof a.summary==='string'?a.summary:'',coachQuestions:Array.isArray(a.questions)?a.questions:[],taskCandidates:(Array.isArray(a.tasks)?a.tasks:[]).filter(task=>task&&typeof task==='object').map(t=>({...t,ownerUserId:r.employee_user_id,owner:r.employee_name,department:r.department,source:'飞书周报 · Kimi 分析',dueDate:shift(r.week_end,7)}))});
  }
  for(const insight of Object.values(byPeriod)){
   insight.executiveSummary=insight.employeeInsights.slice(0,8).map(e=>e.name+'：'+e.coachSummary.slice(0,160));
   const tasks=insight.employeeInsights.flatMap(e=>e.taskCandidates.map(t=>({...t,owner:e.name})));
   insight.executiveSummary.unshift(`${insight.employeeInsights.length} 份周报已分析，${tasks.filter(t=>t.priority==='P0').length} 项 P0 风险待关注。`);
   insight.attentionQueue=tasks.filter(t=>['P0','P1'].includes(t.priority)).map((t,i)=>({...t,id:'live-'+digest([insight.meta.generatedAt,t.owner,t.title]).slice(0,16),whyBoss:t.description,theme:t.title}));
   insight.themes=insight.attentionQueue.slice(0,10).map(t=>({label:t.title,value:t.priority==='P0'?9:6,severity:t.priority,summary:t.description,detail:t.description,quotes:[{author:t.owner,department:t.department,week:'',text:t.evidence}],nextStep:t.firstStep}));
   insight.mustReadReports=insight.employeeInsights.filter(e=>e.taskCandidates.some(t=>t.priority==='P0')).map(e=>{const t=e.taskCandidates.find(t=>t.priority==='P0');return {userId:e.userId,name:e.name,department:t.department,reason:t.title,focus:t.description,evidence:t.evidence};});
  }
  const list=[...periods.values()].sort((a,b)=>a.end.localeCompare(b.end)),latest=list.at(-1);if(!latest)return;
  const employees=roster.map(e=>{const rs=rows.filter(r=>r.user_id===e.user_id),scores=rs.map(r=>r['总分']).filter(Number.isFinite);return {user_id:e.user_id,'姓名':e.name,'部门':e.department,'企业邮箱':e.email||'','周报数':rs.length,'平均分':scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*10)/10:0,'准时次数':rs.filter(r=>r['状态']==='准时').length,'迟交次数':rs.filter(r=>r['状态']==='迟交').length};});
  const firstCollected=[old.meta?.collectionStartDate,collectionStartDate].filter(Boolean).sort()[0];
  const next={...old,meta:{source_xlsx:'FEISHU_LIVE_REPORTS',collectionStartDate:firstCollected,generated_on:date(new Date()),people_count:employees.length,weekly_record_count:rows.length,periods:list,current_week_id:latest.id,current_week_label:latest.label,current_week_start:latest.start,current_week_end:latest.end,current_week_range:latest.range,submitted_count:rows.filter(r=>r['结束日期']===latest.end).length,exempt_count:0,exempt_people:[],class_distribution:{},dept_average_scores:Object.fromEntries([...new Set(employees.map(e=>e['部门']))].map(dept=>{const rs=rows.filter(r=>r['部门']===dept&&r['结束日期']===latest.end&&r.ai);return [dept,rs.length?Math.round(rs.reduce((v,r)=>v+r['总分'],0)/rs.length*10)/10:0];})),company_chat:{name:'',chat_id:''}},employee_summary:employees,weekly_scores:rows,boss_tasks:[],employee_tasks:[],feedback_drafts:[],group_message_draft:''};
  await saveFile('prototypeData',next);await saveFile('kimiInsightsByPeriod',byPeriod);await saveFile('kimiInsights',byPeriod[latest.id]);
 }
 function validateOptions(options){
  if(options.mode!==undefined&&options.mode!=='sync'&&options.mode!=='rescore')throw Error('invalid_sync_mode');
  if(options.mode==='rescore'&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(options.targetMonth||'')||options.targetMonth>date(new Date()).slice(0,7)))throw Error('invalid_rescore_month');
  if(options.targetReportId!==undefined&&(options.mode!=='rescore'||typeof options.targetReportId!=='string'||!options.targetReportId||options.targetReportId.length>200||options.targetReportId.trim()!==options.targetReportId))throw Error('invalid_report_id');
 }
 async function run(options={}){
  validateOptions(options);
  const selected=options.historicalInactiveUserIds;
  if(selected!==undefined&&(!Array.isArray(selected)||selected.length>500||selected.some(id=>typeof id!=='string'||!id.trim()||id!==id.trim()||id.length>200)))throw Error('invalid_historical_inactive_users');
  const historicalIds=new Set(selected||[]),today=date(new Date()),rescore=options.mode==='rescore',jobId=randomUUID();
  const scoringStartMonth=(await settings.reportAutomationConfig?.())?.scoringStartMonth;
  if(rescore&&scoringStartMonth&&options.targetMonth<scoringStartMonth)throw Error('rescore_before_start_month');
  async function closedHistoryCovers(report){
   if(!historicalIds.has(report.userId)||report.end>today)return false;
   const periods=await query(`SELECT start_date,end_date FROM employee_employment_periods WHERE employee_user_id=${sql(report.userId)} AND end_date IS NOT NULL;`);
   return periods.some(period=>/^\d{4}-\d{2}-\d{2}$/.test(period.start_date)&&/^\d{4}-\d{2}-\d{2}$/.test(period.end_date)&&period.start_date<=report.start&&period.end_date>=report.end&&period.end_date<=today);
  }
  const canProcess=async report=>!await inactive(report.userId)||await closedHistoryCovers(report);
  const analysisBatch={blockedReason:null,requests:0,model:config.kimiFollowupModel,baseUrl:config.moonshotBaseUrl,apiKey:config.moonshotApiKey};
  if(!analysisBatch.apiKey)throw Error('ai_not_configured');
  const stat={ok:true,running:true,mode:rescore?'rescore':'sync',...(rescore?{targetMonth:options.targetMonth}:{}),phase:rescore?'prepare':'pull',message:rescore?'正在读取所选月份未完成评分':'正在读取飞书汇报',startedAt:new Date().toISOString(),rowCount:0,analyzed:0,failed:0,cached:0,retryHeld:0,remaining:0,active:0,aiRequestBudget:0,aiRequests:0,skippedInactive:0,skippedInactiveAnalysis:0,skippedSourceChanged:0,historicalInactiveReports:0,errors:[],diagnostics:[],byMonth:{}};
  await emit(stat);
  const reports=new Map();
  if(rescore){
   const target=options.targetReportId?` AND w.id=${sql(options.targetReportId)} AND NOT EXISTS(SELECT 1 FROM weekly_reports newer WHERE newer.employee_user_id=w.employee_user_id AND newer.week_end=w.week_end AND newer.rowid>w.rowid)`:'';
   const stored=await query(`SELECT w.* FROM weekly_reports w JOIN employees e ON e.user_id=w.employee_user_id WHERE substr(w.week_end,1,7)=${sql(options.targetMonth)} AND e.is_active=1 AND COALESCE(w.status,'')<>'未交'${target} ORDER BY w.employee_user_id,w.week_end,w.rowid;`);
   for(const row of stored){
    const content=JSON.parse(row.content_json);
    if(content.source?.provider==='legacy-reportos')continue;
    if(!row.submitted_at&&!Object.values(reportFacts(content)).some(value=>String(value).trim()))continue;
    const facts=reportFacts(content),sourceHash=row.source_hash||digest({id:row.id,facts,submittedAt:row.submitted_at});
    reports.set(row.employee_user_id+'|'+row.week_end,{id:row.id,userId:row.employee_user_id,name:row.employee_name,department:row.department,start:row.week_start,end:row.week_end,weekId:content['周期ID']||'period-'+row.week_end,label:row.week_label,submittedAt:row.submitted_at,facts,sourceHash,source:content.source,stored:row});
   }
   stat.period={label:options.targetMonth+' 周报评分补跑',range:options.targetMonth};
  }else{
   const reportConfig=(await settings.overview()).report;
   if(!config.feishuAppId||!config.feishuAppSecret)throw Error('feishu_not_configured');
   const end=options.end||today,start=options.start||reportConfig.startDate||end.slice(0,7)+'-01';
   if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)throw Error('invalid_sync_dates');
   stat.period={label:start+' 至 '+end,range:''};await emit(stat);
   const token=await request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{app_id:config.feishuAppId,app_secret:config.feishuAppSecret});
   let page='',items=[],seen=new Set();
   do{
    const result=await request('https://open.feishu.cn/open-apis/report/v1/tasks/query?user_id_type=user_id',{commit_start_time:Math.floor(Date.parse(start+'T00:00:00+08:00')/1000),commit_end_time:Math.floor(Date.parse(end+'T23:59:59+08:00')/1000),page_size:20,page_token:page,...(reportConfig.ruleId?{rule_id:reportConfig.ruleId}:{})},token.tenant_access_token);
    items.push(...(result.data?.items||[]));if(!result.data?.has_more)break;page=result.data.page_token;if(!page||seen.has(page))throw Error('invalid_pagination');seen.add(page);if(seen.size>=1000)throw Error('pagination_limit');
   }while(true);
   items=items.filter(item=>reportConfig.ruleId?item.rule_id===reportConfig.ruleId:item.rule_name===reportConfig.templateName);
   if(!items.length){await emit({...stat,running:false,phase:'done',message:'指定日期内没有找到该模板的汇报',finishedAt:new Date().toISOString()});return;}
   const inactiveIds=new Set((await query('SELECT user_id FROM employees WHERE is_active=0;')).map(employee=>employee.user_id));
   const accepted=[];
   for(const item of items){if(!inactiveIds.has(item.from_user_id)||historicalIds.has(item.from_user_id)&&await closedHistoryCovers(normalizeLiveReport(item,calendar())))accepted.push(item);else stat.skippedInactive++;}
   items=accepted;
   if(items.length){
    collectionStartDate=[(await jsonFile('prototypeData')).meta?.collectionStartDate,start].filter(Boolean).sort()[0];
    const ruleIds=[...new Set(items.map(item=>item.rule_id))];if(!reportConfig.ruleId&&ruleIds.length===1)await settings.saveReport({...reportConfig,ruleId:ruleIds[0]},{userId:'system',name:'系统自动匹配'});
    const existingWeeks=new Map((await query('SELECT id,employee_user_id,week_start,week_end,week_label FROM weekly_reports;')).map(row=>[row.id,row]));
    for(const item of items){
     const report=normalizeLiveReport(item,calendar()),prior=existingWeeks.get(report.id),existing=prior?.employee_user_id===report.userId?prior:null;
     if(existing&&existing.week_end!==report.end){report.start=existing.week_start;report.end=existing.week_end;report.weekId='period-'+report.end;report.label=existing.week_label;report.source.weekInference+='；保留该汇报已有的历史周次归属';}
     if(scoringStartMonth&&report.end.slice(0,7)<scoringStartMonth)continue;
     const key=report.userId+'|'+report.end;if(!reports.has(key)||reports.get(key).submittedAt<report.submittedAt)reports.set(key,report);
    }
   }
  }
  const skippedMessage=()=>`${stat.skippedInactive?`；已跳过 ${stat.skippedInactive} 份已停用人员汇报`:''}${stat.skippedInactiveAnalysis?`；已停止 ${stat.skippedInactiveAnalysis} 份停用人员的排队分析`:''}`;
  if(!reports.size){await emit({...stat,running:false,phase:'done',message:rescore?'所选月份没有可补跑的在职员工周报':`本次没有需要导入的汇报${skippedMessage()}。`,finishedAt:new Date().toISOString()});return;}
  const work=[];let batch='';
  function monthCell(report){return stat.byMonth[report.end.slice(0,7)]??={total:0,completed:0,failed:0,cached:0,remaining:0,active:0,skipped:0};}
  function recordRetryHold(cell){stat.retryHeld++;cell.retryHeld=(cell.retryHeld||0)+1;}
  function updateRemaining(){
   stat.aiRequests=analysisBatch.requests;
   stat.remaining=Math.max(0,stat.rowCount-stat.cached-stat.analyzed-stat.failed-stat.retryHeld-stat.skippedInactiveAnalysis-stat.skippedSourceChanged);
   for(const cell of Object.values(stat.byMonth))cell.remaining=Math.max(0,cell.total-cell.cached-cell.completed-cell.failed-(cell.retryHeld||0)-cell.skipped);
   const held=stat.retryHeld?`，已停止自动重试 ${stat.retryHeld} 份`:'';
   stat.message=`${rescore?options.targetMonth+' 评分补跑':'周报同步'}：完成 ${stat.analyzed} 份，复用 ${stat.cached} 份，失败 ${stat.failed} 份，待处理 ${stat.remaining} 份${held}${skippedMessage()}`;
  }
  for(const report of reports.values()){
   const historicalInactive=await inactive(report.userId);if(historicalInactive&&!await closedHistoryCovers(report)){stat.skippedInactive++;continue;}
   const old=report.stored||(await query(`SELECT content_json,source_hash FROM weekly_reports WHERE employee_user_id=${sql(report.userId)} AND week_end=${sql(report.end)};`))[0];
   const previous=old?JSON.parse(old.content_json):{};
   if(previous.source?.provider==='legacy-reportos')continue;
   const policy=await settings.policyFor(report.end.slice(0,7)),weights=REPORT_QUALITY_WEIGHTS;
   // Legacy rows may predate sourceHash in their JSON; SQL remains authoritative.
   const prior={...previous,sourceHash:previous.sourceHash||old?.source_hash||''};
   let ai=null;
   if(!options.targetReportId&&old?.source_hash===report.sourceHash&&currentQualityCached(prior,report.sourceHash,analysisBatch.model))try{ai=validateAnalysis(previous.ai,report.facts);ai.promptVersion=previous.ai.promptVersion||previous.aiPromptVersion;}catch{}
   const cell=monthCell(report);cell.total++;stat.rowCount++;
   if(historicalInactive)stat.historicalInactiveReports++;
   if(rescore&&ai){stat.cached++;cell.cached++;continue;}
   const snapshot=previousQualitySnapshot(prior,old?.source_hash||'',policy.weights||weights),history=ai?previous.aiAnalysisHistory||[]:archivedQuality(prior,old?.source_hash||'',policy.weights||weights);
   const schedule=weeklyReportSchedule(report.end,calendar(),policy.deadlineTime),late=!schedule.exempt&&!schedule.calendarPending&&Date.parse(report.submittedAt)>Date.parse(schedule.dueAt||'');
   const attempts=Array.isArray(previous.aiAnalysisAttempts)?previous.aiAnalysisAttempts:[];
   // Older diagnostic entries lacked a model. Keep the original attribution through later model changes.
   const legacyModel=previous.aiLegacyAttemptsModel||previous.qualityRefresh?.model||previous.aiModel||analysisBatch.model;
   const automaticFailures=attempts.filter(attempt=>attempt?.sourceHash===report.sourceHash&&attempt.promptVersion===REPORT_QUALITY_PROMPT_VERSION&&(attempt.model||legacyModel)===analysisBatch.model&&countsAgainstAutomaticAttempts(attempt.code)).length;
   const retryHeld=!rescore&&!ai&&automaticFailures>=MAX_ANALYSIS_ATTEMPTS;
   const content={...report.facts,'周期ID':report.weekId,'本周成果摘要':report.facts.results,'问题摘要':report.facts.problems,'下周计划摘要':report.facts.nextPlan,'思考与复盘摘要':report.facts.reflection,source:report.source,sourceHash:report.sourceHash,scoringWeights:weights,submissionSchedule:schedule,...(history.length?{aiAnalysisHistory:history}:{}),...(snapshot?{previousQuality:snapshot}:{}),...(attempts.length?{aiAnalysisAttempts:attempts}:{}),...(attempts.some(attempt=>attempt&&!attempt.model)?{aiLegacyAttemptsModel:legacyModel}:{}),qualityRefresh:{state:ai?'ready':retryHeld?'failed':'queued',targetVersion:REPORT_QUALITY_VERSION,model:analysisBatch.model,sourceHash:report.sourceHash,jobId,attempts:retryHeld?automaticFailures:0,updatedAt:new Date().toISOString(),...(retryHeld?{retryHeld:true}:{})},...(ai?{ai,aiModel:previous.aiModel,aiPromptVersion:previous.aiPromptVersion,aiGeneratedAt:previous.aiGeneratedAt,...Object.fromEntries(['成果分','问题分','计划分','复盘分'].map((key,index)=>[key,ai.scores[index]]))}:{})};
   if(rescore){
    const sourceGuard=old.source_hash==null?'source_hash IS NULL':`source_hash=${sql(old.source_hash)}`;
    await exec(`UPDATE weekly_reports SET content_json=${sql(JSON.stringify(content))},source_hash=${sql(report.sourceHash)},updated_at=datetime('now') WHERE id=${sql(old.id)} AND ${sourceGuard} AND content_json=${sql(old.content_json)};`);
   }else{
    if(!batch){batch=randomUUID();await exec(`INSERT INTO import_batches(id,source_type,source_name,record_count) VALUES(${sql(batch)},'feishu-report',${sql(report.source?.ruleName||'周报')},0);`);}
    await exec(`BEGIN; INSERT INTO employees(user_id,name,department) VALUES(${sql(report.userId)},${sql(report.name)},${sql(report.department)}) ON CONFLICT(user_id) DO NOTHING; INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,source_batch_id,source_hash,is_late,submitted_at) VALUES(${sql(report.id)},${sql(report.userId)},${sql(report.name)},${sql(report.department)},${sql(report.label)},${sql(report.start)},${sql(report.end)},${sql(schedule.exempt?'免交':schedule.calendarPending?'等待日历':late?'迟交':'准时')},${sql(JSON.stringify(content))},${sql(batch)},${sql(report.sourceHash)},${late?1:0},${sql(report.submittedAt)}) ON CONFLICT(employee_user_id,week_label) DO UPDATE SET employee_name=excluded.employee_name,department=excluded.department,week_start=excluded.week_start,week_end=excluded.week_end,status=excluded.status,content_json=excluded.content_json,source_hash=excluded.source_hash,submitted_at=excluded.submitted_at,is_late=excluded.is_late,updated_at=datetime('now'); COMMIT;`);
    if(!historicalInactive&&!await inactive(report.userId))await observeEmployee(report.userId,report.start);
   }
   if(ai){stat.cached++;cell.cached++;}
   else if(retryHeld)recordRetryHold(cell);
   else work.push({report,content,automaticAttemptsLeft:rescore?Infinity:MAX_ANALYSIS_ATTEMPTS-automaticFailures});
  }
  if(batch)await exec(`UPDATE import_batches SET record_count=${stat.rowCount} WHERE id=${sql(batch)};`);
  stat.aiRequestBudget=work.length*MAX_ANALYSIS_ATTEMPTS;
  updateRemaining();
  if(!stat.rowCount){await emit({...stat,running:false,phase:'done',message:`本次没有需要导入的汇报${skippedMessage()}。`,finishedAt:new Date().toISOString()});return;}
  const notify=()=>{projection=projection.catch(()=>{}).then(async()=>{await project();await refreshDirectory();await onComplete();stat.publicationPending=false;}).catch(()=>{stat.publicationPending=true;stat.publicationFailures=(stat.publicationFailures||0)+1;stat.diagnostics=[...stat.diagnostics,{code:'publication_update_failed',path:'publication',retryable:true}].slice(-50);});return projection;};
  stat.phase='analysis';await notify();await emit({...stat});let index=0;
  async function persist(report,content){
   const target=report.stored?`id=${sql(report.stored.id)}`:`employee_user_id=${sql(report.userId)} AND week_end=${sql(report.end)}`;
   await exec(`UPDATE weekly_reports SET content_json=${sql(JSON.stringify(content))},updated_at=datetime('now') WHERE ${target} AND source_hash=${sql(report.sourceHash)} AND json_extract(content_json,'$.qualityRefresh.jobId')=${sql(jobId)};`);
   const stored=(await query(`SELECT content_json,source_hash FROM weekly_reports WHERE ${target};`))[0];
   return stored?.source_hash===report.sourceHash&&JSON.parse(stored.content_json).qualityRefresh?.jobId===jobId;
  }
  await Promise.all(Array.from({length:Math.min(3,work.length)},async()=>{
   while(index<work.length){
    if(analysisBatch.blockedReason)break;
    const {report,content,automaticAttemptsLeft}=work[index++],cell=monthCell(report);stat.active++;cell.active++;let attemptCount=0,lastDiagnostic=null;
    try{
     const ai=await analyze(report,canProcess,content.scoringWeights,async(attempt,diagnostic)=>{
      attemptCount=attempt;lastDiagnostic=diagnostic||lastDiagnostic;
      content.qualityRefresh={...content.qualityRefresh,state:'analyzing',attempts:attempt,updatedAt:new Date().toISOString(),...(diagnostic?{diagnostic}:{} )};
      if(diagnostic){
       content.aiAnalysisAttempts=[...(content.aiAnalysisAttempts||[]),{at:new Date().toISOString(),targetVersion:REPORT_QUALITY_VERSION,promptVersion:REPORT_QUALITY_PROMPT_VERSION,sourceHash:report.sourceHash,model:analysisBatch.model,attempt,...diagnostic}];
       stat.diagnostics=[...stat.diagnostics,{reportId:report.id,weekEnd:report.end,attempt,...diagnostic}].slice(-50);
      }
      const saved=await persist(report,content);await emit({...stat});return saved;
     },analysisBatch,automaticAttemptsLeft);
     if(ai===ANALYSIS_DEFERRED){
      if(attemptCount){content.qualityRefresh={...content.qualityRefresh,state:'queued',updatedAt:new Date().toISOString()};await persist(report,content);}
     }
     else if(ai===ANALYSIS_RETRY_HELD){
      content.qualityRefresh={...content.qualityRefresh,state:'failed',retryHeld:true,updatedAt:new Date().toISOString()};
      if(await persist(report,content))recordRetryHold(cell);else{stat.skippedSourceChanged++;cell.skipped++;}
     }
     else if(!ai||!await canProcess(report)){if(!await canProcess(report))stat.skippedInactiveAnalysis++;else stat.skippedSourceChanged++;cell.skipped++;}
     else{
      const next={...content,ai,aiModel:analysisBatch.model,aiPromptVersion:REPORT_QUALITY_PROMPT_VERSION,aiGeneratedAt:new Date().toISOString(),qualityRefresh:{...content.qualityRefresh,state:'ready',attempts:attemptCount,diagnostic:null,updatedAt:new Date().toISOString()},...Object.fromEntries(['成果分','问题分','计划分','复盘分'].map((key,position)=>[key,ai.scores[position]]))};
      if(await persist(report,next)){stat.analyzed++;cell.completed++;}else{stat.skippedSourceChanged++;cell.skipped++;}
     }
    }catch(error){
     const diagnostic=lastDiagnostic||analysisDiagnostic(error);
     content.qualityRefresh={...content.qualityRefresh,state:'failed',attempts:attemptCount,diagnostic,updatedAt:new Date().toISOString()};
     await persist(report,content);stat.failed++;cell.failed++;if(stat.errors.length<5)stat.errors.push(diagnostic.code);
    }finally{
     stat.active--;cell.active--;updateRemaining();
     // Fresh publication after each report lets one employee finish without
     // waiting for the rest of the company-wide queue.
     await notify();await emit({...stat});
    }
   }
  }));
  await projection;await notify();
  if(analysisBatch.blockedReason==='ai_scoring_paused')stat.message+='；AI 评分已暂停';
  const partial=Boolean(stat.failed||stat.retryHeld||stat.publicationPending);
  await emit({...stat,ok:!partial&&!analysisBatch.blockedReason,running:false,phase:analysisBatch.blockedReason?'paused':partial?'partial':'done',...(analysisBatch.blockedReason?{blockedReason:analysisBatch.blockedReason}:{}),finishedAt:new Date().toISOString()});
 }
 async function start(options={},beforeStart){
  validateOptions(options);if(running)return false;running=true;
  try{await beforeStart?.();await emit({ok:true,running:true,phase:'queued',mode:options.mode||'sync',...(options.targetMonth?{targetMonth:options.targetMonth}:{}),message:'同步已开始'});}catch(error){running=false;throw error;}
  void run(options).catch(async(error)=>{await emit({ok:false,running:false,phase:'failed',mode:options.mode||'sync',targetMonth:options.targetMonth,message:'任务失败，请检查评分诊断、日期或服务配置后重试',diagnostics:[analysisDiagnostic(error)]});}).finally(()=>{running=false;});
  return true;
 }
 return {start,isRunning:()=>running,run,project};
}
