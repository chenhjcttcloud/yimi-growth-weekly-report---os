import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(rootDir, 'outputs/tests'), { recursive: true });
const dir = await mkdtemp(path.join(rootDir, 'outputs/tests/scoring360-api-'));
const db = path.join(dir, 'test.sqlite'), data = path.join(dir, 'data');
await mkdir(data);
const sql = (statement, json = false) => {
  const result = spawnSync('sqlite3', ['-bail', ...(json ? ['-json'] : []), db], { input: statement, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return json ? JSON.parse(result.stdout || '[]') : result.stdout.trim();
};
sql(await readFile(path.join(rootDir, 'db/schema.sql'), 'utf8'));
sql(`INSERT INTO employees(user_id,name,department) VALUES
 ('manager','测试管理员','管理部'),('departed','停用同事','管理部'),
 ('staff-a','员工甲','测试团队'),('staff-b','员工乙','测试团队'),('peer','测试同事','测试团队');
 INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at)
 VALUES('historical-cycle','历史评分','2026-06-01','2026-06-30','open','2026-06-01T00:00:00Z');
 INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id)
 VALUES('old-relation','historical-cycle','员工甲','测试同事','staff-a','peer');`);
for (const name of ['prototypeData', 'scoring360', 'kimiInsights', 'kimiInsightsByPeriod', 'monthlyMeetingInsights']) {
  const fixture = name === 'prototypeData' ? { meta: { periods: [] }, employee_summary: [], weekly_scores: [] }
    : name === 'scoring360' ? { cycles: [], assignments: [], responses: [] } : {};
  await writeFile(path.join(data, name + '.json'), JSON.stringify(fixture));
}
// Block all server-side network access, including accidental requests using ambient credentials.
await writeFile(path.join(dir, 'guard.mjs'), `import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(path.join(dir, 'network.log'))},'blocked\\n');throw Error('fixture_external_network_forbidden');};`);
const port = 18100 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`;
const secret = 'isolated-scoring360-api-secret', names = { manager: '测试管理员', peer: '测试同事' };
const cookie = id => {
  const body = Buffer.from(JSON.stringify({ user: { userId: id, name: names[id] || id }, issuedAt: Date.now(), sessionId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() })).toString('base64url');
  return 'wos_session=' + body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
};
const snapshot = () => JSON.stringify(['scoring360_cycles', 'scoring360_assignments', 'scoring360_responses', 'monthly_review_plans'].map(table => sql(`SELECT * FROM ${table} ORDER BY rowid;`, true)));
let server, logs = '';
async function request(route, body, id = 'manager') {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: cookie(id), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function ok(route, body, id) {
  const result = await request(route, body, id);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.notEqual(result.body.ok, false, JSON.stringify(result));
  return result.body;
}
try {
  server = spawn(process.execPath, ['--import', path.join(dir, 'guard.mjs'), 'server/index.mjs'], {
    cwd: rootDir,
    env: { ...process.env, AUTH_MODE: 'feishu', SESSION_SECRET: secret, SERVER_PORT: String(port), BASE_URL: base,
      APP_DATA_DIR: data, WEEKLY_REPORT_DB_PATH: db, WEEKLY_REPORT_UPLOAD_DIR: dir + '/uploads', BACKUP_DIR: dir + '/backups',
      SCORING360_ACTIVE_DATE: '2099-08-25T10:00:00+08:00', SCORING360_CONFIG_MANAGER_USER_IDS: 'manager', SCORING360_CONFIG_MANAGER_NAMES: '', BOSS_VIEW_USER_IDS: '', BOSS_VIEW_NAMES: '', DEV_VIEW_SWITCH_ENABLED: 'false',
      LARK_REPORT_SYNC_STATUS_PATH: dir + '/sync.json', CHINA_CALENDAR_AUTO_UPDATE_ENABLED: 'false', LARK_REPORT_AUTO_SYNC_ENABLED: 'false', LARK_AUTH_MONITOR_ENABLED: 'false', SCORING360_REMINDER_ENABLED: 'false', WEEKLY_REMINDER_ENABLED: 'false', WEEKLY_UPDATE_REMINDER_ENABLED: 'false',
      FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', FEISHU_EVENT_VERIFICATION_TOKEN: '', FEISHU_EVENT_ENCRYPT_KEY: '', MOONSHOT_API_KEY: '', KIMI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => logs += chunk); server.stderr.on('data', chunk => logs += chunk);
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.equal(server.exitCode, null, logs);
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'isolated server becomes healthy');
  const me = await ok('/api/me');
  assert.equal(me.user.userId, 'manager');
  assert.equal(me.access.role, 'system_admin');
  for (const capability of ['bossView', 'canManageScoring360', 'canManagePersonnel', 'canViewSettings']) assert.equal(me.access[capability], true);
  assert.equal(me.access.currentEmployee.userId, 'manager');
  assert.equal((await request('/api/employees/manage', { userId: 'unexpected', name: '不得新增' })).status, 405, 'production roster is SSO managed');
  await ok('/api/employees/manage/status', { userId: 'departed', active: false });
  const overview = await ok('/api/scoring360');
  assert.equal(overview.cycle.id, 'historical-cycle');
  assert(overview.evaluatorOptions.includes('manager'));
  assert(!overview.evaluatorOptions.includes('departed'));

  const before = snapshot();
  const preview = await ok('/api/scoring360/reminders/send', { kind: 'launch', dryRun: true });
  assert.equal(preview.cycle, null); assert.equal(preview.requiresConfiguration, true); assert.equal(preview.count, 0);
  assert.equal(snapshot(), before, 'an unconfigured preview never prepares a month or copies old assignments');
  const notPrepared = await request('/api/scoring360/reminders/send', { kind: 'launch', dryRun: false });
  assert.equal(notPrepared.status, 409); assert.equal(notPrepared.body.error, 'scoring_cycle_not_prepared'); assert.equal(snapshot(), before);

  const cycleId = '2099-08-360';
  const prepared = await ok('/api/scoring360/cycle', { action: 'prepare' });
  assert.equal(prepared.cycle.id, cycleId); assert.equal(prepared.cycle.status, 'draft');
  assert.equal(sql(`SELECT count(*) AS n FROM scoring360_assignments WHERE cycle_id='${cycleId}';`, true)[0].n, 0);
  const emptyOpen = await request('/api/scoring360/cycle', { action: 'open' });
  assert.equal(emptyOpen.status, 409); assert.equal(emptyOpen.body.error, 'scoring_assignments_required');
  const assignments = [];
  for (const [evalueeUserId, evaluatorUserId] of [['staff-a', 'manager'], ['staff-a', 'peer'], ['staff-b', 'manager']]) {
    assignments.push((await ok('/api/scoring360/assignments', { cycleId, evalueeUserId, evaluatorUserId })).assignment.id);
  }
  assert.equal(sql(`SELECT count(*) AS n FROM scoring360_assignments WHERE cycle_id='${cycleId}';`, true)[0].n, 3);
  const configured = snapshot();
  const configuredPreview = await ok('/api/scoring360/reminders/send', { cycleId, kind: 'launch', dryRun: true });
  assert.equal(configuredPreview.cycle.status, 'draft'); assert.equal(configuredPreview.count, 2); assert.equal(configuredPreview.sent, 0);
  assert.equal(snapshot(), configured, 'configured previews preserve assignments and schedule');
  const reminderStatus = await ok('/api/scoring360/reminders?cycleId=' + cycleId);
  assert.equal(reminderStatus.schedule.followupHours, 24); assert.equal(reminderStatus.schedule.dueHours, 48);
  assert.equal(reminderStatus.pending.length, 2);
  const targeted = await ok('/api/scoring360/reminders/send', { cycleId, kind: 'followup', dryRun: true, evaluatorUserId: 'manager' });
  assert.equal(targeted.count, 1); assert.equal(targeted.results[0].recipient.evaluatorUserId, 'manager');
  assert.equal(snapshot(), configured);
  assert.equal((await ok('/api/scoring360')).cycle.id, overview.cycle.id, 'preview keeps the existing active cycle');
  const draftTasks = await ok('/api/scoring360/my-tasks?cycleId=' + cycleId);
  assert.equal(draftTasks.cycleId, cycleId); assert.equal(draftTasks.tasks.length, 2);
  assert(draftTasks.tasks.every(task => !task.submitted && task.locked));
  const draftSubmit = await request('/api/scoring360/submit', { cycleId, scores: [{ assignmentId: assignments[0], score: 80, comment: '有效评价内容' }] });
  assert.equal(draftSubmit.status, 409); assert.equal(draftSubmit.body.error, 'scoring_cycle_not_open');
  const opened = await ok('/api/scoring360/cycle', { action: 'open' });
  assert.equal(opened.cycle.status, 'open'); assert.equal(opened.messagesSent, 0);
  assert.equal((await ok('/api/scoring360/my-tasks?cycleId=' + cycleId)).tasks.length, 2);
  assert.equal(sql("SELECT count(*) AS n FROM scoring360_reminder_sends WHERE status IN('sent','pending','uncertain');", true)[0].n, 0);
  assert.equal(await readFile(dir + '/network.log', 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; }), '');
  assert.equal(sql('PRAGMA integrity_check;'), 'ok');
  const result = { ok: true, isolatedFeishuSessions: true, ssoRosterOnly: true, manualAssignmentsOnly: true, unconfiguredPreviewReadOnly: true, targetedPreview: true, draftSubmissionRejected: true, explicitOpen: true, externalRequests: 0, realMessagesSent: 0, artifacts: dir };
  await writeFile(dir + '/result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { console.error(logs); throw error; }
finally {
  if (server?.exitCode === null) { server.kill('SIGTERM'); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
  await writeFile(dir + '/server.log', logs); console.log('Artifacts retained:', dir);
}
