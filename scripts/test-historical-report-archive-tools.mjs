import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {archiveDigest, archiveFileSha256, canonicalArchiveJson, createLocalCopyDeclaration,
  importHistoricalArchive, writeArchiveJsonExclusive} from '../server/historical-report-archive-tools.mjs';

mkdirSync('outputs/tests', {recursive: true});
const folder = mkdtempSync(path.resolve('outputs/tests/historical-report-archive-'));
const schema = readFileSync('server/historical-report-archive-schema.sql', 'utf8');
const digest = 'a'.repeat(64);
let serial = 0;

function fixture(id, start, end, reflection = '') {
  const legacyRecord = {'源记录ID': id, '姓名': 'PRIVATE_NAME', '部门': 'PRIVATE_DEPARTMENT',
    '开始日期': start, '结束日期': end, '周次': `PRIVATE_WEEK ${end}`, '周期ID': `period-${end}`,
    '提交时间': `${end} 19:03`, '状态': '迟交', 'open_id': '', '企业邮箱': '',
    '本周成果摘要': 'PRIVATE_RESULTS', '问题摘要': 'PRIVATE_PROBLEMS', '下周计划摘要': 'PRIVATE_PLAN',
    '思考与复盘摘要': reflection, '成果分': 0, '问题分': 100, '计划分': 80.3, '复盘分': '72.0', '总分': 91.625,
    '准时分': 0, '等级': 'A', '导入批次': 'PRIVATE_ORIGINAL_BATCH'};
  const rawRecord = {task_id: id.slice('lark-report-'.length), from_user_id: 'PRIVATE_RAW_ID', from_user_name: 'PRIVATE_NAME',
    commit_time: Date.parse(`${end}T19:03:37+08:00`) / 1000,
    form_contents: [['本周成果', 'PRIVATE_RESULTS'], ['问题与挑战', 'PRIVATE_PROBLEMS'], ['下周工作计划', 'PRIVATE_PLAN'],
      ['思考与复盘，目前耗时Top5的工作内容如何优化', reflection || 'PRIVATE_RECOVERED_REFLECTION']]
      .map(([field_name, field_value]) => ({field_name, field_value}))};
  return {employeeUserId: 'person-a', legacyRecord, rawRecord,
    identityEvidence: {anchorReports: [{sourceReportId: 'lark-report-9001', rawFromUserId: 'PRIVATE_RAW_ID'}]},
    provenance: {legacySource: {path: 'PRIVATE_LEGACY_PATH', sha256: digest}, rawSource: {path: 'PRIVATE_RAW_PATH', sha256: digest}}};
}
const entries = [fixture('lark-report-1001', '2026-06-08', '2026-06-12'), fixture('lark-report-1002', '2026-06-15', '2026-06-19', 'PRIVATE_SAVED_REFLECTION')];

function seed(filename, archive = false) {
  const database = new DatabaseSync(filename);
  try {
    database.exec(`CREATE TABLE employees(user_id TEXT PRIMARY KEY,name TEXT,email TEXT);
      CREATE TABLE weekly_reports(id TEXT PRIMARY KEY,employee_user_id TEXT,week_end TEXT,week_label TEXT,content_json TEXT);
      CREATE TABLE performance_results(id TEXT PRIMARY KEY,result_json TEXT);
      CREATE TABLE reminder_state(id TEXT PRIMARY KEY,value TEXT);`);
    database.prepare('INSERT INTO employees VALUES(?,?,?)').run('person-a', 'PRIVATE_NAME', 'PRIVATE_EMAIL');
    database.prepare('INSERT INTO employees VALUES(?,?,?)').run('person-b', 'PRIVATE_OTHER_NAME', 'PRIVATE_EMAIL_2');
    database.prepare('INSERT INTO weekly_reports VALUES(?,?,?,?,?)').run('lark-report-9001', 'person-a', '2026-07-03', 'PRIVATE_ANCHOR_WEEK', JSON.stringify({source: {provider: 'feishu-report'}, results: 'PRIVATE_ANCHOR_FACTS'}));
    database.prepare('INSERT INTO performance_results VALUES(?,?)').run('locked-result', 'PRIVATE_UNCHANGED_SCORE');
    database.prepare('INSERT INTO reminder_state VALUES(?,?)').run('unchanged-reminder', 'PRIVATE_UNCHANGED_REMINDER');
    if (archive) database.exec(schema);
  } finally { database.close(); }
  chmodSync(filename, 0o600);
}

