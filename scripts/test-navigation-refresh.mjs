import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {readFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve(process.env.NAVIGATION_BUILD_DIR||'outputs/navigation-preview-20261026');
const upstream='http://127.0.0.1:5180';
const directory=path.resolve('outputs/navigation-tests-'+Date.now());await mkdir(directory,{recursive:true,mode:0o700});
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(/^\/(api|auth|share)(\/|$)/.test(url.pathname)){
  const next=request(upstream+req.url,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});next.on('error',()=>{res.writeHead(502);res.end('Local backend unavailable');});req.pipe(next);return;
 }
 try{let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep)&&file!==root)throw Error('invalid_path');if(!(await stat(file).catch(()=>null))?.isFile())file=path.join(root,'index.html');const body=await readFile(file);res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const context=await chromium.launchPersistentContext(directory+'/browser-profile',{channel:'chrome',headless:true,viewport:{width:1440,height:1000}});
let role='boss';const errors=[],protectedRequests=[];
try{
 const original=await(await fetch(upstream+'/api/me')).json();const target=(await(await fetch(upstream+'/api/departments')).json()).departments.find(d=>d.name==='产品研发');assert(target);
 const admin=original.access.visibleEmployees[0];assert(admin);
 await context.route('**/api/dev/views',route=>route.fulfill({status:404,json:{ok:false}}));
 await context.route('**/api/me',async route=>{
  const value=structuredClone(original);
  if(role==='admin'){value.user={...value.user,userId:admin.userId,name:admin.name,bossView:false};value.access={...value.access,role:'system_admin',currentEmployee:admin,bossView:true,canViewBossDashboard:true,canViewSettings:true,canManageScoring360:true,canManagePersonnel:true};}
  if(role==='member'){value.user={userId:admin.userId,name:admin.name,role:'member',bossView:false};value.access={...value.access,role:'member',currentEmployee:admin,bossView:false,canViewBossDashboard:false,canViewSettings:false,canManageScoring360:false,canManagePersonnel:false,visibleEmployees:[admin]};}
  await route.fulfill({json:value});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/api\/(settings\/status|departments(?:\/|\?|$)|performance\/manage)/.test(r.url()))protectedRequests.push(r.url());});
 async function title(value){await page.waitForFunction(value=>document.querySelector('.app-header h1')?.textContent===value,value);}
 async function urlValue(key,value){await page.waitForFunction(({key,value})=>new URL(location.href).searchParams.get(key)===value,{key,value});}
 await page.goto(base);await title('老板驾驶舱');
 await page.getByRole('button',{name:'系统设置',exact:true}).click();await page.getByText('组织与部门',{exact:true}).click();await page.locator('.org-tree-select').filter({hasText:target.name}).first().click();
 await urlValue('page','settings');await urlValue('settingsTab','organization');await urlValue('departmentId',target.id);
 await page.reload();await title('系统设置');assert.equal(await page.locator('.settings-module-nav button[aria-current="page"] strong').textContent(),'组织与部门');await page.locator('.org-detail-title h3').filter({hasText:target.name}).waitFor();
 await page.screenshot({path:directory+'/settings-after-refresh.png'});
 await page.getByRole('button',{name:'部门管理',exact:true}).click();await page.getByRole('button',{name:'组织与负责人',exact:true}).click();await urlValue('departmentTab','organization');await page.reload();await title('部门管理');assert(await page.getByRole('button',{name:'组织与负责人',exact:true}).getAttribute('aria-pressed')==='true');
 await page.getByRole('button',{name:'负责人评分',exact:true}).click();await urlValue('departmentTab','scores');await page.reload();await title('部门管理');assert(await page.getByRole('button',{name:'负责人评分',exact:true}).getAttribute('aria-pressed')==='true');
 role='admin';await page.goto(base+'?page=settings&settingsTab=people');await title('系统设置');await page.getByRole('heading',{name:'飞书 SSO 员工花名册',exact:true}).waitFor();await page.reload();await title('系统设置');await urlValue('settingsTab','people');assert.equal(await page.locator('.settings-module-nav button[aria-current="page"] strong').textContent(),'员工管理');
 await page.evaluate(id=>localStorage.setItem('admin-perspective:'+id,'personal'),admin.userId);await page.goto(base+'?page=reports');await title('周报与互动');await page.reload();await title('周报与互动');
 await page.evaluate(id=>localStorage.setItem('admin-perspective:'+id,'employee:'+id),admin.userId);await page.goto(base+'?page=coach');await title('AI 教练');await page.reload();await title('AI 教练');
 await page.goto(base+'?page=settings');await title('个人最终结果');await urlValue('page','growth');
 role='member';protectedRequests.length=0;await page.goto(base+'?page=departments&departmentTab=organization');await title('个人最终结果');await urlValue('page','growth');assert.deepEqual(protectedRequests,[],'an inaccessible restored route must not mount management pages');
 await page.goto(base+'/scores?tab=my360');await title('评分工作台');await urlValue('page','scores');await page.reload();await title('评分工作台');
 role='boss';await page.goto(base+'?page=invalid-page');await title('老板驾驶舱');await urlValue('page','dashboard');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,settingsAndSection:true,selectedDepartment:true,departmentTabs:true,adminManagement:true,adminPersonalAndPreview:true,permissionFallback:true,legacyScoresLink:true,invalidRouteFallback:true,consoleErrors:0,artifacts:directory}));
}catch(error){const page=context.pages().at(-1);if(page)await page.screenshot({path:directory+'/failure.png'}).catch(()=>{});throw error;}
finally{await context.close();await new Promise(resolve=>server.close(resolve));console.log('Test artifacts retained:',directory);}
