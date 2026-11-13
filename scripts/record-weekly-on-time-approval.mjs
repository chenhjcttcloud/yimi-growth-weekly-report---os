import {randomUUID} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {parseArgs} from 'node:util';
import {weeklyOnTimeApprovalKey} from '../server/weekly-on-time-approvals.mjs';

class ApprovalError extends Error {}

function validate(values) {
  if (!values.db || Boolean(values.employee) === Boolean(values['employee-id'])) {
    throw new ApprovalError('请指定已存在的数据库，并在员工姓名与员工 ID 中选择一项。');
  }
  const weekEnd = values['week-end'];
  const date = new Date(weekEnd + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnd) || date.getUTCDay() !== 5 || date.toISOString().slice(0, 10) !== weekEnd) {
    throw new ApprovalError('周次结束日期须为有效的周五，格式为 YYYY-MM-DD。');
  }
  const reason = values.reason?.trim();
  const approvedBy = values.actor?.trim();
  if (!reason || !approvedBy) throw new ApprovalError('请填写延期原因和操作人。');
  if (!lstatSync(values.db, {throwIfNoEntry: false})?.isFile()) {
    throw new ApprovalError('指定路径须为已存在的数据库文件。');
  }
  return {weekEnd, reason, approvedBy};
}

function recordApproval(values) {
  const {weekEnd, reason, approvedBy} = validate(values);
  const apply = values.apply === true;
  const database = new DatabaseSync(values.db, {readOnly: !apply});
  try {
    database.exec(apply ? 'PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;' : 'BEGIN;');
    const employeeColumn = values.employee ? 'name' : 'user_id';
    const employees = database.prepare(
      `SELECT user_id, name FROM employees WHERE ${employeeColumn} = ? AND is_active = 1 LIMIT 2;`
    ).all(values.employee ?? values['employee-id']);
    if (employees.length !== 1) throw new ApprovalError('无法唯一匹配在职员工，请核对姓名或使用员工 ID。');
    const employee = employees[0];
    const employeeUserId = employee.user_id;
    const key = weeklyOnTimeApprovalKey(employeeUserId, weekEnd);
    const existing = database.prepare('SELECT value_json FROM app_settings WHERE key = ?;').get(key);
    let status = 'pending';
    let approval = {employeeUserId, weekEnd, reason, approvedBy};
    if (existing) {
      const saved = JSON.parse(existing.value_json);
      if (saved?.employeeUserId !== employeeUserId || saved.weekEnd !== weekEnd || saved.reason !== reason || saved.approvedBy !== approvedBy) {
        throw new ApprovalError('该员工本周已有不同的延期批准记录。');
      }
      status = 'already_recorded';
      approval = saved;
    } else if (apply) {
      approval.approvedAt = new Date().toISOString();
      database.prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?);')
        .run(key, JSON.stringify(approval), approval.approvedAt);
      database.prepare(
        'INSERT INTO system_operation_logs (id, actor_name, action, details_json, created_at) VALUES (?, ?, ?, ?, ?);'
      ).run(randomUUID(), approvedBy, '批准延期并按准时计入周报统计',
        JSON.stringify({...approval, employeeName: employee.name}), approval.approvedAt);
      status = 'recorded';
    }
    database.exec('COMMIT;');
    return {ok: true, dryRun: !apply, status, employeeName: employee.name, ...approval};
  } finally {
    database.close();
  }
}

try {
  const {values} = parseArgs({options: {
    db: {type: 'string'},
    employee: {type: 'string'},
    'employee-id': {type: 'string'},
    'week-end': {type: 'string'},
    reason: {type: 'string'},
    actor: {type: 'string'},
    apply: {type: 'boolean'},
    help: {type: 'boolean'},
  }});
  if (values.help) {
    console.log('node scripts/record-weekly-on-time-approval.mjs --db FILE (--employee NAME | --employee-id ID) --week-end YYYY-MM-DD --reason REASON --actor ACTOR [--apply]');
  } else {
    console.log(JSON.stringify(recordApproval(values)));
  }
} catch (error) {
  const message = error instanceof ApprovalError || error.code?.startsWith('ERR_PARSE_ARGS_')
    ? error.message : '延期批准登记失败，请检查数据库路径、权限与数据结构。';
  console.error(JSON.stringify({ok: false, error: message}));
  process.exitCode = 1;
}
