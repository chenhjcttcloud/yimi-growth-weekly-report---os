import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {access, chmod, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

// Real App UI, real browser downloads, synthetic read-only API fixtures only.
// Retain every build/download; never start a business server or access real data.
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root, 'outputs/tests'), {recursive: true});
const artifacts = await mkdtemp(path.join(root, 'outputs/tests/performance-export-ui-'));
const staticDir = process.env.TEST_STATIC_DIR ? path.resolve(root, process.env.TEST_STATIC_DIR) : path.join(artifacts, 'dist');
if (!process.env.TEST_STATIC_DIR) {
  const built = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', staticDir, '--emptyOutDir', 'false'], {cwd: root, encoding: 'utf8'});
  assert.equal(built.status, 0, built.stdout + '\n' + built.stderr);
}
await access(path.join(staticDir, 'index.html'));
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'};
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname), file = path.resolve(staticDir, '.' + pathname);
  if (pathname.startsWith('/api/')) { res.writeHead(405); res.end('Synthetic API must be intercepted'); return; }
  if (file !== staticDir && !file.startsWith(staticDir + path.sep)) { res.writeHead(403); res.end(); return; }
  try { const target = pathname === '/' ? path.join(staticDir, 'index.html') : file; const bytes = await readFile(target); res.writeHead(200, {'content-type': mime[path.extname(target)] || 'application/octet-stream'}); res.end(bytes); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port, october = '2026-10', november = '2026-11';
const people = [
  ...Array.from({length: 16}, (_, index) => ({userId: 'employee-' + String(index + 1).padStart(2, '0'), name: '筛选员工' + String(index + 1).padStart(2, '0'), department: '供应链', active: true})),
  {userId: 'multi', name: '筛选跨组员工', department: '供应链 / 研发', active: true},
  ...Array.from({length: 3}, (_, index) => ({userId: 'supply-other-' + index, name: '其他供应链员工' + index, department: '供应链', active: true})),
  ...Array.from({length: 9}, (_, index) => ({userId: 'research-' + index, name: '筛选研发员工' + index, department: '研发', active: true})),
  {userId: 'inactive', name: '筛选离职员工', department: '供应链', active: false},
  {userId: 'unassigned', name: '无部门员工', department: '', active: true},
];
const selectedPeople = people.filter(person => person.active && person.department.includes('供应链') && person.name.includes('筛选'));
assert.equal(selectedPeople.length, 17);
const zeroName = people[0].name, waitingName = people[1].name;
const timeliness = {expected: 4, submitted: 4, onTime: 4, late: 0, missing: 0, pendingTimestamp: 0, pendingCalendar: 0, rate: 100};
function monthly(person, month) {
  const zero = person.userId === people[0].userId && month === october, waiting = person.userId === people[1].userId;
  const score = zero ? 0 : month === october ? 88.2 : 96.4;
  return {...person, month, reports: [], timeliness, collaborationPolicy: {rule: month === november ? 'peers_100' : 'weighted_30_70', weights: {manager: month === november ? 0 : 30, peers: month === november ? 100 : 70}, effectiveMonth: november}, peerCandidate: waiting ? null : score,
    quality: {status: waiting ? 'pending_ai' : 'final', publicationMode: 'automatic', currentAverage: waiting ? 82 : score, candidateScore: waiting ? null : score, finalScore: waiting ? null : score, pendingAnalysis: waiting ? 1 : 0, analyzedCount: waiting ? 3 : 4, expectedCount: 4, canConfirm: false, generatedBy: waiting ? undefined : '系统自动计算', generatedAt: month + '-28T02:00:00Z', confirmedBy: waiting ? undefined : '系统自动计算', confirmedAt: month + '-28T02:00:00Z'},
    managerProgress: month === november ? {kind: 'not_required', required: false, expectedIds: [], expected: 0, submitted: 0, complete: true, score: null, records: []} : {kind: 'boss', expectedIds: [''], expected: 1, submitted: waiting ? 0 : 1, complete: !waiting, score: waiting ? null : score, records: []},
    collaborationExpected: 3, collaborationSubmitted: waiting ? 1 : 3, peerComplete: !waiting, collaborationComplete: !waiting, collaborationCandidate: waiting ? null : score,
  };
}
function overview(month) {
  const rows = people.map(person => monthly(person, month));
  return {scopeMonth: month, months: [november, october], employees: people, monthly: rows, collaborations: [],
    results: rows.filter(row => row.userId !== people[1].userId).flatMap(row => ['quality', 'collaboration'].map(kind => ({month, employee_user_id: row.userId, employee_name: row.name, kind, result: {score: row.quality.finalScore, status: 'final', publicationMode: kind === 'quality' ? 'automatic' : month === november ? 'peers_only' : 'weighted_30_70', pendingAnalysis: 0, peerScore: row.peerCandidate, managerScore: row.managerProgress.score, weights: row.collaborationPolicy.weights}, scoring_rule: kind === 'quality' ? 'automatic_report' : row.collaborationPolicy.rule, evidenceSummary: {}, evidenceDeferred: true, confirmed_by: '合成审核人', confirmed_at: month + '-28T02:00:00Z'}))),
  };
}
const qualityHeaders = ['月份', '姓名', '部门', '月度质量最终分', 'AI质量均分', '质量状态'];
const collaborationHeaders = ['月份', '姓名', '部门', '月度综合最终分', '评分状态', '负责人或老板评分（30%）', '同事互评均分（70%）', '同事已评数', '同事应评数'];
const readWorkbookPython = String.raw`
import json,sys,zipfile,posixpath,xml.etree.ElementTree as E
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None
    shared=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        shared=[''.join(n.itertext()) for n in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns)]
    rels={r.attrib['Id']:r.attrib['Target'] for r in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    output=[]
    for sheet in E.fromstring(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',ns):
        target=rels[sheet.attrib['{'+ns['r']+'}id']]
        target=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
        rows=[]
        for row in E.fromstring(z.read(target)).findall('m:sheetData/m:row',ns):
            values=[];types=[];formulas=[]
            for cell in row.findall('m:c',ns):
                letters=''.join(c for c in cell.attrib.get('r','') if c.isalpha());col=0
                for c in letters:col=col*26+ord(c.upper())-64
                index=col-1
                while len(values)<=index:values.append(None);types.append(None);formulas.append(False)
                kind=cell.attrib.get('t','n');v=cell.find('m:v',ns)
                if kind=='inlineStr':value=''.join(t.text or '' for t in cell.findall('.//m:t',ns))
                elif kind=='s':value=shared[int(v.text)] if v is not None else ''
                elif v is None or v.text is None:value=None
                elif kind=='n':value=float(v.text)
                else:value=v.text
                values[index]=value;types[index]=kind;formulas[index]=cell.find('m:f',ns) is not None
            rows.append({'values':values,'types':types,'formulas':formulas})
        headers=rows[0]['values'] if rows else []
        records=[]
        for row in rows[1:]:
            records.append({'values':{str(h):row['values'][i] if i<len(row['values']) else None for i,h in enumerate(headers)},'types':{str(h):row['types'][i] if i<len(row['types']) else None for i,h in enumerate(headers)},'hasFormula':any(row['formulas'])})
        output.append({'name':sheet.attrib['name'],'headers':headers,'rows':records})
    print(json.dumps({'sheets':output},ensure_ascii=False))
`;
const apiCalls = [], outbound = [], unexpected = [], businessWrites = [], browserErrors = [], downloads = [];
const exportApiCalls = () => apiCalls.filter(row => !row.path.startsWith('/api/usage/') && row.path !== '/api/notifications');
function workbook(file) {
  const response = spawnSync('python3', ['-c', readWorkbookPython, file], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  assert.equal(response.status, 0, response.stderr); return JSON.parse(response.stdout);
}
function verifySheet(book, name, expectedPeople, month) {
  const sheet = book.sheets.find(item => item.name === name); assert(sheet, 'workbook includes ' + name);
  const headers = name === '周报质量' ? qualityHeaders : month === november ? ['月份', '姓名', '部门', '月度综合最终分', '评分状态', '同事互评均分（100%）', '同事已评数', '同事应评数'] : collaborationHeaders;
  if (name !== '周报质量' && month === november) assert(sheet.headers.every(header => !/30%|70%|负责人|老板/.test(header)), 'new month peer-only workbook has no manager/boss columns');
  for (const header of headers) assert(sheet.headers.includes(header), 'exported header: ' + header);
  assert(sheet.headers.every(header => !/确认人|确认时间|发布人|发布时间|生成方式|生成时间|结果来源/.test(header)), 'downloaded score tables omit approval metadata columns');
  assert.deepEqual(sheet.rows.map(row => row.values['姓名']).sort(), expectedPeople.map(person => person.name).sort(), 'export includes every matching employee, once, across all pages');
  assert(sheet.rows.every(row => row.values['月份'] === month && !row.hasFormula));
  const zero = sheet.rows.find(row => row.values['姓名'] === zeroName), waiting = sheet.rows.find(row => row.values['姓名'] === waitingName);
  const finalColumn = name === '周报质量' ? '月度质量最终分' : '月度综合最终分';
  if (zero && month === october) { assert.equal(zero.values[finalColumn], 0); assert.equal(zero.types[finalColumn], 'n', 'valid zero is an Excel number, never waiting/blank'); }
  if (zero && month === november) assert.equal(zero.values[finalColumn], 96.4, 'month switches use the new month\'s actual score');
  if (waiting) {
    assert.equal(waiting.values[finalColumn] ?? null, null, 'waiting final scores stay blank');
    assert.match(String(waiting.values[name === '周报质量' ? '质量状态' : '评分状态']), /待|等待|暂定|尚未/);
    if (name === '周报质量') {assert.equal(waiting.values['AI质量均分'] ?? null, null); assert.equal(waiting.values['已完成分析均分'], 82);}
    else {
      assert.equal(waiting.values['负责人或老板评分（30%）'] ?? null, null);
      assert.equal(waiting.values[month === november ? '同事互评均分（100%）' : '同事互评均分（70%）'] ?? null, null);
      assert.equal(waiting.values['同事已评数'], 1); assert.equal(waiting.values['同事应评数'], 3);
    }
  }
  const multi = sheet.rows.find(row => row.values['姓名'] === '筛选跨组员工');
  if (multi) assert.equal(multi.values['部门'], '供应链 / 研发');
  return sheet;
}
let browser, releaseNovember, holdNovember = false;
try {
  browser = await chromium.launch({channel: 'chrome', headless: true});
  async function newPage(role, {legacyOverview = false} = {}) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1050}, acceptDownloads: true});
    await context.addInitScript(() => {
      const instant = Date.parse('2026-11-27T03:00:00Z'), RealDate = Date;
      globalThis.Date = class extends RealDate {constructor(...args) {super(...(args.length ? args : [instant]));} static now() {return instant;}};
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = value => {if (globalThis.__performanceExportFail) throw Error('synthetic_blob_creation_failed'); return original(value);};
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) {outbound.push(url.origin); return route.abort();}
      if (!url.pathname.startsWith('/api/')) return route.continue();
      apiCalls.push({role, method: request.method(), path: url.pathname, params: Object.fromEntries(url.searchParams)});
      if (request.method() !== 'GET' && !url.pathname.startsWith('/api/usage/')) {businessWrites.push(url.pathname); return route.fulfill({status: 405, json: {error: 'synthetic_read_only'}});}
      const requestedMonth = url.searchParams.get('month') || november, month = requestedMonth === 'latest' ? november : requestedMonth;
      let body;
      switch (url.pathname) {
        case '/api/me': body = {user: {userId: role === 'member' ? people[0].userId : role, name: '合成' + role}, access: {role: role === 'admin' ? 'system_admin' : role, currentEmployee: role === 'member' ? people[0] : {userId: role, name: '合成' + role, department: '合成管理'}, visibleEmployees: role === 'member' ? [people[0]] : people, canManageScoring360: role !== 'member', canManagePersonnel: role !== 'member', canViewSettings: role !== 'member', canViewBossDashboard: role === 'boss'}}; break;
        case '/api/management-data': body = {prototypeData: {meta: {periods: []}, employee_summary: [], weekly_scores: []}}; break;
        case '/api/performance/manage':
          assert.notEqual(role, 'member', 'employee pages must never request manager export data');
          assert.equal(url.searchParams.get('view'), 'overview');
          if (month === november && holdNovember) await new Promise(resolve => {releaseNovember = resolve;});
          body = overview(month);
          if (legacyOverview) {
            delete body.scopeMonth;
            body.monthly = [...overview(october).monthly, ...overview(november).monthly];
            body.results = [...overview(october).results, ...overview(november).results];
          }
          break;
        case '/api/manager-reviews': body = {ok: true, month, canReview: false, hasResponsibilities: false, tasks: []}; break;
        case '/api/personal/workspace': body = {employee: {...people[0], userId: people[0].userId}, month, months: [november, october], weeks: [], selectedWeekId: '', history: [{month, monthlyQuality: monthly(people[0], month).quality, collaboration: 0, timeliness}], collaborationProgress: {expected: 0, submitted: 0, complete: true, canRemind: false}, tasks: []}; break;
        case '/api/notifications': body = {items: [], unreadCount: 0}; break;
        case '/api/dev/views': body = {ok: false}; break;
        case '/api/usage/visit': case '/api/usage/heartbeat': body = {ok: true}; break;
        default: unexpected.push(url.pathname); return route.fulfill({status: 404, json: {error: 'unexpected_synthetic_api'}});
      }
      try {return await route.fulfill({status: 200, json: body});} catch (error) {if (request.failure()) return; throw error;}
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => {if (/Maximum update depth|Too many re-renders|Cannot update a component/.test(message.text())) browserErrors.push(message.text());});
    page.on('download', download => downloads.push({name: download.suggestedFilename(), role}));
    return {page, context};
  }
  const buttonName = scope => scope === 'quality' ? '导出周报质量Excel' : scope === 'collaboration' ? '导出360协同得分Excel' : '导出周报质量和360协同分数Excel';
  const sheetName = scope => scope === 'quality' ? '周报质量' : '360协同得分';
  async function downloadExport(page, scope, filename) {
    const button = page.getByRole('button', {name: buttonName(scope), exact: true});
    await button.waitFor();
    await page.waitForFunction(label => [...document.querySelectorAll('button')].some(item => item.getAttribute('aria-label') === label && !item.disabled), buttonName(scope));
    const before = exportApiCalls().length;
    const incoming = page.waitForEvent('download'); await button.click(); const download = await incoming;
    if (filename) assert.equal(download.suggestedFilename(), filename);
    assert(download.suggestedFilename().includes('2026-') && download.suggestedFilename().endsWith('.xlsx'));
    const file = path.join(artifacts, downloads.length + '-' + download.suggestedFilename());
    await download.saveAs(file); await chmod(file, 0o600); assert.equal(await download.failure(), null);
    assert.equal(exportApiCalls().length, before, 'export must reuse authorized overview without any extra API/AI request');
    await page.getByText(/已开始下载/).waitFor();
    assert.equal(await page.getByText(/导出成功|保存成功|已保存到/).count(), 0);
    return workbook(file);
  }
  async function filterSupply(page) {
    await page.getByRole('group', {name: '按部门筛选', exact: true}).getByRole('button', {name: '供应链', exact: true}).click();
    await page.getByRole('searchbox', {name: '搜索员工或部门', exact: true}).fill('筛选');
    await page.getByText('匹配 17 / 20 人', {exact: true}).waitFor();
    await page.getByRole('button', {name: '下一页员工', exact: true}).click();
    await page.getByText('第 2 / 3 页', {exact: true}).waitFor();
    assert.equal(await page.locator('.pf-person').count(), 8);
  }
  const admin = await newPage('admin');
  await admin.page.goto(base + '/?page=quality-scores&scoreMonth=' + october);
  await admin.page.getByRole('button', {name: buttonName('quality'), exact: true}).waitFor();
  verifySheet(await downloadExport(admin.page, 'quality', '周报质量_2026-10_全部部门.xlsx'), '周报质量', people, october);
  assert.equal(await admin.page.getByRole('button', {name: '确认月度最终分', exact: true}).count(), 0);
  assert.equal(await admin.page.getByText('待管理人员确认', {exact: true}).count(), 0);
  await filterSupply(admin.page);
  verifySheet(await downloadExport(admin.page, 'quality', '周报质量_2026-10_供应链_筛选.xlsx'), '周报质量', selectedPeople, october);
  await admin.page.locator('.content-shell').evaluate(element => {element.scrollTop = 0;});
  await admin.page.screenshot({path: path.join(artifacts, '01-admin-quality-filtered.png'), fullPage: true, animations: 'disabled'});
  await admin.page.setViewportSize({width: 390, height: 844});
  assert(await admin.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await admin.page.locator('.content-shell').evaluate(element => {element.scrollTop = 0;});
  await admin.page.screenshot({path: path.join(artifacts, '02-export-mobile.png'), fullPage: true, animations: 'disabled'});
  await admin.page.setViewportSize({width: 1440, height: 1050});

  // A held November response must not export October's data or filters under a new month.
  const picker = admin.page.getByRole('combobox', {name: '选择绩效月份', exact: true});
  holdNovember = true;
  await picker.click(); await admin.page.getByRole('option', {name: '2026 年 11 月', exact: true}).click();
  await admin.page.getByText('正在整理月度数据', {exact: true}).waitFor();
  assert(await admin.page.getByRole('button', {name: buttonName('quality'), exact: true}).isDisabled());
  const beforeLoadingDownloads = downloads.length;
  await picker.click(); await admin.page.getByRole('option', {name: '2026 年 10 月', exact: true}).click();
  await admin.page.getByRole('searchbox', {name: '搜索员工或部门', exact: true}).waitFor();
  holdNovember = false; releaseNovember?.(); releaseNovember = undefined;
  assert.equal(downloads.length, beforeLoadingDownloads);
  assert.equal(await admin.page.getByRole('searchbox', {name: '搜索员工或部门', exact: true}).inputValue(), '');
  verifySheet(await downloadExport(admin.page, 'quality', '周报质量_2026-10_全部部门.xlsx'), '周报质量', people, october);
  await picker.click(); await admin.page.getByRole('option', {name: '2026 年 11 月', exact: true}).click();
  await admin.page.getByRole('searchbox', {name: '搜索员工或部门', exact: true}).waitFor();
  verifySheet(await downloadExport(admin.page, 'quality', '周报质量_2026-11_全部部门.xlsx'), '周报质量', people, november);

  const beforeFailure = downloads.length, beforeFailureRequests = exportApiCalls().length;
  await admin.page.evaluate(() => {globalThis.__performanceExportFail = true;});
  await admin.page.getByRole('button', {name: buttonName('quality'), exact: true}).click();
  await admin.page.getByRole('alert').filter({hasText: /导出失败/}).waitFor();
  assert.equal(downloads.length, beforeFailure); assert.equal(exportApiCalls().length, beforeFailureRequests);
  assert.equal(await admin.page.getByText(/导出成功|保存成功|已保存到/).count(), 0);
  await admin.page.evaluate(() => {globalThis.__performanceExportFail = false;});
  assert(await admin.page.getByRole('button', {name: buttonName('quality'), exact: true}).isEnabled());
  const canceledEvent = admin.page.waitForEvent('download');
  await admin.page.getByRole('button', {name: buttonName('quality'), exact: true}).click();
  const canceled = await canceledEvent; await canceled.cancel();
  assert.equal(await admin.page.getByText(/导出成功|保存成功|已保存到/).count(), 0, 'canceling a download never claims the file was saved');
  await admin.context.close();

  const boss = await newPage('boss');
  await boss.page.goto(base + '/?page=collaboration-scores&scoreMonth=' + october);
  await boss.page.getByRole('searchbox', {name: '搜索员工或部门', exact: true}).waitFor();
  await filterSupply(boss.page);
  verifySheet(await downloadExport(boss.page, 'collaboration', '360协同得分_2026-10_供应链_筛选.xlsx'), '360协同得分', selectedPeople, october);
  await boss.page.locator('.content-shell').evaluate(element => {element.scrollTop = 0;});
  await boss.page.screenshot({path: path.join(artifacts, '03-boss-collaboration-filtered.png'), fullPage: true, animations: 'disabled'});
  const bossPicker = boss.page.getByRole('combobox', {name: '选择绩效月份', exact: true});
  holdNovember = true;
  await bossPicker.click(); await boss.page.getByRole('option', {name: '2026 年 11 月', exact: true}).click();
  await boss.page.getByText('正在整理月度数据', {exact: true}).waitFor();
  assert(await boss.page.getByRole('button', {name: buttonName('collaboration'), exact: true}).isDisabled());
  holdNovember = false; releaseNovember?.(); releaseNovember = undefined;
  await boss.page.getByRole('searchbox', {name: '搜索员工或部门', exact: true}).waitFor();
  verifySheet(await downloadExport(boss.page, 'collaboration', '360协同得分_2026-11_全部部门.xlsx'), '360协同得分', people, november);
  await boss.page.goto(base + '/?page=scores&scoreTab=results&scoreMonth=' + october);
  const combined = await downloadExport(boss.page, 'all');
  assert.equal(combined.sheets.length, 2);
  verifySheet(combined, '周报质量', people, october); verifySheet(combined, '360协同得分', people, october);
  await boss.context.close();

  // Legacy multi-month responses reuse one mounted Directory across months:
  // its first render must clear old filters and notify with the new source.
  const legacy = await newPage('admin', {legacyOverview: true});
  await legacy.page.goto(base + '/?page=collaboration-scores&scoreMonth=' + october);
  await legacy.page.getByRole('searchbox', {name: '搜索员工或部门', exact: true}).waitFor();
  await filterSupply(legacy.page);
  await legacy.page.getByRole('combobox', {name: '选择绩效月份', exact: true}).click();
  await legacy.page.getByRole('option', {name: '2026 年 11 月', exact: true}).click();
  await legacy.page.waitForFunction(() => document.querySelector('input[aria-label="搜索员工或部门"]')?.value === '');
  assert.equal(await legacy.page.getByRole('button', {name: '清除员工搜索', exact: true}).count(), 0);
  verifySheet(await downloadExport(legacy.page, 'collaboration', '360协同得分_2026-11_全部部门.xlsx'), '360协同得分', people, november);
  await legacy.context.close();

  const member = await newPage('member');
  for (const scope of ['quality', 'collaboration']) {
    await member.page.goto(base + '/?' + new URLSearchParams({page: scope + '-scores', personalUser: people[0].userId, personalMonth: october}));
    await member.page.locator('.pf-intro').getByRole('heading', {name: scope === 'quality' ? '周报质量' : '360 协同得分', exact: true}).waitFor();
    assert.equal(await member.page.getByRole('button', {name: /导出.*Excel/}).count(), 0, 'ordinary employees do not receive management export controls');
  }
  await member.context.close();
  assert.deepEqual(businessWrites, []); assert.deepEqual(outbound, []); assert.deepEqual(unexpected, []); assert.deepEqual(browserErrors, []);
  const proof = {ok: true, realBrowserDownloads: true, syntheticOnly: true, ordinaryEmployeesCannotExport: true, qualityAndCollaborationScopes: true, combinedWorkbookTwoSheets: true, departmentAndSearchAllPages: 17, zeroPreservedAsNumeric: true, waitingFinalBlank: true, staleMonthCannotExport: true, bothScopesDisableDuringLoading: true, legacyContextResetsFilters: true, noAdditionalExportRequests: true, failureAndCancelDoNotClaimSaved: true, unicodeFilenamesAndHeaders: true, apiCalls, downloads, businessWrites, outbound, unexpected, browserErrors, artifacts};
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(proof, null, 2), {flag: 'wx', mode: 0o600});
  console.log('Performance export UI regression passed. Evidence:', artifacts);
} finally {
  holdNovember = false; releaseNovember?.();
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(artifacts, 'requests.json'), JSON.stringify({apiCalls, downloads, businessWrites, outbound, unexpected, browserErrors}, null, 2), {flag: 'wx', mode: 0o600});
  console.log('Synthetic artifacts retained:', artifacts);
}
