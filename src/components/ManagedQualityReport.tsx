import { useState } from 'react';
import { FileText } from 'lucide-react';
import { DeferredEvidence } from './DeferredEvidence';
import { qualityDate } from './MonthlyQuality';
import { scoreText } from './PerformanceUI';
import { ReportQualityDetails, type QualityAssessment } from './ReportQualityDetails';

type ReviewAction = 'adjust_score' | 'validate_evidence' | 'mark_not_applicable' | 'exclude_report' | 'restore_report' | 'reanalyze';

const actionLabels: Record<ReviewAction, string> = {
  adjust_score: '调整周报候选分',
  validate_evidence: '标记证据有效',
  mark_not_applicable: '标记评分项不适用',
  exclude_report: '标记周报无效或重复',
  restore_report: '恢复纳入月度质量分',
  reanalyze: '退回重新分析',
};

interface WeeklyQualityReport {
  id: string;
  start: string;
  end: string;
  status?: string;
  submittedAt?: string;
  submitted?: boolean;
  candidate?: number | null;
  aiCandidate?: number | null;
  qualityExcluded?: boolean;
  qualityReanalysisPending?: boolean;
  qualityReviewVersion?: string;
  qualityReviews?: { action: ReviewAction; reason: string; createdAt: string; reviewerName?: string; active?: boolean; details?: { score?: number; moduleId?: string; criterionId?: string; quote?: string } }[];
  qualityAssessment?: QualityAssessment;
  previousQualityAssessment?: QualityAssessment;
  qualityDisplaySource?: string;
  displayQualityScore?: number | null;
  previousScoringWeights?: number[];
  scoringPolicy?: { weights?: number[] };
  qualityRefresh?: { state?: string; attempts?: number };
  evidence: { module: string; text: string }[];
  anomalies: string[];
  suggestions?: string;
  contentVersion?: string;
  contentDeferred?: boolean;
  content?: unknown;
}

const reviewErrors: Record<string, string> = {
  ai_not_configured: '尚未配置 AI 服务，当前无法发起重新分析。',
  ai_scoring_paused: 'AI 评分已暂停，在系统设置取消暂停后可发起重新分析。',
  report_rescore_not_supported: '该周报来源暂不支持自动重新分析。',
  report_sync_running: '周报正在同步，请稍后再发起重新分析。',
  quality_candidate_changed: '周报评分已更新，请刷新后再复核。',
  result_locked: '月度最终分已确认，请查看审核记录。',
  invalid_quality_evidence: '请填写对应模块中的完整原文引文。',
  quality_criterion_already_not_applicable: '该子项已标记为不适用。',
  quality_module_requires_criterion: '该模块至少保留一个适用子项。',
  rescore_before_start_month: '该周报早于系统配置的 AI 评分起始月。',
};

