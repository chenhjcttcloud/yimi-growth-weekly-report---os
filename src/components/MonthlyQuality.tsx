import { monthText, ResultStatus, scoreText } from './PerformanceUI';

export const qualityGenerationBlockNotes = {
  month_open: '本月尚未结束。月结、周报收集齐且 AI 分析完成后自动生成最终分。',
  collection_pending: '本月周报尚未收集完成。收集齐且 AI 分析完成后自动生成最终分。',
};
// Retain compatibility with readers of the older response field name.
export const qualityConfirmationBlockNotes = qualityGenerationBlockNotes;

export interface MonthlyQualitySummary {
  status: 'pending_ai' | 'pending_confirmation' | 'pending_generation' | 'final' | 'revised_final' | 'no_reports';
  currentAverage: number | null;
  candidateScore: number | null;
  finalScore: number | null;
  pendingAnalysis: number;
  analyzedCount: number;
  expectedCount: number;
  confirmedBy?: string;
  confirmedAt?: string;
  publicationMode?: string;
  generatedBy?: string;
  generatedAt?: string;
  canConfirm?: boolean;
  confirmationBlockedReason?: keyof typeof qualityConfirmationBlockNotes;
  generationBlockedReason?: keyof typeof qualityGenerationBlockNotes;
  version?: string;
}

export const qualityReviewNotice = '四模块 AI 评分用于周报质量参考。月结、周报收集齐且 AI 分析完成后，系统自动汇总月度质量最终分。AI不直接作出奖惩或薪酬决定。';

export function qualityDate(value?: string) {
  if (!value) return '—';
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : value;
}

export function isAutomaticMonthlyQuality(quality?: MonthlyQualitySummary | null) {
  return quality?.publicationMode === 'automatic';
}

export function isMonthlyQualityReviewLocked(quality?: MonthlyQualitySummary | null) {
  return Boolean(quality && ['final', 'revised_final'].includes(quality.status) && !isAutomaticMonthlyQuality(quality));
}

export function monthlyQualityMetadata(quality?: MonthlyQualitySummary | null) {
  const automatic = isAutomaticMonthlyQuality(quality);
  return {
    automatic,
    actor: automatic ? quality?.generatedBy || quality?.confirmedBy || '系统自动生成' : quality?.confirmedBy || '—',
    time: automatic ? quality?.generatedAt || quality?.confirmedAt : quality?.confirmedAt,
    actorLabel: automatic ? '生成方式' : '确认人',
    timeLabel: automatic ? '生成时间' : '确认时间',
  };
}

export function monthlyQualityView(quality?: MonthlyQualitySummary | null, month?: string) {
  if (quality?.status === 'final' || quality?.status === 'revised_final') {
    const metadata = monthlyQualityMetadata(quality);
    return { label: `${month ? monthText(month) : '月度'}周报质量最终分`, value: quality.finalScore, status: metadata.automatic ? '已自动生成' : '历史已确认', note: `${metadata.actorLabel} ${metadata.actor} · ${metadata.timeLabel} ${qualityDate(metadata.time)}`, confirmed: true };
  }
  if (quality?.status === 'pending_ai' || quality?.generationBlockedReason || quality?.confirmationBlockedReason) {
    const block = quality.generationBlockedReason || quality.confirmationBlockedReason;
    const pending = `待完成 AI 分析 ${quality.pendingAnalysis} 份`;
    const note = block
      ? [qualityGenerationBlockNotes[block], quality.pendingAnalysis > 0 ? pending : null].filter(Boolean).join(' ')
      : `${pending} · 完成后按月度规则自动汇总，当前均分仅作参考`;
    return { label: '当前已完成分析均分', value: quality.currentAverage, status: '暂定', note, confirmed: false };
  }
  if (quality?.status === 'pending_confirmation' || quality?.status === 'pending_generation') {
    return { label: '月度质量参考均分', value: quality.candidateScore ?? quality.currentAverage, status: '等待自动生成', note: '月结、周报收集齐且 AI 分析完成后，系统自动生成月度最终分。', confirmed: false };
  }
  return { label: '月度周报质量', value: null, status: '暂无可评分周报', note: '有效周报完成 AI 分析后会展示参考均分，满足月度条件后自动生成最终分。', confirmed: false };
}

export function MonthlyQualityResultRow({ quality }: { quality?: MonthlyQualitySummary }) {
  const view = monthlyQualityView(quality);
  return <div className="pf-confirm-row">
      <span><strong>{view.label} · {scoreText(view.value)}{view.value != null && ' 分'}</strong><small>{view.note}</small></span>
      <ResultStatus confirmed={view.confirmed} label={view.status}/>
    </div>;
}
