import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { CalendarDays, ShieldCheck } from 'lucide-react';
import { AppSelect } from '../components/AppSelect';
import { ManagedQualityReport } from '../components/ManagedQualityReport';
import { MonthlyQualityResultRow, monthlyQualityView, qualityReviewNotice, type MonthlyQualitySummary } from '../components/MonthlyQuality';
import { DeferredEvidence } from '../components/DeferredEvidence';
import { monthText, ResultEmpty } from '../components/PerformanceUI';
import { locationValue, rememberLocation, useLocationSection } from '../lib/navigation';
import type { VisibleEmployee } from '../lib/types';

const validMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
const currentMonth = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()).slice(0, 7);
const initialMonth = () => {
  const month = locationValue('qualityReviewMonth');
  return validMonth(month) ? month : currentMonth();
};

interface QualityScope {
  month: string;
  months: string[];
  employees: VisibleEmployee[];
}

interface SupervisorDetails {
  month: string;
  userId: string;
  revision: number;
  quality: MonthlyQualitySummary;
  reports: ComponentProps<typeof ManagedQualityReport>['report'][];
  results: { confirmed_at?: string; scoring_rule?: string; kind: string }[];
}

export function SupervisorQualityPage({ personal }: { personal: ReactNode }) {
  const [view, setView] = useLocationSection('qualityView', ['personal', 'team'] as const, 'personal');
  return <>
    <nav className="scoring-workbench-tabs" role="tablist" aria-label="周报质量视图">
      <button type="button" role="tab" aria-selected={view==='personal'} onClick={()=>setView('personal')}>我的周报质量</button>
      <button type="button" role="tab" aria-selected={view==='team'} onClick={()=>setView('team')}>团队质量审核</button>
    </nav>
    {view==='team' ? <TeamQuality/> : personal}
  </>;
}

function TeamQuality() {
  const [month, setMonth] = useState(initialMonth);
  const [selectedId, setSelectedId] = useState(() => locationValue('qualityReviewEmployeeId'));
  const [scope, setScope] = useState<QualityScope | null>(null);
  const [details, setDetails] = useState<SupervisorDetails | null>(null);
  const [scopeError, setScopeError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [revision, setRevision] = useState(0);
  const employees = scope?.month===month ? scope.employees : [];
  const employee = employees.find(item=>item.userId===selectedId) || employees[0];
  const employeeId = employee?.userId;
  const current = details?.userId===employeeId && details?.month===month && details?.revision===revision ? details : null;

  useEffect(()=>{
    rememberLocation('qualityReviewMonth', month);
    rememberLocation('qualityReviewEmployeeId', employeeId || selectedId);
  },[month, employeeId, selectedId]);

  useEffect(()=>{
    const controller = new AbortController();
    setScopeError('');
    void fetch('/api/performance/quality-scope?'+new URLSearchParams({month}), {signal:controller.signal}).then(async response=>{
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.employees) || !Array.isArray(data.months)) throw Error('读取审核范围失败，请重试。');
      if (!controller.signal.aborted) setScope({month,months:data.months,employees:data.employees});
    }).catch(()=>{ if (!controller.signal.aborted) setScopeError('读取审核范围失败，请重试。'); });
    return ()=>controller.abort();
  },[month,revision]);

  useEffect(()=>{
    if (!employeeId) return;
    const controller = new AbortController();
    setDetailError('');
    void fetch('/api/performance/employee-month?'+new URLSearchParams({month,employeeId}), {signal:controller.signal}).then(async response=>{
      const data = await response.json();
      if (!response.ok || data.monthly?.userId!==employeeId || data.monthly?.month!==month || !Array.isArray(data.monthly.reports)) throw Error(response.status===403?'没有查看该员工质量评分的权限。':'读取该员工月度评分失败，请重试。');
      if (!controller.signal.aborted) setDetails({month,userId:employeeId,revision,quality:data.monthly.quality,reports:data.monthly.reports,results:data.results || []});
    }).catch(failure=>{ if (!controller.signal.aborted) setDetailError(failure.message); });
    return ()=>controller.abort();
  },[employeeId,month,revision]);

  const reload = () => setRevision(value=>value+1);
  const months = [...new Set([month, ...(scope?.months || [])])].filter(validMonth).sort().reverse();
  const finalRecord = current?.results.find(result=>result.kind==='quality' && result.confirmed_at);
  const resultEvidenceUrl = finalRecord && employeeId ? '/api/performance/result-evidence?'+new URLSearchParams({month,employeeId,kind:'quality',confirmedAt:finalRecord.confirmed_at || '',rule:finalRecord.scoring_rule || ''}) : undefined;
  return <div className="v2-page v2-page-wide pf-page">
    <section className="pf-intro"><div><span className="v2-eyebrow"><ShieldCheck size={14}/>直属员工</span><h2>团队质量审核</h2><p>复核逐周证据，确认员工月度周报质量分。</p></div><label className="pf-month pf-month-select"><CalendarDays size={16}/><AppSelect aria-label="选择审核月份" value={month} onValueChange={setMonth}>{months.map(value=><option value={value} key={value}>{monthText(value)}</option>)}</AppSelect></label></section>
    <p className="pf-notice">{qualityReviewNotice}</p>
    <section className="v2-card pf-workspace">
      {scopeError ? <><p className="pf-error" role="alert">{scopeError}</p><button type="button" className="secondary-button" onClick={reload}>重试读取范围</button></> : scope?.month!==month ? <p role="status">正在读取审核范围…</p> : !employee ? <ResultEmpty title="本月暂无可审核员工" description="审核范围由直属汇报关系决定。"/> : <>
        <div className="v2-card-head"><h3 className="v2-card-title">月度周报质量</h3><AppSelect aria-label="选择审核员工" value={employeeId} onValueChange={setSelectedId}>{employees.map(item=><option key={item.userId} value={item.userId}>{item.name} · {item.department}</option>)}</AppSelect></div>
        {current ? <><div className="pf-confirm-list"><MonthlyQualityResultRow key={employeeId+':'+month} quality={current.quality} target={{userId:employee.userId,month,onUpdated:reload}}/></div>
          {resultEvidenceUrl && <DeferredEvidence label="查看月度最终分计算依据" url={resultEvidenceUrl}/>}
          {current.reports.length>0 ? <div className="pf-evidence-list">{current.reports.map(report=><ManagedQualityReport key={report.id+':'+(report.qualityReviewVersion||'')} report={report} month={month} userId={employee.userId} editable={!monthlyQualityView(current.quality).confirmed} onUpdated={reload}/>)}</div> : <ResultEmpty title="本月暂无周报" description="已同步的周报和逐周评分依据会显示在这里。"/>}
        </> : detailError ? <><p className="pf-error" role="alert">{detailError}</p><button type="button" className="secondary-button" onClick={reload}>重试读取评分</button></> : <p role="status">正在读取 {employee.name} 的评分…</p>}
      </>}
    </section>
  </div>;
}
