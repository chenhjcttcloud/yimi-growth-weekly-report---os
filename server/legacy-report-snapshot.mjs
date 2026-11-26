import {createHash} from 'node:crypto';

const text = value => typeof value === 'string' ? value : '';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
// These are archive groups, never employee identities or authentication users.
const archiveOwners = {
  unknown: {id: 'legacy-unknown-person', kind: 'unknown', label: '未知人员／归属待确认', virtual: true},
  existing: {id: 'legacy-existing-source', kind: 'existing', label: '已在新版保存', virtual: true},
  verified: {id: 'legacy-verified-archive', kind: 'verified', label: '已核实补档', virtual: true},
  unreviewed: {id: 'legacy-unreviewed-source', kind: 'unreviewed', label: '尚未核验归属', virtual: true},
};
// These are the old system's business fields. Account identifiers, email,
// import paths, attachment paths and arbitrary added fields stay server-side.
const savedFieldNames = [
  '姓名', '部门', '周次', '周期ID', '开始日期', '结束日期', '提交时间', '状态', '源记录ID',
  '本周成果摘要', '问题摘要', '下周计划摘要', '思考与复盘摘要',
  '成果分', '问题分', '计划分', '复盘分', '准时分', '总分', '等级',
  '字数', '数字个数', '已读数', '未读数', '点赞数', '评论数',
];

function savedScore(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function displaySavedValue(value) {
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  // A malformed business field can contain nested account/path metadata. Keep
  // that original in the private snapshot rather than serializing it publicly.
  return '（原字段格式异常，已留存待核验）';
}

function scope(options) {
  if (!object(options) || options.management !== true) throw Error('legacy_snapshot_scope_required');
}

function pagination(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))) throw Error('invalid_legacy_snapshot_pagination');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw Error('invalid_legacy_snapshot_pagination');
  return number;
}

function snapshot(value) {
  if (value === null || value === undefined) return null;
  if (!object(value) || value.version !== 1 || value.purpose !== 'legacy-weekly-report-snapshot' ||
      !hashPattern.test(text(value.sourceSha256)) || !hashPattern.test(text(value.recordsSha256)) ||
      !Array.isArray(value.records) || value.records.length > 100_000 || !value.records.every(object) ||
      digest(JSON.stringify(value.records)) !== value.recordsSha256) throw Error('legacy_snapshot_invalid');
  return value;
}

function ownership(source) {
  const records = source?.records || [];
  if (source?.ownership === undefined) return {ready: false, statuses: records.map(() => 'unreviewed')};
  const value = source.ownership;
  if (!object(value) || value.version !== 1 || value.recordsSha256 !== source.recordsSha256 ||
      !hashPattern.test(text(value.referenceSha256)) || !hashPattern.test(text(value.statusesSha256)) ||
      !Array.isArray(value.statuses) || value.statuses.length !== records.length ||
      !value.statuses.every(status => ['unknown', 'existing', 'verified'].includes(status)) ||
      digest(JSON.stringify(value.statuses)) !== value.statusesSha256) throw Error('legacy_snapshot_invalid');
  const bySource = new Map();
  for (let i = 0; i < records.length; i++) {
    const sourceId = text(records[i]['源记录ID']);
    const status = value.statuses[i];
    if (!sourceId && status !== 'unknown' || sourceId && bySource.has(sourceId) && bySource.get(sourceId) !== status) throw Error('legacy_snapshot_invalid');
    if (sourceId) bySource.set(sourceId, status);
  }
  return {ready: true, statuses: value.statuses};
}

