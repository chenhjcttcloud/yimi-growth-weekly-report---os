import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Eye, Search, ShieldCheck, UserRound, Users, X } from "lucide-react";

type Employee = { userId: string; name: string; department?: string };
interface Props {
  value: string;
  employees: Employee[];
  onChange?: (value: string) => void;
  shortcuts?: Array<{ id: string; title: string; description: string }>;
  readOnly?: boolean;
  title?: string;
  caption?: string;
  disabled?: boolean;
}

export function PerspectiveSwitcher({ value, employees, onChange, shortcuts = [{ id: "management", title: "管理视角", description: "查看组织与团队" }, { id: "personal", title: "本人视角", description: "查看我的成长" }], readOnly = true, title = "切换视角", caption, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0, width: 360, maxHeight: 560 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const selected = employees.find(employee => `employee:${employee.userId}` === value);
  const label = selected?.name ?? shortcuts.find(option => option.id === value)?.title ?? "选择视角";
  const term = query.trim().toLocaleLowerCase();
  const filtered = employees.filter(employee => `${employee.name} ${employee.department ?? ""}`.toLocaleLowerCase().includes(term));

  function close(restoreFocus = false) {
    setOpen(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus();
  }

  function select(next: string) {
    close(true);
    if (next !== value) onChange?.(next);
  }

  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 24);
      const top = Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 280));
      setPosition({ top, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), width, maxHeight: Math.min(560, window.innerHeight - top - 12) });
    }
    reposition();
    search.current?.focus();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const inputActive = event.target === search.current;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || (inputActive && ["Home", "End"].includes(event.key))) return;
    const options = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("[data-perspective-option]") ?? []);
    if (!options.length) return;
    event.preventDefault();
    const current = options.findIndex(option => option === document.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? (current + 1) % options.length : (current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length);
    options[index].focus();
  }

  return <>
    <button ref={trigger} type="button" className={`perspective-trigger${open ? " is-open" : ""}`} disabled={disabled} aria-label={`${title}，当前：${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? close() : setOpen(true)}>
      <span className="perspective-trigger-icon">{selected ? <Eye size={16} /> : value === "personal" ? <UserRound size={16} /> : <ShieldCheck size={16} />}</span>
      {caption && <span className="perspective-trigger-caption">{caption}</span>}
      <span className="perspective-trigger-label">{label}</span>
      {selected && readOnly && <span className="perspective-readonly">只读</span>}
      <ChevronDown size={14} className="perspective-chevron" />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-labelledby={`${id}-title`} className="perspective-panel" style={position} onKeyDown={navigate}>
      <div className="perspective-heading"><div><h2 id={`${id}-title`}>{title}</h2><p>{readOnly ? "选择你的工作视角" : "选择身份，切换对应的工作空间"}</p></div><button type="button" className="perspective-close" aria-label="关闭视角菜单" onClick={() => close(true)}><X size={16} /></button></div>
      <div className="perspective-shortcuts">
        {shortcuts.map(option => <button type="button" data-perspective-option key={option.id} className={`perspective-shortcut${value === option.id ? " is-selected" : ""}`} aria-pressed={value === option.id} onClick={() => select(option.id)}>{option.id === "personal" ? <UserRound size={18} /> : <ShieldCheck size={18} />}<span><strong>{option.title}</strong><small>{option.description}</small></span>{value === option.id && <Check size={14} />}</button>)}
      </div>
      <div className="perspective-search"><Search size={16} /><input ref={search} type="search" aria-label="搜索姓名或部门" placeholder="搜索姓名或部门…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="清空人员搜索" onClick={() => { setQuery(""); search.current?.focus(); }}><X size={14} /></button>}</div>
      <div className="perspective-section-heading"><span><Users size={14} />{readOnly ? "员工视角预览" : "员工身份"} <b>{term ? `${filtered.length} / ${employees.length}` : employees.length}</b></span>{readOnly && <span className="perspective-readonly"><Eye size={11} />只读</span>}</div>
      <div className="perspective-employee-list" aria-label="员工列表">
        {filtered.map(employee => <button type="button" data-perspective-option key={employee.userId} className={`perspective-employee${value === `employee:${employee.userId}` ? " is-selected" : ""}`} aria-pressed={value === `employee:${employee.userId}`} onClick={() => select(`employee:${employee.userId}`)}><span className="perspective-avatar" aria-hidden="true">{employee.name.slice(0, 1)}</span><span className="perspective-employee-info"><strong>{employee.name}</strong><small>{employee.department || "未分配部门"}</small></span>{value === `employee:${employee.userId}` && <Check size={16} />}</button>)}
        {!filtered.length && <div className="perspective-empty"><Search size={24} /><strong>{term ? "未找到匹配的员工" : "暂无可预览的员工"}</strong><span>{term ? "试试其他姓名或部门关键词" : "员工加入后将显示在这里"}</span></div>}
      </div>
      <div className="perspective-footer"><ShieldCheck size={13} /><span>{readOnly ? "预览仅供查看，不会更改员工数据" : "切换后按所选角色的权限操作"}</span></div>
    </div>, document.body)}
  </>;
}
