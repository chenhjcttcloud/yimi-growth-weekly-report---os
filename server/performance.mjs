import {createHash,randomUUID} from 'node:crypto';
import {weeklyReportSchedule,monthFridays,shiftDate} from './weekly-report-schedule.mjs';
import {employedOn,employedInMonth} from './employee-lifecycle.mjs';
// Quality/statistics calculate automatically; required human ratings publish when complete.
export function createPerformance({ query, exec, sql, readData, policyFor, managerReviews, calendar, now=()=>new Date() }) {
  const round = n => Math.round(n * 10) / 10;
  const average = xs => xs.length ? round(xs.reduce((a,b)=>a+b,0)/xs.length) : null;
  const monthOf = value => String(value || '').slice(0,7);
  // Reuse each month's policy only within the current calculation. A new
  // request gets a fresh reader, so rule changes cannot leave stale results.
  function policyReader() {
    const policies=new Map();
    return month=>{
      if(!policies.has(month))policies.set(month,Promise.resolve().then(()=>policyFor?policyFor(month):{weights:[30,25,25,20],deadlineTime:'20:00'}));
      return policies.get(month);
    };
  }
  // The first pass only checks publication presence and legacy precedence.
  // Keep large result/evidence snapshots out of that read; final results below
  // still use confirmed() so callers receive the original complete response.
  async function publishedKeys() {
    return query(`SELECT month,employee_user_id,kind,'legacy' AS scoring_rule FROM performance_results
UNION ALL SELECT month,employee_user_id,kind,'weighted_30_70' AS scoring_rule FROM all_monthly_weighted_results
UNION ALL SELECT a.month,a.employee_user_id,a.kind,'automatic_report' AS scoring_rule FROM automatic_performance_results a
WHERE NOT EXISTS(SELECT 1 FROM performance_results p WHERE p.month=a.month AND p.employee_user_id=a.employee_user_id AND p.kind=a.kind)
GROUP BY a.month,a.employee_user_id,a.kind;`);
  }
  async function confirmed(clientSummary=false) {
    // SQLite reduces snapshots before they leave the process. Keep selected
    // keys' JSON types and explicit nulls; absent keys stay absent. Invalid
    // historical evidence becomes an empty summary without changing its row.
    const evidence=column=>clientSummary?`(SELECT json_group_object(key,CASE type
WHEN 'true' THEN json('true') WHEN 'false' THEN json('false')
WHEN 'array' THEN json(value) WHEN 'object' THEN json(value) ELSE value END)
FROM json_each(CASE WHEN json_valid(${column}) THEN ${column} ELSE '{}' END)
WHERE key IN ('reviewNote','qualityCandidate','legitimateReason','deduction'))`:column;
    const columns=alias=>`${alias}.month,${alias}.employee_user_id,${alias}.employee_name,${alias}.kind,${alias}.result_json,${evidence(alias+'.evidence_json')} AS evidence_json,${alias}.confirmed_by,${alias}.confirmed_at`;
    return (await query(`SELECT ${clientSummary?columns('p'):'*'}, 'legacy' AS scoring_rule FROM performance_results p
UNION ALL SELECT ${clientSummary?columns('w'):'*'}, 'weighted_30_70' AS scoring_rule FROM all_monthly_weighted_results w
UNION ALL SELECT a.month,a.employee_user_id,a.employee_name,a.kind,a.result_json,${evidence('a.evidence_json')} AS evidence_json,'系统自动计算' AS confirmed_by,a.calculated_at AS confirmed_at,'automatic_report' AS scoring_rule FROM automatic_performance_results a
WHERE a.rowid=(SELECT MAX(b.rowid) FROM automatic_performance_results b WHERE b.month=a.month AND b.employee_user_id=a.employee_user_id AND b.kind=a.kind)
AND NOT EXISTS(SELECT 1 FROM performance_results p WHERE p.month=a.month AND p.employee_user_id=a.employee_user_id AND p.kind=a.kind)
ORDER BY month DESC, employee_name;`)).map(r=>({...r, result:JSON.parse(r.result_json)}));
  }
  function calculateReportResults(row,existing) {
    if(!row.reports.length&&!row.timeliness.expected)return [];
    const statements=[];
    const submitted=row.reports.filter(r=>r.submitted),pendingAI=submitted.filter(r=>r.candidate===null).length;
    const quality={score:submitted.length&&!pendingAI?average(submitted.map(r=>r.candidate)):null,status:!submitted.length?'no_reports':pendingAI?'pending_ai':'ready',reportCount:submitted.length,pendingAnalysis:pendingAI,publicationMode:'automatic'};
    const timeliness={...row.timeliness,rate:row.timeliness.pendingTimestamp||row.timeliness.pendingCalendar?null:row.timeliness.rate,status:row.timeliness.pendingCalendar?'pending_calendar':row.timeliness.pendingTimestamp?'pending_timestamp':row.timeliness.expected?'ready':'no_due_reports',publicationMode:'automatic'};
    for(const [kind,result] of [['quality',quality],['timeliness',timeliness]]){
      if(existing.some(r=>r.month===row.month&&r.employee_user_id===row.userId&&r.kind===kind&&r.scoring_rule==='legacy'))continue;
      const evidence={userId:row.userId,name:row.name,department:row.department,publicationMode:'automatic',rule:kind==='quality'?'四模块按配置权重生成周分，全部已提交周报分析完成后取月度算术平均':'按提交时间和周五截止时间自动统计，及时率与质量分独立',reports:row.reports,statistics:row.timeliness,reviewNote:'系统自动计算，无需人工确认',deduction:0};
      const hash=createHash('sha256').update(JSON.stringify({result,evidence})).digest('hex');
      // Last-version comparison (rather than a unique hash) preserves A→B→A revisions too.
      statements.push(`INSERT INTO automatic_performance_results(id,month,employee_user_id,employee_name,kind,calculation_hash,result_json,evidence_json,calculated_at)
SELECT ${sql(randomUUID())},${sql(row.month)},${sql(row.userId)},${sql(row.name)},${sql(kind)},${sql(hash)},${sql(JSON.stringify(result))},${sql(JSON.stringify(evidence))},${sql(now().toISOString())}
WHERE COALESCE((SELECT calculation_hash FROM automatic_performance_results WHERE month=${sql(row.month)} AND employee_user_id=${sql(row.userId)} AND kind=${sql(kind)} ORDER BY rowid DESC LIMIT 1),'')<>${sql(hash)};`);
    }
    return statements;
  }
  async function reports(readPolicy=policyReader()) {
    const data = readData('prototypeData');
    const stored = await query('SELECT * FROM weekly_reports;');
    const rows = new Map();
    for(const r of data.weekly_scores || []) {const employeeUserId=r.user_id || ((data.employee_summary||[]).filter(e=>e['姓名']===r['姓名']).length===1?(data.employee_summary||[]).find(e=>e['姓名']===r['姓名'])?.user_id:''); rows.set(`${employeeUserId}|${r['结束日期']}`, {employeeUserId,id:r['源记录ID'], name:r['姓名'], department:r['部门'], end:r['结束日期'], start:r['开始日期'], submittedAt:r['提交时间'], content:r, status:r['状态']});}
    for(const r of stored) rows.set(`${r.employee_user_id}|${r.week_end}`, {employeeUserId:r.employee_user_id,id:r.id,name:r.employee_name,department:r.department,end:r.week_end,start:r.week_start,submittedAt:r.submitted_at,content:JSON.parse(r.content_json),status:r.status});
    const policies=new Map();
    for(const r of rows.values())if(!policies.has(monthOf(r.end)))policies.set(monthOf(r.end),await readPolicy(monthOf(r.end)));
    return [...rows.values()].map(r=>{
      const policy=policies.get(monthOf(r.end));
      const original=r.content || {};
      const c={...original,'本周成果摘要':original['本周成果摘要']||original.results||'', '问题摘要':original['问题摘要']||original.problems||'', '下周计划摘要':original['下周计划摘要']||original.nextPlan||'', '思考与复盘摘要':original['思考与复盘摘要']||original.reflection||''};
      const sections=[['本周成果摘要','成果分',.30],['问题摘要','问题分',.25],['下周计划摘要','计划分',.25],['思考与复盘摘要','复盘分',.20]].map(([text,key],index)=>[text,key,policy.weights[index]/100]);
      const missing=sections.filter(([key])=>!String(c[key]||'').trim()).map(([key])=>key);
      const scores=sections.map(([,key,w])=>({value:c[key]==null||String(c[key]).trim()===''?NaN:Number(c[key]),w}));
      const valid=scores.every(s=>Number.isFinite(s.value)&&s.value>=0&&s.value<=100);
      const submitted=r.status!=='未交' && (!!r.submittedAt || sections.some(([key])=>String(c[key]||'').trim()));
      const ts=submitted?Date.parse(String(r.submittedAt).replace(' ','T')+(/(?:Z|[+-]\d\d:\d\d)$/.test(r.submittedAt)?'':'+08:00')):NaN;
      const schedule=weeklyReportSchedule(r.end,calendar?.()||{},policy.deadlineTime),deadline=Date.parse(schedule.dueAt||'');
      const late=submitted&&!schedule.exempt&&!schedule.calendarPending&&Number.isFinite(ts)&&ts>deadline;
      const status=schedule.exempt?'免交':schedule.calendarPending?'等待日历':!submitted?'未交':!Number.isFinite(ts)?'待核实时间':late?'迟交':'准时';
      return {...r,status,schedule,scoringPolicy:policy, month:monthOf(r.end), submitted, timestampUnknown:submitted&&!Number.isFinite(ts),late,onTime:submitted&&!schedule.exempt&&!schedule.calendarPending&&Number.isFinite(ts)&&ts<=deadline, candidate:valid?round(scores.reduce((n,s)=>n+s.value*s.w,0)):null, missing, evidence:sections.map(([key])=>({module:key,text:c[key]||''})), anomalies:[...(Array.isArray(c.ai?.anomalies)?c.ai.anomalies:[]),...(c.source?.weekInference?['周次按提交日期推定，请核实补交或跨周汇报的归属']:[]),...missing.map(x=>`缺失：${x}`),...(!valid?['缺少有效的四模块候选分']:[]),...(submitted&&!Number.isFinite(ts)?['提交时间无法解析']:[])], suggestions:c.ai?.summary|| (missing.length?'请补齐缺失模块，并由主管核实事实与结果。':'请主管核实成果证据、问题影响和计划可验证性。')};
    });
  }
  async function overview({clientSummary=false}={}) {
    const data=readData('prototypeData'),readPolicy=policyReader();
    const rs=await reports(readPolicy);
    const results=await publishedKeys();
    const managerState=await managerReviews.snapshot();
    const cycles=await query('SELECT * FROM scoring360_cycles ORDER BY start_date DESC;');
    const collaborations=[];
    for(const c of cycles){
      const assignments=await query(`SELECT a.*,r.score,r.comment,r.submitted_at FROM scoring360_assignments a LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE a.cycle_id=${sql(c.id)} AND (COALESCE(a.status,'active')='active' OR r.id IS NOT NULL);`);
      collaborations.push({...c,month:monthOf(c.start_date),assignments,expected:assignments.length,submitted:assignments.filter(a=>a.score!==''&&String(a.comment||'').trim()).length,pending:assignments.filter(a=>a.score===''||!String(a.comment||'').trim()).map(a=>a.evaluator_name)});
    }
    const periodMap=new Map((data.meta?.periods||[]).map(p=>[p.end,p]));
    for(const r of rs) if(r.end&&!periodMap.has(r.end)) periodMap.set(r.end,{end:r.end,start:r.start});
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now());
    const coverageStart=data.meta?.collectionStartDate||[...periodMap.values()].map(p=>p.start).filter(Boolean).sort()[0]||shiftDate(today,-((new Date(today+'T00:00:00Z').getUTCDay()||7)-1));
    if(calendar){
      const current=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now()).slice(0,7);
      for(const month of new Set([current,...[...periodMap.keys()].map(monthOf)]))for(const end of monthFridays(month))if(![...periodMap.values()].some(p=>p.start<=end&&p.end>=end))periodMap.set(end,{start:shiftDate(end,-4),end});
    }
    const periods=[...periodMap.values()];
    const months=[...new Set([...periods.map(p=>monthOf(p.end)),...rs.map(r=>r.month),...collaborations.map(c=>c.month),...managerState.scores.map(s=>s.month),...managerState.bossScores.map(s=>s.month),...results.map(r=>r.month)])].filter(m=>/^\d{4}-\d{2}$/.test(m)).sort().reverse();
    const directory = new Map((data.employee_summary||[]).map(e=>[e.user_id,{name:e['姓名'],department:e['部门'],userId:e.user_id}]));
    const roster=await query('SELECT user_id,name,department,is_active FROM employees;');
    const servicePeriods=await query('SELECT * FROM employee_employment_periods;');
    for(const e of roster)directory.set(e.user_id,{name:e.name,department:e.department,userId:e.user_id,active:Number(e.is_active)===1});
    for(const e of directory.values()){
      const own=servicePeriods.filter(p=>p.employee_user_id===e.userId);
      const first=rs.filter(r=>r.employeeUserId===e.userId).map(r=>r.start).filter(Boolean).sort()[0]||today;
      e.employmentPeriods=own.length?own:[{start_date:first,end_date:e.active===false?today:null,source:'inferred'}];
    }
    const employees=[...directory.values()];
    const monthly=[];
    for(const month of months) for(const employee of employees){
      if(!employedInMonth(employee.employmentPeriods,month)&&!results.some(r=>r.month===month&&r.employee_user_id===employee.userId))continue;
      const monthPolicy=await readPolicy(month);
      const weeks=periods.filter(p=>{const schedule=weeklyReportSchedule(p.end,calendar?.()||{},monthPolicy.deadlineTime);return monthOf(p.end)===month&&(!calendar||p.start>=coverageStart)&&employedOn(employee.employmentPeriods,schedule.deadlineDate)&&!schedule.exempt&&Date.parse(schedule.dueAt)<=now().getTime()&&!(p.exempt_people||[]).includes(employee.name);});
      const employeeReports=rs.filter(r=>r.employeeUserId===employee.userId&&r.month===month);
      const counted=employeeReports.filter(r=>employedOn(employee.employmentPeriods,r.schedule.deadlineDate)&&!r.schedule.exempt&&!(periods.find(p=>p.end===r.end)?.exempt_people||[]).includes(employee.name)),expected=new Set([...weeks.map(p=>p.end),...counted.map(r=>r.end)]).size;
      const submitted=counted.filter(r=>r.submitted).length;
      const onTime=counted.filter(r=>r.onTime).length;
      const cyclesForMonth=collaborations.filter(c=>c.month===month);
      const assignments=cyclesForMonth.flatMap(c=>c.assignments.filter(a=>a.evaluee_user_id===employee.userId));
      const managerProgress=managerReviews.progress(managerState,month,employee.userId);
      const peerCandidate=average(assignments.filter(a=>a.score!=='').map(a=>Number(a.score)));
      const peerComplete=cyclesForMonth.length>0&&assignments.length>0&&assignments.some(a=>a.status==='active')&&assignments.every(a=>a.score!==''&&String(a.comment||'').trim());
      const complete=peerComplete&&managerProgress.complete;
      monthly.push({...employee,month,reports:employeeReports,qualityCandidate:average(employeeReports.filter(r=>r.submitted&&r.candidate!==null).map(r=>r.candidate)),timeliness:{expected,submitted,onTime,late:counted.filter(r=>r.late).length,pendingTimestamp:counted.filter(r=>r.timestampUnknown).length,pendingCalendar:new Set([...weeks.filter(p=>weeklyReportSchedule(p.end,calendar?.()||{},monthPolicy.deadlineTime).calendarPending).map(p=>p.end),...counted.filter(r=>r.schedule.calendarPending).map(r=>r.end)]).size,missing:Math.max(0,expected-submitted),rate:expected?round(onTime/expected*100):null},peerCandidate,peerComplete,managerProgress,collaborationCandidate:complete?round(peerCandidate*.7+managerProgress.score*.3):null,collaborationComplete:complete,collaborationExpected:assignments.length,collaborationSubmitted:assignments.filter(a=>a.score!==''&&String(a.comment||'').trim()).length});
    }
    const calculations=monthly.flatMap(row=>calculateReportResults(row,results));
    if(calculations.length)await exec(`BEGIN IMMEDIATE;${calculations.join('\n')}COMMIT;`);
    for(const row of monthly.filter(r=>r.collaborationComplete)) {
      if(results.some(r=>r.month===row.month&&r.employee_user_id===row.userId&&r.kind==='collaboration'))continue;
      const snapshot={...row,publicationMode:'weighted_30_70',reviewNote:'负责人或老板评分30%＋同事互评70%，两部分完成后自动发布',reviewer:'系统自动发布'};
      await exec(`INSERT OR IGNORE INTO monthly_person_weighted_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at) VALUES(${sql(row.month)},${sql(row.userId)},${sql(row.name)},'collaboration',${sql(JSON.stringify({score:row.collaborationCandidate,peerScore:row.peerCandidate,managerScore:row.managerProgress.score,weights:{manager:30,peers:70}}))},${sql(JSON.stringify(snapshot))},'系统自动发布',datetime('now'));`);
    }
    return {months,employees,monthly,collaborations,results:await confirmed(clientSummary)};
  }
  async function personal(name, userId) {
    const view=await overview({clientSummary:true});
    const rows=view.results.filter(r=>r.employee_user_id===userId);
    const months=[...new Set(rows.map(r=>r.month))].sort().reverse();
    const history=months.map(month=>{
      const get=kind=>rows.find(r=>r.month===month&&r.kind===kind)?.result;
      return {month,quality:get('quality')?.score??null,qualityStatus:get('quality')?.status||null,timeliness:get('timeliness')??null,collaboration:get('collaboration')?.score??null,collaborationRule:rows.find(r=>r.month===month&&r.kind==='collaboration')?.scoring_rule||null};
    });
    const scores=history.filter(r=>r.quality!==null).slice(0,3).map(r=>r.quality);
    return {history,ratingProgress:view.monthly.filter(r=>r.userId===userId).map(r=>({month:r.month,peerComplete:r.peerComplete,managerKind:r.managerProgress.kind,managerExpected:r.managerProgress.expected,managerSubmitted:r.managerProgress.submitted,managerComplete:r.managerProgress.complete})),rollingQuality:average(scores),rollingMonths:scores.length};
  }
  async function confirm(body,user) {
    throw new Error('results_auto_published');
  }
  return {overview,personal,confirm,reports};
}
