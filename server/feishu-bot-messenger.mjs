import {createHash} from 'node:crypto';

// All application-identity reminders use HTTP, including minimal container images.
export function createFeishuBotMessenger({credentials,fetcher=fetch,now=()=>Date.now()}){
 let cached=null,pending=null;
 function failure(retryable=true){return Object.assign(Error('feishu_message_failed'),{retryable});}
 async function json(url,body,token){
  let response,value;
  try{response=await fetcher('https://open.feishu.cn/open-apis'+url,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});value=await response.json();}catch{throw failure();}
  if(!response.ok||value.code!==0)throw Object.assign(failure(response.status===429||response.status>=500||[99991400,99991401].includes(Number(value.code))),{feishuCode:Number(value.code)});
  return value;
 }
 async function token(){
  const c=credentials();if(!c.feishuAppId||!c.feishuAppSecret)throw failure(false);
  const key=createHash('sha256').update(c.feishuAppId+':'+c.feishuAppSecret).digest('hex');
  if(cached?.key===key&&cached.expires>now())return cached.token;
  if(pending?.key===key)return pending.promise;
  const promise=(async()=>{const value=await json('/auth/v3/tenant_access_token/internal',{app_id:c.feishuAppId,app_secret:c.feishuAppSecret});if(!value.tenant_access_token)throw failure();cached={key,token:value.tenant_access_token,expires:now()+Math.max(1,(Number(value.expire)||7200)-120)*1000};return cached.token;})();
  pending={key,promise};try{return await promise;}finally{if(pending?.promise===promise)pending=null;}
 }
 async function send(userId,text,uuid){
  if(!userId||!text||!uuid)throw failure(false);
  const body={receive_id:userId,msg_type:'text',content:JSON.stringify({text}),uuid};
  const access=await token();let result;
  try{result=await json('/im/v1/messages?receive_id_type=user_id',body,access);}catch(error){
   if(![99991663,99991664,99991668,99991677].includes(error.feishuCode))throw error;
   if(cached?.token===access)cached=null;
   result=await json('/im/v1/messages?receive_id_type=user_id',body,await token());
  }
  if(!result.data?.message_id)throw failure();return result.data.message_id;
 }
 return {send};
}
