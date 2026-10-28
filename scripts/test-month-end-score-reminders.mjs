import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createMonthEndScoreReminders,lastTwoWorkingDays,shanghaiClock} from '../server/month-end-score-reminders.mjs';
import {createManagerReviews} from '../server/manager-reviews.mjs';
import {createDepartments} from '../server/departments.mjs';
import {createSystemSettings} from '../server/system-settings.mjs';

await mkdir('outputs/tests',{recursive:true});const dir=await mkdtemp(path.resolve('outputs/tests/month-end-')),db=dir+'/test.sqlite';
const sql=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const run=(input,json=false)=>{const r=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input,encoding:'utf8'});if(r.status)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout;};
const query=async s=>run(s,true),exec=async s=>run(s);run(await readFile('db/schema.sql','utf8'));
const calendar=JSON.parse(await readFile('src/data/chinaWorkCalendar.json','utf8'));
assert.deepEqual(lastTwoWorkingDays('2026-02',calendar),['2026-02-27','2026-02-28'],'Saturday makeup workday counts');
assert.deepEqual(lastTwoWorkingDays('2026-10',calendar),['2026-10-29','2026-10-30']);
assert.deepEqual(lastTwoWorkingDays('2027-01',calendar),['2027-01-28','2027-01-29'],'monthly recurrence, weekend month end');
assert.deepEqual(lastTwoWorkingDays('2026-10',{...calendar,holidayDates:[...calendar.holidayDates,'2026-10-30']}),['2026-10-28','2026-10-29']);
assert.equal(shanghaiClock(new Date('2026-10-28T16:01:00Z')).date,'2026-10-29');
assert.throws(()=>lastTwoWorkingDays('2026-13'),/invalid_month/);

