import assert from 'node:assert/strict';
import {ACTIVE_REPORT_QUALITY_VERSION,ACTIVE_REPORT_QUALITY_PROMPT_VERSION,ACTIVE_REPORT_QUALITY_REVIEW_PROMPT_VERSION,
 ACTIVE_REPORT_QUALITY_WEIGHTS,ACTIVE_REPORT_QUALITY_RUBRIC,buildActiveReportQualityPrompt,buildActiveReportQualityReviewPrompt,
 validateActiveReportQualityAnalysis,activeQualityDiagnostic,isActiveQualityValidationFailure} from '../server/report-quality-active.mjs';
import {REPORT_QUALITY_COACHING_VERSION,REPORT_QUALITY_COACHING_PROMPT_VERSION,buildReportQualityCoachingPrompt,
 buildReportQualityCoachingReviewPrompt,validateReportQualityCoachingAnalysis} from '../server/report-quality-coaching.mjs';
import {buildReportEvidenceFragments} from '../server/report-evidence-fragments.mjs';

// Synthetic adapter tests only. This test never opens a database, writes runtime
// files, contacts a provider or alters historical scores and publication state.
const facts={results:'【虚构校验】样品参数已对齐，正在等待下一轮打样确认。',
 problems:'【虚构校验】双方口径不一致影响后续打样，目前已经协调统一参数。',
 nextPlan:'【虚构校验】下周重点核对修订版并跟进月底交付。',
 reflection:'【虚构校验】先统一范围再核对参数更有效，下次按这一顺序协调。'};
function fixture(){
 const fragments=buildReportEvidenceFragments(facts);
 return {modules:ACTIVE_REPORT_QUALITY_RUBRIC.map(module=>({id:module.id,reason:'本模块实际原文已经说明核心信息。',strengths:[],suggestions:[],confidence:0.8,
  criteria:module.criteria.map(criterion=>({id:criterion.id,score:criterion.maxScore,reason:'原文支持本细项要求。',evidence:[{ref:fragments[module.id][0].id,type:module.id==='nextPlan'?'plan':module.id==='reflection'?'judgment':'reported_fact'}]})),
 })),summary:'工作推进和阶段状态清楚，后续继续按已定顺序协调。',questions:[],riskSignals:[]};
}
const raw=fixture(),before=structuredClone(raw),sourceBefore=structuredClone(facts);
const active=validateActiveReportQualityAnalysis(raw,facts);
assert.deepEqual(raw,before);assert.deepEqual(facts,sourceBefore);
assert.equal(active.version,'weekly-quality-coaching-2026-11-19-v1');
assert.equal(active.promptVersion,'weekly-quality-coaching-prompt-2026-11-19-v1');
assert.equal(ACTIVE_REPORT_QUALITY_REVIEW_PROMPT_VERSION,'weekly-quality-coaching-review-2026-11-19-v1');
assert.deepEqual(ACTIVE_REPORT_QUALITY_WEIGHTS,[30,25,25,20]);
assert.deepEqual(active.scores,[100,100,100,100]);assert.equal(active.totalScore,100);
assert.equal(active.publicationMode,'management_confirmation');assert.equal(active.requiresMonthlyConfirmation,true);
assert(!Object.hasOwn(active,'previewOnly'));assert(!Object.hasOwn(active,'humanConfirmationRequired'));
assert(!JSON.stringify(active).includes('evidenceLevel'));assert(!JSON.stringify(active).includes('"level"'));
assert.deepEqual(validateActiveReportQualityAnalysis(active,facts),active,'active output revalidates under its own version and monthly confirmation contract');
assert.deepEqual(validateActiveReportQualityAnalysis(raw,facts,{evidenceFragments:buildReportEvidenceFragments(facts)}),active);
const preview=validateReportQualityCoachingAnalysis(raw,facts,{mode:'preview'});
assert.equal(preview.version,REPORT_QUALITY_COACHING_VERSION);assert(preview.previewOnly&&preview.humanConfirmationRequired);
assert.equal(preview.publicationMode,'preview_only');
assert.throws(()=>validateActiveReportQualityAnalysis(preview,facts),error=>activeQualityDiagnostic(error).code==='preview_input_forbidden');
assert.throws(()=>validateActiveReportQualityAnalysis({...raw,version:REPORT_QUALITY_COACHING_VERSION},facts),error=>activeQualityDiagnostic(error).code==='wrong_version');
assert.throws(()=>validateActiveReportQualityAnalysis({...raw,promptVersion:REPORT_QUALITY_COACHING_PROMPT_VERSION},facts),error=>activeQualityDiagnostic(error).code==='wrong_version');
for(const marker of [{previewOnly:true},{previewOnly:false},{humanConfirmationRequired:true},{humanConfirmationRequired:false},{publicationMode:'preview_only'}]){
 assert.throws(()=>validateActiveReportQualityAnalysis({...raw,...marker},facts),error=>activeQualityDiagnostic(error).code==='preview_input_forbidden');
}
for(const marker of [{publicationMode:'automatic'},{requiresMonthlyConfirmation:false}])assert.throws(()=>validateActiveReportQualityAnalysis({...raw,...marker},facts),error=>activeQualityDiagnostic(error).code==='invalid_confirmation_mode');
assert.throws(()=>validateActiveReportQualityAnalysis(raw,facts,{mode:'preview'}),error=>activeQualityDiagnostic(error).code==='invalid_active_mode');
assert.throws(()=>validateReportQualityCoachingAnalysis(active,facts,{mode:'preview'}),'the strict offline preview entry point cannot silently rebrand an active assessment');
assert.throws(()=>buildReportQualityCoachingPrompt(),/coaching_preview_required/);
assert.throws(()=>buildReportQualityCoachingReviewPrompt(),/coaching_preview_required/);

