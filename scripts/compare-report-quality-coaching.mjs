import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {buildReportEvidenceFragments} from '../server/report-evidence-fragments.mjs';
import {REPORT_QUALITY_COACHING_VERSION,REPORT_QUALITY_COACHING_PROMPT_VERSION,REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION,buildReportQualityCoachingPrompt,buildReportQualityCoachingReviewPrompt,validateReportQualityCoachingAnalysis,reportQualityCoachingDiagnostic} from '../server/report-quality-coaching.mjs';
import {renderCoachingComparison} from './lib/report-quality-coaching-comparison.mjs';

// Offline comparison entry point: deliberately imports no database, live-sync,
// settings, production API or default scoring writer. The provider is an
// explicit local executable receiving one chat request on stdin per call.
const ids=['results','problems','nextPlan','reflection'];
export const comparisonHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonempty=value=>typeof value==='string'&&Boolean(value.trim());
const isoDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function validateComparisonCases(input){
 const cases=Array.isArray(input)?input:input?.cases;
 if(!Array.isArray(cases)||cases.length!==4)throw Error('exactly_four_cases_required');
 if(cases.some(item=>!item||typeof item!=='object'||Array.isArray(item)))throw Error('invalid_case');
 if(new Set(cases.map(item=>item.id)).size!==4)throw Error('duplicate_case_id');
 if(new Set(cases.map(item=>item.category)).size!==4||!['销售','采购','供应链','职能'].every(category=>cases.some(item=>item.category===category)))throw Error('four_job_categories_required');
 for(const item of cases){
  if(!nonempty(item.id)||!nonempty(item.employeeName)||!nonempty(item.old?.model)||!item.old?.assessment||typeof item.old.assessment!=='object'||Array.isArray(item.old.assessment)||!Object.keys(item.old.assessment).length)throw Error('incomplete_case_metadata');
  if(!isoDate(item.weekStart)||!isoDate(item.weekEnd)||item.weekEnd<item.weekStart)throw Error('invalid_case_week');
  if(!ids.every(id=>typeof item.facts?.[id]==='string'&&item.facts[id].trim()))throw Error('four_original_modules_required');
  if(!Array.isArray(item.old.scores)||item.old.scores.length!==4||!item.old.scores.every(score=>Number.isFinite(score)&&score>=0&&score<=100)||!Number.isFinite(item.old.totalScore)||item.old.totalScore<0||item.old.totalScore>100)throw Error('saved_baseline_required');
  for(const [field,value,code] of [['factsSha256',item.facts,'original_facts_hash_mismatch'],['savedAssessmentSha256',item.old.assessment,'saved_assessment_hash_mismatch']]){
   if(item.integrity&&Object.hasOwn(item.integrity,field)&&(!/^[a-f0-9]{64}$/.test(item.integrity[field])||item.integrity[field]!==comparisonHash(value)))throw Error(code);
  }
 }
 if(new Set(cases.map(item=>item.old.model)).size!==1)throw Error('same_baseline_model_required');
 return cases;
}
export function makeComparisonRequest(item){
 return {model:item.old.model,max_completion_tokens:10000,thinking:{type:'disabled'},response_format:{type:'json_object'},messages:[
  {role:'system',content:buildReportQualityCoachingPrompt({mode:'preview'})},
  {role:'user',content:JSON.stringify({category:item.category,department:item.department,weekStart:item.weekStart,weekEnd:item.weekEnd,facts:item.facts,evidenceFragments:buildReportEvidenceFragments(item.facts)})},
 ]};
}
export function makeComparisonReviewRequest(item,candidate,validationFeedback=[]){
 return {...makeComparisonRequest(item),messages:[
  {role:'system',content:buildReportQualityCoachingReviewPrompt({mode:'preview'})+(validationFeedback.length?'\n上次输出的规则诊断见输入validationFeedback。请逐条对照实际原文，纠正其中客观错误，不能只换措辞保留无依据分数；也不能把诊断当作新的员工工作事实。没有指定目标分数，不按分数高低调整。':'')},
  {role:'user',content:JSON.stringify({category:item.category,department:item.department,weekStart:item.weekStart,weekEnd:item.weekEnd,facts:item.facts,evidenceFragments:buildReportEvidenceFragments(item.facts),candidate,...(validationFeedback.length?{validationFeedback}:{} )})},
 ]};
}
function parseResponse(response){
 if(response?.error)throw Error('provider_returned_error');
 const content=response?.choices?.[0]?.message?.content;
 if(typeof content!=='string'||response.choices[0].finish_reason==='length')throw Error('provider_incomplete_response');
 try{return JSON.parse(content);}catch{throw Error('provider_invalid_json');}
}
// A reviewer can accidentally replace a source NBSP with an ordinary space.
// Restore only a unique fragment with NBSP changed to an ordinary space.
// Never repair other whitespace, words, numbers, punctuation or forged offsets.
export function restoreReviewReferenceWhitespace(value,facts){
 const restored=structuredClone(value),fragments=buildReportEvidenceFragments(facts),repairs=[];
 for(const module of Array.isArray(restored?.modules)?restored.modules:[]){
  for(const criterion of Array.isArray(module?.criteria)?module.criteria:[]){
   for(const [index,item] of (Array.isArray(criterion?.evidence)?criterion.evidence:[]).entries()){
    if(typeof item?.quote!=='string'||Object.hasOwn(item,'ref'))continue;
    const matches=(fragments[module.id]||[]).filter(fragment=>fragment.text.replaceAll('\u00a0',' ')===item.quote);
    if(matches.length!==1||matches[0].text===item.quote)continue;
    const fragment=matches[0];
    criterion.evidence[index]={...item,quote:fragment.text,start:fragment.start,end:fragment.end};
    repairs.push({moduleId:module.id,criterionId:criterion.id,index,sourceRef:fragment.id,kind:'source_whitespace_restored'});
   }
  }
 }
 return {value:restored,repairs};
}
export async function compareCases(input,{provider,reviewProvider=null,reviewFeedback={},artifact=async()=>{},now=()=>new Date().toISOString()}={}){
 const cases=validateComparisonCases(input),results=[];
 if(typeof provider!=='function')throw Error('explicit_provider_required');
 if(reviewProvider!==null&&typeof reviewProvider!=='function')throw Error('invalid_review_provider');
 if(!reviewFeedback||typeof reviewFeedback!=='object'||Array.isArray(reviewFeedback)||Object.entries(reviewFeedback).some(([id,items])=>!cases.some(item=>item.id===id)||!Array.isArray(items)||items.length>8||items.some(item=>!nonempty(item)||item.length>2000)))throw Error('invalid_review_feedback');
 if(Object.keys(reviewFeedback).length&&!reviewProvider)throw Error('feedback_requires_review_provider');
 // Sequential calls make each retained request/response auditable and avoid
 // sending all employee reports to the provider in a single request.
 for(let index=0;index<cases.length;index++){
  const item=cases[index],request=makeComparisonRequest(item),stem=String(index+1).padStart(2,'0');
  await artifact(stem+'-request.json',request);
  const response=await provider(request);
  await artifact(stem+'-response.json',response);
  let assessment;
  try{assessment=validateReportQualityCoachingAnalysis(parseResponse(response),item.facts,{mode:'preview'});}
  catch(error){await artifact(stem+'-diagnostic.json',reportQualityCoachingDiagnostic(error));throw Error('candidate_validation_failed_case_'+stem);}
  let reviewResponse=null,repairResponse=null;
  if(reviewProvider){
   await artifact(stem+'-initial-assessment.json',assessment);
   const reviewRequest=makeComparisonReviewRequest(item,assessment);
   await artifact(stem+'-review-request.json',reviewRequest);
   reviewResponse=await reviewProvider(reviewRequest);
   await artifact(stem+'-review-response.json',reviewResponse);
   try{const restored=restoreReviewReferenceWhitespace(parseResponse(reviewResponse),item.facts);if(restored.repairs.length)await artifact(stem+'-review-reference-format-repairs.json',restored.repairs);assessment=validateReportQualityCoachingAnalysis(restored.value,item.facts,{mode:'preview'});}
   catch(error){await artifact(stem+'-review-diagnostic.json',reportQualityCoachingDiagnostic(error));throw Error('candidate_review_validation_failed_case_'+stem);}
   if(reviewFeedback[item.id]?.length){
    await artifact(stem+'-before-correction-assessment.json',assessment);
    const repairRequest=makeComparisonReviewRequest(item,assessment,reviewFeedback[item.id]);
    await artifact(stem+'-correction-request.json',repairRequest);
    repairResponse=await reviewProvider(repairRequest);
    await artifact(stem+'-correction-response.json',repairResponse);
    try{const restored=restoreReviewReferenceWhitespace(parseResponse(repairResponse),item.facts);if(restored.repairs.length)await artifact(stem+'-correction-reference-format-repairs.json',restored.repairs);assessment=validateReportQualityCoachingAnalysis(restored.value,item.facts,{mode:'preview'});}
    catch(error){await artifact(stem+'-correction-diagnostic.json',reportQualityCoachingDiagnostic(error));throw Error('candidate_correction_validation_failed_case_'+stem);}
   }
  }
  const result={caseId:item.id,assessment,model:request.model,providerModel:response.model||null,reviewPromptVersion:reviewProvider?REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION:null,reviewProviderModel:reviewResponse?.model||null,correctiveReview:!!repairResponse,correctionProviderModel:repairResponse?.model||null,generatedAt:now(),originalFactsSha256:comparisonHash(item.facts),savedAssessmentSha256:comparisonHash(item.old.assessment),usage:response.usage||null,reviewUsage:reviewResponse?.usage||null,correctionUsage:repairResponse?.usage||null};
  await artifact(stem+'-result.json',result);results.push(result);
 }
 return results;
}
export function executableProvider(program,args){
 return request=>new Promise((accept,reject)=>{
  const child=spawn(program,args,{stdio:['pipe','pipe','pipe'],shell:false});
  child.stdout.setEncoding('utf8');
  let output='',size=0,finished=false;
  const fail=code=>{if(!finished){finished=true;reject(Error(code));}};
  const timer=setTimeout(()=>{child.kill('SIGTERM');fail('provider_timeout');},240000);
  child.stdout.on('data',chunk=>{size+=Buffer.byteLength(chunk,'utf8');if(size>4*1024*1024){child.kill('SIGTERM');fail('provider_output_too_large');}else output+=chunk;});
  // Provider diagnostics may contain confidential configuration. Never forward
  // stderr to logs, artifacts or the calling console.
  child.stderr.on('data',()=>{});
  child.on('error',()=>{clearTimeout(timer);fail('provider_process_failed');});
  child.stdin.on('error',()=>{});
  child.on('close',code=>{clearTimeout(timer);if(finished)return;if(code!==0)return fail('provider_process_failed');try{const value=JSON.parse(output);finished=true;accept(value);}catch{fail('provider_output_invalid_json');}});
  child.stdin.end(JSON.stringify(request));
 });
}
async function main(){
 const flags={providerArgs:[],reviewProviderArgs:[]};
 for(let index=2;index<process.argv.length;index++){
  const flag=process.argv[index],value=process.argv[++index];
  if(!value)throw Error('missing_argument');
  if(flag==='--cases')flags.cases=value;
  else if(flag==='--out')flags.out=value;
  else if(flag==='--provider-program')flags.provider=value;
  else if(flag==='--provider-arg')flags.providerArgs.push(value);
  else if(flag==='--review-provider-program')flags.reviewProvider=value;
  else if(flag==='--review-provider-arg')flags.reviewProviderArgs.push(value);
  else if(flag==='--review-feedback')flags.reviewFeedback=value;
  else throw Error('unknown_argument');
 }
 if(!flags.cases||!flags.out||!flags.provider)throw Error('usage_cases_out_provider_program_required');
 const input=JSON.parse(await readFile(resolve(flags.cases),'utf8')),cases=validateComparisonCases(input),out=resolve(flags.out);
 // A new directory is mandatory; previous comparisons are never overwritten.
 await mkdir(out,{mode:0o700});
 const artifact=(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
 await artifact('cases.json',input);
 const generatedAt=new Date().toISOString();
 await artifact('manifest.json',{previewOnly:true,humanConfirmationRequired:true,generatedAt,ruleVersion:REPORT_QUALITY_COACHING_VERSION,promptVersion:REPORT_QUALITY_COACHING_PROMPT_VERSION,promptSha256:createHash('sha256').update(buildReportQualityCoachingPrompt({mode:'preview'})).digest('hex'),reviewPromptVersion:flags.reviewProvider?REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION:null,reviewPromptSha256:flags.reviewProvider?createHash('sha256').update(buildReportQualityCoachingReviewPrompt({mode:'preview'})).digest('hex'):null,baseline:'saved_original_assessment',caseHashes:cases.map(item=>({id:item.id,facts:comparisonHash(item.facts),assessment:comparisonHash(item.old.assessment)}))});
 const reviewFeedback=flags.reviewFeedback?JSON.parse(await readFile(resolve(flags.reviewFeedback),'utf8')):{};
 if(flags.reviewFeedback)await artifact('review-feedback.json',reviewFeedback);
 const results=await compareCases(cases,{provider:executableProvider(flags.provider,flags.providerArgs),reviewProvider:flags.reviewProvider?executableProvider(flags.reviewProvider,flags.reviewProviderArgs):null,reviewFeedback,artifact});
 await artifact('results.json',results);
 const html=renderCoachingComparison({cases,results,generatedAt,model:cases[0].old.model,ruleVersion:REPORT_QUALITY_COACHING_VERSION,promptVersion:REPORT_QUALITY_COACHING_PROMPT_VERSION,reviewPromptVersion:flags.reviewProvider?REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION:null});
 await writeFile(join(out,'comparison.html'),html,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({previewOnly:true,output:join(out,'comparison.html'),cases:results.length},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(/^[a-z0-9_]+$/.test(error.message)?error.message:'comparison_failed');process.exitCode=1;});