run(`INSERT INTO employees(user_id,name,department,is_active) VALUES('head','负责人','团队',1),('staff','员工','团队',1),('peer','同名','团队',1),('peer2','同名','团队',1),('inactive','停职人员','团队',0);
INSERT INTO organization_departments VALUES('team','团队','head',datetime('now'));
INSERT INTO scoring360_cycles(id,label,start_date,status,launch_at) VALUES('oct','十月','2026-10-01','open','2026-10-20'),('sep','九月','2026-09-01','open','2026-09-20'),('draft','草稿','2026-10-01','draft',NULL),('closed','关闭','2026-10-01','closed','2026-10-20');
INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES('p-head','oct','员工','负责人','staff','head'),('p-peer','oct','员工','同名','staff','peer'),('p-peer2','oct','负责人','同名','head','peer2'),('p-inactive','oct','员工','停职','staff','inactive'),('target-inactive','oct','停职','同名','inactive','peer'),('old','sep','员工','同名','staff','peer'),('draft-a','draft','员工','同名','staff','peer'),('closed-a','closed','员工','同名','staff','peer'),('self','oct','同名','同名','peer','peer');
INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('r-zero','p-peer2','oct','负责人','同名',0,'已评分，零分也完成');`);
const employees=async()=> (await query('SELECT * FROM employees WHERE is_active=1;')).map(p=>({userId:p.user_id,name:p.name,department:p.department,managerUserId:p.manager_user_id}));
const departments=createDepartments({query,exec,sql,employees}),reviews=createManagerReviews({query,exec,sql,organization:departments.overview,isBossUserId:id=>id==='boss'});
let time=new Date('2026-10-29T02:00:00Z'),enabled=false,failPeer=true,completeOnReserve=false;
const calls=[];
const options={query,exec,sql,managerReviews:reviews,bossMembers:()=>[{userId:'boss',name:'老板'}],getSettings:async()=>({enabled,time:'10:00',configured:true}),calendar:()=>calendar,baseUrl:'https://growth.example.test',now:()=>time,deliver:async(id,text,uuid)=>{calls.push({id,text,uuid});if(id==='peer'&&failPeer)throw Error('fake network failure');return 'fake-message-'+uuid;}};
const service=createMonthEndScoreReminders(options);
let preview=await service.preview('2026-10');assert.equal(preview.calendarCovered,true);assert.equal((await service.preview('2027-01')).calendarCovered,false);
assert.equal(preview.recipients.length,3);assert.deepEqual(preview.recipients.find(r=>r.userId==='head').counts,{peer:1,manager:3,boss:0});assert.deepEqual(preview.recipients.find(r=>r.userId==='boss').counts,{peer:0,manager:0,boss:1});assert.equal(preview.recipients.find(r=>r.userId==='peer').counts.peer,1);assert(!preview.recipients.some(r=>r.userId==='inactive'||r.userId==='peer2'));
assert.equal(run('SELECT count(*) AS n FROM monthly_score_reminder_deliveries;',true)[0].n,0,'preview is read only');
assert.equal((await service.tick()).skipped,'disabled');enabled=true;time=new Date('2026-10-28T02:00:00Z');assert.equal((await service.tick()).skipped,'not_due');time=new Date('2026-10-29T01:59:00Z');assert.equal((await service.tick()).skipped,'not_due');time=new Date('2026-10-29T02:00:00Z');
// A future start month must block even a due October reminder, across restarts.
const deferredOptions={...options,getSettings:async()=>({enabled:true,time:'10:00',startMonth:'2026-11',configured:true})};
assert.equal((await createMonthEndScoreReminders(deferredOptions).tick()).skipped,'not_started');
time=new Date('2026-10-30T02:00:00Z');assert.equal((await createMonthEndScoreReminders(deferredOptions).tick()).skipped,'not_started');
assert.equal(calls.length,0);assert.equal(run('SELECT count(*) AS n FROM monthly_score_reminder_deliveries;',true)[0].n,0);
const futurePreview=await createMonthEndScoreReminders(deferredOptions).preview();assert.equal(futurePreview.month,'2026-11');assert.deepEqual(futurePreview.dates,['2026-11-27','2026-11-30']);assert.equal((await createMonthEndScoreReminders(deferredOptions).preview('2026-10')).activeInMonth,false);
time=new Date('2026-10-29T02:00:00Z');
const results=await Promise.all([service.tick(),createMonthEndScoreReminders(options).tick()]);assert.equal(results.reduce((n,r)=>n+(r.sent||0),0),2);assert.equal(calls.filter(c=>c.id==='head').length,1,'cross-process daily reservation');assert(calls.find(c=>c.id==='head').text.includes('同事互评：1 项'));assert(calls.find(c=>c.id==='head').text.includes('下属月度评分：3 项'));assert(calls.find(c=>c.id==='boss').text.includes('/?page=departments'));
await createMonthEndScoreReminders(options).tick();assert.equal(calls.length,3,'restart does not resend sent deliveries or retry failures too early');
time=new Date('2026-10-29T02:16:00Z');failPeer=false;await service.tick();assert.equal(calls.length,4);assert.equal(calls[1]?.uuid?.length,32);assert.equal(calls.filter(c=>c.id==='peer')[0].uuid,calls.filter(c=>c.id==='peer')[1].uuid,'retry uses same Feishu UUID');

// Submit peer and boss tasks between the two reminder days; only the manager remains.
run(`INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('r1','p-head','oct','员工','负责人',90,'完整评价'),('r2','p-peer','oct','员工','同名',80,'完整评价'); INSERT INTO department_leader_scores(department_id,month,leader_user_id,score,comment,scorer_user_id,scorer_name,created_at) VALUES('team','2026-10','head',80,'月度评价','boss','老板',datetime('now')); `);
time=new Date('2026-10-30T02:00:00Z');assert.deepEqual(await service.tick(),{sent:1,failed:0});assert.equal(calls.at(-1).id,'head');assert(!calls.at(-1).text.includes('同事互评：'));
assert.equal(run("SELECT count(*) AS n FROM monthly_score_reminder_deliveries WHERE status='sent';",true)[0].n,4);

