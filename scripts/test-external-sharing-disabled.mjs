import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import {chromium} from 'playwright';

// All identities, links and databases are isolated fixtures retained in outputs.
// No live Feishu calls, data deletion, production or repository writes occur.
await mkdir('outputs/tests',{recursive:true});
const directory=await mkdtemp(path.resolve('outputs/tests/external-sharing-disabled-'));
const staticDir=path.resolve(process.env.TEST_STATIC_DIR||'outputs/no-external-sharing-preview-20261028');
const skipBrowser=process.env.BUSINESS_TEST_SKIP_BROWSER==='true';
if(!skipBrowser)assert(existsSync(staticDir+'/index.html'),'Build the new UI or set TEST_STATIC_DIR before running this suite.');
const quote=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
async function freePort(){const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;}
const results=[];

async function checkMode(mode,devSwitch) {
  const folder=directory+'/'+mode;await mkdir(folder);await mkdir(folder+'/data');
  const db=folder+'/fixture.sqlite';
  function sql(statement,json=false){const result=spawnSync('sqlite3',['-bail','-cmd','.timeout 5000',...(json?['-json']:[]),db],{input:statement,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();}
  sql(await readFile('db/schema.sql','utf8'));
  sql("INSERT INTO employees(user_id,name,department) VALUES('boss','测试老板','管理部'),('admin','测试管理员','管理部'),('member','测试员工','研发部');");
  const token='retained-fixture-token-00000000000000000000000000000000';
  sql(`INSERT INTO external_share_links(id,token_hash,name,scope,created_by_user_id,created_by_name,expires_at,status,access_count)
    VALUES('retained-link',${quote(createHash('sha256').update(token).digest('hex'))},'历史分享记录','boss_view','boss','测试老板','2099-12-31T00:00:00.000Z','active',7);`);
  const revokedId='revoked-external-fixture';
  sql(`INSERT INTO revoked_sessions(session_id,expires_at,reason) VALUES(${quote(revokedId)},'2099-12-31T00:00:00.000Z','isolated_fixture');`);
  const linksBefore=sql('SELECT * FROM external_share_links ORDER BY id;',true);
  for(const name of ['prototypeData','scoring360','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights'])await writeFile(folder+'/data/'+name+'.json',JSON.stringify(name==='prototypeData'?{meta:{periods:[]},employee_summary:[],weekly_scores:[]}:name==='scoring360'?{cycles:[],assignments:[],responses:[],results:[]}:{}));
  await writeFile(folder+'/block-external.mjs',`import {appendFile} from 'node:fs/promises'; globalThis.fetch=async input=>{await appendFile(${JSON.stringify(folder+'/unexpected-provider-calls.log')},new URL(String(input)).pathname+'\\n');throw Error('Unexpected external provider request blocked by isolated test');};`);
  const port=await freePort(),base='http://127.0.0.1:'+port,secret='isolated-sharing-disabled-'+mode;
  const env={...process.env,AUTH_MODE:mode,DEV_VIEW_SWITCH_ENABLED:String(devSwitch),SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,APP_DATA_DIR:folder+'/data',WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:folder+'/uploads',LARK_REPORT_SYNC_STATUS_PATH:folder+'/sync.json',BACKUP_DIR:folder+'/backups',STATIC_DIR:staticDir,BOSS_VIEW_USER_IDS:'boss',BOSS_VIEW_NAMES:'',SCORING360_CONFIG_MANAGER_USER_IDS:'admin',SCORING360_CONFIG_MANAGER_NAMES:'',MOCK_USER_ID:'',MOCK_USER_NAME:'',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_APP_ID:'cli_fixture',FEISHU_APP_SECRET:'fixture-secret',MOONSHOT_API_KEY:'',KIMI_API_KEY:''};
  let logs='',browser;
  const server=spawn(process.execPath,['--import',folder+'/block-external.mjs','server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',value=>logs+=value);server.stderr.on('data',value=>logs+=value);
  const sign=payload=>{const body=Buffer.from(JSON.stringify(payload)).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
  const internal=id=>sign({user:{userId:id,name:id==='boss'?'测试老板':id==='admin'?'测试管理员':'测试员工'},sessionId:randomUUID(),issuedAt:Date.now(),expiresAt:new Date(Date.now()+3600000).toISOString()});
  const externalBase={user:{userId:'external:retained-link',name:'历史外部顾问',role:'external_boss_view'},externalShare:{id:'retained-link',scope:'boss_view',expiresAt:new Date(Date.now()+3600000).toISOString()},sessionId:randomUUID(),issuedAt:Date.now(),expiresAt:new Date(Date.now()+3600000).toISOString()};
  const externalVariants=[
    ['current',externalBase],
    ['share-marker-only',{...externalBase,user:{userId:'legacy-share-person',name:'旧分享人'},sessionId:randomUUID()}],
    ['role-only',{...externalBase,externalShare:undefined,user:{userId:'legacy-role-person',name:'旧外部角色',role:'external_boss_view'},sessionId:randomUUID()}],
    ['identity-prefix-only',{...externalBase,externalShare:undefined,user:{userId:'external:prefix-only',name:'旧外部身份'},sessionId:randomUUID()}],
    ['expired',{...externalBase,sessionId:randomUUID(),expiresAt:new Date(Date.now()-1000).toISOString()}],
    ['revoked',{...externalBase,sessionId:revokedId}],
    ['old-unbounded',{...externalBase,sessionId:undefined,expiresAt:undefined}],
    ['invalid-expiry',{...externalBase,sessionId:randomUUID(),expiresAt:'invalid-date'}],
  ];
  async function request(route,{method='GET',cookie,body}={}){const response=await fetch(base+route,{method,redirect:'manual',headers:{...(cookie?{cookie:'wos_session='+cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});const text=await response.text();let value;try{value=JSON.parse(text);}catch{}return {response,text,value,status:response.status};}
  try {
    let ready=false;
    for(let attempt=0;attempt<150;attempt++){if(server.exitCode!==null)throw Error('Fixture exited: '+logs);try{if((await request('/health')).status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    assert(ready,'Fixture failed to become ready');
    for(const route of ['/share','/share/','/share/'+token,'/share/%E0%A4%A','/api/external-links','/api/external-links/','/api/external-links/retained-link'])for(const method of ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']){
      const result=await request(route,{method,cookie:internal('boss'),body:['POST','PUT','PATCH'].includes(method)?{name:'不会创建的分享'}:undefined});assert.equal(result.status,410,mode+' '+method+' '+route);
      if(method!=='HEAD'){
        if(route.startsWith('/api/'))assert.deepEqual(result.value,{ok:false,error:'external_access_disabled'});
        else{assert.match(result.text,/外部|临时访问/);assert.match(result.text,/停用|关闭/);assert.match(result.text,/auth\/login/);}
      }
    }
    for(const route of ['/share/'+token,'/api/external-links','/api/external-links/retained-link'])for(const method of ['GET','POST']){
      const anonymous=await request(route,{method,body:method==='POST'?{name:'匿名不能创建'}:undefined});
      assert.equal(anonymous.status,410,mode+' anonymous '+method+' '+route);
      if(route.startsWith('/api/'))assert.deepEqual(anonymous.value,{ok:false,error:'external_access_disabled'});
      assert.equal(anonymous.response.headers.get('set-cookie'),null,'Disabled links never issue a new session');
    }
    for(const [label,payload] of externalVariants){
      const cookie=sign(payload);
      for(const route of ['/api/me','/api/performance/manage','/api/settings/status','/api/boss-view-members','/api/dev/views','/api/unknown-protected']){
        const result=await request(route,{cookie});assert.equal(result.status,410,mode+' '+label+' '+route);assert.deepEqual(result.value,{ok:false,error:'external_access_disabled'});assert.equal(result.response.headers.get('set-cookie'),null,'Blocked external cookies must not be cleared or renewed into mock fallback');
      }
      const switchAttempt=await request('/api/dev/views',{method:'POST',cookie,body:{id:'boss'}});assert.equal(switchAttempt.status,410,mode+' '+label+' cannot elevate through development switch');assert.equal(switchAttempt.response.headers.get('set-cookie'),null);
      for(const route of ['/?page=dashboard','/index.html']){const page=await request(route,{cookie});assert.equal(page.status,410,mode+' '+label+' protected HTML');assert.match(page.text,/停用|关闭/);}
      assert.equal((await request('/health',{cookie})).status,200);
      const login=await request('/auth/login?provider=feishu',{cookie});assert.equal(login.status,302);assert.match(login.response.headers.get('location'),/^https:\/\/open\.feishu\.cn\//);
      const callback=await request('/auth/feishu/callback',{cookie});assert.equal(callback.status,400);assert.equal(callback.value.error,'invalid_oauth_state');
    }
    const logout=await request('/auth/logout',{method:'POST',cookie:sign(externalBase),body:{}});assert.equal(logout.status,200);assert.match(logout.response.headers.get('set-cookie')||'',/wos_session=/);
    for(const [id,role] of [['boss','boss'],['admin','system_admin'],['member','member']]){const me=await request('/api/me',{cookie:internal(id)});assert.equal(me.status,200);assert.equal(me.value.access.role,role);}
    assert.equal((await request('/api/boss-view-members',{cookie:internal('admin')})).status,200);assert.equal((await request('/api/employees/manage',{cookie:internal('member')})).status,403);
    const normalSwitch=await request('/api/dev/views',{cookie:internal('admin')});assert.equal(normalSwitch.status,devSwitch?200:404);
    if(devSwitch){const switched=await request('/api/dev/views',{method:'POST',cookie:internal('admin'),body:{id:'hr'}});assert.equal(switched.status,200);assert.match(switched.response.headers.get('set-cookie')||'',/wos_session=/);}
    const errors=[];
    if(!skipBrowser){
    browser=await chromium.launchPersistentContext(folder+'/browser',{channel:'chrome',headless:true,viewport:{width:1440,height:1000}});await browser.addCookies([{name:'wos_session',value:internal('admin'),url:base}]);const page=await browser.newPage(),externalRequests=[];page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/external-links'))externalRequests.push({method:request.method(),url:request.url()});});
    await page.goto(base+'/?page=settings&settingsTab=permissions');await page.getByRole('heading',{name:'把权限，交给合适的人。',exact:true}).waitFor();await page.locator('.ra-table').waitFor();assert.equal(await page.locator('.external-access-panel').count(),0);assert.equal(await page.getByRole('heading',{name:'外部顾问临时访问链接',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'生成访问链接',exact:true}).count(),0);assert.deepEqual(externalRequests,[]);await page.screenshot({path:folder+'/internal-permissions-only.png',fullPage:true});
    await page.goto(base+'/share/'+token);await page.getByText(/停用|关闭/).first().waitFor();await page.screenshot({path:folder+'/old-share-disabled.png',fullPage:true});assert.deepEqual(errors,[]);await browser.close();browser=null;
    }
    assert.deepEqual(sql('SELECT * FROM external_share_links ORDER BY id;',true),linksBefore,'Historical links and access counts are preserved');assert.equal(sql('SELECT count(*) FROM employees;'),'3');assert.equal(sql('SELECT count(*) FROM employee_sso_logins;'),'0');assert.equal(sql('SELECT count(*) FROM scoring360_cycles;'),'0');assert.equal(sql('PRAGMA integrity_check;'),'ok');assert(!existsSync(folder+'/unexpected-provider-calls.log'),'No live provider call was attempted');
    const result={ok:true,mode,developmentSwitch:devSwitch,disabledEntryMethods:49,anonymousEntriesDenied:true,blockedExternalCookieVariants:externalVariants.length,oldSessionsCannotUseDevSwitch:true,blockedCookiesRetained:true,employeeLoginAndLogoutPreserved:true,internalRolesPreserved:true,browserChecked:!skipBrowser,settingsModuleAbsent:skipBrowser?undefined:true,noExternalListRequests:skipBrowser?undefined:true,retainedHistory:true,browserErrors:skipBrowser?undefined:errors,realProviderCalls:0,artifacts:folder};results.push(result);await writeFile(folder+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } catch(error){await writeFile(folder+'/server.log',logs);throw error;} finally {if(browser)await browser.close();server.kill('SIGTERM');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));await writeFile(folder+'/server.log',logs);}
}

try {await checkMode('mock',true);await checkMode('feishu',false);await writeFile(directory+'/result.json',JSON.stringify({ok:true,modes:results,browserChecked:!skipBrowser,realProviderCalls:0,realMessagesSent:0,artifacts:directory},null,2));console.log(JSON.stringify({ok:true,modes:results.length,browserChecked:!skipBrowser,realProviderCalls:0,artifacts:directory}));}
finally {console.log('Artifacts retained:',directory);}
