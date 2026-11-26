import {createHash} from 'node:crypto';
import {closeSync, constants, createReadStream, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputsRoot = path.join(projectRoot, 'outputs');
const hashPattern = /^[a-f0-9]{64}$/u;
const digest = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sourceId = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);

class OwnershipPreparationError extends Error {}
function requireValue(value, code) { if (!value) throw new OwnershipPreparationError(code); }

function regularFile(filename, {reference = false} = {}) {
  const absolute = path.resolve(filename), info = lstatSync(absolute);
  requireValue(info.isFile() && !info.isSymbolicLink() && realpathSync(absolute) === absolute, 'regular_unaliased_input_required');
  requireValue((info.mode & 0o077) === 0, 'private_input_permissions_required');
  if (reference) {
    requireValue(absolute.startsWith(outputsRoot + path.sep) && !/(?:^|\/)(?:live|prod|production)(?:\/|$)/iu.test(absolute) && info.nlink === 1, 'isolated_reference_copy_required');
  }
  return {path: absolute, info};
}

function sameFile(first, second) {
  return first.dev === second.dev && first.ino === second.ino && first.size === second.size &&
    first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs;
}

async function fileDigest(filename) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(filename, {flags: constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK})) hash.update(bytes);
  return hash.digest('hex');
}

function noUncheckpointedJournal(filename) {
  for (const suffix of ['-wal', '-journal']) {
    try { requireValue(lstatSync(filename + suffix).size === 0, 'reference_uncheckpointed_journal'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function outputDestination(filename, inputs) {
  const absolute = path.resolve(filename), parent = path.dirname(absolute);
  requireValue(!inputs.includes(absolute), 'output_must_not_replace_input');
  requireValue(absolute.startsWith(outputsRoot + path.sep) && !/(?:^|\/)(?:live|prod|production)(?:\/|$)/iu.test(absolute), 'isolated_outputs_destination_required');
  requireValue(realpathSync(outputsRoot) === outputsRoot && realpathSync(parent) === parent, 'unaliased_destination_required');
  const info = lstatSync(parent);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0, 'private_destination_directory_required');
  try { lstatSync(absolute); throw new OwnershipPreparationError('new_output_file_required'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return {path: absolute, parent, info};
}

function parentUnchanged(destination) {
  const current = lstatSync(destination.parent);
  return current.isDirectory() && !current.isSymbolicLink() && (current.mode & 0o077) === 0 &&
    current.dev === destination.info.dev && current.ino === destination.info.ino && realpathSync(destination.parent) === destination.parent;
}

function referenceSets(database, records) {
  requireValue(database.prepare('PRAGMA quick_check').all().every(row => Object.values(row)[0] === 'ok'), 'reference_integrity_failed');
  const needed = {weekly_reports: ['id'], historical_report_archives: ['source_report_id', 'source_system', 'content_json', 'source_sha256']};
  for (const [table, columns] of Object.entries(needed)) {
    const found = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
    requireValue(columns.every(column => found.has(column)), 'reference_schema_incomplete');
  }
  const existing = new Set();
  for (const row of database.prepare('SELECT id FROM weekly_reports').iterate()) {
    requireValue(sourceId(row.id) && !existing.has(row.id), 'reference_existing_id_invalid_or_duplicate'); existing.add(row.id);
  }
  requireValue(existing.size > 0, 'reference_existing_set_empty');
  const originalById = new Map();
  for (const record of records) {
    const id = record['源记录ID'];
    if (!sourceId(id)) continue;
    if (!originalById.has(id)) originalById.set(id, []);
    originalById.get(id).push(record);
  }
  const verified = new Set();
  for (const row of database.prepare('SELECT source_report_id,source_system,content_json,source_sha256 FROM historical_report_archives').iterate()) {
    const id = row.source_report_id;
    requireValue(row.source_system === 'reportos' && sourceId(id) && !verified.has(id), 'reference_archive_id_invalid_or_duplicate');
    requireValue(!existing.has(id), 'reference_source_sets_overlap');
    let original;
    try { original = JSON.parse(row.content_json); } catch { throw new OwnershipPreparationError('reference_archive_json_invalid'); }
    requireValue(plain(original) && original['源记录ID'] === id && hashPattern.test(row.source_sha256 || '') &&
      digest(canonical(original)) === row.source_sha256 && originalById.has(id) &&
      originalById.get(id).every(record => canonical(record) === canonical(original)), 'reference_archive_original_mismatch');
    verified.add(id);
  }
  requireValue(verified.size > 0, 'reference_verified_set_empty');
  return {existing, verified};
}

export async function prepareLegacyReportOwnership({snapshot, snapshotSha256, referenceCopy, referenceSha256, out}) {
  requireValue([snapshot, referenceCopy, out].every(value => typeof value === 'string' && value.length > 0) &&
    hashPattern.test(snapshotSha256 || '') && hashPattern.test(referenceSha256 || ''), 'explicit_input_hashes_required');
  requireValue(Number.isInteger(constants.O_NOFOLLOW) && Number.isInteger(constants.O_NONBLOCK), 'guarded_file_open_unavailable');
  const source = regularFile(snapshot), reference = regularFile(referenceCopy, {reference: true});
  requireValue(source.path !== reference.path, 'snapshot_and_reference_must_differ');
  const destination = outputDestination(out, [source.path, reference.path]);
  const descriptor = openSync(source.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let sourceBytes;
  try {
    requireValue(sameFile(source.info, fstatSync(descriptor)), 'snapshot_changed_before_open');
    sourceBytes = readFileSync(descriptor);
  } finally { closeSync(descriptor); }
  requireValue(digest(sourceBytes) === snapshotSha256, 'snapshot_sha256_mismatch');
  let original;
  try { original = JSON.parse(sourceBytes.toString('utf8')); } catch { throw new OwnershipPreparationError('snapshot_json_invalid'); }
  requireValue(plain(original) && original.version === 1 && original.purpose === 'legacy-weekly-report-snapshot' &&
    hashPattern.test(original.sourceSha256 || '') && hashPattern.test(original.recordsSha256 || '') &&
    Array.isArray(original.records) && original.records.length <= 100_000 && original.records.every(plain) &&
    digest(JSON.stringify(original.records)) === original.recordsSha256, 'snapshot_contract_invalid');
  requireValue(!Object.hasOwn(original, 'ownership'), 'snapshot_already_has_ownership');
  noUncheckpointedJournal(reference.path);
  requireValue(await fileDigest(reference.path) === referenceSha256 && sameFile(reference.info, regularFile(reference.path, {reference: true}).info), 'reference_sha256_or_identity_mismatch');
  const uri = pathToFileURL(reference.path).href + '?mode=ro&immutable=1';
  const database = new DatabaseSync(uri, {readOnly: true});
  let sets;
  try {
    database.exec('PRAGMA query_only=ON;BEGIN;');
    sets = referenceSets(database, original.records);
  } finally { database.close(); }
  noUncheckpointedJournal(reference.path);
  requireValue(sameFile(reference.info, regularFile(reference.path, {reference: true}).info) &&
    await fileDigest(reference.path) === referenceSha256, 'reference_changed_during_read');
  requireValue(sameFile(source.info, regularFile(source.path).info), 'snapshot_changed_during_read');
  const statuses = original.records.map(record => sets.existing.has(record['源记录ID']) ? 'existing' : sets.verified.has(record['源记录ID']) ? 'verified' : 'unknown');
  const ownership = {version: 1, recordsSha256: original.recordsSha256, referenceSha256,
    statusesSha256: digest(JSON.stringify(statuses)), statuses};
  const prepared = {...original, ownership};
  requireValue(parentUnchanged(destination), 'destination_directory_changed');
  const output = openSync(destination.path, 'wx', 0o600);
  try {
    const opened = fstatSync(output), named = lstatSync(destination.path);
    requireValue(parentUnchanged(destination) && named.isFile() && !named.isSymbolicLink() && opened.dev === named.dev &&
      opened.ino === named.ino && opened.nlink === 1, 'destination_changed_before_write');
    fchmodSync(output, 0o600); writeFileSync(output, JSON.stringify(prepared, null, 2) + '\n'); fsyncSync(output);
  } finally { closeSync(output); }
  return {ok: true, records: statuses.length, counts: {existing: statuses.filter(status => status === 'existing').length,
    verified: statuses.filter(status => status === 'verified').length, unknown: statuses.filter(status => status === 'unknown').length},
    recordsSha256: original.recordsSha256, referenceSha256, statusesSha256: ownership.statusesSha256};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {values} = parseArgs({options: {snapshot: {type: 'string'}, 'snapshot-sha256': {type: 'string'},
      'reference-copy': {type: 'string'}, 'reference-sha256': {type: 'string'}, out: {type: 'string'}}});
    console.log(JSON.stringify(await prepareLegacyReportOwnership({snapshot: values.snapshot, snapshotSha256: values['snapshot-sha256'],
      referenceCopy: values['reference-copy'], referenceSha256: values['reference-sha256'], out: values.out})));
  } catch (error) {
    console.error(JSON.stringify({ok: false, error: error instanceof OwnershipPreparationError ? error.message : 'legacy_ownership_prepare_failed'}));
    process.exitCode = 1;
  }
}
