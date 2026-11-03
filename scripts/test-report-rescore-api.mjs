import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import path from 'node:path';
import {validateAnalysis} from '../server/live-report-sync.mjs';
import {REPORT_QUALITY_VERSION,REPORT_QUALITY_PROMPT_VERSION} from '../server/report-quality-scoring.mjs';
import {makeReportQualityAnalysis} from './report-quality-test-fixtures.mjs';

// Exercise the real local HTTP server. All persisted records and model outputs
// are synthetic; the provider import blocks every unrecognized outbound call.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/report-rescore-api-')),data=dir+'/data',db=dir+'/test.sqlite';await mkdir(data);
const quote=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{const result=spawnSync('sqlite3',['-bail','-cmd','.timeout 10000',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();};
run(await readFile('db/schema.sql','utf8'));
run(`INSERT INTO employees(user_id,name,department,is_active) VALUES('boss','虚构测试老板','管理',1),('admin','虚构测试管理员','管理',1),('a','虚构测试员工甲','测试团队',1),('b','虚构测试员工乙','测试团队',1),('inactive','虚构停用员工','测试团队',0); INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) SELECT 'hire-'||user_id,user_id,'2026-01-01','manager' FROM employees; INSERT INTO app_settings(key,value_json) VALUES('report_automation_config','{"enabled":false,"intervalMinutes":15}');`);
const factsFor=marker=>({results:marker+'：完成3项虚构验收并保存记录。',problems:'测试接口待确认，影响验收；已约双方核查，需要产品支持。',nextPlan:'优先于周五完成3项接口验证，交付验收记录。',reflection:'先确认验收口径可以减少返工，后续复用检查清单。'});
const legacy=facts=>({...facts,ai:{scores:[80,80,80,80],summary:'虚构历史点评'},aiModel:'older-model',aiPromptVersion:'legacy',aiGeneratedAt:'2026-10-01T00:00:00Z','成果分':80,'问题分':80,'计划分':80,'复盘分':80});
const current=(facts,prompt)=>{const ai=validateAnalysis(makeReportQualityAnalysis(facts),facts);ai.promptVersion=prompt;return {...facts,ai,aiModel:'fixture-quality-model',aiPromptVersion:prompt,aiGeneratedAt:'2026-10-20T00:00:00Z',...Object.fromEntries(['成果分','问题分','计划分','复盘分'].map((key,index)=>[key,ai.scores[index]]))};};
function store(id,user,end,content,status='准时',time=end+'T11:00:00Z'){
 const sourceHash='fixture-source-'+id,start=new Date(Date.parse(end+'T00:00:00Z')-4*86400000).toISOString().slice(0,10);
 const full={...content,sourceHash,'周期ID':'period-'+end,source:{provider:'feishu-report',taskId:id},scoringWeights:[30,25,25,20]};
 run(`INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,source_hash,submitted_at) VALUES(${quote(id)},${quote(user)},'虚构样本','测试团队',${quote(end)},${quote(start)},${quote(end)},${quote(status)},${quote(JSON.stringify(full))},${quote(sourceHash)},${quote(time)});`);
}
store('stale-october','a','2026-10-09',legacy(factsFor('retry-first')));
store('cached-v2','a','2026-10-16',current(factsFor('cached-v2'),REPORT_QUALITY_PROMPT_VERSION));
store('cached-v1','b','2026-10-09',current(factsFor('cached-v1'),REPORT_QUALITY_VERSION));
store('outside-september','a','2026-09-25',legacy(factsFor('outside-month')));
store('inactive-october','inactive','2026-10-23',legacy(factsFor('inactive')));
store('not-submitted','a','2026-10-23',{results:'',problems:'',nextPlan:'',reflection:''},'未交',null);
store('empty-placeholder','b','2026-10-23',{results:'',problems:'',nextPlan:'',reflection:''},'待提交',null);
const record=id=>run('SELECT * FROM weekly_reports WHERE id='+quote(id)+';',true)[0];
const untouchedIds=['outside-september','inactive-october','not-submitted','empty-placeholder','cached-v1','cached-v2'];
const retained=Object.fromEntries(untouchedIds.map(id=>[id,record(id)]));
const humanTables=['scoring360_responses','monthly_manager_scores','department_leader_scores','department_person_scores','performance_results'];
const humanBefore=JSON.stringify(humanTables.map(table=>[table,run('SELECT * FROM '+table+' ORDER BY rowid;',true)]));
for(const name of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights'])await writeFile(data+'/'+name+'.json',JSON.stringify(name==='prototypeData'?{meta:{collectionStartDate:'2026-09-01',periods:[]},employee_summary:[],weekly_scores:[]}:name==='scoring360'?{cycles:[],assignments:[],responses:[]}:{}));
const callsFile=dir+'/upstream-calls.log',releaseGate=dir+'/release-ai.flag';
await writeFile(dir+'/provider.mjs',`
import {appendFile,access} from 'node:fs/promises';
import {makeReportQualityAnalysis} from ${JSON.stringify(new URL('./report-quality-test-fixtures.mjs',import.meta.url).href)};
const RealDate=Date,stamp=Date.parse('2026-11-02T08:00:00Z');globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return stamp;}};
let requests=0;
globalThis.fetch=async(url,options={})=>{
 const target=String(url);
 if(target!=='https://fixture-ai.invalid/v1/chat/completions'){await appendFile(${JSON.stringify(callsFile)},JSON.stringify({kind:'unexpected',url:target})+'\\n');throw Error('fixture_external_request_blocked');}
 requests++;const body=JSON.parse(options.body),input=JSON.parse(body.messages.find(message=>message.role==='user').content),feedbackMessage=body.messages.find(message=>message.role==='user'&&message.content.includes('validationFeedback'));
 const feedback=feedbackMessage?JSON.parse(feedbackMessage.content).validationFeedback:null;
 await appendFile(${JSON.stringify(callsFile)},JSON.stringify({kind:'ai',week:input.week,marker:input.report.results.split('：')[0],feedback})+'\\n');
 if(requests===1){let released=false;for(let attempt=0;attempt<500;attempt++){try{await access(${JSON.stringify(releaseGate)});released=true;break;}catch{}await new Promise(resolve=>setTimeout(resolve,20));}if(!released)throw Error('fixture_gate_not_released');}
 const analysis=makeReportQualityAnalysis(input.report,{summary:'虚构修正后的评分理由'});
 if(requests===1)analysis.modules[0].criteria[0].evidence=[{quote:'PRIVATE_UNTRUSTED_MODEL_QUOTE',type:'reported_fact'}];
 return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysis)}}]})};
};
`);
const portProbe=createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
const base='http://127.0.0.1:'+port,secret='isolated-report-rescore-api';let server,logs='';
const env={...process.env,AUTH_MODE:'feishu',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',BACKUP_DIR:dir+'/backups',LARK_REPORT_SYNC_STATUS_PATH:dir+'/sync.json',STATIC_DIR:dir+'/static',BOSS_VIEW_USER_IDS:'boss',BOSS_VIEW_NAMES:'',SCORING360_CONFIG_MANAGER_USER_IDS:'admin',SCORING360_CONFIG_MANAGER_NAMES:'',DEV_VIEW_SWITCH_ENABLED:'false',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',SCORING360_LAUNCH_MODE:'manual',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_TASK_CREATE_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MOONSHOT_API_KEY:'fixture-provider-key',KIMI_API_KEY:'',MOONSHOT_BASE_URL:'https://fixture-ai.invalid/v1',KIMI_FOLLOWUP_MODEL:'fixture-quality-model'};
const cookie=id=>{const payload=Buffer.from(JSON.stringify({user:{userId:id,name:id==='boss'?'虚构测试老板':'虚构测试成员'},sessionId:randomUUID(),issuedAt:Date.parse('2026-11-02T08:00:00Z'),expiresAt:'2026-11-02T09:00:00Z'})).toString('base64url');return 'wos_session='+payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');};
async function call(method,body,id='boss',route='/api/lark-report-sync'){const response=await fetch(base+route,{method,headers:{...(id?{cookie:cookie(id)}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
const providerCalls=async()=>{const value=await readFile(callsFile,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});return value.trim()?value.trim().split('\n').map(line=>JSON.parse(line)):[];};
async function until(check,message,limit=300){for(let attempt=0;attempt<limit;attempt++){if(server.exitCode!==null)throw Error(logs);const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw Error(message+'\n'+logs);}
try{
 server=spawn(process.execPath,['--import',dir+'/provider.mjs','server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',bytes=>logs+=bytes);server.stderr.on('data',bytes=>logs+=bytes);
 await until(async()=>{try{return (await fetch(base+'/health')).ok;}catch{return false;}},'server_start_failed');
 assert.equal((await call('GET',undefined,null)).status,401);
 assert.equal((await call('GET',undefined,'a')).status,403);assert.equal((await call('POST',{mode:'rescore',targetMonth:'2026-10'},'a')).status,403);
 assert.equal((await call('GET',undefined,'admin')).status,200,'configured administrator retains the existing shared management access');assert.equal((await call('POST',{mode:'rescore',targetMonth:'2026-13'},'admin')).status,400);
 for(const targetMonth of [undefined,null,'2026-00','2026-13','2026-1','2026-10-01','2099-01']){const invalid=await call('POST',{mode:'rescore',targetMonth});assert.equal(invalid.status,400);assert.equal(invalid.body.error,'invalid_rescore_month');}
 assert.equal((await call('POST',{mode:'unexpected',targetMonth:'2026-10'})).status,400);
 assert.equal((await providerCalls()).length,0,'authorization and validation never start a model or Feishu request');
 const start=await call('POST',{mode:'rescore',targetMonth:'2026-10'});assert.equal(start.status,202);
 const busy=await call('POST',{mode:'rescore',targetMonth:'2026-10'});assert.equal(busy.status,409);assert.equal(busy.body.alreadyRunning,true);
 const active=await until(async()=>{const response=await call('GET');assert.equal(response.status,200);const state=response.body.status;return state?.rowCount===3&&state.active===1?response.body:null;},'targeted_progress_missing');
 assert.equal(active.processRunning,true);assert.equal(active.status.targetMonth,'2026-10');assert.equal(active.status.mode,'rescore');assert.equal(active.status.cached,2);assert.equal(active.status.remaining,1);assert.deepEqual(active.status.byMonth['2026-10'],{total:3,completed:0,failed:0,cached:2,remaining:1,active:1,skipped:0});
 const inFlight=JSON.parse(record('stale-october').content_json);assert.equal(inFlight.previousQuality.ai.scores[0],80,'the old successful score remains available while scoring is in flight');
 await writeFile(releaseGate,'release synthetic response');
 const diagnostic=await until(async()=>{const state=(await call('GET')).body.status;return state?.diagnostics?.some(item=>item.code==='evidence_not_in_source')?state:null;},'corrective_diagnostic_missing');
 const quoteDiagnostic=diagnostic.diagnostics.find(item=>item.code==='evidence_not_in_source');assert.equal(quoteDiagnostic.moduleId,'results');assert.equal(quoteDiagnostic.criterionId,'result');assert(quoteDiagnostic.path.endsWith('.quote'));assert(!JSON.stringify(diagnostic.diagnostics).includes('PRIVATE_UNTRUSTED_MODEL_QUOTE'),'status exposes only safe diagnostics, never raw provider reply');
 const finished=await until(async()=>{const response=(await call('GET')).body;return !response.processRunning&&response.status?.finishedAt?response.status:null;},'rescore_did_not_complete');
 assert.equal(finished.phase,'done');assert(!finished.publicationPending,'valid legacy records in other months must not break targeted publication');assert.equal(finished.rowCount,3);assert.equal(finished.analyzed,1);assert.equal(finished.cached,2);assert.equal(finished.failed,0);assert.equal(finished.remaining,0);assert.equal(finished.active,0);
 const refreshed=JSON.parse(record('stale-october').content_json);assert.equal(refreshed.ai.version,REPORT_QUALITY_VERSION);assert.equal(refreshed.aiPromptVersion,REPORT_QUALITY_PROMPT_VERSION);assert.equal(refreshed.qualityRefresh.state,'ready');assert.equal(refreshed.qualityRefresh.attempts,2);assert(refreshed.aiAnalysisHistory.some(entry=>entry.ai.scores[0]===80));
 for(const id of untouchedIds)assert.deepEqual(record(id),retained[id],'outside scope, unsubmitted, inactive and valid cached rows remain byte-for-byte intact: '+id);
 const calls=await providerCalls();assert.equal(calls.length,2);assert(calls.every(row=>row.kind==='ai'&&row.week==='2026-10-09'&&row.marker==='retry-first'));assert.equal(calls[1].feedback.code,'evidence_not_in_source');assert(calls[1].feedback.path.endsWith('.quote'));
 const beforeRepeat=record('stale-october');assert.equal((await call('POST',{mode:'rescore',targetMonth:'2026-10'})).status,202);
 const repeated=await until(async()=>{const response=(await call('GET')).body;return !response.processRunning&&response.status?.finishedAt?response.status:null;},'repeat_did_not_complete');
 assert.equal(repeated.cached,3);assert.equal(repeated.analyzed,0);assert.equal(repeated.remaining,0);assert.equal((await providerCalls()).length,2,'a second run resumes from cache without repeating successful model calls');assert.deepEqual(record('stale-october'),beforeRepeat);
 assert.equal(JSON.stringify(humanTables.map(table=>[table,run('SELECT * FROM '+table+' ORDER BY rowid;',true)])),humanBefore,'rescore API does not submit human ratings or legacy results');
 for(const table of ['weekly_reminder_sends','scoring360_reminder_sends','monthly_score_reminder_deliveries'])assert.equal(run('SELECT count(*) AS n FROM '+table+';',true)[0].n,0);
 assert.equal(run('SELECT count(*) AS n FROM import_batches;',true)[0].n,0,'stored-only rescore creates no Feishu import batch');assert.equal(run('PRAGMA integrity_check;'),'ok');
 const result={ok:true,actualLocalServer:true,managementBoundaryPreserved:true,ordinaryMemberDenied:true,invalidMonthRejected:true,busy409:true,storedMonthScope:true,onlyActiveSubmitted:true,version1And2CacheAccepted:true,preciseProgress:true,safeDiagnostic:true,correctionFeedback:true,oldScorePreserved:true,successfulCacheResume:true,humanScoresUntouched:true,feishuQueries:0,realProviderRequests:0,syntheticProviderCalls:calls.length,messagesSent:0,artifacts:dir};await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(logs);throw error;}finally{if(server?.exitCode===null){server.kill('SIGTERM');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));}await writeFile(dir+'/server.log',logs);console.log('Test artifacts retained:',dir);}
