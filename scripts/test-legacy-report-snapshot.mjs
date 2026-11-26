import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createLegacyReportSnapshot} from '../server/legacy-report-snapshot.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const privateMarker = 'PRIVATE_ACCOUNT_ATTACHMENT_PATH_AND_BATCH';
const saved = {'姓名': '合成甲', '部门': '合成部门', '周次': '3/31-4/4', '总分': 0,
  '本周成果摘要': '<script>合成原成果</script>', '问题摘要': '合成问题', '下周计划摘要': '合成计划',
  '成果分': 82.125, '问题分': 70, '计划分': 91, '复盘分': 0, '准时分': 100, '等级': 'B',
  open_id: privateMarker, '企业邮箱': privateMarker, '相关文件': privateMarker, '导入批次': privateMarker, surprise: privateMarker};
const rows = [saved, structuredClone(saved), {'姓名': '合成乙', '周次': '原始格式异常 '.repeat(12), '总分': 52.5,
  '源记录ID': 'fixture-source-id', '开始日期': '2026-08-03', '结束日期': '2026-08-07', '提交时间': '2026-08-07 17:22', '思考与复盘摘要': '合成复盘'}, {'本周成果摘要': {open_id: privateMarker, sourcePath: privateMarker}}];
const bundle = {version: 1, purpose: 'legacy-weekly-report-snapshot', sourceSha256: 'a'.repeat(64),
  recordsSha256: digest(JSON.stringify(rows)), records: rows};
const before = JSON.stringify(bundle);
let loads = 0;
const reader = createLegacyReportSnapshot({load: () => {loads++; return bundle;}});
for (const options of [undefined, {}, {employeeUserId: 'forged-user'}, {management: false}]) {
  await assert.rejects(() => reader.list(options), /legacy_snapshot_scope_required/);
  await assert.rejects(() => reader.detail('forged-id', options), /legacy_snapshot_scope_required/);
}
assert.equal(loads, 0, 'denied scope cannot load the private source');
const all = await reader.list({management: true});
assert.equal(all.total, 4);
assert.equal(all.snapshotTotal, 4);
assert.equal(all.readOnly, true);
assert.equal(all.affectsPerformance, false);
assert.equal(all.ownershipReady, false);
assert.equal(all.ownerGroups.find(group => group.key === 'unreviewed').count, 4);
assert.equal(all.ownerGroups.find(group => group.key === 'unknown').count, 0, 'an unclassified source is not falsely presented as having no unresolved employees');
assert.equal(new Set(all.items.map(row => row.id)).size, 4, 'identical originals retain separate stable row IDs');
assert.deepEqual(all.items.map(row => row.sourceRow), [1, 2, 3, 4]);
assert.equal(all.items[0].weekLabel, '3/31-4/4');
assert.equal(all.items[0].weekStart, '', 'missing historical year is never guessed');
assert.equal(all.items[0].oldScore, 0);
assert.equal(all.items[2].weekLabel, rows[2]['周次'], 'malformed old text must remain intact');
assert(all.items[2].warnings.includes('周次原文格式待核验'));
const page = await reader.list({management: true, limit: 1, offset: 1});
assert.equal(page.items[0].id, all.items[1].id);
assert.equal(page.total, 4);
const byName = await reader.list({management: true, employeeName: '合成甲'});
assert.equal(byName.total, 2);
assert.equal(byName.snapshotTotal, 4);
assert.equal((await reader.list({management: true, search: 'fixture-source-id'})).total, 1);
assert.equal((await reader.list({management: true, search: '<script>'})).total, 2);
assert.equal((await reader.list({management: true, employeeName: "' OR 1=1 --"})).total, 0, 'names are literal filters');
assert.equal((await reader.list({management: true, search: privateMarker})).total, 0, 'private account/path fields are not searchable');
assert.equal((await reader.list({management: true, offset: 99})).items.length, 0);
for (const [index, item] of all.items.entries()) {
  const detail = await reader.detail(item.id, {management: true});
  assert.equal(detail.sourceRow, index + 1);
  assert.equal(detail.facts.results, typeof rows[index]['本周成果摘要'] === 'string' ? rows[index]['本周成果摘要'] : '');
  assert.equal(detail.facts.reflection, rows[index]['思考与复盘摘要'] || '');
  assert.equal(detail.oldScore, rows[index]['总分'] ?? null);
  assert(!JSON.stringify(detail).includes(privateMarker), 'only whitelisted original business fields can be sent');
  assert(!Object.hasOwn(detail, 'records'));
  assert(!Object.hasOwn(detail, 'sourceSha256'));
}
assert.equal((await reader.detail(all.items[0].id, {management: true})).savedFields.find(row => row.label === '总分').value, '0');
assert.equal((await reader.detail(all.items[3].id, {management: true})).savedFields[0].value, '（原字段格式异常，已留存待核验）');
for (const id of ['missing', `reportos-original:${'b'.repeat(64)}:0`, `reportos-original:${bundle.recordsSha256}:04`, `reportos-original:${bundle.recordsSha256}:999999999999999999999`]) {
  assert.equal(await reader.detail(id, {management: true}), null);
}
for (const options of [{limit: 0}, {limit: 101}, {limit: ''}, {offset: -1}, {offset: 0.5}, {offset: 1_000_001},
  {employeeName: ''}, {employeeName: ' 合成甲'}, {search: 'x'.repeat(201)}, {owner: ''}, {owner: 'employee-user-id'}]) {
  await assert.rejects(() => reader.list({management: true, ...options}), /invalid_legacy_snapshot_/);
}
await assert.rejects(() => reader.detail('', {management: true}), /invalid_legacy_snapshot_id/);
const missing = createLegacyReportSnapshot({load: () => null});
assert.equal((await missing.list({management: true})).snapshotTotal, 0);
assert.equal(await missing.detail(all.items[0].id, {management: true}), null);
for (const changed of [{...bundle, recordsSha256: '0'.repeat(64)}, {...bundle, version: 2}, {...bundle, sourceSha256: 'bad'},
  {...bundle, records: null}, {...bundle, records: [null], recordsSha256: digest('[null]')}]) {
  const invalid = createLegacyReportSnapshot({load: () => changed});
  await assert.rejects(() => invalid.list({management: true}), /legacy_snapshot_invalid/);
}
assert.equal(JSON.stringify(bundle), before, 'all source values and row order must remain unchanged');

