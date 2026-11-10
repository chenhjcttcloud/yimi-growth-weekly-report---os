import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

await mkdir('outputs/tests', {recursive: true});
const folder = await mkdtemp(path.resolve('outputs/tests/legacy-weekly-history-'));
const source = path.join(folder, 'legacy-source.json');
const target = path.join(folder, 'copy.sqlite');
const schema = readFileSync('db/schema.sql', 'utf8');

const row = (id, end, openId = 'old-a', overrides = {}) => {
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 4);
  return {
    'open_id': openId, '源记录ID': id, '开始日期': start.toISOString().slice(0, 10), '结束日期': end,
    '提交时间': `${end} 19:05`, '周次': `合成周次 ${end}`, '姓名': 'PRIVATE_LEGACY_NAME', '部门': 'PRIVATE_DEPARTMENT',
    '状态': '准时', '企业邮箱': '', '本周成果摘要': 'PRIVATE_LEGACY_FACTS',
    '问题摘要': '', '下周计划摘要': '', '思考与复盘摘要': '', '成果分': 0, '问题分': 100, '计划分': 80.3,
    '复盘分': '72.0', '总分': 91.625, '准时分': 100, '等级': 'A', ...overrides,
  };
};

function seed(filename) {
  const db = new DatabaseSync(filename);
  try {
    db.exec(schema);
    const employee = db.prepare('INSERT INTO employees(user_id,name,email) VALUES(?,?,?)');
    employee.run('user-a', 'Synthetic A', 'a@example.invalid');
    employee.run('user-b', 'Synthetic B', 'b@example.invalid');
    db.prepare('INSERT INTO employee_identities(user_id,open_id) VALUES(?,?)').run('user-b', 'direct-conflict');
    const insert = db.prepare(`INSERT INTO weekly_reports(id,employee_user_id,employee_name,week_label,week_start,week_end,content_json)
      VALUES (?,?,'Synthetic',?,?,?,?)`);
    for (const [id, end, userId, label, provider] of [
      ['anchor-a', '2026-08-07', 'user-a'],
      ['anchor-a-alias', '2026-08-14', 'user-a'],
      ['anchor-multiple-a', '2026-08-21', 'user-a'],
      ['anchor-multiple-b', '2026-08-21', 'user-b'],
      ['anchor-direct-conflict', '2026-09-04', 'user-a'],
      ['anchor-email-conflict', '2026-09-11', 'user-a'],
      ['anchor-ambiguous-a', '2026-09-18', 'user-a'],
      ['anchor-ambiguous-b', '2026-09-18', 'user-b'],
      ['existing-week', '2026-07-24', 'user-a'],
      ['existing-label', '2026-07-31', 'user-a', 'occupied-label'],
      ['same-id-wrong-week', '2026-09-25', 'user-a'],
      ['prior-import', '2026-10-02', 'user-a', undefined, 'legacy-reportos'],
    ]) {
      insert.run(id, userId, label ?? `合成周次 ${end}`, end, end, JSON.stringify({source: {provider: provider ?? 'feishu-report'}}));
    }
  } finally {
    db.close();
  }
}

seed(target);
const eligible = row('july-missing', '2026-07-10', 'old-a', {'状态': '迟交', 'ai': {summary: 'PRIVATE_UNUSED_AI'}});
const sourceRows = [
  row('anchor-a', '2026-08-07', 'old-a', {'企业邮箱': 'verified-a@example.invalid'}),
  row('anchor-a-alias', '2026-08-14', 'old-alias'),
  row('anchor-multiple-a', '2026-08-21', 'old-multiple'),
  row('anchor-multiple-b', '2026-08-21', 'old-multiple'),
  row('multiple-unknown', '2026-07-03', 'old-multiple'),
  row('anchor-direct-conflict', '2026-09-04', 'direct-conflict'),
  row('direct-conflict-missing', '2026-07-03', 'direct-conflict'),
  row('anchor-email-conflict', '2026-09-11', 'email-conflict', {'企业邮箱': ' B@example.invalid '}),
  row('email-conflict-missing', '2026-07-03', 'email-conflict'),
  row('anchor-ambiguous-a', '2026-09-18', 'ambiguous-a', {'企业邮箱': 'shared@example.invalid'}),
  row('anchor-ambiguous-b', '2026-09-18', 'ambiguous-b', {'企业邮箱': 'shared@example.invalid'}),
  row('ambiguous-email-only', '2026-06-05', 'ambiguous-fallback', {'企业邮箱': 'shared@example.invalid'}),
  row('unique-email-only', '2026-05-08', 'unverified', {'企业邮箱': 'a@example.invalid'}),
  row('prior-import', '2026-10-02', 'unverified-import'),
  row('after-import-only', '2026-07-03', 'unverified-import'),
  eligible,
  row('may-by-verified-email', '2026-05-15', 'historical-a', {'企业邮箱': ' Verified-A@example.invalid '}),
  row('fallback-conflict', '2026-06-05', 'legacy-hint-conflict', {'企业邮箱': 'verified-a@example.invalid', user_id: 'user-b'}),
  row('week-conflict', '2026-07-24', 'old-a', {'周次': 'other-label'}),
  row('label-conflict', '2026-07-17', 'old-a', {'周次': 'occupied-label'}),
  row('same-id-wrong-week', '2026-06-26'),
  row('duplicate-id', '2026-06-19'),
  row('duplicate-id', '2026-06-19'),
  row('duplicate-week-a', '2026-06-12'),
  row('duplicate-week-b', '2026-06-12', 'old-alias', {'周次': 'duplicate-alias-label'}),
  row('november', '2026-11-01'),
  row('wrong-date', '2026-06-05', 'old-a', {'结束日期': '2026-06-31'}),
  row('wrong-time', '2026-05-29', 'old-a', {'提交时间': '2026-05-29 25:00'}),
  row('wrong-score', '2026-05-22', 'old-a', {'总分': 'NaN'}),
  row('', '2026-05-15'),
  row('unsubmitted', '2026-05-08', 'old-a', {'状态': '未提交'}),
  row('invalid-facts', '2026-05-01', 'old-a', {'本周成果摘要': []}),
  null,
];
await writeFile(source, JSON.stringify({weekly_scores: sourceRows}), {mode: 0o600, flag: 'wx'});

