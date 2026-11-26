import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(repo, 'outputs', 'tests', `historical-archive-ui-${Date.now()}`);
const staticDirectory = path.join(directory, 'static');
await mkdir(directory, { recursive: true });
const relative = file => './' + path.relative(directory, path.join(repo, file)).split(path.sep).join('/');
await writeFile(path.join(directory, 'entry.jsx'), `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HistoricalReportArchive} from ${JSON.stringify(relative('src/components/HistoricalReportArchive.tsx'))};
import ${JSON.stringify(relative('src/styles/select.css'))};
function App(){const [owner,setOwner]=useState('fixture-a');return <main style={{maxWidth:1000,margin:'24px auto',padding:'0 12px',fontFamily:'sans-serif'}}>
<nav aria-label="合成测试控制" style={{display:'flex',flexWrap:'wrap',gap:4}}><button onClick={()=>setOwner('fixture-a')}>甲员工预览</button><button onClick={()=>setOwner('fixture-b')}>乙员工预览</button><button onClick={()=>setOwner('admin-personal')}>管理员个人模式</button><button onClick={()=>setOwner('management')}>管理归档</button><button onClick={()=>setOwner('denied')}>拒绝访问预览</button></nav>
<HistoricalReportArchive management={owner==='management'} previewEmployeeId={['management','admin-personal'].includes(owner)?undefined:owner} employeeContextId={owner==='admin-personal'?'fixture-admin':owner}/></main>}
createRoot(document.getElementById('root')).render(<App/>);`);
await writeFile(path.join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成历史补档测试</title></head><body><div id="root"></div><script type="module" src="./entry.jsx"></script></body></html>');
await build({ configFile: false, root: directory, plugins: [react()], logLevel: 'error', build: { outDir: staticDirectory, emptyOutDir: false, target: 'esnext' } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const filename = pathname === '/' ? path.join(staticDirectory, 'index.html') : path.resolve(staticDirectory, '.' + decodeURIComponent(pathname));
  if (!filename.startsWith(staticDirectory + path.sep)) { response.writeHead(403); response.end(); return; }
  try { response.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' }); response.end(await readFile(filename)); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const requests = [], external = [], errors = [];
const summary = id => ({ id, employeeName: id.includes('b') ? '合成乙员工' : '合成甲员工', department: '合成部门', weekLabel: '合成六月第二周', weekStart: '2026-06-08', weekEnd: '2026-06-12', submittedAt: '2026-06-12T08:00:00Z', status: '原保存准时', oldScore: 0 });
const detail = id => ({ ...summary(id), facts: { results: '【合成原成果】<script>globalThis.archiveInjected=true</script>', problems: '【合成原问题】', nextPlan: '【合成原计划】', reflection: '' }, recoveredReflection: { text: id === 'slow-a' ? '【甲员工延迟返回的私密复盘】' : '【合成另存找回复盘】', source: '/private/export/never-show-this-path.json', reason: '内部追溯标识不得出现在界面' } });
let releaseSlow, slowStarted;
const slowGate = new Promise(resolve => { releaseSlow = resolve; });
const startedGate = new Promise(resolve => { slowStarted = resolve; });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { external.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ path: url.pathname, method: request.method(), query: Object.fromEntries(url.searchParams) });
    assert.equal(request.method(), 'GET', 'archive viewing never makes a write request');
    const owner = url.searchParams.get('employeeId');
    if (owner === 'denied') return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    if (url.pathname === '/api/historical-reports') {
      const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
      assert.equal(limit, 20);
      const ids = owner === 'fixture-a' ? ['archive-a', 'slow-a'] : owner === 'fixture-b' ? ['archive-b'] : owner === 'fixture-admin' ? ['admin-personal-report'] : url.searchParams.get('view') === 'management' ? (url.searchParams.has('month') ? ['management-june'] : Array.from({ length: 21 }, (_, index) => `management-${index}`)) : ['default-self-report'];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: ids.slice(offset, offset + limit).map(summary), total: ids.length, months: ['2026-06', '2026-05'], limit, offset, readOnly: true, affectsPerformance: false }) });
    }
    const id = decodeURIComponent(url.pathname.slice('/api/historical-reports/'.length));
    if (id === 'slow-a') { slowStarted(); await slowGate; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, record: detail(id) }) }).catch(() => {});
  });
  await page.goto(base);
  const archive = page.locator('[data-historical-archive]');
  await archive.locator('[data-archive-record="archive-a"]').waitFor();
  assert.equal(requests.at(-1).query.view, undefined, 'personal list never requests company-wide management access');
  assert.equal(requests.filter(row => row.path !== '/api/historical-reports').length, 0, 'record bodies are loaded only after expansion');
  assert(await archive.getByText('只读 · 不计入绩效', { exact: true }).isVisible());
  await archive.locator('[data-archive-record="archive-a"]>summary').click();
  const first = archive.locator('[data-archive-record="archive-a"]');
  await first.locator('[data-archive-module="results"] p').waitFor();
  assert.equal(await first.locator('[data-archive-module]').count(), 4);
  assert.equal(await first.locator('[data-archive-module="reflection"] p').innerText(), '旧版未保存此模块内容。');
  assert.equal(await first.locator('[data-archive-recovered]>p:last-child').innerText(), '【合成另存找回复盘】');
  assert(await first.getByText('旧版保存分 0 分', { exact: true }).isVisible(), 'saved zero is preserved');
  assert.equal(await archive.locator('script,img,form,textarea').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(globalThis.archiveInjected)), false);
  assert(!(await archive.innerText()).includes('/private/export/'));
  assert(!(await archive.innerText()).includes('内部追溯标识'));
  assert.equal(requests.at(-1).query.employeeId, 'fixture-a', 'employee preview is also scoped on detail requests');
  assert.equal(requests.at(-1).query.view, undefined);
  await page.screenshot({ path: path.join(directory, 'desktop.png'), fullPage: true });

  await archive.locator('[data-archive-record="slow-a"]>summary').click();
  await startedGate;
  await page.getByRole('button', { name: '乙员工预览', exact: true }).click();
  await archive.locator('[data-archive-record="archive-b"]').waitFor();
  releaseSlow();
  await page.waitForTimeout(100);
  assert.equal(await archive.locator('[data-archive-record="archive-a"],[data-archive-record="slow-a"]').count(), 0);
  assert(!(await archive.innerText()).includes('甲员工延迟返回的私密复盘'), 'late responses cannot reveal the previously selected employee');
  await archive.locator('[data-archive-record="archive-b"]>summary').click();
  await archive.locator('[data-archive-module="results"] p').waitFor();
  assert.equal(requests.at(-1).query.employeeId, 'fixture-b');

  await page.getByRole('button', { name: '管理员个人模式', exact: true }).click();
  await archive.locator('[data-archive-record="admin-personal-report"]').waitFor();
  assert.equal(requests.at(-1).query.employeeId, 'fixture-admin', 'admin personal mode sends its employee identity even without a preview ID');
  assert.equal(requests.at(-1).query.view, undefined, 'admin personal mode does not request management access');
  await archive.locator('[data-archive-record="admin-personal-report"]>summary').click();
  await archive.locator('[data-archive-module="results"] p').waitFor();
  assert.equal(requests.at(-1).query.employeeId, 'fixture-admin', 'admin personal detail retains the same employee filter');
  assert.equal(requests.at(-1).query.view, undefined);

  await page.getByRole('button', { name: '管理归档', exact: true }).click();
  await archive.locator('[data-archive-record="management-0"]').waitFor();
  assert.equal(requests.at(-1).query.view, 'management', 'company-wide archive list requires an explicit management view');
  await archive.getByRole('button', { name: '下一页', exact: true }).click();
  await archive.locator('[data-archive-record="management-20"]').waitFor();
  assert.equal(requests.at(-1).query.offset, '20');
  assert.equal(requests.at(-1).query.employeeId, undefined);
  assert.equal(requests.at(-1).query.view, 'management');
  await archive.getByRole('combobox', { name: '选择历史补档月份' }).click();
  await page.getByRole('option', { name: '2026 年 06 月', exact: true }).click();
  await archive.locator('[data-archive-record="management-june"]').waitFor();
  assert.equal(requests.at(-1).query.offset, '0', 'changing archive month resets its own page');
  assert.equal(requests.at(-1).query.month, '2026-06');
  await archive.locator('[data-archive-record="management-june"]>summary').click();
  await archive.locator('[data-archive-module="results"] p').waitFor();
  assert.equal(requests.at(-1).query.employeeId, undefined);
  assert.equal(requests.at(-1).query.view, 'management', 'company-wide detail retains explicit management access');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(directory, 'mobile.png'), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'archive content fits a mobile viewport');
  await page.getByRole('button', { name: '拒绝访问预览', exact: true }).click();
  await archive.getByRole('alert').waitFor();
  assert.equal(await archive.locator('[data-archive-record]').count(), 0, 'denied scope cannot retain a previous scope record');
  assert.equal(await archive.getByRole('alert').innerText(), '没有查看这些历史补档的权限。');
  assert(requests.every(row => row.method === 'GET'));
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: true, requests, external, errors }, null, 2));
  console.log(`Historical archive UI passed: lazy detail, four preserved modules, recovered provenance separation, zero-score preservation, escaping, preview isolation, admin personal filtering, explicit management access, independent pagination and month, permission failure, mobile layout, GET only. Evidence: ${directory}`);
} finally {
  releaseSlow();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
