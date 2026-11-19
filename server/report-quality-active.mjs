import {
 REPORT_QUALITY_COACHING_VERSION,REPORT_QUALITY_COACHING_PROMPT_VERSION,
 REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION,REPORT_QUALITY_COACHING_WEIGHTS,
 REPORT_QUALITY_COACHING_RUBRIC,buildReportQualityCoachingPrompt,buildReportQualityCoachingReviewPrompt,
 validateReportQualityCoachingAnalysis,reportQualityCoachingDiagnostic,
} from './report-quality-coaching.mjs';

// An explicit active adapter, separate from the offline preview API and from
// the preserved historical scoring engine. No provider or persistence here.
export const ACTIVE_REPORT_QUALITY_VERSION='weekly-quality-coaching-2026-11-19-v1';
export const ACTIVE_REPORT_QUALITY_PROMPT_VERSION='weekly-quality-coaching-prompt-2026-11-19-v1';
export const ACTIVE_REPORT_QUALITY_REVIEW_PROMPT_VERSION='weekly-quality-coaching-review-2026-11-19-v1';
export const ACTIVE_REPORT_QUALITY_WEIGHTS=REPORT_QUALITY_COACHING_WEIGHTS;
export const ACTIVE_REPORT_QUALITY_RUBRIC=REPORT_QUALITY_COACHING_RUBRIC;

const activeErrors=new WeakMap();
const validationCodes=new Set([
 'invalid_structure','invalid_facts','invalid_source_text','wrong_version','preview_input_forbidden',
 'invalid_active_mode','invalid_confirmation_mode','invalid_manager_review_request','evidence_grading_forbidden',
 'invalid_module_count','missing_or_duplicate_module','invalid_criterion_count','missing_or_duplicate_criterion',
 'unsupported_scoring_rule','invalid_score','required_text','text_too_long','invalid_text_list','invalid_confidence',
 'invalid_reference','invalid_quote','invalid_reference_type','reference_not_in_source','invalid_reference_list',
 'positive_score_without_reference','future_plan_as_result','invalid_risk_signals','invalid_risk_kind',
 'invalid_risk_references','invalid_json','invalid_summary','response_truncated',
]);
function fail(code,path){
 const error=Object.assign(Error('invalid_ai_quality_analysis'),{code:'invalid_ai_quality_analysis'});
 activeErrors.set(error,{code,path,retryable:true});throw error;
}
export function activeQualityDiagnostic(error){
 if(error&&typeof error==='object'&&activeErrors.has(error))return {...activeErrors.get(error)};
 if(error instanceof SyntaxError)return {code:'invalid_json',path:'$',retryable:true};
 if(error?.name==='TimeoutError'||error?.name==='AbortError')return {code:'upstream_timeout',path:'$',retryable:true};
 return {code:'analysis_failed',path:'$',retryable:false};
}
export const isActiveQualityValidationFailure=code=>validationCodes.has(code);

function activeOptions(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options))fail('invalid_active_mode','$options');
 if(options.mode!==undefined&&options.mode!=='active')fail('invalid_active_mode','$options.mode');
 if(options.managerRequestedReview!==undefined&&typeof options.managerRequestedReview!=='boolean')fail('invalid_manager_review_request','$options.managerRequestedReview');
 return options;
}
const taskContract=`保留既有AI行动任务提取功能：输出顶层可选tasks数组（可为[]，最多4项），每项包含title、description、priority（P0/P1/P2）、evidenceRef（本份周报evidenceFragments中实际存在的片段id）、metric、firstStep、supportNeeded。只提取本份原文支持的必要行动候选，不能为了生成任务而编造工作、额外验收指标、员工必须补交的材料或审批；无必要任务时留空。任务不影响质量分，也不代表已创建任务、发送消息或执行任何写入。
完整JSON沿用四模块、summary、questions、riskSignals，并保留tasks:[]这个独立字段。月度最终分仍需主管确认，AI不直接发布月度成绩。`;

