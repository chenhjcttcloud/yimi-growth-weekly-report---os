import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';

// Kept, isolated database and browser fixtures. Scoring POSTs are intercepted;
// no external services, real accounts, data cleanup or messages are used.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/score-month-sync-')),db=dir+'/test.sqlite',data=dir+'/data';await mkdir(data);
const sql=statement=>{const result=spawnSync('sqlite3',['-bail',db],{input:statement,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
sql(await readFile('db/schema.sql','utf8'));
sql("INSERT INTO employees(user_id,name,department,is_active) VALUES('admin','测试管理员','管理部',1),('head','测试负责人','测试团队',1),('pending','待评同事','测试团队',1);");
for(const name of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights'])await writeFile(data+'/'+name+'.json',JSON.stringify(name==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:name==='scoring360'?{cycles:[],assignments:[],responses:[],results:[]}:{}));
const current=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7),previousDate=new Date(current+'-01T00:00:00Z');previousDate.setUTCMonth(previousDate.getUTCMonth()-1);const previous=previousDate.toISOString().slice(0,7);
const months=[current,previous],monthLabel=month=>`${Number(month.slice(0,4))} 年 ${Number(month.slice(5))} 月`;
const secret='isolated-score-month-sync',port=15700+Math.floor(Math.random()*250),base='http://127.0.0.1:'+port;
const guard=dir+'/network-guard.mjs';await writeFile(guard,"import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync("+JSON.stringify(dir+'/blocked-outbound.log')+",'blocked\\n');throw Error('fixture_network_disabled');};");
const env={...process.env,AUTH_MODE:'mock',DEV_VIEW_SWITCH_ENABLED:'false',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',LARK_REPORT_SYNC_STATUS_PATH:dir+'/sync.json',BACKUP_DIR:dir+'/backups',STATIC_DIR:process.env.TEST_STATIC_DIR||'outputs/score-month-sync-preview-20261029',BOSS_VIEW_USER_IDS:'',BOSS_VIEW_NAMES:'',SCORING360_CONFIG_MANAGER_USER_IDS:'admin',SCORING360_CONFIG_MANAGER_NAMES:'',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',FEISHU_EVENT_VERIFICATION_TOKEN:'',FEISHU_EVENT_ENCRYPT_KEY:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:''};
let logs='',browser;
const server=spawn(process.execPath,['--import',guard,'server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',text=>logs+=text);server.stderr.on('data',text=>logs+=text);
const cookie=id=>{const body=Buffer.from(JSON.stringify({user:{userId:id,name:id==='admin'?'测试管理员':'测试负责人'},issuedAt:Date.now()})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
const statistics={expected:4,submitted:4,onTime:4,late:0,missing:0,rate:100,pendingTimestamp:0,pendingCalendar:0};
const quality=month=>month===current?89:78;
const management={ok:true,months,employees:[{userId:'pending',name:'待评同事',department:'测试团队',active:true}],monthly:months.map(month=>({month,userId:'pending',name:'待评同事',department:'测试团队',reports:[],timeliness:statistics,managerProgress:{kind:'manager',expected:1,submitted:0,complete:false,score:null},peerCandidate:null,collaborationSubmitted:0,collaborationExpected:0})),results:months.map(month=>({month,employee_user_id:'pending',employee_name:'待评同事',kind:'quality',result:{score:quality(month)},scoring_rule:'automatic_report',evidence_json:'{}',confirmed_by:'系统自动计算',confirmed_at:'2026-10-01T00:00:00Z'})),collaborations:[]};
const tasks=new Map(months.map(month=>[month,[{employeeUserId:'pending',name:'待评同事',department:'测试团队',submitted:false,locked:false,reports:[{id:'report-'+month,start:month+'-05',end:month+'-09',aiReference:quality(month),facts:[{module:'本周成果',text:month+' 的真实输入测试记录，仅存在隔离fixture。'}]}]}]]));
let failSubmit=false,submitGate=null,getGate=null,gatedMonth='',posts=[],gets=[],abortedResponses=0;
try{
 let ready=false;for(let attempt=0;attempt<150;attempt++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready);
 const originalEmployees=sql('SELECT * FROM employees ORDER BY user_id;'),originalScores=sql('SELECT count(*) FROM monthly_manager_scores;');
 browser=await chromium.launchPersistentContext(dir+'/browser',{channel:'chrome',headless:true,viewport:{width:1600,height:1100}});await browser.addCookies([{name:'wos_session',value:cookie('admin'),url:base}]);
 const page=await browser.newPage(),errors=[],writes=[];page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&!new URL(request.url()).pathname.startsWith('/api/usage/'))writes.push(new URL(request.url()).pathname);});
 await page.route('**/api/usage/**',route=>route.fulfill({status:200,json:{ok:true}}));
 await page.route('**/api/performance/manage*',route=>route.fulfill({status:200,json:management}));
 await page.route('**/api/manager-reviews*',async route=>{
  const request=route.request();
  if(request.method()==='GET'){
   const month=new URL(request.url()).searchParams.get('month');gets.push(month);if(getGate&&month===gatedMonth)await getGate;
   try{return await route.fulfill({status:200,json:{ok:true,month,canReview:true,hasResponsibilities:true,tasks:tasks.get(month)||[]}});}catch(error){if(request.failure()?.errorText){abortedResponses++;return;}throw error;}
  }
  assert.equal(request.method(),'POST');const body=request.postDataJSON();posts.push(body);assert.deepEqual(Object.keys(body).sort(),['comment','employeeUserId','month','score']);if(submitGate)await submitGate;
  if(failSubmit)return route.fulfill({status:503,json:{ok:false,error:'fixture_submit_failed'}});
  Object.assign(tasks.get(body.month)[0],{submitted:true,locked:true,score:Number(body.score),comment:body.comment});return route.fulfill({status:200,json:{ok:true}});
 });
 await page.goto(base+'/?page=scores&scoreTab=results');const panel=page.locator('.manager-reviews-panel'),top=page.getByRole('combobox',{name:'选择绩效月份',exact:true});await panel.locator('.mr-review-card').waitFor();
 assert.equal(await top.count(),1);assert.equal(await panel.getByRole('button',{name:'负责人评分月份',exact:true}).count(),0,'management page must not render a second month picker');assert.equal(await page.locator('.pf-month-select').count(),1);
 const summaryMonth=page.locator('.pf-person-heading p');await summaryMonth.getByText('月度结果 · '+monthLabel(current),{exact:true}).waitFor();
 async function choose(month,wait=true){await top.click();const request=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/manager-reviews'&&new URL(request.url()).searchParams.get('month')===month);await page.getByRole('option',{name:monthLabel(month),exact:true}).click();await request;if(wait)await panel.locator('.mr-review-card').waitFor();}
 await choose(previous);await summaryMonth.getByText('月度结果 · '+monthLabel(previous),{exact:true}).waitFor();assert(gets.includes(previous));assert((await top.innerText()).includes(monthLabel(previous)));
 const score=panel.getByRole('spinbutton',{name:'待评同事负责人评分',exact:true}),comment=panel.getByRole('textbox',{name:'待评同事月度评价',exact:true}),submit=panel.getByRole('button',{name:'提交积分',exact:true});
 await score.fill('84.5');await comment.fill('前月已核实交付，保持本次选定月份。');failSubmit=true;await submit.click();await panel.getByRole('alert').waitFor();assert.equal(await score.inputValue(),'84.5');assert.equal(await comment.inputValue(),'前月已核实交付，保持本次选定月份。');assert((await top.innerText()).includes(monthLabel(previous)));assert.equal(posts[0].month,previous);
 failSubmit=false;let release;submitGate=new Promise(resolve=>{release=resolve;});const sent=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/manager-reviews'&&request.method()==='POST');await submit.click();await sent;assert(await top.isDisabled(),'shared top month must remain fixed while submitting');assert(await score.isDisabled());assert(await comment.isDisabled());release();submitGate=null;
 await panel.getByText('负责人评分已保存，占月度最终分的30%；同事互评全部完成后自动合成发布。',{exact:true}).waitFor();assert.equal(posts[1].month,previous);assert.equal(posts[1].score,'84.5');assert(await top.isEnabled());assert.equal(await panel.getByRole('spinbutton').count(),0);
 await page.screenshot({path:dir+'/01-one-month-selector.png',fullPage:true});
 // A slower response for the prior selection must not replace the selected month.
 let releaseOld;getGate=new Promise(resolve=>{releaseOld=resolve;});gatedMonth=current;
 await choose(current,false);await panel.getByText('正在读取本月评分任务…',{exact:true}).waitFor();assert(await top.isVisible());assert(await top.isEnabled());
 await choose(previous);await panel.getByText('前月已核实交付，保持本次选定月份。',{exact:true}).waitFor();releaseOld();getGate=null;gatedMonth='';await page.waitForTimeout(250);assert((await top.innerText()).includes(monthLabel(previous)));assert.equal(await panel.getByRole('spinbutton').count(),0);await summaryMonth.getByText('月度结果 · '+monthLabel(previous),{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await top.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth+1));await page.screenshot({path:dir+'/02-mobile-one-selector.png',fullPage:true});
 // A normal reviewer has no management-level month control and retains its own.
 await browser.addCookies([{name:'wos_session',value:cookie('head'),url:base}]);await page.setViewportSize({width:1600,height:1100});await page.goto(base+'/?page=scores');await panel.locator('.mr-review-card').waitFor();assert.equal(await page.getByRole('combobox',{name:'选择绩效月份',exact:true}).count(),0);assert(await panel.getByRole('button',{name:'负责人评分月份',exact:true}).isVisible());
 assert.deepEqual(errors,[]);assert(writes.every(route=>route==='/api/manager-reviews'));assert.equal(posts.length,2);assert.equal(sql('SELECT * FROM employees ORDER BY user_id;'),originalEmployees);assert.equal(sql('SELECT count(*) FROM monthly_manager_scores;'),originalScores);assert.equal(sql('SELECT count(*) FROM weekly_reminder_sends;'),'0');assert.equal(sql('SELECT count(*) FROM monthly_score_reminder_deliveries;'),'0');assert.equal(sql('PRAGMA integrity_check;'),'ok');const blocked=await readFile(dir+'/blocked-outbound.log','utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});assert.equal(blocked,'');
 const result={ok:true,oneManagementMonthSelector:true,managerAndResultsShareMonth:true,submissionUsesSelectedMonth:true,topMonthDisabledWhileSaving:true,failedSubmissionKeepsDraftAndMonth:true,staleResponseIgnored:true,standaloneMonthPickerPreserved:true,mobileNoHorizontalOverflow:true,browserErrors:errors,mockedSubmissions:posts.length,realScoringWrites:0,externalRequests:0,messagesSent:0,artifacts:dir};await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(logs);throw error;}
finally{if(browser)await browser.close();server.kill('SIGTERM');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));await writeFile(dir+'/server.log',logs);console.log('Artifacts retained:',dir);}
