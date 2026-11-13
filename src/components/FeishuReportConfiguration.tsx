import { ArrowUpRight, FileText, LogIn } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { FeishuEventSettings } from './FeishuEventSettings';
import { ReportAutomationSettings } from './ReportAutomationSettings';
import '../styles/feishu-settings.css';

export function FeishuReportConfiguration() {
  const [form, setForm] = useState({
    appId: '',
    appSecret: '',
    templateName: '周报（聚焦结果与协作）',
    ruleId: '',
    startDate: '',
  });
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/system-settings')
      .then(async response => {
        if (!response.ok) throw Error();
        return response.json();
      })
      .then(({ report }) => {
        if (!active) return;
        setForm({ ...report, appSecret: '' });
        setConfigured(report.secretConfigured);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setMessage('配置读取失败，请刷新重试');
      });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/system-settings/feishu-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error === 'report_secret_required') {
          throw Error('首次配置或更换应用时请填写 App Secret');
        }
        if (result.error === 'invalid_report_config') {
          throw Error('请检查 App ID、模板名称和日期格式');
        }
        throw Error('保存失败，请重试');
      }
      setForm(current => ({ ...current, appSecret: '' }));
      setConfigured(true);
      setMessage('配置已加密保存。可开启下方自动收集，或使用「立即同步飞书汇报」。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <article className="panel system-config feishu-settings-panel" aria-labelledby="feishu-report-heading">
      <div className="panel-heading feishu-settings-heading">
        <div className="feishu-settings-title">
          <span className="feishu-settings-icon"><FileText size={18} aria-hidden="true" /></span>
          <div>
            <h2 id="feishu-report-heading">飞书周报配置</h2>
            <p className="feishu-settings-note">成长 OS 从飞书「汇报」读取指定模板下的周报。</p>
          </div>
        </div>
        <span className="pf-subtle-tag">{configured ? '凭证已保存' : loaded ? '待配置' : '尚未读取配置'}</span>
      </div>

      <form onSubmit={save} className="feishu-report-form">
        <div className="feishu-settings-fields">
          <label className="feishu-settings-field">
            App ID
            <input required disabled={!loaded} value={form.appId} placeholder="cli_…" onChange={event => setForm({ ...form, appId: event.target.value })} />
          </label>
          <label className="feishu-settings-field">
            App Secret
            <input
              type="password"
              autoComplete="new-password"
              aria-describedby="feishu-report-secret-note"
              disabled={!loaded}
              value={form.appSecret}
              placeholder={configured ? '留空保留已保存的密钥' : '请输入应用密钥'}
              onChange={event => setForm({ ...form, appSecret: event.target.value })}
            />
          </label>
          <label className="feishu-settings-field">
            周报模板名称
            <input required value={form.templateName} onChange={event => setForm({ ...form, templateName: event.target.value })} />
          </label>
          <label className="feishu-settings-field">
            汇报规则 ID（选填）
            <input value={form.ruleId} placeholder="填写规则 ID 可精确匹配汇报" onChange={event => setForm({ ...form, ruleId: event.target.value })} />
          </label>
          <label className="feishu-settings-field">
            首次同步起始日期（选填）
            <input type="date" value={form.startDate} onChange={event => setForm({ ...form, startDate: event.target.value })} />
          </label>
        </div>

        <div className="feishu-settings-actions feishu-report-save">
          <p id="feishu-report-secret-note" className="feishu-settings-note">应用凭证也用于系统飞书服务。密钥加密存储且不回显。</p>
          <button type="submit" className="primary-button" disabled={busy || !loaded}>
            {busy ? '正在保存…' : '保存飞书汇报配置'}
          </button>
        </div>
        {message && <p role="status" className="pf-notice">{message}</p>}
      </form>

      <section className="feishu-report-login" aria-labelledby="feishu-login-heading">
        <div className="feishu-settings-title">
          <span className="feishu-settings-icon"><LogIn size={17} aria-hidden="true" /></span>
          <div>
            <h3 id="feishu-login-heading">飞书 SSO 登录</h3>
            <p className="feishu-settings-note">在飞书开放平台登记下方回调地址，并把员工加入应用可用范围。</p>
          </div>
        </div>
        <div className="feishu-settings-actions feishu-report-login-actions">
          <div className="feishu-settings-endpoint">
            <span>登录回调地址</span>
            <code>{window.location.origin}/auth/feishu/callback</code>
          </div>
          <a className="secondary-button" href="/auth/login?provider=feishu">
            使用飞书账号登录验证 <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
        <p className="feishu-settings-note">首次登录会同步本人花名册。读取通讯录部门信息需要额外权限。</p>
      </section>
    </article>
    <ReportAutomationSettings />
    <FeishuEventSettings />
  </>;
}
