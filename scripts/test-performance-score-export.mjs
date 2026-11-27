import assert from 'node:assert/strict';

// Pure synthetic snapshot tests. No service, database, real identity, workbook
// download or outbound request is used; the writer has its own separate tests.
const month = '2026-10';
const privateMarker = 'SYNTHETIC_PRIVATE_BODY_MUST_NOT_BE_EXPORTED';
const previousFetch = globalThis.fetch;
let outbound = 0, passed = 0;
globalThis.fetch = async () => { outbound++; throw Error('score_export_must_not_fetch'); };

const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const person = (userId, extra = {}) => ({
  month, userId, name: '合成员工 ' + userId, department: '研发组', active: true,
  quality: {status: 'pending_confirmation', currentAverage: 74.2, candidateScore: 74.2,
    finalScore: null, pendingAnalysis: 0, analyzedCount: 3, expectedCount: 3},
  timeliness: {expected: 5, submitted: 3, missing: 2},
  managerProgress: {kind: 'manager', score: 83, expected: 1, submitted: 1, complete: true,
    records: [{score: 83, comment: privateMarker}]},
  peerCandidate: 75.4, peerComplete: true, collaborationExpected: 2,
  collaborationSubmitted: 2, collaborationComplete: true, collaborationCandidate: 77.7,
  reports: [{content: {results: privateMarker}, sourcePath: privateMarker}],
  ...extra,
});
const result = (userId, kind, scoringRule, score, extra = {}) => ({
  month, employee_user_id: userId, employee_name: '不可按该显示名合并', kind,
  scoring_rule: scoringRule, confirmed_by: '合成确认人', confirmed_at: '2026-11-01T00:15:00Z',
  evidence_json: JSON.stringify({privateSource: privateMarker}),
  result: {score, ...extra},
});
const zero = person('zero', {name: '同名 🧪', quality: {status: 'final', finalScore: 0,
  currentAverage: 0, candidateScore: 0, expectedCount: 3, analyzedCount: 3, pendingAnalysis: 0,
  confirmedBy: '合成确认人', confirmedAt: '2026-11-01T00:15:00Z'},
  managerProgress: {kind: 'boss', score: 0, expected: 1, submitted: 1, complete: true},
  peerCandidate: 0});
const pending = person('pending', {name: '同名 🧪', quality: {status: 'pending_ai', finalScore: null,
  currentAverage: 62.5, candidateScore: null, expectedCount: 2, analyzedCount: 1, pendingAnalysis: 1},
  managerProgress: {kind: 'manager', score: null, expected: 2, submitted: 1, complete: false},
  peerCandidate: 80, collaborationExpected: 3, collaborationSubmitted: 1,
  collaborationComplete: false, collaborationCandidate: null});
const candidate = person('candidate');
const legacy = person('legacy', {department: '历史组', managerProgress: {kind: 'boss', score: 99,
  expected: 4, submitted: 4, complete: true}, peerCandidate: 97,
  collaborationExpected: 9, collaborationSubmitted: 9});
const weighted = person('weighted', {department: '业务组', managerProgress: {kind: 'manager', score: 12,
  expected: 2, submitted: 1, complete: false}, peerCandidate: 22});
const missingParts = person('weighted-missing-parts', {department: '业务组',
  managerProgress: {kind: 'boss', score: 98, expected: 1, submitted: 1, complete: true}, peerCandidate: 99});
const blank = person('blank', {quality: {status: 'pending_ai', finalScore: '', candidateScore: ' ',
  currentAverage: null, expectedCount: 0, analyzedCount: 0, pendingAnalysis: 0},
  managerProgress: {kind: 'unassigned', score: '', expected: 0, submitted: 0, complete: false},
  peerCandidate: '\t', collaborationExpected: 0, collaborationSubmitted: 0,
  collaborationComplete: false, collaborationCandidate: null});
const inactive = person('inactive', {name: '保留历史员工', department: '历史组', active: false});
const rows = [zero, pending, candidate, legacy, weighted, missingParts, blank, inactive,
  {...zero, month: '2026-09', quality: {...zero.quality, finalScore: 99}}];
