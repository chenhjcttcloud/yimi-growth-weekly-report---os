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
const artifacts = await mkdtemp(path.join(root, 'outputs/tests/legacy-report-snapshot-api-'));
const secret = 'fixture-only-legacy-snapshot';
const endpoint = '/api/legacy-report-snapshot';
const privateMarker = 'PRIVATE_SNAPSHOT_IDENTITY_EMAIL_PATH_AND_HASH';
const boss = 'snapshot-boss', manager = 'snapshot-manager', staff = 'snapshot-member';
const duplicate = {'姓名': '合成甲', '部门': '合成部门', '周次': '2026年六月第二周', '开始日期': '2026-06-08', '结束日期': '2026-06-12',
  '提交时间': '2026-06-12 19:00', '状态': '准时', '本周成果摘要': '合成关键词甲成果', '问题摘要': '合成问题', '下周计划摘要': '合成计划', '思考与复盘摘要': '',
  '成果分': 80, '问题分': 70, '计划分': 90, '复盘分': 0, '总分': 76.125, '准时分': 100, '等级': 'B',
  open_id: privateMarker, '企业邮箱': privateMarker, sourcePath: privateMarker, '源记录ID': 'legacy-source-duplicate', unknownObject: {secret: privateMarker}};
const records = [duplicate, structuredClone(duplicate),
  {'姓名': '合成乙', '周次': '六月第二周', '状态': '旧版保存', '本周成果摘要': '无年份汇报内容', '总分': 0, open_id: privateMarker},
  {'状态': '未交', '本周成果摘要': '', '问题摘要': '', '下周计划摘要': '', '思考与复盘摘要': '', unknown: privateMarker},
  {'姓名': '', '部门': null, '周次': '异常周次'.repeat(22), '总分': '异常原值', '本周成果摘要': {note: '合成异常原值', open_id: privateMarker, sourcePath: privateMarker}, internalPath: privateMarker},
  {'姓名': '合成甲', '部门': '另一合成部门', '周次': '2025年旧记录', '本周成果摘要': '较早的独立合成内容', '总分': 91, '源记录ID': 'legacy-source-verified'}];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const recordsSha = digest(records);
const originalSnapshotValue = {version: 1, purpose: 'legacy-weekly-report-snapshot', sourceSha256: 'a'.repeat(64), recordsSha256: recordsSha, records};
const ownerStatuses = ['existing', 'existing', 'unknown', 'unknown', 'unknown', 'verified'];
const snapshotValue = {...originalSnapshotValue, ownership: {version: 1, recordsSha256: recordsSha,
  referenceSha256: 'd'.repeat(64), statusesSha256: digest(ownerStatuses), statuses: ownerStatuses}};
const withOwnerStatuses = statuses => ({...snapshotValue, ownership: {...snapshotValue.ownership, statuses, statusesSha256: digest(statuses)}});
const idAt = index => `reportos-original:${recordsSha}:${index}`;
const instances = [];
let requestCount = 0;

function cookie(userId, {employeePerspective = false, claimedRole} = {}) {
  const sign = value => {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
  };
  const issuedAt = Date.now(), sessionId = randomUUID();
  const token = 'wos_session=' + sign({user: {userId, name: '合成账号 ' + userId, ...(claimedRole ? {role: claimedRole} : {})},
    sessionId, issuedAt, expiresAt: new Date(issuedAt + 3600000).toISOString()});
  return employeePerspective ? token + '; wos_perspective=' + sign({purpose: 'session-perspective', sessionId, perspective: 'employee'}) : token;
}

function snapshotDatabase(filename) {
  const database = new DatabaseSync(filename, {readOnly: true});
  try {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return tables.map(({name}) => [name, database.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all().map(row => JSON.stringify(row)).sort()]);
  } finally { database.close(); }
}

