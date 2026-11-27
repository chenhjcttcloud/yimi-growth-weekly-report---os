import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, writeFile, chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDepartments} from '../server/departments.mjs';
import {createManagerReviews} from '../server/manager-reviews.mjs';
import {createScoringSetup} from '../server/scoring-setup.mjs';
import {createScoringWorkbench} from '../server/scoring-workbench.mjs';
import {createScoringRecurrence} from '../server/scoring-recurrence.mjs';
import {createPerformance} from '../server/performance.mjs';

// Synthetic SQLite fixtures only. Keep every database and diagnostic artifact.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlite = process.env.SQLITE3_BIN || 'sqlite3';
await mkdir(path.join(project, 'outputs/tests'), {recursive: true});
const artifacts = await mkdtemp(path.join(project, 'outputs/tests/boss-peer-exclusion-'));
await chmod(artifacts, 0o700);
const schema = await readFile(path.join(project, 'db/schema.sql'), 'utf8');
const actor = {userId: 'fixture-boss', name: '测试业务老板'};
const checks = [];
let externalRequests = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { externalRequests++; throw Error('synthetic_test_external_request_forbidden'); };
const sql = value => value === null || value === undefined || value === ''
  ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";

async function fixture(label, at = '2026-10-28T10:00:00+08:00') {
  const dir = path.join(artifacts, label);
  await mkdir(dir, {mode: 0o700});
  const db = path.join(dir, 'fixture.sqlite');
  let time = new Date(at);
  const raw = (statement, json = false) => {
    const result = spawnSync(sqlite, ['-bail', '-cmd', '.timeout 5000', ...(json ? ['-json'] : []), db], {
      input: statement, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error || 'sqlite3 failed'));
    return json ? JSON.parse(result.stdout || '[]') : result.stdout.trim();
  };
  // The production adapter returns strings and represents SQL NULL as ''.
  const query = async statement => raw(statement, true).map(row => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)]),
  ));
  const exec = async statement => raw(statement);
  raw(schema);
  await chmod(db, 0o600);
  raw(`INSERT INTO employees(user_id,name,department,manager_user_id,is_active) VALUES
    ('fixture-boss','测试业务老板','管理','',1),
    ('head','测试负责人甲','甲队','',1),
    ('other-head','测试负责人乙','乙队','',1),
    ('staff','测试员工','甲队','head',1),
    ('peer','测试同事','甲队','head',1),
    ('view-admin','测试管理查看者','甲队','head',1),
    ('multi','测试多负责人员工','甲队,乙队','',1);
    INSERT INTO organization_departments VALUES
      ('management','管理','fixture-boss',datetime('now')),
      ('alpha','甲队','head',datetime('now')),
      ('beta','乙队','other-head',datetime('now'));
    INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source)
      SELECT 'fixture-period-'||user_id,user_id,'2026-01-01','synthetic' FROM employees;
    INSERT INTO app_settings(key,value_json) VALUES
      ('boss_view_members','[{"userId":"fixture-boss","name":"测试业务老板"},{"userId":"view-admin","name":"测试管理查看者"}]'),
      ('scoring360_admin_members','[{"userId":"view-admin","name":"测试管理查看者"}]'),
      ('business_boss_members','{"members":[{"userId":"fixture-boss","name":"测试业务老板"}]}');
    INSERT INTO scoring360_cycles(id,label,start_date,end_date,status)
      VALUES('sep-fixture','测试九月','2026-09-01','2026-09-30','closed');
    INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES
      ('sep-staff-boss','sep-fixture','测试员工','测试业务老板','staff','fixture-boss'),
      ('sep-staff-head','sep-fixture','测试员工','测试负责人甲','staff','head'),
      ('sep-staff-view','sep-fixture','测试员工','测试管理查看者','staff','view-admin'),
      ('sep-head-peer','sep-fixture','测试负责人甲','测试同事','head','peer'),
      ('sep-other-head-view','sep-fixture','测试负责人乙','测试管理查看者','other-head','view-admin'),
      ('sep-peer-staff','sep-fixture','测试同事','测试员工','peer','staff'),
      ('sep-view-peer','sep-fixture','测试管理查看者','测试同事','view-admin','peer'),
      ('sep-multi-head','sep-fixture','测试多负责人员工','测试负责人甲','multi','head'),
      ('sep-multi-other-head','sep-fixture','测试多负责人员工','测试负责人乙','multi','other-head');
    INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment)
      VALUES('sep-answered-boss','sep-staff-boss','sep-fixture','测试员工','测试业务老板',88,'测试历史互评分必须保留');`);
  const employees = async () => (await query('SELECT * FROM employees WHERE is_active=1;')).map(row => ({
    userId: row.user_id, name: row.name, department: row.department, managerUserId: row.manager_user_id,
  }));
  let reviews;
  const departments = createDepartments({query, exec, sql, employees, now: () => time,
    beforeScore: (month, userId) => reviews.freezeBossPlan(month, userId),
    resolveLeaderScoreTarget: (month, userId) => reviews.leaderScoreTarget(month, userId),
  });
  reviews = createManagerReviews({query, exec, sql, organization: departments.overview,
    reports: async () => [], isBossUserId: id => id === 'fixture-boss', now: () => time,
  });
  const setup = createScoringSetup({query, exec, sql, isBoss: id => id === 'fixture-boss', now: () => time});
  const options = {query, exec, sql, setup, managerReviews: reviews,
    bossMembers: () => [actor], now: () => time,
  };
  const workbench = createScoringWorkbench(options);
  const recurrence = createScoringRecurrence(options);
  const performance = createPerformance({query, exec, sql,
    readData: () => ({meta: {periods: []}, employee_summary: [], weekly_scores: []}),
    managerReviews: reviews, now: () => time,
  });
  const snapshot = tables => JSON.stringify(tables.map(table => raw(`SELECT * FROM ${table} ORDER BY 1,2;`, true)));
  const preserved = () => snapshot(['scoring360_responses', 'monthly_manager_scores', 'monthly_review_plans',
    'department_person_scores', 'performance_results', 'all_monthly_weighted_results']);
  const prior = () => JSON.stringify([
    raw("SELECT * FROM scoring360_assignments WHERE cycle_id='sep-fixture' ORDER BY id;", true),
    raw("SELECT * FROM scoring360_responses WHERE cycle_id='sep-fixture' ORDER BY id;", true),
    raw("SELECT * FROM all_monthly_weighted_results WHERE month='2026-09' ORDER BY employee_user_id;", true),
    raw("SELECT * FROM performance_results WHERE month='2026-09' ORDER BY employee_user_id;", true),
  ]);
  const roles = () => raw("SELECT key,value_json FROM app_settings WHERE key IN('boss_view_members','scoring360_admin_members','business_boss_members') ORDER BY key;", true);
  const links = month => raw(`SELECT evaluee_user_id,evaluator_user_id,status FROM scoring360_assignments
    WHERE cycle_id IN(SELECT id FROM scoring360_cycles WHERE substr(start_date,1,7)=${sql(month)})
    ORDER BY evaluee_user_id,evaluator_user_id;`, true);
  const mutate = async (action, extra = {}) => workbench.mutate({month: '2026-10',
    revision: (await workbench.overview('2026-10')).revision, action, ...extra,
  }, actor);
  return {db, raw, query, setup, reviews, departments, workbench, recurrence, performance,
    snapshot, preserved, prior, roles, links, mutate, setTime: value => { time = new Date(value); }};
}

