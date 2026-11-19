import {
 LEGACY_REPORT_QUALITY_VERSION,REPORT_QUALITY_VERSION,REPORT_QUALITY_WEIGHTS,
 reportQualityAssessment as historicalAssessment,validateReportQualityAnalysis,
} from './report-quality-scoring.mjs';
import {ACTIVE_REPORT_QUALITY_VERSION,ACTIVE_REPORT_QUALITY_WEIGHTS,validateActiveReportQualityAnalysis} from './report-quality-active.mjs';

// Reading an existing record never opts it into a different scoring rubric.
export const isPreviewQuality=ai=>ai?.previewOnly===true||ai?.publicationMode==='preview_only'||ai?.humanConfirmationRequired===true||String(ai?.version||'').startsWith('weekly-quality-coaching-preview-');
export const isStructuredQualityVersion=version=>[LEGACY_REPORT_QUALITY_VERSION,REPORT_QUALITY_VERSION,ACTIVE_REPORT_QUALITY_VERSION].includes(version);
export function fixedQualityWeightsFor(version){
 if(version===ACTIVE_REPORT_QUALITY_VERSION)return ACTIVE_REPORT_QUALITY_WEIGHTS;
 if(version===REPORT_QUALITY_VERSION)return REPORT_QUALITY_WEIGHTS;
 return null;
}
const factsFor=content=>({
 results:content?.results||content?.['本周成果摘要']||'',problems:content?.problems||content?.['问题摘要']||'',
 nextPlan:content?.nextPlan||content?.['下周计划摘要']||'',reflection:content?.reflection||content?.['思考与复盘摘要']||'',
});
export function reportQualityAssessment(content){
 if(isPreviewQuality(content?.ai))return null;
 if(content?.ai?.version!==ACTIVE_REPORT_QUALITY_VERSION)return historicalAssessment(content);
 try{
  const assessment=validateActiveReportQualityAnalysis(content.ai,factsFor(content));
  return {...assessment,model:content.aiModel||'',generatedAt:content.aiGeneratedAt||'',sourceHash:content.sourceHash||''};
 }catch{return null;}
}
export function validateStoredReportQualityAnalysis(value,facts,options={}){
 if(isPreviewQuality(value))throw Object.assign(Error('preview_quality_not_publishable'),{code:'preview_quality_not_publishable'});
 if(options.scoringVersion===ACTIVE_REPORT_QUALITY_VERSION||value?.version===ACTIVE_REPORT_QUALITY_VERSION)return validateActiveReportQualityAnalysis(value,facts,options);
 if(value?.version===LEGACY_REPORT_QUALITY_VERSION){
  const assessed=historicalAssessment({...facts,ai:value});
  if(!assessed)throw Object.assign(Error('invalid_historical_quality'),{code:'invalid_historical_quality'});
  return {...value,...assessed};
 }
 return validateReportQualityAnalysis(value,facts,options);
}