const results = [
  {...result('zero', 'quality', 'management_confirmed', 99), month: '2026-09'},
  {...result('zero', 'collaboration', 'weighted_30_70', 99, {managerScore: 99, peerScore: 99}), month: '2026-09'},
  {...result('pending', 'quality', 'management_confirmed', 66), month: '2026-09'},
  result('zero', 'quality', 'management_confirmed', 0, {candidateScore: 0, publicationMode: 'management_confirmation'}),
  result('zero', 'collaboration', 'weighted_30_70', 0, {managerScore: 0, peerScore: 0, weights: {manager: 30, peers: 70}}),
  result('legacy', 'collaboration', 'legacy', 88.2, {managerScore: 1, peerScore: 2}),
  result('weighted', 'collaboration', 'weighted_30_70', 87.4, {managerScore: 85, peerScore: 88.4}),
  result('weighted-missing-parts', 'collaboration', 'weighted_30_70', 91.6),
  result('blank', 'quality', 'management_confirmed', ''),
  result('blank', 'collaboration', 'weighted_30_70', ' '),
];
const selectedIds = ['zero', 'pending', 'candidate', 'legacy', 'weighted', 'weighted-missing-parts', 'blank', 'inactive'];
const requiredQuality = ['月份', '姓名', '部门', '月度质量最终分', 'AI质量均分', '已完成分析均分',
  '质量状态', '应交周报数', '已交周报数', '缺交周报数', '计入质量周报数', '已分析周报数',
  '待分析周报数', '状态说明', '员工ID'];
const requiredCollaboration = ['月份', '姓名', '部门', '在职状态', '月度综合最终分', '评分状态', '计分口径',
  '负责人或老板评分（30%）', '30%评分角色', '30%已评数', '30%应评数', '30%缺评数',
  '同事互评均分（70%）', '同事已评数', '同事应评数', '同事缺评数', '状态说明', '员工ID'];

