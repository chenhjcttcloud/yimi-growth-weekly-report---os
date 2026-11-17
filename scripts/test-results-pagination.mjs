import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// All identities and responses are synthetic. The browser cannot contact a
// backend or an external host, and every artifact is retained for inspection.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/results-pagination-'));
const build=process.env.TEST_STATIC_DIR?path.resolve(process.env.TEST_STATIC_DIR):path.join(dir,'dist');
if(!process.env.TEST_STATIC_DIR){
  const built=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',build,'--emptyOutDir','false'],{encoding:'utf8'});
  assert.equal(built.status,0,built.stdout+'\n'+built.stderr);
}
await readFile(path.join(build,'index.html'));

const currentMonth=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7);
const previous=new Date(currentMonth+'-01T00:00:00Z');previous.setUTCMonth(previous.getUTCMonth()-1);
const historical=previous.toISOString().slice(0,7),months=[currentMonth,historical];
const monthName=month=>`${month.slice(0,4)} 年 ${Number(month.slice(5))} 月`;
const departments=['虚构产品部','虚构研发部','虚构支持部'];
const employees=Array.from({length:35},(_,index)=>({userId:'pagination-fixture-'+String(index+1).padStart(2,'0'),name:'虚构员工'+String(index+1).padStart(2,'0'),department:departments[index%departments.length]}));
employees[5].department='虚构支持部 / 虚构产品部';
employees[34].department=null;
const groupedEmployees=[
  ...departments.flatMap(department=>employees.filter(person=>person.department?.startsWith(department))),
  employees[34],
];
const productPeople=employees.filter(person=>person.department?.includes(departments[0]));
const researchPeople=employees.filter(person=>person.department===departments[1]);
const supportPeople=employees.filter(person=>person.department?.includes(departments[2]));
const departmentCounts=[['全部部门',employees.length],[departments[0],productPeople.length],[departments[1],researchPeople.length],[departments[2],supportPeople.length],['未分配部门',1]];
const manager={userId:'pagination-fixture-manager',name:'虚构分页管理员',department:'虚构管理部'};
const timing={expected:1,submitted:1,onTime:1,late:0,missing:0,pendingTimestamp:0,pendingCalendar:0,rate:100};
const evidence=(focus,person,month)=>`${person.name} ${month} 的虚构${focus==='quality'?'周报证据':'协作评价'}`;
function week(month){const start=month+'-05',end=month+'-09';return {id:'period-'+end,label:month+'虚构测试周',start,end,range:start+' — '+end};}
function report(person,month,full=false){const w=week(month);return {
  id:person.userId+'-'+month,employeeUserId:person.userId,name:person.name,department:person.department,month,start:w.start,end:w.end,
  submittedAt:w.end+'T09:00:00Z',status:'准时',submitted:true,candidate:82,detailsDeferred:!full,scoringPolicy:{weights:[30,25,25,20]},
  ...(full?{evidence:[{module:'本周成果',text:evidence('quality',person,month)}],anomalies:[],suggestions:'补充虚构交付依据',content:{results:person.name+'的虚构完整原文'}}:{}),
};}
const monthly=months.flatMap(month=>employees.map(person=>({...person,month,reports:[report(person,month)],timeliness:timing,peerCandidate:91,
  collaborationExpected:1,collaborationSubmitted:1,managerProgress:{kind:'manager',submitted:1,expected:1,complete:true,score:90}})));
