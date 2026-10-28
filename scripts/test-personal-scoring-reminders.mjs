import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPersonalScoringReminders} from '../server/personal-scoring-reminders.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'personal-rating-')),db=path.join(dir,'test.sqlite');
function run(s,json=false){const r=spawnSync('sqlite3',[...(json?['-json']:[]),db,s],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]').map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v===null?'':v]))):r.stdout;}
const sql=v=>"'"+String(v).replaceAll("'","''")+"'";
let clock=Date.parse('2026-10-20T00:00:00Z'),sent=[];
const base={query:async s=>run(s,true),exec:async s=>run(s),sql,now:()=>clock};
try {
 run(await readFile('db/schema.sql','utf8'));
 run("INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at,created_at) VALUES('c','十月','2026-10-01','2026-10-31','open','2026-10-18T00:00:00Z','2026-10-18T00:00:00Z'); INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id,created_at) VALUES('a','c','本人','待评人','self','rater','2026-10-18T00:00:00Z'),('b','c','别人','无关评分人','other','other-rater','2026-10-18T00:00:00Z');");
 const user={userId:'self',name:'本人'},preview=createPersonalScoringReminders({...base,enabled:false});
 clock-=47*3600000;assert.equal((await preview.status(user,'2026-10')).canRemind,false);clock+=47*3600000;
 assert.equal((await preview.status(user,'2026-10')).canRemind,true);
 assert.equal((await preview.send(user,'2026-10')).dryRun,true);assert.equal(run('SELECT COUNT(*) n FROM personal_scoring_reminders',true)[0].n,0);
 const service=createPersonalScoringReminders({...base,enabled:true,deliver:async(id,text)=>{sent.push({id,text});return 'message-id';}});
 assert.equal((await service.send(user,'2026-10')).sent,1);assert.equal(sent[0].id,'rater');assert(!sent[0].text.includes('无关评分人'));
 assert.equal((await service.status(user,'2026-10')).reason,'cooldown');
 await assert.rejects(service.send(user,'2026-10'),/reminder_not_due/);
 clock+=25*3600000;assert.equal((await service.send(user,'2026-10')).sent,1);
 run("INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('r','a','c','本人','待评人',88,'完整评价');");
 assert.equal((await service.status(user,'2026-10')).complete,true);await assert.rejects(service.send(user,'2026-10'),/reminder_not_due/);
 assert.equal((await service.status({userId:'unknown',name:'陌生人'},'2026-10')).expected,0);
 await assert.rejects(service.status(user,'bad-month'),/invalid_month/);
 console.log('personal scoring reminder tests passed: self-only recipients, 24-hour wait/cooldown, honest preview, completed-rater exclusion');
}finally{await rm(dir,{recursive:true,force:true});}
