import {LEGACY_REPORT_QUALITY_VERSION,REPORT_QUALITY_VERSION,PREVIOUS_REPORT_QUALITY_PROMPT_VERSION,REPORT_QUALITY_PROMPT_VERSION,reportQualityAssessment,validateReportQualityAnalysis} from './report-quality-scoring.mjs';

export const reportFacts = content => ({
 results:content?.results||content?.['本周成果摘要']||'',
 problems:content?.problems||content?.['问题摘要']||'',
 nextPlan:content?.nextPlan||content?.['下周计划摘要']||'',
 reflection:content?.reflection||content?.['思考与复盘摘要']||'',
});
export function legacyReportScore(content){
 if(content?.source?.provider!=='legacy-reportos')return null;
 const saved=content['总分'];
 const score=typeof saved==='string'&&/^\d+(?:\.\d+)?$/.test(saved)?Number(saved):saved;
 return Number.isFinite(score)&&score>=0&&score<=100?score:null;
}
const scoresValid = ai => Array.isArray(ai?.scores)&&ai.scores.length===4&&ai.scores.every(score=>typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=100)&&typeof ai.summary==='string'&&Boolean(ai.summary.trim());
export function usableQuality(ai,facts){
 if(!scoresValid(ai))return false;
 if(ai.version===LEGACY_REPORT_QUALITY_VERSION)return reportQualityAssessment({...facts,ai})!==null;
 if(ai.version===REPORT_QUALITY_VERSION){try{validateReportQualityAnalysis(ai,facts);}catch{return false;}}
 return true;
}
export function previousQualitySnapshot(content,sourceHash='',weights=[30,25,25,20]){
 const current={ai:content?.ai,aiModel:content?.aiModel||'',aiPromptVersion:content?.aiPromptVersion||content?.ai?.promptVersion||'legacy',aiGeneratedAt:content?.aiGeneratedAt||'',sourceHash:content?.sourceHash||sourceHash,facts:reportFacts(content),scoringWeights:content?.scoringWeights||weights};
 const archive=Array.isArray(content?.aiAnalysisHistory)?content.aiAnalysisHistory:[];
 const candidates=[current,content?.previousQuality,...[...archive].reverse().filter(entry=>entry&&typeof entry==='object').map(entry=>({ai:entry.ai,aiModel:entry.aiModel||entry.model||'',aiPromptVersion:entry.aiPromptVersion||entry.promptVersion||'legacy',aiGeneratedAt:entry.aiGeneratedAt||entry.generatedAt||'',sourceHash:entry.sourceHash||'',facts:entry.facts||{},scoringWeights:entry.scoringWeights||weights}))];
 return candidates.find(snapshot=>snapshot?.facts&&usableQuality(snapshot.ai,snapshot.facts))||null;
}
export function currentQualityCached(content,sourceHash,model){
 if(content?.sourceHash!==sourceHash||content.aiModel!==model||content.ai?.version!==REPORT_QUALITY_VERSION)return false;
 // A formatting-only prompt repair does not invalidate a result that already
 // passed the unchanged scoring rule. Unknown prompt versions still reanalyse.
 if(![REPORT_QUALITY_VERSION,PREVIOUS_REPORT_QUALITY_PROMPT_VERSION,REPORT_QUALITY_PROMPT_VERSION].includes(content.aiPromptVersion))return false;
 return usableQuality(content.ai,reportFacts(content));
}
export function archivedQuality(content,sourceHash='',weights=[30,25,25,20]){
 const history=Array.isArray(content?.aiAnalysisHistory)?[...content.aiAnalysisHistory]:[];
 if(content?.ai){
  const entry={ai:content.ai,model:content.aiModel||'',generatedAt:content.aiGeneratedAt||'',promptVersion:content.aiPromptVersion||content.ai.promptVersion||'legacy',sourceHash:content.sourceHash||sourceHash,facts:reportFacts(content),scoringWeights:content.scoringWeights||weights};
  if(!history.some(existing=>existing&&existing.sourceHash===entry.sourceHash&&existing.model===entry.model&&existing.generatedAt===entry.generatedAt&&JSON.stringify(existing.ai)===JSON.stringify(entry.ai)))history.push(entry);
 }
 return history;
}
