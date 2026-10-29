import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createPerformance} from '../server/performance.mjs';

// Request-scoped caching must remove duplicate rule reads without keeping a
// previous request's configuration or leaking a different employee's results.
await mkdir('outputs/tests',{recursive:true});
const directory=await mkdtemp(path.resolve('outputs/tests/performance-policy-'));
const employees=[{user_id:'a',name:'同事甲',department:'测试部门',is_active:'1'},{user_id:'b',name:'同事乙',department:'测试部门',is_active:'1'}];
const months=['2026-08','2026-09'],records=months.flatMap(month=>employees.map(e=>({user_id:e.user_id,'姓名':e.name,'部门':e.department,'开始日期':month+'-03','结束日期':month+'-07','源记录ID':e.user_id+month,'提交时间':month+'-07T19:00:00+08:00','状态':'准时','本周成果摘要':'完成验收','问题摘要':'接口待确认','下周计划摘要':'完成交付','思考与复盘摘要':'提前对齐','成果分':90,'问题分':10,'计划分':10,'复盘分':10})));
const data={meta:{collectionStartDate:'2026-08-01',periods:months.map(m=>({start:m+'-03',end:m+'-07'}))},employee_summary:employees.map(e=>({user_id:e.user_id,'姓名':e.name,'部门':e.department})),weekly_scores:records};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};freeze(data);
const periods=employees.map(e=>({employee_user_id:e.user_id,start_date:'2026-01-01',end_date:''}));
let policyReads=[],confirmedReads=0,weights=[30,25,25,20],writes=0,fixtureQueries=[];
const published=employees.map(e=>({month:'2026-08',employee_user_id:e.user_id,employee_name:e.name,kind:'quality',result_json:JSON.stringify({score:e.user_id==='a'?34:55}),scoring_rule:'automatic_report'}));
const query=async statement=>{
 fixtureQueries.push(statement);
 const scopes=[...statement.matchAll(/\b(?:[a-z]+\.)?(?:employee_user_id|user_id|evaluee_user_id)='([^']*)'/g)].map(match=>match[1]);
 const userId=scopes[0];if(userId)assert(scopes.every(id=>id===userId),'every scoped union arm must use the same exact identity');
 const own=rows=>userId?rows.filter(row=>(row.employee_user_id||row.user_id)===userId):rows;
 if(/^SELECT \* FROM weekly_reports(?: WHERE employee_user_id='[ab]')?;$/.test(statement))return [];
 if(statement==='SELECT employee_user_id,week_start,week_end FROM weekly_reports;')return [];
 if(statement==='SELECT month FROM performance_results UNION SELECT month FROM all_monthly_weighted_results UNION SELECT month FROM automatic_performance_results;')return published.map(({month})=>({month}));
 if(statement.includes("SELECT month,employee_user_id,kind,'legacy' AS scoring_rule"))return own(published).map(({month,employee_user_id,kind,scoring_rule})=>({month,employee_user_id,kind,scoring_rule}));
 if(statement.includes('ORDER BY month DESC, employee_name;')){confirmedReads++;return own(published);}
 if(statement==='SELECT * FROM scoring360_cycles ORDER BY start_date DESC;')return [];
 if(/^SELECT user_id,name,department,is_active FROM employees(?: WHERE user_id='[ab]')?;$/.test(statement))return own(employees);
 if(/^SELECT \* FROM employee_employment_periods(?: WHERE employee_user_id='[ab]')?;$/.test(statement))return own(periods);
 throw Error('unexpected_fixture_query: '+statement);
};
const performance=createPerformance({query,exec:async()=>{writes++;},sql:v=>"'"+String(v).replaceAll("'","''")+"'",readData:()=>data,policyFor:async month=>{policyReads.push(month);return {weights:[...weights],deadlineTime:'20:00'};},managerReviews:{snapshot:async()=>({scores:[],bossScores:[]}),progress:()=>({kind:'unassigned',expected:0,submitted:0,complete:false,score:null})},now:()=>new Date('2026-10-29T09:00:00+08:00')});
const first=await performance.overview();assert.equal(first.monthly.length,4);assert.deepEqual(policyReads.sort(),months);assert(first.monthly.every(r=>r.reports[0].candidate===34));
weights=[100,0,0,0];policyReads=[];
const second=await performance.overview();assert.deepEqual(policyReads.sort(),months);assert(second.monthly.every(r=>r.reports[0].candidate===90),'next request must read the changed policy');assert(first.monthly.every(r=>r.reports[0].candidate===34),'previous request snapshot must remain unchanged');
policyReads=[];await performance.reports();assert.deepEqual(policyReads.sort(),months);policyReads=[];await performance.reports();assert.deepEqual(policyReads.sort(),months,'standalone report requests must have independent readers');
confirmedReads=0;policyReads=[];fixtureQueries=[];
const personal=await performance.personal('同事甲','a');assert.equal(confirmedReads,1,'personal must only read the final full publication snapshot once');assert.equal(personal.history.length,1);assert.equal(personal.history[0].quality,34);assert(!JSON.stringify(personal).includes('55'),'personal must still filter the requested employee');assert.deepEqual(policyReads.sort(),months);
assert(fixtureQueries.includes("SELECT * FROM weekly_reports WHERE employee_user_id='a';"));
assert(!fixtureQueries.includes('SELECT * FROM weekly_reports;'),'personal must not load global report bodies');
assert(fixtureQueries.includes("SELECT user_id,name,department,is_active FROM employees WHERE user_id='a';"));
assert(fixtureQueries.includes("SELECT * FROM employee_employment_periods WHERE employee_user_id='a';"));
for(const statement of fixtureQueries.filter(q=>q.includes("'legacy' AS scoring_rule")))for(const alias of ['p','w','a'])if(statement.includes('ORDER BY month DESC'))assert(statement.includes(`${alias}.employee_user_id='a'`),'final publication union arms must remain scoped');
// Exercise SQLite's JSON projection itself, including explicit null/missing
// fields, false/zero, composite values and pre-existing malformed evidence.
const db=directory+'/projection.sqlite',quoted=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout;};
run(await readFile('db/schema.sql','utf8'));
run("INSERT INTO employees(user_id,name,department) VALUES('a','同事甲','测试部门'),('b','同事乙','测试部门'); INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES('a','a','2026-01-01','manager'),('b','b','2026-01-01','manager');");
const privateMarker='PRIVATE_EVIDENCE_MUST_REMAIN_SERVER_SIDE';
const legacy=[
 {month:'2026-08',id:'a',kind:'quality',result:{score:73},evidence:JSON.stringify({reviewNote:'人工核实',qualityCandidate:null,legitimateReason:'出差',deduction:0,privateEvidence:privateMarker.repeat(1000)})},
 {month:'2026-08',id:'b',kind:'timeliness',result:{rate:75},evidence:JSON.stringify({reviewNote:null,qualityCandidate:0,deduction:null,privateEvidence:privateMarker})},
 {month:'2026-07',id:'a',kind:'quality',result:{score:81},evidence:JSON.stringify({reviewNote:true,qualityCandidate:[0,null],legitimateReason:{reason:'已核实'},deduction:false,privateEvidence:privateMarker})},
 {month:'2026-06',id:'a',kind:'timeliness',result:{rate:50},evidence:'malformed historical evidence'},
];
for(const entry of legacy)run(`INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES(${quoted(entry.month)},${quoted(entry.id)},${quoted(entry.id==='a'?'同事甲':'同事乙')},${quoted(entry.kind)},${quoted(JSON.stringify(entry.result))},${quoted(entry.evidence)},'历史审核','2026-10-01');`);
const queries=[];
const actual=createPerformance({query:async statement=>{queries.push(statement);return run(statement,true);},exec:async statement=>run(statement),sql:quoted,readData:()=>data,policyFor:async()=>({weights:[30,25,25,20],deadlineTime:'20:00'}),managerReviews:{snapshot:async()=>({scores:[],bossScores:[]}),progress:()=>({kind:'unassigned',expected:0,submitted:0,complete:false,score:null})},now:()=>new Date('2026-10-29T09:00:00+08:00')});
const full=await actual.overview(),versionsBefore=run('SELECT count(*) AS n FROM automatic_performance_results;',true)[0].n;
const summary=await actual.overview({clientSummary:true});
const metadata=rows=>rows.map(({evidence_json,...rest})=>rest);
assert.deepEqual(metadata(summary.results),metadata(full.results),'summary must retain every result, score, rule and timestamp');
const allowed=['reviewNote','qualityCandidate','legitimateReason','deduction'];
for(let i=0;i<full.results.length;i++){
 let original={};try{original=JSON.parse(full.results[i].evidence_json);}catch{}
 const expected=Object.fromEntries(allowed.filter(key=>Object.hasOwn(original,key)).map(key=>[key,original[key]]));
 assert.deepEqual(JSON.parse(summary.results[i].evidence_json),expected,'SQLite projection must preserve null, missing and JSON types');
}
assert(full.results.some(row=>row.evidence_json.includes(privateMarker)));
assert(summary.results.every(row=>!row.evidence_json.includes(privateMarker)));
assert.equal(run('SELECT count(*) AS n FROM automatic_performance_results;',true)[0].n,versionsBefore,'summary reads must not create a different calculation revision');
const originalLegacy=run("SELECT month,employee_user_id,evidence_json FROM performance_results ORDER BY month,employee_user_id;",true);
queries.length=0;const personalWithSql=await actual.personal('同事甲','a');
assert.equal(personalWithSql.history.find(row=>row.month==='2026-08').quality,73,'personal retains authoritative historical scores');
assert(!JSON.stringify(personalWithSql).includes(privateMarker));
assert(queries.find(statement=>statement.includes('ORDER BY month DESC, employee_name;')).includes('json_each('),'personal must request short evidence in SQLite');
assert.deepEqual(run("SELECT month,employee_user_id,evidence_json FROM performance_results ORDER BY month,employee_user_id;",true),originalLegacy,'historical evidence remains stored intact');
const result={ok:true,onePolicyReadPerMonthPerCalculation:true,newRequestSeesPolicyChanges:true,standaloneReportReadersIsolated:true,personalReusesPublishedResults:true,personalEmployeeScopePreserved:true,sqliteEvidenceSummaryProjection:true,summaryResultMetadataUnchanged:true,legacyEvidenceRetained:true,explicitNullMissingAndJsonTypesPreserved:true,malformedEvidenceHandled:true,fixtureCalculations:writes,realScoringWrites:0,realProviderRequests:0,messagesSent:0,artifacts:directory};
await writeFile(directory+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
