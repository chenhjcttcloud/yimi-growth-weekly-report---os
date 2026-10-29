import {DepartmentsPage} from './pages/DepartmentsPage';
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { Sidebar } from "./components/Sidebar";
import { bootstrapData as appData } from "./lib/bootstrap-data";
import type { PageKey } from "./lib/types";
import { FinalResultsPage } from "./pages/FinalResultsPage";
import { PerformanceManagementPage } from "./pages/PerformanceManagementPage";
import { ScoringTasksPage } from "./pages/ScoringTasksPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { UserAccess } from "./lib/types";
import {canVisitPage,perspectiveAccess,rememberLocation,requestedPage,resolvePage} from './lib/navigation';

const DashboardPage=lazy(()=>import('./pages/DashboardPage').then(module=>({default:module.DashboardPage})));
const MonthlyMeetingPage=lazy(()=>import('./pages/MonthlyMeetingPage').then(module=>({default:module.MonthlyMeetingPage})));
const TasksPage=lazy(()=>import('./pages/TasksPage').then(module=>({default:module.TasksPage})));
const TrendsPage=lazy(()=>import('./pages/TrendsPage').then(module=>({default:module.TrendsPage})));

const fallbackAccess: UserAccess = {
  role: "member",
  bossView: false,
  externalView: false,
  canViewBossDashboard: false,
  canViewSettings: false,
  canManageScoring360: false,
  canManagePersonnel: false,
  currentEmployee: null,
  visibilityMode: "self_only",
  visibleEmployees: [],
  visibleUserIds: [],
  visibleNames: [],
  visibleDepartments: [],
};

