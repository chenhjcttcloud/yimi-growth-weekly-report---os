import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import path from 'node:path';
import {createDepartments} from '../server/departments.mjs';
import {createManagerReviews} from '../server/manager-reviews.mjs';
import {createPerformance} from '../server/performance.mjs';

// Point SQLITE3_BIN at the deployment CLI (or an argument-preserving wrapper).
// Every database below is a new retained synthetic artifact. No live service,
// production database, identity, model or network client is used.
const binary = process.env.SQLITE3_BIN || 'sqlite3';
const version = spawnSync(binary, ['-version'], {encoding: 'utf8'});
assert.equal(version.status, 0, 'A real sqlite3 CLI is required; SQLite errors must not be skipped');
const engine = version.stdout.trim().split(/\s+/u)[0];
await mkdir('outputs/tests', {recursive: true});
const folder = await mkdtemp(path.resolve('outputs/tests/collaboration-sqlite-rounding-'));
const schema = await readFile('db/schema.sql', 'utf8');
const sql = value => value === null || value === undefined || value === '' ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const failures = [];
let completed = 0;

async function fixture(label, {peerScores, managerScores = [96], omitPeer = false, omitManager = false, bossPerson = false, published = false}) {
  const directory = path.join(folder, label);
  await mkdir(directory, {mode: 0o700});
  const database = path.join(directory, 'synthetic.sqlite');
  const run = (statement, json = false) => {
    const child = spawnSync(binary, ['-bail', '-cmd', '.timeout 5000', ...(json ? ['-json'] : []), database], {input: statement + '\n', encoding: 'utf8'});
    if (child.status !== 0) throw Error(child.stderr || 'synthetic_sqlite_failure');
    return json ? JSON.parse(child.stdout.trim() || '[]') : child.stdout;
  };
  // Match server/index.mjs querySqlRows exactly: every nonnull value becomes a
  // string and SQL NULL becomes an empty string. Numeric-only mocks hide bugs.
  const query = async statement => run(statement, true).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)])));
  const exec = async statement => run(statement);
  run(schema);
  const managers = managerScores.map((score, index) => ({id: 'manager-' + index, score}));
  run(`INSERT INTO employees(user_id,name,department,manager_user_id) VALUES
    ('target','合成被评员工','合成团队',${bossPerson ? 'NULL' : sql(managers[0].id)}),
    ('boss','合成老板','合成管理部',NULL);
    INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES
    ('team','合成团队',${sql(bossPerson ? 'target' : managers[0].id)},datetime('now')),
    ('management','合成管理部','boss',datetime('now')),('peers','合成同事部','',datetime('now'));
    INSERT INTO employee_employment_periods(id,employee_user_id,start_date,source) VALUES('target-employment','target','2026-01-01','synthetic');
    INSERT INTO scoring360_cycles(id,label,start_date,end_date,status,launch_at)
    VALUES('october','合成十月周期','2026-10-01','2026-10-31','open','2026-10-20T00:00:00Z');`);
  for (const manager of managers) run(`INSERT INTO employees(user_id,name,department) VALUES(${sql(manager.id)},${sql('合成负责人' + manager.id)},'合成管理部');`);
  for (const [index, score] of peerScores.entries()) {
    const id = 'peer-' + index, assignment = 'assignment-' + index;
    run(`INSERT INTO employees(user_id,name,department) VALUES(${sql(id)},${sql('合成同事' + index)},'合成同事部');
      INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id,status)
      VALUES(${sql(assignment)},'october','合成被评员工',${sql('合成同事' + index)},'target',${sql(id)},'active');`);
    if (!(omitPeer && index === peerScores.length - 1)) run(`INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment)
      VALUES(${sql('response-' + index)},${sql(assignment)},'october','合成被评员工',${sql('合成同事' + index)},${sql(score)},'合成评分');`);
  }
  const expectedIds = bossPerson ? [''] : managers.map(manager => manager.id);
  const progressKind = bossPerson ? 'boss' : 'manager';
  run(`INSERT INTO monthly_review_plans(month,employee_user_id,plan_json) VALUES('2026-10','target',${sql(JSON.stringify({
    employee: {userId: 'target', name: '合成被评员工', department: '合成团队'}, kind: progressKind, expectedIds,
  }))});`);
  if (!omitManager) {
    if (bossPerson) {
      assert.equal(managers.length, 1);
      run(`INSERT INTO department_person_scores(department_id,month,leader_user_id,score,comment,scorer_user_id,scorer_name,created_at)
        VALUES('','2026-10','target',${sql(managers[0].score)},'合成老板评分','boss','合成老板',datetime('now'));`);
    } else for (const manager of managers) run(`INSERT INTO monthly_manager_scores(month,employee_user_id,evaluator_user_id,score,comment,snapshot_json)
      VALUES('2026-10','target',${sql(manager.id)},${sql(manager.score)},'合成管理评分',${sql(JSON.stringify({expectedIds}))});`);
  }

  const expected = () => {
    const managerSource = bossPerson ? "SELECT score FROM boss_person_scores WHERE month='2026-10' AND leader_user_id='target'"
      : "SELECT score FROM monthly_manager_scores WHERE month='2026-10' AND employee_user_id='target'";
    return run(`SELECT ROUND(AVG(r.score),1) AS peerScore,
      (SELECT ROUND(AVG(score),1) FROM (${managerSource})) AS managerScore,
      ROUND(ROUND(AVG(r.score),1)*0.7+(SELECT ROUND(AVG(score),1) FROM (${managerSource}))*0.3,1) AS score
      FROM scoring360_assignments a JOIN scoring360_cycles c ON c.id=a.cycle_id
      JOIN scoring360_responses r ON r.assignment_id=a.id WHERE substr(c.start_date,1,7)='2026-10' AND a.evaluee_user_id='target';`, true)[0];
  };
  if (published) {
    const result = expected();
    run(`INSERT INTO monthly_person_weighted_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at)
      VALUES('2026-10','target','合成被评员工','collaboration',${sql(JSON.stringify({score: result.score, peerScore: result.peerScore, managerScore: result.managerScore, weights: {manager: 30, peers: 70}}))},
      ${sql(JSON.stringify({managerProgress: {kind: progressKind, expectedIds}, preserved: 'synthetic immutable history'}))},'合成历史发布','2026-10-25T00:00:00Z');`);
  }
  const employees = async () => (await query('SELECT * FROM employees WHERE is_active=1;')).map(employee => ({
    userId: employee.user_id, name: employee.name, department: employee.department, managerUserId: employee.manager_user_id,
  }));
  let reviews, performance;
  const departments = createDepartments({query, exec, sql, employees,
    beforeScore: (month, id) => reviews.freezeBossPlan(month, id), resolveLeaderScoreTarget: (month, id) => reviews.leaderScoreTarget(month, id)});
  reviews = createManagerReviews({query, exec, sql, organization: departments.overview, reports: () => performance.reports(),
    isBossUserId: id => id === 'boss', now: () => new Date('2026-10-30T00:00:00Z')});
  performance = createPerformance({query, exec, sql, readData: () => ({meta: {periods: []}, employee_summary: [], weekly_scores: []}),
    managerReviews: reviews, now: () => new Date('2026-10-30T00:00:00Z')});
  return {query, run, expected, performance, database};
}