const prompt=buildActiveReportQualityPrompt(),review=buildActiveReportQualityReviewPrompt();
for(const value of [prompt,review]){
 assert(value.includes(ACTIVE_REPORT_QUALITY_VERSION)&&value.includes(ACTIVE_REPORT_QUALITY_PROMPT_VERSION));
 for(const removed of ['preview','当前为显式','四份实际周报并人工确认后才能考虑启用','试评不得替换既有','这次候选对比'])assert(!value.includes(removed),removed);
 assert(value.includes('月度最终分仍需主管确认'));
 for(const rule of ['下周计划默认期限是下周','不要求附件','不生成A/B/C/D','最多2条','没有最低分托底'])assert(value.includes(rule),rule);
 for(const taskField of ['tasks数组','最多4项','title','description','priority','evidenceRef','metric','firstStep','supportNeeded'])assert(value.includes(taskField),taskField);
 assert(value.includes('任务不影响质量分'));assert(value.includes('不代表已创建任务、发送消息或执行任何写入'));
}
assert(review.includes(ACTIVE_REPORT_QUALITY_REVIEW_PROMPT_VERSION));
assert(review.includes('不得仅因评分复核而删除、编造或增加行动任务'));
assert(!prompt.includes(ACTIVE_REPORT_QUALITY_REVIEW_PROMPT_VERSION));
assert(buildReportQualityCoachingPrompt({mode:'preview'}).includes('当前为显式preview试评'),'active adapters do not mutate the offline preview contract');
assert.equal(validateReportQualityCoachingAnalysis(raw,facts,{mode:'preview'}).promptVersion,REPORT_QUALITY_COACHING_PROMPT_VERSION);

function reject(change,expected){
 const payload=fixture();change(payload);
 assert.throws(()=>validateActiveReportQualityAnalysis(payload,facts),error=>{
  assert.equal(error.message,'invalid_ai_quality_analysis');assert.equal(error.code,'invalid_ai_quality_analysis');
  const diagnostic=activeQualityDiagnostic(error);assert.equal(diagnostic.code,expected);assert(diagnostic.retryable);
  assert(isActiveQualityValidationFailure(diagnostic.code));return true;
 });
}
reject(value=>{value.modules.pop();},'invalid_module_count');
reject(value=>{value.modules[0].criteria[0].score=true;},'invalid_score');
reject(value=>{value.modules[1].criteria[3].evidence=[];},'positive_score_without_reference');
reject(value=>{value.modules[1].criteria[3].evidence=[{ref:'reflection-1',type:'judgment'}];},'invalid_reference');
reject(value=>{value.modules[0].suggestions=['一','二','三'];},'invalid_text_list');
reject(value=>{value.modules[2].evidenceLevel='A';},'evidence_grading_forbidden');
reject(value=>{value.modules[0].criteria[0].evidence=[{quote:'PRIVATE_PROVIDER_QUOTE',type:'reported_fact'}];},'reference_not_in_source');
const zero=fixture();for(const module of zero.modules)for(const criterion of module.criteria){criterion.score=0;criterion.evidence=[];}
assert.equal(validateActiveReportQualityAnalysis(zero,facts).totalScore,0,'activation does not introduce a minimum score floor');
const falsified=Object.assign(Error('PRIVATE_MODEL_MESSAGE'),{code:'invalid_score',path:'PRIVATE_SOURCE_TEXT'});
assert.deepEqual(activeQualityDiagnostic(falsified),{code:'analysis_failed',path:'$',retryable:false});
assert.deepEqual(activeQualityDiagnostic(new SyntaxError('PRIVATE_JSON')),{code:'invalid_json',path:'$',retryable:true});
assert.equal(isActiveQualityValidationFailure('response_truncated'),true);assert.equal(isActiveQualityValidationFailure('invented_provider_error'),false);
assert(!JSON.stringify(activeQualityDiagnostic(falsified)).includes('PRIVATE_'));
console.log('Active coaching adapter tests passed: distinct active/preview versions; explicit monthly confirmation; preview rejection; exact citations, strict scoring and safe diagnostics; active prompts retain task extraction and reviewer task preservation; no data writes or provider calls.');