export function App() {
  const [activePage, setActivePage] = useState<PageKey>(()=>requestedPage()||'growth');
  useEffect(() => { document.querySelector('.content-shell')?.scrollTo({top:0}); }, [activePage]);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedPeriodId, setSelectedPeriodId] = useState(appData.currentWeekId || appData.periods.at(-1)?.id || "");
  const [taskCreated, setTaskCreated] = useState(false);
  const [summaryReady, setSummaryReady] = useState(false);
  const [summaryBusy,setSummaryBusy]=useState(false),[summaryVersion,setSummaryVersion]=useState(0),[actionMessage,setActionMessage]=useState('');
  useEffect(()=>{setSummaryReady(false);setActionMessage('');},[selectedPeriodId]);
  async function generateSummary(){if(summaryBusy)return;setSummaryBusy(true);setActionMessage('');try{const r=await fetch('/api/management/summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({periodId:selectedPeriodId})}),j=await r.json();if(!r.ok)throw Error(j.error==='ai_not_configured'?'请先在系统设置配置 AI 服务':j.error==='no_reports'?'本周期没有可分析周报':'摘要生成未完成，请检查服务后重试');setSummaryReady(true);setSummaryVersion(v=>v+1);setActivePage('dashboard');setActionMessage(`已根据 ${j.summary.reportCount} 份本周期周报生成摘要，尚未发送消息。`);}catch(e){setActionMessage(e instanceof Error?e.message:'生成失败');}finally{setSummaryBusy(false);}}
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [adminPerspective,setAdminPerspective]=useState<string>('management');
  const previewEmployeeId=access?.role==='system_admin'&&adminPerspective.startsWith('employee:')?adminPerspective.slice(9):'';
  const previewEmployee=access?.visibleEmployees.find(e=>e.userId===previewEmployeeId);
  const personalMode=access?.role==='system_admin'&&(adminPerspective==='personal'||Boolean(previewEmployee));
  const currentAccess = access?perspectiveAccess(access,adminPerspective):fallbackAccess;
  function changePerspective(next:string){
    if(!window.dispatchEvent(new Event('organization-before-leave',{cancelable:true})))return;
    setAdminPerspective(next);setSelectedEmployee(access?.currentEmployee?.name||'');
    setActivePage(next==='management'?'dashboard':'growth');
    try{localStorage.setItem('admin-perspective:'+access?.currentEmployee?.userId,next);}catch{}
  }
  const externalView = currentAccess.externalView;
  const canOpenPage = (page: PageKey) => canVisitPage(page,currentAccess);

  useEffect(() => {
    async function loadMe() {
      try {
        const response = await fetch("/api/me");
        if (response.status === 401) {
          const next = `${window.location.pathname}${window.location.search}`;
          window.location.assign(`/auth/login?next=${encodeURIComponent(next)}`);
          return;
        }
        if (!response.ok) throw new Error("load_me_failed");
        const result = await response.json();
        const nextAccess = normalizeAccess(result.access, result.user);
        setAccess(nextAccess);
        let mode='management';
        if(nextAccess.role==='system_admin'){
          try{const saved=localStorage.getItem('admin-perspective:'+nextAccess.currentEmployee?.userId)||'';if(saved==='personal'||(saved.startsWith('employee:')&&nextAccess.visibleEmployees.some(e=>e.userId===saved.slice(9))))mode=saved;}catch{}
          setAdminPerspective(mode);
        }
        const permitted=perspectiveAccess(nextAccess,mode);
        setActivePage(page=>resolvePage(requestedPage()||(page!=='growth'?page:undefined),permitted));
        setSelectedEmployee((name) => {
          if (nextAccess.visibleEmployees.some((employee) => employee.name === name)) return name;
          return nextAccess.currentEmployee?.name || nextAccess.visibleEmployees[0]?.name || "";
        });
      } catch {
        setAccess(fallbackAccess);
        setActivePage(page=>resolvePage(page,fallbackAccess));
      }
    }
    loadMe();
  }, []);

  useEffect(()=>{
    if(!access)return;
    const allowed=resolvePage(activePage,currentAccess);
    if(allowed!==activePage){setActivePage(allowed);return;}
    rememberLocation('page',activePage);
  },[access,activePage,adminPerspective]);

  useEffect(()=>{
    if(!access)return;
    const restore=()=>{
      if(!window.dispatchEvent(new Event('organization-before-leave',{cancelable:true}))){rememberLocation('page',activePage);return;}
      setActivePage(resolvePage(requestedPage(),currentAccess));
    };
    window.addEventListener('popstate',restore);
    return()=>window.removeEventListener('popstate',restore);
  },[access,adminPerspective,activePage]);

  useEffect(() => {
    if(!access)return;
    fetch("/api/usage/visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: activePage }),
      keepalive: true,
    }).catch(() => {
      // Static preview can run without the backend.
    });
  }, [access,activePage]);

  useEffect(() => {
    if (!access || externalView) return;
    const sendHeartbeat = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/usage/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page: activePage, visible: true }),
        keepalive: true,
      }).catch(() => {
        // Static preview can run without the backend.
      });
    };
    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 3 * 60 * 1000);
    document.addEventListener("visibilitychange", sendHeartbeat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sendHeartbeat);
    };
  }, [access, activePage, externalView]);

  const page = useMemo(() => {
    if(activePage==="departments"&&currentAccess.canViewSettings)return <DepartmentsPage/>;
    if (activePage === "dashboard" && currentAccess.canViewBossDashboard) {
      return (
        <DashboardPage
          summaryVersion={summaryVersion}
          selectedPeriodId={selectedPeriodId}
          externalView={externalView}
          onOpenEmployee={(name) => {
            setSelectedEmployee(name);
            setActivePage("scores");
          }}
        />
      );
    }

    if (activePage === "scores") {
      return currentAccess.canManageScoring360 ? <PerformanceManagementPage /> : <ScoringTasksPage key={previewEmployeeId} previewEmployeeId={previewEmployeeId}/>;
    }

    if (activePage === "monthly" && currentAccess.canViewBossDashboard) {
      return (
        <MonthlyMeetingPage
          onOpenEmployee={(name) => {
            setSelectedEmployee(name);
            setActivePage("scores");
          }}
        />
      );
    }

    if (activePage === "tasks" && currentAccess.canViewBossDashboard) {
      return <TasksPage selectedPeriodId={selectedPeriodId} taskCreated={taskCreated} readOnly={externalView} onCreateTasks={() => setTaskCreated(true)} />;
    }

    if (activePage === "settings" && currentAccess.canViewSettings) {
      return <SettingsPage access={currentAccess} onOpenScoringSetup={()=>{rememberLocation('scoreTab','setup');setActivePage('scores');}} />;
    }

    if (["reports", "coach", "actions", "timeline"].includes(activePage) && currentAccess.role !== "boss" && !externalView) {
      return <FinalResultsPage previewEmployeeId={previewEmployeeId} key={activePage+previewEmployeeId} module={activePage as import("./lib/types").PersonalModule} onOpenModule={setActivePage} />;
    }

    if (!currentAccess.canViewBossDashboard) return <FinalResultsPage previewEmployeeId={previewEmployeeId} key={activePage+previewEmployeeId} onOpenModule={setActivePage} />;

    if (activePage === "growth") {
      return currentAccess.role !== "system_admin" && currentAccess.canViewBossDashboard ? <DashboardPage selectedPeriodId={selectedPeriodId} externalView={externalView} onOpenEmployee={(name)=>{setSelectedEmployee(name);setActivePage("scores");}}/> : <FinalResultsPage previewEmployeeId={previewEmployeeId} key={activePage+previewEmployeeId} onOpenModule={setActivePage} />;
    }

    if (activePage === "trends") {
      return <TrendsPage selectedPeriodId={selectedPeriodId} />;
    }


    return <FinalResultsPage previewEmployeeId={previewEmployeeId} key={activePage+previewEmployeeId} onOpenModule={setActivePage} />;
  }, [activePage, selectedEmployee, selectedPeriodId, summaryReady,summaryVersion, taskCreated, currentAccess, externalView, previewEmployeeId]);

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        onChangePage={(page) => {
          if (canOpenPage(page) && (page===activePage||window.dispatchEvent(new Event('organization-before-leave',{cancelable:true})))) setActivePage(page);
        }}
        canViewBossDashboard={currentAccess.canViewBossDashboard}
        canViewSettings={currentAccess.canViewSettings}
        showPersonalResults={currentAccess.role !== "boss" && !externalView && !(access?.role==="system_admin"&&!personalMode)}
        userName={currentAccess.currentEmployee?.name || ""}
        userDepartment={currentAccess.currentEmployee?.department || ""}
      />
      <main className="main-shell">
        <AppHeader
          activePage={activePage}
          managementRole={currentAccess.role}
          adminPerspective={access?.role==='system_admin'?adminPerspective:undefined}
          onChangeAdminPerspective={changePerspective}
          previewEmployees={access?.visibleEmployees||[]}
          externalView={externalView}
          canViewBossDashboard={currentAccess.canViewBossDashboard}
          summaryReady={summaryReady}
          summaryBusy={summaryBusy}
          taskCreated={taskCreated}
          selectedPeriodId={selectedPeriodId}
          onSelectPeriod={setSelectedPeriodId}
          onCreateTasks={() => {
            setActivePage("tasks");
          }}
          onGenerateSummary={()=>void generateSummary()}
          onOpenNotificationTarget={(employeeName) => {
            setSelectedEmployee(employeeName);
            setActivePage("scores");
          }}
        />
        {previewEmployee&&<div className="employee-preview-banner" role="status"><span>只读预览 · {previewEmployee.name}（{previewEmployee.department}） · 当前登录：{access?.currentEmployee?.name}</span><button type="button" onClick={()=>changePerspective('management')}>退出预览</button></div>}
        <div className={`content-shell ${activePage === "settings" ? "content-shell-settings" : ""}`}>{actionMessage&&<p role="status" className="pf-notice app-action-message">{actionMessage}</p>}{access?<Suspense fallback={<p role="status">正在读取本页数据…</p>}>{page}</Suspense>:<p role="status">正在恢复页面…</p>}</div>
      </main>
    </div>
  );
}

