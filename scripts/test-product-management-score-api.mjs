import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,createHmac} from 'node:crypto';
import {createServer} from 'node:net';
import {Readable} from 'node:stream';
import {request as httpRequest} from 'node:http';
import path from 'node:path';

await mkdir('outputs/tests',{recursive:true});
const artifacts=await mkdtemp(path.resolve('outputs/tests/product-management-score-api-'));
const schema=await readFile('db/schema.sql','utf8');
const token='fixture-machine-score-token-32-characters-never-production';
const secret='fixture-score-api-session-secret-never-production';
const endpoint='/api/integrations/product-management/monthly-scores',month='2026-10';
const privateMarker='PRIVATE_FIXTURE_REPORT_AND_REVIEW_CONTENT';
const employees=[
 ['fixture-a','测试甲',1],['fixture-b','测试同名',1],['fixture-c','测试同名',1],
 ['fixture-zero','测试零分',1],['fixture-rescoring','测试重评中',1],['fixture-failed','测试重评失败',1],
 ['fixture-pending','测试待分析',1],['fixture-none','测试无周报',1],['fixture-empty','测试未发布',1],
 ['fixture-invalid-json','测试坏结果',1],['fixture-invalid-score','测试异常分',1],
 ['fixture-legacy','测试改名后',1],['fixture-inactive','测试已离职',0],
 ['fixture-parentheses','测试员工（兼职）',1],['fixture-unicode','测试É',1],
 ['fixture-old-weighted','测试旧加权',1],['fixture-boss','测试老板',1],['fixture-peer','测试同事',1],
];
const names=new Map(employees.map(([id,name])=>[id,name]));
const quote=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const json=value=>quote(JSON.stringify(value));
const servers=[];
let requests=0;

