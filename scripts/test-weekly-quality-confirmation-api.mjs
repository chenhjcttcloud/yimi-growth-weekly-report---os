import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {validateAnalysis} from '../server/live-report-sync.mjs';
import {REPORT_QUALITY_PROMPT_VERSION} from '../server/report-quality-scoring.mjs';
import {makeReportQualityAnalysis} from './report-quality-test-fixtures.mjs';

await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/weekly-quality-confirmation-api-'));
const db=path.join(dir,'test.sqlite'),data=path.join(dir,'data');
await mkdir(data);
const month='2026-10',secret='weekly-quality-synthetic-session',auditReason='只供管理人员查看的测试调整原因';
const names={boss:'测试老板',lead:'测试主管',staff:'测试员工',other:'其他员工'};
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
function run(statement,json=false){
 const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();
}
const facts={results:'测试用：合同归档记录 T-1，已完成核对。',problems:'任务记录 T-2 显示接口有依赖，已同步给测试组。',nextPlan:'周五前提交验证清单。',reflection:'检查记录显示，先对齐口径可以减少返工。'};
function reportContent(id,scores){
 const ai=scores?validateAnalysis(makeReportQualityAnalysis(facts,{scores}),facts):null;
 return {...facts,sourceHash:'fixture-'+id,source:{provider:'feishu-report'},...(ai?{ai,aiModel:'fixture-model',aiPromptVersion:REPORT_QUALITY_PROMPT_VERSION,aiGeneratedAt:'2026-10-23T10:00:00Z'}:{})};
}
function storeReport(id,userId,end,scores){
 const start=new Date(Date.parse(end+'T00:00:00Z')-4*86400000).toISOString().slice(0,10);
 run(`INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,source_hash,submitted_at)
 VALUES(${quote(id)},${quote(userId)},${quote(names[userId])},'测试团队',${quote(id)},${quote(start)},${quote(end)},'准时',${quote(JSON.stringify(reportContent(id,scores)))},${quote('fixture-'+id)},${quote(end+'T09:00:00Z')});`);
}
run(await readFile('db/schema.sql','utf8'));
run(`INSERT INTO employees(user_id,name,department,manager_user_id,is_active) VALUES
 ('boss',${quote(names.boss)},'管理','',1),('lead',${quote(names.lead)},'测试团队','boss',1),
 ('staff',${quote(names.staff)},'测试团队','lead',1),('other',${quote(names.other)},'其他团队','boss',1);
 INSERT INTO app_settings(key,value_json) VALUES('report_automation_config','{"enabled":false,"scoringStartMonth":"2026-10"}');`);
