import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
export const defaultPolicy={weights:[30,25,25,20],deadlineTime:'20:00',reminderWaitHours:24,reminderCooldownHours:24};
const DEFAULT_DAILY_REPORT_AI_REQUEST_LIMIT=60;
const DEFAULT_REPORT_SCORING_START_MONTH='2026-11';
const AI_MODELS_TIMEOUT_MS=8000;
const AI_MODELS_RESPONSE_LIMIT=1024*1024;
const AI_MODELS_LIMIT=500;
const reportAiPausedSql=`COALESCE((SELECT CASE
 WHEN json_type(value_json,'$.scoringPaused') IN ('true','false') THEN json_extract(value_json,'$.scoringPaused')
 ELSE json_extract(value_json,'$.dailyAiRequestLimit')=0 END
 FROM app_settings WHERE key='report_automation_config'),0)`;

function parseAiBaseUrl(baseUrl){
 let url;
 try{url=new URL(baseUrl);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname))return null;
 return url;
}

async function readAiModelsResponse(response){
 const chunks=[];
 let bytes=0;
 for await(const chunk of response.body){
  bytes+=chunk.byteLength;
  if(bytes>AI_MODELS_RESPONSE_LIMIT)throw Error('ai_models_unavailable');
  chunks.push(chunk);
 }
 return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
}

