import { useEffect, useId, useState } from 'react';
import { Archive, CalendarDays, ChevronDown, LockKeyhole } from 'lucide-react';
import { AppSelect } from './AppSelect';
import '../styles/historical-report-archive.css';

interface ArchivedReportSummary {
  id: string;
  employeeName: string;
  department?: string;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  submittedAt?: string;
  status?: string;
  oldScore: number | null;
}

interface ArchivedReport extends ArchivedReportSummary {
  facts: { results?: string; problems?: string; nextPlan?: string; reflection?: string };
  recoveredReflection?: { text: string; source?: unknown; reason?: string } | null;
}

interface ArchivePage {
  items: ArchivedReportSummary[];
  total: number;
  months: string[];
  limit: number;
  offset: number;
  readOnly: true;
  affectsPerformance: false;
}

interface ArchiveProps {
  management?: boolean;
  previewEmployeeId?: string;
  employeeContextId?: string;
}

const PAGE_SIZE = 20;
const modules = [
  ['results', '本周成果'],
  ['problems', '问题与挑战'],
  ['nextPlan', '下周计划与目标'],
  ['reflection', '思考与复盘'],
] as const;

function submittedTime(value?: string) {
  if (!value) return '旧版未保存提交时间';
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return value.replace('T', ' ');
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
    : '提交时间待核实';
}

function failureMessage(status: number) {
  if (status === 401) return '登录状态已失效，请刷新页面后重试。';
  if (status === 403) return '没有查看这些历史补档的权限。';
  return '历史补档暂时无法加载，请稍后刷新页面重试。';
}

export function HistoricalReportArchive(props: ArchiveProps) {
  const employeeId = props.previewEmployeeId || (!props.management && props.employeeContextId && props.employeeContextId !== 'self' ? props.employeeContextId : undefined);
  const context = `${props.management ? 'management' : 'personal'}:${props.previewEmployeeId || props.employeeContextId || 'self'}`;
  return <ArchiveBrowser key={context} {...props} employeeId={employeeId} context={context}/>;
}

