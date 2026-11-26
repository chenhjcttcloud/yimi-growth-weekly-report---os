import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {prepareLegacyReportOwnership} from './prepare-legacy-report-ownership.mjs';

fs.mkdirSync('outputs/tests', {recursive: true});
const folder = fs.mkdtempSync(path.resolve('outputs/tests/prepare-legacy-ownership-'));
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
let serial = 0;
const row = (id, extra = {}) => ({...(id ? {'源记录ID': id} : {}), '姓名': 'PRIVATE_NAME', '周次': '3/31-4/4',
  '本周成果摘要': 'PRIVATE_RESULTS', '问题摘要': '', '下周计划摘要': '', '总分': 77.125, ...extra});
const initial = [row('existing-one'), row('verified-one'), row(), row('unknown-person'), row(undefined, {'周次': 'PRIVATE_MALFORMED_COLUMN_TEXT', '本周成果摘要': ''}), row('existing-one')];

function setup({records = structuredClone(initial), live = ['existing-one', 'extra-live'], archives,
  mutateDatabase, omitArchiveTable = false, metadata = {}} = {}) {
  const id = ++serial, directory = path.join(folder, 'case-' + id); fs.mkdirSync(directory, {mode: 0o700});
  const snapshot = path.join(directory, 'snapshot.json'), reference = path.join(directory, 'reference.sqlite'), output = path.join(directory, 'owned.json');
  const bundle = {version: 1, purpose: 'legacy-weekly-report-snapshot', sourceSha256: 'a'.repeat(64),
    recordsSha256: digest(JSON.stringify(records)), records, privateRootMetadata: {note: 'PRIVATE_METADATA'}, ...metadata};
  fs.writeFileSync(snapshot, JSON.stringify(bundle), {flag: 'wx', mode: 0o600});
  const database = new DatabaseSync(reference);
  try {
    database.exec('CREATE TABLE weekly_reports(id TEXT);');
    const insert = database.prepare('INSERT INTO weekly_reports(id) VALUES(?)');
    for (const source of live) insert.run(source);
    if (!omitArchiveTable) {
      database.exec('CREATE TABLE historical_report_archives(source_report_id TEXT,source_system TEXT,content_json TEXT,source_sha256 TEXT);');
      const archive = database.prepare('INSERT INTO historical_report_archives VALUES(?,?,?,?)');
      for (const original of archives || records.filter(value => value?.['源记录ID'] === 'verified-one')) archive.run(original['源记录ID'], 'reportos', canonical(original), digest(canonical(original)));
    }
    if (mutateDatabase) mutateDatabase(database);
  } finally { database.close(); }
  fs.chmodSync(reference, 0o600);
  return {snapshot, snapshotSha256: digest(fs.readFileSync(snapshot)), referenceCopy: reference,
    referenceSha256: digest(fs.readFileSync(reference)), out: output, bundle};
}

function run(options) {
  const sourceBefore = fs.readFileSync(options.snapshot), referenceBefore = fs.readFileSync(options.referenceCopy);
  const child = spawnSync(process.execPath, ['scripts/prepare-legacy-report-ownership.mjs', '--snapshot', options.snapshot,
    '--snapshot-sha256', options.snapshotSha256, '--reference-copy', options.referenceCopy,
    '--reference-sha256', options.referenceSha256, '--out', options.out], {encoding: 'utf8'});
  assert(!`${child.stdout}${child.stderr}`.includes('PRIVATE_'), 'preparation logs must not disclose any private names, content or metadata');
  assert.deepEqual(fs.readFileSync(options.snapshot), sourceBefore, 'snapshot must remain byte-for-byte unchanged');
  assert.deepEqual(fs.readFileSync(options.referenceCopy), referenceBefore, 'reference DB must remain byte-for-byte unchanged');
  return child;
}
const successful = child => { assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout); };
const mustReject = options => { assert.notEqual(run(options).status, 0); assert(!fs.existsSync(options.out)); };

const small = setup();
assert.deepEqual(successful(run(small)).counts, {existing: 2, verified: 1, unknown: 3});
const owned = JSON.parse(fs.readFileSync(small.out, 'utf8'));
for (const key of Object.keys(small.bundle)) assert.deepEqual(owned[key], small.bundle[key], 'all existing keys and original values must be preserved');
assert.deepEqual(owned.ownership, {version: 1, recordsSha256: small.bundle.recordsSha256, referenceSha256: small.referenceSha256,
  statusesSha256: digest(JSON.stringify(['existing', 'verified', 'unknown', 'unknown', 'unknown', 'existing'])),
  statuses: ['existing', 'verified', 'unknown', 'unknown', 'unknown', 'existing']});
assert.equal(owned.records.length, 6, 'duplicate source IDs and malformed original rows must not be collapsed');
assert.equal(fs.statSync(small.out).mode & 0o777, 0o600);
const saved = fs.readFileSync(small.out);
assert.notEqual(run(small).status, 0); assert.deepEqual(fs.readFileSync(small.out), saved);

