import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createChinaWorkCalendar,validateAnnualCalendar} from '../server/china-work-calendar.mjs';
import {createMonthEndScoreReminders,lastTwoWorkingDays} from '../server/month-end-score-reminders.mjs';

await mkdir('outputs/tests',{recursive:true});const dir=await mkdtemp(path.resolve('outputs/tests/calendar-auto-')),db=dir+'/test.sqlite';
const sql=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const run=(input,json=false)=>{const r=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input,encoding:'utf8'});if(r.status)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout;};
const query=async s=>run(s,true),exec=async s=>run(s);run(await readFile('db/schema.sql','utf8'));
const bundled=JSON.parse(await readFile('src/data/chinaWorkCalendar.json','utf8'));
const name=date=>({'01':'元旦','02':'春节','04':'清明节','05':'劳动节','06':'端午节','09':'中秋节','10':'国庆节'})[date.slice(5,7)];
const annual=year=>({year,papers:[bundled.source],days:[...bundled.holidayDates.map(date=>({name:name(date),date:year+date.slice(4),isOffDay:true})),...bundled.workdayOverrides.map(date=>({name:name(date),date:year+date.slice(4),isOffDay:false}))]});
let date=new Date('2026-10-26T02:00:00Z'),published=false,networkFailure=false,revised=false,primaryFailure=false,calls=0;
const fetchImpl=async url=>{
 calls++;if(networkFailure||primaryFailure&&url.startsWith('https://raw.'))throw Error('mock unreachable');
 const year=Number(url.match(/(\d{4})\.json$/)[1]);
 let data=year===2026||published?annual(year):{year,papers:[],days:[]};
 if(year===2026&&revised)data.days.push({name:'国庆节',date:'2026-10-30',isOffDay:true});
 if(year===2027&&published)data.days.push({name:'元旦',date:'2026-12-31',isOffDay:true});
 return new Response(JSON.stringify(data),{status:200});
};
let current;const options={query,exec,sql,bundled,onChange:c=>{current=c;},fetchImpl,now:()=>date};
const service=createChinaWorkCalendar(options);await service.initialize();assert.deepEqual(current.years,[2026]);
await Promise.all([service.refresh(),service.refresh()]);assert.equal(calls,2,'concurrent refresh shares network job');assert.equal(current.automaticUpdate.years.find(y=>y.year===2027).status,'not_published');assert.deepEqual(current.years,[2026]);
await service.refresh();assert.equal(calls,2,'daily throttle');
const restarted=createChinaWorkCalendar(options);await restarted.initialize();await restarted.refresh();assert.equal(calls,2,'throttle persisted across restart');

// Next-year announcement is discovered automatically on the following daily check.
date=new Date('2026-10-27T02:00:00Z');published=true;revised=true;primaryFailure=true;await restarted.refresh();
assert(current.years.includes(2027));assert.deepEqual(lastTwoWorkingDays('2026-10',current),['2026-10-28','2026-10-29']);assert.deepEqual(lastTwoWorkingDays('2026-12',current),['2026-12-29','2026-12-30'],'next-year notification can adjust previous December');assert(current.workdayOverrides.includes('2027-02-28'));assert.equal(calls,6,'documented mirror used after primary failure');
const saved=run("SELECT count(*) AS n FROM app_settings WHERE key LIKE 'china_work_calendar_data_%';",true)[0].n;assert.equal(saved,3);

// A revised calendar can remove an override; the old bundled entry must not leak back.
date=new Date('2026-10-28T02:00:00Z');revised=false;primaryFailure=false;await restarted.refresh();assert.deepEqual(lastTwoWorkingDays('2026-10',current),['2026-10-29','2026-10-30']);
const afterRevert=createChinaWorkCalendar(options);await afterRevert.initialize();assert.deepEqual(lastTwoWorkingDays('2026-10',current),['2026-10-29','2026-10-30'],'restart restores explicitly selected version, including a return to old content');
assert.equal(run("SELECT count(*) AS n FROM app_settings WHERE key LIKE 'china_work_calendar_data_%';",true)[0].n,saved,'no versions deleted and no duplicate content inserted');

date=new Date('2026-10-29T02:00:00Z');networkFailure=true;await afterRevert.refresh();assert(current.years.includes(2027));assert.equal(current.automaticUpdate.years.find(y=>y.year===2026).status,'failed');assert.deepEqual(lastTwoWorkingDays('2026-10',current),['2026-10-29','2026-10-30'],'network failure retains usable cache');
const afterFailure=createChinaWorkCalendar(options);await afterFailure.initialize();assert(current.years.includes(2027),'failed refresh also retains cache across restart');

// Reject malformed, partial, oversized calendars without replacing approved data.
assert.throws(()=>validateAnnualCalendar({year:2027,papers:[],days:[]},2027),/not_published/);
assert.throws(()=>validateAnnualCalendar({...annual(2027),papers:['https://example.test/fake']},2027),/invalid_calendar/);
const duplicate=annual(2027);duplicate.days.push(duplicate.days[0]);assert.throws(()=>validateAnnualCalendar(duplicate,2027),/invalid_calendar/);
const invalid=annual(2027);invalid.days[0].date='2027-02-30';assert.throws(()=>validateAnnualCalendar(invalid,2027),/invalid_calendar/);
const partial=annual(2027);partial.days=partial.days.filter(d=>d.name!=='国庆节');assert.throws(()=>validateAnnualCalendar(partial,2027),/incomplete_calendar/);

// Do not issue month-end reminders on guessed workdays when a year has no calendar.
const reminders=createMonthEndScoreReminders({query,exec,sql,managerReviews:{snapshot:async()=>({plans:new Map()}),progress:()=>({})},getSettings:async()=>({enabled:true,time:'10:00',configured:true}),calendar:()=>current,now:()=>new Date('2028-01-31T02:00:00Z'),deliver:()=>{throw Error('must not send');},baseUrl:'https://example.test'});
assert.equal((await reminders.tick()).skipped,'calendar_unavailable');assert((await reminders.preview('2028-01')).calendarWarning.includes('自动重试'));

if(process.argv.includes('--live')){
 const live=createChinaWorkCalendar({...options,fetchImpl:fetch,now:()=>new Date()});await live.initialize();
 // Separate empty check state only for this read-only live download; no reminder sends.
 const source='https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2026.json';const response=await fetch(source,{signal:AbortSignal.timeout(8000)});assert(response.ok);const raw=await response.json();validateAnnualCalendar(raw,2026);await writeFile(dir+'/downloaded-2026.json',JSON.stringify(raw,null,2));console.log('Live source download validated:',source);
}
assert.equal(run('PRAGMA integrity_check;').trim(),'ok');
console.log('Passed: automatic daily current/next year sync, concurrent/restart throttle, unpublished placeholders, mirror fallback, cross-year December changes, immutable version cache, revised and reverted data, offline fallback, validation and unknown-year reminder guard.');console.log('Artifacts retained:',dir);
