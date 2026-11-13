import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createLiveReportSync} from '../server/live-report-sync.mjs';
import {
  NO_REPORT_EVIDENCE,
  REPORT_QUALITY_PROMPT_VERSION,
  REPORT_QUALITY_VERSION,
  reportQualityAssessment,
  validateReportQualityAnalysis,
} from '../server/report-quality-scoring.mjs';
import {makeReportQualityAnalysis} from './report-quality-test-fixtures.mjs';

const priorPrompt = 'weekly-quality-prompt-2026-11-12-v3';
const month = '2026-11';
const week = '2026-11-06';
const model = 'synthetic-fragment-model';
const repeated = '供应商已确认样品。';
const results = ` \t${repeated}\r\n  ${repeated}\r\n${'长'.repeat(599)}🌿${'句'.repeat(1900)}\r\n第二批样品复检完成。  `;
const root = path.resolve('outputs/tests');
await mkdir(root,{recursive:true});
const directory = await mkdtemp(path.join(root,'report-evidence-fragments-'));
const db = path.join(directory,'test.sqlite');
const sql = value => `'${String(value).replaceAll("'","''")}'`;

function run(statement,json=false) {
  const result = spawnSync('sqlite3',['-bail','-cmd','.timeout 10000',...(json?['-json']:[]),db],{
    input:statement,encoding:'utf8',maxBuffer:16*1024*1024,
  });
  assert.equal(result.status,0,result.stderr);
  return json ? JSON.parse(result.stdout||'[]') : result.stdout.trim();
}

run(await readFile('db/schema.sql','utf8'));
await writeFile(path.join(directory,'prototypeData.json'),JSON.stringify({meta:{periods:[]},employee_summary:[],weekly_scores:[]}));

const sources = new Map();
function seed(id,{cached=false,history=false}={}) {
  const facts = {
    results:id==='a-fragments' ? results : repeated,
    problems:repeated,
    nextPlan:'周五前完成第二批样品复检。',
    reflection:'清单让复检更快，下周继续复用。',
  };
  const content = {...facts,source:{provider:'feishu-report'},sourceHash:`hash-${id}`};
  if(cached) {
    const response = makeReportQualityAnalysis(facts);
    content.ai = {...response,...validateReportQualityAnalysis(response,facts),promptVersion:priorPrompt};
    content.aiPromptVersion = priorPrompt;
    content.aiModel = model;
    content.aiGeneratedAt = `${week}T10:05:00Z`;
  }
  if(history) {
    content.aiAnalysisAttempts = [1,2].map(attempt=>({
      attempt,sourceHash:content.sourceHash,model,promptVersion:priorPrompt,
      code:'evidence_not_in_source',path:'modules.results.criteria.result.evidence[0].quote',retryable:true,
    }));
  }
  run(`INSERT INTO employees(user_id,name,department,is_active) VALUES(${sql(id)},'虚构员工',${sql(id)},1);
    INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,source_hash,submitted_at)
    VALUES(${sql(id)},${sql(id)},'虚构员工',${sql(id)},${sql(week)},'2026-11-02',${sql(week)},'准时',${sql(JSON.stringify(content))},${sql(content.sourceHash)},${sql(week+'T10:00:00Z')});`);
  sources.set(id,facts);
}

seed('a-fragments',{history:true});
seed('b-corrective');
seed('c-invalid');
seed('d-legacy-quote');
seed('e-cached',{cached:true});
seed('f-no-evidence');
const saved = id => run(`SELECT * FROM weekly_reports WHERE id=${sql(id)};`,true)[0];
const report = id => JSON.parse(saved(id).content_json);
const beforeCached = saved('e-cached');

