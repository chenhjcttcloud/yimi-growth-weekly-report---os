import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// Only compiled application UI and synthetic API fixtures. No application DB,
// real account, integration, cleanup or production request is involved.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/boss-leader-scoring-ui-')),staticDir=process.env.TEST_STATIC_DIR?path.resolve(process.env.TEST_STATIC_DIR):dir+'/dist';
if(!process.env.TEST_STATIC_DIR){const built=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',staticDir,'--emptyOutDir','false'],{encoding:'utf8'});assert.equal(built.status,0,built.stdout+'\n'+built.stderr);}
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(request,response)=>{
 const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname),file=path.resolve(staticDir,'.'+pathname);
 if(file!==staticDir&&!file.startsWith(staticDir+path.sep)){response.writeHead(403);response.end();return;}
 try{const target=pathname==='/'?staticDir+'/index.html':file,bytes=await readFile(target);response.writeHead(200,{'content-type':types[path.extname(target)]||'application/octet-stream'});response.end(bytes);}catch{response.writeHead(404);response.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const monthNow=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7);
const older=value=>{const date=new Date(value+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7);};
const month=older(monthNow),previous=older(month),monthName=value=>`${value.slice(0,4)} 年 ${Number(value.slice(5))} 月`;
const people=[{userId:'lead-a',name:'虚构甲',department:'北部团队 / 协作团队',active:true,departmentIds:['north','support']},{userId:'lead-b',name:'虚构乙',department:'已评团队',active:true,departmentIds:['done']},{userId:'lead-old',name:'虚构前任',department:'历史团队',active:true,departmentIds:['frozen']},{userId:'lead-new',name:'虚构新任',department:'历史团队',active:true,departmentIds:['frozen']}];
const departments=[{id:'north',name:'北部团队',leader_user_id:'lead-a',leaderName:'虚构甲'},{id:'support',name:'协作团队',leader_user_id:'lead-a',leaderName:'虚构甲'},{id:'done',name:'已评团队',leader_user_id:'lead-b',leaderName:'虚构乙'},{id:'missing',name:'待配置团队',leader_user_id:'',leaderName:''},{id:'frozen',name:'历史团队',leader_user_id:'lead-new',leaderName:'虚构新任'},{id:'frozen-current',name:'真实冻结形状团队',leader_user_id:'lead-new',leaderName:'虚构新任'}];
const archived=[{id:'archived',name:'已移除团队',leader_user_id:'lead-old',leaderName:'虚构前任',feishu_deleted:true,is_active:0}];
const targets=departments.filter(department=>department.leader_user_id).map(department=>({departmentId:department.id,leaderUserId:department.id==='frozen'?'lead-old':department.leader_user_id,name:department.id==='frozen'?'虚构前任':department.leaderName,frozen:department.id.startsWith('frozen'),ratingRequired:department.id!=='frozen-current'}));
const saved=new Map();
function scores(selected){if(!saved.has(selected))saved.set(selected,[{department_id:'done',leader_user_id:'lead-b',month:selected,score:88,comment:'虚构已保存评价，不能修改。',scorer_name:'虚构老板',created_at:selected+'-28 02:00:00'},{department_id:'frozen',leader_user_id:'lead-old',month:selected,score:79,comment:'虚构按月锁定的原负责人评价。',scorer_name:'虚构老板',created_at:selected+'-28 02:00:00'},{department_id:'frozen',leader_user_id:'lead-b',month:selected,score:77,comment:'虚构更早负责人评价。',scorer_name:'虚构老板',created_at:selected+'-26 02:00:00'},{department_id:'frozen-current',leader_user_id:'lead-old',month:selected,score:82,comment:'真实API形状的前任锁定评价。',scorer_name:'虚构老板',created_at:selected+'-25 02:00:00'},{department_id:'archived',leader_user_id:'lead-old',month:selected,score:75,comment:'虚构已移除部门历史评价。',scorer_name:'虚构老板',created_at:selected+'-28 02:00:00'}]);return saved.get(selected);}
const statistics={expected:0,submitted:0,onTime:0,late:0,missing:0,pendingTimestamp:0,pendingCalendar:0,rate:null};
const overview={months:[month,previous],employees:[people[0]],monthly:[month,previous].map(selected=>({...people[0],month:selected,reports:[],timeliness:statistics,peerCandidate:null,managerProgress:{kind:'boss',expected:1,submitted:0,complete:false,score:null},collaborationExpected:0,collaborationSubmitted:0})),results:[],collaborations:[]};
let role='boss',failSave=false,submitGate=null,getGate=null,gatedMonth='',posts=[],gets=[],performanceGets=0,releaseOld,releaseSave,releaseRacePost,releaseRaceGet;
function releaseHeldRequests(){releaseOld?.();releaseSave?.();releaseRacePost?.();releaseRaceGet?.();getGate=null;submitGate=null;gatedMonth='';}
const unexpected=new Set(),errors=[];let browser;
function departmentPayload(selected){return {ok:true,month:selected,canScore:role==='boss',currentUserId:role==='boss'?'boss':'admin',departments:structuredClone(departments),archivedDepartments:structuredClone(archived),employees:structuredClone(people),scoreTargets:structuredClone(targets),scores:structuredClone(scores(selected))};}
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base){unexpected.add(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  let body;
  switch(url.pathname){
   case '/api/management-data':body={prototypeData:{meta:{periods:[]}}};break;
   case '/api/me':body={user:{userId:role==='boss'?'boss':role==='member'?'member':'admin',name:'虚构'+role},access:{role:role==='admin'?'system_admin':role,currentEmployee:{userId:role,name:'虚构'+role,department:'虚构团队'},visibleEmployees:people,canManageScoring360:role!=='member',canManagePersonnel:role!=='member',canViewSettings:role!=='member',canViewBossDashboard:role==='boss'}};break;
   case '/api/departments':{
    const selected=url.searchParams.get('month')||month;gets.push(selected);if(getGate&&selected===gatedMonth)await getGate;
    try{return await route.fulfill({status:200,json:departmentPayload(selected)});}catch(error){if(request.failure()?.errorText)return;throw error;}
   }
   case '/api/departments/score':{
    assert.equal(request.method(),'POST');const value=request.postDataJSON();posts.push(value);assert.deepEqual(Object.keys(value).sort(),['comment','departmentId','leaderUserId','month','score']);assert.equal(value.leaderUserId,'lead-a');if(submitGate)await submitGate;
    if(failSave)return route.fulfill({status:503,json:{ok:false,error:'fixture_save_failed'}});
    assert(!scores(value.month).some(score=>score.department_id===value.departmentId&&score.leader_user_id===value.leaderUserId),'submitted scores cannot be overwritten');
    scores(value.month).push({department_id:value.departmentId,leader_user_id:value.leaderUserId,month:value.month,score:Number(value.score),comment:value.comment,scorer_name:'虚构老板',created_at:value.month+'-28 03:00:00'});
    return route.fulfill({status:200,json:{ok:true}});
   }
   case '/api/performance/manage':performanceGets++;body=overview;break;
   case '/api/manager-reviews':body={ok:true,month,canReview:false,hasResponsibilities:false,tasks:[]};break;
   case '/api/scoring360/my-tasks':body={ok:true,tasks:[],cycleId:''};break;
   case '/api/scoring360/workbench':body={month,revision:'fixture',editable:false,cycle:null,people:[],rows:[],counts:{total:0,configured:0,pending:0,issues:0,ready:0},checks:[],copy:{sourceMonth:'',sourceCount:0,pairs:[],groups:[],skipped:{}}};break;
   case '/api/scoring360/recurring-plan':body={configured:false,sources:[],current:{month,state:'not_configured',issues:[]}};break;
   case '/api/notifications':body={items:[],unreadCount:0};break;
   case '/api/dev/views':body={ok:false};break;
   case '/api/usage/visit':case '/api/usage/heartbeat':body={ok:true};break;
   default:unexpected.add(url.pathname);body={error:'unexpected_fixture_request'};
  }
  return route.fulfill({status:200,json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/?page=scores');await page.getByRole('heading',{name:'得分页',exact:true}).waitFor();
 const panel=page.getByRole('region',{name:'负责人评分',exact:true}),editor=panel.locator('.bl-editor');await panel.getByRole('spinbutton',{name:'虚构甲老板评分',exact:true}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'负责人评分',exact:true}).getAttribute('aria-selected'),'true','boss opens directly on leader scoring');assert.equal(performanceGets,0,'leader entry need not load company results first');
 assert.equal(new URL(page.url()).searchParams.get('scoreMonth'),month);assert.equal(await page.getByRole('button',{name:'负责人评分月份',exact:true}).count(),1,'one shared month picker');
 const row=id=>panel.locator(`.bl-person[data-department-id="${id}"]`),score=()=>editor.getByRole('spinbutton',{name:'虚构甲老板评分',exact:true}),comment=()=>editor.getByRole('textbox',{name:'虚构甲评分说明',exact:true});
 assert.match(await panel.getByRole('tab',{name:/^待评分/}).innerText(),/^待评分\s*2$/);assert.match(await panel.getByRole('tab',{name:/^已完成/}).innerText(),/^已完成\s*2$/);assert.match(await panel.getByRole('tab',{name:/^待配置/}).innerText(),/^待配置\s*2$/);assert.equal(await row('north').count(),1);assert.equal(await row('support').count(),1,'one leader with two departments remains two rating tasks');
 await page.screenshot({path:dir+'/boss-leader-pending-desktop.png',fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1));await score().scrollIntoViewIfNeeded();await page.screenshot({path:dir+'/boss-leader-pending-mobile.png',animations:'disabled'});await page.setViewportSize({width:1440,height:1100});
 await panel.getByRole('tab',{name:/^已完成/}).click();assert.equal(await row('done').count(),1);assert.equal(await row('frozen').count(),1);
 await row('frozen').click();assert((await editor.innerText()).includes('虚构前任'));assert((await editor.innerText()).includes('79'));assert.equal(await editor.getByRole('button',{name:'提交评分',exact:true}).count(),0,'saved frozen target remains locked');await editor.getByText('本月历任负责人评分（1）',{exact:true}).click();await editor.getByText('虚构更早负责人评价。',{exact:true}).waitFor();
 await panel.getByRole('tab',{name:/^待配置/}).click();await row('missing').click();assert.equal(await editor.getByRole('spinbutton').count(),0,'missing leader has no editable score');
 await row('frozen-current').click();await editor.getByRole('heading',{name:'虚构新任',exact:true}).waitFor();assert.equal(await editor.getByRole('spinbutton').count(),0,'current leader is not editable when the real API freezes the former leader score');await editor.getByText('本月沿用已提交的原评分关系，新岗位从下月开始评分。',{exact:true}).waitFor();await editor.getByText('本月历任负责人评分（1）',{exact:true}).click();await editor.getByText('真实API形状的前任锁定评价。',{exact:true}).waitFor();
 await panel.getByRole('tab',{name:/^全部/}).click();await panel.getByRole('textbox',{name:'搜索负责人或部门',exact:true}).fill('协作');assert.equal(await row('support').count(),1);assert.equal(await row('north').count(),0);await panel.getByRole('textbox',{name:'搜索负责人或部门',exact:true}).fill('');
 await panel.getByRole('tab',{name:/^待评分/}).click();await row('north').click();await score().fill('0');await comment().fill('十月虚构零分草稿，等待明确反馈。');
 let pickerYear=Number(month.slice(0,4));
 async function chooseMonth(selected,wait=true){await page.getByRole('button',{name:'负责人评分月份',exact:true}).click();const dialog=page.getByRole('dialog',{name:'负责人评分月份选择面板',exact:true});await dialog.waitFor();const year=Number(selected.slice(0,4));while(pickerYear>year){await dialog.getByRole('button',{name:'上一年',exact:true}).click();pickerYear--;}while(pickerYear<year){await dialog.getByRole('button',{name:'下一年',exact:true}).click();pickerYear++;}const request=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/departments'&&new URL(request.url()).searchParams.get('month')===selected);await dialog.getByRole('button',{name:monthName(selected),exact:true}).click();await request;if(wait)await panel.locator('.bl-person').first().waitFor();}
 await chooseMonth(previous);await row('north').click();assert.equal(await score().inputValue(),'');assert.equal(await comment().inputValue(),'');await score().fill('76');await comment().fill('九月虚构独立草稿。');
 await chooseMonth(month);await row('north').click();assert.equal(await score().inputValue(),'0');assert.equal(await comment().inputValue(),'十月虚构零分草稿，等待明确反馈。');
 await page.reload();await score().waitFor();assert.equal(await score().inputValue(),'0');assert.equal(await comment().inputValue(),'十月虚构零分草稿，等待明确反馈。','draft survives refreshing the scoring page');
 getGate=new Promise(resolve=>{releaseOld=resolve;});gatedMonth=previous;await chooseMonth(previous,false);await chooseMonth(month);releaseOld();getGate=null;gatedMonth='';await page.waitForTimeout(100);assert.equal(new URL(page.url()).searchParams.get('scoreMonth'),month);await row('north').click();assert.equal(await score().inputValue(),'0');
 failSave=true;submitGate=new Promise(resolve=>{releaseSave=resolve;});const post=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/departments/score');await editor.getByRole('button',{name:'提交并评下一位',exact:true}).click();await post;assert(await page.getByRole('button',{name:'负责人评分月份',exact:true}).isDisabled());assert(await score().isDisabled());releaseSave();submitGate=null;
 await panel.getByRole('alert').waitFor();assert.equal(await editor.getAttribute('data-department-id'),'north');assert.equal(await score().inputValue(),'0');assert.equal(await comment().inputValue(),'十月虚构零分草稿，等待明确反馈。');assert.equal(posts[0].departmentId,'north');assert.equal(posts[0].month,month);assert.equal(Number(posts[0].score),0);
 failSave=false;await editor.getByRole('button',{name:'提交并评下一位',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.bl-editor')?.getAttribute('data-department-id')==='support');assert.equal(posts[1].departmentId,'north');assert.equal(posts[1].month,month);
 assert.equal(await score().inputValue(),'','same leader’s other department has an independent score draft');assert.equal(await comment().inputValue(),'');await score().fill('91');await comment().fill('协作团队单独评价，不能合并到北部团队。');await editor.getByRole('button',{name:'提交评分',exact:true}).click();await panel.getByRole('tab',{name:/^已完成/}).click();await row('support').click();await editor.getByText('协作团队单独评价，不能合并到北部团队。',{exact:true}).waitFor();assert.equal(posts[2].departmentId,'support');assert.equal(posts[2].leaderUserId,'lead-a');
 await panel.getByRole('tab',{name:/^已完成/}).click();await row('north').click();assert.equal(await editor.getByRole('spinbutton').count(),0);assert((await editor.innerText()).includes('十月虚构零分草稿'));
 await panel.getByText(/已移除部门历史评分/).first().click();await panel.getByText('虚构已移除部门历史评价。',{exact:true}).waitFor();
 await panel.evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:dir+'/boss-leader-desktop.png',fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1));await page.locator('.content-shell').evaluate(element=>element.scrollTo({top:0}));await page.screenshot({path:dir+'/boss-leader-mobile.png',animations:'disabled'});
 await page.setViewportSize({width:1440,height:1100});await chooseMonth(previous);await row('north').click();assert.equal(await score().inputValue(),'76');
 // Back/forward navigation bypasses the disabled month picker. A successful
 // older-month POST must not abort the new month's already pending GET.
 const raceMonth=older(previous);submitGate=new Promise(resolve=>{releaseRacePost=resolve;});getGate=new Promise(resolve=>{releaseRaceGet=resolve;});gatedMonth=raceMonth;
 const racePost=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/departments/score');await editor.getByRole('button',{name:'提交评分',exact:true}).click();await racePost;
 async function popMonth(selected){const request=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/departments'&&new URL(request.url()).searchParams.get('month')===selected);await page.evaluate(value=>{const url=new URL(location.href);url.searchParams.set('scoreMonth',value);history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'));},selected);await request;}
 await popMonth(raceMonth);const raceResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/departments/score');releaseRacePost();submitGate=null;assert((await raceResponse).ok());await page.waitForFunction(()=>!document.querySelector('button[aria-label="负责人评分月份"]')?.disabled);
 releaseRaceGet();getGate=null;gatedMonth='';await score().waitFor();assert.equal(new URL(page.url()).searchParams.get('scoreMonth'),raceMonth);assert.equal(await score().inputValue(),'');assert.equal(await comment().inputValue(),'','new month still renders after older-month save resolves');
 await popMonth(previous);await panel.getByRole('tab',{name:/^已完成/}).click();await row('north').click();await editor.getByText('九月虚构独立草稿。',{exact:true}).waitFor();assert.equal(await editor.getByRole('spinbutton').count(),0,'older-month successful score remains saved and locked');assert.equal(posts[3].month,previous);assert.equal(posts[3].departmentId,'north');assert.equal(posts[3].score,'76');
 await page.goto(base+'/?page=scores&scoreTab=results&scoreMonth='+month);await page.getByText('评分完成，结果自动呈现',{exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'得分结果',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await page.locator('.boss-leader-panel').count(),0);
 await page.goto(base+'/?page=scores&scoreTab=setup&scoreMonth='+month);await page.getByRole('region',{name:'月度配评工作台',exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'月度配评',exact:true}).getAttribute('aria-selected'),'true');
 await page.goto(base+'/?page=scores&scoreTarget=1&scoreEmployeeId=lead-a&scoreMonth='+month);await page.getByText('评分完成，结果自动呈现',{exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'得分结果',exact:true}).getAttribute('aria-selected'),'true','existing result target opens results directly');assert.equal(await page.locator('.boss-leader-panel').count(),0);
 role='admin';await page.goto(base+'/?page=scores&scoreTab=leaders&scoreMonth='+previous);await score().waitFor();assert(await score().isDisabled());assert(await comment().isDisabled());assert(await editor.getByRole('button',{name:'提交评分',exact:true}).isDisabled());assert(await editor.getByRole('button',{name:'提交并评下一位',exact:true}).isDisabled(),'admin pending tasks cannot submit');await panel.getByRole('tab',{name:/^已完成/}).click();await row('done').click();assert.equal(await editor.getByRole('button',{name:/提交评分|提交并评下一位/}).count(),0,'admin may read leader scores but never submits');assert.equal(await editor.getByRole('spinbutton').count(),0);
 role='member';await page.goto(base+'/?page=scores&scoreTab=leaders');await page.getByRole('heading',{name:'我的协作评分任务',exact:true}).waitFor();assert.equal(await page.locator('.boss-leader-panel').count(),0,'regular employee cannot mount management scoring');
 assert.deepEqual(errors,[]);assert.deepEqual([...unexpected],[]);assert.equal(posts.length,4);assert(gets.includes(month)&&gets.includes(previous));
 const result={ok:true,pageRenamed:true,bossDefaultDirect:true,explicitResultsAndSetupPreserved:true,resultTargetOpensResults:true,oneSharedMonthPicker:true,pendingCompleteBlockedClear:true,sameLeaderSeparateDepartments:true,frozenAndArchivedHistoryPreserved:true,realFrozenCurrentTargetBlocked:true,searchFilter:true,zeroScoreAccepted:true,failedSaveKeepsDraft:true,submitAndNextOnlyAfterSuccess:true,monthDraftIsolation:true,draftSurvivesRefresh:true,staleResponseIgnored:true,popstateDuringSubmitKeepsNewMonthAndSavedReceipt:true,monthDisabledWhileSubmitting:true,submittedLocks:true,adminReadOnly:true,memberManagementHidden:true,mobileNoOverflow:true,syntheticSubmissions:posts.length,realScoringWrites:0,externalRequests:0,messagesSent:0,artifacts:dir};
 await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){releaseHeldRequests();if(browser){const page=browser.contexts()[0]?.pages().at(-1);if(page)await page.screenshot({path:dir+'/failure.png',animations:'disabled',timeout:3000}).catch(()=>{});}throw error;}finally{releaseHeldRequests();if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));console.log('Artifacts retained:',dir);}
