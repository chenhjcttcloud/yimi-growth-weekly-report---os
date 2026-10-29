import type {ReportPeriod} from './types';

// Shell metadata is independent of the historical reports/AI module. Only
// management pages that use those records import that larger module later.
const response: Record<string, any> = await fetch('/api/management-data?view=bootstrap').then(r => r.ok ? r.json() : {}).catch(() => ({}));
const meta = response.prototypeData?.meta || {};
const text = (value: unknown) => String(value ?? '');
function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed=value.trim(); if (!trimmed) return [];
    try { const parsed=JSON.parse(trimmed.replaceAll("'",'"')); return Array.isArray(parsed)?parsed:[trimmed]; }
    catch { return trimmed.split(/[;\n]/).map(item=>item.trim()).filter(Boolean); }
  }
  return value?[value]:[];
}
const periods: ReportPeriod[] = (meta.periods || []).map((row: Record<string, any>) => ({
  id: text(row.id), label: text(row.label), range: text(row.range),
  start: text(row.start), end: text(row.end),
  submittedCount: Number(row.submitted_count ?? row.submittedCount ?? 0),
  exemptPeople: list(row.exempt_people ?? row.exemptPeople).map(text),
  status: text(row.status),
}));
const latest = periods.at(-1);
const fallback = !text(meta.current_week_id) && latest;
export const bootstrapData = {
  generatedOn: text(meta.generated_on), periods,
  currentWeekId: fallback ? fallback.id : text(meta.current_week_id),
  currentWeekLabel: fallback ? fallback.label : text(meta.current_week_label),
  currentWeekRange: fallback ? fallback.range : text(meta.current_week_range),
};
