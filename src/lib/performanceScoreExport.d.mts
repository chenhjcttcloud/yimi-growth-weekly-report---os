import type {XlsxSheet} from './xlsxWorkbook.mjs';
export type PerformanceScoreExportKind = 'quality' | 'collaboration' | 'all';
export interface PerformanceScoreExportOptions {
  kind: PerformanceScoreExportKind;
  month: string;
  rows: readonly {userId: string; month: string; name: string; [key: string]: any}[];
  results: readonly {month: string; employee_user_id: string; kind: string; [key: string]: any}[];
  /** All matching employee IDs, before directory pagination. */
  employeeUserIds: readonly string[];
  department?: string;
  query?: string;
}
export function buildPerformanceScoreExport(options: PerformanceScoreExportOptions): {fileName: string; sheets: XlsxSheet[]; employeeCount: number};
