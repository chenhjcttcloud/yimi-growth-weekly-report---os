import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// Compiled UI plus synthetic identities and API responses only. One gated
// manager submission is mocked locally; all other business writes and external
// requests are rejected. No backend, credentials or real data is used.
// All build, browser-profile and screenshot artifacts are retained.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/boss-default-entry-'));
const build=process.env.TEST_STATIC_DIR?path.resolve(process.env.TEST_STATIC_DIR):path.join(dir,'dist');
if(!process.env.TEST_STATIC_DIR){
  const result=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',build,'--emptyOutDir','false'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
}
await readFile(path.join(build,'index.html'));

const currentMonth=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7);
function older(month){const date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7);}
const month=older(currentMonth),previous=older(month),months=[currentMonth,month,previous];
const monthName=value=>`${value.slice(0,4)} 年 ${Number(value.slice(5))} 月`;
const employee={userId:'entry-fixture-leader',name:'虚构负责人',department:'虚构测试部',active:true,departmentIds:['entry-fixture-team']};
const boss={userId:'entry-fixture-boss',name:'虚构老板',department:'虚构管理部'};
const admin={userId:'entry-fixture-admin',name:'虚构管理员',department:'虚构管理部'};
const department={id:'entry-fixture-team',name:employee.department,leader_user_id:employee.userId,leaderName:employee.name};
const timing={expected:0,submitted:0,onTime:0,late:0,missing:0,pendingTimestamp:0,pendingCalendar:0,rate:null};
const monthly=months.map(value=>({...employee,month:value,reports:[],timeliness:timing,peerCandidate:null,collaborationExpected:0,collaborationSubmitted:0,managerProgress:{kind:'boss',expected:1,submitted:0,complete:false,score:null}}));
const overview={ok:true,months,employees:[employee],monthly,collaborations:[],results:[]};
const meta={periods:[],people_count:0};
const management={prototypeData:{meta,employee_summary:[],weekly_scores:[]},kimiInsights:{},kimiInsightsByPeriod:{},monthlyMeetingInsights:{},scoring360:{cycles:[],results:[],assignments:[],responses:[]}};
function workspace(person,selected){return {ok:true,employee:person,months,month:selected,selectedWeekId:'',monthSummary:{...timing,upcoming:0},weeks:[],history:[],ratingProgress:{peerComplete:false,managerComplete:false,managerKind:'boss'},tasks:[],comments:[],messages:[],analysis:null,likeCount:0,liked:false,aiConfigured:false,taskCreateEnabled:false};}

