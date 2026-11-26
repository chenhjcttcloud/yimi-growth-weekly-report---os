import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, createHmac, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await mkdir(path.join(root, 'outputs/tests'), {recursive: true});
const artifacts = await mkdtemp(path.join(root, 'outputs/tests/historical-report-archive-api-'));
const data = path.join(artifacts, 'data');
const dbPath = path.join(artifacts, 'fixture.sqlite');
const networkLog = path.join(artifacts, 'blocked-network.log');
const guard = path.join(artifacts, 'network-guard.mjs');
const secret = 'fixture-only';
const endpoint = '/api/historical-reports';
const privateMarker = 'PRIVATE_SYNTHETIC_ARCHIVE_PATH_HASH_AND_IDENTITY';
const admin = 'fixture-archive-admin', staff = 'fixture-archive-a', other = 'fixture-archive-b';
const specialId = 'reportos:raw/中文 7?x';
const ownId = 'reportos:staff-july', otherId = 'reportos:other-october', adminId = 'reportos:admin-august';
await mkdir(data);

for (const [name, value] of Object.entries({
  prototypeData: {meta: {periods: [], collectionStartDate: '2026-01-01'}, employee_summary: [], weekly_scores: []},
  scoring360: {cycles: [], assignments: [], responses: []},
  kimiInsights: {}, kimiInsightsByPeriod: {}, monthlyMeetingInsights: {},
})) await writeFile(path.join(data, name + '.json'), JSON.stringify(value), {mode: 0o600});

