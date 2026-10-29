import {useEffect, useRef, useState} from 'react';

export function DeferredEvidence({label, url, initialValue}: {label: string; url?: string; initialValue?: unknown}) {
  const [record, setRecord] = useState<{url: string; value: unknown} | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setRecord(null); setLoading(false); setError('');
    return () => { request.current?.abort(); request.current = null; };
  }, [url]);
  const value = initialValue !== undefined ? initialValue : record && record.url === url ? record.value : undefined;
  async function load() {
    if (value !== undefined || request.current) return;
    if (!url) { setError('完整记录暂不可用。'); return; }
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try {
      const response = await fetch(url, {signal: controller.signal});
      const result = await response.json();
      if (!response.ok) throw Error(result.error === 'report_changed' ? 'report_changed' : 'evidence_unavailable');
      if (!controller.signal.aborted) setRecord({url, value: result.detail});
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error && error.message === 'report_changed' ? '记录已更新，请刷新页面后查看。' : '暂时无法读取完整记录，请重试。');
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }
  return <details className="pf-disclosure" onToggle={event => { if (event.currentTarget.open) void load(); }}>
    <summary>{label}</summary>
    {loading && <p role="status">正在读取完整记录…</p>}
    {error && <p role="alert">{error} <button type="button" className="secondary-button" onClick={() => void load()}>重试</button></p>}
    {value !== undefined && <pre>{JSON.stringify(value, null, 2)}</pre>}
  </details>;
}
