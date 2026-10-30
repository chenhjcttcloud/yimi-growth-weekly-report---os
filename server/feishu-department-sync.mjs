import {randomUUID} from 'node:crypto';
export function createFeishuDepartmentSync({query,exec,sql,config,fetcher=fetch}){
 let running=false;
 async function sync(){
  if(running)throw Error('department_sync_running');running=true;
  try{
   if(!config.feishuAppId||!config.feishuAppSecret)throw Error('feishu_not_configured');
   const call=async(path,options={})=>{const r=await fetcher('https://open.feishu.cn/open-apis'+path,{...options,signal:AbortSignal.timeout(30000)});const v=await r.json();if(!r.ok||v.code!==0)throw Object.assign(Error(v.code===99991672?'department_permission_required':v.code===40004?'department_scope_required':'department_upstream_failed'),{feishuCode:v.code,httpStatus:r.status});return v;};
   const token=await call('/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:config.feishuAppId,app_secret:config.feishuAppSecret})});
   const received=[];let page='';const seen=new Set();
   while(true){const params=new URLSearchParams({department_id_type:'open_department_id',user_id_type:'user_id',page_size:'50',fetch_child:'true',...(page?{page_token:page}:{})});const v=await call('/contact/v3/departments/0/children?'+params,{headers:{authorization:'Bearer '+token.tenant_access_token}});if(!Array.isArray(v.data?.items))throw Error('department_upstream_failed');received.push(...v.data.items);if(!v.data?.has_more)break;page=v.data.page_token;if(!page||seen.has(page)||seen.size>=1000)throw Error('department_invalid_pagination');seen.add(page);}
   const items=received.filter(d=>d?.status?.is_deleted!==true);
   if(received.some(d=>!d||typeof d.open_department_id!=='string'||!d.open_department_id)||new Set(received.map(d=>d.open_department_id)).size!==received.length)throw Error('department_ambiguous_names');
   if(items.some(d=>!d.open_department_id||!String(d.name||'').trim()))throw Error('department_names_permission_required');
   if(items.some(d=>d.leader_user_id!=null&&(typeof d.leader_user_id!=='string'||d.leader_user_id.startsWith('ou_'))))throw Error('department_leader_user_id_required');
   if(new Set(items.map(d=>d.open_department_id)).size!==items.length||new Set(items.map(d=>d.name.trim())).size!==items.length)throw Error('department_ambiguous_names');
   const external=new Map(items.map(d=>[d.open_department_id,d]));
   for(const d of items){const visited=new Set([d.open_department_id]);let p=d.parent_department_id;while(p&&p!=='0'){if(visited.has(p)||!external.has(p))throw Error('department_incomplete_tree');visited.add(p);p=external.get(p).parent_department_id;}}
   const local=await query('SELECT id,name FROM organization_departments;'),links=await query('SELECT open_department_id,department_id,aliases_json,leader_name,raw_json FROM feishu_department_links;');
   const states=await query('SELECT * FROM feishu_department_sync_states;'),stateById=new Map(states.map(row=>[row.department_id,row]));
   if(!items.length&&!links.length)throw Error('department_scope_empty');
   const confirmedRemoved=new Map(received.filter(d=>d.status?.is_deleted===true).map(d=>[d.open_department_id,'feishu_deleted']));
   const missing=links.filter(link=>!external.has(link.open_department_id)&&!confirmedRemoved.has(link.open_department_id));
   let cursor=0,unverifiedMissing=0;
   // List omission may be a permissions change. Confirm against the same
   // globally unique open_department_id before removing a current department.
   await Promise.all(Array.from({length:Math.min(3,missing.length)},async()=>{
    while(cursor<missing.length){const link=missing[cursor++];
     try{
      const params=new URLSearchParams({department_id_type:'open_department_id',user_id_type:'user_id'});
      const value=await call('/contact/v3/departments/'+encodeURIComponent(link.open_department_id)+'?'+params,{headers:{authorization:'Bearer '+token.tenant_access_token}});
      const department=value.data?.department;
      if(department?.open_department_id===link.open_department_id&&department.status?.is_deleted===true)confirmedRemoved.set(link.open_department_id,'feishu_deleted');
      else unverifiedMissing++;
     }catch(error){
      if(error.feishuCode===40015&&[200,400,404].includes(error.httpStatus))confirmedRemoved.set(link.open_department_id,'department_not_found');
      else unverifiedMissing++;
     }
    }
   }));
   const identities=new Map();
   // Keep previously verified names tied to their exact user_id. A transient
   // profile-permission failure must not erase a known leader's display name.
   for(const link of links){const leader=JSON.parse(link.raw_json||'{}').leader_user_id;if(leader&&link.leader_name)identities.set(leader,link.leader_name);}
   for(const row of await query("SELECT value_json FROM app_settings WHERE key IN ('identity_name_cache','boss_view_members','scoring360_admin_members');"))for(const m of JSON.parse(row.value_json).members||[])if(m.userId&&m.name)identities.set(m.userId,m.name);
   for(const employee of await query('SELECT user_id,name FROM employees;'))if(employee.user_id&&employee.name)identities.set(employee.user_id,employee.name);
   // A department leader may not have logged in yet. Read their Feishu name by
   // user_id without creating or reactivating a roster account.
   const leaderIds=[...new Set(items.map(d=>d.leader_user_id).filter(Boolean))];
   let leaderProfileFailures=0;
   await Promise.all(leaderIds.map(async id=>{
    try{
     const params=new URLSearchParams({user_id_type:'user_id',department_id_type:'open_department_id'});
     const value=await call('/contact/v3/users/'+encodeURIComponent(id)+'?'+params,{headers:{authorization:'Bearer '+token.tenant_access_token}});
     const user=value.data?.user;
     if(user?.user_id!==id||!String(user.name||'').trim())throw Error('leader_profile_unavailable');
     identities.set(id,user.name.trim());
    }catch{leaderProfileFailures++;}
   }));
   const ids=new Map(items.map(d=>[d.open_department_id,links.find(l=>l.open_department_id===d.open_department_id)?.department_id||local.find(l=>l.name===d.name.trim()&&!links.some(link=>link.department_id===l.id))?.id||randomUUID()]));
    const overrides=new Set((await query('SELECT department_id FROM department_local_settings;')).map(d=>d.department_id));
    const finalParents=new Map((await query('SELECT department_id,parent_id FROM department_hierarchy;')).map(d=>[d.department_id,d.parent_id]));
    for(const d of items){const id=ids.get(d.open_department_id);if(!overrides.has(id)||stateById.get(id)?.state==='deleted')finalParents.set(id,d.parent_department_id&&d.parent_department_id!=='0'?ids.get(d.parent_department_id):'');}
    for(const id of finalParents.keys()){const visited=new Set([id]);let p=finalParents.get(id);while(p){if(visited.has(p))throw Error('department_incomplete_tree');visited.add(p);p=finalParents.get(p);}}
    const statements=['BEGIN IMMEDIATE;'];let created=0,removed=0,restored=0;
    const checkedAt=new Date().toISOString();
    // Retain old IDs and score links. A different Feishu ID reusing a removed
    // name gets a new local ID; a private storage name frees the unique label.
    for(const d of items){const id=ids.get(d.open_department_id),collision=local.find(row=>row.name===d.name.trim()&&row.id!==id);
     if(!collision)continue;
     const oldLink=links.find(link=>link.department_id===collision.id);
     if(!oldLink||(!confirmedRemoved.has(oldLink.open_department_id)&&stateById.get(collision.id)?.state!=='deleted'))throw Error('department_ambiguous_names');
     statements.push(`UPDATE organization_departments SET name=${sql(collision.name+' [历史 '+collision.id+']')} WHERE id=${sql(collision.id)};`);
    }
    for(const link of links){const reason=confirmedRemoved.get(link.open_department_id);if(!reason)continue;
     if(stateById.get(link.department_id)?.state!=='deleted')removed++;
     const name=stateById.get(link.department_id)?.display_name||local.find(row=>row.id===link.department_id)?.name||'';
     statements.push(`INSERT INTO feishu_department_sync_states(department_id,state,reason,checked_at,deleted_at,display_name) VALUES(${sql(link.department_id)},'deleted',${sql(reason)},${sql(checkedAt)},${sql(checkedAt)},COALESCE(${sql(name)},'')) ON CONFLICT(department_id) DO UPDATE SET state='deleted',reason=excluded.reason,checked_at=excluded.checked_at,deleted_at=CASE WHEN feishu_department_sync_states.state='deleted' THEN feishu_department_sync_states.deleted_at ELSE excluded.deleted_at END,display_name=CASE WHEN feishu_department_sync_states.display_name<>'' THEN feishu_department_sync_states.display_name ELSE excluded.display_name END;`);
    }
   for(const d of items){const id=ids.get(d.open_department_id),leader=d.leader_user_id||'',parent=d.parent_department_id&&d.parent_department_id!=='0'?ids.get(d.parent_department_id):'';
     const previousName=local.find(l=>l.id===id)?.name;const aliases=[...new Set([...(JSON.parse(links.find(l=>l.open_department_id===d.open_department_id)?.aliases_json||'[]')),...(previousName&&previousName!==d.name.trim()?[previousName,...(overrides.has(id)?[d.name.trim()]:[])]:[])])];
    if(!local.some(l=>l.id===id))created++;
    if(stateById.get(id)?.state==='deleted')restored++;
    statements.push(`INSERT INTO feishu_department_sync_states(department_id,state,reason,checked_at,deleted_at,display_name) VALUES(${sql(id)},'active','',${sql(checkedAt)},NULL,${sql(d.name.trim())}) ON CONFLICT(department_id) DO UPDATE SET state='active',reason='',checked_at=excluded.checked_at,deleted_at=NULL,display_name=excluded.display_name;`);
     if(!overrides.has(id)||stateById.get(id)?.state==='deleted'){
      statements.push(`INSERT INTO organization_departments(id,name,leader_user_id,updated_at) VALUES(${sql(id)},${sql(d.name.trim())},COALESCE(${sql(leader)},''),datetime('now')) ON CONFLICT(id) DO UPDATE SET name=excluded.name,leader_user_id=excluded.leader_user_id,updated_at=excluded.updated_at;`);
      statements.push(`INSERT INTO department_hierarchy(department_id,parent_id) VALUES(${sql(id)},COALESCE(${sql(parent)},'')) ON CONFLICT(department_id) DO UPDATE SET parent_id=excluded.parent_id;`);
     }else{
      // Local layout edits never override the official Feishu department leader.
      statements.push(`UPDATE organization_departments SET leader_user_id=COALESCE(${sql(leader)},''),updated_at=datetime('now') WHERE id=${sql(id)};`);
     }
    statements.push(`INSERT INTO feishu_department_links(open_department_id,department_id,parent_open_department_id,aliases_json,leader_name,member_count,synced_at,raw_json) VALUES(${sql(d.open_department_id)},${sql(id)},COALESCE(${sql(d.parent_department_id)},''),${sql(JSON.stringify(aliases))},COALESCE(${sql(identities.get(leader)||'')},''),${Number.isInteger(d.member_count)?d.member_count:'NULL'},datetime('now'),${sql(JSON.stringify(d))}) ON CONFLICT(open_department_id) DO UPDATE SET department_id=excluded.department_id,parent_open_department_id=excluded.parent_open_department_id,aliases_json=excluded.aliases_json,leader_name=excluded.leader_name,member_count=excluded.member_count,synced_at=excluded.synced_at,raw_json=excluded.raw_json;`);
   }
   statements.push('COMMIT;');await exec(statements.join('\n'));
   const unresolvedLeaderNames=leaderIds.filter(id=>!identities.get(id)).length;
   return {departmentCount:items.length,created,removed,restored,unverifiedMissing,updated:items.length-created,leaders:items.filter(d=>d.leader_user_id).length,leaderProfileFailures,unresolvedLeaderNames,leaderNamePermissionRequired:unresolvedLeaderNames>0,syncedAt:new Date().toISOString()};
  }finally{running=false;}
 }
 return {sync};
}
