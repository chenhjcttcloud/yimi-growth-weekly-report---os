import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:http';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Render the real organization/department components with isolated browser
// fixtures. All API calls are intercepted; no real services or data are used.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/department-mirror-ui-'));
const current=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,7);
const previousDate=new Date(current+'-01T00:00:00Z');previousDate.setUTCMonth(previousDate.getUTCMonth()-1);const previous=previousDate.toISOString().slice(0,7);
const source=`import {createRoot} from 'react-dom/client';import {DepartmentsPage} from './src/pages/DepartmentsPage';createRoot(document.getElementById('root')).render(<DepartmentsPage/>);`;
const bundle=await build({stdin:{contents:source,sourcefile:'department-mirror-harness.tsx',resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
const css=(await Promise.all(['src/styles/v2.css','src/styles/performance.css','src/styles/organization.css','src/styles/select.css'].map(file=>readFile(file,'utf8')))).join('\n');
const server=createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:14px system-ui;margin:0;background:#f4f6f2;color:#20332b}#root{height:100dvh;overflow:auto}.v2-page{padding:24px}'+css+'</style><div id="root"></div><script src="/bundle.js"></script></html>');});
server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
const metric={headcount:1,expected:4,submitted:4,onTime:4,late:0,missing:0,submissionRate:100,onTimeRate:100,quality:90,collaboration:87,qualityPublished:1,collaborationPublished:1,qualityReference:90,pendingRatings:0};
let department={id:'live',name:'研发部',parent_id:'',leader_user_id:'leader',leaderName:'测试负责人',leader_mode:'primary',sort_order:0,is_active:1};
const archived={id:'removed',name:'旧产品部',parent_id:'',leader_user_id:'past-leader',leader_mode:'primary',sort_order:1,is_active:0,feishu_id:'od-removed',removedAt:'2026-10-30T01:00:00Z',removalReason:'deleted'};
const employee={userId:'leader',name:'测试负责人',department:'研发部',directDepartmentIds:['live'],departmentIds:['live']};
const score={department_id:'removed',month:current,leader_user_id:'past-leader',score:87.5,comment:'历史交付评价保留',scorer_name:'测试老板',created_at:'2026-10-01T01:00:00Z'};
let revision='fixture-1',syncs=0;const posts=[],unexpected=[],errors=[];
const data=()=>({ok:true,departments:[{...department,members:[employee],metrics:metric,trend:[],leaderScore:null}],archivedDepartments:[archived],employees:[employee],scores:[score],layoutRevision:revision,canScore:true,currentUserId:'boss',scoreTargets:[{departmentId:'live',leaderUserId:'leader',name:'测试负责人',ratingRequired:true,active:true}],memberCount:1,multiDepartmentCount:0});
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base){unexpected.push(req.url());return route.abort();}if(!url.pathname.startsWith('/api/'))return route.continue();
  if(req.method()==='GET'&&['/api/departments','/api/departments/dashboard'].includes(url.pathname))return route.fulfill({status:200,json:data()});
  if(req.method()==='POST'){
   const body=req.postDataJSON();posts.push({path:url.pathname,body});
   if(url.pathname==='/api/departments/layout'){assert.equal(body.departments.length,1);assert.equal(body.departments[0].id,'live');assert(!body.departments.some(row=>row.id==='removed'));department={...department,...body.departments[0]};revision='fixture-2';return route.fulfill({status:200,json:{ok:true}});}
   if(url.pathname==='/api/departments/sync-feishu'){syncs++;return route.fulfill({status:200,json:{ok:true,departmentCount:1,leaders:1,removed:1,unverifiedMissing:1}});}
   if(url.pathname==='/api/departments/score')return route.fulfill({status:409,json:{ok:false,error:'department_removed'}});
  }
  unexpected.push(req.method()+' '+url.pathname);return route.abort();
 });
 await page.goto(base+'/?departmentTab=organization');const tree=page.getByRole('navigation',{name:'组织部门树'});await tree.waitFor();assert.equal(await tree.getByText('旧产品部',{exact:true}).count(),0);assert.equal(await page.getByRole('textbox',{name:'部门名称',exact:true}).inputValue(),'研发部');
 const history=page.locator('details[aria-label="历史部门记录"]');await history.waitFor();assert.equal(await history.getAttribute('open'),null);assert(!(await history.getByText('旧产品部',{exact:true}).isVisible()));await history.locator('summary').click();await history.getByText('旧产品部',{exact:true}).waitFor();assert((await history.innerText()).includes('已有评分记录 1 条'));assert.equal(await history.getByRole('button').count(),0);assert.equal(await history.locator('input,textarea,select').count(),0);await history.locator('summary').click();
 await page.getByRole('textbox',{name:'部门名称',exact:true}).fill('研发新组');await page.getByRole('button',{name:'预览并保存',exact:true}).click();await page.getByRole('button',{name:'确认保存组织架构',exact:true}).click();await page.getByRole('status').filter({hasText:'组织架构已保存'}).waitFor();assert.equal(department.name,'研发新组');assert.equal(await tree.getByText('旧产品部',{exact:true}).count(),0);
 await page.getByRole('button',{name:'同步飞书负责人',exact:true}).click();await page.getByRole('status').filter({hasText:'已从当前组织移除 1 个飞书已删除部门'}).waitFor();await page.getByRole('status').filter({hasText:'1 个部门暂未确认状态，已保留待核查'}).waitFor();
 await page.screenshot({path:dir+'/01-current-organization.png',fullPage:true});
 await page.getByRole('button',{name:'部门概览',exact:true}).click();await page.getByRole('navigation',{name:'部门列表'}).waitFor();assert.equal(await page.getByRole('navigation',{name:'部门列表'}).getByText('旧产品部',{exact:true}).count(),0);const summary=page.locator('.department-summary article').first();assert((await summary.innerText()).includes('1'));await page.getByRole('button',{name:'同步飞书部门与负责人',exact:true}).click();await page.getByRole('status').filter({hasText:'已从当前组织移除 1 个飞书已删除部门'}).waitFor();await page.getByRole('status').filter({hasText:'已保留待核查'}).waitFor();
 await page.getByRole('button',{name:'负责人评分',exact:true}).click();await page.locator('.department-card-grid article.pf-evidence').waitFor();assert.equal(await page.locator('.department-card-grid').getByText('旧产品部',{exact:true}).count(),0);const scoringHistory=page.locator('details[aria-label="已移除部门历史评分"]');await scoringHistory.waitFor();assert.equal(await scoringHistory.getAttribute('open'),null);await scoringHistory.locator('summary').click();await scoringHistory.getByText('旧产品部',{exact:true}).waitFor();assert((await scoringHistory.innerText()).includes('87.5 分'));assert((await scoringHistory.innerText()).includes('历史交付评价保留'));assert.equal(await scoringHistory.getByRole('button').count(),0);assert.equal(await scoringHistory.locator('input,textarea,select').count(),0);
 await page.getByRole('spinbutton',{name:'老板评分',exact:true}).fill('91');await page.getByRole('textbox',{name:'评分说明',exact:true}).fill('当前部门评分测试，仅浏览器mock。');await page.getByRole('button',{name:'提交积分',exact:true}).click();await page.getByRole('status').filter({hasText:'部门已从飞书移除，请刷新组织架构'}).waitFor();
 await page.getByRole('textbox',{name:'部门评分月份',exact:true}).fill(previous);await scoringHistory.waitFor({state:'detached'});await page.getByRole('textbox',{name:'部门评分月份',exact:true}).fill(current);await page.locator('details[aria-label="已移除部门历史评分"]').waitFor();
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:dir+'/02-history-scores-mobile.png',fullPage:true});
 assert.equal(syncs,2);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);assert.equal(posts.filter(p=>p.path==='/api/departments/score').length,1);assert(posts.every(p=>!p.body.departments?.some(d=>d.id==='removed')));
 const result={ok:true,currentTreeExcludesRemoved:true,archiveReadOnlyAndCollapsed:true,otherDepartmentsEditable:true,currentLayoutPayloadExcludesArchive:true,syncRemovalAndUnverifiedMessages:true,currentOverviewCount:true,scoringArchiveReadOnly:true,historyFollowsSelectedMonth:true,removedScoreErrorClear:true,mobileNoHorizontalOverflow:true,browserErrors:errors,mockedWrites:posts.length,realScoringWrites:0,realSyncs:0,externalRequests:0,messagesSent:0,artifacts:dir};await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){if(browser){const pages=browser.contexts().flatMap(context=>context.pages());if(pages.length)await pages.at(-1).screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});}throw error;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));console.log('Artifacts retained:',dir);}