const seed = new DatabaseSync(dbPath);
try {
  seed.exec(await readFile(path.join(root, 'db/schema.sql'), 'utf8'));
  seed.exec(await readFile(path.join(root, 'server/historical-report-archive-schema.sql'), 'utf8'));
  const employee = seed.prepare('INSERT INTO employees(user_id,name,department,is_active) VALUES(?,?,?,1)');
  for (const id of [admin, staff, other]) employee.run(id, '合成员工 ' + id, '合成部门');
  const setting = seed.prepare('INSERT INTO app_settings(key,value_json) VALUES(?,?)');
  for (const [key, value] of Object.entries({
    boss_view_members: {members: [{userId: admin, name: '合成管理员'}]},
    scoring360_admin_members: {members: [{userId: admin, name: '合成管理员'}]},
    report_automation_config: {enabled: false, intervalMinutes: 15},
    operations_config: {backupEnabled: false, alertsEnabled: false, backupTime: '03:00', recipientUserIds: [], diskWarningPercent: 85},
    scoring360_recurring_config: {enabled: false},
    monthly_score_reminder_config: {enabled: false, time: '10:00', startMonth: '2099-01'},
  })) setting.run(key, JSON.stringify(value));
  // Sentinel live data and automatic score history must remain byte-for-byte unchanged.
  seed.prepare(`INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,submitted_at)
    VALUES('unchanged-live-report',?,'合成员工','合成部门','合成现役周报','2026-10-05','2026-10-09','准时',?,'2026-10-09T10:00:00Z')`).run(staff, JSON.stringify({results: privateMarker}));
  seed.prepare(`INSERT INTO automatic_performance_results(id,month,employee_user_id,employee_name,kind,calculation_hash,result_json,evidence_json,calculated_at)
    VALUES('unchanged-automatic-result','2026-10',?,'合成员工','timeliness','fixture-score-hash','{"rate":88}','{}','2026-10-31T10:00:00Z')`).run(staff);
  const insert = seed.prepare(`INSERT INTO historical_report_archives
    (id,source_system,source_report_id,employee_user_id,employee_name,department,week_label,week_start,week_end,submitted_at,status,content_json,recovered_json,provenance_json,source_sha256,import_batch_id,archived_at)
    VALUES(?,'reportos',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [id, userId, end] of [[ownId, staff, '2026-07-17'], [specialId, staff, '2026-09-04'], [otherId, other, '2026-10-09'], [adminId, admin, '2026-08-28']]) {
    const content = {'本周成果摘要': '合成原文成果 ' + id, '问题摘要': '合成问题', '下周计划摘要': '合成计划', '思考与复盘摘要': '',
      '成果分': 80, '问题分': 70, '计划分': 90, '复盘分': 0, '总分': 76.125, '准时分': 100, '等级': 'B',
      open_id: privateMarker, '企业邮箱': privateMarker, sourceFile: privateMarker};
    const recovered = id === specialId ? {reflection: {text: '单独找回的合成复盘', source: 'feishu_raw_form', reason: '旧解析未提取', privatePath: privateMarker}} : {};
    insert.run(id, id.slice('reportos:'.length), userId, '合成员工 ' + userId, '合成部门', '合成归档周 ' + end,
      end.slice(0, 8) + '01', end, end + ' 19:00', '准时', JSON.stringify(content), JSON.stringify(recovered),
      JSON.stringify({path: privateMarker, identityMapping: privateMarker}), 'a'.repeat(64), 'synthetic-archive-batch', '2026-11-26T08:00:00Z');
  }
} finally { seed.close(); }

await writeFile(guard, `import {appendFileSync} from 'node:fs';
const blocked=()=>{appendFileSync(${JSON.stringify(networkLog)},'unexpected outbound call\\n');throw Error('fixture_external_network_forbidden');};
globalThis.fetch=async()=>blocked();
`, {mode: 0o600});
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = 'http://127.0.0.1:' + port;
const env = {
  PATH: process.env.PATH, HOME: artifacts, LANG: 'en_US.UTF-8',
  AUTH_MODE: 'feishu', SESSION_SECRET: secret, SESSION_TTL_HOURS: '24',
  SERVER_PORT: String(port), BASE_URL: base, APP_DATA_DIR: data, STATIC_DIR: path.join(artifacts, 'static'),
  WEEKLY_REPORT_DB_PATH: dbPath, WEEKLY_REPORT_UPLOAD_DIR: path.join(artifacts, 'uploads'), BACKUP_DIR: path.join(artifacts, 'backups'),
  LARK_REPORT_SYNC_STATUS_PATH: path.join(artifacts, 'sync-status.json'),
  BOSS_VIEW_USER_IDS: '', BOSS_VIEW_NAMES: '', BOSS_EMPLOYEE_PERSPECTIVE_USER_IDS: admin,
  SCORING360_CONFIG_MANAGER_USER_IDS: '', SCORING360_CONFIG_MANAGER_NAMES: '',
  DEV_VIEW_SWITCH_ENABLED: 'false', CHINA_CALENDAR_AUTO_UPDATE_ENABLED: 'false',
  LARK_REPORT_AUTO_SYNC_ENABLED: 'false', LARK_AUTH_MONITOR_ENABLED: 'false',
  SCORING360_REMINDER_ENABLED: 'false', SCORING360_LAUNCH_MODE: 'manual',
  WEEKLY_REMINDER_ENABLED: 'false', WEEKLY_UPDATE_REMINDER_ENABLED: 'false', FEISHU_TASK_CREATE_ENABLED: 'false',
  FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', FEISHU_EVENT_VERIFICATION_TOKEN: '', FEISHU_EVENT_ENCRYPT_KEY: '',
  MOONSHOT_API_KEY: '', KIMI_API_KEY: '', PRODUCT_MANAGEMENT_SCORE_API_TOKEN: '',
};

function sign(value) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}
function cookie(userId, {employeePerspective = false} = {}) {
  const issuedAt = Date.now(), sessionId = randomUUID();
  const value = 'wos_session=' + sign({user: {userId, name: '合成员工 ' + userId}, issuedAt,
    expiresAt: new Date(issuedAt + 3600000).toISOString(), sessionId, feishuGrant: true});
  return employeePerspective ? value + '; wos_perspective=' + sign({purpose: 'session-perspective', sessionId, perspective: 'employee'}) : value;
}

function snapshot() {
  const db = new DatabaseSync(dbPath, {readOnly: true});
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const contents = tables.map(({name}) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all().map(row => JSON.stringify(row)).sort()]);
    return {hash: createHash('sha256').update(JSON.stringify(contents)).digest('hex'), tables: contents};
  } finally { db.close(); }
}

let requests = 0, logs = '';
const server = spawn(process.execPath, ['--import', guard, 'server/index.mjs'], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
server.stdout.on('data', value => logs += value);
server.stderr.on('data', value => logs += value);
async function request(route = endpoint, {auth, method = 'GET'} = {}) {
  const response = await fetch(base + route, {method, redirect: 'manual', headers: {
    ...(auth ? {cookie: auth} : {}), ...(method === 'GET' ? {} : {origin: base, 'content-type': 'application/json'}),
  }, ...(method === 'GET' ? {} : {body: '{}'}), signal: AbortSignal.timeout(5000)});
  const raw = await response.text();
  requests++;
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert(!raw.includes(privateMarker), 'API must not expose provenance, private identity mappings, paths or hashes');
  return {status: response.status, body: JSON.parse(raw), headers: response.headers};
}

try {
  let ready = false;
  for (let n = 0; n < 150; n++) {
    if (server.exitCode !== null) throw Error('Synthetic server exited before readiness');
    try { if ((await fetch(base + '/health', {signal: AbortSignal.timeout(1000)})).ok) { ready = true; break; } } catch {}
    await pause(100);
  }
  assert(ready, 'Synthetic server must become ready');
  // Startup migrations and disabled scheduler checks settle before the logical baseline.
  await pause(300);
  let before = snapshot();
  for (let attempt = 0; attempt < 10; attempt++) {
    await pause(100);
    const current = snapshot();
    if (current.hash === before.hash) break;
    before = current;
    if (attempt === 9) throw Error('Synthetic startup did not reach a stable baseline');
  }
  await writeFile(path.join(artifacts, 'baseline.json'), JSON.stringify(before, null, 2), {mode: 0o600});
  const staffCookie = cookie(staff), adminCookie = cookie(admin);
  assert.equal((await request()).status, 401);
  const external = await request(endpoint, {auth: cookie('external:fixture-archive-guest')});
  assert.equal(external.status, 410, 'Global external sharing retirement remains in force');
  assert.equal(external.body.error, 'external_access_disabled');
  assert(!JSON.stringify(external.body).includes('合成原文成果'));

  const personal = await request(endpoint, {auth: staffCookie});
  assert.equal(personal.status, 200);
  assert.equal(personal.body.total, 2);
  assert.deepEqual(personal.body.items.map(row => row.id), [specialId, ownId]);
  assert.deepEqual(personal.body.months, ['2026-09', '2026-07']);
  assert.equal(personal.body.readOnly, true);
  assert.equal(personal.body.affectsPerformance, false);
  assert(!JSON.stringify(personal.body).includes('合成原文成果'));
  const elevation = await request(endpoint + '?management=true&employeeUserId=' + other, {auth: staffCookie});
  assert.equal(elevation.status, 200);
  assert.equal(elevation.body.total, 2);
  for (const route of [endpoint + '?view=management', endpoint + '/' + encodeURIComponent(otherId) + '?view=management']) {
    assert.equal((await request(route, {auth: staffCookie})).status, 403, 'An explicit management view still requires server-side authority');
  }
  assert.equal((await request(endpoint + '?employeeId=' + other, {auth: staffCookie})).status, 403);
  assert.equal((await request(endpoint + '?employeeId=' + staff, {auth: staffCookie})).body.total, 2);

  const special = await request(endpoint + '/' + encodeURIComponent(specialId), {auth: staffCookie});
  assert.equal(special.status, 200);
  assert.equal(special.body.record.id, specialId, 'Encoded slash, Unicode, space and question mark must decode to the exact ID');
  assert.equal(special.body.record.facts.reflection, '');
  assert.equal(special.body.record.recoveredReflection.text, '单独找回的合成复盘');
  assert.equal(special.body.record.legacyScores.total, 76.125);
  const denied = await request(endpoint + '/' + encodeURIComponent(otherId), {auth: staffCookie});
  const absent = await request(endpoint + '/reportos%3Amissing', {auth: staffCookie});
  assert.equal(denied.status, 404);
  assert.equal(absent.status, 404);
  assert.deepEqual(denied.body, absent.body, 'Cross-person records must not be enumerable by ID');
  assert.equal((await request(endpoint + '/%ZZ', {auth: staffCookie})).status, 400);
  assert.equal((await request(endpoint + '/invalid/extra', {auth: staffCookie})).status, 404);

  const managerDefault = await request(endpoint, {auth: adminCookie});
  assert.equal(managerDefault.status, 200);
  assert.equal(managerDefault.body.total, 1, 'A management-capable session defaults to its own historical reports');
  assert.deepEqual(managerDefault.body.items.map(row => row.id), [adminId]);
  assert.deepEqual(managerDefault.body.months, ['2026-08']);
  assert.equal((await request(endpoint + '?management=true', {auth: adminCookie})).body.total, 1, 'The obsolete management flag must not broaden a manager default request');
  assert.equal((await request(endpoint + '?view=personal', {auth: adminCookie})).body.total, 1);
  assert.equal((await request(endpoint + '/' + encodeURIComponent(otherId), {auth: adminCookie})).status, 404);
  assert.equal((await request(endpoint + '/' + encodeURIComponent(adminId), {auth: adminCookie})).status, 200);
  const managed = await request(endpoint + '?view=management', {auth: adminCookie});
  assert.equal(managed.status, 200);
  assert.equal(managed.body.total, 4);
  assert.deepEqual(managed.body.months, ['2026-10', '2026-09', '2026-08', '2026-07']);
  assert.equal((await request(endpoint + '?employeeId=' + other, {auth: adminCookie})).body.total, 1);
  assert.equal((await request(endpoint + '?view=management&employeeId=' + other, {auth: adminCookie})).body.total, 1, 'Explicit management must retain an employee filter');
  assert.equal((await request(endpoint + '/' + encodeURIComponent(otherId) + '?view=management', {auth: adminCookie})).status, 200);
  assert.equal((await request(endpoint + '/' + encodeURIComponent(otherId) + '?employeeId=' + other, {auth: adminCookie})).status, 200);
  assert.equal((await request(endpoint + '/' + encodeURIComponent(otherId) + '?employeeId=' + staff, {auth: adminCookie})).status, 404);
  const lowerCookie = cookie(admin, {employeePerspective: true});
  const lower = await request(endpoint + '?management=true', {auth: lowerCookie});
  assert.equal(lower.status, 200);
  assert.equal(lower.body.total, 1);
  assert.deepEqual(lower.body.items.map(row => row.id), [adminId]);
  assert.equal((await request(endpoint + '?view=management', {auth: lowerCookie})).status, 403);
  assert.equal((await request(endpoint + '/' + encodeURIComponent(ownId) + '?view=management', {auth: lowerCookie})).status, 403);
  assert.equal((await request(endpoint + '?employeeId=' + staff, {auth: lowerCookie})).status, 403);
  assert.equal((await request(endpoint + '/' + encodeURIComponent(ownId), {auth: lowerCookie})).status, 404);

  const filtered = await request(endpoint + '?month=2026-07&limit=1&offset=0', {auth: staffCookie});
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.items[0].id, ownId);
  const paged = await request(endpoint + '?limit=1&offset=1', {auth: staffCookie});
  assert.equal(paged.body.items[0].id, ownId);
  for (const query of ['month=2026-13', 'month=bad', 'limit=0', 'limit=101', 'limit=', 'offset=-1', 'offset=0.5', 'employeeId=']) {
    assert.equal((await request(endpoint + '?' + query, {auth: staffCookie})).status, 400, 'Invalid request must fail: ' + query);
  }
  for (const auth of [staffCookie, adminCookie]) {
    for (const route of [endpoint + '?view=unknown', endpoint + '/' + encodeURIComponent(adminId) + '?view=unknown']) {
      const result = await request(route, {auth});
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'invalid_historical_archive_view');
    }
  }
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    for (const route of [endpoint, endpoint + '/' + encodeURIComponent(ownId)]) {
      const result = await request(route, {auth: adminCookie, method});
      assert.equal(result.status, 405);
      assert.equal(result.body.error, 'historical_archive_readonly');
    }
  }

  const after = snapshot();
  assert.deepEqual(after.tables, before.tables, 'Archive reads and rejected mutations must leave every logical table unchanged');
  assert.equal(after.hash, before.hash);
  let network = '';
  try { network = await readFile(networkLog, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(network, '', 'No calendar, AI, Feishu or message request may be attempted');
  const result = {ok: true, requests, anonymous401: true, external410: true, selfOnly: true, managementScope: true,
    managerDefaultsToSelf: true, explicitManagementRequired: true, invalidViewRejected: true,
    employeePerspectiveRestricted: true, readonlyMethods405: true, hiddenRecord404: true,
    exactUrlDecoding: true, privateNoStore: true, allTablesUnchanged: true, outboundRequests: 0, artifacts};
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2), {mode: 0o600});
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(path.join(artifacts, 'server.log'), logs, {mode: 0o600});
  console.error('Synthetic server log retained:', path.join(artifacts, 'server.log'));
  throw error;
} finally {
  if (server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    await stopped;
  }
  console.log('Test artifacts retained:', artifacts);
}
