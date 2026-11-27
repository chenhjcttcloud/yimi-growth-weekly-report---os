import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createXlsxWorkbook} from '../src/lib/xlsxWorkbook.mjs';

// No real employee data. Tests retain the XLSX and all diagnostic artifacts.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(project, 'outputs/tests'), {recursive: true});
const artifacts = await mkdtemp(path.join(project, 'outputs/tests/xlsx-workbook-'));
const decoder = new TextDecoder('utf-8', {fatal: true});
const crc32 = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
};

function unzip(bytes) {
  assert(bytes instanceof Uint8Array);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true), u32 = offset => view.getUint32(offset, true);
  const end = bytes.length - 22;
  assert.equal(u32(end), 0x06054b50, 'ZIP end record');
  assert.equal(u16(end + 4), 0); assert.equal(u16(end + 6), 0);
  assert.equal(u16(end + 8), u16(end + 10)); assert.equal(u16(end + 20), 0);
  const count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16);
  assert.equal(centralStart + centralSize, end);
  const entries = new Map();
  let central = centralStart, expectedLocal = 0;
  for (let index = 0; index < count; index++) {
    assert.equal(u32(central), 0x02014b50);
    assert.equal(u16(central + 8), 0x0800, 'UTF-8 ZIP names');
    assert.equal(u16(central + 10), 0, 'stored entries use no external compression library');
    const crc = u32(central + 16), size = u32(central + 20), fullSize = u32(central + 24);
    assert.equal(size, fullSize);
    const nameLength = u16(central + 28), extraLength = u16(central + 30), commentLength = u16(central + 32);
    const local = u32(central + 42), nameBytes = bytes.subarray(central + 46, central + 46 + nameLength);
    const name = decoder.decode(nameBytes);
    assert(!entries.has(name)); assert(!name.includes('..')); assert(!name.startsWith('/'));
    assert.equal(local, expectedLocal);
    assert.equal(u32(local), 0x04034b50); assert.equal(u16(local + 6), 0x0800); assert.equal(u16(local + 8), 0);
    assert.equal(u32(local + 14), crc); assert.equal(u32(local + 18), size); assert.equal(u32(local + 22), fullSize);
    assert.equal(u16(local + 26), nameLength); assert.equal(u16(local + 28), 0);
    assert.deepEqual(bytes.subarray(local + 30, local + 30 + nameLength), nameBytes);
    const dataStart = local + 30 + nameLength, data = bytes.subarray(dataStart, dataStart + size);
    assert.equal(crc32(data), crc, name + ': CRC');
    const xml = decoder.decode(data);
    assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'));
    assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(xml));
    assert(!/<(?:f|externalLink|hyperlink|oleObject|macro)\b|<!DOCTYPE|<!ENTITY|TargetMode="External"/i.test(xml));
    entries.set(name, xml);
    expectedLocal = dataStart + size;
    central += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(central, end); assert.equal(expectedLocal, centralStart);
  return entries;
}