const calls = new Map();
const selected = new Map();
let status;
const sync = createLiveReportSync({
  query:async statement=>run(statement,true),
  exec:async statement=>run(statement),
  sql,
  config:{dataDir:directory,moonshotApiKey:'synthetic-fragment-key',moonshotBaseUrl:'https://fixture.invalid/v1',kimiFollowupModel:model},
  settings:{policyFor:async()=>({weights:[30,25,25,20],deadlineTime:'20:00'})},
  refreshDirectory:async()=>{},
  writeStatus:async value=>{status=structuredClone(value);},
  pause:async()=>{},
  fetcher:async (url,options)=>{
    assert.equal(url,'https://fixture.invalid/v1/chat/completions');
    const request = JSON.parse(options.body);
    const input = JSON.parse(request.messages.find(message=>message.role==='user').content);
    const id = input.department;
    const facts = sources.get(id);
    assert(facts);
    const requests = calls.get(id)||[];
    requests.push({input,feedback:requests.length?JSON.parse(request.messages.at(-1).content).validationFeedback:null});
    calls.set(id,requests);

    const analysis = makeReportQualityAnalysis(facts,{evidenceLevels:['B','B','B','B']});
    const fragments = input.evidenceFragments;
    if(id!=='d-legacy-quote') {
      for(const module of analysis.modules) {
        const sourceFragments = fragments[module.id];
        const fragment = id==='a-fragments'&&module.id==='results'
          ? sourceFragments.filter(item=>item.text===repeated).at(-1)
          : sourceFragments[0];
        for(const criterion of module.criteria) {
          criterion.evidence = criterion.evidence.map(({type,level})=>({ref:fragment.id,type,level}));
        }
        if(id==='a-fragments') selected.set(module.id,fragment);
      }
    }
    const criteria = analysis.modules.find(module=>module.id==='results').criteria;
    if(id==='a-fragments') {
      criteria.find(criterion=>criterion.id==='evidence').evidence = [];
      analysis.tasks = [
        {title:'安排复检',description:'用本周计划安排下周复检。',evidenceRef:fragments.nextPlan[0].id,evidence:'PRIVATE_UNTRUSTED_TASK_QUOTE'},
        {title:'无依据任务',description:'没有可定位的片段。',evidenceRef:'PRIVATE_UNKNOWN_TASK_REFERENCE',evidence:repeated},
      ];
    }
    if(id==='b-corrective'&&requests.length===1) {
      criteria[0].evidence[0] = {...criteria[0].evidence[0],ref:fragments.problems[0].id,quote:repeated};
    }
    if(id==='c-invalid') criteria[0].evidence[0].ref = 'PRIVATE_UNKNOWN_PROVIDER_REFERENCE';
    if(id==='f-no-evidence') {
      for(const module of analysis.modules) for(const criterion of module.criteria) criterion.evidence = [];
    }
    return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(analysis)},finish_reason:'stop'}]})};
  },
});

await sync.run({mode:'rescore',targetMonth:month});
assert.equal(status.phase,'partial');
assert.equal(status.rowCount,6);
assert.equal(status.analyzed,3);
assert.equal(status.cached,1);
assert.equal(status.failed,2);
assert.equal(status.aiRequests,9);
assert.deepEqual(Object.fromEntries([...calls].map(([id,requests])=>[id,requests.length])),{
  'a-fragments':2,'b-corrective':2,'c-invalid':2,'d-legacy-quote':1,'f-no-evidence':2,
});
assert.deepEqual(saved('e-cached'),beforeCached,'the repair must reuse validated v3 scores');
assert.notEqual(REPORT_QUALITY_PROMPT_VERSION,priorPrompt);

