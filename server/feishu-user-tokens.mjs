import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

// Refresh credentials stay encrypted on the server, scoped to the signed app session.
// A refresh whose response was lost requires login again: never reuse a rotated token.
export function createFeishuUserTokens({query,exec,sql,credentials,secret,request,appToken,now=()=>Date.now()}){
 const key=createHash('sha256').update(secret).digest(),pending=new Map();
 const reauth=()=>Object.assign(Error('feishu_reauthorization_required'),{reauthorize:true});
 function encrypt(data){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return [iv.toString('hex'),Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]).toString('hex'),cipher.getAuthTag().toString('hex')].join(':');}
 function decrypt(value){try{const [iv,data,tag]=value.split(':'),d=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'hex'));d.setAuthTag(Buffer.from(tag,'hex'));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'hex')),d.final()]).toString());}catch{throw reauth();}}
 async function save(session,data){
  if(!session?.sessionId||!session.user?.userId||!data.access_token)throw reauth();
  const c=credentials(),value={access:data.access_token,refresh:data.refresh_token||'',expires:now()+Math.max(0,Number(data.expires_in)||0)*1000,sessionExpires:Date.parse(session.expiresAt)||now()+86400000,refreshExpires:data.refresh_token?now()+Math.max(0,Number(data.refresh_expires_in)||0)*1000:0};
  await exec(`INSERT INTO feishu_user_grants(session_id,user_id,app_id,encrypted_tokens,state,updated_at) VALUES(${sql(session.sessionId)},${sql(session.user.userId)},${sql(c.feishuAppId)},${sql(encrypt(value))},'active',${sql(new Date(now()).toISOString())}) ON CONFLICT(session_id) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens,state='active',updated_at=excluded.updated_at;`);
 }
 async function record(session){return (await query(`SELECT * FROM feishu_user_grants WHERE session_id=${sql(session?.sessionId||'')};`))[0];}
 async function revoke(session){if(session?.sessionId)await exec(`UPDATE feishu_user_grants SET state='revoked',updated_at=${sql(new Date(now()).toISOString())} WHERE session_id=${sql(session.sessionId)};`);}
 async function obtain(session,force=false,rejectedToken=''){
  const row=await record(session),c=credentials();
  if(!row||row.user_id!==session?.user?.userId||row.app_id!==c.feishuAppId||row.state!=='active')throw reauth();
  const tokens=decrypt(row.encrypted_tokens);
  // Concurrent calls failing on the old token reuse the refresh already completed.
  if(tokens.expires>now()+60000&&(!force||rejectedToken&&tokens.access!==rejectedToken))return tokens.access;
  if(!tokens.refresh||tokens.refreshExpires<=now())throw reauth();
  const claimed=await query(`UPDATE feishu_user_grants SET state='refreshing' WHERE session_id=${sql(session.sessionId)} AND state='active' RETURNING session_id;`);
  if(!claimed.length)throw reauth();
  let result;
  try{result=await request('/open-apis/authen/v1/refresh_access_token',{method:'POST',token:await appToken(),body:{grant_type:'refresh_token',refresh_token:tokens.refresh}});}catch{await exec(`UPDATE feishu_user_grants SET state='reauthorize' WHERE session_id=${sql(session.sessionId)};`);throw reauth();}
  if(!result.data?.access_token||!result.data?.refresh_token||result.data.user_id&&result.data.user_id!==session.user.userId){await exec(`UPDATE feishu_user_grants SET state='reauthorize' WHERE session_id=${sql(session.sessionId)};`);throw reauth();}
  const latest=await record(session);if(latest?.state!=='refreshing'||(await query(`SELECT 1 FROM revoked_sessions WHERE session_id=${sql(session.sessionId)};`)).length||credentials().feishuAppId!==row.app_id)throw reauth();
  await save(session,result.data);return result.data.access_token;
 }
 async function token(session,force=false,rejectedToken=''){
  if(!session?.sessionId)throw reauth();
  if(pending.has(session.sessionId))return pending.get(session.sessionId);
  const promise=obtain(session,force,rejectedToken);pending.set(session.sessionId,promise);
  try{return await promise;}finally{if(pending.get(session.sessionId)===promise)pending.delete(session.sessionId);}
 }
 async function call(session,action){
  // Legacy SSO cookies cannot refresh; import only their access token into the vault.
  if(session?.userAccessToken&&session?.sessionId&&!await record(session))await save(session,{access_token:session.userAccessToken,expires_in:1});
  const access=await token(session);
  try{return await action(access);}catch(error){
   if(![99991663,99991664,99991668,99991677].includes(Number(error?.feishuCode)))throw error;
   const refreshed=await token(session,true,access);
   try{return await action(refreshed);}catch(next){if([99991663,99991664,99991668,99991677].includes(Number(next?.feishuCode))){await revoke(session);throw reauth();}throw next;}
  }
 }
 async function expiring(){
  const rows=await query("SELECT g.* FROM feishu_user_grants g JOIN employees e ON e.user_id=g.user_id AND e.is_active=1 WHERE g.state='active' AND NOT EXISTS(SELECT 1 FROM revoked_sessions r WHERE r.session_id=g.session_id) ORDER BY g.updated_at DESC;");
  const seen=new Set();return rows.flatMap(row=>{if(seen.has(row.user_id)||row.app_id!==credentials().feishuAppId)return [];seen.add(row.user_id);try{const t=decrypt(row.encrypted_tokens);return t.refreshExpires&&t.sessionExpires>now()?[{userId:row.user_id,refreshExpiresAt:new Date(t.refreshExpires).toISOString()}]:[];}catch{return [];}});
 }
 return {save,call,revoke,expiring};
}
