import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createPerformance} from '../server/performance.mjs';
import {createManagerReviews} from '../server/manager-reviews.mjs';
import {createDepartments} from '../server/departments.mjs';
import {collaborationPolicy,COLLABORATION_PEER_ONLY_EFFECTIVE_MONTH} from '../server/collaboration-policy.mjs';

// Real SQLite, production-shaped string rows and retained synthetic artifacts.
// Rejected mutations below only attempt INSERT/UPDATE; no resource is deleted.
const binary=process.env.SQLITE3_BIN||'sqlite3';
await mkdir('outputs/tests',{recursive:true});
const artifacts=await mkdtemp(path.resolve('outputs/tests/peer-only-scoring-')),db=path.join(artifacts,'test.sqlite');
const quote=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
function run(statement,json=false){
 const child=spawnSync(binary,['-bail','-cmd','.timeout 5000',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:32*1024*1024});
 if(child.status!==0)throw Error(child.stderr||'sqlite fixture failed');
 return json?JSON.parse(child.stdout||'[]'):child.stdout.trim();
}
const query=async statement=>run(statement,true).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==null?'':String(value)])));
const exec=async statement=>run(statement);
run(await readFile('db/schema.sql','utf8'));
const names={boss:'合成老板',head:'合成负责人',target:'合成被评员工',zero:'合成零分员工',partial:'合成缺评员工',none:'合成无配评员工',retained:'合成已答关系保留员工',historical:'合成旧加权员工',manual:'合成人工历史员工',badself:'合成旧自评关系',badboss:'合成旧老板互评关系',badcycle:'合成旧错周期回应',p0:'合成同事甲',p1:'合成同事乙'};
for(const [id,name] of Object.entries(names))run(`INSERT INTO employees(user_id,name,department,manager_user_id,is_active) VALUES(${quote(id)},${quote(name)},'合成团队',${quote(id==='boss'?'':id==='head'?'boss':'head')},1);`);
run(`INSERT INTO app_settings(key,value_json) VALUES('business_boss_members','{"members":[{"userId":"boss","name":"合成老板"}]}');
 INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('team','合成团队','head',datetime('now'));
 INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) SELECT 'employment-'||user_id,user_id,'2026-01-01','synthetic' FROM employees;
 INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES
 ('sep','合成九月无结果周期','2026-09-01','2026-09-30','open','2026-09-20T00:00:00Z'),
 ('oct','合成十月','2026-10-01','2026-10-31','open','2026-10-20T00:00:00Z'),
 ('nov','合成十一月','2026-11-01','2026-11-30','open','2026-11-30T00:00:00+08:00');`);
