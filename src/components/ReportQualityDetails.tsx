import { ChevronDown, FileCheck2, Quote } from 'lucide-react';
import '../styles/report-quality.css';

type EvidenceType = 'reported_fact' | 'plan' | 'judgment';
type EvidenceLevel = 'A' | 'B' | 'C' | 'D';

interface QualityEvidence {
  quote: string;
  type: EvidenceType;
  level?: EvidenceLevel | null;
  start?: number;
  end?: number;
}

interface QualityCriterion {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  description?: string;
  standard?: string;
  reason: string;
  missing?: string[];
  evidence: QualityEvidence[];
  applicable?: boolean;
  notApplicableReason?: string | null;
  evidenceLevel?: EvidenceLevel | null;
}

interface QualityModule {
  id: string;
  module: string;
  candidateScore: number;
  maxScore: number;
  reason: string;
  missing?: string[];
  confidence?: number | null;
  evidence?: QualityEvidence[];
  criteria?: QualityCriterion[];
  evidenceLevel?: EvidenceLevel | null;
  strengths?: string[];
  deductions?: string[];
  suggestions?: string[];
  earnedPoints?: number;
  maxPoints?: number;
  applicableMaxScore?: number;
}

export interface QualityAssessment {
  version: string;
  promptVersion?: string;
  model?: string;
  generatedAt?: string;
  sourceHash?: string;
  anomalies?: string[];
  totalScore?: number;
  evidenceLevel?: EvidenceLevel | null;
  confidence?: number | null;
  factConflict?: boolean;
  recommendHumanReview?: boolean;
  verification?: { recommended?: boolean; reason?: string; wording?: string };
  modules: QualityModule[];
}

const defaultWeights = [30, 25, 25, 20];
const moduleIds = ['results', 'problems', 'nextPlan', 'reflection'];
const evidenceLabels: Record<EvidenceType, string> = {
  reported_fact: '员工自述的事实',
  plan: '计划',
  judgment: '判断',
};
const coachingModules = [
  { id: 'results', label: '本周成果', maxPoints: 30 },
  { id: 'problems', label: '问题与挑战', maxPoints: 25 },
  { id: 'reflection', label: '思考与复盘', maxPoints: 20 },
  { id: 'nextPlan', label: '下周计划', maxPoints: 25 },
];
const disclaimer = '本评分仅用于评价周报的信息完整度、沟通价值与复盘质量，不代表对员工绩效或工作价值的最终评价。';
export const isCoachingQualityAssessment = (assessment?: QualityAssessment | null) => typeof assessment?.version === 'string' && assessment.version.startsWith('weekly-quality-coaching-');
const uniqueText = (items?: string[]) => [...new Set((Array.isArray(items) ? items : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))];
const numberText = (value: number) => Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, '') : '—';
const savedPointText = (value?: number) => typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
const timeText = (value?: string) => {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : value;
};

function EvidenceQuotes({ evidence }: { evidence: QualityEvidence[] }) {
  return <div className="quality-evidence-quotes">{evidence.map((item, index) => <blockquote key={`${index}:${item.quote}`}>
    <span><Quote size={12} aria-hidden="true"/>{evidenceLabels[item.type] || '原文引用'}</span>
    <p>{item.quote}</p>
  </blockquote>)}</div>;
}

