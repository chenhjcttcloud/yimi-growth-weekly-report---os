import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(rootDir, 'outputs/tests'), { recursive: true });
const dir = await mkdtemp(path.join(rootDir, 'outputs/tests/scoring360-admin-api-'));
const db = dir + '/test.sqlite', data = dir + '/data'; await mkdir(data);
const sql = (statement, json = false) => {
  const result = spawnSync('sqlite3', ['-bail', ...(json ? ['-json'] : []), db], { input: statement, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return json ? JSON.parse(result.stdout || '[]') : result.stdout.trim();
};
sql(await readFile(rootDir + '/db/schema.sql', 'utf8'));
sql(`INSERT INTO employees(user_id,name,department,manager_user_id) VALUES
 ('owner','测试老板','管理层',''),('admin','测试管理员','管理层',''),
 ('staff','员工甲','测试团队','head'),('head','测试主管','测试团队',''),
 ('peer','评分同事','其他',''),('member','普通同事','其他','');
 INSERT INTO organization_departments VALUES('team','测试团队','head',datetime('now'));`);
for (const name of ['prototypeData', 'scoring360', 'kimiInsights', 'kimiInsightsByPeriod', 'monthlyMeetingInsights']) {
  await writeFile(data + '/' + name + '.json', JSON.stringify(name === 'prototypeData' ? { meta: { periods: [] }, employee_summary: [], weekly_scores: [] } : name === 'scoring360' ? { cycles: [], assignments: [], responses: [] } : {}));
}
// Retained isolated fixture; no real OAuth credentials, Feishu requests or messages.
await writeFile(dir + '/guard.mjs', `import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(dir + '/network.log')},'blocked\\n');throw Error('fixture_external_network_forbidden');};`);
const port = 18500 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`, secret = 'isolated-scoring360-admin-secret';
const month = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7), cycleId = month + '-360';
const names = { owner: '测试老板', admin: '测试管理员', staff: '员工甲', head: '测试主管', peer: '评分同事', member: '普通同事' };
const cookie = id => {
  const body = Buffer.from(JSON.stringify({ user: { userId: id, name: names[id] }, issuedAt: Date.now(), sessionId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() })).toString('base64url');
  return 'wos_session=' + body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
};
async function request(route, body, id = 'owner', method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + route, { method, headers: { ...(id ? { cookie: cookie(id) } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function ok(route, body, id, method) {
  const result = await request(route, body, id, method); assert.equal(result.status, 200, JSON.stringify(result)); assert.notEqual(result.body.ok, false, JSON.stringify(result)); return result.body;
}
const records = () => JSON.stringify(['scoring360_assignments', 'scoring360_responses', 'monthly_review_plans', 'monthly_manager_scores', 'monthly_person_weighted_results'].map(table => sql(`SELECT * FROM ${table} ORDER BY rowid;`, true)));
const assignments = () => sql(`SELECT * FROM scoring360_assignments WHERE cycle_id='${cycleId}' ORDER BY id;`, true);
let server, logs = '';
try {
  server = spawn(process.execPath, ['--import', dir + '/guard.mjs', 'server/index.mjs'], { cwd: rootDir,
    env: { ...process.env, AUTH_MODE: 'feishu', SESSION_SECRET: secret, SERVER_PORT: String(port), BASE_URL: base,
      APP_DATA_DIR: data, WEEKLY_REPORT_DB_PATH: db, WEEKLY_REPORT_UPLOAD_DIR: dir + '/uploads', BACKUP_DIR: dir + '/backups', SCORING360_ACTIVE_DATE: month + '-25T10:00:00+08:00',
      BOSS_VIEW_USER_IDS: 'owner', BOSS_VIEW_NAMES: '', SCORING360_CONFIG_MANAGER_USER_IDS: '', SCORING360_CONFIG_MANAGER_NAMES: '', DEV_VIEW_SWITCH_ENABLED: 'false',
      LARK_REPORT_SYNC_STATUS_PATH: dir + '/sync.json', CHINA_CALENDAR_AUTO_UPDATE_ENABLED: 'false', LARK_REPORT_AUTO_SYNC_ENABLED: 'false', LARK_AUTH_MONITOR_ENABLED: 'false', SCORING360_REMINDER_ENABLED: 'false', WEEKLY_REMINDER_ENABLED: 'false', WEEKLY_UPDATE_REMINDER_ENABLED: 'false',
      FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', FEISHU_EVENT_VERIFICATION_TOKEN: '', FEISHU_EVENT_ENCRYPT_KEY: '', MOONSHOT_API_KEY: '', KIMI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => logs += chunk); server.stderr.on('data', chunk => logs += chunk);
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.equal(server.exitCode, null, logs);
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'isolated server becomes healthy');
  assert.equal((await request('/api/me', undefined, null)).status, 401);
  assert.equal((await request('/api/employees/manage', undefined, 'member')).status, 403);
  assert.equal((await request('/api/employees/manage/status', { userId: 'staff', active: false }, 'member')).status, 403);
  assert.equal((await request('/api/scoring360-admin-members', { members: [{ userId: 'member' }] }, 'member')).status, 403);
  await ok('/api/scoring360-admin-members', { members: [{ userId: 'admin', name: names.admin, department: '管理层' }] });
  const admin = await ok('/api/me', undefined, 'admin');
  assert.equal(admin.access.role, 'system_admin');
  for (const capability of ['bossView', 'canManageScoring360', 'canManagePersonnel', 'canViewSettings']) assert.equal(admin.access[capability], true);
  assert.equal(admin.access.currentEmployee.userId, 'admin');
  await ok('/api/employees/manage', undefined, 'admin'); await ok('/api/boss-view-members', undefined, 'admin');
  const noCreate = await request('/api/employees/manage', { userId: 'new-staff', name: '新同事' }, 'admin');
  assert.equal(noCreate.status, 405); assert.equal(noCreate.body.error, 'sso_roster_only');
  assert.equal(sql('SELECT count(*) AS n FROM employees;', true)[0].n, 6);

  await ok('/api/scoring360/cycle', { action: 'prepare' }, 'admin');
  assert.equal(assignments().length, 0, 'preparing a month does not guess evaluators');
  const pair = evaluatorUserId => ({ cycleId, evalueeUserId: 'staff', evaluatorUserId });
  assert.equal((await request('/api/scoring360/assignments', pair('peer'), 'member')).status, 403);
  assert.equal((await request('/api/scoring360/assignments', pair('staff'), 'admin')).status, 409);
  const ownerAssignment = (await ok('/api/scoring360/assignments', pair('owner'), 'admin')).assignment.id;
  const peerAssignment = (await ok('/api/scoring360/assignments', pair('peer'), 'admin')).assignment.id;
  await ok('/api/scoring360/assignments', pair('peer'), 'admin'); assert.equal(assignments().length, 2, 'duplicate pairs do not duplicate rows');
  await ok('/api/employees/manage/status', { userId: 'staff', active: false }, 'admin');
  assert(assignments().every(row => row.status === 'inactive'), 'stopping an unused draft cancels unused assignments');
  assert(!(await ok('/api/scoring360/config', undefined, 'admin')).employees.some(employee => employee.userId === 'staff'));
  const inactivePair = await request('/api/scoring360/assignments', pair('peer'), 'admin'); assert.equal(inactivePair.status, 409); assert.equal(inactivePair.body.error, 'inactive_or_unknown_employee');
  assert(!(await ok('/api/scoring360/reminders?cycleId=' + cycleId, undefined, 'admin')).pending.some(recipient => recipient.pendingNames.includes(names.staff)));
  assert.equal((await request('/api/employees/manage', { userId: 'staff', name: names.staff }, 'admin')).status, 405, 'roster upsert cannot restore an account');
  assert.equal((await request('/api/me', undefined, 'staff')).status, 403);
  await ok('/api/employees/manage/status', { userId: 'staff', active: true }, 'admin');
  assert(assignments().every(row => row.status === 'inactive'), 'restoring an account does not revive canceled assignments');
  const roster = await ok('/api/employees/manage', undefined, 'admin'); assert.equal(roster.employees.filter(employee => employee.userId === 'staff').length, 1); assert.equal(roster.employees.find(employee => employee.userId === 'staff').active, true);
  assert.equal((await ok('/api/scoring360/assignments', pair('owner'), 'admin')).assignment.id, ownerAssignment);
  assert.equal((await ok('/api/scoring360/assignments', pair('peer'), 'admin')).assignment.id, peerAssignment);
  await ok('/api/scoring360/cycle', { action: 'open' }, 'admin');
  const grade = (assignmentId, score) => ({ cycleId, scores: [{ assignmentId, score, comment: '依据本月具体成果与实际协作完成评价' }] });
  assert.equal((await ok('/api/scoring360/submit', grade(ownerAssignment, 92))).saved, 1);
  await ok('/api/manager-reviews', { month, employeeUserId: 'staff', score: 80, comment: '本月交付完成，继续提升跨部门信息同步' }, 'head');
  assert.equal(sql('SELECT count(*) AS n FROM monthly_person_weighted_results;', true)[0].n, 0, 'one pending peer prevents final publication');
  const workbench = await ok('/api/scoring360/workbench?month=' + month, undefined, 'admin'), partial = records();
  const removeSubmitted = await request('/api/scoring360/workbench', { action: 'saveEmployee', month, revision: workbench.revision, employeeUserId: 'staff', evaluatorUserIds: ['peer'] }, 'admin');
  assert.equal(removeSubmitted.status, 409); assert.equal(removeSubmitted.body.error, 'submitted_relationship_locked'); assert.equal(records(), partial, 'rejected relation edits preserve submitted history');
  assert.equal((await ok('/api/scoring360/submit', grade(peerAssignment, 88), 'peer')).saved, 1);
  const personal = await ok('/api/performance/me', undefined, 'staff');
  assert.equal(personal.history.find(result => result.month === month).collaboration, 87, '70% of peer average 90 plus 30% of manager 80 publishes 87');
  assert(!JSON.stringify(personal).includes('依据本月具体成果'), 'personal result does not expose peer comments');
  const published = records();
  const edit = await ok('/api/scoring360/submit', grade(ownerAssignment, 1)); assert.equal(edit.saved, 0); assert.equal(edit.skipped[0].reason, 'result_locked');
  const addAfterFinal = await request('/api/scoring360/assignments', pair('member'), 'admin'); assert.equal(addAfterFinal.status, 409); assert.equal(addAfterFinal.body.error, 'result_locked');
  const rejectDeactivation = await request('/api/scoring360/assignments', { assignmentId: ownerAssignment }, 'admin', 'DELETE'); assert.equal(rejectDeactivation.status, 409); assert.equal(rejectDeactivation.body.error, 'result_locked');
  const editManager = await request('/api/manager-reviews', { month, employeeUserId: 'staff', score: 1, comment: '不得覆盖已提交月度评分' }, 'head'); assert.equal(editManager.status, 409); assert.equal(editManager.body.error, 'result_locked');
  assert.equal(records(), published, 'all rejected edits preserve the published score and evidence');
  await ok('/api/employees/manage/status', { userId: 'staff', active: false }, 'admin'); assert.equal((await request('/api/me', undefined, 'staff')).status, 403);
  assert.equal(records(), published, 'stop preserves the final score, submitted evidence and denominator');
  await ok('/api/employees/manage/status', { userId: 'staff', active: true }, 'admin'); assert.equal(records(), published); assert.equal((await ok('/api/performance/me', undefined, 'staff')).history.find(result => result.month === month).collaboration, 87);
  assert.equal(sql('SELECT count(*) AS n FROM employees;', true)[0].n, 6);
  assert.equal(sql("SELECT count(*) AS n FROM scoring360_reminder_sends WHERE status IN('sent','pending','uncertain');", true)[0].n, 0);
  assert.equal(await readFile(dir + '/network.log', 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; }), ''); assert.equal(sql('PRAGMA integrity_check;'), 'ok');
  const result = { ok: true, roleManagement: true, ordinaryMemberDenied: true, ssoRosterOnly: true, explicitStatusRestore: true, canceledAssignmentsStayCanceled: true, submittedRelationsLocked: true, weightedPublication: 87, publishedHistoryImmutable: true, externalRequests: 0, realMessagesSent: 0, artifacts: dir };
  await writeFile(dir + '/result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { console.error(logs); throw error; }
finally {
  if (server?.exitCode === null) { server.kill('SIGTERM'); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
  await writeFile(dir + '/server.log', logs); console.log('Artifacts retained:', dir);
}
