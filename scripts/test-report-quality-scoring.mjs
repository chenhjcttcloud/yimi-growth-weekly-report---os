import assert from 'node:assert/strict';
import {LEGACY_REPORT_QUALITY_VERSION,NO_REPORT_EVIDENCE,REPORT_QUALITY_VERSION,REPORT_QUALITY_PROMPT_VERSION,REPORT_QUALITY_RUBRIC,buildReportQualityPrompt,validateReportQualityAnalysis,reportQualityAssessment,qualityAnalysisDiagnostic} from '../server/report-quality-scoring.mjs';
import {validateAnalysis} from '../server/live-report-sync.mjs';
import {makeReportQualityAnalysis} from './report-quality-test-fixtures.mjs';

const facts={results:'完成5家客户拜访，签约2家，合同金额50万元。',problems:'验收口径不一致影响交付，已约双方周三确认，需要产品支持。',nextPlan:'优先完成接口验证，周五前交付验收记录，标准为3项测试通过。',reflection:'先明确验收口径可以减少返工，下次复用检查清单。'};
const fixture=(options={})=>makeReportQualityAnalysis(facts,options);
const clone=value=>structuredClone(value);
const expectedScores=[90,80,85,75];
const checked=validateReportQualityAnalysis(fixture(),facts);
assert.equal(checked.version,REPORT_QUALITY_VERSION);
assert.equal(checked.promptVersion,REPORT_QUALITY_PROMPT_VERSION);
assert.deepEqual(checked.scores,expectedScores,'program derives normalized module scores from criterion points');
assert.equal(checked.modules.length,4);
assert.equal(validateReportQualityAnalysis(fixture({scores:[70,82,78,70]}),facts).totalScore,75,'four-module weights are applied once');
assert.equal(checked.evidenceLevel,'A');
assert.equal(checked.factConflict,false);
assert.equal(checked.recommendHumanReview,false);
for(const [index,module] of checked.modules.entries()){
 assert.equal(module.candidateScore,expectedScores[index]);assert.equal(module.maxScore,100);
 assert.equal(module.criteria.length,REPORT_QUALITY_RUBRIC[index].criteria.length);
 assert(module.reason);assert(module.evidence.length);
 assert(module.strengths.length);assert(module.deductions.length);
 for(const criterion of module.criteria){
  assert(criterion.reason);assert(criterion.evidence.length);assert(Number.isFinite(criterion.score));
  for(const evidence of criterion.evidence){assert.equal(facts[module.id].slice(evidence.start,evidence.end),evidence.quote,'source offsets resolve to the exact own-module quote');}
 }
}
const ignoredTotals=fixture();ignoredTotals.scores=[1,2,3,4];for(const module of ignoredTotals.modules)module.candidateScore=0;
assert.deepEqual(validateReportQualityAnalysis(ignoredTotals,facts).scores,expectedScores,'AI-provided totals cannot override criterion sums');
assert.deepEqual(validateAnalysis(fixture(),facts).scores,expectedScores,'live analysis validation retains structured grades');
assert.equal(validateAnalysis(fixture(),facts).modules[0].criteria[0].reason,fixture().modules[0].criteria[0].reason);
assert.deepEqual(validateAnalysis({scores:[1,2,3,4],summary:'历史分析'}).scores,[1,2,3,4],'legacy inspection remains compatible without inventing detailed evidence');
assert.throws(()=>validateAnalysis({scores:[1,2,3,4],summary:'旧格式不能用于新评分'},facts),'live scoring requires explanations and evidence');

const internalFacts={...facts,results:'样品已寄出，供应商已在项目台账回填签收，李工周五汇总测试反馈。'};
const internal=makeReportQualityAnalysis(internalFacts,{scores:[85,80,85,75],evidenceLevels:['B','B','B','B']});
internal.modules[0].criteria[1].missing=[NO_REPORT_EVIDENCE];
const internalChecked=validateReportQualityAnalysis(internal,internalFacts);
assert.equal(internalChecked.evidenceLevel,'B');
assert.equal(internalChecked.modules[0].candidateScore,81.6,'B only applies a factor to the dedicated evidence criterion');
const [internalResult,internalEvidence]=internalChecked.modules[0].criteria;
assert.equal(internalResult.score,8.5,'results and value receive no blanket evidence discount');
assert.equal(internalEvidence.score,internal.modules[0].criteria[1].score*.85);
assert.deepEqual(internalEvidence.missing,[],'B counts as valid evidence');
assert.deepEqual(validateReportQualityAnalysis(internalChecked,internalFacts),internalChecked,'the factor is applied once across cache revalidation');

