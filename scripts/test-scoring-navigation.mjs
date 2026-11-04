import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// Identity and every API response are synthetic. This test uses no backend,
// business database, integration or credentials, and retains all artifacts.
const build=path.resolve(process.env.SCORING_NAVIGATION_BUILD_DIR||process.env.TEST_STATIC_DIR||'outputs/scoring-navigation-preview');
await readFile(path.join(build,'index.html'));
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/scoring-navigation-'));
const currentMonth=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7);
const prior=new Date(currentMonth+'-01T00:00:00Z');prior.setUTCMonth(prior.getUTCMonth()-1);
const historical=prior.toISOString().slice(0,7),months=[currentMonth,historical];
const monthName=month=>`${month.slice(0,4)} 年 ${Number(month.slice(5))} 月`;
const employees=[{userId:'score-fixture-a',name:'虚构甲',department:'虚构产品部'},{userId:'score-fixture-b',name:'虚构乙',department:'虚构研发部'}];
const admin={userId:'score-fixture-admin',name:'虚构管理员',department:'虚构管理部'};
const timing={expected:1,submitted:1,onTime:1,late:0,missing:0,pendingTimestamp:0,pendingCalendar:0,rate:100};
function week(month){const start=month+'-05',end=month+'-09';return {id:'period-'+end,label:month+'测试周',start,end,range:start+' — '+end};}
function report(person,month,full=false){const w=week(month);return {
  id:person.userId+'-'+month,employeeUserId:person.userId,name:person.name,department:person.department,month,start:w.start,end:w.end,
  submittedAt:w.end+'T09:00:00Z',status:'准时',submitted:true,candidate:82,detailsDeferred:!full,scoringPolicy:{weights:[30,25,25,20]},
  ...(full?{evidence:[{module:'本周成果',text:person.name+'的虚构周报证据'}],anomalies:[],suggestions:'继续完善交付证据',content:{results:'虚构原文'}}:{}),
};}
const monthly=months.flatMap(month=>employees.map(person=>({...person,month,reports:[report(person,month)],timeliness:timing,peerCandidate:91,
  collaborationExpected:1,collaborationSubmitted:1,managerProgress:{kind:'manager',submitted:1,expected:1,complete:true,score:90}})));
function cycle(month,full=false){return {id:month+'-fixture',month,label:month+'虚构协同互评',expected:2,submitted:2,pending:[],
  ...(full?{assignments:employees.map((person,index)=>({id:month+'-'+index,evaluee_user_id:person.userId,evaluator_name:'虚构评分人',score:91,comment:'虚构协作评价',submitted_at:month+'-28T09:00:00Z'}))}:{}),
};}
const results=months.flatMap(month=>employees.flatMap(person=>['quality','timeliness','collaboration'].map(kind=>({
  month,employee_user_id:person.userId,kind,scoring_rule:kind==='collaboration'?'weighted_30_70':'automatic_report',
  result:kind==='timeliness'?{rate:100}:{score:kind==='quality'?82:90.7},confirmed_by:'系统自动生成',confirmed_at:month+'-28T09:00:00Z',
  evidenceSummary:{reviewNote:'虚构测试评分依据'},
}))));
const overview={ok:true,months,employees,monthly,collaborations:months.map(month=>cycle(month)),results};
const meta={periods:months.slice().reverse().map(month=>week(month)),current_week_id:week(currentMonth).id,generated_on:week(currentMonth).end,people_count:0};
const management={prototypeData:{meta,employee_summary:[],weekly_scores:[]},kimiInsights:{},kimiInsightsByPeriod:{},monthlyMeetingInsights:{},scoring360:{cycles:[],results:[],assignments:[],responses:[]}};
function workspace(person,month,weekId){const w=week(month);return {
  ok:true,employee:person,months,month,selectedWeekId:weekId||w.id,monthSummary:{...timing,upcoming:0},
  weeks:[{...w,status:'准时',submitted:true,submittedAt:w.end+'T09:00:00Z',dueAt:w.end+'T20:00:00+08:00',schedule:{},
    facts:{results:person.name+'的虚构周报证据',problems:'虚构问题',plan:'虚构下周计划',reflection:'虚构复盘'},qualityReference:82,scoringWeights:[30,25,25,20],radar:[],closure:{}}],
  history:months.map(value=>({month:value,quality:82,timeliness:timing,collaboration:90.7,collaborationRule:'weighted_30_70'})),
  ratingProgress:{peerComplete:true,managerComplete:true,managerKind:'manager'},tasks:[],comments:[],messages:[],analysis:null,likeCount:0,liked:false,aiConfigured:false,taskCreateEnabled:false,
};}
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');if(/^\/(api|auth|share)(\/|$)/.test(url.pathname))throw Error('unmocked_api');
  let file=path.resolve(build,'.'+decodeURIComponent(url.pathname));if(file!==build&&!file.startsWith(build+path.sep))throw Error('invalid_path');
  if(!(await stat(file).catch(()=>null))?.isFile())file=path.join(build,'index.html');
  res.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser,role='manager';const errors=[],writes=[],unexpected=[],manageRequests=[],workspaceRequests=[],detailRequests=[];
