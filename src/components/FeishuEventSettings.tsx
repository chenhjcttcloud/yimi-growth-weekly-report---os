import { ClipboardList, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import '../styles/feishu-events.css';

type Status = {
  events: { enabled: boolean; tokenConfigured: boolean; signatureConfigured: boolean };
  features: { taskCreateEnabled: boolean };
};

export function FeishuEventSettings() {
  const [data, setData] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [tasks, setTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/system-settings');
    if (!response.ok) throw Error('配置读取失败');
    const settings = await response.json() as Status;
    setData(settings);
    setEnabled(settings.events.enabled);
    setTasks(settings.features.taskCreateEnabled);
  }

  useEffect(() => {
    void load().catch(error => setMessage(error.message));
  }, []);

  async function save(kind: 'events' | 'features') {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/system-settings/' + (kind === 'events' ? 'feishu-events' : 'features'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(kind === 'events'
          ? { enabled, verificationToken: token, encryptKey: key }
          : { taskCreateEnabled: tasks }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw Error(result.error === 'event_credentials_required'
          ? '请先填写 Verification Token 或 Encrypt Key'
          : result.error === 'feishu_required'
            ? '请先配置飞书应用凭据'
            : '配置未保存，请检查输入后重试');
      }
      setToken('');
      setKey('');
      await load();
      setMessage('配置已保存。本次操作没有发送消息或创建任务。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  const fieldsDisabled = !data || busy;
  const tokenConfigured = data?.events.tokenConfigured;
  const keyConfigured = data?.events.signatureConfigured;

  return (
    <article className="v2-card feishu-settings-panel" aria-label="飞书回调与任务设置">
      <div className="v2-card-head">
        <div>
          <h3 className="v2-card-title">事件安全与任务创建</h3>
        </div>
      </div>
      {message && <p role="status" className="pf-notice">{message}</p>}
      <div className="feishu-events-sections">
        <section className="feishu-events-section" aria-labelledby="feishu-event-callback-title">
          <div className="feishu-settings-title">
            <span className="feishu-settings-icon"><ShieldCheck size={17} aria-hidden="true" /></span>
            <div>
              <h4 id="feishu-event-callback-title">事件回调安全</h4>
              <p className="feishu-settings-note">至少配置一项凭据才能接收回调，建议同时配置两项。凭据加密保存且不回显，可留空保留已保存的值。</p>
            </div>
          </div>
          <div className="feishu-settings-endpoint">
            <span>事件回调地址</span>
            <code>{window.location.origin}/api/feishu/events</code>
          </div>
          <div className="feishu-settings-fields">
            <label className="feishu-settings-field">
              <span className="feishu-events-field-heading">
                <span>Verification Token</span>
                <span id="feishu-event-token-status" className={tokenConfigured ? 'feishu-events-credential is-configured' : 'feishu-events-credential'}>
                  {tokenConfigured ? '已保存' : data ? '未配置' : '状态待加载'}
                </span>
              </span>
              <input
                type="password"
                aria-label="飞书事件Verification Token"
                aria-describedby="feishu-event-token-status"
                autoComplete="new-password"
                placeholder={tokenConfigured ? '留空保留已保存的 Token' : '输入 Verification Token'}
                value={token}
                onChange={event => setToken(event.target.value)}
                disabled={fieldsDisabled}
              />
            </label>
            <label className="feishu-settings-field">
              <span className="feishu-events-field-heading">
                <span>Encrypt Key</span>
                <span id="feishu-event-key-status" className={keyConfigured ? 'feishu-events-credential is-configured' : 'feishu-events-credential'}>
                  {keyConfigured ? '已保存' : data ? '未配置' : '状态待加载'}
                </span>
              </span>
              <input
                type="password"
                aria-label="飞书事件Encrypt Key"
                aria-describedby="feishu-event-key-status"
                autoComplete="new-password"
                placeholder={keyConfigured ? '留空保留已保存的 Encrypt Key' : '输入 Encrypt Key'}
                value={key}
                onChange={event => setKey(event.target.value)}
                disabled={fieldsDisabled}
              />
            </label>
          </div>
          <div className="feishu-events-controls">
            <label className="feishu-settings-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={event => setEnabled(event.target.checked)}
                disabled={fieldsDisabled}
                aria-labelledby="feishu-event-callback-label"
                aria-describedby="feishu-event-callback-help"
              />
              <span>
                <strong id="feishu-event-callback-label">接收经过校验的飞书事件</strong>
                <small id="feishu-event-callback-help">配置 Encrypt Key 后会校验签名与时间窗口，重复事件只处理一次。</small>
              </span>
            </label>
            <div className="feishu-settings-actions">
              <button type="button" className="secondary-button" disabled={fieldsDisabled} onClick={() => void save('events')}>
                保存回调安全设置
              </button>
            </div>
          </div>
        </section>
        <section className="feishu-events-section" aria-labelledby="feishu-event-tasks-title">
          <div className="feishu-settings-title">
            <span className="feishu-settings-icon"><ClipboardList size={17} aria-hidden="true" /></span>
            <div>
              <h4 id="feishu-event-tasks-title">飞书任务</h4>
              <p className="feishu-settings-note">创建任务需要飞书任务权限，用户须在应用可用范围内。</p>
            </div>
          </div>
          <div className="feishu-events-controls">
            <label className="feishu-settings-toggle">
              <input
                type="checkbox"
                checked={tasks}
                onChange={event => setTasks(event.target.checked)}
                disabled={fieldsDisabled}
                aria-labelledby="feishu-event-tasks-label"
                aria-describedby="feishu-event-tasks-help"
              />
              <span>
                <strong id="feishu-event-tasks-label">允许用户创建真实飞书任务</strong>
                <small id="feishu-event-tasks-help">开启后由用户选择候选任务并点击创建。关闭时显示「未接通」。</small>
              </span>
            </label>
            <div className="feishu-settings-actions">
              <button type="button" className="primary-button" disabled={fieldsDisabled} onClick={() => void save('features')}>
                保存任务创建开关
              </button>
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}
