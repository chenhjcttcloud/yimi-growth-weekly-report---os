import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createDepartments} from '../server/departments.mjs';

// Focused, isolated fixtures. Canonical ownership must never require loading a
// report/result evidence body. Legacy missing identities keep their fallback.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/department-summary-loading-')),db=dir+'/test.sqlite';
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();};
run(await readFile('db/schema.sql','utf8'));
run("INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('product','产品部','leader','2026-01-01T00:00:00Z'),('research','研发部','researcher','2026-01-01T00:00:00Z');");
const roster=[{userId:'leader',name:'同名员工',department:'产品部'},{userId:'member',name:'产品同事',department:'产品部'},{userId:'researcher',name:'同名员工',department:'研发部'}];
const service=createDepartments({query:async statement=>run(statement,true),exec:async statement=>run(statement),sql,employees:async()=>roster});
const month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7),previousDate=new Date(month+'-01T00:00:00Z');previousDate.setUTCMonth(previousDate.getUTCMonth()-1);const previous=previousDate.toISOString().slice(0,7),months=[month,previous];
const statistics={expected:4,submitted:3,onTime:2,late:1,missing:1};
const monthly=months.flatMap(m=>roster.map((employee,index)=>({userId:employee.userId,month:m,reports:[{submitted:true,candidate:80+index,evidence:[{text:'本测试不需要传输的四模块分析。'.repeat(1000)}],content:{source:'原始表单'.repeat(1000)}}],timeliness:statistics,collaborationExpected:2,collaborationSubmitted:employee.userId==='member'?1:2})));
const canonical=months.flatMap(m=>[
 {month:m,employee_user_id:'leader',employee_name:'同名员工',kind:'quality',result:{score:m===month?92:89},evidence_json:JSON.stringify({userId:'researcher',body:'错误快照归属不能覆盖主身份列。'.repeat(1000)})},
 {month:m,employee_user_id:'leader',kind:'collaboration',result:{score:88},evidence_json:'{invalid-json'},
 {month:m,employee_user_id:'researcher',employee_name:'同名员工',kind:'quality',result:{score:66},evidence_json:JSON.stringify({userId:'leader'})},
 {month:m,employee_user_id:'outside',kind:'quality',result:{score:100},evidence_json:JSON.stringify({userId:'leader',name:'同名员工'})},
]);
const full={months,monthly,results:canonical},summary={months,monthly:monthly.map(row=>({...row,reports:row.reports.map(({submitted,candidate})=>({submitted,candidate,detailsDeferred:true}))})),results:canonical.map(({evidence_json,...record})=>record)};
const fullDashboard=await service.dashboard(month,full),summaryDashboard=await service.dashboard(month,summary);
assert.deepEqual(summaryDashboard,fullDashboard,'canonical full and brief summaries must yield identical department output');
const product=summaryDashboard.departments.find(department=>department.id==='product'),research=summaryDashboard.departments.find(department=>department.id==='research');
assert.equal(product.metrics.quality,92);assert.equal(product.metrics.collaboration,88);assert.equal(product.metrics.qualityPublished,1);assert.equal(product.metrics.qualityReference,80.5);assert.equal(product.metrics.submissionRate,75);assert.equal(product.metrics.onTimeRate,50);assert.equal(product.metrics.pendingRatings,1);assert.equal(research.metrics.quality,66);assert.equal(product.trend.find(row=>row.month===previous).quality,89);
let canonicalEvidenceReads=0;
const unreadable=canonical.map(({evidence_json,...record})=>Object.defineProperty(record,'evidence_json',{enumerable:true,get(){canonicalEvidenceReads++;throw Error('canonical_evidence_must_not_be_read');}}));
assert.deepEqual(await service.dashboard(month,{...summary,results:unreadable}),summaryDashboard);assert.equal(canonicalEvidenceReads,0,'canonical user_id must bypass every evidence getter');
let legacyReads=0,badLegacyReads=0;
const legacy=[
 Object.defineProperty({month,kind:'quality',result:{score:72}},'evidence_json',{get(){legacyReads++;return JSON.stringify({userId:'member'});}}),
 Object.defineProperty({month,employee_user_id:'',kind:'collaboration',result:{score:70}},'evidence_json',{get(){legacyReads++;return JSON.stringify({userId:'member'});}}),
 Object.defineProperty({month,kind:'quality',result:{score:0}},'evidence_json',{get(){badLegacyReads++;return '{broken';}}),
 {month,kind:'quality',result:{score:0},evidence_json:JSON.stringify({name:'同名员工'})},
 {month,kind:'quality',result:{score:0},evidence_json:JSON.stringify({userId:'absent'})},
];
const mixed=await service.dashboard(month,{...summary,results:[...summary.results,...legacy]}),mixedProduct=mixed.departments.find(department=>department.id==='product');
assert.equal(mixedProduct.metrics.quality,82,'a missing canonical ID may fall back to its legacy userId');assert.equal(mixedProduct.metrics.collaboration,79);assert.equal(mixedProduct.metrics.qualityPublished,2);assert.equal(mixedProduct.metrics.collaborationPublished,2);assert.equal(mixed.departments.find(department=>department.id==='research').metrics.quality,66);assert.equal(legacyReads,2,'decode each missing identity once across all departments and trend months');assert.equal(badLegacyReads,1,'a malformed legacy record is ignored after one attempted decode');
assert.equal(run('SELECT count(*) FROM scoring360_responses; SELECT count(*) FROM monthly_manager_scores; SELECT count(*) FROM department_leader_scores;'),'0\n0\n0');assert.equal(run('PRAGMA integrity_check;'),'ok');
const result={ok:true,canonicalFullSummaryEquivalent:true,canonicalEvidenceReads,canonicalIdentityOverridesWrongEvidence:true,duplicateNamesNotUsedForOwnership:true,legacyMissingIdentityFallback:true,legacyEvidenceDecodedOnce:true,malformedLegacyEvidenceIgnored:true,scoreAndTrendValuesPreserved:true,realScoringWrites:0,externalRequests:0,messagesSent:0,artifacts:dir};await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
