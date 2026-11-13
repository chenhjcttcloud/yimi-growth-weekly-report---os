import {randomUUID} from 'node:crypto';
import {weeklyReportSchedule,monthFridays,shiftDate} from './weekly-report-schedule.mjs';
import {isEligibleOnTimeApproval,readWeeklyOnTimeApprovals} from './weekly-on-time-approvals.mjs';
import {employedOn,employedInMonth} from './employee-lifecycle.mjs';
import {LEGACY_REPORT_QUALITY_VERSION,REPORT_QUALITY_VERSION,REPORT_QUALITY_WEIGHTS,reportQualityAssessment} from './report-quality-scoring.mjs';
import {legacyReportScore} from './report-rescore-state.mjs';
import {encodeAutomaticEvidence,decodeAutomaticEvidence} from './automatic-evidence-storage.mjs';
import {applyQualityReviews,qualityAnalysisVersion,qualityReviewDetails,qualityRound,qualityVersion,summarizeMonthlyQuality} from './weekly-quality-review.mjs';

const selected=(value,keys)=>value&&typeof value==='object'?Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]])):null;
const assessmentBasis=value=>{
  if(!value)return null;
  const {generatedAt,...basis}=value;
  return basis;
};
function automaticReportBasis(report,kind){
  const content=report.content||{};
  const common={id:report.id,employeeUserId:report.employeeUserId,name:report.name,department:report.department,start:report.start,end:report.end,submittedAt:report.submittedAt,status:report.status,submitted:report.submitted,timestampUnknown:report.timestampUnknown,late:report.late,onTime:report.onTime,schedule:report.schedule,facts:report.evidence,sourceHash:content.sourceHash||null,source:selected(content.source,['provider','taskId','ruleId','ruleName','commitTime','formContents','weekInference']),deadlineTime:report.scoringPolicy?.deadlineTime};
  // Timeliness cannot change merely because an AI request was retried or a
  // candidate analysis changed. Its complete evidence is still saved below.
  common.originalFacts=selected(content,['results','problems','nextPlan','reflection','本周成果摘要','问题摘要','下周计划摘要','思考与复盘摘要']);
  if(kind==='timeliness')return common;
  const refresh=report.qualityRefresh;
  return {...common,moduleScores:report.qualityAssessment?.scores||selected(content,['成果分','问题分','计划分','复盘分']),weights:legacyReportScore(content)===null?report.scoringPolicy?.weights:undefined,candidate:report.candidate,missing:report.missing,anomalies:report.anomalies,suggestions:report.suggestions,assessment:assessmentBasis(report.qualityAssessment),analysis:selected(content.ai,['version','promptVersion','scores','modules','summary','anomalies','questions','tasks']),model:content.aiModel||'',promptVersion:content.aiPromptVersion||'',refresh:refresh?{state:refresh.state==='ready'?'ready':refresh.state==='failed'?'failed':'pending',targetVersion:refresh.targetVersion}:null,displayQualityScore:report.displayQualityScore??null,qualityDisplaySource:report.qualityDisplaySource||null,previousQualityVersion:report.previousQualityVersion||null,previousScoringWeights:report.previousScoringWeights||null,previousAssessment:assessmentBasis(report.previousQualityAssessment),qualityExcluded:report.qualityExcluded,reviewIds:report.qualityReviews?.filter(review=>review.active).map(review=>review.id)};
}
function automaticBusinessHash(row,kind,result){
  // Collection jobs, retry diagnostics, historical analysis arrays and runtime
  // timestamps are not score revisions. Only the current business basis is
  // hashed; the original, complete snapshot is retained for every real change.
  const {version,...stableResult}=result;
  const reports=row.reports.map(report=>automaticReportBasis(report,kind)).sort((a,b)=>{
    const left=JSON.stringify([a.employeeUserId,a.end,a.start,a.id]),right=JSON.stringify([b.employeeUserId,b.end,b.start,b.id]);
    return left<right?-1:left>right?1:0;
  });
  return qualityVersion({version:'automatic-score-business-v1',month:row.month,userId:row.userId,name:row.name,department:row.department,kind,result:stableResult,reports});
}
// Weekly quality analysis supplies candidates for management confirmation.
export function createPerformance({ query, exec, sql, readData, policyFor, managerReviews, calendar, isCollectingReports, now=()=>new Date() }) {
  const round = n => Math.round(n * 10) / 10;
  const average = xs => xs.length ? round(xs.reduce((a,b)=>a+b,0)/xs.length) : null;
  const monthOf = value => String(value || '').slice(0,7);
  const shanghaiDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'});
  const reportContexts=new WeakSet();
  function employeeScope(value) {
    if(value===undefined)return undefined;
    if(typeof value!=='string'||!value||value.trim()!==value||value.length>200)throw Error('invalid_employee_identity');
    return value;
  }
  function assertReportContext(context,userId) {
    employeeScope(userId);
    if(!userId||!context||!reportContexts.has(context)||context.userId!==userId)throw Error('invalid_report_context');
    return context;
  }
  // Reuse each month's policy only within the current calculation. A new
  // request gets a fresh reader, so rule changes cannot leave stale results.
  function policyReader() {
    const policies=new Map();
    return month=>{
      if(!policies.has(month))policies.set(month,Promise.resolve().then(()=>policyFor?policyFor(month):{weights:[30,25,25,20],deadlineTime:'20:00'}));
      return policies.get(month);
    };
  }
  function scheduleReader() {
    const workCalendar=calendar?.()||{},schedules=new Map();
    return (end,deadlineTime)=>{
      const key=end+'|'+deadlineTime;
      if(!schedules.has(key))schedules.set(key,weeklyReportSchedule(end,workCalendar,deadlineTime));
      return schedules.get(key);
    };
  }
  function qualityConfirmationBlock(month,today,asOf,policy,readSchedule) {
    if(month>=monthOf(today))return 'month_open';
    const deadlinePending=monthFridays(month).some(end=>{
      const schedule=readSchedule(end,policy.deadlineTime);
      return !schedule.exempt && Date.parse(schedule.dueAt)>asOf.getTime();
    });
    if(deadlinePending||isCollectingReports?.(month))return 'collection_pending';
  }
  function resultScope(userId,month,alias='') {
    return [userId?`${alias}employee_user_id=${sql(userId)}`:'',month?`${alias}month=${sql(month)}`:''].filter(Boolean);
  }
  const where=conditions=>conditions.length?' WHERE '+conditions.join(' AND '):'';
  const validMonth=month=>typeof month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const manualRule=alias=>`CASE WHEN json_extract(CASE WHEN json_valid(${alias}.result_json) THEN ${alias}.result_json ELSE '{}' END,'$.publicationMode')='management_confirmation' THEN 'management_confirmed' ELSE 'legacy' END`;
  // The first pass only checks publication presence and legacy precedence.
  // Keep large result/evidence snapshots out of that read; final results below
  // still use confirmed() so callers receive the original complete response.
  async function publishedKeys(userId,month) {
    const scope=where(resultScope(userId,month)),automaticScope=resultScope(userId,month,'a.');
    return query(`SELECT month,employee_user_id,kind,${manualRule('p')} AS scoring_rule,NULL AS calculation_hash FROM performance_results p${scope}
UNION ALL SELECT month,employee_user_id,kind,'weighted_30_70' AS scoring_rule,NULL AS calculation_hash FROM all_monthly_weighted_results${scope}
UNION ALL SELECT a.month,a.employee_user_id,a.kind,'automatic_report' AS scoring_rule,a.calculation_hash FROM automatic_performance_results a
WHERE ${automaticScope.length?automaticScope.join(' AND ')+' AND ':''}a.rowid=(SELECT MAX(b.rowid) FROM automatic_performance_results b WHERE b.month=a.month AND b.employee_user_id=a.employee_user_id AND b.kind=a.kind)
AND NOT EXISTS(SELECT 1 FROM performance_results p WHERE p.month=a.month AND p.employee_user_id=a.employee_user_id AND p.kind=a.kind);`);
  }
  async function confirmed(clientSummary=false,userId,month,includeTrendResults=false) {
    // SQLite reduces snapshots before they leave the process. Keep selected
    // keys' JSON types and explicit nulls; absent keys stay absent. Invalid
    // historical evidence becomes an empty summary without changing its row.
    const evidence=alias=>{
      const column=alias+'.evidence_json';
      if(!clientSummary)return column;
      const summary=`(SELECT json_group_object(key,CASE type
WHEN 'true' THEN json('true') WHEN 'false' THEN json('false')
WHEN 'array' THEN json(value) WHEN 'object' THEN json(value) ELSE value END)
FROM json_each(CASE WHEN json_valid(${column}) THEN ${column} ELSE '{}' END)
WHERE key IN ('reviewNote','qualityCandidate','legitimateReason','deduction'))`;
      return includeTrendResults?`CASE WHEN ${alias}.month=${sql(month)} THEN ${summary} ELSE '{}' END`:summary;
    };
    const scope=alias=>[
      ...resultScope(userId,includeTrendResults?undefined:month,alias+'.'),
      ...(includeTrendResults?[`(${alias}.month=${sql(month)} OR ${alias}.kind IN ('quality','collaboration'))`]:[]),
    ];
    const automaticScope=scope('a');
    const columns=alias=>`${alias}.month,${alias}.employee_user_id,${alias}.employee_name,${alias}.kind,${alias}.result_json,${evidence(alias)} AS evidence_json,${alias}.confirmed_by,${alias}.confirmed_at`;
    return (await query(`SELECT ${clientSummary?columns('p'):'*'}, ${manualRule('p')} AS scoring_rule FROM performance_results p${where(scope('p'))}
UNION ALL SELECT ${clientSummary?columns('w'):'*'}, 'weighted_30_70' AS scoring_rule FROM all_monthly_weighted_results w${where(scope('w'))}
UNION ALL SELECT a.month,a.employee_user_id,a.employee_name,a.kind,a.result_json,${evidence('a')} AS evidence_json,'系统自动计算' AS confirmed_by,a.calculated_at AS confirmed_at,'automatic_report' AS scoring_rule FROM automatic_performance_results a
WHERE a.kind='timeliness' AND ${automaticScope.length?automaticScope.join(' AND ')+' AND ':''}a.rowid=(SELECT MAX(b.rowid) FROM automatic_performance_results b WHERE b.month=a.month AND b.employee_user_id=a.employee_user_id AND b.kind=a.kind)
AND NOT EXISTS(SELECT 1 FROM performance_results p WHERE p.month=a.month AND p.employee_user_id=a.employee_user_id AND p.kind=a.kind)
ORDER BY month DESC, employee_name;`)).map(r=>({...r,...(!clientSummary&&r.scoring_rule==='automatic_report'&&typeof r.evidence_json==='string'?{evidence_json:decodeAutomaticEvidence(r.evidence_json)}:{}),result:JSON.parse(r.result_json)}));
  }
  function calculateReportResults(row,existing) {
    if(!row.reports.length&&!row.timeliness.expected)return [];
    const statements=[];
    const quality={...row.quality,score:null,publicationMode:'ai_candidate'};
    const timeliness={...row.timeliness,rate:row.timeliness.pendingTimestamp||row.timeliness.pendingCalendar?null:row.timeliness.rate,status:row.timeliness.pendingCalendar?'pending_calendar':row.timeliness.pendingTimestamp?'pending_timestamp':row.timeliness.expected?'ready':'no_due_reports',publicationMode:'automatic'};
    for(const [kind,result] of [['quality',quality],['timeliness',timeliness]]){
      if(existing.some(r=>r.month===row.month&&r.employee_user_id===row.userId&&r.kind===kind&&['legacy','management_confirmed'].includes(r.scoring_rule)))continue;
      const qualityRule='取已完成分析的有效周报算术平均，月份结束且分析完成后提交管理确认';
      const evidence={userId:row.userId,name:row.name,department:row.department,publicationMode:result.publicationMode,rule:kind==='quality'?qualityRule:'按提交时间和周五截止时间自动统计，及时率与质量分独立',reports:row.reports,statistics:row.timeliness,reviewNote:kind==='quality'?'AI 候选汇总，须经管理人员确认':'系统自动计算，无需人工确认',deduction:0};
      const hash=automaticBusinessHash(row,kind,result);
      // A read with unchanged inputs does not need a write transaction. Keep the
      // SQL comparison too: another request may publish between this read/write.
      if(existing.some(r=>r.month===row.month&&r.employee_user_id===row.userId&&r.kind===kind&&r.scoring_rule==='automatic_report'&&r.calculation_hash===hash))continue;
      // Last-version comparison (rather than a unique hash) preserves A→B→A revisions too.
      statements.push(`INSERT INTO automatic_performance_results(id,month,employee_user_id,employee_name,kind,calculation_hash,result_json,evidence_json,calculated_at)
SELECT ${sql(randomUUID())},${sql(row.month)},${sql(row.userId)},${sql(row.name)},${sql(kind)},${sql(hash)},${sql(JSON.stringify(result))},${sql(encodeAutomaticEvidence(JSON.stringify(evidence)))},${sql(now().toISOString())}
WHERE COALESCE((SELECT calculation_hash FROM automatic_performance_results WHERE month=${sql(row.month)} AND employee_user_id=${sql(row.userId)} AND kind=${sql(kind)} ORDER BY rowid DESC LIMIT 1),'')<>${sql(hash)}${kind==='quality'?` AND NOT EXISTS(SELECT 1 FROM performance_results WHERE ${finalMatch(row.userId,row.month)})`:''};`);
    }
    return statements;
  }
  function prototypeIdentity(data) {
    const names=new Map();
    for(const employee of data.employee_summary||[]){const name=employee['姓名'];names.set(name,names.has(name)?null:employee.user_id);}
    return row=>row.user_id||names.get(row['姓名'])||'';
  }
  function weeklyReportScope(userId,month,alias='') {
    const start=month?sql(month+'-01'):'';
    return [userId?`${alias}employee_user_id=${sql(userId)}`:'',month?`${alias}week_end>=${start} AND ${alias}week_end<date(${start},'+1 month')`:''].filter(Boolean);
  }
  async function readReports(data,userId,readPolicy,month,readSchedule=scheduleReader(),writeBasis) {
    const scope=weeklyReportScope(userId,month);
    const stored=await query(`SELECT ${writeBasis?'rowid AS review_rowid,':''}* FROM weekly_reports${where(scope)}${month?' ORDER BY rowid':''};`);
    const rows = new Map();
    const identity=prototypeIdentity(data);
    for(const r of data.weekly_scores || []) {const employeeUserId=identity(r);if(userId&&employeeUserId!==userId||month&&monthOf(r['结束日期'])!==month)continue;rows.set(`${employeeUserId}|${r['结束日期']}`, {employeeUserId,id:r['源记录ID'], name:r['姓名'], department:r['部门'], end:r['结束日期'], start:r['开始日期'], submittedAt:r['提交时间'], content:r, status:r['状态']});}
    for(const r of stored) rows.set(`${r.employee_user_id}|${r.week_end}`, {employeeUserId:r.employee_user_id,id:r.id,name:r.employee_name,department:r.department,end:r.week_end,start:r.week_start,submittedAt:r.submitted_at,content:JSON.parse(r.content_json),status:r.status});
    const reviews=new Map();
    if(rows.size){
      const records=await query(`SELECT rowid AS review_rowid,* FROM weekly_quality_reviews${where(resultScope(userId,month))} ORDER BY rowid;`);
      for(const record of records){
        const key=JSON.stringify([record.employee_user_id,record.month,record.report_id]);
        if(!reviews.has(key))reviews.set(key,[]);
        reviews.get(key).push(record);
      }
      if(writeBasis)writeBasis.lastReview=records.at(-1)?.review_rowid??0;
    }
    if(writeBasis)writeBasis.stored=stored;
    const approvedOnTime=rows.size?await readWeeklyOnTimeApprovals({query,sql,month,employeeUserId:userId}):null;
    const policies=new Map();
    for(const r of rows.values())if(!policies.has(monthOf(r.end)))policies.set(monthOf(r.end),await readPolicy(monthOf(r.end)));
    return [...rows.values()].map(r=>{
      const original=r.content || {};
      const configuredPolicy=policies.get(monthOf(r.end));
      const policy=original.ai?.version===REPORT_QUALITY_VERSION?{...configuredPolicy,weights:REPORT_QUALITY_WEIGHTS}:configuredPolicy;
      const c={...original,'本周成果摘要':original['本周成果摘要']||original.results||'', '问题摘要':original['问题摘要']||original.problems||'', '下周计划摘要':original['下周计划摘要']||original.nextPlan||'', '思考与复盘摘要':original['思考与复盘摘要']||original.reflection||''};
      const sections=[['本周成果摘要','成果分',.30],['问题摘要','问题分',.25],['下周计划摘要','计划分',.25],['思考与复盘摘要','复盘分',.20]].map(([text,key],index)=>[text,key,policy.weights[index]/100]);
      const missing=sections.filter(([key])=>!String(c[key]||'').trim()).map(([key])=>key);
      const qualityAssessment=reportQualityAssessment(c);
      // The previous score belongs to its saved original facts, not an edited report.
      const archived=Array.isArray(c.aiAnalysisHistory)?[...c.aiAnalysisHistory].reverse():[];
      const previous=c.previousQuality||archived.find(record=>Array.isArray(record?.ai?.scores)&&record.ai.scores.length===4&&record.ai.scores.every(value=>Number.isFinite(value)&&value>=0&&value<=100));
      const rawRefresh=c.qualityRefresh||(!c.ai&&previous?{state:'queued',targetVersion:REPORT_QUALITY_VERSION}:null);
      const qualityRefresh=rawRefresh?{state:['queued','analyzing','failed','ready'].includes(rawRefresh.state)?rawRefresh.state:'queued',targetVersion:String(rawRefresh.targetVersion||REPORT_QUALITY_VERSION),attempts:Number.isInteger(rawRefresh.attempts)?rawRefresh.attempts:0,updatedAt:typeof rawRefresh.updatedAt==='string'?rawRefresh.updatedAt:''}:null;
      const refreshPending=qualityRefresh&&qualityRefresh.state!=='ready';
      let previousQualityAssessment=null,previousQualityScore=null;
      if(previous&&Array.isArray(previous.ai?.scores)&&previous.ai.scores.length===4&&previous.ai.scores.every(value=>Number.isFinite(value)&&value>=0&&value<=100)){
        previousQualityAssessment=reportQualityAssessment({...previous.facts,ai:previous.ai,aiModel:previous.aiModel||previous.model,aiPromptVersion:previous.aiPromptVersion||previous.promptVersion,aiGeneratedAt:previous.aiGeneratedAt||previous.generatedAt,sourceHash:previous.sourceHash});
        if(![REPORT_QUALITY_VERSION,LEGACY_REPORT_QUALITY_VERSION].includes(previous.ai.version)||previousQualityAssessment){const previousScores=previousQualityAssessment?.scores||previous.ai.scores;previousQualityScore=previousQualityAssessment?.totalScore??round(previousScores.reduce((sum,value,index)=>sum+value*(previous.scoringWeights||policy.weights)[index]/100,0));}
      }
      const scores=sections.map(([,key,w],index)=>({value:qualityAssessment?qualityAssessment.scores[index]:c[key]==null||String(c[key]).trim()===''?NaN:Number(c[key]),w}));
      const valid=scores.every(s=>Number.isFinite(s.value)&&s.value>=0&&s.value<=100)&&(![REPORT_QUALITY_VERSION,LEGACY_REPORT_QUALITY_VERSION].includes(c.ai?.version)||qualityAssessment!==null)&&!refreshPending;
      const candidate=legacyReportScore(c)??(valid?qualityAssessment?.totalScore??round(scores.reduce((n,s)=>n+s.value*s.w,0)):null);
      const submitted=r.status!=='未交' && (!!r.submittedAt || sections.some(([key])=>String(c[key]||'').trim()));
      const ts=submitted?Date.parse(String(r.submittedAt).replace(' ','T')+(/(?:Z|[+-]\d\d:\d\d)$/.test(r.submittedAt)?'':'+08:00')):NaN;
      const schedule=readSchedule(r.end,policy.deadlineTime),deadline=Date.parse(schedule.dueAt||'');
      const approved=approvedOnTime(r.employeeUserId,r.end)&&isEligibleOnTimeApproval(r.status,ts);
      const late=submitted&&!schedule.exempt&&!schedule.calendarPending&&Number.isFinite(ts)&&ts>deadline&&!approved;
      const status=schedule.exempt?'免交':schedule.calendarPending?'等待日历':!submitted?'未交':!Number.isFinite(ts)?'待核实时间':late?'迟交':'准时';
      const report={...r,content:c,status,schedule,scoringPolicy:policy,...(qualityAssessment&&!refreshPending?{qualityAssessment}:{}),...(qualityRefresh?{qualityRefresh,displayQualityScore:refreshPending?previousQualityScore:null,...(refreshPending&&previousQualityScore!==null?{qualityDisplaySource:'previous',previousQualityVersion:previous.ai.version||previous.aiPromptVersion||previous.promptVersion||'legacy',previousScoringWeights:previous.ai.version===REPORT_QUALITY_VERSION?REPORT_QUALITY_WEIGHTS:previous.scoringWeights||policy.weights,...(previousQualityAssessment?{previousQualityAssessment}:{})}: {})}:{}), month:monthOf(r.end), submitted, timestampUnknown:submitted&&!Number.isFinite(ts),late,onTime:submitted&&!schedule.exempt&&!schedule.calendarPending&&Number.isFinite(ts)&&(ts<=deadline||approved), candidate, missing, evidence:sections.map(([key])=>({module:key,text:c[key]||''})), anomalies:[...(Array.isArray(c.ai?.anomalies)?c.ai.anomalies:[]),...(c.source?.weekInference?['周次按提交日期推定，请核实补交或跨周汇报的归属']:[]),...missing.map(x=>`缺失：${x}`),...(!valid?['缺少有效的四模块候选分']:[]),...(submitted&&!Number.isFinite(ts)?['提交时间无法解析']:[])], suggestions:c.ai?.summary|| (missing.length?'请补齐缺失模块，并由主管核实事实与结果。':'请主管核实成果证据、问题影响和计划可验证性。'),qualityExcluded:['无效','重复','invalid','duplicate','void'].includes(String(r.status||'').toLowerCase())};
      const reviewed=applyQualityReviews(report,reviews.get(JSON.stringify([r.employeeUserId,report.month,r.id]))||[]);
      return {...reviewed,content:original};
    });
  }
  async function reports(options={}) {
    const readPolicy=typeof options==='function'?options:policyReader();
    const userId=employeeScope(typeof options==='function'?undefined:options.employeeUserId);
    const month=typeof options==='function'?undefined:options.month;
    return readReports(readData('prototypeData'),userId,readPolicy,month);
  }
  async function reportById(id) {
    const data=readData('prototypeData'),identity=prototypeIdentity(data),prototype=new Map();
    const key=(userId,weekEnd)=>`${userId}|${weekEnd}`;
    for(const row of data.weekly_scores||[])prototype.set(key(identity(row),row['结束日期']),row);
    const candidates=[...prototype.values()].filter(row=>row['源记录ID']===id);
    const prototypeSql=candidates.length?`WITH prototype_matches(employee_user_id,week_end) AS (VALUES
      ${candidates.map(row=>`(${sql(identity(row))},${sql(String(row['结束日期']))})`).join(',')})`:'';
    // Preserve the merged report's last row per employee/week. Prototype rows
    // overwritten by any database report are hidden, even if the IDs differ.
    const records=await query(`${prototypeSql}
      SELECT 'report' AS kind,w.employee_user_id,COALESCE(w.week_end,'') AS week_end,w.content_json
      FROM weekly_reports w WHERE w.id=${sql(id)} AND NOT EXISTS(
        SELECT 1 FROM weekly_reports later WHERE later.employee_user_id=w.employee_user_id
          AND COALESCE(later.week_end,'')=COALESCE(w.week_end,'') AND later.rowid>w.rowid)
      ${candidates.length?`UNION ALL SELECT 'overlay',p.employee_user_id,p.week_end,NULL FROM prototype_matches p
        WHERE EXISTS(SELECT 1 FROM weekly_reports w WHERE w.employee_user_id=p.employee_user_id AND COALESCE(w.week_end,'')=p.week_end)`:''};`);
    const stored=records.find(row=>row.kind==='report');
    const storedKey=stored?key(stored.employee_user_id,stored.week_end):null;
    const overlays=new Set(records.filter(row=>row.kind==='overlay').map(row=>key(row.employee_user_id,row.week_end)));
    // Map insertion order retains the first employee/week position, including
    // when that position's report is later replaced by a database row.
    for(const [reportKey,row] of prototype){
      if(reportKey===storedKey)break;
      if(row['源记录ID']===id&&!overlays.has(reportKey))return {content:row,employeeUserId:identity(row),month:monthOf(row['结束日期'])};
    }
    return stored?{content:JSON.parse(stored.content_json),employeeUserId:stored.employee_user_id,month:monthOf(stored.week_end)}:undefined;
  }
  // This context is created inside one request and never cached across requests.
  // Non-enumerable internals prevent accidental JSON serialization of source data.
  async function createReportContext(userId) {
    employeeScope(userId);
    if(!userId)throw Error('invalid_employee_identity');
    const data=readData('prototypeData'),readPolicy=policyReader();
    const context={userId};
    Object.defineProperties(context,{data:{value:data},reports:{value:await readReports(data,userId,readPolicy)},readPolicy:{value:readPolicy}});
    Object.freeze(context);reportContexts.add(context);
    return context;
  }
  async function overview({clientSummary=false,employeeUserId,reportContext,month:requestedMonth,includeTrendResults=false}={}) {
    const userId=employeeScope(employeeUserId);
    const context=reportContext===undefined?null:assertReportContext(reportContext,userId);
    const data=context?.data||readData('prototypeData'),readPolicy=context?.readPolicy||policyReader();
    const readSchedule=scheduleReader();
    const scoped=requestedMonth!==undefined;
    let rs=scoped?[]:context?.reports||await readReports(data,userId,readPolicy,undefined,readSchedule);
    let results=scoped?[]:await publishedKeys(userId);
    const managerState=await managerReviews.snapshot();
    const cycles=await query('SELECT * FROM scoring360_cycles ORDER BY start_date DESC;');
    const periodMap=new Map((data.meta?.periods||[]).map(p=>[p.end,p]));
    let reportPeriods=rs,publicationMonths=results;
    if(userId||scoped){
      // Discover calendar boundaries and fallback employment dates using only
      // identities and dates. Weekly report bodies are read for the selected month.
      const identity=prototypeIdentity(data),boundaries=new Map();
      for(const r of data.weekly_scores||[]){
        const employeeUserId=identity(r);
        boundaries.set(`${employeeUserId}|${r['结束日期']}`,{employeeUserId,end:r['结束日期'],start:r['开始日期']});
      }
      const boundaryQuery=scoped?'SELECT employee_user_id,week_start,week_end FROM weekly_reports ORDER BY rowid;':'SELECT employee_user_id,week_start,week_end FROM weekly_reports;';
      for(const r of await query(boundaryQuery))boundaries.set(`${r.employee_user_id}|${r.week_end}`,{employeeUserId:r.employee_user_id,end:r.week_end,start:r.week_start});
      reportPeriods=[...boundaries.values()];
      publicationMonths=await query('SELECT month FROM performance_results UNION SELECT month FROM all_monthly_weighted_results UNION SELECT month FROM automatic_performance_results;');
    }
    for(const r of reportPeriods) if(r.end&&!periodMap.has(r.end)) periodMap.set(r.end,{end:r.end,start:r.start});
    const asOf=now();
    const today=shanghaiDate.format(asOf);
    const coverageStart=data.meta?.collectionStartDate||[...periodMap.values()].map(p=>p.start).filter(Boolean).sort()[0]||shiftDate(today,-((new Date(today+'T00:00:00Z').getUTCDay()||7)-1));
    if(calendar){
      const current=today.slice(0,7);
      for(const month of new Set([current,...[...periodMap.keys()].map(monthOf)]))for(const end of monthFridays(month))if(![...periodMap.values()].some(p=>p.start<=end&&p.end>=end))periodMap.set(end,{start:shiftDate(end,-4),end});
    }
    const periods=[...periodMap.values()];
    const ratingMonths=[...managerState.scores,...managerState.bossScores,...(managerState.bossPersonScores||[])].map(score=>score.month);
    const months=[...new Set([...periods.map(p=>monthOf(p.end)),...rs.map(r=>r.month),...cycles.map(c=>monthOf(c.start_date)),...ratingMonths,...publicationMonths.map(r=>r.month)])].filter(m=>/^\d{4}-\d{2}$/.test(m)).sort().reverse();
    const scopeMonth=requestedMonth==='latest'?months[0]||'':requestedMonth;
    if(scoped&&months.includes(scopeMonth)){
      rs=context?context.reports.filter(report=>report.month===scopeMonth):await readReports(data,userId,readPolicy,scopeMonth,readSchedule);
      results=await publishedKeys(userId,scopeMonth);
    }
    const selectedCycles=scoped?cycles.filter(c=>monthOf(c.start_date)===scopeMonth):cycles;
    let cycleTotals=[];
    if(userId&&selectedCycles.length){
      // Keep the management view's whole-cycle progress while reading only this
      // employee's assignment details. Match JavaScript String.trim whitespace.
      const comment=`trim(COALESCE(r.comment,''),char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))`;
      cycleTotals=await query(`SELECT a.cycle_id,COUNT(*) AS expected,SUM(CASE WHEN r.score IS NOT NULL AND ${comment}<>'' THEN 1 ELSE 0 END) AS submitted,json_group_array(a.evaluator_name) FILTER (WHERE r.score IS NULL OR ${comment}='') AS pending_json FROM scoring360_assignments a LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE (COALESCE(a.status,'active')='active' OR r.id IS NOT NULL)${scoped?` AND a.cycle_id IN (${selectedCycles.map(c=>sql(c.id)).join(',')})`:''} GROUP BY a.cycle_id;`);
    }
    const collaborations=[];
    for(const c of selectedCycles){
      const assignments=await query(`SELECT a.*,r.score,r.comment,r.submitted_at FROM scoring360_assignments a LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE a.cycle_id=${sql(c.id)}${userId?` AND a.evaluee_user_id=${sql(userId)}`:''} AND (COALESCE(a.status,'active')='active' OR r.id IS NOT NULL);`);
      const totals=cycleTotals.find(t=>t.cycle_id===c.id);
      collaborations.push({...c,month:monthOf(c.start_date),assignments,expected:userId?Number(totals?.expected||0):assignments.length,submitted:userId?Number(totals?.submitted||0):assignments.filter(a=>a.score!==''&&String(a.comment||'').trim()).length,pending:userId?JSON.parse(totals?.pending_json||'[]'):assignments.filter(a=>a.score===''||!String(a.comment||'').trim()).map(a=>a.evaluator_name)});
    }
    const directory = new Map((data.employee_summary||[]).filter(e=>!userId||e.user_id===userId).map(e=>[e.user_id,{name:e['姓名'],department:e['部门'],userId:e.user_id}]));
    const roster=await query(`SELECT user_id,name,department,is_active FROM employees${userId?` WHERE user_id=${sql(userId)}`:''};`);
    const servicePeriods=await query(`SELECT * FROM employee_employment_periods${userId?` WHERE employee_user_id=${sql(userId)}`:''};`);
    for(const e of roster)directory.set(e.user_id,{name:e.name,department:e.department,userId:e.user_id,active:Number(e.is_active)===1});
    for(const e of directory.values()){
      const own=servicePeriods.filter(p=>p.employee_user_id===e.userId);
      const first=(scoped?reportPeriods:rs).filter(r=>r.employeeUserId===e.userId).map(r=>r.start).filter(Boolean).sort()[0]||today;
      e.employmentPeriods=own.length?own:[{start_date:first,end_date:e.active===false?today:null,source:'inferred'}];
    }
    const employees=[...directory.values()];
    const monthly=[];
    const selectedMonths=scoped?months.filter(m=>m===scopeMonth):months;
    const confirmationBlocks=new Map();
    for(const month of selectedMonths){
      const monthPolicy=await readPolicy(month);
      confirmationBlocks.set(month,qualityConfirmationBlock(month,today,asOf,monthPolicy,readSchedule));
    }
    for(const month of selectedMonths) for(const employee of employees){
      const employeeReports=rs.filter(r=>r.employeeUserId===employee.userId&&r.month===month);
      if(!employedInMonth(employee.employmentPeriods,month)&&!results.some(r=>r.month===month&&r.employee_user_id===employee.userId)&&!employeeReports.some(r=>legacyReportScore(r.content)!==null))continue;
      const monthPolicy=await readPolicy(month);
      const weeks=periods.filter(p=>{if(monthOf(p.end)!==month||calendar&&!(p.start>=coverageStart))return false;const schedule=readSchedule(p.end,monthPolicy.deadlineTime);return employedOn(employee.employmentPeriods,schedule.deadlineDate)&&!schedule.exempt&&Date.parse(schedule.dueAt)<=asOf.getTime()&&!(p.exempt_people||[]).includes(employee.name);});
      const counted=employeeReports.filter(r=>employedOn(employee.employmentPeriods,r.schedule.deadlineDate)&&!r.schedule.exempt&&!(periodMap.get(r.end)?.exempt_people||[]).includes(employee.name)),expected=new Set([...weeks.map(p=>p.end),...counted.map(r=>r.end)]).size;
      const submitted=counted.filter(r=>r.submitted).length;
      const onTime=counted.filter(r=>r.onTime).length;
      const cyclesForMonth=collaborations.filter(c=>c.month===month);
      const assignments=cyclesForMonth.flatMap(c=>c.assignments.filter(a=>a.evaluee_user_id===employee.userId));
      const managerProgress=managerReviews.progress(managerState,month,employee.userId);
      const peerCandidate=average(assignments.filter(a=>a.score!=='').map(a=>Number(a.score)));
      const peerComplete=cyclesForMonth.length>0&&assignments.length>0&&assignments.some(a=>a.status==='active')&&assignments.every(a=>a.score!==''&&String(a.comment||'').trim());
      const complete=peerComplete&&managerProgress.complete;
      const quality=summarizeMonthlyQuality(employeeReports,confirmationBlocks.get(month));
      monthly.push({...employee,month,reports:employeeReports,quality,qualityCandidate:quality.candidateScore,timeliness:{expected,submitted,onTime,late:counted.filter(r=>r.late).length,pendingTimestamp:counted.filter(r=>r.timestampUnknown).length,pendingCalendar:new Set([...weeks.filter(p=>readSchedule(p.end,monthPolicy.deadlineTime).calendarPending).map(p=>p.end),...counted.filter(r=>r.schedule.calendarPending).map(r=>r.end)]).size,missing:Math.max(0,expected-submitted),rate:expected?round(onTime/expected*100):null},peerCandidate,peerComplete,managerProgress,collaborationCandidate:complete?round(peerCandidate*.7+managerProgress.score*.3):null,collaborationComplete:complete,collaborationExpected:assignments.length,collaborationSubmitted:assignments.filter(a=>a.score!==''&&String(a.comment||'').trim()).length});
    }
    const calculations=monthly.flatMap(row=>calculateReportResults(row,results));
    if(calculations.length)await exec(`BEGIN IMMEDIATE;${calculations.join('\n')}COMMIT;`);
    for(const row of monthly.filter(r=>r.collaborationComplete)) {
      if(results.some(r=>r.month===row.month&&r.employee_user_id===row.userId&&r.kind==='collaboration'))continue;
      const snapshot={...row,publicationMode:'weighted_30_70',reviewNote:'负责人或老板评分30%＋同事互评70%，两部分完成后自动发布',reviewer:'系统自动发布'};
      const match=`month=${sql(row.month)} AND employee_user_id=${sql(row.userId)}`;
      const {kind,expectedIds}=row.managerProgress;
      const usesPersonScore=kind==='boss'&&expectedIds.length===1&&expectedIds[0]==='';
      const personScoreGuard=usesPersonScore?'':`AND NOT EXISTS(SELECT 1 FROM boss_person_scores WHERE month=${sql(row.month)} AND leader_user_id=${sql(row.userId)})`;
      await exec(`INSERT OR IGNORE INTO monthly_person_weighted_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at)
SELECT ${sql(row.month)},${sql(row.userId)},${sql(row.name)},'collaboration',${sql(JSON.stringify({score:row.collaborationCandidate,peerScore:row.peerCandidate,managerScore:row.managerProgress.score,weights:{manager:30,peers:70}}))},${sql(JSON.stringify(snapshot))},'系统自动发布',datetime('now')
WHERE NOT EXISTS(SELECT 1 FROM all_monthly_weighted_results WHERE ${match})
 AND NOT EXISTS(SELECT 1 FROM performance_results WHERE ${match} AND kind='collaboration')
 ${personScoreGuard};`);
    }
    const published=await confirmed(clientSummary,userId,scopeMonth,includeTrendResults);
    const finals=new Map(published.filter(row=>row.kind==='quality').map(row=>[`${row.month}|${row.employee_user_id}`,row]));
    for(const row of monthly){
      const final=finals.get(`${row.month}|${row.userId}`);
      if(final){
        const {version,confirmationBlockedReason,...quality}=row.quality;
        row.quality={...quality,status:'final',currentAverage:final.result.candidateScore??null,candidateScore:final.result.candidateScore??null,finalScore:final.result.score??null,
          confirmedBy:final.confirmed_by,confirmedAt:final.confirmed_at,canConfirm:false,
          ...(final.result.version?{version:final.result.version}:{}),
          ...(final.result.reportCount!==undefined?{pendingAnalysis:0,analyzedCount:final.result.reportCount,expectedCount:final.result.reportCount}:{}),
        };
        row.qualityCandidate=row.quality.candidateScore;
      }
    }
    return {months,employees,monthly,collaborations,results:published,...(scoped?{scopeMonth}:{})};
  }
  async function personal(name, userId,{reportContext}={}) {
    employeeScope(userId);
    if(!userId)throw Error('invalid_employee_identity');
    const view=await overview({clientSummary:true,employeeUserId:userId,reportContext});
    const rows=view.results.filter(r=>r.employee_user_id===userId);
    const ownMonthly=view.monthly.filter(row=>row.userId===userId);
    const months=[...new Set([...rows.map(r=>r.month),...ownMonthly.filter(row=>row.quality.status!=='no_reports').map(row=>row.month)])].sort().reverse();
    const history=months.map(month=>{
      const get=kind=>rows.find(r=>r.month===month&&r.kind===kind)?.result;
      const row=ownMonthly.find(item=>item.month===month);
      const {version,...monthlyQuality}=row?.quality||summarizeMonthlyQuality([]);
      const refreshing=(row?.reports||[]).filter(report=>report.submitted&&!report.qualityExcluded&&report.candidate===null&&(report.qualityRefresh||report.qualityReanalysisPending));
      const failedAnalysis=refreshing.filter(report=>report.qualityRefresh?.state==='failed').length;
      return {month,quality:get('quality')?.score??null,qualityStatus:monthlyQuality.status,monthlyQuality:{...monthlyQuality,canConfirm:false},
        ...(refreshing.length&&monthlyQuality.status==='pending_ai'?{qualityRefresh:{status:failedAnalysis?'rescore_failed':'rescoring',pendingAnalysis:monthlyQuality.pendingAnalysis,failedAnalysis,targetVersion:REPORT_QUALITY_VERSION}}:{}),
        timeliness:get('timeliness')??null,collaboration:get('collaboration')?.score??null,collaborationRule:rows.find(r=>r.month===month&&r.kind==='collaboration')?.scoring_rule||null};
    });
    const scores=history.filter(r=>r.quality!==null).slice(0,3).map(r=>r.quality);
    return {history,ratingProgress:view.monthly.filter(r=>r.userId===userId).map(r=>({month:r.month,peerComplete:r.peerComplete,managerKind:r.managerProgress.kind,managerExpected:r.managerProgress.expected,managerSubmitted:r.managerProgress.submitted,managerComplete:r.managerProgress.complete})),rollingQuality:average(scores),rollingMonths:scores.length};
  }
  function qualityWriteIdentity(body,user) {
    const {userId,month,version}=body||{};
    if(typeof userId!=='string'||!userId||userId.length>200||userId.trim()!==userId||!validMonth(month))throw Error('invalid_employee_month');
    if(typeof version!=='string'||!/^[a-f0-9]{64}$/.test(version))throw Error('quality_version_required');
    if(typeof user?.userId!=='string'||!user.userId.trim())throw Error('invalid_reviewer');
    return {userId,month,version,reviewerName:String(user.name||user.userId)};
  }
  const finalMatch=(userId,month)=>`${resultScope(userId,month).join(' AND ')} AND kind='quality'`;
  async function assertQualityUnlocked(userId,month) {
    if((await query(`SELECT 1 AS locked FROM performance_results WHERE ${finalMatch(userId,month)};`)).length)throw Error('result_locked');
  }
  function qualityWriteGuard(userId,month,basis) {
    // Recheck the complete input set under SQLite's write lock. This catches a
    // late submission or a rescore/review that finishes after the candidate read.
    const scope=weeklyReportScope(userId,month,'w.').join(' AND ');
    const keys=['id','week_start','week_end','status','submitted_at','content_json','source_hash','employee_name','department'];
    const expected=basis.stored.map(row=>({rowid:String(row.review_rowid),...Object.fromEntries(keys.map(key=>[key,String(row[key]??'')]))}));
    const equal=keys.map(key=>`COALESCE(w.${key},'')=json_extract(s.value,'$.${key}')`).join(' AND ');
    return `(SELECT count(*) FROM weekly_reports w WHERE ${scope})=${expected.length}
      AND NOT EXISTS(SELECT 1 FROM json_each(${sql(JSON.stringify(expected))}) s WHERE NOT EXISTS(
        SELECT 1 FROM weekly_reports w WHERE ${scope} AND w.rowid=CAST(json_extract(s.value,'$.rowid') AS INTEGER) AND ${equal}))
      AND COALESCE((SELECT MAX(rowid) FROM weekly_quality_reviews WHERE ${resultScope(userId,month).join(' AND ')}),0)=${sql(basis.lastReview??0)}+0
      AND NOT EXISTS(SELECT 1 FROM performance_results WHERE ${finalMatch(userId,month)})`;
  }
  async function confirm(body,user) {
    if(body?.kind!=='quality')throw Error('results_auto_published');
    const {userId,month,version,reviewerName}=qualityWriteIdentity(body,user);
    await assertQualityUnlocked(userId,month);
    const readPolicy=policyReader(),readSchedule=scheduleReader();
    const monthPolicy=await readPolicy(month);
    function assertConfirmationOpen() {
      const instant=now();
      const blocked=qualityConfirmationBlock(month,shanghaiDate.format(instant),instant,monthPolicy,readSchedule);
      if(blocked)throw Error('quality_'+blocked);
    }
    assertConfirmationOpen();
    const basis={};
    const reports=await readReports(readData('prototypeData'),userId,readPolicy,month,readSchedule,basis);
    const quality=summarizeMonthlyQuality(reports);
    if(!quality.canConfirm)throw Error('quality_not_ready');
    if(version!==quality.version)throw Error('quality_candidate_changed');
    if(body.note!==undefined&&(typeof body.note!=='string'||body.note.length>4000))throw Error('quality_adjustment_reason_required');
    if(body.score!==undefined&&(typeof body.score!=='number'||!Number.isFinite(body.score)||body.score<0||body.score>100))throw Error('invalid_quality_score');
    const note=body.note?.trim()||'';
    const score=body.score===undefined?quality.candidateScore:qualityRound(body.score);
    if(score!==quality.candidateScore&&!note)throw Error('quality_adjustment_reason_required');
    const confirmedAt=now().toISOString(),confirmationId=randomUUID();
    const {name,department}=reports.find(report=>report.submitted&&!report.qualityExcluded);
    const result={score,status:'final',candidateScore:quality.candidateScore,reportCount:quality.expectedCount,publicationMode:'management_confirmation',version,confirmationId};
    const evidence={userId,name,department,publicationMode:result.publicationMode,qualityCandidate:quality.candidateScore,reports,
      reviewerId:user.userId,reviewerName,confirmedAt,reviewNote:note||'管理人员确认月度质量候选分',
      rule:'取当月有效周报候选分算术平均后由管理人员确认'};
    const audit={month,employeeUserId:userId,confirmationId,score,candidateScore:quality.candidateScore,reason:note};
    assertConfirmationOpen();
    await exec(`BEGIN IMMEDIATE;
      INSERT INTO performance_results(month,employee_user_id,employee_name,kind,result_json,evidence_json,confirmed_by,confirmed_at)
      SELECT ${sql(month)},${sql(userId)},${sql(name)},'quality',${sql(JSON.stringify(result))},${sql(JSON.stringify(evidence))},${sql(reviewerName)},${sql(confirmedAt)}
      WHERE ${qualityWriteGuard(userId,month,basis)};
      INSERT INTO system_operation_logs(id,actor_user_id,actor_name,action,details_json,created_at)
      SELECT ${sql(confirmationId)},${sql(user.userId)},${sql(reviewerName)},'月度周报质量最终分已确认',${sql(JSON.stringify(audit))},${sql(confirmedAt)} WHERE changes()=1;
      COMMIT;`);
    if(!(await query(`SELECT 1 AS saved FROM system_operation_logs WHERE id=${sql(confirmationId)};`)).length){
      await assertQualityUnlocked(userId,month);
      throw Error('quality_candidate_changed');
    }
    return {score,status:'final',confirmedBy:reviewerName,confirmedAt,version};
  }
  async function reviewQuality(body,user) {
    const {userId,month,version,reviewerName}=qualityWriteIdentity(body,user);
    const {reportId,action,reason}=body;
    if(typeof reportId!=='string'||!reportId||reportId.length>200||!['adjust_score','validate_evidence','mark_not_applicable','exclude_report','restore_report','reanalyze'].includes(action))throw Error('invalid_quality_review');
    if(typeof reason!=='string'||!reason.trim()||reason.length>4000)throw Error('quality_review_reason_required');
    await assertQualityUnlocked(userId,month);
    const basis={};
    const reports=await readReports(readData('prototypeData'),userId,policyReader(),month,scheduleReader(),basis);
    const report=reports.find(item=>item.id===reportId&&item.submitted);
    if(!report)throw Error('quality_report_not_found');
    if(version!==report.qualityReviewVersion)throw Error('quality_candidate_changed');
    if(action==='reanalyze'&&!basis.stored.some(item=>item.id===reportId))throw Error('quality_report_not_stored');
    const details={...qualityReviewDetails(report,body),previousCandidate:report.candidate};
    const id=randomUUID(),createdAt=now().toISOString();
    const audit={month,employeeUserId:userId,reportId,action,reason:reason.trim()};
    await exec(`BEGIN IMMEDIATE;
      INSERT INTO weekly_quality_reviews(id,month,employee_user_id,report_id,analysis_version,action,reason,details_json,reviewer_user_id,reviewer_name,created_at)
      SELECT ${sql(id)},${sql(month)},${sql(userId)},${sql(reportId)},${sql(qualityAnalysisVersion(report))},${sql(action)},${sql(reason.trim())},${sql(JSON.stringify(details))},${sql(user.userId)},${sql(reviewerName)},${sql(createdAt)}
      WHERE ${qualityWriteGuard(userId,month,basis)};
      INSERT INTO system_operation_logs(id,actor_user_id,actor_name,action,details_json,created_at)
      SELECT ${sql(id)},${sql(user.userId)},${sql(reviewerName)},'周报质量复核已记录',${sql(JSON.stringify(audit))},${sql(createdAt)} WHERE changes()=1;
      COMMIT;`);
    if(!(await query(`SELECT 1 AS saved FROM weekly_quality_reviews WHERE id=${sql(id)};`)).length){
      await assertQualityUnlocked(userId,month);
      throw Error('quality_candidate_changed');
    }
    return {id,action,reportId,userId,month};
  }
  return {overview,personal,confirm,reviewQuality,reports,reportById,createReportContext,assertReportContext};
}
