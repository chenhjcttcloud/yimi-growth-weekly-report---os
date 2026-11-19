import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {comparisonHash,validateComparisonCases,makeComparisonRequest,makeComparisonReviewRequest,restoreReviewReferenceWhitespace,compareCases,executableProvider} from './compare-report-quality-coaching.mjs';
import {REPORT_QUALITY_COACHING_VERSION,REPORT_QUALITY_COACHING_PROMPT_VERSION,REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION,REPORT_QUALITY_COACHING_RUBRIC,validateReportQualityCoachingAnalysis} from '../server/report-quality-coaching.mjs';

// Pure in-memory orchestration tests. All names, report text, models, provider
// responses and hashes are synthetic. No filesystem, application DB or network.
const clone=value=>structuredClone(value);
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const moduleIds=['results','problems','nextPlan','reflection'];
const categories=['销售','采购','供应链','职能'];
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function fixtures(){
 return categories.map((category,index)=>{
  const facts=Object.fromEntries(moduleIds.map(id=>[id,`  【虚构案例${index}-${id}开头】\r\n`+('【合成原文】本周已完成工作范围对齐，目前到达明确阶段，下周跟进下一节点。\r\n'.repeat(120))+`【合成原文末尾${index}-${id}】\n  `]));
  const old={scores:[31.125,42.25,53.375,64.5],totalScore:17.001,version:'synthetic-saved-version',promptVersion:'synthetic-saved-prompt',model:'synthetic-same-model',generatedAt:'2026-11-14T01:00:00Z',assessment:{version:'synthetic-saved-version',weights:[10,20,30,40],modules:moduleIds.map(id=>({id,candidateScore:1,reason:'这是已保存的合成旧理由。'})),opaqueHistoricalField:{keepExactly:true}}};
  return {id:'synthetic-case-'+index,category,employeeName:'虚构比较员工'+index,department:'合成'+category+'团队',weekStart:'2026-11-09',weekEnd:'2026-11-13',facts,sourceHash:sha(facts),old,integrity:{factsSha256:sha(facts),savedAssessmentSha256:sha(old.assessment)}};
 });
}
function candidateFor(request,change){
 const content=JSON.parse(request.messages.find(message=>message.role==='user').content);
 const value={modules:REPORT_QUALITY_COACHING_RUBRIC.map(module=>({id:module.id,reason:'根据此模块原文评价本周实际推进与表达。',strengths:['说明了对象和阶段状态。'],suggestions:['下次可突出最主要的下一节点。'],confidence:.8,
  criteria:module.criteria.map(criterion=>({id:criterion.id,score:criterion.maxScore*.8,reason:'当前模块原文包含与这一细项相关的说明。',evidence:[{ref:content.evidenceFragments[module.id][0].id,type:module.id==='nextPlan'?'plan':module.id==='reflection'?'judgment':'reported_fact'}]})),
 })),summary:'合成候选点评：工作推进和当前状态具体，后续可进一步突出重点。',questions:[],riskSignals:[],scores:[0,0,0,0],totalScore:0};
 change?.(value);return value;
}
function responseFor(request,change){return {id:'synthetic-provider-response',model:request.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(candidateFor(request,change))}}],usage:{prompt_tokens:123,completion_tokens:456,total_tokens:579}};}
const records=[],requests=[],providerResponses=[];
const cases=freeze(fixtures()),before=JSON.stringify(cases),clock='2026-11-19T04:00:00Z';
const originalFetch=globalThis.fetch;let externalRequests=0;
globalThis.fetch=async()=>{externalRequests++;throw Error('synthetic_test_network_forbidden');};
try{
 assert.equal(comparisonHash(cases[0].facts),sha(cases[0].facts));
 assert.equal(validateComparisonCases(cases),cases);
 assert.equal(validateComparisonCases({cases}),cases);
 const firstRequest=makeComparisonRequest(cases[0]);
 assert.equal(firstRequest.model,cases[0].old.model);
 assert.equal(firstRequest.response_format.type,'json_object');
 assert(firstRequest.messages[0].content.includes(REPORT_QUALITY_COACHING_VERSION));
 assert(firstRequest.messages[0].content.includes(REPORT_QUALITY_COACHING_PROMPT_VERSION));
 assert.deepEqual(JSON.parse(firstRequest.messages[1].content).facts,cases[0].facts);
 const output=await compareCases(cases,{
  now:()=>clock,
  artifact:async(name,value)=>records.push({name,value:clone(value)}),
  provider:async request=>{
   assert.equal(request.model,'synthetic-same-model');
   const content=JSON.parse(request.messages[1].content),source=cases.find(sample=>sample.category===content.category);
   assert(source);assert.deepEqual(content.facts,source.facts,'every original character, whitespace, line ending and final marker reaches the same-model request');
   for(const id of moduleIds){assert(content.facts[id].length>4000);assert(content.facts[id].includes('【合成原文末尾'));}
   assert.equal(content.weekStart,source.weekStart);assert.equal(content.weekEnd,source.weekEnd);
   for(const id of moduleIds)for(const fragment of content.evidenceFragments[id])assert.equal(content.facts[id].slice(fragment.start,fragment.end),fragment.text);
   requests.push(clone(request));const response=responseFor(request);providerResponses.push(clone(response));return response;
  },
 });
 assert.equal(output.length,4);assert.equal(requests.length,4);
 assert.deepEqual(records.map(record=>record.name),Array.from({length:4},(_,index)=>{const stem=String(index+1).padStart(2,'0');return [stem+'-request.json',stem+'-response.json',stem+'-result.json'];}).flat());
 for(const [index,result] of output.entries()){
  assert.equal(result.caseId,cases[index].id);assert.equal(result.model,cases[index].old.model);assert.equal(result.generatedAt,clock);
  assert.equal(result.originalFactsSha256,sha(cases[index].facts));assert.equal(result.savedAssessmentSha256,sha(cases[index].old.assessment));
  assert.deepEqual(result.usage,providerResponses[index].usage);
  assert(result.assessment.previewOnly&&result.assessment.humanConfirmationRequired);assert.equal(result.assessment.publicationMode,'preview_only');
  assert.equal(result.assessment.version,REPORT_QUALITY_COACHING_VERSION);assert.equal(result.assessment.promptVersion,REPORT_QUALITY_COACHING_PROMPT_VERSION);
  assert.deepEqual(result.assessment.scores,[80,80,80,80]);assert.equal(result.assessment.totalScore,80,'model-supplied aggregate defaults do not become a saved score');
  assert.deepEqual(records[index*3+1].value,providerResponses[index],'retain the exact synthetic raw provider response before validation');
  assert.deepEqual(records[index*3+2].value,result);assert.deepEqual(JSON.parse(records[index*3].value.messages[1].content).facts,cases[index].facts);
 }
 assert.equal(JSON.stringify(cases),before,'the comparison must not mutate old scores, old weights, old reasons, original facts or integrity metadata');
 assert(cases.every(sample=>sample.old.totalScore===17.001&&sample.old.scores[0]===31.125&&sample.old.assessment.modules[0].candidateScore===1),'saved baselines are never recomputed');
 await assert.rejects(compareCases(cases),/explicit_provider_required/);
 const withoutArtifact=await compareCases(cases,{provider:async request=>responseFor(request),now:()=>clock});
 assert.deepEqual(withoutArtifact,output,'omitting an artifact callback only returns previews in memory; it does not invoke a default writer');

 const directReview=makeComparisonReviewRequest(cases[0],output[0].assessment);
 assert.equal(directReview.model,cases[0].old.model);
 assert(directReview.messages[0].content.includes(REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION));
 assert(directReview.messages[0].content.includes(REPORT_QUALITY_COACHING_PROMPT_VERSION));
 assert.deepEqual(JSON.parse(directReview.messages[1].content).candidate,output[0].assessment);
 const reviewArchive=[],reviewRequests=[],reviewResponses=[];
 let initialCalls=0;
 const reviewed=await compareCases(cases,{
  now:()=>clock,artifact:async(name,value)=>reviewArchive.push({name,value:clone(value)}),
  provider:async request=>{initialCalls++;return responseFor(request);},
  reviewProvider:async request=>{
   const content=JSON.parse(request.messages[1].content),source=cases.find(sample=>sample.category===content.category),index=categories.indexOf(content.category);
   assert(source);assert.equal(request.model,source.old.model,'the second pass uses the same saved baseline model');
   assert.deepEqual(Object.keys(content).sort(),['candidate','category','department','evidenceFragments','facts','weekEnd','weekStart'].sort(),'review context contains the initial preview and originals, not old scoring targets');
   assert.deepEqual(content.facts,source.facts);assert.equal(content.weekStart,source.weekStart);assert.equal(content.weekEnd,source.weekEnd);
   assert.deepEqual(content.candidate,output[index].assessment,'the independently archived validated first pass is the review subject');
   assert.notDeepEqual(content.candidate,source.old.assessment);
   assert.deepEqual(content.evidenceFragments,JSON.parse(requests[index].messages[1].content).evidenceFragments);
   for(const id of moduleIds){assert(content.facts[id].length>4000);assert(content.facts[id].includes('【合成原文末尾'));}
   for(const module of content.candidate.modules)for(const criterion of module.criteria)for(const citation of criterion.evidence)assert.equal(source.facts[module.id].slice(citation.start,citation.end),citation.quote);
   reviewRequests.push(clone(request));
   const candidate=clone(content.candidate);candidate.modules[0].criteria[0].score=0;candidate.modules[0].criteria[0].reason='合成二次自检修正后的细项理由。';candidate.modules[0].reason='合成二次自检修正后的模块理由。';candidate.summary='合成二次自检后的点评。';
   // Intentionally stale aggregate values must be recalculated by validation.
   const response={id:'synthetic-review-response',model:request.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(candidate)}}],usage:{prompt_tokens:22,completion_tokens:44,total_tokens:66}};
   reviewResponses.push(clone(response));return response;
  },
 });
 assert.equal(initialCalls,4);assert.equal(reviewRequests.length,4);
 assert.deepEqual(reviewArchive.map(record=>record.name),Array.from({length:4},(_,index)=>{const stem=String(index+1).padStart(2,'0');return [stem+'-request.json',stem+'-response.json',stem+'-initial-assessment.json',stem+'-review-request.json',stem+'-review-response.json',stem+'-result.json'];}).flat());
 for(const [index,result] of reviewed.entries()){
  const archived=reviewArchive.slice(index*6,index*6+6);
  assert.deepEqual(archived[2].value,output[index].assessment,'preserve the first-pass assessment separately from the corrected final preview');
  assert.equal(archived[2].value.totalScore,80);assert.equal(result.assessment.totalScore,70.4,'use the validated second-pass criteria rather than the initial score or stale aggregate');
  assert.equal(result.assessment.modules[0].criteria[0].score,0);assert.equal(result.assessment.modules[0].criteria[0].reason,'合成二次自检修正后的细项理由。');
  assert.equal(result.reviewPromptVersion,REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION);assert.equal(result.assessment.promptVersion,REPORT_QUALITY_COACHING_PROMPT_VERSION);
  assert.equal(result.model,cases[index].old.model);assert.equal(result.providerModel,cases[index].old.model);assert.equal(result.reviewProviderModel,cases[index].old.model);
  assert.deepEqual(result.reviewUsage,reviewResponses[index].usage);assert.deepEqual(archived[4].value,reviewResponses[index]);assert.deepEqual(archived[5].value,result);
  assert.equal(result.originalFactsSha256,sha(cases[index].facts));assert.equal(result.savedAssessmentSha256,sha(cases[index].old.assessment));
  assert(result.assessment.previewOnly&&result.assessment.humanConfirmationRequired);assert.equal(result.assessment.publicationMode,'preview_only');
 }
 assert.equal(JSON.stringify(cases),before,'the second pass changes neither original reports nor saved old scores and weights');

 const diagnostic='合成规则诊断：候选理由与所引用原文的阶段判断不一致，请只对照原文修正这一客观问题。';
 const feedback=freeze({[cases[0].id]:[diagnostic]}),feedbackBefore=JSON.stringify(feedback);
 const correctionArchive=[],correctionRequests=[];let correctionInitialCalls=0,ordinaryReviewCalls=0;
 const corrected=await compareCases(cases,{
  now:()=>clock,reviewFeedback:feedback,artifact:async(name,value)=>correctionArchive.push({name,value:clone(value)}),
  provider:async request=>{correctionInitialCalls++;return responseFor(request);},
  reviewProvider:async request=>{
   const content=JSON.parse(request.messages[1].content),source=cases.find(sample=>sample.category===content.category);
   assert(source);assert.equal(request.model,source.old.model);
   if(!content.validationFeedback){ordinaryReviewCalls++;return responseFor(request,value=>{value.summary='合成首次复核后的独立候选。';value.modules[0].reason='合成首次复核后的独立模块理由。';});}
   correctionRequests.push(clone(request));
   assert.equal(source.id,cases[0].id,'only the explicitly diagnosed case receives a corrective pass');
   assert.deepEqual(Object.keys(content).sort(),['candidate','category','department','evidenceFragments','facts','validationFeedback','weekEnd','weekStart'].sort(),'the repair request contains diagnostics and report context without saved scoring targets');
   assert.deepEqual(content.validationFeedback,feedback[source.id]);assert.deepEqual(content.facts,source.facts);
   assert.deepEqual(content.evidenceFragments,JSON.parse(requests[0].messages[1].content).evidenceFragments);
   assert.deepEqual(content.candidate,correctionArchive.find(record=>record.name==='01-before-correction-assessment.json').value,'repair starts from the independently archived validated review');
   assert.equal(content.candidate.summary,'合成首次复核后的独立候选。');assert.equal(content.candidate.modules[0].reason,'合成首次复核后的独立模块理由。');
   assert.notDeepEqual(content.candidate,output[0].assessment,'the first pass cannot replace the reviewed candidate during correction');assert.notDeepEqual(content.candidate,source.old.assessment);
   assert(request.messages[0].content.includes('没有指定目标分数，不按分数高低调整'));
   assert(!Object.hasOwn(content,'old')&&!Object.hasOwn(content,'targetScore')&&!Object.hasOwn(content,'totalScore'));
   for(const id of moduleIds)assert.equal(content.facts[id],cases[0].facts[id],'correction retains every original character');
   const candidate=clone(content.candidate);candidate.modules[0].criteria[0].score=0;
   candidate.modules[0].criteria[0].reason='合成诊断对应的细项修正理由。';candidate.modules[0].reason='仅依照原文修正后的合成模块理由。';
   candidate.totalScore=99.999;candidate.scores=[99.999,99.999,99.999,99.999];
   return {id:'synthetic-correction-response',model:request.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(candidate)}}],usage:{prompt_tokens:33,completion_tokens:55,total_tokens:88}};
  },
 });
 assert.equal(correctionInitialCalls,4);assert.equal(ordinaryReviewCalls,4);assert.equal(correctionRequests.length,1);
 assert.deepEqual(correctionArchive.map(record=>record.name),Array.from({length:4},(_,index)=>{const stem=String(index+1).padStart(2,'0');return [stem+'-request.json',stem+'-response.json',stem+'-initial-assessment.json',stem+'-review-request.json',stem+'-review-response.json',...(index===0?[stem+'-before-correction-assessment.json',stem+'-correction-request.json',stem+'-correction-response.json']:[]),stem+'-result.json'];}).flat());
 const beforeCorrection=correctionArchive.find(record=>record.name==='01-before-correction-assessment.json');
 const correctionResponse=correctionArchive.find(record=>record.name==='01-correction-response.json');
 assert.notDeepEqual(beforeCorrection.value,output[0].assessment);assert.equal(beforeCorrection.value.totalScore,80);assert.equal(beforeCorrection.value.summary,'合成首次复核后的独立候选。');
 assert.equal(corrected[0].assessment.totalScore,70.4,'the validated corrective criteria win over both saved historical scores and stale requested aggregates');
 assert.equal(corrected[0].assessment.modules[0].criteria[0].score,0);assert.equal(corrected[0].assessment.modules[0].criteria[0].reason,'合成诊断对应的细项修正理由。');
 assert.equal(corrected[0].correctiveReview,true);assert.equal(corrected[0].correctionProviderModel,cases[0].old.model);
 assert.equal(corrected[0].model,cases[0].old.model);assert.equal(corrected[0].reviewProviderModel,cases[0].old.model);
 assert.deepEqual(corrected[0].correctionUsage,correctionResponse.value.usage);
 assert.equal(corrected[0].originalFactsSha256,sha(cases[0].facts));assert.equal(corrected[0].savedAssessmentSha256,sha(cases[0].old.assessment));
 for(let index=1;index<corrected.length;index++){
  assert.equal(corrected[index].correctiveReview,false);assert.equal(corrected[index].correctionProviderModel,null);assert.equal(corrected[index].correctionUsage,null);
  assert.equal(corrected[index].assessment.totalScore,80,'cases without feedback keep the ordinary reviewed path');
 }
 assert.equal(JSON.stringify(feedback),feedbackBefore);assert.equal(JSON.stringify(cases),before,'corrective review preserves all historical scores, weights, reasons and source reports');

 const badFeedback=[
  ['null feedback',null],['array feedback',[]],['text feedback','synthetic-invalid'],
  ['unknown case',{'synthetic-unknown-case':['合成诊断']}],
  ['non-array diagnostics',{[cases[0].id]:'合成诊断'}],
  ['empty diagnostic',{[cases[0].id]:['']}],['blank diagnostic',{[cases[0].id]:['  ']}],
  ['non-text diagnostic',{[cases[0].id]:[123]}],
  ['too many diagnostics',{[cases[0].id]:Array.from({length:9},()=> '合成诊断')}],
  ['diagnostic exceeds limit',{[cases[0].id]:['合'.repeat(2001)]}],
 ];
 for(const [label,reviewFeedback] of badFeedback){
  let calls=0;const archive=[];
  await assert.rejects(compareCases(cases,{reviewFeedback,provider:async()=>{calls++;throw Error('must_not_call_provider');},reviewProvider:async()=>{calls++;throw Error('must_not_call_review_provider');},artifact:async name=>archive.push(name)}),/invalid_review_feedback/,label);
  assert.equal(calls,0,label);assert.deepEqual(archive,[],label);
 }
 let missingReviewProviderCalls=0;
 await assert.rejects(compareCases(cases,{reviewFeedback:feedback,provider:async()=>{missingReviewProviderCalls++;throw Error('must_not_call_provider');}}),/feedback_requires_review_provider/);
 assert.equal(missingReviewProviderCalls,0);assert.equal(JSON.stringify(cases),before);

 const whitespaceCases=freeze(fixtures().map((sample,index)=>{
  sample.facts.results=`  合成项目${index}\u00a0Alpha\u00a0本周完成12项，交付已确认。\n另一个唯一的合成阶段说明。\n`;
  sample.sourceHash=sha(sample.facts);sample.integrity.factsSha256=sha(sample.facts);return sample;
 })),whitespaceCasesBefore=JSON.stringify(whitespaceCases);
 const whitespaceSource=whitespaceCases[0],whitespaceRequest=makeComparisonRequest(whitespaceSource);
 const whitespaceInitial=validateReportQualityCoachingAnalysis(candidateFor(whitespaceRequest),whitespaceSource.facts,{mode:'preview'});
 const sourceCitation=whitespaceInitial.modules[0].criteria[0].evidence[0];
 assert(sourceCitation.quote.includes('\u00a0'));
 const normalizedQuote=sourceCitation.quote.replaceAll('\u00a0',' ');
 const malformedWhitespace=clone(whitespaceInitial),malformedCitation=malformedWhitespace.modules[0].criteria[0].evidence[0];
 malformedCitation.quote=normalizedQuote;malformedCitation.start+=3;malformedCitation.end=malformedCitation.start+malformedCitation.quote.length;
 freeze(malformedWhitespace);const malformedBefore=JSON.stringify(malformedWhitespace);
 const restored=restoreReviewReferenceWhitespace(malformedWhitespace,whitespaceSource.facts);
 assert.notEqual(restored.value,malformedWhitespace);assert.deepEqual(restored.value.modules[0].criteria[0].evidence[0],sourceCitation,'only unique NBSP formatting is restored to exact original quote and offsets');
 assert.deepEqual(restored.repairs,[{moduleId:'results',criterionId:whitespaceInitial.modules[0].criteria[0].id,index:0,sourceRef:'results-1',kind:'source_whitespace_restored'}]);
 assert.equal(validateReportQualityCoachingAnalysis(restored.value,whitespaceSource.facts,{mode:'preview'}).totalScore,80);
 assert.equal(JSON.stringify(malformedWhitespace),malformedBefore);assert.equal(JSON.stringify(whitespaceCases),whitespaceCasesBefore);
 const firstPassWhitespaceArchive=[];
 await assert.rejects(compareCases(whitespaceCases,{provider:async request=>({model:request.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(malformedWhitespace)}}]}),artifact:async(name,value)=>firstPassWhitespaceArchive.push({name,value:clone(value)})}),/candidate_validation_failed_case_01/);
 assert.deepEqual(firstPassWhitespaceArchive.map(record=>record.name),['01-request.json','01-response.json','01-diagnostic.json'],'format restoration is limited to review/correction, never first-pass provider output');

 const unsafeWhitespaceCases=[
  ['changed letter',value=>value.modules[0].criteria[0].evidence[0].quote=normalizedQuote.replace('Alpha','Alphx')],
  ['changed Chinese character',value=>value.modules[0].criteria[0].evidence[0].quote=normalizedQuote.replace('完成','未成')],
  ['changed number',value=>value.modules[0].criteria[0].evidence[0].quote=normalizedQuote.replace('12','13')],
  ['changed punctuation',value=>value.modules[0].criteria[0].evidence[0].quote=normalizedQuote.replace('，',',')],
  ['tab is not ordinary-space replacement',value=>value.modules[0].criteria[0].evidence[0].quote=sourceCitation.quote.replaceAll('\u00a0','\t')],
  ['line endings are not ordinary-space replacement',value=>value.modules[0].criteria[0].evidence[0].quote=sourceCitation.quote.replaceAll('\u00a0','\r\n')],
  ['expanded spacing is not NBSP replacement',value=>value.modules[0].criteria[0].evidence[0].quote=sourceCitation.quote.replaceAll('\u00a0','  ')],
  ['exact quote forged offset',value=>{const citation=value.modules[0].criteria[0].evidence[0];citation.start++;citation.end++;}],
 ];
 for(const [label,change] of unsafeWhitespaceCases){
  const invalid=clone(whitespaceInitial);change(invalid);freeze(invalid);const snapshot=JSON.stringify(invalid);
  const untouched=restoreReviewReferenceWhitespace(invalid,whitespaceSource.facts);
  assert.deepEqual(untouched.repairs,[],label);assert.deepEqual(untouched.value,invalid,label);
  assert.throws(()=>validateReportQualityCoachingAnalysis(untouched.value,whitespaceSource.facts,{mode:'preview'}),Error,label);
  assert.equal(JSON.stringify(invalid),snapshot,label);assert.equal(JSON.stringify(whitespaceCases),whitespaceCasesBefore,label);
 }
 const duplicateFacts=freeze({...whitespaceSource.facts,results:sourceCitation.quote+'\n'+sourceCitation.quote});
 const ambiguous=clone(whitespaceInitial);ambiguous.modules[0].criteria[0].evidence[0].quote=normalizedQuote;
 const ambiguousSnapshot=JSON.stringify(ambiguous),notRestored=restoreReviewReferenceWhitespace(freeze(ambiguous),duplicateFacts);
 assert.deepEqual(notRestored.repairs,[]);assert.deepEqual(notRestored.value,ambiguous,'two matching original fragments cannot select an arbitrary source');
 assert.throws(()=>validateReportQualityCoachingAnalysis(notRestored.value,duplicateFacts,{mode:'preview'}),Error);
 assert.equal(JSON.stringify(ambiguous),ambiguousSnapshot);

 for(const pass of ['review','correction']){
  const archive=[],rawResponses=[];let repairsIssued=0;
  const actual=await compareCases(whitespaceCases,{
   now:()=>clock,reviewFeedback:pass==='correction'?{[whitespaceSource.id]:[diagnostic]}:{},
   provider:async request=>responseFor(request),artifact:async(name,value)=>archive.push({name,value:clone(value)}),
   reviewProvider:async request=>{
    const content=JSON.parse(request.messages[1].content),candidate=clone(content.candidate),isCorrection=Boolean(content.validationFeedback);
    if(content.category===whitespaceSource.category&&isCorrection===(pass==='correction')){
     const citation=candidate.modules[0].criteria[0].evidence[0];citation.quote=citation.quote.replaceAll('\u00a0',' ');citation.start+=3;citation.end=citation.start+citation.quote.length;repairsIssued++;
    }
    const response=freeze({id:'synthetic-whitespace-response',model:request.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(candidate)}}]});
    rawResponses.push({response,snapshot:JSON.stringify(response)});return response;
   },
  });
  assert.equal(repairsIssued,1);assert.deepEqual(actual[0].assessment.modules[0].criteria[0].evidence[0],sourceCitation);
  const responseName=`01-${pass}-response.json`,repairName=`01-${pass}-reference-format-repairs.json`;
  const responseIndex=archive.findIndex(record=>record.name===responseName),repairIndex=archive.findIndex(record=>record.name===repairName);
  assert(responseIndex>=0&&repairIndex>responseIndex,'the unmodified raw response is archived before its separate formatting repair manifest');
  assert.equal(JSON.parse(archive[responseIndex].value.choices[0].message.content).modules[0].criteria[0].evidence[0].quote,normalizedQuote);
  assert.deepEqual(archive[repairIndex].value,restored.repairs);assert.equal(archive.filter(record=>record.name.endsWith('-reference-format-repairs.json')).length,1);
  for(const raw of rawResponses)assert.equal(JSON.stringify(raw.response),raw.snapshot,'provider response objects are never mutated by citation restoration');
  assert.equal(JSON.stringify(whitespaceCases),whitespaceCasesBefore);
 }

 const badCases=[
  ['not four cases',value=>value.pop()],
  ['duplicate identity',value=>value[1].id=value[0].id],
  ['missing job category',value=>value[1].category=value[0].category],
  ['missing identity',value=>value[0].employeeName=''],
  ['non-text identity',value=>value[0].id={unsafe:true}],
  ['missing saved model',value=>value[0].old.model=''],
  ['mixed saved models',value=>value[1].old.model='different-synthetic-model'],
  ['missing saved assessment',value=>delete value[0].old.assessment],
  ['non-object saved assessment',value=>value[0].old.assessment=[]],
  ['missing original module',value=>delete value[0].facts.reflection],
  ['non-text original module',value=>value[0].facts.reflection=123],
  ['invalid saved module score',value=>value[0].old.scores[0]=101],
  ['saved total below range',value=>value[0].old.totalScore=-1],
  ['saved total above range',value=>value[0].old.totalScore=101],
  ['non-finite saved total',value=>value[0].old.totalScore=NaN],
  ['invalid date format',value=>value[0].weekStart='next week'],
  ['nonexistent date',value=>value[0].weekEnd='2026-11-31'],
  ['reversed dates',value=>value[0].weekEnd='2026-11-01'],
  ['changed source hash',value=>value[0].integrity.factsSha256='0'.repeat(64)],
  ['changed saved assessment hash',value=>value[0].integrity.savedAssessmentSha256='0'.repeat(64)],
  ['provided empty source hash',value=>value[0].integrity.factsSha256=''],
 ];
 for(const [label,change] of badCases){
  const value=clone(cases);change(value);assert.throws(()=>validateComparisonCases(value),Error,label);
  let calls=0;await assert.rejects(compareCases(value,{provider:async()=>{calls++;throw Error('must_not_call_provider');}}),Error,label);assert.equal(calls,0,label);
 }

 const badResponses=[
  ['provider error',request=>({...responseFor(request),error:'SYNTHETIC_PROVIDER_PRIVATE_ERROR'})],
  ['truncated provider response',request=>{const value=responseFor(request);value.choices[0].finish_reason='length';return value;}],
  ['missing content',()=>({choices:[]})],
  ['broken JSON',()=>({choices:[{finish_reason:'stop',message:{content:'{"modules":['}}]})],
  ['invalid module schema',request=>responseFor(request,value=>value.modules=[])],
  ['missing source citation',request=>responseFor(request,value=>value.modules[0].criteria[0].evidence=[])],
  ['foreign source citation',request=>responseFor(request,value=>value.modules[0].criteria[0].evidence=[{ref:'problems-1',type:'reported_fact'}])],
  ['forbidden evidence grade',request=>responseFor(request,value=>value.modules[2].evidenceLevel='A')],
  ['excess suggestions',request=>responseFor(request,value=>value.modules[0].suggestions=['第一条合成建议','第二条合成建议','第三条不合法建议'])],
 ];
 for(const [label,makeResponse] of badResponses){
  let calls=0;const archive=[];
  await assert.rejects(compareCases(cases,{provider:async request=>{calls++;return makeResponse(request);},artifact:async(name,value)=>archive.push({name,value:clone(value)})}),/candidate_validation_failed_case_01/,label);
  assert.equal(calls,1,label);assert.deepEqual(archive.map(item=>item.name),['01-request.json','01-response.json','01-diagnostic.json'],label);
  assert(archive[2].value.code);assert(!JSON.stringify(archive[2].value).includes('SYNTHETIC_PROVIDER_PRIVATE_ERROR'));assert.equal(JSON.stringify(cases),before,label);
 }
 for(const [label,makeResponse] of badResponses){
  let initial=0,reviews=0;const archive=[];
  await assert.rejects(compareCases(cases,{provider:async request=>{initial++;return responseFor(request);},reviewProvider:async request=>{reviews++;return makeResponse(request);},artifact:async(name,value)=>archive.push({name,value:clone(value)})}),/candidate_review_validation_failed_case_01/,label);
  assert.equal(initial,1,label);assert.equal(reviews,1,label);
  assert.deepEqual(archive.map(item=>item.name),['01-request.json','01-response.json','01-initial-assessment.json','01-review-request.json','01-review-response.json','01-review-diagnostic.json'],label);
  assert.equal(archive[2].value.totalScore,80,'review failure preserves the first pass for audit without publishing it or a default zero');
  assert(!archive.some(item=>item.name.endsWith('-result.json')));assert.equal(JSON.stringify(cases),before,label);
 }
 for(const [label,makeResponse] of badResponses){
  let initial=0,reviews=0,corrections=0;const archive=[];
  await assert.rejects(compareCases(cases,{reviewFeedback:feedback,provider:async request=>{initial++;return responseFor(request);},reviewProvider:async request=>{
   if(JSON.parse(request.messages[1].content).validationFeedback){corrections++;return makeResponse(request);}
   reviews++;return responseFor(request);
  },artifact:async(name,value)=>archive.push({name,value:clone(value)})}),/candidate_correction_validation_failed_case_01/,label);
  assert.equal(initial,1,label);assert.equal(reviews,1,label);assert.equal(corrections,1,label);
  assert.deepEqual(archive.map(item=>item.name),['01-request.json','01-response.json','01-initial-assessment.json','01-review-request.json','01-review-response.json','01-before-correction-assessment.json','01-correction-request.json','01-correction-response.json','01-correction-diagnostic.json'],label);
  assert.equal(archive[2].value.totalScore,80);assert.equal(archive[5].value.totalScore,80,'a failed repair retains the previous candidate without publishing it or a default zero');
  assert(!archive.some(item=>item.name.endsWith('-result.json')));assert.equal(JSON.stringify(cases),before,label);assert.equal(JSON.stringify(feedback),feedbackBefore,label);
 }
 const thrownCorrectionArchive=[];let correctionFailures=0;
 await assert.rejects(compareCases(cases,{reviewFeedback:feedback,provider:async request=>responseFor(request),reviewProvider:async request=>{
  if(JSON.parse(request.messages[1].content).validationFeedback){correctionFailures++;throw Error('synthetic_correction_provider_failure');}
  return responseFor(request);
 },artifact:async(name,value)=>thrownCorrectionArchive.push({name,value:clone(value)})}),/synthetic_correction_provider_failure/);
 assert.equal(correctionFailures,1);assert.deepEqual(thrownCorrectionArchive.map(item=>item.name),['01-request.json','01-response.json','01-initial-assessment.json','01-review-request.json','01-review-response.json','01-before-correction-assessment.json','01-correction-request.json']);
 assert.equal(thrownCorrectionArchive[5].value.totalScore,80);assert(!thrownCorrectionArchive.some(item=>item.name.endsWith('-result.json')));
 const thrownReviewArchive=[];let initialBeforeReviewFailure=0,reviewFailures=0;
 await assert.rejects(compareCases(cases,{provider:async request=>{initialBeforeReviewFailure++;return responseFor(request);},reviewProvider:async()=>{reviewFailures++;throw Error('synthetic_review_provider_failure');},artifact:async(name,value)=>thrownReviewArchive.push({name,value:clone(value)})}),/synthetic_review_provider_failure/);
 assert.equal(initialBeforeReviewFailure,1);assert.equal(reviewFailures,1);assert.deepEqual(thrownReviewArchive.map(item=>item.name),['01-request.json','01-response.json','01-initial-assessment.json','01-review-request.json']);
 assert.equal(thrownReviewArchive[2].value.totalScore,80);assert(!thrownReviewArchive.some(item=>item.name.endsWith('-result.json')));
 let thrownCalls=0;const thrownArchive=[];
 await assert.rejects(compareCases(cases,{provider:async()=>{thrownCalls++;throw Error('synthetic_provider_failure');},artifact:async(name,value)=>thrownArchive.push({name,value:clone(value)})}),/synthetic_provider_failure/);
 assert.equal(thrownCalls,1);assert.deepEqual(thrownArchive.map(item=>item.name),['01-request.json']);
 let afterArchiveFailure=0;
 await assert.rejects(compareCases(cases,{provider:async request=>{afterArchiveFailure++;return responseFor(request);},artifact:async name=>{if(name.endsWith('-response.json'))throw Error('synthetic_archive_failure');}}),/synthetic_archive_failure/);
 assert.equal(afterArchiveFailure,1,'a response archive failure stops before a candidate result is returned');
 const utf8Child=`const bytes=Buffer.from(JSON.stringify({text:'周报沟通😀'}));const split=bytes.indexOf(Buffer.from('周'))+1;process.stdout.write(bytes.subarray(0,split));setTimeout(()=>process.stdout.write(bytes.subarray(split)),25);`;
 const utf8Response=await executableProvider(process.execPath,['-e',utf8Child])({synthetic:true});
 assert.deepEqual(utf8Response,{text:'周报沟通😀'},'UTF-8 characters split across provider stdout chunks must remain intact');
 assert.equal(externalRequests,0);assert.equal(JSON.stringify(cases),before);
 console.log(JSON.stringify({ok:true,syntheticCases:4,providerCalls:4,reviewProviderCalls:4,correctiveReviewCalls:correctionRequests.length,sameSavedModel:true,untruncatedOriginals:true,originalInputsAndBaselinesImmutable:true,previewOnlyNoDefaultWriter:true,rawResponsesArchived:true,sourceAndBaselineHashes:true,initialAssessmentSeparatelyArchived:true,completeIndependentReviewRequest:true,validatedReviewIsFinalPreview:true,reviewFailureNeverPublishesDefault:true,diagnosticsOnlyCorrectionRequest:true,validatedCorrectionIsFinalPreview:true,correctionFailureNeverPublishesDefault:true,uniqueNbspCitationRestored:true,providerAndSourceNotMutated:true,reviewAndCorrectionRepairArchivedAfterRawResponse:true,unsafeCitationRepairsRejected:unsafeWhitespaceCases.length+1,invalidCasesRejected:badCases.length,invalidResponsesRejected:badResponses.length,invalidReviewResponsesRejected:badResponses.length,invalidCorrectionResponsesRejected:badResponses.length,invalidReviewFeedbackRejected:badFeedback.length+1,networkRequests:0,fileWrites:0}));
}finally{globalThis.fetch=originalFetch;}
