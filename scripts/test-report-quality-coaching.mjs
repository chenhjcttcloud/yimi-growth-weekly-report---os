import assert from 'node:assert/strict';
import {REPORT_QUALITY_COACHING_VERSION,REPORT_QUALITY_COACHING_PROMPT_VERSION,REPORT_QUALITY_COACHING_WEIGHTS,
 REPORT_QUALITY_COACHING_RUBRIC,REPORT_QUALITY_COACHING_VERIFICATION_WORDING,buildReportQualityCoachingPrompt,
 validateReportQualityCoachingAnalysis,reportQualityCoachingDiagnostic,REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION,
 buildReportQualityCoachingReviewPrompt} from '../server/report-quality-coaching.mjs';
import {buildReportEvidenceFragments} from '../server/report-evidence-fragments.mjs';
import {REPORT_QUALITY_VERSION,REPORT_QUALITY_PROMPT_VERSION,buildReportQualityPrompt,reportQualityAssessment} from '../server/report-quality-scoring.mjs';
import {currentQualityCached} from '../server/report-rescore-state.mjs';

// Fictional unit-test text only, never the user's pending four employee cases.
// No provider requests, database calls, runtime files, employee identities or publication.
const repeated='【虚构校验文字】与供应商明确样品修订口径，目前已完成参数对齐，等待修订版回传以推进下一阶段。';
const facts={results:repeated+'\r\n'+repeated,
 problems:'【虚构校验文字】样品尺寸口径存在分歧，影响下一轮对接；当前已协调双方确认修订范围。',
 nextPlan:'【虚构校验文字】下周重点跟进修订版，周五前完成参数核对，协同供应商按已确认范围回传。',
 reflection:'【虚构校验文字】这次对齐发现沟通顺序影响效率，下次先明确范围再讨论参数，可复用同样的对齐顺序。'};
const options={mode:'preview'},clone=value=>structuredClone(value);
function fixture(source=facts,scale=1){
 const fragments=buildReportEvidenceFragments(source);
 return {modules:REPORT_QUALITY_COACHING_RUBRIC.map(module=>({id:module.id,reason:'根据本模块原文说明表达和工作推进的具体情况。',
  strengths:['具体说明了工作对象与当前推进。'],suggestions:['下次可用一句话突出下一步的重点。'],confidence:0.8,
  criteria:module.criteria.map(criterion=>({id:criterion.id,score:criterion.maxScore*scale,reason:'原文提供了与本细项相关的具体说明。',
   evidence:fragments[module.id].length?[{ref:fragments[module.id].at(-1).id,type:module.id==='nextPlan'?'plan':module.id==='reflection'?'judgment':'reported_fact'}]:[]})),
 })),summary:'已经说明日常工作推进和阶段状态，可以继续练习把重点表达得更清楚。',questions:[],riskSignals:[]};
}
function validate(value=fixture(),source=facts,extra={}){return validateReportQualityCoachingAnalysis(value,source,{...options,...extra});}
function rejects(change,code){
 const value=fixture();change(value);
 assert.throws(()=>validate(value),error=>error.code==='invalid_coaching_preview_analysis'&&(!code||reportQualityCoachingDiagnostic(error).code===code));
}
const before=clone(facts),raw=fixture(),rawBefore=clone(raw),full=validate(raw);
assert.deepEqual(facts,before);assert.deepEqual(raw,rawBefore,'candidate validation never mutates the submitted report or provider payload');
assert.equal(full.version,REPORT_QUALITY_COACHING_VERSION);assert.equal(full.promptVersion,REPORT_QUALITY_COACHING_PROMPT_VERSION);
assert(full.previewOnly&&full.humanConfirmationRequired);assert.equal(full.publicationMode,'preview_only');
assert.deepEqual(full.weights,[30,25,25,20]);assert.deepEqual(REPORT_QUALITY_COACHING_WEIGHTS,[30,25,25,20]);
assert.deepEqual(full.modules.map(module=>module.id),['results','problems','nextPlan','reflection']);
assert.deepEqual(full.modules.map(module=>module.maxPoints),[30,25,25,20]);
assert.deepEqual(full.modules.map(module=>module.criteria.map(criterion=>criterion.maxScore)),[[12,10,5,3],[10,6,5,4],[10,6,4,3,2],[6,6,6,2]]);
assert.deepEqual(full.scores,[100,100,100,100]);assert.equal(full.totalScore,100,'a clear self-report is not capped merely because there are no attachments or external records');
assert(!JSON.stringify(full).includes('evidenceLevel'));assert(!JSON.stringify(full).includes('"level"'));
const noSuggestions=fixture();for(const module of noSuggestions.modules)module.suggestions=[];
assert(validate(noSuggestions).modules.every(module=>module.suggestions.length===0),'the validator never pads an unnecessary suggestion list');
assert.equal(full.recommendHumanReview,false);assert.equal(full.verification.wording,null);
assert.deepEqual(validate(full),full,'persisting an isolated preview JSON does not change scores when revalidated');
for(const module of full.modules)for(const criterion of module.criteria)for(const citation of criterion.evidence){
 assert.equal(facts[module.id].slice(citation.start,citation.end),citation.quote);
}
assert.equal(full.modules[0].criteria[0].evidence[0].start,facts.results.lastIndexOf(repeated),'repeated references retain their exact selected occurrence');
const fragments=buildReportEvidenceFragments(facts);
assert.deepEqual(validate(raw,facts,{evidenceFragments:fragments}),full);
const forgedFragments=clone(fragments);forgedFragments.results.at(-1).start=String(forgedFragments.results.at(-1).start);
assert.throws(()=>validate(raw,facts,{evidenceFragments:forgedFragments}),error=>reportQualityCoachingDiagnostic(error).code==='invalid_reference');
const manyReferencesFacts={...facts,results:Array.from({length:9},(_,index)=>`【虚构多片段校验】第${index+1}项参数已经明确。`).join('\n')};
const manyReferences=fixture(manyReferencesFacts),manyFragments=buildReportEvidenceFragments(manyReferencesFacts);
manyReferences.modules[0].criteria[0].evidence=manyFragments.results.map(fragment=>({ref:fragment.id,type:'reported_fact'}));
assert.equal(manyReferences.modules[0].criteria[0].evidence.length,9);
const manyChecked=validate(manyReferences,manyReferencesFacts);
assert.equal(manyChecked.modules[0].criteria[0].evidence.length,9,'nine valid own-source citations are retained without rescoring');
assert.equal(manyChecked.totalScore,100,'citation count affects neither point totals nor content quality');
const excessiveReferences=clone(manyReferences);
excessiveReferences.modules[0].criteria[0].evidence=Array.from({length:65},()=>({ref:manyFragments.results[0].id,type:'reported_fact'}));
assert.throws(()=>validate(excessiveReferences,manyReferencesFacts),error=>reportQualityCoachingDiagnostic(error).code==='invalid_reference_list');