storeReport('duplicate','staff','2026-10-16',[10,10,10,10]);
storeReport('score-first','staff','2026-10-16',[70,82,78,70]);
storeReport('score-second','staff','2026-10-23');
storeReport('other-score','other','2026-10-16',[96,96,96,96]);
for(const name of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights']){
 const payload=name==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:{};
 await writeFile(path.join(data,name+'.json'),JSON.stringify(payload));
}
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port,base='http://127.0.0.1:'+port;
await new Promise(resolve=>socket.close(resolve));
const provider=path.join(dir,'provider.mjs'),providerLog=path.join(dir,'provider.jsonl');
await writeFile(provider,`import {appendFileSync,existsSync} from 'node:fs';
import {setTimeout as pause} from 'node:timers/promises';
import {makeReportQualityAnalysis} from ${JSON.stringify(new URL('./report-quality-test-fixtures.mjs',import.meta.url).href)};
globalThis.fetch=async (url,request)=>{
 if(String(url)!=='https://weekly-quality-fixture.invalid/v1/chat/completions')throw Error('fixture blocked all non-model requests');
 const {report,week}=JSON.parse(JSON.parse(request.body).messages[1].content);
 appendFileSync(${JSON.stringify(providerLog)},JSON.stringify({report,week})+'\\n');
 while(!existsSync(${JSON.stringify(path.join(dir,'provider-release'))}))await pause(25);
 return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(makeReportQualityAnalysis(report,{scores:[84,84,84,84]}))}}]})};
};`);
const server=spawn(process.execPath,['--import',provider,'server/index.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env,
 AUTH_MODE:'mock',DEV_VIEW_SWITCH_ENABLED:'false',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,
 WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',BACKUP_DIR:dir+'/backups',LARK_REPORT_SYNC_STATUS_PATH:dir+'/sync.json',
 BOSS_VIEW_USER_IDS:'boss',SCORING360_CONFIG_MANAGER_USER_IDS:'',SCORING360_CONFIG_MANAGER_NAMES:'',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',
 MOONSHOT_API_KEY:'fixture-model-key',MOONSHOT_BASE_URL:'https://weekly-quality-fixture.invalid/v1',KIMI_API_KEY:'',KIMI_FOLLOWUP_MODEL:'fixture-model',
 CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',
 WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_TASK_CREATE_ENABLED:'false',
}});
let logs='';server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
async function api(route,userId='lead',body){
 const session=Buffer.from(JSON.stringify({user:{userId,name:names[userId]},issuedAt:Date.now()})).toString('base64url');
 const signature=createHmac('sha256',secret).update(session).digest('base64url');
 const response=await fetch(base+route,{method:body?'POST':'GET',headers:{cookie:`wos_session=${session}.${signature}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:response.status,body:await response.json()};
}
const detail=(userId='lead',employeeId='staff')=>api(`/api/performance/employee-month?month=${month}&employeeId=${employeeId}`,userId);
const confirm=(body,userId='lead')=>api('/api/performance/confirm',userId,{kind:'quality',userId:'staff',month,...body});
const review=(body,userId='lead')=>api('/api/performance/quality-review',userId,{userId:'staff',reportId:'score-first',month,...body});
try{
 let ready=false;
 for(let attempt=0;attempt<100;attempt++){
  if(server.exitCode!==null)throw Error(logs);
  try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
  await pause(100);
 }
 assert(ready,logs);
 assert.equal((await api('/api/me','staff')).body.access.canReviewWeeklyQuality,false);
 assert.equal((await api('/api/me')).body.access.canReviewWeeklyQuality,true);
 assert.deepEqual((await api('/api/performance/quality-scope')).body.employees.map(employee=>employee.userId),['staff']);
 assert.equal((await api('/api/performance/manage')).status,403);
 assert.equal((await detail('staff')).status,403);
 assert.equal((await detail('lead','other')).status,403);
 assert.equal((await api('/api/performance/report?id=other-score')).status,404);
 assert.equal((await api('/api/performance/report?id=score-first')).status,200);
 assert.equal((await api('/api/performance/me?employeeId=other','staff')).status,403);
 assert.equal((await confirm({},'staff')).status,403);
 const initial=await detail();assert.equal(initial.status,200,JSON.stringify(initial.body));
 assert.equal(initial.body.monthly.quality.status,'pending_ai');
 assert.equal(initial.body.monthly.quality.currentAverage,75);
 assert.equal(initial.body.monthly.quality.pendingAnalysis,1);
 assert.equal(initial.body.monthly.quality.finalScore,null);
 assert.deepEqual(initial.body.collaborations,[]);
 assert.equal(initial.body.monthly.reports.some(report=>report.id==='duplicate'),false);
 const initialWeek=initial.body.monthly.reports.find(report=>report.id==='score-first');
 assert.equal(initialWeek.qualityAssessment.modules[0].evidence[0].quote,facts.results);
 assert.equal((await confirm({version:'a'.repeat(64)})).status,409);

 const next=reportContent('score-second',[81,81,81,81]);
 run(`UPDATE weekly_reports SET content_json=${quote(JSON.stringify(next))} WHERE id='score-second';`);
 const candidate=(await detail()).body.monthly.quality;
 assert.equal(candidate.status,'pending_confirmation');assert.equal(candidate.candidateScore,78);
 assert.equal(run("SELECT count(*) FROM performance_results WHERE kind='quality';"),'0');
 const adjustment={action:'adjust_score',version:initialWeek.qualityReviewVersion,score:77};
 assert.equal((await review(adjustment)).status,400,'manual adjustments require a reason');
 assert.equal((await review({...adjustment,reason:auditReason})).status,200);
 assert.equal((await confirm({version:candidate.version})).status,409,'a stale candidate cannot be confirmed');
 const workspace=await api(`/api/personal/workspace?month=${month}&weekId=period-2026-10-16`,'staff');
 assert.equal(workspace.status,200);assert(!JSON.stringify(workspace.body).includes(auditReason));
 assert.equal(workspace.body.weeks.find(week=>week.end==='2026-10-16').qualityAssessment.modules[0].evidence[0].quote,facts.results);

 const adjusted=(await detail()).body.monthly;
 assert.equal(adjusted.quality.candidateScore,79);
 const adjustedWeek=adjusted.reports.find(report=>report.id==='score-first');
 assert.equal(adjustedWeek.aiCandidate,75);
 const reanalysisRequest={action:'reanalyze',version:adjustedWeek.qualityReviewVersion,reason:'核对阶段交付后重新分析'};
 run("UPDATE app_settings SET value_json=json_set(value_json,'$.dailyAiRequestLimit',0) WHERE key='report_automation_config';");
 assert.equal((await review(reanalysisRequest)).body.error,'ai_scoring_paused');
 assert.equal((await detail()).body.monthly.quality.version,adjusted.quality.version,'paused scoring leaves the current candidate available');
 run("UPDATE app_settings SET value_json=json_set(value_json,'$.dailyAiRequestLimit',60) WHERE key='report_automation_config';");
 const reanalysis=await review(reanalysisRequest);
 assert.equal(reanalysis.status,202,JSON.stringify(reanalysis.body));
 assert.equal((await detail()).body.monthly.quality.status,'pending_ai');
 assert.equal((await confirm({version:adjusted.quality.version})).status,409);
 await writeFile(path.join(dir,'provider-release'),'ready');
 let refreshed;
 for(let attempt=0;attempt<100;attempt++){
  refreshed=(await detail()).body.monthly.quality;
  if(refreshed.status==='pending_confirmation')break;
  await pause(60);
 }
 assert.equal(refreshed.status,'pending_confirmation',logs);
 assert.equal(refreshed.candidateScore,82.5);
 const inputs=(await readFile(providerLog,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.deepEqual(inputs,[{report:facts,week:'2026-10-16'}]);
 assert.deepEqual(JSON.parse(run("SELECT content_json FROM weekly_reports WHERE id='score-second';")),next);
 const attempts=await Promise.all([confirm({version:refreshed.version}),confirm({version:refreshed.version},'boss')]);
 assert.deepEqual(attempts.map(result=>result.status).sort(),[200,409]);
 const final=(await detail()).body.monthly.quality;
 assert.equal(final.status,'final');assert.equal(final.finalScore,82.5);assert(final.confirmedBy);assert(final.confirmedAt);
 const snapshotPath='/api/performance/result-evidence?'+new URLSearchParams({month,employeeId:'staff',kind:'quality',rule:'management_confirmed',confirmedAt:final.confirmedAt});
 const snapshot=await api(snapshotPath);assert.equal(snapshot.status,200);
 assert.equal(snapshot.body.detail.reports.find(report=>report.id==='score-first').qualityAssessment.model,'fixture-model');
 assert(snapshot.body.detail.reviewerId);assert.equal((await api(snapshotPath,'other')).status,403);
 const own=(await api('/api/performance/me','staff')).body.history.find(row=>row.month===month);
 assert.equal(own.monthlyQuality.finalScore,82.5);assert(!JSON.stringify(own).includes(auditReason));
 assert.equal(run("SELECT count(*) FROM performance_results WHERE kind='quality';"),'1');
 assert.equal(run('SELECT count(*) FROM weekly_quality_reviews;'),'2');
 assert.equal(run('PRAGMA integrity_check;'),'ok');
 console.log(JSON.stringify({ok:true,supervisorScope:true,employeeEvidence:true,pendingIsExcluded:true,onlyTargetReanalyzed:true,oneHumanFinal:true,artifacts:dir}));
}catch(error){console.error(logs);throw error;}
finally{
 if(server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
 console.log('Test artifacts retained:',dir);
}
