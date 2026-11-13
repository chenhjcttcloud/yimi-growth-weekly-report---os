const approvalPrefix = 'weekly_on_time_approval:';

export function weeklyOnTimeApprovalKey(employeeUserId, weekEnd) {
  return approvalPrefix + weekEnd + ':' + employeeUserId;
}

export async function readWeeklyOnTimeApprovals({ query, sql, month, employeeUserId }) {
  const prefix = approvalPrefix + (month ? month + '-' : '');
  const employeeScope = employeeUserId
    ? ` AND substr(key,${approvalPrefix.length + 12})=${sql(employeeUserId)}`
    : '';
  const rows = await query(`SELECT key FROM app_settings WHERE key GLOB ${sql(prefix + '*')}${employeeScope};`);
  const keys = new Set(rows.map(row => row.key));
  return (id, weekEnd) => keys.has(weeklyOnTimeApprovalKey(id, weekEnd));
}

export function isEligibleOnTimeApproval(status, submittedAt) {
  return Number.isFinite(submittedAt)
    && !['未交', '未提交', '未汇报', '免交', '无效', '重复', 'invalid', 'duplicate', 'void'].includes(String(status || '').toLowerCase());
}