export function createSystemSettings({query,exec,sql,config,now=()=>new Date(),fetcher=fetch}) {
 const key=createHash('sha256').update(config.sessionSecret).digest();
 let aiWrites=Promise.resolve();
 const month=()=>now().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
 function encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return [iv.toString('hex'),Buffer.concat([cipher.update(value,'utf8'),cipher.final()]).toString('hex'),cipher.getAuthTag().toString('hex')].join(':');}
 function decrypt(value){const [iv,data,tag]=value.split(':');const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'hex'));decipher.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(data,'hex')),decipher.final()]).toString('utf8');}
 const readAiSetting=row=>row?JSON.parse(Buffer.from(row.value,'hex').toString('utf8')):null;
 async function setting(){const rows=await query("SELECT hex(value_json) AS value FROM app_settings WHERE key='ai_runtime';");return readAiSetting(rows[0]);}
 function applyAiSetting(stored){
  const apiKey=stored.encryptedKey?decrypt(stored.encryptedKey):'';
  config.moonshotBaseUrl=stored.baseUrl;
  config.kimiFollowupModel=stored.model;
  config.moonshotApiKey=apiKey;
 }
 async function reportSetting(){const rows=await query("SELECT hex(value_json) AS value FROM app_settings WHERE key='feishu_report';");return rows[0]?JSON.parse(Buffer.from(rows[0].value,'hex').toString('utf8')):null;}
 async function reportOverview(){const r=await reportSetting();return {appId:config.feishuAppId||'',secretConfigured:!!config.feishuAppSecret,templateName:r?.templateName||'周报（聚焦结果与协作）',ruleId:r?.ruleId||'',startDate:r?.startDate||''};}
 async function saveReport(body,user){const old=await reportSetting();const appId=String(body.appId||'').trim(),secret=String(body.appSecret||'').trim(),templateName=String(body.templateName||'').trim(),ruleId=String(body.ruleId||'').trim(),startDate=String(body.startDate||'');if(!/^cli_[a-zA-Z0-9]+$/.test(appId)||!templateName||templateName.length>200||secret.length>4000||ruleId.length>200||startDate&&!/^\d{4}-\d{2}-\d{2}$/.test(startDate))throw Error('invalid_report_config');if(!secret&&appId!==config.feishuAppId)throw Error('report_secret_required');const stored={appId,encryptedSecret:secret?encrypt(secret):old?.encryptedSecret||(config.feishuAppSecret?encrypt(config.feishuAppSecret):''),templateName,ruleId,startDate};if(!stored.encryptedSecret)throw Error('report_secret_required');await exec(`INSERT INTO app_settings(key,value_json,updated_at) VALUES('feishu_report',${sql(JSON.stringify(stored))},datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at;`);config.feishuAppId=appId;config.feishuAppSecret=decrypt(stored.encryptedSecret);await audit(user,'飞书汇报配置已保存',{appId,templateName,ruleId,startDate});}
 async function initialize(){const report=await reportSetting();if(report){config.feishuAppId=report.appId;config.feishuAppSecret=report.encryptedSecret?decrypt(report.encryptedSecret):'';}const stored=await setting();if(stored)applyAiSetting(stored);const events=await eventSetting();if(events){config.eventVerificationToken=events.token?decrypt(events.token):'';config.eventEncryptKey=events.key?decrypt(events.key):'';config.eventReceiverEnabled=events.enabled===true;}else config.eventReceiverEnabled=!!(config.eventVerificationToken||config.eventEncryptKey);const features=await featureSettings();config.taskCreateEnabled=features.taskCreateEnabled;}
 async function eventSetting(){const row=(await query("SELECT value_json FROM app_settings WHERE key='feishu_event_security';"))[0];return row?JSON.parse(row.value_json):null;}
 async function eventOverview(){return {enabled:config.eventReceiverEnabled===true,tokenConfigured:!!config.eventVerificationToken,signatureConfigured:!!config.eventEncryptKey,callbackPath:'/api/feishu/events'};}
 async function saveEvents(body,user){
  if(typeof body.enabled!=='boolean'||[body.verificationToken,body.encryptKey].some(v=>v!=null&&(typeof v!=='string'||v.length>1000)))throw Error('invalid_event_config');
  const token=String(body.verificationToken||'').trim()||config.eventVerificationToken||'',key=String(body.encryptKey||'').trim()||config.eventEncryptKey||'';
  if(body.enabled&&!token&&!key)throw Error('event_credentials_required');
  const value={enabled:body.enabled,token:token?encrypt(token):'',key:key?encrypt(key):''};
  await exec(`INSERT INTO app_settings(key,value_json,updated_at) VALUES('feishu_event_security',${sql(JSON.stringify(value))},datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at;`);
  config.eventReceiverEnabled=value.enabled;config.eventVerificationToken=token;config.eventEncryptKey=key;await audit(user,'飞书事件安全配置已更新',await eventOverview());
 }
 async function featureSettings(){const r=(await query("SELECT value_json FROM app_settings WHERE key='integration_features';"))[0];return {taskCreateEnabled:r?JSON.parse(r.value_json).taskCreateEnabled===true:config.taskCreateEnabled===true};}
 async function saveFeatures(body,user){if(typeof body.taskCreateEnabled!=='boolean')throw Error('invalid_integration_features');if(body.taskCreateEnabled&&!(config.feishuAppId&&config.feishuAppSecret))throw Error('feishu_required');await exec(`INSERT INTO app_settings(key,value_json,updated_at) VALUES('integration_features',${sql(JSON.stringify({taskCreateEnabled:body.taskCreateEnabled}))},datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at;`);config.taskCreateEnabled=body.taskCreateEnabled;await audit(user,'飞书任务创建开关已更新',{taskCreateEnabled:body.taskCreateEnabled});}
 async function policies(){const rows=await query('SELECT effective_month,policy_json,created_by,created_at FROM system_policy_versions ORDER BY effective_month;');return rows.map(r=>({...r,policy:JSON.parse(r.policy_json)}));}
 async function policyFor(target){const versions=await policies();return {...defaultPolicy,...versions.filter(v=>v.effective_month<=target).at(-1)?.policy};}
 async function audit(user,action,details={}){await exec(`INSERT INTO system_operation_logs VALUES(${sql(randomUUID())},${sql(user.userId)},${sql(user.name)},${sql(action)},${sql(JSON.stringify(details))},datetime('now'));`);}
 async function monthlyReminderConfig(){
  const row=(await query("SELECT value_json FROM app_settings WHERE key='month_end_score_reminders';"))[0];
  const stored=row?JSON.parse(row.value_json):null;
  return {enabled:stored?stored.enabled===true:config.scoring360ReminderEnabled===true,time:stored?.time||`${String(config.scoring360ReminderHour??10).padStart(2,'0')}:${String(config.scoring360ReminderMinute??0).padStart(2,'0')}`,startMonth:stored?.startMonth||'',configured:!!(config.feishuAppId&&config.feishuAppSecret)};
 }
 async function scoringRemindersEnabled(targetMonth=month()){const c=await monthlyReminderConfig();return c.enabled&&c.configured&&(!c.startMonth||targetMonth>=c.startMonth);}
 async function reportAutomationConfig(){
  const row=(await query("SELECT value_json FROM app_settings WHERE key='report_automation_config';"))[0],stored=row?JSON.parse(row.value_json):null;
  const scoringPaused=typeof stored?.scoringPaused==='boolean'?stored.scoringPaused:stored?.dailyAiRequestLimit===0;
  // Keep the pause indicator compatible with older settings clients.
  const dailyAiRequestLimit=scoringPaused?0:stored?.dailyAiRequestLimit||DEFAULT_DAILY_REPORT_AI_REQUEST_LIMIT;
  return {enabled:stored?stored.enabled===true:config.larkReportAutoSyncEnabled===true,intervalMinutes:stored?.intervalMinutes||15,scoringPaused,dailyAiRequestLimit,scoringStartMonth:stored?.scoringStartMonth??DEFAULT_REPORT_SCORING_START_MONTH,feishuConfigured:!!(config.feishuAppId&&config.feishuAppSecret),aiConfigured:!!config.moonshotApiKey};
 }
 function reportAiUsageKey(){return sql('report_ai_requests:'+now().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}));}
 async function reportAiRequestsToday(){
  const row=(await query(`SELECT value_json FROM app_settings WHERE key=${reportAiUsageKey()};`))[0];
  return Number(row?.value_json??0);
 }
 async function reserveReportAiRequest(){
  // Check the persisted pause and count each request atomically across processes.
  const rows=await query(`INSERT INTO app_settings(key,value_json,updated_at)
    SELECT ${reportAiUsageKey()},'1',datetime('now') WHERE ${reportAiPausedSql}=0
    ON CONFLICT(key) DO UPDATE SET value_json=CAST(app_settings.value_json AS INTEGER)+1,updated_at=excluded.updated_at
    RETURNING key;`);
  return rows.length===1?true:'ai_scoring_paused';
 }
 async function saveReportAutomation(body,user){
  if(typeof body.enabled!=='boolean'||body.intervalMinutes!==undefined&&(!Number.isInteger(body.intervalMinutes)||body.intervalMinutes<5||body.intervalMinutes>1440))throw Error('invalid_report_automation');
  if(body.scoringPaused!==undefined&&typeof body.scoringPaused!=='boolean')throw Error('invalid_report_scoring_pause');
  if(body.dailyAiRequestLimit!==undefined&&(!Number.isInteger(body.dailyAiRequestLimit)||body.dailyAiRequestLimit<0||body.dailyAiRequestLimit>500))throw Error('invalid_ai_request_limit');
  if(body.scoringStartMonth!==undefined&&(typeof body.scoringStartMonth!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.scoringStartMonth)))throw Error('invalid_report_scoring_start_month');
  if(body.enabled&&!(config.feishuAppId&&config.feishuAppSecret))throw Error('feishu_required');
  if(body.enabled&&!config.moonshotApiKey)throw Error('ai_required');
  const scoringPaused=body.scoringPaused??(body.dailyAiRequestLimit===undefined?undefined:body.dailyAiRequestLimit===0);
  const value={enabled:body.enabled,scoringPaused,intervalMinutes:body.intervalMinutes,dailyAiRequestLimit:body.dailyAiRequestLimit,scoringStartMonth:body.scoringStartMonth};
  await exec(`INSERT INTO app_settings(key,value_json,updated_at) VALUES('report_automation_config',${sql(JSON.stringify(value))},datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json=json_patch(app_settings.value_json,excluded.value_json),updated_at=excluded.updated_at;`);
  await audit(user,'周报自动收集与AI评分配置已保存',value);
 }
 async function saveMonthlyReminders(body,user){
  if(typeof body.enabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time||''))throw Error('invalid_monthly_reminders');
  const startMonth=body.startMonth===undefined?(await monthlyReminderConfig()).startMonth:body.startMonth;
  if(typeof startMonth!=='string'||startMonth!==''&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth))throw Error('invalid_monthly_reminders');
  if(body.enabled&&!(config.feishuAppId&&config.feishuAppSecret))throw Error('feishu_required');
  const value={enabled:body.enabled,time:body.time,startMonth};
  await exec(`INSERT INTO app_settings(key,value_json,updated_at) VALUES('month_end_score_reminders',${sql(JSON.stringify(value))},datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at;`);
  await audit(user,'月末评分提醒设置已保存',{...value,schedule:'last_two_workdays',timezone:'Asia/Shanghai'});
 }
 async function overview(){return {events:await eventOverview(),features:await featureSettings(),reportAutomation:await reportAutomationConfig(),monthlyReminders:await monthlyReminderConfig(),report:await reportOverview(),policy:await policyFor(month()),versions:await policies(),ai:{baseUrl:config.moonshotBaseUrl,model:config.kimiFollowupModel,keyConfigured:!!config.moonshotApiKey},currentMonth:month(),publication:{collaboration:'manager_30_peers_70_when_complete',leader:'boss_30_peers_70',quality:'management_confirmed_monthly',timeliness:'automatic_submission_statistics'},integration:{authMode:config.authMode,feishuConfigured:!!(config.feishuAppId&&config.feishuAppSecret),remindersEnabled:await scoringRemindersEnabled()}};}
 async function savePolicy(body,user){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.effectiveMonth||'')||body.effectiveMonth<=month())throw Error('future_cycle_required');
  const p=body.policy||{},weights=p.weights;
  if(!Array.isArray(weights)||weights.length!==4||weights.some(w=>typeof w!=='number'||!Number.isFinite(w)||w<0||w>100)||Math.abs(weights.reduce((a,b)=>a+b,0)-100)>.001)throw Error('invalid_weights');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.deadlineTime||''))throw Error('invalid_deadline');
  for(const field of ['reminderWaitHours','reminderCooldownHours'])if(!Number.isInteger(p[field])||p[field]<1||p[field]>720)throw Error('invalid_reminder_hours');
  const policy={weights,deadlineTime:p.deadlineTime,reminderWaitHours:p.reminderWaitHours,reminderCooldownHours:p.reminderCooldownHours};
  // Future versions are immutable too: one authoritative rule per cycle.
  if((await policies()).some(v=>v.effective_month===body.effectiveMonth))throw Error('policy_version_exists');
  await exec(`INSERT INTO system_policy_versions VALUES(${sql(body.effectiveMonth)},${sql(JSON.stringify(policy))},${sql(user.name)},datetime('now'));`);
  await audit(user,'评分与周期规则已保存',{effectiveMonth:body.effectiveMonth,policy});
 }
 function enqueueAiWrite(write){
  const result=aiWrites.then(write);
  aiWrites=result.catch(()=>{});
  return result;
 }
 async function saveAiSetting(initial,updateSql,{user,action,details,guardSql='',expectedBaseUrl}){
  // Check the saved address under the same write lock as the credential update.
  const addressMatches=expectedBaseUrl===undefined?'1':`COALESCE(
    (SELECT json_extract(value_json,'$.baseUrl') IS ${sql(expectedBaseUrl)} FROM app_settings WHERE key='ai_runtime'),
    ${Number(initial.baseUrl===expectedBaseUrl)})`;
  const [row]=await query(`BEGIN IMMEDIATE;
    INSERT INTO app_settings(key,value_json,updated_at)
    SELECT 'ai_runtime',${sql(JSON.stringify(initial))},datetime('now') WHERE ${addressMatches}
    ON CONFLICT(key) DO UPDATE SET value_json=${updateSql},updated_at=excluded.updated_at
    ${guardSql} RETURNING hex(value_json) AS value;
    INSERT OR ROLLBACK INTO system_operation_logs(id,actor_user_id,actor_name,action,details_json,created_at)
    SELECT ${sql(randomUUID())},${sql(user.userId)},${sql(user.name)},${sql(action)},
      json_set(${sql(JSON.stringify(details))},'$.keyConfigured',json(CASE WHEN NULLIF(json_extract(value_json,'$.encryptedKey'),'') IS NULL THEN 'false' ELSE 'true' END)),datetime('now')
    FROM app_settings WHERE key='ai_runtime' AND changes()=1;
    COMMIT;`);
  if(!row)throw Error(expectedBaseUrl===undefined?'ai_key_host_change_requires_clear':'ai_key_service_address_changed');
  applyAiSetting(readAiSetting(row));
 }
 async function saveAI(body,user){
  if(String(body.apiKey??'').trim()||body.clearKey)throw Error('ai_key_action_required');
  const baseUrl=String(body.baseUrl||'').replace(/\/$/,''),model=String(body.model||'').trim();
  const url=parseAiBaseUrl(baseUrl);
  if(!url)throw Error('invalid_ai_url');
  if(!model||model.length>150)throw Error('invalid_ai_model');
  return enqueueAiWrite(async()=>{
   const stored=await setting();
   const currentBaseUrl=stored?.baseUrl??config.moonshotBaseUrl;
   const sameOrigin=URL.canParse(currentBaseUrl)&&new URL(currentBaseUrl).origin===url.origin;
   const hasKey=stored?!!stored.encryptedKey:!!config.moonshotApiKey;
   if(hasKey&&!sameOrigin)throw Error('ai_key_host_change_requires_clear');
   // Preserve an environment-provided key on the first save. Existing rows keep their exact ciphertext.
   const initial={baseUrl,model,encryptedKey:!stored&&config.moonshotApiKey?encrypt(config.moonshotApiKey):''};
   // Recheck the origin snapshot if another process wrote a key or a different address while we waited.
   const matchingAddress=sameOrigin?` OR json_extract(app_settings.value_json,'$.baseUrl')=${sql(currentBaseUrl)}`:'';
   const guard=`WHERE NULLIF(json_extract(app_settings.value_json,'$.encryptedKey'),'') IS NULL${matchingAddress}`;
   await saveAiSetting(initial,`json_set(app_settings.value_json,'$.baseUrl',${sql(baseUrl)},'$.model',${sql(model)})`,{user,action:'AI 模型与服务地址已保存',details:{baseUrl,model},guardSql:guard});
  });
 }
 async function saveAIKey(body,user){
  const {action,expectedBaseUrl}=body;
  if(!['replace','clear'].includes(action))throw Error('invalid_ai_key_action');
  const apiKey=typeof body.apiKey==='string'?body.apiKey.trim():'';
  if(action==='replace'&&(!apiKey||apiKey.length>4000||/[\s\p{Cc}]/u.test(apiKey))||action==='clear'&&body.apiKey!==undefined)throw Error('invalid_ai_key');
  if(expectedBaseUrl!==undefined&&(typeof expectedBaseUrl!=='string'||!expectedBaseUrl||/\p{Cc}/u.test(expectedBaseUrl)))throw Error('invalid_ai_url');
  return enqueueAiWrite(async()=>{
   const encryptedKey=action==='replace'?encrypt(apiKey):'';
   const initial={baseUrl:config.moonshotBaseUrl,model:config.kimiFollowupModel,encryptedKey};
   await saveAiSetting(initial,`json_set(app_settings.value_json,'$.encryptedKey',${sql(encryptedKey)})`,{user,action:action==='replace'?'AI 服务密钥已替换':'AI 服务密钥已清除',details:{action},expectedBaseUrl});
   return {keyConfigured:!!config.moonshotApiKey};
  });
 }
 async function listAiModels(){
  const {moonshotBaseUrl:baseUrl,moonshotApiKey:apiKey}=config;
  const url=typeof baseUrl==='string'?parseAiBaseUrl(baseUrl):null;
  if(!url||typeof apiKey!=='string'||!apiKey||/[\s\p{Cc}]/u.test(apiKey))throw Error('ai_not_configured');
  const containsKey=value=>value===apiKey||(apiKey.length>=12&&value.includes(apiKey));
  if(containsKey(baseUrl))throw Error('ai_not_configured');
  url.pathname=url.pathname.replace(/\/+$/,'')+'/models';
  const signal=AbortSignal.timeout(AI_MODELS_TIMEOUT_MS);
  try{
   const response=await fetcher(url.href,{method:'GET',headers:{accept:'application/json',authorization:'Bearer '+apiKey},redirect:'error',signal});
   if(!response.ok){
    void response.body?.cancel().catch(()=>{});
    throw Error('ai_models_unavailable');
   }
   const value=await readAiModelsResponse(response);
   if(!Array.isArray(value?.data)||config.moonshotBaseUrl!==baseUrl||config.moonshotApiKey!==apiKey)throw Error('ai_models_unavailable');
   const models=new Set();
   for(const entry of value.data){
    const id=typeof entry?.id==='string'?entry.id.trim():'';
    if(!id||id.length>150||/[\s\p{Cc}]/u.test(id)||containsKey(id))continue;
    models.add(id);
    if(models.size===AI_MODELS_LIMIT)break;
   }
   return {baseUrl,models:[...models]};
  }catch(error){
   throw Error(signal.aborted||error?.name==='TimeoutError'?'ai_models_timeout':'ai_models_unavailable');
  }
 }
 async function logs(){return (await query('SELECT id,actor_name,action,hex(details_json) AS details_hex,created_at FROM system_operation_logs ORDER BY created_at DESC,rowid DESC LIMIT 100;')).map(r=>({...r,details:JSON.parse(Buffer.from(r.details_hex,'hex').toString('utf8')),details_hex:undefined}));}
 return {initialize,overview,saveReport,savePolicy,saveAI,saveAIKey,listAiModels,policyFor,policies,audit,logs,monthlyReminderConfig,saveMonthlyReminders,scoringRemindersEnabled,reportAutomationConfig,saveReportAutomation,reportAiRequestsToday,reserveReportAiRequest,eventOverview,saveEvents,featureSettings,saveFeatures};
}
