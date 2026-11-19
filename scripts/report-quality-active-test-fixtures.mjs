import {ACTIVE_REPORT_QUALITY_RUBRIC} from '../server/report-quality-active.mjs';
import {buildReportEvidenceFragments} from '../server/report-evidence-fragments.mjs';

// Synthetic provider output only. Keep the legacy fixture factory unchanged so
// historical readers continue to be tested against their original schema.
export function makeActiveReportQualityAnalysis(facts,{scores=[90,80,85,75],summary='AI 测试点评',questions=[],riskSignals=[],tasks=[],confidence=.9}={}){
 const fragments=buildReportEvidenceFragments(facts);
 const round=value=>Math.round((value+Number.EPSILON)*10)/10;
 let cumulativeTarget=0,allocatedPoints=0;
 return {
  summary,questions,riskSignals,tasks,
  modules:ACTIVE_REPORT_QUALITY_RUBRIC.map((module,index)=>{
   const filled=Boolean(facts[module.id]?.trim());
   cumulativeTarget+=filled?module.maxScore*scores[index]/100:0;
   const points=round(cumulativeTarget)-allocatedPoints;allocatedPoints=round(cumulativeTarget);
   let criterionWeight=0,criterionPoints=0;
   return {
    id:module.id,reason:`${module.module}按本模块虚构原文独立评价。`,strengths:['原文提供当前事项的具体说明'],suggestions:[],confidence,
    criteria:module.criteria.map(criterion=>{
     criterionWeight+=criterion.maxScore;
     const cumulativePoints=round(points*criterionWeight/module.maxScore),score=round(cumulativePoints-criterionPoints);criterionPoints=cumulativePoints;
     return {id:criterion.id,score,reason:filled?`${criterion.label}依据本模块原文，具体性可由人工校准。`:'本模块未填写。',
      evidence:filled&&score>0?[{ref:fragments[module.id][0].id,type:module.id==='nextPlan'?'plan':module.id==='reflection'?'judgment':'reported_fact'}]:[]};
    }),
   };
  }),
 };
}
