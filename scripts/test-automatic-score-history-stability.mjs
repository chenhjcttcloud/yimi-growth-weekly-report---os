import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createPerformance} from '../server/performance.mjs';
import {decodeAutomaticEvidence} from '../server/automatic-evidence-storage.mjs';
import {REPORT_QUALITY_VERSION,REPORT_QUALITY_PROMPT_VERSION,validateReportQualityAnalysis} from '../server/report-quality-scoring.mjs';
import {previousQualitySnapshot} from '../server/report-rescore-state.mjs';
import {makeReportQualityAnalysis} from './report-quality-test-fixtures.mjs';

// All fixtures are synthetic and retained. No real integrations, cleanup,
// deletion, migration, or production database access is performed.
await mkdir('outputs/tests',{recursive:true});
const artifacts=await mkdtemp(path.resolve('outputs/tests/automatic-history-stability-')),db=artifacts+'/test.sqlite';
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
function run(statement,json=false){
 const result=spawnSync('sqlite3',['-bail','-cmd','.timeout 10000',...(json?['-json']:[]),db],{input:statement,encoding:'utf8',maxBuffer:64*1024*1024});
 assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();
}
run(await readFile('db/schema.sql','utf8'));
run("INSERT INTO employees(user_id,name,department) VALUES('fixture-worker','合成同事','合成部门');INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES('fixture-hire','fixture-worker','2026-09-01','manager');");
const facts={results:'合成成果：完成三项验收，交付记录齐全。',problems:'合成问题：接口范围待确认，已安排双方核对。',nextPlan:'合成计划：周五优先完成三项验收并登记结果。',reflection:'合成复盘：先确认范围可以减少返工，复用检查清单。'};
const analysis=(input,scores,summary='合成质量点评')=>{const raw=makeReportQualityAnalysis(input,{scores,summary});return {...raw,...validateReportQualityAnalysis(raw,input)};};
let content={...facts,'本周成果摘要':facts.results,'问题摘要':facts.problems,'下周计划摘要':facts.nextPlan,'思考与复盘摘要':facts.reflection,sourceHash:'fixture-source-a',source:{provider:'fixture',taskId:'fixture-report',formContents:[{label:'成果',value:JSON.stringify(facts.results)}]},ai:analysis(facts,[80,70,60,50]),aiModel:'fixture-model',aiPromptVersion:REPORT_QUALITY_PROMPT_VERSION,aiGeneratedAt:'2026-10-09T10:00:00Z',qualityRefresh:{state:'ready',targetVersion:REPORT_QUALITY_VERSION,attempts:1,jobId:'initial-job',updatedAt:'2026-10-09T10:00:00Z'},aiAnalysisAttempts:[]};
run(`INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,source_hash,submitted_at) VALUES('fixture-report','fixture-worker','合成同事','合成部门','fixture-week','2026-10-05','2026-10-09','准时',${sql(JSON.stringify(content))},'fixture-source-a','2026-10-09T10:00:00Z');`);
// A record from the prior hash algorithm must remain completely untouched.
run(`INSERT INTO automatic_performance_results(id,month,employee_user_id,employee_name,kind,calculation_hash,result_json,evidence_json,calculated_at) VALUES('retained-old-version','2026-10','fixture-worker','合成同事','quality','pre-fix-hash','{"score":52,"status":"ready","reportCount":1}',${sql(JSON.stringify({retainedMarker:'ORIGINAL_COMPLETE_EVIDENCE'}))},'2026-10-10T00:00:00Z');`);
let weights=[30,25,25,20],deadlineTime='20:00';
const managerReviews={snapshot:async()=>({plans:new Map(),scores:[],bossScores:[]}),progress:()=>({kind:'unassigned',expected:0,submitted:0,complete:false,score:null})};
const data={meta:{collectionStartDate:'2026-10-01',periods:[{start:'2026-10-05',end:'2026-10-09'}]},employee_summary:[],weekly_scores:[]};
const performance=createPerformance({query:async statement=>run(statement,true),exec:async statement=>run(statement),sql,readData:()=>data,policyFor:async()=>({weights:[...weights],deadlineTime}),managerReviews,now:()=>new Date('2026-11-02T09:00:00Z')});
const saved=()=>run('SELECT * FROM automatic_performance_results ORDER BY rowid;',true);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const preserved=new Map();
function retainAndCheck(){for(const row of saved()){if(preserved.has(row.id))assert.equal(digest(row),preserved.get(row.id),'Previously saved history was modified');else preserved.set(row.id,digest(row));}}
function writeContent(){run(`UPDATE weekly_reports SET content_json=${sql(JSON.stringify(content))},source_hash=${sql(content.sourceHash)} WHERE id='fixture-report';`);}
function counts(){return Object.fromEntries(['quality','timeliness'].map(kind=>[kind,run(`SELECT COUNT(*) AS n FROM automatic_performance_results WHERE kind=${sql(kind)};`,true)[0].n]));}
const checks=[];
async function read(label,delta={quality:0,timeliness:0}){
 const before=counts(),view=await performance.overview(),after=counts();
 for(const kind of ['quality','timeliness'])assert.equal(after[kind]-before[kind],delta[kind],label+': '+kind+' history increment');
 retainAndCheck();checks.push({label,delta});return view;
}
const quality=()=>JSON.parse(saved().filter(row=>row.kind==='quality').at(-1).result_json);
retainAndCheck();
let view=await read('first semantic baseline',{quality:1,timeliness:1});assert.equal(quality().status,'pending_confirmation');
assert(!view.results.some(row=>row.kind==='quality'),'historical automatic snapshots do not appear as final results');
for(let attempt=2;attempt<=8;attempt++){
 content={...content,aiGeneratedAt:`2026-10-10T10:00:0${attempt}Z`,qualityRefresh:{...content.qualityRefresh,attempts:attempt,jobId:'retry-job-'+attempt,updatedAt:`2026-10-10T11:00:0${attempt}Z`,diagnostic:{code:'fixture-retry'}},aiAnalysisAttempts:[...content.aiAnalysisAttempts,{attempt,at:'runtime-'+attempt,jobId:'retry-job-'+attempt}],aiAnalysisHistory:[{ai:{scores:[10,10,10,10],summary:'诊断保留旧分析'},generatedAt:'runtime-'+attempt}]};
 writeContent();await read('ready retry diagnostics '+attempt);
}
content=Object.fromEntries(Object.entries(content).reverse());writeContent();await read('object serialization order is not a revision');
const sameScore=quality().candidateScore;
content.ai={...content.ai,modules:content.ai.modules.map((module,index)=>index?module:{...module,reason:module.reason+'（补充业务评分依据）'})};writeContent();
view=await read('changed reason at same score',{quality:1,timeliness:0});assert.equal(quality().candidateScore,sameScore);
let latest=saved().filter(row=>row.kind==='quality').at(-1);assert(JSON.parse(decodeAutomaticEvidence(latest.evidence_json)).reports[0].content.aiAnalysisAttempts.length>=7,'Real revisions retain complete evidence and retry diagnostics');
content.ai=analysis(facts,[90,80,70,60]);writeContent();await read('changed AI score only',{quality:1,timeliness:0});
const revisedFacts={...facts,results:facts.results+'新增一项已验收交付。'};
content={...content,...revisedFacts,'本周成果摘要':revisedFacts.results,sourceHash:'fixture-source-b',ai:analysis(revisedFacts,[90,80,70,60])};writeContent();
await read('source facts changed at same score',{quality:1,timeliness:1});
run("UPDATE weekly_reports SET submitted_at='2026-10-09T21:00:00+08:00' WHERE id='fixture-report';");
await read('submission becomes late',{quality:1,timeliness:1});
run("UPDATE weekly_reports SET submitted_at='2026-10-09T10:00:00Z' WHERE id='fixture-report';");
await read('A to B to A restores prior business basis',{quality:1,timeliness:1});
const hashes=run("SELECT calculation_hash,COUNT(*) AS n FROM automatic_performance_results WHERE kind='timeliness' GROUP BY calculation_hash HAVING COUNT(*)>1;",true);assert(hashes.length,'A→B→A must create a new row even when its hash occurred before');
weights=[100,0,0,0];await read('legacy policy weights do not affect the current rubric');
deadlineTime='19:00';await read('submission deadline policy changes',{quality:1,timeliness:1});
const previous=previousQualitySnapshot(content,content.sourceHash,weights);
content={...content,previousQuality:previous,ai:undefined,qualityRefresh:{state:'queued',targetVersion:REPORT_QUALITY_VERSION,attempts:0,jobId:'rescore-entry',updatedAt:'2026-10-31T10:00:00Z'}};writeContent();
view=await read('enter quality rescore',{quality:1,timeliness:0});assert.equal(quality().status,'pending_ai');
for(let attempt=1;attempt<=6;attempt++){
 content={...content,qualityRefresh:{...content.qualityRefresh,state:attempt%2?'analyzing':'queued',attempts:attempt,jobId:'runtime-'+attempt,updatedAt:'runtime-'+attempt,diagnostic:{code:'fixture-only'}},aiAnalysisAttempts:[...content.aiAnalysisAttempts,{attempt,at:'runtime-'+attempt}]};writeContent();
 await read('pending rescore retry diagnostics '+attempt);
}
content.qualityRefresh={...content.qualityRefresh,state:'failed',updatedAt:'failed-at'};writeContent();
view=await read('rescore failure is meaningful',{quality:1,timeliness:0});assert.equal(quality().status,'pending_ai');
assert.equal(JSON.parse(decodeAutomaticEvidence(saved().filter(row=>row.kind==='quality').at(-1).evidence_json)).reports[0].qualityRefresh.state,'failed');
for(let attempt=7;attempt<=12;attempt++){
 content.qualityRefresh={...content.qualityRefresh,attempts:attempt,updatedAt:'later-runtime-'+attempt,jobId:'later-job-'+attempt};content.aiAnalysisAttempts.push({attempt,at:'later-runtime-'+attempt});writeContent();await read('same failed state diagnostics '+attempt);
}
content={...content,ai:analysis(revisedFacts,[100,80,60,40]),qualityRefresh:{...content.qualityRefresh,state:'ready'},aiGeneratedAt:'2026-11-01T11:00:00Z'};writeContent();
view=await read('rescore completion is meaningful',{quality:1,timeliness:0});assert.equal(quality().status,'pending_confirmation');
content.ai=analysis(revisedFacts,[0,0,0,0]);writeContent();view=await read('valid zero score remains a real revision',{quality:1,timeliness:0});assert.equal(quality().candidateScore,0);
content.aiModel='fixture-other-model';writeContent();await read('analysis model basis changes',{quality:1,timeliness:0});
await read('stable final read');
assert.equal(run('PRAGMA integrity_check;'),'ok');assert.deepEqual(run('PRAGMA foreign_key_check;',true),[]);
retainAndCheck();
const result={ok:true,scenarios:checks.length,retryDiagnosticsDoNotCreateHistory:true,timelinessIndependentOfAI:true,trueBusinessChangesCreateHistory:true,qualityStateTransitionsPreserved:true,AtoBtoAPreserved:true,completeEvidenceRetained:true,priorHistoryUnchanged:true,validZeroPreserved:true,finalCounts:counts(),productionWrites:0,externalRequests:0,deletions:0,artifacts};
await writeFile(artifacts+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
