import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rename,stat,utimes,chmod} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

// Real HTTP with a private, isolated database and synthetic source files. Every
// artifact is retained; this suite never contacts providers or removes files.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/management-transport-')),data=dir+'/data',db=dir+'/test.sqlite';
await chmod(dir,0o700);await mkdir(data);
const save=(filename,value)=>writeFile(filename,value,{mode:0o600});
const sql=(statement,json=false)=>{const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();};
sql(await readFile('db/schema.sql','utf8'));
sql("INSERT INTO employees(user_id,name,department,is_active) VALUES('admin','传输测试管理员','测试管理部',1),('member','传输测试员工','测试部门',1); INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES('hire-admin','admin','2026-08-03','manager'),('hire-member','member','2026-08-03','manager');");
const period={id:'fixture-week',label:'2026年8月第1周',start:'2026-08-03',end:'2026-08-07',range:'2026-08-03 — 2026-08-07'};
const meta={generated_on:'2026-10-29',current_week_id:period.id,current_week_label:period.label,current_week_range:period.range,periods:[period],retainedClientMeta:'source-meta'};
const employee={user_id:'member','姓名':'传输测试员工','部门':'测试部门','平均分':88};
const weekly={user_id:'member','姓名':'传输测试员工','部门':'测试部门','周期ID':period.id,'周次':period.label,'开始日期':period.start,'结束日期':period.end,'状态':'准时','总分':88,'本周成果摘要':'phase-A '+('完成3项验收，复盘并确认跨部门支持。'.repeat(800))};
const bossTask={'优先级':'P1','来源人员':'传输测试员工','部门':'测试部门','主题':'统一验收口径','建议任务标题':'整理验收清单'};
const employeeTask={'优先级':'P2','来源人员':'传输测试员工','负责人user_id':'member','建议任务标题':'沉淀工作方法'};
const feedback={user_id:'member','姓名':'传输测试员工','反馈草稿':'保留已完成的证据。'};
const insight={meta:{periodId:period.id},executiveSummary:'insight-phase-A',companyMessageDraft:'测试公司摘要',collectiveFocus:[{title:'本周焦点',detail:'形成验收清单'}],themes:[{label:'验收',value:6,severity:'P1',summary:'口径需要统一',quotes:[{author:'传输测试员工',department:'测试部门',week:period.label,text:'先确认验收口径'}]}],employeeInsights:[{userId:'member',name:'传输测试员工',coachSummary:'关注可核实结果',coachQuestions:['怎样验收？'],taskCandidates:[{id:'candidate-1',priority:'P1',ownerUserId:'member',title:'整理清单',metric:'完成3项'}]}]};
const meeting={meta:{source:'fixture'},records:[{monthKey:'2026-08',meetingDate:'2026-08-31',status:'draft',executiveSummary:'月度摘要',comparison:{improvements:['形成清单'],recurringIssues:[],newRisks:['输入未统一']}}]};
const scoring={cycles:[],assignments:[],responses:[],results:[],fixtureRetained:'legacy-shape'};
const sources={prototypeData:{meta,employee_summary:[{...employee,rawSource:'full-only-employee'}],weekly_scores:[{...weekly,rawSource:'full-only-weekly'}],boss_tasks:[{...bossTask,rawSource:'full-only-task'}],employee_tasks:[{...employeeTask,rawSource:'full-only-task'}],feedback_drafts:[{...feedback,rawSource:'full-only-feedback'}],group_message_draft:'测试草稿',rawSource:'full-only-prototype'},kimiInsights:{...insight,rawSource:'full-only-insight'},kimiInsightsByPeriod:{[period.id]:{executiveSummary:'period-phase-A',rawSource:'full-only-period'}},monthlyMeetingInsights:{...meeting,rawSource:'full-only-meeting'},scoring360:scoring};
const clientExpected=()=>({prototypeData:{meta:sources.prototypeData.meta,group_message_draft:'测试草稿',employee_summary:[employee],weekly_scores:[Object.fromEntries(Object.keys(weekly).map(key=>[key,sources.prototypeData.weekly_scores[0][key]]))],boss_tasks:[bossTask],employee_tasks:[employeeTask],feedback_drafts:[feedback]},kimiInsights:Object.fromEntries(Object.entries(sources.kimiInsights).filter(([key])=>key!=='rawSource')),kimiInsightsByPeriod:{[period.id]:{executiveSummary:sources.kimiInsightsByPeriod[period.id].executiveSummary}},monthlyMeetingInsights:meeting,scoring360:scoring});
const bootstrapExpected=()=>({prototypeData:{meta:Object.fromEntries(['generated_on','current_week_id','current_week_label','current_week_range','periods'].map(key=>[key,sources.prototypeData.meta[key]]))}});
for(const [name,value] of Object.entries(sources))await save(data+'/'+name+'.json',JSON.stringify(value));

