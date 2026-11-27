import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,createHmac} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,symlink} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {ACTIVE_REPORT_QUALITY_VERSION,ACTIVE_REPORT_QUALITY_PROMPT_VERSION,validateActiveReportQualityAnalysis} from '../server/report-quality-active.mjs';
import {makeActiveReportQualityAnalysis} from './report-quality-active-test-fixtures.mjs';

// A real isolated HTTP service and its real publication path supply the saved
// dependency snapshot. No hand-built automatic result can hide a JS/SQL mismatch.
await mkdir('outputs/tests',{recursive:true});
const artifacts=await mkdtemp(path.resolve('outputs/tests/automatic-score-api-freshness-'));
const data=path.join(artifacts,'data'),db=path.join(artifacts,'test.sqlite');
await mkdir(data);
const binary=process.env.SQLITE3_BIN?path.resolve(process.env.SQLITE3_BIN):'sqlite3';
let childPath=process.env.PATH;
if(process.env.SQLITE3_BIN){
 const bin=path.join(artifacts,'bin');await mkdir(bin);await symlink(binary,path.join(bin,'sqlite3'));
 childPath=bin+path.delimiter+childPath;
}
const quote=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
function sql(statement,json=false){
 const result=spawnSync(binary,['-bail','-cmd','.timeout 5000',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:32*1024*1024});
 assert.equal(result.status,0,result.stderr);
 return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();
}
function fingerprint(){
 const tables=sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",true);
 const contents=tables.map(({name})=>[name,sql(`SELECT * FROM "${name.replaceAll('"','""')}";`,true).map(row=>JSON.stringify(row)).sort()]);
 return createHash('sha256').update(JSON.stringify(contents)).digest('hex');
}
const month='2026-10',userId='freshness-staff',name='合成质量员工',department='合成测试部门';
const privateMarker='PRIVATE_SYNTHETIC_REPORT_EVIDENCE',token='synthetic-score-freshness-token-never-production-32',secret='synthetic-score-freshness-session';
const fixtureNow=Date.parse('2026-11-13T09:00:00Z');
const facts={results:privateMarker+'：已完成三项验收并留存记录。',problems:privateMarker+'：接口范围待统一，已同步依赖。',nextPlan:privateMarker+'：周五前验证验收清单。',reflection:privateMarker+'：先对齐范围可减少返工。'};
const legacyScore=value=>Object.fromEntries(['成果分','问题分','计划分','复盘分'].map(key=>[key,value]));
function analyzed(value){
 const ai=validateActiveReportQualityAnalysis(makeActiveReportQualityAnalysis(facts,{scores:[value,value,value,value]}),facts);
 return {...facts,...legacyScore(value),'总分':null,source:{provider:'feishu-report',taskId:'synthetic-only'},sourceHash:'synthetic-source-a',ai,aiModel:'synthetic-model',aiPromptVersion:ACTIVE_REPORT_QUALITY_PROMPT_VERSION,aiGeneratedAt:'2026-10-23T10:00:00Z'};
}
sql(await readFile('db/schema.sql','utf8'));
sql(`INSERT INTO employees(user_id,name,department,manager_user_id,is_active) VALUES
 ('freshness-admin','合成管理员','管理','',1),(${quote(userId)},${quote(name)},${quote(department)},'freshness-admin',1);
 INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES('staff-hire',${quote(userId)},'2026-10-01','manager');
 INSERT INTO app_settings(key,value_json) VALUES
 ('report_automation_config','{"enabled":false,"scoringStartMonth":"2026-10"}'),
 ('operations_config','{"backupEnabled":false,"alertsEnabled":false,"backupTime":"03:00","recipientUserIds":[],"diskWarningPercent":85}'),
 ('scoring360_recurring_config','{"enabled":false}');`);
