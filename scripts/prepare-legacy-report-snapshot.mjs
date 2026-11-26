import {createHash} from 'node:crypto';
import {closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputsRoot = path.join(projectRoot, 'outputs');
const digest = value => createHash('sha256').update(value).digest('hex');

class SnapshotPreparationError extends Error {}
function requireValue(value, code) { if (!value) throw new SnapshotPreparationError(code); }

export function prepareLegacyReportSnapshot({source, sourceSha256, out, expectedCount}) {
  requireValue(typeof source === 'string' && typeof out === 'string' && /^[a-f0-9]{64}$/u.test(sourceSha256 || ''), 'source_sha256_confirmation_required');
  const sourcePath = path.resolve(source), outputPath = path.resolve(out);
  requireValue(sourcePath !== outputPath, 'source_and_output_must_differ');
  const parent = path.dirname(outputPath);
  requireValue(outputPath.startsWith(outputsRoot + path.sep) && !/(?:^|\/)(?:live|prod|production)(?:\/|$)/iu.test(outputPath), 'isolated_outputs_destination_required');
  requireValue(realpathSync(outputsRoot) === outputsRoot && realpathSync(parent) === parent, 'unaliased_destination_required');
  const parentInfo = lstatSync(parent);
  requireValue(parentInfo.isDirectory() && !parentInfo.isSymbolicLink() && (parentInfo.mode & 0o077) === 0, 'private_destination_directory_required');
  try {
    lstatSync(outputPath);
    throw new SnapshotPreparationError('new_output_file_required');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const sourceInfo = lstatSync(sourcePath);
  requireValue(sourceInfo.isFile() && !sourceInfo.isSymbolicLink() && realpathSync(sourcePath) === sourcePath, 'source_regular_unaliased_file_required');
  requireValue(Number.isInteger(constants.O_NOFOLLOW) && Number.isInteger(constants.O_NONBLOCK), 'source_open_guards_unavailable');
  const input = openSync(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const openedSource = fstatSync(input);
    requireValue(openedSource.isFile() && openedSource.dev === sourceInfo.dev && openedSource.ino === sourceInfo.ino, 'source_changed_before_open');
    bytes = readFileSync(input);
  } finally { closeSync(input); }
  requireValue(digest(bytes) === sourceSha256, 'source_sha256_mismatch');
  let original;
  try { original = JSON.parse(bytes.toString('utf8')); }
  catch { throw new SnapshotPreparationError('invalid_source_json'); }
  requireValue(original && Array.isArray(original.weekly_scores), 'weekly_scores_array_required');
  const records = original.weekly_scores;
  requireValue(records.length <= 100_000 && records.every(record => record !== null && typeof record === 'object' && !Array.isArray(record)), 'weekly_scores_object_records_required');
  if (expectedCount !== undefined) requireValue(Number.isSafeInteger(expectedCount) && expectedCount >= 0 && records.length === expectedCount, 'unexpected_record_count');
  // Keep the complete array, order, duplicate rows, missing fields and malformed
  // historical values. Interpretation and display belong to the read-only reader.
  const snapshot = {version: 1, purpose: 'legacy-weekly-report-snapshot', sourceSha256,
    recordsSha256: digest(JSON.stringify(records)), records};
  const destinationParentUnchanged = () => {
    const current = lstatSync(parent);
    return current.isDirectory() && !current.isSymbolicLink() && (current.mode & 0o077) === 0 &&
      current.dev === parentInfo.dev && current.ino === parentInfo.ino && realpathSync(parent) === parent;
  };
  requireValue(destinationParentUnchanged(), 'destination_directory_changed');
  const output = openSync(outputPath, 'wx', 0o600);
  try {
    const openedOutput = fstatSync(output), namedOutput = lstatSync(outputPath);
    requireValue(destinationParentUnchanged() && namedOutput.isFile() && !namedOutput.isSymbolicLink() &&
      openedOutput.dev === namedOutput.dev && openedOutput.ino === namedOutput.ino && openedOutput.nlink === 1, 'destination_changed_before_write');
    fchmodSync(output, 0o600);
    writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n');
    fsyncSync(output);
  } finally { closeSync(output); }
  return {ok: true, records: records.length, sourceSha256: snapshot.sourceSha256, recordsSha256: snapshot.recordsSha256};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {values} = parseArgs({options: {source: {type: 'string'}, 'source-sha256': {type: 'string'},
      out: {type: 'string'}, 'expected-count': {type: 'string'}}});
    const expected = values['expected-count'];
    if (expected !== undefined) requireValue(/^(?:0|[1-9]\d*)$/u.test(expected), 'invalid_expected_record_count');
    const result = prepareLegacyReportSnapshot({source: values.source, sourceSha256: values['source-sha256'],
      out: values.out, expectedCount: expected === undefined ? undefined : Number(expected)});
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ok: false, error: error instanceof SnapshotPreparationError ? error.message : 'legacy_snapshot_prepare_failed'}));
    process.exitCode = 1;
  }
}