function MissingEvidence({ missing }: { missing: string[] }) {
  return missing.length ? <div className="quality-missing"><strong>如需进一步确认</strong><ul>{missing.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null;
}

function ScoringReasons({ label, items }: { label: string; items?: string[] }) {
  return !!items?.length && <div className="quality-module-reason"><strong>{label}</strong><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>;
}

export function ReportQualityDetails({ assessment, weights = defaultWeights, pending = false, previous = false, refresh }: {
  assessment?: QualityAssessment | null;
  weights?: number[];
  pending?: boolean;
  previous?: boolean;
  refresh?: {state?: string; attempts?: number};
}) {
  const modules = Array.isArray(assessment?.modules) ? assessment.modules : [];
  const refreshLabel=refresh&&refresh.state!=='ready'?(refresh.state==='failed'?'重评失败':'重评中'):'';
  if (!assessment || !modules.length) return <section className="quality-assessment quality-assessment-empty" aria-label="四模块评分说明">
    <div className="quality-assessment-heading"><h4><FileCheck2 size={15} aria-hidden="true"/>四模块评分说明</h4>{refreshLabel&&<span className="pf-status is-warning">{previous?'旧版分数 · ':''}{refreshLabel}</span>}</div>
    {refreshLabel&&<p>{previous?'旧评分继续保留，新评分全部校验成功后自动更新。':'新评分尚未完成，仍待处理，不按0分处理。'}</p>}
    <p>{pending&&!previous ? 'AI 分析完成后，将自动展示各模块得分、评分理由和可以补充的内容。当前未生成有效评分，不按 0 分处理。' : '历史记录未保存详细评分说明，已有分数保留；这里不补写历史理由。'}</p>
    <p className="quality-disclaimer">{disclaimer}</p>
  </section>;

  if (isCoachingQualityAssessment(assessment)) return <section className="quality-assessment quality-assessment-coaching" aria-label="四模块评分说明" data-quality-version="coaching">
    <div className="quality-assessment-heading"><h4><FileCheck2 size={15} aria-hidden="true"/>四模块评分说明</h4><span className="pf-status is-warning">{previous?`旧版分数 · ${refreshLabel||'历史评分'}`:'AI 候选'}</span></div>
    {previous&&<p className="quality-assessment-caption">以下保留上次评分说明，当前候选完成后会更新。</p>}
    <p className="quality-assessment-caption">各模块展示本次计入总分的实际贡献分。月结、周报收集齐且 AI 分析完成后自动生成月度最终分。</p>
    {assessment.totalScore != null && <p className="quality-confidence">AI 候选分 {savedPointText(assessment.totalScore)} 分</p>}
    {(assessment.anomalies?.length || assessment.verification?.recommended === true) && <div className="quality-missing quality-anomalies"><strong>如需进一步确认</strong>{assessment.anomalies?.length ? <ul>{assessment.anomalies.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>如有需要可进一步核实。</p>}</div>}
    <div className="quality-module-list">{coachingModules.map(definition => {
      const module = modules.find(item => item.id === definition.id);
      if (!module) return null;
      const suggestions = uniqueText(module.suggestions).slice(0, 2);
      return <article className="quality-module quality-coaching-module" key={module.id} data-quality-module={module.id}>
        <header className="quality-coaching-module-heading"><span className="quality-module-title">{definition.label}<small>计入总分的贡献分</small></span><span className="quality-module-score"><b>{savedPointText(module.earnedPoints)}</b><small>/ {savedPointText(module.maxPoints ?? definition.maxPoints)} 分</small></span></header>
        <div className="quality-module-body">
          <div className="quality-module-reason" data-quality-section="reason"><strong>理由</strong><p>{module.reason}</p></div>
          <div className="quality-module-reason" data-quality-section="strengths"><strong>做得好</strong>{uniqueText(module.strengths).length ? <ul>{uniqueText(module.strengths).map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="quality-assessment-caption">本次未单独列出。</p>}</div>
          <div className="quality-module-reason" data-quality-section="suggestions"><strong>可以补充</strong>{suggestions.length ? <ul>{suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="quality-assessment-caption">本次未提出补充建议。</p>}</div>
        </div>
      </article>;
    })}</div>
    <p className="quality-disclaimer">{disclaimer}</p>
    <AssessmentVersion assessment={assessment}/>
  </section>;

  const weightFor = (module: QualityModule, index: number) => {
    const position = moduleIds.indexOf(module.id);
    return weights[position < 0 ? index : position] ?? defaultWeights[position < 0 ? index : position] ?? 0;
  };

  return <section className="quality-assessment" aria-label="四模块评分说明" data-quality-version="legacy">
    <div className="quality-assessment-heading"><h4><FileCheck2 size={15} aria-hidden="true"/>四模块评分说明</h4><span className="pf-status is-warning">{previous?`旧版分数 · ${refreshLabel||'历史评分'}`:'AI 候选'}</span></div>
    {previous&&<p className="quality-missing">以下引文来自旧评分对应的周报版本。新评分完成后会更新候选分。</p>}
    <p className="quality-assessment-caption">各模块按适用子项折算为 100 分后加权。月结、周报收集齐且 AI 分析完成后自动生成月度最终分。</p>
    {(assessment.confidence != null || assessment.totalScore != null) && <p className="quality-confidence">{[
      assessment.totalScore != null && `AI 候选分 ${assessment.totalScore.toFixed(1)} 分`,
      assessment.confidence != null && `整体置信度（模型自评）${numberText(assessment.confidence * 100)}%`,
    ].filter(Boolean).join(' · ')}</p>}
    {(assessment.factConflict != null || assessment.recommendHumanReview != null) && <p className="quality-confidence">{[
      assessment.factConflict != null && (assessment.factConflict ? '发现可能的事实冲突' : '未发现事实冲突'),
      assessment.recommendHumanReview != null && (assessment.recommendHumanReview ? '建议重点人工复核' : '常规复核参考'),
    ].filter(Boolean).join(' · ')}</p>}
    {!!assessment.anomalies?.length && <div className="quality-missing quality-anomalies"><strong>如需进一步确认</strong><ul>{assessment.anomalies.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    <div className="quality-module-list">{modules.map((module, index) => {
      const weight = weightFor(module, index);
      const criteria = Array.isArray(module.criteria) ? module.criteria : [];
      const applicableCriteria = criteria.filter(criterion => criterion.applicable !== false);
      const criterionScore = applicableCriteria.reduce((total, criterion) => total + criterion.score, 0);
      const criterionMaximum = module.applicableMaxScore ?? applicableCriteria.reduce((total, criterion) => total + criterion.maxScore, 0);
      return <details className="quality-module" key={module.id} data-quality-module={module.id} open={index === 0}>
        <summary><span className="quality-module-title">{module.module}<small>权重 {numberText(weight)}%</small></span><span className="quality-module-score"><b>{numberText(module.candidateScore)}</b><small>/ 100 分</small></span><span className="quality-module-contribution">计入总分 <b>{numberText(module.candidateScore * weight / 100)}</b> 分</span><ChevronDown size={15} aria-hidden="true"/></summary>
        <div className="quality-module-body">
          <div className="quality-module-reason"><strong>评分理由</strong><p>{module.reason}</p></div>
          <ScoringReasons label="做得好" items={module.strengths}/>
          <details className="quality-legacy-details"><summary>历史评分细项与原文引用</summary>
          {criterionMaximum > 0 && <p className="quality-confidence">适用细则合计 {numberText(criterionScore)} / {numberText(criterionMaximum)} 分，折算模块分 {numberText(module.candidateScore)} / 100 分。</p>}
          {module.confidence != null && <p className="quality-confidence">置信度（模型自评）：{numberText(module.confidence * 100)}%</p>}
          <ScoringReasons label="可以补充" items={module.deductions}/>
          <MissingEvidence missing={module.missing || []}/>
          {!!module.evidence?.length && <div className="quality-module-evidence"><strong>保存的原文引用</strong><EvidenceQuotes evidence={module.evidence}/></div>}
          <div className="quality-criteria">{criteria.map(criterion => <article key={criterion.id} className="quality-criterion">
            <div className="quality-criterion-heading"><h5>{criterion.label}</h5><span>{criterion.applicable === false ? '不适用' : <><b>{numberText(criterion.score)}</b> / {numberText(criterion.maxScore)} 分</>}</span></div>
            {(criterion.description || criterion.standard) && <p className="quality-criterion-standard">评分标准：{criterion.description || criterion.standard}</p>}
            <p className="quality-criterion-reason"><strong>{criterion.applicable === false ? '不适用原因：' : '理由：'}</strong>{criterion.notApplicableReason || criterion.reason}</p>
            {!!criterion.evidence?.length && <EvidenceQuotes evidence={criterion.evidence}/>}
            <MissingEvidence missing={criterion.missing || []}/>
          </article>)}</div>
          </details>
        </div>
      </details>;
    })}</div>
    <p className="quality-assessment-caption">{previous?'引文来自旧评分保存的原文版本。':'引文来自本份周报。'}如需进一步确认，可结合内部记录查看。</p>
    <p className="quality-disclaimer">{disclaimer}</p>
    <AssessmentVersion assessment={assessment}/>
  </section>;
}

function AssessmentVersion({ assessment }: { assessment: QualityAssessment }) {
  return <details className="quality-version"><summary>评分版本与时间</summary><dl>
      <div><dt>评分规则</dt><dd>{assessment.version}</dd></div>
      <div><dt>AI 模型</dt><dd>{assessment.model || '未记录'}</dd></div>
      <div><dt>评分时间</dt><dd>{timeText(assessment.generatedAt)}（北京时间）</dd></div>
      {assessment.sourceHash && <div><dt>原文版本</dt><dd>{assessment.sourceHash}</dd></div>}
    </dl></details>;
}
