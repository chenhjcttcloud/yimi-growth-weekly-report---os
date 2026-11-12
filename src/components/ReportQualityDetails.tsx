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
  missing: string[];
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
  missing: string[];
  confidence: number | null;
  evidence: QualityEvidence[];
  criteria: QualityCriterion[];
  evidenceLevel?: EvidenceLevel | null;
  strengths?: string[];
  deductions?: string[];
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
  modules: QualityModule[];
}

const defaultWeights = [30, 25, 25, 20];
const moduleIds = ['results', 'problems', 'nextPlan', 'reflection'];
const evidenceLabels: Record<EvidenceType, string> = {
  reported_fact: '员工自述的事实',
  plan: '计划',
  judgment: '判断',
};
const levelLabels: Record<EvidenceLevel, string> = {
  A: 'A 级 · 硬证据',
  B: 'B 级 · 内部可核验事实',
  C: 'C 级 · 明确员工自述',
  D: 'D 级 · 空泛描述',
};
const numberText = (value: number) => Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, '') : '—';
const timeText = (value?: string) => {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : value;
};

function EvidenceQuotes({ evidence }: { evidence: QualityEvidence[] }) {
  return <div className="quality-evidence-quotes">{evidence.map((item, index) => <blockquote key={`${index}:${item.quote}`}>
    <span><Quote size={12} aria-hidden="true"/>{item.level ? levelLabels[item.level] : evidenceLabels[item.type] || '原文引用'}</span>
    <p>{item.quote}</p>
  </blockquote>)}</div>;
}

function MissingEvidence({ missing }: { missing: string[] }) {
  return missing.length ? <div className="quality-missing"><strong>缺失证据</strong><ul>{missing.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null;
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
  if (!assessment || !modules.length) return <section className="quality-assessment quality-assessment-empty" aria-label="四模块评分依据">
    <div className="quality-assessment-heading"><h4><FileCheck2 size={15} aria-hidden="true"/>四模块评分依据</h4>{refreshLabel&&<span className="pf-status is-warning">{previous?'旧版分数 · ':''}{refreshLabel}</span>}</div>
    {refreshLabel&&<p>{previous?'旧评分继续保留，新评分全部校验成功后自动更新。':'新评分尚未完成，仍待处理，不按0分处理。'}</p>}
    <p>{pending&&!previous ? 'AI 分析完成后，将自动展示各模块得分、评分理由和原文证据。当前未生成有效评分，不按 0 分处理。' : '历史记录未保存逐项评分理由和原文证据，已有分数保留；这里不补造评分依据。'}</p>
  </section>;

  const weightFor = (module: QualityModule, index: number) => {
    const position = moduleIds.indexOf(module.id);
    return weights[position < 0 ? index : position] ?? defaultWeights[position < 0 ? index : position] ?? 0;
  };

  return <section className="quality-assessment" aria-label="四模块评分依据">
    <div className="quality-assessment-heading"><h4><FileCheck2 size={15} aria-hidden="true"/>四模块评分依据</h4><span className="pf-status is-warning">{previous?`旧版分数 · ${refreshLabel||'历史评分'}`:'AI 候选'}</span></div>
    {previous&&<p className="quality-missing">以下引文来自旧评分对应的周报版本。新评分完成后会更新候选分。</p>}
    <p className="quality-assessment-caption">各模块按适用子项折算为 100 分后加权。月度最终分由管理人员确认。</p>
    {(assessment.evidenceLevel || assessment.confidence != null || assessment.totalScore != null) && <p className="quality-confidence">{[
      assessment.totalScore != null && `AI 候选分 ${assessment.totalScore.toFixed(1)} 分`,
      assessment.evidenceLevel && levelLabels[assessment.evidenceLevel],
      assessment.confidence != null && `整体置信度（模型自评）${numberText(assessment.confidence * 100)}%`,
    ].filter(Boolean).join(' · ')}</p>}
    {(assessment.factConflict != null || assessment.recommendHumanReview != null) && <p className="quality-confidence">{[
      assessment.factConflict != null && (assessment.factConflict ? '发现可能的事实冲突' : '未发现事实冲突'),
      assessment.recommendHumanReview != null && (assessment.recommendHumanReview ? '建议重点人工复核' : '常规人工确认'),
    ].filter(Boolean).join(' · ')}</p>}
    {!!assessment.anomalies?.length && <div className="quality-missing quality-anomalies"><strong>异常提示</strong><ul>{assessment.anomalies.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
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
          {criterionMaximum > 0 && <p className="quality-confidence">适用细则合计 {numberText(criterionScore)} / {numberText(criterionMaximum)} 分，折算模块分 {numberText(module.candidateScore)} / 100 分。</p>}
          {module.confidence != null && <p className="quality-confidence">置信度（模型自评）：{numberText(module.confidence * 100)}%</p>}
          {module.evidenceLevel && <p className="quality-confidence">证据等级 · {levelLabels[module.evidenceLevel]}</p>}
          <ScoringReasons label="加分依据" items={module.strengths}/>
          <ScoringReasons label="扣分依据" items={module.deductions}/>
          <MissingEvidence missing={module.missing || []}/>
          {!!module.evidence?.length && <div className="quality-module-evidence"><strong>模块原文证据</strong><EvidenceQuotes evidence={module.evidence}/></div>}
          <div className="quality-criteria">{criteria.map(criterion => <article key={criterion.id} className="quality-criterion">
            <div className="quality-criterion-heading"><h5>{criterion.label}</h5><span>{criterion.applicable === false ? '不适用' : <><b>{numberText(criterion.score)}</b> / {numberText(criterion.maxScore)} 分</>}</span></div>
            {(criterion.description || criterion.standard) && <p className="quality-criterion-standard">评分标准：{criterion.description || criterion.standard}</p>}
            <p className="quality-criterion-reason"><strong>{criterion.applicable === false ? '不适用原因：' : '理由：'}</strong>{criterion.notApplicableReason || criterion.reason}</p>
            {criterion.evidenceLevel && <p className="quality-confidence">证据等级 · {levelLabels[criterion.evidenceLevel]}</p>}
            {!!criterion.evidence?.length && <EvidenceQuotes evidence={criterion.evidence}/>}
            <MissingEvidence missing={criterion.missing || []}/>
          </article>)}</div>
        </div>
      </details>;
    })}</div>
    <p className="quality-assessment-caption">{previous?'引文来自旧评分保存的原文版本。':'引文来自本份周报。'}员工自述的事项可结合内部记录复核。</p>
    <details className="quality-version"><summary>评分版本与时间</summary><dl>
      <div><dt>评分规则</dt><dd>{assessment.version}</dd></div>
      <div><dt>AI 模型</dt><dd>{assessment.model || '未记录'}</dd></div>
      <div><dt>评分时间</dt><dd>{timeText(assessment.generatedAt)}（北京时间）</dd></div>
      {assessment.sourceHash && <div><dt>原文版本</dt><dd>{assessment.sourceHash}</dd></div>}
    </dl></details>
  </section>;
}
