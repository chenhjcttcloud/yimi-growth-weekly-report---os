// Export the already authorized on-screen snapshot. No fetch, publication,
// recalculation, raw reports, peer comments or additional employee lookup.
const text = (title, width = 19) => ({title, width, type: 'text'});
const score = title => ({title, width: 23, type: 'number', format: '0.0'});
const count = title => ({title, width: 18, type: 'number', format: '0'});
const baseColumns = [text('月份', 13), text('姓名', 16), text('部门', 26), text('在职状态', 16)];
const titles = {quality: '周报质量', collaboration: '360协同得分', all: '绩效评分'};
function numeric(value, maximum = Infinity, integer = false) {
  if (!(typeof value === 'number' || typeof value === 'string' && value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= maximum && (!integer || Number.isSafeInteger(result)) ? result : null;
}
const scoreValue = value => numeric(value, 100);
const countValue = value => numeric(value, Number.MAX_SAFE_INTEGER, true);
const missing = (expected, submitted) => expected === null || submitted === null ? null : Math.max(0, expected - submitted);
const baseValues = row => [row.month, row.name || '', row.department || '未分配部门', row.active === false ? '离职 / 停用' : row.active === true ? '在职' : '未标记'];

function qualityValues(row) {
  const quality = row.quality || {}, confirmed = ['final', 'revised_final'].includes(quality.status);
  const automatic = quality.publicationMode === 'automatic';
  const blocked = {month_open: '本月尚未结束，月结后自动生成最终分。', collection_pending: '周报收集未完成，收集和分析完成后自动生成最终分。'}[quality.confirmationBlockedReason];
  const statuses = {final: automatic ? '已自动生成' : '历史已发布', revised_final: automatic ? '已自动生成' : '历史已发布', pending_ai: '暂定', pending_confirmation: '等待自动生成', pending_generation: '等待自动生成', no_reports: '暂无可评分周报'};
  const note = confirmed ? automatic ? '有效周报完成分析后自动汇总生成的月度最终分。' : '历史已保存的月度最终分。' : blocked || (quality.status === 'pending_ai' ? '待AI分析；当前均分为暂定参考。' : ['pending_confirmation', 'pending_generation'].includes(quality.status) ? '等待系统自动汇总，最终分留空。' : '尚无有效周报质量分。');
  return [...baseValues(row), confirmed ? scoreValue(quality.finalScore) : null, scoreValue(quality.candidateScore), scoreValue(quality.currentAverage), statuses[quality.status] || '暂无可评分周报',
    countValue(row.timeliness?.expected), countValue(row.timeliness?.submitted), countValue(row.timeliness?.missing),
    countValue(quality.expectedCount), countValue(quality.analyzedCount), countValue(quality.pendingAnalysis), note, row.userId];
}

function collaborationValues(row, saved) {
  const finalScore = scoreValue(saved?.result?.score), published = finalScore !== null;
  // A legacy final is authoritative even when its original component scores
  // were never archived. Present-day assignments cannot explain that result.
  const legacy = published && saved.scoring_rule !== 'weighted_30_70';
  const manager = row.managerProgress || {};
  const managerExpected = legacy ? null : countValue(manager.expected), managerSubmitted = legacy ? null : countValue(manager.submitted);
  const peerExpected = legacy ? null : countValue(row.collaborationExpected), peerSubmitted = legacy ? null : countValue(row.collaborationSubmitted);
  const managerScore = published ? legacy ? null : scoreValue(saved.result.managerScore) : scoreValue(manager.score);
  const peerScore = published ? legacy ? null : scoreValue(saved.result.peerScore) : scoreValue(row.peerCandidate);
  let status = legacy ? '历史已发布' : published ? '已发布' : '待评分';
  if (!published) {
    if (manager.handoffRequired) status = '待评分交接';
    else if (managerExpected === 0 && peerExpected === 0) status = '暂无评分数据';
    else if (!managerExpected || !peerExpected) status = '待配评';
    else if (manager.complete && row.peerComplete) status = '待自动发布';
  }
  const note = legacy ? '历史原分；缺失分项留空，不按新口径重算。' : published ? '使用已保存的最终分和分项；缺失分项留空。' : manager.handoffRequired ? '30%责任待交接，最终分留空。' : '互评均分仅供参考；两部分完成后发布。';
  return [...baseValues(row), finalScore, status, legacy ? '历史原值' : '负责人或老板30%＋同事70%', managerScore,
    legacy ? null : manager.kind === 'boss' ? '老板' : manager.kind === 'manager' ? '负责人' : '未配置',
    managerSubmitted, managerExpected, missing(managerExpected, managerSubmitted), peerScore, peerSubmitted, peerExpected, missing(peerExpected, peerSubmitted),
    note, row.userId];
}

const qualityColumns = [...baseColumns, score('月度质量最终分'), score('AI质量均分'), score('已完成分析均分'), text('质量状态', 24),
  count('应交周报数'), count('已交周报数'), count('缺交周报数'), count('计入质量周报数'), count('已分析周报数'), count('待分析周报数'), text('状态说明', 54), text('员工ID', 25)];
const collaborationColumns = [...baseColumns, score('月度综合最终分'), text('评分状态', 18), text('计分口径', 29), score('负责人或老板评分（30%）'), text('30%评分角色', 18),
  count('30%已评数'), count('30%应评数'), count('30%缺评数'), score('同事互评均分（70%）'), count('同事已评数'), count('同事应评数'), count('同事缺评数'), text('状态说明', 58), text('员工ID', 25)];

function filenamePart(value) {
  const part = String(value).replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_').trim().replace(/[. ]+$/g, '');
  return Array.from(part || '全部部门').slice(0, 70).join('');
}

export function buildPerformanceScoreExport({kind, month, rows, results, employeeUserIds, department = '', query = ''}) {
  if (!Object.hasOwn(titles, kind) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || month.startsWith('0000')) throw Error('invalid_score_export_selection');
  if (!Array.isArray(rows) || !Array.isArray(results) || !Array.isArray(employeeUserIds) || !employeeUserIds.length || employeeUserIds.some(id => typeof id !== 'string' || !id)) throw Error('no_score_export_employees');
  const wanted = [...new Set(employeeUserIds)], byId = new Map();
  for (const row of rows) {
    if (row.month !== month || !wanted.includes(row.userId)) continue;
    if (byId.has(row.userId)) throw Error('duplicate_score_export_employee');
    byId.set(row.userId, row);
  }
  if (wanted.some(id => !byId.has(id))) throw Error('stale_score_export_selection');
  const selected = wanted.map(id => byId.get(id)), sheets = [];
  if (kind !== 'collaboration') sheets.push({name: titles.quality, columns: qualityColumns.map(column => ({...column})), rows: selected.map(qualityValues)});
  if (kind !== 'quality') sheets.push({name: titles.collaboration, columns: collaborationColumns.map(column => ({...column})), rows: selected.map(row => collaborationValues(row, results.find(result => result.month === month && result.employee_user_id === row.userId && result.kind === 'collaboration')))});
  return {fileName: `${titles[kind]}_${month}_${filenamePart(department || '全部部门')}${query.trim() ? '_筛选' : ''}.xlsx`, sheets, employeeCount: selected.length};
}
