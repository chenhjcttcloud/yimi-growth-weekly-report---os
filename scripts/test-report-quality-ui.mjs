import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// Build and serve isolated assets. APIs use synthetic fixtures; no application
// database, integration credentials, external service or existing output is used.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/report-quality-ui-'));
const staticDir=process.env.TEST_STATIC_DIR?path.resolve(process.env.TEST_STATIC_DIR):path.join(dir,'dist');
const build=process.env.TEST_STATIC_DIR?{status:0,stdout:'',stderr:''}:spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',staticDir,'--emptyOutDir','false'],{encoding:'utf8'});
assert.equal(build.status,0,build.stdout+'\n'+build.stderr);
const contentTypes={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  const filename=path.resolve(staticDir,'.'+pathname);
  if(!filename.startsWith(staticDir+path.sep)&&filename!==staticDir){response.writeHead(403);response.end();return;}
  try{
    const target=pathname==='/'?path.join(staticDir,'index.html'):filename;
    const bytes=await readFile(target);
    response.writeHead(200,{'content-type':contentTypes[path.extname(target)]||'application/octet-stream'});response.end(bytes);
  }catch{response.writeHead(404);response.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const month='2026-10',weekId='period-2026-10-16';
const weights=[30,25,25,20];
const quote='【虚构测试】完成5家客户拜访并签约2家，合同金额50万元。';
const reasons={module:'写明了完成结果与数据，尚未说明该结果对团队目标的贡献。',criterion:'原文记录了具体完成数量与签约情况，支持本项得分。'};
const evidence=[{quote,type:'reported_fact',level:'B',start:0,end:quote.length}];
const modules=[['results','本周成果',[10,8,7,5]],['problems','问题与挑战',[8,7,6,4]],['nextPlan','下周计划',[7,6,5,4,3]],['reflection','思考与复盘',[5,6,5,4]]].map(([id,module,maxima],index)=>({
  id,module,candidateScore:index===3?0:80,maxScore:100,
  reason:index===3?'本模块未填写，系统按固定规则计0分。':reasons.module,
  missing:index===3?['未填写本模块']:['未说明与团队目标的对应关系'],confidence:index===3?null:0.86,evidence:index===3?[]:evidence,evidenceLevel:index===3?'D':'B',strengths:['具体完成数量可从内部记录核验'],deductions:['缺少团队目标的对应关系'],
  criteria:maxima.map((maxScore,position)=>({id:id+'-'+position,label:position===0?'具体结果或目标':'评分项 '+(position+1),maxScore,score:index===3?0:maxScore*.8,
    standard:'描述清楚且有直接原文依据得满分，信息部分缺失按完整性给分，没有有效内容得0分。',
    reason:index===3?'本模块没有有效原文。':reasons.criterion,missing:index===3?['未填写本模块']:[],evidence:index===3?[]:evidence,
    ...(index===0&&position===3?{applicable:false,notApplicableReason:'本项不属于该岗位的交付范围。'}:{applicable:true,evidenceLevel:index===3?'D':'B'})})),
}));
const anomaly='虚构测试：同一结果的两处数据不一致';
const assessment={version:'weekly-quality-v2-test',promptVersion:'internal-prompt-version',model:'fixture-model',generatedAt:'2026-11-02T08:00:00Z',sourceHash:'isolated-fixture-source',anomalies:[anomaly],totalScore:64,evidenceLevel:'B',confidence:0.86,factConflict:true,recommendHumanReview:true,modules};
const employee={userId:'fixture-staff',name:'虚构测试员工',department:'虚构测试团队'};
const supervisor={userId:'fixture-supervisor',name:'虚构测试主管',department:employee.department};
const timeliness={expected:1,submitted:1,onTime:0,late:1,missing:0,pendingTimestamp:0,pendingCalendar:0,rate:0};
const period={id:weekId,label:'2026年10月第3周',start:'2026-10-12',end:'2026-10-16',range:'10/12 — 10/16'};
const reportHeader={id:'fixture-report',employeeUserId:employee.userId,name:employee.name,department:employee.department,month,start:period.start,end:period.end,submittedAt:'2026-10-16T13:00:00Z',status:'迟交',submitted:true,candidate:64,scoringPolicy:{weights},detailsDeferred:true};
const fourthReport={...reportHeader,id:'fixture-fourth-report',start:'2026-10-19',end:'2026-10-23',submittedAt:'2026-10-23T11:00:00Z',status:'准时'};
const unsubmittedReport={...reportHeader,id:'fixture-unsubmitted',start:'2026-10-26',end:'2026-10-30',submittedAt:'',status:'未交',submitted:false,candidate:null};
const monthly={...employee,month,reports:[reportHeader,unsubmittedReport,fourthReport],timeliness,peerCandidate:null,collaborationExpected:0,collaborationSubmitted:0,managerProgress:{kind:'manager',expected:0,submitted:0,complete:false,score:null}};
const fourWeekMonth='2026-11';
const emptyMonthOverview={scopeMonth:fourWeekMonth,months:[fourWeekMonth],employees:[employee],monthly:[{...monthly,month:fourWeekMonth,reports:[],timeliness:{...timeliness,expected:0,submitted:0,late:0}}],collaborations:[],results:[]};
const version='a'.repeat(64);
const reportVersion='b'.repeat(64);
let mode='management',state='ready',qualityState='pending_ai',detailRequests=0,confirmedScore=null,historicalFinal=false;
let confirmationBlockedReason;
const reviewRequests=[],confirmRequests=[],qualityReviews=[];
const unhandledRoutes=new Set(),errors=[];
const currentAssessment=()=>state==='ready'?assessment:null;
const currentScore=()=>state==='pending'?null:64;
const quality=()=>({status:qualityState,currentAverage:64,candidateScore:qualityState==='pending_ai'?null:64,finalScore:confirmedScore,pendingAnalysis:qualityState==='pending_ai'&&!confirmationBlockedReason?1:0,analyzedCount:1,expectedCount:qualityState==='pending_ai'&&!confirmationBlockedReason?2:1,canConfirm:false,publicationMode:historicalFinal?'management_confirmed':'automatic',confirmationBlockedReason,version,...(qualityState==='final'?{confirmedBy:historicalFinal?supervisor.name:'系统自动计算',confirmedAt:'2026-11-02T08:00:00Z'}:{})});
const resultRows=()=>qualityState==='final'?[{month,employee_user_id:employee.userId,kind:'quality',result:{score:confirmedScore,finalScore:confirmedScore,status:'final',publicationMode:historicalFinal?'management_confirmed':'automatic'},scoring_rule:historicalFinal?'management_confirmed':'automatic_report',confirmed_by:historicalFinal?supervisor.name:'系统自动计算',confirmed_at:'2026-11-02T08:00:00Z',evidenceSummary:{qualityCandidate:64}}]:[];
const overview=()=>({scopeMonth:month,months:[month],employees:[employee],monthly:[{...monthly,quality:quality()}],collaborations:[],results:resultRows()});
function personalWorkspace(){return {
  employee,months:[month],month,selectedWeekId:weekId,monthSummary:{...timeliness,upcoming:0},
  weeks:[{...period,dueAt:'2026-10-16T20:00:00+08:00',schedule:{reason:'normal_friday'},status:'迟交',submitted:true,submittedAt:reportHeader.submittedAt,
    facts:{results:quote,problems:'【虚构测试】接口响应缓慢，需要支持。',plan:'【虚构测试】周五前完成验证。',reflection:''},qualityReference:currentScore(),qualityAssessment:currentAssessment(),scoringWeights:weights,radar:[],closure:{}}],
  history:[{month,quality:confirmedScore,monthlyQuality:{...quality(),canConfirm:false},timeliness,collaboration:null}],tasks:[],comments:[],messages:[],likeCount:0,liked:false,analysis:null,aiConfigured:false,taskCreateEnabled:false,
};}
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base){unhandledRoutes.add(url.origin);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    let body;
    switch(url.pathname){
      case '/api/management-data':body={prototypeData:{meta:{periods:[period],current_week_id:weekId}}};break;
      case '/api/me':{
        const user=mode==='supervisor'?supervisor:employee;
        body={user,access:{role:mode==='management'?'hr':'member',currentEmployee:user,visibleEmployees:[user],canManageScoring360:mode==='management',canReviewWeeklyQuality:mode==='supervisor',canViewSettings:mode==='management',canManagePersonnel:mode==='management',canViewBossDashboard:false}};break;
      }
      case '/api/performance/manage':assert.equal(mode,'management');body=url.searchParams.get('month')===fourWeekMonth?emptyMonthOverview:overview();break;
      case '/api/performance/quality-scope':assert.equal(mode,'supervisor');assert.equal(url.searchParams.get('month'),month);body={employees:[employee],months:[month]};break;
      case '/api/performance/employee-month':{
        detailRequests++;
        assert.equal(url.searchParams.get('employeeId'),employee.userId);
        assert.equal(url.searchParams.get('month'),month);
        body={monthly:{...monthly,quality:quality(),reports:[{...reportHeader,candidate:currentScore(),qualityAssessment:currentAssessment(),qualityReviewVersion:reportVersion,qualityReviews,contentDeferred:true,contentVersion:'fixture-v1',evidence:[{module:'本周成果摘要',text:quote}],anomalies:['测试异常：分数波动仅作提示'],suggestions:'请在后续周报中补充目标贡献说明。'},{...unsubmittedReport,evidence:[],anomalies:[]},{...fourthReport,evidence:[{module:'本周成果摘要',text:'第四周虚构成果'}],anomalies:[]}]},collaborations:[],results:resultRows()};break;
      }
      case '/api/performance/quality-review':{
        assert.equal(mode,'management');
        const review=route.request().postDataJSON();reviewRequests.push(review);
        qualityReviews.push({...review,details:{quote:review.quote},createdAt:'2026-11-02T08:00:00Z',reviewerName:supervisor.name});body={ok:true};break;
      }
      case '/api/performance/confirm':{
        confirmRequests.push(route.request().postDataJSON());
        return route.fulfill({status:409,json:{ok:false,error:'results_auto_published'}});
      }
      case '/api/manager-reviews':body={month,canReview:false,hasResponsibilities:false,tasks:[]};break;
      case '/api/personal/workspace':body=personalWorkspace();break;
      case '/api/dev/views':body={ok:false};break;
      case '/api/usage/visit':case '/api/usage/heartbeat':body={ok:true};break;
      default:unhandledRoutes.add(url.pathname);body={error:'unexpected_fixture_request'};
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/?page=scores&scoreMonth='+month);
  await page.getByRole('heading',{name:'员工月度结果',exact:true}).waitFor();
  assert(await page.locator('.pf-metrics').getByText('当前已完成分析均分',{exact:true}).isVisible());
  assert.equal(await page.getByText('周报质量最终均分',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'确认月度最终分'}).count(),0);
  assert.equal(detailRequests,0,'scoring details must remain lazy on the overview');
  for(const [reason,note] of [['month_open','本月尚未结束。'],['collection_pending','本月周报尚未收集完成。']]){
    confirmationBlockedReason=reason;
    await page.reload();
    await page.locator('.pf-confirm-list').getByText('当前已完成分析均分 · 64.0 分',{exact:true}).waitFor();
    assert(await page.locator('.pf-confirm-list').getByText(note,{exact:false}).isVisible());
    assert(await page.locator('.pf-metrics').getByText('当前已完成分析均分',{exact:true}).isVisible());
    assert.equal(await page.getByText('月度质量候选均分',{exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'确认月度最终分'}).count(),0);
    assert.equal(confirmRequests.length,0);
  }
  confirmationBlockedReason=undefined;
  await page.reload();
  await page.getByRole('heading',{name:'员工月度结果',exact:true}).waitFor();
  await page.getByRole('tab',{name:'周报与证据',exact:true}).click();
  const assessmentPanel=page.getByRole('region',{name:'四模块评分说明'});
  await page.getByText('第四周虚构成果',{exact:true}).waitFor();
  const weekButtons=page.getByRole('group',{name:'周报周次'});
  const weekButton=week=>weekButtons.getByRole('button',{name:`第 ${week} 周`,exact:true});
  const reportCards=page.locator('[data-report-week]:visible');
  assert.equal(await weekButtons.getByRole('button').count(),5);
  assert.equal(await weekButton(4).getAttribute('aria-pressed'),'true');
  assert.equal(await reportCards.count(),1);
  assert.equal(await reportCards.getAttribute('data-report-week'),fourthReport.end);
  const requestsBeforeSwitch=detailRequests;
  await weekButton(1).click();
  await page.getByText('本周暂无周报记录',{exact:true}).waitFor();
  assert.equal(await reportCards.count(),0);
  await weekButton(5).click();
  await reportCards.getByText('未交',{exact:true}).waitFor();
  assert.equal(await reportCards.count(),1);
  assert.equal(await reportCards.getAttribute('data-report-week'),unsubmittedReport.end);
  await weekButton(3).click();
  assert.equal(detailRequests,requestsBeforeSwitch);
  await page.setViewportSize({width:390,height:844});
  assert(await weekButtons.evaluate(element=>element.scrollWidth<=element.clientWidth));
  await page.setViewportSize({width:1440,height:1100});
  const linkedWeekUrl=new URL(page.url());
  linkedWeekUrl.searchParams.set('scoreWeekId',period.id);
  await page.goto(linkedWeekUrl.href);
  await assessmentPanel.getByText('AI 候选',{exact:true}).waitFor();
  assert.equal(await weekButton(3).getAttribute('aria-pressed'),'true');
  assert(await assessmentPanel.getByText(anomaly,{exact:true}).isVisible(),'management must display the non-blocking anomaly');
  assert(detailRequests>0,'the management detail endpoint must provide the assessment');
  assert.equal(await assessmentPanel.locator('[data-quality-module]').count(),4);
  const first=assessmentPanel.locator('[data-quality-module="results"]');
  assert(await first.getByText(reasons.module,{exact:true}).isVisible());
  assert(await first.getByText(reasons.criterion).first().isHidden(),'historical fine-grained scoring is collapsed by default');
  await first.locator('.quality-legacy-details>summary').click();
  assert(await first.getByText(reasons.criterion).first().isVisible());
  assert(await first.getByText(quote,{exact:true}).first().isVisible());
  assert(await first.getByText('置信度（模型自评）：86%',{exact:true}).isVisible());
  assert(await first.getByText('计入总分 24 分',{exact:true}).isVisible());
  assert.equal(await assessmentPanel.getByText('证据等级',{exact:false}).count(),0,'saved grades do not become evidence demands');
  assert(await first.getByText('本项不属于该岗位的交付范围。').isVisible());
  assert(await first.getByText('做得好',{exact:true}).isVisible());
  assert(await first.getByText('可以补充',{exact:true}).isVisible());
  await assessmentPanel.locator('[data-quality-module="reflection"]>summary').click();
  assert(await assessmentPanel.getByText('本模块未填写，系统按固定规则计0分。',{exact:true}).isVisible());
  assert.equal(await page.getByRole('button',{name:'确认月度最终分'}).count(),0);
  assert(await assessmentPanel.getByText('发现可能的事实冲突 · 建议重点人工复核',{exact:true}).isVisible());
  await assessmentPanel.evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(dir,'management-desktop.png'),fullPage:true});
  const reviewReason='虚构测试管理内部备注';
  await page.getByText('复核这份周报',{exact:true}).click();
  await page.getByLabel('复核操作').selectOption('validate_evidence');
  await page.getByLabel('评分模块').selectOption('results');
  await page.getByLabel('评分子项').selectOption('results-0');
  assert.equal(await page.getByLabel('已核验的周报原文').inputValue(),quote);
  await page.getByLabel('复核原因').fill(reviewReason);
  await weekButton(4).click();
  await reportCards.getByText('第四周虚构成果',{exact:true}).waitFor();
  assert(await page.getByLabel('复核原因').isHidden());
  await weekButton(3).click();
  assert.equal(await page.getByLabel('复核原因').inputValue(),reviewReason);
  assert.equal(await page.getByLabel('已核验的周报原文').inputValue(),quote);
  await page.getByRole('button',{name:'保存复核'}).click();
  await page.getByText('人工复核记录（1）',{exact:true}).click();
  assert(await page.getByText(reviewReason,{exact:true}).isVisible());
  assert.deepEqual(reviewRequests,[{reportId:reportHeader.id,userId:employee.userId,month,version:reportVersion,action:'validate_evidence',reason:reviewReason,moduleId:'results',criterionId:'results-0',quote}]);

  await page.goto(base+'/?'+new URLSearchParams({page:'quality-scores',scoreMonth:fourWeekMonth,scoreEmployeeId:employee.userId,scoreDetailTab:'reports'}));
  await weekButtons.waitFor();
  assert.deepEqual(await weekButtons.getByRole('button').allTextContents(),['第 1 周','第 2 周','第 3 周','第 4 周']);
  assert.equal(await weekButton(1).getAttribute('aria-pressed'),'true');
  await page.getByText('本周暂无周报记录',{exact:true}).waitFor();

  mode='personal';
  const personalUrl=base+'/?page=quality-scores&personalUser='+employee.userId+'&personalMonth='+month;
  await page.goto(personalUrl);
  await page.getByText('AI 候选',{exact:true}).waitFor();
  assert(await page.getByText('当前已完成分析均分',{exact:true}).isVisible());
  assert(await page.getByText('待完成 AI 分析 1 份',{exact:false}).isVisible());
  assert.equal(await page.getByRole('columnheader',{name:'质量最终分'}).count(),0);
  assert(await page.locator('.quality-assessment').getByText(anomaly,{exact:true}).isVisible(),'employees must also see the same non-blocking anomaly');
  await page.locator('[data-quality-module="results"] .quality-legacy-details>summary').click();
  assert(await page.locator('[data-quality-module="results"]').getByText(reasons.criterion).first().isVisible());
  assert(await page.locator('[data-quality-module="results"]').getByText(quote,{exact:true}).first().isVisible());
  assert.equal(await page.getByRole('button',{name:'确认月度最终分'}).count(),0);
  assert.equal(await page.getByText(reviewReason,{exact:true}).count(),0);
  await page.locator('.quality-assessment').evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(dir,'personal-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.locator('.quality-assessment').evaluate(element=>element.scrollWidth<=element.clientWidth),'scoring evidence must fit a mobile viewport');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile page must not overflow horizontally');
  await page.locator('.quality-assessment').evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(dir,'personal-mobile.png'),fullPage:true});

  confirmationBlockedReason='month_open';
  await page.reload();
  const personalMetrics=page.locator('.pf-metrics');
  await personalMetrics.getByText('本月尚未结束。',{exact:false}).waitFor();
  assert(await personalMetrics.getByText('当前已完成分析均分',{exact:true}).isVisible());
  assert(await personalMetrics.getByText('64.0',{exact:false}).isVisible());
  assert.equal(await personalMetrics.getByText('待完成 AI 分析 0 份',{exact:false}).count(),0);
  assert.equal(await page.getByRole('button',{name:'确认月度最终分'}).count(),0);
  confirmationBlockedReason=undefined;
  qualityState='pending_confirmation';
  await page.reload();
  await page.getByText('月度质量参考均分',{exact:true}).waitFor();
  assert(await page.getByText('等待自动生成',{exact:true}).isVisible());
  assert.equal(await page.getByRole('button',{name:'确认月度最终分'}).count(),0);
  assert.equal(confirmRequests.length,0,'opening an AI candidate never confirms it');

  mode='management';
  qualityState='final';confirmedScore=64;
  await page.setViewportSize({width:1440,height:1100});
  await page.goto(base+'/?page=quality-scores&scoreMonth='+month);
  await page.getByText('月度周报质量最终分 · 64.0 分',{exact:true}).waitFor();
  assert(await page.locator('.pf-confirm-list').getByText('已自动生成',{exact:true}).isVisible());
  assert.deepEqual(confirmRequests,[],'viewing an automatic final never submits a confirmation');
  assert.equal(await page.getByRole('button',{name:'确认月度最终分'}).count(),0);
  assert.equal(await page.getByLabel('调整分数后确认').count(),0);
  await page.locator('.content-shell').evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:path.join(dir,'automatic-final-management.png'),fullPage:true});
  confirmedScore=0;
  await page.reload();
  await page.getByText('月度周报质量最终分 · 0.0 分',{exact:true}).waitFor();
  assert(await page.locator('.pf-confirm-list').getByText('已自动生成',{exact:true}).isVisible(),'a valid automatic zero is final');
  confirmedScore=64;
  await page.reload();
  await page.getByRole('tab',{name:'周报与证据',exact:true}).click();
  await weekButton(3).click();
  await page.getByText('复核这份周报',{exact:true}).waitFor();
  historicalFinal=true;confirmedScore=73;
  await page.reload();
  await page.getByRole('tab',{name:'结果概览',exact:true}).click();
  await page.getByText('月度周报质量最终分 · 73.0 分',{exact:true}).waitFor();
  assert(await page.locator('.pf-confirm-list').getByText('历史已确认',{exact:true}).isVisible());
  await page.getByRole('tab',{name:'周报与证据',exact:true}).click();
  await weekButton(3).click();
  assert.equal(await page.getByText('复核这份周报',{exact:true}).count(),0,'retained manual finals keep weekly reviews locked');
  historicalFinal=false;confirmedScore=64;

  mode='personal';
  await page.goto(personalUrl);
  await page.getByText('2026 年 10 月周报质量最终分',{exact:true}).waitFor();
  assert(await page.getByRole('columnheader',{name:'质量最终分'}).isVisible());
  assert.equal(await page.getByRole('cell',{name:'系统自动计算'}).count(),0,'automatic score tables omit generation metadata');
  await page.locator('.content-shell').evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:path.join(dir,'automatic-final-personal.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.locator('.content-shell').evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:path.join(dir,'automatic-final-personal-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1100});
  historicalFinal=true;confirmedScore=73;
  await page.reload();
  await page.locator('.pf-metrics').getByText('73.0',{exact:false}).first().waitFor();
  const historyTable=page.locator('.pf-table-card').filter({has:page.getByRole('heading',{name:'历史周报质量最终分',exact:true})}).getByRole('table');
  assert.deepEqual(await historyTable.getByRole('columnheader').allTextContents(),['月份','质量最终分','状态']);
  assert.equal(await historyTable.getByRole('cell',{name:supervisor.name}).count(),0,'score tables omit historical confirmation metadata');
  historicalFinal=false;confirmedScore=64;
  state='legacy';await page.reload();
  await page.getByText('历史记录未保存详细评分说明，已有分数保留；这里不补写历史理由。',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-quality-module]').count(),0,'historical evidence must not be fabricated');
  state='pending';await page.reload();
  await page.getByText('AI 分析完成后，将自动展示各模块得分、评分理由和可以补充的内容。当前未生成有效评分，不按 0 分处理。',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-quality-module]').count(),0,'a failed analysis must not appear as a zero-scored report');

  mode='supervisor';state='ready';qualityState='final';confirmedScore=64;
  await page.goto(base+'/?page=quality-scores&qualityView=team&qualityReviewMonth='+month);
  await page.getByRole('heading',{name:'团队质量审核',exact:true}).waitFor();
  await page.getByText('月度周报质量最终分 · 64.0 分',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'确认月度最终分'}).count(),0);
  assert.equal(await page.getByLabel('调整分数后确认').count(),0);
  assert.equal(await page.getByLabel('调整后的月度分').count(),0);
  assert.deepEqual(confirmRequests,[]);
  assert(await page.getByText('复核这份周报',{exact:true}).isVisible(),'automatic monthly finals keep authorized weekly review available');
  assert.deepEqual(errors,[]);assert.deepEqual([...unhandledRoutes],[]);
  console.log(JSON.stringify({ok:true,managementLazyDetails:true,personalEvidence:true,automaticMonthlyFinal:true,manualMonthlyControlsAbsent:true,supervisorScope:true,reviewAudit:true,legacyHonesty:true,pendingHonesty:true,mobile:true,artifacts:dir}));
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
  console.log('UI test artifacts retained:',dir);
}
