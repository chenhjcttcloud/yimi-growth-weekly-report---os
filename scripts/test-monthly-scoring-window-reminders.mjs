import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createMonthlyScoringWindow} from '../server/monthly-scoring-window.mjs';
import {createMonthEndScoreReminders,lastTwoWorkingDays} from '../server/month-end-score-reminders.mjs';
import {createPersonalScoringReminders} from '../server/personal-scoring-reminders.mjs';

// Real SQLite, fictional users and mock deliveries only; keep all test artifacts.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/monthly-scoring-window-reminders-')),db=dir+'/test.sqlite';
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{
 const result=spawnSync('sqlite3',['-bail','-cmd','.timeout 10000',...(json?['-json']:[]),db],{input:statement,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();
};
const query=async statement=>run(statement,true),exec=async statement=>run(statement);
run(await readFile('db/schema.sql','utf8'));
run(`INSERT INTO employees(user_id,name,is_active) VALUES('self','测试本人',1),('peer','正式评分人',1),('alt-peer','其他周期评分人',1),('head','测试负责人',1),('boss','测试老板',1);
 INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at,created_at) VALUES
 ('2026-11-360','十一月正式周期','2026-11-01','2026-11-30','open','2026-11-01T00:00:00+08:00','2026-11-01T00:00:00+08:00'),
 ('2026-11-alt','十一月其他周期','2026-11-01','2026-11-30','open','2026-11-01T00:00:00+08:00','2026-11-02T00:00:00+08:00');
 INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id,created_at) VALUES
 ('canonical-task','2026-11-360','测试本人','正式评分人','self','peer','2026-11-01T00:00:00+08:00'),
 ('alternate-task','2026-11-alt','测试本人','其他周期评分人','self','alt-peer','2026-11-01T00:00:00+08:00');`);
let clock=Date.parse('2026-11-27T10:00:00+08:00');
const at=value=>{clock=Date.parse(value);},now=()=>new Date(clock);
const ratingWindow=createMonthlyScoringWindow({query,sql,now});
const state={plans:new Map([['self',{}],['head',{}]])};
const managerReviews={
 snapshot:async()=>state,
 progress:(_state,_month,id)=>({kind:id==='head'?'boss':'manager',expectedIds:[id==='head'?'team':'head'],records:[],handoffRequired:false,taskStartedAt:'2026-11-01T00:00:00+08:00'}),
};
const monthEndCalls=[],personalCalls=[],calendar={year:2026,autoManaged:true,holidayDates:[],workdayOverrides:[]};
let unexpectedNetworkCalls=0;
globalThis.fetch=async()=>{unexpectedNetworkCalls++;throw Error('window_reminder_fixture_network_forbidden');};
const monthly=createMonthEndScoreReminders({query,exec,sql,managerReviews,ratingWindow,now,
 bossMembers:()=>[{userId:'boss',name:'测试老板'}],getSettings:async()=>({enabled:true,configured:true,startMonth:'2026-11',time:'10:00'}),calendar:()=>calendar,baseUrl:'https://growth.example.test',
 deliver:async(userId,message,uuid)=>{monthEndCalls.push({userId,message,uuid});return 'mock-monthly-'+uuid;},
});
const personalOptions={query,exec,sql,ratingWindow,now:()=>clock,enabled:true,policyFor:async()=>({reminderWaitHours:24,reminderCooldownHours:24}),
 deliver:async(userId,message,uuid)=>{personalCalls.push({userId,message,uuid});return 'mock-personal-'+uuid;},
};
const personal=createPersonalScoringReminders({...personalOptions,managerReviews,bossUserIds:()=>['boss']});
const peerOnlyPersonal=createPersonalScoringReminders(personalOptions),user={userId:'self',name:'测试本人'};
const count=table=>run('SELECT count(*) AS n FROM '+table+';',true)[0].n;
const checks=[];

assert.deepEqual(lastTwoWorkingDays('2026-11',calendar),['2026-11-27','2026-11-30']);
assert.equal((await ratingWindow.status('2026-11')).reason,'before_window');
const preview=await monthly.preview('2026-11');assert.deepEqual(preview.recipients,[]);
assert.deepEqual(await monthly.tick(),{sent:0,failed:0},'the earlier of the final two workdays cannot send before the opening week');
assert.equal((await personal.status(user,'2026-11')).canRemind,false);
await assert.rejects(personal.send(user,'2026-11'),/reminder_not_due/);
assert.equal(count('monthly_score_reminder_deliveries'),0,'unopened months do not reserve a delivery');
assert.equal(count('personal_scoring_reminders'),0,'unopened personal reminders do not consume cooldown');
assert.equal(monthEndCalls.length,0);assert.equal(personalCalls.length,0);
checks.push('november_27_is_due_workday_but_unopened_window_sends_and_reserves_nothing');

at('2026-11-30T00:00:00+08:00');
assert.equal((await ratingWindow.status('2026-11')).isOpen,true);
let pending=await monthly.pending('2026-11');
assert.deepEqual(pending.map(row=>row.userId),['boss','head','peer']);
assert.deepEqual(pending.find(row=>row.userId==='boss').counts,{peer:0,manager:0,boss:1});
assert.deepEqual(pending.find(row=>row.userId==='head').counts,{peer:0,manager:1,boss:0});
assert.deepEqual(pending.find(row=>row.userId==='peer').counts,{peer:1,manager:0,boss:0});
assert(!pending.some(row=>row.userId==='alt-peer'),'alternate-cycle tasks cannot generate a reminder');
assert.equal((await personal.status(user,'2026-11')).canRemind,false,'old manager responsibility timestamps must not allow immediate personal reminders');
assert.equal((await peerOnlyPersonal.status(user,'2026-11')).canRemind,false,'old peer launch/creation timestamps must not bypass the opening-based wait');
await assert.rejects(personal.send(user,'2026-11'),/reminder_not_due/);
assert.equal(count('personal_scoring_reminders'),0);
checks.push('exact_opening_exposes_all_three_roles_but_personal_wait_starts_at_opening');

at('2026-11-30T10:00:00+08:00');
for(const status of ['draft','closed']){
 run(`UPDATE scoring360_cycles SET status=${sql(status)} WHERE id='2026-11-360';`);
 assert.equal((await ratingWindow.status('2026-11')).isOpen,false);
 assert.deepEqual(await monthly.pending('2026-11'),[]);
 assert.deepEqual(await monthly.tick(),{sent:0,failed:0});
 assert.equal((await personal.status(user,'2026-11')).canRemind,false);
 await assert.rejects(personal.send(user,'2026-11'),/reminder_not_due/);
 assert.equal(count('monthly_score_reminder_deliveries'),0);
 assert.equal(count('personal_scoring_reminders'),0);
 assert.equal(monthEndCalls.length,0);assert.equal(personalCalls.length,0);
}
checks.push('draft_or_closed_canonical_cycle_blocks_every_reminder_even_with_open_alternate');
run("UPDATE scoring360_cycles SET status='open' WHERE id='2026-11-360';");
assert.deepEqual(await monthly.tick(),{sent:3,failed:0});
assert.deepEqual(monthEndCalls.map(call=>call.userId),['boss','head','peer']);
assert(!monthEndCalls.some(call=>call.userId==='alt-peer'));
assert.deepEqual(run('SELECT DISTINCT recipient_user_id FROM monthly_score_reminder_deliveries ORDER BY recipient_user_id;',true).map(row=>row.recipient_user_id),['boss','head','peer']);
assert.equal(run("SELECT count(*) AS n FROM monthly_score_reminder_deliveries WHERE reminder_date='2026-11-30' AND status='sent';",true)[0].n,3);
checks.push('opened_due_day_delivers_only_actionable_canonical_peer_and_manager_boss_tasks');

// The 24-hour personal wait uses the latest applicable start, including when a
// new launch or an assignment is later than the calendar's opening Monday.
async function personalBoundary(before,ready,label){
 at(before);assert.equal((await peerOnlyPersonal.status(user,'2026-11')).canRemind,false,label+' is too early');
 await assert.rejects(peerOnlyPersonal.send(user,'2026-11'),/reminder_not_due/);
 assert.equal(count('personal_scoring_reminders'),0,'a denied wait must not reserve cooldown');
 at(ready);const status=await peerOnlyPersonal.status(user,'2026-11');
 assert.equal(status.canRemind,true,label+' opens exactly at 24 hours');
 assert.equal(status.eligibleCount,1,'only the canonical task can become eligible');
 checks.push(label);
}
await personalBoundary('2026-11-30T23:59:59+08:00','2026-12-01T00:00:00+08:00','personal_wait_24_hours_from_calendar_opening');
run("UPDATE scoring360_cycles SET launch_at='2026-11-30T06:00:00+08:00' WHERE id='2026-11-360';");
await personalBoundary('2026-12-01T05:59:59+08:00','2026-12-01T06:00:00+08:00','personal_wait_24_hours_from_later_cycle_launch');
run("UPDATE scoring360_assignments SET created_at='2026-11-30T12:00:00+08:00' WHERE id='canonical-task';");
await personalBoundary('2026-12-01T11:59:59+08:00','2026-12-01T12:00:00+08:00','personal_wait_24_hours_from_later_assignment_creation');
const sent=await peerOnlyPersonal.send(user,'2026-11');
assert.equal(sent.sent,1);assert.equal(sent.recipientCount,1);
assert.deepEqual(personalCalls.map(call=>call.userId),['peer']);
assert.deepEqual(run('SELECT recipient_user_id,status FROM personal_scoring_reminders;',true),[{recipient_user_id:'peer',status:'sent'}]);
checks.push('personal_send_excludes_alternate_cycle_even_after_all_waits_elapsed');
assert.equal(unexpectedNetworkCalls,0);assert.equal(run('PRAGMA integrity_check;'),'ok');
const result={ok:true,checks,mockMonthEndDeliveries:monthEndCalls.length,mockPersonalDeliveries:personalCalls.length,externalRequests:unexpectedNetworkCalls,realMessagesSent:0,artifacts:dir};
await writeFile(dir+'/result.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));console.log('Artifacts retained:',dir);
