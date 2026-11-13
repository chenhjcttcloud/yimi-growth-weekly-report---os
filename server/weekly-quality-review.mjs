import {createHash} from 'node:crypto';

export const qualityRound = value => Math.round((value+Number.EPSILON)*10)/10;

const canonical = value => {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
};
export const qualityVersion = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function qualityAnalysisVersion(report) {
  const {content,qualityAssessment} = report;
  return qualityVersion({id:report.id,sourceHash:content.sourceHash,source:report.evidence,
    model:content.aiModel,generatedAt:content.aiGeneratedAt,ai:qualityAssessment||content.ai,
    scores:['成果分','问题分','计划分','复盘分'].map(key=>content[key]),archiveScore:content['总分'],
    weights:report.scoringPolicy.weights,submitted:report.submitted});
}

export function applyQualityReviews(report,records) {
  const analysisVersion=qualityAnalysisVersion(report);
  const qualityReviews=records.map(row=>({id:row.id,action:row.action,reason:row.reason,
    details:JSON.parse(row.details_json),reviewerName:row.reviewer_name,reviewerId:row.reviewer_user_id,
    createdAt:row.created_at,active:row.analysis_version===analysisVersion}));
  const active=qualityReviews.filter(review=>review.active);
  const disposition=active.findLast(review=>['exclude_report','restore_report'].includes(review.action));
  const qualityExcluded=report.qualityExcluded||disposition?.action==='exclude_report';
  const qualityReanalysisPending=active.some(review=>review.action==='reanalyze');
  const override=active.findLast(review=>review.action==='adjust_score');
  let moduleScores=report.qualityAssessment?.scores;
  if(moduleScores&&active.some(review=>review.action==='mark_not_applicable')){
    moduleScores=report.qualityAssessment.modules.map(module=>{
      const excluded=new Set(active.filter(review=>review.action==='mark_not_applicable'&&review.details.moduleId===module.id).map(review=>review.details.criterionId));
      const applicable=module.criteria.filter(criterion=>criterion.applicable!==false&&!excluded.has(criterion.id));
      const maximum=applicable.reduce((sum,criterion)=>sum+criterion.maxScore,0);
      return excluded.size&&maximum?qualityRound(applicable.reduce((sum,criterion)=>sum+criterion.score,0)/maximum*100):module.candidateScore;
    });
  }
  const aiCandidate=report.candidate;
  const candidate=qualityExcluded||qualityReanalysisPending||aiCandidate===null?null:override?.details.score??(
    moduleScores&&moduleScores!==report.qualityAssessment.scores?qualityRound(moduleScores.reduce((sum,score,index)=>sum+score*report.scoringPolicy.weights[index]/100,0)):aiCandidate
  );
  return {...report,aiCandidate,candidate,qualityReviewVersion:qualityVersion([analysisVersion,qualityReviews.at(-1)?.id]),
    qualityReviews,qualityExcluded:Boolean(qualityExcluded),qualityReanalysisPending,
    ...(moduleScores&&moduleScores!==report.qualityAssessment.scores?{reviewedModuleScores:moduleScores}:{})};
}

export function summarizeMonthlyQuality(reports,confirmationBlockedReason) {
  const submitted=reports.filter(report=>report.submitted&&!report.qualityExcluded);
  const analyzed=submitted.filter(report=>report.candidate!==null);
  const pendingAnalysis=submitted.length-analyzed.length;
  const currentAverage=analyzed.length?qualityRound(analyzed.reduce((sum,report)=>sum+report.candidate,0)/analyzed.length):null;
  const status=!submitted.length?'no_reports':confirmationBlockedReason||pendingAnalysis?'pending_ai':'pending_confirmation';
  const canConfirm=status==='pending_confirmation';
  const version=canConfirm?qualityVersion(reports.filter(report=>report.submitted).map(report=>[
    report.end,report.id,report.submittedAt,report.candidate,report.qualityReviewVersion,report.qualityExcluded
  ]).sort((left,right)=>String(left[0]).localeCompare(String(right[0])))):undefined;
  return {status,currentAverage,candidateScore:canConfirm?currentAverage:null,finalScore:null,pendingAnalysis,
    analyzedCount:analyzed.length,expectedCount:submitted.length,canConfirm,
    ...(confirmationBlockedReason?{confirmationBlockedReason}:{}),...(version?{version}:{})};
}

export function qualityReviewDetails(report,body) {
  const {action,score,moduleId,criterionId,quote}=body;
  if(action==='exclude_report'){
    if(report.qualityExcluded)throw Error('quality_report_excluded');
    return {};
  }
  if(action==='restore_report'){
    if(!report.qualityReviews.some(review=>review.action==='exclude_report'&&review.active)||!report.qualityExcluded)throw Error('quality_report_not_excluded');
    return {};
  }
  if(report.qualityExcluded)throw Error('quality_report_excluded');
  if(action==='reanalyze')return {};
  if(report.candidate===null)throw Error('quality_not_ready');
  if(action==='adjust_score'){
    if(typeof score!=='number'||!Number.isFinite(score)||score<0||score>100)throw Error('invalid_quality_score');
    return {score:qualityRound(score)};
  }
  const module=report.qualityAssessment?.modules.find(item=>item.id===moduleId);
  const criterion=module?.criteria.find(item=>item.id===criterionId);
  if(!criterion)throw Error('invalid_quality_criterion');
  if(action==='validate_evidence'){
    const field={results:'本周成果摘要',problems:'问题摘要',nextPlan:'下周计划摘要',reflection:'思考与复盘摘要'}[moduleId];
    const source=String(report.content[moduleId]||report.content[field]||'');
    if(typeof quote!=='string'||!quote.trim()||quote.length>2000||!source.includes(quote))throw Error('invalid_quality_evidence');
    return {moduleId,criterionId,quote};
  }
  const excluded=new Set(report.qualityReviews.filter(review=>review.active&&review.action==='mark_not_applicable'&&review.details.moduleId===moduleId).map(review=>review.details.criterionId));
  if(criterion.applicable===false||excluded.has(criterionId))throw Error('quality_criterion_already_not_applicable');
  if(!module.criteria.some(item=>item.id!==criterionId&&item.applicable!==false&&!excluded.has(item.id)))throw Error('quality_module_requires_criterion');
  return {moduleId,criterionId};
}
