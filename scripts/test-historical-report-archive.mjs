import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHistoricalReportArchive} from '../server/historical-report-archive.mjs';

const sql = value => value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const privateMarker = 'PRIVATE_ARCHIVE_IDENTITY_PATH_HASH_AND_EVIDENCE';
const database = new DatabaseSync(':memory:');
const statements = [];
try {
  database.exec(`
    CREATE TABLE employees(user_id TEXT PRIMARY KEY);
    CREATE TABLE historical_report_archives(
      id TEXT PRIMARY KEY,source_system TEXT,source_report_id TEXT,employee_user_id TEXT,
      employee_name TEXT,department TEXT,week_label TEXT,week_start TEXT,week_end TEXT,
      submitted_at TEXT,status TEXT,content_json TEXT,recovered_json TEXT,provenance_json TEXT,
      source_sha256 TEXT,import_batch_id TEXT,archived_at TEXT,
      UNIQUE(source_system,source_report_id)
    );
    CREATE TABLE weekly_reports(id TEXT PRIMARY KEY,content_json TEXT);
    CREATE TABLE automatic_performance_results(id TEXT PRIMARY KEY,result_json TEXT);
    INSERT INTO weekly_reports VALUES('unchanged-live-report','{"score":77}');
    INSERT INTO automatic_performance_results VALUES('unchanged-performance','{"score":81}');
  `);
  const insert = database.prepare(`INSERT INTO historical_report_archives VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const original = {
    '本周成果摘要': '<b>合成原文成果</b>\n证据保持原样', '问题摘要': '合成问题',
    '下周计划摘要': '合成计划', '思考与复盘摘要': '',
    '成果分': 80, '问题分': '70.5', '计划分': 90, '复盘分': 0,
    '总分': 76.125, '准时分': 100, '等级': 'B',
    open_id: privateMarker, user_id: privateMarker, '企业邮箱': privateMarker,
    source: {path: privateMarker}, unknownPrivateField: privateMarker,
  };
  function seed(id, userId, end, overrides = {}) {
    const content = overrides.content ?? original;
    const recovered = overrides.recovered ?? {};
    insert.run(id, 'reportos', id.slice('reportos:'.length), userId, '合成员工', '合成部门',
      '合成周次 ' + end, end.slice(0, 8) + '01', end, end + ' 19:00', '准时',
      typeof content === 'string' ? content : JSON.stringify(content), JSON.stringify(recovered),
      JSON.stringify({path: privateMarker, internalIdentity: privateMarker}),
      privateMarker, privateMarker, '2026-11-26T08:00:00Z');
  }
  seed('reportos:a-july', 'user-a', '2026-07-17');
  seed('reportos:a-september', 'user-a', '2026-09-04', {
    recovered: {reflection: {text: '新找回的原始复盘，单独保留', source: 'feishu_raw_form', reason: '旧版解析未提取复盘', privateEvidence: privateMarker}, path: privateMarker},
  });
  seed('reportos:b-october', 'user-b', '2026-10-09', {content: {...original, '总分': 0}});
  seed('reportos:quoted', "user'quoted", '2026-08-07');

  const before = {
    reports: database.prepare('SELECT * FROM weekly_reports').all(),
    performance: database.prepare('SELECT * FROM automatic_performance_results').all(),
    archiveCount: database.prepare('SELECT count(*) AS n FROM historical_report_archives').get().n,
    changes: database.prepare('SELECT total_changes() AS n').get().n,
  };
  database.exec('PRAGMA query_only=ON');
  const archive = createHistoricalReportArchive({
    query: async statement => {
      assert.match(statement, /^SELECT\b/);
      assert.doesNotMatch(statement, /\b(?:weekly_reports|automatic_performance_results|performance_results|app_settings)\b/);
      statements.push(statement);
      return database.prepare(statement).all();
    },
    sql,
  });

  // An absent, empty, or string-valued management scope must never read company data.
  const initialReads = statements.length;
  await assert.rejects(archive.list(), /historical_archive_scope_required/);
  await assert.rejects(archive.list({management: 'true'}), /historical_archive_scope_required/);
  await assert.rejects(archive.list({employeeUserId: ''}), /historical_archive_scope_required/);
  await assert.rejects(archive.detail('reportos:a-july'), /historical_archive_scope_required/);
  assert.equal(statements.length, initialReads);

  const personal = await archive.list({employeeUserId: 'user-a'});
  assert.equal(personal.total, 2);
  assert.deepEqual(personal.items.map(row => row.id), ['reportos:a-september', 'reportos:a-july']);
  assert.deepEqual(personal.months, ['2026-09', '2026-07']);
  assert.equal(personal.readOnly, true);
  assert.equal(personal.affectsPerformance, false);
  assert.equal(personal.limit, 50);
  assert.equal(personal.offset, 0);
  assert.deepEqual(Object.keys(personal.items[0]).sort(), [
    'id', 'employeeName', 'department', 'weekLabel', 'weekStart', 'weekEnd', 'month',
    'submittedAt', 'status', 'oldScore', 'sourceSummary',
  ].sort());
  assert(!JSON.stringify(personal).includes('合成原文成果'), 'List must defer original report bodies');
  assert(!JSON.stringify(personal).includes(privateMarker));
  assert.equal(await archive.detail('reportos:b-october', {employeeUserId: 'user-a'}), null);
  assert.equal(await archive.detail('reportos:unknown', {management: true}), null);
  assert.equal((await archive.list({employeeUserId: 'no-archive-user'})).total, 0);

  const detail = await archive.detail('reportos:a-september', {employeeUserId: 'user-a'});
  assert.deepEqual(detail.facts, {results: original['本周成果摘要'], problems: '合成问题', nextPlan: '合成计划', reflection: ''});
  assert.deepEqual(detail.legacyScores, {results: 80, problems: 70.5, nextPlan: 90, reflection: 0, total: 76.125, onTime: 100, grade: 'B'});
  assert.deepEqual(detail.recoveredReflection, {text: '新找回的原始复盘，单独保留', source: 'feishu_raw_form', reason: '旧版解析未提取复盘'});
  assert.equal(detail.facts.reflection, '', 'Recovered reflection must not overwrite the old saved text');
  assert.deepEqual(detail.sourceSummary, {system: 'reportos', reportId: 'a-september', archivedAt: '2026-11-26T08:00:00Z'});
  assert.equal(detail.readOnly, true);
  assert.equal(detail.affectsPerformance, false);
  assert(!JSON.stringify(detail).includes(privateMarker), 'Unknown JSON, paths, evidence and identity mapping must not escape');
  assert.equal((await archive.detail('reportos:a-july', {management: true})).recoveredReflection, null);

  const managed = await archive.list({management: true, limit: '1', offset: '1'});
  assert.equal(managed.total, 4);
  assert.equal(managed.items.length, 1);
  assert.equal(managed.items[0].id, 'reportos:a-september');
  assert.deepEqual(managed.months, ['2026-10', '2026-09', '2026-08', '2026-07']);
  assert.equal((await archive.list({management: true, employeeUserId: 'user-a'})).total, 2, 'A management employee filter must still narrow scope');
  const filtered = await archive.list({employeeUserId: 'user-a', month: '2026-07'});
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].id, 'reportos:a-july');
  assert.deepEqual(filtered.months, ['2026-09', '2026-07']);
  assert.equal((await archive.detail('reportos:b-october', {management: true})).oldScore, 0);
  assert.equal((await archive.list({employeeUserId: "user'quoted"})).total, 1);
  assert.equal((await archive.list({employeeUserId: "user-a' OR 1=1 --"})).total, 0);
  assert.equal(await archive.detail("reportos:a-july' OR 1=1 --", {employeeUserId: 'user-a'}), null);

  for (const options of [
    {month: '2026-13'}, {month: "2026-07' OR 1=1 --"}, {month: 202607},
    {limit: 0}, {limit: 101}, {limit: '1; SELECT 1'}, {offset: -1}, {offset: 0.5}, {offset: 1_000_001},
  ]) {
    await assert.rejects(archive.list({employeeUserId: 'user-a', ...options}), /invalid_historical_archive_/);
  }
  await assert.rejects(archive.detail('', {management: true}), /invalid_historical_archive_id/);
  await assert.rejects(archive.detail(7, {management: true}), /invalid_historical_archive_id/);

  // Compatibility only covers this optional table being absent; all other DB failures remain visible.
  const absent = createHistoricalReportArchive({query: async () => { throw Error('Parse error: no such table: historical_report_archives'); }, sql});
  assert.deepEqual(await absent.list({employeeUserId: 'user-a'}), {items: [], total: 0, months: [], limit: 50, offset: 0, readOnly: true, affectsPerformance: false});
  assert.equal(await absent.detail('reportos:a-july', {employeeUserId: 'user-a'}), null);
  for (const message of ['database is locked', 'no such table: weekly_reports', 'no such table: historical_report_archives_other']) {
    const error = Error(message);
    const broken = createHistoricalReportArchive({query: async () => { throw error; }, sql});
    await assert.rejects(broken.list({management: true}), value => value === error);
    await assert.rejects(broken.detail('reportos:a-july', {management: true}), value => value === error);
  }
  const invalidContent = createHistoricalReportArchive({query: async () => [{id: 'reportos:bad', content_json: privateMarker, recovered_json: '{}'}], sql});
  await assert.rejects(invalidContent.detail('reportos:bad', {management: true}), error => error.message === 'historical_archive_content_invalid');

  assert.deepEqual(database.prepare('SELECT * FROM weekly_reports').all(), before.reports);
  assert.deepEqual(database.prepare('SELECT * FROM automatic_performance_results').all(), before.performance);
  assert.equal(database.prepare('SELECT count(*) AS n FROM historical_report_archives').get().n, before.archiveCount);
  assert.equal(database.prepare('SELECT total_changes() AS n').get().n, before.changes, 'Reading archives must perform no writes, including automatic score snapshots');
  console.log('Historical report archive: scope, privacy, pagination, missing-table compatibility and zero-write isolation passed.');
} finally {
  database.close();
}