async function completeCase(label, options) {
  const current = await fixture(label, options), expected = current.expected();
  const initial = await current.query("SELECT * FROM monthly_person_weighted_results ORDER BY month,employee_user_id,kind;");
  const view = await current.performance.overview({clientSummary: true, month: '2026-10'});
  const target = view.monthly.find(row => row.month === '2026-10' && row.userId === 'target');
  assert(target?.collaborationComplete, label + ': both scoring parts should be complete');
  assert.equal(target.peerCandidate, Number(expected.peerScore), label + ': peer average must use the same SQLite rounding rule');
  assert.equal(target.managerProgress.score, Number(expected.managerScore), label + ': managerial average must use the same SQLite rounding rule');
  assert.equal(target.collaborationCandidate, Number(expected.score), label + ': candidate must match this SQLite CLI engine');
  const rows = await current.query("SELECT * FROM monthly_person_weighted_results WHERE month='2026-10' AND employee_user_id='target';");
  assert.equal(rows.length, 1, label + ': exactly one result is published');
  assert.equal(JSON.parse(rows[0].result_json).score, Number(expected.score));
  const saved = await current.query('SELECT * FROM monthly_person_weighted_results ORDER BY month,employee_user_id,kind;');
  await current.performance.overview({clientSummary: true, month: '2026-10'});
  assert.deepEqual(await current.query('SELECT * FROM monthly_person_weighted_results ORDER BY month,employee_user_id,kind;'), saved, label + ': repeated reads do not append or rewrite monthly results');
  if (options.published) assert.deepEqual(saved, initial, label + ': the complete historical row is preserved byte-for-byte');
}

async function pendingCase(label, options) {
  const current = await fixture(label, options);
  const view = await current.performance.overview({clientSummary: true, month: '2026-10'});
  const target = view.monthly.find(row => row.month === '2026-10' && row.userId === 'target');
  assert(target);
  assert.equal(target.collaborationComplete, false);
  assert.equal(target.collaborationCandidate, null);
  assert.equal((await current.query("SELECT * FROM monthly_person_weighted_results WHERE month='2026-10' AND employee_user_id='target';")).length, 0, label + ': incomplete scoring stays unpublished');
}

const highPeers = [...Array(7).fill(95), ...Array(7).fill(96)];
const cases = [
  ['high-half-step', () => completeCase('high-half-step', {peerScores: highPeers, managerScores: [96]})],
  ['low-half-step', () => completeCase('low-half-step', {peerScores: [0, 1], managerScores: [0]})],
  ['multiple-manager-average', () => completeCase('multiple-manager-average', {peerScores: [95, 96], managerScores: [95.4, 95.5]})],
  ['boss-empty-scope', () => completeCase('boss-empty-scope', {peerScores: highPeers, managerScores: [96], bossPerson: true})],
  ['published-history', () => completeCase('published-history', {peerScores: [80, 90], managerScores: [90], published: true})],
  ['missing-peer', () => pendingCase('missing-peer', {peerScores: highPeers, managerScores: [96], omitPeer: true})],
  ['missing-manager', () => pendingCase('missing-manager', {peerScores: [0, 1], managerScores: [0], omitManager: true})],
];
for (const [label, execute] of cases) {
  try { await execute(); completed++; }
  catch (error) { failures.push({scenario: label, error: String(error.message || error).split('\n')[0]}); }
}
console.log(JSON.stringify({sqliteVersion: engine, passed: completed, total: cases.length, failed: failures, retainedArtifacts: folder}));
assert.deepEqual(failures, [], 'Collaboration publication must use the same actual SQLite CLI rounding rules for candidates, averaged inputs, guards and persisted results.');
