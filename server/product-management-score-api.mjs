import {createHash,timingSafeEqual} from 'node:crypto';

export const PRODUCT_MANAGEMENT_SCORE_PATH='/api/integrations/product-management/monthly-scores';
const MAX_EMPLOYEES=100,MAX_BODY_BYTES=64*1024;
const digest=value=>createHash('sha256').update(value).digest('hex');
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const score=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:null;
const count=value=>Number.isInteger(value)&&value>=0?value:null;
const emptyScore=status=>({score:null,status,isFinal:false,previousScore:null,source:null,updatedAt:null,revision:null});
function timestamp(value){
 if(typeof value!=='string'||!value)return null;
 const input=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)?value.replace(' ','T')+'Z':value;
 const time=Date.parse(input);return Number.isFinite(time)?new Date(time).toISOString():null;
}
function validateRequest(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)||!Array.isArray(body.employees)||!body.employees.length||body.employees.length>MAX_EMPLOYEES)throw failure('invalid_score_request');
 const ids=new Set();
 const employees=body.employees.map(employee=>{
  if(!employee||typeof employee!=='object'||Array.isArray(employee)||typeof employee.feishuUserId!=='string'||typeof employee.name!=='string')throw failure('invalid_score_request');
  const feishuUserId=employee.feishuUserId.trim(),name=employee.name.trim().normalize('NFC');
  if(!feishuUserId||feishuUserId.length>200||/^ou_/i.test(feishuUserId)||/[\s\p{Cc}\p{Cf}]/u.test(feishuUserId)||!name||name.length>200||/[\p{Cc}\p{Cf}]/u.test(name))throw failure('invalid_score_request');
  if(ids.has(feishuUserId))throw failure('duplicate_employee_id');
  ids.add(feishuUserId);return {feishuUserId,name};
 });
 return {month:body.month,employees};
}
// Reject oversized bodies without destroying the request socket before the 413
// response can be delivered. Discard remaining chunks instead of retaining them.
function readBody(req){
 if(Number(req.headers['content-length'])>MAX_BODY_BYTES){req.resume();throw failure('payload_too_large',413);}
 return new Promise((resolve,reject)=>{
  const chunks=[];let bytes=0,exceeded=false;
  req.on('data',chunk=>{
   if(exceeded)return;
   bytes+=chunk.length;
   if(bytes>MAX_BODY_BYTES){exceeded=true;chunks.length=0;reject(failure('payload_too_large',413));return;}
   chunks.push(chunk);
  });
  req.once('end',()=>{if(exceeded)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(failure('invalid_score_request'));}});
  req.once('error',()=>reject(failure('invalid_score_request')));
  req.once('aborted',()=>reject(failure('invalid_score_request')));
 });
}
function resultScore(row,month,userId){
 const output={...emptyScore('invalid_result'),source:row.source,updatedAt:timestamp(row.updated_at),revision:digest(JSON.stringify([month,userId,row.kind,row.source,row.version_id,row.updated_at,row.result_json]))};
 let result;try{result=JSON.parse(row.result_json);}catch{return output;}
 if(!result||typeof result!=='object'||Array.isArray(result))return output;
 const value=score(result.score);
 if(row.source!=='automatic_report')return value===null?output:{...output,score:value,status:'published',isFinal:true};
 const metadata={reportCount:count(result.reportCount),pendingAnalysis:count(result.pendingAnalysis),failedAnalysis:count(result.failedAnalysis),previousResultAt:timestamp(result.previousResultAt)};
 if(result.status==='ready'&&value===null)return {...output,...metadata};
 if(['ready','pending_confirmation','candidate'].includes(result.status))return {...output,...metadata,status:'pending_confirmation'};
 if(['rescoring','rescore_failed'].includes(result.status))return {...output,...metadata,status:result.status};
 if(['pending_ai','no_reports'].includes(result.status))return {...output,...metadata,status:result.status};
 return {...output,...metadata};
}

