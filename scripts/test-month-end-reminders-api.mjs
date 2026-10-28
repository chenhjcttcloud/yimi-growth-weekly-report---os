import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';
await mkdir('outputs/tests',{recursive:true});const dir=await mkdtemp(path.resolve('outputs/tests/month-end-api-')),db=dir+'/test.sqlite',data=dir+'/data';await mkdir(data);
const run=s=>{const r=spawnSync('sqlite3',['-bail','-json',db],{input:s,encoding:'utf8'});if(r.status)throw Error(r.stderr);return s.trim().toUpperCase().startsWith('SELECT')?JSON.parse(r.stdout||'[]'):[];};run(await readFile('db/schema.sql','utf8'));
run("INSERT INTO employees(user_id,name,department) VALUES('head','测试负责人','团队'),('staff','测试员工','团队'),('admin','测试管理员','管理部'); INSERT INTO organization_departments VALUES('team','团队','head',datetime('now'));");
await writeFile(data+'/prototypeData.json',JSON.stringify({meta:{periods:[]},employee_summary:[],weekly_scores:[]}));await writeFile(data+'/scoring360.json','{"cycles":[],"assignments":[],"responses":[]}');
const port=8800+Math.floor(Math.random()*300),base='http://127.0.0.1:'+port,secret='isolated-month-end-test';let logs='',browser;
const server=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,AUTH_MODE:'mock',SESSION_SECRET:secret,SERVER_PORT:String(port),BASE_URL:base,STATIC_DIR:process.env.TEST_STATIC_DIR||'outputs/calendar-auto-preview-20261026',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',APP_DATA_DIR:data,WEEKLY_REPORT_DB_PATH:db,WEEKLY_REPORT_UPLOAD_DIR:dir+'/uploads',BOSS_VIEW_USER_IDS:'boss',BOSS_VIEW_NAMES:'测试老板',SCORING360_CONFIG_MANAGER_USER_IDS:'admin',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',DEV_VIEW_SWITCH_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:''},stdio:['ignore','pipe','pipe']});server.stderr.on('data',x=>logs+=x);
const cookie=id=>{const body=Buffer.from(JSON.stringify({user:{userId:id,name:({boss:'测试老板',admin:'测试管理员',staff:'测试员工'})[id]||id},issuedAt:Date.now()})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
async function call(route,id,body,origin){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{cookie:'wos_session='+cookie(id),'content-type':'application/json',...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
try{
 for(let n=0;n<120;n++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const endpoint='/api/system-settings/monthly-reminders';
 assert.equal((await call(endpoint,'staff')).status,403);assert.equal((await call(endpoint,'staff',{enabled:false,time:'09:30'})).status,403);
 assert.equal((await call(endpoint,'admin')).status,200);const preview=await call(endpoint,'boss');assert.equal(preview.status,200);assert.equal(preview.body.settings.enabled,false);assert.equal(preview.body.calendarUpdate.enabled,false);assert(preview.body.recipients.some(r=>r.userId==='head'));assert(preview.body.recipients.some(r=>r.userId==='boss'));
 assert.equal((await call(endpoint+'?month=2026-99','admin')).status,400);
 assert.equal((await call(endpoint,'admin',{enabled:false,time:'30:00'})).body.error,'invalid_monthly_reminders');assert.equal((await call(endpoint,'admin',{enabled:true,time:'10:00'})).body.error,'feishu_required');
 assert.equal((await call(endpoint,'admin',{enabled:false,time:'09:30'},'https://untrusted.example')).status,403);
 assert.equal((await call(endpoint,'admin',{enabled:false,time:'09:30'})).status,200);assert.equal((await call(endpoint,'boss')).body.settings.time,'09:30');
 assert.equal(run('SELECT count(*) AS n FROM monthly_score_reminder_deliveries;')[0].n,0,'preview/save creates no sends');assert((await call('/api/system-settings/logs','boss')).body.logs.some(l=>l.action==='月末评分提醒设置已保存'));
 browser=await chromium.launchPersistentContext(dir+'/browser-profile',{channel:'chrome',headless:true,viewport:{width:1440,height:1100}});await browser.addCookies([{name:'wos_session',value:cookie('boss'),url:base}]);
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/?page=settings&settingsTab=cycles');
 const region=page.getByRole('region',{name:'月度评分飞书提醒'});await region.getByRole('button',{name:'保存月末提醒设置'}).waitFor();await region.getByLabel('工作日日历更新状态').waitFor();assert.equal(await region.getByRole('checkbox').isChecked(),false);assert.equal(await region.getByLabel('月末提醒发送时间').inputValue(),'09:30');
 await region.getByLabel('月末提醒发送时间').fill('10:00');await region.getByRole('button',{name:'保存月末提醒设置'}).click();await region.getByText('已保存：自动提醒已关闭。',{exact:true}).waitFor();await region.getByText('查看待提醒名单',{exact:false}).click();await region.getByText('测试负责人',{exact:true}).waitFor();
 await page.screenshot({path:dir+'/month-end-settings.png',fullPage:true});await page.reload();await page.getByRole('region',{name:'月度评分飞书提醒'}).getByLabel('月末提醒发送时间').waitFor();assert.equal(await region.getByLabel('月末提醒发送时间').inputValue(),'10:00');assert.deepEqual(errors,[]);
 const overflow=await page.evaluate(()=>({outer:document.documentElement.scrollHeight>window.innerHeight,width:document.documentElement.scrollWidth>window.innerWidth}));assert.equal(overflow.width,false);assert.equal(overflow.outer,false);
 assert.equal(run('SELECT count(*) AS n FROM monthly_score_reminder_deliveries;')[0].n,0);
 console.log(JSON.stringify({ok:true,apiAuthorization:true,validation:true,originGuard:true,noRealSends:true,settingsPersist:true,browserSave:true,layout:overflow,artifacts:dir}));
}catch(e){console.error(logs);throw e;}
finally{if(browser)await browser.close();server.kill('SIGTERM');if(server.exitCode===null)await new Promise(r=>server.once('exit',r));console.log('Artifacts retained:',dir);}
