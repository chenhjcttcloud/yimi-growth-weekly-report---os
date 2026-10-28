import {createEmployeeIdentity,resolveFeishuLogin} from './employee-identity.mjs';
import {createFeishuDepartmentSync} from './feishu-department-sync.mjs';
import {createLiveReportSync} from './live-report-sync.mjs';
import { createSystemSettings } from './system-settings.mjs';
import { createDepartments } from './departments.mjs';
import { createPersonalScoringReminders } from './personal-scoring-reminders.mjs';
import { createSsoRoster } from './sso-roster.mjs';
import { createPersonalWorkspace } from "./personal-workspace.mjs";
import {createManagerReviews} from './manager-reviews.mjs';
import {createMonthEndScoreReminders} from './month-end-score-reminders.mjs';
import {createChinaWorkCalendar} from './china-work-calendar.mjs';
import {createReportAutomation} from './report-automation.mjs';
import {weeklyReportSchedule,fridayOfWeek} from './weekly-report-schedule.mjs';
import { createPerformance } from "./performance.mjs";
import { createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultScoring360ConfigManagers,
  isScoring360ConfigManager,
  isScoring360CycleForDate,
  parseScoring360LaunchDays,
  scoring360CycleForLaunchDate,
} from "./scoring360-policy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

loadDotEnv(path.join(rootDir, ".env"));

const config = {
  port: Number(process.env.SERVER_PORT || process.env.PORT || 5174),
  baseUrl: (process.env.BASE_URL || `http://localhost:${process.env.SERVER_PORT || 5174}`).replace(/\/$/, ""),
  authMode: process.env.AUTH_MODE || "feishu",
  devViewSwitchEnabled: process.env.AUTH_MODE === "mock" && process.env.DEV_VIEW_SWITCH_ENABLED === "true",
  sessionSecret: process.env.SESSION_SECRET || "dev-only-change-me",
  staticDir: path.resolve(rootDir, process.env.STATIC_DIR || "dist"),
  dataDir: path.resolve(rootDir, process.env.APP_DATA_DIR || "src/data"),
  dbPath: path.resolve(rootDir, process.env.WEEKLY_REPORT_DB_PATH || "outputs/demo/weekly-report-os.sqlite"),
  uploadDir: path.resolve(rootDir, process.env.WEEKLY_REPORT_UPLOAD_DIR || "outputs/uploads"),
  feishuAppId: process.env.FEISHU_APP_ID || "",
  feishuAppSecret: process.env.FEISHU_APP_SECRET || "",
  eventVerificationToken: process.env.FEISHU_EVENT_VERIFICATION_TOKEN || "",
  eventEncryptKey: process.env.FEISHU_EVENT_ENCRYPT_KEY || "",
  taskCreateEnabled: process.env.FEISHU_TASK_CREATE_ENABLED === "true",
  taskDueMode: process.env.FEISHU_TASK_DUE_MODE || "none",
  companyChatId: process.env.FEISHU_COMPANY_CHAT_ID || "",
  companyChatName: process.env.FEISHU_COMPANY_CHAT_NAME || "公司全员群",
  bossViewUserIds: process.env.BOSS_VIEW_USER_IDS || "",
  bossViewNames: process.env.BOSS_VIEW_NAMES || "",
  moonshotApiKey: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || "",
  moonshotBaseUrl: stripTrailingSlash(process.env.MOONSHOT_BASE_URL || process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1"),
  kimiFollowupModel: process.env.KIMI_FOLLOWUP_MODEL || process.env.KIMI_DEEP_MODEL || process.env.KIMI_MODEL || "kimi-k2.6",
  kimiFollowupTimeoutMs: Number(process.env.KIMI_FOLLOWUP_TIMEOUT_MS || 120000),
  larkReportAutoSyncEnabled: process.env.LARK_REPORT_AUTO_SYNC_ENABLED === "true",
  larkReportAutoSyncHour: Number(process.env.LARK_REPORT_AUTO_SYNC_HOUR || 8),
  larkReportAutoSyncExempt: process.env.LARK_REPORT_AUTO_SYNC_EXEMPT || "",
  weeklyReminderEnabled: process.env.WEEKLY_REMINDER_ENABLED === "true",
  weeklyReminderDay: Number(process.env.WEEKLY_REMINDER_DAY || 5),
  weeklyReminderHour: Number(process.env.WEEKLY_REMINDER_HOUR || 15),
  weeklyReminderMinute: Number(process.env.WEEKLY_REMINDER_MINUTE || 0),
  weeklyReminderIdentity: process.env.WEEKLY_REMINDER_FEISHU_IDENTITY || "bot",
  weeklyReminderRespectChinaHolidays: process.env.WEEKLY_REMINDER_RESPECT_CHINA_HOLIDAYS !== "false",
  weeklyReminderUseOutbox: process.env.WEEKLY_REMINDER_USE_OUTBOX !== "false",
  weeklyUpdateReminderEnabled: process.env.WEEKLY_UPDATE_REMINDER_ENABLED === "true",
  weeklyUpdateReminderDay: Number(process.env.WEEKLY_UPDATE_REMINDER_DAY || 1),
  weeklyUpdateReminderHour: Number(process.env.WEEKLY_UPDATE_REMINDER_HOUR || 10),
  weeklyUpdateReminderMinute: Number(process.env.WEEKLY_UPDATE_REMINDER_MINUTE || 30),
  scoring360ReminderEnabled: process.env.SCORING360_REMINDER_ENABLED === "true",
  scoring360ReminderDayOfMonth: Number(process.env.SCORING360_REMINDER_DAY_OF_MONTH || 25),
  scoring360ReminderDaysOfMonth: parseScoring360LaunchDays(
    process.env.SCORING360_REMINDER_DAYS_OF_MONTH,
    Number(process.env.SCORING360_REMINDER_DAY_OF_MONTH || 25),
  ),
  scoring360ReminderHour: Number(process.env.SCORING360_REMINDER_HOUR || 10),
  scoring360ReminderMinute: Number(process.env.SCORING360_REMINDER_MINUTE || 0),
  scoring360ReminderDueHours: Number(process.env.SCORING360_REMINDER_DUE_HOURS || 48),
  scoring360ReminderFollowupHours: Number(process.env.SCORING360_REMINDER_FOLLOWUP_HOURS || 24),
  scoring360HistoricalWeight: Number(process.env.SCORING360_HISTORICAL_WEIGHT || 0.3),
  scoring360CurrentWeight: Number(process.env.SCORING360_CURRENT_WEIGHT || 0.7),
  scoring360ReminderIdentity: process.env.SCORING360_REMINDER_FEISHU_IDENTITY || "bot",
  scoring360ActiveDate: process.env.SCORING360_ACTIVE_DATE || "",
  scoring360ConfigManagerUserIds: process.env.SCORING360_CONFIG_MANAGER_USER_IDS || "",
  scoring360ConfigManagerNames: process.env.SCORING360_CONFIG_MANAGER_NAMES || "",
  scoring360LaunchMode: process.env.SCORING360_LAUNCH_MODE === "scheduled" ? "scheduled" : "manual",
  scoring360RosterExempt: process.env.SCORING360_ROSTER_EXEMPT || process.env.LARK_REPORT_AUTO_SYNC_EXEMPT || "",
  larkAuthMonitorEnabled: process.env.LARK_AUTH_MONITOR_ENABLED !== "false",
  larkAuthMonitorIntervalMinutes: Number(process.env.LARK_AUTH_MONITOR_INTERVAL_MINUTES || 60),
  larkAuthMonitorThresholdHours: parseNumberList(process.env.LARK_AUTH_MONITOR_THRESHOLD_HOURS || "48,12"),
  larkAuthMonitorIdentity: process.env.LARK_AUTH_MONITOR_FEISHU_IDENTITY || "bot",
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const textHeaders = { "content-type": "text/plain; charset=utf-8" };

const defaultBossViewMembers = [];

const employeeDirectory = loadEmployeeDirectory();
const larkReportSyncStatusPath = path.join(rootDir, "outputs/lark-report-sync-status.json");
const scoring360DataPath = path.join(config.dataDir, "scoring360.json");
let chinaWorkCalendar = loadChinaWorkCalendar();
let larkReportSyncProcess = null;
let lastAutoSyncKey = "";

const bossAccessState = {
  userIds: new Set(parseCsvList(config.bossViewUserIds)),
  names: new Set(parseCsvList(config.bossViewNames)),
  members: [],
};

const scoring360AdminState = {
  userIds: new Set(),
  names: new Set(),
  members: [],
};

const employeeIdentity=createEmployeeIdentity({query:querySqlRows,exec:execSql,sql:sqlValue,strict:config.authMode!=='mock'});
await ensureDatabase();
await employeeIdentity.load();
await loadBossAccessState();
await loadScoring360AdminState();
await ensureScoring360SeedData();
await refreshEmployeeDirectory();
const syncSsoLogin=createSsoRoster({query:querySqlRows,exec:execSql,sql:sqlValue,getJson:feishuJson,registerIdentity:employeeIdentity.register});

const systemSettings=createSystemSettings({query:querySqlRows,exec:execSql,sql:sqlValue,config});
await systemSettings.initialize();
const calendarUpdates=createChinaWorkCalendar({query:querySqlRows,exec:execSql,sql:sqlValue,bundled:loadChinaWorkCalendar(),onChange:value=>{chinaWorkCalendar=value;},enabled:process.env.CHINA_CALENDAR_AUTO_UPDATE_ENABLED!=='false'});
await calendarUpdates.initialize();
const liveReportSync=createLiveReportSync({query:querySqlRows,exec:execSql,sql:sqlValue,config,settings:systemSettings,calendar:()=>chinaWorkCalendar,refreshDirectory:refreshEmployeeDirectory,writeStatus:writeLarkReportSyncStatus,onComplete:()=>performance.overview()});
if((await readLarkReportSyncStatus()).running)await writeLarkReportSyncStatus({ok:false,running:false,phase:'interrupted',message:'上次同步因服务重启中断，可点击同步继续；已保存的分析将复用。'});
const feishuDepartmentSync=createFeishuDepartmentSync({query:querySqlRows,exec:execSql,sql:sqlValue,config});
const departments=createDepartments({query:querySqlRows,exec:execSql,sql:sqlValue,employees:()=>loadManagedEmployees()});
let organizationMutationRunning=false;
const managerReviews=createManagerReviews({query:querySqlRows,exec:execSql,sql:sqlValue,organization:departments.overview,reports:()=>performance.reports(),isBossUserId:id=>bossAccessState.userIds.has(id)||(config.authMode==='mock'&&id==='mock_owner')});
const performance = createPerformance({managerReviews,calendar:()=>chinaWorkCalendar,policyFor:systemSettings.policyFor,query: querySqlRows, exec: execSql, sql: sqlValue, readData: name => JSON.parse(readFileSync(path.join(config.dataDir, `${name}.json`), 'utf8'))});
const reportAutomation=createReportAutomation({query:querySqlRows,exec:execSql,sql:sqlValue,getConfig:systemSettings.reportAutomationConfig,isRunning:()=>liveReportSync.isRunning(),start:options=>liveReportSync.start(options)});
const personalScoringReminders=createPersonalScoringReminders({managerReviews,bossUserIds:()=>[...bossAccessState.userIds],policyFor:systemSettings.policyFor,query:querySqlRows,exec:execSql,sql:sqlValue,
 enabled:Boolean(config.scoring360ReminderEnabled&&config.feishuAppId&&config.feishuAppSecret),
 deliver:async(userId,text,id)=>{
  const response=await feishuJson('/open-apis/im/v1/messages?receive_id_type=user_id',{method:'POST',token:await getFeishuTenantAccessToken(),body:{receive_id:userId,msg_type:'text',content:JSON.stringify({text}),uuid:id}});
  if(!response.data?.message_id)throw Error('missing_message_id');
  return response.data.message_id;
 }});


const monthEndScoreReminders=createMonthEndScoreReminders({query:querySqlRows,exec:execSql,sql:sqlValue,managerReviews,
 bossMembers:()=>[...bossAccessState.userIds].map(userId=>({userId,name:bossAccessState.members.find(m=>m.userId===userId)?.name||userId})),
 getSettings:systemSettings.monthlyReminderConfig,calendar:()=>chinaWorkCalendar,baseUrl:config.baseUrl,
 deliver:async(userId,text,uuid)=>{
  const response=await feishuJson('/open-apis/im/v1/messages?receive_id_type=user_id',{method:'POST',token:await getFeishuTenantAccessToken(),body:{receive_id:userId,msg_type:'text',content:JSON.stringify({text}),uuid}});
  return response.data?.message_id;
 }});

const personalWorkspace = createPersonalWorkspace({calendar:()=>chinaWorkCalendar,policyFor:systemSettings.policyFor,performance,readData:name=>JSON.parse(readFileSync(path.join(config.dataDir,`${name}.json`),'utf8')),query:querySqlRows,exec:execSql,sql:sqlValue,config,askAi:callKimiFollowup,createTask:(task,user,session)=>createFeishuTask(normalizeTaskCandidate({...task,useDueDate:true},user),session)});

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: "internal_server_error" });
  }
});

server.listen(config.port, () => {
  console.log(`weekly-report-os server listening on ${config.port}`);
});

scheduleAutomaticReportCollection();
scheduleWeeklyGrowthReminder();
scheduleWeeklyUpdateReminder();
scheduleMonthEndScoreReminders();
scheduleLarkAuthMonitor();

