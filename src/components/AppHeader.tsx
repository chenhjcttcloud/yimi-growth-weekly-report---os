import { useEffect, useState } from "react";
import { AppSelect } from "./AppSelect";
import { Bell, CheckCircle2, Send, ShieldCheck } from "lucide-react";
import { DevViewSwitcher } from "./DevViewSwitcher";
import { PerspectiveSwitcher } from "./PerspectiveSwitcher";
import { appData } from "../lib/data";
import type { PageKey } from "../lib/types";

const titles: Record<PageKey, string> = {
  departments: "部门管理",
  dashboard: "老板驾驶舱",
  monthly: "月度会议",
  scores: "评分工作台",
  tasks: "任务闭环",
  growth: "个人最终结果",
  reports: "周报与互动",
  coach: "AI 教练",
  actions: "行动任务",
  timeline: "成长轨迹",
  trends: "组织趋势",
  settings: "系统设置",
};

interface AppHeaderProps {
  activePage: PageKey;
  externalView: boolean;
  canViewBossDashboard: boolean;
  managementRole?: string;
  adminPerspective?: string;
  previewEmployees?: Array<{userId:string;name:string;department?:string}>;
  onChangeAdminPerspective?: (value:string)=>void;
  summaryReady: boolean;
  summaryBusy?:boolean;
  taskCreated: boolean;
  selectedPeriodId: string;
  onSelectPeriod: (periodId: string) => void;
  onCreateTasks: () => void;
  onGenerateSummary: () => void;
  onOpenNotificationTarget: (employeeName: string) => void;
}

interface NotificationItem {
  id: string;
  eventType: string;
  targetEmployeeName?: string;
  actorName?: string;
  title: string;
  body?: string;
  readAt?: string;
  createdAt?: string;
}

export function AppHeader({
  activePage,
  externalView,
  canViewBossDashboard,
  managementRole,
  adminPerspective,
  previewEmployees=[],
  onChangeAdminPerspective,
  summaryReady,
  summaryBusy=false,
  taskCreated,
  selectedPeriodId,
  onSelectPeriod,
  onCreateTasks,
  onGenerateSummary,
  onOpenNotificationTarget,
}: AppHeaderProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);

  useEffect(() => {
    if (!canViewBossDashboard) return;
    void loadNotifications();
    const timer = window.setInterval(() => {
      void loadNotifications();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activePage, canViewBossDashboard]);

  async function loadNotifications() {
    try {
      const response = await fetch("/api/notifications");
      if (!response.ok) return;
      const result = await response.json();
      setNotifications(Array.isArray(result.notifications) ? result.notifications : []);
      setUnreadCount(Number(result.unreadCount || 0));
    } catch {
      // Static preview can render without the notification API.
    }
  }

  async function markRead(ids?: string[]) {
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      await loadNotifications();
    } catch {
      // The dropdown remains usable even if marking read fails.
    }
  }

  async function openNotification(item: NotificationItem) {
    await markRead([item.id]);
    if (item.targetEmployeeName) {
      onOpenNotificationTarget(item.targetEmployeeName);
      setNotificationOpen(false);
    }
  }

  async function exitReadonlyView() {
    try {
      await fetch("/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/auth/login?next=/";
    }
  }

  return (
    <header className="app-header">
      <div>
        <h1>{titles[activePage]}</h1>
        {canViewBossDashboard && activePage !== "growth" && activePage !== "departments" && activePage !== "scores" ? <div className="header-meta">
          <span>{currentPeriodLabel(selectedPeriodId)}</span>
          <span>数据生成：{appData.generatedOn}</span>
          <AppSelect
            className="period-select"
            value={selectedPeriodId}
            onValueChange={onSelectPeriod}
            aria-label="选择周报周期"
            disabled={summaryBusy}
          >
            {appData.periods.slice().reverse().map((period) => (
              <option value={period.id} key={period.id}>
                {period.label} {period.range}
              </option>
            ))}
          </AppSelect>
        </div> : <p className="header-meta">{activePage==="scores"?"月度结果 · 配评安排 · 评分任务":activePage==="departments"?"部门层级 · 团队成员 · 月度表现 · 负责人评分":"月度结果 · 每周周报 · AI 教练 · 行动闭环"}</p>}
      </div>

      <div className="header-actions">
        {adminPerspective && <PerspectiveSwitcher value={adminPerspective} employees={previewEmployees} onChange={onChangeAdminPerspective} />}
          <DevViewSwitcher employees={previewEmployees} />
        {canViewBossDashboard ? <div className="notification-anchor">
          <button className="icon-button notification-button" type="button" aria-label="通知" onClick={() => setNotificationOpen((open) => !open)}>
            <Bell size={18} />
            {unreadCount > 0 ? <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
          </button>
          {notificationOpen ? (
            <div className="notification-popover">
              <div className="notification-heading">
                <strong>成长提醒</strong>
                <button type="button" onClick={() => markRead()}>
                  全部已读
                </button>
              </div>
              <div className="notification-list">
                {notifications.length === 0 ? (
                  <p className="notification-empty">暂无新的点赞、评论或 AI 追问。</p>
                ) : (
                  notifications.slice(0, 8).map((item) => (
                    <button className={`notification-item ${item.readAt ? "" : "is-unread"}`} type="button" key={item.id} onClick={() => openNotification(item)}>
                      <span>{notificationLabel(item.eventType)}</span>
                      <strong>{item.title}</strong>
                      {item.body ? <small>{item.body}</small> : null}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div> : null}
        {canViewBossDashboard && activePage !== "growth" && activePage !== "scores" && activePage !== "settings" && activePage !== "departments" ? (
          <>
            {!adminPerspective && (<button className="secondary-button management-role-badge" type="button" onClick={externalView ? exitReadonlyView : undefined}>
              <ShieldCheck size={16} />
              <span>{externalView ? "退出只读视图" : "管理视角"}</span>
            </button>)}
            <button
              className={`secondary-button ${taskCreated ? "is-confirmed" : ""}`}
              type="button"
              onClick={onCreateTasks}
              disabled={externalView}
              title={externalView ? "外部访问链接为只读模式，不能创建飞书任务" : undefined}
            >
              <CheckCircle2 size={16} />
              <span>{externalView ? "只读访问" : "查看关注任务"}</span>
            </button>
            <button
              className={`primary-button ${summaryReady ? "is-confirmed" : ""}`}
              type="button"
              onClick={onGenerateSummary}
              disabled={externalView||summaryBusy}
              title={externalView ? "外部访问链接为只读模式，不能生成或写入公司总结" : undefined}
            >
              <Send size={16} />
              <span>{externalView ? "只读视图" : summaryBusy?'正在生成…':summaryReady ? "重新生成公司总结" : "生成公司总结"}</span>
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}

function notificationLabel(eventType: string) {
  if (eventType === "comment") return "评论";
  if (eventType === "reaction") return "点赞";
  if (eventType === "ai_followup") return "追问";
  return "提醒";
}

function currentPeriodLabel(periodId: string) {
  const period = appData.periods.find((item) => item.id === periodId) ?? appData.periods.at(-1);
  if (!period) return `${appData.currentWeekLabel} ${appData.currentWeekRange}`.trim();
  return `${period.label} ${period.range}`.trim();
}