export function ManagedQualityReport({ report, userId, month, editable, onUpdated }: { report: WeeklyQualityReport; userId: string; month: string; editable: boolean; onUpdated: () => void }) {
  const previous = report.qualityDisplaySource === 'previous';
  const displayScore = previous ? report.displayQualityScore : report.aiCandidate ?? report.candidate;
  const assessment = previous ? report.previousQualityAssessment : report.qualityAssessment;
  const [action, setAction] = useState<ReviewAction | ''>('');
  const [reason, setReason] = useState('');
  const [score, setScore] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [criterionId, setCriterionId] = useState('');
  const [quote, setQuote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const modules = report.qualityAssessment?.modules || [];
  const criterionAction = action === 'mark_not_applicable' || action === 'validate_evidence';
  const selectedModule = modules.find(module => module.id === moduleId);
  const criteria = selectedModule?.criteria || [];
  const ready = Boolean(action && reason.trim() && (!criterionAction || moduleId && criterionId) && (action !== 'validate_evidence' || quote.trim()) && (action !== 'adjust_score' || score.trim() && Number.isFinite(Number(score)) && Number(score) >= 0 && Number(score) <= 100));
  const reviewActions: ReviewAction[] = report.qualityExcluded ? (report.qualityReviews?.some(review => review.active && review.action === 'exclude_report') ? ['restore_report'] : []) : [
    ...(report.candidate != null ? ['adjust_score' as const] : []),
    ...(report.candidate != null && modules.length ? ['validate_evidence' as const, 'mark_not_applicable' as const] : []),
    'exclude_report', 'reanalyze',
  ];

  async function saveReview() {
    if (busy || !ready || !report.qualityReviewVersion) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/performance/quality-review', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportId: report.id, userId, month, version: report.qualityReviewVersion, action, reason: reason.trim(), ...(criterionAction ? { moduleId, criterionId } : {}), ...(action === 'validate_evidence' ? { quote } : {}), ...(action === 'adjust_score' ? { score: Number(score) } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(reviewErrors[result.error] || (response.status === 403 ? '没有复核该周报的权限。' : '周报复核未保存，请刷新后重试。'));
      onUpdated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '周报复核未保存，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return <article className="pf-evidence" data-report-week={report.end}>
    <div className="pf-evidence-head"><h4><FileText size={16}/>{report.start} — {report.end}</h4><span className="pf-subtle-tag">{report.status || '待核实'}</span></div>
    <p className="pf-caption">提交时间 {report.submittedAt || '待核实'} · {previous ? '旧版 AI 候选分' : 'AI 候选分'} {scoreText(displayScore)}{displayScore != null && ' 分'}{report.qualityExcluded ? ' · 已标记为无效或重复' : report.qualityReanalysisPending ? ' · 已退回重新分析' : report.candidate != null && report.candidate !== displayScore ? ` · 人工复核后 ${scoreText(report.candidate)} 分` : ''}</p>
    {report.evidence.map(item => <div className="pf-fact" key={item.module}><span>{item.module.replace('摘要', '')}</span><p>{item.text || '未提供内容'}</p></div>)}
    <ReportQualityDetails assessment={assessment} weights={previous ? report.previousScoringWeights : report.scoringPolicy?.weights} pending={report.candidate == null && report.displayQualityScore == null} previous={previous} refresh={report.qualityRefresh}/>
    <div className={`pf-evidence-note ${report.anomalies.length ? 'is-warning' : ''}`}><strong>{report.anomalies.length ? '完整性提示' : '完整性检查'}</strong><p>{report.anomalies.join('；') || '四个模块完整，未标记异常'}</p>{report.suggestions && <p>{report.suggestions}</p>}</div>
    <DeferredEvidence label="查看完整原始记录" url={report.id ? '/api/performance/report?id=' + encodeURIComponent(report.id) + (report.contentVersion ? '&version=' + encodeURIComponent(report.contentVersion) : '') : undefined} initialValue={report.contentDeferred ? undefined : report.content}/>
    {!!report.qualityReviews?.length && <details className="quality-version"><summary>人工复核记录（{report.qualityReviews.length}）</summary><ul className="quality-review-records">
      {report.qualityReviews.map((review, index) => <li key={index}><strong>{actionLabels[review.action]}{review.details?.score != null ? ` · ${scoreText(review.details.score)} 分` : ''}{review.active === false ? ' · 历史记录' : ''}</strong><p>{review.reason}</p>{review.details?.quote && <blockquote>{review.details.quote}</blockquote>}<small>{review.reviewerName || '—'} · {qualityDate(review.createdAt)}</small></li>)}
    </ul></details>}
    {editable && report.submitted && report.qualityReviewVersion && reviewActions.length > 0 && <details className="quality-version"><summary>复核这份周报</summary>
      <form className="pf-form quality-review-form" onSubmit={event => { event.preventDefault(); void saveReview(); }}>
        <label>复核操作<select value={action} disabled={busy} onChange={event => { setAction(event.target.value as ReviewAction | ''); setModuleId(''); setCriterionId(''); setQuote(''); setScore(String(report.candidate ?? '')); }} required><option value="">选择操作</option>{reviewActions.map(item => <option value={item} key={item}>{actionLabels[item]}</option>)}</select></label>
        {action === 'adjust_score' && <label>调整后的周报候选分<input type="number" min={0} max={100} step="0.1" value={score} disabled={busy} onChange={event => setScore(event.target.value)} required/></label>}
        {criterionAction && <>
          <label>评分模块<select value={moduleId} disabled={busy} onChange={event => { setModuleId(event.target.value); setCriterionId(''); setQuote(''); }} required><option value="">选择模块</option>{modules.map(module => <option value={module.id} key={module.id}>{module.module}</option>)}</select></label>
          <label>评分子项<select value={criterionId} disabled={busy || !moduleId} onChange={event => { setCriterionId(event.target.value); setQuote(criteria.find(item => item.id === event.target.value)?.evidence?.[0]?.quote || ''); }} required><option value="">选择子项</option>{criteria.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        </>}
        {action === 'validate_evidence' && <label>已核验的周报原文<textarea value={quote} disabled={busy} onChange={event => setQuote(event.target.value)} required/></label>}
        {action && <><label>复核原因<textarea value={reason} maxLength={4000} disabled={busy} onChange={event => setReason(event.target.value)} required/></label><div><button className="primary-button" type="submit" disabled={busy || !ready}>{busy ? '正在保存…' : '保存复核'}</button></div></>}
        {error && <p role="alert" className="pf-error pf-span-full">{error}</p>}
      </form>
    </details>}
  </article>;
}