// Reject every Node networking path in the child, including named ESM imports.
const blockedLog=dir+'/blocked-outbound.log',guard=dir+'/network-guard.mjs';
await save(guard,`import {appendFileSync} from 'node:fs';
import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';
const reject=kind=>function(){appendFileSync(${JSON.stringify(blockedLog)},kind+'\\n');throw Error('fixture_external_network_disabled');};
globalThis.fetch=reject('fetch');for(const api of [http,https])for(const name of ['request','get'])api[name]=reject(name);
net.connect=reject('net.connect');net.createConnection=reject('net.createConnection');net.Socket.prototype.connect=reject('socket.connect');tls.connect=reject('tls.connect');
for(const name of ['lookup','resolve','resolve4','resolve6','reverse'])dns[name]=reject('dns.'+name);syncBuiltinESMExports();
`);
const freePort=await new Promise((resolve,reject)=>{const listener=net.createServer();listener.once('error',reject);listener.listen(0,'127.0.0.1',()=>{const port=listener.address().port;listener.close(error=>error?reject(error):resolve(port));});});
const secret='isolated-management-transport',base='http://127.0.0.1:'+freePort;
const env={...process.env,AUTH_MODE:'feishu',DEV_VIEW_SWITCH_ENABLED:'false',SESSION_SECRET:secret,SERVER_PORT:String(freePort),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',LARK_REPORT_SYNC_STATUS_PATH:dir+'/sync.json',BACKUP_DIR:dir+'/backups',STATIC_DIR:dir+'/static',BOSS_VIEW_USER_IDS:'',BOSS_VIEW_NAMES:'',SCORING360_CONFIG_MANAGER_USER_IDS:'admin',SCORING360_CONFIG_MANAGER_NAMES:'',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_TASK_CREATE_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',FEISHU_EVENT_VERIFICATION_TOKEN:'',FEISHU_EVENT_ENCRYPT_KEY:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:''};
const cookie=id=>{const body=Buffer.from(JSON.stringify({user:{userId:id,name:id==='admin'?'传输测试管理员':'传输测试员工'},sessionId:'transport-'+randomUUID(),issuedAt:Date.now(),expiresAt:new Date(Date.now()+3600000).toISOString()})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
const decode=response=>JSON.parse((response.headers['content-encoding']==='br'?brotliDecompressSync(response.raw):response.headers['content-encoding']==='gzip'?gunzipSync(response.raw):response.raw).toString('utf8'));
const calls=[];
const call=(route,{user='admin',encoding}={})=>new Promise((resolve,reject)=>{
 const headers={};if(user)headers.cookie='wos_session='+cookie(user);if(encoding!==undefined)headers['Accept-Encoding']=encoding;
 const request=http.get(base+route,{headers,agent:false},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.once('error',reject);response.once('end',()=>{const value={status:response.statusCode,headers:response.headers,raw:Buffer.concat(chunks)};calls.push({route,user:user||'anonymous',acceptEncoding:encoding??null,status:value.status,contentEncoding:value.headers['content-encoding']||'identity',bytes:value.raw.length});resolve(value);});});request.once('error',reject);request.setTimeout(15000,()=>request.destroy(Error('fixture_http_timeout')));
});
const assertTransport=(response,encoding='identity')=>{assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert(String(response.headers.vary).toLowerCase().split(',').map(x=>x.trim()).includes('accept-encoding'));assert.equal(response.headers['content-type'],'application/json; charset=utf-8');assert.equal(Number(response.headers['content-length']),response.raw.length);assert.equal(response.headers['content-encoding']||'identity',encoding);};
const checkView=async(view,encoding='identity')=>{const response=await call('/api/management-data'+(view?'?view='+view:''),{encoding});assertTransport(response,encoding);assert.deepEqual(decode(response),view==='bootstrap'?bootstrapExpected():view==='client'?clientExpected():sources);return response;};
const scoreCounts=()=>sql('SELECT count(*) FROM scoring360_responses; SELECT count(*) FROM monthly_manager_scores; SELECT count(*) FROM department_leader_scores; SELECT count(*) FROM automatic_performance_results;');
const beforeCounts=scoreCounts();
let logs='',result;
const server=spawn(process.execPath,['--import',guard,'server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
try{
 let ready=false;for(let n=0;n<150;n++){if(server.exitCode!==null)throw Error('isolated_server_failed:'+logs);try{if((await call('/health',{user:null})).status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'isolated server must become ready');
 const baseline={};for(const view of ['', 'full','client','bootstrap','unknown'])for(const encoding of ['identity','gzip','br']){const response=await checkView(view,encoding);if(['','client','bootstrap'].includes(view))baseline[(view||'full')+':'+encoding]=response.raw.length;}
 const implicit=await call('/api/management-data');assertTransport(implicit);assert.deepEqual(decode(implicit),sources);
 const negotiation=[['br, gzip','br'],['BR; q=1, GZIP; q=1','br'],['br;q=0,gzip;q=1','gzip'],['br;q=0,gzip;q=0','identity'],['br;q=0.5,gzip;q=0.5','identity'],['br;q=0.8,gzip;q=0.9,identity;q=0','gzip'],['*;q=1,identity;q=0','br'],['br;q=0,*;q=1,identity;q=0','gzip'],['deflate','identity'],['identity;q=1,br;q=0.1','identity']];
 for(const [encoding,expected] of negotiation){const response=await call('/api/management-data?view=client',{encoding});assertTransport(response,expected);assert.deepEqual(decode(response),clientExpected());}
 for(const encoding of ['br;q=0,gzip;q=0,identity;q=0','*;q=0','deflate,identity;q=0']){const response=await call('/api/management-data?view=client',{encoding});assert.equal(response.status,406);assert.equal(response.headers['cache-control'],'no-store');assert(String(response.headers.vary).toLowerCase().includes('accept-encoding'));assert.equal(response.headers['content-encoding'],undefined);assert.deepEqual(decode(response),{ok:false,error:'encoding_not_acceptable'});}
 for(const view of ['full','client','bootstrap'])for(const user of [null,'member']){const response=await call('/api/management-data?view='+view,{user,encoding:'br'});assert.equal(response.status,user?403:401);assert.deepEqual(decode(response),{ok:false,error:user?'manager_only':'unauthorized'});}
 const prototypePath=data+'/prototypeData.json',before=await stat(prototypePath,{bigint:true}),original=await readFile(prototypePath,'utf8');
 await save(dir+'/prototype-before-same-size.json',original);sources.prototypeData.weekly_scores[0]['本周成果摘要']=sources.prototypeData.weekly_scores[0]['本周成果摘要'].replace('phase-A','phase-B');const modified=JSON.stringify(sources.prototypeData);assert.equal(Buffer.byteLength(modified),Buffer.byteLength(original));await save(prototypePath,modified);await utimes(prototypePath,Number(before.atimeNs)/1e9,Number(before.mtimeNs)/1e9);
 for(const view of ['full','client','bootstrap'])for(const encoding of ['identity','gzip','br'])await checkView(view,encoding);
 const insightPath=data+'/kimiInsights.json',oldInode=(await stat(insightPath,{bigint:true})).ino,staged=data+'/kimiInsights-staged.json';sources.kimiInsights.executiveSummary='insight-phase-B';await save(staged,JSON.stringify(sources.kimiInsights));await rename(insightPath,dir+'/kimiInsights-before-replacement.json');await rename(staged,insightPath);assert.notEqual((await stat(insightPath,{bigint:true})).ino,oldInode);
 for(const view of ['full','client','bootstrap'])for(const encoding of ['identity','gzip','br'])await checkView(view,encoding);
 // A malformed or missing source must fail even when a valid body is warm.
 await rename(insightPath,dir+'/kimiInsights-valid-before-corruption.json');await save(insightPath,'{"bad":');
 for(const view of ['full','client'])for(const encoding of ['identity','br']){const response=await call('/api/management-data?view='+view,{encoding});assert.equal(response.status,500);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(decode(response),{ok:false,error:'internal_server_error'});}
 await checkView('bootstrap','br');await rename(insightPath,dir+'/kimiInsights-retained-corruption.json');await rename(dir+'/kimiInsights-valid-before-corruption.json',insightPath);await checkView('client','gzip');
 await rename(prototypePath,dir+'/prototype-retained-during-missing.json');
 for(const view of ['full','client','bootstrap']){const response=await call('/api/management-data?view='+view,{encoding:'br'});assert.equal(response.status,500);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(decode(response),{ok:false,error:'internal_server_error'});}
 for(const user of [null,'member']){const response=await call('/api/management-data?view=client',{user,encoding:'br'});assert.equal(response.status,user?403:401);}
 await rename(dir+'/prototype-retained-during-missing.json',prototypePath);for(const view of ['full','client','bootstrap'])await checkView(view,'br');
 assert.equal(scoreCounts(),beforeCounts);assert.equal(sql('SELECT count(*) FROM weekly_reminder_sends;'),'0');assert.equal(sql('SELECT count(*) FROM monthly_score_reminder_deliveries;'),'0');assert.equal(sql('PRAGMA integrity_check;'),'ok');const blocked=await readFile(blockedLog,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});assert.equal(blocked,'');
 result={ok:true,isolatedRawHttp:true,fullClientBootstrapShapesPreserved:true,defaultAndUnknownViewCompatibility:true,identityGzipBrotliDecodeExact:true,encodingQualityAndQZeroRespected:true,notAcceptable406:true,noStoreAndVary:true,warmCacheUnauthorized401AndMember403:true,sourceSameSizeAndMtimeResetInvalidation:true,sourceAtomicReplacementInvalidation:true,corruptAndMissingSourceFailClosed:true,metadataBootstrapIndependentOfUnrelatedSource:true,authorizationPrecedesMissingSourceRead:true,sourceRecoveryWithoutRestart:true,databaseIntegrity:'ok',humanScoreAndResultWrites:0,providerRequests:0,messagesSent:0,baselineBytes:baseline,httpRequests:calls.length,artifacts:dir};await save(dir+'/requests.json',JSON.stringify(calls,null,2));await save(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(logs);await save(dir+'/requests.json',JSON.stringify(calls,null,2));throw error;}
finally{server.kill('SIGTERM');if(server.exitCode===null&&server.signalCode===null)await new Promise(resolve=>server.once('exit',resolve));await save(dir+'/server.log',logs);console.log('Artifacts retained:',dir);}
