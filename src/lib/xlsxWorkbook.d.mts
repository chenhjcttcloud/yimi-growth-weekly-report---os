export type XlsxCell = string | number | null;
export interface XlsxColumn {
  title: string;
  /** Excel character-width units, greater than 0 and at most 255. */
  width?: number;
  /** Defaults to text. Number columns require finite numbers or null. */
  type?: 'text' | 'number';
  /** Number columns only; defaults to 0.0. Use 0 for integer counts. */
  format?: '0' | '0.0';
}
export interface XlsxSheet {
  /** Invalid characters are removed/replaced; names are limited to 31 UTF-16 units and made unique. */
  name: string;
  columns: readonly XlsxColumn[];
  rows: readonly (readonly XlsxCell[])[];
}
export interface XlsxWorkbookOptions {
  sheets: readonly XlsxSheet[];
}
/** Creates an XLSX ZIP as bytes, without downloading, network access or formulas. */
export function createXlsxWorkbook(options: XlsxWorkbookOptions): Uint8Array<ArrayBuffer>;
