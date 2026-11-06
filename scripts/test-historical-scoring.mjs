import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import path from 'node:path';
import {chromium} from 'playwright';
import {createDepartments} from '../server/departments.mjs';
import {createManagerReviews} from '../server/manager-reviews.mjs';
import {createScoringSetup} from '../server/scoring-setup.mjs';
import {createScoringWorkbench} from '../server/scoring-workbench.mjs';

// Every identity, grade and provider response in this script is synthetic.
// The child process blocks all outbound network calls, and retains artifacts.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/historical-scoring-')),db=dir+'/fixture.sqlite',data=dir+'/data';await mkdir(data);
const quote=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{const r=spawnSync('sqlite3',['-bail','-cmd','.timeout 10000',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout.trim();};
const query=async statement=>run(statement,true).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==null?'':String(value)]))),exec=async statement=>run(statement);
run(await readFile('db/schema.sql','utf8'));
run(`INSERT INTO employees(user_id,name,department,manager_user_id) VALUES('boss','虚构老板','管理',''),('admin','虚构管理员','管理','head'),('head','虚构负责人','测试团队',''),('staff','虚构被评员工','测试团队','head'),('peer','虚构评分同事','测试团队','head'),('unassigned','虚构未配评人员','测试团队','head'); INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('team','测试团队','head',datetime('now')); INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) SELECT 'hire-'||user_id,user_id,'2026-01-01','fixture' FROM employees; INSERT INTO app_settings(key,value_json) VALUES('report_automation_config','{"enabled":false,"intervalMinutes":15}');`);
function cycle(month,status='draft',launch=null,assignment=true){
 run(`INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES(${quote(month+'-360')},${quote(month+'虚构评分')},${quote(month+'-01')},${quote(month+'-28')},${quote(status)},${quote(launch)});`);
 if(assignment)run(`INSERT INTO scoring360_assignments(id,cycle_id,evaluee_user_id,evaluator_user_id,evaluee_name,evaluator_name) VALUES(${quote(month+'-link')},${quote(month+'-360')},'staff','peer','虚构被评员工','虚构评分同事');`);
}
cycle('2026-10');cycle('2026-09','closed');cycle('2026-08','draft','2026-08-01T00:00:00Z');cycle('2026-07','draft',null,false);cycle('2026-06');cycle('2026-05');cycle('2026-04');cycle('2026-02');cycle('2026-01');cycle('2026-11','open','2026-11-01T00:00:00Z');
run(`INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('june-response','2026-06-link','2026-06-360','虚构被评员工','虚构评分同事',80,'虚构已完成互评'); INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES('2026-06','staff','虚构被评员工','collaboration','{"score":80}','{}','fixture','2026-06-30');`);
const employees=async()=>(await query('SELECT * FROM employees WHERE is_active=1;')).map(e=>({userId:e.user_id,name:e.name,department:e.department,managerUserId:e.manager_user_id}));
const now=()=>new Date('2026-11-05T08:00:00Z'),organization=createDepartments({query,exec,sql:quote,employees}),reviews=createManagerReviews({query,exec,sql:quote,organization:organization.overview,isBossUserId:id=>id==='boss',now}),setup=createScoringSetup({query,exec,sql:quote,isBoss:id=>id==='boss',now}),options={query,exec,sql:quote,setup,managerReviews:reviews,bossMembers:()=>[{userId:'boss',name:'虚构老板'}],now},workbench=createScoringWorkbench(options),actor={userId:'admin',name:'虚构管理员'};
const body=async(month,extra={})=>({month,cycleId:month+'-360',revision:(await workbench.overview(month)).revision,action:'openHistorical',confirmed:true,...extra});
const snapshots=()=>JSON.stringify(['scoring360_assignments','scoring360_responses','monthly_manager_scores','all_department_leader_scores','monthly_review_plans'].map(table=>[table,run('SELECT * FROM '+table+' ORDER BY 1;',true)]));
assert.equal((await workbench.overview('2026-10')).canOpenHistorical,true,'unassigned current employees must not expand an old cycle');
for(const [month,error] of [['2026-09','historical_draft_required'],['2026-08','historical_draft_required'],['2026-07','scoring_assignments_required'],['2026-06','result_locked'],['2026-03','historical_cycle_required'],['2026-11','historical_month_required']])await assert.rejects(()=>body(month).then(value=>workbench.mutate(value,actor)),new RegExp(error));
await assert.rejects(()=>body('2026-10',{confirmed:false}).then(value=>workbench.mutate(value,actor)),/historical_confirmation_required/);
await assert.rejects(()=>body('2026-10',{revision:'stale'}).then(value=>workbench.mutate(value,actor)),/setup_changed/);
await assert.rejects(()=>body('2026-10',{cycleId:'2026-04-360'}).then(value=>workbench.mutate(value,actor)),/setup_changed/);
run("INSERT INTO employees(user_id,name,department,is_active) VALUES('stopped','虚构停用评分人','测试团队',0); UPDATE scoring360_assignments SET evaluator_user_id='stopped' WHERE id='2026-01-link';");
await assert.rejects(()=>body('2026-01').then(value=>workbench.mutate(value,actor)),/historical_assignment_invalid/);
run("UPDATE scoring360_assignments SET evaluator_user_id='staff' WHERE id='2026-01-link';");
await assert.rejects(()=>body('2026-01').then(value=>workbench.mutate(value,actor)),/historical_assignment_invalid/);
await assert.rejects(()=>setup.assign('2026-10',[{evalueeUserId:'staff',evaluatorUserId:'head'}]),/editable_month_required/);
await assert.rejects(()=>body('2026-10',{action:'launch'}).then(value=>workbench.mutate(value,actor)),/editable_month_required/);
const before=snapshots(),opened=await workbench.mutate(await body('2026-04'),actor);assert.equal(opened.cycle.status,'open');assert.equal(opened.editable,false);assert.equal(opened.messagesSent,0);assert.equal(snapshots(),before,'opening must never create grades, plans or relationships');
const audit=run("SELECT * FROM system_operation_logs WHERE action='月度配评：历史草稿开放补评';",true);assert.equal(audit.length,1);assert.equal(audit[0].actor_user_id,'admin');assert.equal(JSON.parse(audit[0].details_json).cycleId,'2026-04-360');
let race=true;const racing=createScoringWorkbench({...options,exec:async statement=>{if(race&&statement.startsWith('BEGIN IMMEDIATE')){race=false;run(`INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('may-response','2026-05-link','2026-05-360','虚构被评员工','虚构评分同事',80,'虚构并发互评'); INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES('2026-05','staff','虚构被评员工','collaboration','{"score":80}','{}','fixture','2026-05-30');`);}return exec(statement);}});
await assert.rejects(()=>body('2026-05').then(value=>racing.mutate(value,actor)),/setup_changed/);
assert.equal(run("SELECT status FROM scoring360_cycles WHERE id='2026-05-360';"),'draft');assert.equal(run("SELECT count(*) FROM system_operation_logs WHERE action='月度配评：历史草稿开放补评';"),'1','a concurrent publication must prevent both cycle change and audit success');