function pair(month,target,rater,score,status='active'){
 const id=`${month}-${target}-${rater}`;
 run(`INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id,status) VALUES(${quote(id)},${quote(month)},${quote(names[target])},${quote(names[rater])},${quote(target)},${quote(rater)},${quote(status)});`);
 if(score!==undefined)run(`INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES(${quote('r-'+id)},${quote(id)},${quote(month)},${quote(names[target])},${quote(names[rater])},${score},'合成私密评价正文');`);
 return id;
}
pair('nov','target','p0',95);pair('nov','target','p1',96);pair('nov','zero','p0',0);
pair('nov','retained','p0',85,'inactive');
pair('nov','partial','p0',80);pair('nov','partial','p1');pair('nov','historical','p0',90);pair('nov','manual','p0',73);
pair('nov','badself','badself',100);pair('nov','badboss','boss',100);
pair('nov','badcycle','p0');
run("INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('mismatched-cycle-response','nov-badcycle-p0','oct','合成旧错周期回应','合成同事甲',99,'合成错周期历史记录');");
pair('oct','target','p0',90);pair('oct','target','p1',100);
for(const [month,id] of [['2026-10','target'],['2026-11','historical']]){
 run(`INSERT INTO monthly_manager_scores(month,employee_user_id,evaluator_user_id,score,comment,snapshot_json) VALUES(${quote(month)},${quote(id)},'head',80,'合成历史负责人评价','{"expectedIds":["head"]}');`);
 if(id==='historical')run(`INSERT INTO monthly_person_weighted_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES(${quote(month)},${quote(id)},${quote(names[id])},'collaboration','{"score":87,"peerScore":90,"managerScore":80,"weights":{"manager":30,"peers":70}}','{"managerProgress":{"kind":"manager","expectedIds":["head"]},"preserved":"合成旧十一月发布证据"}','合成旧发布人','2026-11-19T03:00:00Z');`);
}
run(`INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES('2026-11','manual',${quote(names.manual)},'collaboration','{"score":73}','{"preserved":"合成人工历史证据"}','合成原审核人','2026-11-19T03:00:00Z');`);
const preserved=()=>['monthly_manager_scores','monthly_person_weighted_results','performance_results'].map(table=>[table,run(`SELECT * FROM ${table} ORDER BY rowid;`,true)]);
const beforeHistory=preserved(),historyHash=createHash('sha256').update(JSON.stringify(beforeHistory)).digest('hex');
const now=()=>new Date('2026-11-30T10:00:00+08:00');
const employees=async()=>(await query('SELECT * FROM employees WHERE is_active=1;')).map(row=>({userId:row.user_id,name:row.name,department:row.department,managerUserId:row.manager_user_id}));
let reviews,performance;
const departments=createDepartments({query,exec,sql:quote,employees,now,beforeScore:(month,id)=>reviews.freezeBossPlan(month,id),resolveLeaderScoreTarget:(month,id)=>reviews.leaderScoreTarget(month,id)});
reviews=createManagerReviews({query,exec,sql:quote,organization:departments.overview,reports:()=>performance.reports(),isBossUserId:id=>id==='boss',now});
performance=createPerformance({query,exec,sql:quote,readData:()=>({meta:{periods:[]},employee_summary:[],weekly_scores:[]}),managerReviews:reviews,now});
const checks=[];
const oldFetch=globalThis.fetch;let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('synthetic_no_outbound');};
try{
 assert.equal(COLLABORATION_PEER_ONLY_EFFECTIVE_MONTH,'2026-11');
 assert.deepEqual(collaborationPolicy('2026-10'),{rule:'weighted_30_70',weights:{manager:30,peers:70},effectiveMonth:'2026-11'});
 assert.deepEqual(collaborationPolicy('2026-11'),{rule:'peers_100',weights:{manager:0,peers:100},effectiveMonth:'2026-11'});
 assert.equal(collaborationPolicy('2027-01').rule,'peers_100');
 for(const invalid of ['2026-13','2026-00','0000-01','2026-1',null])assert.throws(()=>collaborationPolicy(invalid),/invalid_month/);
 checks.push('exact_policy_boundary_and_invalid_months');
 const view=await performance.overview({month:'2026-11',clientSummary:true});
 const row=id=>view.monthly.find(item=>item.userId===id);
 assert.equal(row('target').collaborationComplete,true);assert.equal(row('target').collaborationCandidate,95.5);
 assert.equal(row('target').peerCandidate,95.5);assert.equal(row('target').collaborationPolicy.rule,'peers_100');
 assert.deepEqual(row('target').collaborationPolicy.weights,{manager:0,peers:100});
 const published=id=>view.results.find(item=>item.kind==='collaboration'&&item.employee_user_id===id);
 assert.equal(published('target').scoring_rule,'peers_100');assert.equal(published('target').result.score,95.5);
 assert.equal(published('target').result.peerScore,95.5);assert.equal(published('target').result.managerScore,null);
 assert.equal(published('target').result.publicationMode,'peers_only');assert.equal(published('zero').result.score,0);
 assert.equal(published('retained').result.score,85);assert.equal(row('retained').peerComplete,true,'already answered inactive relationships remain effective without inventing new raters');
 checks.push('retained_answered_inactive_peer_still_counts');
 assert.equal(row('partial').collaborationComplete,false);assert.equal(row('none').collaborationComplete,false);
 assert.equal(published('partial'),undefined);assert.equal(published('none'),undefined);
 assert.equal(published('badself'),undefined);assert.equal(published('badboss'),undefined);
 assert.equal(row('badself').peerCandidate,null);assert.equal(row('badboss').peerCandidate,null,'invalid historical boss/self inputs are not a displayed peer average');
 assert.equal(published('badcycle'),undefined);assert.equal(row('badcycle').peerCandidate,null);assert.equal(row('badcycle').peerComplete,false,'response cycle must match its assignment canonical cycle');
 checks.push('raw_historical_self_and_boss_relations_cannot_publish');
 assert.equal(run("SELECT count(*) AS n FROM monthly_manager_scores WHERE month='2026-11' AND employee_user_id IN('target','zero');",true)[0].n,0);
 checks.push('all_peers_publish_sqlite_average_without_thirty_percent','zero_is_final','missing_and_unassigned_stay_pending');
 assert.equal(published('historical').result.score,87);assert.equal(published('historical').scoring_rule,'weighted_30_70');
 assert.equal(published('manual').result.score,73);assert.equal(published('manual').scoring_rule,'legacy');
 assert.equal(row('historical').collaborationCandidate,87,'saved weighted final overrides the new monthly policy candidate');
 assert.equal(row('historical').collaborationRule,'weighted_30_70');
 assert.equal(row('manual').collaborationCandidate,73);assert.equal(row('manual').peerCandidate,null,'unarchived legacy components must not be reconstructed');
 assert.equal(run("SELECT count(*) AS n FROM monthly_peer_results WHERE employee_user_id IN('historical','manual');",true)[0].n,0);
 assert.deepEqual(preserved(),beforeHistory);checks.push('november_existing_weighted_and_manual_bytes_preserved');

 const peersBefore=run('SELECT * FROM monthly_peer_results ORDER BY rowid;',true);
 await performance.overview({month:'2026-11',clientSummary:true});
 assert.deepEqual(run('SELECT * FROM monthly_peer_results ORDER BY rowid;',true),peersBefore,'unchanged overview is idempotent');
 assert.equal((await performance.personal(names.target,'target')).history.find(item=>item.month==='2026-11').collaboration,95.5);
 const oct=await performance.overview({month:'2026-10',clientSummary:true});
 assert.equal(oct.results.find(item=>item.employee_user_id==='target'&&item.kind==='collaboration').result.score,90.5,'October keeps manager80*30% plus peers95*70%');
 checks.push('repeat_get_and_personal_agree','october_retains_thirty_seventy');

 const locked=(label,statement)=>{assert.throws(()=>run(statement),/result_locked/,label);checks.push(label);};
 const safeValue='{"score":95.5,"peerScore":95.5,"managerScore":null,"weights":{"manager":0,"peers":100},"publicationMode":"peers_only","scoring_rule":"peers_100"}';
 locked('response_update_locked',"UPDATE scoring360_responses SET score=1 WHERE assignment_id='nov-target-p0';");
 locked('response_insert_locked',"INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('duplicate-peer-answer','nov-target-p1','nov','合成被评员工','合成同事乙',1,'');");
 locked('wrong_response_cycle_insert_cannot_bypass_canonical_assignment_lock',"INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('wrong-cycle-new-answer','nov-target-p1','sep','合成被评员工','合成同事乙',1,'');");
 locked('wrong_response_cycle_update_cannot_move_into_published_assignment',"UPDATE scoring360_responses SET assignment_id='nov-target-p0',cycle_id='sep',score=1 WHERE id='mismatched-cycle-response';");
 locked('assignment_update_locked',"UPDATE scoring360_assignments SET status='inactive' WHERE id='nov-target-p0';");
 locked('assignment_insert_locked',"INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES('extra-peer','nov','合成被评员工','合成负责人','target','head');");
 locked('cycle_update_locked',"UPDATE scoring360_cycles SET end_date='2026-11-29' WHERE id='nov';");
 locked('peer_result_update_locked',"UPDATE monthly_peer_results SET employee_name='changed' WHERE month='2026-11' AND employee_user_id='target';");
 for(const table of ['monthly_peer_results','monthly_weighted_results','monthly_person_weighted_results','performance_results'])locked('cross_generation_'+table,`INSERT INTO ${table}(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES('2026-11','target',${quote(names.target)},'collaboration',${quote(safeValue)},'{}','synthetic','2026-11-30T02:00:00Z');`);
 const peerInsert=(id,result)=>`INSERT INTO monthly_peer_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES('2026-11',${quote(id)},${quote(names[id])},'collaboration',${quote(JSON.stringify(result))},'{}','synthetic','2026-11-30T02:00:00Z');`;
 assert.throws(()=>run(peerInsert('partial',{score:80,peerScore:80,managerScore:null,weights:{manager:0,peers:100},publicationMode:'peers_only',scoring_rule:'peers_100'})),/peer_scoring_incomplete_or_changed/);
 assert.throws(()=>run(peerInsert('none',{score:0,peerScore:0,managerScore:null,weights:{manager:0,peers:100},publicationMode:'peers_only',scoring_rule:'peers_100'})),/peer_scoring_incomplete_or_changed/);
 for(const id of ['badself','badboss','badcycle'])assert.throws(()=>run(peerInsert(id,{score:id==='badcycle'?99:100,peerScore:id==='badcycle'?99:100,managerScore:null,weights:{manager:0,peers:100},publicationMode:'peers_only',scoring_rule:'peers_100'})),/peer_scoring_incomplete_or_changed/);
 run("INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES('complete-partial','nov-partial-p1','nov','合成缺评员工','合成同事乙',40,'');");
 assert.throws(()=>run(peerInsert('partial',{score:61,peerScore:61,managerScore:null,weights:{manager:0,peers:100},publicationMode:'peers_only',scoring_rule:'peers_100'})),/peer_scoring_incomplete_or_changed/,'database validates the exact average, not merely completion');
 checks.push('direct_sql_cannot_publish_missing_or_unassigned');
 assert.equal(run('PRAGMA integrity_check;'),'ok');assert.equal(run('PRAGMA foreign_key_check;'),'');assert.equal(outbound,0);
 const result={ok:true,sqliteVersion:run('SELECT sqlite_version() AS version;',true)[0].version,checks,historyHashBefore:historyHash,existingNovemberHistoryUnchanged:true,externalRequests:0,productionWrites:0,deletions:0,artifacts};
 await writeFile(path.join(artifacts,'result.json'),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));
}finally{globalThis.fetch=oldFetch;console.log('Synthetic artifacts retained:',artifacts);}
