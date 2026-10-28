import { useEffect, useState } from 'react';
import { PerspectiveSwitcher } from './PerspectiveSwitcher';
interface DevelopmentView { id: string; role: string; label: string; group: string }
export function DevViewSwitcher({ employees = [] }: { employees?: Array<{ userId: string; name: string; department?: string }> }) {
  const [views, setViews] = useState<DevelopmentView[]>([]);
  const [active, setActive] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/dev/views', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(data => {
      if (data?.ok) { setViews(data.views); setActive(data.activeId); }
    }).catch(() => {});
  }, []);
  async function switchView(id: string) {
    if (busy || id === active) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/dev/views', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id}) });
      if (!response.ok) throw Error('切换失败，请重试');
      // Recreate the page to discard the previous role's in-memory process data.
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : '切换失败'); setBusy(false); }
  }
  if (!views.length) return null;
  return <div className="dev-view-control">
    <PerspectiveSwitcher
      value={active}
      title="切换开发视角"
      caption={busy ? "切换中…" : "开发视角"}
      readOnly={false}
      disabled={busy}
      shortcuts={views.filter(view => view.role !== 'employee').map(view => ({ id: view.id, title: view.id === 'boss' ? '老板视角' : '管理员视角', description: view.id === 'boss' ? '查看经营与团队' : '管理组织与系统' }))}
      employees={views.filter(view => view.role === 'employee').map(view => {
        const userId = view.id.slice(9);
        const employee = employees.find(item => item.userId === userId);
        return { userId, name: employee?.name || view.label.replace(/^员工\s*[·・]\s*/, ''), department: employee?.department };
      })}
      onChange={id => void switchView(id)}
    />
    {error && <span className="dev-view-error" role="alert">{error}</span>}
  </div>;
}
