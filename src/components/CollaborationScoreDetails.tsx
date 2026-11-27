import {qualityDate} from './MonthlyQuality';
import {ResultEmpty, scoreText} from './PerformanceUI';

type ManagerProgress = {
 kind:string; submitted:number; expected:number; score:number|null;
 handoffRequired?:boolean;
};
type Assignment = {
 id:string; evaluee_user_id:string; evaluator_name:string;
 score:number|string|null; comment?:string; submitted_at?:string;
};
type Cycle = {
 id:string; label:string; submitted:number; expected:number;
 assignments:Assignment[];
};

const hasScore=(assignment:Assignment)=>{
 const value=assignment.score;
 return (typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=100;
};

export function ManagerScoreSummary({progress,peerOnly=false,saved}:{progress:ManagerProgress;peerOnly?:boolean;saved?:any}){
 if(peerOnly)return null;
 const validScore=(value:unknown)=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=100;
 if(saved&&['weighted_30_70','legacy'].includes(saved.scoring_rule)&&validScore(saved.result?.score)){
  const score=saved.result?.managerScore;
  return <p className="pf-notice">{validScore(score)?<>历史30%评分 · {scoreText(Number(score))} 分</>:'历史30%分项未保存'}</p>;
 }
 return <p className="pf-notice">{progress.kind==='boss'?'老板':'负责人'}评分（30%）：{progress.submitted}/{progress.expected} 已完成 · {scoreText(progress.score)} 分。{progress.handoffRequired?'原负责人已停用或身份缺失，请到「系统设置 → 月度评分交接」指定接任负责人。':!progress.expected&&'请先同步飞书部门负责人或直属上级。'}</p>;
}

export function CollaborationScoreDetails({cycles,employeeUserId,progress,peerOnly=false,saved}:{cycles:Cycle[];employeeUserId:string;progress:ManagerProgress;peerOnly?:boolean;saved?:any}){
 return <div className="pf-evidence-list">
  <ManagerScoreSummary progress={progress} peerOnly={peerOnly} saved={saved}/>
  <p className="pf-caption"><strong>同事互评（{peerOnly?'100%':'70%'}）</strong>按本月有效配评记录计算。老板不参与同事互评。</p>
  {cycles.map(cycle=>{
   const assignments=cycle.assignments.filter(assignment=>assignment.evaluee_user_id===employeeUserId);
   const submitted=assignments.filter(hasScore).length;
   const pending=[...new Set(assignments.filter(assignment=>!hasScore(assignment)).map(assignment=>assignment.evaluator_name))];
   return <article className="pf-evidence" key={cycle.id}>
    <div className="pf-evidence-head" style={{flexWrap:'wrap'}}><h4>{cycle.label}</h4><span className="pf-subtle-tag">该员工 {submitted} / {assignments.length} 已完成</span></div>
    <div className="pf-progress"><i style={{width:`${assignments.length?submitted/assignments.length*100:0}%`}}/></div>
    <p className="pf-caption">该员工待评：{assignments.length?pending.join('、')||'全部完成':'尚未配置同事评分人'}</p>
    <p className="pf-caption">全轮 {cycle.submitted} / {cycle.expected} 已完成</p>
    {assignments.map(assignment=><div className="pf-assignment" key={assignment.id}>
     <div><strong>{assignment.evaluator_name}</strong><span className="pf-tabular">{hasScore(assignment)?`同事互评已完成 · ${scoreText(Number(assignment.score))} 分`:'同事互评待评分'}</span></div>
     <p>{assignment.comment||'未填写评价'}</p>
     <small>{assignment.submitted_at?`提交于 ${qualityDate(assignment.submitted_at)}`:'此项尚无同事互评记录'}</small>
    </div>)}
   </article>;
  })}
  {!cycles.length&&<ResultEmpty title="本月尚无协作评分记录" description="发起月度评分后，可在这里查看任务进度与评价。"/>}
 </div>;
}
