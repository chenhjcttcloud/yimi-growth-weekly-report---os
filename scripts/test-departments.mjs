import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDepartments} from '../server/departments.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'departments-')),db=path.join(dir,'db.sqlite');
function run(s,json=false){const r=spawnSync('sqlite3',[...(json?['-json']:[]),db,s],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout;}
const sql=v=>v==null||v===''?'NULL':"'"+String(v).replaceAll("'","''")+"'";
try{
 run(await readFile('db/schema.sql','utf8'));
 const roster=[{userId:'leader',name:'负责人',department:'产品部'},{userId:'other',name:'另一人',department:'研发部'}];
 const service=createDepartments({query:async s=>run(s,true),exec:async s=>run(s),sql,employees:async()=>roster});
 await service.save({name:'测试事业群'});
 assert.equal(run("SELECT leader_user_id FROM organization_departments WHERE name='测试事业群'",true)[0].leader_user_id,'');
 const view=await service.overview(),dept=view.departments.find(d=>d.name==='产品部');assert.equal(view.departments.length,3);
 await assert.rejects(service.save({id:dept.id,name:'产品部',leaderUserId:'other'}),/leader_must/);
 await service.save({id:dept.id,name:'产品部',leaderUserId:'leader'});
 const research=view.departments.find(d=>d.name==='研发部');await service.save({id:research.id,name:'研发部',parentId:dept.id});
 await assert.rejects(service.save({id:dept.id,name:'产品部',leaderUserId:'leader',parentId:research.id}),/hierarchy_cycle/);
 const month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7),body={departmentId:dept.id,month,score:92,comment:'明确组织目标并带领团队完成交付'};
 await assert.rejects(service.score({...body,score:''},{userId:'boss',name:'老板'}),/score_and/);
 await service.score(body,{userId:'boss',name:'老板'});
 assert.equal((await service.personal({userId:'leader'}))[0].score,92);
 assert.equal((await service.personal({userId:'other'})).length,0);
 await assert.rejects(service.score(body,{userId:'boss',name:'老板'}),/result_locked/);
 assert.throws(()=>run('UPDATE department_person_scores SET score=0'),/result_locked/);
 assert.equal(run('SELECT COUNT(*) n FROM performance_results',true)[0].n,0,'boss score must remain separate from peer scores');
 roster.push({userId:'multi',name:'多部门成员',department:'产品部, 研发部'});
 run(`INSERT INTO organization_departments(id,name,updated_at) VALUES('legacy','产品部, 研发部',datetime('now'));`);
 const canonical=await service.overview();assert.equal(canonical.departments.length,3,'do not create a phantom combined department');assert.equal(canonical.employees.find(e=>e.userId==='multi').departmentIds.length,2);
 const monthly=[{userId:'leader',month,reports:[{submitted:true,candidate:80}],timeliness:{expected:2,submitted:2,onTime:1,late:1,missing:0},collaborationExpected:3,collaborationSubmitted:2},{userId:'multi',month,reports:[{submitted:true,candidate:90}],timeliness:{expected:2,submitted:1,onTime:1,late:0,missing:1},collaborationExpected:0,collaborationSubmitted:0}];
 const results=[{month,kind:'quality',result:{score:92},evidence_json:JSON.stringify({userId:'leader'})},{month,kind:'collaboration',result:{score:88},evidence_json:JSON.stringify({userId:'leader'})},{month,kind:'quality',result:{score:100},evidence_json:JSON.stringify({userId:'outsider',name:'负责人'})}];
 const dashboard=await service.dashboard(month,{months:[month],monthly,results}),product=dashboard.departments.find(d=>d.id===dept.id);
 assert.equal(product.metrics.headcount,3);assert.equal(product.metrics.submissionRate,75);assert.equal(product.metrics.onTimeRate,50);assert.equal(product.metrics.quality,92,'aggregate published scores by identity, never by duplicate names');assert.equal(product.metrics.qualityReference,85);assert.equal(product.metrics.collaboration,88);assert.equal(product.metrics.pendingRatings,1);assert.equal(product.leaderScore.score,92);assert.equal(dashboard.multiDepartmentCount,1);
 await assert.rejects(service.dashboard('9999-01',{months:[],monthly:[],results:[]}),/invalid_month/);
 console.log('department tests passed: department roster, leader membership, monthly boss score, self-only results, immutable score, multiple departments, identity-safe monthly aggregates, final/reference separation');
}finally{console.log('Test artifacts retained:',dir);}
