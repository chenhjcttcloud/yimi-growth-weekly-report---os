import { useEffect, useId, useState } from 'react';
import { Archive, ChevronDown, Search, ShieldCheck } from 'lucide-react';
import { AppSelect } from './AppSelect';
import '../styles/legacy-report-snapshot.css';

type OwnerKind = 'unknown' | 'existing' | 'verified' | 'unreviewed';
interface SnapshotOwner { id: string; kind: OwnerKind; label: string; virtual: true }
interface OwnerGroup { key: 'all' | OwnerKind; label: string; count: number }

interface SnapshotSummary {
  id: string;
  sourceRow: number;
  employeeName: string;
  department: string;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  submittedAt: string;
  status: string;
  oldScore: number | null;
  warnings: string[];
  owner?: SnapshotOwner;
}

interface SnapshotRecord extends SnapshotSummary {
  facts: { results?: string; problems?: string; nextPlan?: string; reflection?: string };
  legacyScores: { results?: number | null; problems?: number | null; nextPlan?: number | null; reflection?: number | null; total?: number | null; onTime?: number | null; grade?: string };
  savedFields: { label: string; value: string }[];
  readOnly: true;
  affectsPerformance: false;
}

interface SnapshotPage {
  ok: true;
  items: SnapshotSummary[];
  names: string[];
  total: number;
  snapshotTotal: number;
  ownershipReady?: boolean;
  ownerTotal?: number;
  ownerGroups?: OwnerGroup[];
  limit: number;
  offset: number;
  readOnly: true;
  affectsPerformance: false;
}

const pageSize = 20;
const modules = [['results', '本周成果'], ['problems', '问题与挑战'], ['nextPlan', '下周计划与目标'], ['reflection', '思考与复盘']] as const;
const savedScore = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${value} 分` : '未保存';
const requestError = (status: number) => status === 401 ? '登录状态已失效，请刷新页面后重试。' : status === 403 ? '当前视角没有查看旧版原始档案的权限，请切换到管理视角。' : '旧版原始档案暂时无法加载，请稍后重新查询。';

export function LegacyReportSnapshot() {
  const filterId = useId();
  const [draftName, setDraftName] = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [filter, setFilter] = useState({ employeeName: '', search: '' });
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'unknown'>('all');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; page: SnapshotPage } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const requestKey = JSON.stringify([ownerFilter, filter, offset, revision]);
  const page = result?.key === requestKey ? result.page : null;
  const errorText = error?.key === requestKey ? error.message : '';
  const names = Array.from(new Set(result?.page.names || []));
  const ownershipReady = result?.page.ownershipReady === true;
  const groups = result?.page.ownerGroups || [];
  const allTotal = groups.find(group => group.key === 'all')?.count ?? result?.page.snapshotTotal;
  const unknownTotal = ownershipReady ? groups.find(group => group.key === 'unknown')?.count : undefined;
  const unknownAvailable = ownershipReady && typeof unknownTotal === 'number' && Number.isFinite(unknownTotal);
  const changeOwner = (value: 'all' | 'unknown') => {
    setOwnerFilter(value); setDraftName(''); setDraftSearch('');
    setFilter({ employeeName: '', search: '' }); setOffset(0); setRevision(current => current + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (ownerFilter === 'unknown') query.set('owner', 'unknown');
    if (filter.employeeName) query.set('employeeName', filter.employeeName);
    if (filter.search) query.set('search', filter.search);
    fetch(`/api/legacy-report-snapshot?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw Error(requestError(response.status));
        return response.json() as Promise<SnapshotPage>;
      })
      .then(value => {
        if (value.ok !== true || !Array.isArray(value.items) || !Array.isArray(value.names) || !Number.isFinite(value.total) || !Number.isFinite(value.snapshotTotal) || value.readOnly !== true || value.affectsPerformance !== false) throw Error(requestError(500));
        if (!controller.signal.aborted) setResult({ key: requestKey, page: value });
      })
      .catch(failure => { if (!controller.signal.aborted) { setResult(null); setError({ key: requestKey, message: failure instanceof Error ? failure.message : requestError(500) }); } });
    return () => controller.abort();
  }, [requestKey, ownerFilter, filter, offset]);

  return <section className="v2-card legacy-report-snapshot" aria-label="旧版原始档案" data-legacy-report-snapshot>
    <header className="legacy-snapshot-heading"><div><span className="v2-eyebrow"><Archive size={14}/>旧版原始档案</span><h3 className="v2-card-title">旧版的每一条记录，都按原样保留</h3><p className="v2-card-sub">查询旧版全量原始记录，姓名、日期和原分按旧版保留。部分记录的身份或年份仍待核验。仅供查询，不计入绩效。</p></div><span className="legacy-snapshot-badge"><ShieldCheck size={13}/>管理查询 · 不计入绩效</span></header>
    <div className="legacy-snapshot-owner-groups" role="group" aria-label="档案归属分组"><button type="button" className={ownerFilter === 'all' ? 'is-active' : ''} aria-pressed={ownerFilter === 'all'} onClick={() => changeOwner('all')}>所有原始档案 <strong>{allTotal ?? '—'}</strong></button><button type="button" className={ownerFilter === 'unknown' ? 'is-active' : ''} aria-pressed={ownerFilter === 'unknown'} disabled={!unknownAvailable} onClick={() => changeOwner('unknown')}>未知人员／归属待确认 <strong>{unknownAvailable ? unknownTotal : '待核验'}</strong></button></div>
    {result && !unknownAvailable && <p className="legacy-snapshot-owner-note" role="status">档案归属尚未核验，未知人员分组暂不可用。</p>}
    {ownerFilter === 'unknown' && <p className="legacy-snapshot-owner-note">“未知人员／归属待确认”是虚拟档案分组，原保存姓名与内容仍保留，归属待进一步核验。</p>}
    <form className="legacy-snapshot-filters" onSubmit={event => { event.preventDefault(); setFilter({ employeeName: draftName, search: draftSearch.trim() }); setOffset(0); setRevision(value => value + 1); }}>
      <label><span>旧版保存姓名</span><AppSelect aria-label="选择旧版保存姓名" value={draftName} onValueChange={setDraftName} searchable><option value="">全部旧版姓名</option>{names.map(name => <option value={name} key={name}>{name}</option>)}</AppSelect></label>
      <label htmlFor={filterId}><span>关键词</span><input id={filterId} type="search" value={draftSearch} maxLength={200} onChange={event => setDraftSearch(event.target.value)} placeholder="查找旧版原文或周次"/></label>
      <button type="submit" className="secondary-button"><Search size={14}/>查询档案</button>
    </form>
    {page && <p className="legacy-snapshot-count">原始档案 <strong>{page.snapshotTotal}</strong> 条<span>当前分组 {ownerFilter === 'unknown' && page.ownershipReady !== true ? '待核验' : page.ownerTotal ?? (ownerFilter === 'all' ? page.snapshotTotal : '待核验')} 条</span><span>当前匹配 {page.total} 条</span><small>姓名筛选沿用旧版原值。</small></p>}
    {errorText ? <p className="legacy-snapshot-empty" role="alert">{errorText}</p> : !page ? <p className="legacy-snapshot-empty" role="status">正在读取旧版原始档案…</p> : ownerFilter === 'unknown' && page.ownershipReady !== true ? <p className="legacy-snapshot-empty">档案归属尚未核验，请先查看所有原始档案。</p> : page.items.length ? <>
      <div className="legacy-snapshot-records">{page.items.map(item => <SnapshotItem key={`${ownerFilter}:${item.id}`} item={item}/>)}</div>
      {page.total > pageSize && <nav className="legacy-snapshot-pagination" aria-label="旧版原始档案分页"><button type="button" className="secondary-button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - pageSize))}>上一页</button><span>{offset + 1}–{offset + page.items.length} / {page.total} 条</span><button type="button" className="secondary-button" disabled={offset + page.items.length >= page.total} onClick={() => setOffset(value => value + pageSize)}>下一页</button></nav>}
    </> : <p className="legacy-snapshot-empty">{page.snapshotTotal === 0 ? '旧版原始档案尚未导入。全量快照导入后，可在这里查询原保存记录。' : '没有匹配的原始记录，请调整姓名或关键词后查询。'}</p>}
  </section>;
}