function database(db,sql){
 const result=spawnSync('sqlite3',['-bail','-json',db],{input:sql,encoding:'utf8',maxBuffer:16*1024*1024});
 assert.equal(result.status,0,result.stderr);
 return /^\s*(SELECT|WITH)\b/i.test(sql)?JSON.parse(result.stdout||'[]'):[];
}
function fingerprint(db){
 const tables=database(db,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
 const contents=tables.map(({name})=>{
  const rows=database(db,`SELECT * FROM "${name.replaceAll('"','""')}";`);
  return [name,rows.map(row=>JSON.stringify(row)).sort()];
 });
 return createHash('sha256').update(JSON.stringify(contents)).digest('hex');
}
async function freePort(){
 const socket=createServer();await new Promise(resolve=>socket.listen(0,resolve));
 const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;
}
function cookie(userId){
 const issuedAt=Date.now();
 const body=Buffer.from(JSON.stringify({user:{userId,name:names.get(userId)||'测试用户'},issuedAt,expiresAt:new Date(issuedAt+600000).toISOString(),sessionId:'score-api-fixture-'+userId})).toString('base64url');
 return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
}
async function startServer(label,apiToken){
 const dir=path.join(artifacts,label),data=dir+'/data',db=dir+'/test.sqlite';await mkdir(data,{recursive:true});
 await writeFile(data+'/prototypeData.json',JSON.stringify({meta:{periods:[]},employee_summary:[],weekly_scores:[]}));
 await writeFile(data+'/scoring360.json',JSON.stringify({cycles:[],assignments:[],responses:[]}));
 database(db,schema);
 const confidentialEvidence=JSON.stringify({source:privateMarker,comment:privateMarker,aiAnalysisHistory:[{text:privateMarker.repeat(3000)}]});
 const statements=[
  ...employees.map(([id,name,active])=>`INSERT INTO employees(user_id,name,department,is_active) VALUES(${quote(id)},${quote(name)},'合成测试部门',${active});`),
  `INSERT INTO employee_identities(user_id,open_id,union_id) VALUES('fixture-a','ou_fixture_application_specific','on_fixture_union');`,
  `INSERT INTO scoring360_cycles(id,label,start_date,end_date,status) VALUES('fixture-cycle','合成旧周期','2026-10-01','2026-10-31','closed');`,
  `INSERT INTO app_settings(key,value_json) VALUES('boss_view_members',${json({members:[{userId:'fixture-boss',name:'测试老板'}]})}),('scoring360_admin_members',${json({members:[{userId:'fixture-boss',name:'测试老板'}]})}),('report_automation_config',${json({enabled:false,intervalMinutes:15})}),('operations_config',${json({backupEnabled:false,alertsEnabled:false,backupTime:'03:00',recipientUserIds:[],diskWarningPercent:85})}),('scoring360_recurring_config',${json({enabled:false})});`,
  `INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,source_hash,submitted_at) VALUES('private-report','fixture-a','测试甲','合成测试部门','fixture-week','2026-10-05','2026-10-09','submitted',${json({results:privateMarker,ai:{score:99,reason:privateMarker}})},'fixture-source-hash','2026-10-09T09:00:00Z');`,
 ];
 let autoSequence=0;
 const automatic=(id,result,calculatedAt='2026-10-31T10:00:00Z')=>{
  const sequence=++autoSequence;
  statements.push(`INSERT INTO automatic_performance_results(id,month,employee_user_id,employee_name,kind,calculation_hash,result_json,evidence_json,calculated_at) VALUES(${quote('auto-'+sequence)},${quote(month)},${quote(id)},${quote(names.get(id))},'quality',${quote('fixture-hash-'+sequence)},${typeof result==='string'?quote(result):json(result)},${quote(confidentialEvidence)},${quote(calculatedAt)});`);
 };
 const weighted=(table,id,score,managerScore=80,peerScore=90)=>{
  const assignment='weighted-'+id;
  statements.push(`INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES(${quote(assignment)},'fixture-cycle',${quote(names.get(id))},'测试同事',${quote(id)},'fixture-peer');`);
  statements.push(`INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES(${quote('response-'+id)},${quote(assignment)},'fixture-cycle',${quote(names.get(id))},'测试同事',${peerScore},${quote(privateMarker)});`);
  statements.push(`INSERT INTO monthly_manager_scores(month,employee_user_id,evaluator_user_id,score,comment,snapshot_json) VALUES(${quote(month)},${quote(id)},'fixture-boss',${managerScore},${quote(privateMarker)},'{}');`);
  const evidence={...JSON.parse(confidentialEvidence),managerProgress:{kind:'manager',expectedIds:['fixture-boss']}};
  statements.push(`INSERT INTO ${table}(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES(${quote(month)},${quote(id)},${quote(names.get(id))},'collaboration',${json({score,managerScore,peerScore,weights:{manager:30,peers:70}})},${json(evidence)},'fixture-publisher','2026-10-31T12:00:00Z');`);
 };
 // A later rowid wins even when its timestamp sorts before an older snapshot.
 automatic('fixture-a',{score:41,status:'ready',reportCount:1},'2099-01-01T00:00:00Z');
 automatic('fixture-a',{score:86.5,status:'ready',reportCount:4});
 automatic('fixture-b',{score:71,status:'ready'});automatic('fixture-c',{score:93,status:'ready'});
 automatic('fixture-zero',{score:0,status:'ready'});
 automatic('fixture-rescoring',{score:81,status:'ready'});
 automatic('fixture-rescoring',{score:81,status:'rescoring',pendingAnalysis:2,refreshPending:2,previousResultAt:'2026-10-30T08:00:00Z'});
 automatic('fixture-failed',{score:62,status:'rescore_failed',pendingAnalysis:1,failedAnalysis:1});
 automatic('fixture-pending',{score:null,status:'pending_ai',pendingAnalysis:2});
 automatic('fixture-none',{score:null,status:'no_reports'});
 automatic('fixture-invalid-json','{bad-json');automatic('fixture-invalid-score',{score:101,status:'ready'});
 automatic('fixture-legacy',{score:99,status:'ready'});automatic('fixture-inactive',{score:76,status:'ready'});
 automatic('fixture-parentheses',{score:78,status:'ready'});automatic('fixture-unicode',{score:79,status:'ready'});
 weighted('monthly_person_weighted_results','fixture-a',87,80,90);
 weighted('monthly_person_weighted_results','fixture-zero',0,0,0);
 weighted('monthly_weighted_results','fixture-old-weighted',84,70,90);
 statements.push(`INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES(${quote(month)},'fixture-legacy','测试改名前','quality',${json({score:64})},${quote(confidentialEvidence)},'fixture-legacy-publisher','2026-10-20T12:00:00Z');`);
 // The complete weighted fixture also satisfies the old peer-only publication gate.
 weighted('monthly_person_weighted_results','fixture-legacy',69,90,60);
 statements.push(`INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES(${quote(month)},'fixture-legacy','测试改名前','collaboration',${json({score:60})},${quote(confidentialEvidence)},'fixture-legacy-publisher','2026-10-20T12:00:00Z');`);
 database(db,statements.join('\n'));
 const externalLog=dir+'/external-fetches.jsonl',guard=dir+'/network-guard.mjs';
 await writeFile(guard,`import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(externalLog)},'blocked\\n');throw Error('fixture_external_network_disabled');};`);
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const env={...process.env,AUTH_MODE:'feishu',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',BACKUP_DIR:dir+'/backups',PRODUCT_MANAGEMENT_SCORE_API_TOKEN:apiToken,FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:'',FEISHU_TASK_CREATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',DEV_VIEW_SWITCH_ENABLED:'false'};
 const server=spawn(process.execPath,['--import',guard,'server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 const instance={server,base,db,dir,externalLog,logs:()=>logs};servers.push(instance);
 let ready=false;
 for(let n=0;n<150;n++){
  if(server.exitCode!==null)throw Error('Fixture server exited: '+logs);
  try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(ready,'Fixture server did not become ready: '+logs);
 // Initial scheduler checks complete before the read-only request fingerprint.
 await new Promise(resolve=>setTimeout(resolve,150));return instance;
}
async function request(instance,{method='GET',params,body,rawBody,authorization=token,cookieValue,headers={}}={}){
 const query=params?'?'+new URLSearchParams(params):'';
 const response=await fetch(instance.base+endpoint+query,{method,headers:{...(authorization!==null?{authorization:'Bearer '+authorization}:{}),...((body!==undefined||rawBody!==undefined)?{'content-type':'application/json'}:{}),...(cookieValue?{cookie:'wos_session='+cookieValue}:{}),...headers},body:rawBody!==undefined?rawBody:body!==undefined?JSON.stringify(body):undefined});
 const raw=await response.text();requests++;
 assert.match(response.headers.get('cache-control')||'',/no-store/);
 assert.equal(response.headers.get('set-cookie'),null,'Machine API must not renew browser sessions');
 assert(!raw.includes(privateMarker),'Machine API exposed report/review/AI evidence');
 assert(!raw.includes(token),'Machine API exposed its service token');
 return {status:response.status,body:JSON.parse(raw),headers:response.headers,raw};
}
async function duplicateAuthorization(instance,values){
 const target=new URL(endpoint+'?'+new URLSearchParams(single('fixture-a')),instance.base);
 const response=await new Promise((resolve,reject)=>{
  const call=httpRequest(target,{headers:['Host',target.host,...values.flatMap(value=>['Authorization','Bearer '+value])]},incoming=>{
   let raw='';incoming.setEncoding('utf8');incoming.on('data',chunk=>raw+=chunk);incoming.on('error',reject);incoming.on('end',()=>{try{resolve({status:incoming.statusCode,headers:incoming.headers,body:JSON.parse(raw)});}catch(error){reject(error);}});
  });
  call.on('error',reject);call.end();
 });
 requests++;
 assert.match(response.headers['cache-control']||'',/no-store/);assert.equal(response.headers['set-cookie'],undefined);
 assert.equal(response.status,401);assert.equal(response.body.error,'unauthorized');
}
const single=(id,name=names.get(id))=>({month,feishuUserId:id,name});
const identity=(id,name=names.get(id))=>({feishuUserId:id,name});
function published(score,value){assert.equal(score.score,value);assert.equal(score.status,'published');assert.equal(score.isFinal,true);assert.equal(score.previousScore,null);assert.equal(typeof score.revision,'string');assert(score.revision.length>0);assert(score.updatedAt);}
function unavailable(score,status){assert.equal(score.score,null);assert.equal(score.status,status);assert.equal(score.isFinal,false);}

try{
 const configured=await startServer('configured',token),before=fingerprint(configured.db),historyBefore=database(configured.db,'SELECT count(*) AS count FROM automatic_performance_results;')[0].count;
 const plain=await request(configured,{params:single('fixture-a')});assert.equal(plain.status,200);assert(plain.body.ok);assert.equal(plain.body.apiVersion,'1');assert.equal(plain.body.month,month);assert(Number.isFinite(Date.parse(plain.body.generatedAt)));assert.deepEqual(plain.body.totals,{requested:1,matched:1,unmatched:0});
 const first=plain.body.data[0];assert.equal(first.matchStatus,'matched');assert.equal(first.employee.feishuUserId,'fixture-a');assert.equal(first.employee.name,'测试甲');assert.equal(first.employee.active,true);published(first.weeklyQuality,86.5);published(first.collaboration360,87);assert.equal(first.weeklyQuality.source,'automatic_report');assert.equal(plain.raw.length<12000,true,'Only compact score summaries should be exported');
 const ids=['fixture-c','fixture-b','fixture-zero','fixture-rescoring','fixture-failed','fixture-pending','fixture-none','fixture-empty','fixture-invalid-json','fixture-invalid-score','fixture-legacy','fixture-inactive','fixture-parentheses','fixture-unicode','fixture-old-weighted'];
 const batch=await request(configured,{method:'POST',body:{month,employees:ids.map(id=>identity(id))}});assert.equal(batch.status,200);assert.deepEqual(batch.body.data.map(row=>row.employee.feishuUserId),ids,'Batch preserves requested order');
 const byId=new Map(batch.body.data.map(row=>[row.employee.feishuUserId,row]));published(byId.get('fixture-c').weeklyQuality,93);published(byId.get('fixture-b').weeklyQuality,71);published(byId.get('fixture-zero').weeklyQuality,0);published(byId.get('fixture-zero').collaboration360,0);
 for(const [id,status,oldScore] of [['fixture-rescoring','rescoring',81],['fixture-failed','rescore_failed',62]]){const score=byId.get(id).weeklyQuality;unavailable(score,status);assert.equal(score.previousScore,oldScore);}
 unavailable(byId.get('fixture-pending').weeklyQuality,'pending_ai');unavailable(byId.get('fixture-none').weeklyQuality,'no_reports');unavailable(byId.get('fixture-empty').weeklyQuality,'not_published');unavailable(byId.get('fixture-empty').collaboration360,'not_published');unavailable(byId.get('fixture-invalid-json').weeklyQuality,'invalid_result');unavailable(byId.get('fixture-invalid-score').weeklyQuality,'invalid_result');
 published(byId.get('fixture-legacy').weeklyQuality,64);published(byId.get('fixture-legacy').collaboration360,60);assert.equal(byId.get('fixture-legacy').weeklyQuality.source,'legacy');assert.equal(byId.get('fixture-legacy').collaboration360.source,'legacy');assert.equal(byId.get('fixture-legacy').employee.name,'测试改名后');published(byId.get('fixture-old-weighted').collaboration360,84);assert.equal(byId.get('fixture-inactive').employee.active,false);published(byId.get('fixture-inactive').weeklyQuality,76);
 const unknown=await request(configured,{params:single('fixture-does-not-exist','测试甲')});assert.equal(unknown.status,200);assert.equal(unknown.body.data[0].matchStatus,'not_found');assert.equal(unknown.body.data[0].employee,null);unavailable(unknown.body.data[0].weeklyQuality,'identity_mismatch');unavailable(unknown.body.data[0].collaboration360,'identity_mismatch');
 const mismatch=await request(configured,{params:single('fixture-a','测试其他姓名')});assert.equal(mismatch.body.data[0].matchStatus,'name_mismatch');unavailable(mismatch.body.data[0].weeklyQuality,'identity_mismatch');unavailable(mismatch.body.data[0].collaboration360,'identity_mismatch');
 const sqlIdentity=await request(configured,{params:single("'OR'1'='1",'测试甲')});assert.equal(sqlIdentity.status,200);assert.equal(sqlIdentity.body.data.length,1);assert.equal(sqlIdentity.body.data[0].matchStatus,'not_found');assert.equal(sqlIdentity.body.data[0].employee,null);assert.deepEqual(sqlIdentity.body.totals,{requested:1,matched:0,unmatched:1});unavailable(sqlIdentity.body.data[0].weeklyQuality,'identity_mismatch');unavailable(sqlIdentity.body.data[0].collaboration360,'identity_mismatch');
 const sqlName=await request(configured,{params:single('fixture-a',"测试甲' OR '1'='1")});assert.equal(sqlName.status,200);assert.equal(sqlName.body.data.length,1);assert.equal(sqlName.body.data[0].matchStatus,'name_mismatch');unavailable(sqlName.body.data[0].weeklyQuality,'identity_mismatch');unavailable(sqlName.body.data[0].collaboration360,'identity_mismatch');
 const parentheses=await request(configured,{params:single('fixture-parentheses','测试员工')});assert.equal(parentheses.body.data[0].matchStatus,'name_mismatch','Do not remove parentheses when matching names');
 const normalized=await request(configured,{params:single('fixture-unicode','  测试E\u0301  ')});assert.equal(normalized.body.data[0].matchStatus,'matched');published(normalized.body.data[0].weeklyQuality,79);
 const inactiveCookie=await request(configured,{params:single('fixture-inactive'),cookieValue:cookie('fixture-inactive')});assert.equal(inactiveCookie.status,200,'Browser identity must not change the machine token scope');
 for(const options of [{authorization:null},{authorization:'wrong-token'},{authorization:'x'.repeat(token.length)},{authorization:null,cookieValue:cookie('fixture-boss')},{authorization:'wrong-token',cookieValue:cookie('fixture-boss')},{authorization:null,params:{...single('fixture-a'),token}}]){
  const denied=await request(configured,{params:single('fixture-a'),...options});assert.equal(denied.status,401);assert.equal(denied.body.error,'unauthorized');
 }
 const other=await fetch(configured.base+'/api/performance/manage?view=overview',{headers:{authorization:'Bearer '+token}});assert.equal(other.status,401);await other.arrayBuffer();
 await duplicateAuthorization(configured,[token,'wrong-token']);await duplicateAuthorization(configured,['wrong-token',token]);
 for(const method of ['PUT','PATCH','DELETE','OPTIONS']){const wrong=await request(configured,{method,params:single('fixture-a')});assert.equal(wrong.status,405);assert.match(wrong.headers.get('allow')||'',/GET/);assert.match(wrong.headers.get('allow')||'',/POST/);}
 const malformed=await request(configured,{method:'POST',rawBody:'{not-valid-json'});assert.equal(malformed.status,400);assert.equal(malformed.body.error,'invalid_score_request');
 const tooLarge=await request(configured,{method:'POST',rawBody:JSON.stringify({month,employees:[identity('fixture-a')],padding:'x'.repeat(70*1024)})});assert.equal(tooLarge.status,413);assert.equal(tooLarge.body.error,'payload_too_large');
 const chunked=await fetch(configured.base+endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:Readable.from(Array.from({length:70},()=>Buffer.from('x'.repeat(1024)))),duplex:'half'});assert.equal(chunked.status,413);assert.equal((await chunked.json()).error,'payload_too_large');assert.match(chunked.headers.get('cache-control')||'',/no-store/);assert.equal(chunked.headers.get('set-cookie'),null);requests++;
 const origin=await request(configured,{method:'POST',body:{month,employees:[identity('fixture-a')]},headers:{origin:'https://untrusted.invalid'}});assert.equal(origin.status,403);assert.equal(origin.body.error,'invalid_origin');
 const extraQuery=await request(configured,{params:{...single('fixture-a'),token}});assert.equal(extraQuery.status,400);assert.equal(extraQuery.body.error,'invalid_score_request');
 const duplicateQuery=new URLSearchParams(single('fixture-a'));duplicateQuery.append('month','2026-09');const repeatedParameter=await request(configured,{params:duplicateQuery});assert.equal(repeatedParameter.status,400);assert.equal(repeatedParameter.body.error,'invalid_score_request');
 const invalidBodies=[{},null,[],{month:'2026-13',employees:[identity('fixture-a')]},{month:'2026-1',employees:[identity('fixture-a')]},{month,employees:[]},{month,employees:{}},{month,employees:[{feishuUserId:'fixture-a'}]},{month,employees:[{name:'测试甲'}]},{month,employees:[identity('ou_fixture_application_specific','测试甲')]},{month,employees:[identity('fixture a','测试甲')]},{month,employees:[identity('fixture-a\u0000','测试甲')]},{month,employees:[identity('fixture-a','')]},{month,employees:[identity('fixture-a',123)]},{month,employees:Array.from({length:101},(_,i)=>identity('fixture-bound-'+i,'测试人数上限'))}];
 for(const body of invalidBodies){const invalid=await request(configured,{method:'POST',body});assert.equal(invalid.status,400,JSON.stringify(body).slice(0,160));assert.equal(invalid.body.error,'invalid_score_request');}
 const duplicate=await request(configured,{method:'POST',body:{month,employees:[identity('fixture-a'),identity('fixture-a')]}});assert.equal(duplicate.status,400);assert.equal(duplicate.body.error,'duplicate_employee_id');
 const boundary=await request(configured,{method:'POST',body:{month,employees:Array.from({length:100},(_,i)=>identity('fixture-bound-'+i,'测试人数上限'))}});assert.equal(boundary.status,200);assert.equal(boundary.body.data.length,100);assert.equal(boundary.body.totals.unmatched,100);
 for(let n=0;n<3;n++){const repeat=await request(configured,{params:single('fixture-a')});assert.equal(repeat.body.data[0].weeklyQuality.revision,first.weeklyQuality.revision);assert.equal(repeat.body.data[0].collaboration360.revision,first.collaboration360.revision);}
 assert.equal(fingerprint(configured.db),before,'Score export must not mutate any database table');assert.equal(database(configured.db,'SELECT count(*) AS count FROM automatic_performance_results;')[0].count,historyBefore,'Repeated exports must not append automatic score history');
 for(const [label,value] of [['disabled',''],['short-token','short-fixture-token']]){
  const disabled=await startServer(label,value),snapshot=fingerprint(disabled.db);
  const response=await request(disabled,{params:single('fixture-a')});assert.equal(response.status,503);assert.equal(response.body.error,'score_api_not_configured');assert.equal(fingerprint(disabled.db),snapshot);
 }
 for(const instance of servers){let external=false;try{await access(instance.externalLog);external=true;}catch{}assert.equal(external,false,'Fixture attempted an external request');}
 const result={ok:true,requests,serverTokenAuthentication:true,disabledByDefault:true,userIdAndNameMatching:true,noNameFallback:true,sameNameIsolation:true,inactiveHistoryReadable:true,monthlyQualityAndWeightedCollaboration:true,zeroScoresPreserved:true,latestRowIdAndLegacyPrecedence:true,rescoreOldScoreSeparated:true,pendingAndInvalidResultsExplicit:true,compactPrivateResponse:true,requestBoundaries:true,allDatabaseTablesUnchanged:true,automaticHistoryRowsUnchanged:historyBefore,externalRequests:0,realMessages:0,productionWrites:0,deletions:0,artifacts};
 await writeFile(artifacts+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){for(const instance of servers)console.error(instance.logs());throw error;}
finally{
 for(const {server} of servers){if(server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}}
 console.log('Test artifacts retained: '+artifacts);
}