const fragments = calls.get('a-fragments')[0].input.evidenceFragments;
for(const [module,entries] of Object.entries(fragments)) {
  const source = sources.get('a-fragments')[module];
  let end = 0;
  for(const {text} of entries) {
    const start = source.indexOf(text,end);
    assert(start>=end&&text.trim()&&text.length<=2000);
    assert.equal(source.slice(end,start).trim(),'','only inter-fragment whitespace may be omitted');
    assert.equal(text.isWellFormed(),true,'fragment boundaries must not split an emoji');
    end = start+text.length;
  }
  assert.equal(source.slice(end).trim(),'');
}
assert.equal(fragments.results.filter(entry=>entry.text===repeated).length,2);
const first = report('a-fragments');
assert.equal(first.results,results);
assert.equal(first.ai.version,REPORT_QUALITY_VERSION);
assert.equal(first.aiPromptVersion,REPORT_QUALITY_PROMPT_VERSION);
assert.equal(first.aiAnalysisAttempts.length,3,'previous attempt diagnostics survive recovery');
assert(first.aiAnalysisAttempts.slice(0,2).every(attempt=>attempt.promptVersion===priorPrompt));
assert.equal(calls.get('a-fragments')[1].feedback.code,'positive_score_without_evidence');
const resultCriteria = first.ai.modules.find(module=>module.id==='results').criteria;
const evidence = resultCriteria.find(criterion=>criterion.id==='result').evidence[0];
assert.deepEqual(evidence,{
  quote:selected.get('results').text,type:'reported_fact',level:'B',
  start:results.lastIndexOf(repeated),end:results.lastIndexOf(repeated)+repeated.length,
});
const missing = resultCriteria.find(criterion=>criterion.id==='evidence');
assert.equal(missing.score,0);
assert.equal(missing.rawScore,0);
assert.deepEqual(missing.evidence,[]);
assert(missing.missing.includes(NO_REPORT_EVIDENCE));
assert(resultCriteria.find(criterion=>criterion.id==='outcome').score>0,'only the unsupported item should lose points');
assert.deepEqual(first.ai.scores,[66,80,85,75]);
assert.equal(first.ai.recommendHumanReview,true);
assert.equal(reportQualityAssessment(first).modules[0].criteria[0].evidence[0].start,evidence.start);
assert.deepEqual(first.ai.tasks.map(task=>({title:task.title,evidence:task.evidence})),[
  {title:'安排复检',evidence:selected.get('nextPlan').text},
]);
assert(!JSON.stringify(first.ai.tasks).includes('evidenceRef'));
assert(!JSON.stringify(first.ai.tasks).includes('PRIVATE_'));

const corrective = report('b-corrective');
assert.equal(corrective.qualityRefresh.state,'ready');
assert.equal(corrective.qualityRefresh.attempts,2);
assert.deepEqual(corrective.ai.scores,[86.4,80,85,75],'reference resolution preserves existing evidence weighting');
assert.equal(calls.get('b-corrective')[1].feedback.code,'invalid_evidence_reference');
assert.deepEqual(calls.get('b-corrective')[1].input.evidenceFragments,calls.get('b-corrective')[0].input.evidenceFragments);
const rejected = report('c-invalid');
assert.equal(rejected.ai,undefined);
assert.equal(rejected.qualityRefresh.state,'failed');
assert.equal(rejected.qualityRefresh.attempts,2);
assert.equal(rejected.qualityRefresh.diagnostic.code,'invalid_evidence_reference');
assert(!JSON.stringify(rejected.aiAnalysisAttempts).includes('PRIVATE_UNKNOWN_PROVIDER_REFERENCE'));
assert(!JSON.stringify(status.diagnostics).includes('PRIVATE_UNKNOWN_PROVIDER_REFERENCE'));

const exactQuote = report('d-legacy-quote');
assert.equal(exactQuote.qualityRefresh.state,'ready');
assert.equal(exactQuote.qualityRefresh.attempts,1);
assert.equal(exactQuote.ai.modules[0].criteria[0].evidence[0].quote,repeated);
const unsupported = report('f-no-evidence');
assert.equal(unsupported.ai,undefined,'an entirely unsupported reply cannot produce a new candidate');
assert.equal(unsupported.qualityRefresh.state,'failed');
assert.equal(unsupported.qualityRefresh.attempts,2);
assert.equal(unsupported.qualityRefresh.diagnostic.code,'positive_score_without_evidence');
assert.equal(run('SELECT count(*) FROM import_batches;'),'0');
assert.equal(run("SELECT count(*) FROM performance_results WHERE kind='quality';"),'0');
console.log('Report evidence fragment tests passed: selected source offsets, criterion-only missing evidence, corrective retry, invalid ref rejection, task evidence, exact quote and prior cache compatibility.');
console.log('Synthetic artifacts retained:',directory);
