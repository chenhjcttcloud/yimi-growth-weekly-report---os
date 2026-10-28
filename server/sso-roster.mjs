// Called only after Feishu has verified the authorization code and user identity.
export function createSsoRoster({query,exec,sql,getJson,registerIdentity=async()=>{}}) {
  return async function syncLogin(identity,token) {
    if(!identity.userId || !identity.name)throw Error('invalid_sso_identity');
    let profile={},department='',note='';
    try {
      const response=await getJson(`/open-apis/contact/v3/users/${encodeURIComponent(identity.userId)}?user_id_type=user_id&department_id_type=open_department_id`,{method:'GET',token});
      profile=response.data?.user||{};
      if(profile.user_id && profile.user_id!==identity.userId)throw Error('identity_mismatch');
      const departments=await Promise.all((profile.department_ids||[]).map(async id=>{
        const result=await getJson(`/open-apis/contact/v3/departments/${encodeURIComponent(id)}?department_id_type=open_department_id&user_id_type=user_id`,{method:'GET',token});
        return result.data?.department?.name||'';
      }));
      department=departments.filter(Boolean).join(' / ');
    } catch(error) {if(error.message==='identity_mismatch')throw error;note='通讯录信息未完整同步，请检查飞书通讯录权限和可见范围。';}
    await registerIdentity({userId:identity.userId,openId:profile.open_id||identity.feishuOpenId||'',unionId:profile.union_id||identity.unionId||''});
    await exec(`BEGIN;
      INSERT INTO employees(user_id,name,department,email,manager_user_id,is_active,updated_at)
      VALUES(${sql(identity.userId)},${sql(identity.name)},${sql(department)},${sql(identity.email||profile.email||profile.enterprise_email||'')},${sql(profile.leader_user_id||'')},1,datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,
        department=CASE WHEN excluded.department<>'' THEN excluded.department ELSE employees.department END,
        email=CASE WHEN excluded.email<>'' THEN excluded.email ELSE employees.email END,
        manager_user_id=CASE WHEN excluded.manager_user_id<>'' THEN excluded.manager_user_id ELSE employees.manager_user_id END,
        updated_at=datetime('now');
      INSERT INTO employee_sso_logins(user_id,last_login_at,sync_note) VALUES(${sql(identity.userId)},datetime('now'),${sql(note)})
      ON CONFLICT(user_id) DO UPDATE SET last_login_at=excluded.last_login_at,sync_note=excluded.sync_note;
      COMMIT;`);
    const employee=(await query(`SELECT * FROM employees WHERE user_id=${sql(identity.userId)};`))[0];
    return {employee,active:Number(employee?.is_active)===1};
  };
}