const weighted=fixture();
for(const [index,module] of weighted.modules.entries())for(const criterion of module.criteria)criterion.score*=([0.8,0.6,0.4,0.2][index]);
assert.deepEqual(validate(weighted).scores,[80,60,40,20]);assert.equal(validate(weighted).totalScore,53,'weights apply once in the original score-array order');
const fractional=fixture(facts,0.73),fractionalResult=validate(fractional);
assert.equal(fractionalResult.totalScore,Math.round(fractionalResult.modules.reduce((sum,module)=>sum+module.earnedPoints,0)*10)/10,'total is the sum of the displayed 30/25/25/20 contribution points');
const forgedTotals=fixture();forgedTotals.scores=[0,0,0,0];forgedTotals.totalScore=0;
for(const module of forgedTotals.modules)module.candidateScore=0;
assert.equal(validate(forgedTotals).totalScore,100,'untrusted aggregate totals cannot override fixed criterion scoring');
const zero=fixture(facts,0);
for(const module of zero.modules){module.confidence=0.05;for(const criterion of module.criteria)criterion.evidence=[];}
zero.recommendHumanReview=true;zero.factConflict=true;
const zeroResult=validate(zero);
assert.equal(zeroResult.totalScore,0,'the coaching interpretation creates no minimum-score floor');
assert.equal(zeroResult.recommendHumanReview,false,'neither low scores, low confidence nor ungrounded model review flags start verification');
assert.equal(zeroResult.factConflict,false);
const blankFacts={...facts,reflection:' \r\n '},blank=validate(fixture(blankFacts),blankFacts);
assert.deepEqual(blank.scores,[100,100,100,0]);assert.equal(blank.totalScore,80);
assert(blank.modules[3].criteria.every(criterion=>criterion.score===0&&criterion.evidence.length===0));
assert(blank.modules.every(module=>module.suggestions.length<=2));
const noAttachments={...facts,results:facts.results+'\n未附外部材料。'};
assert.equal(validate(fixture(noAttachments),noAttachments).totalScore,100,'an explicit absence of attachments does not cause a programmatic penalty');
const ordinaryPlan={...facts,nextPlan:'继续跟进已确认的样品修订，重点核对参数并完成下一轮对接。'};
const ordinary=validate(fixture(ordinaryPlan),ordinaryPlan);
assert.equal(ordinary.modules[2].candidateScore,100,'the validator imposes no date/name/quantity heuristics on routine next-week plans');
assert.equal(ordinary.modules[2].criteria.find(criterion=>criterion.id==='timing').score,3);
assert.equal(ordinary.modules[2].criteria.find(criterion=>criterion.id==='dependencies').score,2);
const shortReflection={...facts,reflection:'这次参数返工说明先对齐范围更有效，下次先确认范围再沟通参数。'};
assert.equal(validate(fixture(shortReflection),shortReflection).modules[3].candidateScore,100,'a single sentence can provide event, judgment and next action without an algorithmic length penalty');

