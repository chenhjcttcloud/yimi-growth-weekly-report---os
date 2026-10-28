import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createPerformance } from '../server/performance.mjs';
if (process.env.AUTH_MODE !== 'mock') throw Error('Development fixtures require AUTH_MODE=mock');
const arg = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key)+1] : fallback;
const output = path.resolve(arg('--output', 'outputs/development-data'));
const seed = Number(arg('--seed', Date.now() % 2147483647));
try { await access(output); throw Error('Output already exists; use a new directory to preserve previous development data'); } catch(e) { if(e.code!=='ENOENT') throw e; }
await mkdir(output,{recursive:true});
let state=seed>>>0;
const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
const integer=(a,b)=>Math.floor(random()*(b-a+1))+a;
const pick=xs=>xs[integer(0,xs.length-1)];
const round=n=>Math.round(n*10)/10;
const avg=xs=>xs.length?round(xs.reduce((a,b)=>a+b,0)/xs.length):null;
const date=s=>new Date(s+'T00:00:00Z');
const iso=d=>d.toISOString().slice(0,10);
const now=new Date();
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now);
const month=today.slice(0,7);
const first=date(month+'-01');first.setUTCMonth(first.getUTCMonth()-5);
const employees=[['林清','产品部'],['周远','运营部'],['苏禾','产品部'],['陈星','产品部'],['许言','运营部'],['顾南','运营部'],['沈舟','研发部'],['陆遥','研发部'],['程一','研发部'],['唐宁','客户成功部'],['叶青','客户成功部'],['江屿','客户成功部']].map(([name,department],i)=>({name,department,userId:`demo_user_id_${String(i+1).padStart(3,'0')}`,email:`demo${i+1}@example.invalid`,base:integer(72,89)}));
const work={
 '产品部':{project:'客户需求验证',result:'完成用户访谈并交付需求优先级清单',problem:'跨部门评审输入口径不统一，造成重复沟通',plan:'联合运营完成评审前置清单，并在新需求中验证',reflection:'先确认可验证的用户价值，再讨论实现方式，能减少无效返工'},
 '运营部':{project:'用户分层运营',result:'完成分层触达实验，整理渠道转化数据',problem:'低活跃用户样本不足，需要客户成功团队协助补充',plan:'补充低活跃用户访谈，形成每周复购运营检查表',reflection:'不能只看触达数量，需要结合留存与有效反馈检验策略'},
 '研发部':{project:'服务稳定性优化',result:'完成核心接口优化与回归验证，更新发布检查清单',problem:'需求验收标准不完整，影响联调与发布节奏',plan:'与产品明确验收标准，补齐关键链路自动化验证',reflection:'将高频故障归因沉淀成检查项，比临时修复更能减少重复问题'},
 '客户成功部':{project:'客户问题闭环',result:'完成客户问题回访，更新知识库与问题跟踪台账',problem:'升级处理责任边界不清，跨团队问题仍需明确负责人',plan:'联合研发复核未解决问题，输出客户回访闭环清单',reflection:'以客户是否确认解决为终点，避免把转交问题误认为闭环'},
};
const periods=[];
for(let d=new Date(first);iso(d)<=today;d.setUTCDate(d.getUTCDate()+1)) if(d.getUTCDay()===5 && Date.parse(iso(d)+'T20:00:00+08:00')<=now.getTime()){
 const start=new Date(d);start.setUTCDate(start.getUTCDate()-4);
 const id=`demo-${iso(d)}`,label=`${d.getUTCMonth()+1}月第${Math.ceil(d.getUTCDate()/7)}周`;
 periods.push({id,label,range:`${start.getUTCMonth()+1}/${start.getUTCDate()}-${d.getUTCMonth()+1}/${d.getUTCDate()}`,start:iso(start),end:iso(d),submitted_count:0,exempt_people:[],status:'历史'});
}
const weekly=[];
for(const period of periods) for(const [index,e] of employees.entries()){
 const w=work[e.department],chance=random();
 const status=chance<.07?'未交':chance<.25?'迟交':'准时';
 const scores=[0,1,2,3].map(()=>Math.min(98,Math.max(55,e.base+integer(-8,8)+Math.floor(periods.indexOf(period)/6))));
 const total=round(scores[0]*.3+scores[1]*.25+scores[2]*.25+scores[3]*.2);
 const submittedAt=status==='未交'?'':`${period.end} ${status==='迟交'?`${integer(21,23)}:15:00`:`${integer(15,19)}:${pick(['10','25','40'])}:00`}`;
 const missingModule=status!=='未交'&&index===10&&period===periods.at(-1);
 weekly.push({'姓名':e.name,'部门':e.department,'周期ID':period.id,'周次':`${period.label} ${period.range}`,'开始日期':period.start,'结束日期':period.end,'提交时间':submittedAt,'源记录ID':`${period.id}-${e.userId}`,'状态':status,'总分':status==='未交'?0:total,'等级':total>=90?'A':total>=85?'A-':total>=80?'B+':'B','成果分':scores[0],'问题分':scores[1],'计划分':scores[2],'复盘分':scores[3],'准时分':status==='准时'?100:0,'数字个数':integer(3,14),'字数':integer(380,980),'本周成果摘要':status==='未交'?'':`【虚构开发数据】${w.result}，本周完成 ${integer(3,9)} 项，关键指标改善 ${integer(3,18)}%。`,'问题摘要':status==='未交'?'':`${w.problem}，目前仍有 ${integer(1,4)} 项待协调。`,'下周计划摘要':status==='未交'?'':`${w.plan}，目标在下周五前完成 ${integer(2,5)} 项验证。`,'思考与复盘摘要':status==='未交'||missingModule?'':w.reflection,'评论数':integer(0,5),'点赞数':integer(0,8),'已读数':integer(3,12),'未读数':integer(0,3),'相关文件':'虚构项目记录，仅供开发演示'});
 if(status!=='未交') period.submitted_count++;
}
const current=periods.at(-1);current.status='当前';
const summary=employees.map(e=>{const reports=weekly.filter(r=>r['姓名']===e.name&&r['状态']!=='未交');const score=avg(reports.map(r=>r['总分']));return {'姓名':e.name,'部门':e.department,user_id:e.userId,'企业邮箱':e.email,'周报数':reports.length,'准时次数':reports.filter(r=>r['状态']==='准时').length,'迟交次数':reports.filter(r=>r['状态']==='迟交').length,'平均分':score,'等级':score>=88?'A':score>=83?'A-':'B+','自动等级':score>=88?'A':'B+','趋势':integer(-3,6),'弱问题周数':integer(0,3),'人工校准说明':'虚构开发数据，非真实绩效记录','一句话成长判断':`${work[e.department].project}逐步形成稳定节奏，继续关注跨周证据与协作闭环。`};});
const taskSpecs=[['P0',6,'核心服务发布风险','核心服务告警仍未完成根因验证，需要确认发布窗口与回滚负责人。','研发部,产品部'],['P1',0,'统一需求评审输入','产品与研发验收口径不一致，需要形成共同的评审前置清单。','产品部,研发部'],['P1',1,'补齐低活跃用户反馈','运营触达样本不足，需要客户成功部门协助安排访谈。','运营部,客户成功部'],['P1',9,'明确客户升级处理责任','跨部门客户问题缺少明确负责人，需协调关闭长期未结问题。','客户成功部,研发部'],['P2',3,'沉淀需求验证模板','将本月已验证的方法整理为可复用的团队模板。','产品部']];
const due=iso(new Date(Date.parse(current.end+'T00:00:00Z')+7*86400000));
const queue=taskSpecs.map(([priority,i,title,description,department],n)=>({priority,source:employees[i].name,department,theme:title,title,whyBoss:description,owner:employees[i].name,ownerUserId:employees[i].userId,dueDate:due,evidence:`【虚构开发数据】${description}`}));
const rawTasks=queue.map(q=>({'优先级':q.priority,'来源人员':q.source,'部门':q.department,'主题':q.theme,'审核状态':'待管理者确认','建议任务标题':q.title,'建议任务描述':q.whyBoss,'建议负责人':q.owner,'建议负责人user_id':q.ownerUserId,'截止日期':due,'证据':q.evidence}));
const prototype={meta:{source_xlsx:'RANDOM_DEVELOPMENT_FIXTURE',generated_on:today,company_chat:{name:'虚构开发公司 · 不发送消息',chat_id:'demo_chat_id'},people_count:employees.length,weekly_record_count:weekly.length,class_distribution:{A:summary.filter(e=>e['等级']==='A').length,'A-':summary.filter(e=>e['等级']==='A-').length,'B+':summary.filter(e=>e['等级']==='B+').length},dept_average_scores:Object.fromEntries(Object.keys(work).map(dept=>[dept,avg(summary.filter(e=>e['部门']===dept).map(e=>e['平均分']))])),current_week_id:current.id,current_week_label:current.label,current_week_range:current.range,current_week_start:current.start,current_week_end:current.end,submitted_count:current.submitted_count,exempt_count:0,exempt_people:[],periods,seed},employee_summary:summary,weekly_scores:weekly,boss_tasks:rawTasks,employee_tasks:rawTasks,feedback_drafts:[],group_message_draft:'【虚构开发数据】本周优先完成发布风险核实、需求验收口径统一与客户升级问题闭环。'};
const insights={meta:{provider:'development-fixture',model:'seeded-random-demo',generatedAt:now.toISOString(),source:'RANDOM_DEVELOPMENT_FIXTURE'},executiveSummary:[`【虚构开发数据】${employees.length} 位员工、4 个部门，本周已提交 ${current.submitted_count} 份周报。`,'核心服务发布风险需要优先确认，需求验收与客户升级问题需要跨部门协调。','历史月度结果已模拟确认，当前月保留待审核与未完成评分，供验证不同状态。'],collectiveFocus:queue.slice(0,3).map(q=>({title:q.title,detail:q.whyBoss})),companyMessageDraft:prototype.group_message_draft,attentionQueue:queue,mustReadReports:queue.slice(0,4).map(q=>({name:q.source,department:q.department.split(',')[0],reason:q.whyBoss,focus:q.title,evidence:q.evidence})),themes:queue.map(q=>({label:q.title,value:integer(3,9),severity:q.priority,summary:q.whyBoss,detail:q.whyBoss,quotes:[{author:q.source,department:q.department,week:current.label,text:q.evidence}],nextStep:q.title})),employeeInsights:employees.map(e=>({name:e.name,coachSummary:'【虚构开发数据】建议继续用事实与可验证结果回应上周计划。',coachQuestions:[],taskCandidates:[]})),feishuTaskPlan:{tasklistName:'虚构开发任务池',requiredScopes:[],creationMode:'review_then_create'}};
const months=[...new Set(periods.map(p=>p.end.slice(0,7)))];
const cycles=[],assignments=[],responses=[];
for(const m of months){
 const end=new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5)),0));
 const cid=`generated-${m}`,isCurrent=m===month;
 const launch=isCurrent?new Date(now.getTime()-86400000).toISOString():`${m}-20T10:00:00+08:00`;
 cycles.push({id:cid,label:`${m} 协作评分 · 虚构开发`,mode:'monthly',startDate:m+'-01',endDate:iso(end),launchAt:launch,dueAt:isCurrent?new Date(now.getTime()+86400000).toISOString():`${m}-25T20:00:00+08:00`,followupAfterAt:isCurrent?now.toISOString():`${m}-24T10:00:00+08:00`,historicalWeight:.3,currentWeight:.7,status:isCurrent?'open':'closed',totalEmployees:employees.length,totalEvaluees:employees.length});
 for(const [i,e] of employees.entries()) for(let j=1;j<=3;j++){
  const evaluator=employees[(i+j*3)%employees.length],id=`${cid}-${e.userId}-${j}`;
  assignments.push({id,cycleId:cid,evaluee:e.name,evaluator:evaluator.name,evalueeUserId:e.userId,evaluatorUserId:evaluator.userId});
  if(isCurrent && (i+j)%4===0)continue;
  responses.push({id:`response-${id}`,assignmentId:id,cycleId:cid,evaluee:e.name,evaluator:evaluator.name,score:integer(Math.max(65,e.base-4),Math.min(98,e.base+12)),comment:pick(['【虚构评价】沟通清晰，能主动同步风险，并协助完成交付。','【虚构评价】对协作需求响应及时，建议进一步明确验收标准。','【虚构评价】能够提供具体证据，推动跨团队问题闭环。']),submittedAt:isCurrent?new Date(now.getTime()-3600000).toISOString():`${m}-24T16:00:00+08:00`});
 }
}
for(const c of cycles){const all=assignments.filter(a=>a.cycleId===c.id),done=responses.filter(r=>r.cycleId===c.id);c.totalAssignments=all.length;c.totalResponses=done.length;c.progressPct=round(done.length/all.length*100);c.averageScore=avg(done.map(r=>r.score));}
const latest=cycles.at(-1);
const results=employees.map(e=>{const rs=responses.filter(r=>r.cycleId===latest.id&&r.evaluee===e.name);return {name:e.name,expected:3,submitted:rs.length,completionRate:round(rs.length/3*100),averageScore:avg(rs.map(r=>r.score)),previousScore:null,rollingScore:avg(rs.map(r=>r.score)),minScore:Math.min(...rs.map(r=>r.score)),maxScore:Math.max(...rs.map(r=>r.score)),evaluators:rs.map(r=>r.evaluator)};});
const data={prototypeData:prototype,kimiInsights:insights,kimiInsightsByPeriod:{[current.id]:insights},monthlyMeetingInsights:{records:[]},scoring360:{meta:{source:{type:'RANDOM_DEVELOPMENT_FIXTURE'},importedAt:now.toISOString(),seed},cycles:[...cycles].reverse(),employees:employees.map(e=>e.name),assignments,responses,results}};
for(const [name,value]of Object.entries(data))await writeFile(path.join(output,`${name}.json`),JSON.stringify(value,null,2)+'\n');
const db=path.join(output,'development.sqlite');
const sql=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
function exec(statement){const result=spawnSync('sqlite3',[db],{input:statement,encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);}
async function query(statement){const result=spawnSync('sqlite3',['-json',db,statement],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);return JSON.parse(result.stdout||'[]').map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v==null?'':String(v)])));}
exec(await readFile('db/schema.sql','utf8'));
const statements=['BEGIN;'];
for(const e of employees)statements.push(`INSERT INTO employees(user_id,name,department,email) VALUES(${sql(e.userId)},${sql(e.name)},${sql(e.department)},${sql(e.email)});`);
for(const c of cycles)statements.push(`INSERT INTO scoring360_cycles(id,label,mode,start_date,end_date,launch_at,due_at,followup_after_at,status,total_employees,total_evaluees) VALUES(${[c.id,c.label,c.mode,c.startDate,c.endDate,c.launchAt,c.dueAt,c.followupAfterAt,c.status,12,12].map(sql).join(',')});`);
for(const a of assignments)statements.push(`INSERT INTO scoring360_assignments(id,cycle_id,evaluee_name,evaluator_name,evaluee_user_id,evaluator_user_id) VALUES(${[a.id,a.cycleId,a.evaluee,a.evaluator,a.evalueeUserId,a.evaluatorUserId].map(sql).join(',')});`);
for(const r of responses)statements.push(`INSERT INTO scoring360_responses(id,assignment_id,cycle_id,evaluee_name,evaluator_name,score,comment,submitted_at) VALUES(${[r.id,r.assignmentId,r.cycleId,r.evaluee,r.evaluator,r.score,r.comment,r.submittedAt].map(sql).join(',')});`);
for(const [i,q] of queue.entries())statements.push(`INSERT INTO feishu_tasks(guid,summary,assignee_user_id,due_date,status,raw_response_json) VALUES(${[`development-task-${i}`,q.title,q.ownerUserId,q.dueDate,i===4?'completed':'open',JSON.stringify({source:'RANDOM_DEVELOPMENT_FIXTURE'})].map(sql).join(',')});`);
statements.push('COMMIT;');exec(statements.join('\n'));
const performance=createPerformance({query,exec:async s=>exec(s),sql,readData:name=>data[name]});
const view=await performance.overview();
let finalCount=0;
const confirmedSql=['BEGIN;'];
for(const row of view.monthly){
 const index=employees.findIndex(e=>e.name===row.name),mi=months.indexOf(row.month),historical=row.month!==month;
 for(const kind of ['quality','timeliness','collaboration']){
  if(!historical && (index>=4||kind==='collaboration'))continue;
  if(historical && mi===months.length-2 && kind==='collaboration'&&index>=6)continue;
  if(kind==='collaboration'&&!row.collaborationComplete)throw Error('Fixture collaboration must be complete before confirmation');
  const result=kind==='quality'?{score:round(Math.min(98,Math.max(0,row.qualityCandidate+integer(-2,2))))}:kind==='collaboration'?{score:row.collaborationCandidate}:row.timeliness;
  const snapshot={...row,reviewNote:'【虚构开发数据】模拟人工审核，供页面和流程验证，不代表真实绩效。',legitimateReason:row.timeliness.late?'【模拟正当理由】跨团队发布支持，已核实说明。':'',qualityAdjustment:kind==='quality'?{candidate:row.qualityCandidate,final:result.score,reason:'【模拟调整】结合交付证据人工复核。'}:null,deduction:0,reviewer:'开发模拟确认 · Demo HR',reviewerUserId:'mock_manager',fixtureSeed:seed};
  const confirmedAt=historical?`${row.month}-${String(new Date(Date.UTC(Number(row.month.slice(0,4)),Number(row.month.slice(5)),0)).getUTCDate())} 10:00:00`:new Date(now.getTime()-3600000).toISOString();
  confirmedSql.push(`INSERT INTO performance_results(month,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES(${[row.month,row.name,kind,JSON.stringify(result),JSON.stringify(snapshot),'开发模拟确认 · Demo HR',confirmedAt].map(sql).join(',')});`);finalCount++;
 }
}
confirmedSql.push('COMMIT;');exec(confirmedSql.join('\n'));
const check=await query('PRAGMA integrity_check;');if(check[0]?.integrity_check!=='ok')throw Error('Database integrity failed');
const report={seed,output,db,source:'RANDOM_DEVELOPMENT_FIXTURE',people:employees.length,departments:4,months,weeklyReports:weekly.length,onTime:weekly.filter(r=>r['状态']==='准时').length,late:weekly.filter(r=>r['状态']==='迟交').length,missing:weekly.filter(r=>r['状态']==='未交').length,scoringTasks:assignments.length,scoringResponses:responses.length,confirmedResults:finalCount,currentScoringProgress:latest.progressPct};
await writeFile(path.join(output,'manifest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
