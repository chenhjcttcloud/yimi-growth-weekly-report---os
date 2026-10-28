export function createEmployeeIdentity({query,exec,sql,strict=true}){
 const aliases=new Map();
 async function load(){aliases.clear();for(const row of await query('SELECT user_id,open_id FROM employee_identities;')){aliases.set(row.user_id,row.user_id);if(row.open_id)aliases.set(row.open_id,row.user_id);}}
 function resolve(value){const id=String(value||'').trim();if(!id)return '';return aliases.get(id)||((strict&&id.startsWith('ou_'))?'':id);}
 function sessionUser(user){if(!user)return null;const userId=resolve(user.userId||user.openId);if(!userId)return null;const {openId,...rest}=user;return {...rest,userId};}
 async function register({userId,openId,unionId}){
  if(!userId||(strict&&userId.startsWith('ou_')))throw Error('feishu_user_id_required');
  if(openId){const old=await query(`SELECT user_id FROM employee_identities WHERE open_id=${sql(openId)};`);if(old[0]&&old[0].user_id!==userId)throw Error('identity_mapping_conflict');}
  await exec(`INSERT INTO employee_identities(user_id,open_id,union_id) VALUES(${sql(userId)},${openId?sql(openId):'NULL'},${sql(unionId||'')}) ON CONFLICT(user_id) DO UPDATE SET open_id=COALESCE(NULLIF(excluded.open_id,''),employee_identities.open_id),union_id=COALESCE(NULLIF(excluded.union_id,''),employee_identities.union_id),updated_at=datetime('now');`);
  aliases.set(userId,userId);if(openId)aliases.set(openId,userId);
 }
 return {load,resolve,sessionUser,register};
}

// Called only after Feishu's authorization-code exchange and user_info verification.
export async function resolveFeishuLogin(data,lookupByOpenId){
 let userId=data.user_id;
 if(!userId&&data.open_id){const profile=await lookupByOpenId(data.open_id);if(profile.open_id&&profile.open_id!==data.open_id)throw Error('identity_mismatch');userId=profile.user_id;}
 if(!userId||String(userId).startsWith('ou_'))throw Error('feishu_user_id_required');
 return {userId,feishuOpenId:data.open_id||'',unionId:data.union_id||'',name:data.name||data.en_name||'Feishu User',email:data.email||'',avatarUrl:data.avatar_url||''};
}
