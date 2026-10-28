import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';

// Retained isolated database and browser fixtures. All directory requests are
// intercepted in the browser; this script never synchronizes a real roster.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/company-roster-ui-')),db=dir+'/test.sqlite',data=dir+'/data';
await mkdir(data);
const sql=statement=>{const result=spawnSync('sqlite3',['-bail',db],{input:statement,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
sql(await readFile('db/schema.sql','utf8'));
sql("INSERT INTO employees(user_id,name,department,is_active) VALUES('admin','测试管理员','管理部',1),('stopped','已停用同事','研发部',0);");
for(const name of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights'])await writeFile(data+'/'+name+'.json',JSON.stringify(name==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:name==='scoring360'?{cycles:[],assignments:[],responses:[],results:[]}:{}));
const port=13900+Math.floor(Math.random()*250),base='http://127.0.0.1:'+port,secret='isolated-company-roster-ui';let logs='',browser;
const env={...process.env,AUTH_MODE:'mock',DEV_VIEW_SWITCH_ENABLED:'false',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',LARK_REPORT_SYNC_STATUS_PATH:dir+'/sync.json',BACKUP_DIR:dir+'/backups',STATIC_DIR:process.env.TEST_STATIC_DIR||'outputs/company-roster-ui-preview-20261028',BOSS_VIEW_USER_IDS:'',BOSS_VIEW_NAMES:'',SCORING360_CONFIG_MANAGER_USER_IDS:'admin',SCORING360_CONFIG_MANAGER_NAMES:'',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:''};
const server=spawn(process.execPath,['server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});server.stderr.on('data',text=>logs+=text);
const body=Buffer.from(JSON.stringify({user:{userId:'admin',name:'测试管理员'},issuedAt:Date.now()})).toString('base64url'),cookie=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
const people=[
  {userId:'admin',name:'测试管理员',department:'管理部',active:true,lastLoginAt:'2026-10-28T06:00:00Z'},
  {userId:'director',name:'未登录负责人',department:'产品部',active:true},
  {userId:'same-1',name:'张同',department:'研发部',active:true},
  {userId:'stopped',name:'已停用同事',department:'研发部',active:false},
  {userId:'name-pending',name:'',department:'运营部',active:true,nameMissing:true},
  ...Array.from({length:30},(_,index)=>({userId:'member-'+index,name:'测试成员'+String(index).padStart(2,'0'),department:index%2?'研发部':'设计部',active:true})),
].map(person=>({...person,source:'feishu_directory',directorySyncedAt:'2026-10-28T07:00:00Z',employmentPeriods:[{start_date:'2026-10-01',source:'feishu'}]}));
let lastSync={total:35,created:3,updated:31,preservedInactive:1,failed:0,failedUserIds:[],missingNames:1,scannedDepartments:12,coverage:'visible_scope',expectedCompanyTotal:36,scopeComplete:false,incomplete:true,notReturnedLocalCount:0,finishedAt:'2026-10-28T07:00:00Z'};
let nextResult={...lastSync},syncPosts=0,statusGets=0,failSync=false,failRoster=false;
try{
  for(let attempt=0;attempt<150;attempt++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  const initialEmployees=sql('SELECT user_id,name,is_active FROM employees ORDER BY user_id;'),initialCycles=sql('SELECT count(*) FROM scoring360_cycles;');
  browser=await chromium.launchPersistentContext(dir+'/browser',{channel:'chrome',headless:true,viewport:{width:1600,height:1000}});await browser.addCookies([{name:'wos_session',value:cookie,url:base}]);
  const page=await browser.newPage(),errors=[],posts=[];page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')posts.push(new URL(request.url()).pathname);});
  await page.route('**/api/employees/manage',route=>route.fulfill({status:failRoster?503:200,json:failRoster?{ok:false}:{ok:true,employees:people}}));
  await page.route('**/api/employees/directory-status',route=>{statusGets++;return route.fulfill({status:200,json:{ok:true,lastSync}});});
  await page.route('**/api/employees/sync-feishu',route=>{
    assert.equal(route.request().method(),'POST');syncPosts++;
    if(failSync)return route.fulfill({status:409,json:{ok:false,error:'directory_permission_or_scope_required'}});
    lastSync={...nextResult};return route.fulfill({status:200,json:{ok:true,...lastSync}});
  });
  await page.goto(base+'/?page=settings&settingsTab=people');const panel=page.locator('.company-roster');
  await panel.getByRole('heading',{name:'公司员工花名册',exact:true}).waitFor();await panel.locator('.company-roster-list>div').nth(34).waitFor();
  assert.equal(syncPosts,0,'opening the page must not start a directory sync');assert(statusGets>0);
  assert.equal(await panel.locator('.company-roster-list>div').count(),35);await panel.getByText('当前仅同步了飞书授权范围内人员',{exact:true}).waitFor();assert.equal(await panel.getByText('本次公司人员同步已完成',{exact:true}).count(),0);
  await panel.getByText('尚不能确认全公司已纳入。请将飞书应用的通讯录可见范围设为「全部员工」，再重新同步。',{exact:true}).waitFor();await panel.getByText('1 人的姓名待补全',{exact:false}).waitFor();
  const unseen=panel.locator('.company-roster-list>div').filter({hasText:'未登录负责人'});await unseen.getByText('已从飞书收录 · 尚未登录',{exact:true}).waitFor();assert.equal(await panel.locator('.employment-dates').count(),35);assert(await panel.locator('.company-roster-list>div').filter({hasText:'已停用同事'}).getByRole('button',{name:'已停用',exact:true}).isDisabled());
  await page.waitForTimeout(500);await page.screenshot({path:dir+'/01-directory-partial.png',fullPage:true});
  const search=panel.getByRole('searchbox',{name:'搜索公司员工'});
  await search.fill('未登录负责人');assert.equal(await panel.locator('.company-roster-list>div').count(),1);
  await search.fill('产品部');assert.equal(await panel.locator('.company-roster-list>div').count(),1);
  await search.fill('same-1');assert.equal(await panel.locator('.company-roster-list>div').count(),1);await panel.locator('.employee-profile strong').filter({hasText:'张同'}).waitFor();
  await search.fill('不存在的人员');await panel.getByText('没有匹配人员，请调整搜索或状态筛选。',{exact:true}).waitFor();await search.fill('');
  await panel.locator('.company-roster-filters').getByRole('button',{name:/^已停用\s*1$/}).click();assert.equal(await panel.locator('.company-roster-list>div').count(),1);await panel.locator('.company-roster-filters').getByRole('button',{name:/^在职\s*34$/}).click();assert.equal(await panel.locator('.company-roster-list>div').count(),34);await panel.locator('.company-roster-filters').getByRole('button',{name:/^全部\s*35$/}).click();
  const sync=panel.getByRole('button',{name:'同步公司全部人员',exact:true});
  await sync.click();await panel.getByText('本次读取 35 人，新增 3 人，更新 31 人，保留已停用 1 人。当前仅覆盖飞书授权范围，尚不能确认全公司已纳入。',{exact:true}).waitFor();assert.equal(syncPosts,1);
  nextResult={...lastSync,total:34,coverage:'company',expectedCompanyTotal:34,scopeComplete:true,incomplete:false,notReturnedLocalCount:1};await sync.click();await panel.getByText('人员已收录，部分资料仍待补全',{exact:true}).waitFor();assert.equal(syncPosts,2);assert.equal(await panel.getByText('本次公司人员同步已完成',{exact:true}).count(),0);await panel.getByText('另有 1 个原有账号本次未返回，已保留，请核实。',{exact:true}).waitFor();await page.screenshot({path:dir+'/02-missing-names.png',fullPage:true});
  people.find(person=>person.userId==='name-pending').name='已补全姓名';people.find(person=>person.userId==='name-pending').nameMissing=false;
  nextResult={...lastSync,missingNames:0,incomplete:false,created:0,updated:34};await sync.click();await panel.getByText('本次公司人员同步已完成',{exact:true}).waitFor();assert.equal(syncPosts,3);assert.equal(await panel.locator('.employee-profile strong').filter({hasText:'姓名待补全'}).count(),0);await panel.getByText('另有 1 个原有账号本次未返回，已保留，请核实。',{exact:true}).waitFor();assert.equal(await panel.locator('.company-roster-list>div').count(),35);await page.screenshot({path:dir+'/03-complete.png',fullPage:true});
  await page.reload();await panel.getByRole('heading',{name:'公司员工花名册',exact:true}).waitFor();await panel.getByText('本次公司人员同步已完成',{exact:true}).waitFor();assert.equal(syncPosts,3,'refresh only reads roster and sync status');assert.equal(new URL(page.url()).searchParams.get('settingsTab'),'people');
  const scroll=await panel.locator('.company-roster-list').evaluate(element=>({height:element.clientHeight,total:element.scrollHeight,overflow:getComputedStyle(element).overflowY}));assert(scroll.total>scroll.height);assert.equal(scroll.overflow,'auto');
  assert(await page.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1&&document.scrollingElement.scrollWidth<=innerWidth+1));
  failSync=true;await sync.click();await panel.getByRole('alert').filter({hasText:'通讯录同步未完成。'}).waitFor();assert.equal(syncPosts,4);assert.equal(await panel.locator('.company-roster-list>div').count(),35);
  failRoster=true;await panel.getByRole('button',{name:'刷新状态',exact:true}).click();await panel.getByRole('alert').filter({hasText:'花名册暂时加载失败'}).waitFor();assert.equal(await panel.locator('.company-roster-list>div').count(),35);failRoster=false;await panel.getByRole('button',{name:'刷新状态',exact:true}).click();await panel.getByRole('alert').filter({hasText:'花名册暂时加载失败'}).waitFor({state:'hidden'});
  await page.setViewportSize({width:390,height:844});await panel.locator('.company-roster-toolbar').scrollIntoViewIfNeeded();await page.waitForTimeout(300);await page.screenshot({path:dir+'/04-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1&&document.scrollingElement.scrollWidth<=innerWidth+1));assert((await panel.boundingBox()).width<=390);assert.equal(await panel.locator('.company-roster-list').evaluate(element=>getComputedStyle(element).overflowY),'auto');
  assert.deepEqual(errors,[]);assert.equal(sql('SELECT user_id,name,is_active FROM employees ORDER BY user_id;'),initialEmployees);assert.equal(sql('SELECT count(*) FROM scoring360_cycles;'),initialCycles);assert.equal(sql('SELECT count(*) FROM monthly_score_reminder_deliveries;'),'0');assert.equal(sql('PRAGMA integrity_check;'),'ok');
  assert(posts.filter(route=>!route.startsWith('/api/usage/')).every(route=>route==='/api/employees/sync-feishu'),'no unrelated mutations were sent');
  const result={ok:true,manualSyncOnly:true,searchNameDepartmentAndUserId:true,statusFilters:true,unenrolledSourceLabel:true,incompleteCoverageWarning:true,missingNameWarning:true,completeStatusOnlyWhenComplete:true,unreturnedLocalAccountsPreservedAndExplained:true,reloadReadsOnly:true,syncFailurePreservesRoster:true,loadFailurePreservesRoster:true,desktopAndMobileInternalScroll:true,browserErrors:errors,mockedDirectorySyncRequests:syncPosts,realDirectorySyncs:0,realMessagesSent:0,artifacts:dir};await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(logs);throw error;}finally{if(browser)await browser.close();server.kill('SIGTERM');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));await writeFile(dir+'/server.log',logs);console.log('Artifacts retained:',dir);}