const jsonFile = (name, value) => { const filename = path.join(folder, name); writeArchiveJsonExclusive(filename, value); return filename; };
async function setup(options = {}) {
  const n = ++serial, target = path.join(folder, `copy-${n}.sqlite`); seed(target, options.archive);
  if (options.mutateDatabase) {
    const database = new DatabaseSync(target);
    try { options.mutateDatabase(database); } finally { database.close(); }
  }
  const source = jsonFile(`source-${n}.json`, {version: 1, entries: options.entries || structuredClone(entries)});
  const approved = jsonFile(`approved-${n}.json`, {version: 1, purpose: 'verified-historical-report-archive', sourceReportIds: ['lark-report-1001', 'lark-report-1002']});
  const declaration = jsonFile(`declaration-${n}.json`, await createLocalCopyDeclaration(target));
  return {package: source, approvedList: approved, approvedListSha256: await archiveFileSha256(approved),
    targetCopy: target, copyDeclaration: declaration, plan: path.join(folder, `plan-${n}.json`)};
}

function command(mode, options, ...extra) {
  const args = [`scripts/${mode}-historical-report-archive.mjs`, '--package', options.package,
    '--approved-list', options.approvedList, '--approved-list-sha256', options.approvedListSha256,
    '--target-copy', options.targetCopy, '--copy-declaration', options.copyDeclaration,
    mode === 'prepare' ? '--out' : '--plan', options.plan, ...extra];
  const result = spawnSync(process.execPath, args, {encoding: 'utf8'});
  assert(!`${result.stdout}${result.stderr}`.includes('PRIVATE_'), 'CLI output must not include business content or identities');
  return result;
}
const successful = child => { assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout); };
function inspect(filename) {
  const database = new DatabaseSync(filename, {readOnly: true});
  try {
    const archive = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='historical_report_archives'").get();
    return {employees: database.prepare('SELECT * FROM employees ORDER BY user_id').all(), reports: database.prepare('SELECT * FROM weekly_reports ORDER BY id').all(),
      performance: database.prepare('SELECT * FROM performance_results').all(), reminders: database.prepare('SELECT * FROM reminder_state').all(),
      archives: archive ? database.prepare('SELECT * FROM historical_report_archives ORDER BY id').all() : []};
  } finally { database.close(); }
}

const main = await setup();
const before = inspect(main.targetCopy), initialFileSha = await archiveFileSha256(main.targetCopy);
assert.equal(successful(command('prepare', main)).proposedInserts, 2);
assert.equal(await archiveFileSha256(main.targetCopy), initialFileSha, 'prepare is byte-for-byte read-only');
const preview = successful(command('import', main));
assert.equal(preview.inserted, 0); assert.equal(preview.proposedInserts, 2);
assert.equal(await archiveFileSha256(main.targetCopy), initialFileSha, 'import defaults to read-only');
const applied = successful(command('import', main, '--apply'));
assert.equal(applied.inserted, 2);
const after = inspect(main.targetCopy);
assert.deepEqual({...after, archives: []}, before, 'active reports, employees, scores and reminders are unchanged');
assert.deepEqual(JSON.parse(after.archives[0].content_json), entries[0].legacyRecord);
assert.equal(after.archives[0].source_sha256, archiveDigest(entries[0].legacyRecord));
assert.deepEqual(JSON.parse(after.archives[0].recovered_json), {reflection: {text: 'PRIVATE_RECOVERED_REFLECTION', source: '原始飞书汇报', reason: '旧版导入字段遗漏'}});
assert.deepEqual(JSON.parse(after.archives[1].recovered_json), {}, 'saved nonempty reflection is preserved without a replacement');
assert.equal(successful(command('import', main, '--apply')).inserted, 0, 'same plan is idempotent after the file SHA changes');
assert.deepEqual(inspect(main.targetCopy), after);
assert.notEqual(command('prepare', main).status, 0, 'exclusive output and initial file binding reject an overwritten/reused plan');
const locked = new DatabaseSync(main.targetCopy);
try {
  assert.throws(() => locked.prepare("UPDATE historical_report_archives SET status='changed'").run(), /historical_archive_locked/);
} finally { locked.close(); }

const rejectedMutations = [
  value => { value.entries[0].legacyRecord['源记录ID'] = 'lark-report-213'; },
  value => { value.entries[0].rawRecord.task_id = '999'; },
  value => { value.entries[0].identityEvidence.anchorReports[0].rawFromUserId = 'other-identity'; },
  value => { value.entries[0].employeeUserId = 'person-b'; },
  value => { value.entries[0].rawRecord.form_contents[0].field_value = 'PRIVATE_CHANGED_FACTS'; },
  value => { value.entries[0].rawRecord.commit_time += 3600; },
  value => { value.entries[0].legacyRecord['结束日期'] = '2026-06-31'; },
  value => { value.entries[0].legacyRecord['提交时间'] = '2026-06-12 25:03'; },
  value => { value.entries[0].rawRecord.form_contents.push(value.entries[0].rawRecord.form_contents[3]); },
  value => { value.entries[0].identityEvidence.anchorReports = []; },
  value => { value.entries[1] = structuredClone(value.entries[0]); },
];
for (const mutate of rejectedMutations) {
  const data = {entries: structuredClone(entries)}; mutate(data);
  const item = await setup({entries: data.entries});
  assert.notEqual(command('prepare', item).status, 0);
  assert.equal(inspect(item.targetCopy).archives.length, 0);
}

