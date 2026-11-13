import { useState } from 'react';
import { monthText, ResultStatus, scoreText } from './PerformanceUI';

export const qualityConfirmationBlockNotes = {
  month_open: '本月尚未结束。月结并完成周报收集与评分后可确认最终分。',
  collection_pending: '本月周报尚未收集完成。收集和评分完成后可确认最终分。',
};

export interface MonthlyQualitySummary {
  status: 'pending_ai' | 'pending_confirmation' | 'final' | 'revised_final' | 'no_reports';
  currentAverage: number | null;
  candidateScore: number | null;
  finalScore: number | null;
  pendingAnalysis: number;
  analyzedCount: number;
  expectedCount: number;
  confirmedBy?: string;
  confirmedAt?: string;
  canConfirm?: boolean;
  confirmationBlockedReason?: keyof typeof qualityConfirmationBlockNotes;
  version?: string;
}

export const qualityReviewNotice = 'AI评分仅用于提供周报质量参考。最终绩效结果须经管理人员审核确认。AI不直接作出绩效、奖惩或薪酬决定。';

export function qualityDate(value?: string) {
  if (!value) return '—';
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : value;
}

export function monthlyQualityView(quality?: MonthlyQualitySummary | null, month?: string) {
  if (quality?.status === 'final' || quality?.status === 'revised_final') {
    return { label: `${month ? monthText(month) : '月度'}周报质量最终分`, value: quality.finalScore, status: '已确认最终', note: `确认人 ${quality.confirmedBy || '—'} · 确认时间 ${qualityDate(quality.confirmedAt)}`, confirmed: true };
  }
  if (quality?.status === 'pending_ai' || quality?.confirmationBlockedReason) {
    const block = quality.confirmationBlockedReason;
    const pending = `待完成 AI 分析 ${quality.pendingAnalysis} 份`;
    const note = block
      ? [qualityConfirmationBlockNotes[block], quality.pendingAnalysis > 0 ? pending : null].filter(Boolean).join(' ')
      : `${pending} · 仅作周报质量参考`;
    return { label: '当前已完成分析均分', value: quality.currentAverage, status: '暂定', note, confirmed: false };
  }
  if (quality?.status === 'pending_confirmation') {
    return { label: '月度质量候选分', value: quality.candidateScore, status: '待管理人员确认', note: 'AI 候选分尚未确认，仅作周报质量参考。', confirmed: false };
  }
  return { label: '月度周报质量', value: null, status: '暂无可评分周报', note: '有效周报完成 AI 分析后会展示质量候选分。', confirmed: false };
}

interface ConfirmTarget {
  userId: string;
  month: string;
  onUpdated: () => void;
}

export function MonthlyQualityResultRow({ quality, target }: { quality?: MonthlyQualitySummary; target?: ConfirmTarget }) {
  const [override, setOverride] = useState(false);
  const [score, setScore] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const view = monthlyQualityView(quality);
  const version = quality?.version;
  const canConfirm = Boolean(target && quality?.canConfirm && !quality.confirmationBlockedReason && quality.status === 'pending_confirmation' && quality.candidateScore != null && version);
  const validOverride = score.trim() !== '' && Number.isFinite(Number(score)) && Number(score) >= 0 && Number(score) <= 100 && Boolean(note.trim());

  async function confirm() {
    if (busy || !canConfirm || !target || (override && !validOverride)) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/performance/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'quality', userId: target.userId, month: target.month, version, ...(override ? { score: Number(score), note: note.trim() } : {}) }),
      });
      const result = await response.json();
      if (response.status === 409) {
        if (result.error === 'quality_month_open') throw Error(qualityConfirmationBlockNotes.month_open);
        if (result.error === 'quality_collection_pending') throw Error(qualityConfirmationBlockNotes.collection_pending);
      }
      if (!response.ok) throw Error(response.status === 403 ? '没有确认该员工质量分的权限。' : response.status === 409 ? '月度状态可能已更新，请刷新后查看。' : result.error === 'quality_adjustment_reason_required' ? '请填写人工调整原因。' : '月度质量分确认失败，请重试。');
      target.onUpdated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '月度质量分确认失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="pf-confirm-row">
      <span><strong>{view.label} · {scoreText(view.value)}{view.value != null && ' 分'}</strong><small>{view.note}</small></span>
      <ResultStatus confirmed={view.confirmed} label={view.status}/>
    </div>
    {canConfirm && <form className="pf-form quality-review-form" onSubmit={event => { event.preventDefault(); void confirm(); }}>
      <label className="quality-adjust-toggle pf-span-full"><input type="checkbox" checked={override} disabled={busy} onChange={event => { setOverride(event.target.checked); setScore(String(quality?.candidateScore ?? '')); }}/> 调整分数后确认</label>
      {override && <>
        <label>调整后的月度分<input type="number" min={0} max={100} step="0.1" value={score} disabled={busy} onChange={event => setScore(event.target.value)} required/></label>
        <label>调整原因<textarea value={note} maxLength={4000} disabled={busy} onChange={event => setNote(event.target.value)} required/></label>
      </>}
      <div><button className="primary-button" type="submit" disabled={busy || (override && !validOverride)}>{busy ? '正在确认…' : '确认月度最终分'}</button></div>
      {error && <p role="alert" className="pf-error pf-span-full">{error}</p>}
    </form>}
  </>;
}
