import {
  Building2,
  BookOpen,
  Brain,
  History,
  Target,
  CalendarClock,
  ClipboardCheck,
  Gauge,
  LineChart,
  Settings,
  Sprout,
  Trophy,
} from "lucide-react";
import type { NavItem, PageKey } from "../lib/types";

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "我的成长",
    items: [
      { key: "growth", label: "个人最终结果", icon: Sprout },
      { key: "reports", label: "周报与互动", icon: BookOpen },
      { key: "coach", label: "AI 教练", icon: Brain },
      { key: "actions", label: "行动任务", icon: Target },
      { key: "timeline", label: "成长轨迹", icon: History },
      { key: "scores", label: "评分工作台", icon: Trophy },
    ],
  },
  {
    label: "组织脉搏",
    items: [{ key: "departments", label: "部门管理", icon: Building2 },{ key: "trends", label: "组织趋势", icon: LineChart }],
  },
  {
    label: "管理视角",
    items: [
      { key: "dashboard", label: "老板驾驶舱", icon: Gauge },
      { key: "tasks", label: "任务闭环", icon: ClipboardCheck },
      { key: "monthly", label: "月度会议", icon: CalendarClock },
    ],
  },
  {
    label: "系统",
    items: [{ key: "settings", label: "系统设置", icon: Settings }],
  },
];

interface SidebarProps {
  activePage: PageKey;
  onChangePage: (page: PageKey) => void;
  canViewBossDashboard: boolean;
  canViewSettings: boolean;
  showPersonalResults: boolean;
  userName?: string;
  userDepartment?: string;
}

export function Sidebar({ activePage, onChangePage, canViewBossDashboard, canViewSettings, showPersonalResults, userName, userDepartment }: SidebarProps) {
  const canOpen = (key: PageKey) => {
    if (["growth", "reports", "coach", "actions", "timeline"].includes(key)) return showPersonalResults;
    if(key === "departments")return canViewSettings;
    if (key === "dashboard" || key === "monthly" || key === "tasks" || key === "trends") return canViewBossDashboard;
    if (key === "settings") return canViewSettings;
    return true;
  };
  const visibleGroups = navGroups
    .map((group) => ({ ...group, label: group.label === "我的成长" && !showPersonalResults ? "评分管理" : group.label, items: group.items.filter((item) => canOpen(item.key)) }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Sprout size={19} />
        </div>
        <div>
          <strong>亿觅成长 OS</strong>
          <span>让成长被看见</span>
        </div>
      </div>

      <nav className="side-nav" aria-label="主导航">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  aria-label={item.label}
                  title={item.label}
                  className={`nav-item ${activePage === item.key ? "is-active" : ""}`}
                  type="button"
                  onClick={() => onChangePage(item.key)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {userName ? (
        <div className="sidebar-user">
          <span className="sidebar-user-avatar">{userName.slice(0, 1)}</span>
          <span>
            <span className="sidebar-user-name">{userName}</span>
            {userDepartment ? <span className="sidebar-user-dept">{userDepartment}</span> : null}
          </span>
        </div>
      ) : null}
    </aside>
  );
}
