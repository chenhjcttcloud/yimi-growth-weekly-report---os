import {createHash} from 'node:crypto';
import {createReadStream, closeSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {hostname} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = path.join(root, 'outputs');
const archiveTable = 'historical_report_archives';
const schema = readFileSync(new URL('./historical-report-archive-schema.sql', import.meta.url), 'utf8');
const columns = ['id', 'source_system', 'source_report_id', 'employee_user_id', 'employee_name', 'department',
  'week_label', 'week_start', 'week_end', 'submitted_at', 'status', 'content_json', 'recovered_json',
  'provenance_json', 'source_sha256', 'import_batch_id', 'archived_at'];
const shaPattern = /^[a-f0-9]{64}$/;
const sourcePattern = /^lark-report-\d+$/;
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const nonempty = value => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
const normalized = value => String(value ?? '').replace(/\s+/gu, '');
const quoted = value => '"' + value.replaceAll('"', '""') + '"';

export class HistoricalArchiveError extends Error {}
function fail(code) { throw new HistoricalArchiveError(code); }
function requireValue(condition, code) { if (!condition) fail(code); }

export function canonicalArchiveJson(value) {
  if (typeof value === 'bigint') return JSON.stringify({$bigint: value.toString()});
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return JSON.stringify({$bytes: Buffer.from(value).toString('hex')});
  if (Array.isArray(value)) return '[' + value.map(canonicalArchiveJson).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalArchiveJson(value[key])).join(',') + '}';
  const encoded = JSON.stringify(value);
  if (encoded === undefined || typeof value === 'number' && !Number.isFinite(value)) fail('invalid_json_value');
  return encoded;
}
export const archiveDigest = value => createHash('sha256').update(canonicalArchiveJson(value)).digest('hex');

export async function archiveFileSha256(filename) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest('hex');
}

function privateFile(filename) {
  const absolute = path.resolve(filename);
  const stat = lstatSync(absolute);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && realpathSync(absolute) === absolute, 'regular_unaliased_file_required');
  requireValue((stat.mode & 0o077) === 0, 'private_file_permissions_required');
  return {path: absolute, stat};
}

function localCopy(filename) {
  const file = privateFile(filename);
  requireValue(file.path.startsWith(outputRoot + path.sep) && !/(?:^|\/)(?:live|production|prod)(?:\/|$)/iu.test(file.path), 'isolated_outputs_copy_required');
  requireValue(file.stat.nlink === 1, 'hardlinked_copy_rejected');
  requireValue(/\.(?:sqlite|sqlite3|db)$/iu.test(file.path), 'sqlite_copy_extension_required');
  return file;
}

function loadPrivateJson(filename) {
  const file = privateFile(filename);
  const bytes = readFileSync(file.path);
  return {value: JSON.parse(bytes), sha256: createHash('sha256').update(bytes).digest('hex'), path: file.path};
}

