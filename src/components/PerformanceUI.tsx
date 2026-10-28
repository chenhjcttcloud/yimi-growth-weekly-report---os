import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { CheckCheck, FolderClock } from 'lucide-react';

export const scoreText = (value: number | null | undefined) => value == null ? '—' : Number(value).toFixed(1);
export const monthText = (month: string) => month ? `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月` : '月度结果';

export function ResultMetric({ icon: Icon, label, value, unit, description, children }: {
  icon: LucideIcon; label: string; value: string; unit?: string; description: string; children?: ReactNode;
}) {
  return <article className="v2-card pf-metric">
    <div className="pf-metric-label"><span>{label}</span><span className="pf-icon"><Icon size={18}/></span></div>
    <div className={`pf-metric-value ${value === '—' ? 'is-empty' : ''}`}>{value}<small>{value !== '—' && unit}</small></div>
    <p className="pf-caption">{description}</p>
    {children && <div className="pf-metric-footer">{children}</div>}
  </article>;
}

export function ResultStatus({ confirmed, label }: { confirmed: boolean; label?: string }) {
  return <span className={`pf-status ${confirmed ? 'is-confirmed' : ''}`}><CheckCheck size={12}/>{label || (confirmed ? '已确认' : '待确认')}</span>;
}

export function ResultEmpty({ title, description }: { title: string; description: string }) {
  return <div className="pf-empty"><span className="pf-empty-icon"><FolderClock size={24} strokeWidth={1.5}/></span><h3>{title}</h3><p>{description}</p></div>;
}

export function SubmissionCounts({ stats }: { stats?: any }) {
  return <div className="pf-counts">{[['expected','应交'],['submitted','已交'],['onTime','准时'],['late','迟交'],['missing','未交']].map(([key,label]) => <div key={key}><strong>{stats?.[key] ?? '—'}</strong><span>{label}</span></div>)}</div>;
}
