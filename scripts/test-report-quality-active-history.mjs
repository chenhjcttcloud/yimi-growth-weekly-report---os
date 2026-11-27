import assert from 'node:assert/strict';
import {REPORT_QUALITY_VERSION,REPORT_QUALITY_PROMPT_VERSION,LEGACY_REPORT_QUALITY_VERSION,reportQualityAssessment as historicalAssessment,validateReportQualityAnalysis} from '../server/report-quality-scoring.mjs';
import {ACTIVE_REPORT_QUALITY_VERSION,ACTIVE_REPORT_QUALITY_PROMPT_VERSION,validateActiveReportQualityAnalysis} from '../server/report-quality-active.mjs';
import {reportQualityAssessment,validateStoredReportQualityAnalysis,fixedQualityWeightsFor} from '../server/report-quality-reader.mjs';
import {reportFacts,usableQuality,currentQualityCached,retainedQualityCached,previousQualitySnapshot,archivedQuality} from '../server/report-rescore-state.mjs';
import {qualityVersion,qualityAnalysisVersion,applyQualityReviews,qualityReviewDetails} from '../server/weekly-quality-review.mjs';
import {makeReportQualityAnalysis} from './report-quality-test-fixtures.mjs';
import {makeActiveReportQualityAnalysis} from './report-quality-active-test-fixtures.mjs';
import {validateReportQualityCoachingAnalysis} from '../server/report-quality-coaching.mjs';

// Synthetic records only: exercise the version boundary without DBs, model
// requests, employee records, notifications or filesystem writes.
const facts={results:'【虚构】相机样品已完成参数对齐，正在打样。',problems:'【虚构】供应商需要修订尺寸，影响下次送样，已约双方确认。',nextPlan:'【虚构】跟进相机打样，重点核对新参数。',reflection:'【虚构】这次参数返工说明先对齐更有效，下次先确认范围再沟通。'};
const payload=makeReportQualityAnalysis(facts),oldAi={...payload,...validateReportQualityAnalysis(payload,facts)};
const old={...facts,ai:oldAi,aiModel:'old-model',aiPromptVersion:REPORT_QUALITY_PROMPT_VERSION,aiGeneratedAt:'2026-11-13T08:00:00Z',sourceHash:'same-source',scoringWeights:[40,20,20,20]};
const original=structuredClone(old);
assert.deepEqual(reportQualityAssessment(old),historicalAssessment(old),'activation must not change old interpretation, total, metadata or evidence');
assert.deepEqual(old,original);
assert.deepEqual(fixedQualityWeightsFor(REPORT_QUALITY_VERSION),[30,25,25,20]);
assert.equal(fixedQualityWeightsFor(LEGACY_REPORT_QUALITY_VERSION),null,'legacy policy path is preserved');
assert(retainedQualityCached(old,'same-source'),'a rule/model change is not permission to rescore');
assert(!currentQualityCached(old,'same-source','new-model'),'strict same-model cache check remains available');
assert(!retainedQualityCached(old,'edited-source'));
assert(!retainedQualityCached({...old,qualityRefresh:{state:'failed'}},'same-source'),'an explicitly queued/failed analysis is eligible to continue');
const legacy=structuredClone(old);legacy.ai.version=LEGACY_REPORT_QUALITY_VERSION;
for(const module of legacy.ai.modules)for(const criterion of module.criteria)criterion.evidence=criterion.evidence.map(({quote,type})=>({quote,type}));
assert.deepEqual(reportQualityAssessment(legacy),historicalAssessment(legacy));
assert(retainedQualityCached(legacy,'same-source'));

const ai=validateActiveReportQualityAnalysis(makeActiveReportQualityAnalysis(facts,{scores:[80,80,80,80]}),facts);
const active={...facts,ai,aiModel:'new-model',aiPromptVersion:ACTIVE_REPORT_QUALITY_PROMPT_VERSION,aiGeneratedAt:'2026-11-19T08:00:00Z',sourceHash:'new-source',scoringWeights:[5,5,5,85]};
const assessment=reportQualityAssessment(active);
assert.equal(assessment.version,ACTIVE_REPORT_QUALITY_VERSION);
assert.equal(assessment.totalScore,80);assert.equal(assessment.requiresMonthlyConfirmation,false);assert.equal(assessment.publicationMode,'automatic');
assert.deepEqual(assessment.modules.map(module=>module.maxPoints),[30,25,25,20]);
assert.deepEqual(fixedQualityWeightsFor(ai.version),[30,25,25,20]);
assert(currentQualityCached(active,'new-source','new-model'));assert(retainedQualityCached(active,'new-source'));
assert.deepEqual(validateStoredReportQualityAnalysis(makeActiveReportQualityAnalysis(facts,{scores:[80,80,80,80]}),facts,{scoringVersion:ACTIVE_REPORT_QUALITY_VERSION}),ai);
const corrupted=structuredClone(active);corrupted.ai.modules[0].criteria[0].evidence[0].quote='原文不存在的虚构引文';
assert.equal(reportQualityAssessment(corrupted),null);assert(!usableQuality(corrupted.ai,facts));
assert.equal(reportQualityAssessment({...active,aiPromptVersion:'earlier-formatting-prompt'}).totalScore,80,'metadata prompt changes do not invalidate an otherwise valid saved rubric assessment');
assert(retainedQualityCached({...active,aiPromptVersion:'earlier-formatting-prompt'},'new-source'),'saved valid grades are retained even when prompt metadata differs');
assert(!currentQualityCached({...active,aiPromptVersion:'earlier-formatting-prompt'},'new-source','new-model'),'strict current cache still requires the current prompt');
const wrongRulePrompt=structuredClone(active);wrongRulePrompt.ai.promptVersion='unrecognized-analysis-prompt';
assert.equal(reportQualityAssessment(wrongRulePrompt),null);assert(!retainedQualityCached(wrongRulePrompt,'new-source'),'an invalid analysis version is never held as a valid grade');
const preview=validateReportQualityCoachingAnalysis(makeActiveReportQualityAnalysis(facts),facts,{mode:'preview'});
assert.equal(reportQualityAssessment({...facts,ai:preview}),null);
assert(!usableQuality(preview,facts));assert(!retainedQualityCached({...old,ai:preview},'same-source'));
assert.throws(()=>validateStoredReportQualityAnalysis(preview,facts),/preview_quality_not_publishable/);
const previous={ai:old.ai,aiModel:old.aiModel,aiPromptVersion:old.aiPromptVersion,aiGeneratedAt:old.aiGeneratedAt,sourceHash:old.sourceHash,facts,scoringWeights:old.scoringWeights};
assert.deepEqual(previousQualitySnapshot({...facts,previousQuality:previous,aiAnalysisHistory:[{ai:preview,facts}]}),previous);
const archive=archivedQuality(old);assert.deepEqual(archive[0].ai,old.ai);assert.deepEqual(archive[0].scoringWeights,old.scoringWeights);
assert.deepEqual(reportFacts(active),facts);assert.deepEqual(old,original);

