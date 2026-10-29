import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createLiveReportSync,normalizeLiveReport,validateAnalysis} from '../server/live-report-sync.mjs';

// All upstream calls use fixtures. Databases and projections are retained.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/live-report-test-')),db=path.join(dir,'db.sqlite');
const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
const run=(statement,json=false)=>{
 const result=spawnSync('sqlite3',[...(json?['-json']:[]),db,statement],{encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr);
 return json?JSON.parse(result.stdout||'[]'):result.stdout;
};
try{
 run(await readFile('db/schema.sql','utf8'));
 const item={task_id:'t1',from_user_id:'ou_1',from_user_name:'测试员工',department_name:'产品',rule_id:'r1',rule_name:'周报（聚焦结果与协作）',commit_time:Math.floor(Date.parse('2026-10-16T19:00:00+08:00')/1000),form_contents:[{field_name:'本周成果（只写最重要的）',field_value:'完成3项验收'},{field_name:'问题与挑战',field_value:'接口待确认'},{field_name:'下周工作计划与目标',field_value:'完成接口验证'},{field_name:'思考与复盘',field_value:'提前确认验收口径'}]};
 assert.equal(normalizeLiveReport(item).end,'2026-10-16');
 assert.equal(normalizeLiveReport({...item,commit_time:Math.floor(Date.parse('2026-10-19T10:00:00+08:00')/1000)}).end,'2026-10-16');
 assert.throws(()=>validateAnalysis({scores:[101,0,0,0],summary:'invalid'}));
 let calls=0,pages=0,status,failAi=false,incoming=[item,{...item,task_id:'other',rule_id:'other',rule_name:'日报'}],stopOnPause='',stopBeforeImport='',stopAfterAi='',invalidateHistoryOnPause='',invalidateHistoryAfterAi='';
 const observed=[],settings={overview:async()=>({report:{templateName:item.rule_name,ruleId:'r1'}}),policyFor:async()=>({deadlineTime:'20:00'})};
 const config={dataDir:dir,feishuAppId:'cli_test',feishuAppSecret:'secret',moonshotApiKey:'key',moonshotBaseUrl:'https://api.example.com/v1',kimiFollowupModel:'test'};
 const fetcher=async(url,options)=>{
  let value;
  if(url==='https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal')value={code:0,tenant_access_token:'token'};
  else if(url==='https://open.feishu.cn/open-apis/report/v1/tasks/query?user_id_type=user_id'){
   pages++;const next=JSON.parse(options.body).page_token;
   value={code:0,data:{items:next?[]:incoming,has_more:!next,page_token:'next'}};
  }else{
   assert.equal(url,'https://api.example.com/v1/chat/completions','all upstream requests remain fixture-only');
   calls++;
   if(stopAfterAi){run(`UPDATE employees SET is_active=0 WHERE user_id=${sql(stopAfterAi)};`);stopAfterAi='';}
   if(invalidateHistoryAfterAi){run(`UPDATE employee_employment_periods SET end_date='2026-10-15' WHERE employee_user_id=${sql(invalidateHistoryAfterAi)};`);invalidateHistoryAfterAi='';}
   if(failAi)return {ok:false,status:429,json:async()=>({error:{type:'rate_limit'}})};
   value={choices:[{message:{content:JSON.stringify({scores:[90,80,85,75],summary:'AI 测试点评',questions:['请核实接口验收标准'],tasks:[{title:'确认接口',description:'与负责人确认验收标准',priority:'P1',evidence:'接口待确认'}]})}}]};
  }
  return {ok:true,status:200,json:async()=>value};
 };
 const sync=createLiveReportSync({
  query:async statement=>{
   if(stopBeforeImport&&statement===`SELECT is_active FROM employees WHERE user_id=${sql(stopBeforeImport)};`){run(`UPDATE employees SET is_active=0 WHERE user_id=${sql(stopBeforeImport)};`);stopBeforeImport='';}
   return run(statement,true);
  },exec:async statement=>run(statement),sql,config,settings,
  observeEmployee:async userId=>{observed.push(userId);},refreshDirectory:async()=>{},writeStatus:async value=>{status=value;},
  pause:async()=>{if(stopOnPause){run(`UPDATE employees SET is_active=0 WHERE user_id=${sql(stopOnPause)};`);stopOnPause='';}if(invalidateHistoryOnPause){run(`UPDATE employee_employment_periods SET end_date='2026-10-15' WHERE employee_user_id=${sql(invalidateHistoryOnPause)};`);invalidateHistoryOnPause='';}},fetcher
 });
 const options={start:'2026-10-01',end:'2026-10-23'};
 const count=table=>run(`SELECT COUNT(*) AS n FROM ${table};`,true)[0].n;
 const savedReports=userId=>run(`SELECT * FROM weekly_reports WHERE employee_user_id=${sql(userId)} ORDER BY id;`,true);
 await sync.run(options);
 assert.equal(status.ok,true);assert.equal(pages,2);assert.equal(calls,1);assert.equal(count('weekly_reports'),1);
 let data=JSON.parse(await readFile(path.join(dir,'prototypeData.json')));
 assert.equal(data.weekly_scores.length,1);assert.equal(data.weekly_scores[0]['总分'],83.3);
 const insights=JSON.parse(await readFile(path.join(dir,'kimiInsightsByPeriod.json')));
 assert.equal(insights['period-2026-10-16'].employeeInsights[0].coachSummary,'AI 测试点评');
 assert.equal(insights['period-2026-10-16'].attentionQueue.length,1);
 await sync.run(options);assert.equal(calls,1,'unchanged reports reuse cached analysis');assert.equal(count('weekly_reports'),1);
 config.kimiFollowupModel='new-test-model';failAi=true;
 await sync.run(options);assert.equal(status.phase,'partial');assert.equal(status.failed,1);assert.equal(count('weekly_reports'),1,'AI failure retains the source report');
 failAi=false;await sync.run(options);assert.equal(status.ok,true);assert.equal(status.analyzed,1,'retry completes previously failed analysis');
 await assert.rejects(sync.run({start:'bad',end:'2026-10-23'}),/invalid_sync_dates/);

 // Retain a real historical fixture, then stop its account. A fresh report from
 // that account must not update its history or trigger another analysis.
 const stopped={...item,task_id:'stopped-history',from_user_id:'stopped-member',from_user_name:'已停用同事',commit_time:item.commit_time-7*86400};
 incoming=[stopped];await sync.run(options);
 run("UPDATE employees SET is_active=0 WHERE user_id='stopped-member';");
 const retained=savedReports('stopped-member'),stoppedEmployee=run("SELECT * FROM employees WHERE user_id='stopped-member';",true);
 const changedStopped={...stopped,task_id:'stopped-new',commit_time:item.commit_time,form_contents:[...item.form_contents,{field_name:'额外内容',field_value:'不应进入系统'}]};
 const newActive={...item,task_id:'active-new',from_user_id:'new-member',from_user_name:'新员工'};
 incoming=[item,newActive,changedStopped];const beforeMixed=calls,observedBefore=observed.length;
 await sync.run(options);
 assert.equal(status.ok,true);assert.equal(status.rowCount,2);assert.equal(status.skippedInactive,1);assert.equal(status.skippedInactiveAnalysis,0);
 assert.equal(calls,beforeMixed+1,'active cache is reused and only the new active member needs AI');
 assert.deepEqual(savedReports('stopped-member'),retained,'stopped history is preserved without new rows');
 assert.deepEqual(run("SELECT * FROM employees WHERE user_id='stopped-member';",true),stoppedEmployee,'sync never reactivates the stopped member');
 assert.deepEqual(observed.slice(observedBefore),['ou_1','new-member'],'excluded reports do not observe employment dates');
 assert.equal(run('SELECT record_count FROM import_batches ORDER BY rowid DESC LIMIT 1;',true)[0].record_count,2);
 data=JSON.parse(await readFile(path.join(dir,'prototypeData.json')));
 assert(data.weekly_scores.some(row=>row.user_id==='stopped-member'&&row['结束日期']==='2026-10-09'),'existing historical projections are preserved');
 assert(!data.employee_summary.some(row=>row.user_id==='stopped-member'),'active roster projection excludes the stopped account');

 const beforeAllStopped={calls,batches:count('import_batches'),reports:count('weekly_reports'),observed:observed.length,projection:await readFile(path.join(dir,'prototypeData.json'),'utf8')};
 incoming=[changedStopped];config.kimiFollowupModel='another-model';failAi=true;
 for(let attempt=0;attempt<2;attempt++){
  await sync.run(options);assert.equal(status.ok,true);assert.equal(status.phase,'done');assert.equal(status.rowCount,0);assert.equal(status.skippedInactive,1);
  assert.match(status.message,/已跳过 1 份已停用人员汇报/);
 }
 assert.equal(calls,beforeAllStopped.calls,'all-stopped repeated batches never call AI, even after model changes');
 assert.equal(count('import_batches'),beforeAllStopped.batches,'all-stopped batches do not create empty imports');
 assert.equal(count('weekly_reports'),beforeAllStopped.reports);assert.equal(observed.length,beforeAllStopped.observed);
 assert.equal(await readFile(path.join(dir,'prototypeData.json'),'utf8'),beforeAllStopped.projection,'no-work sync leaves projections unchanged');
 assert.deepEqual(savedReports('stopped-member'),retained);

 // Stop after the initial snapshot but before import. The fresh status check
 // must still avoid both a report row and an empty import batch.
 failAi=false;const beforeImport={...item,task_id:'before-import',from_user_id:'before-import',from_user_name:'导入前停用'};
 run("INSERT INTO employees(user_id,name,is_active) VALUES('before-import','导入前停用',1);");
 incoming=[beforeImport];stopBeforeImport='before-import';const beforeImportBatches=count('import_batches'),beforeImportCalls=calls;
 await sync.run(options);assert.equal(status.skippedInactive,1);assert.equal(status.rowCount,0);assert.equal(count('import_batches'),beforeImportBatches);assert.equal(calls,beforeImportCalls);assert.deepEqual(savedReports('before-import'),[]);

 // A stop during the AI queue wait cancels that work while another active
 // member still completes. Source rows already imported are retained.
 const queued={...item,task_id:'queue-stop',from_user_id:'queue-stop',from_user_name:'排队时停用'},otherQueued={...item,task_id:'queue-active',from_user_id:'queue-active',from_user_name:'继续分析的同事'};
 incoming=[queued,otherQueued];stopOnPause='queue-stop';const beforeQueue=calls;
 await sync.run(options);assert.equal(status.ok,true);assert.equal(status.failed,0);assert.equal(status.rowCount,2);assert.equal(status.skippedInactiveAnalysis,1);assert.equal(status.analyzed,1);assert.equal(calls,beforeQueue+1);
 assert.equal(savedReports('queue-stop').length,1,'already-imported source remains available');
 assert.equal(JSON.parse(savedReports('queue-stop')[0].content_json).ai,undefined,'stopped queued work never reaches AI');
 assert(JSON.parse(savedReports('queue-active')[0].content_json).ai,'active queued work completes');

 const completed={...item,task_id:'stop-in-flight',from_user_id:'stop-in-flight',from_user_name:'请求期间停用'};
 incoming=[completed];stopAfterAi='stop-in-flight';const beforeInFlight=calls;
 await sync.run(options);assert.equal(calls,beforeInFlight+1);assert.equal(status.skippedInactiveAnalysis,1);assert.equal(status.analyzed,0);assert.equal(status.failed,0);
 assert.equal(JSON.parse(savedReports('stop-in-flight')[0].content_json).ai,undefined,'a response arriving after a stop is not applied');

 // An explicit internal maintenance allowlist permits only fully closed past
 // employment weeks. It does not reactivate accounts or expand their dates.
 const historicalIds=['history-selected','history-unselected','history-open','history-partial','history-future-end','history-future-report'];
 run(historicalIds.map(id=>`INSERT INTO employees(user_id,name,is_active) VALUES(${sql(id)},${sql(id)},0);`).join(''));
 run(`INSERT INTO employee_employment_periods(id,employee_user_id,start_date,end_date,source) VALUES
 ('history-selected-period','history-selected','2026-10-01','2026-10-20','manager'),
 ('history-unselected-period','history-unselected','2026-10-01','2026-10-20','manager'),
 ('history-open-period','history-open','2026-10-01',NULL,'report'),
 ('history-partial-period','history-partial','2026-10-13','2026-10-20','manager'),
 ('history-future-end-period','history-future-end','2026-10-01','2999-12-31','manager'),
 ('history-future-report-period','history-future-report','2026-10-01','2026-10-20','manager');`);
 const historicalEmployees=run("SELECT * FROM employees WHERE user_id LIKE 'history-%' ORDER BY user_id;",true),historicalPeriods=run("SELECT * FROM employee_employment_periods WHERE employee_user_id LIKE 'history-%' ORDER BY id;",true);
 incoming=historicalIds.map(id=>({...item,task_id:id,from_user_id:id,from_user_name:id,...(id==='history-future-report'?{commit_time:Date.parse('2999-01-04T19:00:00+08:00')/1000}:{})}));
 const historyBefore={calls,batches:count('import_batches'),observed:observed.length};
 await sync.run(options);assert.equal(status.rowCount,0);assert.equal(status.skippedInactive,6);assert.equal(calls,historyBefore.calls);assert.equal(count('import_batches'),historyBefore.batches,'default sync still ignores every inactive account');
 const historyOptions={...options,historicalInactiveUserIds:historicalIds.filter(id=>id!=='history-unselected')};
 await sync.run(historyOptions);
 assert.equal(status.ok,true);assert.equal(status.rowCount,1);assert.equal(status.analyzed,1);assert.equal(status.historicalInactiveReports,1);assert.equal(status.skippedInactive,5);assert.equal(calls,historyBefore.calls+1);
 assert(JSON.parse(savedReports('history-selected')[0].content_json).ai,'selected closed history receives valid AI scores');
 for(const id of historicalIds.filter(id=>id!=='history-selected'))assert.deepEqual(savedReports(id),[],'unlisted, open, partial and future history remain excluded: '+id);
 assert.deepEqual(run("SELECT * FROM employees WHERE user_id LIKE 'history-%' ORDER BY user_id;",true),historicalEmployees,'backfill cannot reactivate or modify historical staff');
 assert.deepEqual(run("SELECT * FROM employee_employment_periods WHERE employee_user_id LIKE 'history-%' ORDER BY id;",true),historicalPeriods,'backfill cannot reopen or rewrite employment history');
 assert.equal(observed.length,historyBefore.observed,'historical backfill never observes a new employment interval');
 await sync.run(historyOptions);assert.equal(status.rowCount,1);assert.equal(status.analyzed,0);assert.equal(status.historicalInactiveReports,1);assert.equal(calls,historyBefore.calls+1,'explicit backfill reuses validated cached scores');
 const beforeMalformed={calls,pages,reports:count('weekly_reports')};
 for(const historicalInactiveUserIds of [null,'history-selected',{},[''],[' history-selected'],[1],Array(501).fill('history-selected')])await assert.rejects(sync.run({...options,historicalInactiveUserIds}),/invalid_historical_inactive_users/);
 assert.equal(calls,beforeMalformed.calls);assert.equal(pages,beforeMalformed.pages);assert.equal(count('weekly_reports'),beforeMalformed.reports,'malformed overrides fail before any source read or write');

 // The closed-range guard is checked again after queue waits and responses.
 for(const [id,hook] of [['history-queue-invalid','queue'],['history-response-invalid','response']]){
  run(`INSERT INTO employees(user_id,name,is_active) VALUES(${sql(id)},${sql(id)},0); INSERT INTO employee_employment_periods(id,employee_user_id,start_date,end_date,source) VALUES(${sql(id+'-period')},${sql(id)},'2026-10-01','2026-10-20','manager');`);
  incoming=[{...item,task_id:id,from_user_id:id,from_user_name:id}];
  if(hook==='queue')invalidateHistoryOnPause=id;else invalidateHistoryAfterAi=id;
  const beforeGuard=calls;await sync.run({...options,historicalInactiveUserIds:[id]});
  assert.equal(status.rowCount,1);assert.equal(status.analyzed,0);assert.equal(status.skippedInactiveAnalysis,1);assert.equal(calls,beforeGuard+(hook==='response'?1:0));
  assert.equal(JSON.parse(savedReports(id)[0].content_json).ai,undefined,'withdrawn closed history does not accept AI results');
  assert.equal(run(`SELECT is_active FROM employees WHERE user_id=${sql(id)};`,true)[0].is_active,0);
 }
 for(const table of ['weekly_reminder_sends','monthly_score_reminder_deliveries','scoring360_reminder_sends'])assert.equal(count(table),0,'historical import does not schedule or deliver reminders');
 assert.equal(run('PRAGMA integrity_check;').trim(),'ok');
 console.log('live report sync tests passed: pagination, templates, normalization, AI validation, persistence, historical projections, cache/retry, inactive mixed/all batches, no empty imports, pre-import/queued/in-flight stop, closed-history maintenance allowlist and rechecks, no reactivation, zero real upstream requests');
}finally{console.log('Test artifacts retained:',dir);}
