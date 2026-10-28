import {createHash,timingSafeEqual} from 'node:crypto';

const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);};

// SHA256(timestamp + nonce + Encrypt Key + raw body), per Feishu's event protocol.
export function validateFeishuEvent({raw,headers,body,verificationToken,encryptKey,now=Date.now()}){
 if(!verificationToken&&!encryptKey)throw Error('event_receiver_not_configured');
 if(encryptKey&&!(body.challenge&&verificationToken)){
  const timestamp=String(headers['x-lark-request-timestamp']||''),nonce=String(headers['x-lark-request-nonce']||''),signature=headers['x-lark-signature'];
  if(!/^\d+$/.test(timestamp)||!nonce||nonce.length>256||Math.abs(now/1000-Number(timestamp))>300)throw Error('invalid_event_signature');
  const expected=createHash('sha256').update(timestamp+nonce+encryptKey).update(raw).digest('hex');
  if(!equal(expected,signature))throw Error('invalid_event_signature');
 }
 if(verificationToken&&!equal(body.header?.token||body.token,verificationToken))throw Error('invalid_event_token');
 const appId=body.header?.app_id||body.app_id;
 return {eventId:body.header?.event_id||body.uuid||createHash('sha256').update(raw).digest('hex'),appId};
}
