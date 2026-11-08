import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createLiveReportSync} from '../server/live-report-sync.mjs';
import {makeReportQualityAnalysis} from './report-quality-test-fixtures.mjs';

// Retained, synthetic SQLite fixtures and in-memory providers only. No real
// employee identity, credential, network request, notification or cleanup.
await mkdir('outputs/tests',{recursive:true});
const root=await mkdtemp(path.resolve('outputs/tests/report-rate-limit-'));
const schema=await readFile('db/schema.sql','utf8'),sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
let scenarios=0;
async function fixture(name,{count=1,respond,reserveAiRequest,pauseHook=async()=>{}}={}){
 const directory=path.join(root,name);await mkdir(directory);
 const database=path.join(directory,'test.sqlite');
 const run=(statement,json=false)=>{const result=spawnSync('sqlite3',['-bail','-cmd','.timeout 10000',...(json?['-json']:[]),database],{input:statement,encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();};
 run(schema);
 for(let index=1;index<=count;index++){
  const facts={results:`【虚构${index}】完成接口验收。`,problems:`【虚构${index}】口径待确认，已邀请协作方。`,nextPlan:`【虚构${index}】优先在周五交付验收。`,reflection:`【虚构${index}】先明确口径，下次复用清单。`};
  const content={...facts,source:{provider:'feishu-report'},sourceHash:'source-'+index,ai:{scores:[79,79,79,79],summary:'虚构旧版评分'},aiModel:'legacy-fixture-model',aiPromptVersion:'legacy',aiGeneratedAt:'2026-10-31T00:00:00Z'};
  run(`INSERT INTO employees(user_id,name,is_active) VALUES(${sql('E'+index)},${sql('虚构'+index)},1); INSERT INTO weekly_reports(id,employee_user_id,employee_name,week_label,week_start,week_end,status,content_json,source_hash,submitted_at) VALUES(${sql('R'+index)},${sql('E'+index)},${sql('虚构'+index)},'2026-10-09','2026-10-05','2026-10-09','准时',${sql(JSON.stringify(content))},${sql('source-'+index)},'2026-10-09T10:00:00Z');`);
 }
 await writeFile(path.join(directory,'prototypeData.json'),JSON.stringify({meta:{periods:[]},employee_summary:[],weekly_scores:[]}));
 const events=[],calls=[],statuses=[];let inFlight=0,maxInFlight=0,status;
 const fetcher=async(url,options)=>{
  assert.equal(url,'https://fixture.invalid/v1/chat/completions');
  const request=JSON.parse(options.body),input=JSON.parse(request.messages.find(message=>message.role==='user').content);
  calls.push({request,input});events.push({kind:'request',number:calls.length,input});inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
  try{await new Promise(resolve=>setImmediate(resolve));return await respond({request,input,number:calls.length,calls,run});}finally{inFlight--;}
 };
 const sync=createLiveReportSync({query:async statement=>run(statement,true),exec:async statement=>run(statement),sql,config:{dataDir:directory,moonshotApiKey:'synthetic-fixture-key',moonshotBaseUrl:'https://fixture.invalid/v1',kimiFollowupModel:'synthetic-model'},settings:{policyFor:async()=>({weights:[30,25,25,20],deadlineTime:'20:00'})},refreshDirectory:async()=>{},writeStatus:async value=>{status=structuredClone(value);statuses.push(status);},fetcher,reserveAiRequest,pause:async milliseconds=>{assert(milliseconds>0&&milliseconds<=60000);events.push({kind:'pause',milliseconds});await pauseHook({milliseconds,run,calls});}});
 const execute=()=>sync.run({mode:'rescore',targetMonth:'2026-10'});
 const report=index=>JSON.parse(run(`SELECT content_json FROM weekly_reports WHERE id=${sql('R'+index)};`,true)[0].content_json);
 scenarios++;
 return {execute,run,report,events,calls,statuses,get status(){return status;},get maxInFlight(){return maxInFlight;}};
}
const success=input=>({ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(makeReportQualityAnalysis(input.report))},finish_reason:'stop'}]})});
const failure=(status,type=null,after=null,nonJson=false)=>({ok:false,status,headers:{get:name=>name.toLowerCase()==='retry-after'?after:null},json:async()=>{if(nonJson)throw new SyntaxError('PRIVATE_PROVIDER_BODY_NOT_JSON');return {error:{type,message:'PRIVATE_PROVIDER_TEXT_NEVER_STORE'}};}});
const diagnostics=value=>value.report(1).aiAnalysisAttempts||[];
function pausedBetween(value,leftRequest,rightRequest){
 const start=value.events.findIndex(event=>event.kind==='request'&&event.number===leftRequest),end=value.events.findIndex(event=>event.kind==='request'&&event.number===rightRequest);
 assert(start>=0&&end>start);return value.events.slice(start+1,end).filter(event=>event.kind==='pause').reduce((sum,event)=>sum+event.milliseconds,0);
}

const single=await fixture('single-flight',{count:4,respond:({input})=>success(input)});
await single.execute();assert.equal(single.maxInFlight,1);assert.equal(single.calls.length,4);assert.equal(single.status.analyzed,4);assert.equal(single.status.failed,0);

