import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDepartments} from '../server/departments.mjs';
import {createFeishuDepartmentSync} from '../server/feishu-department-sync.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'organization-layout-')),db=path.join(dir,'test.sqlite');
function run(s,json=false){const r=spawnSync('sqlite3',[...(json?['-json']:[]),db],{input:'.bail on\n'+s,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return json?JSON.parse(r.stdout||'[]'):r.stdout;}
const sql=v=>v==null||v===''?'NULL':"'"+String(v).replaceAll("'","''")+"'";
try{
 run(await readFile('db/schema.sql','utf8'));
 const roster=[{userId:'domestic',name:'国内负责人',department:'国内事业部'},{userId:'overseas',name:'海外负责人',department:'海外事业部'}];
 const service=createDepartments({query:async s=>run(s,true),exec:async s=>run(s),sql,employees:async()=>roster});
 let view=await service.overview();
 const domestic=view.departments.find(d=>d.name==='国内事业部'),overseas=view.departments.find(d=>d.name==='海外事业部');
 const promotion={id:'promotion',name:'产品推广',parent_id:'',leader_user_id:'overseas',leader_mode:'concurrent',sort_order:1,is_active:1};
 const save=(rows,revision=view.layoutRevision)=>service.saveLayout({revision,departments:rows});
 await save([...view.departments,promotion]);
 await assert.rejects(save([...view.departments,promotion]),/layout_conflict/);
 view=await service.overview();
 assert.equal(view.employees.find(e=>e.userId==='overseas').department,'海外事业部');
 assert(!view.employees.find(e=>e.userId==='overseas').departmentIds.includes('promotion'),'leadership must not grant membership');
 await assert.rejects(save(view.departments.map(d=>d.id==='promotion'?{...d,leader_mode:'primary'}:d)),/leader_must/);
 const month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 await service.score({departmentId:'promotion',month,score:90,comment:'兼任推广职责'}, {userId:'boss',name:'老板'});
 assert.equal((await service.personal({userId:'overseas'}))[0].department,'产品推广');
 const cycle=view.departments.map(d=>d.id===domestic.id?{...d,parent_id:overseas.id}:d.id===overseas.id?{...d,parent_id:domestic.id}:d);
 await assert.rejects(save(cycle),/hierarchy_cycle/);
 assert.equal((await service.overview()).departments.find(d=>d.id===domestic.id).parent_id,'','failed validation is atomic');
 await assert.rejects(save(view.departments.filter(d=>d.id!=='promotion')),/invalid_department/);
 await assert.rejects(save(view.departments.map(d=>d.id===domestic.id?{...d,is_active:0}:d)),/department_not_empty/);
 await save(view.departments.map(d=>d.id===domestic.id?{...d,name:'国内销售中心',sort_order:3}:d));
 view=await service.overview();
 assert(!view.departments.some(d=>d.name==='国内事业部'),'rename aliases must prevent phantom departments');
 assert.deepEqual(view.employees.find(e=>e.userId==='domestic').directDepartmentIds,[domestic.id],'rename preserves member identity');
 assert.equal(view.departments.at(-1).id,domestic.id,'custom ordering is persisted');
 // A late SQL failure must roll back earlier writes, not leave a half-saved tree.
 run("CREATE TRIGGER fail_layout BEFORE UPDATE ON organization_departments WHEN NEW.id='promotion' BEGIN SELECT RAISE(ABORT,'test_failure'); END;");
 await assert.rejects(save(view.departments.map(d=>d.id===overseas.id?{...d,name:'海外新名称'}:d)),/test_failure/);
 assert.equal((await service.overview()).departments.find(d=>d.id===overseas.id).name,'海外事业部');
 run('DROP TRIGGER fail_layout;');
 await save(view.departments.map(d=>d.id==='promotion'?{...d,is_active:0}:d));
 view=await service.overview();
 await assert.rejects(service.score({departmentId:'promotion',month,score:91,comment:'不允许'}, {userId:'boss',name:'老板'}),/department_inactive/);
 assert.equal((await service.personal({userId:'overseas'}))[0].score,90,'deactivation retains history');
 // Feishu still refreshes source metadata, but refreshes official leadership while preserving local layout.
 run(`INSERT INTO feishu_department_links VALUES('od-promotion','promotion','','[]','',0,datetime('now'),'{}');`);
 const sync=createFeishuDepartmentSync({query:async s=>run(s,true),exec:async s=>run(s),sql,config:{feishuAppId:'a',feishuAppSecret:'s'},fetcher:async url=>({ok:true,json:async()=>url.includes('tenant_access_token')?{code:0,tenant_access_token:'token'}:{code:0,data:{items:[{open_department_id:'od-promotion',name:'飞书推广部',parent_department_id:'0',leader_user_id:'domestic',member_count:0}],has_more:false}}})});
 await sync.sync();view=await service.overview();
 const kept=view.departments.find(d=>d.id==='promotion');assert.equal(kept.name,'产品推广');assert.equal(kept.leader_user_id,'domestic');assert.equal(kept.is_active,0);
 assert(JSON.parse(kept.aliases_json).includes('飞书推广部'));
 console.log('Organization layout tests passed: hierarchy, concurrent leaders, identity, ordering, stale saves, atomic rollback, deactivation, history, sync protection.');
}finally{console.log('Test artifacts retained:',dir);}
