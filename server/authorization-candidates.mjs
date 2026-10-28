// Authorization candidates are separate from the employee roster. A department
// leader can be authorized before SSO without entering report/scoring statistics.
export function createAuthorizationCandidates({query, profile}) {
  async function leaders() {
    const rows = await query(`SELECT l.leader_name,l.raw_json,d.name AS department_name
      FROM feishu_department_links l LEFT JOIN organization_departments d ON d.id=l.department_id;`);
    const result = new Map();
    for (const row of rows) {
      let raw;
      try {raw = JSON.parse(row.raw_json || '{}');} catch {continue;}
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const userId = String(raw.leader_user_id || '').trim(), name = String(row.leader_name || '').trim();
      if (!userId || userId.startsWith('ou_') || !name) continue;
      const department = String(row.department_name || raw.name || '').trim();
      const previous = result.get(userId), departments = new Set([...(previous?.departments || []),department].filter(Boolean));
      result.set(userId,{userId,name,departments:[...departments],department:[...departments].join(' / '),active:true,authorizationOnly:true,source:'feishu_department'});
    }
    return [...result.values()].map(({departments,...person})=>person);
  }

  async function list(employees) {
    const roster = new Set(employees.map(employee=>employee.userId));
    return [
      ...employees.filter(employee=>employee.active && employee.userId),
      ...(await leaders()).filter(person=>!roster.has(person.userId)),
    ].sort((left,right)=>(left.name||left.userId).localeCompare(right.name||right.userId,'zh-CN'));
  }

  async function validate(members, previousMembers) {
    const previous = new Set(previousMembers.map(member=>member.userId || `legacy:${member.name}`));
    const employees = new Map((await query('SELECT user_id,name,department,is_active FROM employees;')).map(employee=>[employee.user_id,employee]));
    const candidates = new Map((await leaders()).map(person=>[person.userId,person]));
    const result = [];
    for (const member of members) {
      if (previous.has(member.userId || `legacy:${member.name}`)) {result.push(member); continue;}
      const employee = employees.get(member.userId);
      if (employee) {
        if (Number(employee.is_active) !== 1) throw Error('authorization_candidate_inactive');
        result.push({userId:employee.user_id,name:employee.name,department:employee.department||''});
        continue;
      }
      const candidate = candidates.get(member.userId);
      if (!candidate) throw Error('authorization_candidate_not_found');
      let current;
      try {current = await profile(candidate.userId);} catch {throw Error('authorization_candidate_unavailable');}
      if (current?.user_id !== candidate.userId) throw Error('authorization_candidate_unavailable');
      if (['is_resigned','is_frozen','is_unjoined'].some(key=>current.status?.[key] === true)) throw Error('authorization_candidate_inactive');
      // Some app scopes expose only user_id. The name remains bound to the exact
      // ID from the previous Feishu department sync; never use the form's name.
      result.push({userId:candidate.userId,name:String(current.name||'').trim()||candidate.name,department:candidate.department});
    }
    return result;
  }
  return {list,validate};
}
