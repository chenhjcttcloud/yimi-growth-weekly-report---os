import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';

mkdirSync('outputs/tests', {recursive: true});
const folder = mkdtempSync(path.resolve('outputs/tests/prepare-legacy-snapshot-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const duplicate = {'源记录ID': 'PRIVATE_DUPLICATE_SOURCE', '姓名': 'PRIVATE_NAME', '开始日期': '', '总分': 77.125, '本周成果摘要': 'PRIVATE_RESULTS'};
const malformed = {'周次': 'PRIVATE_MISPLACED_REPORT_TEXT', '本周成果摘要': '', '状态': '准时', '字数': 0};
const rows = [duplicate, structuredClone(duplicate), malformed, {'姓名': 'PRIVATE_NO_ID', '周次': '3/31-4/4', '总分': 0}];
const source = path.join(folder, 'source.json');
writeFileSync(source, JSON.stringify({meta: {private: 'PRIVATE_UNUSED_METADATA'}, weekly_scores: rows}), {flag: 'wx', mode: 0o600});
const original = readFileSync(source), sourceSha = sha(original);
const run = (out, options = {}) => {
  const args = ['scripts/prepare-legacy-report-snapshot.mjs', '--source', options.source || source, '--out', out];
  if (options.hash !== false) args.push('--source-sha256', options.hash || sourceSha);
  if (options.count !== undefined) args.push('--expected-count', String(options.count));
  const result = spawnSync(process.execPath, args, {encoding: 'utf8'});
  assert(!`${result.stdout}${result.stderr}`.includes('PRIVATE_'), 'logs must not expose report text, identities or source metadata');
  assert.deepEqual(readFileSync(source), original, 'the source remains byte-for-byte unchanged');
  return result;
};

const out = path.join(folder, 'snapshot.json');
const prepared = run(out, {count: 4});
assert.equal(prepared.status, 0, prepared.stderr);
assert.deepEqual(JSON.parse(prepared.stdout), {ok: true, records: 4, sourceSha256: sourceSha, recordsSha256: sha(JSON.stringify(rows))});
const snapshot = JSON.parse(readFileSync(out, 'utf8'));
assert.deepEqual(Object.keys(snapshot), ['version', 'purpose', 'sourceSha256', 'recordsSha256', 'records']);
assert.equal(snapshot.version, 1);
assert.equal(snapshot.purpose, 'legacy-weekly-report-snapshot');
assert.equal(snapshot.sourceSha256, sourceSha);
assert.equal(snapshot.recordsSha256, sha(JSON.stringify(snapshot.records)));
assert.deepEqual(snapshot.records, rows, 'duplicate and malformed object rows must retain their original position and values');
assert.equal(lstatSync(out).mode & 0o777, 0o600);
const priorOutput = readFileSync(out);
assert.notEqual(run(out).status, 0, 'an existing snapshot cannot be overwritten');
assert.deepEqual(readFileSync(out), priorOutput);

for (const [name, options] of [['missing-hash', {hash: false}], ['wrong-hash', {hash: '0'.repeat(64)}],
  ['wrong-count', {count: 3}], ['invalid-count', {count: '05'}]]) {
  const target = path.join(folder, name + '.json');
  assert.notEqual(run(target, options).status, 0);
  assert(!existsSync(target));
}
assert.notEqual(run(source).status, 0, 'output must never replace the source');
const link = path.join(folder, 'output-link.json');
symlinkSync(source, link);
assert.notEqual(run(link).status, 0);
assert(lstatSync(link).isSymbolicLink(), 'the existing symlink is retained');
const sourceLink = path.join(folder, 'source-link.json');
symlinkSync(source, sourceLink);
const aliasTarget = path.join(folder, 'aliased-source-snapshot.json');
assert.notEqual(run(aliasTarget, {source: sourceLink}).status, 0, 'a source alias must not be followed');
assert(!existsSync(aliasTarget));
const parentLink = path.join(folder, 'parent-link');
symlinkSync(folder, parentLink);
assert.notEqual(run(path.join(parentLink, 'through-link.json')).status, 0);
assert(!existsSync(path.join(folder, 'through-link.json')));
const missingParent = path.join(folder, 'uncreated-directory', 'snapshot.json');
assert.notEqual(run(missingParent).status, 0);
assert(!existsSync(path.dirname(missingParent)), 'the CLI must not create directories as a side effect');
const live = path.join(folder, 'live');
mkdirSync(live, {mode: 0o700});
assert.notEqual(run(path.join(live, 'snapshot.json')).status, 0, 'live data directories are not staging destinations');
assert.notEqual(run(path.resolve('snapshot-should-not-be-created.json')).status, 0);
assert(!existsSync(path.resolve('snapshot-should-not-be-created.json')));
const invalid = path.join(folder, 'invalid-source.json');
writeFileSync(invalid, JSON.stringify({weekly_scores: {not: 'an array'}}), {flag: 'wx', mode: 0o600});
const invalidTarget = path.join(folder, 'invalid-snapshot.json');
assert.notEqual(run(invalidTarget, {source: invalid, hash: sha(readFileSync(invalid))}).status, 0);
assert(!existsSync(invalidTarget));
for (const [index, value] of [null, [], 42, 'PRIVATE_NOT_AN_OBJECT'].entries()) {
  const invalidRowSource = path.join(folder, `invalid-record-${index}.json`);
  writeFileSync(invalidRowSource, JSON.stringify({weekly_scores: [...rows, value]}), {flag: 'wx', mode: 0o600});
  const invalidRowOutput = path.join(folder, `invalid-record-snapshot-${index}.json`);
  assert.notEqual(run(invalidRowOutput, {source: invalidRowSource, hash: sha(readFileSync(invalidRowSource))}).status, 0, 'a nonobject row rejects the whole preparation without filtering');
  assert(!existsSync(invalidRowOutput));
}
const oversized = path.join(folder, 'oversized-source.json');
writeFileSync(oversized, JSON.stringify({weekly_scores: Array.from({length: 100_001}, () => ({}))}), {flag: 'wx', mode: 0o600});
const oversizedOutput = path.join(folder, 'oversized-snapshot.json');
assert.notEqual(run(oversizedOutput, {source: oversized, hash: sha(readFileSync(oversized))}).status, 0, 'prepare and reader must agree on their record limit');
assert(!existsSync(oversizedOutput));

console.log('Legacy snapshot preparation tests passed: exact preservation and checksums, private exclusive output, explicit source confirmation, alias/live/outside-output rejection, source unchanged. Synthetic artifacts retained:', folder);
