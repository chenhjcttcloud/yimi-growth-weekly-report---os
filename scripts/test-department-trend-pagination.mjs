import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// All people, departments and API responses are synthetic. No real backend,
// credentials, messages or scoring writes are used; all artifacts are retained.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/department-trend-pagination-'));
const build=process.env.TEST_STATIC_DIR?path.resolve(process.env.TEST_STATIC_DIR):path.join(dir,'dist');
if(!process.env.TEST_STATIC_DIR){
  const built=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',build,'--emptyOutDir','false'],{encoding:'utf8'});
  assert.equal(built.status,0,built.stdout+'\n'+built.stderr);
}
await readFile(path.join(build,'index.html'));

const currentMonth=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7);
const months=Array.from({length:3},(_,index)=>{const date=new Date(currentMonth+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-index);return date.toISOString().slice(0,7);});
const monthName=month=>`${month.slice(0,4)} 年 ${Number(month.slice(5))} 月`;
const departments=Array.from({length:12},(_,index)=>'虚构趋势部门'+String(index+1).padStart(2,'0'));
const employees=departments.flatMap((department,index)=>[0,1].map(member=>({userId:`trend-fixture-${index+1}-${member+1}`,name:`虚构趋势员工${String(index+1).padStart(2,'0')}${member+1}`,department})));
const manager={userId:'trend-fixture-manager',name:'虚构趋势管理员',department:'虚构管理部'};
const timing={expected:1,submitted:1,onTime:1,late:0,missing:0,pendingTimestamp:0,pendingCalendar:0,rate:100};
function week(month){const start=month+'-05',end=month+'-09';return {id:'period-'+end,label:month+'虚构趋势测试周',start,end,range:start+' — '+end};}
function report(person,month){const w=week(month);return {id:person.userId+'-'+month,employeeUserId:person.userId,name:person.name,department:person.department,month,start:w.start,end:w.end,
  submittedAt:w.end+'T09:00:00Z',status:'准时',submitted:true,candidate:82,detailsDeferred:false,scoringPolicy:{weights:[30,25,25,20]},
  evidence:[{module:'本周成果',text:person.name+'的虚构趋势测试证据'}],anomalies:[],suggestions:'完善虚构交付证据',content:{results:'虚构原文'}};}
const monthly=months.flatMap(month=>employees.map(person=>({...person,month,reports:[report(person,month)],timeliness:timing,peerCandidate:91,
  collaborationExpected:1,collaborationSubmitted:1,managerProgress:{kind:'manager',submitted:1,expected:1,complete:true,score:90}})));