const currentConflict = await setup({mutateDatabase: database => database.prepare('INSERT INTO weekly_reports VALUES(?,?,?,?,?)').run('other-current-id', 'person-a', '2026-06-12', 'PRIVATE_CURRENT_WEEK', '{}')});
assert.notEqual(command('prepare', currentConflict).status, 0, 'same person/week in active reports cannot be imported as a separate archive');
const fakeAuthority = await setup({mutateDatabase: database => database.prepare('UPDATE weekly_reports SET content_json=?').run('{"source":{"provider":"legacy-reportos"}}')});
assert.notEqual(command('prepare', fakeAuthority).status, 0, 'a prior legacy import is not independent identity evidence');
const wrongHash = await setup(); wrongHash.approvedListSha256 = 'b'.repeat(64);
assert.notEqual(command('prepare', wrongHash).status, 0);

const stale = await setup(); successful(command('prepare', stale));
const changed = new DatabaseSync(stale.targetCopy);
try { changed.prepare('INSERT INTO reminder_state VALUES(?,?)').run('new-state', 'PRIVATE_NEW_STATE'); } finally { changed.close(); }
assert.notEqual(command('import', stale, '--apply').status, 0, 'nonarchive drift invalidates a prepared plan');
assert.equal(inspect(stale.targetCopy).archives.length, 0);

const tampered = await setup(); successful(command('prepare', tampered));
const modifiedPlan = JSON.parse(readFileSync(tampered.plan, 'utf8')); modifiedPlan.recordCount++;
const altered = {...tampered, plan: jsonFile('altered-plan.json', modifiedPlan)};
assert.notEqual(command('import', altered, '--apply').status, 0);
const changedPackage = await setup(); successful(command('prepare', changedPackage));
const changedSource = JSON.parse(readFileSync(changedPackage.package, 'utf8')); changedSource.entries[0].legacyRecord['总分'] = 0;
changedPackage.package = jsonFile('changed-package.json', changedSource);
assert.notEqual(command('import', changedPackage, '--apply').status, 0, 'a different package cannot reuse a previously reviewed plan');
const wrongHost = await setup();
const declaration = JSON.parse(readFileSync(wrongHost.copyDeclaration, 'utf8')); declaration.host = 'unrelated-server.invalid';
wrongHost.copyDeclaration = jsonFile('wrong-host-declaration.json', declaration);
assert.notEqual(command('prepare', wrongHost).status, 0, 'a declaration from another host cannot authorize this copy');

const alias = await setup();
const symlink = path.join(folder, 'symlink.sqlite'); symlinkSync(alias.targetCopy, symlink);
assert.notEqual(command('prepare', {...alias, targetCopy: symlink}).status, 0);
const hardlink = path.join(folder, 'hardlink.sqlite'); linkSync(alias.targetCopy, hardlink);
assert.notEqual(command('prepare', {...alias, targetCopy: hardlink}).status, 0);
assert.notEqual(command('prepare', alias).status, 0, 'the original inode becomes unsafe after a hard link is added');
const noTarget = await setup(); noTarget.targetCopy = path.join(folder, 'absent.sqlite');
assert.notEqual(command('import', noTarget, '--apply').status, 0); assert(!existsSync(noTarget.targetCopy));

const insertTrigger = await setup({archive: true});
const triggerDb = new DatabaseSync(insertTrigger.targetCopy);
try { triggerDb.exec("CREATE TRIGGER malicious_archive_insert AFTER INSERT ON historical_report_archives BEGIN INSERT INTO reminder_state VALUES(NEW.id,'PRIVATE_WRITE'); END;"); }
finally { triggerDb.close(); }
assert.notEqual(command('prepare', insertTrigger).status, 0, 'unexpected INSERT side effects are rejected before any archive write');

const rollback = await setup(); successful(command('prepare', rollback));
const originalPrepare = DatabaseSync.prototype.prepare;
let inserts = 0;
DatabaseSync.prototype.prepare = function (sql) {
  const statement = originalPrepare.call(this, sql);
  if (sql.startsWith('INSERT INTO historical_report_archives(')) return {run(...args) {
    if (++inserts === 2) throw new Error('PRIVATE_SIMULATED_DISK_FAILURE');
    return statement.run(...args);
  }};
  return statement;
};
try { await assert.rejects(importHistoricalArchive({...rollback, apply: true}), /PRIVATE_SIMULATED_DISK_FAILURE/); }
finally { DatabaseSync.prototype.prepare = originalPrepare; }
assert.equal(inserts, 2);
assert.deepEqual(inspect(rollback.targetCopy).archives, [], 'a failed second insert rolls back the first insert and schema creation');

console.log('Historical archive tests passed: evidence validation, source allowlist, private copy and plan binding, dry-run, isolated atomic insert, original-score preservation, recovery separation, idempotency, drift and trigger rejection. Synthetic artifacts retained:', folder);
