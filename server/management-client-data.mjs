// The browser adapter consumes a view of the management data, not the stored
// Feishu export. Keep source records and the default management endpoint intact.
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value!=null&&Object.hasOwn(value,key)).map(key=>[key,value[key]]));
const rows=(value,project)=>Array.isArray(value)?value.map(project):value;

const employeeFields=['姓名','部门','user_id','企业邮箱','周报数','准时次数','迟交次数','平均分','等级','自动等级','趋势','弱问题周数','人工校准说明','一句话成长判断'];
const weeklyFields=['user_id','姓名','部门','周期ID','周次','开始日期','结束日期','提交时间','源记录ID','状态','总分','等级','成果分','问题分','计划分','复盘分','准时分','数字个数','字数','本周成果摘要','问题摘要','下周计划摘要','思考与复盘摘要','相关文件','评论数','点赞数','已读数','未读数'];
const bossTaskFields=['优先级','来源人员','部门','主题','审核状态','建议任务标题','建议任务描述','建议负责人','建议负责人user_id','截止日期','证据'];
const employeeTaskFields=['优先级','来源人员','部门','负责人user_id','主题','建议任务标题','建议任务描述','建议负责人','截止日期','证据'];
const feedbackFields=['姓名','部门','user_id','建议发送方式','反馈草稿'];
const candidateFields=['id','priority','source','department','owner','ownerUserId','title','description','dueDate','metric','evidence','aiIntent','firstStep','supportNeeded','contextNeed'];
const attentionFields=['priority','source','department','theme','title','whyBoss','description','acceptance','owner','ownerUserId','dueDate','evidence'];

export function managementBootstrapData(data){
 const original=data?.meta||{},meta=pick(original,['generated_on','current_week_id','current_week_label','current_week_range','periods']);
 if(!Array.isArray(meta.periods)||!meta.periods.length){
  const periods=new Map(),numbers={一:'1',二:'2',三:'3',四:'4',五:'5',六:'6',七:'7',八:'8',九:'9',十:'10'};
  for(const row of data?.weekly_scores||[]){
   const week=String(row['周次']??'');if(!week||week.length>32)continue;
   const month=week.match(/(\d{1,2})月/),number=week.match(/第([一二三四五六七八九十\d]+)周/);
   const recorded=row['周期ID']==null?'':String(row['周期ID']);
   const id=recorded||(month&&number?month[1].padStart(2,'0')+'W'+(numbers[number[1]]||number[1]):week);
   if(!periods.has(id))periods.set(id,{id,label:week.split(/\s+/)[0]||week,range:week.split(/\s+/)[1]||'',start:row['开始日期'],end:row['结束日期'],submittedCount:0,exemptPeople:[],status:'历史'});
   periods.get(id).submittedCount++;
  }
  meta.periods=[...periods.values()];
 }
 return {prototypeData:{meta}};
}

function prototypeView(value){
 const projected=pick(value,['meta','group_message_draft']);
 for(const [key,fields] of [['employee_summary',employeeFields],['weekly_scores',weeklyFields],['boss_tasks',bossTaskFields],['employee_tasks',employeeTaskFields],['feedback_drafts',feedbackFields]]){
  if(value!=null&&Object.hasOwn(value,key))projected[key]=rows(value[key],row=>pick(row,fields));
 }
 return projected;
}

function insightView(value){
 const projected=pick(value,['meta','executiveSummary','companyMessageDraft']);
 for(const [key,fields] of [['collectiveFocus',['title','detail']],['attentionQueue',attentionFields],['mustReadReports',['userId','name','department','reason','focus','evidence']]]){
  if(value!=null&&Object.hasOwn(value,key))projected[key]=rows(value[key],row=>pick(row,fields));
 }
 if(value!=null&&Object.hasOwn(value,'themes'))projected.themes=rows(value.themes,row=>{
  const theme=pick(row,['label','value','severity','summary','detail','nextStep']);
  if(row!=null&&Object.hasOwn(row,'quotes'))theme.quotes=rows(row.quotes,quote=>pick(quote,['author','department','week','text']));
  return theme;
 });
 if(value!=null&&Object.hasOwn(value,'employeeInsights'))projected.employeeInsights=rows(value.employeeInsights,row=>{
  const insight=pick(row,['userId','name','coachSummary','coachQuestions']);
  if(row!=null&&Object.hasOwn(row,'taskCandidates'))insight.taskCandidates=rows(row.taskCandidates,candidate=>pick(candidate,candidateFields));
  return insight;
 });
 if(value!=null&&Object.hasOwn(value,'feishuTaskPlan'))projected.feishuTaskPlan=pick(value.feishuTaskPlan,['tasklistName','requiredScopes','creationMode']);
 return projected;
}

function meetingView(value){
 const projected=pick(value,['meta']);
 if(value!=null&&Object.hasOwn(value,'records'))projected.records=rows(value.records,record=>{
  const item=pick(record,['monthKey','meetingDate','status','model','generatedAt','executiveSummary']);
  if(record!=null&&Object.hasOwn(record,'comparison'))item.comparison=pick(record.comparison,['improvements','recurringIssues','newRisks']);
  return item;
 });
 return projected;
}

export function managementClientData(data){
 return {
  prototypeData:prototypeView(data.prototypeData),
  kimiInsights:insightView(data.kimiInsights),
  kimiInsightsByPeriod:Object.fromEntries(Object.entries(data.kimiInsightsByPeriod||{}).map(([id,value])=>[id,insightView(value)])),
  monthlyMeetingInsights:meetingView(data.monthlyMeetingInsights),
  // This legacy structure is passed through by the actual client adapter.
  // Do not strip scoring details based on today's empty local assignments.
  scoring360:data.scoring360,
 };
}