const selfReportedFacts={
 results:'已完成两版样品方案对齐，当前待二次打样，李工周五跟进供应商出样。',
 problems:'供应商首版尺寸偏大，目前已对齐修订口径，李工周五检查修正版。',
 nextPlan:'下周继续验证修正版，规格清单已整理，李工周五提交对照结果。',
 reflection:'首版偏差来自接口定义不清，已整理校对表，下批打样前由李工复用。',
};
const selfReported=makeReportQualityAnalysis(selfReportedFacts,{scores:[70,68,72,70],evidenceLevels:['C','C','C','C']});
const selfReportedChecked=validateReportQualityAnalysis(selfReported,selfReportedFacts);
assert.equal(selfReportedChecked.evidenceLevel,'C');
assert.equal(selfReportedChecked.totalScore,70,'clear self-reports can receive 60–74');
const capped=makeReportQualityAnalysis(selfReportedFacts,{scores:[100,100,100,100],evidenceLevels:['C','C','C','C']});
assert.equal(validateReportQualityAnalysis(capped,selfReportedFacts).modules[0].criteria[1].score,8*.74,'self-reported evidence cannot get full evidence points');

const vagueFacts=Object.fromEntries(Object.keys(facts).map(key=>[key,'持续推进，加强沟通。']));
const vague=makeReportQualityAnalysis(vagueFacts,{scores:[100,100,100,100],evidenceLevels:['D','D','D','D']});
const vagueChecked=validateReportQualityAnalysis(vague,vagueFacts);
assert.equal(vagueChecked.totalScore,30,'vague claims cannot get above 30 even if the AI raw score is high');
assert(vagueChecked.modules.every(module=>module.missing.includes(NO_REPORT_EVIDENCE)),'a vague quote does not count as evidence');
const partialFacts={...facts,results:'开会讨论了样品配色。'};
const partial=makeReportQualityAnalysis(partialFacts,{scores:[55,80,85,75],evidenceLevels:[null,'B','B','B']});
assert.equal(validateReportQualityAnalysis(partial,partialFacts).modules[0].candidateScore,55,'specific processes with weak outcomes can receive 45–59');

const inapplicable=fixture({scores:[70,80,85,75]});
const omitted=inapplicable.modules[0].criteria[1];
Object.assign(omitted,{score:0,applicable:false,notApplicableReason:'该周工作仅评估方案，无对应交付或可独立核验证据要求。',missing:[],evidence:[]});
const omittedChecked=validateReportQualityAnalysis(inapplicable,facts).modules[0];
assert.equal(omittedChecked.applicableMaxScore,22);
assert.equal(omittedChecked.candidateScore,70,'inapplicable points exit the denominator');
assert.equal(omittedChecked.criteria[1].notApplicableReason,omitted.notApplicableReason);
for(const criterion of inapplicable.modules[0].criteria) Object.assign(criterion,omitted,{id:criterion.id});
assert.throws(()=>validateReportQualityAnalysis(inapplicable,facts),'a nonempty module cannot opt out of every criterion');

const noEvidence=fixture();
Object.assign(noEvidence.modules[0].criteria[1],{score:0,evidence:[],missing:[]});
const noEvidenceChecked=validateReportQualityAnalysis(noEvidence,facts);
assert(noEvidenceChecked.modules[0].criteria[1].missing.includes(NO_REPORT_EVIDENCE));
assert(noEvidenceChecked.modules[0].missing.includes(NO_REPORT_EVIDENCE));
assert.equal(noEvidenceChecked.modules[0].criteria[0].score,checked.modules[0].criteria[0].score);
const conflict=validateReportQualityAnalysis(fixture({factConflict:true}),facts);
assert.equal(conflict.factConflict,true);
assert.equal(conflict.recommendHumanReview,true);

