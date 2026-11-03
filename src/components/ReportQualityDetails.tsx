import { ChevronDown, FileCheck2, Quote } from 'lucide-react';
import '../styles/report-quality.css';

type EvidenceType = 'reported_fact' | 'plan' | 'judgment';

interface QualityEvidence {
  quote: string;
  type: EvidenceType;
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
}

export interface QualityAssessment {
  version: string;
  promptVersion?: string;
  model?: string;
  generatedAt?: string;
  sourceHash?: string;
  anomalies?: string[];
  modules: QualityModule[];
}

const defaultWeights = [30, 25, 25, 20];
const moduleIds = ['results', 'problems', 'nextPlan', 'reflection'];
const evidenceLabels: Record<EvidenceType, string> = {
  reported_fact: '员工自述的事实',
  plan: '计划',
  judgment: '判断',
};
const numberText = (value: number) => Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, '') : '—';
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
  return missing.length ? <div className="quality-missing"><strong>缺失证据</strong><ul>{missing.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null;
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
    {refreshLabel&&<p>{previous?'旧评分继续保留，新评分全部校验成功后自动更新。':'新评分尚未完成，系统会自动重试，不按0分处理。'}</p>}
    <p>{pending&&!previous ? 'AI 分析完成后，将自动展示各模块得分、评分理由和原文证据。当前未生成有效评分，不按 0 分处理。' : '历史记录未保存逐项评分理由和原文证据，已有分数保留；这里不补造评分依据。'}</p>
  </section>;

  const weightFor = (module: QualityModule, index: number) => {
    const position = moduleIds.indexOf(module.id);
    return weights[position < 0 ? index : position] ?? defaultWeights[position < 0 ? index : position] ?? 0;
  };

  return <section className="quality-assessment" aria-label="四模块评分依据">
    <div className="quality-assessment-heading"><h4><FileCheck2 size={15} aria-hidden="true"/>四模块评分依据</h4><span className={`pf-status ${previous?'is-warning':'is-confirmed'}`}>{previous?`旧版分数 · ${refreshLabel||'历史评分'}`:'自动评分发布'}</span></div>
    {previous&&<p className="quality-missing">以下为旧版本评分依据，引文对应该次评分的原文版本。当前正文的新评分完成后自动切换，无需人工审核。</p>}
    <p className="quality-assessment-caption">各模块标准化为 100 分后加权；及时率独立统计。异常只作提示，无需人工审核。</p>
    {!!assessment.anomalies?.length && <div className="quality-missing quality-anomalies"><strong>异常提示</strong><ul>{assessment.anomalies.map((item, index) => <li key={index}>{item}</li>)}</ul><p>异常仅作提示，评分自动发布，不额外扣分。</p></div>}
    <div className="quality-module-list">{modules.map((module, index) => {
      const weight = weightFor(module, index);
      const criteria = Array.isArray(module.criteria) ? module.criteria : [];
      const criterionScore = criteria.reduce((total, criterion) => total + criterion.score, 0);
      const criterionMaximum = criteria.reduce((total, criterion) => total + criterion.maxScore, 0);
      return <details className="quality-module" key={module.id} data-quality-module={module.id} open={index === 0}>
        <summary><span className="quality-module-title">{module.module}<small>权重 {numberText(weight)}%</small></span><span className="quality-module-score"><b>{numberText(module.candidateScore)}</b><small>/ 100 分</small></span><span className="quality-module-contribution">计入总分 <b>{numberText(module.candidateScore * weight / 100)}</b> 分</span><ChevronDown size={15} aria-hidden="true"/></summary>
        <div className="quality-module-body">
          <div className="quality-module-reason"><strong>评分理由</strong><p>{module.reason}</p></div>
          {!!criteria.length && <p className="quality-confidence">细则合计 {numberText(criterionScore)} / {numberText(criterionMaximum)} 分，折算模块分 {numberText(module.candidateScore)} / 100 分。</p>}
          {module.confidence != null && <p className="quality-confidence">置信度（模型自评）：{numberText(module.confidence * 100)}%</p>}
          <MissingEvidence missing={module.missing || []}/>
          {!!module.evidence?.length && <div className="quality-module-evidence"><strong>模块原文证据</strong><EvidenceQuotes evidence={module.evidence}/></div>}
          <div className="quality-criteria">{criteria.map(criterion => <article key={criterion.id} className="quality-criterion">
            <div className="quality-criterion-heading"><h5>{criterion.label}</h5><span><b>{numberText(criterion.score)}</b> / {numberText(criterion.maxScore)} 分</span></div>
            {(criterion.description || criterion.standard) && <p className="quality-criterion-standard">评分标准：{criterion.description || criterion.standard}</p>}
            <p className="quality-criterion-reason"><strong>理由：</strong>{criterion.reason}</p>
            {!!criterion.evidence?.length && <EvidenceQuotes evidence={criterion.evidence}/>}
            <MissingEvidence missing={criterion.missing || []}/>
          </article>)}</div>
        </div>
      </details>;
    })}</div>
    <p className="quality-assessment-caption">{previous?'引文来自旧评分保存的原文版本；':'引文来自本份周报；'}“员工自述的事实”表示员工报告的已完成事项，不表示已核实业务结果。</p>
    <details className="quality-version"><summary>评分版本与时间</summary><dl>
      <div><dt>评分规则</dt><dd>{assessment.version}</dd></div>
      <div><dt>提示词版本</dt><dd>{assessment.promptVersion || assessment.version}</dd></div>
      <div><dt>AI 模型</dt><dd>{assessment.model || '未记录'}</dd></div>
      <div><dt>评分时间</dt><dd>{timeText(assessment.generatedAt)}（北京时间）</dd></div>
      {assessment.sourceHash && <div><dt>原文版本</dt><dd>{assessment.sourceHash}</dd></div>}
    </dl></details>
  </section>;
}
