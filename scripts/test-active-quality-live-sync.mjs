import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createLiveReportSync,normalizeLiveReport} from '../server/live-report-sync.mjs';
import {ACTIVE_REPORT_QUALITY_VERSION,ACTIVE_REPORT_QUALITY_PROMPT_VERSION,ACTIVE_REPORT_QUALITY_REVIEW_PROMPT_VERSION} from '../server/report-quality-active.mjs';
import {makeActiveReportQualityAnalysis} from './report-quality-active-test-fixtures.mjs';

// All identities, credentials, upstream responses and SQLite rows are synthetic.
// Every fetch is intercepted, and each fixture directory is retained.
await mkdir('outputs/tests',{recursive:true});
const root=await mkdtemp(path.resolve('outputs/tests/active-quality-live-'));
const schema=await readFile('db/schema.sql','utf8');
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const facts={results:'虚构订单确认样品已付款，交付表同一订单同时记为已发货和未发货。',problems:'虚构订单发货状态矛盾，已安排仓库核对。',nextPlan:'优先核对订单状态，再更新交付表。',reflection:'重复登记造成状态不一致，下次只维护一份交付表。'};
const item={task_id:'synthetic-report',from_user_id:'synthetic-employee',from_user_name:'虚构员工',department_name:'虚构部门',rule_id:'fixture-rule',rule_name:'虚构周报',commit_time:Date.parse('2026-10-16T19:00:00+08:00')/1000,
 form_contents:Object.entries(facts).map(([key,value])=>({field_name:{results:'本周成果',problems:'问题与挑战',nextPlan:'下周计划',reflection:'思考与复盘'}[key],field_value:value}))};