const collaborations=months.map(month=>({id:month+'-fixture',month,label:month+'虚构协同互评',expected:24,submitted:24,pending:[],assignments:[]}));
// Include zero, entirely unpublished and partly published departments, plus
// non-integer means. Null scores must not enter an average's denominator.
function fixtureScore(monthIndex,departmentIndex,member,kind){
  if(departmentIndex===0)return 0;
  if(departmentIndex===1)return null;
  if(departmentIndex===2)return member===0?null:kind==='quality'?73.5:84;
  return (kind==='quality'?60:70)+monthIndex*2+departmentIndex+(member===0?0:11);
}
const results=months.flatMap((month,monthIndex)=>employees.flatMap((person,index)=>['quality','timeliness','collaboration'].map(kind=>({
  month,employee_user_id:person.userId,kind,scoring_rule:kind==='collaboration'?'weighted_30_70':'automatic_report',
  result:kind==='timeliness'?{rate:100}:{score:fixtureScore(monthIndex,Math.floor(index/2),index%2,kind)},
  confirmed_by:'虚构系统自动生成',confirmed_at:month+'-28T09:00:00Z',evidenceSummary:{reviewNote:'虚构趋势测试计算依据'},
}))));
const overview={ok:true,months,employees,monthly,collaborations,results};
const emptyOverview={ok:true,months:[],employees:[],monthly:[],collaborations:[],results:[]};
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
const errors=[],writes=[],unexpected=[],checks=[],manageRequests=[];
let browser,fixtureMode='populated';
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
    if(p==='/api/performance/manage'){manageRequests.push({fixtureMode,month:url.searchParams.get('month')});return json(fixtureMode==='empty'?emptyOverview:overview);}
    if(p==='/api/manager-reviews')return json({ok:true,month:url.searchParams.get('month'),canReview:false,hasResponsibilities:false,tasks:[],weights:{manager:30,peers:70}});
    if(p==='/api/scoring360/my-tasks')return json({ok:true,tasks:[],cycleId:'fixture-cycle'});
    if(p==='/api/notifications')return json({ok:true,notifications:[],unreadCount:0});
    if(p==='/api/management/summary')return json({ok:true,summary:null});
    unexpected.push(p);return route.fulfill({status:404,json:{error:'unexpected_fixture_request'}});
  });
  const page=await browser.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  const section=()=>page.getByRole('region',{name:'部门得分趋势',exact:true});
  const table=()=>section().getByRole('table',{name:'部门趋势记录',exact:true});
  const rows=()=>table().locator('tbody tr');
  const pagination=()=>section().getByRole('navigation',{name:'部门趋势分页',exact:true});
  const next=()=>pagination().getByRole('button',{name:'下一页部门趋势',exact:true});
  const back=()=>pagination().getByRole('button',{name:'上一页部门趋势',exact:true});
  const search=()=>section().getByRole('searchbox',{name:'搜索趋势部门',exact:true});
  const clear=()=>section().getByRole('button',{name:'清除趋势部门搜索',exact:true});
  const monthFilter=()=>section().getByRole('combobox',{name:'筛选趋势月份',exact:true});
  function expectedRows(focus,chosenMonths=months,query=''){
    return chosenMonths.flatMap(month=>departments.filter(department=>department.includes(query)).map(department=>{
      const userIds=employees.filter(person=>person.department===department).map(person=>person.userId);
      const average=kind=>{const scores=results.filter(result=>result.month===month&&result.kind===kind&&userIds.includes(result.employee_user_id)&&result.result.score!=null).map(result=>result.result.score);
        return scores.length?(scores.reduce((sum,value)=>sum+value,0)/scores.length).toFixed(1):'—';};
      return [monthName(month),department,...(focus==='collaboration'?[]:[average('quality')]),...(focus==='quality'?[]:[average('collaboration')])];
    }));
  }
  async function assertPage(number,expected,total=Math.max(1,Math.ceil(expected.length/8))){
    await pagination().getByText(`第 ${number} / ${total} 页`,{exact:true}).waitFor();
    assert.deepEqual(await rows().evaluateAll(elements=>elements.map(row=>Array.from(row.cells,cell=>cell.textContent?.trim()))),expected.slice((number-1)*8,number*8),'rendered records preserve source month/department order and original average calculation');
    assert.equal(await back().isDisabled(),number===1,'previous is disabled at the first page');
    assert.equal(await next().isDisabled(),number===total,'next is disabled at the final page');
  }
  async function assertEmpty(columns){
    await page.waitForFunction(()=>document.querySelector('table[aria-label="部门趋势记录"] tbody tr td[colspan]'));
    assert.equal(await rows().count(),1,'empty state occupies one table row');
    assert.equal(await rows().locator('td').count(),1,'empty state occupies one table cell');
    assert.equal(await rows().locator('td').getAttribute('colspan'),String(columns),'empty row spans the focused table columns');
    assert.match(await rows().innerText(),/暂无|未找到|没有匹配|无匹配/,'empty state explains the lack of matching records');
    if(await pagination().count()){
      assert.equal(await back().isDisabled(),true);assert.equal(await next().isDisabled(),true);
      await pagination().getByText('第 1 / 1 页',{exact:true}).waitFor();
    }
  }
  async function chooseTrendMonth(month){
    await monthFilter().click();await page.getByRole('option',{name:month?monthName(month):'全部月份',exact:true}).click();
  }
  async function topSelection(){return {month:new URL(page.url()).searchParams.get('scoreMonth'),employee:new URL(page.url()).searchParams.get('scoreEmployeeId'),heading:await page.locator('.pf-person-heading').innerText(),monthControl:await page.getByRole('combobox',{name:'选择绩效月份',exact:true}).innerText()};}
  async function assertMobileWidth(){
    const widths=await page.evaluate(()=>{const targets={page:document.documentElement,trend:document.querySelector('section[aria-label="部门得分趋势"]'),pagination:document.querySelector('nav[aria-label="部门趋势分页"]')};
      return Object.fromEntries(Object.entries(targets).map(([name,element])=>[name,{scroll:element?.scrollWidth,client:name==='page'?innerWidth:element?.clientWidth}]));});
    for(const [name,value] of Object.entries(widths))assert(value.scroll<=value.client+1,`${name} must fit in the 390px viewport: ${JSON.stringify(value)}`);
    return widths;
  }

  for(const [route,focus,heading,title] of [['quality-scores','quality','部门周报质量趋势','周报质量'],['collaboration-scores','collaboration','部门协同得分趋势','360 协同得分'],['scores','all','部门质量与历史月度趋势','评分工作台']]){
    fixtureMode='populated';
    await page.goto(`${base}/?page=${route}&scoreTab=results&scoreMonth=${currentMonth}&scoreEmployeeId=${employees[0].userId}`);
    await page.waitForFunction(value=>document.querySelector('.app-header h1')?.textContent===value,title);
    await section().getByRole('heading',{name:heading,exact:true}).waitFor();
    const columns=focus==='all'?4:3,all=expectedRows(focus),headers=['月份','部门',...(focus==='collaboration'?[]:['周报质量均分']),...(focus==='quality'?[]:['协作能力均分'])];
    assert.deepEqual(await table().locator('thead th').allTextContents(),headers,'focused routes show only their intended score columns');
    assert.equal(await search().getAttribute('type'),'search');
    assert.match(await monthFilter().innerText(),/全部月份/,'trend defaults to every available month');
    await assertPage(1,all);
    assert.equal(all.length,36);assert.equal(all[0][2],'0.0');assert.equal(all[1][2],'—');
    if(focus==='all'){assert.equal(all[0][3],'0.0');assert.equal(all[1][3],'—');assert.equal(all[2][3],'84.0');}
    if(focus!=='collaboration')assert.equal(all[2][2],'73.5','unpublished result does not dilute the published average');
    const originalTop=await topSelection(),requestCount=manageRequests.length;

    // Page two crosses a month boundary; the final page has only four rows.
    const visited=[];
    for(let number=1;number<=5;number++){
      if(number>1)await next().click();await assertPage(number,all);
      visited.push(...await rows().evaluateAll(elements=>elements.map(row=>Array.from(row.cells,cell=>cell.textContent?.trim()))));
    }
    assert.deepEqual(visited,all,'walking all pages visits every month/department exactly once');
    assert.equal(await rows().count(),4,'partial final page renders only remaining records');
    await back().click();await assertPage(4,all);

    // A search from a later page resets to the first page and supports its own
    // pagination. Whitespace is trimmed, and exact department matches span months.
    await search().fill('  虚构趋势部门1  ');const matches=expectedRows(focus,months,'虚构趋势部门1');await assertPage(1,matches);
    assert.equal(matches.length,9);await next().click();await assertPage(2,matches);
    await search().fill(departments[11]);await assertPage(1,expectedRows(focus,months,departments[11]));
    await clear().click();assert.equal(await search().inputValue(),'');await assertPage(1,all);
    await next().click();await assertPage(2,all);
    await search().fill('完全不存在的虚构趋势部门');await assertEmpty(columns);
    await clear().click();await assertPage(1,all);

    // Month selection operates only on trends and resets its page. It must not
    // change the employee/month currently shown in the upper result detail.
    for(let number=2;number<=5;number++){await next().click();await assertPage(number,all);}
    await chooseTrendMonth(months[1]);const filtered=expectedRows(focus,[months[1]]);await assertPage(1,filtered);
    assert.deepEqual(await topSelection(),originalTop,'trend month must not alter upper employee result context');
    await next().click();await assertPage(2,filtered);
    await chooseTrendMonth(months[2]);await assertPage(1,expectedRows(focus,[months[2]]));
    await search().fill(departments[2]);await assertPage(1,expectedRows(focus,[months[2]],departments[2]));
    await chooseTrendMonth(months[1]);await assertPage(1,expectedRows(focus,[months[1]],departments[2]));
    await clear().click();await assertPage(1,filtered);
    await next().click();await assertPage(2,filtered);
    await chooseTrendMonth('');await assertPage(1,all);
    assert.deepEqual(await topSelection(),originalTop,'all trend browsing leaves upper detail unchanged');
    assert.equal(manageRequests.length,requestCount,'trend paging/search/month filters reuse the existing overview');
    await section().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(dir,focus+'-desktop.png'),fullPage:true,animations:'disabled'});

    await page.setViewportSize({width:390,height:844});await section().scrollIntoViewIfNeeded();
    const mobileWidths=await assertMobileWidth();
    await next().click();await assertPage(2,all);
    await search().fill('虚构趋势部门1');await assertPage(1,matches);await next().click();await assertPage(2,matches);
    await chooseTrendMonth(months[2]);await assertPage(1,expectedRows(focus,[months[2]],'虚构趋势部门1'));
    await assertMobileWidth();await section().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(dir,focus+'-mobile.png'),fullPage:true,animations:'disabled'});
    await page.setViewportSize({width:1440,height:1000});

    fixtureMode='empty';await page.reload();await section().waitFor();await assertEmpty(columns);
    assert.deepEqual(await table().locator('thead th').allTextContents(),headers,'empty table retains focus-specific headers');
    await page.screenshot({path:path.join(dir,focus+'-empty.png'),fullPage:true,animations:'disabled'});
    checks.push({route,months:3,departments:12,records:36,pageSize:8,pages:5,columns,crossMonthPagination:true,originalAveragesPreserved:true,zeroAndUnpublishedPreserved:true,
      searchAndClear:true,emptySearchAndEmptyData:true,monthFilterReset:true,upperDetailIsolated:true,noExtraOverviewRequests:true,mobileWidth:390,mobileWidths});
  }
  assert.deepEqual(errors,[],'no browser runtime errors');assert.deepEqual(writes,[],'no business write requests');assert.deepEqual(unexpected,[],'no external or unmocked requests');
  const result={ok:true,checks,browserErrors:errors,businessWrites:writes,externalRequests:unexpected,realMessagesSent:0,realApiCalls:0,manageRequests,artifacts:dir};
  await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
  const page=browser?.pages().at(-1);if(page)await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true,animations:'disabled'}).catch(()=>{});
  await writeFile(path.join(dir,'result.json'),JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error),checks,errors,writes,unexpected,manageRequests,artifacts:dir},null,2));
  throw error;
}finally{
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));console.log('Artifacts retained:',dir);
}
