// Run only inside the local OrbStack app container. Sends to one explicitly authorized user.
// All scoring/task/delivery writes go to a fresh isolated test DB; live DB access is read-only.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {createSystemSettings} from '../server/system-settings.mjs';
import {createDepartments} from '../server/departments.mjs';
import {createManagerReviews} from '../server/manager-reviews.mjs';
import {createMonthEndScoreReminders,lastTwoWorkingDays,shanghaiClock} from '../server/month-end-score-reminders.mjs';

const args=process.argv.slice(2),option=key=>args[args.indexOf(key)+1];
const recipientId=args.includes('--recipient-user-id')?option('--recipient-user-id'):'';
if(!args.includes('--send-one-test')||!recipientId||!/^\w{1,64}$/.test(recipientId))throw Error('explicit_single_recipient_required');
if(process.cwd()!=='/app'||process.env.AUTH_MODE!=='mock')throw Error('local_mock_container_only');
const sourceDB=process.env.WEEKLY_REPORT_DB_PATH;
if(!sourceDB?.startsWith('/app/outputs/')||sourceDB.includes('/live/'))throw Error('local_database_required');
const sql=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
function sqlite(db,input,json=false,readonly=false){
 const r=spawnSync('sqlite3',[...(readonly?['-readonly']:[]),'-bail',...(json?['-json']:[]),db],{input,encoding:'utf8'});
 if(r.status)throw Error('sqlite_operation_failed');return json?JSON.parse(r.stdout||'[]'):r.stdout;
}
const liveQuery=async s=>sqlite(sourceDB,s,true,true);
const recipient=(await liveQuery(`SELECT user_id,name,is_active FROM employees WHERE user_id=${sql(recipientId)};`))[0];
if(!recipient||Number(recipient.is_active)!==1)throw Error('active_recipient_required');
const config={sessionSecret:process.env.SESSION_SECRET,feishuAppId:process.env.FEISHU_APP_ID,feishuAppSecret:process.env.FEISHU_APP_SECRET,scoring360ReminderEnabled:process.env.SCORING360_REMINDER_ENABLED==='true'};
if(!config.sessionSecret)throw Error('session_key_missing');
const settings=createSystemSettings({query:liveQuery,exec:()=>{throw Error('live_writes_forbidden');},sql,config});await settings.initialize();
if(!config.feishuAppId||!config.feishuAppSecret)throw Error('feishu_credentials_missing');
const originalSettings=await settings.monthlyReminderConfig();
const originalDeliveries=await liveQuery('SELECT COUNT(*) AS count FROM monthly_score_reminder_deliveries;');