function ArchiveBrowser({ management = false, employeeId, context }: ArchiveProps & { context: string; employeeId?: string }) {
  const monthId = useId();
  const [month, setMonth] = useState('');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{ key: string; page: ArchivePage } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const requestKey = `${context}:${month}:${offset}`;
  const page = result?.key === requestKey ? result.page : null;
  const errorText = error?.key === requestKey ? error.message : '';
  const months = result?.page.months || [];

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (month) query.set('month', month);
    if (employeeId) query.set('employeeId', employeeId);
    if (management) query.set('view', 'management');
    fetch(`/api/historical-reports?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(failureMessage(response.status));
        return response.json() as Promise<ArchivePage>;
      })
      .then(value => {
        if (!Array.isArray(value.items) || !Array.isArray(value.months) || !Number.isFinite(value.total) || value.readOnly !== true || value.affectsPerformance !== false) throw new Error(failureMessage(500));
        if (!controller.signal.aborted) setResult({ key: requestKey, page: value });
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError({ key: requestKey, message: failure instanceof Error ? failure.message : failureMessage(500) });
      });
    return () => controller.abort();
  }, [requestKey, month, offset, employeeId, management]);

  return <section className="v2-card historical-archive" aria-label="历史补档" data-historical-archive={management ? 'management' : 'personal'}>
    <header className="historical-archive-heading">
      <div><span className="v2-eyebrow"><Archive size={14}/>历史补档</span><h3 className="v2-card-title">回看旧版保存的周报</h3><p className="v2-card-sub">仅供历史查询，不计入绩效。旧版保存分和原文按原记录展示。</p></div>
      <span className="historical-archive-badge"><LockKeyhole size={13}/>只读 · 不计入绩效</span>
    </header>
    <div className="historical-archive-toolbar">
      <label htmlFor={monthId}><CalendarDays size={15}/><span>归档月份</span><AppSelect id={monthId} aria-label="选择历史补档月份" value={month} onValueChange={value => { setMonth(value); setOffset(0); }}><option value="">全部历史月份</option>{months.map(value => <option key={value} value={value}>{value.replace('-', ' 年 ')} 月</option>)}</AppSelect></label>
      {page && <span className="historical-archive-count">{page.total} 份历史补档</span>}
    </div>
    {errorText ? <p className="historical-archive-empty" role="alert">{errorText}</p> : !page ? <p className="historical-archive-empty" role="status">正在加载历史补档…</p> : page.items.length ? <>
      <div className="historical-archive-records">{page.items.map(item => <ArchiveRecord key={`${context}:${item.id}`} item={item} management={management} employeeId={employeeId}/>)}</div>
      {page.total > PAGE_SIZE && <nav className="historical-archive-pagination" aria-label="历史补档分页"><button type="button" className="secondary-button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}>上一页</button><span>{offset + 1}–{offset + page.items.length} / {page.total} 份</span><button type="button" className="secondary-button" disabled={offset + page.items.length >= page.total} onClick={() => setOffset(value => value + PAGE_SIZE)}>下一页</button></nav>}
    </> : <p className="historical-archive-empty">{month ? '这个月暂无历史补档。' : '暂无已核实的历史补档。'}</p>}
  </section>;
}

function ArchiveRecord({ item, management, employeeId }: { item: ArchivedReportSummary; management: boolean; employeeId?: string }) {
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<ArchivedReport | null>(null);
  const [error, setError] = useState('');
  const query = new URLSearchParams();
  if (employeeId) query.set('employeeId', employeeId);
  if (management) query.set('view', 'management');
  const detailUrl = `/api/historical-reports/${encodeURIComponent(item.id)}${query.size ? `?${query}` : ''}`;

  useEffect(() => {
    if (!open || record) return;
    const controller = new AbortController();
    setError('');
    fetch(detailUrl, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(failureMessage(response.status));
        return response.json() as Promise<{ ok: boolean; record: ArchivedReport }>;
      })
      .then(value => {
        if (!value.ok || value.record?.id !== item.id || !value.record.facts) throw new Error(failureMessage(500));
        if (!controller.signal.aborted) setRecord(value.record);
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : failureMessage(500));
      });
    return () => controller.abort();
  }, [open, detailUrl, item.id]);

  return <details className="historical-archive-record" data-archive-record={item.id} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><div className="historical-archive-record-heading"><strong>{management && `${item.employeeName} · `}{item.weekLabel || `${item.weekStart} — ${item.weekEnd}`}</strong><span>{item.weekStart} — {item.weekEnd}{management && item.department ? ` · ${item.department}` : ''}</span></div><div className="historical-archive-record-meta"><span>{item.status || '原保存状态待核实'}</span><span>旧版保存分 {typeof item.oldScore === 'number' && Number.isFinite(item.oldScore) ? `${item.oldScore} 分` : '未保存'}</span><ChevronDown size={17} aria-hidden="true"/></div></summary>
    <div className="historical-archive-record-body"><p className="historical-archive-submitted">提交时间 · {submittedTime(item.submittedAt)}</p>
      {error ? <p className="historical-archive-empty" role="alert">{error}</p> : !record ? <p className="historical-archive-empty" role="status">正在读取原保存内容…</p> : <>
        <div className="historical-archive-facts">{modules.map(([key, label]) => <section key={key} data-archive-module={key}><h4>{label}<span>旧版原保存</span></h4><p>{record.facts[key] || '旧版未保存此模块内容。'}</p></section>)}</div>
        {record.recoveredReflection?.text && <section className="historical-archive-recovered" data-archive-recovered><h4>另存找回的思考与复盘</h4><p className="historical-archive-source">来源：旧版独立保存的原始汇报归档。单独保留找回内容及其来源。</p><p>{record.recoveredReflection.text}</p></section>}
      </>}
    </div>
  </details>;
}
