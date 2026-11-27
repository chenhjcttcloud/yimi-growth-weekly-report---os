import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {createBusinessBossPolicy} from '../server/business-boss-policy.mjs';

// Every database is a new retained synthetic fixture. No production service,
// private identity, outbound client, existing setting or score is used.
const binary = process.env.SQLITE3_BIN || 'sqlite3';
const version = spawnSync(binary, ['-version'], {encoding: 'utf8'});
assert.equal(version.status, 0, 'sqlite3 CLI is required');
await mkdir('outputs/tests', {recursive: true});
const artifacts = await mkdtemp(path.resolve('outputs/tests/business-boss-policy-'));
const sql = value => value === null || value === undefined ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const action = '业务老板：安全排除未答70%互评关系';
let passed = 0;

async function fixture(label, {explicit = true} = {}) {
  const directory = path.join(artifacts, label);
  await mkdir(directory, {mode: 0o700});
  const database = path.join(directory, 'synthetic.sqlite');
  const run = (statement, json = false) => {
    const child = spawnSync(binary, ['-bail', '-cmd', '.timeout 5000', ...(json ? ['-json'] : []), database], {input: statement + '\n', encoding: 'utf8'});
    if (child.status !== 0) throw Error(child.stderr || 'synthetic_sqlite_failure');
    return json ? JSON.parse(child.stdout.trim() || '[]') : child.stdout;
  };
  // Preserve production adapter behavior (numeric cells become strings).
  const query = async statement => run(statement, true).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)])));
  let execCalls = 0, beforeExec = null, fallback = [{userId: 'viewer', name: '合成查看者'}];
  const exec = async statement => { execCalls++; if (beforeExec) { const hook = beforeExec; beforeExec = null; hook(); } return run(statement); };
  run(`CREATE TABLE app_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL);
    CREATE TABLE employees(user_id TEXT PRIMARY KEY,name TEXT,is_active INTEGER DEFAULT 1);
    CREATE TABLE scoring360_cycles(id TEXT PRIMARY KEY,start_date TEXT);
    CREATE TABLE scoring360_assignments(id TEXT PRIMARY KEY,cycle_id TEXT,evaluee_user_id TEXT,evaluator_user_id TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE scoring360_responses(id TEXT PRIMARY KEY,assignment_id TEXT,score INTEGER,comment TEXT);
    CREATE TABLE monthly_weighted_results(month TEXT,employee_user_id TEXT,result_json TEXT);
    CREATE TABLE monthly_person_weighted_results(month TEXT,employee_user_id TEXT,result_json TEXT);
    CREATE VIEW all_monthly_weighted_results AS SELECT * FROM monthly_weighted_results UNION ALL SELECT * FROM monthly_person_weighted_results;
    CREATE TABLE monthly_peer_results(month TEXT,employee_user_id TEXT,result_json TEXT);
    CREATE VIEW all_collaboration_results AS SELECT * FROM all_monthly_weighted_results UNION ALL SELECT * FROM monthly_peer_results;
    CREATE TABLE performance_results(month TEXT,employee_user_id TEXT,kind TEXT,result_json TEXT);
    CREATE TABLE monthly_manager_scores(month TEXT,employee_user_id TEXT,score INTEGER,comment TEXT);
    CREATE TABLE monthly_review_plans(month TEXT,employee_user_id TEXT,plan_json TEXT);
    CREATE TABLE system_operation_logs(id TEXT PRIMARY KEY,actor_user_id TEXT,actor_name TEXT,action TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL);
    INSERT INTO employees(user_id,name) VALUES('boss','合成业务老板'),('other-boss','合成另一个老板'),('viewer','合成查看者'),('peer','合成同事');
    INSERT INTO scoring360_cycles VALUES('oct','2026-10-01'),('oct-second','2026-10-09'),('nov','2026-11-01'),('dec','2026-12-01');
    INSERT INTO scoring360_assignments VALUES
      ('eligible-oct','oct','target-eligible','boss','active','original'),
      ('eligible-nov','nov','target-eligible','boss','active','original'),
      ('answered','oct','target-answered','boss','active','original'),
      ('weighted','oct-second','target-weighted','boss','active','original'),
      ('person-weighted','oct','target-person-weighted','boss','active','original'),
      ('performance','oct','target-performance','boss','active','original'),
      ('both','oct','target-both','boss','active','original'),
      ('inactive','oct','target-inactive','boss','inactive','original'),
      ('other-peer','oct','target-eligible','peer','active','original'),
      ('unselected-month','dec','target-eligible','boss','active','original'),
      ('unselected-boss','oct','target-other','other-boss','active','original'),
      ('viewer-peer','oct','target-viewer','viewer','active','original');
    INSERT INTO scoring360_responses VALUES('response-answered','answered',81,'合成已保存评分'),('response-both','both',82,'合成已保存评分');
    INSERT INTO monthly_weighted_results VALUES('2026-10','target-weighted','{"score":83}');
    INSERT INTO monthly_person_weighted_results VALUES('2026-10','target-person-weighted','{"score":84}');
    INSERT INTO performance_results VALUES('2026-10','target-performance','collaboration','{"score":85}'),('2026-10','target-both','collaboration','{"score":86}'),('2026-10','target-eligible','quality','{"score":87}');
    INSERT INTO monthly_manager_scores VALUES('2026-10','target-eligible',85,'合成已完成30%');
    INSERT INTO monthly_review_plans VALUES('2026-10','target-eligible','{"kind":"boss","expectedIds":[""]}');
    INSERT INTO app_settings VALUES('scoring_recurring_template','{"pairs":[{"evaluatorUserId":"boss","evalueeUserId":"target-eligible"}]}');`);
  const setConfig = value => run(`INSERT INTO app_settings(key,value_json) VALUES('business_boss_members',${sql(typeof value === 'string' ? value : JSON.stringify(value))}) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json;`);
  if (explicit) setConfig({members: [{userId: 'boss', name: '仅显示名', untrusted: 'not-exposed'}, {userId: 'other-boss'}]});
  const policy = createBusinessBossPolicy({query, exec, sql, fallbackMembers: () => fallback, now: () => new Date('2026-11-27T01:00:00Z')});
  const tables = run("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;", true).map(row => row.name);
  const dump = () => Object.fromEntries(tables.map(table => [table, run(`SELECT * FROM ${table} ORDER BY rowid;`, true)]));
  return {policy, run, query, dump, setConfig, database, setFallback: value => { fallback = value; }, beforeExec: hook => { beforeExec = hook; }, execCalls: () => execCalls};
}

