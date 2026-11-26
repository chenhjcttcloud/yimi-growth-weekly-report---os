const archiveTable = 'historical_report_archives';
const headerColumns = 'id,source_report_id,employee_name,department,week_label,week_start,week_end,submitted_at,status,content_json,archived_at';
const text = value => typeof value === 'string' ? value : '';
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const monthPattern = /^\d{4}-(?:0[1-9]|1[0-2])$/;

function score(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function objectJson(value, errorCode) {
  try {
    const parsed = JSON.parse(value);
    if (plainObject(parsed)) return parsed;
  } catch {}
  throw Error(errorCode);
}

function header(row, content) {
  return {
    id: text(row.id),
    employeeName: text(row.employee_name),
    department: text(row.department),
    weekLabel: text(row.week_label),
    weekStart: text(row.week_start),
    weekEnd: text(row.week_end),
    month: text(row.week_end).slice(0, 7),
    submittedAt: text(row.submitted_at),
    status: text(row.status),
    oldScore: score(content['总分']),
    sourceSummary: {
      system: 'reportos',
      reportId: text(row.source_report_id),
      archivedAt: text(row.archived_at),
    },
  };
}

function scope(options, sql) {
  if (!plainObject(options)) throw Error('historical_archive_scope_required');
  const userId = options.employeeUserId;
  if (userId !== undefined && (typeof userId !== 'string' || !userId || userId !== userId.trim() || userId.length > 200)) {
    throw Error('historical_archive_scope_required');
  }
  if (userId) return [`employee_user_id=${sql(userId)}`];
  if (options.management === true) return [];
  throw Error('historical_archive_scope_required');
}

function pagination(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))) throw Error('invalid_historical_archive_pagination');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw Error('invalid_historical_archive_pagination');
  return number;
}

function missingArchiveTable(error) {
  return /\bno such table:\s*(?:main\.)?historical_report_archives(?:\s|$)/i.test(text(error?.message));
}

// Scope is set by the authenticated route. No request object, write capability,
// live-report reader, performance calculation, AI client, or sender is accepted.
export function createHistoricalReportArchive({query, sql}) {
  if (typeof query !== 'function' || typeof sql !== 'function') throw Error('historical_archive_reader_required');
  const where = conditions => conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

  async function list(options = {}) {
    const employeeScope = scope(options, sql);
    const conditions = [...employeeScope];
    if (options.month !== undefined) {
      if (typeof options.month !== 'string' || !monthPattern.test(options.month)) throw Error('invalid_historical_archive_month');
      conditions.push(`substr(week_end,1,7)=${sql(options.month)}`);
    }
    const limit = pagination(options.limit, 50, 100);
    const offset = pagination(options.offset, 0, 1_000_000);
    if (!limit) throw Error('invalid_historical_archive_pagination');
    const empty = {items: [], total: 0, months: [], limit, offset, readOnly: true, affectsPerformance: false};
    let rows, totals, periods;
    try {
      totals = await query(`SELECT COUNT(*) AS total FROM ${archiveTable}${where(conditions)};`);
      rows = await query(`SELECT ${headerColumns} FROM ${archiveTable}${where(conditions)} ORDER BY week_end DESC,submitted_at DESC,id ASC LIMIT ${limit} OFFSET ${offset};`);
      periods = await query(`SELECT DISTINCT substr(week_end,1,7) AS month FROM ${archiveTable}${where(employeeScope)} ORDER BY month DESC;`);
    } catch (error) {
      if (missingArchiveTable(error)) return empty;
      throw error;
    }
    return {
      items: rows.map(row => header(row, objectJson(row.content_json, 'historical_archive_content_invalid'))),
      total: Number(totals[0]?.total || 0),
      months: periods.map(row => text(row.month)).filter(month => monthPattern.test(month)),
      limit, offset, readOnly: true, affectsPerformance: false,
    };
  }

  async function detail(id, options = {}) {
    const conditions = scope(options, sql);
    if (typeof id !== 'string' || !id || id !== id.trim() || id.length > 300) throw Error('invalid_historical_archive_id');
    conditions.push(`id=${sql(id)}`);
    let rows;
    try {
      rows = await query(`SELECT ${headerColumns},recovered_json FROM ${archiveTable}${where(conditions)} LIMIT 1;`);
    } catch (error) {
      if (missingArchiveTable(error)) return null;
      throw error;
    }
    const row = rows[0];
    if (!row) return null;
    const content = objectJson(row.content_json, 'historical_archive_content_invalid');
    const recovered = objectJson(row.recovered_json, 'historical_archive_recovery_invalid');
    const reflection = plainObject(recovered.reflection) ? recovered.reflection : null;
    return {
      ...header(row, content),
      facts: {
        results: text(content['本周成果摘要']),
        problems: text(content['问题摘要']),
        nextPlan: text(content['下周计划摘要']),
        reflection: text(content['思考与复盘摘要']),
      },
      legacyScores: {
        results: score(content['成果分']), problems: score(content['问题分']),
        nextPlan: score(content['计划分']), reflection: score(content['复盘分']),
        total: score(content['总分']), onTime: score(content['准时分']), grade: text(content['等级']),
      },
      recoveredReflection: reflection && text(reflection.text).trim() ? {
        text: text(reflection.text), source: text(reflection.source), reason: text(reflection.reason),
      } : null,
      readOnly: true,
      affectsPerformance: false,
    };
  }

  return {list, detail};
}
