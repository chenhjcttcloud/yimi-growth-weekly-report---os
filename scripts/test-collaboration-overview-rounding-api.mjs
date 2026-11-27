import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, createHmac} from 'node:crypto';
import {once} from 'node:events';
import {access, mkdir, mkdtemp, readFile, realpath, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const originalPath = process.env.PATH;
const requestedBinary = process.env.SQLITE3_BIN || 'sqlite3';
const resolved = path.isAbsolute(requestedBinary) ? requestedBinary : spawnSync('which', [requestedBinary], {encoding: 'utf8'}).stdout?.trim();
assert(resolved, 'SQLITE3_BIN must resolve to an existing SQLite CLI');
const sqlite = await realpath(resolved);
const staticDirectory = path.resolve(root, process.env.TEST_STATIC_DIR || 'dist');
await access(path.join(staticDirectory, 'index.html'));
await mkdir(path.join(root, 'outputs/tests'), {recursive: true});
const artifacts = await mkdtemp(path.join(root, 'outputs/tests/collaboration-overview-rounding-api-'));
const bin = path.join(artifacts, 'bin'), data = path.join(artifacts, 'data'), db = path.join(artifacts, 'fixture.sqlite');
await mkdir(bin); await mkdir(data);
await symlink(sqlite, path.join(bin, 'sqlite3'));
const quote = value => value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
function sql(statement, rows = false) {
  const result = spawnSync(sqlite, ['-bail', '-json', db], {input: statement, encoding: 'utf8'});
  if (result.status !== 0) throw Error(result.stderr || 'synthetic_sql_failed');
  return rows ? JSON.parse(result.stdout.trim() || '[]') : result.stdout;
}
sql(await readFile(path.join(root, 'db/schema.sql'), 'utf8'));
const oracle = sql('SELECT sqlite_version() AS version,ROUND(95.5*0.7+96*0.3,1) AS score;', true)[0];
assert.equal(Math.round((95.5 * .7 + 96 * .3) * 10) / 10, 95.6);
if (oracle.version === '3.40.1') assert.equal(oracle.score, 95.7, 'production SQLite must exercise the actual rounding boundary');
const names = {target: '合成临界员工', history: '合成历史员工', manager: '合成负责人', admin: '合成管理员', boss: '合成老板', 'peer-one': '合成同事甲', 'peer-two': '合成同事乙'};
const people = Object.entries(names).map(([userId, name]) => ({userId, name, department: ['boss', 'admin'].includes(userId) ? '合成管理部' : '合成团队'}));
for (const person of people) {
  sql(`INSERT INTO employees(user_id,name,department,manager_user_id,is_active) VALUES(${quote(person.userId)},${quote(person.name)},${quote(person.department)},${quote(['target', 'history'].includes(person.userId) ? 'manager' : '')},1);
INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES(${quote('employment-' + person.userId)},${quote(person.userId)},'2026-10-01','synthetic');`);
}
sql("INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES('team','合成团队','manager',datetime('now')),('management','合成管理部','boss',datetime('now'));");
for (const [key, value] of Object.entries({
  boss_view_members: {members: [{userId: 'boss', name: names.boss}, {userId: 'admin', name: names.admin}]},
  business_boss_members: {members: [{userId: 'boss', name: names.boss}]},
  scoring360_admin_members: {members: [{userId: 'admin', name: names.admin}]},
  report_automation_config: {enabled: false, intervalMinutes: 15},
  operations_config: {backupEnabled: false, alertsEnabled: false, backupTime: '03:00', recipientUserIds: [], diskWarningPercent: 85},
  scoring360_recurring_config: {enabled: false},
  monthly_score_reminder_config: {enabled: false, time: '10:00', startMonth: '2099-01'},
})) sql(`INSERT INTO app_settings(key,value_json) VALUES(${quote(key)},${quote(JSON.stringify(value))});`);
sql("INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at) VALUES('oct','合成十月互评','2026-10-01','2026-10-31','open','2026-10-26T00:00:00+08:00'),('nov','合成十一月草稿','2026-11-01','2026-11-30','draft',NULL);");
for (const [id, target, evaluator, score] of [['target-one', 'target', 'peer-one', 95], ['target-two', 'target', 'peer-two', 96], ['history-one', 'history', 'peer-one', 88.2]]) {
  sql(`INSERT INTO scoring360_assignments(id,cycle_id,evaluee_user_id,evaluator_user_id,evaluee_name,evaluator_name,status) VALUES(${quote(id)},'oct',${quote(target)},${quote(evaluator)},${quote(names[target])},${quote(names[evaluator])},'active');
INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment) VALUES(${quote('response-' + id)},${quote(id)},'oct',${quote(names[target])},${quote(names[evaluator])},${score},'合成已保存评价');`);
}
for (const [id, score] of [['target', 96], ['history', 80]]) {
  const plan = {kind: 'manager', expectedIds: ['manager'], employee: people.find(person => person.userId === id)};
  sql(`INSERT INTO monthly_review_plans(month,employee_user_id,plan_json,created_at) VALUES('2026-10',${quote(id)},${quote(JSON.stringify(plan))},'2026-10-27T02:00:00Z');
INSERT INTO monthly_manager_scores(month,employee_user_id,evaluator_user_id,score,comment,snapshot_json,created_at) VALUES('2026-10',${quote(id)},'manager',${score},'合成负责人已评分',${quote(JSON.stringify(plan))},'2026-10-27T02:00:00Z');`);
}
sql(`INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES('2026-10','history',${quote(names.history)},'collaboration','{"score":88.2,"legacySentinel":"retain-verbatim"}','{"reviewNote":"合成旧口径原保存证据"}','合成历史系统','2026-11-01T02:00:00Z');`);
sql("INSERT INTO scoring360_assignments(id,cycle_id,evaluee_user_id,evaluator_user_id,evaluee_name,evaluator_name,status) VALUES('boss-pending','oct','manager','boss','合成负责人','合成老板','active'),('boss-answered','oct','admin','boss','合成管理员','合成老板','active'); INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment,submitted_at) VALUES('old-boss-peer','boss-answered','oct','合成管理员','合成老板',77,'保留历史已答老板互评','2026-11-26T09:59:00Z');");
const historyBefore = JSON.stringify(sql("SELECT * FROM performance_results WHERE employee_user_id='history';", true));
const humanTables = ['scoring360_responses', 'monthly_manager_scores', 'monthly_review_plans', 'department_leader_scores', 'department_person_scores', 'performance_results'];
const humanSnapshot = () => JSON.stringify(humanTables.map(table => [table, sql('SELECT * FROM ' + table + ';', true).map(row => JSON.stringify(row)).sort()]));
const humanBefore = humanSnapshot();
const publishedCount = () => sql("SELECT count(*) AS n FROM monthly_person_weighted_results WHERE month='2026-10' AND employee_user_id='target';", true)[0].n;
assert.equal(publishedCount(), 0, 'the rounding-boundary result must begin unpublished');
const periods = [{id: '2026-W43', label: '合成十月周', start: '2026-10-19', end: '2026-10-23'}, {id: '2026-W47', label: '合成十一月周', start: '2026-11-16', end: '2026-11-20'}];
for (const [filename, value] of Object.entries({
  prototypeData: {meta: {generated_on: '2026-11-26', collectionStartDate: '2026-10-01', people_count: people.length, current_week_id: '2026-W47', periods}, employee_summary: people.map(person => ({user_id: person.userId, '姓名': person.name, '部门': person.department})), weekly_scores: [], boss_tasks: [], employee_tasks: [], feedback_drafts: []},
  scoring360: {cycles: [], assignments: [], responses: [], results: []}, kimiInsights: {}, kimiInsightsByPeriod: {}, monthlyMeetingInsights: {},
})) await writeFile(path.join(data, filename + '.json'), JSON.stringify(value), {mode: 0o600});

const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`, at = Date.parse('2026-11-26T10:00:00Z'), secret = 'synthetic-collaboration-rounding-session';
const guard = path.join(artifacts, 'network-guard.mjs'), networkLog = path.join(artifacts, 'blocked-network.log');
await writeFile(guard, `import {appendFileSync} from 'node:fs';
import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import {syncBuiltinESMExports} from 'node:module';
const blocked=()=>{appendFileSync(${JSON.stringify(networkLog)},'unexpected outbound attempt\\n');throw Error('synthetic_rounding_outbound_forbidden');};
globalThis.fetch=blocked;http.request=http.get=https.request=https.get=blocked;net.connect=net.createConnection=tls.connect=blocked;syncBuiltinESMExports();
const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[${at}]));}static now(){return ${at};}};
`, {mode: 0o600});
const env = {
  PATH: bin + path.delimiter + (originalPath || ''), HOME: process.env.HOME, LANG: process.env.LANG || 'en_US.UTF-8',
  AUTH_MODE: 'feishu', SESSION_SECRET: secret, SESSION_TTL_HOURS: '24', SERVER_PORT: String(port), BASE_URL: base,
  APP_DATA_DIR: data, STATIC_DIR: staticDirectory, WEEKLY_REPORT_DB_PATH: db, WEEKLY_REPORT_UPLOAD_DIR: path.join(artifacts, 'uploads'), BACKUP_DIR: path.join(artifacts, 'backups'), LARK_REPORT_SYNC_STATUS_PATH: path.join(artifacts, 'sync-status.json'),
  BOSS_VIEW_USER_IDS: 'boss', BOSS_VIEW_NAMES: '', BOSS_EMPLOYEE_PERSPECTIVE_USER_IDS: '', SCORING360_CONFIG_MANAGER_USER_IDS: 'admin', SCORING360_CONFIG_MANAGER_NAMES: '',
  DEV_VIEW_SWITCH_ENABLED: 'false', CHINA_CALENDAR_AUTO_UPDATE_ENABLED: 'false', LARK_REPORT_AUTO_SYNC_ENABLED: 'false', LARK_AUTH_MONITOR_ENABLED: 'false', SCORING360_REMINDER_ENABLED: 'false', SCORING360_LAUNCH_MODE: 'manual', WEEKLY_REMINDER_ENABLED: 'false', WEEKLY_UPDATE_REMINDER_ENABLED: 'false', FEISHU_TASK_CREATE_ENABLED: 'false',
  FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', FEISHU_EVENT_VERIFICATION_TOKEN: '', FEISHU_EVENT_ENCRYPT_KEY: '', MOONSHOT_API_KEY: '', KIMI_API_KEY: '', PRODUCT_MANAGEMENT_SCORE_API_TOKEN: '',
};
let serverLog = '', browser;
const server = spawn(process.execPath, ['--import', guard, path.join(root, 'server/index.mjs')], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
server.stdout.on('data', chunk => { serverLog += chunk; }); server.stderr.on('data', chunk => { serverLog += chunk; });
const session = userId => {
  const body = Buffer.from(JSON.stringify({user: {userId, name: names[userId]}, sessionId: 'synthetic-rounding-' + userId, issuedAt: at, expiresAt: new Date(at + 24 * 3600_000).toISOString(), feishuGrant: true})).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
};
const apiCalls = [];
async function request(month, userId = 'admin') {
  const url = base + '/api/performance/manage?' + new URLSearchParams({view: 'overview', month});
  const response = await fetch(url, {headers: userId ? {cookie: 'wos_session=' + session(userId)} : {}, signal: AbortSignal.timeout(20_000)});
  const body = await response.json(); apiCalls.push({month, role: userId || 'anonymous', status: response.status});
  return {status: response.status, body};
}
const browserRequests = [], browserResponses = [], browserErrors = [], outbound = [], browserWrites = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 160; attempt++) {
    if (server.exitCode !== null) throw Error('Synthetic server exited before readiness: ' + serverLog);
    try { if ((await fetch(base + '/health', {signal: AbortSignal.timeout(1000)})).ok) { ready = true; break; } } catch {}
    await pause(100);
  }
  assert(ready, 'synthetic server must start');
  const rawApi=async (route,userId,body)=>{const response=await fetch(base+route,{method:body?'POST':'GET',headers:{cookie:'wos_session='+session(userId),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  for(const [userId,canScore] of [['boss',true],['admin',false]]){
    const departments=await rawApi('/api/departments?month=2026-10',userId);
    assert.equal(departments.status,200);assert.equal(departments.body.canScore,canScore,'boss-view access is independent of business scoring authority');
  }
  for(const route of ['/api/scoring360/my-tasks?month=2026-10','/api/admin/employee-preview/scoring-tasks?month=2026-10&employeeId=boss']){
    const tasks=await rawApi(route,route.includes('employee-preview')?'admin':'boss');assert.equal(tasks.status,200);
    assert.deepEqual(tasks.body.tasks.map(task=>task.id),['boss-answered']);assert.equal(tasks.body.tasks[0].score,77);assert.equal(tasks.body.tasks[0].locked,true,'retained historical boss peer scores are read only in self and preview');
  }
  const reminders=await rawApi('/api/scoring360/reminders?cycleId=oct','admin');assert.equal(reminders.status,200);assert(!reminders.body.pending.some(recipient=>recipient.evaluatorUserId==='boss'),'retained boss peer relationships cannot generate peer reminders');
  const deniedBossPeer=await rawApi('/api/scoring360/submit','boss',{cycleId:'oct',scores:[{assignmentId:'target-one',score:85}]});
  assert.equal(deniedBossPeer.status,403);assert.equal(deniedBossPeer.body.error,'boss_peer_forbidden');
  const deniedAdminBossScore=await rawApi('/api/departments/score','admin',{month:'2026-10',leaderUserId:'manager',score:90,comment:'forbidden business-role crossover'});
  assert.equal(deniedAdminBossScore.status,403);assert.equal(deniedAdminBossScore.body.error,'boss_only');
  assert.equal(humanSnapshot(),humanBefore,'denied role crossover cannot write any human score');
  assert.equal((await request('2026-10', null)).status, 401);
  assert.equal((await request('2026-10', 'peer-one')).status, 403);
  assert.equal(publishedCount(), 0, 'denied requests cannot publish scores');
  const latestBefore = await request('latest');
  assert.equal(latestBefore.status, 200);
  assert.equal(latestBefore.body.scopeMonth, '2026-11');
  assert.equal(publishedCount(), 0, 'latest November overview does not force October publication');
  for (const role of ['admin', 'boss']) {
    const october = await request('2026-10', role);
    assert.equal(october.status, 200, JSON.stringify(october.body));
    assert.equal(october.body.scopeMonth, '2026-10');
    assert(october.body.months.includes('2026-10'));
    const target = october.body.results.find(row => row.employee_user_id === 'target' && row.month === '2026-10' && row.kind === 'collaboration');
    assert.equal(target?.result.score, oracle.score);
    assert.equal(target?.result.peerScore, 95.5); assert.equal(target?.result.managerScore, 96);
    assert.equal(october.body.results.find(row => row.employee_user_id === 'history' && row.kind === 'collaboration')?.result.score, 88.2);
    assert.equal(publishedCount(), 1);
  }
  const publicationBeforeRepeat = JSON.stringify(sql('SELECT * FROM monthly_person_weighted_results;', true));
  for (const role of ['admin', 'boss']) {
    assert.equal((await request('2026-10', role)).status, 200);
    const latest = await request('latest', role);
    assert.equal(latest.status, 200); assert.equal(latest.body.scopeMonth, '2026-11');
    assert.equal(latest.body.results.find(row => row.employee_user_id === 'target' && row.month === '2026-10' && row.kind === 'collaboration')?.result.score, oracle.score);
  }
  assert.equal(JSON.stringify(sql('SELECT * FROM monthly_person_weighted_results;', true)), publicationBeforeRepeat);
  assert.equal(JSON.stringify(sql("SELECT * FROM performance_results WHERE employee_user_id='history';", true)), historyBefore);
  assert.equal(humanSnapshot(), humanBefore);
  await writeFile(path.join(artifacts, 'http-result.json'), JSON.stringify({ok: true, sqliteVersion: oracle.version, databaseScore: oracle.score, apiCalls, publishedTargetRows: publishedCount(), retainedHistory: true, repeatNoNewPublication: true}, null, 2), {mode: 0o600});
  console.log(`HTTP core passed: SQLite ${oracle.version}, admin/boss October ${oracle.score}, retained history, idempotent publication, latest and 401/403. Evidence: ${artifacts}`);

  browser = await chromium.launch({channel: 'chrome', headless: true});
  for (const role of ['admin', 'boss']) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}});
    await context.addCookies([{name: 'wos_session', value: session(role), url: base}]);
    await context.addInitScript(value => { const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [value])); } static now() { return value; } }; }, at);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { outbound.push(url.origin); return route.abort(); }
      if (url.pathname.startsWith('/api/usage/')) return route.fulfill({status: 200, json: {ok: true}});
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    page.on('pageerror', error => browserErrors.push({role, message: error.message}));
    page.on('request', req => {
      const url = new URL(req.url());
      if (url.pathname === '/api/performance/manage') browserRequests.push({role, path: url.pathname, month: url.searchParams.get('month'), view: url.searchParams.get('view')});
      if (url.pathname.startsWith('/api/') && req.method() !== 'GET' && !url.pathname.startsWith('/api/usage/')) browserWrites.push({role, method: req.method(), path: url.pathname});
    });
    page.on('response', response => { const url = new URL(response.url()); if (url.pathname === '/api/performance/manage') browserResponses.push({role, month: url.searchParams.get('month'), status: response.status()}); });
    await page.goto(base + '/?' + new URLSearchParams({page: 'collaboration-scores', scoreMonth: '2026-10', scoreEmployeeId: 'target', scoreTarget: '1', scoreDetailTab: 'review'}));
    await page.getByRole('heading', {name: '360 协同得分', exact: true, level: 2}).waitFor();
    const picker = page.getByRole('combobox', {name: '选择绩效月份', exact: true});
    await picker.waitFor();
    assert((await picker.innerText()).includes('10 月'));
    const final = page.locator('.pf-review-main .pf-confirm-row strong');
    await final.getByText('月度综合评分 · ' + oracle.score + ' 分', {exact: true}).waitFor();
    assert.equal(await page.getByText('读取月度结果失败，请重试。', {exact: true}).count(), 0);
    await picker.click(); await page.getByRole('option', {name: '2026 年 11 月', exact: true}).click();
    await picker.getByText('2026 年 11 月', {exact: true}).waitFor();
    await picker.click(); await page.getByRole('option', {name: '2026 年 10 月', exact: true}).click();
    await picker.getByText('2026 年 10 月', {exact: true}).waitFor();
    await page.locator('.pf-person').filter({hasText: names.history}).click();
    await final.getByText('月度综合评分 · 88.2 分', {exact: true}).waitFor();
    await page.locator('.pf-person').filter({hasText: names.target}).click();
    await final.getByText('月度综合评分 · ' + oracle.score + ' 分', {exact: true}).waitFor();
    await page.locator('.content-shell').evaluate(element => element.scrollTo({top: 0}));
    await page.screenshot({path: path.join(artifacts, role + '-october-collaboration.png'), fullPage: true, animations: 'disabled'});
    await context.close();
  }
  assert(browserRequests.filter(row => row.month === '2026-10').some(row => row.role === 'admin'));
  assert(browserRequests.filter(row => row.month === '2026-10').some(row => row.role === 'boss'));
  assert(browserResponses.length > 0 && browserResponses.every(row => row.status === 200));
  assert.deepEqual(browserErrors, []); assert.deepEqual(browserWrites, []); assert.deepEqual(outbound, []);
  assert.equal(await readFile(networkLog, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; }), '');
  assert.equal(JSON.stringify(sql("SELECT * FROM performance_results WHERE employee_user_id='history';", true)), historyBefore, 'legacy result JSON and evidence remain byte-for-byte unchanged');
  assert.equal(humanSnapshot(), humanBefore, 'existing human scores, frozen plans and publications remain unchanged');
  assert.equal(JSON.stringify(sql('SELECT * FROM monthly_person_weighted_results;', true)), publicationBeforeRepeat, 'browser reads never duplicate or rewrite the publication');
  assert.equal(publishedCount(), 1); assert.equal(process.env.PATH, originalPath);
  const result = {ok: true, sqliteVersion: oracle.version, databaseScore: oracle.score, jsBoundaryScore: 95.6, adminAndBossHttp200: true, realBrowserBothRoles: true, octoberSelection: true, retainedHistory: true, repeatNoNewPublication: true, latestNovember200: true, anonymous401: true, staff403: true, apiCalls, browserRequests, browserResponses, browserErrors, browserWrites, outbound, parentPathUnchanged: true, artifacts};
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2), {mode: 0o600});
  console.log(`Collaboration rounding HTTP/browser regression passed: SQLite ${oracle.version}, score ${oracle.score}, admin/boss October, month selection, history and idempotency, latest, 401/403, no outbound. Evidence: ${artifacts}`);
} finally {
  await browser?.close();
  if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  await writeFile(path.join(artifacts, 'server.log'), serverLog, {mode: 0o600});
  console.log('Synthetic artifacts retained:', artifacts);
}