function index(sheet, title) {
  const value = sheet.columns.findIndex(column => column.title === title);
  assert(value >= 0, 'missing column: ' + title);
  return value;
}
function cell(sheet, userId, title) {
  const row = sheet.rows.find(item => item[index(sheet, '员工ID')] === userId);
  assert(row, 'missing employee: ' + userId);
  return row[index(sheet, title)];
}
const isBlank = value => value === null || value === '' || value === undefined;
function sheetFor(model, title) { const value = model.sheets.find(sheet => sheet.columns.some(column => column.title === title)); assert(value, 'missing sheet: ' + title); return value; }
function validateModel(model) {
  assert(model && typeof model === 'object' && !('then' in model));
  assert(Array.isArray(model.sheets) && model.sheets.length);
  assert.equal(model.fileName.endsWith('.xlsx'), true);
  assert(!/[\\/<>:"|?*\u0000-\u001f\u007f]/u.test(model.fileName), 'filename must be a safe leaf name');
  for (const sheet of model.sheets) {
    assert.equal(typeof sheet.name, 'string');
    assert.equal(new Set(sheet.columns.map(column => column.title)).size, sheet.columns.length);
    assert(sheet.columns.every(column => !/确认人|确认时间|发布人|发布时间|生成方式|生成时间|结果来源/.test(column.title)), 'score tables omit approval metadata columns');
    for (const row of sheet.rows) {
      assert.equal(row.length, sheet.columns.length);
      row.forEach((value, position) => {
        assert(value === null || typeof value === 'string' || typeof value === 'number', 'cells must be primitive strings/numbers/null');
        if (sheet.columns[position].type === 'number') assert(value === null || typeof value === 'number' && Number.isFinite(value), 'number cells must preserve blank as null and valid scores as numbers');
      });
    }
    assert.equal(new Set(sheet.rows.map(row => row[index(sheet, '员工ID')])).size, sheet.rows.length, 'an employee must not be repeated in a monthly sheet');
  }
  assert(!JSON.stringify(model).includes(privateMarker), 'raw report, evidence, private paths and comments must not leak through row spreading');
}

try {
  const {buildPerformanceScoreExport} = await import('../src/lib/performanceScoreExport.mjs');
  const build = extra => {
    const input = {kind: 'all', month, rows, results, employeeUserIds: selectedIds, ...extra};
    const before = structuredClone(input);
    freeze(input);
    const model = buildPerformanceScoreExport(input);
    assert.deepEqual(input, before, 'export must not mutate the authorized source snapshot');
    validateModel(model);
    return model;
  };
  const check = (label, fn) => { fn(); passed++; console.log('PASS ' + label); };

  check('two sheets, typed columns and current month only', () => {
    const model = build();
    assert.equal(model.employeeCount, 8);
    assert.equal(model.sheets.length, 2);
    assert.equal(model.fileName, '绩效评分_2026-10_全部部门.xlsx');
    const quality = sheetFor(model, '月度质量最终分'), collaboration = sheetFor(model, '月度综合最终分');
    for (const title of requiredQuality) index(quality, title);
    for (const title of requiredCollaboration) index(collaboration, title);
    for (const sheet of model.sheets) for (const row of sheet.rows) assert.equal(row[index(sheet, '月份')], month);
  });

  check('zero is a numeric score and current-month identity join defeats names and trend results', () => {
    const model = build(), quality = sheetFor(model, '月度质量最终分'), collaboration = sheetFor(model, '月度综合最终分');
    assert.equal(cell(quality, 'zero', '月度质量最终分'), 0);
    assert(isBlank(cell(quality, 'pending', '月度质量最终分')), 'same display name and an older result must not supply this employee a current final');
    assert.equal(cell(collaboration, 'zero', '月度综合最终分'), 0);
    assert.equal(cell(collaboration, 'zero', '负责人或老板评分（30%）'), 0);
    assert.equal(cell(collaboration, 'zero', '同事互评均分（70%）'), 0);
  });

  check('quality candidate and analyzed average never impersonate a final score', () => {
    const quality = sheetFor(build({kind: 'quality'}), '月度质量最终分');
    assert(isBlank(cell(quality, 'candidate', '月度质量最终分')));
    assert.equal(cell(quality, 'candidate', 'AI质量均分'), 74.2);
    assert.equal(cell(quality, 'candidate', '已完成分析均分'), 74.2);
    assert.equal(cell(quality, 'candidate', '应交周报数'), 5);
    assert.equal(cell(quality, 'candidate', '已交周报数'), 3);
    assert.equal(cell(quality, 'candidate', '缺交周报数'), 2);
    assert.equal(cell(quality, 'candidate', '计入质量周报数'), 3);
    assert.equal(cell(quality, 'pending', '待分析周报数'), 1);
    assert.equal(cell(quality, 'pending', '已分析周报数'), 1);
    assert.equal(cell(quality, 'candidate', '质量状态'), '等待自动生成');
  });

  check('automatic monthly quality exports its final without confirmation fields', () => {
    const automatic = person('automatic', {quality: {...zero.quality, finalScore: 86.4, candidateScore: 86.4, currentAverage: 86.4, publicationMode: 'automatic', generatedBy: '系统自动计算', generatedAt: '2026-11-01T00:15:00Z'}});
    const automaticZero = person('automatic-zero', {quality: {...zero.quality, publicationMode: 'automatic', confirmedBy: '系统自动计算'}});
    const sheet = sheetFor(build({kind: 'quality', rows: [automatic, automaticZero], results: [], employeeUserIds: ['automatic', 'automatic-zero']}), '月度质量最终分');
    assert.equal(cell(sheet, 'automatic', '月度质量最终分'), 86.4);
    assert.equal(cell(sheet, 'automatic-zero', '月度质量最终分'), 0);
    for (const id of ['automatic', 'automatic-zero']) {
      assert.equal(cell(sheet, id, '质量状态'), '已自动生成');
      assert(!cell(sheet, id, '状态说明').includes('确认'));
    }
  });

  check('waiting for automatic generation is an explicit state and never a final or a human confirmation', () => {
    const waiting = person('waiting-generation', {quality: {...candidate.quality, status: 'pending_generation'}});
    const sheet = sheetFor(build({kind: 'quality', rows: [waiting], results: [], employeeUserIds: ['waiting-generation']}), '月度质量最终分');
    assert.equal(cell(sheet, 'waiting-generation', '质量状态'), '等待自动生成');
    assert.equal(cell(sheet, 'waiting-generation', '月度质量最终分'), null);
    assert(!cell(sheet, 'waiting-generation', '状态说明').includes('确认'));
  });

  check('unpublished collaboration exports current components and personal missing counts', () => {
    const sheet = sheetFor(build({kind: 'collaboration'}), '月度综合最终分');
    assert(isBlank(cell(sheet, 'candidate', '月度综合最终分')), 'a completed candidate is still not a published result');
    assert.equal(cell(sheet, 'candidate', '负责人或老板评分（30%）'), 83);
    assert.equal(cell(sheet, 'candidate', '同事互评均分（70%）'), 75.4);
    assert.equal(cell(sheet, 'pending', '30%已评数'), 1);
    assert.equal(cell(sheet, 'pending', '30%应评数'), 2);
    assert.equal(cell(sheet, 'pending', '30%缺评数'), 1);
    assert.equal(cell(sheet, 'pending', '同事已评数'), 1);
    assert.equal(cell(sheet, 'pending', '同事应评数'), 3);
    assert.equal(cell(sheet, 'pending', '同事缺评数'), 2);
  });

  check('legacy keeps only its frozen final and no reconstructed 30/70 components or progress', () => {
    const sheet = sheetFor(build({kind: 'collaboration'}), '月度综合最终分');
    assert.equal(cell(sheet, 'legacy', '月度综合最终分'), 88.2);
    for (const title of ['负责人或老板评分（30%）', '30%评分角色', '30%已评数', '30%应评数', '30%缺评数', '同事互评均分（70%）', '同事已评数', '同事应评数', '同事缺评数']) assert(isBlank(cell(sheet, 'legacy', title)), 'legacy column must remain blank: ' + title);
    assert.match(String(cell(sheet, 'legacy', '计分口径')), /历史|legacy/iu);
  });

  check('weighted publications use saved components and absent components stay blank', () => {
    const sheet = sheetFor(build({kind: 'collaboration'}), '月度综合最终分');
    assert.equal(cell(sheet, 'weighted', '月度综合最终分'), 87.4);
    assert.equal(cell(sheet, 'weighted', '负责人或老板评分（30%）'), 85);
    assert.equal(cell(sheet, 'weighted', '同事互评均分（70%）'), 88.4);
    assert.equal(cell(sheet, 'weighted-missing-parts', '月度综合最终分'), 91.6);
    assert(isBlank(cell(sheet, 'weighted-missing-parts', '负责人或老板评分（30%）')));
    assert(isBlank(cell(sheet, 'weighted-missing-parts', '同事互评均分（70%）')));
  });

  check('null and whitespace are not zero or completion', () => {
    const model = build(), quality = sheetFor(model, '月度质量最终分'), sheet = sheetFor(model, '月度综合最终分');
    for (const title of ['月度质量最终分', 'AI质量均分', '已完成分析均分']) assert(isBlank(cell(quality, 'blank', title)));
    for (const title of ['月度综合最终分', '负责人或老板评分（30%）', '同事互评均分（70%）']) assert(isBlank(cell(sheet, 'blank', title)));
    assert(!/^已发布|^全部完成/u.test(String(cell(sheet, 'blank', '评分状态'))), 'zero configured relationships cannot count as completion');
  });

  check('explicit selection includes every page, deduplicates IDs and excludes unselected loaded rows', () => {
    const bulk = Array.from({length: 43}, (_, i) => person('page-' + i));
    const ids = bulk.map(row => row.userId);
    const model = build({rows: [...bulk, zero], results: [], employeeUserIds: [...ids, ids[0]]});
    assert.equal(model.employeeCount, 43);
    for (const sheet of model.sheets) assert.deepEqual(new Set(sheet.rows.map(row => row[index(sheet, '员工ID')])), new Set(ids));
    const limited = build({employeeUserIds: ['zero', 'candidate', 'zero']});
    assert.equal(limited.employeeCount, 2);
    for (const sheet of limited.sheets) assert.deepEqual(new Set(sheet.rows.map(row => row[index(sheet, '员工ID')])), new Set(['zero', 'candidate']));
  });

  check('department and Unicode search preserve both same-name identities', () => {
    // Department/search are filename context; the page supplies its full
    // filtered ID set, rather than allowing this pure function to widen it.
    const model = build({department: '研发组', query: '同名 🧪', employeeUserIds: ['zero', 'pending']});
    assert.equal(model.fileName, '绩效评分_2026-10_研发组_筛选.xlsx');
    assert.equal(model.employeeCount, 2);
    for (const sheet of model.sheets) assert.deepEqual(new Set(sheet.rows.map(row => row[index(sheet, '员工ID')])), new Set(['zero', 'pending']));
    assert.equal(build({kind: 'quality'}).fileName, '周报质量_2026-10_全部部门.xlsx');
    assert.equal(build({kind: 'collaboration'}).fileName, '360协同得分_2026-10_全部部门.xlsx');
  });

  check('path-like labels cannot create a path or expose a search query in the filename', () => {
    const department = '../研发/实验\\组:"*?|<>\u0000';
    const special = person('unicode', {name: '跨平台 🧪', department});
    const model = build({kind: 'quality', rows: [special], results: [], employeeUserIds: ['unicode'], department, query: '跨平台'});
    assert.match(model.fileName, /^周报质量_2026-10_/u);
    assert.match(model.fileName, /研发/u);
    assert.match(model.fileName, /_筛选\.xlsx$/u);
    assert(!model.fileName.includes('跨平台'), 'only a generic filter suffix belongs in the filename');
  });

  check('invalid months, kinds and empty selected snapshots fail rather than exporting misleading data', () => {
    for (const invalidMonth of ['', 'latest', '2026-13', '2026-00', '2026-1', '../../2026-10', '2026-10/evil']) assert.throws(() => buildPerformanceScoreExport({kind: 'quality', month: invalidMonth, rows, results, employeeUserIds: selectedIds}));
    assert.throws(() => buildPerformanceScoreExport({kind: 'unknown', month, rows, results, employeeUserIds: selectedIds}));
    for (const input of [{rows: []}, {employeeUserIds: []}, {employeeUserIds: ['not-loaded']}, {employeeUserIds: ['zero', 'not-loaded']}, {rows: [...rows, zero]}]) assert.throws(() => buildPerformanceScoreExport({kind: 'all', month, rows, results, employeeUserIds: selectedIds, ...input}));
  });
  assert.equal(outbound, 0);
  console.log(JSON.stringify({passed, outboundRequests: outbound, syntheticOnly: true, snapshotMutation: false}));
} finally {
  globalThis.fetch = previousFetch;
}
