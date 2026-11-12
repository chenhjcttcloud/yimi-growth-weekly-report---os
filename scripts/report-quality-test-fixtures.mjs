import {REPORT_QUALITY_RUBRIC} from '../server/report-quality-scoring.mjs';

// Synthetic provider payloads shared by isolated tests. Quotes always come from
// the supplied report, so a test never needs an upstream model or real data.
export function makeReportQualityAnalysis(facts,{scores=[90,80,85,75],summary='AI 测试点评',questions=[],anomalies=[],tasks=[],confidence=.9,evidenceLevels=['A','B','B','B'],factConflict=false,recommendHumanReview=false}={}) {
 return {
  scores,summary,questions,anomalies,tasks,factConflict,recommendHumanReview,
  modules:REPORT_QUALITY_RUBRIC.map((module,index)=>({
   id:module.id,reason:`${module.module}按固定细则评分，依据所附原文。`,strengths:['测试原文包含对应信息'],deductions:scores[index]<100?['测试样本可补充信息']:[],missing:scores[index]<100?['测试样本尚可补充更具体的依据']:[],confidence,
   criteria:module.criteria.map(criterion=>({
    id:criterion.id,score:criterion.maxScore*scores[index]/100,reason:`${criterion.label}：原文提供部分依据。`,missing:scores[index]<100?['可补充细节']:[],applicable:true,notApplicableReason:null,
    evidence:String(facts[module.id]||'').trim()?[{quote:String(facts[module.id]),type:module.id==='nextPlan'?'plan':module.id==='reflection'?'judgment':'reported_fact',level:evidenceLevels[index]}]:[],
   })),
  })),
 };
}