const fixture = {sheets: [
  {name: '周报质量', columns: [
    {title: '员工／编码', width: 20},
    {title: '周报质量分', type: 'number', format: '0.0', width: 16},
    {title: '已提交周报数', type: 'number', format: '0', width: 16},
    {title: '状态', width: 18},
    {title: '原样文本', width: 36},
  ], rows: [
    ['测试甲🧪', 0, 0, '已发布', '=SUM(1,2)'],
    ['测试乙', 88.5, 2, '已发布', '+1+2'],
    ['００１23', null, null, '待评分', '-1+2'],
    ['测试丙', 100, 1, '已发布', '@SUM(1,2)'],
  ]},
  {name: '360协同得分', columns: [
    {title: '员工', width: 20},
    {title: '老板／负责人30%', type: 'number', format: '0.0', width: 22},
    {title: '同事70%', type: 'number', format: '0.0', width: 18},
    {title: '完成数', type: 'number', format: '0', width: 14},
    {title: '状态', width: 22},
  ], rows: [
    ['测试负责人', 85, 90, 15, '尚未全部完成'],
    ['测试同事', 0, 0, 0, '已发布'],
    ['测试新员工', null, null, 0, '待评分'],
  ]},
]};
const snapshot = JSON.stringify(fixture);
const bytes = createXlsxWorkbook(fixture), entries = unzip(bytes);
assert.equal(JSON.stringify(fixture), snapshot, 'writer never mutates caller data');
assert.deepEqual(createXlsxWorkbook(fixture), bytes, 'deterministic ZIP bytes');
assert.equal(entries.size, 7);
assert.deepEqual([...entries.keys()].sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels',
  'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].sort());
const main = entries.get('xl/worksheets/sheet1.xml'), second = entries.get('xl/worksheets/sheet2.xml');
assert(main.includes('<c r="B2" s="2"><v>0</v></c>'));
assert(main.includes('<c r="C2" s="3"><v>0</v></c>'));
assert(main.includes('<c r="B4" s="2"/>'));
assert(main.includes('<c r="C4" s="3"/>'));
assert(!main.includes('<v>null</v>') && !main.includes('undefined'));
for (const value of ['=SUM(1,2)', '+1+2', '-1+2', '@SUM(1,2)']) assert(main.includes(`<t xml:space="preserve">${value}</t>`));
assert(main.includes('测试甲🧪') && main.includes('００１23'));
assert(main.includes('state="frozen"') && main.includes('topLeftCell="A2"'));
assert(main.includes('<autoFilter ref="A1:E5"/>') && second.includes('<autoFilter ref="A1:E4"/>'));
assert(main.includes('width="20" customWidth="1"'));
const styles = entries.get('xl/styles.xml');
assert(styles.includes('rgb="FF2F7D55"') && styles.includes('formatCode="0.0"') && styles.includes('numFmtId="1"'));
assert(entries.get('xl/workbook.xml').includes('name="周报质量"') && entries.get('xl/workbook.xml').includes('name="360协同得分"'));

const tiny = (rows, columns = [{title: '文本'}], name = 'Sheet') => ({sheets: [{name, columns, rows}]});
const escaped = unzip(createXlsxWorkbook(tiny([['<tag>&"\'\u0000\u0001\u000b\ud800\udfff\ufffe\uffff\t\r\n_x000A_']])))
  .get('xl/worksheets/sheet1.xml');
assert(escaped.includes('&lt;tag&gt;&amp;&quot;&apos;'));
assert(escaped.includes('\t&#13;\n_x005F_x000A_'));
assert(!escaped.includes('\ufffd'), 'invalid lone surrogates are filtered before UTF-8 encoding');
const long = unzip(createXlsxWorkbook(tiny([['🧪'.repeat(17000)]]))).get('xl/worksheets/sheet1.xml');
assert.equal((long.match(/🧪/gu) || []).length, 16383, 'cell limit avoids a split surrogate');
const textNumber = unzip(createXlsxWorkbook(tiny([[0]]))).get('xl/worksheets/sheet1.xml');
assert(textNumber.includes('<c r="A2" t="inlineStr" s="0"><is><t xml:space="preserve">0</t>'));
const names = unzip(createXlsxWorkbook({sheets: [
  {name: " 'A/B:*?[x]\\' ", columns: [{title: 'x'}], rows: []},
  {name: 'a b    x', columns: [{title: 'x'}], rows: []},
  {name: 'Long'.repeat(20), columns: [{title: 'x'}], rows: []},
  {name: 'LONG'.repeat(20), columns: [{title: 'x'}], rows: []},
  {name: "'''\u0000", columns: [{title: 'x'}], rows: []},
  {name: 'History', columns: [{title: 'x'}], rows: []},
]})).get('xl/workbook.xml');
const sheetNames = [...names.matchAll(/<sheet name="([^"]+)"/g)].map(match => match[1]);
assert(sheetNames.every(name => name.length <= 31 && !/[\\/?*\[\]:]/.test(name) && !name.startsWith("'") && !name.endsWith("'")));
assert.equal(new Set(sheetNames.map(name => name.toLowerCase())).size, sheetNames.length);
assert(sheetNames[3].endsWith(' (2)'));
assert.equal(sheetNames[4], 'Sheet 5'); assert.equal(sheetNames[5], 'History_');

const invalid = [
  null, {}, {sheets: []}, {sheets: [null]}, tiny([[]]), tiny([['a', 'extra']]), tiny([null]),
  tiny([[undefined]]), tiny([[true]]), tiny([[{}]]), tiny([[NaN]]), tiny([[Infinity]]), tiny([[-Infinity]]),
  tiny([['85']], [{title: '分数', type: 'number'}]), tiny([[1]], [{title: '分数', type: 'date'}]),
  tiny([[1]], [{title: '分数', type: 'number', format: '0.00'}]), tiny([[1]], [{title: '文本', format: '0'}]),
  tiny([['a']], [{title: '文本', width: NaN}]), tiny([['a']], [{title: '文本', width: 0}]), tiny([['a']], [{title: '文本', width: 256}]),
  tiny([], []), tiny([], Array(16385).fill({title: 'x'})), tiny(Array(1048576)),
];
for (const value of invalid) assert.throws(() => createXlsxWorkbook(value), /invalid_/);
const wide = unzip(createXlsxWorkbook(tiny([Array(27).fill(null)], Array.from({length: 27}, (_, index) => ({title: '列' + index})))))
  .get('xl/worksheets/sheet1.xml');
assert(wide.includes('ref="A1:AA2"') && wide.includes('r="AA2"'));
const empty = unzip(createXlsxWorkbook(tiny([]))).get('xl/worksheets/sheet1.xml');
assert(empty.includes('<autoFilter ref="A1:A1"/>'));

const output = path.join(artifacts, 'synthetic-score-export.xlsx');
await writeFile(output, bytes, {flag: 'wx', mode: 0o600});
const result = {ok: true, zipCrcAndOffsets: true, xmlEscaping: true, formulaTextOnly: true, zeroAndNullDistinct: true,
  scoresOneDecimalAndCountsInteger: true, unicodeAndCellLimit: true, uniqueSafeSheetNames: true,
  freezeFilterAndWidths: true, deterministicAndInputPreserved: true, invalidCasesRejected: invalid.length,
  realBusinessData: false, externalRequests: 0, bytes: bytes.length, artifacts, workbook: output};
await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2), {flag: 'wx', mode: 0o600});
console.log(JSON.stringify(result));