assert.throws(()=>buildReportQualityCoachingPrompt(),/coaching_preview_required/);
assert.throws(()=>buildReportQualityCoachingPrompt({mode:'automatic'}),/coaching_preview_required/);
assert.throws(()=>validateReportQualityCoachingAnalysis(raw,facts),/coaching_preview_required/);
assert.throws(()=>validate(raw,facts,{mode:'publish'}),/coaching_preview_required/);
assert.throws(()=>validate(raw,facts,{managerRequestedReview:'true'}),/invalid_manager_review_request/);
rejects(value=>{value.modules.pop();},'invalid_module_count');
rejects(value=>{value.modules[3]=clone(value.modules[0]);},'missing_or_duplicate_module');
rejects(value=>{value.modules[0].criteria.pop();},'invalid_criterion_count');
rejects(value=>{value.modules[0].criteria[1]=clone(value.modules[0].criteria[0]);},'missing_or_duplicate_criterion');
for(const invalid of [undefined,null,'12',true,false,[],{},NaN,Infinity,-1,12.1])rejects(value=>{value.modules[0].criteria[0].score=invalid;},'invalid_score');
rejects(value=>{value.modules[0].reason=' ';},'required_text');
rejects(value=>{value.modules[0].confidence=undefined;},'invalid_confidence');
rejects(value=>{value.modules[0].suggestions=['一条建议','第二条建议','不允许第三条建议'];},'invalid_text_list');
rejects(value=>{value.modules[0].criteria[0].evidence=[];},'positive_score_without_reference');
rejects(value=>{const action=value.modules[1].criteria.find(criterion=>criterion.id==='action');action.score=2;action.evidence=[];},'positive_score_without_reference');
rejects(value=>{const action=value.modules[1].criteria.find(criterion=>criterion.id==='action');action.evidence=[{ref:'reflection-1',type:'judgment'}];},'invalid_reference');
rejects(value=>{value.modules[0].criteria[0].evidence=[{ref:'problems-1',type:'reported_fact'}];},'invalid_reference');
rejects(value=>{value.modules[0].criteria[0].evidence=[{quote:'PRIVATE_MODEL_TEXT_DO_NOT_COPY',type:'reported_fact'}];},'reference_not_in_source');
rejects(value=>{value.modules[0].criteria[0].evidence[0].type='attachment';},'invalid_reference_type');
rejects(value=>{value.modules[0].criteria[0].evidence[0].type='plan';},'future_plan_as_result');
rejects(value=>{value.modules[0].criteria[0].applicable=false;},'unsupported_scoring_rule');
rejects(value=>{value.version='some-other-engine';},'wrong_version');
rejects(value=>{value.previewOnly=false;},'preview_required');
rejects(value=>{value.evidenceLevel='A';},'evidence_grading_forbidden');
rejects(value=>{value.modules[2].evidenceLevel='A';},'evidence_grading_forbidden');
rejects(value=>{value.modules[3].criteria[0].evidenceLevel='A';},'unsupported_scoring_rule');
rejects(value=>{value.modules[0].criteria[0].evidence[0].level='A';},'invalid_reference');
rejects(value=>{value.riskSignals=[{kind:'low_confidence',reason:'只是低置信度',references:[]}];},'invalid_risk_kind');
rejects(value=>{value.riskSignals=[{kind:'explicit_anomaly',reason:'模型没有提供原文依据',references:[]}];},'invalid_risk_references');
const altered=clone(full);altered.modules[0].criteria[0].evidence[0].start=0;altered.modules[0].criteria[0].evidence[0].end=repeated.length-1;
assert.throws(()=>validate(altered),error=>reportQualityCoachingDiagnostic(error).code==='reference_not_in_source');