function schemaObjects(database, archiveOnly = false) {
  return database.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND ${archiveOnly ? 'tbl_name=?' : 'tbl_name<>?'} ORDER BY type,name`).all(archiveTable);
}

let expectedArchiveObjects;
function checkArchiveSchema(database) {
  const actual = schemaObjects(database, true);
  if (!actual.length) return false;
  if (!expectedArchiveObjects) {
    const memory = new DatabaseSync(':memory:');
    try { memory.exec(schema); expectedArchiveObjects = schemaObjects(memory, true); }
    finally { memory.close(); }
  }
  requireValue(canonicalArchiveJson(actual) === canonicalArchiveJson(expectedArchiveObjects), 'unexpected_archive_schema_or_trigger');
  return true;
}

// Stream rows, including large TEXT/BLOB fields, rather than collecting a whole database.
export function nonArchiveFingerprint(database) {
  const hash = createHash('sha256');
  for (const name of ['application_id', 'user_version', 'encoding']) hash.update(canonicalArchiveJson(database.prepare(`PRAGMA ${name}`).get()) + '\n');
  hash.update(canonicalArchiveJson(schemaObjects(database)) + '\n');
  const tables = database.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>? ORDER BY name").all(archiveTable);
  for (const table of tables) {
    hash.update(JSON.stringify(table.name) + '\n');
    const info = database.prepare(`PRAGMA table_info(${quoted(table.name)})`).all();
    const primary = info.filter(column => column.pk).sort((first, second) => first.pk - second.pk);
    const order = /\bWITHOUT\s+ROWID\b/iu.test(table.sql || '') ? primary.map(column => quoted(column.name)).join(',') : 'rowid';
    const statement = database.prepare(`SELECT * FROM ${quoted(table.name)} ORDER BY ${order}`);
    statement.setReadBigInts(true);
    for (const row of statement.iterate()) hash.update(canonicalArchiveJson(row) + '\n');
  }
  return hash.digest('hex');
}

function archiveFingerprint(database, additions = []) {
  const hash = createHash('sha256');
  const pending = [...additions].sort((first, second) => first.id.localeCompare(second.id, 'en'));
  let position = 0;
  const exists = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(archiveTable));
  if (exists) for (const row of database.prepare(`SELECT ${columns.join(',')} FROM ${archiveTable} ORDER BY id COLLATE BINARY`).iterate()) {
    while (position < pending.length && pending[position].id < row.id) hash.update(canonicalArchiveJson(pending[position++]) + '\n');
    requireValue(position >= pending.length || pending[position].id !== row.id, 'archive_plan_duplicate');
    hash.update(canonicalArchiveJson(row) + '\n');
  }
  while (position < pending.length) hash.update(canonicalArchiveJson(pending[position++]) + '\n');
  return hash.digest('hex');
}

export async function createLocalCopyDeclaration(filename) {
  const file = localCopy(filename);
  const database = new DatabaseSync(file.path, {readOnly: true});
  try {
    database.exec('PRAGMA query_only=ON; BEGIN;');
    checkArchiveSchema(database);
    return {version: 1, kind: 'isolated-local-sqlite-copy', host: hostname(), isolatedCopy: true,
      target: {realPath: file.path, dev: file.stat.dev, ino: file.stat.ino, nlink: 1},
      initialFileSha256: await archiveFileSha256(file.path), nonArchiveSha256: nonArchiveFingerprint(database)};
  } finally { database.close(); }
}

export function writeArchiveJsonExclusive(filename, value) {
  const absolute = path.resolve(filename);
  requireValue(absolute.startsWith(outputRoot + path.sep), 'private_outputs_destination_required');
  const parent = path.dirname(absolute);
  requireValue(realpathSync(parent) === parent, 'unaliased_destination_required');
  const descriptor = openSync(absolute, 'wx', 0o600);
  try { writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n'); }
  finally { closeSync(descriptor); }
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

function rawSections(raw) {
  requireValue(Array.isArray(raw.form_contents), 'raw_form_fields_required');
  const sections = {};
  for (const [key, prefix] of [['results', '本周成果'], ['problems', '问题与挑战'], ['nextPlan', '下周工作计划'], ['reflection', '思考与复盘']]) {
    const fields = raw.form_contents.filter(field => plain(field) && typeof field.field_name === 'string' && field.field_name.trim().startsWith(prefix));
    requireValue(fields.length === 1 && typeof fields[0].field_value === 'string', 'unique_raw_section_required');
    sections[key] = fields[0].field_value;
  }
  return sections;
}

function evidenceSource(value) {
  return plain(value) && nonempty(value.path) && shaPattern.test(value.sha256 || '');
}

function archiveBusinessRow(entry, approvedIds, database) {
  requireValue(plain(entry) && plain(entry.legacyRecord) && plain(entry.rawRecord) && plain(entry.identityEvidence), 'entry_evidence_required');
  const legacy = entry.legacyRecord, raw = entry.rawRecord, id = legacy['源记录ID'];
  requireValue(sourcePattern.test(id || '') && approvedIds.has(id) && id === 'lark-report-' + raw.task_id, 'unapproved_or_mismatched_source');
  requireValue(nonempty(entry.employeeUserId) && nonempty(legacy['姓名']) && raw.from_user_name === legacy['姓名'], 'source_name_mismatch');
  const employee = database.prepare('SELECT user_id,name FROM employees WHERE user_id=?').get(entry.employeeUserId);
  requireValue(employee && employee.name === legacy['姓名'], 'target_employee_mismatch');
  requireValue(validDate(legacy['开始日期']) && validDate(legacy['结束日期']) && legacy['开始日期'] <= legacy['结束日期'], 'invalid_archive_dates');
  requireValue(nonempty(legacy['周次']) && nonempty(legacy['状态']) && !['未交', '未提交', '未汇报'].includes(legacy['状态']) && typeof legacy['部门'] === 'string', 'invalid_legacy_metadata');
  const submitted = String(legacy['提交时间'] || '');
  requireValue(/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u.test(submitted) &&
    validDate(submitted.slice(0, 10)) && Number.isFinite(Date.parse(submitted.replace(' ', 'T') + '+08:00')), 'invalid_archive_timestamp');
  const rawTime = Number(raw.commit_time) * 1000, legacyTime = Date.parse(submitted.replace(' ', 'T') + '+08:00');
  requireValue(Number.isFinite(rawTime) && Math.floor(rawTime / 60000) === Math.floor(legacyTime / 60000), 'raw_timestamp_mismatch');
  requireValue(nonempty(raw.from_user_id), 'raw_identity_required');
  const anchors = entry.identityEvidence.anchorReports;
  requireValue(Array.isArray(anchors) && anchors.length > 0, 'independent_identity_anchors_required');
  const anchorIds = new Set();
  for (const anchor of anchors) {
    requireValue(plain(anchor) && sourcePattern.test(anchor.sourceReportId || '') && !approvedIds.has(anchor.sourceReportId) && !anchorIds.has(anchor.sourceReportId) && anchor.rawFromUserId === raw.from_user_id, 'invalid_identity_anchor');
    anchorIds.add(anchor.sourceReportId);
    const current = database.prepare("SELECT employee_user_id,content_json FROM weekly_reports WHERE id=?").get(anchor.sourceReportId);
    requireValue(current && current.employee_user_id === entry.employeeUserId, 'identity_anchor_target_mismatch');
    const content = JSON.parse(current.content_json);
    requireValue(content?.source?.provider !== 'legacy-reportos', 'archive_cannot_authorize_identity');
  }
  const facts = rawSections(raw);
  for (const [key, field] of [['results', '本周成果摘要'], ['problems', '问题摘要'], ['nextPlan', '下周计划摘要'], ['reflection', '思考与复盘摘要']]) {
    requireValue(typeof legacy[field] === 'string', 'legacy_four_sections_required');
    requireValue(key === 'reflection' && !normalized(legacy[field]) || normalized(legacy[field]) === normalized(facts[key]), 'legacy_raw_content_mismatch');
  }
  for (const field of ['成果分', '问题分', '计划分', '复盘分', '总分']) {
    const value = legacy[field];
    requireValue((typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value)) && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100, 'invalid_legacy_saved_score');
  }
  requireValue(plain(entry.provenance) && evidenceSource(entry.provenance.legacySource) && evidenceSource(entry.provenance.rawSource), 'source_provenance_required');
  requireValue(!database.prepare('SELECT 1 FROM weekly_reports WHERE id=? OR (employee_user_id=? AND (week_end=? OR week_label=?))').get(id, entry.employeeUserId, legacy['结束日期'], legacy['周次']), 'current_report_conflict');
  const recovered = !normalized(legacy['思考与复盘摘要']) && normalized(facts.reflection)
    ? {reflection: {text: facts.reflection, source: '原始飞书汇报', reason: '旧版导入字段遗漏'}} : {};
  const provenance = {...entry.provenance, identityEvidence: entry.identityEvidence,
    raw: {taskId: String(raw.task_id), fromUserId: raw.from_user_id, commitTime: raw.commit_time, sha256: archiveDigest(raw)}};
  return {id: 'reportos:' + id, source_system: 'reportos', source_report_id: id,
    employee_user_id: entry.employeeUserId, employee_name: legacy['姓名'], department: legacy['部门'],
    week_label: legacy['周次'], week_start: legacy['开始日期'], week_end: legacy['结束日期'], submitted_at: submitted, status: legacy['状态'],
    content_json: canonicalArchiveJson(legacy), recovered_json: canonicalArchiveJson(recovered), provenance_json: canonicalArchiveJson(provenance), source_sha256: archiveDigest(legacy)};
}

function archiveRows(input, database, batchId, at) {
  const rows = [], additions = [], seenWeeks = new Set();
  const exists = checkArchiveSchema(database);
  for (const entry of input.package.value.entries) {
    const business = archiveBusinessRow(entry, input.approvedIds, database);
    const key = JSON.stringify([business.employee_user_id, business.week_end]);
    requireValue(!seenWeeks.has(key), 'package_person_period_conflict'); seenWeeks.add(key);
    const existing = exists ? database.prepare(`SELECT ${columns.join(',')} FROM ${archiveTable} WHERE id=? OR (source_system='reportos' AND source_report_id=?)`).get(business.id, business.source_report_id) : undefined;
    if (existing) {
      const savedBusiness = Object.fromEntries(Object.keys(business).map(key => [key, existing[key]]));
      requireValue(canonicalArchiveJson(savedBusiness) === canonicalArchiveJson(business), 'existing_archive_conflict');
      rows.push(existing);
    } else {
      if (exists) requireValue(!database.prepare(`SELECT 1 FROM ${archiveTable} WHERE employee_user_id=? AND week_end=?`).get(business.employee_user_id, business.week_end), 'archive_person_period_conflict');
      const row = {...business, import_batch_id: batchId, archived_at: at}; rows.push(row); additions.push(row);
    }
  }
  rows.sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  return {rows, additions};
}

async function inputs(options) {
  const source = loadPrivateJson(options.package), approved = loadPrivateJson(options.approvedList), declaration = loadPrivateJson(options.copyDeclaration);
  requireValue(shaPattern.test(options.approvedListSha256 || '') && options.approvedListSha256 === approved.sha256, 'approved_list_hash_mismatch');
  requireValue(approved.value.version === 1 && approved.value.purpose === 'verified-historical-report-archive' && Array.isArray(approved.value.sourceReportIds), 'invalid_approved_list');
  const approvedIds = new Set(approved.value.sourceReportIds);
  requireValue(approvedIds.size > 0 && approvedIds.size <= 7 && approvedIds.size === approved.value.sourceReportIds.length && [...approvedIds].every(id => sourcePattern.test(id)), 'invalid_approved_source_ids');
  requireValue(source.value.version === 1 && Array.isArray(source.value.entries) && source.value.entries.length === approvedIds.size, 'approved_package_size_mismatch');
  const sourceIds = source.value.entries.map(entry => entry?.legacyRecord?.['源记录ID']);
  requireValue(new Set(sourceIds).size === approvedIds.size && sourceIds.every(id => approvedIds.has(id)), 'approved_package_set_mismatch');
  const target = localCopy(options.targetCopy), declared = declaration.value;
  requireValue(declared.version === 1 && declared.kind === 'isolated-local-sqlite-copy' && declared.host === hostname() && declared.isolatedCopy === true, 'local_copy_declaration_required');
  requireValue(declared.target?.realPath === target.path && declared.target.dev === target.stat.dev && declared.target.ino === target.stat.ino && declared.target.nlink === 1, 'local_copy_binding_mismatch');
  requireValue(shaPattern.test(declared.initialFileSha256 || '') && shaPattern.test(declared.nonArchiveSha256 || ''), 'invalid_copy_digest');
  return {package: source, approved, declaration, approvedIds, target};
}

function baseBinding(input) {
  return {packageSha256: input.package.sha256, approvedListSha256: input.approved.sha256,
    copyDeclarationSha256: input.declaration.sha256, target: input.declaration.value.target,
    host: hostname(), schemaSha256: createHash('sha256').update(schema).digest('hex'),
    nonArchiveSha256: input.declaration.value.nonArchiveSha256};
}

export async function prepareHistoricalArchive(options) {
  const input = await inputs(options);
  requireValue(await archiveFileSha256(input.target.path) === input.declaration.value.initialFileSha256, 'initial_copy_file_changed');
  const database = new DatabaseSync(input.target.path, {readOnly: true});
  try {
    database.exec('PRAGMA query_only=ON; BEGIN;');
    requireValue(nonArchiveFingerprint(database) === input.declaration.value.nonArchiveSha256, 'nonarchive_baseline_changed');
    const binding = baseBinding(input), preparedAt = new Date().toISOString();
    const batchId = 'historical-archive-' + archiveDigest(binding).slice(0, 24);
    const {rows, additions} = archiveRows(input, database, batchId, preparedAt);
    const plan = {version: 1, kind: 'historical-report-archive-plan', ...binding, preparedAt, batchId,
      recordCount: rows.length, insertCount: additions.length, rowsSha256: archiveDigest(rows),
      archiveBeforeSha256: archiveFingerprint(database), archiveAfterSha256: archiveFingerprint(database, additions)};
    plan.planSha256 = archiveDigest(plan);
    writeArchiveJsonExclusive(options.out, plan);
    return {ok: true, mode: 'dry-run', records: rows.length, proposedInserts: additions.length, inserted: 0, planSha256: plan.planSha256};
  } finally { database.close(); }
}

export async function importHistoricalArchive(options) {
  const input = await inputs(options), plan = loadPrivateJson(options.plan).value;
  const {planSha256, ...unsigned} = plan;
  requireValue(plan.version === 1 && plan.kind === 'historical-report-archive-plan' && shaPattern.test(planSha256 || '') && archiveDigest(unsigned) === planSha256, 'invalid_plan_digest');
  const binding = baseBinding(input);
  requireValue(Object.keys(binding).every(key => canonicalArchiveJson(plan[key]) === canonicalArchiveJson(binding[key])), 'stale_plan_binding');
  requireValue(plan.batchId === 'historical-archive-' + archiveDigest(binding).slice(0, 24) && Number.isFinite(Date.parse(plan.preparedAt)), 'invalid_plan_batch');
  const database = new DatabaseSync(input.target.path, {readOnly: !options.apply});
  try {
    database.exec(options.apply ? 'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;' : 'PRAGMA query_only=ON; BEGIN;');
    requireValue(nonArchiveFingerprint(database) === plan.nonArchiveSha256, 'nonarchive_baseline_changed');
    const before = archiveFingerprint(database);
    requireValue(before === plan.archiveBeforeSha256 || before === plan.archiveAfterSha256, 'archive_baseline_changed');
    if (before === plan.archiveBeforeSha256) requireValue(await archiveFileSha256(input.target.path) === input.declaration.value.initialFileSha256, 'initial_copy_file_changed');
    const {rows, additions} = archiveRows(input, database, plan.batchId, plan.preparedAt);
    requireValue(rows.length === plan.recordCount && archiveDigest(rows) === plan.rowsSha256 && archiveFingerprint(database, additions) === plan.archiveAfterSha256, 'archive_plan_rows_changed');
    requireValue(before !== plan.archiveAfterSha256 || additions.length === 0, 'invalid_idempotent_state');
    if (options.apply && additions.length) {
      if (!checkArchiveSchema(database)) database.exec(schema);
      checkArchiveSchema(database);
      const insert = database.prepare(`INSERT INTO ${archiveTable}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
      for (const row of additions) insert.run(...columns.map(column => row[column]));
      requireValue(nonArchiveFingerprint(database) === plan.nonArchiveSha256 && archiveFingerprint(database) === plan.archiveAfterSha256, 'archive_write_scope_mismatch');
    }
    database.exec('COMMIT;');
    return {ok: true, mode: options.apply ? 'apply-local-copy' : 'dry-run', records: rows.length,
      proposedInserts: additions.length, inserted: options.apply ? additions.length : 0, alreadyPresent: rows.length - additions.length, planSha256};
  } finally { database.close(); }
}
