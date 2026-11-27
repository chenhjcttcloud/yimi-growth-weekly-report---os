// Minimal OOXML/ZIP32 writer: stored entries, inline strings, no formulas or links.
const encoder = new TextEncoder();
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAX_ZIP32 = 0xffffffff;
const crcTable = Uint32Array.from({length: 256}, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function cleanText(value, limit = 32767) {
  let result = '';
  for (const character of String(value)) {
    const code = character.codePointAt(0);
    if (!(code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000)) continue;
    if (result.length + character.length > limit) break;
    result += character;
  }
  return result;
}
const escapeXml = value => value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[character]));
// Escape literal OOXML string-escape sequences before Excel decodes them.
const textXml = value => escapeXml(cleanText(value).replace(/_x[0-9a-f]{4}_/gi, match => '_x005F_' + match.slice(1))).replace(/\r/g, '&#13;');

function sheetNames(sheets) {
  const used = new Set();
  return sheets.map((sheet, index) => {
    if (!sheet || typeof sheet.name !== 'string') throw Error('invalid_sheet_name');
    let base = cleanText(sheet.name, Number.MAX_SAFE_INTEGER).replace(/[\\/?*\[\]:\t\r\n]/g, ' ').trim().replace(/^'+|'+$/g, '').trim();
    base = cleanText(base, 31).replace(/'+$/g, '').trim() || 'Sheet ' + (index + 1);
    if (base.toLowerCase() === 'history') base = 'History_';
    let name = base, number = 1;
    while (used.has(name.toLowerCase())) {
      const suffix = ' (' + (++number) + ')';
      name = cleanText(base, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function columnName(index) {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}

function widthOf(column, rows, index) {
  if (column.width !== undefined) {
    if (typeof column.width !== 'number' || !Number.isFinite(column.width) || column.width <= 0 || column.width > 255) throw Error('invalid_column_width');
    return column.width;
  }
  const length = value => [...cleanText(value, 100)].reduce((total, character) => total + (character.codePointAt(0) > 255 ? 2 : 1), 0);
  let width = Math.max(column.type === 'number' ? 14 : 12, length(column.title) + 2);
  for (let row = 0; row < Math.min(rows.length, 100); row++) if (rows[row]?.[index] != null) width = Math.max(width, length(rows[row][index]) + 2);
  return Math.min(48, width);
}

function worksheet(sheet, sheetIndex) {
  const {columns, rows} = sheet;
  if (!Array.isArray(columns) || !columns.length || columns.length > 16384) throw Error('invalid_columns');
  if (!Array.isArray(rows) || rows.length > 1048575) throw Error('invalid_rows');
  for (const column of columns) if (!column || typeof column.title !== 'string' || ![undefined, 'text', 'number'].includes(column.type) || ![undefined, '0', '0.0'].includes(column.format) || column.format !== undefined && column.type !== 'number') throw Error('invalid_column');
  const last = columnName(columns.length - 1), dimension = 'A1:' + last + (rows.length + 1);
  const widths = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${widthOf(column, rows, index)}" customWidth="1"/>`).join('');
  const content = ['<row r="1" ht="28" customHeight="1">' + columns.map((column, index) => `<c r="${columnName(index)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${textXml(column.title)}</t></is></c>`).join('') + '</row>'];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex], number = rowIndex + 2;
    if (!Array.isArray(row) || row.length !== columns.length) throw Error(`invalid_row_length:sheet_${sheetIndex + 1}:row_${number}`);
    const cells = [];
    for (let index = 0; index < columns.length; index++) {
      const value = row[index], ref = columnName(index) + number, numeric = columns[index].type === 'number';
      const style = numeric ? columns[index].format === '0' ? 3 : 2 : 0;
      if (value === null) cells.push(`<c r="${ref}" s="${style}"/>`);
      else if (typeof value !== 'string' && typeof value !== 'number' || typeof value === 'number' && !Number.isFinite(value) || numeric && typeof value !== 'number') throw Error(`invalid_cell_value:sheet_${sheetIndex + 1}:row_${number}:column_${index + 1}`);
      else if (numeric) cells.push(`<c r="${ref}" s="${style}"><v>${value}</v></c>`);
      else cells.push(`<c r="${ref}" t="inlineStr" s="0"><is><t xml:space="preserve">${textXml(value)}</t></is></c>`);
    }
    content.push(`<row r="${number}">${cells.join('')}</row>`);
  }
  return XML + `<worksheet xmlns="${MAIN}"><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols><sheetData>${content.join('')}</sheetData><autoFilter ref="${dimension}"/></worksheet>`;
}

const STYLES = XML + `<styleSheet xmlns="${MAIN}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
<fonts count="2"><font><sz val="10"/><color rgb="FF1F2937"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F7D55"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/>
</styleSheet>`;

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  if (entries.length > 65535) throw Error('zip32_entry_limit');
  let offset = 0, centralSize = 0;
  const files = entries.map(([path, xml]) => {
    const name = encoder.encode(path), data = encoder.encode(xml);
    if (name.length > 65535 || data.length > MAX_ZIP32) throw Error('zip32_size_limit');
    const file = {name, data, crc: crc32(data), offset};
    offset += 30 + name.length + data.length;
    centralSize += 46 + name.length;
    return file;
  });
  if (offset + centralSize + 22 > MAX_ZIP32) throw Error('zip32_size_limit');
  const bytes = new Uint8Array(offset + centralSize + 22), view = new DataView(bytes.buffer);
  let position = 0;
  const u16 = value => { view.setUint16(position, value, true); position += 2; };
  const u32 = value => { view.setUint32(position, value, true); position += 4; };
  const put = value => { bytes.set(value, position); position += value.length; };
  for (const file of files) {
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(0); u16(33);
    u32(file.crc); u32(file.data.length); u32(file.data.length); u16(file.name.length); u16(0);
    put(file.name); put(file.data);
  }
  for (const file of files) {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(0); u16(33);
    u32(file.crc); u32(file.data.length); u32(file.data.length); u16(file.name.length);
    u16(0); u16(0); u16(0); u16(0); u32(0); u32(file.offset); put(file.name);
  }
  u32(0x06054b50); u16(0); u16(0); u16(files.length); u16(files.length); u32(centralSize); u32(offset); u16(0);
  return bytes;
}

/**
 * Create a deterministic XLSX in browsers or Node without dependencies.
 * Text columns (the default) preserve identifiers as strings. Number columns
 * require finite numbers or null and use 0.0 formatting (or explicit 0).
 * Null stays blank.
 */
export function createXlsxWorkbook(options) {
  if (!options || !Array.isArray(options.sheets) || !options.sheets.length || options.sheets.length > 65530) throw Error('invalid_sheets');
  const sheets = options.sheets, names = sheetNames(sheets);
  const entries = sheets.map((sheet, index) => ['xl/worksheets/sheet' + (index + 1) + '.xml', worksheet(sheet, index)]);
  entries.unshift(
    ['[Content_Types].xml', XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', XML + `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', XML + `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', XML + `<Relationships xmlns="${PACKAGE_REL}">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
  );
  return zip(entries);
}