function normalizeAccess(value: unknown, user: any): UserAccess {
  const record = value && typeof value === "object" ? value as Partial<UserAccess> : {};
  const visibleEmployees = Array.isArray(record.visibleEmployees) ? record.visibleEmployees : [];
  return {
    role: String(record.role || user?.role || "member"),
    bossView: Boolean(record.bossView || user?.bossView),
    externalView: Boolean(record.externalView || user?.role === "external_boss_view"),
    canViewBossDashboard: Boolean(record.canViewBossDashboard || record.bossView || user?.bossView || user?.role === "external_boss_view"),
    canManageScoring360: Boolean(record.canManageScoring360 || record.bossView || user?.bossView),
    canManagePersonnel: Boolean(record.canManagePersonnel || record.canManageScoring360 || record.bossView || user?.bossView),
    canViewSettings: Boolean(record.canViewSettings || record.canManageScoring360 || record.bossView || user?.bossView),
    currentEmployee: record.currentEmployee || null,
    visibilityMode: String(record.visibilityMode || "self_department_and_reports"),
    visibleEmployees,
    visibleUserIds: Array.isArray(record.visibleUserIds) ? record.visibleUserIds : visibleEmployees.map((employee) => employee.userId).filter(Boolean),
    visibleNames: Array.isArray(record.visibleNames) ? record.visibleNames : visibleEmployees.map((employee) => employee.name).filter(Boolean),
    visibleDepartments: Array.isArray(record.visibleDepartments) ? record.visibleDepartments : Array.from(new Set(visibleEmployees.map((employee) => employee.department).filter(Boolean))),
  };
}