// This service deliberately receives no exec(), performance.overview(), or
// provider client. Reading saved summaries cannot publish or recalculate scores.
export function createProductManagementScoreApi({query,sql,sendJson,token='',now=()=>new Date()}){
 const configured=typeof token==='string'&&/^[\x21-\x7e]{32,4096}$/.test(token);
 const expected=configured?createHash('sha256').update(token).digest():null;
 function authorized(req){
  const headers=req.rawHeaders||[];
  if(headers.filter((value,index)=>index%2===0&&value.toLowerCase()==='authorization').length>1)return false;
  const header=req.headers.authorization;
  const supplied=typeof header==='string'&&/^Bearer ([^\s]{1,4096})$/i.exec(header)?.[1];
  return Boolean(supplied&&timingSafeEqual(createHash('sha256').update(supplied).digest(),expected));
 }
 async function readScores(body){
  const {month,employees}=validateRequest(body),ids=employees.map(employee=>sql(employee.feishuUserId)).join(',');
  // One SELECT gives a consistent snapshot of the current identity and selected
  // saved scores. Limit by month/IDs and never load evidence or report content.
  const rows=await query(`WITH selected AS (
 SELECT user_id,name,department,is_active FROM employees WHERE user_id IN (${ids})
), candidates AS (
 SELECT p.employee_user_id,p.kind,p.result_json,p.confirmed_at AS updated_at,
 CASE WHEN p.kind='quality' AND json_extract(CASE WHEN json_valid(p.result_json) THEN p.result_json ELSE '{}' END,'$.publicationMode')='management_confirmation' THEN 'management_confirmed' ELSE 'legacy' END AS source,
 p.confirmed_at AS version_id,0 AS priority
 FROM performance_results p JOIN selected e ON e.user_id=p.employee_user_id
 WHERE p.month=${sql(month)} AND p.kind IN ('quality','collaboration')
 UNION ALL SELECT p.employee_user_id,p.kind,p.result_json,p.confirmed_at,'weighted_30_70',p.confirmed_at,1
 FROM monthly_person_weighted_results p JOIN selected e ON e.user_id=p.employee_user_id WHERE p.month=${sql(month)} AND p.kind='collaboration'
 UNION ALL SELECT p.employee_user_id,p.kind,p.result_json,p.confirmed_at,'weighted_30_70',p.confirmed_at,2
 FROM monthly_weighted_results p JOIN selected e ON e.user_id=p.employee_user_id WHERE p.month=${sql(month)} AND p.kind='collaboration'
 UNION ALL SELECT a.employee_user_id,a.kind,a.result_json,a.calculated_at,'automatic_report',a.id,3
 FROM automatic_performance_results a JOIN selected e ON e.user_id=a.employee_user_id
 WHERE a.month=${sql(month)} AND a.kind='quality' AND a.rowid=(SELECT MAX(b.rowid) FROM automatic_performance_results b WHERE b.month=a.month AND b.employee_user_id=a.employee_user_id AND b.kind=a.kind)
)
SELECT e.user_id,e.name,e.department,e.is_active,c.kind,c.result_json,c.updated_at,c.source,c.version_id
FROM selected e LEFT JOIN candidates c ON c.employee_user_id=e.user_id
AND NOT EXISTS(SELECT 1 FROM candidates preferred WHERE preferred.employee_user_id=c.employee_user_id AND preferred.kind=c.kind AND preferred.priority<c.priority);`);
  const identities=new Map();
  for(const row of rows){
   if(!identities.has(row.user_id))identities.set(row.user_id,{employee:{feishuUserId:row.user_id,name:row.name,department:row.department||'',active:Number(row.is_active)===1},scores:new Map()});
   if(row.kind)identities.get(row.user_id).scores.set(row.kind,row);
  }
  const data=employees.map(input=>{
   const found=identities.get(input.feishuUserId),employee=found?.employee||null;
   const matchStatus=!employee?'not_found':employee.name.trim().normalize('NFC')===input.name?'matched':'name_mismatch';
   const get=kind=>matchStatus!=='matched'?emptyScore('identity_mismatch'):found.scores.has(kind)?resultScore(found.scores.get(kind),month,input.feishuUserId):emptyScore('not_published');
   return {input,matchStatus,employee,weeklyQuality:get('quality'),collaboration360:get('collaboration')};
  });
  const matched=data.filter(row=>row.matchStatus==='matched').length;
  return {ok:true,apiVersion:'1',month,generatedAt:now().toISOString(),data,totals:{requested:data.length,matched,unmatched:data.length-matched}};
 }
 async function handle(req,res,url){
  res.setHeader('cache-control','no-store');res.setHeader('vary','Authorization');
  if(!configured)return sendJson(res,503,{ok:false,error:'score_api_not_configured'});
  if(!authorized(req)){res.setHeader('www-authenticate','Bearer realm="growth-os-score-api"');return sendJson(res,401,{ok:false,error:'unauthorized'});}
  if(!['GET','POST'].includes(req.method)){res.setHeader('allow','GET, POST');return sendJson(res,405,{ok:false,error:'method_not_allowed'});}
  if(req.method==='POST'&&req.headers.origin){
   let sameOrigin=false;try{sameOrigin=new URL(req.headers.origin).host===req.headers.host;}catch{}
   if(!sameOrigin)return sendJson(res,403,{ok:false,error:'invalid_origin'});
  }
  try{
   let body;
   if(req.method==='GET'){
    const allowed=['month','feishuUserId','name'];
    if([...url.searchParams.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>url.searchParams.getAll(key).length!==1))throw failure('invalid_score_request');
    body={month:url.searchParams.get('month'),employees:[{feishuUserId:url.searchParams.get('feishuUserId'),name:url.searchParams.get('name')}]};
   }else{
    if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')throw failure('json_required',415);
    body=await readBody(req);
   }
   return sendJson(res,200,await readScores(body));
  }catch(error){
   if(error.status)return sendJson(res,error.status,{ok:false,error:error.message});
   res.setHeader('retry-after','5');return sendJson(res,503,{ok:false,error:'score_data_unavailable'});
  }
 }
 return {handle};
}