function activatePrompt(source){
 const firstBreak=source.indexOf('\n');
 if(firstBreak<0||!source.startsWith('候选规则版本：'+REPORT_QUALITY_COACHING_VERSION)||!source.slice(0,firstBreak).includes('当前为显式preview试评'))throw Error('active_prompt_template_mismatch');
 const header=`评分规则版本：${ACTIVE_REPORT_QUALITY_VERSION}；提示词版本：${ACTIVE_REPORT_QUALITY_PROMPT_VERSION}。使用用户已确认的成长教练规则生成本周AI质量候选；月度最终分仍需主管确认。既有历史分数、发布快照和趋势保持原版本记录，不由AI自行覆写。`;
 const prompt=header+source.slice(firstBreak)
  .replaceAll(REPORT_QUALITY_COACHING_VERSION,ACTIVE_REPORT_QUALITY_VERSION)
  .replaceAll(REPORT_QUALITY_COACHING_PROMPT_VERSION,ACTIVE_REPORT_QUALITY_PROMPT_VERSION)
  .replaceAll(REPORT_QUALITY_COACHING_REVIEW_PROMPT_VERSION,ACTIVE_REPORT_QUALITY_REVIEW_PROMPT_VERSION)
  .replace('所有引用和建议仅服务于这次候选对比，不得修改其他功能。','所有引用和建议用于本周内容质量评分与成长反馈，不改变其他功能。')
  .replace('维持上面的主规则v1、主提示词v4及preview隔离。','沿用已经确认的线上成长教练主规则，只更正AI输出；月度最终分仍需主管确认。');
 if(prompt.includes('preview')||prompt.includes('四份实际周报并人工确认后才能考虑启用')||prompt.includes('当前为显式'))throw Error('active_prompt_template_mismatch');
 return prompt;
}
export function buildActiveReportQualityPrompt(options={}){
 activeOptions(options);
 return activatePrompt(buildReportQualityCoachingPrompt({...options,mode:'preview'}))+'\n'+taskContract;
}
export function buildActiveReportQualityReviewPrompt(options={}){
 activeOptions(options);
 return activatePrompt(buildReportQualityCoachingReviewPrompt({...options,mode:'preview'}))+'\n'+taskContract+
  '\n评分复核时，保持本份原文支持的原tasks，不得仅因评分复核而删除、编造或增加行动任务。仅当原任务确实缺乏本份原文支持或违反上述规则时更正；任务提取不能反过来改变质量分。review版本由调用方另行记录，analysis.promptVersion保持主评分提示词版本。';
}

export function validateActiveReportQualityAnalysis(value,facts,options={}){
 activeOptions(options);
 if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_structure','$');
 if(Object.hasOwn(value,'previewOnly')||Object.hasOwn(value,'humanConfirmationRequired')||value.publicationMode==='preview_only')fail('preview_input_forbidden','$');
 if(value.version!==undefined&&value.version!==ACTIVE_REPORT_QUALITY_VERSION)fail('wrong_version','version');
 if(value.promptVersion!==undefined&&value.promptVersion!==ACTIVE_REPORT_QUALITY_PROMPT_VERSION)fail('wrong_version','promptVersion');
 if(value.publicationMode!==undefined&&value.publicationMode!=='management_confirmation')fail('invalid_confirmation_mode','publicationMode');
 if(value.requiresMonthlyConfirmation!==undefined&&value.requiresMonthlyConfirmation!==true)fail('invalid_confirmation_mode','requiresMonthlyConfirmation');
 let normalized;
 try{
  normalized=validateReportQualityCoachingAnalysis({...value,version:REPORT_QUALITY_COACHING_VERSION,
   promptVersion:REPORT_QUALITY_COACHING_PROMPT_VERSION},facts,{...options,mode:'preview'});
 }catch(error){
  const diagnostic=reportQualityCoachingDiagnostic(error);
  if(diagnostic.retryable&&validationCodes.has(diagnostic.code))fail(diagnostic.code,diagnostic.path);
  throw error;
 }
 const {previewOnly,humanConfirmationRequired,publicationMode,version,promptVersion,...assessment}=normalized;
 const confidences=assessment.modules.flatMap(module=>module.confidence===null?[]:[module.confidence]);
 return {...assessment,version:ACTIVE_REPORT_QUALITY_VERSION,promptVersion:ACTIVE_REPORT_QUALITY_PROMPT_VERSION,
  publicationMode:'management_confirmation',requiresMonthlyConfirmation:true,
  confidence:confidences.length?confidences.reduce((sum,value)=>sum+value,0)/confidences.length:null};
}