// A fresh month automatically resolves new pending tasks and a new daily key.
time=new Date('2026-11-26T02:00:00Z');assert.equal((await service.tick()).skipped,'not_due');time=new Date('2026-11-30T02:00:00Z');await service.tick();assert(calls.at(-1).text.includes('2026-11'));assert.equal(calls.at(-1).id,'head');assert(calls.some(c=>c.id==='boss'&&c.text.includes('2026-11')));

// A process interrupted after reservation must not resend an uncertain delivery.
time=new Date('2026-11-30T02:20:00Z');const beforeRestart=calls.length;
run("UPDATE monthly_score_reminder_deliveries SET status='pending',updated_at='2026-11-30T02:00:00.000Z' WHERE month='2026-11' AND recipient_user_id='boss';");
await createMonthEndScoreReminders(options).tick();assert.equal(calls.length,beforeRestart);assert.equal(run("SELECT status FROM monthly_score_reminder_deliveries WHERE month='2026-11' AND recipient_user_id='boss';",true)[0].status,'uncertain');

// Completing after reservation must cancel the delivery before any network call.
time=new Date('2026-12-30T02:00:00Z');const before=calls.length;
const completing=createMonthEndScoreReminders({...options,exec:async s=>{await exec(s);if(!completeOnReserve&&s.includes("SET status='pending'")){completeOnReserve=true;run("UPDATE employees SET is_active=0;");}}});
await completing.tick();assert.equal(calls.length,before);assert.equal(run("SELECT status FROM monthly_score_reminder_deliveries WHERE month='2026-12';",true)[0].status,'cancelled');
time=new Date('2026-11-27T02:00:00Z');assert.deepEqual(await createMonthEndScoreReminders(deferredOptions).tick(),{sent:0,failed:0},'start month is eligible; inactive recipients remain excluded');

// Stored settings validate inputs, require credentials, audit, and survive a new instance.
const config={sessionSecret:'test-only',scoring360ReminderEnabled:false,scoring360ReminderHour:10,scoring360ReminderMinute:0};
const settings=createSystemSettings({query,exec,sql,config});const actor={userId:'admin',name:'管理员'};
await assert.rejects(settings.saveMonthlyReminders({enabled:true,time:'10:00'},actor),/feishu_required/);await assert.rejects(settings.saveMonthlyReminders({enabled:false,time:'25:00'},actor),/invalid_monthly/);
await settings.saveMonthlyReminders({enabled:false,time:'09:30'},actor);assert.equal((await createSystemSettings({query,exec,sql,config}).monthlyReminderConfig()).time,'09:30');assert.equal((await settings.logs())[0].action,'月末评分提醒设置已保存');
for(const startMonth of ['2026-13','2026-00','2026-1',202611,null])await assert.rejects(settings.saveMonthlyReminders({enabled:false,time:'10:00',startMonth},actor),/invalid_monthly_reminders/);
await settings.saveMonthlyReminders({enabled:false,time:'10:00',startMonth:'2026-11'},actor);assert.equal((await createSystemSettings({query,exec,sql,config}).monthlyReminderConfig()).startMonth,'2026-11');
await settings.saveMonthlyReminders({enabled:false,time:'09:30'},actor);assert.equal((await settings.monthlyReminderConfig()).startMonth,'2026-11','older clients cannot accidentally clear the start month');
await settings.saveMonthlyReminders({enabled:false,time:'09:30',startMonth:''},actor);assert.equal((await settings.monthlyReminderConfig()).startMonth,'');
assert.equal(run('PRAGMA integrity_check;').trim(),'ok');
console.log('Passed: last two workdays, Chinese holiday/makeup dates, Beijing clock, all 3 rating roles, active scopes, manual cycles, zero scores, same names, no preview sends, daily/restart/concurrent dedup, retries, completion recheck, month rollover, settings validation and persistence.');console.log('Artifacts retained:',dir);