function insert(id,end,content,sourceHash){
 const start=new Date(Date.parse(end+'T00:00:00Z')-4*86400000).toISOString().slice(0,10);
 sql(`INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,source_hash,submitted_at)
 VALUES(${quote(id)},${quote(userId)},${quote(name)},${quote(department)},${quote('合成周次-'+end)},${quote(start)},${quote(end)},'准时',${quote(JSON.stringify(content))},${quote(sourceHash)},${quote(end+'T09:00:00Z')});`);
}
// Deliberately insert reverse chronological dates: the fence is rowid ordered.
insert('freshness-active','2026-10-23',analyzed(80),'synthetic-source-a');
insert('freshness-legacy','2026-10-16',{...facts,...legacyScore(20),'总分':20},null);
const stored=id=>JSON.parse(sql(`SELECT content_json FROM weekly_reports WHERE id=${quote(id)};`,true)[0].content_json);
const store=(id,value)=>sql(`UPDATE weekly_reports SET content_json=${quote(JSON.stringify(value))} WHERE id=${quote(id)};`);
for(const source of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights']){
 await writeFile(path.join(data,source+'.json'),JSON.stringify(source==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:source==='scoring360'?{cycles:[],assignments:[],responses:[]}:{}));
}
const guard=path.join(artifacts,'network-guard.mjs'),externalLog=path.join(artifacts,'blocked-outbound.log');
await writeFile(guard,`import {appendFileSync} from 'node:fs';
const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[${fixtureNow}]));}static now(){return ${fixtureNow};}};
globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(externalLog)},'blocked\\n');throw Error('synthetic_fixture_external_network_disabled');};`);
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const base='http://127.0.0.1:'+port,endpoint='/api/integrations/product-management/monthly-scores';
const session=Buffer.from(JSON.stringify({user:{userId:'freshness-admin',name:'合成管理员'},issuedAt:fixtureNow,sessionId:'synthetic-freshness-session',expiresAt:new Date(fixtureNow+3600000).toISOString()})).toString('base64url');
const cookie=session+'.'+createHmac('sha256',secret).update(session).digest('base64url');
const server=spawn(process.execPath,['--import',guard,'server/index.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:childPath,
 AUTH_MODE:'feishu',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,
 WEEKLY_REPORT_UPLOAD_DIR:path.join(artifacts,'uploads'),BACKUP_DIR:path.join(artifacts,'backups'),LARK_REPORT_SYNC_STATUS_PATH:path.join(artifacts,'sync.json'),
 PRODUCT_MANAGEMENT_SCORE_API_TOKEN:token,SCORING360_CONFIG_MANAGER_USER_IDS:'freshness-admin',SCORING360_CONFIG_MANAGER_NAMES:'',BOSS_VIEW_USER_IDS:'',BOSS_VIEW_NAMES:'',
 DEV_VIEW_SWITCH_ENABLED:'false',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',
 SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_TASK_CREATE_ENABLED:'false',
 FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:'',
}});
let logs='',requests=0;const phases=[];
server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
async function admin(route,body){
 const response=await fetch(base+route,{method:body?'POST':'GET',headers:{cookie:'wos_session='+cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));return payload;
}
const overview=()=>admin('/api/performance/manage?view=overview&month='+month);
function latest(){return sql(`SELECT * FROM automatic_performance_results WHERE month=${quote(month)} AND employee_user_id=${quote(userId)} AND kind='quality' ORDER BY rowid DESC LIMIT 1;`,true)[0];}
async function machine(phase,status,value=null){
 const before=fingerprint();
 const response=await fetch(base+endpoint+'?'+new URLSearchParams({month,feishuUserId:userId,name}),{headers:{authorization:'Bearer '+token}});
 const raw=await response.text();requests++;
 assert.equal(response.status,200,raw);assert.match(response.headers.get('cache-control')||'',/no-store/);assert.equal(response.headers.get('set-cookie'),null);
 for(const confidential of [privateMarker,token,'sourceReportState','sourceReviewRowId','analysis_version','qualityRefresh','fixture-model-key'])assert(!raw.includes(confidential),'machine response leaked private/internal fields');
 assert(raw.length<6000,'machine output must stay compact');
 const body=JSON.parse(raw);assert.equal(body.data.length,1);assert.equal(body.data[0].matchStatus,'matched');
 const result=body.data[0].weeklyQuality;assert.equal(result.status,status,phase);assert.equal(result.score,value,phase);assert.equal(result.isFinal,status==='published',phase);assert.equal(result.previousScore,null);
 assert.equal(fingerprint(),before,'machine GET mutated a database table: '+phase);
 phases.push({phase,status,score:value,revision:result.revision,allTablesUnchanged:true});return result;
}
try{
 let ready=false;
 for(let attempt=0;attempt<150;attempt++){
  if(server.exitCode!==null)throw Error('synthetic server exited');
  try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
  await pause(100);
 }
 assert(ready,'synthetic server did not start');await pause(150);
 const firstView=await overview(),firstMonthly=firstView.monthly.find(row=>row.userId===userId);
 assert.equal(firstMonthly.quality.finalScore,50);
 const initialRow=latest(),initial=JSON.parse(initialRow.result_json);
 assert.equal(initial.sourceDependencyVersion,1);assert.equal(initial.sourceReviewRowId,'0');
 assert.equal(initial.sourceReportState.length,2);assert(initial.sourceReportState.every(row=>row.length===24));
 assert.deepEqual(initial.sourceReportState.map(row=>row[1]),['freshness-active','freshness-legacy']);
 assert(initial.sourceReportState.every(row=>typeof row[0]==='string'),'rowids must match SQL text representation');
 assert.equal(initial.sourceReportState[1][2],'');assert.equal(initial.sourceReportState[1][7],null);assert.equal(initial.sourceReportState[1][9],null);
 assert.equal(initial.sourceReportState[1][17],20,'Chinese module keys must preserve numeric JSON values');
 const first=await machine('initial-real-publication','published',50);

 store('freshness-active',{...stored('freshness-active'),qualityRefresh:{state:'queued',targetVersion:ACTIVE_REPORT_QUALITY_VERSION,jobId:'private-queue'}});
 const queued=await machine('queued-before-overview','pending_generation');assert.notEqual(queued.revision,first.revision);
 store('freshness-active',{...stored('freshness-active'),qualityRefresh:{state:'failed',targetVersion:ACTIVE_REPORT_QUALITY_VERSION,diagnostic:{code:'synthetic_failure'}}});
 const failed=await machine('failed-before-overview','pending_generation');assert.notEqual(failed.revision,queued.revision);
 assert.deepEqual(latest(),initialRow,'machine reads cannot replace the previously published row');

 store('freshness-active',{...analyzed(0),qualityRefresh:{state:'ready',targetVersion:ACTIVE_REPORT_QUALITY_VERSION,jobId:'zero-ready'}});
 store('freshness-legacy',{...facts,...legacyScore(0),'总分':0});
 const readyUnpublished=await machine('ready-zero-before-overview','pending_generation');assert.notEqual(readyUnpublished.revision,failed.revision);
 assert.deepEqual(latest(),initialRow);
 await overview();const zeroRow=latest(),zeroResult=JSON.parse(zeroRow.result_json);
 assert.equal(zeroResult.score,0);assert.equal(zeroResult.finalScore,0);assert.equal(zeroResult.sourceReportState[0][13],0);assert.equal(zeroResult.sourceReportState[1][17],0);
 const zero=await machine('real-zero-publication','published',0);assert.notEqual(zero.revision,first.revision);

 const diagnostics=stored('freshness-active');
 diagnostics.aiGeneratedAt='2026-11-13T08:59:00Z';diagnostics.updatedAt='2026-11-13T09:00:00Z';
 diagnostics.aiAnalysisAttempts=[{attempt:4,code:'synthetic_diagnostic_only'}];
 diagnostics.qualityRefresh={...diagnostics.qualityRefresh,jobId:'different-ready-job',updatedAt:'2026-11-13T09:00:00Z',attempts:4};
 store('freshness-active',diagnostics);
 const diagnosticsOnly=await machine('ready-diagnostics-only','published',0);assert.equal(diagnosticsOnly.revision,zero.revision,'runtime-only diagnostics cannot change the score revision');
 assert.deepEqual(latest(),zeroRow,'diagnostics-only machine reads retain publication history');

 const detail=await admin('/api/performance/employee-month?'+new URLSearchParams({month,employeeId:userId}));
 const report=detail.monthly.reports.find(row=>row.id==='freshness-active');assert(report.qualityReviewVersion);
 await admin('/api/performance/quality-review',{month,userId,reportId:report.id,version:report.qualityReviewVersion,action:'adjust_score',score:84,reason:privateMarker+'：合成逐周复核'});
 assert.equal(sql('SELECT count(*) AS n FROM weekly_quality_reviews;',true)[0].n,1);
 const reviewed=await machine('weekly-review-before-overview','pending_generation');assert.notEqual(reviewed.revision,zero.revision);
 await overview();const reviewedRow=latest(),reviewedResult=JSON.parse(reviewedRow.result_json);
 assert.equal(reviewedResult.sourceReviewRowId,'1');assert.equal(reviewedResult.score,42,'effective weekly adjustment 84 and legacy zero average to 42');
 const final=await machine('real-reviewed-publication','published',42);assert.notEqual(final.revision,reviewed.revision);
 await machine('repeated-reviewed-read','published',42);
 const newerAnalysis=stored('freshness-active');newerAnalysis.aiGeneratedAt='2026-11-13T09:01:00Z';store('freshness-active',newerAnalysis);
 const staleReview=await machine('new-analysis-invalidates-weekly-review','pending_generation');assert.notEqual(staleReview.revision,final.revision);
 await overview();const newAnalysisResult=JSON.parse(latest().result_json);
 assert.equal(newAnalysisResult.score,0,'a new analysis invalidates the previous analysis-specific weekly adjustment');
 await machine('new-analysis-publication-without-old-adjustment','published',0);
 assert.deepEqual(sql(`SELECT * FROM automatic_performance_results WHERE id=${quote(initialRow.id)};`,true)[0],initialRow,'first publication stays byte-for-byte intact');
 assert.equal(sql("SELECT count(*) AS n FROM performance_results WHERE kind='quality';",true)[0].n,0,'no human monthly final is created');
 assert.equal(sql('PRAGMA integrity_check;'),'ok');assert.equal(sql('PRAGMA foreign_key_check;'),'');
 const blocked=await readFile(externalLog,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});assert.equal(blocked,'','synthetic service attempted outbound requests');
 const result={ok:true,requests,realOverviewGeneratedDependency:true,dependencyFields:24,rowidOrderAndStringType:true,nullAndChineseScoreValues:true,queuedFailedAndReadyFence:true,zeroPublishedAfterAggregation:true,diagnosticsRevisionStable:true,weeklyReviewFence:true,newAnalysisInvalidatesPriorWeeklyReview:true,effectiveWeeklyMeanPreserved:true,allMachineReadsLeaveEveryTableUnchanged:true,initialHistoryUnchanged:true,noPrivateContent:true,externalRequests:0,productionWrites:0,deletions:0,phases,artifacts};
 await writeFile(path.join(artifacts,'result.json'),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify(result));
}catch(error){
 await writeFile(path.join(artifacts,'failure-server.log'),logs,{mode:0o600,flag:'wx'});throw error;
}finally{
 if(server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
 console.log('Synthetic test artifacts retained: '+artifacts);
}
