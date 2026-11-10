import {lstatSync, readFileSync, realpathSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {DatabaseSync} from 'node:sqlite';

const cutoff = '2026-11-01';
const sections = ['本周成果摘要', '问题摘要', '下周计划摘要', '思考与复盘摘要'];
const scores = ['成果分', '问题分', '计划分', '复盘分', '总分'];
const preservedFields = [
  '源记录ID', '结束日期', '开始日期', '提交时间', '周次', '周期ID', '状态',
  ...sections, ...scores, '准时分', '等级',
];

class ImportFailure extends Error {}

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const identifier = value => nonempty(value) && value === value.trim();
const pair = (...values) => JSON.stringify(values);
const plainRow = value => value && typeof value === 'object' && !Array.isArray(value);
const increment = (counts, key) => counts.set(key, (counts.get(key) || 0) + 1);

function emailKey(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function addToSet(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})[T ]((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?)(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  return Boolean(match && validDate(match[1]) && Number.isFinite(Date.parse(`${match[1]}T${match[2]}${match[3] || '+08:00'}`)));
}

function validScore(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) return false;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 100;
}

function classifyRow(row) {
  if (!plainRow(row)) return 'invalidStructure';
  if (!identifier(row['源记录ID']) || !identifier(row.open_id)) return 'missingOrInvalidIds';
  if (!validDate(row['结束日期'])) return 'invalidDates';
  if (row['结束日期'] >= cutoff) return 'outsideCutoff';
  if (!validDate(row['开始日期']) || row['开始日期'] > row['结束日期']) return 'invalidDates';
  if (['未交', '未提交', '未汇报'].includes(row['状态'])) return 'unsubmitted';
  if (!validTimestamp(row['提交时间'])) return 'invalidTimestamp';
  if (scores.some(field => !validScore(row[field]))) return 'invalidScores';
  if (!nonempty(row['周次']) || !nonempty(row['姓名']) || !nonempty(row['状态']) ||
      typeof row['部门'] !== 'string' || (row['企业邮箱'] != null && typeof row['企业邮箱'] !== 'string') ||
      (row['周期ID'] != null && typeof row['周期ID'] !== 'string') ||
      (row['准时分'] != null && !validScore(row['准时分'])) || (row['等级'] != null && typeof row['等级'] !== 'string') ||
      sections.some(field => typeof row[field] !== 'string') || !sections.some(field => nonempty(row[field]))) {
    return 'invalidStructure';
  }
  return null;
}

function createPlan(database, sourceRows) {
  const employees = database.prepare('SELECT user_id, email FROM employees').all();
  const knownUsers = new Set(employees.map(row => row.user_id));
  const byOpenId = new Map(database.prepare('SELECT open_id, user_id FROM employee_identities WHERE open_id IS NOT NULL').all()
    .filter(row => knownUsers.has(row.user_id)).map(row => [row.open_id, row.user_id]));
  const byEmail = new Map();
  for (const employee of employees) {
    const email = emailKey(employee.email);
    if (email) addToSet(byEmail, email, employee.user_id);
  }

  const targetRows = database.prepare(`SELECT id, employee_user_id, week_end, week_label,
    CASE WHEN json_valid(content_json) THEN json_extract(content_json, '$.source.provider') END AS provider
    FROM weekly_reports`).all();
  const byReportId = new Map(targetRows.map(row => [row.id, row]));
  const targetWeeks = new Set(targetRows.map(row => pair(row.employee_user_id, row.week_end)));
  const targetLabels = new Set(targetRows.map(row => pair(row.employee_user_id, row.week_label)));
  const inScope = sourceRows.filter(row => plainRow(row) && identifier(row['源记录ID']) &&
    validDate(row['结束日期']) && row['结束日期'] < cutoff);
  const sourceIdCounts = new Map();
  const sourceIdentities = new Map();
  for (const row of inScope) {
    increment(sourceIdCounts, row['源记录ID']);
    addToSet(sourceIdentities, row['源记录ID'], pair(row.open_id, row['结束日期']));
  }

  // Only an exact match against independent history can verify a legacy identity or email.
  const overlapUsers = new Map();
  const directUsers = new Map();
  const overlapEmailUsers = new Map();
  const matchingReports = [];
  for (const row of inScope) {
    const legacyId = row.open_id;
    if (!identifier(legacyId)) continue;
    const id = row['源记录ID'];
    const existing = byReportId.get(id);
    const email = emailKey(row['企业邮箱']);
    if (sourceIdentities.get(id).size === 1 && existing?.week_end === row['结束日期'] &&
        existing.provider !== 'legacy-reportos' && knownUsers.has(existing.employee_user_id)) {
      const userId = existing.employee_user_id;
      matchingReports.push({legacyId, userId, email});
      addToSet(overlapUsers, legacyId, userId);
      if (email) addToSet(overlapEmailUsers, email, userId);
    }
    if (byOpenId.has(legacyId)) addToSet(directUsers, legacyId, byOpenId.get(legacyId));
    if (knownUsers.has(legacyId)) addToSet(directUsers, legacyId, legacyId);
    if (knownUsers.has(row.user_id)) addToSet(directUsers, legacyId, row.user_id);
    const emailUsers = byEmail.get(email);
    if (emailUsers?.size === 1) addToSet(directUsers, legacyId, emailUsers.values().next().value);
  }
  const conflictingIdentities = new Set();
  const crosswalk = new Map();
  for (const [legacyId, users] of overlapUsers) {
    const direct = directUsers.get(legacyId) || [];
    if (new Set([...users, ...direct]).size !== 1) conflictingIdentities.add(legacyId);
    else crosswalk.set(legacyId, users.values().next().value);
  }
  for (const [legacyId, users] of directUsers) {
    if (users.size > 1) conflictingIdentities.add(legacyId);
  }

  const verifiedEmails = new Map();
  for (const {legacyId, userId, email} of matchingReports) {
    if (overlapEmailUsers.get(email)?.size === 1 && crosswalk.get(legacyId) === userId) verifiedEmails.set(email, userId);
  }
  const bridgedUsers = new Map();
  for (const row of inScope) {
    const userId = verifiedEmails.get(emailKey(row['企业邮箱']));
    if (identifier(row.open_id) && userId) addToSet(bridgedUsers, row.open_id, userId);
  }
  for (const [legacyId, users] of bridgedUsers) {
    const all = new Set([...users, ...(directUsers.get(legacyId) || []), ...(overlapUsers.get(legacyId) || [])]);
    if (all.size > 1) conflictingIdentities.add(legacyId);
  }
  const ambiguousEmail = row => overlapEmailUsers.get(emailKey(row['企业邮箱']))?.size > 1;
  const resolvedUser = row => conflictingIdentities.has(row.open_id) || ambiguousEmail(row) ? undefined
    : crosswalk.get(row.open_id) || verifiedEmails.get(emailKey(row['企业邮箱']));

  const sourceWeeks = new Map();
  const sourceLabels = new Map();
  for (const row of inScope) {
    const userId = resolvedUser(row);
    if (!userId) continue;
    increment(sourceWeeks, pair(userId, row['结束日期']));
    if (nonempty(row['周次'])) increment(sourceLabels, pair(userId, row['周次']));
  }

  const skipped = {
    outsideCutoff: 0, invalidStructure: 0, missingOrInvalidIds: 0, invalidDates: 0,
    invalidTimestamp: 0, invalidScores: 0, unsubmitted: 0, unmappedIdentity: 0,
    conflictingIdentity: 0, ambiguousEmail: 0, ambiguousSource: 0, existingTarget: 0, targetConflict: 0,
  };
  const inserts = [];
  const eligibleMonths = new Map();
  for (const row of sourceRows) {
    const invalid = classifyRow(row);
    if (invalid) { skipped[invalid]++; continue; }
    const legacyId = row.open_id;
    const id = row['源记录ID'];
    const userId = resolvedUser(row);
    const weekKey = pair(userId, row['结束日期']);
    const labelKey = pair(userId, row['周次']);
    const existing = byReportId.get(id);
    if (conflictingIdentities.has(legacyId)) skipped.conflictingIdentity++;
    else if (ambiguousEmail(row)) skipped.ambiguousEmail++;
    else if (sourceIdCounts.get(id) > 1 || sourceWeeks.get(weekKey) > 1 || sourceLabels.get(labelKey) > 1) skipped.ambiguousSource++;
    else if (existing && existing.week_end !== row['结束日期']) skipped.targetConflict++;
    else if (!userId) skipped.unmappedIdentity++;
    else if (existing?.employee_user_id === userId) skipped.existingTarget++;
    else if (existing || targetWeeks.has(weekKey) || targetLabels.has(labelKey)) skipped.targetConflict++;
    else {
      inserts.push({row, id, userId});
      increment(eligibleMonths, row['结束日期'].slice(0, 7));
    }
  }
  return {
    inserts,
    result: {
      cutoffWeekEndExclusive: cutoff,
      sourceRows: sourceRows.length,
      crosswalk: {
        matchingReportRows: matchingReports.length,
        verifiedIdentities: [...crosswalk.keys()].filter(id => !conflictingIdentities.has(id)).length,
        verifiedOverlapEmails: verifiedEmails.size,
        conflictingIdentities: conflictingIdentities.size,
      },
      eligible: inserts.length,
      eligibleViaEmail: inserts.filter(({row}) => !crosswalk.has(row.open_id)).length,
      eligibleByMonth: Object.fromEntries([...eligibleMonths].sort(([first], [second]) => first.localeCompare(second))),
      skipped,
    },
  };
}

function existingFile(input, errorCode) {
  try {
    if (!lstatSync(input).isFile()) throw Error();
    return realpathSync(input);
  } catch {
    throw new ImportFailure(errorCode);
  }
}

function run({source, target, apply}) {
  const sourcePath = existingFile(source, 'source_file_required');
  const targetPath = existingFile(target, 'existing_target_copy_required');
  if (sourcePath === targetPath || (apply && (
    targetPath.startsWith('/opt/emie-growth-os/data/') || lstatSync(targetPath).nlink !== 1
  ))) throw new ImportFailure('invalid_target_copy');
  const sourceRows = JSON.parse(readFileSync(sourcePath, 'utf8'))?.weekly_scores;
  if (!Array.isArray(sourceRows)) throw new ImportFailure('weekly_scores_array_required');
  const database = new DatabaseSync(targetPath, {readOnly: !apply});
  try {
    database.exec('PRAGMA busy_timeout=5000;');
    database.exec(apply ? 'BEGIN IMMEDIATE;' : 'BEGIN;');
    const {inserts, result} = createPlan(database, sourceRows);
    if (apply) {
      const insert = database.prepare(`INSERT INTO weekly_reports
        (id, employee_user_id, employee_name, department, week_label, week_start, week_end, status, content_json, is_late, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const {row, id, userId} of inserts) {
        const content = Object.fromEntries(preservedFields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]]));
        content.source = {provider: 'legacy-reportos'};
        insert.run(id, userId, row['姓名'], row['部门'], row['周次'], row['开始日期'], row['结束日期'],
          row['状态'], JSON.stringify(content), Number(row['状态'] === '迟交'), row['提交时间']);
      }
    }
    database.exec('COMMIT;');
    return {ok: true, mode: apply ? 'apply' : 'dry-run', ...result, inserted: apply ? inserts.length : 0};
  } finally {
    // Closing a connection rolls back any uncommitted transaction.
    database.close();
  }
}

try {
  const {values} = parseArgs({options: {source: {type: 'string'}, 'target-copy': {type: 'string'}, apply: {type: 'boolean'}, help: {type: 'boolean'}}});
  if (values.help) {
    console.log('Usage: node scripts/import-legacy-weekly-history.mjs --source prototypeData.json --target-copy copy.sqlite [--apply]');
  } else {
    if (!values.source || !values['target-copy']) throw new ImportFailure('source_and_target_copy_required');
    console.log(JSON.stringify(run({source: values.source, target: values['target-copy'], apply: values.apply === true})));
  }
} catch (error) {
  console.error(JSON.stringify({ok: false, error: error instanceof ImportFailure ? error.message : 'legacy_history_import_failed'}));
  process.exitCode = 1;
}