const liveIds = Array.from({length: 785}, (_, index) => 'synthetic-existing-' + index);
const archiveRecords = Array.from({length: 7}, (_, index) => row('synthetic-verified-' + index));
const allRecords = [...liveIds.map(id => row(id)), ...archiveRecords,
  ...Array.from({length: 209}, (_, index) => row(undefined, index === 168 ? {'周次': 'PRIVATE_MALFORMED_ORIGINAL', '本周成果摘要': ''} : {})),
  ...Array.from({length: 4}, (_, index) => row('synthetic-unmapped-' + index))];
const thousand = setup({records: allRecords, live: [...liveIds, 'synthetic-new-one', 'synthetic-new-two'], archives: archiveRecords});
const all = successful(run(thousand));
assert.equal(all.records, 1005); assert.deepEqual(all.counts, {existing: 785, verified: 7, unknown: 213});
assert.equal(JSON.parse(fs.readFileSync(thousand.out)).ownership.statuses.filter(value => value === 'unknown').length, 209 + 4);

for (const change of [options => { options.snapshotSha256 = '0'.repeat(64); }, options => { options.referenceSha256 = '0'.repeat(64); }]) {
  const options = setup(); change(options); mustReject(options);
}
mustReject(setup({omitArchiveTable: true}));
mustReject(setup({live: []}));
mustReject(setup({archives: []}));
mustReject(setup({live: ['existing-one', 'existing-one']}));
mustReject(setup({live: ['existing-one', 'verified-one']}));
mustReject(setup({archives: [row('verified-one'), row('verified-one')]}));
mustReject(setup({archives: [row('verified-one', {'总分': 0})]}));
mustReject(setup({archives: [row('not-in-original-snapshot')]}));
mustReject(setup({records: [...initial, null]}));
mustReject(setup({metadata: {ownership: {version: 1, statuses: ['unknown']}}}));
mustReject(setup({metadata: {recordsSha256: '0'.repeat(64)}}));
mustReject(setup({mutateDatabase: database => database.prepare("UPDATE historical_report_archives SET source_sha256=?").run('0'.repeat(64))}));

const changedReference = setup();
const writer = new DatabaseSync(changedReference.referenceCopy);
try { writer.prepare('INSERT INTO weekly_reports(id) VALUES(?)').run('changed-after-confirmation'); } finally { writer.close(); }
mustReject(changedReference);
const journal = setup(); fs.writeFileSync(journal.referenceCopy + '-wal', 'PRIVATE_UNCHECKPOINTED_WAL', {flag: 'wx', mode: 0o600}); mustReject(journal);

const alias = setup();
const aliasPath = path.join(path.dirname(alias.out), 'reference-link.sqlite'); fs.symlinkSync(alias.referenceCopy, aliasPath);
mustReject({...alias, referenceCopy: aliasPath});
const snapshotLink = path.join(path.dirname(alias.out), 'snapshot-link.json'); fs.symlinkSync(alias.snapshot, snapshotLink);
mustReject({...alias, snapshot: snapshotLink});
const outLink = path.join(path.dirname(alias.out), 'output-link.json'); fs.symlinkSync(alias.snapshot, outLink);
assert.notEqual(run({...alias, out: outLink}).status, 0); assert(fs.lstatSync(outLink).isSymbolicLink());
const parentLink = path.join(path.dirname(alias.out), 'parent-link'); fs.symlinkSync(path.dirname(alias.out), parentLink);
mustReject({...alias, out: path.join(parentLink, 'aliased-output.json')});
for (const input of [alias.snapshot, alias.referenceCopy]) assert.notEqual(run({...alias, out: input}).status, 0);
const liveOut = path.join(path.dirname(alias.out), 'live'); fs.mkdirSync(liveOut, {mode: 0o700});
mustReject({...alias, out: path.join(liveOut, 'snapshot.json')});
const outside = path.resolve('ownership-should-not-be-created.json'); mustReject({...alias, out: outside});

// A timestamp change during the asynchronous reference hash must invalidate the
// immutable-copy assumption even when its bytes and declared SHA stay the same.
const drift = setup(), createStream = fs.createReadStream;
let touched = false;
fs.createReadStream = function (filename, options) {
  const stream = createStream.call(this, filename, options);
  if (filename === drift.referenceCopy && !touched) {
    touched = true;
    stream.once('end', () => { const now = new Date(Date.now() + 3000); fs.utimesSync(drift.referenceCopy, now, now); });
  }
  return stream;
};
syncBuiltinESMExports();
try { await assert.rejects(prepareLegacyReportOwnership(drift), /reference_sha256_or_identity_mismatch|reference_changed_during_read/); }
finally { fs.createReadStream = createStream; syncBuiltinESMExports(); }
assert(touched); assert(!fs.existsSync(drift.out));

console.log('Legacy ownership preparation tests passed: exact source-ID classification, synthetic 785/7/213 coverage, row and metadata preservation, archive-content verification, strict immutable-reference and SHA binding, drift rejection, private non-overwriting output, no employee or DB writes. Synthetic artifacts retained:', folder);
