import {useLocationSection} from '../lib/navigation';
import { FeishuReportConfiguration } from '../components/FeishuReportConfiguration';
import { AppSelect } from '../components/AppSelect';
import { SystemConfiguration } from '../components/SystemConfiguration';
import { DepartmentManagement } from '../components/DepartmentManagement';
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, CheckCheck, Database, Link2, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { ResultEmpty } from "../components/PerformanceUI";
import type { DragEvent } from "react";
import { appData } from "../lib/data";
import type { UserAccess } from "../lib/types";

interface ExternalLink {
  id: string;
  name: string;
  scope: string;
  expiresAt: string;
  status: string;
  accessCount: number;
  lastAccessedAt?: string;
  createdAt?: string;
}

interface ImportResult {
  batch?: {
    id: string;
    sourceName: string;
    importMode: string;
    rowCount: number;
    validCount: number;
    inserted: number;
    updated: number;
    weekLabel: string;
  };
  sampleRecords?: Array<{
    employeeName: string;
    department: string;
    weekLabel: string;
    status: string;
  }>;
  warnings?: string[];
}

interface BossViewMember {
  userId: string;
  name: string;
  department: string;
}

interface ManagedEmployee {
  lastLoginAt?:string;
  syncNote?:string;
  userId: string;
  name: string;
  department: string;
  email?: string;
  managerUserId?: string;
  roleLevel?: string;
  active: boolean;
  source?: string;
}

interface LarkReportSyncStatus {
  ok?: boolean;
  running?: boolean;
  phase?: string;
  message?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  rowCount?: number;
  importOutputPath?: string;
  period?: {
    id?: string;
    label?: string;
    range?: string;
    start?: string;
    end?: string;
    commitStart?: string;
    commitEnd?: string;
  };
}

interface WeeklyReminderOutboxItem {
  id: string;
  periodId: string;
  periodLabel?: string;
  kind: "friday_review" | "monday_update" | string;
  recipientName: string;
  department?: string;
  message: string;
  personalizationNote?: string;
  provider?: string;
  model?: string;
  status: string;
  updatedAt?: string;
}

interface WeeklyReminderStatus {
  outbox?: {
    enabled?: boolean;
    fridayPeriodId?: string;
    mondayPeriodId?: string;
    counts?: Array<{ periodId: string; status: string; count: number }>;
    items?: WeeklyReminderOutboxItem[];
  };
}

interface Scoring360ConfigAssignment {
  id: string;
  cycleId: string;
  evalueeName: string;
  evaluatorName: string;
  evalueeUserId: string;
  evaluatorUserId: string;
  relationship?: string;
  response?: {
    score: number;
    submittedAt: string;
    locked: boolean;
  } | null;
}

interface Scoring360Config {
  cycle?: {
    id: string;
    label: string;
    mode: string;
    dueAt?: string;
    historicalWeight?: number;
    currentWeight?: number;
  } | null;
  employees?: Array<{
    name: string;
    department?: string;
    userId?: string;
  }>;
  assignments: Scoring360ConfigAssignment[];
  diagnosis?: {
    mode: string;
    liveAssignments: boolean;
    liveResponses: boolean;
    note: string;
  };
}

interface Scoring360ReminderStatus {
  enabled?: boolean;
  launchMode?: "manual" | "scheduled" | string;
  schedule?: {
    dayOfMonth: number;
    daysOfMonth?: number[];
    hour: number;
    minute: number;
    dueHours: number;
    followupHours: number;
    identity: string;
  };
  cycle?: {
    id: string;
    label: string;
    dueAt?: string;
    progressPct?: number;
  } | null;
  pending?: Array<{
    evaluatorName: string;
    evaluatorUserId?: string;
    department?: string;
    pendingCount: number;
    totalCount: number;
    pendingNames: string[];
    deliverable: boolean;
  }>;
  sends?: Array<{
    evaluatorName: string;
    pendingCount: number;
    kind: string;
    status: string;
    createdAt?: string;
  }>;
}

interface Scoring360ReminderResult {
  dryRun?: boolean;
  count?: number;
  sent?: number;
  dryRunCount?: number;
  skipped?: number;
  failed?: number;
}

interface RosterAuditStatus {
  latestWeek?: {
    label: string;
    reportCount: number;
  } | null;
  counts?: {
    activeEmployees: number;
    latestReports: number;
    newInReports: number;
    missingLatestReport: number;
    missingUserId: number;
  };
  newInReports?: Array<{ name: string; department?: string; userId?: string }>;
  missingLatestReport?: Array<{ name: string; department?: string; userId?: string }>;
  missingUserId?: Array<{ name: string; department?: string; userId?: string }>;
  exemptNames?: string[];
  note?: string;
}

interface AccountActivityRow {
  userId?: string;
  name: string;
  department?: string;
  isReminderRecipient?: boolean;
  loginCount: number;
  sessionCount: number;
  heartbeatCount: number;
  pageVisitCount: number;
  commentCount: number;
  reactionCount: number;
  followupCount: number;
  activeSignals: number;
  interactionSignals: number;
  attentionScore: number;
  status: "no_record" | "active" | "engaged" | string;
  statusLabel: string;
  firstActiveAt?: string;
  lastActiveAt?: string;
}

interface AccountActivityStatus {
  window?: {
    mode: string;
    periodId?: string;
    periodLabel?: string;
    startAt?: string;
    firstSentAt?: string;
    lastSentAt?: string;
    sentCount?: number;
  };
  summary?: {
    recipients: number;
    active: number;
    noRecord: number;
    engaged: number;
    activeRate: number;
    engagedRate: number;
  };
  rows?: AccountActivityRow[];
}

interface SettingsPageProps {
  access?: UserAccess;
}