let availableRequests=1;
const dailyLimit=await fixture('daily-request-limit',{
 count:3,respond:({input})=>success(input),reserveAiRequest:async()=>{
  if(availableRequests===0)return false;
  availableRequests--;
  return true;
 },
});
await dailyLimit.execute();
assert.equal(dailyLimit.calls.length,1);
assert.equal(dailyLimit.status.phase,'paused');
assert.equal(dailyLimit.status.blockedReason,'daily_ai_request_limit');
assert.equal(dailyLimit.status.analyzed,1);
assert.equal(dailyLimit.status.failed,0);
assert.equal(dailyLimit.status.remaining,2);
for(const index of [2,3])assert.equal(dailyLimit.report(index).qualityRefresh.state,'queued');
availableRequests=2;
await dailyLimit.execute();
assert.equal(dailyLimit.status.phase,'done');
assert.equal(dailyLimit.status.cached,1);
assert.equal(dailyLimit.status.analyzed,2);
assert.equal(dailyLimit.calls.length,3);
assert.equal(availableRequests,0);

let reservations=0;
const retryBudget=await fixture('daily-limit-on-retry',{
 respond:()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:'invalid JSON'}}]})}),
 reserveAiRequest:async()=>++reservations===1,
});
await retryBudget.execute();
assert.equal(reservations,2,'a retry needs its own reservation');
assert.equal(retryBudget.calls.length,1);
assert.equal(retryBudget.status.phase,'paused');
assert.equal(retryBudget.status.blockedReason,'daily_ai_request_limit');
assert.equal(retryBudget.status.remaining,1);
assert.equal(retryBudget.status.failed,0);
assert.equal(retryBudget.report(1).qualityRefresh.state,'queued');
assert.equal(retryBudget.report(1).qualityRefresh.attempts,1);

for(const [name,header,minimum] of [['default',null,58000],['seconds','90',88000],['http-date',new Date(Date.now()+120000).toUTCString(),115000],['invalid-header','not-a-retry-date',58000],['negative-header','-1',58000],['fractional-header','1.5',58000]]){
 const sample=await fixture('retry-'+name,{respond:({number,input})=>number===1?failure(429,'rate_limit_reached_error',header):success(input)});
 await sample.execute();assert.equal(sample.calls.length,2);assert.equal(sample.status.analyzed,1);
 assert(pausedBetween(sample,1,2)>=minimum,'Retry-After must be consumed before another request: '+name);
 const diagnostic=diagnostics(sample)[0];assert.equal(diagnostic.code,'upstream_rate_limit');assert.equal(diagnostic.retryable,true);assert(diagnostic.retryAfterMs>=0&&diagnostic.retryAfterMs<=86400000);
}

const exhaustedRetries=await fixture('final-429-shared',{count:2,respond:({input})=>input.report.results.includes('虚构1')?failure(429):success(input)});
await exhaustedRetries.execute();assert.equal(exhaustedRetries.calls.length,5);assert.equal(exhaustedRetries.report(1).qualityRefresh.attempts,4);assert.equal(exhaustedRetries.status.failed,1);assert.equal(exhaustedRetries.status.analyzed,1);
assert(pausedBetween(exhaustedRetries,4,5)>=58000,'fourth 429 must cool down the next report too');
assert.equal(exhaustedRetries.report(1).previousQuality.ai.scores[0],79);assert.equal(exhaustedRetries.report(1).ai,undefined);assert(exhaustedRetries.report(1).aiAnalysisHistory.length>0);

let quota=true;
const depleted=await fixture('quota-pauses-batch',{count:5,respond:({input})=>quota?failure(429,'exceeded_current_quota_error'):success(input)});
await depleted.execute();assert.equal(depleted.calls.length,1);assert.equal(depleted.status.phase,'paused');assert.equal(depleted.status.blockedReason,'upstream_quota_exhausted');assert.equal(depleted.status.failed,1);assert.equal(depleted.status.remaining,4);assert.equal(depleted.status.active,0);assert.equal(depleted.status.skippedSourceChanged,0);
assert.equal(depleted.report(1).qualityRefresh.diagnostic.code,'upstream_quota_exhausted');assert.equal(depleted.report(1).qualityRefresh.diagnostic.retryable,false);
for(let index=2;index<=5;index++){assert.equal(depleted.report(index).qualityRefresh.state,'queued');assert.equal(depleted.report(index).qualityRefresh.attempts,0);}
quota=false;await depleted.execute();assert.equal(depleted.status.phase,'done');assert.equal(depleted.status.analyzed,5);assert.equal(depleted.calls.length,6,'a later explicit run may recover after quota is fixed');

const overloaded=await fixture('overload',{respond:({number,input})=>number===1?failure(503,'engine_overloaded_error','75'):success(input)});
await overloaded.execute();assert.equal(overloaded.calls.length,2);assert(pausedBetween(overloaded,1,2)>=73000);assert.equal(diagnostics(overloaded)[0].code,'upstream_overloaded');assert.equal(diagnostics(overloaded)[0].retryable,true);

