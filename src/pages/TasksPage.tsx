import { useEffect, useMemo, useState } from "react";
import { PriorityBadge } from "../components/PriorityBadge";
import { appData, attentionQueueForInsights, insightsForPeriod, priorityRank } from "../lib/data";
import { truncate } from "../lib/format";
import {AppSelect} from '../components/AppSelect';

interface TasksPageProps {
  selectedPeriodId: string;
  taskCreated: boolean;
  onCreateTasks: () => void;
  readOnly?:boolean;
}

interface FeishuTaskRow {
  guid: string;
  candidateId?: string;
  summary: string;
  assigneeUserId?: string;
  dueDate?: string;
  url?: string;
  status: "created" | "updated" | "commented" | "completed" | "deleted" | string;
  createdAt?: string;
  updatedAt?: string;
}

export function TasksPage({ selectedPeriodId, taskCreated, onCreateTasks,readOnly=false }: TasksPageProps) {
  const [feishuTasks, setFeishuTasks] = useState<FeishuTaskRow[]>([]);
  const [taskLedgerState, setTaskLedgerState] = useState<"loading" | "ready" | "error">("loading");
  const periodInsights = insightsForPeriod(selectedPeriodId);
  const periodAttentionQueue = attentionQueueForInsights(periodInsights);
  const [enabled,setEnabled]=useState(false),[people,setPeople]=useState<{userId:string;name:string;department:string}[]>([]),[selected,setSelected]=useState<number[]>([]),[owners,setOwners]=useState<Record<number,string>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{setSelected([]);setOwners({});setMessage('');},[selectedPeriodId]);

  useEffect(() => {
    let ignore = false;
    async function loadTasks() {
      setTaskLedgerState("loading");
      try {
        const response = await fetch("/api/tasks");
        if (!response.ok) throw new Error("load_tasks_failed");
        const result = await response.json();
        if (!ignore) {
          setFeishuTasks(Array.isArray(result.tasks) ? result.tasks : []);
          setEnabled(result.taskCreateEnabled===true);setPeople(result.employees||[]);
          setTaskLedgerState("ready");
        }
      } catch {
        if (!ignore) setTaskLedgerState("error");
      }
    }
    loadTasks();
    const timer = window.setInterval(loadTasks, 30000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [taskCreated,revision]);

  const kimiEmployeeTasks = periodInsights.employeeInsights.flatMap((insight) => insight.taskCandidates);
  const employeeTaskRows = kimiEmployeeTasks.length > 0
    ? kimiEmployeeTasks.map((task) => ({
        priority: task.priority,
        title: task.title,
        description: task.description,
        dueDate: task.dueDate,
        theme: task.contextNeed || "AI 拆解任务",
        person: task.source || task.owner,
        lane: "同事闭环",
        evidence: task.evidence,
        ownerUserId:task.ownerUserId||'',
      }))
    : [];
  const allTasks = [
    ...periodAttentionQueue.map((task) => ({ ...task,ownerUserId:task.ownerUserId||'', lane: "老板关注", person: task.source })),
    ...employeeTaskRows,
  ].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  const createText = busy?'正在创建…':`创建选中的飞书任务（${selected.length}）`;
  async function createSelected(){
    setBusy(true);setMessage('');try{
      const candidates=selected.map(index=>{const t=allTasks[index],ownerUserId=owners[index]||t.ownerUserId;if(!ownerUserId)throw Error('请为每条选中任务选择负责人');return {periodId:selectedPeriodId,title:t.title,description:t.description,priority:t.priority,ownerUserId,evidence:t.evidence,dueDate:t.dueDate,useDueDate:Boolean(t.dueDate)};});
      const r=await fetch('/api/tasks/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({candidates})}),j=await r.json();if(!r.ok)throw Error(j.error==='task_creation_disabled'?'任务创建尚未开启，请在系统设置接通飞书任务':'创建未完成，请检查飞书权限和负责人');
      if(j.results.some((v:{error?:string})=>v.error==='feishu_reauthorization_required')){setMessage('飞书授权已到期，请重新授权后再创建；已成功的任务会保留。');setRevision(v=>v+1);return;}
      const saved=j.results.filter((v:{ok:boolean;dryRun?:boolean})=>v.ok&&!v.dryRun).length,failed=j.results.length-saved;setMessage(`已创建或确认已有任务 ${saved} 个${failed?`，${failed} 个未成功，请检查权限后重试`:''}。`);if(saved)onCreateTasks();if(!failed)setSelected([]);setRevision(v=>v+1);
    }catch(e){setMessage(e instanceof Error?e.message:'创建失败');}finally{setBusy(false);}
  }
  const taskStats = useMemo(() => {
    const completed = feishuTasks.filter((task) => task.status === "completed").length;
    const active = feishuTasks.filter((task) => !["completed", "deleted"].includes(task.status)).length;
    const commented = feishuTasks.filter((task) => task.status === "commented").length;
    return { active, completed, commented };
  }, [feishuTasks]);

  return (
    <div className="page-stack">
      <section className="panel full-panel">
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Action System</span>
            <h2>周报问题到飞书任务</h2>
          </div>
          <button className="primary-button" type="button" disabled={busy||readOnly||!enabled||!selected.length||selected.length>50} onClick={()=>void createSelected()}>
            {createText}
          </button>
        </div>
        {!enabled&&<p className="pf-notice">飞书任务创建尚未开启。可先回看候选，在「系统设置 → 飞书与数据集成」接通后再创建，不会模拟成功。</p>}{message&&<p role="status" className="pf-notice">{message}{message.includes('飞书授权已到期')&&<> <a href="/auth/login">重新授权飞书</a></>}</p>}
        <div className="task-board">
          {["老板关注", "同事闭环"].map((lane) => (
            <div className="task-column" key={lane}>
              <h3>{lane}</h3>
              {allTasks.map((task,index)=>({...task,index})).filter((task) => task.lane === lane).map((task) => (
                <div className="task-card" key={`${lane}-${task.title}`}>
                  <div className="task-card-top">
                    <PriorityBadge priority={task.priority} />
                    <span>{task.person}</span>
                  </div>
                  <strong>{task.title}</strong>
                  <label><input type="checkbox" aria-label={`选择任务${task.title}`} disabled={busy||readOnly} checked={selected.includes(task.index)} onChange={()=>setSelected(xs=>xs.includes(task.index)?xs.filter(v=>v!==task.index):[...xs,task.index])}/>选择创建</label>
                  <AppSelect aria-label={`任务负责人${task.title}`} value={owners[task.index]||task.ownerUserId} disabled={busy||readOnly} placeholder="请选择负责人" searchable onValueChange={value=>setOwners(xs=>({...xs,[task.index]:value}))}>{people.map(e=><option key={e.userId} value={e.userId}>{e.name} · {e.department}</option>)}</AppSelect>
                  <p>{truncate(task.description, 120)}</p>
                  <small>{task.dueDate || "待定截止日"} · {task.theme}</small>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="panel full-panel">
        <div className="panel-heading compact">
          <div>
            <span className="section-label">Task Ledger</span>
            <h2>已创建飞书任务闭环台账</h2>
          </div>
          <span className="task-ledger-state">
            {taskLedgerState === "loading" ? "同步中" : taskLedgerState === "error" ? "同步失败" : `进行中 ${taskStats.active} · 已完成 ${taskStats.completed}`}
          </span>
        </div>
        <div className="task-ledger-hint">
          <span>这里会收拢从个人周报页创建出来的真实飞书任务。任务创建是第一次闭环；只有飞书任务完成、评论推进和状态回传后，问题才算真正闭环结束。</span>
          <strong>当前查看周期：{selectedPeriodId}</strong>
          {taskStats.commented ? <strong>{taskStats.commented} 个任务最近有评论事件</strong> : null}
        </div>
        <div className="task-ledger-list">
          {feishuTasks.length === 0 ? (
            <div className="task-ledger-empty">还没有读取到已创建任务。创建成功后，这里会显示飞书任务 GUID、状态和链接。</div>
          ) : (
            feishuTasks.map((task) => (
              <div className="task-ledger-row" key={task.guid}>
                <div>
                  <span className={`task-status status-${task.status}`}>{statusLabel(task.status)}</span>
                  <strong>{task.summary}</strong>
                  <p>{task.assigneeUserId ? `负责人 user_id：${task.assigneeUserId}` : "负责人待解析"} · {task.updatedAt || task.createdAt || "等待回传"}</p>
                </div>
                {task.url ? (
                  <a href={task.url} target="_blank" rel="noreferrer">打开飞书任务</a>
                ) : (
                  <span className="task-guid">{task.guid}</span>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function statusLabel(status: FeishuTaskRow["status"]) {
  if (status === "completed") return "已完成";
  if (status === "commented") return "有评论";
  if (status === "updated") return "有进展";
  if (status === "deleted") return "已删除";
  return "已创建";
}