try{
  browser=await chromium.launchPersistentContext(dir+'/browser-profile',{channel:'chrome',headless:true,viewport:{width:1440,height:1000}});
  await browser.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==base){unexpected.push(url.origin);return route.abort();}
    if(!/^\/(api|auth|share)(\/|$)/.test(url.pathname))return route.continue();
    const p=url.pathname,json=value=>route.fulfill({status:200,json:value});
    if(req.method()!=='GET'){
      if(p.startsWith('/api/usage/'))return json({ok:true});
      writes.push(p);return route.abort();
    }
    if(p==='/api/me'){
      const manager=role==='manager'||role==='admin',external=role==='external',person=role==='member'?employees[0]:admin;
      return json({ok:true,user:{...person,role:external?'external_boss_view':role==='admin'?'system_admin':role==='manager'?'hr':'member',bossView:external||role==='admin'},access:{
        role:external?'external_boss_view':role==='admin'?'system_admin':role==='manager'?'hr':'member',externalView:external,bossView:external||role==='admin',
        canViewBossDashboard:external||role==='admin',canViewSettings:manager,canManageScoring360:manager,canManagePersonnel:manager,
        currentEmployee:person,visibleEmployees:manager?[admin,...employees]:[person],
      }});
    }
    if(p==='/api/dev/views')return route.fulfill({status:404,json:{ok:false}});
    if(p==='/api/management-data')return json(url.searchParams.get('view')==='bootstrap'?{prototypeData:{meta}}:management);
    if(p==='/api/performance/manage'){manageRequests.push({role,path:p});return json(overview);}
    if(p==='/api/performance/employee-month'){
      const userId=url.searchParams.get('employeeId'),month=url.searchParams.get('month'),person=employees.find(value=>value.userId===userId);
      assert(person,'detail requests must identify a fixture employee');
      detailRequests.push({userId,month});
      return json({ok:true,monthly:{...monthly.find(value=>value.userId===userId&&value.month===month),reports:[report(person,month,true)]},collaborations:[cycle(month,true)],results:results.filter(value=>value.employee_user_id===userId&&value.month===month)});
    }
    if(p==='/api/personal/workspace'||p==='/api/admin/employee-preview/workspace'){
      const preview=p.includes('employee-preview'),person=preview?employees.find(value=>value.userId===url.searchParams.get('employeeId')):role==='admin'?admin:employees[0];
      assert(person,'preview requests must identify a fixture employee');
      const month=url.searchParams.get('month')||currentMonth,weekId=url.searchParams.get('weekId');
      workspaceRequests.push({path:p,userId:person.userId,month});return json(workspace(person,month,weekId));
    }
    if(p==='/api/manager-reviews'||p==='/api/admin/employee-preview/manager-reviews')return json({ok:true,month:url.searchParams.get('month'),canReview:false,hasResponsibilities:false,tasks:[],weights:{manager:30,peers:70}});
    if(p==='/api/scoring360/my-tasks')return json({ok:true,tasks:[],cycleId:'fixture-cycle'});
    if(p==='/api/notifications')return json({ok:true,notifications:[],unreadCount:0});
    if(p==='/api/management/summary')return json({ok:true,summary:null});
    unexpected.push(p);return route.fulfill({status:404,json:{error:'unexpected_fixture_request'}});
  });
  const page=await browser.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  const nav=()=>page.getByRole('navigation',{name:'主导航',exact:true});
  async function title(value){await page.waitForFunction(text=>document.querySelector('.app-header h1')?.textContent===text,value);}
  async function urlValue(key,value){await page.waitForFunction(({key,value})=>new URL(location.href).searchParams.get(key)===value,{key,value});}
  async function chooseMonth(label,month){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:monthName(month),exact:true}).click();}

  // Management shortcuts open focused results directly, retaining useful context.
  await page.goto(base+'/?page=quality-scores');await title('周报质量');await page.locator('.pf-confirm-list').waitFor();
  assert.equal(await nav().getByRole('button',{name:'周报质量',exact:true}).getAttribute('aria-current'),'page');
  assert.equal(await nav().getByRole('button',{name:'360 协同得分',exact:true}).count(),1);
  assert((await page.locator('.pf-confirm-list').innerText()).includes('周报质量'));
  assert(!(await page.locator('.pf-confirm-list').innerText()).includes('月度综合评分'));
  assert.equal(await page.getByRole('tab',{name:'协作明细',exact:true}).count(),0);
  assert.equal(await page.getByRole('tab',{name:'负责人评分',exact:true}).count(),0);
  assert.equal(await page.getByRole('combobox',{name:'选择周报周期',exact:true}).count(),0);
  await chooseMonth('选择绩效月份',historical);await urlValue('scoreMonth',historical);
  await page.locator('.pf-person').filter({hasText:employees[1].name}).click();await urlValue('scoreEmployeeId',employees[1].userId);
  await page.getByRole('tab',{name:'周报与证据',exact:true}).click();await page.getByText(employees[1].name+'的虚构周报证据',{exact:true}).waitFor();
  assert.deepEqual(detailRequests.at(-1),{userId:employees[1].userId,month:historical});
  await page.reload();await title('周报质量');await page.getByText(employees[1].name+'的虚构周报证据',{exact:true}).waitFor();await urlValue('scoreMonth',historical);await urlValue('scoreEmployeeId',employees[1].userId);
  await page.screenshot({path:dir+'/quality-management.png',fullPage:true,animations:'disabled'});

  await nav().getByRole('button',{name:'360 协同得分',exact:true}).click();await title('360 协同得分');await page.locator('.pf-confirm-list').waitFor();
  await urlValue('scoreMonth',historical);await urlValue('scoreEmployeeId',employees[1].userId);
  assert(!(await page.locator('.pf-confirm-list').innerText()).includes('周报质量'));
  assert.equal(await page.getByRole('tab',{name:'周报与证据',exact:true}).count(),0);
  await page.getByRole('tab',{name:'协作明细',exact:true}).click();await page.getByText('虚构评分人',{exact:true}).waitFor();
  await page.reload();await title('360 协同得分');await page.getByText('虚构评分人',{exact:true}).waitFor();
  await page.screenshot({path:dir+'/collaboration-management.png',fullPage:true,animations:'disabled'});

  await page.goto(base+'/?page=quality-scores&scoreMonth='+historical+'&scoreEmployeeId='+employees[1].userId+'&scoreDetailTab=collaboration');
  await title('周报质量');await page.locator('.pf-confirm-list').waitFor();
  assert.equal(await page.getByRole('tab',{name:'结果概览',exact:true}).getAttribute('aria-selected'),'true','inapplicable old tabs must normalize to an available tab');
  await page.goto(base+'/?page=scores&scoreTab=results&scoreMonth='+historical);await title('评分工作台');
  for(const label of ['负责人评分','得分结果','月度配评'])assert.equal(await page.getByRole('tab',{name:label,exact:true}).count(),1);

  // Personal shortcuts never mount company scoring data or reveal raters.
  role='member';const memberManageStart=manageRequests.length;
  await page.goto(base+'/?page=quality-scores');await title('周报质量');await page.locator('.personal-workspace').waitFor();
  assert.equal(workspaceRequests.at(-1).userId,employees[0].userId);
  assert.equal(await page.locator('.pf-metric-label').filter({hasText:'周报质量分'}).count(),1);
  assert.equal(await page.locator('.pf-metric-label').filter({hasText:'月度综合最终分'}).count(),0);
  await chooseMonth('选择个人月份',historical);await urlValue('personalMonth',historical);await page.reload();await title('周报质量');await page.locator('.personal-workspace').waitFor();await urlValue('personalMonth',historical);
  await nav().getByRole('button',{name:'360 协同得分',exact:true}).click();await title('360 协同得分');await page.locator('.pf-metrics').waitFor();
  assert.equal(await page.locator('.personal-workspace').count(),0);
  assert.equal(await page.locator('.pf-metric-label').filter({hasText:'周报质量分'}).count(),0);
  assert.equal(await page.getByText('虚构评分人',{exact:true}).count(),0);
  assert.equal(manageRequests.length,memberManageStart,'member views must never request company result APIs');
  await page.screenshot({path:dir+'/collaboration-personal.png',fullPage:true,animations:'disabled'});

  // The external view has no scoring shortcut and cannot restore these routes.
  role='external';const externalManageStart=manageRequests.length;
  await page.goto(base+'/?page=quality-scores');await title('老板驾驶舱');await urlValue('page','dashboard');
  assert.equal(await nav().getByRole('button',{name:'周报质量',exact:true}).count(),0);
  assert.equal(await nav().getByRole('button',{name:'360 协同得分',exact:true}).count(),0);
  await page.goto(base+'/?page=collaboration-scores');await title('老板驾驶舱');await urlValue('page','dashboard');
  assert.equal(manageRequests.length,externalManageStart);

  // Admin personal and employee previews preserve the existing identity boundary.
  role='admin';await page.evaluate(userId=>localStorage.setItem('admin-perspective:'+userId,'personal'),admin.userId);
  const previewManageStart=manageRequests.length;
  await page.goto(base+'/?page=collaboration-scores');await title('360 协同得分');await page.locator('.pf-metrics').waitFor();
  assert.equal(workspaceRequests.at(-1).userId,admin.userId);assert.equal(workspaceRequests.at(-1).path,'/api/personal/workspace');
  await page.evaluate(({adminId,employeeId})=>localStorage.setItem('admin-perspective:'+adminId,'employee:'+employeeId),{adminId:admin.userId,employeeId:employees[1].userId});
  await page.goto(base+'/?page=quality-scores');await title('周报质量');await page.locator('.personal-workspace').waitFor();
  assert.equal(workspaceRequests.at(-1).userId,employees[1].userId);assert.equal(workspaceRequests.at(-1).path,'/api/admin/employee-preview/workspace');
  assert.equal(await page.getByRole('button',{name:'发布评论',exact:true}).isDisabled(),true);
  assert.equal(manageRequests.length,previewManageStart);

  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(unexpected,[]);
  const result={ok:true,focusedManagementShortcuts:true,selectedEmployeeAndMonthRetained:true,refreshRestoresFocus:true,staleTabNormalized:true,legacyWorkbenchPreserved:true,personalIsolation:true,externalPermissionFallback:true,adminPersonalAndPreview:true,browserErrors:errors,businessWrites:writes,realMessagesSent:0,artifacts:dir};
  await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
  const page=browser?.pages().at(-1);if(page)await page.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});
  await writeFile(dir+'/diagnostic.json',JSON.stringify({errors,writes,unexpected,manageRequests,workspaceRequests,detailRequests},null,2));throw error;
}finally{
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));console.log('Artifacts retained:',dir);
}