try {
  const direct = await fixture('direct-assignment');
  const directRoles = direct.roles(), directHistory = direct.preserved();
  const setupState = await direct.setup.prepare('2026-10');
  assert(!setupState.raters.some(person => person.userId === actor.userId));
  assert(!setupState.targets.some(person => person.userId === actor.userId));
  assert(setupState.raters.some(person => person.userId === 'head'));
  assert(setupState.raters.some(person => person.userId === 'view-admin'));
  assert(setupState.targets.some(person => person.userId === 'view-admin'));
  const directBefore = direct.snapshot(['scoring360_assignments']);
  await assert.rejects(() => direct.setup.assign('2026-10', [
    {evalueeUserId: 'staff', evaluatorUserId: 'peer'},
    {evalueeUserId: 'staff', evaluatorUserId: actor.userId},
  ]), /boss_peer_forbidden/);
  assert.equal(direct.snapshot(['scoring360_assignments']), directBefore, 'a mixed forbidden batch cannot add its valid first pair');
  await direct.setup.assign('2026-10', [
    {evalueeUserId: 'staff', evaluatorUserId: 'head'},
    {evalueeUserId: 'staff', evaluatorUserId: 'view-admin'},
    {evalueeUserId: 'view-admin', evaluatorUserId: 'peer'},
  ]);
  assert.equal(direct.links('2026-10').length, 3);
  assert.equal(direct.preserved(), directHistory);
  assert.deepEqual(direct.roles(), directRoles);
  checks.push('business_boss_excluded_and_view_admin_remains_regular_peer');

  const work = await fixture('workbench');
  const workBefore = work.snapshot(['scoring360_cycles', 'scoring360_assignments', 'system_operation_logs']);
  const priorBefore = work.prior(), workScores = work.preserved(), workRoles = work.roles();
  await assert.rejects(() => work.mutate('saveEmployee', {employeeUserId: 'staff', evaluatorUserIds: [actor.userId]}), /boss_peer_forbidden/);
  await assert.rejects(() => work.mutate('batch', {employeeUserIds: ['staff', 'peer'], evaluatorUserIds: ['head', actor.userId]}), /boss_peer_forbidden/);
  assert.equal(work.snapshot(['scoring360_cycles', 'scoring360_assignments', 'system_operation_logs']), workBefore);
  const copy = await work.workbench.overview('2026-10');
  assert(!copy.copy.pairs.some(pair => pair.evaluatorUserId === actor.userId));
  assert(copy.copy.pairs.some(pair => pair.evaluatorUserId === 'head'));
  assert(copy.copy.pairs.some(pair => pair.evaluatorUserId === 'view-admin'));
  assert(copy.rows.some(person => person.userId === 'view-admin'));
  assert.deepEqual(copy.rows.find(person => person.userId === 'head').manager.reviewers.map(person => person.userId), [actor.userId]);
  const copied = await work.mutate('copyPrevious');
  assert.equal(copied.saved, 8);
  assert.equal(work.links('2026-10').length, 8);
  assert(!work.links('2026-10').some(pair => pair.evaluator_user_id === actor.userId));
  await work.mutate('saveEmployee', {employeeUserId: 'staff', evaluatorUserIds: ['head', 'view-admin']});
  await work.mutate('batch', {employeeUserIds: ['view-admin'], evaluatorUserIds: ['head']});
  const multipleManagers = work.reviews.progress(await work.reviews.snapshot(), '2026-10', 'multi');
  assert.deepEqual([...multipleManagers.expectedIds].sort(), ['head', 'other-head']);
  assert.equal(work.prior(), priorBefore, 'copying cannot rewrite a historical answered boss relationship');
  assert.equal(work.preserved(), workScores);
  assert.deepEqual(work.roles(), workRoles);
  checks.push('manual_and_batch_rejected_atomically_copy_filters_only_business_boss');

  const recurring = await fixture('legacy-recurring-template', '2026-10-01T00:05:00+08:00');
  const recurringPrior = recurring.prior(), recurringScores = recurring.preserved(), recurringRoles = recurring.roles();
  const adopted = await recurring.recurrence.mutate({action: 'adoptMonth', sourceMonth: '2026-09',
    startMonth: '2026-10', enabled: true,
  }, actor);
  assert.equal(adopted.config.pairCount, 9, 'the confirmed legacy template keeps its complete original pairs');
  const template = () => recurring.raw("SELECT key,value_json FROM app_settings WHERE key LIKE 'scoring360_recurring_plan_version_%' ORDER BY key;", true);
  const originalTemplate = template();
  assert(JSON.parse(originalTemplate[0].value_json).pairs.some(pair => pair.evaluatorUserId === actor.userId));
  const expectedPairs = recurring.raw("SELECT evaluee_user_id,evaluator_user_id FROM scoring360_assignments WHERE cycle_id='sep-fixture' AND evaluator_user_id<>'fixture-boss' ORDER BY evaluee_user_id,evaluator_user_id;", true);
  const generatedPairs = month => recurring.links(month).map(({evaluee_user_id, evaluator_user_id}) => ({evaluee_user_id, evaluator_user_id}));
  assert.deepEqual(generatedPairs('2026-10'), expectedPairs);
  assert.equal(adopted.current.issueCount, 0);
  recurring.setTime('2026-11-01T00:05:00+08:00');
  await recurring.recurrence.tick();
  await recurring.recurrence.tick();
  assert.deepEqual(generatedPairs('2026-11'), expectedPairs);
  assert.deepEqual(template(), originalTemplate, 'automatic projection never rewrites the immutable template');
  assert.deepEqual([...recurring.reviews.progress(await recurring.reviews.snapshot(), '2026-10', 'multi').expectedIds].sort(), ['head', 'other-head'],'old months retain every thirty-percent responsibility');
  assert.deepEqual(recurring.reviews.progress(await recurring.reviews.snapshot(), '2026-11', 'multi').expectedIds,[],'new months do not create thirty-percent tasks');
  assert.equal(recurring.prior(), recurringPrior);
  assert.equal(recurring.preserved(), recurringScores);
  assert.deepEqual(recurring.roles(), recurringRoles);
  checks.push('old_template_skips_boss_without_losing_other_managers_or_history');

  const locked = await fixture('published-and-answered-history');
  await locked.setup.prepare('2026-10');
  await locked.setup.assign('2026-10', [{evalueeUserId: 'head', evaluatorUserId: 'peer'}]);
  // Model a relationship that was answered before the business role split.
  locked.raw(`UPDATE scoring360_cycles SET status='open',launch_at='2026-10-26T00:00:00+08:00' WHERE id='2026-10-360';
    INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id)
      VALUES('legacy-oct-answered-boss','2026-10-360','测试负责人甲','测试业务老板','head','fixture-boss');
    INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment)
      SELECT 'response-'||id,id,cycle_id,evaluee_name,evaluator_name,CASE WHEN evaluator_user_id='fixture-boss' THEN 94 ELSE 90 END,'测试历史回答'
      FROM scoring360_assignments WHERE cycle_id='2026-10-360' AND evaluee_user_id='head';`);
  await locked.departments.score({leaderUserId: 'head', month: '2026-10', score: 85, comment: '测试老板30%独立评价'}, actor);
  const manager = locked.reviews.progress(await locked.reviews.snapshot(), '2026-10', 'head');
  assert.equal(manager.score, 85);
  assert.equal(manager.complete, true);
  assert.deepEqual(manager.expectedIds, ['']);
  await locked.performance.overview();
  const published = locked.raw("SELECT * FROM all_monthly_weighted_results WHERE month='2026-10' AND employee_user_id='head';", true);
  assert.equal(published.length, 1);
  assert.equal(JSON.parse(published[0].result_json).score, 89.9);
  const publishedBefore = locked.preserved(), lockedRoles = locked.roles();
  const lockedState = await locked.workbench.overview('2026-10');
  assert.equal(lockedState.rows.find(person => person.userId === 'head').locked, true);
  assert(lockedState.rows.find(person => person.userId === 'head').assignments.some(link => link.evaluator_user_id === actor.userId && link.submitted));
  await assert.rejects(() => locked.mutate('saveEmployee', {employeeUserId: 'head', evaluatorUserIds: ['peer']}), /result_locked/);
  await assert.rejects(() => locked.setup.deactivate('2026-10', 'legacy-oct-answered-boss'), /result_locked/);
  await locked.mutate('saveEmployee', {employeeUserId: 'staff', evaluatorUserIds: ['head', 'view-admin']});
  await locked.performance.overview();
  await locked.performance.overview();
  assert.equal(locked.preserved(), publishedBefore, 'role filtering cannot recompute a published result or alter either score channel');
  assert.equal(locked.raw("SELECT score FROM boss_person_scores WHERE month='2026-10' AND leader_user_id='head';"), '85.0');
  assert.deepEqual(locked.roles(), lockedRoles);
  assert.equal(locked.raw('PRAGMA integrity_check;'), 'ok');
  assert.equal(externalRequests, 0);
  checks.push('boss_30_score_85_and_answered_peer_and_published_rows_preserved');
  const result = {ok: true, checks, sqliteVersion: locked.raw('SELECT sqlite_version();'),
    productionAdapterConvention: 'string/null-as-empty', externalRequests, realMessagesSent: 0, artifacts};
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(path.join(artifacts, 'failure.json'), JSON.stringify({error: error.stack, checks, externalRequests}, null, 2), {flag: 'wx', mode: 0o600});
  throw error;
} finally {
  globalThis.fetch = previousFetch;
  console.log('Artifacts retained:', artifacts);
}