for(const name of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights'])await writeFile(data+'/'+name+'.json',JSON.stringify(name==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:name==='scoring360'?{cycles:[],assignments:[],responses:[]}:{}));
const statusFile=dir+'/sync-status.json',priorStatus={ok:true,running:true,phase:'analyze',mode:'rescore',targetMonth:'2026-10',rowCount:25,analyzed:5,failed:3,cached:7,remaining:10,active:2,errors:['fixture-error'],diagnostics:[{code:'upstream_rate_limited',httpStatus:429}],byMonth:{'2026-10':{total:25,completed:5,failed:3,cached:7,remaining:10,active:2}},customCheckpoint:'preserve-me'};
await writeFile(statusFile,JSON.stringify(priorStatus));
await writeFile(dir+'/network-guard.mjs',`import {appendFileSync} from 'node:fs';const RealDate=Date,stamp=Date.parse('2026-11-05T08:00:00Z');globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return stamp;}};globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(dir+'/outbound.log')},'blocked\\n');throw Error('fixture_outbound_forbidden');};`);
const skipBrowser=process.env.BUSINESS_TEST_SKIP_BROWSER==='true';
let staticDir=process.env.TEST_STATIC_DIR;
if(!staticDir){staticDir=dir+'/static';if(skipBrowser)await mkdir(staticDir);else{const built=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',staticDir,'--emptyOutDir','false'],{encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(built.status,0,built.stderr);}}
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base='http://127.0.0.1:'+port,secret='isolated-historical-scoring-test-secret';
const env={...process.env,AUTH_MODE:'feishu',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',BACKUP_DIR:dir+'/backups',STATIC_DIR:staticDir,LARK_REPORT_SYNC_STATUS_PATH:statusFile,BOSS_VIEW_USER_IDS:'boss',BOSS_VIEW_NAMES:'',SCORING360_CONFIG_MANAGER_USER_IDS:'admin',SCORING360_CONFIG_MANAGER_NAMES:'',DEV_VIEW_SWITCH_ENABLED:'false',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:''};
const cookie=(id='admin')=>{const payload=Buffer.from(JSON.stringify({user:{userId:id,name:id==='boss'?'虚构老板':id==='admin'?'虚构管理员':id==='peer'?'虚构评分同事':'虚构被评员工'},issuedAt:now().getTime(),expiresAt:'2026-11-06T08:00:00Z',sessionId:randomUUID()})).toString('base64url');return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');};
async function api(route,id='admin',value,origin){const response=await fetch(base+route,{method:value?'POST':'GET',headers:{...(id?{cookie:'wos_session='+cookie(id)}:{}),'content-type':'application/json',...(origin?{origin}:{})},body:value?JSON.stringify(value):undefined});return {status:response.status,body:await response.json()};}
let server,logs='',browser,context,page;const errors=[];
async function start(){server=spawn(process.execPath,['--import',dir+'/network-guard.mjs','server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',data=>logs+=data);server.stderr.on('data',data=>logs+=data);for(let i=0;i<160;i++){assert.equal(server.exitCode,null,logs);try{if((await fetch(base+'/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw Error('server startup timed out');}
async function stop(){if(server?.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}}
try{
 await start();
 const interrupted=JSON.parse(await readFile(statusFile,'utf8'));for(const key of ['mode','targetMonth','rowCount','analyzed','failed','cached','remaining','errors','diagnostics','customCheckpoint'])assert.deepEqual(interrupted[key],priorStatus[key],key+' survives restart');assert.equal(interrupted.phase,'interrupted');assert.equal(interrupted.active,0);assert.equal(interrupted.byMonth['2026-10'].active,0);assert.equal(interrupted.byMonth['2026-10'].completed,5);assert.equal(interrupted.running,false);assert(interrupted.interruptedAt);
 const checkpoint=(await api('/api/lark-report-sync')).body.status;assert.equal(checkpoint.targetMonth,'2026-10');assert.equal(checkpoint.rowCount,25);assert.deepEqual(checkpoint.diagnostics,priorStatus.diagnostics);
 await stop();const inactiveStatus=await readFile(statusFile,'utf8');await start();assert.equal(await readFile(statusFile,'utf8'),inactiveStatus,'a restart without an in-flight job must not rewrite status');
 const fresh=()=>api('/api/scoring360/workbench?month=2026-10');
 const request={...(await fresh()).body,action:'openHistorical',cycleId:'2026-10-360',confirmed:true};
 assert.equal((await api('/api/scoring360/workbench','peer',request)).status,403);assert.equal((await api('/api/scoring360/workbench',null,request)).status,403);assert.equal((await api('/api/scoring360/workbench','admin',request,'https://cross-site.invalid')).status,403);
 assert.equal((await api('/api/scoring360/workbench','admin',request,'not-a-url')).status,403);
 assert.equal((await api('/api/scoring360/my-tasks?month=2026-10','peer')).body.tasks.length,0);
 assert.equal((await api('/api/scoring360/my-tasks?month=2026-03','peer')).body.cycleId,'','a missing month must not fall back to the open current month');
 assert.equal((await api('/api/scoring360/my-tasks?month=2026-13','peer')).status,400);
 assert.equal((await api('/api/scoring360/my-tasks?month=2026-10&cycleId=2026-11-360','peer')).status,400);
 assert.equal((await api('/api/admin/employee-preview/scoring-tasks?employeeId=peer&month=2026-03')).body.cycleId,'');
 const humanBefore=snapshots();
 if(!skipBrowser){
 browser=await chromium.launch({channel:'chrome',headless:true});context=await browser.newContext({viewport:{width:1440,height:1050}});await context.addCookies([{name:'wos_session',value:cookie(),url:base}]);page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/?page=scores&scoreTab=setup&scoreMonth=2026-10');
 await page.getByRole('button',{name:'开放历史月份补评',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'开放2026年10月补评',exact:true});await dialog.waitFor();
 await dialog.getByText('请确认需要补评的月份',{exact:true}).waitFor();assert.equal((await fresh()).body.cycle.status,'draft','viewing the confirmation never opens or grades');
 await page.screenshot({path:dir+'/historical-confirmation.png',fullPage:true,animations:'disabled'});
 await dialog.getByRole('button',{name:'确认开放2026年10月补评',exact:true}).click();await dialog.waitFor({state:'detached'});
 }else assert.equal((await api('/api/scoring360/workbench','admin',request)).status,200,'the CI API path still explicitly opens the historical draft');
 assert.equal((await fresh()).body.cycle.status,'open');assert.equal((await fresh()).body.editable,false);assert.equal(snapshots(),humanBefore);
 const history=(await api('/api/scoring360/my-tasks?month=2026-10','peer')).body;assert.equal(history.month,'2026-10');assert.equal(history.cycleId,'2026-10-360');assert.equal(history.tasks.length,1);assert.equal(history.tasks[0].locked,false);
 assert.equal((await api('/api/scoring360/workbench','boss',{...(await api('/api/scoring360/workbench?month=2026-02')).body,action:'openHistorical',cycleId:'2026-02-360',confirmed:true})).status,200,'boss retains the same explicit capability');
 if(!skipBrowser){
 await context.clearCookies();await context.addCookies([{name:'wos_session',value:cookie('peer'),url:base}]);
 await page.goto(base+'/?page=scores');
 const picker=page.getByRole('button',{name:'协作评分月份',exact:true});await picker.waitFor();await picker.click();await page.getByRole('button',{name:'2026 年 10 月',exact:true}).click();
 const taskSection=page.locator('.pf-scoring');await taskSection.getByRole('heading',{name:'虚构被评员工',exact:true}).waitFor();await taskSection.getByRole('spinbutton').fill('73');await taskSection.getByRole('textbox').fill('未保存的十月草稿');
 await picker.click();await page.getByRole('button',{name:'2026 年 11 月',exact:true}).click();await taskSection.getByRole('heading',{name:'虚构被评员工',exact:true}).waitFor();assert.equal(await taskSection.getByRole('spinbutton').inputValue(),'','month switch must clear a draft even for the same employee');
 await picker.click();await page.getByRole('button',{name:'2026 年 10 月',exact:true}).click();await taskSection.getByRole('heading',{name:'虚构被评员工',exact:true}).waitFor();assert.equal(await taskSection.getByRole('spinbutton').inputValue(),'');await taskSection.getByRole('spinbutton').fill('80');await taskSection.getByRole('textbox').fill('虚构历史月份实际协作评价');
 const write=page.waitForRequest(request=>request.url().endsWith('/api/scoring360/submit'));await taskSection.getByRole('button',{name:'提交积分',exact:true}).click();const payload=(await write).postDataJSON();assert.equal(payload.cycleId,'2026-10-360');assert.equal(payload.scores[0].assignmentId,'2026-10-link');await taskSection.getByText('评分已提交，同事互评占70%；负责人或老板评分占30%，两部分完成后自动发布最终分。',{exact:true}).waitFor();assert.equal(run("SELECT count(*) FROM scoring360_responses WHERE cycle_id='2026-11-360';"),'0');
 // A late October response must not paint over November after a rapid switch.
 await picker.click();await page.getByRole('button',{name:'2026 年 11 月',exact:true}).click();await taskSection.getByRole('heading',{name:'虚构被评员工',exact:true}).waitFor();
 let releaseLate,finishLate;const lateDone=new Promise(resolve=>{finishLate=resolve;});
 const delayed='**/api/scoring360/my-tasks?month=2026-10';
 await page.route(delayed,async route=>{try{const response=await route.fetch(),value=await response.json();value.tasks[0].evaluee='旧月份迟到数据';await new Promise(resolve=>{releaseLate=resolve;});await route.fulfill({response,json:value});}catch{/* Aborting the selected-month fetch is expected. */}finally{finishLate();}});
 await picker.click();await page.getByRole('button',{name:'2026 年 10 月',exact:true}).click();for(let i=0;i<100&&!releaseLate;i++)await new Promise(resolve=>setTimeout(resolve,20));assert(releaseLate,'delayed selected-month request was observed');
 await picker.click();await page.getByRole('button',{name:'2026 年 11 月',exact:true}).click();await taskSection.getByRole('heading',{name:'虚构被评员工',exact:true}).waitFor();releaseLate();await lateDone;assert.equal(await taskSection.getByRole('heading',{name:'旧月份迟到数据',exact:true}).count(),0);assert.match(await picker.innerText(),/11/);await page.unroute(delayed);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:dir+'/historical-tasks-mobile.png',fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth+1));
 }else{
  const submitted=await api('/api/scoring360/submit','peer',{cycleId:history.cycleId,scores:[{assignmentId:history.tasks[0].id,score:80,comment:'虚构历史月份实际协作评价'}]});assert.equal(submitted.status,200);assert.equal(submitted.body.saved,1);
 }
 assert.equal(run("SELECT count(*) FROM scoring360_responses WHERE cycle_id='2026-10-360';"),'1');assert.equal(run("SELECT count(*) FROM scoring360_responses WHERE cycle_id='2026-11-360';"),'0');assert.equal(run("SELECT count(*) FROM all_monthly_weighted_results WHERE month='2026-10';"),'0','a peer rating cannot substitute for missing managerial scores');
 assert.deepEqual(errors,[]);assert.equal(run('SELECT count(*) FROM scoring360_reminder_sends;'),'0');assert.equal(run('SELECT count(*) FROM monthly_score_reminder_deliveries;'),'0');assert.equal(await readFile(dir+'/outbound.log','utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;}),'','providers and messaging must never be called');assert.equal(run('PRAGMA integrity_check;'),'ok');
 console.log(JSON.stringify({ok:true,historicalDraftOnly:true,explicitConfirmation:true,existingRelationshipsUnchanged:true,noDefaultScores:true,closedAndPublishedRejected:true,ordinaryHistoricalEditsLocked:true,publicationRaceGuard:true,managerAndBossAuthorization:true,strictTaskMonth:true,monthDraftIsolation:!skipBrowser,browserSkipped:skipBrowser,correctSubmitCycle:true,startupCheckpointPreserved:true,noRestartWithoutRunningWrite:true,outboundRequests:0,artifacts:dir}));
}catch(error){console.error(logs);throw error;}
finally{if(browser)await browser.close();await stop();await writeFile(dir+'/server.log',logs);console.log('Artifacts retained:',dir);}