function cycle(month,person){return {id:month+'-fixture',month,label:month+'虚构协同互评',expected:35,submitted:35,pending:[],
  ...(person?{assignments:[{id:month+'-'+person.userId,evaluee_user_id:person.userId,evaluator_name:'虚构评分人',score:91,comment:evidence('collaboration',person,month),submitted_at:month+'-28T09:00:00Z'}]}:{}),
};}
const results=months.flatMap(month=>employees.flatMap((person,index)=>['quality','timeliness','collaboration'].map(kind=>({
  month,employee_user_id:person.userId,kind,scoring_rule:kind==='collaboration'?'weighted_30_70':'automatic_report',
  result:kind==='timeliness'?{rate:100}:{score:kind==='quality'?80+index/10:90+index/10},confirmed_by:'系统自动生成',confirmed_at:month+'-28T09:00:00Z',
  evidenceSummary:{reviewNote:'虚构分页测试依据'},
}))));
const overview={ok:true,months,employees,monthly,collaborations:months.map(month=>cycle(month)),results};
const meta={periods:months.slice().reverse().map(month=>week(month)),current_week_id:week(currentMonth).id,generated_on:week(currentMonth).end,people_count:0};
const management={prototypeData:{meta,employee_summary:[],weekly_scores:[]},kimiInsights:{},kimiInsightsByPeriod:{},monthlyMeetingInsights:{},scoring360:{cycles:[],results:[],assignments:[],responses:[]}};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(/^\/(api|auth|share)(\/|$)/.test(url.pathname))throw Error('unmocked_api');
  let file=path.resolve(build,'.'+decodeURIComponent(url.pathname));
  if(file!==build&&!file.startsWith(build+path.sep))throw Error('invalid_path');
  if(!(await stat(file).catch(()=>null))?.isFile())file=path.join(build,'index.html');
  res.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const errors=[],writes=[],unexpected=[],detailRequests=[],checks=[];
