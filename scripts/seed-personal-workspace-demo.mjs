// Enrich only the explicitly generated mock dataset, never real employee data.
import { readFile,writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
if(process.env.AUTH_MODE!=='mock')throw Error('Mock mode required');
const dir=path.resolve(process.env.APP_DATA_DIR||'src/data');
const raw=JSON.parse(await readFile(path.join(dir,'prototypeData.json'),'utf8'));
if(raw.meta?.source_xlsx!=='RANDOM_DEVELOPMENT_FIXTURE')throw Error('Generated development fixture required');
const insightsPath=path.join(dir,'kimiInsightsByPeriod.json');
const original=await readFile(insightsPath,'utf8');
const insights=JSON.parse(original);
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,32);
const sql=s=>"'"+String(s).replaceAll("'","''")+"'";
const statements=['BEGIN;'];
let analyses=0,comments=0;
for(const period of raw.meta.periods){
 const periodRows=raw.weekly_scores.filter(r=>r['周期ID']===period.id&&r['状态']!=='未交');
 const existing=insights[period.id]||{};
 insights[period.id]={...existing,meta:{provider:'development-fixture',model:'scripted-demo-analysis',generatedAt:new Date().toISOString(),source:'RANDOM_DEVELOPMENT_FIXTURE'},executiveSummary:existing.executiveSummary||[`【虚构开发数据】${period.label}已收到 ${periodRows.length} 份周报，供历史周期回看。`],employeeInsights:[]};
 for(const r of periodRows){
  const employee=raw.employee_summary.find(e=>e['姓名']===r['姓名']);
  if(!employee)continue;
  const result=r['本周成果摘要']||'尚无成果记录',problem=r['问题摘要']||'本周未说明具体卡点',plan=r['下周计划摘要']||'建议补充明确的下一步计划',reflection=r['思考与复盘摘要']||'本周尚缺复盘内容，需要补充原因与改进方法';
  const previous=raw.weekly_scores.filter(p=>p['姓名']===r['姓名']&&p['结束日期']<r['结束日期']&&p['状态']!=='未交').sort((a,b)=>a['结束日期'].localeCompare(b['结束日期'])).at(-1);
  insights[period.id].employeeInsights.push({name:employee['姓名'],coachSummary:`【虚构开发演示分析，非实时 AI】${employee['姓名']}，本周主要进展是：${result}\n\n问题与挑战：${problem} 这类问题需要明确责任人与验证节点，避免只记录阻塞而没有后续行动。\n\n下周建议：${plan} 请把计划拆成首个动作、交付物和验收口径，再核实所需的跨部门支持。\n\n复盘观察：${reflection} ${previous?'对照上一期计划，建议逐项列出本周的回应证据；尚未交付的内容应说明原因与新的确认时间。':'当前还没有上期记录，先建立一个可回看的承诺基线。'}`,coachQuestions:[`针对「${problem}」，有哪些已验证的事实，哪些仍是推测？`,previous?`上期计划「${previous['下周计划摘要']}」的哪些动作已在本周完成？还缺什么证据？`:'下周准备先完成哪一项可验证行动？',`为了完成「${plan}」，你需要谁提供什么支持，准备何时验收？`],taskCandidates:[]});
  const thread=`personal-${hash(`${employee.user_id}:${period.id}`)}`;
  for(const [index,author,body] of [[0,'示例主管',`【虚构示例点评】已看到本周成果。请把「${plan}」补充为明确的交付物与验证时间，便于下周对照。`],[1,'示例协作者',`【虚构示例反馈】关于「${problem}」，建议先统一输入材料和责任边界，再约定一次验收。`]]){
   const id=`demo-comment-${hash(thread+':'+index)}`;
   statements.push(`INSERT OR IGNORE INTO comments(id,target_type,target_id,author_user_id,author_name,body,visibility,created_at) VALUES(${sql(id)},'personal_weekly_report',${sql(thread)},${sql('demo-feedback-'+index)},${sql(author)},${sql(body)},'self_manager',${sql(r['结束日期']+' 12:00:00')});`);comments++;
  }
  for(let i=0;i<3;i++)statements.push(`INSERT OR IGNORE INTO reactions(id,target_type,target_id,actor_user_id,reaction_type) VALUES(${sql('demo-like-'+hash(thread+':'+i))},'personal_weekly_report',${sql(thread)},${sql('demo-colleague-'+i)},'like');`);
  analyses++;
 }
}
statements.push('COMMIT;');
const result=spawnSync('sqlite3',[process.env.WEEKLY_REPORT_DB_PATH],{input:statements.join('\n'),encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr);
try{await readFile(insightsPath+'.before-personal-workspace');}catch{await writeFile(insightsPath+'.before-personal-workspace',original);}
await writeFile(insightsPath,JSON.stringify(insights,null,2)+'\n');
console.log(JSON.stringify({source:'RANDOM_DEVELOPMENT_FIXTURE',weeklyDemoAnalyses:analyses,exampleComments:comments,exampleLikes:analyses*3,months:6},null,2));
