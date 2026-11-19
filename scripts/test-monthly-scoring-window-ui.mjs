import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// Synthetic API responses and a local static build only. Keep all artifacts;
// no application database, external requests, messages or cleanup are used.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/monthly-scoring-window-ui-'));
const staticDir=process.env.TEST_STATIC_DIR?path.resolve(process.env.TEST_STATIC_DIR):dir+'/dist';
if(!process.env.TEST_STATIC_DIR){
 const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',staticDir,'--emptyOutDir','false'],{encoding:'utf8'});
 assert.equal(build.status,0,build.stdout+'\n'+build.stderr);
}
const server=createServer(async(request,response)=>{
 const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname),file=path.resolve(staticDir,'.'+pathname);
 if(file!==staticDir&&!file.startsWith(staticDir+path.sep)){response.writeHead(403);response.end();return;}
 try{const target=pathname==='/'?staticDir+'/index.html':file,bytes=await readFile(target);response.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(target)]||'application/octet-stream'});response.end(bytes);}catch{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,current='2026-11',previous='2026-10';
let closeAfterPeerRejection=false,rejectPeer=false;
const reviewWindow=month=>({month,opensAt:month===current?'2026-11-30T00:00:00+08:00':'2026-10-26T00:00:00+08:00',isOpen:month!==current&&!closeAfterPeerRejection,reason:month===current?'before_window':closeAfterPeerRejection?'draft':''});
const people=[{userId:'head',name:'虚构负责人',department:'测试团队'},{userId:'pending',name:'虚构待评员工',department:'测试团队'},{userId:'saved',name:'虚构已评员工',department:'测试团队'}];
const submitted=new Set(),requests=[],posts=[],errors=[],unexpected=[];
let role='member',browser;
const managerTasks=month=>[
 {employeeUserId:'pending',name:'虚构待评员工',department:'测试团队',submitted:submitted.has(month),locked:submitted.has(month),score:submitted.has(month)?85:null,comment:submitted.has(month)?'本月交付已核实':'',reports:[]},
 {employeeUserId:'saved',name:'虚构已评员工',department:'测试团队',submitted:true,locked:true,score:88.5,comment:'保留原有负责人评价',reports:[]},
];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base){unexpected.push(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(request.method()==='POST'&&!url.pathname.startsWith('/api/usage/'))posts.push({path:url.pathname,body:request.postDataJSON()});
  const month=url.searchParams.get('month')||current;let body;
  switch(url.pathname){
   case '/api/me':body={user:{userId:role==='boss'?'boss':'head',name:role==='boss'?'虚构老板':'虚构负责人'},access:{role,currentEmployee:people[0],visibleEmployees:people,canManageScoring360:role==='boss',canViewBossDashboard:role==='boss'}};break;
   case '/api/management-data':body={prototypeData:{meta:{periods:[]}}};break;
   case '/api/manager-reviews':
    if(request.method()==='POST'){const value=request.postDataJSON();assert.equal(value.month,previous);submitted.add(value.month);body={ok:true};}
    else{requests.push(['manager',month]);body={ok:true,month,canReview:true,hasResponsibilities:true,reviewWindow:reviewWindow(month),tasks:managerTasks(month)};}break;
   case '/api/scoring360/my-tasks':requests.push(['peer',month]);body={ok:true,month,cycleId:month+'-360',cycle:{id:month+'-360',status:'open',launchAt:month+'-01T00:00:00+08:00'},reviewWindow:reviewWindow(month),tasks:[{id:month+'-pending',evaluee:'虚构协作员工',score:null,comment:'',submitted:false,locked:false},{id:month+'-saved',evaluee:'虚构协作已评',score:91,comment:'保留原有协作评价',submitted:true,locked:true}]};break;
   case '/api/scoring360/submit':if(rejectPeer){closeAfterPeerRejection=true;return route.fulfill({status:409,json:{ok:false,error:'scoring_cycle_not_open'}});}body={ok:true,saved:1};break;
   case '/api/scoring360/workbench':body={month,reviewWindow:reviewWindow(month),revision:'fixture',editable:true,cycle:{id:month+'-360',status:'open'},people,rows:[],counts:{total:0,configured:0,pending:0,issues:0,ready:0},checks:[],copy:{sourceMonth:previous,sourceCount:0,pairs:[],groups:[],skipped:{}}};break;
   case '/api/scoring360/recurring-plan':body={configured:false,config:{enabled:false,sourceMonth:'',startMonth:'',versionId:'',pairCount:0,targetCount:0,updatedAt:''},sources:[],current:{month:current,state:'not_configured',issues:[],createdPairs:0,missingEmployeesCount:0,issueCount:0}};break;
   case '/api/departments':body={ok:true,month,reviewWindow:reviewWindow(month),canScore:true,currentUserId:'boss',departments:[{id:'team',name:'测试团队',leader_user_id:'head'},{id:'saved-team',name:'已评团队',leader_user_id:'saved'}],employees:people,scores:[],personScores:[{leader_user_id:'saved',month,score:89,comment:'保留原有老板评价'}],leaderScoreTargets:[{leaderUserId:'head',departmentIds:['team'],name:'虚构负责人',ratingRequired:true},{leaderUserId:'saved',departmentIds:['saved-team'],name:'虚构已评员工',ratingRequired:false,unavailableReason:'result_locked'}]};break;
   case '/api/notifications':body={items:[],unreadCount:0};break;
   case '/api/dev/views':body={ok:false};break;
   case '/api/usage/visit':case '/api/usage/heartbeat':body={ok:true};break;
   default:unexpected.push(url.pathname);body={ok:false};
  }
  return route.fulfill({status:200,json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install({time:new Date('2026-11-19T04:00:00Z')});
 await page.goto(base+'/?page=scores');
 const manager=page.locator('.manager-reviews-panel'),peer=page.locator('.pf-scoring');
 await manager.locator('.mr-review-card').first().waitFor();await peer.locator('.pf-evidence').first().waitFor();
 assert.equal(await page.getByRole('button',{name:'月度评分月份',exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'负责人评分月份',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'协作评分月份',exact:true}).count(),0);
 for(const input of await manager.locator('input,textarea').all())assert(await input.isDisabled());
 for(const input of await peer.locator('input,textarea').all())assert(await input.isDisabled());
 for(const button of await manager.getByRole('button',{name:'尚未开放',exact:true}).all())assert(await button.isDisabled());
 assert(await peer.getByRole('button',{name:'尚未开放',exact:true}).isDisabled());
 await manager.getByText('保留原有负责人评价',{exact:true}).waitFor();
 assert.equal(await peer.getByRole('textbox').nth(1).inputValue(),'保留原有协作评价');
 for(const section of [manager,peer])assert((await section.locator('[data-review-window]').innerText()).includes('北京时间 2026年11月30日 00:00'));
 assert.equal(posts.length,0,'closed windows must not submit scores');
 await page.screenshot({path:dir+'/01-before-window.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});const sharedPicker=page.getByRole('button',{name:'月度评分月份',exact:true});await sharedPicker.scrollIntoViewIfNeeded();
 const sharedBounds=await sharedPicker.boundingBox();assert(sharedBounds.x>=0&&sharedBounds.x+sharedBounds.width<=390,'the shared month picker stays in the mobile viewport');assert(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:dir+'/01b-shared-month-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1100});
 await page.getByRole('button',{name:'月度评分月份',exact:true}).click();
 const previousPeer=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/scoring360/my-tasks'&&new URL(response.url()).searchParams.get('month')===previous);
 await page.getByRole('button',{name:'2026 年 10 月',exact:true}).click();
 const managerPending=manager.locator('.mr-review-card').filter({has:page.getByRole('heading',{name:'虚构待评员工',exact:true})});
 await managerPending.getByRole('spinbutton').waitFor();
 await previousPeer;
 assert(requests.some(([kind,selected])=>kind==='manager'&&selected===previous));assert(requests.some(([kind,selected])=>kind==='peer'&&selected===previous));
 assert(await managerPending.getByRole('spinbutton').isEnabled());assert(await peer.getByRole('spinbutton').first().isEnabled());
 assert.equal(await page.locator('[data-review-window]').count(),0);
 await managerPending.getByRole('spinbutton').fill('85');await managerPending.getByRole('textbox').fill('本月交付已核实');await managerPending.getByRole('button',{name:'提交积分',exact:true}).click();
 await managerPending.getByText('本月交付已核实',{exact:true}).waitFor();
 assert.equal(posts.length,1);assert.equal(posts[0].body.month,previous);
 await peer.getByRole('spinbutton').first().fill('83');await peer.getByRole('button',{name:'提交积分',exact:true}).click();await peer.getByText('评分已提交，同事互评占70%；负责人或老板评分占30%，两部分完成后自动发布最终分。',{exact:true}).waitFor();
 assert.equal(posts.length,2);assert.equal(posts[1].body.cycleId,previous+'-360');
 rejectPeer=true;await peer.getByRole('spinbutton').first().fill('84');await peer.getByRole('button',{name:'提交积分',exact:true}).click();
 await peer.getByText('本月评分尚未开放，请刷新查看开放时间。',{exact:true}).waitFor();assert(await peer.getByRole('spinbutton').first().isDisabled());assert.equal(await peer.getByRole('spinbutton').first().inputValue(),'84','a rejected stale form keeps its draft while refreshing the window');
 assert(await peer.getByRole('button',{name:'尚未开放',exact:true}).isDisabled());assert.equal(posts.length,3);
 role='boss';await page.goto(base+'/?page=scores&scoreTab=leaders&scoreMonth='+current);
 const boss=page.getByRole('region',{name:'负责人评分',exact:true});await boss.getByRole('spinbutton',{name:'虚构负责人老板评分',exact:true}).waitFor();
 assert(await boss.getByRole('spinbutton').isDisabled());assert(await boss.getByRole('textbox',{name:'虚构负责人评分说明',exact:true}).isDisabled());
 assert.equal(await boss.getByRole('button',{name:'尚未开放',exact:true}).count(),2);
 for(const button of await boss.getByRole('button',{name:'尚未开放',exact:true}).all())assert(await button.isDisabled());
 await boss.getByRole('tab',{name:/^已完成/}).click();await boss.getByText('保留原有老板评价',{exact:true}).waitFor();
 assert.equal(posts.length,3,'closed boss window keeps existing scores visible without writes');
 await page.setViewportSize({width:390,height:844});await boss.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:dir+'/02-boss-before-window-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1100});await page.getByRole('tab',{name:'月度配评',exact:true}).click();
 const workbench=page.getByRole('region',{name:'月度配评工作台',exact:true});await workbench.getByText('待最后一周开放',{exact:true}).waitFor();assert((await workbench.locator('[data-review-window]').innerText()).includes('北京时间 2026年11月30日 00:00'));assert.equal(await workbench.locator('.wb-cycle-state.is-live').count(),0,'an old open cycle must not appear live before the unified window');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 const result={ok:true,closedManagerPeerBossDisabled:true,submittedHistoryPreserved:true,oneSharedMonthPicker:true,managerPeerMonthsLinked:true,openMonthSubmission:true,staleRejectionRefreshesWindow:true,configurationShowsUnifiedWindow:true,mobileNoOverflow:true,mockedSubmissions:posts.length,externalRequests:0,realWrites:0,artifacts:dir};
 await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));console.log('Artifacts retained:',dir);}