export function SettingsPage({ access }: SettingsPageProps) {
  const bossView = access ? Boolean(access.bossView) : true;
  const canManageScoring360 = access ? Boolean(access.bossView || access.canManageScoring360) : true;
  const canManagePersonnel = access ? Boolean(access.bossView || access.canManagePersonnel) : true;
  const sections=['overview',...(canManagePersonnel?['organization','people']:[]),...(canManageScoring360?['rules','scoring','cycles']:[]),...(bossView?['permissions','ai','integrations','logs','activity']:[])];
  const [settingsTab, setSettingsTabState] = useLocationSection('settingsTab',sections,'overview');
  const setSettingsTab=(next:string)=>{if(next===settingsTab||window.dispatchEvent(new Event('organization-before-leave',{cancelable:true})))setSettingsTabState(next);};
  useEffect(() => { document.querySelector('.settings-content')?.scrollTo({top:0}); }, [settingsTab]);
  const [runtimeStatus, setRuntimeStatus] = useState<any>(null);
  const [runtimeError, setRuntimeError] = useState('');
  async function loadRuntimeStatus() {
    try {
      const response = await fetch('/api/settings/status');
      if (!response.ok) throw Error('运行状态加载失败，请重试');
      setRuntimeStatus(await response.json()); setRuntimeError('');
    } catch (error) { setRuntimeError(error instanceof Error ? error.message : '加载失败'); }
  }
  useEffect(() => { void loadRuntimeStatus(); }, []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [externalLinks, setExternalLinks] = useState<ExternalLink[]>([]);
  const [adminMembers,setAdminMembers]=useState<BossViewMember[]>([]);
  const [adminState,setAdminState]=useState("idle");
  const [bossViewMembers, setBossViewMembers] = useState<BossViewMember[]>([]);
  const [bossViewState, setBossViewState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [managedEmployees, setManagedEmployees] = useState<ManagedEmployee[]>([]);
  const [managedEmployeeState, setManagedEmployeeState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [employeeMessage,setEmployeeMessage]=useState("");
  const [externalName, setExternalName] = useState("外部顾问临时访问");
  const [ttlHours, setTtlHours] = useState("72");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [externalLinkState, setExternalLinkState] = useState<"idle" | "creating" | "error">("idle");
  const [importState, setImportState] = useState<"idle" | "dragging" | "uploading" | "done" | "error">("idle");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const [syncStatus, setSyncStatus] = useState<LarkReportSyncStatus | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  const [weeklyReminderStatus, setWeeklyReminderStatus] = useState<WeeklyReminderStatus | null>(null);
  const [scoring360Config, setScoring360Config] = useState<Scoring360Config | null>(null);
  const employeeChoices = scoring360Config?.employees || [];
  const employeeOptions = useMemo(() => (scoring360Config?.employees || []).map(e=>e.userId).filter(Boolean), [scoring360Config]);
  const [scoring360State, setScoring360State] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [scoring360Error, setScoring360Error] = useState("");
  const [assignmentMessage,setAssignmentMessage]=useState("");
  const [scoring360Evaluee, setScoring360Evaluee] = useState(employeeOptions[0] || "");
  const [scoring360Evaluator, setScoring360Evaluator] = useState(employeeOptions[1] || employeeOptions[0] || "");
  const [scoring360ReminderStatus, setScoring360ReminderStatus] = useState<Scoring360ReminderStatus | null>(null);
  const [scoring360ReminderState, setScoring360ReminderState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [scoring360ReminderError, setScoring360ReminderError] = useState("");
  const [scoring360ReminderResult, setScoring360ReminderResult] = useState<Scoring360ReminderResult | null>(null);
  const [rosterAudit, setRosterAudit] = useState<RosterAuditStatus | null>(null);
  const [accountActivity, setAccountActivity] = useState<AccountActivityStatus | null>(null);


  useEffect(() => {
    if (bossView) {
      loadExternalLinks();
      loadBossViewMembers();
      void fetch("/api/scoring360-admin-members").then(r=>r.json()).then(j=>setAdminMembers(j.members||[]));
      loadLarkReportSyncStatus();
      loadWeeklyReminderStatus();
      loadRosterAudit();
      loadAccountActivity();
    }
    if (canManageScoring360) {
      loadScoring360Config();
      loadScoring360ReminderStatus();
    }
    if (canManagePersonnel) loadManagedEmployees();
  }, [bossView, canManageScoring360, canManagePersonnel]);

  useEffect(() => {
    if (!scoring360Evaluee && employeeOptions[0]) {
      setScoring360Evaluee(employeeOptions[0]);
    }
    if (!scoring360Evaluator && (employeeOptions[1] || employeeOptions[0])) {
      setScoring360Evaluator(employeeOptions[1] || employeeOptions[0] || "");
    }
  }, [employeeOptions, scoring360Evaluee, scoring360Evaluator]);

  useEffect(() => {
    if (!syncStatus?.running) return;
    const timer = window.setInterval(() => {
      void loadLarkReportSyncStatus();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [syncStatus?.running]);

  async function saveAdminMembers(){
    setAdminState('saving');
    try{const r=await fetch('/api/scoring360-admin-members',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({members:adminMembers})});if(!r.ok)throw Error();setAdminState('saved');}catch{setAdminState('error');}
  }
  async function loadBossViewMembers() {
    try {
      const response = await fetch("/api/boss-view-members");
      if (!response.ok) return;
      const result = await response.json();
      setBossViewMembers(Array.isArray(result.members) ? result.members : []);
    } catch {
      // Static preview keeps this as a visual configuration mock.
    }
  }

  function toggleBossViewMember(member: BossViewMember) {
    setBossViewState("idle");
    setBossViewMembers((current) => {
      const exists = current.some((item) => item.userId === member.userId);
      if (exists) return current.filter((item) => item.userId !== member.userId);
      return [...current, member];
    });
  }

  async function saveBossViewMembers() {
    setBossViewState("saving");
    try {
      const response = await fetch("/api/boss-view-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ members: bossViewMembers }),
      });
      if (!response.ok) throw new Error("save_boss_view_failed");
      const result = await response.json();
      setBossViewMembers(Array.isArray(result.members) ? result.members : bossViewMembers);
      setBossViewState("saved");
    } catch {
      setBossViewState("error");
    }
  }

  async function loadManagedEmployees() {
    try {
      const response = await fetch("/api/employees/manage");
      if (!response.ok) return;
      const result = await response.json();
      setManagedEmployees(Array.isArray(result.employees) ? result.employees : []);
    } catch {
      // Static preview keeps the roster panel empty.
    }
  }

  async function setManagedEmployeeActive(employee: ManagedEmployee, active: boolean) {
    if (!active && !window.confirm(`确认停用 ${employee.name}？历史评分会保留，但不会进入新周期或提醒。`)) return;
    setEmployeeMessage("");
    setManagedEmployeeState("saving");
    try {
      const response = await fetch("/api/employees/manage/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: employee.userId, active }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "update_employee_status_failed");
      await loadManagedEmployees();
      await loadScoring360Config();
      await loadScoring360ReminderStatus();
      setEmployeeMessage(`${employee.name}已${active?"恢复在职":"停用"}。`);
      setManagedEmployeeState("saved");
    } catch(error) {
      const code=error instanceof Error?error.message:'';
      setEmployeeMessage(code==='employee_user_id_and_name_required'?'请填写员工姓名和飞书 user_id。':code==='scoring360_config_manager_only'||code==='manager_only'?'当前账号没有人员管理权限，请切换到管理视角。':'保存失败，请检查网络后重试。');
      setManagedEmployeeState("error");
    }
  }

  async function loadExternalLinks() {
    try {
      const response = await fetch("/api/external-links");
      if (!response.ok) return;
      const result = await response.json();
      setExternalLinks(Array.isArray(result.links) ? result.links : []);
    } catch {
      // Settings remains usable even if the server is not available in static preview.
    }
  }

  async function createExternalLink() {
    setExternalLinkState("creating");
    try {
      const response = await fetch("/api/external-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: externalName, ttlHours: Number(ttlHours) }),
      });
      if (!response.ok) throw new Error("create_external_link_failed");
      const result = await response.json();
      setGeneratedUrl(result.link?.url || "");
      setExternalLinkState("idle");
      await loadExternalLinks();
    } catch {
      setExternalLinkState("error");
    }
  }

  async function loadLarkReportSyncStatus() {
    try {
      const response = await fetch("/api/lark-report-sync");
      if (!response.ok) return;
      const result = await response.json();
      const status = result.status || null;
      setSyncStatus(status);
      setSyncState(status?.running ? "running" : "idle");
    } catch {
      // Static preview keeps this as an explanatory panel.
    }
  }

  async function loadWeeklyReminderStatus() {
    try {
      const response = await fetch("/api/weekly-reminders");
      if (!response.ok) return;
      const result = await response.json();
      setWeeklyReminderStatus(result);
    } catch {
      // Static preview keeps this panel empty.
    }
  }

  async function loadScoring360Config() {
    try {
      const response = await fetch("/api/scoring360/config");
      if (!response.ok) return;
      const result = await response.json();
      setScoring360Config({
        cycle: result.cycle || null,
        employees: Array.isArray(result.employees) ? result.employees : [],
        assignments: Array.isArray(result.assignments) ? result.assignments : [],
        diagnosis: result.diagnosis,
      });
    } catch {
      // Static preview keeps the explanation visible without live configuration.
    }
  }

  async function loadScoring360ReminderStatus() {
    try {
      const response = await fetch("/api/scoring360/reminders");
      if (!response.ok) return;
      const result = await response.json();
      setScoring360ReminderStatus(result);
    } catch {
      // Static preview keeps this panel explanatory.
    }
  }

  async function loadRosterAudit() {
    try {
      const response = await fetch("/api/roster/audit");
      if (!response.ok) return;
      const result = await response.json();
      setRosterAudit(result);
    } catch {
      // Static preview keeps this panel explanatory.
    }
  }

  async function loadAccountActivity() {
    try {
      const response = await fetch("/api/account-activity");
      if (!response.ok) return;
      const result = await response.json();
      setAccountActivity(result);
    } catch {
      // Static preview keeps this panel explanatory.
    }
  }

  async function sendScoring360Reminder(
    kind: "launch" | "followup",
    dryRun = true,
    target?: NonNullable<Scoring360ReminderStatus["pending"]>[number],
  ) {
    const confirmation = target
      ? `确认提醒 ${target.evaluatorName}？此人还有 ${target.pendingCount} 个评分对象未完成。`
      : `确认向当前待评分人员真实发送${kind === "launch" ? "首轮" : "补充"}提醒？`;
    if (!dryRun && !window.confirm(confirmation)) return;
    setScoring360ReminderState("running");
    setScoring360ReminderError("");
    setScoring360ReminderResult(null);
    try {
      const response = await fetch("/api/scoring360/reminders/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cycleId: scoring360ReminderStatus?.cycle?.id,
          kind,
          dryRun,
          evaluatorUserId: target?.evaluatorUserId || "",
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "send_scoring360_reminder_failed");
      setScoring360ReminderResult(result);
      await loadScoring360ReminderStatus();
      setScoring360ReminderState("done");
    } catch (error) {
      setScoring360ReminderError(error instanceof Error ? error.message : "协同360提醒处理失败");
      setScoring360ReminderState("error");
    }
  }

  async function prepareScoringCycle(action:'prepare'|'open'){
    setScoring360State('saving');setScoring360Error('');setAssignmentMessage('');
    try{const response=await fetch('/api/scoring360/cycle',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});const result=await response.json();if(!response.ok)throw Error(result.error==='scoring_assignments_required'?'请先手动添加评分关系，再开放本月评分。':result.error==='scoring_cycle_closed'?'该周期已关闭，不能重新开放。':'评分周期操作失败，请重试');await loadScoring360Config();await loadScoring360ReminderStatus();setAssignmentMessage(action==='prepare'?'本月评分周期已准备，请手动选择谁给谁评分；没有自动添加关系或发送消息。':'本月评分已开放；没有发送飞书消息。');setScoring360State('saved');}catch(error){setScoring360Error(error instanceof Error?error.message:'操作失败');setScoring360State('error');}
  }
  async function addScoring360Assignment() {
    if (!scoring360Evaluee || !scoring360Evaluator) return;
    setScoring360State("saving");
    setScoring360Error("");setAssignmentMessage("");
    try {
      const response = await fetch("/api/scoring360/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cycleId: scoring360Config?.cycle?.id,
          evalueeUserId: scoring360Evaluee,
          evaluatorUserId: scoring360Evaluator,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(({self_scoring_forbidden:"同事互评不能给自己评分。",result_locked:"该员工当月协作结果已确认锁定，不能新增或恢复评分关系。请在新评分周期配置。",inactive_or_unknown_employee:"请选择在职员工。",invalid_assignment:"请选择被评分人和评分人。"} as Record<string,string>)[result.error]||"添加失败，请稍后重试");
      await loadScoring360Config();
      setAssignmentMessage(result.alreadyExists?"这条评分关系已存在，无需重复添加。":"评分关系已更新。");
      setScoring360State("saved");
    } catch (error) {
      setScoring360Error(error instanceof Error ? error.message : "添加评分关系失败");
      setScoring360State("error");
    }
  }

  async function removeScoring360Assignment(assignmentId: string) {
    setScoring360State("saving");
    setScoring360Error("");setAssignmentMessage("");
    try {
      const response = await fetch("/api/scoring360/assignments", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error==='result_locked'?"该员工当月协作结果已确认锁定，不能删除评分关系。":"删除失败，请稍后重试");
      await loadScoring360Config();
      setAssignmentMessage(result.alreadyExists?"这条评分关系已存在，无需重复添加。":"评分关系已更新。");
      setScoring360State("saved");
    } catch (error) {
      setScoring360Error(error instanceof Error ? error.message : "删除评分关系失败");
      setScoring360State("error");
    }
  }

  async function startLarkReportSync() {
    setSyncState("starting");
    setSyncError("");
    try {
      const response = await fetch("/api/lark-report-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exempt: "" }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (result.alreadyRunning) {
          setSyncStatus(result.status || null);
          setSyncState("running");
          return;
        }
        throw new Error(result.error || "sync_start_failed");
      }
      setSyncStatus(result.status || null);
      setSyncState("running");
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "同步启动失败");
      setSyncState("error");
    }
  }

  async function uploadWeeklyReport(file?: File) {
    if (!file) return;
    setImportState("uploading");
    setImportError("");
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("importMode", "auto");
      const response = await fetch("/api/import/weekly-report", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "import_failed");
      setImportResult(result);
      setImportState("done");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入失败");
      setImportState("error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    void uploadWeeklyReport(file);
  }

  return (
    <div className="v2-page v2-page-wide settings-page">
      <section className="pf-intro"><div><span className="v2-eyebrow"><Settings2 size={14}/>系统设置</span><h2>团队的规则与连接，都在这里。</h2><p>管理组织、配置评分规则，连接 AI 与飞书服务。</p></div><span className="pf-subtle-tag">{runtimeStatus?.authMode === 'mock' ? '开发演示环境' : runtimeStatus ? '正式认证环境' : '正在读取环境状态'}</span></section>
      <div className="settings-layout">
      <nav className="settings-module-nav" aria-label="设置分类">
      {[
       {label:'工作空间',items:[{id:'overview',label:'运行概览',description:'服务状态与常用操作',icon:Settings2,visible:true}]},
       {label:'组织与人员',items:[{id:'organization',label:'组织与部门',description:'部门层级与负责人',icon:UsersRound,visible:canManagePersonnel},{id:'people',label:'员工管理',description:'飞书同步与在职状态',icon:UsersRound,visible:canManagePersonnel},{id:'permissions',label:'角色与权限',description:'老板、管理员与员工',icon:ShieldCheck,visible:bossView}]},
       {label:'评分与成长',items:[{id:'rules',label:'评分规则',description:'权重与规则版本',icon:CheckCheck,visible:canManageScoring360},{id:'scoring',label:'协作评分关系',description:'配置谁给谁评分',icon:UsersRound,visible:canManageScoring360},{id:'cycles',label:'周期与提醒',description:'截止时间与催评频率',icon:Settings2,visible:canManageScoring360}]},
       {label:'服务与记录',items:[{id:'ai',label:'AI 配置',description:'模型服务与密钥',icon:Database,visible:bossView},{id:'integrations',label:'飞书与数据集成',description:'连接、同步与导入',icon:Link2,visible:bossView},{id:'logs',label:'操作日志',description:'配置变更与操作记录',icon:Activity,visible:bossView},{id:'activity',label:'访问统计',description:'团队使用情况',icon:Activity,visible:bossView}]},
      ].filter(group=>group.items.some(item=>item.visible)).map(group=><div className="settings-nav-group" key={group.label}><span className="settings-nav-group-label">{group.label}</span>{group.items.filter(item=>item.visible).map(({id,label,description,icon:Icon})=><button type="button" key={id} className={settingsTab===id?'is-active':''} aria-current={settingsTab===id?'page':undefined} onClick={()=>setSettingsTab(id)}><Icon size={17}/><span><strong>{label}</strong><small>{description}</small></span><span className="settings-nav-arrow">›</span></button>)}</div>)}
      </nav>
      <div className="settings-content">
      {settingsTab==='overview'&&<div className="settings-overview"><section className="settings-quick-actions" aria-label="常用设置">{[{id:'organization',title:'管理组织',text:'设置部门与负责人',icon:UsersRound},{id:'rules',title:'调整评分规则',text:'配置下个周期的权重',icon:CheckCheck},{id:'ai',title:'接入 AI',text:'配置模型与服务密钥',icon:Database}].map(({id,title,text,icon:Icon})=><button key={id} type="button" onClick={()=>setSettingsTab(id)}><span className="settings-quick-icon"><Icon size={20}/></span><strong>{title}</strong><small>{text}</small><span className="settings-quick-arrow">↗</span></button>)}</section>
        <section className="settings-summary-grid">{[
          ['在职员工',managedEmployees.filter(e=>e.active).length,'员工管理','people'],
          ['协作评分关系',scoring360Config?.assignments.length??'—','管理评分任务','scoring'],
          ['待完成评分人员',scoring360ReminderStatus?.pending?.length??'—','跟进本轮进度','scoring'],
        ].map(([label,value,caption,target])=><button className="v2-card settings-summary" type="button" key={label} onClick={()=>setSettingsTab(String(target))}><span>{label}</span><strong>{value}<small>{label==='协作评分关系'?'条':'人'}</small></strong><p>{caption} →</p></button>)}</section>
        <section className="v2-card"><div className="v2-card-head"><div><span className="v2-eyebrow"><Database size={14}/>当前环境</span><h3 className="v2-card-title">运行状态与服务连接</h3><p className="v2-card-sub">展示真实配置状态。未接入的服务会明确标记，不会伪造连接或发送记录。</p></div><button type="button" className="secondary-button" onClick={()=>void loadRuntimeStatus()}>刷新状态</button></div>
        {runtimeError?<div className="pf-error" role="alert">{runtimeError}</div>:runtimeStatus?<><div className="settings-status-list">{runtimeStatus.services.map((service:any)=><div key={service.name}><span className={`settings-status-dot ${service.ready?'is-ready':''}`}/><div><strong>{service.name}</strong><p>{service.description}</p></div><span className={`pf-status ${service.ready?'is-confirmed':''}`}>{service.label}</span></div>)}</div><p className="settings-environment-note">{runtimeStatus.demoData?'当前为虚构开发数据，可切换老板、管理员和员工视角验证流程。':'当前使用已配置的数据源。'} 负责人或老板30%与同事互评70%全部完成后自动发布；周报及时率独立统计。</p></>:<ResultEmpty title="正在读取运行状态" description="服务连接与当前数据来源将在这里显示。"/>}
        </section>
        <section className="v2-card settings-guide"><h3 className="v2-card-title">从这里开始</h3><div><p><strong>01 · 确认团队</strong><span>在「组织与部门」同步飞书负责人，在「员工管理」检查在职人员。</span></p><p><strong>02 · 检查评分关系</strong><span>在「协作评分关系」配置谁给谁评分，并查看未完成任务。</span></p><p><strong>03 · 查看结果</strong><span>负责人或老板30%与同事互评70%全部完成后自动发布；周报质量与及时性异常在评分工作台核实。</span></p></div></section>
      </div>}
      <section className="settings-grid" data-settings-tab={settingsTab}>
      {["rules","ai","cycles","logs"].includes(settingsTab)&&<SystemConfiguration section={settingsTab as "rules"|"ai"|"cycles"|"logs"}/>}
      {bossView ? (
        <>
      <article className="panel" data-settings-group="permissions" hidden={settingsTab !== "permissions"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">SSO</span>
            <h2>飞书登录与权限模型</h2>
          </div>
        </div>
        <div className="permission-list">
          <div><strong>员工</strong><span>查看本人自动生成的周报质量分、提交统计，以及全部评分完成后发布的月度综合分。</span></div>

          <div><strong>管理员</strong><span>拥有与老板相同的管理功能，额外查看本人的分数、周报和成长记录。</span></div>
          <div><strong>评分人</strong><span>仅在评分工作台完成本人分配到的评分任务。</span></div>
          <div><strong>老板视角</strong><span>查看全公司经营看板、组织趋势、任务和月度会议，并管理角色授权。</span></div>
        </div>
      </article>
      <article className="panel boss-access-panel" data-settings-group="permissions" hidden={settingsTab !== "permissions"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Boss View</span>
            <h2>老板视角授权名单</h2>
          </div>
          <span className="boss-access-count">已授权 {bossViewMembers.length} 人</span>
        </div>
        <p className="boss-access-copy">勾选后授予老板视角，可查看公司经营看板并维护角色授权。管理员请在下方单独授权。</p>
        <div className="boss-member-grid">
          {bossViewCandidates().map((member) => {
            const checked = bossViewMembers.some((item) => item.userId === member.userId);
            return (
              <label className={`boss-member-option ${checked ? "is-selected" : ""}`} key={member.userId}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleBossViewMember(member)}
                />
                <span>
                  <strong>{member.name}</strong>
                  <small>{member.department || "未填部门"}</small>
                </span>
              </label>
            );
          })}
        </div>
        <div className="boss-access-actions">
          <button className="primary-button" type="button" onClick={saveBossViewMembers} disabled={bossViewState === "saving"}>
            {bossViewState === "saving" ? "保存中" : "保存老板视角名单"}
          </button>
          {bossViewState === "saved" ? <span className="settings-success">已保存，刷新页面后角色会同步为老板视角。</span> : null}
          {bossViewState === "error" ? <span className="settings-error">保存失败，请确认当前账号有管理视角权限。</span> : null}
        </div>
      </article>
      <article className="panel boss-access-panel" data-settings-group="permissions" hidden={settingsTab!=="permissions"}>
       <div className="panel-heading compact"><div><span className="section-label">Administrator</span><h2>管理员授权名单</h2></div><span>已授权 {adminMembers.length} 人</span></div>
       <p className="boss-access-copy">管理员使用自己的飞书员工身份，拥有完整管理功能，并额外保留个人分数、周报和评分任务。</p>
       <div className="boss-member-grid">{bossViewCandidates().map(member=><label className="boss-member-option" key={member.userId}><input type="checkbox" checked={adminMembers.some(m=>m.userId===member.userId)} onChange={()=>{setAdminState('idle');setAdminMembers(ms=>ms.some(m=>m.userId===member.userId)?ms.filter(m=>m.userId!==member.userId):[...ms,member]);}}/><span><strong>{member.name}</strong><small>{member.department}</small></span></label>)}</div>
       <div className="boss-access-actions"><button className="primary-button" disabled={adminState==='saving'} onClick={()=>void saveAdminMembers()}>保存管理员名单</button>{adminState==='saved'&&<span className="settings-success">管理员权限已保存。</span>}{adminState==='error'&&<span className="settings-error">保存失败，请重试。</span>}</div>
      </article>


        </>
      ) : null}
      {canManagePersonnel && settingsTab === "organization" && <DepartmentManagement/>}
      {canManagePersonnel ? (
      <article className="panel personnel-admin-panel" data-settings-group="people" hidden={settingsTab !== "people"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Active Roster</span>
            <h2>飞书 SSO 员工花名册</h2>
          </div>
          <span className="scoring360-live-badge">在职 {managedEmployees.filter((employee) => employee.active).length} 人</span>
        </div>
        <p className="boss-access-copy">新员工首次通过飞书 SSO 登录后自动加入花名册；后续登录同步姓名、邮箱和可读取的部门信息。管理员只需停用账号，历史周报和评分继续保留，停用后登录不会自动恢复。</p>
        {employeeMessage&&<p role={managedEmployeeState === "error"?"alert":"status"} className={managedEmployeeState === "error"?"settings-error":"settings-success"}>{employeeMessage}</p>}
        <div className="personnel-admin-list">
          {managedEmployees.map((employee) => (
            <div className={employee.active ? "" : "is-inactive"} key={employee.userId}>
              <span><strong>{employee.name}</strong><small>{employee.department || "部门待同步"} · user_id：{employee.userId}</small>{employee.lastLoginAt?<small>最近 SSO 登录：{employee.lastLoginAt}</small>:<small>现有导入记录 · 首次 SSO 登录后同步</small>}{employee.syncNote&&<small>{employee.syncNote}</small>}</span>
              <button className="secondary-button" type="button" onClick={() => setManagedEmployeeActive(employee, false)} disabled={managedEmployeeState === "saving" || !employee.active}>
                {employee.active ? "停用" : "已停用"}
              </button>
            </div>
          ))}
        </div>
      </article>
      ) : null}
      {canManageScoring360 ? (
        <>
      <article className="panel scoring360-config-panel" data-settings-group="scoring" hidden={settingsTab !== "scoring"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Collaboration 360</span>
            <h2>协同360评分关系配置</h2>
          </div>
          <span className="scoring360-live-badge">
            {scoring360Config?.diagnosis?.liveAssignments ? "活配置" : "静态兜底"}
          </span>
        </div>
        <div className="scoring360-config-copy">
          <strong>{scoring360Config?.cycle?.label || "当前评分周期"}</strong>
          <span>{scoring360Config?.diagnosis?.note || "当前页面用于维护谁给谁打分；管理视角或协同360管理员可见。"}</span>
        </div>
        <div className="scoring360-reminder-actions"><button type="button" className="secondary-button" disabled={scoring360State==='saving'} onClick={()=>void prepareScoringCycle('prepare')}>创建/切换本月评分周期</button><button type="button" className="primary-button" disabled={scoring360State==='saving'} onClick={()=>void prepareScoringCycle('open')}>开放本月评分（不发消息）</button></div><p className="pf-caption">同事互评占70%，评分关系由管理者手动指定；负责人或老板评分占30%。先创建周期、配置关系，再开放评分。</p><div className="scoring360-config-form">
          <label>
            <span>被评分人</span>
            <AppSelect
              aria-label="被评分人"
              value={scoring360Evaluee}
              onValueChange={setScoring360Evaluee}
              placeholder="输入或选择姓名"
              searchable searchPlaceholder="搜索姓名…"
            >{employeeChoices.map(e=><option key={e.userId} value={e.userId}>{e.name} · {e.department}</option>)}</AppSelect>
          </label>
          <label>
            <span>评分人</span>
            <AppSelect
              aria-label="评分人"
              value={scoring360Evaluator}
              onValueChange={setScoring360Evaluator}
              placeholder="输入或选择姓名"
              searchable searchPlaceholder="搜索姓名…"
            >{employeeChoices.map(e=><option key={e.userId} value={e.userId}>{e.name} · {e.department}</option>)}</AppSelect>
          </label>
          <button className="primary-button" type="button" onClick={addScoring360Assignment} disabled={scoring360State === "saving"}>
            添加评分关系
          </button>
        </div>
        <div className="scoring360-config-summary">
          <span>当前 {scoring360Config?.assignments.length || 0} 条评分关系</span>
          <button className="secondary-button" type="button" onClick={loadScoring360Config}>刷新</button>
        </div>
        <div className="scoring360-assignment-groups">
          {!scoring360Config?.assignments.length ? <p className="settings-hint">暂无评分关系。请先确认在职花名册，再添加评分人与被评分人。</p> : null}
          {groupScoring360Assignments(scoring360Config?.assignments || []).slice(0, 30).map((group) => (
            <div className="scoring360-assignment-group" key={group.evalueeUserId}>
              <div>
                <strong>{group.evalueeName}</strong>
                <span>{group.assignments.length} 位评分人</span>
              </div>
              <div className="scoring360-evaluator-chips">
                {group.assignments.map((assignment) => (
                  <span className={assignment.response ? "has-response" : ""} key={assignment.id}>
                    {assignment.evaluatorName}
                    {assignment.response ? <small>{assignment.response.score}分</small> : null}
                    <button
                      type="button"
                      aria-label={`删除 ${assignment.evaluatorName} 对 ${assignment.evalueeName} 的评分关系`}
                      onClick={() => removeScoring360Assignment(assignment.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        {scoring360Error ? <p role="alert" className="settings-error">{scoring360Error}</p> : null}
        {assignmentMessage ? <p role="status" className="settings-success">{assignmentMessage}</p> : null}
      </article>
      <article className="panel scoring360-reminder-panel" data-settings-group="scoring" hidden={settingsTab !== "scoring"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">360 Cycle</span>
            <h2>协同360评分任务提醒</h2>
          </div>
          <span className="scoring360-live-badge">
            管理员手动通知
          </span>
        </div>
        <div className="scoring360-config-copy">
          <strong>{scoring360ReminderStatus?.cycle?.label || "当前周期"}</strong>
          <span>
            本区用于手动预览和发送同事互评通知。每月最后两个工作日的自动提醒，请前往「周期与提醒」配置；自动提醒同时覆盖负责人月评与老板评分。
          </span>
        </div>
        <div className="scoring360-reminder-actions">
          <button className="secondary-button" type="button" onClick={() => sendScoring360Reminder("launch", true)} disabled={scoring360ReminderState === "running"}>
            预览首轮提醒（不发送）
          </button>
          <button className="secondary-button" type="button" onClick={() => sendScoring360Reminder("followup", true)} disabled={scoring360ReminderState === "running"}>
            预览补提醒（不发送）
          </button>
          <button className="primary-button" type="button" onClick={() => sendScoring360Reminder("launch", false)} disabled={scoring360ReminderState === "running"}>
            发起本月评分并发送首轮提醒
          </button>
          <button className="primary-button" type="button" onClick={() => sendScoring360Reminder("followup", false)} disabled={scoring360ReminderState === "running"}>
            手动发送未评分提醒
          </button>
          <button className="secondary-button" type="button" onClick={loadScoring360ReminderStatus}>
            刷新
          </button>
        </div>
        <div className="scoring360-pending-list">
          {(scoring360ReminderStatus?.pending || []).map((item) => (
            <div className={item.deliverable ? "" : "is-warning"} key={item.evaluatorName}>
              <strong>{item.evaluatorName}</strong>
              <span>{item.pendingCount}/{item.totalCount} 未评 · {item.department || "未填部门"}</span>
              <small>{item.deliverable ? item.pendingNames.join("、") : "缺少 user_id，暂不能飞书提醒"}</small>
              <button
                className="secondary-button scoring360-person-reminder"
                type="button"
                disabled={!item.deliverable || scoring360ReminderState === "running"}
                onClick={() => sendScoring360Reminder("followup", false, item)}
              >
                提醒此人
              </button>
            </div>
          ))}
          {(scoring360ReminderStatus?.pending || []).length === 0 ? <p className="empty-state">当前周期暂无待评分对象。</p> : null}
        </div>
        <div className="scoring360-config-summary">
          <span>最近发送记录 {scoring360ReminderStatus?.sends?.length || 0} 条</span>
          <span>身份：{scoring360ReminderStatus?.schedule?.identity || "bot"}</span>
        </div>
        {scoring360ReminderState === "done" ? (
          <p className="settings-success">
            {scoring360ReminderResult?.dryRun ? "预览完成" : "发送完成"}：目标 {scoring360ReminderResult?.count || 0} 人，成功 {scoring360ReminderResult?.sent || 0}，预览 {scoring360ReminderResult?.dryRunCount || 0}，跳过 {scoring360ReminderResult?.skipped || 0}，失败 {scoring360ReminderResult?.failed || 0}。
          </p>
        ) : null}
        {scoring360ReminderError ? <p className="settings-error">360 提醒失败：{scoring360ReminderError}</p> : null}
      </article>
        </>
      ) : null}
      {bossView ? (
        <>
      <article className="panel roster-audit-panel" data-settings-group="people" hidden={settingsTab !== "people"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Roster Audit</span>
            <h2>花名册与提醒名单健康检查</h2>
          </div>
          <button className="secondary-button" type="button" onClick={loadRosterAudit}>刷新</button>
        </div>
        <div className="roster-audit-kpis">
          <div><strong>{rosterAudit?.counts?.latestReports ?? "-"}</strong><span>最近周报人数</span></div>
          <div><strong>{rosterAudit?.counts?.newInReports ?? "-"}</strong><span>周报新人</span></div>
          <div><strong>{rosterAudit?.counts?.missingLatestReport ?? "-"}</strong><span>活跃但缺周报</span></div>
          <div><strong>{rosterAudit?.counts?.missingUserId ?? "-"}</strong><span>缺 user_id</span></div>
        </div>
        <div className="roster-audit-columns">
          <div>
            <strong>新增/待确认人员</strong>
            {(rosterAudit?.newInReports || []).slice(0, 8).map((item) => <span key={item.name}>{item.name} · {item.department || "未填部门"}</span>)}
            {(rosterAudit?.newInReports || []).length === 0 ? <span>暂无</span> : null}
          </div>
          <div>
            <strong>缺少最近周报</strong>
            {(rosterAudit?.missingLatestReport || []).slice(0, 8).map((item) => <span key={item.name}>{item.name} · {item.department || "未填部门"}</span>)}
            {(rosterAudit?.missingLatestReport || []).length === 0 ? <span>暂无</span> : null}
          </div>
        </div>
        <p className="settings-hint">{rosterAudit?.note || "后续每周一同步后会检查花名册变化，避免离职同事继续进提醒列表，也避免新入职人员漏进成长 OS。"}</p>
      </article>
      <article className="panel account-activity-panel" data-settings-group="activity" hidden={settingsTab !== "activity"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Account Activity</span>
            <h2>访问统计与成长关注度分析</h2>
          </div>
          <button className="secondary-button" type="button" onClick={loadAccountActivity}>刷新</button>
        </div>
        <div className="activity-window-copy">
          <strong>{accountActivity?.window?.periodLabel || "最近一次周一更新通知"}</strong>
          <span>
            统计窗口从 {formatDateTime(accountActivity?.window?.firstSentAt || accountActivity?.window?.startAt)} 开始。这里看的是账号活跃信号，后续绩效判断仍需结合真实工作产出。
          </span>
        </div>
        <div className="roster-audit-kpis">
          <div><strong>{accountActivity?.summary?.recipients ?? "-"}</strong><span>通知对象</span></div>
          <div><strong>{accountActivity?.summary?.activeRate ?? "-"}%</strong><span>有活跃记录</span></div>
          <div><strong>{accountActivity?.summary?.engaged ?? "-"}</strong><span>有互动贡献</span></div>
          <div><strong>{accountActivity?.summary?.noRecord ?? "-"}</strong><span>暂无活跃记录</span></div>
        </div>
        <div className="activity-analysis-copy">
          <strong>管理解释</strong>
          <span>这里只记录实际访问与互动，随机周报不会自动生成登录记录。访问次数不直接等同工作表现，也不自动决定绩效或奖惩。</span>
        </div>
        <div className="activity-table-wrap">
          <table className="activity-table">
            <thead>
              <tr>
                <th>同事</th>
                <th>状态</th>
                <th>登录/会话</th>
                <th>心跳/访问</th>
                <th>互动</th>
                <th>最近活跃</th>
              </tr>
            </thead>
            <tbody>
              {(accountActivity?.rows || [])
                .filter((row) => row.isReminderRecipient)
                .slice(0, 32)
                .map((row) => (
                  <tr className={row.status === "no_record" ? "is-silent" : row.status === "engaged" ? "is-engaged" : ""} key={row.userId || row.name}>
                    <td>
                      <strong>{row.name}</strong>
                      <span>{row.department || "未填部门"}</span>
                    </td>
                    <td><em>{row.statusLabel}</em></td>
                    <td>{row.loginCount}/{row.sessionCount}</td>
                    <td>{row.heartbeatCount}/{row.pageVisitCount}</td>
                    <td>{row.commentCount + row.reactionCount + row.followupCount}</td>
                    <td>{row.lastActiveAt ? formatDateTime(row.lastActiveAt) : "无记录"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="settings-hint">口径：登录=SSO成功次数；会话=已有登录态打开成长OS；心跳=页面可见时的持续活跃；访问=栏目切换或页面打开；互动=评论、点赞、追问。</p>
      </article>
      <article className="panel external-access-panel" data-settings-group="permissions" hidden={settingsTab !== "permissions"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">External Access</span>
            <h2>外部顾问临时访问链接</h2>
          </div>
        </div>
        <div className="external-access-copy">
          <strong>绕过 SSO，但不绕过过期控制</strong>
          <span>用于公司教练、外部顾问临时查看管理视角。链接按 token 访问，服务器只保存 hash，到期后自动失效。</span>
        </div>
        <div className="external-link-form">
          <label>
            <span>链接名称</span>
            <input value={externalName} onChange={(event) => setExternalName(event.target.value)} />
          </label>
          <label>
            <span>有效期</span>
            <AppSelect value={ttlHours} onValueChange={setTtlHours} aria-label="链接有效期">
              <option value="24">24 小时</option>
              <option value="72">3 天</option>
              <option value="168">7 天</option>
              <option value="720">30 天</option>
            </AppSelect>
          </label>
          <button className="primary-button" type="button" onClick={createExternalLink} disabled={externalLinkState === "creating"}>
            {externalLinkState === "creating" ? "生成中" : "生成访问链接"}
          </button>
        </div>
        {generatedUrl ? (
          <div className="generated-link-box">
            <strong>新链接只在这里完整显示一次</strong>
            <code>{generatedUrl}</code>
          </div>
        ) : null}
        {externalLinkState === "error" ? <p className="settings-error">生成失败，请确认后端服务和登录状态。</p> : null}
        <div className="external-link-list">
          {externalLinks.length === 0 ? (
            <p>暂无外部访问链接。</p>
          ) : (
            externalLinks.slice(0, 6).map((link) => (
              <div className="external-link-row" key={link.id}>
                <div>
                  <strong>{link.name || "外部顾问访问"}</strong>
                  <span>{link.status === "active" ? "有效" : "已失效"} · 访问 {link.accessCount || 0} 次 · 到期 {formatDateTime(link.expiresAt)}</span>
                </div>
                <small>{link.lastAccessedAt ? `最近访问 ${formatDateTime(link.lastAccessedAt)}` : "尚未访问"}</small>
              </div>
            ))
          )}
        </div>
      </article>
      {settingsTab === "integrations" && <FeishuReportConfiguration />}
      <article className="panel" data-settings-group="integrations" hidden={settingsTab !== "integrations"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Data Ingest</span>
            <h2>数据入口</h2>
          </div>
        </div>
        <div className="pipeline-list">
          <div><span>1</span><strong>飞书汇报导出 Excel</strong><p>保留 Excel / CSV 导入作为补交入口。</p></div>
          <div><span>2</span><strong>应用身份读取</strong><p>使用已授权的飞书汇报查询接口，自动翻页。</p></div>
          <div><span>3</span><strong>飞书汇报接口</strong><p>匹配指定模板与规则，按员工和周次幂等更新。</p></div>
          <div><span>4</span><strong>Kimi 周报分析</strong><p>候选质量分、点评、风险和行动建议持久化，供个人和管理页面使用。</p></div>
        </div>
      </article>
      <article className="panel lark-sync-panel" data-settings-group="integrations" hidden={settingsTab !== "integrations"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Lark Report Sync</span>
            <h2>飞书汇报自动同步</h2>
          </div>
          <span className={`sync-status-badge ${syncStatus?.running ? "is-running" : syncStatus?.ok === false ? "is-error" : ""}`}>
            {syncStatus?.running ? "同步中" : syncStatus?.ok === false ? "需处理" : "待命"}
          </span>
        </div>
        <div className="sync-flow-copy">
          <strong>完整流程：读取飞书汇报 → 保存原文 → Kimi 评分 → 自动更新月度结果</strong>
          <span>自动收集频率由上方设置管理，也可以立即手动同步。首次手动同步按配置日期读取；未填写则读取本月。未变化的 AI 分析会复用，失败记录下一轮自动重试。</span>
        </div>
        <div className="sync-status-box">
          <div>
            <strong>{syncStatus?.message || "尚未运行飞书汇报同步"}</strong>
            <span>
              {syncStatus?.period?.label ? `${syncStatus.period.label} ${syncStatus.period.range || ""}` : "按已配置的首次同步日期至今天"}
              {syncStatus?.rowCount ? ` · ${syncStatus.rowCount} 条` : ""}
            </span>
          </div>
          <small>{syncStatus?.updatedAt ? `更新于 ${formatDateTime(syncStatus.updatedAt)}` : "等待首次同步"}</small>
        </div>
        <div className="sync-actions">
          <button
            className="primary-button"
            type="button"
            onClick={startLarkReportSync}
            disabled={syncState === "starting" || syncState === "running" || Boolean(syncStatus?.running)}
          >
            {syncState === "starting" ? "启动中" : syncStatus?.running ? "同步运行中" : "立即同步飞书汇报"}
          </button>
          <button className="secondary-button" type="button" onClick={loadLarkReportSyncStatus}>
            刷新状态
          </button>
        </div>
        {syncError ? <p className="settings-error">同步启动失败：{syncError}</p> : null}
        {syncStatus?.ok === false ? <p className="settings-error">最近一次同步失败：{syncStatus.message}</p> : null}
      </article>
      <article className="panel reminder-outbox-panel" data-settings-group="integrations" hidden={settingsTab !== "integrations"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Message Outbox</span>
            <h2>成长提醒文案队列审阅</h2>
          </div>
          <button className="secondary-button" type="button" onClick={loadWeeklyReminderStatus}>刷新</button>
        </div>
        <div className="reminder-outbox-summary">
          <strong>周五提醒：{weeklyReminderStatus?.outbox?.fridayPeriodId || "未生成"}</strong>
          <span>周一更新通知：{weeklyReminderStatus?.outbox?.mondayPeriodId || "未生成"}</span>
        </div>
        <div className="reminder-outbox-list">
          {(weeklyReminderStatus?.outbox?.items || []).length === 0 ? (
            <p>暂无预生成文案。当前周报同步不会自动向员工发送消息。</p>
          ) : (
            (weeklyReminderStatus?.outbox?.items || []).map((item) => (
              <article className="reminder-outbox-row" key={item.id}>
                <div className="reminder-outbox-meta">
                  <strong>{item.recipientName}</strong>
                  <span>{item.department || "未填部门"} · {item.kind === "monday_update" ? "周一更新通知" : "周五周报提醒"} · {item.status}</span>
                  <small>{item.provider || "local"}{item.model ? ` / ${item.model}` : ""} · {formatDateTime(item.updatedAt)}</small>
                </div>
                <p>{item.message}</p>
                {item.personalizationNote ? <small className="reminder-outbox-note">个性化依据：{item.personalizationNote}</small> : null}
              </article>
            ))
          )}
        </div>
      </article>
      <article className="panel import-mode-panel" data-settings-group="integrations" hidden={settingsTab !== "integrations"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Late Submission</span>
            <h2>补交周报导入策略</h2>
          </div>
        </div>
        <div className="import-mode-list">
          <div className="is-primary">
            <strong>增量导入个人周报</strong>
            <span>适合单人补交场景：上传个人 Excel 或从飞书汇报详情抓取，系统按人员+周次 upsert，不重跑全员导入。</span>
          </div>
          <div>
            <strong>重导完整全员表</strong>
            <span>适合每周固定归档：整份 Excel 作为新的导入批次，已存在记录更新，缺失记录保持历史状态。</span>
          </div>
          <div>
            <strong>导入后局部重算</strong>
            <span>只重算该员工个人成长、所在部门主题、老板 P0/P1 队列增量影响，夜间再跑全量 Kimi 深分析。</span>
          </div>
        </div>
        <div
          className={`import-dropzone ${importState === "dragging" ? "is-dragging" : ""} ${importState === "done" ? "is-done" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setImportState("dragging");
          }}
          onDragLeave={() => setImportState(importResult ? "done" : "idle")}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            hidden
            onChange={(event) => {
              void uploadWeeklyReport(event.target.files?.[0]);
            }}
          />
          <strong>{importState === "uploading" ? "正在导入..." : "拖入或点击上传 Excel / CSV"}</strong>
          <span>真实入口：后端会保存原始文件，识别 full_export / single_employee，并按人员+周次 upsert 到数据库。</span>
        </div>
        {importResult?.batch ? (
          <div className="import-result-box">
            <strong>导入完成：{importResult.batch.sourceName}</strong>
            <span>
              {importResult.batch.importMode} · 有效 {importResult.batch.validCount}/{importResult.batch.rowCount} 条 · 新增 {importResult.batch.inserted} · 更新 {importResult.batch.updated} · 周期 {importResult.batch.weekLabel}
            </span>
            {importResult.sampleRecords?.length ? (
              <small>
                样例：{importResult.sampleRecords.map((record) => `${record.employeeName}（${record.department || "未填部门"}）`).join("、")}
              </small>
            ) : null}
          </div>
        ) : null}
        {importError ? <p className="settings-error">导入失败：{importError}</p> : null}
      </article>
      <article className="panel storage-panel" data-settings-group="integrations" hidden={settingsTab !== "integrations"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Storage</span>
            <h2>数据库与对象存储</h2>
          </div>
        </div>
        <div className="storage-list">
          <div><strong>当前部署</strong><span>本机 OrbStack 容器运行 Node API；SQLite 数据库和上传文件使用持久化数据卷。</span></div>
          <div><strong>SQL 必须要</strong><span>周报、评论、点赞、任务、贡献度排行、权限和幂等导入都需要结构化事务。</span></div>
          <div><strong>推荐 RDS PostgreSQL</strong><span>生产环境优先用阿里云 RDS 自动备份；预算敏感时再自建 Postgres，并把备份推到 OSS。</span></div>
          <div><strong>对象存储</strong><span>原始 Excel、导出 HTML、附件、分析报告快照放 OSS，不直接塞进数据库。</span></div>
          <div><strong>向量/全文检索</strong><span>后续用 pgvector 或独立向量库保存周报片段 embedding，供 AI 上下文召回。</span></div>
        </div>
      </article>
      <article className="panel storage-panel" data-settings-group="integrations" hidden={settingsTab !== "integrations"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Feishu Task</span>
            <h2>飞书任务创建权限</h2>
          </div>
        </div>
        <div className="storage-list">
          <div><strong>最小闭环权限</strong><span>task:task:write、task:task:read、task:tasklist:write、task:tasklist:read。</span></div>
          <div><strong>人员分配</strong><span>需要通讯录 user_id 映射；如果要按姓名分配，需读取联系人/组织架构权限。</span></div>
          <div><strong>创建策略</strong><span>AI 只生成候选任务，老板或员工勾选后再批量创建，避免把噪声写入飞书。</span></div>
          <div><strong>幂等保护</strong><span>每条任务使用 report_week + employee_user_id + task_id 作为幂等 key，重复导入不会重复建任务。</span></div>
        </div>
      </article>
      <article className="panel" data-settings-group="integrations" hidden={settingsTab !== "integrations"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Model Routing</span>
            <h2>大模型调用策略</h2>
          </div>
        </div>
        <div className="model-route-list">
          <div className="is-primary"><strong>Kimi K2.6</strong><span>主模型：周报长上下文分析、问题分拣、任务拆解、老板周总结。</span></div>
          <div><strong>Kimi K2.5</strong><span>低成本批处理：初筛、格式化、低风险改写、缓存命中复用。</span></div>
          <div><strong>Gemini</strong><span>可选备份：后续只在网络与合规稳定时用于交叉评审。</span></div>
        </div>
      </article>
      <article className="panel memory-panel" data-settings-group="integrations" hidden={settingsTab !== "integrations"}>
        <div className="panel-heading compact">
          <div>
            <span className="section-label">AI Memory Pipeline</span>
            <h2>周报知识库与组织记忆</h2>
          </div>
        </div>
        <div className="memory-pipeline">
          <div>
            <strong>1. 原始周报入库</strong>
            <span>每周按人员、部门、周次、权限范围写入文档库，并切成可检索片段。</span>
          </div>
          <div>
            <strong>2. AI 分析事件化</strong>
            <span>评分、成长建议、风险识别、P0/P1 判断都保存为结构化事件。</span>
          </div>
          <div>
            <strong>3. 互动沉淀上下文</strong>
            <span>评论、点赞、全员公开、老板介入、任务状态都成为下一周分析依据。</span>
          </div>
          <div>
            <strong>4. 下周上下文包</strong>
            <span>分析前自动召回个人历史、部门共性问题、未闭环任务和关键决策。</span>
          </div>
        </div>
        <div className="context-pack-grid">
          <div><strong>个人上下文包</strong><span>近 9 周周报、评分趋势、教练问题、未闭环承诺。</span></div>
          <div><strong>团队上下文包</strong><span>同部门高频卡点、优秀样本、跨人协同线索。</span></div>
          <div><strong>公司上下文包</strong><span>P0/P1 风险、战略主题、老板评论、全员公告。</span></div>
          <div><strong>任务上下文包</strong><span>从周报生成的飞书任务、负责人、截止日、进展回传。</span></div>
        </div>
      </article>
        </>
      ) : null}
    </section>
      </div></div>
    </div>
  );
}

function formatDateTime(value?: string) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function bossViewCandidates(): BossViewMember[] {
  const priority = new Map<string, number>();
  return appData.employeeSummary
    .filter((employee) => employee.userId)
    .map((employee) => ({
      userId: employee.userId,
      name: employee.name,
      department: employee.department,
    }))
    .sort((left, right) => {
      const leftPriority = priority.get(left.name) || 99;
      const rightPriority = priority.get(right.name) || 99;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.name.localeCompare(right.name, "zh-CN");
    });
}

function groupScoring360Assignments(assignments: Scoring360ConfigAssignment[]) {
  const groups = new Map<string, Scoring360ConfigAssignment[]>();
  for (const assignment of assignments) {
    if (!groups.has(assignment.evalueeUserId)) groups.set(assignment.evalueeUserId, []);
    groups.get(assignment.evalueeUserId)!.push(assignment);
  }
  return Array.from(groups.entries()).map(([evalueeUserId, groupAssignments]) => ({
    evalueeUserId, evalueeName:groupAssignments[0].evalueeName,
    assignments: groupAssignments,
  }));
}