const run = (filename, ...flags) => {
  const child = spawnSync(process.execPath, ['scripts/import-legacy-weekly-history.mjs', '--source', source, '--target-copy', filename, ...flags], {encoding: 'utf8'});
  assert(!`${child.stdout}${child.stderr}`.includes('PRIVATE_'), 'CLI output must not disclose any personal report fields');
  return child;
};
const snapshot = filename => {
  const db = new DatabaseSync(filename, {readOnly: true});
  try { return db.prepare('SELECT * FROM weekly_reports ORDER BY id').all(); }
  finally { db.close(); }
};
const result = (filename, ...flags) => {
  const child = run(filename, ...flags);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
};

const before = snapshot(target);
const preview = result(target);
assert.equal(preview.mode, 'dry-run');
assert.equal(preview.eligible, 2);
assert.equal(preview.eligibleViaEmail, 1);
assert.deepEqual(preview.eligibleByMonth, {'2026-05': 1, '2026-07': 1});
assert.equal(preview.inserted, 0);
assert.deepEqual(preview.crosswalk, {matchingReportRows: 8, verifiedIdentities: 4, verifiedOverlapEmails: 1, conflictingIdentities: 4});
assert.deepEqual(preview.skipped, {
  outsideCutoff: 1, invalidStructure: 2, missingOrInvalidIds: 1, invalidDates: 1,
  invalidTimestamp: 1, invalidScores: 1, unsubmitted: 1, unmappedIdentity: 3,
  conflictingIdentity: 8, ambiguousEmail: 3, ambiguousSource: 4, existingTarget: 2, targetConflict: 3,
});
assert.deepEqual(snapshot(target), before);

const applied = result(target, '--apply');
assert.equal(applied.inserted, 2);
assert.deepEqual(applied.skipped, preview.skipped);
const after = snapshot(target);
assert.deepEqual(after.filter(item => !['july-missing', 'may-by-verified-email'].includes(item.id)), before, 'apply preserves every existing row');
const imported = after.find(item => item.id === 'july-missing');
assert.equal(imported.employee_user_id, 'user-a');
assert.equal(after.find(item => item.id === 'may-by-verified-email').employee_user_id, 'user-a');
assert.equal(imported.employee_name, eligible['姓名']);
assert.equal(imported.department, eligible['部门']);
assert.equal(imported.status, eligible['状态']);
assert.equal(imported.is_late, 1);
assert.equal(imported.submitted_at, eligible['提交时间']);
const content = JSON.parse(imported.content_json);
const {ai: unused, open_id: oldId, '企业邮箱': email, '姓名': name, '部门': department, ...originalFields} = eligible;
assert.deepEqual(content, {...originalFields, source: {provider: 'legacy-reportos'}});

const repeat = result(target, '--apply');
assert.equal(repeat.eligible, 0);
assert.equal(repeat.inserted, 0);
assert.deepEqual(repeat.eligibleByMonth, {});
assert.deepEqual(repeat.crosswalk, preview.crosswalk, 'already imported rows must not become new authority for identity');
assert.equal(repeat.skipped.existingTarget, preview.skipped.existingTarget + 2);
assert.deepEqual(snapshot(target), after);

const rollbackTarget = path.join(folder, 'copy-with-failing-trigger.sqlite');
seed(rollbackTarget);
const triggerDb = new DatabaseSync(rollbackTarget);
try {
  triggerDb.exec(`CREATE TRIGGER fail_second_import BEFORE INSERT ON weekly_reports
    WHEN NEW.id='may-by-verified-email' BEGIN SELECT RAISE(ABORT, 'PRIVATE_SQLITE_ERROR'); END;`);
} finally { triggerDb.close(); }
assert.notEqual(run(rollbackTarget, '--apply').status, 0);
assert.deepEqual(snapshot(rollbackTarget), before, 'a failed insert rolls back earlier inserts in the same transaction');

const missingTarget = path.join(folder, 'missing.sqlite');
assert.notEqual(run(missingTarget, '--apply').status, 0);
assert(!existsSync(missingTarget));
console.log('Legacy weekly history tests passed. Synthetic artifacts retained:', folder);