await mkdir('/app/outputs/tests',{recursive:true});const dir=await mkdtemp('/app/outputs/tests/live-month-end-'),db=path.join(dir,'test.sqlite');
const query=async s=>sqlite(db,s,true),exec=async s=>sqlite(db,s);
await exec(await readFile('/app/db/schema.sql','utf8'));
const calendar=JSON.parse(await readFile('/app/src/data/chinaWorkCalendar.json','utf8'));
const clock=shanghaiClock(new Date()),dates=lastTwoWorkingDays(clock.month,calendar),testDate=dates[0];
if(Number(calendar.year)!==Number(clock.month.slice(0,4)))throw Error('test_calendar_year_missing');
let simulatedNow=new Date(testDate+'T10:00:00+08:00');
await exec(`INSERT INTO employees(user_id,name,department,manager_user_id) VALUES(${sql(recipientId)},${sql(recipient.name)},'测试团队',''),('__test_subject__','虚拟测试对象','测试团队',${sql(recipientId)});
INSERT INTO organization_departments VALUES('test-team','测试团队',${sql(recipientId)},datetime('now'));
INSERT INTO scoring360_cycles(id,label,start_date,status,launch_at) VALUES('test-cycle','隔离测试周期',${sql(clock.month+'-01')},'open',${sql(clock.month+'-01T00:00:00Z')});
INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES('test-assignment','test-cycle','虚拟测试对象',${sql(recipient.name)},'__test_subject__',${sql(recipientId)});`);
const employees=async()=> (await query('SELECT * FROM employees WHERE is_active=1;')).map(e=>({userId:e.user_id,name:e.name,department:e.department,managerUserId:e.manager_user_id}));
const departments=createDepartments({query,exec,sql,employees}),reviews=createManagerReviews({query,exec,sql,organization:departments.overview,isBossUserId:id=>id===recipientId});
const testRunId=randomUUID();let attempts=0,acceptedMessageId='',deliveryError=null,token='';
async function sendOne(userId,text,id){
 assert.equal(userId,recipientId);if(attempts++)throw Error('one_message_limit');
 const tokenResponse=await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:config.feishuAppId,app_secret:config.feishuAppSecret}),signal:AbortSignal.timeout(15000)});
 const auth=await tokenResponse.json();if(!tokenResponse.ok||auth.code!==0||!auth.tenant_access_token){deliveryError={stage:'token',code:auth.code||tokenResponse.status};throw Error('feishu_token_failed');}token=auth.tenant_access_token;
 const marked=`【本机测试 · 无需评分】\n${recipient.name}，这是一条经授权发送的成长 OS 月末提醒测试。\n当前实际时间：${new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）。\n本次仅在隔离数据中模拟 ${testDate} 10:00 触发；以下评分任务和数量都是虚拟测试数据，不涉及真实人员成绩，也不需要处理。\n\n${text}\n\n测试结束后不会开启自动群发，也不会修改生产系统。`;
 await writeFile(path.join(dir,'test-message.txt'),marked);
 const response=await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=user_id',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=utf-8'},body:JSON.stringify({receive_id:userId,msg_type:'text',content:JSON.stringify({text:marked}),uuid:createHash('sha256').update(testRunId+':'+id).digest('hex').slice(0,32)}),signal:AbortSignal.timeout(15000)});
 const result=await response.json();if(!response.ok||result.code!==0||!result.data?.message_id){deliveryError={stage:'send',code:result.code||response.status,msg:String(result.msg||'').replaceAll(config.feishuAppSecret,'[redacted]').replaceAll(token,'[redacted]').slice(0,1800),permissionViolations:result.error?.permission_violations,requestId:result.error?.log_id||''};throw Error('feishu_send_failed');}
 acceptedMessageId=result.data.message_id;return acceptedMessageId;
}
const options={query,exec,sql,managerReviews:reviews,bossMembers:()=>[],getSettings:async()=>({enabled:true,time:'10:00',configured:true}),calendar:()=>calendar,baseUrl:'http://192.168.200.118:5180',now:()=>simulatedNow,deliver:sendOne};
const service=createMonthEndScoreReminders(options),preview=await service.preview(clock.month);
assert.equal(preview.recipients.length,1);assert.equal(preview.recipients[0].userId,recipientId);
// A non-month-end day must not invoke the network, even with the test switch enabled.
simulatedNow=new Date(clock.month+'-01T10:00:00+08:00');assert.equal((await service.tick()).skipped,'not_due');assert.equal(attempts,0);
simulatedNow=new Date(testDate+'T10:00:00+08:00');const result=await service.tick();
const duplicate=await createMonthEndScoreReminders(options).tick();assert.equal(duplicate.sent,0);assert.equal(attempts,1);
const currentSettings=await settings.monthlyReminderConfig();assert.deepEqual(currentSettings,originalSettings);
assert.deepEqual(await liveQuery('SELECT COUNT(*) AS count FROM monthly_score_reminder_deliveries;'),originalDeliveries);
const report={ok:result.sent===1,recipient:{userId:recipientId,name:recipient.name},actualTime:new Date().toISOString(),simulatedDate:testDate,scheduledDates:dates,monthlyPipeline:result,duplicateTick:duplicate,networkAttempts:attempts,messageId:acceptedMessageId,deliveryError,liveAutoReminderEnabled:currentSettings.enabled,liveDataUntouched:true,artifacts:dir};
if(acceptedMessageId){
 try{
  const response=await fetch('https://open.feishu.cn/open-apis/im/v1/messages/'+encodeURIComponent(acceptedMessageId),{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)}),readback=await response.json();
  report.messageReadback={ok:response.ok&&readback.code===0&&readback.data?.items?.some(m=>m.message_id===acceptedMessageId),code:readback.code??response.status};
 }catch{report.messageReadback={ok:false,code:'network_error'};}
}
await writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