for(const [status,code,retry] of [[400,'upstream_bad_request',false],[401,'upstream_auth_failed',false],[403,'upstream_forbidden',false],[429,'upstream_rate_limit',true],[503,'upstream_error',true]]){
 const sample=await fixture('non-json-'+status,{respond:({number,input})=>number===1?failure(status,null,null,true):success(input)});
 await sample.execute();assert.equal(sample.calls.length,retry?2:1);assert.equal(diagnostics(sample)[0].code,code);assert.equal(diagnostics(sample)[0].retryable,retry);assert.notEqual(diagnostics(sample)[0].code,'invalid_json');
 assert(!JSON.stringify(diagnostics(sample)).includes('PRIVATE_'));
}

const unknown=await fixture('unknown-private-type',{respond:({number,input})=>number===1?failure(429,'PRIVATE_UNKNOWN_PROVIDER_TYPE'):success(input)});
await unknown.execute();assert.equal(diagnostics(unknown)[0].code,'upstream_rate_limit');assert(!JSON.stringify(unknown.report(1).aiAnalysisAttempts).includes('PRIVATE_'));

const tooLong=await fixture('oversized-retry-after',{count:3,respond:()=>failure(429,'rate_limit_reached_error','90000')});
await tooLong.execute();assert.equal(tooLong.calls.length,1);assert.equal(tooLong.status.phase,'paused');assert.equal(tooLong.status.blockedReason,'upstream_retry_after_too_long');assert.equal(tooLong.status.remaining,2);assert.equal(tooLong.report(1).qualityRefresh.diagnostic.retryAfterMs,86400000);assert.equal(tooLong.report(1).qualityRefresh.diagnostic.retryAfterExceeded,true);
await tooLong.execute();assert.equal(tooLong.calls.length,1,'new run cannot bypass the longer server cooldown');assert.equal(tooLong.status.phase,'paused');assert.equal(tooLong.status.remaining,3);assert.equal(tooLong.status.failed,0);

const overflowing=await fixture('overflowing-retry-after',{count:2,respond:()=>failure(429,'rate_limit_reached_error','9'.repeat(400))});
await overflowing.execute();assert.equal(overflowing.calls.length,1);assert.equal(overflowing.status.phase,'paused');assert.equal(overflowing.status.blockedReason,'upstream_retry_after_too_long');assert.equal(overflowing.status.remaining,1);
assert.equal(overflowing.report(1).qualityRefresh.diagnostic.retryAfterMs,86400000);assert.equal(overflowing.report(1).qualityRefresh.diagnostic.retryAfterExceeded,true);assert.equal(overflowing.report(2).qualityRefresh.state,'queued');
await overflowing.execute();assert.equal(overflowing.calls.length,1,'overflowing delay must never become the default 60s retry');assert.equal(overflowing.status.remaining,2);

for(const kind of ['source','active','job']){
 let changed=false;
 const guarded=await fixture('guard-after-cooldown-'+kind,{respond:()=>failure(429),pauseHook:({milliseconds,run})=>{
  if(!changed&&milliseconds>=58000){changed=true;run(kind==='source'?"UPDATE weekly_reports SET source_hash='newer-source' WHERE id='R1';":kind==='active'?"UPDATE employees SET is_active=0 WHERE user_id='E1';":"UPDATE weekly_reports SET content_json=json_set(content_json,'$.qualityRefresh.jobId','newer-job') WHERE id='R1';");}
 }});
 await guarded.execute();assert(changed);assert.equal(guarded.calls.length,1,'queued/cooling request must recheck '+kind);assert.equal(guarded.status.analyzed,0);assert.equal(guarded.status.failed,0);assert.equal(guarded.status[kind==='active'?'skippedInactiveAnalysis':'skippedSourceChanged'],1);
 assert.equal(guarded.report(1).ai,undefined);
}

const corrective=await fixture('strict-evidence-retry',{respond:({number,input,request})=>{
 const result=makeReportQualityAnalysis(input.report);
 if(number===1)result.modules[0].criteria[0].evidence=[{quote:'PRIVATE_FORGED_QUOTE',type:'reported_fact'}];
 else{const feedback=JSON.parse(request.messages.at(-1).content).validationFeedback;assert.equal(feedback.code,'evidence_not_in_source');assert(!JSON.stringify(feedback).includes('PRIVATE_'));}
 return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]})};
}});
await corrective.execute();assert.equal(corrective.calls.length,2);assert.equal(corrective.status.analyzed,1);assert.equal(corrective.report(1).qualityRefresh.state,'ready');assert(!JSON.stringify(corrective.report(1).aiAnalysisAttempts).includes('PRIVATE_'));

const result={ok:true,scenarios,singleFlight:true,dailyLimitPausesAndResumes:true,retriesRequireReservation:true,retryAfterSecondsAndDate:true,defaultAndFinal429Cooldown:true,quotaPausesUnrequestedReports:true,quotaRecovery:true,overloadRetry:true,nonJsonHttpDiagnostics:true,oversizedWaitPauses:true,sourceJobAndActiveRechecked:true,strictEvidenceRetry:true,externalRequests:0,notifications:0};
await writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));console.log('Synthetic artifacts retained:',root);