const contradictoryFacts={...facts,results:'【虚构矛盾校验】本周已完成三项核对。',problems:'【虚构矛盾校验】本周三项核对均未完成。'};
const flagged=fixture(contradictoryFacts);
flagged.riskSignals=[{kind:'contradiction',reason:'两处原文对同一核对事项的完成状态存在明确矛盾。',references:[{moduleId:'results',ref:'results-1'},{moduleId:'problems',ref:'problems-1'}]}];
const verified=validate(flagged,contradictoryFacts);
assert(verified.factConflict&&verified.recommendHumanReview);
assert.equal(verified.verification.wording,REPORT_QUALITY_COACHING_VERIFICATION_WORDING);
assert.deepEqual(validate(verified,contradictoryFacts),verified);
const requested=validate(raw,facts,{managerRequestedReview:true});
assert.equal(requested.verification.reason,'manager_requested');assert.equal(requested.verification.wording,'如有需要可进一步核实');
assert.equal(requested.totalScore,full.totalScore,'an explicit manager verification request changes no scores');

const prompt=buildReportQualityCoachingPrompt(options);
assert(prompt.includes(REPORT_QUALITY_COACHING_VERSION)&&prompt.includes(REPORT_QUALITY_COACHING_PROMPT_VERSION));
for(const module of REPORT_QUALITY_COACHING_RUBRIC)for(const criterion of module.criteria)assert(prompt.includes(criterion.standard));
for(const policy of ['成长','不做附件审计','70–89','没有最低分托底','最多2条','原文引用','如有需要可进一步核实','空白模块','阶段状态'])assert(prompt.includes(policy),policy);
for(const band of ['90–100分','80–89分','70–79分','60–69分','50–59分','<50分'])assert(prompt.includes(band),'all six interpretation bands are explicit: '+band);
for(const policy of ['周报作者默认责任人','下周计划默认期限是下周','不得只因没有具体日期扣节点分','跨部门协作或特殊节点','具体事件、简单判断和后续行动','不能把有实际内容的总结直接打成接近零分','不按字数多少、数字多寡','证明材料不进入公开周报','只有管理人员另行发起抽查','不得索取合同、截图、合同编号、订单编号'])assert(prompt.includes(policy),policy);
for(const policy of ['不能把其他模块事项说成本模块已经写出','其他模块只可辅助理解相关性','不得补造本模块得分依据','为了避免重罚而凑无依据的中间分','信息不足的细项可以给0分','隐含语义可以得分','不能把所有非空细项默认给满分','所有score>0的细项都必须有真实且相关的本模块引用','没有实际必要就填[]','不得默认要求管理层认可策略、报价审批','不得再建议补这些重复字段','不得把‘开展评估’改写成‘完成评估’','未来预期写成已达成节点','多项目列表清楚不等于优先级已经明确'])assert(prompt.includes(policy),policy);
assert(REPORT_QUALITY_COACHING_RUBRIC[1].criteria.find(criterion=>criterion.id==='action').standard.includes('不能从复盘或其他模块借来'));
assert(REPORT_QUALITY_COACHING_RUBRIC[2].criteria.find(criterion=>criterion.id==='priority').standard.includes('不能仅凭列表格式或篇幅给本项满分'));
for(const meaning of ['成果突出、表达清楚、有较好的思考复盘','推进扎实、信息具体、沟通较好','正常工作，主要信息基本清楚','有工作记录，部分状态或思考不明确','内容较少，多数事项难以判断','大面积空白、明显敷衍或严重不一致'])assert(prompt.includes(meaning),meaning);
for(const policy of ['原因或背景’是OR','已经交代背景不再要求根因','已经交代影响，不再要求准确金额或展开客户关系','其一，不强求三者都有','不能理由全是正面评价却任意扣分','不能把本标准不要求的扩展细节变成扣分项','进行中或待确认本身不扣成果分','不强求所谓‘深入原因’','不必捏造原因来撑分','不能编成‘新人慢的原因已明确’'])assert(prompt.includes(policy),policy);
for(const anchor of ['【虚构校准锚点一】','【虚构校准锚点二】','【虚构校准锚点三】','订单取消后已恢复生产，部分交付，其余待客户定交期后包装，退单风险解除。','下周驻厂核对相机包装并验货，跟进台灯月底交付。','日常检验和翻新饱和，扫描录入延后。'])assert(prompt.includes(anchor),anchor);
assert(prompt.includes('不是用户的真实周报，不是打分模板或最低分托底'));
assert(REPORT_QUALITY_COACHING_RUBRIC[1].criteria.find(criterion=>criterion.id==='action').standard.includes('三者之一'));
assert(REPORT_QUALITY_COACHING_RUBRIC[2].criteria.find(criterion=>criterion.id==='timing').standard.includes('不能仅因没有额外具体日期给部分分'));
assert.equal(REPORT_QUALITY_COACHING_PROMPT_VERSION,'weekly-quality-coaching-preview-prompt-2026-11-19-v4');
assert(prompt.includes('没有原文明确的需要背景，不得建议申请特殊价格授权、管理层认可或任何审批'));
assert.equal(REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION,'weekly-quality-coaching-preview-review-2026-11-19-v1');
assert.throws(()=>buildReportQualityCoachingReviewPrompt(),/coaching_preview_required/);
assert.throws(()=>buildReportQualityCoachingReviewPrompt({mode:'publish'}),/coaching_preview_required/);
const reviewPrompt=buildReportQualityCoachingReviewPrompt(options);
assert(reviewPrompt.startsWith(prompt),'review reuses the exact frozen v4 main prompt and rubric');
assert(reviewPrompt.includes(REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION));
for(const policy of ['复检输入candidate这份AI输出，而不是重新审核员工','candidate中的理由、引用和结论也都需要对照原文','已经合理的分项分数和评价保持原样','不能借下周计划的‘持续甄别低效线索’','所称核心实质缺口必须确实存在且是rubric要求','工艺成本影响类指标','进行中、待客户确认或未最终成交本身也不能扣分','不能把‘海关’写成‘住建’','可保留已校验的quote/type/start/end','禁止为了提高或降低总分','不能增加建议数量','不因复检本身新增风险信号','输出完整的同schema JSON','二次自检版本仅由调用方另行记录'])assert(reviewPrompt.includes(policy),policy);
assert(!prompt.includes(REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION),'the default candidate prompt remains v4 without implicit second-pass execution');
assert.equal(REPORT_QUALITY_COACHING_RUBRIC[1].criteria[1].label,'原因或背景');
assert.equal(REPORT_QUALITY_COACHING_RUBRIC[1].criteria[3].label,'应对动作或所需支持');
assert(REPORT_QUALITY_COACHING_RUBRIC[2].criteria.find(criterion=>criterion.id==='timing').standard.includes('默认期限就是下周'));
assert(REPORT_QUALITY_COACHING_RUBRIC[2].criteria.find(criterion=>criterion.id==='dependencies').standard.includes('默认就是计划责任人'));
assert.equal(REPORT_QUALITY_VERSION,'weekly-quality-2026-11-12-v2');
assert.equal(REPORT_QUALITY_PROMPT_VERSION,'weekly-quality-prompt-2026-11-13-v4');
assert(!buildReportQualityPrompt().includes(REPORT_QUALITY_COACHING_VERSION),'default scoring still uses the deployed version and rubric');
assert.equal(reportQualityAssessment({...facts,ai:full}),null,'a coaching preview is not a default-engine assessment');
assert.equal(currentQualityCached({...facts,ai:full,sourceHash:'unit-source',aiModel:'unit-model',aiPromptVersion:REPORT_QUALITY_COACHING_PROMPT_VERSION},'unit-source','unit-model'),false);
const forged=Object.assign(Error('PRIVATE_PROVIDER_MESSAGE'),{code:'required_text',path:'PRIVATE_QUOTE'});
assert.deepEqual(reportQualityCoachingDiagnostic(forged),{code:'preview_analysis_failed',path:'$',retryable:false});
assert(!JSON.stringify(reportQualityCoachingDiagnostic(forged)).includes('PRIVATE_'));
console.log('Coaching preview tests passed: independent explicit-preview versions; fixed criterion weights; precise own-source references without attachment or grade caps; no minimum floor; <=2 constructive module suggestions; grounded/manager-only verification; immutable inputs and default scorer isolation. No real employee cases, provider calls, database or file writes.');