for(const score of [-1,Infinity,NaN,'5',null,REPORT_QUALITY_RUBRIC[0].criteria[0].maxScore+1]){
 const invalid=fixture();invalid.modules[0].criteria[0].score=score;
 assert.throws(()=>validateReportQualityAnalysis(invalid,facts),'invalid criterion points must not publish: '+String(score));
}
for(const change of [
 value=>{value.modules[0].criteria[0].evidence=[{quote:'员工从未提交的伪造结果',type:'reported_fact'}];},
 value=>{value.modules[0].criteria[0].evidence=[{quote:facts.problems,type:'reported_fact'}];},
 value=>{value.modules[0].criteria[0].evidence=[{quote:facts.results,type:'verified_fact'}];},
 value=>{value.modules[0].criteria[0].evidence[0].level='unknown';},
 value=>{value.modules[2].criteria[0].evidence[0].level='A';},
 value=>{value.modules[0].criteria[0].evidence=[];},
 value=>{value.modules[0].criteria[0].reason=' ';},
 value=>{value.modules[0].reason='';},
 value=>{value.modules[0].confidence=1.01;},
 value=>{value.modules[0].confidence='high';},
 value=>{value.modules[0].criteria[1].id=value.modules[0].criteria[0].id;},
 value=>{value.modules[1].id=value.modules[0].id;},
 value=>{value.modules[0].criteria.pop();},
 value=>{value.factConflict='false';},
]){
 const invalid=fixture();change(invalid);assert.throws(()=>validateReportQualityAnalysis(invalid,facts),'invalid structure, reasons, confidence or source quotes are rejected');
}
const lowConfidence=fixture({scores:[40,40,40,40],confidence:.1,anomalies:['数据存在矛盾，仅展示异常']});
const low=validateAnalysis(lowConfidence,facts);assert.deepEqual(low.scores,[40,40,40,40]);assert.equal(low.modules[0].confidence,.1);assert(low.anomalies.includes('数据存在矛盾，仅展示异常'));assert(low.recommendHumanReview,'low-confidence analyses produce candidates with a review suggestion');
const unknownConfidence=fixture({confidence:null});assert.equal(validateReportQualityAnalysis(unknownConfidence,facts).modules[0].confidence,null);
const flaggedAssessment=reportQualityAssessment({...facts,ai:low,aiModel:'flagged-fixture'});
assert(flaggedAssessment.anomalies.includes('数据存在矛盾，仅展示异常'),'both personal and management assessment contracts preserve informational anomalies');
const missingFacts={...facts,reflection:' \n '};
const missing=validateReportQualityAnalysis(fixture(),missingFacts);
assert.equal(missing.scores[3],0,'missing module is forced to zero even if AI assigns positive criterion points');
assert.equal(missing.modules[3].candidateScore,0);assert(missing.modules[3].missing.length);assert(missing.modules[3].criteria.every(c=>c.score===0&&c.evidence.length===0));
const supplied=fixture();const before=clone(supplied);validateReportQualityAnalysis(supplied,facts);assert.deepEqual(supplied,before,'validation does not mutate the upstream payload');
// Persisted, normalized analysis must still validate on reads and cache reuse.
// Distinct missing details across criteria used to make the merged module list
// exceed its own input limit, leaving an initially valid result pending forever.
const detailedMissing=fixture();
for(const module of detailedMissing.modules){
 module.missing=Array.from({length:10},(_,index)=>`${module.id}模块待补充${index}`);
 for(const criterion of module.criteria)criterion.missing=Array.from({length:10},(_,index)=>`${module.id}/${criterion.id}细项待补充${index}`);
}
const normalizedMissing=validateReportQualityAnalysis(detailedMissing,facts);
const checkedAgain=validateReportQualityAnalysis(normalizedMissing,facts);
assert.deepEqual(checkedAgain,normalizedMissing,'normalized scoring details must be idempotent through cache revalidation');
const storedAssessment=reportQualityAssessment({...facts,ai:normalizedMissing,aiModel:'roundtrip-fixture-model',aiGeneratedAt:'2026-11-02T00:00:00Z',sourceHash:'roundtrip-fixture-source'});
assert(storedAssessment,'a valid result with many missing evidence details must remain publishable after storage');
assert.equal(storedAssessment.modules.length,4);
assert.equal(storedAssessment.model,'roundtrip-fixture-model');
assert.equal(storedAssessment.generatedAt,'2026-11-02T00:00:00Z');
assert.equal(storedAssessment.sourceHash,'roundtrip-fixture-source');
for(const [moduleIndex,module] of storedAssessment.modules.entries()){
 assert(module.missing.length<=10,'module-level display summary stays bounded');
 for(const [criterionIndex,criterion] of module.criteria.entries())assert.deepEqual(criterion.missing,detailedMissing.modules[moduleIndex].criteria[criterionIndex].missing,'every original criterion-level missing evidence detail is retained');
}
// Diagnostic locations are stable schema identifiers, never excerpts of employee
// content or provider responses. Corrective retries can address exactly one cause.
function diagnosticFor(change) {
 const value=fixture();change(value);
 try{validateReportQualityAnalysis(value,facts);assert.fail('invalid fixture must be rejected');}
 catch(error){assert.equal(error.message,'invalid_ai_quality_analysis');assert.equal(error.code,'invalid_ai_quality_analysis');return qualityAnalysisDiagnostic(error);}
}
const criterionContext={moduleId:'results',criterionId:'result',retryable:true};
assert.deepEqual(diagnosticFor(value=>{value.modules=value.modules.slice(0,3);}),{code:'missing_module',path:'modules.reflection',moduleId:'reflection',retryable:true});
assert.deepEqual(diagnosticFor(value=>{value.modules[0].reason=' ';}),{code:'required_text',path:'modules.results.reason',moduleId:'results',retryable:true});
assert.deepEqual(diagnosticFor(value=>{value.modules[0].criteria[0].reason=undefined;}),{code:'required_text',path:'modules.results.criteria.result.reason',...criterionContext});
assert.deepEqual(diagnosticFor(value=>{value.modules[0].criteria[0].score=11;}),{code:'invalid_score',path:'modules.results.criteria.result.score',...criterionContext});
assert.deepEqual(diagnosticFor(value=>{value.modules[0].criteria[0].evidence=[{quote:'PRIVATE_EMPLOYEE_RESULT_DO_NOT_LOG',type:'reported_fact'}];}),{code:'evidence_not_in_source',path:'modules.results.criteria.result.evidence[0].quote',...criterionContext});
assert.deepEqual(diagnosticFor(value=>{value.modules[0].confidence=undefined;}),{code:'invalid_confidence',path:'modules.results.confidence',moduleId:'results',retryable:true});
assert.deepEqual(diagnosticFor(value=>{value.modules[0].missing=Array(11).fill('PRIVATE_EMPLOYEE_MISSING_DETAIL');}),{code:'too_many_missing',path:'modules.results.missing',moduleId:'results',retryable:true});
assert.deepEqual(diagnosticFor(value=>{value.modules[0].criteria[0].evidence=Array(9).fill({quote:facts.results,type:'reported_fact'});}),{code:'too_many_evidence',path:'modules.results.criteria.result.evidence',...criterionContext});
assert.deepEqual(diagnosticFor(value=>{value.modules[0].criteria[0].evidence=[{quote:facts.results,type:'PRIVATE_PROVIDER_VALUE'}];}),{code:'invalid_evidence_type',path:'modules.results.criteria.result.evidence[0].type',...criterionContext});
assert.deepEqual(diagnosticFor(value=>{value.modules[0].criteria=value.modules[0].criteria.slice(1);}),{code:'missing_criterion',path:'modules.results.criteria.result',...criterionContext});
const spoofed=Object.assign(Error('PRIVATE_RESPONSE_OR_API_KEY'),{code:'evidence_not_in_source',path:'PRIVATE_EMPLOYEE_QUOTE',moduleId:'PRIVATE_NAME',criterionId:'PRIVATE_ID',retryable:true});
assert.deepEqual(qualityAnalysisDiagnostic(spoofed),{code:'analysis_failed',path:'$',retryable:false});
assert.deepEqual(qualityAnalysisDiagnostic(new SyntaxError('PRIVATE_TRUNCATED_PROVIDER_JSON')),{code:'invalid_json',path:'$',retryable:true});
assert(!JSON.stringify(qualityAnalysisDiagnostic(spoofed)).includes('PRIVATE_'),'opaque exception text and forged diagnostic properties cannot reach logs or retry feedback');
const oldPromptAssessment=reportQualityAssessment({...facts,ai:{...checked,promptVersion:REPORT_QUALITY_VERSION},aiPromptVersion:REPORT_QUALITY_VERSION});
assert.equal(oldPromptAssessment.promptVersion,REPORT_QUALITY_VERSION,'old saved scoring evidence keeps its actual prompt provenance');
const legacyFixture=fixture();
legacyFixture.version=LEGACY_REPORT_QUALITY_VERSION;
for(const module of legacyFixture.modules) {
 for(const criterion of module.criteria) criterion.evidence=criterion.evidence.map(({quote,type})=>({quote,type}));
}
const legacyAssessment=reportQualityAssessment({...facts,ai:legacyFixture});
assert.deepEqual(legacyAssessment.scores,expectedScores,'historical structured scoring remains readable with its original scoring rules');
assert.equal(legacyAssessment.modules[0].evidenceLevel,undefined,'historical evidence grades are never invented');
assert.throws(()=>validateReportQualityAnalysis(legacyFixture,facts),'historical evidence shape cannot pass the new provider validator');
const prompt=buildReportQualityPrompt();
for(const module of REPORT_QUALITY_RUBRIC){assert(prompt.includes(module.module));for(const criterion of module.criteria){assert(prompt.includes(criterion.id));assert(prompt.includes(criterion.standard));}}
assert(prompt.includes(REPORT_QUALITY_VERSION),'request includes a versioned scoring rule');
assert(prompt.includes(REPORT_QUALITY_PROMPT_VERSION),'request includes the new corrective prompt version');
for(const module of REPORT_QUALITY_RUBRIC){
 const occurrences=prompt.split('\"id\":\"'+module.id+'\"').length-1;
 assert(occurrences>=2,'each module appears in both fixed rubric and complete response template');
 for(const criterion of module.criteria){assert(prompt.split('\"id\":\"'+criterion.id+'\"').length-1>=2,'every criterion is present in the response template');}
}
console.log('report quality scoring tests passed: fixed weights, evidence grades and offsets, N/A normalization, review flags, legacy compatibility and versioned rubric; no upstream calls or data writes');