async function optionalText(filename) {
  try { return await readFile(filename, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

async function startFixture(label, value) {
  const directory = path.join(artifacts, label), data = path.join(directory, 'data'), databasePath = path.join(directory, 'fixture.sqlite');
  await mkdir(data, {recursive: true});
  const sourceFiles = {};
  for (const [name, json] of Object.entries({
    prototypeData: {meta: {periods: [], collectionStartDate: '2026-01-01'}, employee_summary: [], weekly_scores: []},
    scoring360: {cycles: [], assignments: [], responses: []}, kimiInsights: {}, kimiInsightsByPeriod: {}, monthlyMeetingInsights: {},
  })) {
    const filename = path.join(data, name + '.json');
    sourceFiles[filename] = JSON.stringify(json);
    await writeFile(filename, sourceFiles[filename], {mode: 0o600});
  }
  if (value !== undefined) {
    const filename = path.join(data, 'legacyReportSnapshot.json');
    sourceFiles[filename] = typeof value === 'string' ? value : JSON.stringify(value);
    await writeFile(filename, sourceFiles[filename], {mode: 0o600});
  }
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(await readFile(path.join(root, 'db/schema.sql'), 'utf8'));
    database.exec(await readFile(path.join(root, 'server/historical-report-archive-schema.sql'), 'utf8'));
    const employee = database.prepare('INSERT INTO employees(user_id,name,department,is_active) VALUES(?,?,?,1)');
    for (const id of [boss, manager, staff]) employee.run(id, '合成账号 ' + id, '合成部门');
    const setting = database.prepare('INSERT INTO app_settings(key,value_json) VALUES(?,?)');
    for (const [key, json] of Object.entries({
      boss_view_members: {members: [{userId: boss, name: '合成老板'}]},
      scoring360_admin_members: {members: [{userId: manager, name: '合成管理员'}]},
      report_automation_config: {enabled: false, intervalMinutes: 15},
      operations_config: {backupEnabled: false, alertsEnabled: false, backupTime: '03:00', recipientUserIds: [], diskWarningPercent: 85},
      scoring360_recurring_config: {enabled: false}, monthly_score_reminder_config: {enabled: false, startMonth: '2099-01', time: '10:00'},
    })) setting.run(key, JSON.stringify(json));
    database.prepare(`INSERT INTO weekly_reports(id,employee_user_id,employee_name,department,week_label,week_start,week_end,status,content_json,submitted_at)
      VALUES('snapshot-live-sentinel',?,'合成账号','合成部门','合成现役周报','2026-10-05','2026-10-09','准时',?,'2026-10-09T10:00:00Z')`).run(staff, JSON.stringify({results: privateMarker}));
    database.prepare(`INSERT INTO automatic_performance_results(id,month,employee_user_id,employee_name,kind,calculation_hash,result_json,evidence_json,calculated_at)
      VALUES('snapshot-score-sentinel','2026-10',?,'合成账号','timeliness','fixture-score-hash','{"rate":88}','{}','2026-10-31T10:00:00Z')`).run(staff);
    database.prepare(`INSERT INTO historical_report_archives
      (id,source_system,source_report_id,employee_user_id,employee_name,department,week_label,week_start,week_end,submitted_at,status,content_json,provenance_json,source_sha256,import_batch_id,archived_at)
      VALUES('reportos:snapshot-existing-archive','reportos','snapshot-existing-archive',?,'合成账号','合成部门','合成历史补档','2026-06-08','2026-06-12','2026-06-12 19:00','准时',?,'{}',?,'synthetic-batch','2026-11-26T08:00:00Z')`).run(staff, JSON.stringify({'本周成果摘要': privateMarker, '总分': 66}), 'b'.repeat(64));
  } finally { database.close(); }
  const guard = path.join(directory, 'guard.mjs'), networkLog = path.join(directory, 'network.log'), prototypeReads = path.join(directory, 'prototype-reads.log');
  await writeFile(guard, `import fs from 'node:fs';import fsp from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const record=value=>{if(String(value).endsWith('/prototypeData.json'))fs.appendFileSync(${JSON.stringify(prototypeReads)},'prototype read\\n');};
const syncRead=fs.readFileSync;fs.readFileSync=function(file,...args){record(file);return syncRead.call(this,file,...args);};
const asyncRead=fsp.readFile;fsp.readFile=async function(file,...args){record(file);return asyncRead.call(this,file,...args);};syncBuiltinESMExports();
globalThis.fetch=async()=>{fs.appendFileSync(${JSON.stringify(networkLog)},'blocked outbound request\\n');throw Error('fixture_external_network_forbidden');};
`, {mode: 0o600});
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const env = {
    PATH: process.env.PATH, HOME: directory, LANG: 'en_US.UTF-8', AUTH_MODE: 'feishu', SESSION_SECRET: secret,
    SESSION_TTL_HOURS: '24', SERVER_PORT: String(port), BASE_URL: base, APP_DATA_DIR: data,
    WEEKLY_REPORT_DB_PATH: databasePath, WEEKLY_REPORT_UPLOAD_DIR: path.join(directory, 'uploads'), BACKUP_DIR: path.join(directory, 'backups'),
    STATIC_DIR: path.join(directory, 'static'), LARK_REPORT_SYNC_STATUS_PATH: path.join(directory, 'sync-status.json'),
    BOSS_VIEW_USER_IDS: '', BOSS_VIEW_NAMES: '', BOSS_EMPLOYEE_PERSPECTIVE_USER_IDS: boss,
    SCORING360_CONFIG_MANAGER_USER_IDS: '', SCORING360_CONFIG_MANAGER_NAMES: '',
    CHINA_CALENDAR_AUTO_UPDATE_ENABLED: 'false', DEV_VIEW_SWITCH_ENABLED: 'false', LARK_REPORT_AUTO_SYNC_ENABLED: 'false',
    LARK_AUTH_MONITOR_ENABLED: 'false', SCORING360_REMINDER_ENABLED: 'false', SCORING360_LAUNCH_MODE: 'manual',
    WEEKLY_REMINDER_ENABLED: 'false', WEEKLY_UPDATE_REMINDER_ENABLED: 'false', FEISHU_TASK_CREATE_ENABLED: 'false',
    FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', MOONSHOT_API_KEY: '', KIMI_API_KEY: '', PRODUCT_MANAGEMENT_SCORE_API_TOKEN: '',
    FEISHU_EVENT_VERIFICATION_TOKEN: '', FEISHU_EVENT_ENCRYPT_KEY: '',
  };
  const child = spawn(process.execPath, ['--import', guard, 'server/index.mjs'], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
  const instance = {label, directory, databasePath, data, base, child, networkLog, prototypeReads, sourceFiles, logs: ''};
  instances.push(instance);
  child.stdout.on('data', value => instance.logs += value);
  child.stderr.on('data', value => instance.logs += value);
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw Error('Synthetic server exited before readiness: ' + label);
    try { if ((await fetch(base + '/health', {signal: AbortSignal.timeout(1000)})).ok) { ready = true; break; } } catch {}
    await pause(100);
  }
  assert(ready, 'Synthetic fixture must start: ' + label);
  await pause(300);
  instance.baseline = snapshotDatabase(databasePath);
  instance.prototypeBaseline = await optionalText(prototypeReads);
  assert(instance.prototypeBaseline.includes('prototype read'), 'Prototype read instrumentation must observe startup before testing isolation');
  return instance;
}

async function request(instance, route = endpoint, {auth, method = 'GET', headers = {}} = {}) {
  const response = await fetch(instance.base + route, {method, redirect: 'manual', headers: {
    ...(auth ? {cookie: auth} : {}), ...(method === 'GET' ? {} : {origin: instance.base, 'content-type': 'application/json'}), ...headers,
  }, ...(method === 'GET' ? {} : {body: '{}'}), signal: AbortSignal.timeout(5000)});
  const raw = await response.text();
  requestCount++;
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert(!raw.includes(privateMarker), 'Snapshot response must exclude account identities, email, paths, private hashes and arbitrary private fields');
  return {status: response.status, body: JSON.parse(raw), headers: response.headers, raw};
}

async function verifyUnchanged(instance) {
  assert.deepEqual(snapshotDatabase(instance.databasePath), instance.baseline, 'Snapshot queries must not change any logical database table: ' + instance.label);
  for (const [filename, value] of Object.entries(instance.sourceFiles)) assert.equal(await readFile(filename, 'utf8'), value, 'Source JSON must remain unchanged');
  assert.equal(await optionalText(instance.prototypeReads), instance.prototypeBaseline, 'Snapshot API must not load prototypeData after startup');
  assert.equal(await optionalText(instance.networkLog), '', 'Snapshot requests must not call Feishu, AI, calendars or messaging');
}

// Assertions are below the shared fixture helpers so every data/error variant
// uses its own new directory and retains its original inputs without deletion.
try {
  const valid = await startFixture('valid', snapshotValue);
  const bossCookie = cookie(boss), managerCookie = cookie(manager), staffCookie = cookie(staff);
  assert.equal((await request(valid)).status, 401);
  const external = await request(valid, endpoint, {auth: cookie('external:synthetic-snapshot-guest')});
  assert.equal(external.status, 410);
  assert.equal(external.body.error, 'external_access_disabled');
  assert(!external.raw.includes('合成关键词甲成果'));

  for (const query of ['', '?management=true', '?view=management', '?role=boss&employeeId=' + boss,
    '?owner=unknown&management=true&employeeId=legacy-unknown-person', '?owner=legacy-unknown-person',
    '?employeeName=' + encodeURIComponent('合成甲') + '&search=' + encodeURIComponent('合成关键词') + '&limit=100&offset=0',
    '?file=/private/never-read.json&path=/private/never-read.json&sourceSha256=' + 'a'.repeat(64)]) {
    assert.equal((await request(valid, endpoint + query, {auth: staffCookie, headers: {'x-role': 'boss', 'x-management': 'true'}})).status, 403);
  }
  assert.equal((await request(valid, endpoint + '/' + encodeURIComponent(idAt(0)), {auth: staffCookie})).status, 403);
  assert.equal((await request(valid, endpoint, {auth: cookie(staff, {claimedRole: 'boss'})})).status, 403, 'Claimed role text cannot replace a configured management grant');
  assert.equal((await request(valid, endpoint + '?owner=unknown', {auth: cookie('legacy-unknown-person')})).status, 403, 'An archive owner group is not an authentication account');
  assert.equal((await request(valid, endpoint, {auth: cookie(boss, {employeePerspective: true})})).status, 403);
  assert.equal((await request(valid, endpoint + '/' + encodeURIComponent(idAt(0)), {auth: cookie(boss, {employeePerspective: true})})).status, 403);

  const listing = await request(valid, endpoint, {auth: managerCookie});
  assert.equal(listing.status, 200);
  assert.match(listing.headers.get('cache-control') || '', /private/);
  assert.equal(listing.body.total, records.length);
  assert.equal(listing.body.snapshotTotal, records.length);
  assert.equal(listing.body.ownershipReady, true);
  assert.equal(listing.body.ownerTotal, records.length);
  const groupCounts = Object.fromEntries(listing.body.ownerGroups.map(group => [group.key, group.count]));
  assert.deepEqual(groupCounts, {all: 6, unknown: 3, existing: 2, verified: 1, unreviewed: 0});
  assert(listing.body.ownerGroups.every(group => typeof group.label === 'string' && group.label));
  assert.deepEqual(new Set(listing.body.items.map(item => item.id)), new Set(records.map((_, index) => idAt(index))));
  assert.deepEqual(listing.body.names, ['合成甲', '合成乙']);
  assert.equal(listing.body.readOnly, true);
  assert.equal(listing.body.affectsPerformance, false);
  assert(!listing.raw.includes('合成关键词甲成果'), 'List summaries must not bulk-return original report text');
  assert(!listing.raw.includes(snapshotValue.sourceSha256), 'Raw source file hash stays out of the API');
  assert.deepEqual(Object.keys(listing.body.items[0]).sort(), ['id', 'sourceRow', 'employeeName', 'department', 'weekLabel', 'weekStart', 'weekEnd', 'submittedAt', 'status', 'oldScore', 'owner', 'warnings'].sort());
  for (const item of listing.body.items) {
    const index = item.sourceRow - 1, old = records[index];
    assert.equal(item.owner.kind, ownerStatuses[index]);
    assert.equal(item.owner.virtual, true);
    assert.equal(item.employeeName, typeof old['姓名'] === 'string' ? old['姓名'] : '');
    assert.equal(item.weekStart, typeof old['开始日期'] === 'string' ? old['开始日期'] : '');
    assert.equal(item.weekEnd, typeof old['结束日期'] === 'string' ? old['结束日期'] : '');
    if (item.owner.kind === 'unknown') assert.equal(item.owner.id, 'legacy-unknown-person');
  }
  assert.equal((await request(valid, endpoint, {auth: bossCookie})).body.total, records.length);

  const unknown = await request(valid, endpoint + '?owner=unknown', {auth: managerCookie});
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.ownerTotal, 3);
  assert.equal(unknown.body.total, 3);
  assert.equal(unknown.body.snapshotTotal, records.length);
  assert.deepEqual(unknown.body.items.map(item => item.id), [idAt(2), idAt(3), idAt(4)], 'Unknown grouping excludes both already-existing and verified records');
  assert.deepEqual(unknown.body.names, ['合成乙']);
  assert.deepEqual(unknown.body.ownerGroups, listing.body.ownerGroups, 'Group counts remain global rather than shrinking with the selected group');
  assert(unknown.body.items.every(item => item.owner.kind === 'unknown' && item.owner.id === 'legacy-unknown-person'));
  const unknownFiltered = await request(valid, endpoint + '?' + new URLSearchParams({owner: 'unknown', employeeName: '合成乙', search: '无年份', limit: '1', offset: '0'}), {auth: managerCookie});
  assert.equal(unknownFiltered.body.total, 1);
  assert.equal(unknownFiltered.body.ownerTotal, 3, 'ownerTotal is calculated before name, keyword and pagination filters');
  assert.deepEqual(unknownFiltered.body.items.map(item => item.id), [idAt(2)]);
  const unknownPage = await request(valid, endpoint + '?owner=unknown&limit=1&offset=1', {auth: managerCookie});
  assert.equal(unknownPage.body.total, 3);
  assert.equal(unknownPage.body.ownerTotal, 3);
  assert.deepEqual(unknownPage.body.items.map(item => item.id), [idAt(3)]);
  const existing = await request(valid, endpoint + '?owner=existing', {auth: managerCookie});
  assert.deepEqual(existing.body.items.map(item => item.id), [idAt(0), idAt(1)]);
  const verified = await request(valid, endpoint + '?owner=verified', {auth: managerCookie});
  assert.deepEqual(verified.body.items.map(item => item.id), [idAt(5)]);
  assert.equal((await request(valid, endpoint + '?owner=unreviewed', {auth: managerCookie})).body.total, 0);
  const ignoredEmployeeId = await request(valid, endpoint + '?owner=unknown&employeeId=legacy-unknown-person', {auth: managerCookie});
  assert.equal(ignoredEmployeeId.body.total, 3, 'A virtual group ID is not resolved as a real employee ID');

  const byName = await request(valid, endpoint + '?' + new URLSearchParams({employeeName: '合成甲'}), {auth: managerCookie});
  assert.equal(byName.status, 200);
  assert.equal(byName.body.total, 3);
  assert.equal(byName.body.snapshotTotal, records.length);
  assert.equal(byName.body.ownerTotal, records.length);
  assert(byName.body.items.every(item => item.employeeName === '合成甲'));
  const search = await request(valid, endpoint + '?' + new URLSearchParams({search: '合成关键词甲成果'}), {auth: managerCookie});
  assert.equal(search.body.total, 2);
  assert.deepEqual(search.body.items.map(item => item.id), [idAt(0), idAt(1)], 'Identical old rows retain separate stable row IDs');
  const combined = await request(valid, endpoint + '?' + new URLSearchParams({employeeName: '合成乙', search: '合成关键词'}), {auth: managerCookie});
  assert.equal(combined.body.total, 0);
  const paged = await request(valid, endpoint + '?limit=2&offset=2', {auth: managerCookie});
  assert.equal(paged.body.total, records.length);
  assert.equal(paged.body.items.length, 2);
  assert.deepEqual(paged.body.items.map(item => item.id), listing.body.items.slice(2, 4).map(item => item.id));
  const noYear = listing.body.items.find(item => item.id === idAt(2));
  assert.equal(noYear.weekLabel, '六月第二周');
  assert.equal(noYear.weekStart, '');
  assert.equal(noYear.weekEnd, '');
  assert.equal(noYear.oldScore, 0);
  assert(noYear.warnings.some(value => value.includes('年份未推定')));
  const abnormal = listing.body.items.find(item => item.id === idAt(4));
  assert.equal(abnormal.weekLabel, records[4]['周次']);
  assert(abnormal.warnings.includes('周次原文格式待核验'));
  assert.equal(abnormal.oldScore, null);
  assert.equal(listing.body.items.find(item => item.id === idAt(3)).employeeName, '', 'Unassigned source rows stay visible instead of receiving a guessed employee');

  const first = await request(valid, endpoint + '/' + encodeURIComponent(idAt(0)), {auth: managerCookie});
  assert.equal(first.status, 200);
  assert.equal(first.body.record.id, idAt(0));
  assert.equal(first.body.record.sourceRow, 1);
  assert.equal(first.body.record.facts.results, duplicate['本周成果摘要']);
  assert.equal(first.body.record.facts.reflection, '');
  assert.equal(first.body.record.legacyScores.total, 76.125);
  assert.equal(first.body.record.owner.kind, 'existing');
  const second = await request(valid, endpoint + '/' + encodeURIComponent(idAt(1)), {auth: managerCookie});
  assert.equal(second.status, 200);
  assert.equal(second.body.record.sourceRow, 2);
  assert.deepEqual(second.body.record.facts, first.body.record.facts);
  const odd = await request(valid, endpoint + '/' + encodeURIComponent(idAt(4)), {auth: managerCookie});
  assert.equal(odd.status, 200);
  assert.equal(odd.body.record.owner.id, 'legacy-unknown-person');
  assert.equal(odd.body.record.employeeName, '');
  assert.equal(odd.body.record.facts.results, '');
  assert.equal(odd.body.record.savedFields.find(field => field.label === '本周成果摘要').value, '（原字段格式异常，已留存待核验）', 'Nested identity and private-path data must not escape through an allowed business field');
  assert.equal(odd.body.record.savedFields.find(field => field.label === '总分').value, '异常原值');
  for (const field of first.body.record.savedFields) assert(!['open_id', '企业邮箱', 'sourcePath', 'unknownObject'].includes(field.label));
  for (const id of [`reportos-original:${'b'.repeat(64)}:0`, idAt(99999), 'reportos-original:missing', 'reportos-original:' + recordsSha + ':01']) {
    assert.equal((await request(valid, endpoint + '/' + encodeURIComponent(id), {auth: managerCookie})).status, 404);
  }
  assert.equal((await request(valid, endpoint + '/%ZZ', {auth: managerCookie})).status, 400);
  assert.equal((await request(valid, endpoint + '/unescaped/extra', {auth: managerCookie})).status, 404);
  for (const query of ['limit=0', 'limit=101', 'offset=-1', 'offset=0.5', 'employeeName=', 'employeeName=%20' + encodeURIComponent('合成甲'), 'search=' + 'x'.repeat(201), 'owner=invalid', 'owner=legacy-unknown-person']) {
    assert.equal((await request(valid, endpoint + '?' + query, {auth: managerCookie})).status, 400);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const route of [endpoint, endpoint + '/' + encodeURIComponent(idAt(0))]) {
      const denied = await request(valid, route, {auth: managerCookie, method});
      assert.equal(denied.status, 405);
      assert.equal(denied.body.error, 'legacy_snapshot_readonly');
    }
  }
  await verifyUnchanged(valid);

  const missing = await startFixture('missing', undefined);
  const empty = await request(missing, endpoint, {auth: managerCookie});
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.items, []);
  assert.deepEqual(empty.body.names, []);
  assert.equal(empty.body.total, 0);
  assert.equal(empty.body.snapshotTotal, 0);
  assert.equal(empty.body.ownershipReady, false);
  assert.equal(empty.body.ownerTotal, 0);
  assert(empty.body.ownerGroups.every(group => group.count === 0));
  assert.equal((await request(missing, endpoint + '/' + encodeURIComponent(idAt(0)), {auth: managerCookie})).status, 404);
  await verifyUnchanged(missing);

  const unreviewed = await startFixture('unreviewed-without-metadata', originalSnapshotValue);
  const pending = await request(unreviewed, endpoint, {auth: managerCookie});
  assert.equal(pending.status, 200);
  assert.equal(pending.body.ownershipReady, false);
  assert.equal(pending.body.total, records.length);
  assert.equal(pending.body.ownerTotal, records.length);
  assert.deepEqual(Object.fromEntries(pending.body.ownerGroups.map(group => [group.key, group.count])), {all: 6, unknown: 0, existing: 0, verified: 0, unreviewed: 6});
  assert(pending.body.items.every(item => item.owner.kind === 'unreviewed' && item.owner.virtual === true));
  const pendingUnknown = await request(unreviewed, endpoint + '?owner=unknown', {auth: managerCookie});
  assert.equal(pendingUnknown.body.ownershipReady, false);
  assert.equal(pendingUnknown.body.total, 0);
  assert.equal(pendingUnknown.body.ownerTotal, 0);
  const pendingDetail = await request(unreviewed, endpoint + '/' + encodeURIComponent(idAt(0)), {auth: managerCookie});
  assert.equal(pendingDetail.body.record.owner.kind, 'unreviewed');
  assert.equal(pendingDetail.body.record.employeeName, duplicate['姓名']);
  await verifyUnchanged(unreviewed);

  const invalidInputs = [
    ['corrupt', '{' + privateMarker],
    ['hash-mismatch', {...snapshotValue, recordsSha256: 'c'.repeat(64)}],
    ['invalid-row-shape', {...snapshotValue, records: [null], recordsSha256: digest([null])}],
    ['ownership-records-binding', {...snapshotValue, ownership: {...snapshotValue.ownership, recordsSha256: 'b'.repeat(64)}}],
    ['ownership-reference-digest', {...snapshotValue, ownership: {...snapshotValue.ownership, referenceSha256: privateMarker}}],
    ['ownership-status-digest', {...snapshotValue, ownership: {...snapshotValue.ownership, statusesSha256: 'f'.repeat(64)}}],
    ['ownership-length', withOwnerStatuses(ownerStatuses.slice(0, -1))],
    ['ownership-invalid-kind', withOwnerStatuses(['existing', 'existing', 'unreviewed', 'unknown', 'unknown', 'verified'])],
    ['ownership-missing-source-cannot-be-existing', withOwnerStatuses(['existing', 'existing', 'existing', 'unknown', 'unknown', 'verified'])],
    ['ownership-duplicate-source-conflict', withOwnerStatuses(['existing', 'verified', 'unknown', 'unknown', 'unknown', 'verified'])],
  ];
  for (const [label, value] of invalidInputs) {
    const broken = await startFixture(label, value);
    for (const route of [endpoint, endpoint + '/' + encodeURIComponent(idAt(0))]) {
      const error = await request(broken, route, {auth: managerCookie});
      assert.equal(error.status, 500);
      assert.deepEqual(error.body, {ok: false, error: 'legacy_snapshot_unavailable'});
      assert(!error.raw.includes(broken.data));
      assert(!error.raw.includes(snapshotValue.sourceSha256));
      assert(!error.raw.includes(recordsSha));
    }
    assert.equal((await request(broken, endpoint + '?management=true', {auth: staffCookie})).status, 403, 'Access control runs before parsing invalid private data');
    await verifyUnchanged(broken);
  }
  const result = {ok: true, requests: requestCount, syntheticInstances: instances.length,
    configuredManagersOnly: true, anonymous401: true, staff403: true, external410: true, employeePerspective403: true,
    readonlyMethods405: true, missingSnapshotEmpty: true, invalidSnapshotGeneric500: true,
    filtersAndPagination: true, duplicatesRetained: true, yearNotInferred: true, abnormalRowsRetained: true,
    verifiedOwnershipGroups: true, unknownVirtualGroupOnly: true, ownershipMetadataBindingsValidated: true,
    absentOwnershipRemainsUnreviewed: true, virtualOwnerIsNotAccount: true,
    privateWhitelist: true, noPrototypeReadsAfterStartup: true, allTablesUnchanged: true, outboundRequests: 0, artifacts};
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2), {mode: 0o600});
  console.log(JSON.stringify(result));
} catch (error) {
  for (const instance of instances) await writeFile(path.join(instance.directory, 'server.log'), instance.logs, {mode: 0o600});
  console.error('Synthetic snapshot API evidence retained:', artifacts);
  throw error;
} finally {
  for (const instance of instances) {
    if (instance.child.exitCode === null) {
      const stopped = once(instance.child, 'exit');
      instance.child.kill('SIGTERM');
      await stopped;
    }
  }
  console.log('Test artifacts retained:', artifacts);
}