function summary(record, index, hash, ownerKind) {
  const warnings = [];
  if (!text(record['源记录ID'])) warnings.push('旧版未保存源记录ID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(record['开始日期'])) || !/^\d{4}-\d{2}-\d{2}$/.test(text(record['结束日期']))) warnings.push('旧版未保存完整日期，年份未推定');
  if (text(record['周次']).length > 60) warnings.push('周次原文格式待核验');
  return {
    id: `reportos-original:${hash}:${index}`,
    sourceRow: index + 1,
    employeeName: text(record['姓名']),
    department: text(record['部门']),
    weekLabel: text(record['周次']),
    weekStart: text(record['开始日期']),
    weekEnd: text(record['结束日期']),
    submittedAt: text(record['提交时间']),
    status: text(record['状态']),
    oldScore: savedScore(record['总分']),
    owner: {...archiveOwners[ownerKind]},
    warnings,
  };
}

// The source is a separate, explicitly prepared file. This reader has no DB,
// employee resolver, score calculator, AI client, sender or write capability.
export function createLegacyReportSnapshot({load}) {
  if (typeof load !== 'function') throw Error('legacy_snapshot_loader_required');

  async function list(options = {}) {
    scope(options);
    const limit = pagination(options.limit, 20, 100);
    const offset = pagination(options.offset, 0, 1_000_000);
    if (!limit) throw Error('invalid_legacy_snapshot_pagination');
    if (options.employeeName !== undefined && (typeof options.employeeName !== 'string' || !options.employeeName || options.employeeName.trim() !== options.employeeName || options.employeeName.length > 100)) throw Error('invalid_legacy_snapshot_name');
    if (options.search !== undefined && (typeof options.search !== 'string' || options.search.length > 200)) throw Error('invalid_legacy_snapshot_search');
    const ownerFilter = options.owner === undefined ? 'all' : options.owner;
    if (!['all', ...Object.keys(archiveOwners)].includes(ownerFilter)) throw Error('invalid_legacy_snapshot_owner');
    const source = snapshot(await load());
    const records = source?.records || [];
    const owners = ownership(source);
    const counts = {unknown: 0, existing: 0, verified: 0, unreviewed: 0};
    for (const status of owners.statuses) counts[status]++;
    const ownerGroups = [{key: 'all', label: '全部原始档案', count: records.length},
      ...Object.entries(archiveOwners).map(([key, value]) => ({key, label: value.label, count: counts[key]}))];
    const grouped = records.map((record, index) => ({record, index, ownerKind: owners.statuses[index]}))
      .filter(({ownerKind}) => ownerFilter === 'all' || ownerKind === ownerFilter);
    const names = [...new Set(grouped.map(({record}) => text(record['姓名'])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const term = (options.search || '').trim().toLowerCase();
    const matched = grouped.filter(({record}) => {
      if (options.employeeName !== undefined && text(record['姓名']) !== options.employeeName) return false;
      return !term || ['姓名', '部门', '周次', '开始日期', '结束日期', '源记录ID', '本周成果摘要', '问题摘要', '下周计划摘要', '思考与复盘摘要']
        .some(key => text(record[key]).toLowerCase().includes(term));
    });
    return {
      items: matched.slice(offset, offset + limit).map(({record, index, ownerKind}) => summary(record, index, source.recordsSha256, ownerKind)),
      names, total: matched.length, snapshotTotal: records.length, limit, offset,
      ownerGroups, ownerTotal: grouped.length, ownershipReady: owners.ready,
      readOnly: true, affectsPerformance: false,
    };
  }

  async function detail(id, options = {}) {
    scope(options);
    if (typeof id !== 'string' || !id || id.trim() !== id || id.length > 200) throw Error('invalid_legacy_snapshot_id');
    const source = snapshot(await load());
    const owners = ownership(source);
    const match = /^reportos-original:([a-f0-9]{64}):(0|[1-9]\d*)$/.exec(id);
    if (!source || !match || match[1] !== source.recordsSha256) return null;
    const index = Number(match[2]);
    if (!Number.isSafeInteger(index) || index >= source.records.length) return null;
    const record = source.records[index];
    return {
      ...summary(record, index, source.recordsSha256, owners.statuses[index]),
      facts: {
        results: text(record['本周成果摘要']), problems: text(record['问题摘要']),
        nextPlan: text(record['下周计划摘要']), reflection: text(record['思考与复盘摘要']),
      },
      legacyScores: {
        results: savedScore(record['成果分']), problems: savedScore(record['问题分']),
        nextPlan: savedScore(record['计划分']), reflection: savedScore(record['复盘分']),
        total: savedScore(record['总分']), onTime: savedScore(record['准时分']), grade: text(record['等级']),
      },
      savedFields: savedFieldNames.filter(label => Object.hasOwn(record, label)).map(label => ({
        label, value: displaySavedValue(record[label]),
      })),
      readOnly: true, affectsPerformance: false,
    };
  }

  return {list, detail};
}