const reportFor=content=>({id:'synthetic-report',content,qualityAssessment:reportQualityAssessment(content),candidate:80,submitted:true,evidence:[],scoringPolicy:{weights:[30,25,25,20]},qualityReviews:[]});
const report=reportFor(active),criterion=assessment.modules[0].criteria[0];
assert.throws(()=>qualityReviewDetails(report,{action:'mark_not_applicable',moduleId:'results',criterionId:criterion.id}),/quality_fixed_rubric/);
assert.deepEqual(qualityReviewDetails(report,{action:'validate_evidence',moduleId:'results',criterionId:criterion.id,quote:facts.results}),{moduleId:'results',criterionId:criterion.id,quote:facts.results},'optional management checking is still a record, not a score gate');
const row={id:'synthetic-review',analysis_version:qualityAnalysisVersion(report),action:'mark_not_applicable',reason:'虚构伪造的旧操作',details_json:JSON.stringify({moduleId:'results',criterionId:criterion.id}),created_at:'2026-11-19T08:00:00Z'};
const reviewed=applyQualityReviews(report,[row]);
assert.equal(reviewed.candidate,80);assert.equal(reviewed.reviewedModuleScores,undefined,'an injected N/A review cannot reweight the fixed active rubric');
const legacyReport=reportFor(old),legacyRow={...row,analysis_version:qualityAnalysisVersion(legacyReport),details_json:JSON.stringify({moduleId:'results',criterionId:oldAi.modules[0].criteria[0].id})};
assert(applyQualityReviews(legacyReport,[legacyRow]).reviewedModuleScores,'historical N/A review behavior remains available');
assert.deepEqual(qualityReviewDetails(report,{action:'adjust_score',score:81}),{score:81},'authorized management adjustment remains independent of the rubric');
// Reproduce the pre-automatic fingerprint independently of the current version
// helper: changing publication metadata must not orphan saved weekly reviews.
const oldActive=structuredClone(active);
Object.assign(oldActive.ai,{publicationMode:'management_confirmation',requiresMonthlyConfirmation:true});
const oldActiveBytes=JSON.stringify(oldActive),oldActiveReport=reportFor(oldActive);
const oldAssessment={...oldActiveReport.qualityAssessment,publicationMode:'management_confirmation',requiresMonthlyConfirmation:true};
const oldVersion=qualityVersion({id:oldActiveReport.id,sourceHash:oldActive.sourceHash,source:oldActiveReport.evidence,
 model:oldActive.aiModel,generatedAt:oldActive.aiGeneratedAt,ai:oldAssessment,
 scores:['成果分','问题分','计划分','复盘分'].map(key=>oldActive[key]),archiveScore:oldActive['总分'],weights:oldActiveReport.scoringPolicy.weights,submitted:true});
assert.equal(oldActiveReport.qualityAssessment.publicationMode,'automatic');
assert.equal(qualityAnalysisVersion(oldActiveReport),oldVersion,'old analysis_version must survive publication metadata normalization');
const savedAdjustment={...row,id:'old-active-adjustment',analysis_version:oldVersion,action:'adjust_score',details_json:'{"score":81}'};
const replayed=applyQualityReviews(oldActiveReport,[savedAdjustment]);
assert.equal(replayed.candidate,81);assert.equal(replayed.qualityReviews[0].active,true);
const excluded=applyQualityReviews(oldActiveReport,[savedAdjustment,{...savedAdjustment,id:'old-active-exclusion',action:'exclude_report',details_json:'{}'}]);
assert.equal(excluded.qualityExcluded,true);assert.equal(excluded.candidate,null);assert(excluded.qualityReviews.every(review=>review.active));
assert.equal(JSON.stringify(oldActive),oldActiveBytes,'reading old saved content cannot rewrite it');
assert.notEqual(qualityAnalysisVersion({...oldActiveReport,content:{...oldActive,sourceHash:'changed-facts'}}),oldVersion,'actual source changes still invalidate old reviews');
assert.notEqual(qualityAnalysisVersion({...oldActiveReport,content:{...oldActive,aiModel:'changed-model'}}),oldVersion,'actual model changes still invalidate old reviews');
console.log('Active quality history tests passed: old interpretations and weekly review fingerprints unchanged; automatic publication metadata; fixed points; preview exclusion; archive snapshots retained. No data writes or network.');
