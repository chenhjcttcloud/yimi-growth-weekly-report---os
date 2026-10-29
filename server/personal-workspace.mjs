import { createHash, randomUUID } from 'node:crypto';
import {weeklyReportSchedule} from './weekly-report-schedule.mjs';
import {employedOn} from './employee-lifecycle.mjs';

// Personal workspace exposes a strict allowlist of the signed-in employee's data.
export function createPersonalWorkspace({ performance, readData, query, exec, sql, config, askAi, createTask, policyFor, calendar=()=>({}) }) {
  const formatDate = d => d.toISOString().slice(0,10);
  const short = (text,n=90) => String(text||'').trim().slice(0,n);
  const hash = value => createHash('sha256').update(value).digest('hex').slice(0,32);
  const text = (content,cn,en) => String(content?.[cn] || content?.[en] || '');
  const keyFor = (user,weekId) => `personal-${hash(`${user.userId}:${weekId}`)}`;
  const validMonth = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

  async function weeksFor(user,month,reportContext) {
    if(!validMonth(month)) throw Error('invalid_month');
    const shared=reportContext||await performance.createReportContext?.(user.userId);
    if(shared)performance.assertReportContext(shared,user.userId);
    const raw=shared?.data||readData('prototypeData');
    const policy=shared?await shared.readPolicy(month):policyFor?await policyFor(month):{deadlineTime:'20:00'};
    const mine=(shared?.reports||await performance.reports({employeeUserId:user.userId})).filter(r=>r.employeeUserId===user.userId).sort((a,b)=>String(a.end).localeCompare(String(b.end)));
    let employee=(raw.employee_summary||[]).find(e=>e.user_id===user.userId);
    if(!employee){const e=(await query(`SELECT name,department FROM employees WHERE user_id=${sql(user.userId)} AND is_active=1;`))[0];if(e)employee={'姓名':e.name,'部门':e.department,user_id:user.userId};}
    // No name-only fallback: a non-directory user must never inherit somebody else's reports.
    if(!employee) return {weeks:[],mine:[],employee:null};
    const map=new Map((raw.meta?.periods||[]).map(p=>[p.end,{id:p.id,label:p.label,start:p.start,end:p.end,exempt:(p.exempt_people||[]).includes(user.name)}]));
    for(const report of mine) if(!map.has(report.end)) map.set(report.end,{id:report.content?.['周期ID']||`period-${report.end}`,label:report.content?.['周次']||`${report.start} — ${report.end}`,start:report.start,end:report.end});
    const year=Number(month.slice(0,4)),m=Number(month.slice(5));
    const now=new Date();
    const employment=await query(`SELECT * FROM employee_employment_periods WHERE employee_user_id=${sql(user.userId)};`);
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now);
    const coverageStart=raw.meta?.collectionStartDate||[...map.values()].map(p=>p.start).filter(Boolean).sort()[0]||new Date(now.getTime()-((new Date(today+'T00:00:00Z').getUTCDay()||7)-1)*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
    if(month>today.slice(0,7)) throw Error('future_month');
    for(let d=new Date(Date.UTC(year,m-1,1));d.getUTCMonth()===m-1;d.setUTCDate(d.getUTCDate()+1)) {
      if(d.getUTCDay()!==5) continue;
      const end=formatDate(d);
      if([...map.values()].some(p=>p.start<=end&&p.end>=end)) continue;
      const start=new Date(d);start.setUTCDate(start.getUTCDate()-4);
      map.set(end,{id:`period-${end}`,label:`${m}月第${Math.ceil(d.getUTCDate()/7)}周`,start:formatDate(start),end});
    }
    const weeks=[...map.values()].filter(p=>String(p.end).startsWith(month)).sort((a,b)=>a.end.localeCompare(b.end)).map(p=>{
      const report=mine.find(r=>r.end===p.end),c=report?.content||{};
      const submitted=Boolean(report?.submitted);
      const schedule=weeklyReportSchedule(p.end,calendar(),policy.deadlineTime),dueAt=schedule.dueAt,future=Date.parse(dueAt||'')>Date.now();
      const outsideEmployment=employment.length>0&&!employedOn(employment,schedule.deadlineDate||p.end);
      const status=outsideEmployment?'不在职':p.exempt||schedule.exempt?'免交':schedule.calendarPending?'等待日历':!report&&p.start<coverageStart?'未收集':submitted?(report.timestampUnknown?'待核实时间':report.late?'迟交':'准时'):future?'未到期':'未交';
      const facts={results:text(c,'本周成果摘要','results'),problems:text(c,'问题摘要','problems'),plan:text(c,'下周计划摘要','nextPlan'),reflection:text(c,'思考与复盘摘要','reflection')};
      const modules=[['成果','成果分'],['问题','问题分'],['计划','计划分'],['复盘','复盘分']];
      const radar=modules.every(([,key])=>c[key]!=null&&String(c[key]).trim()!==''&&Number.isFinite(Number(c[key]))&&Number(c[key])>=0&&Number(c[key])<=100)?modules.map(([label,key])=>({label,value:Number(c[key])})):[];
      const prev=mine.filter(r=>r.end<p.end&&r.submitted).at(-1);
      const previousPlan=prev?text(prev.content,'下周计划摘要','nextPlan'):'';
      const immediate=prev && (Date.parse(p.end)-Date.parse(prev.end))<=10*86400000;
      return {id:p.id,label:p.label,start:p.start,end:p.end,dueAt,schedule,status,submitted,reportId:report?.id||'',submittedAt:submitted?report.submittedAt:'',facts,qualityReference:submitted?report.candidate:null,radar:submitted?radar:[],closure:{previousWeek:prev?.end||'',previousPlan:previousPlan||'暂无上一期已提交的计划记录',evidence:submitted?facts.results:'本周尚无已提交周报',status:!submitted?'等待本周周报':!prev?'缺少上期记录':immediate?'待核实闭环证据':'上期未交或存在跨周间隔',summary:submitted&&prev?'请对照上期承诺与本周成果核实闭环；文字关联仅供回看，不代表任务已经完成。':'补齐周报后，可对照上期计划检查执行情况。'}};
    });
    return {weeks,mine,employee};
  }
  async function context(user,month,weekId) {
    const result=await weeksFor(user,month);
    const week=result.weeks.find(w=>w.id===weekId);
    if(!week) throw Error('week_not_found');
    return {...result,week};
  }
  function baseTasks(user,week,insights) {
    if(!week.submitted)return [];
    const source=(insights===undefined?readData('kimiInsightsByPeriod'):insights)?.[week.id];
    const insight=source?.employeeInsights?.find(e=>e.userId===user.userId);
    const stored=Array.isArray(insight?.taskCandidates)?insight.taskCandidates:[];
    const nextDate=new Date(`${week.end}T00:00:00Z`);nextDate.setUTCDate(nextDate.getUTCDate()+7);
    const candidates=stored.length?stored.slice(0,6):[
      {title:`推进下周计划：${short(week.facts.plan,24)}`,description:week.facts.plan,evidence:week.facts.plan,firstStep:'把计划拆成三个可以验证的小步骤，先确认第一项的负责人和交付物。',metric:'完成计划中的交付物，附上结果记录和验证结论。',supportNeeded:'如需跨部门协作，请先与相关负责人确认输入、责任与验收口径。'},
      {title:`解决本周卡点：${short(week.facts.problems,24)}`,description:week.facts.problems,evidence:week.facts.problems,firstStep:'列出当前状态、影响对象和阻塞环节三条事实，与相关协作者确认。',metric:'形成问题处理记录，明确解决结果或下一次升级节点。',supportNeeded:'请直属上级协助确认跨部门责任与所需资源。'},
      {title:'把本周复盘沉淀为可复用的方法',description:week.facts.reflection||'对照本周成果，复盘一个有效动作及其适用条件。',evidence:week.facts.reflection||week.facts.results,firstStep:'选取一个已验证动作，整理为一页检查清单。',metric:'输出一份清单或模板，并完成一次使用反馈。',supportNeeded:'邀请一位协作者验证这份方法是否能复用。'},
    ];
    return candidates.filter(c=>String(c.description||'').trim()).map((c,i)=>({id:`p-${hash(`${user.userId}:${week.id}:${i}`)}`,title:short(c.title,240),description:short(c.description,10000),priority:['P0','P1','P2'].includes(c.priority)?c.priority:i===1?'P1':'P2',dueDate:c.dueDate||formatDate(nextDate),evidence:short(c.evidence||week.facts.problems,8000),metric:short(c.metric||'附上交付物、完成时间与验证结果。',2000),firstStep:short(c.firstStep||'先核实事实，再确认一个最小可验证动作。',2000),supportNeeded:short(c.supportNeeded||'与相关协作者确认责任及验收口径。',2000),owner:user.name,ownerUserId:user.userId,source:stored.length?'已存档 AI 候选':'周报辅助拆解（非实时 AI）'}));
  }
  async function tasksFor(user,week,insights) {
    const rows=await query(`SELECT * FROM personal_task_drafts WHERE owner_user_id=${sql(user.userId)} AND week_id=${sql(week.id)};`);
    return baseTasks(user,week,insights).map(task=>{
      const saved=rows.find(r=>r.id===task.id);
      return {...task,...(saved?JSON.parse(saved.draft_json):{}),id:task.id,owner:user.name,ownerUserId:user.userId,created:Boolean(saved?.feishu_guid),feishuGuid:saved?.feishu_guid||'',url:saved?.feishu_url||'',savedAt:saved?.updated_at||''};
    });
  }
  async function workspace(user,month,weekId) {
    const reportContext=await performance.createReportContext?.(user.userId);
    if(reportContext)performance.assertReportContext(reportContext,user.userId);
    const raw=reportContext?.data||readData('prototypeData');
    const history=await performance.personal(user.name,user.userId,{reportContext});
    const months=[...new Set([new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7),...(raw.meta?.periods||[]).map(p=>String(p.end).slice(0,7)),...history.history.map(r=>r.month)])].filter(m=>validMonth(m)&&m<=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7)).sort().reverse();
    month=month||months[0];
    const {weeks,employee}=await weeksFor(user,month,reportContext);
    const selected=weeks.find(w=>w.id===weekId)||weeks.filter(w=>w.submitted).at(-1)||weeks[0];
    if(!selected)return {employee:{name:user.name,userId:user.userId},months,month,weeks,selectedWeekId:'',history:history.history};
    const insights=selected.submitted?readData('kimiInsightsByPeriod'):{};
    const source=insights?.[selected.id];
    const personalInsight=source?.employeeInsights?.find(e=>e.userId===user.userId);
    const tasks=await tasksFor(user,selected,insights);
    const threadKey=keyFor(user,selected.id);
    const comments=await query(`SELECT id,author_name,hex(body) AS body_hex,created_at FROM comments WHERE target_type='personal_weekly_report' AND target_id=${sql(threadKey)} AND deleted_at IS NULL ORDER BY created_at,id;`);
    const reactions=await query(`SELECT actor_user_id FROM reactions r WHERE target_type='personal_weekly_report' AND target_id=${sql(threadKey)} AND reaction_type='like' AND NOT EXISTS(SELECT 1 FROM personal_reaction_states s WHERE s.target_id=r.target_id AND s.actor_user_id=r.actor_user_id AND s.liked=0);`);
    const messageRows=await query(`SELECT role,hex(body) AS body_hex,created_at FROM personal_coach_messages WHERE owner_user_id=${sql(user.userId)} AND week_id=${sql(selected.id)} ORDER BY created_at,rowid LIMIT 100;`);
    const messages=messageRows.map(r=>({role:r.role,body:Buffer.from(r.body_hex,'hex').toString('utf8'),created_at:r.created_at}));
    const reportCount=weeks.filter(w=>w.submitted&&!['免交','不在职'].includes(w.status)).length;
    const analysis=selected.submitted?{
      mode:personalInsight?.coachSummary?(source?.meta?.provider==='development-fixture'?'demo':'archived'):'local',
      label:personalInsight?.coachSummary?(source?.meta?.provider==='development-fixture'?'开发演示分析（非实时 AI）':'已存档的 AI 点评'):'基于周报的辅助整理（非实时 AI）',
      summary:personalInsight?.coachSummary||`本周记录了「${short(selected.facts.results,120)}」。主要卡点是「${short(selected.facts.problems,100)||'尚未说明'}」。建议先验证「${short(selected.facts.plan,100)||'一个明确的下一步动作'}」，再记录结果与复盘。`,
      questions:personalInsight?.coachQuestions?.length?personalInsight.coachQuestions.slice(0,5).map(q=>typeof q==='string'?{title:'教练提问',text:q}:q):[
        {title:'教练提问',text:`针对「${short(selected.facts.problems,80)||'本周的主要问题'}」，哪些已经有事实证据，哪些仍需核实？`},
        {title:'自我对照',text:`对照上期计划「${short(selected.closure.previousPlan,80)}」，本周哪些结果能够回应承诺？`},
        {title:'支持请求',text:'下一步需要谁提供什么支持？你准备交付什么、在什么时候验证？'},
      ],
    }:null;
    return {employee:{name:user.name,userId:user.userId,department:employee?.['部门']||''},months,month,weeks,selectedWeekId:selected.id,analysis,tasks,comments:comments.map(c=>({id:c.id,authorName:c.author_name,body:Buffer.from(c.body_hex,'hex').toString('utf8'),createdAt:c.created_at})),likeCount:reactions.length,liked:reactions.some(r=>r.actor_user_id===user.userId),messages,history:history.history,ratingProgress:history.ratingProgress?.find(p=>p.month===month)||null,rollingQuality:history.rollingQuality,rollingMonths:history.rollingMonths,monthSummary:{expected:weeks.filter(w=>!['未到期','免交','未收集','等待日历','不在职'].includes(w.status)).length,submitted:reportCount,onTime:weeks.filter(w=>w.status==='准时').length,late:weeks.filter(w=>w.status==='迟交').length,missing:weeks.filter(w=>w.status==='未交').length,upcoming:weeks.filter(w=>w.status==='未到期').length},aiConfigured:Boolean(config.moonshotApiKey),taskCreateEnabled:config.taskCreateEnabled};
  }
  async function saveTask(user,body) {
    const {week}=await context(user,body.month,body.weekId);
    const task=(await tasksFor(user,week)).find(t=>t.id===body.id);
    if(!task)throw Error('task_not_found');
    if(task.created)throw Error('task_already_created');
    const fields={};
    for(const [name,limit] of Object.entries({title:240,description:10000,metric:2000,evidence:8000,dueDate:10})) fields[name]=short(body[name]??task[name],limit);
    if(!fields.title||!fields.description)throw Error('task_content_required');
    if(fields.dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate))throw Error('invalid_due_date');
    await exec(`INSERT INTO personal_task_drafts(id,owner_user_id,week_id,draft_json) VALUES(${sql(task.id)},${sql(user.userId)},${sql(week.id)},${sql(JSON.stringify(fields))}) ON CONFLICT(id) DO UPDATE SET draft_json=excluded.draft_json,updated_at=datetime('now') WHERE owner_user_id=${sql(user.userId)} AND feishu_guid IS NULL;`);
    return {ok:true};
  }
  async function interact(user,body,kind) {
    const {week}=await context(user,body.month,body.weekId);
    if(!week.submitted)throw Error('report_not_submitted');
    const target=keyFor(user,week.id);
    if(kind==='comment') {
      const content=String(body.body||'').trim();
      if(!content||content.length>4000)throw Error('invalid_comment');
      await exec(`INSERT INTO comments(id,target_type,target_id,author_user_id,author_name,body,visibility) VALUES(${sql(randomUUID())},'personal_weekly_report',${sql(target)},${sql(user.userId)},${sql(user.name)},${sql(content)},'self_manager');`);
    } else {
      await exec(`BEGIN; INSERT OR IGNORE INTO reactions(id,target_type,target_id,actor_user_id,reaction_type) VALUES(${sql(randomUUID())},'personal_weekly_report',${sql(target)},${sql(user.userId)},'like'); INSERT INTO personal_reaction_states(target_id,actor_user_id,liked) VALUES(${sql(target)},${sql(user.userId)},${body.liked===false?0:1}) ON CONFLICT(target_id,actor_user_id) DO UPDATE SET liked=excluded.liked,updated_at=datetime('now'); COMMIT;`);
    }
    return {ok:true};
  }
  async function chat(user,body) {
    const {week}=await context(user,body.month,body.weekId);
    if(!week.submitted)throw Error('report_not_submitted');
    if(!config.moonshotApiKey)throw Error('ai_not_configured');
    const question=String(body.question||'').trim();
    if(!question||question.length>4000)throw Error('invalid_question');
    const tasks=await tasksFor(user,week);
    const candidate=body.candidateId?tasks.find(t=>t.id===body.candidateId):{title:`${week.label} 周报教练`,description:week.facts.plan,evidence:JSON.stringify(week.facts),metric:'以实际交付证据核实进展。'};
    if(!candidate)throw Error('task_not_found');
    const priorRows=await query(`SELECT role,hex(body) AS body_hex FROM personal_coach_messages WHERE owner_user_id=${sql(user.userId)} AND week_id=${sql(week.id)} ORDER BY created_at,rowid;`);
    const messages=priorRows.map(r=>({role:r.role,body:Buffer.from(r.body_hex,'hex').toString('utf8')}));
    const answer=await askAi({candidate,question,messages:messages.slice(-8),employeeName:user.name,userName:user.name});
    await exec(`BEGIN; INSERT INTO personal_coach_messages(id,owner_user_id,week_id,role,body) VALUES(${sql(randomUUID())},${sql(user.userId)},${sql(week.id)},'user',${sql(question)}); INSERT INTO personal_coach_messages(id,owner_user_id,week_id,role,body) VALUES(${sql(randomUUID())},${sql(user.userId)},${sql(week.id)},'assistant',${sql(answer)}); COMMIT;`);
    return {ok:true,answer};
  }
  const creating=new Set();
  async function createTasks(user,session,body) {
    const {week}=await context(user,body.month,body.weekId);
    const ids=Array.isArray(body.ids)?[...new Set(body.ids)]:[];
    const tasks=await tasksFor(user,week);
    if(!ids.length||ids.length>6||ids.some(id=>!tasks.some(t=>t.id===id)))throw Error('invalid_tasks');
    const results=[];
    for(const id of ids) {
      const task=tasks.find(t=>t.id===id);
      if(task.created){results.push({id,created:true,skipped:true});continue;}
      if(creating.has(id))throw Error('task_creation_in_progress');
      if(!config.taskCreateEnabled){results.push({id,dryRun:true});continue;}
      creating.add(id);
      try {
        const created=await createTask(task,user,session);
        const external=created.data?.task||created.data||{};
        const guid=external.guid||external.task_id||external.id;
        if(!guid)throw Error('task_create_failed');
        const url=external.url||external.link||'';
        await exec(`BEGIN; INSERT INTO personal_task_drafts(id,owner_user_id,week_id,draft_json,feishu_guid,feishu_url) VALUES(${sql(id)},${sql(user.userId)},${sql(week.id)},${sql(JSON.stringify(task))},${sql(guid)},${sql(url)}) ON CONFLICT(id) DO UPDATE SET feishu_guid=excluded.feishu_guid,feishu_url=excluded.feishu_url,updated_at=datetime('now'); INSERT OR IGNORE INTO feishu_tasks(guid,idempotency_key,summary,assignee_user_id,due_date,url,status,raw_response_json) VALUES(${sql(guid)},${sql(id)},${sql(task.title)},${sql(user.userId)},${sql(task.dueDate)},${sql(url)},'created',${sql(JSON.stringify(created))}); COMMIT;`);
        results.push({id,created:true,url});
      } finally {creating.delete(id);}
    }
    return {ok:true,taskCreateEnabled:config.taskCreateEnabled,results};
  }
  return {workspace,saveTask,interact,chat,createTasks};
}