const classified = structuredClone(bundle);
classified.records[0]['源记录ID'] = 'fixture-existing-duplicate';
classified.records[1]['源记录ID'] = 'fixture-existing-duplicate';
classified.records[3]['姓名'] = '合成待确认';
classified.recordsSha256 = digest(JSON.stringify(classified.records));
const statuses = ['existing', 'existing', 'verified', 'unknown'];
classified.ownership = {version: 1, recordsSha256: classified.recordsSha256, referenceSha256: 'c'.repeat(64),
  statusesSha256: digest(JSON.stringify(statuses)), statuses};
const classifiedBefore = JSON.stringify(classified);
const withOwners = createLegacyReportSnapshot({load: () => classified});
const grouped = await withOwners.list({management: true, owner: 'unknown'});
assert.equal(grouped.ownershipReady, true);
assert.equal(grouped.snapshotTotal, 4);
assert.equal(grouped.ownerTotal, 1);
assert.equal(grouped.total, 1);
assert.deepEqual(grouped.ownerGroups.map(group => [group.key, group.count]), [['all', 4], ['unknown', 1], ['existing', 2], ['verified', 1], ['unreviewed', 0]]);
assert.equal(grouped.items[0].employeeName, '合成待确认', 'unknown virtual owner never overwrites the original name');
assert.deepEqual(grouped.items[0].owner, {id: 'legacy-unknown-person', kind: 'unknown', label: '未知人员／归属待确认', virtual: true});
assert.equal((await withOwners.detail(grouped.items[0].id, {management: true})).owner.kind, 'unknown');
assert.equal((await withOwners.list({management: true, owner: 'unknown', employeeName: '合成甲'})).total, 0);
assert.equal((await withOwners.list({management: true, owner: 'existing', limit: 1, offset: 1})).items[0].sourceRow, 2);
assert.equal((await withOwners.list({management: true, owner: 'unknown', search: '待确认'})).total, 1);
const rejectedOwnership = [
  {...classified.ownership, recordsSha256: 'f'.repeat(64)},
  {...classified.ownership, statusesSha256: 'f'.repeat(64)},
  {...classified.ownership, statuses: ['unknown']},
  {...classified.ownership, statuses: ['employee-user-id', 'existing', 'verified', 'unknown']},
  {...classified.ownership, statuses: ['existing', 'verified', 'verified', 'unknown'], statusesSha256: digest(JSON.stringify(['existing', 'verified', 'verified', 'unknown']))},
  {...classified.ownership, statuses: ['existing', 'existing', 'verified', 'existing'], statusesSha256: digest(JSON.stringify(['existing', 'existing', 'verified', 'existing']))},
];
for (const ownership of rejectedOwnership) {
  const invalid = createLegacyReportSnapshot({load: () => ({...classified, ownership})});
  await assert.rejects(() => invalid.list({management: true}), /legacy_snapshot_invalid/);
  await assert.rejects(() => invalid.detail(grouped.items[0].id, {management: true}), /legacy_snapshot_invalid/);
}
assert.equal(JSON.stringify(classified), classifiedBefore, 'virtual owner classification must not mutate the source or create accounts');
console.log('Legacy snapshot reader passed: complete duplicate/malformed row preservation, virtual unknown-owner group without account creation, integrity-bound coverage, no inferred dates or identities, management-only scope, literal filters, pagination, exact old facts and scores, whitelist privacy, checksum enforcement, no source mutation.');
