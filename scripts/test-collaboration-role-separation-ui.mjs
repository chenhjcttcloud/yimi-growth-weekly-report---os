import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {access, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

// Exercise the real App and parent scoring pages with synthetic HTTP fixtures.
// No application server, database, account, external request or score submission.
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root, 'outputs/tests'), {recursive: true});
const artifacts = await mkdtemp(path.join(root, 'outputs/tests/collaboration-role-separation-ui-'));
const staticDir = process.env.TEST_STATIC_DIR ? path.resolve(root, process.env.TEST_STATIC_DIR) : path.join(artifacts, 'dist');
if (!process.env.TEST_STATIC_DIR) {
  const built = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', staticDir, '--emptyOutDir', 'false'], {cwd: root, encoding: 'utf8'});
  assert.equal(built.status, 0, built.stdout + '\n' + built.stderr);
}
await access(path.join(staticDir, 'index.html'));
const contentTypes = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'};
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname.startsWith('/api/')) { response.writeHead(405); response.end('Synthetic API must be intercepted'); return; }
  const file = path.resolve(staticDir, '.' + pathname);
  if (file !== staticDir && !file.startsWith(staticDir + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    const target = pathname === '/' ? path.join(staticDir, 'index.html') : file;
    response.writeHead(200, {'content-type': contentTypes[path.extname(target)] || 'application/octet-stream'});
    response.end(await readFile(target));
  } catch { response.writeHead(404); response.end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const october = '2026-10', november = '2026-11';
const names = {target: '合成负责人甲', other: '合成其他被评人', empty: '合成尚未配评人', ceo: '合成老板', zero: '合成零分评价人', missing: '合成待评同事甲', third: '合成待评同事乙', outsider: '其他员工的待评人'};
const people = [
  {userId: 'target', name: names.target, department: '合成业务组', active: true},
  {userId: 'other', name: names.other, department: '其他业务组', active: true},
  {userId: 'ceo', name: names.ceo, department: '合成管理组', roleLevel: 'CEO', active: true},
  ...Array.from({length: 5}, (_, index) => ({userId: 'leader-' + index, name: '合成已评负责人' + index, department: '合成业务组' + index, active: true})),
  {userId: 'empty', name: names.empty, department: '尚未配评组', active: true},
];
const zeroAssignment = {id: 'oct-zero', cycle_id: 'oct-cycle', evaluee_user_id: 'target', evaluee_name: names.target, evaluator_user_id: 'zero', evaluator_name: names.zero, status: 'active', score: '0', comment: '零分是已保存的真实合成评分', submitted_at: '2026-10-28 02:00:00'};
const octoberAssignments = [zeroAssignment,
  ...Array.from({length: 14}, (_, index) => ({...zeroAssignment, id: 'oct-done-' + index, evaluator_user_id: 'peer-' + index, evaluator_name: '合成已评同事' + index, score: '80', comment: '合成已完成评价'})),
  ...['ceo', 'missing', 'third'].map(id => ({...zeroAssignment, id: 'oct-pending-' + id, evaluator_user_id: id, evaluator_name: names[id], score: id === 'third' ? ' ' : '', comment: '', submitted_at: ''})),
];
const novemberAssignments = [zeroAssignment, {...zeroAssignment, id: 'nov-ceo', evaluator_user_id: 'ceo', evaluator_name: names.ceo, score: '90'}].map(row => ({...row, id: row.id.startsWith('nov-') ? row.id : 'nov-zero', cycle_id: 'nov-cycle', submitted_at: '2026-11-25 02:00:00'}));
const otherAssignment = {...zeroAssignment, id: 'other-pending', evaluee_user_id: 'other', evaluee_name: names.other, evaluator_user_id: 'outsider', evaluator_name: names.outsider, score: '', comment: '', submitted_at: ''};
const timeliness = {expected: 0, submitted: 0, onTime: 0, late: 0, missing: 0, pendingTimestamp: 0, pendingCalendar: 0, rate: null};
function monthly(month, userId) {
  const target = userId === 'target', isOctober = month === october;
  return {...people.find(row => row.userId === userId), month, reports: [], timeliness,
    peerCandidate: target ? isOctober ? 74.7 : 45 : null,
    managerProgress: {kind: 'boss', expectedIds: [''], expected: 1, submitted: 1, complete: true, score: target ? isOctober ? 85 : 92 : 86, records: [{leader_user_id: userId, scorer_user_id: 'ceo', scorer_name: names.ceo, month, score: target ? isOctober ? '85' : '92' : '86'}]},
    collaborationExpected: userId === 'empty' ? 0 : target ? isOctober ? 18 : 2 : 1,
    collaborationSubmitted: target ? isOctober ? 15 : 2 : 0,
    collaborationComplete: target && !isOctober,
  };
}
function cycle(month, userId) {
  const isOctober = month === october;
  return {id: isOctober ? 'oct-cycle' : 'nov-cycle', label: isOctober ? '合成十月互评轮次' : '合成十一月互评轮次', month, start_date: month + '-01', end_date: month + '-30', status: 'open', launch_at: month + '-25T00:00:00+08:00',
    expected: isOctober ? 374 : 11, submitted: isOctober ? 343 : 10,
    // The actual employee-month API intentionally retains company-wide counts
    // and pending names, while its assignments only contain the chosen person.
    pending: isOctober ? [names.ceo, names.missing, names.third, names.outsider] : [names.outsider],
    ...(userId ? {assignments: userId === 'empty' ? [] : userId === 'target' ? isOctober ? octoberAssignments : novemberAssignments : [otherAssignment]} : {detailsDeferred: true}),
  };
}
function overview(month) {
  return {scopeMonth: month, months: [november, october], employees: people.filter(row => ['target', 'other', 'empty'].includes(row.userId)), monthly: ['target', 'other', 'empty'].map(id => monthly(month, id)), collaborations: [cycle(month)], results: []};
}
function departments(month) {
  const leaders = people.filter(person => person.userId === 'target' || person.userId.startsWith('leader-'));
  return {ok: true, month, canScore: true, currentUserId: 'ceo', departments: leaders.map(person => ({id: 'department-' + person.userId, name: person.department, leader_user_id: person.userId})), employees: people, scores: [],
    personScores: leaders.map(person => ({leader_user_id: person.userId, month, score: person.userId === 'target' ? 85 : 88, comment: '合成老板已完成30%评分', scorer_name: names.ceo, created_at: month + '-28 02:00:00'})),
    leaderScoreTargets: leaders.map(person => ({leaderUserId: person.userId, departmentIds: ['department-' + person.userId], name: person.name, ratingRequired: true})),
  };
}
const requests = [], unexpected = [], outbound = [], businessWrites = [], errors = [];
let browser;
try {
  browser = await chromium.launch({channel: 'chrome', headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}});
  await context.addInitScript(() => {
    const instant = Date.parse('2026-11-27T02:00:00Z'), RealDate = Date;
    globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return instant; } };
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { outbound.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({path: url.pathname, method: request.method(), params: Object.fromEntries(url.searchParams)});
    if (request.method() !== 'GET' && !url.pathname.startsWith('/api/usage/')) {
      businessWrites.push(url.pathname); return route.fulfill({status: 405, json: {error: 'read_only_synthetic_fixture'}});
    }
    const month = url.searchParams.get('month') || october;
    let body;
    switch (url.pathname) {
      case '/api/me': body = {user: {userId: 'ceo', name: names.ceo}, access: {role: 'boss', currentEmployee: people[2], visibleEmployees: people, canManageScoring360: true, canManagePersonnel: true, canViewSettings: true, canViewBossDashboard: true}}; break;
      case '/api/management-data': body = {prototypeData: {meta: {periods: []}, employee_summary: [], weekly_scores: []}}; break;
      case '/api/performance/manage': assert.equal(url.searchParams.get('view'), 'overview'); body = overview(month === 'latest' ? november : month); break;
      case '/api/performance/employee-month': {
        const id = url.searchParams.get('employeeId'); assert(['target', 'other', 'empty'].includes(id));
        body = {monthly: monthly(month, id), collaborations: [cycle(month, id)], results: []}; break;
      }
      case '/api/departments': body = departments(month); break;
      case '/api/manager-reviews': body = {ok: true, month, canReview: false, hasResponsibilities: false, tasks: []}; break;
      case '/api/notifications': body = {items: [], unreadCount: 0}; break;
      case '/api/dev/views': body = {ok: false}; break;
      case '/api/usage/visit': case '/api/usage/heartbeat': body = {ok: true}; break;
      default: unexpected.push(url.pathname); return route.fulfill({status: 404, json: {error: 'unexpected_synthetic_api'}});
    }
    return route.fulfill({status: 200, json: body});
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  const visit = (month, employeeId = 'target', detailTab = 'review') => page.goto(base + '/?' + new URLSearchParams({page: 'collaboration-scores', scoreMonth: month, scoreEmployeeId: employeeId, scoreTarget: '1', scoreDetailTab: detailTab}));
  const main = page.locator('.pf-review-main');
  await visit(october);
  await page.getByRole('heading', {name: '360 协同得分', exact: true, level: 2}).waitFor();
  const personalProgress = main.locator('.pf-review-stats > div').filter({hasText: '该员工同事互评（70%）进度'});
  await personalProgress.waitFor();
  assert.match(await personalProgress.innerText(), /15\s*\/\s*18/);
  assert.match(await main.innerText(), /老板评分（30%）[：:\s]*1\s*\/\s*1\s*已完成[\s·]*85(?:\.0)?\s*分/);
  assert.equal(requests.filter(row => row.path === '/api/scoring360/my-tasks').length, 0, 'the 360 result page does not encourage the boss to submit a separate peer score');
  await page.getByRole('tab', {name: '协作明细', exact: true}).click();
  await main.getByText('该员工待评：' + [names.ceo, names.missing, names.third].join('、'), {exact: true}).waitFor();
  assert.match(await main.innerText(), /该员工\s*15\s*\/\s*18\s*已完成/);
  assert.match(await main.innerText(), /全轮\s*343\s*\/\s*374\s*已完成/);
  assert.match(await main.innerText(), /老板评分（30%）/);
  assert.match(await main.innerText(), /同事互评（70%）/);
  await main.getByText('老板仅负责30%，不参与70%同事互评。', {exact: false}).waitFor();
  assert.equal(await main.getByText(names.outsider, {exact: true}).count(), 0, 'another employee\'s global pending name is absent from the selected employee detail');
  const ceoRow = main.locator('.pf-assignment').filter({has: page.getByText(names.ceo, {exact: true})});
  await ceoRow.getByText('同事互评待评分', {exact: true}).waitFor();
  assert.equal(await ceoRow.getByText(/85(?:\.0)?\s*分/).count(), 0, 'the saved boss score must never be copied into the separate peer assignment');
  await main.locator('.pf-assignment').filter({has: page.getByText(names.zero, {exact: true})}).getByText('同事互评已完成 · 0.0 分', {exact: true}).waitFor();
  await main.locator('.pf-notice').evaluate(element => element.scrollIntoView({block: 'start'}));
  await page.screenshot({path: path.join(artifacts, '01-october-personal-versus-cycle-desktop.png'), animations: 'disabled'});
  await ceoRow.scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(artifacts, '02-historical-boss-peer-record.png'), animations: 'disabled'});

  await page.locator('.pf-person').filter({hasText: names.other}).click();
  await page.getByRole('tab', {name: '协作明细', exact: true}).click();
  await main.getByText('该员工待评：' + names.outsider, {exact: true}).waitFor();
  assert.match(await main.innerText(), /该员工\s*0\s*\/\s*1\s*已完成/);
  await page.locator('.pf-person').filter({hasText: names.empty}).click();
  await page.getByRole('tab', {name: '协作明细', exact: true}).click();
  await main.getByText('该员工待评：尚未配置同事评分人', {exact: true}).waitFor();
  assert.equal(await main.getByText('该员工待评：全部完成', {exact: true}).count(), 0, 'a missing assignment list must not imply completion');
  await page.locator('.pf-person').filter({hasText: names.target}).click();
  await page.getByRole('tab', {name: '协作明细', exact: true}).click();
  await main.getByText('该员工待评：' + [names.ceo, names.missing, names.third].join('、'), {exact: true}).waitFor();
  assert.equal(await main.getByText(names.outsider, {exact: true}).count(), 0);

  const picker = page.getByRole('combobox', {name: '选择绩效月份', exact: true});
  await picker.click(); await page.getByRole('option', {name: '2026 年 11 月', exact: true}).click();
  await picker.getByText('2026 年 11 月', {exact: true}).waitFor();
  await page.getByRole('tab', {name: '协作明细', exact: true}).click();
  await main.getByText('该员工待评：全部完成', {exact: true}).waitFor();
  assert.match(await main.innerText(), /该员工\s*2\s*\/\s*2\s*已完成/);
  assert.match(await main.innerText(), /全轮\s*10\s*\/\s*11\s*已完成/);
  assert.equal(await main.getByText('同事互评待评分', {exact: true}).count(), 0, 'the other employee\'s pending assignment does not make this employee pending');
  await main.locator('.pf-assignment').filter({has: page.getByText(names.ceo, {exact: true})}).getByText('同事互评已完成 · 90.0 分', {exact: true}).waitFor();
  await picker.click(); await page.getByRole('option', {name: '2026 年 10 月', exact: true}).click();
  await picker.getByText('2026 年 10 月', {exact: true}).waitFor();
  await page.getByRole('tab', {name: '协作明细', exact: true}).click();
  await main.getByText('该员工待评：' + [names.ceo, names.missing, names.third].join('、'), {exact: true}).waitFor();
  await page.setViewportSize({width: 390, height: 844});
  await main.locator('.pf-notice').evaluate(element => element.scrollIntoView({block: 'start'}));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'the role explanations and personal/cycle progress fit a mobile viewport');
  await page.screenshot({path: path.join(artifacts, '03-role-separation-mobile.png'), animations: 'disabled'});
  await page.setViewportSize({width: 1440, height: 1100});

  await page.goto(base + '/?' + new URLSearchParams({page: 'scores', scoreTab: 'leaders', scoreMonth: october}));
  const bossPanel = page.locator('.boss-leader-panel');
  await bossPanel.locator('.bl-person').first().waitFor();
  assert.match(await bossPanel.innerText(), /本页.*30%/);
  assert.match(await bossPanel.locator('.bl-metric.is-pending').innerText(), /0\s*项/);
  assert.match(await bossPanel.locator('.bl-metric.is-done').innerText(), /6\s*项/);
  await bossPanel.locator('button.bl-person[data-leader-user-id="target"]').click();
  assert.match(await bossPanel.locator('.bl-saved').innerText(), /85(?:\.0)?\s*分/);
  await page.screenshot({path: path.join(artifacts, '04-boss-thirty-percent-only.png'), fullPage: true, animations: 'disabled'});
  assert.deepEqual(unexpected, []); assert.deepEqual(outbound, []); assert.deepEqual(businessWrites, []); assert.deepEqual(errors, []);
  assert.equal(requests.filter(row => /employee-preview|scoring360\/my-tasks/.test(row.path)).length, 0);
  const proof = {ok: true, syntheticOnly: true, actualAppParentPages: true, savedBossScore: 85, bossSubmitted: '1/1', personalPeerProgress: '15/18', wholeCycleProgress: '343/374', zeroIsSubmitted: true, whitespaceIsPending: true, unconfiguredIsNotComplete: true, preservedHistoricalPendingNotAutoFilled: true, bossOnlyThirtyPercentRule: true, globalPendingExcludedFromPersonalDetail: true, monthSwitching: true, noPeerTaskEntryAdded: true, bossPanelOnlyThirtyPercent: true, noBusinessWrites: true, noOutbound: true, requests, unexpected, outbound, businessWrites, errors, artifacts};
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(proof, null, 2), {flag: 'wx', mode: 0o600});
  console.log('Collaboration role-separation browser regression passed. Evidence:', artifacts);
  await context.close();
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(artifacts, 'requests.json'), JSON.stringify({requests, unexpected, outbound, businessWrites, errors}, null, 2), {flag: 'wx', mode: 0o600});
  console.log('Synthetic artifacts retained:', artifacts);
}