async function route(req, res) {
  const url = new URL(req.url || "/", config.baseUrl);

  if (url.pathname === '/api/dev/views') {
    res.setHeader('cache-control', 'no-store');
    if (!config.devViewSwitchEnabled) return sendJson(res,404,{ok:false,error:'not_found'});
    const views = developmentViews(getSession(req)?.user);
    if (req.method === 'GET') {
      const session=getSession(req);
      return sendJson(res,200,{ok:true,activeId:session?.devView?.id || 'boss',views:views.map(({user,...view})=>view)});
    }
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return sendJson(res,403,{ok:false,error:'invalid_origin'});
      if (!String(req.headers['content-type']||'').startsWith('application/json')) return sendJson(res,415,{ok:false,error:'json_required'});
      const body=await readJsonBody(req,{limitBytes:4096});
      const view=views.find(v=>v.id===body.id);
      if (!view) return sendJson(res,400,{ok:false,error:'invalid_view'});
      setSession(res,{user:view.user,devView:{id:view.id,role:view.role},issuedAt:Date.now(),expiresAt:new Date(Date.now()+86400000).toISOString()},{maxAge:86400});
      return sendJson(res,200,{ok:true});
    }
    return sendJson(res,405,{ok:false,error:'method_not_allowed'});
  }

  const sessionForPolicy = getSession(req);
  // Normal logins have no server-side deadline. Renew the persistent browser
  // cookie on activity, including usage heartbeats, and migrate old 7-day cookies.
  if (sessionForPolicy && !isExternalSession(sessionForPolicy) && !sessionForPolicy.devView && url.pathname !== "/auth/logout") {
    setSession(res, sessionForPolicy);
    res.setHeader("Cache-Control", "private, no-store");
  }
  const userForPolicy = sessionForPolicy?.user || (config.authMode === 'mock' ? mockUser() : null);
  if(url.pathname.startsWith('/api/') && userForPolicy && !isExternalSession(sessionForPolicy)) {
    const employee=(await querySqlRows(`SELECT is_active FROM employees WHERE user_id=${sqlValue(userForPolicy.userId)} LIMIT 1;`))[0];
    if(employee && Number(employee.is_active)===0) return sendJson(res,403,{ok:false,error:'account_inactive'});
  }
  const managerForPolicy = Boolean(userForPolicy && !isExternalSession(sessionForPolicy) && isScoring360ConfigManagerSession(sessionForPolicy));
  if(url.pathname.startsWith('/api/system-settings')) {
    if(!managerForPolicy)return sendJson(res,403,{ok:false,error:'manager_only'});
    res.setHeader('cache-control','no-store');
    if(req.method==='GET'&&url.pathname==='/api/system-settings')return sendJson(res,200,{ok:true,...await systemSettings.overview()});
    if(req.method==='GET'&&url.pathname==='/api/system-settings/logs')return sendJson(res,200,{ok:true,logs:await systemSettings.logs()});
    if(req.method==='GET'&&url.pathname==='/api/system-settings/report-automation')return sendJson(res,200,{ok:true,...await reportAutomation.overview()});
    if(req.method==='GET'&&url.pathname==='/api/system-settings/monthly-reminders'){
      try{return sendJson(res,200,{ok:true,...await monthEndScoreReminders.preview(url.searchParams.get('month')||undefined)});}
      catch(error){if(error.message==='invalid_month')return sendJson(res,400,{ok:false,error:'invalid_month'});throw error;}
    }
    if(req.method==='POST'){
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return sendJson(res,403,{ok:false,error:'invalid_origin'});
      const body=await readJsonBody(req,{limitBytes:15000});
      try{
        if(url.pathname==='/api/system-settings/policy')await systemSettings.savePolicy(body,userForPolicy);
        else if(url.pathname==='/api/system-settings/feishu-report')await systemSettings.saveReport(body,userForPolicy);
        else if(url.pathname==='/api/system-settings/ai')await systemSettings.saveAI(body,userForPolicy);
        else if(url.pathname==='/api/system-settings/monthly-reminders')await systemSettings.saveMonthlyReminders(body,userForPolicy);
        else if(url.pathname==='/api/system-settings/report-automation')await systemSettings.saveReportAutomation(body,userForPolicy);
        else return sendJson(res,404,{ok:false,error:'not_found'});
        return sendJson(res,200,{ok:true});
      }catch(error){return sendJson(res,400,{ok:false,error:['invalid_report_config','report_secret_required','future_cycle_required','invalid_weights','invalid_deadline','invalid_reminder_hours','policy_version_exists','invalid_ai_url','invalid_ai_model','invalid_monthly_reminders','feishu_required','invalid_report_automation','ai_required'].includes(error.message)?error.message:'settings_save_failed'});}
    }
    return sendJson(res,404,{ok:false,error:'not_found'});
  }
  if(url.pathname==='/api/scoring360/cycle'&&req.method==='POST'){
    if(!managerForPolicy)return sendJson(res,403,{ok:false,error:'manager_only'});
    if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return sendJson(res,403,{ok:false,error:'invalid_origin'});
    const body=await readJsonBody(req);if(!['prepare','open'].includes(body.action))return sendJson(res,400,{ok:false,error:'invalid_cycle_action'});
    const cycleId=await ensureScoring360CycleForLaunchDate(scoring360ActiveDate(),{copyAssignments:false});
    const cycle=await loadScoring360Cycle(cycleId);
    if(body.action==='open'){
      if(!['draft','open','active'].includes(cycle.status))return sendJson(res,409,{ok:false,error:'scoring_cycle_closed'});
      const assignments=await querySqlRows(`SELECT COUNT(*) AS count FROM scoring360_assignments WHERE cycle_id=${sqlValue(cycleId)} AND status='active';`);
      if(!Number(assignments[0]?.count))return sendJson(res,409,{ok:false,error:'scoring_assignments_required'});
      if(!cycle.launchAt)await ensureScoring360CycleSchedule(cycleId);
    }
    await systemSettings.audit(userForPolicy,body.action==='open'?'月度互评已开放（未发送通知）':'月度互评周期已准备（手动配置关系）',{cycleId});
    return sendJson(res,200,{ok:true,cycle:await loadScoring360Cycle(cycleId),messagesSent:0});
  }
  if(url.pathname==='/api/manager-reviews'){
    if(!userForPolicy||isExternalSession(sessionForPolicy))return sendJson(res,401,{ok:false,error:'unauthorized'});
    res.setHeader('cache-control','no-store');
    try{
      if(req.method==='GET')return sendJson(res,200,{ok:true,...await managerReviews.tasks(userForPolicy,url.searchParams.get('month'))});
      if(req.method==='POST'){
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return sendJson(res,403,{ok:false,error:'invalid_origin'});
        await managerReviews.submit(userForPolicy,await readJsonBody(req));await performance.overview();
        return sendJson(res,200,{ok:true});
      }
      return sendJson(res,405,{ok:false,error:'method_not_allowed'});
    }catch(error){const known=['invalid_month','score_and_comment_required','self_scoring_forbidden','not_your_subordinate','result_locked'];return sendJson(res,error.message==='not_your_subordinate'?403:409,{ok:false,error:error.message.includes('UNIQUE')?'result_locked':known.includes(error.message)?error.message:'manager_review_failed'});}
  }
  if(url.pathname.startsWith('/api/departments')) {
    if(!managerForPolicy)return sendJson(res,403,{ok:false,error:'manager_only'});
    res.setHeader('cache-control','no-store');
    if(req.method==='GET'&&url.pathname==='/api/departments/dashboard'){try{return sendJson(res,200,{ok:true,...await departments.dashboard(url.searchParams.get('month'),await performance.overview()),canScore:isBossIdentity(sessionForPolicy),currentUserId:userForPolicy.userId});}catch{return sendJson(res,400,{ok:false,error:'invalid_department_month'});}}
    if(req.method==='GET'&&url.pathname==='/api/departments')return sendJson(res,200,{ok:true,...await departments.overview(),canScore:isBossIdentity(sessionForPolicy),currentUserId:userForPolicy.userId});
    if(req.method==='POST'){
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return sendJson(res,403,{ok:false,error:'invalid_origin'});
      const body=await readJsonBody(req);
      const organizationMutation=['/api/departments/layout','/api/departments/save','/api/departments/sync-feishu'].includes(url.pathname);
      if(organizationMutation&&organizationMutationRunning)return sendJson(res,409,{ok:false,error:'department_layout_conflict'});
      if(organizationMutation)organizationMutationRunning=true;
      try{
        if(url.pathname==='/api/departments/sync-feishu'){const result=await feishuDepartmentSync.sync();await systemSettings.audit(userForPolicy,'飞书部门已同步',result);return sendJson(res,200,{ok:true,...result});}
        else if(url.pathname==='/api/departments/layout'){await departments.saveLayout(body);await systemSettings.audit(userForPolicy,'组织架构已更新',{departmentCount:body.departments.length});}
        else if(url.pathname==='/api/departments/save'){await departments.save(body);await systemSettings.audit(userForPolicy,'部门配置已更新',{department:body.name,leaderUserId:body.leaderUserId});}
        else if(url.pathname==='/api/departments/score'){
          if(!isBossIdentity(sessionForPolicy))return sendJson(res,403,{ok:false,error:'boss_only'});
          if((await querySqlRows(`SELECT leader_user_id FROM organization_departments WHERE id=${sqlValue(body.departmentId)};`))[0]?.leader_user_id===userForPolicy.userId)return sendJson(res,409,{ok:false,error:'self_scoring_forbidden'});
          await departments.score(body,userForPolicy);await performance.overview();await systemSettings.audit(userForPolicy,'老板负责人评分已发布',{departmentId:body.departmentId,month:body.month});
        }else return sendJson(res,404,{ok:false,error:'not_found'});
        return sendJson(res,200,{ok:true});
      }catch(error){const known=['department_layout_conflict','department_not_empty','department_inactive','department_sync_running','feishu_not_configured','department_permission_required','department_scope_required','department_scope_empty','department_names_permission_required','department_leader_user_id_required','department_leader_managed_by_feishu','department_ambiguous_names','department_incomplete_tree','department_invalid_pagination','department_upstream_failed','department_hierarchy_cycle','invalid_parent_department','invalid_department','leader_must_be_department_member','department_not_found','invalid_month','score_and_comment_required','department_leader_required','leader_inactive','leader_not_registered','result_locked'];return sendJson(res,409,{ok:false,error:error.message.includes('UNIQUE')?'department_exists':known.includes(error.message)?error.message:'department_save_failed'});}finally{if(organizationMutation)organizationMutationRunning=false;}
    }
    return sendJson(res,405,{ok:false,error:'method_not_allowed'});
  }
  if(url.pathname.startsWith('/api/admin/employee-preview')){
    res.setHeader('cache-control','no-store');
    if(!managerForPolicy)return sendJson(res,403,{ok:false,error:'manager_only'});
    if(req.method!=='GET')return sendJson(res,405,{ok:false,error:'preview_readonly'});
    const rows=await querySqlRows(`SELECT user_id,name,department FROM employees WHERE user_id=${sqlValue(url.searchParams.get('employeeId'))} LIMIT 1;`);
    const directoryEntry=employeeDirectory.find(e=>e.userId===url.searchParams.get('employeeId'));
    const employee=rows[0]||(directoryEntry?{user_id:directoryEntry.userId,name:directoryEntry.name}:null);if(!employee)return sendJson(res,404,{ok:false,error:'employee_not_found'});
    const user={userId:employee.user_id,name:employee.name};
    if(url.pathname==='/api/admin/employee-preview/workspace'){
      try{const workspace=await personalWorkspace.workspace(user,url.searchParams.get('month'),url.searchParams.get('weekId'));return sendJson(res,200,{ok:true,...workspace,collaborationProgress:await personalScoringReminders.status(user,workspace.month),preview:{readOnly:true,employeeId:user.userId,employeeName:user.name}});}catch{return sendJson(res,400,{ok:false,error:'invalid_preview_request'});}
    }
    if(url.pathname==='/api/admin/employee-preview/manager-reviews'){try{return sendJson(res,200,{ok:true,...await managerReviews.tasks(user,url.searchParams.get('month')),readOnly:true});}catch{return sendJson(res,400,{ok:false,error:'invalid_month'});}}
    if(url.pathname==='/api/admin/employee-preview/scoring-tasks'){
      const cycleId=await resolveScoring360CycleId(url.searchParams.get('cycleId'),{ensureCurrentRound:false});
      const cycle=cycleId?await loadScoring360Cycle(cycleId):null;
      if(!cycle?.launchAt||!['open','active'].includes(cycle.status))return sendJson(res,200,{ok:true,cycleId,tasks:[],readOnly:true});
      const tasks=await querySqlRows(`SELECT a.id,a.evaluee_name,r.id AS response_id,r.score,r.comment,r.submitted_at FROM scoring360_assignments a LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE a.cycle_id=${sqlValue(cycleId)} AND a.evaluator_user_id=${sqlValue(user.userId)} AND COALESCE(a.status,'active')='active' ORDER BY a.evaluee_name;`);
      return sendJson(res,200,{ok:true,cycleId,readOnly:true,tasks:tasks.map(r=>({id:r.id,evaluee:r.evaluee_name,score:r.score===''?null:Number(r.score),comment:r.comment||'',submitted:Boolean(r.response_id),locked:isScoring360Locked(r.submitted_at)}))});
    }
    return sendJson(res,404,{ok:false,error:'not_found'});
  }
  if (url.pathname.startsWith('/api/personal/')) {
    res.setHeader('cache-control','no-store');
    if(!userForPolicy) return sendJson(res,401,{ok:false,error:'unauthorized'});
    if(isExternalSession(sessionForPolicy)) return sendJson(res,403,{ok:false,error:'external_readonly'});
    const identity=employeeDirectory.find(e=>e.userId===userForPolicy.userId);
    // Workspace access is bound to directory identity, never to a name supplied by the client.
    const user={...userForPolicy,name:identity?.name||userForPolicy.name,userId:identity?.userId||userForPolicy.userId};
    if(url.searchParams.has('employeeId')&&url.searchParams.get('employeeId')!==user.userId) return sendJson(res,403,{ok:false,error:'self_only'});
    try {
      if(req.method==='GET'&&url.pathname==='/api/personal/workspace') {
        const workspace=await personalWorkspace.workspace(user,url.searchParams.get('month'),url.searchParams.get('weekId'));
        return sendJson(res,200,{ok:true,...workspace,collaborationProgress:await personalScoringReminders.status(user,workspace.month)});
      }
      if(req.method!=='POST')return sendJson(res,404,{ok:false,error:'not_found'});
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return sendJson(res,403,{ok:false,error:'invalid_origin'});
      if(!String(req.headers['content-type']||'').startsWith('application/json'))return sendJson(res,415,{ok:false,error:'json_required'});
      const body=await readJsonBody(req,{limitBytes:50000});
      if(body.employeeId&&body.employeeId!==user.userId)return sendJson(res,403,{ok:false,error:'self_only'});
      if(url.pathname==='/api/personal/collaboration/remind') return sendJson(res,200,{ok:true,...await personalScoringReminders.send(user,body.month)});

      if(url.pathname==='/api/personal/tasks/save')return sendJson(res,200,await personalWorkspace.saveTask(user,body));
      if(url.pathname==='/api/personal/tasks/create')return sendJson(res,200,await personalWorkspace.createTasks(user,sessionForPolicy,body));
      if(url.pathname==='/api/personal/comment')return sendJson(res,200,await personalWorkspace.interact(user,body,'comment'));
      if(url.pathname==='/api/personal/like')return sendJson(res,200,await personalWorkspace.interact(user,body,'like'));
      if(url.pathname==='/api/personal/coach')return sendJson(res,200,await personalWorkspace.chat(user,body));
      return sendJson(res,404,{ok:false,error:'not_found'});
    }catch(error){
      const known=['reminder_in_progress','reminder_not_due','invalid_month','future_month','week_not_found','task_not_found','task_already_created','task_content_required','invalid_due_date','report_not_submitted','invalid_comment','ai_not_configured','invalid_question','invalid_tasks','task_creation_in_progress','task_create_failed'];
      console.error('Personal workspace:',error.message);
      return sendJson(res,error.message==='ai_not_configured'?503:known.includes(error.message)?400:502,{ok:false,error:known.includes(error.message)?error.message:'personal_service_failed'});
    }
  }

  if (url.pathname.startsWith('/api/performance') || url.pathname === '/api/management-data') {
    if (!userForPolicy) return sendJson(res, 401, {ok:false,error:'unauthorized'});
    res.setHeader('cache-control', 'no-store');
    if (url.pathname === '/api/performance/me' && req.method === 'GET') {
      const identity=employeeDirectory.find(e=>e.userId===userForPolicy.userId);
      return sendJson(res,200,{ok:true,...await performance.personal(identity?.name||normalizeUserName(userForPolicy.name),identity?.userId||userForPolicy.userId)});
    }
    if (!managerForPolicy) return sendJson(res,403,{ok:false,error:'manager_only'});
    if (url.pathname === '/api/management-data' && req.method === 'GET') {
      const names=['prototypeData','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights','scoring360'];
      return sendJson(res,200,Object.fromEntries(names.map(name=>[name,JSON.parse(readFileSync(path.join(config.dataDir,`${name}.json`),'utf8'))])));
    }
    if (url.pathname === '/api/performance/manage' && req.method === 'GET') return sendJson(res,200,{ok:true,...await performance.overview()});
    if (url.pathname === '/api/performance/confirm' && req.method === 'POST') {
      return sendJson(res,409,{ok:false,error:'results_auto_published'});
    }
    return sendJson(res,404,{ok:false,error:'not_found'});
  }
  // The personal workspace above enforces self-only access; legacy process APIs remain manager-only.
  const employeeApis = ['/api/me','/api/performance/me','/api/scoring360/my-tasks','/api/scoring360/submit','/api/usage/visit','/api/usage/heartbeat','/api/feishu/events'];
  if (url.pathname.startsWith('/api/') && !managerForPolicy && !employeeApis.includes(url.pathname)) {
    if (url.pathname === '/api/scoring360' && req.method === 'GET' && userForPolicy) return sendJson(res,200,{ok:true,results:[],cycles:[],evaluatorOptions:[]});
    return sendJson(res,userForPolicy?403:401,{ok:false,error:'manager_only'});
  }

  if (req.method === 'GET' && url.pathname === '/api/settings/status') {
    res.setHeader('cache-control','no-store');
    const demoData=JSON.parse(readFileSync(path.join(config.dataDir,'prototypeData.json'),'utf8')).meta?.source_xlsx === 'RANDOM_DEVELOPMENT_FIXTURE';
    const feishuReady=Boolean(config.feishuAppId && config.feishuAppSecret);
    const aiReady=Boolean(config.moonshotApiKey);
    return sendJson(res,200,{ok:true,authMode:config.authMode,demoData,services:[
      {name:'登录与身份',ready:true,label:config.authMode==='mock'?'开发演示':'飞书认证',description:config.authMode==='mock'?'使用开发身份，可切换老板、管理员与员工视角。':'使用已配置的飞书身份认证。'},
      {name:'本地数据与存储',ready:true,label:'运行中',description:demoData?'虚构开发数据已载入；数据库与上传文件持久化保存。':'SQLite 数据库已连接，运行数据持久化保存。'},
      {name:'飞书服务',ready:feishuReady,label:feishuReady?'已配置':'未配置',description:feishuReady?'已提供应用凭据；实际可用范围以应用授权为准。':'尚未提供飞书应用凭据，本地人员、评分和审核功能可以继续使用。'},
      {name:'AI 分析服务',ready:aiReady,label:aiReady?'已配置':'未配置',description:aiReady?'已提供模型服务凭据；AI 只生成候选分析。':'当前展示已载入的候选分析，暂不执行实时 AI 调用。'},
      {name:'周报与协作提醒',ready:config.weeklyReminderEnabled||config.scoring360ReminderEnabled,label:config.weeklyReminderEnabled||config.scoring360ReminderEnabled?'已启用':'未开启',description:'周报提醒与评分提醒各自控制；开启外发前需配置并授权飞书服务。'},
    ]});
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "weekly-report-os",
      authMode: config.authMode,
      taskCreateEnabled: config.taskCreateEnabled,
      taskDueMode: config.taskDueMode,
      kimiFollowupConfigured: Boolean(config.moonshotApiKey),
      dbPath: config.dbPath,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const session = getSession(req);
    if (!session && config.authMode !== "mock") {
      sendJson(res, 401, { ok: false, authenticated: false });
      return;
    }
    const user = session?.user || mockUser();
    if (!isExternalSession(session)) {
      await recordAccountEvent(user, "session_resume", {
        targetType: "session",
        targetId: "api_me",
        points: 0,
      });
    }
    const access = buildAccessProfile(session, user);
    sendJson(res, 200, {
      ok: true,
      authenticated: true,
      devView: config.devViewSwitchEnabled ? (session?.devView || {id:"boss",role:"boss"}) : null,
      user: {
        ...user,
        role: access.role,
        bossView: access.bossView,
      },
      access,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    await listTasks(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/scoring360") {
    await getScoring360(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/scoring360/my-tasks") {
    await getMyScoring360Tasks(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/scoring360/config") {
    await getScoring360Config(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/scoring360/reminders") {
    await getScoring360ReminderStatus(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scoring360/submit") {
    await submitScoring360(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/notifications") {
    await listNotifications(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/contribution-activity") {
    await listContributionActivity(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/account-activity") {
    await listAccountActivity(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/external-links") {
    await listExternalLinks(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/boss-view-members") {
    await listBossViewMembers(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/scoring360-admin-members") {
    await listScoring360AdminMembers(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/employees/manage") {
    await listManagedEmployees(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/lark-report-sync") {
    await getLarkReportSyncStatus(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/weekly-reminders") {
    await getWeeklyReminderStatus(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ai/followups") {
    await listAiFollowups(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/share/")) {
    await enterExternalShare(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/login") {
    await startLogin(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/feishu/callback") {
    await finishFeishuLogin(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/logout") {
    clearCookie(res, "wos_session");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/company-message/send") {
    await sendCompanyMessage(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scoring360/assignments") {
    await createScoring360Assignment(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scoring360/reminders/send") {
    await sendScoring360Reminder(req, res);
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/scoring360/assignments") {
    await deleteScoring360Assignment(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/roster/audit") {
    await getRosterAudit(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/external-links") {
    await createExternalLink(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/boss-view-members") {
    await updateBossViewMembers(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scoring360-admin-members") {
    await updateScoring360AdminMembers(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/employees/manage") {
    await upsertManagedEmployee(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/employees/manage/status") {
    await updateManagedEmployeeStatus(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lark-report-sync") {
    await startLarkReportSync(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/weekly-reminders/send") {
    await sendWeeklyReminder(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/weekly-report") {
    await importWeeklyReport(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/usage/visit") {
    await recordUsageVisit(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/usage/heartbeat") {
    await recordUsageHeartbeat(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/social/comment") {
    await createSocialComment(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/social/reaction") {
    await createSocialReaction(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notifications/read") {
    await markNotificationsRead(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/followup") {
    await createAiFollowup(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tasks/create") {
    await createTasks(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/feishu/events") {
    await handleFeishuEvent(req, res);
    return;
  }

  if (req.method === "GET") {
    const session = getSession(req);
    if (!session && config.authMode !== "mock" && requiresStaticAuth(url.pathname)) {
      redirect(res, `/auth/login?next=${encodeURIComponent(safeNext(url.pathname + url.search))}`);
      return;
    }
    await serveStatic(url, res);
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
}

async function startLogin(_req, res, url) {
  if (config.authMode === "mock" && url.searchParams.get("provider") !== "feishu") {
    setSession(res, { user: mockUser(), issuedAt: Date.now() });
    redirect(res, url.searchParams.get("next") || "/");
    return;
  }
  assertFeishuAppId();
  const statePayload = {
    nonce: randomBytes(16).toString("hex"),
    next: safeNext(url.searchParams.get("next") || "/"),
    issuedAt: Date.now(),
  };
  const state = signPayload(statePayload);
  setCookie(res, "wos_oauth_state", state, { maxAge: 600, httpOnly: true });
  const redirectUri = `${config.baseUrl}/auth/feishu/callback`;
  const authUrl = new URL("https://open.feishu.cn/open-apis/authen/v1/index");
  authUrl.searchParams.set("app_id", config.feishuAppId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  redirect(res, authUrl.toString());
}

async function finishFeishuLogin(req, res, url) {
  assertFeishuConfig();
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const cookieState = parseCookies(req).wos_oauth_state || "";
  const statePayload = verifyPayload(state);

  if (!code || !statePayload || state !== cookieState) {
    sendJson(res, 400, { ok: false, error: "invalid_oauth_state" });
    return;
  }

  const appToken = await getFeishuAppAccessToken();
  const tokenData = await feishuJson("/open-apis/authen/v1/access_token", {
    method: "POST",
    token: appToken,
    body: { grant_type: "authorization_code", code },
  });
  const userAccessToken = tokenData.data?.access_token;
  if (!userAccessToken) throw new Error(`Feishu auth token missing: ${JSON.stringify(tokenData)}`);

  const userInfo = await feishuJson("/open-apis/authen/v1/user_info", {
    method: "GET",
    token: userAccessToken,
  });
  const data = userInfo.data || {};
  const user=await resolveFeishuLogin(data,async openId=>{const result=await feishuJson(`/open-apis/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,{method:'GET',token:await getFeishuTenantAccessToken()});return result.data?.user||{};});
  const roster=await syncSsoLogin(user,userAccessToken);
  await refreshEmployeeDirectory();
  if(!roster.active) {
    clearCookie(res,"wos_session");clearCookie(res,"wos_oauth_state");
    return send(res,403,{"content-type":"text/html; charset=utf-8"},"<h2>账号已停用</h2><p>请联系公司管理员。重新通过飞书登录不会自动恢复账号。</p>");
  }
  setSession(res, {
    user,
    issuedAt: Date.now(),
    userAccessToken,
  });
  await recordAccountEvent(user, "login_success", {
    targetType: "session",
    targetId: "feishu_sso",
    points: 2,
  });
  clearCookie(res, "wos_oauth_state");
  redirect(res, safeNext(statePayload.next || "/"));
}

async function createTasks(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  const body = await readJsonBody(req);
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  if (candidates.length === 0) {
    sendJson(res, 400, { ok: false, error: "empty_candidates" });
    return;
  }

  const results = [];
  const currentUser = session?.user || (config.authMode === "mock" ? mockUser() : null);
  for (const candidate of candidates.slice(0, 50)) {
    const normalized = normalizeTaskCandidate(candidate, currentUser);
    if (!config.taskCreateEnabled) {
      results.push({ ok: true, dryRun: true, candidateId: normalized.candidateId, request: normalized });
      continue;
    }
    const created = await createFeishuTask(normalized, session);
    await persistCreatedTask(normalized, created);
    results.push({ ok: true, dryRun: false, candidateId: normalized.candidateId, feishu: created });
  }
  sendJson(res, 200, { ok: true, taskCreateEnabled: config.taskCreateEnabled, results });
}

async function sendCompanyMessage(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }

  const user = session?.user || mockUser();
  const body = await readJsonBody(req, { limitBytes: 80_000 });
  const finalMessage = String(body.message || "").trim();
  const originalDraft = String(body.originalDraft || "").trim();
  const periodId = String(body.periodId || "").trim().slice(0, 80);
  const periodLabel = String(body.periodLabel || "").trim().slice(0, 80);
  if (!finalMessage) {
    sendJson(res, 400, { ok: false, error: "empty_message" });
    return;
  }
  if (finalMessage.length > 5000) {
    sendJson(res, 400, { ok: false, error: "message_too_long" });
    return;
  }
  if (!config.companyChatId) {
    sendJson(res, 500, { ok: false, error: "company_chat_not_configured" });
    return;
  }

  const idempotencyKey = String(body.idempotencyKey || `wos-company-${periodId || "latest"}-${Date.now()}`)
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 64);
  const sendResult = await sendCompanyMessageToFeishu(session, finalMessage, idempotencyKey);
  const responsePayload = sendResult.payload;
  const feishuMessageId = String(responsePayload?.data?.message_id || responsePayload?.message_id || "");
  const recordId = randomUUID();
  await execSql(`
    INSERT INTO company_message_sends
      (id, period_id, period_label, chat_id, chat_name, original_draft, final_message,
       sent_by_user_id, sent_by_name, feishu_message_id, idempotency_key, status, raw_response_json)
    VALUES
      (${sqlValue(recordId)}, ${sqlValue(periodId)}, ${sqlValue(periodLabel)}, ${sqlValue(config.companyChatId)},
       ${sqlValue(config.companyChatName)}, ${sqlValue(originalDraft || finalMessage)}, ${sqlValue(finalMessage)},
       ${sqlValue(user.userId)}, ${sqlValue(user.name)}, ${sqlValue(feishuMessageId)}, ${sqlValue(idempotencyKey)},
       ${sqlValue(sendResult.ok ? "sent" : "failed")}, ${sqlValue(JSON.stringify(responsePayload))});
  `);

  if (!sendResult.ok) {
    sendJson(res, 502, {
      ok: false,
      error: "feishu_send_failed",
      recordId,
      detail: responsePayload.error,
      stderr: responsePayload.stderr,
      transport: sendResult.transport,
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    recordId,
    chatId: config.companyChatId,
    chatName: config.companyChatName,
    messageId: feishuMessageId,
    idempotencyKey,
    transport: sendResult.transport,
    feishu: responsePayload,
  });
}

async function getWeeklyReminderStatus(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  const context = await loadWeeklyReminderContext();
  const rows = await querySqlRows(`
    SELECT period_id, period_label, recipient_name, department, status, identity, feishu_message_id, created_at
    FROM weekly_reminder_sends
    ORDER BY created_at DESC
    LIMIT 80;
  `).catch(() => []);
  const todayWorkday = getChinaWorkdayStatus(dateInShanghai(new Date()));
  const mondayOutboxPeriodId = buildWeeklyReminderOutboxPeriodId(context.period.id, "monday_update");
  const outboxRows = await querySqlRows(`
    SELECT period_id, status, COUNT(*) AS count
    FROM weekly_reminder_outbox
    WHERE period_id IN (${sqlValue(context.period.id)}, ${sqlValue(mondayOutboxPeriodId)})
    GROUP BY period_id, status
    ORDER BY period_id, status;
  `).catch(() => []);
  const outboxItems = await querySqlRows(`
    SELECT id, period_id, period_label, recipient_name, department, message, personalization_note,
           provider, model, status, sent_at, created_at, updated_at
    FROM weekly_reminder_outbox
    WHERE period_id IN (${sqlValue(context.period.id)}, ${sqlValue(mondayOutboxPeriodId)})
    ORDER BY period_id DESC, recipient_name ASC, updated_at DESC
    LIMIT 120;
  `).catch(() => []);
  sendJson(res, 200, {
    ok: true,
    enabled: config.weeklyReminderEnabled,
    schedule: {
      day: config.weeklyReminderDay,
      hour: config.weeklyReminderHour,
      minute: config.weeklyReminderMinute,
      timezone: "Asia/Shanghai",
      identity: config.weeklyReminderIdentity,
    },
    updateSchedule: {
      enabled: config.weeklyUpdateReminderEnabled,
      day: config.weeklyUpdateReminderDay,
      hour: config.weeklyUpdateReminderHour,
      minute: config.weeklyUpdateReminderMinute,
      timezone: "Asia/Shanghai",
      identity: config.weeklyReminderIdentity,
    },
    chinaWorkday: {
      enabled: config.weeklyReminderRespectChinaHolidays,
      ...todayWorkday,
      source: chinaWorkCalendar.source || "",
    },
    outbox: {
      enabled: config.weeklyReminderUseOutbox,
      fridayPeriodId: context.period.id,
      mondayPeriodId: mondayOutboxPeriodId,
      counts: outboxRows.map((row) => ({
        periodId: row.period_id,
        status: row.status,
        count: Number(row.count || 0),
      })),
      items: outboxItems.map((row) => ({
        id: row.id,
        periodId: row.period_id,
        periodLabel: row.period_label,
        kind: String(row.period_id || "").includes("monday_update") ? "monday_update" : "friday_review",
        recipientName: row.recipient_name,
        department: row.department,
        message: row.message,
        personalizationNote: row.personalization_note,
        provider: row.provider,
        model: row.model,
        status: row.status,
        sentAt: row.sent_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    },
    period: context.period,
    exemptPeople: context.exemptPeople,
    recipients: context.recipients.map((recipient) => ({
      userId: recipient.userId,
      name: recipient.name,
      department: recipient.department,
    })),
    recentSends: rows,
  });
}

async function sendWeeklyReminder(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  const user = session?.user || mockUser();
  const body = await readJsonBody(req, { limitBytes: 20_000 });
  const result = await runWeeklyGrowthReminder({
    dryRun: body.dryRun !== false,
    force: body.force === true,
    source: "manual",
    actor: user,
    kind: body.kind === "monday_update" ? "monday_update" : "friday_review",
  });
  sendJson(res, 200, result);
}

async function createAiFollowup(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  const body = await readJsonBody(req, { limitBytes: 120_000 });
  const question = String(body.question || "").trim();
  const candidateId = String(body.candidate?.id || body.candidateId || "").trim();
  if (!question) {
    sendJson(res, 400, { ok: false, error: "empty_question" });
    return;
  }
  if (!candidateId) {
    sendJson(res, 400, { ok: false, error: "empty_candidate_id" });
    return;
  }
  const user = session?.user || mockUser();
  try {
    const userMessage = await persistAiFollowupMessage({
      candidateId,
      role: "user",
      authorUserId: user.userId,
      authorName: user.name,
      body: question,
      metadata: { employeeName: body.employeeName || "", candidateTitle: body.candidate?.title || "" },
    });
    await createNotification({
      recipientUserId: String(body.employeeUserId || ""),
      recipientName: String(body.employeeName || ""),
      actorUserId: user.userId,
      actorName: user.name,
      eventType: "ai_followup",
      targetType: "task_candidate",
      targetId: candidateId,
      targetEmployeeName: String(body.employeeName || ""),
      title: `${user.name} 追问了你的周报任务`,
      body: question,
      payload: { candidateTitle: body.candidate?.title || "", candidateId },
    });
    if (!config.moonshotApiKey) {
      sendJson(res, 503, { ok: false, error: "kimi_not_configured", messages: [userMessage] });
      return;
    }
    const answer = await callKimiFollowup({
      candidate: body.candidate || {},
      question,
      messages: Array.isArray(body.messages) ? body.messages : [],
      employeeName: String(body.employeeName || ""),
      userName: user.name,
    });
    const assistantMessage = await persistAiFollowupMessage({
      candidateId,
      role: "assistant",
      authorUserId: "kimi",
      authorName: "Kimi",
      body: answer,
      provider: "kimi",
      model: config.kimiFollowupModel,
      metadata: { employeeName: body.employeeName || "", candidateTitle: body.candidate?.title || "" },
    });
    sendJson(res, 200, {
      ok: true,
      provider: "kimi",
      model: config.kimiFollowupModel,
      answer,
      messages: [userMessage, assistantMessage],
    });
  } catch (error) {
    console.error("Kimi followup failed", error);
    sendJson(res, 502, { ok: false, error: "kimi_followup_failed" });
  }
}

async function listNotifications(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  const user = session?.user || mockUser();
  const bossView = isBossSession(session);
  const where = bossView
    ? "1 = 1"
    : `(recipient_user_id = ${sqlValue(user.userId)} OR recipient_name = ${sqlValue(user.name)})`;
  const rows = await querySqlRows(`
    SELECT id, event_type, target_type, target_id, target_employee_name, recipient_name, actor_name, title, body, read_at, created_at
    FROM notifications
    WHERE ${where}
    ORDER BY datetime(created_at) DESC
    LIMIT 50;
  `);
  const countRows = await querySqlRows(`
    SELECT COUNT(*) AS count
    FROM notifications
    WHERE ${where} AND read_at IS NULL;
  `);
  sendJson(res, 200, {
    ok: true,
    unreadCount: Number(countRows[0]?.count || 0),
    notifications: rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      targetType: row.target_type,
      targetId: row.target_id,
      targetEmployeeName: row.target_employee_name,
      actorName: row.actor_name,
      title: bossView ? bossNotificationTitle(row) : row.title,
      body: row.body,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
  });
}

function bossNotificationTitle(row) {
  const actor = row.actor_name || "有人";
  const target = row.target_employee_name || row.recipient_name || "同事";
  if (row.event_type === "reaction") return `${actor} 点赞了 ${target} 的周报`;
  if (row.event_type === "ai_followup") return `${actor} 追问了 ${target} 的周报任务`;
  if (row.event_type === "comment") return `${actor} 评论了 ${target} 的周报`;
  return row.title;
}

async function markNotificationsRead(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  const user = session?.user || mockUser();
  const body = await readJsonBody(req, { limitBytes: 20_000 });
  const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id).trim()).filter(Boolean).slice(0, 100) : [];
  const allowed = isBossSession(session)
    ? "1 = 1"
    : `(recipient_user_id = ${sqlValue(user.userId)} OR recipient_name = ${sqlValue(user.name)})`;
  const target = ids.length > 0
    ? `id IN (${ids.map(sqlValue).join(", ")})`
    : "read_at IS NULL";
  await execSql(`
    UPDATE notifications
    SET read_at = datetime('now')
    WHERE ${allowed} AND ${target};
  `);
  sendJson(res, 200, { ok: true });
}

async function createSocialComment(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  const user = session?.user || mockUser();
  const body = await readJsonBody(req, { limitBytes: 60_000 });
  const text = String(body.body || "").trim();
  if (!text) {
    sendJson(res, 400, { ok: false, error: "empty_comment" });
    return;
  }
  const id = randomUUID();
  const targetType = String(body.targetType || "weekly_report");
  const targetId = String(body.targetId || body.employeeName || "unknown");
  const employeeName = String(body.employeeName || "");
  await execSql(`
    INSERT INTO comments (id, target_type, target_id, author_user_id, author_name, body, visibility)
    VALUES (${sqlValue(id)}, ${sqlValue(targetType)}, ${sqlValue(targetId)}, ${sqlValue(user.userId)}, ${sqlValue(user.name)}, ${sqlValue(text)}, 'department');
  `);
  await createNotification({
    recipientUserId: String(body.employeeUserId || ""),
    recipientName: employeeName,
    actorUserId: user.userId,
    actorName: user.name,
    eventType: "comment",
    targetType,
    targetId,
    targetEmployeeName: employeeName,
    title: `${user.name} 评论了你的周报`,
    body: text,
    payload: { commentId: id },
  });
  sendJson(res, 200, { ok: true, comment: { id, body: text, authorName: user.name } });
}

async function createSocialReaction(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  const user = session?.user || mockUser();
  const body = await readJsonBody(req, { limitBytes: 20_000 });
  const targetType = String(body.targetType || "weekly_report");
  const targetId = String(body.targetId || body.employeeName || "unknown");
  const reactionType = String(body.reactionType || "like");
  const employeeName = String(body.employeeName || "");
  await execSql(`
    INSERT OR IGNORE INTO reactions (id, target_type, target_id, actor_user_id, reaction_type)
    VALUES (${sqlValue(randomUUID())}, ${sqlValue(targetType)}, ${sqlValue(targetId)}, ${sqlValue(user.userId)}, ${sqlValue(reactionType)});
  `);
  await createNotification({
    recipientUserId: String(body.employeeUserId || ""),
    recipientName: employeeName,
    actorUserId: user.userId,
    actorName: user.name,
    eventType: "reaction",
    targetType,
    targetId,
    targetEmployeeName: employeeName,
    title: `${user.name} 点赞了你的周报`,
    body: "你的周报收到了新的认可。",
    payload: { reactionType },
  });
  sendJson(res, 200, { ok: true });
}

async function createNotification({
  recipientUserId = "",
  recipientName = "",
  actorUserId = "",
  actorName = "",
  eventType,
  targetType = "",
  targetId = "",
  targetEmployeeName = "",
  title,
  body = "",
  payload = {},
}) {
  if (!recipientUserId && !recipientName) return null;
  const id = randomUUID();
  await execSql(`
    INSERT INTO notifications
      (id, recipient_user_id, recipient_name, actor_user_id, actor_name, event_type, target_type, target_id,
       target_employee_name, title, body, payload_json)
    VALUES
      (${sqlValue(id)}, ${sqlValue(recipientUserId)}, ${sqlValue(recipientName)}, ${sqlValue(actorUserId)}, ${sqlValue(actorName)},
       ${sqlValue(eventType)}, ${sqlValue(targetType)}, ${sqlValue(targetId)}, ${sqlValue(targetEmployeeName)},
       ${sqlValue(title)}, ${sqlValue(body)}, ${sqlValue(JSON.stringify(payload))});
  `);
  return id;
}

async function listAiFollowups(req, res, url) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  const candidateId = String(url.searchParams.get("candidateId") || "").trim();
  if (!candidateId) {
    sendJson(res, 400, { ok: false, error: "empty_candidate_id" });
    return;
  }
  const rows = await querySqlRows(`
    SELECT id, candidate_id, role, author_user_id, author_name, hex(body) AS body_hex, provider, model, created_at
    FROM ai_followup_messages
    WHERE candidate_id = ${sqlValue(candidateId)}
    ORDER BY datetime(created_at) ASC, id ASC
    LIMIT 200;
  `);
  sendJson(res, 200, { ok: true, messages: rows.map(aiFollowupRowToMessage) });
}

async function persistAiFollowupMessage({ candidateId, role, authorUserId, authorName, body, provider = "", model = "", metadata = {} }) {
  const id = randomUUID();
  await execSql(`
    INSERT INTO ai_followup_messages
      (id, candidate_id, role, author_user_id, author_name, body, provider, model, metadata_json)
    VALUES
      (${sqlValue(id)}, ${sqlValue(candidateId)}, ${sqlValue(role)}, ${sqlValue(authorUserId)}, ${sqlValue(authorName)},
       ${sqlValue(body)}, ${sqlValue(provider)}, ${sqlValue(model)}, ${sqlValue(JSON.stringify(metadata))});
  `);
  return {
    id,
    candidateId,
    role,
    authorUserId,
    authorName,
    body,
    provider,
    model,
    createdAt: new Date().toISOString(),
  };
}

function aiFollowupRowToMessage(row) {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    role: row.role,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    body: row.body_hex ? Buffer.from(row.body_hex, "hex").toString("utf8") : "",
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
  };
}

async function callKimiFollowup({ candidate, question, messages, employeeName, userName }) {
  const contextPack = {
    employeeName,
    currentUser: userName,
    taskCandidate: {
      priority: candidate.priority,
      title: candidate.title,
      owner: candidate.owner,
      department: candidate.department,
      description: candidate.description,
      suggestedCloseDate: candidate.dueDate,
      metric: candidate.metric,
      evidence: candidate.evidence,
      aiIntent: candidate.aiIntent,
      firstStep: candidate.firstStep,
      supportNeeded: candidate.supportNeeded,
      contextNeed: candidate.contextNeed,
    },
    recentConversation: messages.slice(-8),
    question,
  };
  const response = await fetch(`${config.moonshotBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${config.moonshotApiKey}`,
    },
    body: JSON.stringify({
      model: config.kimiFollowupModel,
      messages: [
        {
          role: "system",
          content: [
            "你是成长周报 OS 的 AI 执行教练，服务对象是正在把周报问题转成飞书任务的员工和管理者。",
            "必须直接回答用户追问，不要复读任务描述，不要泛泛鼓励。",
            "你需要基于任务候选、周报证据、验收指标和已有对话，给出可执行方案。",
            "如果用户问到外部工具能力而上下文不足，要明确区分事实、推断和建议，并给出验证路径。",
            "输出中文，控制在 4 到 8 句话；可以用短段落，但不要输出 Markdown 表格。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `请基于以下上下文回答最后的追问：\n${JSON.stringify(contextPack, null, 2)}`,
        },
      ],
      max_completion_tokens: 1200,
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(config.kimiFollowupTimeoutMs),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || text || response.statusText;
    throw new Error(`Kimi ${response.status}: ${message}`);
  }
  const answer = (data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.reasoning_content || "").trim();
  if (!answer) throw new Error("Kimi returned empty answer");
  return answer;
}

async function handleFeishuEvent(req, res) {
  const rawBody = await readJsonBody(req, { limitBytes: 2_000_000 });
  const body = unwrapFeishuEventBody(rawBody);
  if (body.challenge) {
    if (config.eventVerificationToken && body.token && body.token !== config.eventVerificationToken) {
      sendJson(res, 403, { ok: false, error: "invalid_event_token" });
      return;
    }
    sendJson(res, 200, { challenge: body.challenge });
    return;
  }

  if (config.eventVerificationToken && body.token && body.token !== config.eventVerificationToken) {
    sendJson(res, 403, { ok: false, error: "invalid_event_token" });
    return;
  }

  const eventType = body.header?.event_type || body.type || "feishu_event";
  await updateFeishuTaskFromEvent(body, eventType);
  await execSql(`
    INSERT INTO contribution_events (id, actor_user_id, actor_name, event_type, target_type, target_id, points, payload_json)
    VALUES (${sqlValue(randomUUID())}, ${sqlValue("system")}, ${sqlValue("Feishu Event")}, ${sqlValue(eventType)},
            ${sqlValue("feishu_event")}, ${sqlValue(extractTaskGuid(body) || body.header?.event_id || body.uuid || randomUUID())}, 0, ${sqlValue(JSON.stringify(body))});
  `);
  sendJson(res, 200, { ok: true });
}

async function listTasks(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (!isScoring360ConfigManagerSession(session) && !isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  const rows = await querySqlRows(`
    SELECT guid, candidate_id, summary, assignee_user_id, due_date, url, status, created_at, updated_at
    FROM feishu_tasks
    ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
    LIMIT 200;
  `);
  const tasks = rows.map((row) => ({
    guid: row.guid,
    candidateId: row.candidate_id,
    summary: row.summary,
    assigneeUserId: row.assignee_user_id,
    dueDate: row.due_date,
    url: row.url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  sendJson(res, 200, { ok: true, tasks });
}

async function getScoring360(req, res, url) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  const user = session?.user || mockUser();
  const access = buildAccessProfile(session, user);
  const evaluatorOptions = access.bossView || access.canManageScoring360
    ? (await loadManagedEmployees()).map((employee) => employee.userId).filter(Boolean)
    : [user.userId].filter(Boolean);
  const cycleId = await resolveScoring360CycleId(url.searchParams.get("cycleId"), { ensureCurrentRound: true });
  if (!cycleId) {
    sendJson(res, 200, { ok: true, cycles: [], results: [], stats: null, evaluatorOptions });
    return;
  }

  const cycleRows = await querySqlRows(`
    SELECT id, label, mode, start_date, end_date, launch_at, due_at, followup_after_at,
           historical_weight, current_weight, status, total_employees, total_evaluees, created_at, updated_at
    FROM scoring360_cycles
    WHERE id = ${sqlValue(cycleId)}
    LIMIT 1;
  `);
  const cycleRow = cycleRows[0] || null;
  const previousScores = cycleRow ? await loadPreviousScoring360Scores(cycleRow) : new Map();
  const resultRows = await querySqlRows(`
    SELECT
      a.evaluee_name AS name, a.evaluee_user_id AS user_id,
      COUNT(a.id) AS expected,
      COUNT(r.id) AS submitted,
      ROUND(CASE WHEN COUNT(a.id) = 0 THEN 0 ELSE COUNT(r.id) * 100.0 / COUNT(a.id) END, 1) AS completion_rate,
      ROUND(AVG(r.score), 1) AS average_score,
      MIN(r.score) AS min_score,
      MAX(r.score) AS max_score,
      GROUP_CONCAT(CASE WHEN r.id IS NOT NULL THEN r.evaluator_name END, '、') AS evaluators
    FROM scoring360_assignments a
    LEFT JOIN scoring360_responses r ON r.assignment_id = a.id
    WHERE a.cycle_id = ${sqlValue(cycleId)}
      AND (COALESCE(a.status, 'active') = 'active' OR r.id IS NOT NULL)
    GROUP BY a.evaluee_user_id
    ORDER BY average_score DESC, completion_rate DESC, name ASC;
  `);
  const visibleNames = new Set(access.visibleNames);
  const results = resultRows
    .filter((row) => access.bossView || access.canManageScoring360 || row.user_id===user.userId)
    .map((row) => formatScoring360Result(row, {
      previousScore: previousScores.get(row.user_id),
      historicalWeight: cycleRow?.historical_weight,
      currentWeight: cycleRow?.current_weight,
    }));
  const stats = results.reduce((acc, item) => {
    acc.expected += item.expected;
    acc.submitted += item.submitted;
    if (item.averageScore !== null) acc.scoreSum += item.averageScore;
    return acc;
  }, { expected: 0, submitted: 0, scoreSum: 0 });
  const responseStats = {
    expected: stats.expected,
    submitted: stats.submitted,
    progressPct: stats.expected ? Number(((stats.submitted / stats.expected) * 100).toFixed(1)) : 0,
    averageScore: results.length ? Number((stats.scoreSum / results.length).toFixed(1)) : 0,
  };
  const cycle = cycleRow ? {
    ...formatScoring360Cycle(cycleRow),
    totalAssignments: responseStats.expected,
    totalResponses: responseStats.submitted,
    progressPct: responseStats.progressPct,
    averageScore: responseStats.averageScore,
  } : null;

  sendJson(res, 200, {
    ok: true,
    cycle,
    results,
    stats: responseStats,
    evaluatorOptions,
  });
}

async function getMyScoring360Tasks(req, res, url) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_readonly" });
    return;
  }
  const user = session?.user || mockUser();
  const canSelectEvaluator = isBossSession(session) || isScoring360ConfigManagerSession(session);
  const evaluator = canSelectEvaluator && url.searchParams.get("evaluator")
    ? normalizeUserName(url.searchParams.get("evaluator"))
    : normalizeUserName(user.name);
  const selectedEvaluator = canSelectEvaluator && (url.searchParams.get("evaluatorUserId") || url.searchParams.get("evaluator")) ? await findActiveManagedEmployee(url.searchParams.get("evaluatorUserId") || evaluator) : user;
  const evaluatorUserId = selectedEvaluator?.userId || "";
  const cycleId = await resolveScoring360CycleId(url.searchParams.get("cycleId"), { ensureCurrentRound: true });
  if (!cycleId || !evaluatorUserId) {
    sendJson(res, 200, { ok: true, cycleId, evaluator, tasks: [] });
    return;
  }
  const cycle = await loadScoring360Cycle(cycleId);
  const cycleOpen = Boolean(
    cycle?.launchAt
      && ["open", "active"].includes(cycle.status),
  );
  if (!cycleOpen && !canSelectEvaluator) {
    sendJson(res, 200, { ok: true, cycleId, evaluator, tasks: [] });
    return;
  }

  const rows = await querySqlRows(`
    SELECT
      a.id, a.cycle_id, a.evaluee_name, a.evaluator_name, a.created_at,
      r.id AS response_id, r.score, r.comment, r.submitted_at
    FROM scoring360_assignments a
    LEFT JOIN scoring360_responses r ON r.assignment_id = a.id
    WHERE a.cycle_id = ${sqlValue(cycleId)}
      AND a.evaluator_user_id = ${sqlValue(evaluatorUserId)}
      AND COALESCE(a.status, 'active') = 'active'
    ORDER BY a.evaluee_name ASC;
  `);
  sendJson(res, 200, {
    ok: true,
    cycleId,
    evaluator,
    tasks: rows.map((row) => ({
      id: row.id,
      cycleId: row.cycle_id,
      evaluee: row.evaluee_name,
      evaluator: row.evaluator_name,
      score: row.score === "" ? null : Number(row.score),
      comment: row.comment || "",
      submitted: Boolean(row.response_id),
      submittedAt: row.submitted_at || "",
      locked: !cycleOpen || isScoring360Locked(row.submitted_at),
    })),
  });
}

async function submitScoring360(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_readonly" });
    return;
  }
  const user = session?.user || mockUser();
  const evaluator = normalizeUserName(user.name);
  const evaluatorUserId = user.userId;
  const body = await readJsonBody(req, { limitBytes: 100_000 });
  const cycleId = await resolveScoring360CycleId(body.cycleId, { ensureCurrentRound: true });
  const scores = Array.isArray(body.scores) ? body.scores : [];
  if (!cycleId || !evaluator || scores.length === 0) {
    sendJson(res, 400, { ok: false, error: "invalid_scoring_payload" });
    return;
  }
  const cycle = await loadScoring360Cycle(cycleId);
  const published = await querySqlRows(`SELECT employee_user_id FROM performance_results WHERE kind='collaboration' AND month=${sqlValue(String(cycle?.startDate || '').slice(0,7))} UNION SELECT employee_user_id FROM monthly_weighted_results WHERE month=${sqlValue(String(cycle?.startDate || '').slice(0,7))};`);
  const publishedNames = new Set(published.map(row=>row.employee_user_id));
  if (!cycle?.launchAt || !["open", "active"].includes(cycle.status)) {
    sendJson(res, 409, { ok: false, error: "scoring_cycle_not_open" });
    return;
  }

  let saved = 0;
  const skipped = [];
  for (const item of scores) {
    const assignmentId = String(item?.assignmentId || "").trim();
    const score = Number(item?.score);
    const comment = String(item?.comment || "").trim().slice(0, 1000);
    if (!assignmentId || !comment || !Number.isFinite(score) || score < 0 || score > 100) {
      skipped.push({ assignmentId, reason: "invalid_score" });
      continue;
    }
    const assignmentRows = await querySqlRows(`
      SELECT a.id, a.evaluee_name, a.evaluee_user_id, a.evaluator_name, r.submitted_at
      FROM scoring360_assignments a
      LEFT JOIN scoring360_responses r ON r.assignment_id = a.id
      WHERE a.id = ${sqlValue(assignmentId)}
        AND a.cycle_id = ${sqlValue(cycleId)}
        AND a.evaluator_user_id = ${sqlValue(evaluatorUserId)}
        AND COALESCE(a.status, 'active') = 'active'
      LIMIT 1;
    `);
    const assignment = assignmentRows[0];
    if (!assignment) {
      skipped.push({ assignmentId, reason: "assignment_not_found" });
      continue;
    }
    if (publishedNames.has(assignment.evaluee_user_id)) {
      skipped.push({assignmentId,reason:'result_locked'});continue;
    }
    if (isScoring360Locked(assignment.submitted_at)) {
      skipped.push({ assignmentId, reason: "locked" });
      continue;
    }
    await execSql(`
      INSERT INTO scoring360_responses (id, assignment_id, cycle_id, evaluee_name, evaluator_name, score, comment, submitted_at)
      VALUES (${sqlValue(randomUUID())}, ${sqlValue(assignment.id)}, ${sqlValue(cycleId)}, ${sqlValue(assignment.evaluee_name)},
              ${sqlValue(evaluator)}, ${sqlValue(Math.round(score))}, ${sqlValue(comment)}, datetime('now'))
      ON CONFLICT(assignment_id) DO UPDATE SET
        score = excluded.score,
        comment = excluded.comment,
        submitted_at = datetime('now');
    `);
    saved += 1;
  }
  await performance.overview();
  sendJson(res, 200, { ok: true, saved, skipped });
}

async function getScoring360Config(req, res, url) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_readonly" });
    return;
  }
  if (!isScoring360ConfigManagerSession(session)) {
    sendJson(res, 403, { ok: false, error: "scoring360_config_manager_only" });
    return;
  }
  const currentId=url.searchParams.get("cycleId")||scoring360CycleForLaunchDate(scoring360ActiveDate()).id;
  const current=(await querySqlRows(`SELECT id FROM scoring360_cycles WHERE id=${sqlValue(currentId)};`))[0];
  const cycleId = current?.id||await resolveScoring360CycleId(url.searchParams.get("cycleId"));
  const employees = await loadManagedEmployees();
  if (!cycleId) {
    sendJson(res, 200, { ok: true, cycle: null, employees, assignments: [], diagnosis: scoring360Diagnosis() });
    return;
  }

  const cycleRows = await querySqlRows(`
    SELECT id, label, mode, start_date, end_date, launch_at, due_at, followup_after_at,
           historical_weight, current_weight, status, total_employees, total_evaluees, created_at, updated_at
    FROM scoring360_cycles
    WHERE id = ${sqlValue(cycleId)}
    LIMIT 1;
  `);
  const assignmentRows = await querySqlRows(`
    SELECT
      a.id, a.cycle_id, a.evaluee_name, a.evaluator_name, a.evaluee_user_id, a.evaluator_user_id,
      a.relationship, a.status, a.created_at, a.updated_at,
      r.id AS response_id, r.score, r.comment, r.submitted_at
    FROM scoring360_assignments a
    LEFT JOIN scoring360_responses r ON r.assignment_id = a.id
    WHERE a.cycle_id = ${sqlValue(cycleId)}
      AND COALESCE(a.status, 'active') = 'active'
    ORDER BY a.evaluee_name ASC, a.evaluator_name ASC;
  `);
  sendJson(res, 200, {
    ok: true,
    cycle: cycleRows[0] ? formatScoring360Cycle(cycleRows[0]) : null,
    employees,
    assignments: assignmentRows.map(formatScoring360ConfigAssignment),
    diagnosis: scoring360Diagnosis(),
  });
}

async function getScoring360ReminderStatus(req, res, url) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_readonly" });
    return;
  }
  if (!isScoring360ConfigManagerSession(session)) {
    sendJson(res, 403, { ok: false, error: "scoring360_config_manager_only" });
    return;
  }
  const cycleId = await resolveScoring360CycleId(url.searchParams.get("cycleId"), { ensureCurrentRound: true });
  const cycle = cycleId ? await loadScoring360Cycle(cycleId) : null;
  const pending = cycleId ? await loadScoring360PendingRecipients(cycleId) : [];
  const sends = cycleId ? await querySqlRows(`
    SELECT cycle_id, cycle_label, evaluator_user_id, evaluator_name, pending_count, kind, source,
           identity, feishu_message_id, idempotency_key, status, created_at
    FROM scoring360_reminder_sends
    WHERE cycle_id = ${sqlValue(cycleId)}
    ORDER BY datetime(created_at) DESC
    LIMIT 80;
  `) : [];
  sendJson(res, 200, {
    ok: true,
    enabled: config.scoring360ReminderEnabled,
    launchMode: config.scoring360LaunchMode,
    schedule: {
      dayOfMonth: config.scoring360ReminderDaysOfMonth[0] || config.scoring360ReminderDayOfMonth,
      daysOfMonth: config.scoring360ReminderDaysOfMonth,
      hour: config.scoring360ReminderHour,
      minute: config.scoring360ReminderMinute,
      dueHours: config.scoring360ReminderDueHours,
      followupHours: config.scoring360ReminderFollowupHours,
      identity: config.scoring360ReminderIdentity,
    },
    weights: {
      historical: normalizeScoring360Weights().historicalWeight,
      current: normalizeScoring360Weights().currentWeight,
    },
    cycle,
    pending,
    sends: sends.map((row) => ({
      cycleId: row.cycle_id,
      cycleLabel: row.cycle_label,
      evaluatorUserId: row.evaluator_user_id,
      evaluatorName: row.evaluator_name,
      pendingCount: Number(row.pending_count || 0),
      kind: row.kind,
      source: row.source,
      identity: row.identity,
      messageId: row.feishu_message_id,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      createdAt: row.created_at,
    })),
  });
}

async function sendScoring360Reminder(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_readonly" });
    return;
  }
  if (!isScoring360ConfigManagerSession(session)) {
    sendJson(res, 403, { ok: false, error: "scoring360_config_manager_only" });
    return;
  }
  const body = await readJsonBody(req, { limitBytes: 30_000 });
  const kind = body.kind === "followup" ? "followup" : "launch";
  const evaluatorUserId = String(body.evaluatorUserId || "").trim();
  const requestedCycleId = String(body.cycleId || "").trim();
  const cycleId = requestedCycleId
    ? await resolveScoring360CycleId(requestedCycleId)
    : kind === "launch"
      ? await ensureScoring360CycleForLaunchDate(scoring360ActiveDate())
      : await resolveScoring360CycleId("");
  const result = await runScoring360Reminder({
    cycleId,
    kind,
    dryRun: body.dryRun !== false,
    force: Boolean(body.force),
    evaluatorUserId,
    source: "manual",
    actor: session?.user || mockUser(),
  });
  sendJson(res, 200, result);
}

async function getRosterAudit(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  const exemptNames = new Set(toSimpleList(config.scoring360RosterExempt).map(normalizeUserName));
  const employeeRows = await querySqlRows(`
    SELECT user_id, name, department, email, is_active, updated_at
    FROM employees
    ORDER BY name ASC;
  `).catch(() => []);
  // Read the same merged report source as the performance workbench.
  const mergedReports = await performance.reports();
  const latest = [...mergedReports].sort((a,b)=>String(b.end).localeCompare(String(a.end)))[0];
  const latestWeek = latest ? {week_label:latest.content?.['周次'] || `${latest.start} — ${latest.end}`,week_start:latest.start,week_end:latest.end} : null;
  const reportRows = latest ? mergedReports.filter(r=>r.end===latest.end && r.submitted).map(r=>({employee_user_id:r.employeeUserId,employee_name:r.name,department:r.department,week_label:latestWeek.week_label,submitted_at:r.submittedAt})) : [];
  const employeeNames = new Set(employeeRows.filter((row) => Number(row.is_active || 1) === 1).map((row) => normalizeUserName(row.name)));
  const directoryNames = new Set(employeeDirectory.map((employee) => normalizeUserName(employee.name)).filter(Boolean));
  const reportNames = new Set(reportRows.map((row) => normalizeUserName(row.employee_name)).filter(Boolean));
  const newInReports = reportRows
    .filter((row) => !employeeNames.has(normalizeUserName(row.employee_name)) && !directoryNames.has(normalizeUserName(row.employee_name)) && !exemptNames.has(normalizeUserName(row.employee_name)))
    .map((row) => ({ name: row.employee_name, department: row.department || "", userId: row.employee_user_id || "" }));
  const missingLatestReport = employeeRows
    .filter((row) => Number(row.is_active || 1) === 1)
    .filter((row) => !reportNames.has(normalizeUserName(row.name)) && !exemptNames.has(normalizeUserName(row.name)))
    .map((row) => ({ name: row.name, department: row.department || "", userId: row.user_id || "" }));
  const missingUserId = [
    ...employeeRows.map((row) => ({ name: row.name, department: row.department || "", userId: row.user_id || "" })),
    ...employeeDirectory.map((employee) => ({ name: employee.name, department: employee.department || "", userId: employee.userId || "" })),
  ].filter((employee) => employee.name && !employee.userId && !exemptNames.has(normalizeUserName(employee.name)));
  const knownDepartedStillConfigured = [...new Set([...employeeNames, ...directoryNames])]
    .filter((name) => exemptNames.has(name))
    .map((name) => ({ name }));
  sendJson(res, 200, {
    ok: true,
    latestWeek: latestWeek ? {
      label: latestWeek.week_label,
      startDate: latestWeek.week_start,
      endDate: latestWeek.week_end,
      reportCount: reportRows.length,
    } : null,
    exemptNames: Array.from(exemptNames),
    counts: {
      activeEmployees: employeeNames.size,
      directoryEmployees: directoryNames.size,
      latestReports: reportNames.size,
      newInReports: newInReports.length,
      missingLatestReport: missingLatestReport.length,
      missingUserId: missingUserId.length,
    },
    newInReports,
    missingLatestReport,
    missingUserId,
    knownDepartedStillConfigured,
    note: "这里只做花名册健康检查，不自动删除或新增评分关系；新入职人员需要确认 user_id 后再进入提醒和评分对象池。",
  });
}

async function loadScoring360Cycle(cycleId) {
  const rows = await querySqlRows(`
    SELECT id, label, mode, start_date, end_date, launch_at, due_at, followup_after_at,
           historical_weight, current_weight, status, total_employees, total_evaluees, created_at, updated_at
    FROM scoring360_cycles
    WHERE id = ${sqlValue(cycleId)}
    LIMIT 1;
  `);
  return rows[0] ? formatScoring360Cycle(rows[0]) : null;
}

async function loadScoring360PendingRecipients(cycleId) {
  const rows = await querySqlRows(`
    SELECT a.evaluator_name, a.evaluator_user_id, a.evaluee_name, a.evaluee_user_id, r.id AS response_id
    FROM scoring360_assignments a
    LEFT JOIN scoring360_responses r ON r.assignment_id = a.id
    WHERE a.cycle_id = ${sqlValue(cycleId)}
      AND COALESCE(a.status, 'active') = 'active'
    ORDER BY a.evaluator_name ASC, a.evaluee_name ASC;
  `);
  const employees = await loadManagedEmployees();
  const activeByUserId = new Map(employees.filter((item) => item.userId).map((item) => [item.userId, item]));
  const activeByName = new Map(employees.map((item) => [normalizeUserName(item.name), item]));
  const grouped = new Map();
  for (const row of rows) {
    const evaluator = activeByUserId.get(String(row.evaluator_user_id || ""));
    const evaluee = activeByUserId.get(String(row.evaluee_user_id || ""));
    if (!evaluator || !evaluee) continue;
    const key = evaluator.userId || evaluator.name;
    if (!grouped.has(key)) {
      grouped.set(key, {
        evaluatorName: evaluator.name,
        evaluatorUserId: evaluator.userId || "",
        department: evaluator.department || "",
        pendingCount: 0,
        totalCount: 0,
        pendingNames: [],
        deliverable: Boolean(evaluator.userId),
      });
    }
    const item = grouped.get(key);
    item.totalCount += 1;
    if (!row.response_id) {
      item.pendingCount += 1;
      item.pendingNames.push(evaluee.name);
    }
  }
  return Array.from(grouped.values())
    .filter((item) => item.pendingCount > 0)
    .sort((left, right) => right.pendingCount - left.pendingCount || left.evaluatorName.localeCompare(right.evaluatorName, "zh-CN"));
}

async function runScoring360Reminder({ cycleId, kind = "launch", dryRun = true, force = false, evaluatorUserId = "", source = "manual", actor = null } = {}) {
  cycleId = cycleId || (kind === "launch"
    ? await ensureScoring360CycleForLaunchDate(scoring360ActiveDate())
    : await resolveScoring360CycleId(""));
  if (!cycleId) return { ok: false, error: "missing_cycle" };
  if (kind === "launch" && !dryRun) await ensureScoring360CycleSchedule(cycleId);
  let cycle = await loadScoring360Cycle(cycleId);
  if (!cycle) return { ok: false, error: "cycle_not_found" };
  const pending = await loadScoring360PendingRecipients(cycleId);
  const recipients = evaluatorUserId
    ? pending.filter((recipient) => recipient.evaluatorUserId === evaluatorUserId)
    : pending;
  if (evaluatorUserId && recipients.length === 0) {
    return { ok: false, error: "target_evaluator_not_pending" };
  }
  const results = [];
  for (const recipient of recipients) {
    const idempotencyKey = buildScoring360ReminderIdempotencyKey(cycle.id, recipient.evaluatorUserId || recipient.evaluatorName, kind);
    const existing = await querySqlRows(`
      SELECT status, feishu_message_id, created_at
      FROM scoring360_reminder_sends
      WHERE idempotency_key = ${sqlValue(idempotencyKey)}
      LIMIT 1;
    `).catch(() => []);
    if (!force && existing[0]?.status === "sent") {
      results.push({ ok: true, skipped: true, reason: "already_sent", recipient, existing: existing[0] });
      continue;
    }
    const message = buildScoring360ReminderMessage({ cycle, recipient, kind });
    if (dryRun || !recipient.evaluatorUserId) {
      await persistScoring360ReminderSend({
        cycle,
        recipient,
        message,
        kind,
        source,
        identity: config.scoring360ReminderIdentity,
        idempotencyKey,
        status: recipient.evaluatorUserId ? "dry_run" : "missing_user_id",
        feishuMessageId: "",
        rawResponse: { dryRun, actorName: actor?.name || "", missingUserId: !recipient.evaluatorUserId },
      });
      results.push({ ok: Boolean(recipient.evaluatorUserId), dryRun, recipient, message, idempotencyKey, error: recipient.evaluatorUserId ? "" : "missing_user_id" });
      continue;
    }
    const sendResult = sendFeishuDirectMessage(
      recipient.evaluatorUserId,
      message,
      idempotencyKey,
      config.scoring360ReminderIdentity,
    );
    const payload = sendResult.ok ? parseJsonMaybe(sendResult.stdout) : {
      ok: false,
      error: sendResult.error || "lark_cli_send_failed",
      stderr: sendResult.stderr,
      stdout: sendResult.stdout,
      exitCode: sendResult.exitCode,
    };
    const feishuMessageId = String(payload?.data?.message_id || payload?.message_id || "");
    await persistScoring360ReminderSend({
      cycle,
      recipient,
      message,
      kind,
      source,
      identity: config.scoring360ReminderIdentity,
      idempotencyKey,
      status: sendResult.ok ? "sent" : "failed",
      feishuMessageId,
      rawResponse: payload,
    });
    results.push({
      ok: sendResult.ok,
      recipient,
      messageId: feishuMessageId,
      idempotencyKey,
      error: sendResult.ok ? "" : payload.error,
    });
  }
  if (kind === "launch" && !dryRun) {
    const sentRows = await querySqlRows(`
      SELECT COUNT(*) AS count
      FROM scoring360_reminder_sends
      WHERE cycle_id = ${sqlValue(cycleId)} AND kind = 'launch' AND status = 'sent';
    `).catch(() => []);
    if (Number(sentRows[0]?.count || 0) === 0) {
      await execSql(`
        UPDATE scoring360_cycles
        SET launch_at = NULL, due_at = NULL, followup_after_at = NULL,
            status = 'draft', updated_at = datetime('now')
        WHERE id = ${sqlValue(cycleId)};
      `);
      cycle = await loadScoring360Cycle(cycleId);
    }
  }
  return {
    ok: true,
    dryRun,
    force,
    cycle,
    kind,
    count: results.length,
    sent: results.filter((item) => item.ok && !item.dryRun && !item.skipped).length,
    dryRunCount: results.filter((item) => item.dryRun).length,
    skipped: results.filter((item) => item.skipped).length,
    failed: results.filter((item) => item.ok === false).length,
    results,
  };
}

async function ensureScoring360CycleSchedule(cycleId) {
  const rows = await querySqlRows(`
    SELECT launch_at, due_at, followup_after_at
    FROM scoring360_cycles
    WHERE id = ${sqlValue(cycleId)}
    LIMIT 1;
  `).catch(() => []);
  const row = rows[0] || {};
  const sentRows = await querySqlRows(`
    SELECT COUNT(*) AS count
    FROM scoring360_reminder_sends
    WHERE cycle_id = ${sqlValue(cycleId)} AND kind = 'launch' AND status = 'sent';
  `).catch(() => []);
  if (Number(sentRows[0]?.count || 0) > 0 && row.launch_at && row.due_at && row.followup_after_at) return;
  const now = new Date();
  const dueAt = new Date(now.getTime() + config.scoring360ReminderDueHours * 60 * 60 * 1000).toISOString();
  const followupAt = new Date(now.getTime() + config.scoring360ReminderFollowupHours * 60 * 60 * 1000).toISOString();
  await execSql(`
    UPDATE scoring360_cycles
    SET launch_at = ${sqlValue(now.toISOString())},
        due_at = ${sqlValue(dueAt)},
        followup_after_at = ${sqlValue(followupAt)},
        historical_weight = COALESCE(historical_weight, ${sqlValue(normalizeScoring360Weights().historicalWeight)}),
        current_weight = COALESCE(current_weight, ${sqlValue(normalizeScoring360Weights().currentWeight)}),
        status = CASE WHEN status = 'draft' THEN 'open' ELSE status END,
        updated_at = datetime('now')
    WHERE id = ${sqlValue(cycleId)};
  `);
}

function buildScoring360ReminderMessage({ cycle, recipient, kind }) {
  const weights = normalizeScoring360Weights(cycle);
  const pendingNames = recipient.pendingNames.slice(0, 6).join("、");
  const more = recipient.pendingNames.length > 6 ? `等 ${recipient.pendingNames.length} 位同事` : "";
  const action = kind === "followup" ? "温柔提醒一下，你还有协同 360 评分没有完成。" : "协同 360 评分周期已经启动。";
  const dueText = cycle.dueAt ? `本轮请在 ${formatChineseDateTime(cycle.dueAt)} 前完成。` : `本轮截止时间为启动后 48 小时。`;
  return `${recipient.evaluatorName}，${action}

这不是人情分，也不是简单给同事排高低，而是帮助团队看见：谁在协作中持续贡献价值，谁可能变成信息孤岛，以及哪些协作关系需要被管理层及时补位。

你这轮需要评价 ${recipient.pendingCount} 个对象：${pendingNames}${more}。
${dueText}

月度最终分 = 负责人或老板评分 × 30% + 本月全部同事互评均分 × 70%。两部分都完成后自动发布，无需人工确认。开启月末自动提醒后，每月最后两个工作日会分别提醒仍未完成的评分人员。

入口：${config.baseUrl}/scores?tab=my360

谢谢你认真给出判断。真实、克制、有证据的评分，才会帮助大家一起成长。`;
}

function formatChineseDateTime(value) {
  if (!value) return "";
  const date = new Date(String(value).replace(" ", "T"));
  if (!Number.isFinite(date.getTime())) return String(value);
  const shanghai = dateInShanghai(date);
  return `${shanghai.getMonth() + 1}月${shanghai.getDate()}日 ${String(shanghai.getHours()).padStart(2, "0")}:${String(shanghai.getMinutes()).padStart(2, "0")}`;
}

function isScoring360CycleDeadlinePassed(cycle) {
  if (!cycle?.dueAt) return false;
  const dueTime = new Date(String(cycle.dueAt).replace(" ", "T")).getTime();
  return Number.isFinite(dueTime) && Date.now() >= dueTime;
}

function buildScoring360ReminderIdempotencyKey(cycleId, recipientKey, kind) {
  const digest = createHash("sha1").update(`scoring360:${kind}:${cycleId}:${recipientKey}`).digest("hex").slice(0, 24);
  return `wos-sc360-${digest}`;
}

async function persistScoring360ReminderSend({
  cycle,
  recipient,
  message,
  kind,
  source,
  identity,
  idempotencyKey,
  status,
  feishuMessageId,
  rawResponse,
}) {
  await execSql(`
    INSERT OR REPLACE INTO scoring360_reminder_sends
      (id, cycle_id, cycle_label, evaluator_user_id, evaluator_name, pending_count, message,
       kind, source, identity, feishu_message_id, idempotency_key, status, raw_response_json, created_at)
    VALUES
      (${sqlValue(randomUUID())}, ${sqlValue(cycle.id)}, ${sqlValue(cycle.label)},
       ${sqlValue(recipient.evaluatorUserId || "")}, ${sqlValue(recipient.evaluatorName)},
       ${sqlValue(recipient.pendingCount)}, ${sqlValue(message)}, ${sqlValue(kind)},
       ${sqlValue(source)}, ${sqlValue(identity)}, ${sqlValue(feishuMessageId)},
       ${sqlValue(idempotencyKey)}, ${sqlValue(status)}, ${sqlValue(JSON.stringify(rawResponse || {}))},
       datetime('now'));
  `);
}

async function collaborationResultPublished(cycleId,userId) {
  return (await querySqlRows(`SELECT 1 AS locked FROM performance_results p JOIN scoring360_cycles c ON p.month=substr(c.start_date,1,7) WHERE c.id=${sqlValue(cycleId)} AND p.employee_user_id=${sqlValue(userId)} AND p.kind='collaboration' UNION SELECT 1 AS locked FROM monthly_weighted_results p JOIN scoring360_cycles c ON p.month=substr(c.start_date,1,7) WHERE c.id=${sqlValue(cycleId)} AND p.employee_user_id=${sqlValue(userId)} LIMIT 1;`)).length>0;
}

async function createScoring360Assignment(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_readonly" });
    return;
  }
  if (!isScoring360ConfigManagerSession(session)) {
    sendJson(res, 403, { ok: false, error: "scoring360_config_manager_only" });
    return;
  }
  const body = await readJsonBody(req, { limitBytes: 30_000 });
  const cycleId = await resolveScoring360CycleId(body.cycleId, { ensureCurrentRound: true });
  const evalueeName = normalizeUserName(body.evalueeName || body.evaluee || body.evalueeUserId);
  const evaluatorName = normalizeUserName(body.evaluatorName || body.evaluator || body.evaluatorUserId);
  if (!cycleId || !evalueeName || !evaluatorName) {
    sendJson(res, 400, { ok: false, error: "invalid_assignment" });
    return;
  }
  const evaluee = await findActiveManagedEmployee(body.evalueeUserId || evalueeName);
  const evaluator = await findActiveManagedEmployee(body.evaluatorUserId || evaluatorName);
  if (!evaluee || !evaluator) {
    sendJson(res, 409, { ok: false, error: "inactive_or_unknown_employee" });
    return;
  }
  if(evaluee.userId===evaluator.userId)return sendJson(res,409,{ok:false,error:'self_scoring_forbidden'});
  const existing = (await querySqlRows(`SELECT id,status FROM scoring360_assignments WHERE cycle_id=${sqlValue(cycleId)} AND evaluee_user_id=${sqlValue(evaluee.userId)} AND evaluator_user_id=${sqlValue(evaluator.userId)} LIMIT 1;`))[0];
  if(existing && existing.status === 'active') return sendJson(res,200,{ok:true,alreadyExists:true,assignment:{id:existing.id,cycleId,evalueeName,evaluatorName}});
  if(await collaborationResultPublished(cycleId,evaluee.userId)) return sendJson(res,409,{ok:false,error:'result_locked'});
  const assignmentId = `sc360-${createHash("sha1").update(`${cycleId}:${evaluee.userId}:${evaluator.userId}`).digest("hex").slice(0, 20)}`;
  await execSql(`
    INSERT INTO scoring360_assignments (
      id, cycle_id, evaluee_name, evaluator_name, evaluee_user_id, evaluator_user_id, relationship, status, created_at, updated_at
    ) VALUES (
      ${sqlValue(assignmentId)}, ${sqlValue(cycleId)}, ${sqlValue(evaluee.name)}, ${sqlValue(evaluator.name)},
      ${sqlValue(evaluee.userId || "")}, ${sqlValue(evaluator.userId || "")}, ${sqlValue(body.relationship || "")},
      'active', datetime('now'), datetime('now')
    )
    ON CONFLICT(cycle_id, evaluee_user_id, evaluator_user_id) DO UPDATE SET
      evaluee_user_id = excluded.evaluee_user_id,
      evaluator_user_id = excluded.evaluator_user_id,
      relationship = excluded.relationship,
      status = 'active',
      updated_at = datetime('now');
  `);
  await refreshScoring360CycleTotals(cycleId);
  sendJson(res, 200, { ok: true, assignment: { id: assignmentId, cycleId, evalueeName, evaluatorName } });
}

async function deleteScoring360Assignment(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_readonly" });
    return;
  }
  if (!isScoring360ConfigManagerSession(session)) {
    sendJson(res, 403, { ok: false, error: "scoring360_config_manager_only" });
    return;
  }
  const body = await readJsonBody(req, { limitBytes: 30_000 });
  const assignmentId = String(body.assignmentId || body.id || "").trim();
  const cycleId = await resolveScoring360CycleId(body.cycleId, { ensureCurrentRound: true });
  const evalueeName = normalizeUserName(body.evalueeName || body.evaluee || body.evalueeUserId);
  const evaluatorName = normalizeUserName(body.evaluatorName || body.evaluator || body.evaluatorUserId);
  const where = assignmentId
    ? `id = ${sqlValue(assignmentId)}`
    : `cycle_id = ${sqlValue(cycleId)} AND evaluee_name = ${sqlValue(evalueeName)} AND evaluator_name = ${sqlValue(evaluatorName)}`;
  if (!assignmentId && (!cycleId || !evalueeName || !evaluatorName)) {
    sendJson(res, 400, { ok: false, error: "invalid_assignment" });
    return;
  }
  const rows = await querySqlRows(`
    SELECT id, cycle_id, evaluee_name, evaluee_user_id FROM scoring360_assignments
    WHERE ${where}
    LIMIT 1;
  `);
  const assignment = rows[0];
  if (!assignment) {
    sendJson(res, 404, { ok: false, error: "assignment_not_found" });
    return;
  }
  if(await collaborationResultPublished(assignment.cycle_id,assignment.evaluee_user_id)) return sendJson(res,409,{ok:false,error:'result_locked'});
  await execSql(`
    UPDATE scoring360_assignments
    SET status = 'inactive', updated_at = datetime('now')
    WHERE id = ${sqlValue(assignment.id)};
  `);
  await refreshScoring360CycleTotals(assignment.cycle_id);
  sendJson(res, 200, { ok: true, deactivated: assignment.id });
}

async function recordUsageVisit(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 200, { ok: true, skipped: "external_readonly" });
    return;
  }
  const user = session?.user || mockUser();
  const body = await readJsonBody(req, { limitBytes: 10_000 });
  const page = String(body.page || "").replace(/[^a-z_:-]/gi, "").slice(0, 40) || "unknown";
  await recordAccountEvent(user, "page_visit", {
    targetType: "page",
    targetId: page,
    points: 1,
    payload: { page },
  });
  sendJson(res, 200, { ok: true });
}

async function recordUsageHeartbeat(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 200, { ok: true, skipped: "external_readonly" });
    return;
  }
  const user = session?.user || mockUser();
  const body = await readJsonBody(req, { limitBytes: 10_000 });
  const page = String(body.page || "").replace(/[^a-z_:-]/gi, "").slice(0, 40) || "unknown";
  const visible = body.visible !== false;
  if (!visible) {
    sendJson(res, 200, { ok: true, skipped: "hidden_tab" });
    return;
  }
  await recordAccountEvent(user, "heartbeat", {
    targetType: "page",
    targetId: page,
    points: 0,
    payload: { page, visible: true },
  });
  sendJson(res, 200, { ok: true });
}

async function recordAccountEvent(user, eventType, options = {}) {
  if (!user?.userId || !eventType) return;
  const targetType = options.targetType || "account";
  const targetId = options.targetId || "";
  const points = Number.isFinite(Number(options.points)) ? Number(options.points) : 0;
  const payload = options.payload || {};
  await execSql(`
    INSERT INTO contribution_events (id, actor_user_id, actor_name, event_type, target_type, target_id, points, payload_json)
    VALUES (${sqlValue(randomUUID())}, ${sqlValue(user.userId)}, ${sqlValue(user.name || "")}, ${sqlValue(eventType)},
            ${sqlValue(targetType)}, ${sqlValue(targetId)}, ${points}, ${sqlValue(JSON.stringify(payload))});
  `);
}

async function listContributionActivity(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  const activity = new Map();
  const ensure = (userId, name = "") => {
    const key = userId || name || "unknown";
    if (!activity.has(key)) {
      activity.set(key, {
        userId,
        name,
        visits: 0,
        comments: 0,
        likes: 0,
        followups: 0,
        eventPoints: 0,
        lastActiveAt: "",
      });
    }
    const item = activity.get(key);
    if (!item.name && name) item.name = name;
    return item;
  };
  const touch = (item, value) => {
    if (value && (!item.lastActiveAt || new Date(value).getTime() > new Date(item.lastActiveAt).getTime())) {
      item.lastActiveAt = value;
    }
  };

  const visitRows = await querySqlRows(`
    SELECT actor_user_id, actor_name, COUNT(*) AS count, SUM(points) AS points, MAX(created_at) AS last_at
    FROM contribution_events
    WHERE event_type = 'page_visit'
    GROUP BY actor_user_id, actor_name;
  `);
  for (const row of visitRows) {
    const item = ensure(row.actor_user_id, row.actor_name);
    item.visits += Number(row.count || 0);
    item.eventPoints += Number(row.points || 0);
    touch(item, row.last_at);
  }

  const commentRows = await querySqlRows(`
    SELECT author_user_id, author_name, COUNT(*) AS count, MAX(created_at) AS last_at
    FROM comments
    WHERE deleted_at IS NULL
    GROUP BY author_user_id, author_name;
  `);
  for (const row of commentRows) {
    const item = ensure(row.author_user_id, row.author_name);
    item.comments += Number(row.count || 0);
    touch(item, row.last_at);
  }

  const reactionRows = await querySqlRows(`
    SELECT actor_user_id, COUNT(*) AS count, MAX(created_at) AS last_at
    FROM reactions
    GROUP BY actor_user_id;
  `);
  for (const row of reactionRows) {
    const item = ensure(row.actor_user_id);
    item.likes += Number(row.count || 0);
    touch(item, row.last_at);
  }

  const followupRows = await querySqlRows(`
    SELECT author_user_id, author_name, COUNT(*) AS count, MAX(created_at) AS last_at
    FROM ai_followup_messages
    WHERE role = 'user'
    GROUP BY author_user_id, author_name;
  `);
  for (const row of followupRows) {
    const item = ensure(row.author_user_id, row.author_name);
    item.followups += Number(row.count || 0);
    touch(item, row.last_at);
  }

  sendJson(res, 200, {
    ok: true,
    activity: Array.from(activity.values()).filter((item) => item.userId || item.name),
  });
}

async function listAccountActivity(req, res, url) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_view_required" });
    return;
  }

  const latestWindow = await querySqlRows(`
    SELECT period_id, period_label, COUNT(*) AS sent_count, MIN(created_at) AS first_sent_at, MAX(created_at) AS last_sent_at
    FROM weekly_reminder_sends
    WHERE source = 'auto_monday_update' AND status = 'sent'
    GROUP BY period_id, period_label
    ORDER BY MAX(created_at) DESC
    LIMIT 1;
  `);
  const fallbackStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const requestedSince = sanitizeSqliteDate(url.searchParams.get("since") || "");
  const windowRow = latestWindow[0] || null;
  const windowStart = requestedSince || windowRow?.first_sent_at || fallbackStart;
  const periodId = windowRow?.period_id || "";

  const recipientRows = periodId
    ? await querySqlRows(`
        SELECT recipient_user_id, recipient_name, department, MIN(created_at) AS sent_at
        FROM weekly_reminder_sends
        WHERE period_id = ${sqlValue(periodId)}
          AND source = 'auto_monday_update'
          AND status = 'sent'
        GROUP BY recipient_user_id, recipient_name, department
        ORDER BY recipient_name;
      `)
    : await querySqlRows(`
        SELECT user_id AS recipient_user_id, name AS recipient_name, department, updated_at AS sent_at
        FROM employees
        WHERE is_active = 1
        ORDER BY name;
      `);

  const rowsByUserId = new Map();
  const ensure = (userId, name = "", department = "") => {
    const key = userId || name;
    if (!key) return null;
    if (!rowsByUserId.has(key)) {
      rowsByUserId.set(key, {
        userId,
        name,
        department,
        sentAt: "",
        loginCount: 0,
        sessionCount: 0,
        heartbeatCount: 0,
        pageVisitCount: 0,
        commentCount: 0,
        reactionCount: 0,
        followupCount: 0,
        firstActiveAt: "",
        lastActiveAt: "",
      });
    }
    const item = rowsByUserId.get(key);
    if (!item.name && name) item.name = name;
    if (!item.department && department) item.department = department;
    return item;
  };
  const touch = (item, firstAt, lastAt) => {
    if (!item) return;
    if (firstAt && (!item.firstActiveAt || new Date(firstAt).getTime() < new Date(item.firstActiveAt).getTime())) item.firstActiveAt = firstAt;
    if (lastAt && (!item.lastActiveAt || new Date(lastAt).getTime() > new Date(item.lastActiveAt).getTime())) item.lastActiveAt = lastAt;
  };

  for (const row of recipientRows) {
    const item = ensure(row.recipient_user_id, row.recipient_name, row.department);
    if (item) item.sentAt = row.sent_at || "";
  }

  const eventRows = await querySqlRows(`
    SELECT actor_user_id, actor_name,
      SUM(CASE WHEN event_type = 'login_success' THEN 1 ELSE 0 END) AS login_count,
      SUM(CASE WHEN event_type = 'session_resume' THEN 1 ELSE 0 END) AS session_count,
      SUM(CASE WHEN event_type = 'heartbeat' THEN 1 ELSE 0 END) AS heartbeat_count,
      SUM(CASE WHEN event_type = 'page_visit' THEN 1 ELSE 0 END) AS page_visit_count,
      MIN(created_at) AS first_at,
      MAX(created_at) AS last_at
    FROM contribution_events
    WHERE created_at >= ${sqlValue(windowStart)}
      AND event_type IN ('login_success', 'session_resume', 'heartbeat', 'page_visit')
    GROUP BY actor_user_id, actor_name;
  `);
  for (const row of eventRows) {
    const item = ensure(row.actor_user_id, row.actor_name);
    if (!item) continue;
    item.loginCount += Number(row.login_count || 0);
    item.sessionCount += Number(row.session_count || 0);
    item.heartbeatCount += Number(row.heartbeat_count || 0);
    item.pageVisitCount += Number(row.page_visit_count || 0);
    touch(item, row.first_at, row.last_at);
  }

  const commentRows = await querySqlRows(`
    SELECT author_user_id, author_name, COUNT(*) AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at
    FROM comments
    WHERE deleted_at IS NULL AND created_at >= ${sqlValue(windowStart)}
    GROUP BY author_user_id, author_name;
  `);
  for (const row of commentRows) {
    const item = ensure(row.author_user_id, row.author_name);
    if (!item) continue;
    item.commentCount += Number(row.count || 0);
    touch(item, row.first_at, row.last_at);
  }

  const reactionRows = await querySqlRows(`
    SELECT actor_user_id, COUNT(*) AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at
    FROM reactions
    WHERE created_at >= ${sqlValue(windowStart)}
    GROUP BY actor_user_id;
  `);
  for (const row of reactionRows) {
    const item = ensure(row.actor_user_id);
    if (!item) continue;
    item.reactionCount += Number(row.count || 0);
    touch(item, row.first_at, row.last_at);
  }

  const followupRows = await querySqlRows(`
    SELECT author_user_id, author_name, COUNT(*) AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at
    FROM ai_followup_messages
    WHERE role = 'user' AND created_at >= ${sqlValue(windowStart)}
    GROUP BY author_user_id, author_name;
  `);
  for (const row of followupRows) {
    const item = ensure(row.author_user_id, row.author_name);
    if (!item) continue;
    item.followupCount += Number(row.count || 0);
    touch(item, row.first_at, row.last_at);
  }

  const recipientUserIds = new Set(recipientRows.map((row) => row.recipient_user_id).filter(Boolean));
  const rows = Array.from(rowsByUserId.values()).map((item) => {
    const activeSignals = item.loginCount + item.sessionCount + item.heartbeatCount + item.pageVisitCount;
    const interactionSignals = item.commentCount + item.reactionCount + item.followupCount;
    const attentionScore = activeSignals + interactionSignals * 3;
    const status = attentionScore <= 0
      ? "no_record"
      : interactionSignals > 0
        ? "engaged"
        : "active";
    return {
      ...item,
      isReminderRecipient: recipientUserIds.has(item.userId),
      activeSignals,
      interactionSignals,
      attentionScore,
      status,
      statusLabel: status === "no_record" ? "暂无活跃记录" : status === "engaged" ? "有互动贡献" : "已访问/活跃",
      firstActiveAt: item.firstActiveAt ? toIsoLike(item.firstActiveAt) : "",
      lastActiveAt: item.lastActiveAt ? toIsoLike(item.lastActiveAt) : "",
      sentAt: item.sentAt ? toIsoLike(item.sentAt) : "",
    };
  }).sort((left, right) => {
    if (left.status === "no_record" && right.status !== "no_record") return 1;
    if (left.status !== "no_record" && right.status === "no_record") return -1;
    return right.attentionScore - left.attentionScore || left.name.localeCompare(right.name, "zh-CN");
  });

  const recipients = rows.filter((row) => row.isReminderRecipient);
  const noRecord = recipients.filter((row) => row.status === "no_record");
  const engaged = recipients.filter((row) => row.status === "engaged");
  const active = recipients.filter((row) => row.status !== "no_record");

  sendJson(res, 200, {
    ok: true,
    window: {
      mode: requestedSince ? "custom_since" : (periodId ? "latest_monday_update" : "last_7_days"),
      periodId,
      periodLabel: windowRow?.period_label || "",
      startAt: toIsoLike(windowStart),
      firstSentAt: toIsoLike(windowRow?.first_sent_at || ""),
      lastSentAt: toIsoLike(windowRow?.last_sent_at || ""),
      sentCount: Number(windowRow?.sent_count || recipientRows.length || 0),
    },
    summary: {
      recipients: recipients.length,
      active: active.length,
      noRecord: noRecord.length,
      engaged: engaged.length,
      activeRate: recipients.length ? Math.round((active.length / recipients.length) * 100) : 0,
      engagedRate: recipients.length ? Math.round((engaged.length / recipients.length) * 100) : 0,
    },
    rows,
  });
}

async function listExternalLinks(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  const rows = await querySqlRows(`
    SELECT id, name, scope, created_by_name, expires_at, status, access_count, last_accessed_at, created_at
    FROM external_share_links
    ORDER BY datetime(created_at) DESC
    LIMIT 50;
  `);
  sendJson(res, 200, {
    ok: true,
    links: rows.map((row) => ({
      id: row.id,
      name: row.name,
      scope: row.scope,
      createdByName: row.created_by_name,
      expiresAt: row.expires_at,
      status: externalLinkRuntimeStatus(row),
      accessCount: Number(row.access_count || 0),
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
    })),
  });
}

async function createExternalLink(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  const user = session?.user || mockUser();
  const body = await readJsonBody(req, { limitBytes: 20_000 });
  const ttlHours = clampNumber(Number(body.ttlHours || 72), 1, 24 * 30);
  const name = String(body.name || "外部顾问临时访问").trim().slice(0, 80);
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashExternalToken(token);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  await execSql(`
    INSERT INTO external_share_links
      (id, token_hash, name, scope, created_by_user_id, created_by_name, expires_at)
    VALUES
      (${sqlValue(id)}, ${sqlValue(tokenHash)}, ${sqlValue(name)}, 'boss_view',
       ${sqlValue(user.userId)}, ${sqlValue(user.name)}, ${sqlValue(expiresAt)});
  `);
  sendJson(res, 200, {
    ok: true,
    link: {
      id,
      name,
      scope: "boss_view",
      expiresAt,
      url: `${requestPublicBaseUrl(req)}/share/${token}`,
    },
  });
}

async function listBossViewMembers(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    members: bossAccessState.members,
    userIds: Array.from(bossAccessState.userIds),
    names: Array.from(bossAccessState.names),
  });
}

async function updateBossViewMembers(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  const body = await readJsonBody(req, { limitBytes: 80_000 });
  const members = normalizeBossViewMembers(body.members || body.userIds || []);
  await saveAppSetting("boss_view_members",{members});
  applyBossViewMembers(members);
  await systemSettings.audit(session?.user||mockUser(),'老板角色授权已更新',{members:members.map(m=>m.userId)});
  sendJson(res, 200, { ok: true, members: bossAccessState.members });
}

async function listScoring360AdminMembers(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session) || !isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  sendJson(res, 200, { ok: true, members: scoring360AdminState.members });
}

async function updateScoring360AdminMembers(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session) || !isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  const body = await readJsonBody(req, { limitBytes: 80_000 });
  const members = normalizeBossViewMembers(body.members || []);
  await saveAppSetting("scoring360_admin_members",{members});
  applyScoring360AdminMembers(members);
  await systemSettings.audit(session?.user||mockUser(),'管理员角色授权已更新',{members:members.map(m=>m.userId)});
  sendJson(res, 200, { ok: true, members: scoring360AdminState.members });
}

async function listManagedEmployees(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session) || !isScoring360ConfigManagerSession(session)) {
    sendJson(res, 403, { ok: false, error: "scoring360_config_manager_only" });
    return;
  }
  sendJson(res, 200, { ok: true, employees: await loadManagedEmployees({ includeInactive: true }) });
}

async function upsertManagedEmployee(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session) || !isScoring360ConfigManagerSession(session)) {
    sendJson(res, 403, { ok: false, error: "scoring360_config_manager_only" });
    return;
  }
  const body = await readJsonBody(req, { limitBytes: 30_000 });
  if(config.authMode!=='mock') return sendJson(res,405,{ok:false,error:'sso_roster_only'});
  const employee = normalizeManagedEmployee(body);
  if (!employee.userId || !employee.name) {
    sendJson(res, 400, { ok: false, error: "employee_user_id_and_name_required" });
    return;
  }
  await ensureManagedEmployeeStore();
  await execSql(`
    INSERT INTO employees (user_id, name, department, email, manager_user_id, role_level, is_active, updated_at)
    VALUES (${sqlValue(employee.userId)}, ${sqlValue(employee.name)}, ${sqlValue(employee.department)},
            ${sqlValue(employee.email)}, ${sqlValue(employee.managerUserId)}, ${sqlValue(employee.roleLevel)}, 1, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      name = excluded.name,
      department = excluded.department,
      email = excluded.email,
      manager_user_id = excluded.manager_user_id,
      role_level = excluded.role_level,
      is_active = 1,
      updated_at = datetime('now');
  `);
  sendJson(res, 200, { ok: true, employee: (await loadManagedEmployees({ includeInactive: true })).find((item) => item.userId === employee.userId) });
}

async function updateManagedEmployeeStatus(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session) || !isScoring360ConfigManagerSession(session)) {
    sendJson(res, 403, { ok: false, error: "scoring360_config_manager_only" });
    return;
  }
  const body = await readJsonBody(req, { limitBytes: 20_000 });
  const userId = String(body.userId || body.user_id || "").trim();
  const active = body.active !== false;
  if(active && config.authMode!=='mock')return sendJson(res,405,{ok:false,error:'sso_roster_only'});
  if (!userId) {
    sendJson(res, 400, { ok: false, error: "employee_user_id_required" });
    return;
  }
  await ensureManagedEmployeeStore();
  const rows = await querySqlRows(`SELECT user_id, name FROM employees WHERE user_id = ${sqlValue(userId)} LIMIT 1;`);
  if (!rows[0]) {
    sendJson(res, 404, { ok: false, error: "employee_not_found" });
    return;
  }
  await execSql(`
    UPDATE employees SET is_active = ${active ? 1 : 0}, updated_at = datetime('now')
    WHERE user_id = ${sqlValue(userId)};
  `);
  if (!active) {
    await execSql(`
      UPDATE scoring360_assignments
      SET status = 'inactive', updated_at = datetime('now')
      WHERE status = 'active'
        AND (evaluee_user_id = ${sqlValue(userId)} OR evaluator_user_id = ${sqlValue(userId)})
        AND NOT EXISTS(SELECT 1 FROM scoring360_responses r WHERE r.assignment_id=scoring360_assignments.id)
        AND NOT EXISTS(SELECT 1 FROM performance_results p JOIN scoring360_cycles c ON p.month=substr(c.start_date,1,7) WHERE c.id=scoring360_assignments.cycle_id AND p.kind='collaboration' AND p.employee_user_id=scoring360_assignments.evaluee_user_id)
        AND NOT EXISTS(SELECT 1 FROM monthly_weighted_results p JOIN scoring360_cycles c ON p.month=substr(c.start_date,1,7) WHERE c.id=scoring360_assignments.cycle_id AND p.employee_user_id=scoring360_assignments.evaluee_user_id);
    `);
  }
  await refreshEmployeeDirectory();
  await systemSettings.audit(session?.user||mockUser(),'员工状态已更新',{userId,active});
  sendJson(res, 200, { ok: true, userId, active });
}

async function getLarkReportSyncStatus(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    autoSyncEnabled: (await systemSettings.reportAutomationConfig()).enabled,
    automation: await reportAutomation.overview(),
    autoSyncHour: config.larkReportAutoSyncHour,
    processRunning: liveReportSync.isRunning(),
    status: await readLarkReportSyncStatus(),
  });
}

async function startLarkReportSync(req, res) {
  if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return sendJson(res,403,{ok:false,error:"invalid_origin"});
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  const body = await readJsonBody(req, { limitBytes: 30_000 });
  const started = await enqueueLarkReportSync({
    source: "manual",
    start: body.start,
    end: body.end,
    commitStart: body.commitStart,
    commitEnd: body.commitEnd,
    id: body.id,
    label: body.label,
    range: body.range,
    generatedOn: body.generatedOn,
    exempt: body.exempt || config.larkReportAutoSyncExempt,
    ruleId: body.ruleId,
  });
  sendJson(res, started ? 202 : 409, {
    ok: started,
    alreadyRunning: !started,
    status: await readLarkReportSyncStatus(),
  });
}

async function enqueueLarkReportSync(options = {}) {
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
  const prior=new Date(today+'T00:00:00Z');prior.setUTCDate(prior.getUTCDate()-7);
  return liveReportSync.start({start:options.commitStart||options.start||(options.source==='auto_monday'?prior.toISOString().slice(0,10):undefined),end:options.commitEnd||options.end});
}

async function enqueueLegacyLarkReportSync(options = {}) {
  if (larkReportSyncProcess) return false;
  await writeLarkReportSyncStatus({
    ok: true,
    running: true,
    phase: "queued",
    message: "飞书汇报同步已进入后台队列",
    source: options.source || "manual",
    queuedAt: new Date().toISOString(),
  });
  const args = ["scripts/run-lark-report-weekly-sync.mjs"];
  const append = (key, value) => {
    if (value !== undefined && value !== null && String(value).trim()) args.push(`--${key}`, String(value).trim());
  };
  append("start", options.start);
  append("end", options.end);
  append("commitStart", options.commitStart);
  append("commitEnd", options.commitEnd);
  append("id", options.id);
  append("label", options.label);
  append("range", options.range);
  append("generatedOn", options.generatedOn);
  append("exempt", options.exempt);
  append("rule-id", options.ruleId);
  append("source", options.source);

  const child = spawn("node", args, {
    cwd: rootDir,
    env: { ...process.env, KIMI_APP_IGNORE_CACHE: "1" },
    stdio: ["ignore", "ignore", "pipe"],
    detached: false,
  });
  larkReportSyncProcess = child;
  child.stderr.on("data", (chunk) => {
    console.error(`[lark-report-sync] ${chunk}`);
  });
  child.on("close", async (code) => {
    larkReportSyncProcess = null;
    if (code !== 0) {
      const current = await readLarkReportSyncStatus();
      await writeLarkReportSyncStatus({
        ...current,
        ok: false,
        running: false,
        phase: current.phase === "failed" ? "failed" : "failed",
        message: current.message || `同步进程退出：${code}`,
        finishedAt: new Date().toISOString(),
      });
    }
  });
  return true;
}

async function readLarkReportSyncStatus() {
  try {
    return JSON.parse(await readFile(larkReportSyncStatusPath, "utf8"));
  } catch {
    return {
      ok: true,
      running: false,
      phase: "idle",
      message: "尚未运行飞书汇报同步",
    };
  }
}

async function writeLarkReportSyncStatus(status) {
  await mkdir(path.dirname(larkReportSyncStatusPath), { recursive: true });
  const temp=larkReportSyncStatusPath+'.'+randomUUID()+'.tmp';
  await writeFile(temp, `${JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  await rename(temp,larkReportSyncStatusPath);
}

function scheduleAutomaticReportCollection() {
  const tick=()=>reportAutomation.tick().catch(()=>console.error('automatic report collection scheduler failed'));
  setInterval(tick,60*1000).unref();
  void tick();
}

// Retained compatibility implementation; polling now collects new submissions throughout the week.
function scheduleWeeklyLarkReportSync() {
  if (!config.larkReportAutoSyncEnabled) return;
  const tick = async () => {
    const now = new Date();
    const shanghai = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const day = shanghai.getDay() || 7;
    const hour = shanghai.getHours();
    const dateKey = `${shanghai.getFullYear()}-${String(shanghai.getMonth() + 1).padStart(2, "0")}-${String(shanghai.getDate()).padStart(2, "0")}`;
    if (day !== 1 || hour < config.larkReportAutoSyncHour || lastAutoSyncKey === dateKey) return;
    const status = await readLarkReportSyncStatus();
    if (liveReportSync.isRunning() || larkReportSyncProcess) return;
    if (isWeeklyReportSyncCompletedForDate(status, dateKey)) {
      lastAutoSyncKey = dateKey;
      return;
    }
    lastAutoSyncKey = dateKey;
    await enqueueLarkReportSync({ source: "auto_monday", exempt: config.larkReportAutoSyncExempt });
  };
  setInterval(() => {
    tick().catch((error) => console.error("weekly lark report auto sync failed", error));
  }, 15 * 60 * 1000).unref();
  tick().catch((error) => console.error("weekly lark report auto sync failed", error));
}

function scheduleWeeklyGrowthReminder() {
  if (!config.weeklyReminderEnabled) return;
  let lastReminderKey = "";
  const tick = async () => {
    const shanghai = dateInShanghai(new Date());
    const day = shanghai.getDay() || 7;
    const hour = shanghai.getHours();
    const minute = shanghai.getMinutes();
    const dateKey = formatDateKey(shanghai);
    const end=fridayOfWeek(dateKey),policy=await systemSettings.policyFor(end.slice(0,7)),schedule=weeklyReportSchedule(end,chinaWorkCalendar,policy.deadlineTime);
    if(schedule.exempt||schedule.calendarPending||dateKey!==schedule.deadlineDate||hour!==config.weeklyReminderHour||minute<config.weeklyReminderMinute)return;
    if (lastReminderKey === dateKey) return;
    const workday = getChinaWorkdayStatus(dateKey);
    if (config.weeklyReminderRespectChinaHolidays && !workday.isWorkday) {
      lastReminderKey = dateKey;
      console.log(`weekly growth reminder skipped: ${dateKey} is not a China workday (${workday.reason})`);
      return;
    }
    lastReminderKey = dateKey;
    await runWeeklyGrowthReminder({ dryRun: false, force: false, source: "auto_friday", kind: "friday_review" });
  };
  setInterval(() => {
    tick().catch((error) => console.error("weekly growth reminder failed", error));
  }, 60 * 1000).unref();
  tick().catch((error) => console.error("weekly growth reminder failed", error));
}

function scheduleWeeklyUpdateReminder() {
  if (!config.weeklyUpdateReminderEnabled) return;
  let lastReminderKey = "";
  const tick = async () => {
    const shanghai = dateInShanghai(new Date());
    const day = shanghai.getDay() || 7;
    const hour = shanghai.getHours();
    const minute = shanghai.getMinutes();
    const dateKey = formatDateKey(shanghai);
    if (
      day !== config.weeklyUpdateReminderDay
      || !isAtOrAfterScheduledTime(hour, minute, config.weeklyUpdateReminderHour, config.weeklyUpdateReminderMinute)
    ) return;
    if (lastReminderKey === dateKey) return;
    const workday = getChinaWorkdayStatus(dateKey);
    if (config.weeklyReminderRespectChinaHolidays && !workday.isWorkday) {
      lastReminderKey = dateKey;
      console.log(`weekly update reminder skipped: ${dateKey} is not a China workday (${workday.reason})`);
      return;
    }
    const syncReady = await isWeeklyReportSyncReadyForDate(dateKey);
    if (!syncReady.ready) {
      console.log(`weekly update reminder waiting: ${syncReady.reason}`);
      return;
    }
    lastReminderKey = dateKey;
    await runWeeklyGrowthReminder({ dryRun: false, force: false, source: "auto_monday_update", kind: "monday_update" });
  };
  setInterval(() => {
    tick().catch((error) => console.error("weekly update reminder failed", error));
  }, 60 * 1000).unref();
  tick().catch((error) => console.error("weekly update reminder failed", error));
}

function isWeeklyReportSyncCompletedForDate(status, dateKey) {
  if (status?.ok !== true || status?.running) return false;
  const finishedAt = status.finishedAt || status.updatedAt || "";
  if (!finishedAt) return false;
  return formatDateKey(dateInShanghai(new Date(finishedAt))) === dateKey;
}

function isAtOrAfterScheduledTime(hour, minute, scheduledHour, scheduledMinute) {
  return hour > scheduledHour || (hour === scheduledHour && minute >= scheduledMinute);
}

function scheduleMonthEndScoreReminders() {
  const tick=async()=>{
    try{
      // Refreshes at most daily, also discovers next-year data without a code release.
      await calendarUpdates.refresh();
      const result=await monthEndScoreReminders.tick();
      if(result.failed)console.error('month-end scoring reminders: delivery failed',result.failed);
    }catch{console.error('month-end scoring reminders: scheduler failed');}
  };
  setInterval(tick,60*1000).unref();
  void tick();
}

// Retained for compatibility/reference; automatic startup uses month-end reminders above.
function scheduleScoring360Reminder() {
  if (!config.scoring360ReminderEnabled) return;
  let lastLaunchKey = "";
  let lastFollowupKey = "";
  const tick = async () => {
    const shanghai = dateInShanghai(new Date());
    const hour = shanghai.getHours();
    const minute = shanghai.getMinutes();
    const dateKey = formatDateKey(shanghai);
    const workday = getChinaWorkdayStatus(dateKey);
    if (!workday.isWorkday) return;

    if (
      config.scoring360LaunchMode === "scheduled"
      && shanghai.getDate() >= Math.min(...config.scoring360ReminderDaysOfMonth)
      && isAtOrAfterScheduledTime(
        hour,
        minute,
        config.scoring360ReminderHour,
        config.scoring360ReminderMinute,
      )
      && lastLaunchKey !== `${dateKey}:${shanghai.getDate()}`
    ) {
      const cycleId = await ensureScoring360CycleForLaunchDate(shanghai);
      const launch = await runScoring360Reminder({ cycleId, dryRun: false, force: false, source: "auto_scoring360_launch", kind: "launch" });
      if (launch.ok && launch.failed === 0 && launch.sent + launch.skipped > 0) {
        lastLaunchKey = `${dateKey}:${shanghai.getDate()}`;
      }
    }

    const cycleId = await resolveScoring360CycleId("");
    if (!cycleId || lastFollowupKey === dateKey) return;
    const launchRows = await querySqlRows(`
      SELECT COUNT(*) AS count
      FROM scoring360_reminder_sends
      WHERE cycle_id = ${sqlValue(cycleId)} AND kind = 'launch' AND status = 'sent';
    `).catch(() => []);
    if (Number(launchRows[0]?.count || 0) === 0) return;
    const cycle = await loadScoring360Cycle(cycleId);
    if (!isScoring360CycleForDate(cycle, shanghai)) return;
    if (!cycle?.followupAfterAt) return;
    const followupTime = new Date(String(cycle.followupAfterAt).replace(" ", "T")).getTime();
    if (Number.isFinite(followupTime) && Date.now() >= followupTime) {
      const pending = await loadScoring360PendingRecipients(cycleId);
      if (pending.length > 0) {
        const followup = await runScoring360Reminder({ cycleId, dryRun: false, force: false, source: "auto_scoring360_followup", kind: "followup" });
        if (followup.ok && followup.failed === 0) lastFollowupKey = dateKey;
      }
    }
  };
  setInterval(() => {
    tick().catch((error) => console.error("scoring360 reminder failed", error));
  }, 60 * 1000).unref();
  tick().catch((error) => console.error("scoring360 reminder failed", error));
}

function scheduleLarkAuthMonitor() {
  if (!config.larkAuthMonitorEnabled) return;
  const intervalMinutes = Math.max(5, config.larkAuthMonitorIntervalMinutes || 60);
  const tick = async () => {
    await runLarkAuthExpiryCheck({ source: "auto_lark_auth_monitor" });
  };
  setInterval(() => {
    tick().catch((error) => console.error("lark auth monitor failed", error));
  }, intervalMinutes * 60 * 1000).unref();
  tick().catch((error) => console.error("lark auth monitor failed", error));
}

async function runLarkAuthExpiryCheck({ source = "manual_lark_auth_monitor" } = {}) {
  const status = readLarkCliAuthStatus();
  if (!status.ok) {
    console.error("lark auth monitor status failed", status.error || status.stderr || status.stdout || "unknown_error");
    return { ok: false, error: status.error || "auth_status_failed" };
  }
  const user = status.user;
  if (!user?.userId || !user?.refreshExpiresAt) {
    return { ok: true, skipped: true, reason: "missing_user_refresh_expiry" };
  }
  const expiresAt = new Date(user.refreshExpiresAt).getTime();
  if (!Number.isFinite(expiresAt)) {
    return { ok: true, skipped: true, reason: "invalid_refresh_expiry" };
  }
  const remainingHours = (expiresAt - Date.now()) / 36e5;
  const threshold = pickLarkAuthExpiryThreshold(remainingHours);
  if (threshold === null) {
    return { ok: true, skipped: true, reason: "not_in_threshold", remainingHours: Number(remainingHours.toFixed(2)) };
  }
  const existing = await querySqlRows(`
    SELECT status, feishu_message_id, created_at
    FROM lark_auth_monitor_sends
    WHERE app_id = ${sqlValue(status.appId)}
      AND user_id = ${sqlValue(user.userId)}
      AND threshold_hours = ${threshold}
      AND refresh_expires_at = ${sqlValue(user.refreshExpiresAt)}
    LIMIT 1;
  `).catch(() => []);
  if (existing[0]?.status === "sent") {
    return { ok: true, skipped: true, reason: "already_sent", remainingHours: Number(remainingHours.toFixed(2)) };
  }

  const message = buildLarkAuthExpiryMessage({ status, user, threshold, remainingHours });
  const idempotencyKey = buildLarkAuthMonitorIdempotencyKey({
    appId: status.appId,
    userId: user.userId,
    refreshExpiresAt: user.refreshExpiresAt,
    threshold,
  });
  const sendResult = sendFeishuDirectMessage(
    user.userId,
    message,
    idempotencyKey,
    config.larkAuthMonitorIdentity,
  );
  const payload = sendResult.ok ? parseJsonMaybe(sendResult.stdout) : {
    ok: false,
    error: sendResult.error || "lark_cli_send_failed",
    stderr: sendResult.stderr,
    stdout: sendResult.stdout,
    exitCode: sendResult.exitCode,
  };
  const feishuMessageId = String(payload?.data?.message_id || payload?.message_id || "");
  const sendStatus = sendResult.ok ? "sent" : "failed";
  await execSql(`
    INSERT INTO lark_auth_monitor_sends
      (id, app_id, user_id, user_name, threshold_hours, refresh_expires_at, message,
       identity, feishu_message_id, idempotency_key, status, raw_response_json, created_at)
    VALUES
      (${sqlValue(randomUUID())}, ${sqlValue(status.appId)}, ${sqlValue(user.userId)}, ${sqlValue(user.userName)},
       ${threshold}, ${sqlValue(user.refreshExpiresAt)}, ${sqlValue(message)}, ${sqlValue(config.larkAuthMonitorIdentity)},
       ${sqlValue(feishuMessageId)}, ${sqlValue(idempotencyKey)}, ${sqlValue(sendStatus)},
       ${sqlValue(JSON.stringify(payload || {}))}, datetime('now'))
    ON CONFLICT(app_id, user_id, threshold_hours, refresh_expires_at) DO UPDATE SET
      status = excluded.status,
      feishu_message_id = excluded.feishu_message_id,
      raw_response_json = excluded.raw_response_json;
  `);
  if (!sendResult.ok) {
    console.error("lark auth monitor send failed", payload);
  }
  return {
    ok: sendResult.ok,
    status: sendStatus,
    thresholdHours: threshold,
    remainingHours: Number(remainingHours.toFixed(2)),
    source,
    feishuMessageId,
  };
}

function readLarkCliAuthStatus() {
  const result = spawnSync("lark-cli", ["auth", "status"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const raw = result.stdout || result.stderr || "";
  const payload = parseJsonMaybe(raw);
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      exitCode: result.status,
      error: result.error?.message || payload?.error?.message || "lark_cli_auth_status_failed",
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  }
  const user = payload?.identities?.user || {};
  return {
    ok: true,
    appId: String(payload.appId || ""),
    brand: String(payload.brand || ""),
    identity: String(payload.identity || ""),
    user: {
      userId: String(user.userId || ""),
      userName: String(user.userName || ""),
      tokenStatus: String(user.tokenStatus || ""),
      scope: String(user.scope || ""),
      expiresAt: String(user.expiresAt || ""),
      refreshExpiresAt: String(user.refreshExpiresAt || ""),
      grantedAt: String(user.grantedAt || ""),
    },
    raw: payload,
  };
}

function pickLarkAuthExpiryThreshold(remainingHours) {
  const thresholds = [...config.larkAuthMonitorThresholdHours]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (remainingHours <= 0) return 0;
  for (const threshold of thresholds) {
    if (remainingHours <= threshold) return threshold;
  }
  return null;
}

function buildLarkAuthExpiryMessage({ status, user, threshold, remainingHours }) {
  const expiryText = formatShanghaiDateTime(user.refreshExpiresAt);
  const remainingText = remainingHours <= 0 ? "已经到期" : `剩余约 ${formatRemainingHours(remainingHours)}`;
  const thresholdText = threshold === 0 ? "已到期" : `${threshold} 小时预警`;
  return `Jean，成长OS检测到飞书用户授权进入「${thresholdText}」窗口。

当前授权账号：${user.userName || "未知用户"}
应用：${status.appId || "未知应用"}
授权续期到期：${expiryText}
当前状态：${remainingText}

如果授权过期，周一自动拉取飞书汇报、通讯录解析和员工更新通知可能会失败。建议你抽空让我重新拉起飞书授权，避免下次自动更新被卡住。`;
}

function formatShanghaiDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || "未知");
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

function formatRemainingHours(value) {
  if (!Number.isFinite(value)) return "未知";
  if (value < 1) return `${Math.max(0, Math.round(value * 60))} 分钟`;
  return `${Math.round(value)} 小时`;
}

function buildLarkAuthMonitorIdempotencyKey({ appId, userId, refreshExpiresAt, threshold }) {
  const digest = createHash("sha1")
    .update(`lark-auth:${appId || ""}:${userId || ""}:${refreshExpiresAt || ""}:${threshold}`)
    .digest("hex")
    .slice(0, 24);
  return `wos-auth-${digest}`;
}

async function isWeeklyReportSyncReadyForDate(dateKey) {
  const status = await readLarkReportSyncStatus().catch(() => ({}));
  if (status.running || larkReportSyncProcess) return { ready: false, reason: "sync_running" };
  if (status.ok !== true) return { ready: false, reason: "last_sync_not_ok" };
  const finishedAt = status.finishedAt || status.updatedAt || "";
  if (!finishedAt) return { ready: false, reason: "missing_finished_at" };
  const finishedDateKey = formatDateKey(dateInShanghai(new Date(finishedAt)));
  if (finishedDateKey !== dateKey) return { ready: false, reason: `last_sync_finished_on_${finishedDateKey}` };
  return { ready: true, reason: "ready" };
}

function dateInShanghai(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function loadChinaWorkCalendar() {
  const filePath = path.join(rootDir, "src", "data", "chinaWorkCalendar.json");
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return {
      year: Number(parsed.year || 0),
      source: String(parsed.source || ""),
      holidayDates: Array.isArray(parsed.holidayDates) ? parsed.holidayDates.map(String) : [],
      workdayOverrides: Array.isArray(parsed.workdayOverrides) ? parsed.workdayOverrides.map(String) : [],
    };
  } catch (error) {
    console.error("Failed to load China work calendar", error);
    return { source: "", holidayDates: [], workdayOverrides: [] };
  }
}

function getChinaWorkdayStatus(input) {
  const dateKey = typeof input === "string" ? input : formatDateKey(input);
  const holidayDates = new Set(chinaWorkCalendar.holidayDates || []);
  const workdayOverrides = new Set(chinaWorkCalendar.workdayOverrides || []);
  if (!config.weeklyReminderRespectChinaHolidays) {
    return { dateKey, isWorkday: true, reason: "disabled" };
  }
  if (holidayDates.has(dateKey)) return { dateKey, isWorkday: false, reason: "china_public_holiday" };
  if (workdayOverrides.has(dateKey)) return { dateKey, isWorkday: true, reason: "china_adjusted_workday" };
  const day = new Date(`${dateKey}T00:00:00+08:00`).getDay();
  return {
    dateKey,
    isWorkday: day >= 1 && day <= 5,
    reason: day >= 1 && day <= 5 ? "weekday" : "weekend",
  };
}

async function runWeeklyGrowthReminder({ dryRun = true, force = false, source = "manual", actor = null, kind = "friday_review" } = {}) {
  const context = await loadWeeklyReminderContext();
  const deliveryRecipients = await resolveWeeklyReminderDeliveryRecipients(context.recipients);
  const outboxPeriodId = buildWeeklyReminderOutboxPeriodId(context.period.id, kind);
  const outboxByUserId = config.weeklyReminderUseOutbox
    ? await loadWeeklyReminderOutbox(outboxPeriodId)
    : new Map();
  const results = [];
  for (const recipient of context.recipients) {
    const deliveryRecipient = deliveryRecipients.get(recipient.userId) || recipient;
    const outboxItem = outboxByUserId.get(recipient.userId) || outboxByUserId.get(deliveryRecipient.userId);
    const message = kind==='friday_review'?await buildWeeklyReminderMessage(recipient,context.period,kind):outboxItem?.message||await buildWeeklyReminderMessage(recipient, context.period, kind);
    const idempotencyKey = buildWeeklyReminderIdempotencyKey(context.period.id, deliveryRecipient.userId, kind);
    const existing = await querySqlRows(`
      SELECT status, feishu_message_id, created_at
      FROM weekly_reminder_sends
      WHERE idempotency_key = ${sqlValue(idempotencyKey)}
      LIMIT 1;
    `).catch(() => []);
    if (!force && existing[0]?.status === "sent") {
      results.push({
        ok: true,
        skipped: true,
        reason: "already_sent",
        recipient: pickReminderRecipient(deliveryRecipient),
        existing: existing[0],
      });
      continue;
    }

    if (dryRun) {
      await persistWeeklyReminderSend({
        context,
        recipient: deliveryRecipient,
        message,
        idempotencyKey,
        source,
        identity: config.weeklyReminderIdentity,
        status: "dry_run",
        feishuMessageId: "",
        rawResponse: { dryRun: true, actorName: actor?.name || "", outboxId: outboxItem?.id || "" },
      });
      results.push({
        ok: true,
        dryRun: true,
        recipient: pickReminderRecipient(deliveryRecipient),
        message,
        idempotencyKey,
        outbox: Boolean(outboxItem),
      });
      continue;
    }

    const sendResult = sendFeishuDirectMessage(
      deliveryRecipient.userId,
      message,
      idempotencyKey,
      config.weeklyReminderIdentity,
    );
    const payload = sendResult.ok ? parseJsonMaybe(sendResult.stdout) : {
      ok: false,
      error: sendResult.error || "lark_cli_send_failed",
      stderr: sendResult.stderr,
      stdout: sendResult.stdout,
      exitCode: sendResult.exitCode,
    };
    const feishuMessageId = String(payload?.data?.message_id || payload?.message_id || "");
    await persistWeeklyReminderSend({
      context,
      recipient: deliveryRecipient,
      message,
      idempotencyKey,
      source,
      identity: config.weeklyReminderIdentity,
      status: sendResult.ok ? "sent" : "failed",
      feishuMessageId,
      rawResponse: payload,
    });
    await updateWeeklyReminderOutboxAfterSend({
      outboxItem,
      recipientUserId: deliveryRecipient.userId,
      status: sendResult.ok ? "sent" : "failed",
      feishuMessageId,
    });
    results.push({
      ok: sendResult.ok,
      recipient: pickReminderRecipient(deliveryRecipient),
      messageId: feishuMessageId,
      idempotencyKey,
      outbox: Boolean(outboxItem),
      error: sendResult.ok ? "" : payload.error,
      stderr: sendResult.ok ? "" : payload.stderr,
    });
  }

  return {
    ok: results.every((item) => item.ok),
    dryRun,
    source,
    kind,
    period: context.period,
    exemptPeople: context.exemptPeople,
    recipientCount: context.recipients.length,
    results,
  };
}

async function resolveWeeklyReminderDeliveryRecipients(recipients) {
  const result = new Map(recipients.map((recipient) => [recipient.userId, recipient]));
  const emailRecipients = recipients.filter((recipient) => recipient.email);
  if (emailRecipients.length === 0) return result;
  try {
    const token = await getFeishuTenantAccessToken();
    const emailToRecipient = new Map(emailRecipients.map((recipient) => [recipient.email.toLowerCase(), recipient]));
    const json = await feishuJson("/open-apis/contact/v3/users/batch_get_id?user_id_type=user_id", {
      method: "POST",
      token,
      body: { emails: Array.from(emailToRecipient.keys()) },
    });
    const users = Array.isArray(json.data?.user_list) ? json.data.user_list : [];
    for (const user of users) {
      const email = String(user.email || "").toLowerCase();
      const userId = String(user.user_id || "").trim();
      const recipient = emailToRecipient.get(email);
      if (recipient && userId) result.set(recipient.userId, { ...recipient, userId });
    }
  } catch (error) {
    console.error("Failed to resolve weekly reminder user IDs", error);
  }
  return result;
}

async function loadWeeklyReminderOutbox(periodId) {
  const rows = await querySqlRows(`
    SELECT id, period_id, recipient_user_id, recipient_name, message, personalization_note, status
    FROM weekly_reminder_outbox
    WHERE period_id = ${sqlValue(periodId)}
      AND status IN ('prepared', 'failed', 'sent')
    ORDER BY updated_at DESC;
  `).catch(() => []);
  const result = new Map();
  for (const row of rows) {
    if (!row.recipient_user_id || result.has(row.recipient_user_id)) continue;
    result.set(row.recipient_user_id, {
      id: row.id,
      periodId: row.period_id,
      recipientUserId: row.recipient_user_id,
      recipientName: row.recipient_name,
      message: row.message,
      personalizationNote: row.personalization_note,
      status: row.status,
    });
  }
  return result;
}

async function updateWeeklyReminderOutboxAfterSend({ outboxItem, recipientUserId, status, feishuMessageId }) {
  if (!outboxItem?.id) return;
  await execSql(`
    UPDATE weekly_reminder_outbox
    SET status = ${sqlValue(status)},
        recipient_user_id = COALESCE(NULLIF(${sqlValue(recipientUserId || "")}, ''), recipient_user_id),
        feishu_message_id = ${sqlValue(feishuMessageId)},
        sent_at = CASE WHEN ${sqlValue(status)} = 'sent' THEN datetime('now') ELSE sent_at END,
        updated_at = datetime('now')
    WHERE id = ${sqlValue(outboxItem.id)};
  `);
}

async function loadWeeklyReminderContext() {
  const filePath = path.join(config.dataDir, "prototypeData.json");
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  const meta = parsed.meta || {};
  const periods = Array.isArray(meta.periods) ? meta.periods : [];
  const period = periods.find((item) => String(item.id || "") === String(meta.current_week_id || ""))
    || periods.at(-1)
    || {};
  const periodId = String(period.id || meta.current_week_id || "latest");
  const periodLabel = [period.label || meta.current_week_label, period.range || meta.current_week_range]
    .filter(Boolean)
    .join(" ")
    .trim();
  const exemptPeople = new Set([
    ...toSimpleList(period.exempt_people || period.exemptPeople),
    ...toSimpleList(meta.exempt_people || meta.exemptPeople),
  ].map((name) => String(name || "").trim()).filter(Boolean));
  const rows = Array.isArray(parsed.employee_summary) ? parsed.employee_summary : [];
  const activeEmployeeRows = await querySqlRows(`
    SELECT user_id, name
    FROM employees
    WHERE is_active = 1;
  `).catch(() => []);
  const activeUserIds = new Set(activeEmployeeRows.map((row) => String(row.user_id || "").trim()).filter(Boolean));
  const activeNames = new Set(activeEmployeeRows.map((row) => normalizeUserName(row.name)).filter(Boolean));
  const recipients = rows
    .map((row) => ({
      userId: String(row.user_id || row.userId || "").trim(),
      name: String(row["姓名"] || row.name || "").trim(),
      department: String(row["部门"] || row.department || "").trim(),
      email: String(row["企业邮箱"] || row.email || "").trim(),
    }))
    .filter((employee) => employee.userId && employee.name && !exemptPeople.has(employee.name))
    .filter((employee) => activeEmployeeRows.length === 0
      || activeUserIds.has(employee.userId)
      || activeNames.has(normalizeUserName(employee.name)));
  return {
    period: {
      id: periodId,
      label: periodLabel || "最近一周期",
      rawLabel: String(period.label || meta.current_week_label || ""),
      range: String(period.range || meta.current_week_range || ""),
    },
    exemptPeople: Array.from(exemptPeople),
    recipients,
  };
}

async function buildWeeklyReminderMessage(recipient, period, kind = "friday_review") {
  if (kind === "monday_update") {
    return `${recipient.name}，早上好。

感谢你上周认真、详细地完成周报。上周的周报分析已经更新到成长 OS，你可以抽空看看自己的 AI 点评、成长记录和任务建议。

入口：${config.baseUrl}

期待你在这一周里，也继续带着复盘往前走，看到自己的成长和进步。`;
  }
  const periodText = period.label && period.label !== "最近一周期" ? `上一周期「${period.label}」` : "上一周期";
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()),end=fridayOfWeek(today),policy=await systemSettings.policyFor(end.slice(0,7)),schedule=weeklyReportSchedule(end,chinaWorkCalendar,policy.deadlineTime);
  const deadline=schedule.exempt?'本周整周放假，免交周报。':schedule.calendarPending?'本周工作日日历待更新，请以公司通知的截止时间为准。':`请在 ${schedule.deadlineDate} ${policy.deadlineTime} 前提交周报${schedule.reason==='pre_holiday'?'（放假前最后一个工作日）':''}。`;
  return `${recipient.name}，又到每周总结时间了。

感谢你上一周的辛勤付出。成长 OS 会定时收集飞书周报并自动进行 AI 分析。撰写新一周周报之前，可以先打开成长 OS 回看一下${periodText}的个人成长页，再总结这一周的新进展。${deadline}

入口：${config.baseUrl}

让周报不只是提交给老板看的结果，而是你自己的成长轨迹。`;
}

function buildWeeklyReminderOutboxPeriodId(periodId, kind = "friday_review") {
  return kind === "monday_update" ? `${periodId || "latest"}::monday_update` : String(periodId || "latest");
}

function buildWeeklyReminderIdempotencyKey(periodId, userId, kind = "friday_review") {
  const digest = createHash("sha1").update(`${kind}:${periodId || "latest"}:${userId}`).digest("hex").slice(0, 24);
  return `wos-reminder-${digest}`;
}

function pickReminderRecipient(recipient) {
  return {
    userId: recipient.userId,
    name: recipient.name,
    department: recipient.department,
  };
}

async function persistWeeklyReminderSend({
  context,
  recipient,
  message,
  idempotencyKey,
  source,
  identity,
  status,
  feishuMessageId,
  rawResponse,
}) {
  await execSql(`
    INSERT OR REPLACE INTO weekly_reminder_sends
      (id, period_id, period_label, recipient_user_id, recipient_name, department, message,
       source, identity, feishu_message_id, idempotency_key, status, raw_response_json, created_at)
    VALUES
      (${sqlValue(randomUUID())}, ${sqlValue(context.period.id)}, ${sqlValue(context.period.label)},
       ${sqlValue(recipient.userId)}, ${sqlValue(recipient.name)}, ${sqlValue(recipient.department)},
       ${sqlValue(message)}, ${sqlValue(source)}, ${sqlValue(identity)}, ${sqlValue(feishuMessageId)},
       ${sqlValue(idempotencyKey)}, ${sqlValue(status)}, ${sqlValue(JSON.stringify(rawResponse || {}))},
       datetime('now'));
  `);
}

function toSimpleList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value.split(/[,\n;，、]/).map((item) => item.trim()).filter(Boolean);
  }
  return value ? [value] : [];
}

async function importWeeklyReport(req, res) {
  const session = getSession(req);
  if (!session && config.authMode !== "mock") {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (isExternalSession(session)) {
    sendJson(res, 403, { ok: false, error: "external_share_readonly" });
    return;
  }
  if (!isBossSession(session)) {
    sendJson(res, 403, { ok: false, error: "boss_only" });
    return;
  }
  const user = session?.user || mockUser();
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    sendJson(res, 400, { ok: false, error: "multipart_required" });
    return;
  }
  const multipart = await readMultipartBody(req, contentType, { limitBytes: 20 * 1024 * 1024 });
  const file = multipart.files.find((item) => item.fieldName === "file") || multipart.files[0];
  if (!file) {
    sendJson(res, 400, { ok: false, error: "file_required" });
    return;
  }
  const sourceName = sanitizeFileName(file.fileName || "weekly-report-upload");
  const sourceSha = sha256(file.data);
  await mkdir(config.uploadDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const savedPath = path.join(config.uploadDir, `${stamp}-${sourceSha.slice(0, 10)}-${sourceName}`);
  await writeFile(savedPath, file.data);

  const parsed = parseWeeklyReportUpload(savedPath, sourceName, file.data);
  const batchId = randomUUID();
  const requestedImportMode = String(multipart.fields.importMode || "").trim();
  const importMode = requestedImportMode && requestedImportMode !== "auto"
    ? requestedImportMode
    : inferImportMode(parsed.records, sourceName);
  const weekWindow = inferBatchWeekWindow(sourceName, parsed.records);
  const normalized = parsed.records.map((record, index) => normalizeImportedWeeklyRecord(record, index, weekWindow));
  const validRecords = normalized.filter((record) => record.employeeName && (record.content.results || record.content.problems || record.content.nextPlan || record.content.reflection));

  await execSql(`
    INSERT INTO import_batches
      (id, source_type, source_name, source_sha256, imported_by_user_id, record_count, status)
    VALUES
      (${sqlValue(batchId)}, ${sqlValue(importMode)}, ${sqlValue(sourceName)}, ${sqlValue(sourceSha)},
       ${sqlValue(user.userId)}, ${validRecords.length}, 'imported');
  `);

  let inserted = 0;
  let updated = 0;
  for (const record of validRecords) {
    const existing = await querySqlRows(`
      SELECT id
      FROM weekly_reports
      WHERE employee_user_id = ${sqlValue(record.employeeUserId)} AND week_label = ${sqlValue(record.weekLabel)}
      LIMIT 1;
    `);
    if (existing.length > 0) updated += 1;
    else inserted += 1;

    await execSql(`
      INSERT INTO employees (user_id, name, department, email, updated_at)
      VALUES (${sqlValue(record.employeeUserId)}, ${sqlValue(record.employeeName)}, ${sqlValue(record.department)}, ${sqlValue(record.email)}, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        name = excluded.name,
        department = excluded.department,
        email = excluded.email,
        updated_at = datetime('now');

      INSERT INTO weekly_reports
        (id, employee_user_id, employee_name, department, week_label, week_start, week_end, status,
         content_json, source_batch_id, source_hash, is_late, submitted_at, updated_at)
      VALUES
        (${sqlValue(record.id)}, ${sqlValue(record.employeeUserId)}, ${sqlValue(record.employeeName)}, ${sqlValue(record.department)},
         ${sqlValue(record.weekLabel)}, ${sqlValue(record.weekStart)}, ${sqlValue(record.weekEnd)}, ${sqlValue(record.status)},
         ${sqlValue(JSON.stringify(record.contentJson))}, ${sqlValue(batchId)}, ${sqlValue(record.sourceHash)},
         ${record.isLate ? 1 : 0}, ${sqlValue(record.submittedAt)}, datetime('now'))
      ON CONFLICT(employee_user_id, week_label) DO UPDATE SET
        employee_name = excluded.employee_name,
        department = excluded.department,
        week_start = excluded.week_start,
        week_end = excluded.week_end,
        status = excluded.status,
        content_json = excluded.content_json,
        source_batch_id = excluded.source_batch_id,
        source_hash = excluded.source_hash,
        is_late = excluded.is_late,
        submitted_at = excluded.submitted_at,
        updated_at = datetime('now');
    `);
  }

  sendJson(res, 200, {
    ok: true,
    batch: {
      id: batchId,
      sourceName,
      importMode,
      sourceSha256: sourceSha,
      savedPath,
      rowCount: parsed.records.length,
      validCount: validRecords.length,
      inserted,
      updated,
      weekLabel: weekWindow.weekLabel,
    },
    sampleRecords: validRecords.slice(0, 5).map((record) => ({
      employeeName: record.employeeName,
      department: record.department,
      weekLabel: record.weekLabel,
      status: record.status,
    })),
    warnings: parsed.warnings,
  });
}

async function enterExternalShare(_req, res, url) {
  const token = decodeURIComponent(url.pathname.replace(/^\/share\//, "")).trim();
  const link = await validateExternalShareToken(token);
  if (!link) {
    send(res, 403, textHeaders, "外部访问链接无效或已过期。请联系管理员重新生成。");
    return;
  }
  setSession(
    res,
    {
      user: {
        userId: `external:${link.id}`,
        unionId: `external:${link.id}`,
        name: link.name || "外部顾问",
        email: "",
        avatarUrl: "",
        role: "external_boss_view",
      },
      externalShare: {
        id: link.id,
        scope: link.scope,
        expiresAt: link.expiresAt,
      },
      issuedAt: Date.now(),
      expiresAt: link.expiresAt,
    },
    { maxAge: Math.max(60, Math.floor((new Date(link.expiresAt).getTime() - Date.now()) / 1000)) },
  );
  redirect(res, "/");
}

async function validateExternalShareToken(token) {
  if (!token || token.length < 24) return null;
  const tokenHash = hashExternalToken(token);
  const rows = await querySqlRows(`
    SELECT id, name, scope, expires_at, status
    FROM external_share_links
    WHERE token_hash = ${sqlValue(tokenHash)}
    LIMIT 1;
  `);
  const row = rows[0];
  if (!row || row.status !== "active" || new Date(row.expires_at).getTime() <= Date.now()) return null;
  await execSql(`
    UPDATE external_share_links
    SET access_count = access_count + 1, last_accessed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ${sqlValue(row.id)};
  `);
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    expiresAt: row.expires_at,
  };
}

function externalLinkRuntimeStatus(row) {
  if (row.status !== "active") return row.status;
  return new Date(row.expires_at).getTime() <= Date.now() ? "expired" : "active";
}

function hashExternalToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

async function updateFeishuTaskFromEvent(body, eventType) {
  const guid = extractTaskGuid(body);
  if (!guid) return;
  const event = body.event || body;
  const status = inferTaskStatus(event, eventType);
  await execSql(`
    UPDATE feishu_tasks
    SET status = ${sqlValue(status)}, raw_response_json = ${sqlValue(JSON.stringify(body))}, updated_at = datetime('now')
    WHERE guid = ${sqlValue(guid)};
  `);
}

function extractTaskGuid(body) {
  const event = body.event || body;
  return String(
    event.task?.guid ||
      event.task?.task_guid ||
      event.task?.id ||
      event.task_guid ||
      event.guid ||
      event.task_id ||
      event.resource_id ||
      "",
  ).trim();
}

function inferTaskStatus(event, eventType) {
  const text = `${eventType} ${event.task?.status || ""} ${event.status || ""}`.toLowerCase();
  if (text.includes("delete")) return "deleted";
  if (text.includes("complete") || text.includes("done") || text.includes("closed")) return "completed";
  if (text.includes("comment")) return "commented";
  return "updated";
}

function unwrapFeishuEventBody(body) {
  if (!body.encrypt) return body;
  if (!config.eventEncryptKey) throw new Error("FEISHU_EVENT_ENCRYPT_KEY is required for encrypted events");
  const encrypted = Buffer.from(String(body.encrypt), "base64");
  const iv = encrypted.subarray(0, 16);
  const ciphertext = encrypted.subarray(16);
  const key = createHash("sha256").update(config.eventEncryptKey).digest();
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(decrypted);
}

async function createFeishuTask(candidate, session) {
  assertFeishuConfig();
  const token = session?.userAccessToken || (await getFeishuTenantAccessToken());
  const due = (candidate.useDueDate || config.taskDueMode === "candidate") ? toFeishuDue(candidate.dueDate) : null;
  const members = [];
  if (candidate.assigneeUserId) {
    members.push({ id: candidate.assigneeUserId, type: "user", role: "assignee" });
  }
  for (const followerUserId of candidate.followerUserIds) {
    if (followerUserId && followerUserId !== candidate.assigneeUserId) {
      members.push({ id: followerUserId, type: "user", role: "follower" });
    }
  }
  const body = {
    summary: `[${candidate.priority}] ${candidate.title}`.slice(0, 250),
    description: candidate.description,
    client_token: candidate.idempotencyKey,
  };
  if (due) body.due = due;
  if (members.length > 0) body.members = members;
  return feishuJson("/open-apis/task/v2/tasks?user_id_type=user_id", {
    method: "POST",
    token,
    body,
  });
}

function sendFeishuGroupMessage(text, idempotencyKey) {
  const result = spawnSync("lark-cli", [
    "im",
    "+messages-send",
    "--as",
    "user",
    "--chat-id",
    config.companyChatId,
    "--text",
    text,
    "--idempotency-key",
    idempotencyKey,
  ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: !result.error && result.status === 0,
    exitCode: result.status,
    error: result.error?.message || "",
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function sendFeishuDirectMessage(userId, text, idempotencyKey, identity = "bot") {
  const result = spawnSync("lark-cli", [
    "im",
    "+messages-send",
    "--as",
    identity === "user" ? "user" : "bot",
    "--user-id",
    userId,
    "--text",
    text,
    "--idempotency-key",
    idempotencyKey,
  ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: !result.error && result.status === 0,
    exitCode: result.status,
    error: result.error?.message || "",
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

async function sendCompanyMessageToFeishu(session, text, idempotencyKey) {
  if (session?.userAccessToken) {
    try {
      return {
        ok: true,
        transport: "feishu_user_access_token",
        payload: await sendFeishuUserGroupMessage(session.userAccessToken, text, idempotencyKey),
      };
    } catch (error) {
      return {
        ok: false,
        transport: "feishu_user_access_token",
        payload: {
          ok: false,
          error: error instanceof Error ? error.message : "feishu_user_send_failed",
        },
      };
    }
  }

  const cliResult = sendFeishuGroupMessage(text, idempotencyKey);
  return {
    ok: cliResult.ok,
    transport: "lark_cli_user",
    payload: cliResult.ok ? parseJsonMaybe(cliResult.stdout) : {
      ok: false,
      error: cliResult.error || "lark_cli_send_failed",
      stderr: cliResult.stderr,
      stdout: cliResult.stdout,
      exitCode: cliResult.exitCode,
    },
  };
}

async function sendFeishuUserGroupMessage(userAccessToken, text, idempotencyKey) {
  return feishuJson("/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    token: userAccessToken,
    body: {
      receive_id: config.companyChatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
      uuid: idempotencyKey,
    },
  });
}

function parseJsonMaybe(value) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return { raw: String(value || "") };
  }
}

function normalizeTaskCandidate(candidate, currentUser) {
  const candidateId = String(candidate.id || candidate.candidateId || randomUUID());
  const evidence = String(candidate.evidence || "").trim();
  const metric = String(candidate.metric || "").trim();
  const description = [
    String(candidate.description || "").trim(),
    normalizeDate(candidate.dueDate) ? `\n建议闭环周期：${normalizeDate(candidate.dueDate)}` : "",
    metric ? `\n验收口径：${metric}` : "",
    evidence ? `\n周报证据：${evidence}` : "",
    candidate.firstStep ? `\n第一步：${candidate.firstStep}` : "",
    candidate.contextNeed ? `\n上下文：${candidate.contextNeed}` : "",
  ].join("").trim();
  const currentUserUserId = String(currentUser?.userId || "").trim();
  const requestedFollowers = Array.isArray(candidate.followerUserIds)
    ? candidate.followerUserIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const followerUserIds = Array.from(new Set([currentUserUserId, ...requestedFollowers].filter(Boolean)));
  return {
    candidateId,
    priority: ["P0", "P1", "P2"].includes(candidate.priority) ? candidate.priority : "P1",
    title: String(candidate.title || "周报闭环任务").trim(),
    description,
    assigneeUserId: String(candidate.ownerUserId || candidate.assigneeUserId || "").trim(),
    followerUserIds,
    dueDate: normalizeDate(candidate.dueDate),
    useDueDate: Boolean(candidate.useDueDate),
    idempotencyKey: `weekly-report-os-${candidateId}`.slice(0, 64),
    raw: candidate,
  };
}

async function persistCreatedTask(candidate, created) {
  const task = created.data?.task || created.data || {};
  const guid = task.guid || task.task_id || task.id || randomUUID();
  const url = task.url || task.link || "";
  await execSql(`
    INSERT OR REPLACE INTO feishu_tasks
      (guid, candidate_id, idempotency_key, summary, assignee_user_id, due_date, url, status, raw_response_json, updated_at)
    VALUES
      (${sqlValue(guid)}, ${sqlValue(candidate.candidateId)}, ${sqlValue(candidate.idempotencyKey)},
       ${sqlValue(candidate.title)}, ${sqlValue(candidate.assigneeUserId)}, ${sqlValue(candidate.dueDate)},
       ${sqlValue(url)}, 'created', ${sqlValue(JSON.stringify(created))}, datetime('now'));
    UPDATE task_candidates
      SET created_task_guid = ${sqlValue(guid)}, status = 'created', updated_at = datetime('now')
      WHERE id = ${sqlValue(candidate.candidateId)};
  `);
}

async function getFeishuAppAccessToken() {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret }),
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw new Error(`Feishu app token failed: ${JSON.stringify(json)}`);
  return json.app_access_token;
}

async function getFeishuTenantAccessToken() {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret }),
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw new Error(`Feishu tenant token failed: ${JSON.stringify(json)}`);
  return json.tenant_access_token;
}

async function feishuJson(apiPath, options) {
  const response = await fetch(`https://open.feishu.cn${apiPath}`, {
    method: options.method,
    headers: {
      authorization: `Bearer ${options.token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw new Error(`Feishu API failed ${apiPath}: ${JSON.stringify(json)}`);
  return json;
}

async function serveStatic(url, res) {
  const requested = decodeURIComponent(url.pathname);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(config.staticDir, safePath === "/" ? "index.html" : safePath);
  const targetPath = await fileExists(filePath) ? filePath : path.join(config.staticDir, "index.html");
  if (!(await fileExists(targetPath))) {
    send(res, 404, textHeaders, "Build output not found. Run npm run build first.");
    return;
  }
  const ext = path.extname(targetPath);
  const headers = { "content-type": contentType(ext), "cache-control": ext === ".html" ? "no-store" : "no-cache" };
  res.writeHead(200, headers);
  createReadStream(targetPath).pipe(res);
}

async function ensureDatabase() {
  await mkdir(path.dirname(config.dbPath), { recursive: true });
  const prior=await querySqlRows('PRAGMA table_info(employees);');
  if(prior.some(c=>c.name==='open_id'))throw Error('user_id_migration_required');
  const schemaPath = path.join(rootDir, "db/schema.sql");
  if (!existsSync(schemaPath)) return;
  const schema = await readFile(schemaPath, "utf8");
  await execSql(schema);
  await ensureScoring360Schema();
}

async function ensureScoring360Schema() {
  const columns = [
    ["launch_at", "TEXT"],
    ["due_at", "TEXT"],
    ["followup_after_at", "TEXT"],
    ["historical_weight", `REAL NOT NULL DEFAULT ${Number.isFinite(config.scoring360HistoricalWeight) ? config.scoring360HistoricalWeight : 0.3}`],
    ["current_weight", `REAL NOT NULL DEFAULT ${Number.isFinite(config.scoring360CurrentWeight) ? config.scoring360CurrentWeight : 0.7}`],
  ];
  for (const [column, definition] of columns) {
    await addColumnIfMissing("scoring360_cycles", column, definition);
  }
}

async function addColumnIfMissing(table, column, definition) {
  const existing = await querySqlRows(`PRAGMA table_info(${table});`).catch(() => []);
  if (existing.some((row) => row.name === column)) return;
  await execSql(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

async function loadBossAccessState() {
  try {
    const rows = await querySqlRows(`SELECT value_json FROM app_settings WHERE key = 'boss_view_members' LIMIT 1;`);
    const parsed = rows[0]?.value_json ? JSON.parse(rows[0].value_json) : null;
    const members = normalizeBossViewMembers(parsed?.members || defaultBossViewMembers);
    applyBossViewMembers(members);
  } catch (error) {
    console.error("Failed to load boss view members", error);
    applyBossViewMembers(defaultBossViewMembers);
  }
}

async function loadScoring360AdminState() {
  try {
    const rows = await querySqlRows(`SELECT value_json FROM app_settings WHERE key = 'scoring360_admin_members' LIMIT 1;`);
    const parsed = rows[0]?.value_json ? JSON.parse(rows[0].value_json) : null;
    applyScoring360AdminMembers(parsed?.members || []);
  } catch (error) {
    console.error("Failed to load scoring360 admin members", error);
    applyScoring360AdminMembers([]);
  }
}

async function ensureScoring360SeedData() {
  if (!existsSync(scoring360DataPath)) return;
  const data = JSON.parse(await readFile(scoring360DataPath, "utf8"));
  const assignmentCount = Array.isArray(data?.assignments) ? data.assignments.length : 0;
  const responseCount = Array.isArray(data?.responses) ? data.responses.length : 0;
  const rows = await querySqlRows(`
    SELECT
      (SELECT COUNT(*) FROM scoring360_assignments) AS assignment_count,
      (SELECT COUNT(*) FROM scoring360_responses) AS response_count;
  `).catch(() => []);
  if (Number(rows[0]?.assignment_count || 0) >= assignmentCount && Number(rows[0]?.response_count || 0) >= responseCount) return;
  await seedScoring360FromJson(data);
}

async function seedScoring360FromJson(data) {
  const cycles = Array.isArray(data?.cycles) ? data.cycles : [];
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  const responses = Array.isArray(data?.responses) ? data.responses : [];
  const statements = ["BEGIN TRANSACTION;"];

  for (const cycle of cycles) {
    statements.push(`
      INSERT OR IGNORE INTO scoring360_cycles (
        id, label, mode, start_date, end_date, launch_at, status, total_employees, total_evaluees, created_at, updated_at
      ) VALUES (
        ${sqlValue(cycle.id)}, ${sqlValue(cycle.label)}, ${sqlValue(cycle.mode || "monthly")},
        ${sqlValue(cycle.startDate)}, ${sqlValue(cycle.endDate)},
        ${sqlValue(cycle.launchAt || (["open", "active"].includes(cycle.status || "open") ? new Date().toISOString() : ""))},
        ${sqlValue(cycle.status || "open")},
        ${sqlValue(Number(cycle.totalEmployees || 0))}, ${sqlValue(Number(cycle.totalEvaluees || 0))},
        datetime('now'), datetime('now')
      );
    `);
  }

  for (const assignment of assignments) {
    const evaluee=await findActiveManagedEmployee(assignment.evalueeUserId || assignment.evaluee);
    const evaluator=await findActiveManagedEmployee(assignment.evaluatorUserId || assignment.evaluator) || (assignment.evaluatorUserId?{userId:assignment.evaluatorUserId}:null);
    if(!evaluee||!evaluator)throw Error("assignment_identity_unresolved");
    statements.push(`
      INSERT OR IGNORE INTO scoring360_assignments (
        id, cycle_id, evaluee_name, evaluator_name, evaluee_user_id, evaluator_user_id, created_at
      ) VALUES (
        ${sqlValue(assignment.id)}, ${sqlValue(assignment.cycleId)}, ${sqlValue(assignment.evaluee)},
        ${sqlValue(assignment.evaluator)}, ${sqlValue(evaluee.userId)}, ${sqlValue(evaluator.userId)}, datetime('now')
      );
    `);
  }

  for (const response of responses) {
    statements.push(`
      INSERT OR IGNORE INTO scoring360_responses (
        id, assignment_id, cycle_id, evaluee_name, evaluator_name, score, comment, submitted_at
      ) VALUES (
        ${sqlValue(response.id)}, ${sqlValue(response.assignmentId)}, ${sqlValue(response.cycleId)},
        ${sqlValue(response.evaluee)}, ${sqlValue(response.evaluator)}, ${sqlValue(Number(response.score || 0))},
        ${sqlValue(response.comment || "")}, ${sqlValue(response.submittedAt || "")}
      );
    `);
  }
  statements.push("COMMIT;");
  await execSql(statements.join("\n"));
}

async function resolveScoring360CycleId(input) {
  const requested = String(input || "").trim();
  if (requested) {
    const rows = await querySqlRows(`SELECT id FROM scoring360_cycles WHERE id = ${sqlValue(requested)} LIMIT 1;`);
    if (rows[0]?.id) return rows[0].id;
  }
  const rows = await querySqlRows(`
    SELECT id FROM scoring360_cycles
    WHERE status IN ('open', 'active') AND NULLIF(launch_at, '') IS NOT NULL
    ORDER BY datetime(launch_at) DESC, datetime(created_at) DESC
    LIMIT 1;
  `);
  if (rows[0]?.id) return rows[0].id;
  const fallbackRows = await querySqlRows(`
    SELECT id FROM scoring360_cycles
    WHERE status <> 'draft'
    ORDER BY date(end_date) DESC, datetime(created_at) DESC
    LIMIT 1;
  `);
  return fallbackRows[0]?.id || "";
}

function scoring360ActiveDate() {
  const override = String(config.scoring360ActiveDate || "").trim();
  if (override) {
    const date = new Date(override);
    if (Number.isFinite(date.getTime())) return date;
  }
  return new Date();
}

async function ensureScoring360CycleForLaunchDate(dateLike,{copyAssignments=true}={}) {
  const cycle = scoring360CycleForLaunchDate(dateLike);
  const existingRows = await querySqlRows(`SELECT id FROM scoring360_cycles WHERE id = ${sqlValue(cycle.id)} LIMIT 1;`);
  if (existingRows[0]?.id) return existingRows[0].id;

  const weights = normalizeScoring360Weights();
  await execSql(`
    INSERT INTO scoring360_cycles (
      id, label, mode, start_date, end_date, launch_at, due_at, followup_after_at,
      historical_weight, current_weight, status, created_at, updated_at
    ) VALUES (
      ${sqlValue(cycle.id)}, ${sqlValue(cycle.label)}, ${sqlValue(cycle.mode)},
      ${sqlValue(cycle.startDate)}, ${sqlValue(cycle.endDate)}, NULL,
      NULL, NULL, ${sqlValue(weights.historicalWeight)},
      ${sqlValue(weights.currentWeight)}, 'draft', datetime('now'), datetime('now')
    );
  `);
  if(copyAssignments)await copyScoring360AssignmentsFromTemplate(cycle.id);
  await refreshScoring360CycleTotals(cycle.id);
  return cycle.id;
}

async function copyScoring360AssignmentsFromTemplate(targetCycleId) {
  const templateRows = await querySqlRows(`
    SELECT c.id
    FROM scoring360_cycles c
    JOIN scoring360_assignments a ON a.cycle_id = c.id
    WHERE c.id <> ${sqlValue(targetCycleId)}
    GROUP BY c.id
    ORDER BY date(c.end_date) DESC, datetime(c.created_at) DESC
    LIMIT 1;
  `);
  const templateId = templateRows[0]?.id;
  if (!templateId) return 0;

  const assignments = await querySqlRows(`
    SELECT evaluee_name, evaluator_name, evaluee_user_id, evaluator_user_id, relationship, status
    FROM scoring360_assignments
    WHERE cycle_id = ${sqlValue(templateId)}
      AND COALESCE(status, 'active') = 'active'
    ORDER BY evaluee_name ASC, evaluator_name ASC;
  `);
  if (assignments.length === 0) return 0;

  const activeEmployees = await loadManagedEmployees();
  const activeByUserId = new Map(activeEmployees.filter((item) => item.userId).map((item) => [item.userId, item]));
  const activeByName = new Map(activeEmployees.map((item) => [normalizeUserName(item.name), item]));
  const statements = ["BEGIN TRANSACTION;"];
  let copied = 0;
  for (const assignment of assignments) {
    const evalueeName = normalizeUserName(assignment.evaluee_name);
    const evaluatorName = normalizeUserName(assignment.evaluator_name);
    if (!evalueeName || !evaluatorName) continue;
    const evaluee = activeByUserId.get(String(assignment.evaluee_user_id || ""));
    const evaluator = activeByUserId.get(String(assignment.evaluator_user_id || ""));
    if (!evaluee || !evaluator) continue;
    const assignmentId = `sc360-${createHash("sha1").update(`${targetCycleId}:${evaluee.userId}:${evaluator.userId}`).digest("hex").slice(0, 20)}`;
    statements.push(`
      INSERT OR IGNORE INTO scoring360_assignments (
        id, cycle_id, evaluee_name, evaluator_name, evaluee_user_id, evaluator_user_id, relationship, status, created_at, updated_at
      ) VALUES (
        ${sqlValue(assignmentId)}, ${sqlValue(targetCycleId)}, ${sqlValue(evalueeName)}, ${sqlValue(evaluatorName)},
        ${sqlValue(evaluee.userId || "")},
        ${sqlValue(evaluator.userId || "")},
        ${sqlValue(assignment.relationship || "")}, 'active', datetime('now'), datetime('now')
      );
    `);
    copied += 1;
  }
  statements.push("COMMIT;");
  await execSql(statements.join("\n"));
  return copied;
}

function formatScoring360Cycle(row) {
  const weights = normalizeScoring360Weights(row);
  return {
    id: row.id,
    label: row.label,
    mode: row.mode,
    startDate: row.start_date,
    endDate: row.end_date,
    launchAt: row.launch_at || "",
    dueAt: row.due_at || "",
    followupAfterAt: row.followup_after_at || "",
    historicalWeight: weights.historicalWeight,
    currentWeight: weights.currentWeight,
    status: row.status,
    totalEmployees: Number(row.total_employees || 0),
    totalEvaluees: Number(row.total_evaluees || 0),
    totalAssignments: 0,
    totalResponses: 0,
    progressPct: 0,
    averageScore: 0,
  };
}

function formatScoring360Result(row, options = {}) {
  const averageScore = row.average_score === "" ? null : Number(row.average_score);
  const previousScore = options.previousScore === undefined || options.previousScore === "" ? null : Number(options.previousScore);
  const weights = normalizeScoring360Weights(options);
  const rollingScore = averageScore === null
    ? previousScore
    : previousScore === null
      ? averageScore
      : Number((previousScore * weights.historicalWeight + averageScore * weights.currentWeight).toFixed(1));
  return {
    userId: row.user_id,
    name: row.name,
    expected: Number(row.expected || 0),
    submitted: Number(row.submitted || 0),
    completionRate: Number(row.completion_rate || 0),
    averageScore,
    previousScore,
    rollingScore,
    historicalWeight: weights.historicalWeight,
    currentWeight: weights.currentWeight,
    level: scoring360Level(averageScore),
    minScore: row.min_score === "" ? null : Number(row.min_score),
    maxScore: row.max_score === "" ? null : Number(row.max_score),
    evaluators: String(row.evaluators || "").split("、").map((item) => item.trim()).filter(Boolean),
  };
}

function normalizeScoring360Weights(row = {}) {
  const historical = Number(row.historical_weight ?? row.historicalWeight ?? config.scoring360HistoricalWeight);
  const current = Number(row.current_weight ?? row.currentWeight ?? config.scoring360CurrentWeight);
  const safeHistorical = Number.isFinite(historical) && historical >= 0 ? historical : 0.3;
  const safeCurrent = Number.isFinite(current) && current >= 0 ? current : 0.7;
  const total = safeHistorical + safeCurrent;
  if (!total) return { historicalWeight: 0.3, currentWeight: 0.7 };
  return {
    historicalWeight: Number((safeHistorical / total).toFixed(2)),
    currentWeight: Number((safeCurrent / total).toFixed(2)),
  };
}

async function loadPreviousScoring360Scores(cycleRow) {
  const currentEnd = cycleRow?.end_date || "";
  const currentStart = cycleRow?.start_date || "";
  const anchor = currentStart || currentEnd;
  const rows = await querySqlRows(`
    WITH cycle_scores AS (
      SELECT
        a.evaluee_name, a.evaluee_user_id,
        c.id AS cycle_id,
        c.end_date,
        c.start_date,
        ROUND(AVG(r.score), 1) AS average_score
      FROM scoring360_cycles c
      JOIN scoring360_assignments a ON a.cycle_id = c.id
      JOIN scoring360_responses r ON r.assignment_id = a.id
      WHERE c.id <> ${sqlValue(cycleRow.id)}
        AND (${anchor ? `date(COALESCE(c.end_date, c.start_date)) < date(${sqlValue(anchor)})` : "1 = 1"})
      GROUP BY a.evaluee_user_id, c.id
    ),
    ranked AS (
      SELECT
        evaluee_name, evaluee_user_id,
        average_score,
        ROW_NUMBER() OVER (
          PARTITION BY evaluee_user_id
          ORDER BY date(COALESCE(end_date, start_date)) DESC,
            CASE WHEN cycle_id LIKE '%round2%' THEN 0 ELSE 1 END,
            cycle_id DESC
        ) AS rank
      FROM cycle_scores
    )
    SELECT evaluee_name, evaluee_user_id, average_score
    FROM ranked
    WHERE rank = 1;
  `).catch(() => []);
  return new Map(rows.map((row) => [row.evaluee_user_id, Number(row.average_score)]));
}

function formatScoring360ConfigAssignment(row) {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    evalueeName: row.evaluee_name,
    evaluatorName: row.evaluator_name,
    evalueeUserId: row.evaluee_user_id || "",
    evaluatorUserId: row.evaluator_user_id || "",
    relationship: row.relationship || "",
    status: row.status || "active",
    response: row.response_id ? {
      id: row.response_id,
      score: Number(row.score || 0),
      comment: row.comment || "",
      submittedAt: row.submitted_at || "",
      locked: isScoring360Locked(row.submitted_at),
    } : null,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function scoring360Diagnosis() {
  return {
    mode: "database",
    seededFrom: "src/data/scoring360.json",
    liveAssignments: true,
    liveResponses: true,
    note: "协同360已具备 SQLite 任务与提交接口；JSON 仅作为首次导入种子和静态兜底。",
  };
}

async function refreshScoring360CycleTotals(cycleId) {
  await execSql(`
    UPDATE scoring360_cycles
    SET total_employees = (
          SELECT COUNT(DISTINCT evaluator_user_id)
          FROM scoring360_assignments
          WHERE cycle_id = ${sqlValue(cycleId)} AND COALESCE(status, 'active') = 'active'
        ),
        total_evaluees = (
          SELECT COUNT(DISTINCT evaluee_user_id)
          FROM scoring360_assignments
          WHERE cycle_id = ${sqlValue(cycleId)} AND COALESCE(status, 'active') = 'active'
        ),
        updated_at = datetime('now')
    WHERE id = ${sqlValue(cycleId)};
  `);
}

function scoring360Level(score) {
  if (score === null || Number.isNaN(score)) return "未评分";
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 85) return "A-";
  if (score >= 80) return "B+";
  if (score >= 70) return "B";
  return "C";
}

function isScoring360Locked(submittedAt) {
  if (!submittedAt) return false;
  const time = new Date(String(submittedAt).replace(" ", "T")).getTime();
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > 4 * 60 * 60 * 1000;
}

function applyBossViewMembers(members) {
  bossAccessState.userIds = new Set(parseCsvList(config.bossViewUserIds));
  bossAccessState.names = new Set(parseCsvList(config.bossViewNames));
  bossAccessState.members = normalizeBossViewMembers(members);
  for (const member of bossAccessState.members) {
    if (member.userId) bossAccessState.userIds.add(member.userId);
    if (member.name&&!member.userId) bossAccessState.names.add(member.name);
  }
}

function applyScoring360AdminMembers(members) {
  const normalized = normalizeBossViewMembers(members);
  scoring360AdminState.userIds = new Set();
  scoring360AdminState.names = new Set();
  scoring360AdminState.members = normalized;
  for (const member of normalized) {
    if (member.userId) scoring360AdminState.userIds.add(member.userId);
    if (member.name) scoring360AdminState.names.add(member.name);
  }
}

function normalizeBossViewMembers(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  return list.map((item) => {
    if (typeof item === "string") return { userId: employeeIdentity.resolve(item), name: "", department: "" };
    return {
      userId: (item?.userId||item?.user_id||item?.openId||item?.open_id)?employeeIdentity.resolve(item?.userId||item?.user_id||item?.openId||item?.open_id):((employeeDirectory.filter(e=>e.name===String(item?.name||item?.姓名||'').trim()).length===1)?employeeDirectory.find(e=>e.name===String(item?.name||item?.姓名||'').trim()).userId:''),
      name: String(item?.name || item?.姓名 || "").trim(),
      department: String(item?.department || item?.部门 || "").trim(),
    };
  }).filter((item) => {
    const key = item.userId || item.name;
    if (!key || (config.authMode!=="mock"&&!item.userId) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function loadEmployeeDirectory() {
  try {
    const filePath = path.join(config.dataDir, "prototypeData.json");
    const rawText = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(rawText);
    const rows = Array.isArray(parsed.employee_summary) ? parsed.employee_summary : [];
    return rows.map((row) => ({
      userId: String(row.user_id || row["user_id"] || "").trim(),
      name: String(row["姓名"] || row.name || "").trim(),
      department: String(row["部门"] || row.department || "").trim(),
      email: String(row["企业邮箱"] || row.email || "").trim(),
      managerUserId: String(row.manager_user_id || row["manager_user_id"] || "").trim(),
    })).filter((employee) => employee.userId || employee.name);
  } catch (error) {
    console.error("Failed to load employee directory", error);
    return [];
  }
}

function normalizeManagedEmployee(input) {
  return {
    userId: String(input?.userId || input?.user_id || "").trim(),
    name: normalizeUserName(input?.name || input?.姓名),
    department: String(input?.department || input?.部门 || "").trim(),
    email: String(input?.email || input?.企业邮箱 || "").trim(),
    managerUserId: String(input?.managerUserId || input?.manager_user_id || "").trim(),
    roleLevel: String(input?.roleLevel || input?.role_level || "").trim(),
  };
}

async function ensureManagedEmployeeStore() {
  const rows = await querySqlRows("SELECT COUNT(*) AS count FROM employees;").catch(() => []);
  if (Number(rows[0]?.count || 0) > 0 || employeeDirectory.length === 0) return;
  const statements = ["BEGIN TRANSACTION;"];
  for (const employee of employeeDirectory) {
    if (!employee.userId || !employee.name) continue;
    statements.push(`
      INSERT OR IGNORE INTO employees (user_id, name, department, email, manager_user_id, is_active, updated_at)
      VALUES (${sqlValue(employee.userId)}, ${sqlValue(employee.name)}, ${sqlValue(employee.department || "")},
              ${sqlValue(employee.email || "")}, ${sqlValue(employee.managerUserId || "")}, 1, datetime('now'));
    `);
  }
  statements.push("COMMIT;");
  await execSql(statements.join("\n"));
}

async function loadManagedEmployees({ includeInactive = false } = {}) {
  const rows = await querySqlRows(`
    SELECT e.user_id, e.name, e.department, e.email, e.manager_user_id, e.role_level, e.is_active, e.updated_at, s.last_login_at, s.sync_note
    FROM employees e LEFT JOIN employee_sso_logins s ON s.user_id=e.user_id
    ORDER BY name ASC;
  `).catch(() => []);
  if (rows.length === 0) {
    return employeeDirectory.map((employee) => ({
      ...employee,
      roleLevel: "",
      active: true,
      source: "static_fallback",
    }));
  }
  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    department: row.department || "",
    email: row.email || "",
    managerUserId: row.manager_user_id || "",
    roleLevel: row.role_level || "",
    active: Number(row.is_active) === 1,
    updatedAt: row.updated_at || "",
    source: row.last_login_at ? "feishu_sso" : "database",
    lastLoginAt: row.last_login_at||"",
    syncNote: row.sync_note||"",
  })).filter((employee) => includeInactive || employee.active);
}

async function refreshEmployeeDirectory() {
  const rows=await loadManagedEmployees({includeInactive:true});
  for(const employee of rows) {
    const index=employeeDirectory.findIndex(e=>e.userId===employee.userId);
    if(index>=0)employeeDirectory[index]={...employeeDirectory[index],...employee};
    else employeeDirectory.push(employee);
  }
}

async function findActiveManagedEmployee(value) {
  const normalized = normalizeUserName(value);
  if (!normalized) return null;
  const employees = await loadManagedEmployees();
  const byId=employees.find(employee=>employee.userId===normalized);
  if(byId)return byId;
  const matches=employees.filter(employee=>normalizeUserName(employee.name)===normalized);
  return matches.length===1?matches[0]:null;
}

function buildAccessProfile(session, user) {
  const externalView = isExternalSession(session);
  const bossView = isBossSession(session);
  const canManageScoring360 = isScoring360ConfigManagerSession(session);
  const canManagePersonnel = canManageScoring360;
  const fullVisibility = bossView || canManageScoring360;
  const currentEmployee = findDirectoryEmployee(user) || {
    userId: String(user?.userId || "").trim(),
    name: normalizeUserName(user?.name),
    department: "",
    email: String(user?.email || "").trim(),
  };
  const visibleEmployees = fullVisibility
    ? employeeDirectory
    : [currentEmployee];

  return {
    role: externalView ? "external_boss_view" : isBossIdentity(session) ? "boss" : canManageScoring360 ? "system_admin" : "member",
    bossView,
    externalView,
    canViewBossDashboard: bossView,
    canViewSettings: bossView || canManageScoring360,
    canManageScoring360,
    canManagePersonnel,
    currentEmployee,
    visibilityMode: fullVisibility
      ? "all_company"
      : currentEmployee?.department
        ? "self_department_and_reports"
        : "self_only",
    visibleEmployees,
    visibleUserIds: visibleEmployees.map((employee) => employee.userId).filter(Boolean),
    visibleNames: visibleEmployees.map((employee) => employee.name).filter(Boolean),
    visibleDepartments: Array.from(new Set(visibleEmployees.map((employee) => employee.department).filter(Boolean))),
  };
}

function findDirectoryEmployee(user) {
  const userId=String(user?.userId||'').trim();
  return userId?employeeDirectory.find(employee=>employee.userId===userId)||null:null;
}

function findDirectoryEmployeeByName(name) {
  const matches=employeeDirectory.filter(employee=>normalizeUserName(employee.name)===normalizeUserName(name));
  return matches.length===1?matches[0]:null;
}

function visibleEmployeesForUser(user, currentEmployee) {
  const visible = new Map();
  const add = (employee) => {
    if (!employee) return;
    visible.set(employee.userId || employee.name, employee);
  };
  if (currentEmployee) {
    add(currentEmployee);
    for (const employee of employeeDirectory) {
      if (currentEmployee.department && employee.department === currentEmployee.department) add(employee);
    }
    for (const employee of managedEmployeesFor(currentEmployee.userId)) add(employee);
  } else {
    const name = normalizeUserName(user?.name);
    const userId = String(user?.userId || "").trim();
    add({ userId, name, department: "", email: String(user?.email || "") });
  }
  return Array.from(visible.values());
}

function managedEmployeesFor(managerUserId) {
  if (!managerUserId) return [];
  const result = [];
  const visited = new Set();
  const visit = (userId) => {
    if (!userId || visited.has(userId)) return;
    visited.add(userId);
    for (const employee of employeeDirectory) {
      if (employee.managerUserId === userId) {
        result.push(employee);
        visit(employee.userId);
      }
    }
  };
  visit(managerUserId);
  return result;
}

function normalizeUserName(value) {
  return String(value || "").replace(/\(.+?\)/g, "").trim();
}

async function saveAppSetting(key, value) {
  await execSql(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (${sqlValue(key)}, ${sqlValue(JSON.stringify(value))}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = datetime('now');
  `);
}

async function execSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", [config.dbPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `sqlite3 exited with ${code}`));
    });
    child.stdin.end(`.bail on\nPRAGMA busy_timeout = 5000;\n${sql}`);
  });
}

async function querySqlRows(sql) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn("sqlite3", ["-cmd", ".timeout 5000", "-header", "-separator", "\u001f", config.dbPath, sql], { stdio: ["ignore", "pipe", "pipe"] });
    // Decode across chunk boundaries; Buffer→string per chunk can corrupt Chinese JSON keys.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `sqlite3 exited with ${code}`));
    });
  });
  const lines = String(output).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\u001f");
  return lines.slice(1).map((line) => {
    const values = line.split("\u001f");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

async function readMultipartBody(req, contentType, options = {}) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[1] || /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[2];
  if (!boundary) throw new Error("multipart_boundary_missing");
  const buffer = await readRawBody(req, { limitBytes: options.limitBytes || 20 * 1024 * 1024 });
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const files = [];
  const fields = {};
  let cursor = buffer.indexOf(boundaryBuffer);
  while (cursor !== -1) {
    cursor += boundaryBuffer.length;
    if (buffer.slice(cursor, cursor + 2).toString() === "--") break;
    if (buffer.slice(cursor, cursor + 2).toString() === "\r\n") cursor += 2;
    const headerEnd = buffer.indexOf("\r\n\r\n", cursor, "utf8");
    if (headerEnd === -1) break;
    const headerText = buffer.slice(cursor, headerEnd).toString("utf8");
    const nextBoundary = buffer.indexOf(boundaryBuffer, headerEnd + 4);
    if (nextBoundary === -1) break;
    let body = buffer.slice(headerEnd + 4, nextBoundary);
    if (body.slice(-2).toString() === "\r\n") body = body.slice(0, -2);
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headerText)?.[1] || "";
    const fieldName = /name="([^"]+)"/i.exec(disposition)?.[1] || "";
    const fileName = /filename="([^"]*)"/i.exec(disposition)?.[1] || "";
    const partType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || "";
    if (fileName) files.push({ fieldName, fileName, contentType: partType, data: body });
    else if (fieldName) fields[fieldName] = body.toString("utf8");
    cursor = nextBoundary;
  }
  return { files, fields };
}

async function readRawBody(req, options = {}) {
  const limitBytes = options.limitBytes || 200_000;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseWeeklyReportUpload(filePath, sourceName, buffer) {
  const ext = path.extname(sourceName).toLowerCase();
  if (ext === ".csv") {
    return parseWeeklyCsv(buffer.toString("utf8"), sourceName);
  }
  if (ext === ".xlsx") {
    return parseWeeklyXlsx(filePath, sourceName);
  }
  throw new Error("unsupported_import_file_type");
}

function parseWeeklyCsv(text, sourceName) {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => String(cell || "").trim()));
  const headers = rows[0] || [];
  return {
    meta: { sourceName, headers, parser: "csv-direct" },
    records: rows.slice(1).map((row, index) => normalizeReportExportRow(row, headers, index)),
    warnings: [],
  };
}

function parseWeeklyXlsx(filePath, sourceName) {
  const warnings = [];
  const sharedXml = unzipText(filePath, "xl/sharedStrings.xml", true);
  const sharedStrings = sharedXml ? parseSharedStrings(sharedXml) : [];
  const workbookXml = unzipText(filePath, "xl/workbook.xml", true);
  const sheetName = /<sheet\b[^>]*\bname="([^"]+)"/.exec(workbookXml || "")?.[1] || "sheet1";
  const sheetXml = unzipText(filePath, "xl/worksheets/sheet1.xml", false);
  const rows = parseXlsxRows(sheetXml, sharedStrings).filter((row) => row.some(Boolean));
  const headers = rows[0] || [];
  if (headers.length === 0) warnings.push("未识别到表头，请确认文件是飞书汇报导出表。");
  return {
    meta: { sourceName, sheetName, headers, parser: "xlsx-xml-direct" },
    records: rows.slice(1).map((row, index) => normalizeReportExportRow(row, headers, index)),
    warnings,
  };
}

function unzipText(filePath, entry, optional) {
  const result = spawnSync("unzip", ["-p", filePath, entry], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (optional) return "";
    throw new Error(result.stderr || `failed_to_unzip_${entry}`);
  }
  return result.stdout || "";
}

function parseSharedStrings(xml) {
  const items = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRegex.exec(xml))) {
    const textParts = [];
    const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let textMatch;
    while ((textMatch = textRegex.exec(match[1]))) {
      textParts.push(decodeXml(textMatch[1]));
    }
    items.push(textParts.join("") || stripXmlTags(match[1]));
  }
  return items;
}

function parseXlsxRows(sheetXml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(sheetXml))) {
    const row = [];
    const cellRegex = /<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      row[columnIndex(cellMatch[1])] = xlsxCellValue(cellMatch[0], sharedStrings).trim();
    }
    rows.push(row.map((item) => item || ""));
  }
  return rows;
}

function xlsxCellValue(cellXml, sharedStrings) {
  const type = /<c\b[^>]*\bt="([^"]+)"/.exec(cellXml)?.[1] || "";
  const rawValue = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
  const inline = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cellXml)?.[1];
  if (type === "s" && rawValue !== undefined) return sharedStrings[Number(rawValue)] ?? "";
  if (type === "inlineStr" && inline) return stripXmlTags(inline);
  return rawValue ? decodeXml(rawValue) : "";
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        value += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += char;
  }
  if (value || row.length > 0) {
    row.push(value.trim());
    rows.push(row);
  }
  return rows;
}

function normalizeReportExportRow(row, headers, index) {
  const record = Object.fromEntries(headers.map((header, columnIndex) => [String(header || "").trim(), row[columnIndex] || ""]));
  return {
    rowNumber: index + 2,
    employeeNo: firstField(record, ["工号", "员工工号", "编号"]),
    employeeName: firstField(record, ["姓名", "人员", "员工", "提交人", "汇报人"]),
    email: firstField(record, ["邮箱", "邮箱地址", "Email"]),
    department: firstField(record, ["部门", "所属部门", "一级部门"]),
    submittedAt: firstField(record, ["提交时间", "提交日期", "更新时间"]),
    editStatus: firstField(record, ["编辑状态"]),
    submitStatus: firstField(record, ["提交状态", "状态"]),
    content: {
      results: firstField(record, ["本周成果（只写最重要的3-5件事，用数据说话，拒绝流水账）", "本周成果", "工作成果", "成果"]),
      problems: firstField(record, ["问题与挑战（暴露风险，寻求支持，不要隐瞒）", "问题与挑战", "问题摘要", "问题"]),
      nextPlan: firstField(record, ["下周工作计划与目标（目标明确，优先级排序）", "下周工作计划与目标", "下周计划", "计划"]),
      reflection: firstField(record, ["思考与复盘", "思考与复盘 ", "复盘", "思考"]),
      files: firstField(record, ["相关文件", "附件", "文件"]),
    },
    interaction: {
      commentCount: Number(firstField(record, ["评论数"]) || 0),
      likeCount: Number(firstField(record, ["点赞数"]) || 0),
      readCount: Number(firstField(record, ["已读数"]) || 0),
      unreadCount: Number(firstField(record, ["未读数"]) || 0),
      commentInfo: firstField(record, ["评论信息"]) || "",
    },
    raw: record,
  };
}

function normalizeImportedWeeklyRecord(record, index, weekWindow) {
  const employeeName = cleanImportedText(record.employeeName);
  const email = cleanImportedText(record.email);
  const employeeNo = cleanImportedText(record.employeeNo);
  const department = cleanImportedText(record.department);
  const content = {
    results: cleanImportedText(record.content.results),
    problems: cleanImportedText(record.content.problems),
    nextPlan: cleanImportedText(record.content.nextPlan),
    reflection: cleanImportedText(record.content.reflection),
    files: cleanImportedText(record.content.files),
  };
  const stable = [
    employeeNo,
    email,
    employeeName,
    weekWindow.weekLabel,
    content.results,
    content.problems,
    content.nextPlan,
    content.reflection,
  ].join("\n");
  const sourceHash = sha256(stable);
  const employeeUserId = employeeNo ? `emp:${employeeNo}` : email ? `email:${email.toLowerCase()}` : `name:${employeeName}`;
  const submittedAt = cleanImportedText(record.submittedAt);
  return {
    id: `report-${sourceHash.slice(0, 16)}`,
    employeeUserId,
    employeeName,
    email,
    department,
    weekLabel: weekWindow.weekLabel,
    weekStart: weekWindow.weekStart,
    weekEnd: weekWindow.weekEnd,
    status: cleanImportedText(record.submitStatus || record.editStatus || "已提交"),
    isLate: /迟|补|逾期/.test(`${record.submitStatus || ""}${record.editStatus || ""}`),
    submittedAt,
    sourceHash,
    content,
    contentJson: {
      results: content.results,
      problems: content.problems,
      nextPlan: content.nextPlan,
      reflection: content.reflection,
      files: content.files,
      interaction: record.interaction || {},
      import: {
        rowNumber: record.rowNumber || index + 2,
        raw: record.raw || {},
      },
    },
  };
}

function inferBatchWeekWindow(sourceName, records) {
  const sampleSubmittedAt = records.map((record) => record.submittedAt).find(Boolean);
  const fromName = /(\d{4})(\d{2})(\d{2})/.exec(sourceName);
  const endDate = parseLocalDate(sampleSubmittedAt)
    || (fromName ? new Date(`${fromName[1]}-${fromName[2]}-${fromName[3]}T00:00:00+08:00`) : null)
    || new Date();
  const startDate = mondayOf(endDate);
  return {
    weekStart: formatDate(startDate),
    weekEnd: formatDate(endDate),
    weekLabel: `${formatDate(startDate)}_${formatDate(endDate)}`,
  };
}

function inferImportMode(records, sourceName) {
  if (/补交|单人|single|patch/i.test(sourceName)) return "single_employee";
  const names = new Set(records.map((record) => cleanImportedText(record.employeeName)).filter(Boolean));
  if (names.size <= 1) return "single_employee";
  return "full_export";
}

function parseLocalDate(value) {
  const text = String(value || "").trim();
  const match = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(text);
  if (!match) return null;
  return new Date(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}T00:00:00+08:00`);
}

function mondayOf(date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return copy;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sanitizeSqliteDate(value) {
  const text = String(value || "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(text);
  if (!match) return "";
  return `${match[1]} ${match[2] || "00:00:00"}`;
}

function toIsoLike(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) return text.replace(" ", "T");
  return `${text.replace(" ", "T")}Z`;
}

function firstField(record, names) {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && String(value).trim()) return String(value);
  }
  return "";
}

function cleanImportedText(value) {
  return decodeXml(String(value || "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function columnIndex(ref) {
  const letters = ref.replace(/\d+/g, "");
  return letters.split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function stripXmlTags(value = "") {
  return decodeXml(value.replace(/<[^>]+>/g, ""));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeFileName(value) {
  return path.basename(String(value || "upload")).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "upload";
}

function sqlValue(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function readJsonBody(req, options = {}) {
  const limitBytes = options.limitBytes || 200_000;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(text);
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyPayload(value) {
  const [body, sig] = String(value || "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function setSession(res, session, options = {}) {
  setCookie(res, "wos_session", signPayload(session), { maxAge: options.maxAge ?? 60 * 60 * 24 * 400, httpOnly: true });
}

function getSession(req) {
  const token = parseCookies(req).wos_session;
  const session = verifyPayload(token);
  if (!session) return null;
  if(session.user){const user=employeeIdentity.sessionUser(session.user);if(!user)return null;session.user=user;}
  if (session.devView && !config.devViewSwitchEnabled) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) return null;
  if(config.devViewSwitchEnabled && session.devView?.role==='hr' && !employeeDirectory.some(e=>e.userId===session.user?.userId&&e.active!==false)) {
    session.user=developmentManagerIdentity();
  }
  return session;
}

function isExternalSession(session) {
  return Boolean(session?.externalShare || session?.user?.role === "external_boss_view");
}

function isBossIdentity(session) {
  if(!session && config.devViewSwitchEnabled && !process.env.MOCK_USER_ID)return true;
  if (session?.devView && config.devViewSwitchEnabled) return session.devView.role === "boss";
  const user = session?.user || (config.authMode === "mock" ? mockUser() : null);
  const userId = String(user?.userId || "").trim();
  const name = String(user?.name || "").trim();
  return Boolean(
    (config.authMode === "mock" && userId === "mock_owner") ||
      bossAccessState.userIds.has(userId) ||
      (config.authMode==="mock"&&bossAccessState.names.has(name)),
  );
}

// Boss and administrator share management capabilities but keep distinct identities.
function isBossSession(session) {
  if(session?.devView && config.devViewSwitchEnabled)return ['boss','hr'].includes(session.devView.role);
  return isBossIdentity(session)||isScoring360ConfiguredManagerUser(session?.user||(config.authMode==='mock'?mockUser():null));
}

function isScoring360ConfigManagerSession(session) {
  if (session?.devView && config.devViewSwitchEnabled) return ["boss","hr"].includes(session.devView.role);
  const user = session?.user || (config.authMode === "mock" ? mockUser() : null);
  return isBossSession(session) || isScoring360ConfiguredManagerUser(user);
}

function isScoring360ConfiguredManagerUser(user) {
  return isScoring360ConfigManager(user, scoring360ConfigManagers());
}

function scoring360ConfigManagers() {
  const envUserIds = parseCsvList(config.scoring360ConfigManagerUserIds).map((userId) => ({ userId, name: "" }));
  const envNames = parseCsvList(config.scoring360ConfigManagerNames).map((name) => ({ userId: "", name }));
  return [...defaultScoring360ConfigManagers, ...normalizeBossViewMembers([...envUserIds,...envNames]), ...scoring360AdminState.members];
}

function parseCsvList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
}

function requestPublicBaseUrl(req) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  if (/^https?:\/\//i.test(origin)) return origin;

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (config.baseUrl.startsWith("https://") ? "https" : "http");
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || req.headers.host || new URL(config.baseUrl).host;
  return `${proto}://${host}`.replace(/\/$/, "");
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (config.baseUrl.startsWith("https://")) parts.push("Secure");
  appendHeader(res, "Set-Cookie", parts.join("; "));
}

function clearCookie(res, name) {
  appendHeader(res, "Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
}

function appendHeader(res, name, value) {
  const current = res.getHeader(name);
  if (!current) res.setHeader(name, value);
  else if (Array.isArray(current)) res.setHeader(name, [...current, value]);
  else res.setHeader(name, [current, value]);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function safeNext(next) {
  const value = String(next || "/");
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function sendJson(res, status, payload) {
  send(res, status, jsonHeaders, JSON.stringify(payload));
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function assertFeishuConfig() {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required");
  }
}

function assertFeishuAppId() {
  if (!config.feishuAppId) {
    throw new Error("FEISHU_APP_ID is required");
  }
}

async function fileExists(filePath) {
  try {
    const entry = await stat(filePath);
    return entry.isFile();
  } catch {
    return false;
  }
}

function contentType(ext) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
  }[ext] || "application/octet-stream";
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function requiresStaticAuth(pathname) {
  return !pathname.startsWith("/assets/") && pathname !== "/favicon.ico";
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return "";
}

function toFeishuDue(value) {
  const date = normalizeDate(value);
  if (!date) return null;
  const timestamp = new Date(`${date}T23:59:59+08:00`).getTime();
  return { is_all_day: true, timestamp };
}

function developmentManagerIdentity(currentUser) {
  const employee=employeeDirectory.find(e=>e.userId===currentUser?.userId&&e.active!==false)
    ||employeeDirectory.find(e=>e.userId==='demo_user_id_001'&&e.active!==false)
    ||employeeDirectory.find(e=>e.userId&&e.name&&e.active!==false);
  return employee?{userId:employee.userId,name:employee.name,email:employee.email||''}:{userId:'mock_owner',name:'Demo Owner',email:'owner@example.com'};
}

function developmentViews(currentUser) {
  const manager=developmentManagerIdentity(currentUser);
  return [
    {id:'boss',role:'boss',label:'老板视角',group:'管理视角',user:{userId:'mock_owner',name:'Demo Owner',email:'owner@example.com'}},
    {id:'hr',role:'hr',label:`管理员视角 · ${manager.name}`,group:'管理视角',user:manager},
    ...employeeDirectory.filter(e=>e.userId&&e.name&&e.active!==false).map(e=>({id:`employee:${e.userId}`,role:'employee',label:`员工 · ${e.name}`,group:'员工视角',user:{userId:e.userId,name:e.name,email:e.email||''}})),
  ];
}

function mockUser() {
  const userId = process.env.MOCK_USER_ID || "mock_owner";
  const name = process.env.MOCK_USER_NAME || "Demo Owner";
  return {
    userId,
    unionId: process.env.MOCK_USER_UNION_ID || userId,
    name,
    email: process.env.MOCK_USER_EMAIL || "owner@example.com",
    avatarUrl: "",
  };
}

function loadDotEnv(envPath) {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}