let browser;
try{
  browser=await chromium.launchPersistentContext(path.join(dir,'browser-profile'),{channel:'chrome',headless:true,viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await browser.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base){unexpected.push(url.origin);return route.abort();}
    if(!/^\/(api|auth|share)(\/|$)/.test(url.pathname))return route.continue();
    const p=url.pathname,json=value=>route.fulfill({status:200,json:value});
    if(request.method()!=='GET'){
      if(p.startsWith('/api/usage/'))return json({ok:true});
      writes.push({method:request.method(),path:p});return route.abort();
    }
    if(p==='/api/me')return json({ok:true,user:{...manager,role:'hr',bossView:false},access:{role:'hr',externalView:false,bossView:false,
      canViewBossDashboard:false,canViewSettings:true,canManageScoring360:true,canManagePersonnel:true,currentEmployee:manager,visibleEmployees:[manager,...employees]}});
    if(p==='/api/dev/views')return route.fulfill({status:404,json:{ok:false}});
    if(p==='/api/management-data')return json(url.searchParams.get('view')==='bootstrap'?{prototypeData:{meta}}:management);
    if(p==='/api/performance/manage')return json(overview);
    if(p==='/api/performance/employee-month'){
      const userId=url.searchParams.get('employeeId'),month=url.searchParams.get('month'),person=employees.find(value=>value.userId===userId);
      assert(person,'detail requests must identify one of the synthetic employees');assert(months.includes(month),'detail requests must identify a fixture month');
      detailRequests.push({userId,month});
      return json({ok:true,monthly:{...monthly.find(value=>value.userId===userId&&value.month===month),reports:[report(person,month,true)]},
        collaborations:[cycle(month,person)],results:results.filter(value=>value.employee_user_id===userId&&value.month===month)});
    }
    if(p==='/api/manager-reviews')return json({ok:true,month:url.searchParams.get('month'),canReview:false,hasResponsibilities:false,tasks:[],weights:{manager:30,peers:70}});
    if(p==='/api/scoring360/my-tasks')return json({ok:true,tasks:[],cycleId:'fixture-cycle'});
    if(p==='/api/notifications')return json({ok:true,notifications:[],unreadCount:0});
    if(p==='/api/management/summary')return json({ok:true,summary:null});
    unexpected.push(p);return route.fulfill({status:404,json:{error:'unexpected_fixture_request'}});
  });
  const page=await browser.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  const people=()=>page.locator('.pf-person');
  const personButton=person=>people().filter({has:page.getByText(person.name,{exact:true})});
  const directory=()=>page.getByRole('complementary',{name:'选择查看员工',exact:true});
  const pagination=()=>page.getByRole('navigation',{name:'员工列表分页',exact:true});
  const next=()=>pagination().getByRole('button',{name:'下一页员工',exact:true});
  const back=()=>pagination().getByRole('button',{name:'上一页员工',exact:true});
  const search=()=>page.getByLabel('搜索员工或部门',{exact:true});
  const departmentFilter=()=>page.getByRole('group',{name:'按部门筛选',exact:true});
  const departmentButton=department=>departmentFilter().getByRole('button',{name:department,exact:true});
  const departmentHeading=department=>directory().getByRole('heading',{name:new RegExp('^'+department)});
  async function title(value){await page.waitForFunction(text=>document.querySelector('.app-header h1')?.textContent===text,value);}
  async function urlValue(key,value){await page.waitForFunction(({key,value})=>new URL(location.href).searchParams.get(key)===value,{key,value});}
  async function selected(person){
    await page.waitForFunction(name=>document.querySelector('.pf-person-heading h3')?.textContent?.startsWith(name),person.name);
    await urlValue('scoreEmployeeId',person.userId);
  }
  async function assertPage(number,expected=groupedEmployees.slice((number-1)*8,number*8),total=5){
    await pagination().getByText(`第 ${number} / ${total} 页`,{exact:true}).waitFor();
    assert.deepEqual(await people().locator('strong').allTextContents(),expected.map(person=>person.name),'only the expected employees on this page are rendered, in order');
    assert.equal(await back().isDisabled(),number===1,'previous is disabled only at the first page');
    assert.equal(await next().isDisabled(),number===total,'next is disabled only at the last page');
  }
  async function assertActive(person){
    assert.equal(await personButton(person).getAttribute('aria-pressed'),'true','the restored employee is visibly active');
    assert.equal(await page.locator('.pf-person[aria-pressed="true"]').count(),1,'only one employee is active');
  }
  async function chooseMonth(month){
    await page.getByRole('combobox',{name:'选择绩效月份',exact:true}).click();
    await page.getByRole('option',{name:monthName(month),exact:true}).click();await urlValue('scoreMonth',month);
  }
  async function assertDepartment(department){
    assert.equal(await departmentButton(department).getAttribute('aria-pressed'),'true');
    assert.equal(await departmentFilter().getByRole('button',{pressed:true}).count(),1,'only the chosen department is pressed');
  }
  async function chooseDepartment(department){
    await departmentButton(department).click();await assertDepartment(department);
  }
  async function assertDepartmentHeader(){
    await assertDepartment('全部部门');
    assert.equal(await directory().getByRole('group',{name:'按部门筛选',exact:true}).count(),0,'department buttons are outside the employee sidebar');
    for(const [department,count] of departmentCounts){
      assert.deepEqual((await departmentButton(department).innerText()).match(/\d+/g),[String(count)],'each department has a visible count that includes secondary members');
    }
    const header=await departmentFilter().boundingBox(),sidebar=await directory().boundingBox();
    assert(header&&sidebar&&header.width>sidebar.width&&header.y+header.height<=sidebar.y+1,'departments occupy a shared row above the employee directory and detail');
  }
  async function showEvidence(focus,person,month,absent=[]){
    await page.getByRole('tab',{name:focus==='quality'?'周报与证据':'协作明细',exact:true}).click();
    await page.getByText(evidence(focus,person,month),{exact:true}).waitFor();
    assert.deepEqual(detailRequests.at(-1),{userId:person.userId,month},'evidence is loaded for the selected employee and month');
    for(const [oldPerson,oldMonth] of absent)assert.equal(await page.getByText(evidence(focus,oldPerson,oldMonth),{exact:true}).count(),0,'evidence from a different employee or month must not be reused');
  }

  for(const [route,focus,label] of [['quality-scores','quality','周报质量'],['collaboration-scores','collaboration','360 协同得分'],['scores','quality','评分工作台']]){
    const resultUrl=`${base}/?page=${route}&scoreMonth=${currentMonth}${route==='scores'?'&scoreTab=results':''}`;
    await page.goto(resultUrl);await title(label);await assertPage(1);await selected(employees[0]);await assertActive(employees[0]);
    if(route==='scores')assert.equal(await page.getByRole('tab',{name:'得分结果',exact:true}).getAttribute('aria-selected'),'true');
    await assertDepartmentHeader();
    assert(await departmentHeading(departments[0]).isVisible());
    assert.equal(await directory().getByText('虚构员工35',{exact:true}).count(),0,'35-person directory does not render the whole roster');
    const requestsBeforePaging=detailRequests.length;
    for(let number=2;number<=5;number++){
      await next().click();await assertPage(number);await selected(employees[0]);
      if(number===2){
        assert(await departmentHeading(departments[0]).isVisible(),'a department heading repeats when its employee list spans pages');
        assert(await departmentHeading(departments[1]).isVisible());
      }
      if(number===5)assert(await departmentHeading('未分配部门').isVisible(),'employees without departments remain visible');
      assert.equal(await page.locator('.pf-person[aria-pressed="true"]').count(),0,'paging does not silently select a different employee');
    }
    assert.equal(detailRequests.length,requestsBeforePaging,'paging alone never loads a different employee detail');
    for(let number=4;number>=1;number--){await back().click();await assertPage(number);}
    await assertActive(employees[0]);

    // An explicit bookmark and refresh reveal employee 20 on page 3.
    await page.goto(`${resultUrl}&scoreEmployeeId=${employees[19].userId}&scoreDetailTab=review`);
    await title(label);await assertPage(3);await selected(employees[19]);await assertActive(employees[19]);
    await page.reload();await title(label);await assertPage(3);await selected(employees[19]);await assertActive(employees[19]);
    await showEvidence(focus,employees[19],currentMonth);
    const nextPerson=employees[22];
    await personButton(nextPerson).click();await assertPage(3);await selected(nextPerson);await assertActive(nextPerson);
    await showEvidence(focus,nextPerson,currentMonth,[[employees[19],currentMonth]]);

    // Search is a directory filter. The selected detail remains stable while
    // the filtered list may have its own pages, or no matching employees.
    await search().fill(employees[34].name);await assertPage(1,[employees[34]],1);await selected(nextPerson);
    await page.getByText(evidence(focus,nextPerson,currentMonth),{exact:true}).waitFor();
    await personButton(employees[34]).click();await selected(employees[34]);await assertActive(employees[34]);
    assert.equal(await people().count(),1,'choosing a search match does not discard the filter');
    await search().fill(departments[1]);await assertPage(1,researchPeople.slice(0,8),2);await selected(employees[34]);
    await next().click();await assertPage(2,researchPeople.slice(8),2);await selected(employees[34]);
    await search().fill('完全不存在的虚构姓名');
    await page.waitForFunction(()=>document.querySelectorAll('.pf-person').length===0);
    assert.match(await directory().innerText(),/未找到|无匹配|没有匹配|暂无匹配/,'empty search has an explanatory state');
    await selected(employees[34]);
    await directory().getByRole('button',{name:'清除搜索',exact:true}).click();await assertPage(1);await selected(employees[34]);
    assert.equal(await search().inputValue(),'','the empty-state action clears the filter');
    for(let number=2;number<=4;number++){await next().click();await assertPage(number);await selected(employees[34]);}
    const multiDepartmentPerson=employees[5];
    await personButton(multiDepartmentPerson).click();await assertPage(4);await selected(multiDepartmentPerson);await assertActive(multiDepartmentPerson);
    assert.equal(await people().count(),8,'selecting a person keeps the chosen page at eight employees');

    await search().fill(multiDepartmentPerson.name);await assertPage(1,[multiDepartmentPerson],1);
    const beforeFilter=detailRequests.length;
    await chooseDepartment(departments[1]);await assertPage(1,researchPeople.slice(0,8),2);await selected(researchPeople[0]);await assertActive(researchPeople[0]);
    assert.equal(await search().inputValue(),'','changing departments clears the previous search');
    await search().fill(multiDepartmentPerson.name);
    await directory().getByText('未找到匹配员工',{exact:true}).waitFor();
    assert.equal(await people().count(),0,'employee search intersects with the selected department');
    await selected(researchPeople[0]);
    await chooseDepartment(departments[0]);await assertPage(1,productPeople.slice(0,8),2);await selected(productPeople[0]);await assertActive(productPeople[0]);
    assert(await personButton(multiDepartmentPerson).isVisible(),'a secondary membership appears in the selected department');
    await next().click();await assertPage(2,productPeople.slice(8),2);
    await search().fill(multiDepartmentPerson.name);await assertPage(1,[multiDepartmentPerson],1);await selected(productPeople[0]);
    assert.equal(detailRequests.length,beforeFilter,'department and search changes only open the normal result review');

    await personButton(multiDepartmentPerson).click();await selected(multiDepartmentPerson);
    await showEvidence(focus,multiDepartmentPerson,currentMonth);
    const beforeKeepingSelection=detailRequests.length;
    await chooseDepartment(departments[2]);await assertPage(1,supportPeople.slice(0,8),2);await selected(multiDepartmentPerson);await assertActive(multiDepartmentPerson);
    assert.equal(await search().inputValue(),'','switching between the employee’s departments clears stale search');
    await chooseDepartment('全部部门');await assertPage(4);await selected(multiDepartmentPerson);await assertActive(multiDepartmentPerson);
    await page.getByText(evidence(focus,multiDepartmentPerson,currentMonth),{exact:true}).waitFor();
    await chooseDepartment('未分配部门');await assertPage(1,[employees[34]],1);await selected(employees[34]);await assertActive(employees[34]);
    assert.equal(await page.getByRole('tab',{name:'结果概览',exact:true}).getAttribute('aria-selected'),'true','selecting a department without the current employee opens normal result review');
    assert.equal(detailRequests.length,beforeKeepingSelection,'compatible filters keep evidence, and a replacement opens review without another evidence request');
    await chooseDepartment(departments[1]);
    await search().fill(departments[1]);await chooseMonth(historical);await assertPage(1);await selected(employees[0]);await assertActive(employees[0]);
    assert.equal(await search().inputValue(),'','changing month clears a stale directory filter');
    await assertDepartment('全部部门');
    await showEvidence(focus,employees[0],historical,[[nextPerson,currentMonth]]);
    await page.screenshot({path:path.join(dir,route+'-desktop.png'),fullPage:true,animations:'disabled'});

    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone layout must not overflow the viewport horizontally');
    assert(await departmentFilter().evaluate(element=>element.getBoundingClientRect().right<=innerWidth+1),'department buttons fit within the phone viewport');
    assert(await directory().evaluate(element=>element.scrollWidth<=element.clientWidth+1),'employee directory must fit within phone width');
    assert(await pagination().evaluate(element=>element.scrollWidth<=element.clientWidth+1),'pagination controls must fit within phone width');
    await next().click();await assertPage(2);await selected(employees[0]);
    const mobilePerson=groupedEmployees[8];
    await personButton(mobilePerson).click();await selected(mobilePerson);await assertPage(2);await assertActive(mobilePerson);
    await directory().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(dir,route+'-mobile.png'),fullPage:true,animations:'disabled'});
    await page.setViewportSize({width:1440,height:1000});
    checks.push({route,employees:35,pageSize:8,pages:5,pagingPreservesDetail:true,deepLinkAndRefreshLocateEmployee:true,nameAndDepartmentSearch:true,departmentGrouping:true,departmentHeaderAndCounts:true,departmentSelectionPreservesOrReplacesDetail:true,emptySearchRetainsDetail:true,monthReset:true,evidenceIsolation:true,mobileWidth:390});
  }

  // Browser-history targets must win over a directory filter left by the
  // previous view, including a simultaneous employee/month restoration.
  await page.goto(`${base}/?page=quality-scores&scoreMonth=${currentMonth}&scoreEmployeeId=${employees[0].userId}&scoreDetailTab=review`);
  await title('周报质量');await assertPage(1);await selected(employees[0]);
  async function restoreHistoryTarget(person,month){
    await page.evaluate(({person,month})=>{
      const url=new URL(location.href);
      url.searchParams.set('scoreTarget','1');url.searchParams.set('scoreEmployeeId',person.userId);url.searchParams.set('scoreEmployeeName',person.name);
      url.searchParams.set('scoreMonth',month);url.searchParams.set('scoreDetailTab','review');
      history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'));
    },{person,month});
    await selected(person);await urlValue('scoreMonth',month);
    await page.waitForFunction(()=>document.querySelector('input[aria-label="搜索员工或部门"]')?.value==='');
    await assertPage(3);await assertActive(person);
  }
  await search().fill(employees[2].name);await assertPage(1,[employees[2]],1);await selected(employees[0]);
  await restoreHistoryTarget(employees[19],currentMonth);
  await search().fill(employees[2].name);await assertPage(1,[employees[2]],1);await selected(employees[19]);
  await personButton(employees[2]).click();await selected(employees[2]);await assertActive(employees[2]);
  await restoreHistoryTarget(employees[19],historical);
  await page.screenshot({path:path.join(dir,'history-target-clears-stale-search.png'),fullPage:true,animations:'disabled'});

  // Switching modules must locate the current selection, even after browsing
  // away from its directory page without changing the selected employee.
  await page.goto(`${base}/?page=quality-scores&scoreMonth=${historical}&scoreEmployeeId=${employees[19].userId}&scoreDetailTab=review`);
  await title('周报质量');await assertPage(3);await next().click();await assertPage(4);await selected(employees[19]);
  const nav=page.getByRole('navigation',{name:'主导航',exact:true});
  await nav.getByRole('button',{name:'360 协同得分',exact:true}).click();await title('360 协同得分');await assertPage(3);await selected(employees[19]);await assertActive(employees[19]);
  await chooseDepartment(departments[0]);
  await search().fill(employees[5].name);await assertPage(1,[employees[5]],1);await selected(productPeople[0]);
  await restoreHistoryTarget(employees[22],historical);
  await assertDepartment('全部部门');
  await restoreHistoryTarget(employees[19],historical);
  await chooseDepartment(departments[1]);await assertPage(1,researchPeople.slice(0,8),2);await selected(employees[19]);
  await search().fill(departments[1]);await next().click();await assertPage(2,researchPeople.slice(8),2);await selected(employees[19]);
  await nav.getByRole('button',{name:'周报质量',exact:true}).click();await title('周报质量');await assertPage(3);await selected(employees[19]);await assertActive(employees[19]);
  await assertDepartment('全部部门');
  assert.equal(await search().inputValue(),'','switching modules clears directory filters');
  await page.screenshot({path:path.join(dir,'module-switch-restored-selection.png'),fullPage:true,animations:'disabled'});

  const pendingSubjects=employees.slice(0,4);
  overview.results=results.filter(result=>result.month!==currentMonth||result.kind!=='collaboration'
    ||!pendingSubjects.some(employee=>employee.userId===result.employee_user_id));
  overview.monthly=monthly.map(row=>{
    if(row.month!==currentMonth)return row;
    const index=employees.findIndex(employee=>employee.userId===row.userId);
    if(![0,1,2,3,4].includes(index))return row;
    return {...row,
      collaborationSubmitted:[0,1,4].includes(index)?0:row.collaborationSubmitted,
      managerProgress:[0,2,3,4].includes(index)?{...row.managerProgress,submitted:0,complete:false,score:null}:row.managerProgress,
    };
  });
  const currentCycle=overview.collaborations.find(value=>value.month===currentMonth);
  Object.assign(currentCycle,{status:'draft',launch_at:'',pending:['虚构评分人甲','虚构评分人乙','虚构评分人丙','虚构评分人丁','虚构评分人戊']});
  await page.goto(`${base}/?page=collaboration-scores&scoreMonth=${currentMonth}`);
  const progress=page.locator('.pf-collaboration-progress');
  await progress.getByText('尚未开放',{exact:true}).waitFor();
  assert.equal(await progress.getByText('同事互评未齐的员工',{exact:true}).count(),1);
  assert.equal(await progress.getByText('负责人或老板评分未齐的员工',{exact:true}).count(),1);
  assert.deepEqual(await progress.locator('dd').allTextContents(),['2 人','3 人'],'both counts use unpublished employees being evaluated');
  await progress.screenshot({path:path.join(dir,'collaboration-progress-draft.png'),animations:'disabled'});
  Object.assign(currentCycle,{status:'open',launch_at:currentMonth+'-01T09:00:00+08:00'});
  await page.reload();
  await progress.getByText('2 人',{exact:true}).waitFor();
  assert.equal(await progress.getByText('尚未开放',{exact:true}).count(),0,'an opened cycle has no draft label');

  assert.deepEqual(errors,[],'no browser runtime errors');assert.deepEqual(writes,[],'no business write requests');assert.deepEqual(unexpected,[],'no external or unmocked requests');
  const result={ok:true,checks,historyTargetsClearStaleSearch:true,historyMonthAndEmployeeLocateSelection:true,moduleSwitchLocatesSelection:true,collaborationProgressUsesSamePopulation:true,browserErrors:errors,businessWrites:writes,externalRequests:unexpected,detailRequests,realMessagesSent:0,artifacts:dir};
  await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
  const page=browser?.pages().at(-1);if(page)await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true,animations:'disabled'}).catch(()=>{});
  await writeFile(path.join(dir,'result.json'),JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error),checks,errors,writes,unexpected,detailRequests,artifacts:dir},null,2));
  throw error;
}finally{
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));console.log('Artifacts retained:',dir);
}
