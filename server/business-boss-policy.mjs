import {createHash, randomUUID} from 'node:crypto';

const SETTING_KEY = 'business_boss_members';
const EXCLUSION_ACTION = '业务老板：安全排除未答70%互评关系';
const digest = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);

function normalizeMembers(value, fallback = false) {
  if (!Array.isArray(value) || value.length > 100 || (!fallback && !value.length)) throw Error('invalid_business_boss_members');
  const seen = new Set(), members = [];
  for (const member of value) {
    if (fallback && !member?.userId) continue; // Names alone never establish a business identity.
    if (!member || typeof member !== 'object' || Array.isArray(member) || !validId(member.userId) || seen.has(member.userId)) throw Error('invalid_business_boss_members');
    if (member.name !== undefined && (typeof member.name !== 'string' || member.name.length > 256)) throw Error('invalid_business_boss_members');
    seen.add(member.userId);
    members.push(Object.freeze({userId: member.userId, name: member.name || ''}));
  }
  return Object.freeze(members.sort((a, b) => a.userId.localeCompare(b.userId, 'en')));
}

function normalizeScope(options, currentIds) {
  if (!options || !Array.isArray(options.months) || !options.months.length || options.months.length > 120 || options.months.some(month => typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(month))) throw Error('invalid_business_boss_months');
  if (!Array.isArray(options.businessBossUserIds) || !options.businessBossUserIds.length || options.businessBossUserIds.length > 100 || options.businessBossUserIds.some(id => !validId(id) || !currentIds.has(id))) throw Error('invalid_business_boss_scope');
  return {months: [...new Set(options.months)].sort(), businessBossUserIds: [...new Set(options.businessBossUserIds)].sort()};
}

/**
 * Business identity is independent of boss-view authorization. This module
 * never saves settings, changes templates, submits a score or sends a message.
 * The compatibility fallback is observable and cannot authorize an exclusion.
 */
