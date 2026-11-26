// The publication trigger uses SQLite ROUND/AVG. Their boundary behavior can
// differ from JavaScript and between SQLite versions, so ask the same database
// that will validate the insert. Read the same score sources and expected
// manager scope as the trigger, keeping both averages and the final rounding.
export async function databaseCollaborationScores({query, sql}, candidates) {
  if (!Array.isArray(candidates) || typeof query !== 'function' || typeof sql !== 'function') throw Error('invalid_collaboration_score_basis');
  if (!candidates.length) return [];
  const basis = candidates.map(candidate => {
    const {month, employeeUserId, kind, expectedIds} = candidate;
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month || '') || typeof employeeUserId !== 'string' || !employeeUserId || employeeUserId.trim() !== employeeUserId || employeeUserId.length > 200 ||
        !['boss', 'manager'].includes(kind) || !Array.isArray(expectedIds) || !expectedIds.length || new Set(expectedIds).size !== expectedIds.length ||
        expectedIds.some(id => typeof id !== 'string' || id.trim() !== id || id.length > 200)) throw Error('invalid_collaboration_score_basis');
    return {month, employeeUserId, kind, expectedIds};
  });
  const rows = await query(`WITH score_scope AS (
SELECT CAST(source.key AS INTEGER) AS row_index,
 json_extract(source.value,'$.month') AS month,
 json_extract(source.value,'$.employeeUserId') AS employee_user_id,
 json_extract(source.value,'$.kind') AS manager_kind,
 json_extract(source.value,'$.expectedIds') AS expected_ids
FROM json_each(${sql(JSON.stringify(basis))}) AS source
), score_basis AS (
SELECT scope.row_index,
 (SELECT ROUND(AVG(r.score),1) FROM scoring360_assignments a
 JOIN scoring360_cycles c ON c.id=a.cycle_id JOIN scoring360_responses r ON r.assignment_id=a.id
 WHERE substr(c.start_date,1,7)=scope.month AND a.evaluee_user_id=scope.employee_user_id) AS peer_score,
 CASE scope.manager_kind WHEN 'boss' THEN
 (SELECT ROUND(AVG(score),1) FROM all_department_leader_scores
 WHERE month=scope.month AND leader_user_id=scope.employee_user_id AND department_id IN(SELECT value FROM json_each(scope.expected_ids)))
 ELSE (SELECT ROUND(AVG(score),1) FROM monthly_manager_scores
 WHERE month=scope.month AND employee_user_id=scope.employee_user_id AND evaluator_user_id IN(SELECT value FROM json_each(scope.expected_ids))) END AS manager_score
FROM score_scope AS scope
)
SELECT row_index,peer_score,manager_score,ROUND(peer_score*0.7+manager_score*0.3,1) AS final_score FROM score_basis;`);
  if (rows.length !== candidates.length) throw Error('invalid_collaboration_score_result');
  const seen = new Set();
  return rows.map(row => {
    const index = Number(row.row_index);
    if (row.row_index === '' || row.row_index === null || row.row_index === undefined || !Number.isSafeInteger(index) || index < 0 || index >= candidates.length || seen.has(index)) throw Error('invalid_collaboration_score_result');
    seen.add(index);
    const numeric = key => {
      const value = Number(row[key]);
      if (row[key] === '' || row[key] === null || row[key] === undefined || !Number.isFinite(value) || value < 0 || value > 100) throw Error('invalid_collaboration_score_result');
      return value;
    };
    return {index, peerScore: numeric('peer_score'), managerScore: numeric('manager_score'), score: numeric('final_score')};
  });
}
