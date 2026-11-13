import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHmac, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await mkdir(path.join(root, 'outputs/tests'), {recursive: true});
const dir = await mkdtemp(path.join(root, 'outputs/tests/session-perspective-'));
const db = path.join(dir, 'test.sqlite');
const data = path.join(dir, 'data');
const networkLog = path.join(dir, 'network.log');
const networkGuard = path.join(dir, 'guard.mjs');
const secret = 'isolated-session-perspective-test';
const month = '2026-01';
const cycleId = '2026-01-360';
const owner = {userId: 'fixture-boss', name: '测试老板'};
const ownReport = '本人周报内容测试标记';
const otherReport = '他人周报内容测试标记';
await mkdir(data);

function sql(statement, json = false) {
  const result = spawnSync('sqlite3', ['-bail', '-cmd', '.timeout 5000', ...(json ? ['-json'] : []), db],
    {input: statement, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return json ? JSON.parse(result.stdout || '[]') : result.stdout.trim();
}

sql(await readFile(path.join(root, 'db/schema.sql'), 'utf8'));
sql(`
  INSERT INTO employees(user_id,name,department,manager_user_id,is_active) VALUES
    ('fixture-boss','测试老板','测试团队',NULL,1),
    ('other-boss','另一位老板','测试团队',NULL,1),
    ('admin-only','测试管理员','测试团队',NULL,1),
    ('same-name','测试老板','测试团队','fixture-boss',1),
    ('staff','测试员工','测试团队',NULL,1),
    ('inactive-boss','停用老板','测试团队',NULL,0);
  INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source)
    SELECT 'employment-'||user_id,user_id,'2026-01-01','manager' FROM employees WHERE is_active=1;
  INSERT INTO app_settings(key,value_json) VALUES
    ('boss_view_members','{"members":[{"userId":"fixture-boss","name":"测试老板"}]}'),
    ('report_automation_config','{"enabled":false}');
  INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,submitted_at)
    VALUES ('fixture-own-report','fixture-boss','测试老板','测试团队','测试周','2026-01-05','2026-01-09','准时',
      '{"results":"${ownReport}","source":{"provider":"feishu-report"}}','2026-01-09T10:00:00Z'),
    ('fixture-other-report','same-name','测试老板','测试团队','测试周','2026-01-05','2026-01-09','准时',
      '{"results":"${otherReport}","source":{"provider":"feishu-report"}}','2026-01-09T10:00:00Z');
  INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at)
    VALUES ('${cycleId}','测试周期','2026-01-01','2026-01-31','open','2026-01-01T00:00:00Z');
  INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id)
    VALUES ('own-assignment','${cycleId}','测试员工','测试老板','staff','fixture-boss'),
      ('other-assignment','${cycleId}','测试员工','测试老板','staff','same-name');
`);
const fixtures = {
  prototypeData: {meta: {periods: [], collectionStartDate: '2026-01-01'}, employee_summary: [], weekly_scores: []},
  scoring360: {cycles: [], assignments: [], responses: []},
  kimiInsights: {},
  kimiInsightsByPeriod: {},
  monthlyMeetingInsights: {},
};
for (const [name, fixture] of Object.entries(fixtures)) {
  await writeFile(path.join(data, name + '.json'), JSON.stringify(fixture));
}
await writeFile(networkGuard, `
  import {appendFileSync} from 'node:fs';
  globalThis.fetch = async () => {
    appendFileSync(${JSON.stringify(networkLog)}, 'unexpected outbound request\\n');
    throw Error('fixture_external_network_forbidden');
  };
`);

const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const base = 'http://127.0.0.1:' + port;
const env = {...process.env,
  AUTH_MODE: 'feishu', DEV_VIEW_SWITCH_ENABLED: 'true', SESSION_SECRET: secret, SESSION_TTL_HOURS: '24',
  SERVER_PORT: String(port), BASE_URL: base, APP_DATA_DIR: data, STATIC_DIR: path.join(dir, 'static'),
  WEEKLY_REPORT_DB_PATH: db, WEEKLY_REPORT_UPLOAD_DIR: path.join(dir, 'uploads'), BACKUP_DIR: path.join(dir, 'backups'),
  LARK_REPORT_SYNC_STATUS_PATH: path.join(dir, 'report-sync.json'),
  BOSS_VIEW_USER_IDS: 'other-boss,inactive-boss', BOSS_VIEW_NAMES: '',
  BOSS_EMPLOYEE_PERSPECTIVE_USER_IDS: 'fixture-boss,admin-only,inactive-boss',
  SCORING360_CONFIG_MANAGER_USER_IDS: 'fixture-boss,admin-only', SCORING360_CONFIG_MANAGER_NAMES: '',
  CHINA_CALENDAR_AUTO_UPDATE_ENABLED: 'false', LARK_REPORT_AUTO_SYNC_ENABLED: 'false',
  LARK_AUTH_MONITOR_ENABLED: 'false', SCORING360_REMINDER_ENABLED: 'false', SCORING360_LAUNCH_MODE: 'manual',
  WEEKLY_REMINDER_ENABLED: 'false', WEEKLY_UPDATE_REMINDER_ENABLED: 'false', FEISHU_TASK_CREATE_ENABLED: 'false',
  FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', MOONSHOT_API_KEY: '', KIMI_API_KEY: '',
};

function authCookie(user, overrides = {}) {
  const issuedAt = Date.now();
  const session = {user, issuedAt, expiresAt: new Date(issuedAt + 3600000).toISOString(),
    sessionId: randomUUID(), feishuGrant: true, ...overrides};
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return 'wos_session=' + payload + '.' + signature;
}

async function request(route, {cookie, method = 'GET', body, headers = {}} = {}) {
  const response = await fetch(base + route, {method, redirect: 'manual', headers: {...(cookie ? {cookie} : {}), ...headers}, body});
  return {status: response.status, body: await response.json(), headers: response.headers};
}

function post(route, cookie, body, headers) {
  return request(route, {cookie, method: 'POST', body: JSON.stringify(body),
    headers: {origin: base, 'content-type': 'application/json', ...headers}});
}

const sessionRoute = '/api/session/perspective';
const session = authCookie(owner);
const switchView = (cookie, perspective, headers) => post(sessionRoute, cookie, {perspective}, headers);
const access = cookie => request('/api/me', {cookie});
const bossRoute = '/api/boss-view-members';
const managedRoutes = ['/api/management-data', '/api/system-settings/report-automation',
  '/api/performance/manage', '/api/performance/quality-scope', '/api/manager-reviews?month=' + month,
  '/api/admin/employee-preview/workspace?employeeId=same-name', '/api/scoring360/config', bossRoute];

function sessionPreference(response) {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 1, 'switch writes one independent preference cookie');
  assert.match(cookies[0], /^wos_perspective=/);
  assert.match(cookies[0], /; HttpOnly\b/);
  assert.match(cookies[0], /; SameSite=Lax\b/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  return cookies[0].split(';')[0];
}

const server = spawn(process.execPath, ['--import', networkGuard, 'server/index.mjs'],
  {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
let logs = '';
server.stdout.on('data', chunk => {logs += chunk;});
server.stderr.on('data', chunk => {logs += chunk;});
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(server.exitCode, null, logs);
    try {
      if ((await fetch(base + '/health')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await pause(100);
  }
  assert(ready, logs || 'Isolated Feishu fixture did not start');

  const initial = await access(session);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.user.userId, owner.userId);
  assert.equal(initial.body.access.role, 'boss');
  assert.equal(initial.body.canSwitchPerspective, true);
  assert.equal(initial.body.activePerspective, 'boss');
  assert.equal(initial.body.devView, null);
  assert.equal((await request('/api/dev/views', {cookie: session})).status, 404);
  assert.equal((await request('/api/performance/quality-scope', {cookie: session})).status, 200);
  assert.equal((await request('/api/manager-reviews?month=' + month, {cookie: session})).body.canReview, true);

  assert.equal((await request(sessionRoute, {cookie: session})).status, 405);
  assert.equal((await switchView(undefined, 'employee')).status, 401);
  assert.equal((await switchView(session, 'employee', {origin: 'https://fixture-other.invalid'})).status, 403);
  assert.equal((await switchView(session, 'employee', {'content-type': 'text/plain'})).status, 415);
  assert.equal((await request(sessionRoute, {cookie: session, method: 'POST',
    body: '{invalid json', headers: {'content-type': 'application/json'}})).status, 400);
  assert.equal((await switchView(session, 'administrator')).status, 400);
  assert.equal((await post(sessionRoute, session, {perspective: 'employee', userId: 'same-name'})).status, 400);

  const employeePreference = sessionPreference(await switchView(session, 'employee'));
  const employeeCookie = session + '; ' + employeePreference;
  const employee = await access(employeeCookie);
  assert.equal(employee.status, 200);
  assert.equal(employee.body.canSwitchPerspective, true);
  assert.equal(employee.body.activePerspective, 'employee');
  assert.equal(employee.body.access.role, 'member');
  assert.equal(employee.body.user.role, 'member');
  assert.equal(employee.body.user.userId, owner.userId);
  assert.equal(employee.body.access.currentEmployee.userId, owner.userId);
  assert.deepEqual(employee.body.access.visibleUserIds, [owner.userId]);
  for (const capability of ['bossView', 'canViewBossDashboard', 'canViewSettings', 'canManageScoring360',
    'canManagePersonnel', 'canReviewWeeklyQuality']) {
    assert.equal(employee.body.access[capability], false, capability);
  }
  const renewed = employee.headers.getSetCookie().find(cookie => cookie.startsWith('wos_session='));
  assert.equal(renewed?.split(';')[0], session, 'normal requests renew the same signed login separately');
  assert.equal((await access(employeeCookie)).body.activePerspective, 'employee');
  assert.equal((await access(authCookie(owner) + '; ' + employeePreference)).body.activePerspective, 'boss');
  assert.equal((await access(session + '; ' + employeePreference.replace(/\..+$/, '.invalid'))).body.activePerspective, 'boss');
  assert.equal((await access(employeePreference)).status, 401);
  for (const route of managedRoutes) {
    assert.equal((await request(route, {cookie: employeeCookie})).status, 403, route);
  }
  assert.equal((await post('/api/manager-reviews', employeeCookie,
    {employeeUserId: 'same-name', month, score: 80, comment: '员工视角管理写入测试'})).status, 403);
  assert.equal((await request('/api/performance/report?id=fixture-other-report', {cookie: employeeCookie})).status, 403);
  assert.equal((await request('/api/performance/me?employeeId=same-name', {cookie: employeeCookie})).status, 403);
  assert.equal((await request('/api/personal/workspace?employeeId=same-name', {cookie: employeeCookie})).status, 403);

  const workspace = await request('/api/personal/workspace?month=' + month, {cookie: employeeCookie});
  assert.equal(workspace.status, 200);
  assert.equal(workspace.body.employee.userId, owner.userId);
  const week = workspace.body.weeks.find(report => report.reportId === 'fixture-own-report');
  assert.equal(week?.facts.results, ownReport);
  assert(!JSON.stringify(workspace.body).includes(otherReport));
  assert.equal((await post('/api/personal/comment', employeeCookie,
    {month, weekId: week.id, body: '本人视角可以写入本人周报评论'})).status, 200);
  assert.deepEqual(sql("SELECT author_user_id FROM comments WHERE target_type='personal_weekly_report';", true),
    [{author_user_id: owner.userId}]);
  const tasks = await request('/api/scoring360/my-tasks?month=' + month + '&evaluatorUserId=same-name', {cookie: employeeCookie});
  assert.equal(tasks.status, 200);
  assert.deepEqual(tasks.body.tasks.map(task => task.id), ['own-assignment']);
  const scores = await post('/api/scoring360/submit', employeeCookie, {
    cycleId, scores: [
      {assignmentId: 'own-assignment', score: 82, comment: '本人的评分任务'},
      {assignmentId: 'other-assignment', score: 82, comment: '其他人的评分任务'},
    ],
  });
  assert.equal(scores.status, 200);
  assert.equal(scores.body.saved, 1);
  assert.deepEqual(scores.body.skipped, [{assignmentId: 'other-assignment', reason: 'assignment_not_found'}]);
  assert.deepEqual(sql('SELECT assignment_id FROM scoring360_responses;', true), [{assignment_id: 'own-assignment'}]);

  const restoredPreference = sessionPreference(await switchView(employeeCookie, 'boss'));
  const restoredCookie = session + '; ' + restoredPreference;
  assert.equal((await access(restoredCookie)).body.access.role, 'boss');
  assert.equal((await request('/api/system-settings/report-automation', {cookie: restoredCookie})).status, 200);

  for (const [user, role] of [
    [{userId: 'same-name', name: owner.name}, 'member'],
    [{userId: 'admin-only', name: '测试管理员'}, 'system_admin'],
    [{userId: 'other-boss', name: '另一位老板'}, 'boss'],
  ]) {
    const cookie = authCookie(user);
    const profile = await access(cookie);
    assert.equal(profile.body.access.role, role);
    assert.notEqual(profile.body.canSwitchPerspective, true);
    assert.equal((await switchView(cookie, 'employee')).status, 403);
    assert.equal((await switchView(cookie, 'boss')).status, 403);
  }
  assert.equal((await switchView(authCookie({userId: 'inactive-boss', name: '停用老板'}), 'employee')).status, 403);
  assert.equal((await switchView(authCookie({userId: 'external:legacy', name: '旧访客'}), 'employee')).status, 410);
  assert.equal((await switchView(authCookie(owner, {expiresAt: '2026-01-01T00:00:00Z'}), 'employee')).status, 401);

  const revokingAdmin = authCookie({userId: 'admin-only', name: '测试管理员'});
  const grants = await request(bossRoute, {cookie: revokingAdmin});
  assert.equal(grants.status, 200);
  assert.equal((await post(bossRoute, revokingAdmin, {members: [], expectedRevision: grants.body.revision})).status, 200);
  const revoked = await access(employeeCookie);
  assert.notEqual(revoked.body.canSwitchPerspective, true);
  assert.notEqual(revoked.body.access.role, 'boss');
  assert.equal((await switchView(employeeCookie, 'boss')).status, 403);

  const logout = await post('/auth/logout', employeeCookie, {});
  assert.equal(logout.status, 200);
  assert(logout.headers.getSetCookie().some(cookie => /^wos_perspective=;.*Max-Age=0/.test(cookie)));
  assert.equal((await access(employeeCookie)).status, 401);
  await assert.rejects(readFile(networkLog, 'utf8'), {code: 'ENOENT'});
  console.log('Session perspective tests passed: same identity and expiry, session-bound preference, personal reports and tasks, management denial, authorization revocation, logout, no provider requests.');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    await stopped;
  }
  console.log('Test artifacts retained:', dir);
}