export function createBusinessBossPolicy({query, exec, sql, fallbackMembers = () => [], now = () => new Date()}) {
  let current = null, invalid = null, busy = false;
  function install(members, source) {
    const ids = new Set(members.map(member => member.userId));
    current = {ids, snapshot: Object.freeze({source, configured: source === 'explicit', members, userIds: Object.freeze([...ids])})};
    invalid = null;
    return current.snapshot;
  }
  function state() {
    if (invalid) throw invalid;
    if (!current || current.snapshot.source === 'boss-view-fallback') install(normalizeMembers(fallbackMembers(), true), 'boss-view-fallback');
    return current.snapshot;
  }
  async function readConfiguration() {
    const rows = await query(`SELECT value_json FROM app_settings WHERE key=${sql(SETTING_KEY)};`);
    if (!rows.length) return {raw: null, members: normalizeMembers(fallbackMembers(), true), source: 'boss-view-fallback'};
    let parsed;
    try { parsed = JSON.parse(rows[0].value_json); } catch { throw Error('invalid_business_boss_members'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('invalid_business_boss_members');
    const members = normalizeMembers(parsed.members);
    const registered = new Set((await query(`SELECT user_id FROM employees WHERE user_id IN (${members.map(member => sql(member.userId)).join(',')});`)).map(row => row.user_id));
    if (members.some(member => !registered.has(member.userId))) throw Error('business_boss_employee_not_found');
    return {raw: rows[0].value_json, members, source: 'explicit'};
  }
  async function load() {
    try { const config = await readConfiguration(); return install(config.members, config.source); }
    catch (error) { invalid = error; throw error; }
  }
  function selection(scope) {
    return `SELECT a.id AS assignment_id,a.cycle_id,substr(c.start_date,1,7) AS month,a.evaluee_user_id,a.evaluator_user_id,COALESCE(a.status,'active') AS status,
      (SELECT COUNT(*) FROM scoring360_responses r WHERE r.assignment_id=a.id) AS response_count,
      ((SELECT COUNT(*) FROM all_monthly_weighted_results w WHERE w.month=substr(c.start_date,1,7) AND w.employee_user_id=a.evaluee_user_id)
       +(SELECT COUNT(*) FROM performance_results p WHERE p.month=substr(c.start_date,1,7) AND p.employee_user_id=a.evaluee_user_id AND p.kind='collaboration')) AS published_count
      FROM scoring360_assignments a JOIN scoring360_cycles c ON c.id=a.cycle_id
      WHERE substr(c.start_date,1,7) IN (${scope.months.map(sql).join(',')}) AND a.evaluator_user_id IN (${scope.businessBossUserIds.map(sql).join(',')}) ORDER BY a.id`;
  }
  function fingerprint(scope) {
    return `SELECT COALESCE(json_group_array(json_array(assignment_id,cycle_id,month,evaluee_user_id,evaluator_user_id,status,response_count,published_count)),'[]') FROM (${selection(scope)})`;
  }
  async function buildPlan(options) {
    let config;
    try { config = await readConfiguration(); }
    catch (error) { invalid = error; throw error; }
    install(config.members, config.source);
    const scope = normalizeScope(options, current.ids);
    const rawSignature = (await query(`SELECT (${fingerprint(scope)}) AS signature;`))[0]?.signature;
    if (typeof rawSignature !== 'string') throw Error('business_boss_plan_unavailable');
    const tuples = JSON.parse(rawSignature), candidates = [], blocked = [];
    const counts = {matched: tuples.length, eligible: 0, alreadyInactive: 0, blocked: 0, blockedAnswered: 0, blockedPublished: 0};
    for (const [assignmentId, cycleId, month, evalueeUserId, businessBossUserId, status, responseCount, publishedCount] of tuples) {
      if (status !== 'active') { counts.alreadyInactive++; continue; }
      const entry = {assignmentId, cycleId, month, evalueeUserId, businessBossUserId};
      const reasons = [...(Number(responseCount) ? ['answered'] : []), ...(Number(publishedCount) ? ['published'] : [])];
      if (reasons.length) {
        blocked.push({...entry, reasons}); counts.blocked++;
        if (Number(responseCount)) counts.blockedAnswered++;
        if (Number(publishedCount)) counts.blockedPublished++;
      } else { candidates.push(entry); counts.eligible++; }
    }
    const planSha256 = digest(JSON.stringify({version: 1, source: config.source, setting: config.raw, ...scope, rawSignature}));
    return {config, scope, rawSignature, plan: {source: config.source, ...scope, planSha256, counts, candidates, blocked}};
  }
  async function planExclusion(options) { return (await buildPlan(options)).plan; }
  async function previousApply(auditId) {
    const rows = await query(`SELECT details_json FROM system_operation_logs WHERE id=${sql(auditId)} AND action=${sql(EXCLUSION_ACTION)};`);
    return rows.length ? JSON.parse(rows[0].details_json) : null;
  }
  async function applyExclusion(options) {
    if (options?.confirm !== true || !/^[a-f0-9]{64}$/u.test(options?.expectedPlanSha256 || '') || !validId(options?.actor?.userId)) throw Error('business_boss_exclusion_confirmation_required');
    if (busy) throw Error('business_boss_exclusion_busy');
    busy = true;
    try {
      const {config, scope, rawSignature, plan} = await buildPlan(options);
      if (config.source !== 'explicit') throw Error('explicit_business_boss_configuration_required');
      const auditId = `business-boss-peer-exclusion:${options.expectedPlanSha256}`;
      const prior = await previousApply(auditId);
      if (prior) return {applied: 0, alreadyApplied: true, auditId, counts: prior.counts};
      if (plan.planSha256 !== options.expectedPlanSha256) throw Error('business_boss_exclusion_plan_changed');
      if (!plan.candidates.length) return {applied: 0, alreadyApplied: false, auditId: null, counts: plan.counts};
      const invocationId = randomUUID(), createdAt = now().toISOString();
      const details = {version: 1, invocationId, source: 'explicit', ...scope, planSha256: plan.planSha256, counts: plan.counts, assignmentIds: plan.candidates.map(row => row.assignmentId)};
      const unchanged = `EXISTS(SELECT 1 FROM app_settings WHERE key=${sql(SETTING_KEY)} AND value_json=${sql(config.raw)}) AND (${fingerprint(scope)})=${sql(rawSignature)}`;
      const owned = `EXISTS(SELECT 1 FROM system_operation_logs WHERE id=${sql(auditId)} AND details_json=${sql(JSON.stringify(details))})`;
      const candidateIds = plan.candidates.map(row => sql(row.assignmentId)).join(',');
      // BEGIN IMMEDIATE and the fingerprint protect the reviewed scope from a
      // response, publication, relationship or configuration race. The UPDATE
      // independently repeats the no-response/no-publication checks.
      await exec(`BEGIN IMMEDIATE;
        INSERT INTO system_operation_logs(id,actor_user_id,actor_name,action,details_json,created_at)
        SELECT ${sql(auditId)},${sql(options.actor.userId)},${sql(typeof options.actor.name === 'string' ? options.actor.name : '')},${sql(EXCLUSION_ACTION)},${sql(JSON.stringify(details))},${sql(createdAt)} WHERE ${unchanged};
        UPDATE scoring360_assignments SET status='inactive',updated_at=${sql(createdAt)}
        WHERE id IN (${candidateIds}) AND COALESCE(status,'active')='active' AND ${owned}
          AND NOT EXISTS(SELECT 1 FROM scoring360_responses r WHERE r.assignment_id=scoring360_assignments.id)
          AND NOT EXISTS(SELECT 1 FROM scoring360_cycles c JOIN all_monthly_weighted_results w ON w.month=substr(c.start_date,1,7) WHERE c.id=scoring360_assignments.cycle_id AND w.employee_user_id=scoring360_assignments.evaluee_user_id)
          AND NOT EXISTS(SELECT 1 FROM scoring360_cycles c JOIN performance_results p ON p.month=substr(c.start_date,1,7) WHERE c.id=scoring360_assignments.cycle_id AND p.employee_user_id=scoring360_assignments.evaluee_user_id AND p.kind='collaboration');
        COMMIT;`);
      const applied = await previousApply(auditId);
      if (!applied) throw Error('business_boss_exclusion_plan_changed');
      return {applied: applied.invocationId === invocationId ? applied.assignmentIds.length : 0, alreadyApplied: applied.invocationId !== invocationId, auditId, counts: applied.counts};
    } finally { busy = false; }
  }
  return Object.freeze({load, state, members: () => state().members, isBusinessBoss: id => { state(); return current.ids.has(id); }, planExclusion, applyExclusion});
}
