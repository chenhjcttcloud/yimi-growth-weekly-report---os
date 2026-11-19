import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// Only a local build and synthetic API responses. No real sessions, grants,
// messages, application database or cleanup operations are used.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/three-perspectives-ui-'));
const staticDir=process.env.TEST_STATIC_DIR?path.resolve(process.env.TEST_STATIC_DIR):dir+'/dist';
if(!process.env.TEST_STATIC_DIR){const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',staticDir,'--emptyOutDir','false'],{encoding:'utf8'});assert.equal(build.status,0,build.stdout+'\n'+build.stderr);}
const server=createServer(async(request,response)=>{
 const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname),file=path.resolve(staticDir,'.'+pathname);
 if(file!==staticDir&&!file.startsWith(staticDir+path.sep)){response.writeHead(403);response.end();return;}
 try{const target=pathname==='/'?staticDir+'/index.html':file,bytes=await readFile(target);response.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(target)]||'application/octet-stream'});response.end(bytes);}catch{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).slice(0,7);
const dual={userId:'dual',name:'虚构双角色用户',department:'测试团队'},other={userId:'staff',name:'虚构员工乙',department:'测试团队'},plain={userId:'plain-admin',name:'虚构普通管理员',department:'管理部'};
let active='boss',scenario='dual',failure=0,browser;
const posts=[],meReads=[],unexpected=[],errors=[],navigations=[];
function me(){
 const user=scenario==='plain-admin'?plain:dual;
 const role=scenario==='plain-admin'||active==='admin'?'system_admin':active==='boss'?'boss':'member';
 const management=role!=='member',result={user,access:{role,currentEmployee:user,visibleEmployees:management?[user,other]:[user],canManageScoring360:management,canManagePersonnel:management,canViewSettings:management,canViewBossDashboard:management}};
 if(scenario!=='plain-admin')Object.assign(result,{canSwitchPerspective:true,activePerspective:active});
 if(scenario==='dual')result.availablePerspectives=['boss','admin','admin','employee','unknown',null,7];
 if(scenario==='boss-only')result.availablePerspectives=['boss','employee'];
 if(scenario==='invalid-options')result.availablePerspectives=['unknown',null];
 return result;
}
function workspace(employee,selected){return {ok:true,employee,month:selected,months:[selected],weeks:[],tasks:[],history:[],comments:[],selectedWeekId:'',ratingProgress:null};}
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{localStorage.setItem('admin-perspective:dual','personal');localStorage.setItem('admin-perspective:plain-admin','personal');});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base){unexpected.push(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  let body;
  switch(url.pathname){
   case '/api/me':{body=me();meReads.push({userId:body.user.userId,perspective:active,scenario});break;}
   case '/api/session/perspective':{
    assert.equal(request.method(),'POST');const payload=request.postDataJSON();assert.deepEqual(Object.keys(payload),['perspective']);posts.push(payload);
    if(failure){const status=failure;failure=0;return route.fulfill({status,json:{ok:false,error:'fixture_rejected'}});}
    assert(['boss','admin','employee'].includes(payload.perspective));active=payload.perspective;body={ok:true};break;
   }
   case '/api/management-data':body={prototypeData:{meta:{periods:[]},employee_summary:[],weekly_scores:[]},scoring360:{cycles:[],results:[],assignments:[],responses:[]}};break;
   case '/api/management/summary':body={summary:null};break;
   case '/api/notifications':body={notifications:[],unreadCount:0};break;
   case '/api/dev/views':body={ok:false};break;
   case '/api/departments':body={ok:true,month,departments:[],employees:[dual,other],scores:[],personScores:[],leaderScoreTargets:[],canScore:active==='boss',currentUserId:dual.userId};break;
   case '/api/personal/workspace':body=workspace(scenario==='plain-admin'?plain:dual,url.searchParams.get('month')||month);break;
   case '/api/admin/employee-preview/workspace':body=workspace(other,url.searchParams.get('month')||month);break;
   case '/api/usage/visit':case '/api/usage/heartbeat':body={ok:true};break;
   default:unexpected.push(url.pathname);body={ok:false};
  }
  return route.fulfill({status:200,json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations.push(frame.url());});
 const sessionPicker=()=>page.getByRole('combobox',{name:'切换视角',exact:true});
 async function options(){await sessionPicker().click();return page.getByRole('option').allTextContents();}
 async function settlePicker(){const panel=page.locator('.app-select-panel');await panel.waitFor();await panel.evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));});assert.equal(await panel.evaluate(element=>getComputedStyle(element).opacity),'1','the perspective menu is fully opaque before visual verification');}
 async function switchSession(label){await sessionPicker().click();const nextDocument=page.waitForNavigation({waitUntil:'domcontentloaded'});await page.getByRole('option',{name:label,exact:true}).click();await nextDocument;await sessionPicker().waitFor();}
 await page.goto(base+'/?page=scores');await sessionPicker().waitFor();assert.equal((await sessionPicker().innerText()).trim(),'老板视角');
 assert.deepEqual(await options(),['老板视角','管理员视角','员工视角']);await page.keyboard.press('Escape');
 assert.equal(await page.locator('.sidebar').getByRole('button',{name:'个人最终结果',exact:true}).count(),0);
 await switchSession('管理员视角');assert.equal((await sessionPicker().innerText()).trim(),'管理员视角');
 assert.equal(posts.at(-1).perspective,'admin');assert(await page.locator('.sidebar').getByRole('button',{name:'系统设置',exact:true}).isVisible());
 assert.equal(await page.locator('.sidebar').getByRole('button',{name:'个人最终结果',exact:true}).count(),0,'legacy personal storage must not override the administrator session');
 const previewPicker=()=>page.getByRole('button',{name:/^员工预览，当前：/});assert(await previewPicker().isVisible());assert.equal(await page.getByRole('button',{name:/^切换视角，当前：/}).count(),0,'preview is labelled separately from the session menu');
 await previewPicker().click();const previewDialog=page.getByRole('dialog',{name:'员工预览',exact:true});await previewDialog.waitFor();assert.equal(await previewDialog.getByRole('button',{name:/本人视角/}).count(),0);
 await previewDialog.locator('.perspective-employee').filter({hasText:other.name}).click();await page.locator('.employee-preview-banner').waitFor();
 assert((await page.locator('.employee-preview-banner').innerText()).includes('当前登录：'+dual.name));assert.equal(posts.length,1,'read-only employee preview does not switch the real session');
 await page.getByRole('button',{name:'退出预览',exact:true}).click();await page.locator('.employee-preview-banner').waitFor({state:'detached'});assert(await page.locator('.sidebar').getByRole('button',{name:'系统设置',exact:true}).isVisible());
 await page.setViewportSize({width:390,height:844});await sessionPicker().click();await settlePicker();const mobileBounds=await page.locator('.app-select-panel').boundingBox();assert(mobileBounds.x>=0&&mobileBounds.x+mobileBounds.width<=390&&mobileBounds.y>=0&&mobileBounds.y+mobileBounds.height<=844);assert.deepEqual(await page.getByRole('option').allTextContents(),['老板视角','管理员视角','员工视角']);assert(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth+1));await page.screenshot({path:dir+'/01-three-perspectives-mobile.png',fullPage:true,animations:'disabled'});await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});
 await sessionPicker().click();await settlePicker();await page.screenshot({path:dir+'/02-admin-and-employee-preview.png',fullPage:true,animations:'disabled'});await page.keyboard.press('Escape');
 await switchSession('员工视角');assert.equal((await sessionPicker().innerText()).trim(),'员工视角');assert(await page.locator('.sidebar').getByRole('button',{name:'个人最终结果',exact:true}).isVisible());assert.equal(await page.locator('.sidebar').getByRole('button',{name:'系统设置',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/^员工预览，当前：/}).count(),0);assert((await page.locator('.sidebar-user-name').innerText()).includes(dual.name));
 await switchSession('老板视角');assert.equal((await sessionPicker().innerText()).trim(),'老板视角');assert.equal(await page.locator('.sidebar').getByRole('button',{name:'个人最终结果',exact:true}).count(),0);
 const beforeGuard=posts.length;await page.evaluate(()=>{window.perspectiveTestGuard=event=>event.preventDefault();window.addEventListener('organization-before-leave',window.perspectiveTestGuard);});await sessionPicker().click();await page.getByRole('option',{name:'管理员视角',exact:true}).click();await page.waitForTimeout(100);assert.equal(posts.length,beforeGuard,'an unsaved-change leave guard cancels the session request');assert.equal((await sessionPicker().innerText()).trim(),'老板视角');await page.evaluate(()=>window.removeEventListener('organization-before-leave',window.perspectiveTestGuard));
 const beforeFailure=navigations.length;failure=401;await sessionPicker().click();await page.getByRole('option',{name:'管理员视角',exact:true}).click();await page.getByRole('alert').filter({hasText:'登录已过期，请刷新页面后重试。'}).waitFor();assert.equal(navigations.length,beforeFailure);assert.equal((await sessionPicker().innerText()).trim(),'老板视角');assert(await sessionPicker().isEnabled());
 assert(meReads.filter(item=>item.scenario==='dual').every(item=>item.userId===dual.userId),'all three sessions retain the same logged-in identity');assert(navigations.length>=4,'each successful session switch loads a new document');
 scenario='boss-only';active='boss';await page.goto(base+'/?page=scores');await sessionPicker().waitFor();assert.deepEqual(await options(),['老板视角','员工视角']);await page.keyboard.press('Escape');
 scenario='legacy-boss';await page.goto(base+'/?page=scores');await sessionPicker().waitFor();assert.deepEqual(await options(),['老板视角','员工视角']);await page.keyboard.press('Escape');
 scenario='invalid-options';await page.goto(base+'/?page=scores');await page.locator('.sidebar-user-name').waitFor();assert.equal(await sessionPicker().count(),0,'an explicit invalid option array must not fall back to additional choices');
 scenario='plain-admin';await page.goto(base+'/');const oldPicker=page.getByRole('button',{name:'切换视角，当前：本人视角',exact:true});await oldPicker.waitFor();assert.equal(await sessionPicker().count(),0);assert(await page.locator('.sidebar').getByRole('button',{name:'个人最终结果',exact:true}).isVisible());
 await oldPicker.click();await page.getByRole('dialog',{name:'切换视角',exact:true}).getByRole('button',{name:/管理视角/}).click();assert(await page.locator('.sidebar').getByRole('button',{name:'系统设置',exact:true}).isVisible());assert.equal(await sessionPicker().count(),0,'existing administrators without the session feature retain the original preview picker');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert(posts.every(payload=>Object.keys(payload).length===1&&Object.keys(payload)[0]==='perspective'));
 const result={ok:true,threeOptionsFromApi:true,duplicatesAndUnknownOptionsFiltered:true,bossEmployeeLegacyFallback:true,noOptionsInferredFromInvalidArray:true,sameRealIdentity:true,adminIgnoresOldPersonalStorage:true,distinctReadonlyPreview:true,previewExitPreserved:true,employeeRestrictionsPreserved:true,unsavedLeaveGuardPreserved:true,failedSwitchRetainsView:true,fullDocumentReload:true,legacyAdministratorsUnchanged:true,mobileNoOverflow:true,syntheticSessionPosts:posts.length,realGrantWrites:0,externalRequests:0,artifacts:dir};
 await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));console.log('Artifacts retained:',dir);}
