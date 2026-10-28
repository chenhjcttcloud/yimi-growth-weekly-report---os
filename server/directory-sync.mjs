export function createDirectorySync({query,exec,sql,config,lifecycle,registerIdentity=async()=>{},fetcher=fetch}) {
  let running=false;
  async function status() {
    const rows=await query("SELECT value_json FROM app_settings WHERE key='employee_directory_sync';");
    let lastSync=null;
    try {lastSync=rows[0]?.value_json?JSON.parse(rows[0].value_json):null;} catch {}
    return {running,lastSync};
  }
  async function run() {
    if(running)throw Error('directory_sync_running');
    running=true;
    try {
      if(!config.feishuAppId||!config.feishuAppSecret)throw Error('feishu_not_configured');
      const call=async(route,options={})=>{
        const response=await fetcher('https://open.feishu.cn/open-apis'+route,{...options,signal:AbortSignal.timeout(30000)});
        const value=await response.json();
        if(!response.ok||value.code!==0)throw Error('directory_permission_or_scope_required');
        return value;
      };
      const token=(await call('/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:config.feishuAppId,app_secret:config.feishuAppSecret})})).tenant_access_token;
      if(!token)throw Error('directory_permission_or_scope_required');
      const get=async route=>(await call(route,{headers:{authorization:'Bearer '+token}})).data ?? {};
      const common={user_id_type:'user_id',department_id_type:'open_department_id',page_size:'50'};
      async function pages(route,params,visit) {
        let page='';const seen=new Set();
        while(true) {
          const data=await get(route+'?'+new URLSearchParams({...common,...params,...(page?{page_token:page}:{})}));
          if(!data||typeof data!=='object')throw Error('directory_invalid_response');
          visit(data);
          if(!data.has_more)return;
          page=data.page_token;
          if(typeof page!=='string'||!page||seen.has(page)||seen.size>=1000)throw Error('directory_invalid_pagination');
          seen.add(page);
        }
      }
      const local=await query('SELECT user_id,name,department,manager_user_id,email,is_active FROM employees;');
      const localById=new Map(local.map(person=>[person.user_id,person]));
      const links=await query('SELECT open_department_id,leader_name,raw_json FROM feishu_department_links;');
      const departments=new Map(),knownNames=new Map(local.filter(p=>p.name&&p.name!=='待同步姓名').map(p=>[p.user_id,p.name]));
      for(const link of links) {
        try {const raw=JSON.parse(link.raw_json);if(!raw||typeof raw!=='object')continue;
          if(raw.name)departments.set(link.open_department_id,raw.name);
          if(raw.leader_user_id&&link.leader_name)knownNames.set(raw.leader_user_id,link.leader_name);
        } catch {}
      }
      for(const row of await query("SELECT value_json FROM app_settings WHERE key IN ('identity_name_cache','boss_view_members','scoring360_admin_members');")) {
        try {for(const member of JSON.parse(row.value_json).members||[])if(member.userId&&member.name)knownNames.set(member.userId,member.name);} catch {}
      }
      const scopeDepartments=new Set(),scopeUsers=new Set(),failedDepartments=new Set(),failedUsers=new Set();
      let scopeRead=false,departmentScanComplete=false,expectedCompanyTotal=null,invalidIdentities=0;
      try {await pages('/contact/v3/scopes',{},data=>{
        for(const id of data.department_ids||[])if(typeof id==='string')scopeDepartments.add(id);
        for(const id of data.user_ids||[])if(typeof id==='string')scopeUsers.add(id);
      });scopeRead=true;} catch { /* The root total can independently verify full coverage. */ }
      try {const root=(await get('/contact/v3/departments/0?user_id_type=user_id&department_id_type=open_department_id'))?.department;
        if(Number.isInteger(root?.member_count)&&root.member_count>=0)expectedCompanyTotal=root.member_count;
      } catch {}
      const discoveredDepartments=new Set(['0',...scopeDepartments]);
      try {await pages('/contact/v3/departments/0/children',{fetch_child:'true'},data=>{
        if(data.items!==undefined&&!Array.isArray(data.items)||data.items===undefined&&data.has_more)throw Error('directory_invalid_response');
        for(const department of data.items||[]) {
          if(!department.open_department_id)throw Error('directory_invalid_response');
          discoveredDepartments.add(department.open_department_id);
          if(department.name)departments.set(department.open_department_id,department.name);
          if(department.leader_user_id&&department.leader_name)knownNames.set(department.leader_user_id,department.leader_name);
        }
      });departmentScanComplete=true;} catch {failedDepartments.add('department_tree');}
      // Cached departments provide a safe additional discovery path when scope is
      // restricted. Missing users are never interpreted as termination.
      for(const id of departments.keys())discoveredDepartments.add(id);
      if(discoveredDepartments.size>10000)throw Error('directory_invalid_response');
      const people=new Map(),memberships=new Map();
      function accept(person,departmentId) {
        const id=person?.user_id;
        if(typeof id!=='string'||!id||id.startsWith('ou_')) {invalidIdentities++;return;}
        people.set(id,{...people.get(id),...person});
        if(departmentId) {const ids=memberships.get(id)||new Set();ids.add(departmentId);memberships.set(id,ids);}
      }
      async function parallel(items,work) {
        let index=0;
        await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{while(index<items.length)await work(items[index++]);}));
      }
      await parallel([...discoveredDepartments],async id=>{
        try {await pages('/contact/v3/users/find_by_department',{department_id:id},data=>{
          // Feishu omits items for a successful empty direct-members list.
          // Parent departments can still have many users in their children.
          if(data.items!==undefined&&!Array.isArray(data.items)||data.items===undefined&&data.has_more)throw Error('directory_invalid_response');
          for(const person of data.items||[])accept(person,id);
        });} catch {failedDepartments.add(id);}
      });
      await parallel([...scopeUsers].filter(id=>!people.has(id)),async id=>{
        try {const person=(await get('/contact/v3/users/'+encodeURIComponent(id)+'?user_id_type=user_id&department_id_type=open_department_id'))?.user;
          if(person?.user_id!==id)throw Error('directory_invalid_identity');accept(person);
        } catch {failedUsers.add(id);}
      });
      if(!people.size)throw Error(invalidIdentities?'directory_user_id_permission_required':'directory_scope_empty');
      // Fill missing names once, only for identities with no known display name.
      await parallel([...people.values()].filter(person=>!person.name&&!knownNames.has(person.user_id)),async person=>{
        try {const current=(await get('/contact/v3/users/'+encodeURIComponent(person.user_id)+'?user_id_type=user_id&department_id_type=open_department_id'))?.user;
          if(current?.user_id!==person.user_id)throw Error('directory_invalid_identity');accept({...person,...current});
        } catch {failedUsers.add(person.user_id);}
      });
      let created=0,updated=0,preservedInactive=0,missingNames=0;
      const prepared=[],statements=['BEGIN IMMEDIATE;'],finishedAt=new Date().toISOString();
      for(const person of people.values()) {
        const id=person.user_id,previous=localById.get(id),name=String(person.name||knownNames.get(id)||'').trim();
        const nameMissing=!name;
        if(nameMissing)missingNames++;
        const departmentIds=Array.isArray(person.department_ids)?person.department_ids:[...(memberships.get(id)||[])];
        const departmentNames=departmentIds.filter(id=>id!=='0').map(id=>departments.get(id));
        const departmentComplete=departmentNames.every(Boolean)&&departmentIds.length>0;
        const department=departmentComplete?(departmentNames.join(' / ')||(departmentIds.includes('0')?'公司直属（根部门）':'')):(previous?.department||'');
        const remoteInactive=['is_resigned','is_frozen','is_unjoined'].some(key=>person.status?.[key]===true);
        const active=previous?.is_active===0||remoteInactive?0:1;
        if(previous) {updated++;if(Number(previous.is_active)===0)preservedInactive++;} else created++;
        const manager=typeof person.leader_user_id==='string'&&!person.leader_user_id.startsWith('ou_')?person.leader_user_id:(previous?.manager_user_id||'');
        const email=person.email||person.enterprise_email||previous?.email||'';
        statements.push(`INSERT INTO employees(user_id,name,department,email,manager_user_id,is_active,updated_at)
          VALUES(${sql(id)},${sql(name||'待同步姓名')},${sql(department)},${sql(email)},${sql(manager)},${active},datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET name=${String(person.name||'').trim()?'excluded.name':"CASE WHEN employees.name<>'' AND employees.name<>'待同步姓名' THEN employees.name ELSE excluded.name END"},
            department=${departmentComplete?"CASE WHEN excluded.department<>'' THEN excluded.department ELSE employees.department END":'employees.department'},
            email=${person.email||person.enterprise_email?'excluded.email':'employees.email'},manager_user_id=${typeof person.leader_user_id==='string'&&!person.leader_user_id.startsWith('ou_')?'excluded.manager_user_id':'employees.manager_user_id'},
            is_active=CASE WHEN employees.is_active=0 THEN 0 ELSE excluded.is_active END,updated_at=datetime('now');`);
        statements.push(`INSERT INTO employee_directory_profiles(user_id,name_missing,synced_at) SELECT user_id,CASE WHEN name='' OR name='待同步姓名' THEN 1 ELSE 0 END,${sql(finishedAt)} FROM employees WHERE user_id=${sql(id)}
          ON CONFLICT(user_id) DO UPDATE SET name_missing=excluded.name_missing,synced_at=excluded.synced_at;`);
        prepared.push({person,active});
      }
      statements.push('COMMIT;');await exec(statements.join('\n'));
      const currentById=new Map((await query('SELECT user_id,is_active FROM employees;')).map(person=>[person.user_id,person]));
      for(const {person,active} of prepared) {
        try {
          await registerIdentity({userId:person.user_id,openId:person.open_id,unionId:person.union_id});
          if(Number(currentById.get(person.user_id)?.is_active)===1)await lifecycle?.profile(person.user_id,person.join_time);
          else {
            if(!localById.has(person.user_id))await lifecycle?.observe(person.user_id,undefined,'feishu');
            if(!localById.has(person.user_id)||Number(localById.get(person.user_id)?.is_active)===1)await lifecycle?.stop(person.user_id);
          }
        } catch {failedUsers.add(person.user_id);}
      }
      const scopeComplete=!failedDepartments.size&&!failedUsers.size&&!invalidIdentities&&departmentScanComplete&&(
        expectedCompanyTotal!==null?people.size===expectedCompanyTotal:scopeRead&&scopeDepartments.has('0'));
      missingNames=Number((await query(`SELECT count(*) AS count FROM employee_directory_profiles WHERE user_id IN (${[...people.keys()].map(sql).join(',')}) AND name_missing=1;`))[0]?.count||0);
      const notReturnedLocalUserIds=local.filter(person=>!people.has(person.user_id)).map(person=>person.user_id);
      const result={total:people.size,created,updated,preservedInactive,missingNames,notReturnedLocalCount:notReturnedLocalUserIds.length,notReturnedLocalUserIds,failed:failedUsers.size,
        failedUserIds:[...failedUsers],failedDepartments:[...failedDepartments],invalidIdentities,scannedDepartments:discoveredDepartments.size,
        coverage:scopeComplete?'company':'visible_scope',expectedCompanyTotal,scopeComplete,
        incomplete:!scopeComplete||missingNames>0,finishedAt};
      await exec(`INSERT INTO app_settings(key,value_json,updated_at) VALUES('employee_directory_sync',${sql(JSON.stringify(result))},datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at;`);
      return result;
    } finally {running=false;}
  }
  return {run,status};
}