function SnapshotItem({ item }: { item: SnapshotSummary }) {
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<SnapshotRecord | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || record) return;
    const controller = new AbortController();
    setError('');
    fetch(`/api/legacy-report-snapshot/${encodeURIComponent(item.id)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw Error(requestError(response.status));
        return response.json() as Promise<{ ok: boolean; record: SnapshotRecord }>;
      })
      .then(value => {
        if (!value.ok || value.record?.id !== item.id || !value.record.facts || !Array.isArray(value.record.savedFields) || value.record.readOnly !== true || value.record.affectsPerformance !== false) throw Error(requestError(500));
        if (!controller.signal.aborted) setRecord(value.record);
      })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : requestError(500)); });
    return () => controller.abort();
  }, [open, item.id]);

  return <details className="legacy-snapshot-record" data-snapshot-record={item.id} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><div className="legacy-snapshot-record-heading"><strong>{item.owner?.kind === 'unknown' && <span className="legacy-snapshot-original-name">旧版姓名：</span>}{item.employeeName || '旧版未保存姓名'}{item.department && <span> · {item.department}</span>}</strong><span>{item.weekLabel || '旧版未保存周次'}</span></div><div className="legacy-snapshot-record-status"><span>{item.owner?.label || (item.warnings.length ? '待核验' : '原始记录')}</span><span>旧版保存分 {savedScore(item.oldScore)}</span><ChevronDown size={17} aria-hidden="true"/></div></summary>
    <div className="legacy-snapshot-record-body"><p className="legacy-snapshot-metadata">原记录序号 {item.sourceRow} · 原保存状态 {item.status || '未保存'} · 原提交时间 {item.submittedAt || '未保存'}</p>{(item.weekStart || item.weekEnd) && <p className="legacy-snapshot-metadata">原保存日期 {item.weekStart || '未保存'} — {item.weekEnd || '未保存'}</p>}
      {item.warnings.length > 0 && <ul className="legacy-snapshot-warnings" aria-label="原始记录待核验事项">{item.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      {error ? <p className="legacy-snapshot-empty" role="alert">{error}</p> : !record ? <p className="legacy-snapshot-empty" role="status">正在读取原保存内容…</p> : <>
        <div className="legacy-snapshot-facts">{modules.map(([key, title]) => <section key={key} data-snapshot-module={key}><h4>{title}<span>原保存分 {savedScore(record.legacyScores?.[key])}</span></h4><p>{record.facts[key] || '旧版未保存此字段内容。'}</p></section>)}</div>
        <details className="legacy-snapshot-original-fields"><summary>查看原始字段（{record.savedFields.length} 项）</summary><dl>{record.savedFields.map((field, index) => <div key={index}><dt>{field.label}</dt><dd>{field.value || '（原保存为空）'}</dd></div>)}</dl></details>
      </>}
    </div>
  </details>;
}