const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,'http://localhost');
    if(/^\/(api|auth|share)(\/|$)/.test(url.pathname))throw Error('unmocked_api');
    let file=path.resolve(build,'.'+decodeURIComponent(url.pathname));
    if(file!==build&&!file.startsWith(build+path.sep))throw Error('invalid_path');
    if(!(await stat(file).catch(()=>null))?.isFile())file=path.join(build,'index.html');
    response.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});
    response.end(await readFile(file));
  }catch{response.writeHead(404);response.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser,role='boss',managerFixtureEnabled=false,managerSaved=false,managerGate,releaseManager;
const managerTask={employeeUserId:'entry-fixture-subordinate',name:'虚构下属',department:'虚构测试部',reports:[]};
const managerComment='虚构下属反馈：提交期间保持当前结果工作台。';
const errors=[],writes=[],unexpected=[],requests=[],cases=[],managerPosts=[];
try{
  browser=await chromium.launchPersistentContext(path.join(dir,'browser-profile'),{channel:'chrome',headless:true,viewport:{width:1440,height:1050}});
  await browser.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),p=url.pathname;
    if(url.origin!==base){unexpected.push(url.origin);return route.abort();}
    if(!/^\/(api|auth|share)(\/|$)/.test(p))return route.continue();
    const json=value=>route.fulfill({status:200,json:value});
    if(request.method()!=='GET'){
      if(p.startsWith('/api/usage/'))return json({ok:true});
      if(managerFixtureEnabled&&p==='/api/manager-reviews'&&request.method()==='POST'){
        assert.equal(role,'boss');assert.equal(managerPosts.length,0,'only the controlled synthetic manager submission is permitted');
        const value=request.postDataJSON();
        assert.deepEqual(value,{month,employeeUserId:managerTask.employeeUserId,score:'89',comment:managerComment});
        managerPosts.push(value);await managerGate;managerSaved=true;
        try{return await json({ok:true});}catch(error){if(request.failure()?.errorText)return;throw error;}
      }
      writes.push({role,path:p,method:request.method()});return route.abort();
    }
    requests.push({role,path:p,query:url.search});
    if(p==='/api/me'){
      const external=role==='external',isAdmin=role==='admin',manager=role==='boss'||isAdmin,person=role==='boss'?boss:isAdmin?admin:employee;
      const accessRole=external?'external_boss_view':isAdmin?'system_admin':role;
      return json({ok:true,user:{...person,role:accessRole},access:{role:accessRole,externalView:external,bossView:false,canViewBossDashboard:manager||external,canManageScoring360:manager,canManagePersonnel:manager,canViewSettings:manager,currentEmployee:person,visibleEmployees:manager?[boss,admin,employee]:[person]}});
    }
    if(p==='/api/management-data')return json(management);
    if(p==='/api/dev/views')return route.fulfill({status:404,json:{ok:false}});
    if(p==='/api/notifications')return json({ok:true,notifications:[],unreadCount:0});
    if(p==='/api/management/summary')return json({ok:true,summary:null});
    if(p==='/api/performance/manage')return json(overview);
    if(p==='/api/performance/employee-month'){
      assert.equal(url.searchParams.get('employeeId'),employee.userId);
      return json({ok:true,monthly:monthly.find(value=>value.month===url.searchParams.get('month')),collaborations:[],results:[]});
    }
    if(p==='/api/departments')return json({ok:true,month:url.searchParams.get('month')||month,canScore:role==='boss',currentUserId:role==='boss'?boss.userId:admin.userId,departments:[department],archivedDepartments:[],employees:[employee],scoreTargets:[{departmentId:department.id,leaderUserId:employee.userId,name:employee.name,ratingRequired:true}],scores:[]});
    if(p==='/api/manager-reviews'){
      const enabled=managerFixtureEnabled&&role==='boss';
      return json({ok:true,month:url.searchParams.get('month')||month,canReview:enabled,hasResponsibilities:enabled,tasks:enabled?[{...managerTask,submitted:managerSaved,locked:managerSaved,...(managerSaved?{score:89,comment:managerComment}:{})}]:[]});
    }
    if(p==='/api/scoring360/my-tasks')return json({ok:true,tasks:[],cycleId:''});
    if(p==='/api/scoring360/workbench')return json({month:url.searchParams.get('month')||currentMonth,revision:'entry-fixture',editable:false,cycle:null,people:[],rows:[],counts:{total:0,configured:0,pending:0,issues:0,ready:0},checks:[],copy:{sourceMonth:'',sourceCount:0,pairs:[],groups:[],skipped:{}}});
    if(p==='/api/scoring360/recurring-plan')return json({configured:false,sources:[],current:{month,state:'not_configured',issues:[]}});
    if(p==='/api/personal/workspace')return json(workspace(role==='admin'?admin:employee,url.searchParams.get('month')||currentMonth));
    unexpected.push(p);return route.fulfill({status:404,json:{error:'unexpected_fixture_request'}});
  });
  const page=await browser.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  const nav=()=>page.getByRole('navigation',{name:'主导航',exact:true});
  const panel=()=>page.getByRole('region',{name:'负责人评分',exact:true});
  const score=()=>panel().getByRole('spinbutton',{name:employee.name+'老板评分',exact:true});
  const comment=()=>panel().getByRole('textbox',{name:employee.name+'评分说明',exact:true});
  const selectedTab=()=>page.locator('.scoring-workbench-tabs [role="tab"][aria-selected="true"]');
  const targetKeys=['scoreTarget','scoreEmployeeId','scoreEmployeeName','scoreWeekId','scoreDetailTab'];
  const targetQuery=new URLSearchParams({scoreTarget:'1',scoreEmployeeId:employee.userId,scoreEmployeeName:employee.name,scoreWeekId:month+'-09',scoreDetailTab:'history'}).toString();
  async function title(value){await page.waitForFunction(expected=>document.querySelector('.app-header h1')?.textContent===expected,value);}
  async function locationValue(key,value){await page.waitForFunction(({key,value})=>new URL(location.href).searchParams.get(key)===value,{key,value});}
  let entryContext;
  async function leaders({preserveContext=false,selectedMonth}={}){
    await title('评分工作台');await score().waitFor();await locationValue('page','scores');await locationValue('scoreTab','leaders');
    assert.equal(await selectedTab().innerText(),'负责人评分');
    assert.equal(await nav().getByRole('button',{name:'评分工作台',exact:true}).getAttribute('aria-current'),'page');
    assert.equal(await page.locator('.pf-confirm-list').count(),0,'default entry does not render employee result content');
    if(preserveContext){const url=new URL(page.url());for(const key of targetKeys)assert.equal(url.searchParams.get(key),entryContext.searchParams.get(key),'leader entry preserves result context '+key);assert.equal(url.hash,entryContext.hash);}
    if(selectedMonth)await locationValue('scoreMonth',selectedMonth);
  }
  async function results(){await title('评分工作台');await page.getByText('评分完成，结果自动呈现',{exact:true}).waitFor();assert.equal(await selectedTab().innerText(),'得分结果');await locationValue('scoreTab','results');}
  async function setup(){await title('评分工作台');await page.getByRole('region',{name:'月度配评工作台',exact:true}).waitFor();assert.equal(await selectedTab().innerText(),'月度配评');await locationValue('scoreTab','setup');}
  async function clickWorkbench(){entryContext=new URL(page.url());await nav().getByRole('button',{name:'评分工作台',exact:true}).click();}
  function record(name){cases.push(name);}

  // A role-based default must ignore section/employee state left on a root URL.
  for(const staleTab of ['results','setup']){
    const start=requests.length;
    entryContext=new URL(base+'/?scoreTab='+staleTab+'&scoreMonth='+month+'&'+targetQuery+'#entry-retained');
    await page.goto(entryContext.href);
    await leaders({preserveContext:true,selectedMonth:month});
    assert.equal(new URL(page.url()).hash,'#entry-retained');
    assert(!requests.slice(start).some(request=>request.path==='/api/performance/manage'),'root default skips company result loading');
    record('boss root with stale '+staleTab+' and employee target opens leaders');
  }
  await page.goto(base+'/?page=scores');await leaders({selectedMonth:month});
  record('fresh explicit scores page defaults to leaders');
  await page.screenshot({path:path.join(dir,'boss-default-leaders.png'),fullPage:true,animations:'disabled'});

  // The main navigation opens leaders from both focused result pages even when
  // employee context remains in the URL for a later return to employee results.
  for(const [destination,label] of [['quality-scores','周报质量'],['collaboration-scores','360 协同得分']]){
    await page.goto(base+'/?page='+destination+'&scoreTab=results&scoreMonth='+previous+'&'+targetQuery);
    await title(label);await page.locator('.pf-person-heading').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('scoreEmployeeId'),employee.userId);
    await clickWorkbench();await leaders({preserveContext:true,selectedMonth:previous});
    record('boss sidebar from '+destination+' opens leaders while retaining employee result target');
  }

  // Clicking the currently selected main-navigation item must also switch a
  // mounted results/setup workspace to leaders; a React page-key no-op is unsafe.
  for(const [tab,ready] of [['results',results],['setup',setup]]){
    await page.goto(base+'/?page=scores&scoreTab='+tab+'&scoreMonth='+month+'&'+targetQuery);
    await ready();await page.reload();await ready();await locationValue('scoreMonth',month);
    record('explicit '+tab+' deep link and refresh preserve section');
    await clickWorkbench();await leaders({preserveContext:true,selectedMonth:month});
    record('boss sidebar reselect from mounted '+tab+' opens leaders');
  }

  // Repeated entry is idempotent and must leave existing draft persistence intact.
  await score().fill('83');await comment().fill('虚构草稿：重复点击左侧工作台后继续编辑。');
  const storageKey='boss-leader-drafts:'+boss.userId,draftKey=JSON.stringify([month,department.id,employee.userId]);
  await page.waitForFunction(({storageKey,draftKey})=>JSON.parse(sessionStorage.getItem(storageKey)||'{}')[draftKey]?.score==='83',{storageKey,draftKey});
  const savedDrafts=await page.evaluate(key=>sessionStorage.getItem(key),storageKey);
  for(let attempt=0;attempt<2;attempt++){
    await clickWorkbench();await leaders({preserveContext:true,selectedMonth:month});
    assert.equal(await score().inputValue(),'83');
    assert.equal(await comment().inputValue(),'虚构草稿：重复点击左侧工作台后继续编辑。');
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),savedDrafts);
  }
  await page.getByRole('tab',{name:'得分结果',exact:true}).click();await results();
  await clickWorkbench();await leaders({preserveContext:true,selectedMonth:month});
  assert.equal(await score().inputValue(),'83','return from results keeps the mounted leader draft');
  await page.getByRole('button',{name:'负责人评分月份',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'负责人评分月份选择面板',exact:true});
  if(month.slice(0,4)!==previous.slice(0,4))await picker.getByRole('button',{name:'上一年',exact:true}).click();
  await picker.getByRole('button',{name:monthName(previous),exact:true}).click();
  await leaders({selectedMonth:previous});assert.equal(await score().inputValue(),'','drafts stay isolated by month');
  await clickWorkbench();await leaders({preserveContext:true,selectedMonth:previous});
  assert.equal(await page.evaluate(({storageKey,draftKey})=>JSON.parse(sessionStorage.getItem(storageKey)||'{}')[draftKey]?.score,{storageKey,draftKey}),'83');
  await page.screenshot({path:path.join(dir,'boss-sidebar-entry.png'),fullPage:true,animations:'disabled'});
  record('repeated sidebar entry and tab/month changes preserve stored drafts');

  // Explicit employee-result links still bypass the role default, even without
  // scoreTab, and preserve the requested employee and detail tab after refresh.
  await page.goto(base+'/?page=scores&scoreMonth='+month+'&'+targetQuery);
  await results();await page.getByRole('tab',{name:'结果记录',exact:true}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'结果记录',exact:true}).getAttribute('aria-selected'),'true');
  await page.reload();await results();await locationValue('scoreEmployeeId',employee.userId);await locationValue('scoreDetailTab','history');
  assert((await page.locator('.pf-person-heading').innerText()).includes(employee.name));
  record('explicit employee result deep link and refresh remain available');
  await page.goto(base+'/?page=dashboard');await title('老板驾驶舱');await locationValue('page','dashboard');
  assert.equal(await nav().getByRole('button',{name:'老板驾驶舱',exact:true}).getAttribute('aria-current'),'page');
  await clickWorkbench();await leaders({preserveContext:true});
  record('boss explicit dashboard and sidebar return remain available');

  // A pending lower-level manager review must block the new same-page sidebar
  // entry, otherwise switching to leaders unmounts the in-flight result form.
  managerFixtureEnabled=true;
  managerGate=new Promise(resolve=>{releaseManager=resolve;});
  await page.goto(base+'/?page=scores&scoreTab=results&scoreMonth='+month);await results();
  const managerPanel=page.locator('.manager-reviews-panel');
  const managerScore=managerPanel.getByRole('spinbutton',{name:managerTask.name+'负责人评分',exact:true});
  await managerScore.fill('89');
  await managerPanel.getByRole('textbox',{name:managerTask.name+'月度评价',exact:true}).fill(managerComment);
  const managerRequest=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/manager-reviews'&&request.method()==='POST');
  await managerPanel.getByRole('button',{name:'提交积分',exact:true}).click();await managerRequest;
  await managerPanel.getByRole('button',{name:'提交中…',exact:true}).waitFor();
  assert(await managerScore.isDisabled(),'fixture holds the manager submission busy');
  await clickWorkbench();
  assert.equal(new URL(page.url()).searchParams.get('scoreTab'),'results','busy manager review blocks same-page sidebar navigation before URL mutation');
  assert.equal(await page.getByRole('tab',{name:'负责人评分',exact:true}).getAttribute('aria-selected'),'false');
  assert.equal(await selectedTab().innerText(),'得分结果');
  assert.equal(await managerScore.inputValue(),'89','busy submission form remains mounted');
  assert(await managerPanel.getByRole('button',{name:'提交中…',exact:true}).isDisabled());
  await page.screenshot({path:path.join(dir,'boss-manager-submit-busy.png'),fullPage:true,animations:'disabled'});
  releaseManager();
  await managerPanel.getByText('负责人评分已保存，占月度最终分的30%；同事互评全部完成后自动合成发布。',{exact:true}).waitFor();
  await managerPanel.getByText(managerComment,{exact:true}).waitFor();
  assert.equal(managerPosts.length,1);
  await clickWorkbench();await leaders({preserveContext:true,selectedMonth:month});
  managerFixtureEnabled=false;
  record('pending manager submission blocks sidebar reentry until successful completion');

  // Other perspectives retain their old entry points and workbench selection.
  role='admin';await page.goto(base+'/');await title('老板驾驶舱');await locationValue('page','dashboard');
  await clickWorkbench();await results();
  record('administrator root stays dashboard and workbench defaults to results');
  await page.getByRole('tab',{name:'月度配评',exact:true}).click();await setup();
  await clickWorkbench();await setup();
  await nav().getByRole('button',{name:'老板驾驶舱',exact:true}).click();await title('老板驾驶舱');
  await clickWorkbench();await setup();
  record('administrator selected setup survives same-page and cross-page sidebar entry');
  await page.goto(base+'/?page=scores');await results();

  role='member';const memberStart=requests.length;
  await page.goto(base+'/');await title('个人最终结果');await locationValue('page','growth');
  await clickWorkbench();await page.getByRole('heading',{name:'我的协作评分任务',exact:true}).waitFor();await locationValue('page','scores');
  await clickWorkbench();await page.getByRole('heading',{name:'我的协作评分任务',exact:true}).waitFor();
  assert.equal(await page.locator('.boss-leader-panel').count(),0);
  assert(!requests.slice(memberStart).some(request=>request.path==='/api/performance/manage'||request.path==='/api/departments'),'member entry does not load management scoring');
  record('member default and repeated sidebar entry retain personal scoring tasks');

  role='external';const externalStart=requests.length;
  await page.goto(base+'/');await title('老板驾驶舱');await locationValue('page','dashboard');
  await clickWorkbench();await page.getByRole('heading',{name:'我的协作评分任务',exact:true}).waitFor();
  assert.equal(await page.locator('.boss-leader-panel').count(),0);
  assert(!requests.slice(externalStart).some(request=>request.path==='/api/performance/manage'||request.path==='/api/departments'),'external entry does not load management scoring');
  assert.equal(await nav().getByRole('button',{name:'周报质量',exact:true}).count(),0);
  record('external default and sidebar behavior remain unchanged');

  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(unexpected,[]);assert.equal(managerPosts.length,1);
  const result={ok:true,cases,syntheticIdentities:true,syntheticManagerPosts:managerPosts.length,browserErrors:errors,businessWrites:writes,realScoringWrites:0,externalRequests:0,messagesSent:0,artifacts:dir};
  await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}catch(error){
  releaseManager?.();
  const page=browser?.pages().at(-1);
  if(page)await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true,animations:'disabled',timeout:3000}).catch(()=>{});
  await writeFile(path.join(dir,'diagnostic.json'),JSON.stringify({role,cases,errors,writes,unexpected,requests,syntheticManagerPosts:managerPosts.length},null,2));
  throw error;
}finally{
  releaseManager?.();
  if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  console.log('Artifacts retained:',dir);
}