const scope = {months: ['2026-11', '2026-10'], businessBossUserIds: ['boss']};
const actor = {userId: 'synthetic-admin', name: '合成管理员'};
const applyOptions = plan => ({...scope, expectedPlanSha256: plan.planSha256, confirm: true, actor});
async function check(label, fn) { await fn(); passed++; console.log('PASS ' + label); }

await check('fallback is dynamic, observable and cannot authorize writes', async () => {
  const f = await fixture('fallback', {explicit: false}), before = f.dump();
  assert.equal((await f.policy.load()).source, 'boss-view-fallback');
  assert(f.policy.isBusinessBoss('viewer'));
  f.setFallback([{userId: 'boss'}, {name: '合成姓名不能作为身份'}]);
  assert.equal(f.policy.isBusinessBoss('viewer'), false);
  assert(f.policy.isBusinessBoss('boss'));
  assert.deepEqual(f.policy.state().userIds, ['boss']);
  const plan = await f.policy.planExclusion(scope);
  await assert.rejects(f.policy.applyExclusion(applyOptions(plan)), /explicit_business_boss_configuration_required/u);
  assert.deepEqual(f.dump(), before);
  assert.equal(f.execCalls(), 0);
});

await check('explicit business identity is independent of view permissions and immutable', async () => {
  const f = await fixture('identity'), before = f.dump(), state = await f.policy.load();
  assert.equal(state.source, 'explicit');
  assert(f.policy.isBusinessBoss('boss'));
  assert.equal(f.policy.isBusinessBoss('viewer'), false);
  f.setFallback([{userId: 'peer'}]);
  assert(f.policy.isBusinessBoss('boss'));
  assert.equal(f.policy.isBusinessBoss('peer'), false);
  assert.throws(() => state.userIds.push('peer'), TypeError);
  assert.throws(() => state.members[0].userId = 'peer', TypeError);
  assert.equal('untrusted' in state.members[0], false);
  assert.deepEqual(f.dump(), before);
});

await check('invalid explicit settings fail closed instead of falling back', async () => {
  const f = await fixture('invalid-settings');
  for (const invalid of ['{', null, [], {members: []}, {members: [{name: '合成姓名'}]}, {members: [{userId: 'boss'}, {userId: 'boss'}]}, {members: [{userId: 'missing'}]}, {members: [{userId: ' boss'}]}]) {
    f.setConfig(invalid);
    await assert.rejects(f.policy.load(), /invalid_business_boss_members|business_boss_employee_not_found/u);
    assert.throws(() => f.policy.isBusinessBoss('viewer'));
    assert.throws(() => f.policy.members());
  }
  f.setConfig({members: [{userId: 'boss'}]});
  await f.policy.load();
  assert(f.policy.isBusinessBoss('boss'));
  f.run("UPDATE employees SET is_active=0 WHERE user_id='boss';");
  await f.policy.load();
  assert(f.policy.isBusinessBoss('boss'), 'inactive status must not erase established business identity');
});