const normalized=normalizeLiveReport(item),syncOptions={start:'2026-10-01',end:'2026-10-23'};
const response=analysis=>({ok:true,status:200,json:async()=>({usage:{prompt_tokens:20,completion_tokens:30},choices:[{message:{content:JSON.stringify(analysis)},finish_reason:'stop'}]})});
let scenarios=0;
async function fixture(name,{respond,reserve,afterModel=()=>{},savedContent,sourceHash=normalized.sourceHash}={}){
 const directory=path.join(root,name);await mkdir(directory);const database=path.join(directory,'fixture.sqlite');
 const run=(statement,json=false)=>{const result=spawnSync('sqlite3',['-bail','-cmd','.timeout 10000',...(json?['-json']:[]),database],{input:statement,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();};
 run(schema);
 run("INSERT INTO employees(user_id,name,department,is_active) VALUES('synthetic-employee','虚构员工','虚构部门',1);");
 if(savedContent)run(`INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,source_hash,submitted_at) VALUES(${sql(normalized.id)},${sql(normalized.userId)},'虚构员工','虚构部门',${sql(normalized.label)},${sql(normalized.start)},${sql(normalized.end)},'准时',${sql(JSON.stringify(savedContent))},${sql(sourceHash)},${sql(normalized.submittedAt)});`);
 const calls=[],measurements=[],statuses=[];let reservations=0,status;
 const content=()=>{const row=run(`SELECT content_json FROM weekly_reports WHERE id=${sql(normalized.id)};`,true)[0];return row?JSON.parse(row.content_json):null;};
 const config={dataDir:directory,feishuAppId:'synthetic-app',feishuAppSecret:'synthetic-secret',moonshotApiKey:'synthetic-key',moonshotBaseUrl:'https://fixture.invalid/v1',kimiFollowupModel:'same-synthetic-model'};
 const fetcher=async(url,options)=>{
  if(url==='https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal')return {ok:true,status:200,json:async()=>({code:0,tenant_access_token:'synthetic-token'})};
  if(url==='https://open.feishu.cn/open-apis/report/v1/tasks/query?user_id_type=user_id')return {ok:true,status:200,json:async()=>({code:0,data:{items:[item],has_more:false}})};
  assert.equal(url,'https://fixture.invalid/v1/chat/completions','no external fetch can escape this fixture');
  assert(options.signal instanceof AbortSignal,'both model stages retain timeout cancellation');
  const request=JSON.parse(options.body),payload=JSON.parse(request.messages.find(message=>message.role==='user').content),stage=payload.candidate?'review':'initial';
  assert.equal(request.model,'same-synthetic-model');assert(request.messages[0].content.includes(ACTIVE_REPORT_QUALITY_VERSION));
  assert.equal(content().ai,undefined,'no grade is stored before both stages pass');
  calls.push({stage,request,payload});
  const result=respond?await respond({stage,request,payload,number:calls.length,run,content,config}):response(makeActiveReportQualityAnalysis(payload.report));
  afterModel({stage,number:calls.length,run,config});return result;
 };
 const sync=createLiveReportSync({query:async statement=>run(statement,true),exec:async statement=>run(statement),sql,config,settings:{overview:async()=>({report:{templateName:item.rule_name,ruleId:item.rule_id}}),policyFor:async()=>({deadlineTime:'20:00',weights:[25,25,25,25]})},refreshDirectory:async()=>{},writeStatus:async value=>{status=structuredClone(value);statuses.push(status);},fetcher,pause:async()=>{},
  reserveAiRequest:async()=>{reservations++;return reserve?reserve(reservations):true;},
  measureAiRequest:async(model,operation)=>{const entry={model,usage:null};measurements.push(entry);return operation((ok,usage)=>{entry.ok=ok;entry.usage=usage;});},
 });
 scenarios++;return {directory,run,sync,config,calls,measurements,statuses,content,get status(){return status;},get reservations(){return reservations;}};
}

const rich=await fixture('two-stage-compatible-output',{respond:({payload,stage})=>{
 const candidate=makeActiveReportQualityAnalysis(payload.report,{summary:'虚构成长点评',questions:['哪条交付状态准确？'],riskSignals:[{kind:'contradiction',reason:'同一订单同时被标为已发货和未发货。',references:[{moduleId:'results',ref:'results-1'}]}],tasks:[{title:'核对交付表',description:'按原文明示动作核对状态',evidenceRef:'problems-1',priority:'P1',firstStep:'与仓库核对'}]});
 if(stage==='review'){assert.equal(payload.candidate.version,ACTIVE_REPORT_QUALITY_VERSION);assert.equal(payload.candidate.tasks.length,1);assert.deepEqual(payload.facts,facts);}
 return response(candidate);
}});
await rich.sync.run(syncOptions);
assert.deepEqual(rich.calls.map(call=>call.stage),['initial','review']);assert.equal(rich.reservations,2);assert.equal(rich.measurements.length,2);assert(rich.measurements.every(entry=>entry.ok&&entry.usage.completion_tokens===30));
assert.equal(rich.status.aiRequestBudget,4);assert.equal(rich.status.aiRequests,2);assert.equal(rich.status.analyzed,1);
assert.equal(rich.content().ai.version,ACTIVE_REPORT_QUALITY_VERSION);assert.equal(rich.content().aiPromptVersion,ACTIVE_REPORT_QUALITY_PROMPT_VERSION);assert.equal(rich.content().aiReviewPromptVersion,ACTIVE_REPORT_QUALITY_REVIEW_PROMPT_VERSION);
assert.equal(rich.content().ai.tasks[0].evidence,facts.problems);assert.deepEqual(rich.content().ai.questions,['哪条交付状态准确？']);assert.equal(rich.content().ai.riskSignals.length,1);assert.equal(rich.content().ai.anomalies.length,1);
assert.equal(rich.content().ai.previewOnly,undefined);assert.equal(rich.content().ai.humanConfirmationRequired,undefined);

for(const badStage of ['initial','review']){
 const corrected=await fixture('retry-'+badStage,{respond:({payload,stage,number})=>{
  const analysis=makeActiveReportQualityAnalysis(payload.report);
  if(stage===badStage&&number===(badStage==='initial'?1:2))analysis.modules[0].criteria[0].evidence=[{quote:'虚构的错误引用不在原文',type:'reported_fact'}];
  return response(analysis);
 }});
 await corrected.sync.run(syncOptions);assert.equal(corrected.status.analyzed,1);assert.equal(corrected.calls.length,3);assert.equal(corrected.reservations,3);assert.equal(corrected.measurements.length,3);
 assert.deepEqual(corrected.calls.map(call=>call.stage),badStage==='initial'?['initial','initial','review']:['initial','review','review']);
 assert.equal(corrected.content().aiAnalysisAttempts[0].stage,badStage);assert(corrected.calls.findLast(call=>call.stage===badStage).request.messages.some(message=>message.content.includes('validationFeedback')));
}

const rejected=await fixture('review-never-publishes-invalid',{respond:({payload,stage})=>{
 const analysis=makeActiveReportQualityAnalysis(payload.report);
 if(stage==='review')analysis.modules[1].criteria[0].evidence=[];
 return response(analysis);
}});
await rejected.sync.run(syncOptions);assert.equal(rejected.calls.length,3);assert.equal(rejected.status.retryHeld,1);assert.equal(rejected.status.analyzed,0);assert.equal(rejected.content().ai,undefined);assert.equal(rejected.content().qualityRefresh.retryHeld,true);
assert(rejected.content().aiAnalysisAttempts.every(attempt=>attempt.stage==='review'));
const rejectedProjection=JSON.parse(await readFile(path.join(rejected.directory,'prototypeData.json')));assert.equal(rejectedProjection.weekly_scores[0]['总分'],null);
await rejected.sync.run(syncOptions);assert.equal(rejected.calls.length,3,'automatic reruns cannot evade the cumulative failure bound');

let budgetAvailable=false;
const paused=await fixture('review-reservation-required',{reserve:number=>number===1||budgetAvailable});
await paused.sync.run(syncOptions);assert.equal(paused.calls.length,1);assert.equal(paused.reservations,2);assert.equal(paused.measurements.length,1);assert.equal(paused.status.blockedReason,'ai_request_budget_unavailable');assert.equal(paused.content().ai,undefined);assert.equal(paused.content().qualityRefresh.state,'queued');
budgetAvailable=true;await paused.sync.run(syncOptions);assert.equal(paused.status.analyzed,1);assert.equal(paused.calls.length,3);assert.equal(paused.content().ai.version,ACTIVE_REPORT_QUALITY_VERSION);

for(const kind of ['inactive','source','job','model']){
 const guarded=await fixture('between-stages-'+kind,{afterModel:({stage,run,config})=>{
  if(stage!=='initial')return;
  if(kind==='inactive')run("UPDATE employees SET is_active=0 WHERE user_id='synthetic-employee';");
  if(kind==='source')run("UPDATE weekly_reports SET source_hash='newer-source' WHERE employee_user_id='synthetic-employee';");
  if(kind==='job')run("UPDATE weekly_reports SET content_json=json_set(content_json,'$.qualityRefresh.jobId','newer-job') WHERE employee_user_id='synthetic-employee';");
  if(kind==='model')config.kimiFollowupModel='changed-model';
 }});
 await guarded.sync.run(syncOptions);assert.equal(guarded.calls.length,1,'review is stopped when '+kind+' changes');assert.equal(guarded.content().ai,undefined);assert.equal(guarded.status.analyzed,0);
 if(kind==='model')assert.equal(guarded.status.blockedReason,'ai_model_changed');
 else assert.equal(guarded.status[kind==='inactive'?'skippedInactiveAnalysis':'skippedSourceChanged'],1);
}

const historical={...facts,source:normalized.source,sourceHash:normalized.sourceHash,scoringWeights:[25,25,25,25],ai:{scores:[10,20,30,40],summary:'虚构旧版点评'},aiModel:'old-model',aiPromptVersion:'old-prompt',aiGeneratedAt:'2026-01-01T00:00:00Z'};
const preserved=await fixture('old-score-stays-byte-identical',{savedContent:historical});
const original=preserved.run(`SELECT content_json FROM weekly_reports WHERE id=${sql(normalized.id)};`,true)[0].content_json;
await preserved.sync.run(syncOptions);assert.equal(preserved.calls.length,0);assert.equal(preserved.status.cached,1);assert.equal(preserved.run(`SELECT content_json FROM weekly_reports WHERE id=${sql(normalized.id)};`,true)[0].content_json,original);
const oldProjection=JSON.parse(await readFile(path.join(preserved.directory,'prototypeData.json')));assert.equal(oldProjection.weekly_scores[0]['总分'],25,'historical saved weights retain their original total');
await preserved.sync.run({mode:'rescore',targetMonth:'2026-10',targetReportId:normalized.id});assert.equal(preserved.calls.length,2);assert.equal(preserved.content().ai.version,ACTIVE_REPORT_QUALITY_VERSION);assert.deepEqual(preserved.content().previousQuality.ai,historical.ai);assert.deepEqual(preserved.content().previousQuality.scoringWeights,[25,25,25,25]);assert.deepEqual(preserved.content().aiAnalysisHistory[0].ai,historical.ai);

const unhashed={...facts,source:normalized.source,scoringWeights:[25,25,25,25],ai:historical.ai,aiModel:'old-model',aiPromptVersion:'old-prompt'};
const retainedUnhashed=await fixture('unhashed-scored-source-retained',{savedContent:unhashed,sourceHash:null});
const unhashedBefore=retainedUnhashed.run(`SELECT content_json,source_hash FROM weekly_reports WHERE id=${sql(normalized.id)};`,true)[0];
await retainedUnhashed.sync.run(syncOptions);assert.equal(retainedUnhashed.calls.length,0);assert.equal(retainedUnhashed.status.cached,1);assert.deepEqual(retainedUnhashed.run(`SELECT content_json,source_hash FROM weekly_reports WHERE id=${sql(normalized.id)};`,true)[0],unhashedBefore);

console.log(JSON.stringify({ok:true,scenarios,retainedArtifacts:root,realUpstreamRequests:0,productionWrites:0}));
