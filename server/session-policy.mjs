import {createHash,randomUUID} from 'node:crypto';

export function createSessionPolicy({query,exec,sql,ttlHours=168,mock=false,now=()=>Date.now()}){
 const ttl=Math.min(720,Math.max(1,Number(ttlHours)||168))*3600000,revoked=new Set();
 const id=(session,token)=>session?.sessionId||createHash('sha256').update(String(token||'')).digest('hex');
 async function load(){for(const r of await query('SELECT session_id FROM revoked_sessions;'))revoked.add(r.session_id);}
 function issue(session){
  const issuedAt=Number.isFinite(session.issuedAt)?session.issuedAt:now();
  const expiry=Math.min(Date.parse(session.expiresAt)||Infinity,issuedAt+ttl);
  return {...session,issuedAt,sessionId:session.sessionId||randomUUID(),expiresAt:new Date(expiry).toISOString()};
 }
 function valid(session,token){
  if(!session||revoked.has(id(session,token)))return false;
  const expiry=Date.parse(session.expiresAt),issued=Number(session.issuedAt);
  if(session.expiresAt&&(!Number.isFinite(expiry)||expiry<=now()))return false;
  // Mock-only fixtures can still use synthetic signed sessions; real logins are bounded.
  if(!mock&&(!session.sessionId||!Number.isFinite(issued)||issued>now()+300000||!Number.isFinite(expiry)||expiry>issued+ttl||now()-issued>=ttl))return false;
  return true;
 }
 async function revoke(session,token,reason='logout'){
  if(!session)return;
  const sessionId=id(session,token);revoked.add(sessionId);
  await exec(`INSERT OR IGNORE INTO revoked_sessions(session_id,expires_at,reason) VALUES(${sql(sessionId)},${sql(session.expiresAt||null)},${sql(reason)});`);
 }
 return {load,issue,valid,revoke};
}