await check('plan is read only and blocks all response and publication sources', async () => {
  const f = await fixture('plan'), before = f.dump(), plan = await f.policy.planExclusion(scope);
  assert.deepEqual(plan.candidates.map(row => row.assignmentId), ['eligible-nov', 'eligible-oct']);
  assert.deepEqual(plan.counts, {matched: 8, eligible: 2, alreadyInactive: 1, blocked: 5, blockedAnswered: 2, blockedPublished: 4});
  assert.deepEqual(plan.blocked.find(row => row.assignmentId === 'both').reasons, ['answered', 'published']);
  assert.deepEqual(f.dump(), before);
  assert.equal(f.execCalls(), 0);
  for (const invalid of [{}, {...scope, months: []}, {...scope, months: ['2026-13']}, {...scope, businessBossUserIds: []}, {...scope, businessBossUserIds: ['viewer']}]) await assert.rejects(f.policy.planExclusion(invalid));
});

await check('apply needs exact reviewed scope, explicit confirmation and actor', async () => {
  const f = await fixture('confirmation'), plan = await f.policy.planExclusion(scope), before = f.dump();
  for (const invalid of [{...applyOptions(plan), confirm: false}, {...applyOptions(plan), actor: {}}, {...applyOptions(plan), expectedPlanSha256: ''}, {...applyOptions(plan), expectedPlanSha256: '0'.repeat(64)}]) await assert.rejects(f.policy.applyExclusion(invalid));
  assert.deepEqual(f.dump(), before);
  assert.equal(f.execCalls(), 0);
});

await check('apply changes only selected eligible relationships and appends one audit; replay is inert', async () => {
  const f = await fixture('apply'), plan = await f.policy.planExclusion(scope), before = f.dump();
  const result = await f.policy.applyExclusion(applyOptions(plan));
  assert.equal(result.applied, 2);
  assert.equal(result.alreadyApplied, false);
  const after = f.dump();
  assert.equal(after.scoring360_assignments.length, before.scoring360_assignments.length);
  for (const row of before.scoring360_assignments) {
    const actual = after.scoring360_assignments.find(item => item.id === row.id);
    if (['eligible-oct', 'eligible-nov'].includes(row.id)) assert.deepEqual(actual, {...row, status: 'inactive', updated_at: '2026-11-27T01:00:00.000Z'});
    else assert.deepEqual(actual, row);
  }
  for (const table of Object.keys(before).filter(table => !['scoring360_assignments', 'system_operation_logs'].includes(table))) assert.deepEqual(after[table], before[table], table + ' must be preserved');
  assert.equal(after.system_operation_logs.length, 1);
  assert.equal(after.system_operation_logs[0].action, action);
  const details = JSON.parse(after.system_operation_logs[0].details_json);
  assert.deepEqual(details.assignmentIds, ['eligible-nov', 'eligible-oct']);
  assert.deepEqual(details.months, ['2026-10', '2026-11']);
  const replay = await f.policy.applyExclusion(applyOptions(plan));
  assert.equal(replay.applied, 0);
  assert.equal(replay.alreadyApplied, true);
  assert.deepEqual(f.dump(), after);
  const empty = await f.policy.planExclusion(scope);
  assert.equal(empty.counts.eligible, 0);
  assert.equal((await f.policy.applyExclusion(applyOptions(empty))).applied, 0);
  assert.deepEqual(f.dump(), after, 'zero-change plans do not append misleading audits');
});

for (const [label, mutation] of [
  ['response-race', f => f.run("INSERT INTO scoring360_responses VALUES('late-answer','eligible-oct',91,'合成并发答卷');")],
  ['publication-race', f => f.run("INSERT INTO performance_results VALUES('2026-10','target-eligible','collaboration','{}');")],
  ['weighted-race', f => f.run("INSERT INTO monthly_person_weighted_results VALUES('2026-10','target-eligible','{}');")],
  ['configuration-race', f => f.setConfig({members: [{userId: 'boss', name: '合成并发配置'}]})],
  ['relationship-race', f => f.run("INSERT INTO scoring360_assignments VALUES('late-relation','oct','target-late','boss','active','original');")],
]) await check(label + ' is rechecked inside transaction', async () => {
  const f = await fixture(label), plan = await f.policy.planExclusion(scope);
  let concurrentState;
  f.beforeExec(() => { mutation(f); concurrentState = f.dump(); });
  await assert.rejects(f.policy.applyExclusion(applyOptions(plan)), /business_boss_exclusion_plan_changed/u);
  assert.deepEqual(f.dump(), concurrentState, 'only the independent concurrent action is retained');
});

await check('failed relationship update rolls back its audit atomically', async () => {
  const f = await fixture('rollback'), plan = await f.policy.planExclusion(scope), before = f.dump();
  f.beforeExec(() => f.run("CREATE TRIGGER synthetic_abort BEFORE UPDATE ON scoring360_assignments BEGIN SELECT RAISE(ABORT,'synthetic_update_blocked'); END;"));
  await assert.rejects(f.policy.applyExclusion(applyOptions(plan)), /synthetic_update_blocked/u);
  assert.deepEqual(f.dump(), before);
});

console.log(JSON.stringify({passed, sqliteVersion: version.stdout.trim().split(/\s+/u)[0], retainedArtifacts: artifacts}));
