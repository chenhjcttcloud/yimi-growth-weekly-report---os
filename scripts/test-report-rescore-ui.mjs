import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// The real settings component is compiled into an isolated harness. All API
// responses are synthetic; no application data, provider call or cleanup runs.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/report-rescore-ui-')),dist=path.join(dir,'dist');
await mkdir(dist);
const source=path.resolve('src');
await writeFile(path.join(dir,'entry.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import{ReportAutomationSettings}from ${JSON.stringify(source+'/components/ReportAutomationSettings.tsx')};import ${JSON.stringify(source+'/styles.css')};import ${JSON.stringify(source+'/styles/v2.css')};import ${JSON.stringify(source+'/styles/performance.css')};createRoot(document.getElementById('root')).render(<ReportAutomationSettings/>);`);
await build({entryPoints:[path.join(dir,'entry.tsx')],bundle:true,outfile:path.join(dist,'app.js'),format:'esm',platform:'browser',jsx:'automatic',target:'es2022',logLevel:'silent'});
await writeFile(path.join(dist,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;padding:16px}#root{max-width:1100px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
const server=createServer(async(request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname,name=path.join(dist,pathname==='/'?'index.html':pathname);
 if(!path.resolve(name).startsWith(dist+path.sep)){response.writeHead(403);response.end();return;}
 try{const bytes=await readFile(name);response.writeHead(200,{'content-type':name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'});response.end(bytes);}catch{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
let state=null,running=false,busyOnNextPost=false,failOnNextPost=false,browser;
let scoringStartMonth;
let nextCollection={nextCheckAt:'2026-11-06T12:05:00Z',nextCheckKind:'deadline'};
const posts=[],errors=[],unexpected=[];
const snapshot=(values={})=>({mode:'rescore',targetMonth:'2026-10',rowCount:4,analyzed:0,failed:0,cached:1,remaining:3,active:0,phase:'queued',running:true,...values});
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.addInitScript(()=>{const RealDate=Date;const stamp=Date.parse('2026-11-02T08:00:00Z');globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return stamp;}};});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==base){unexpected.push(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(url.pathname==='/api/system-settings/report-automation'&&route.request().method()==='GET')return route.fulfill({status:200,json:{config:{enabled:true,scoringStartMonth},lastAttemptAt:null,...nextCollection,running}});
  if(url.pathname==='/api/lark-report-sync'){
   if(route.request().method()==='GET')return route.fulfill({status:200,json:{ok:true,status:state,processRunning:running}});
   const payload=route.request().postDataJSON();posts.push(payload);assert.deepEqual(Object.keys(payload).sort(),['mode','targetMonth']);assert.equal(payload.mode,'rescore');
   if(busyOnNextPost){busyOnNextPost=false;state={mode:'rescore',targetMonth:'2026-09',running:true,phase:'analysis'};running=true;return route.fulfill({status:409,json:{ok:false,alreadyRunning:true,status:state}});}
   if(failOnNextPost){failOnNextPost=false;return route.fulfill({status:503,json:{ok:false,error:'fixture_could_not_start'}});}
   state=snapshot({targetMonth:payload.targetMonth});running=true;return route.fulfill({status:202,json:{ok:true,status:state}});
  }
  unexpected.push(url.pathname);return route.fulfill({status:500,json:{error:'unexpected_fixture_request'}});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base);
 const automation=page.getByRole('article',{name:'周报自动收集与AI评分'});
 await automation.getByText(/2026\/11\/6 20:05:00（截止后收集）/).waitFor();
 assert(await automation.getByText(/下一个工作日 09:00 补拉迟交和更新的周报/).isVisible());
 assert.equal(await automation.getByLabel('周报自动收集间隔').count(),0);
 nextCollection={nextCheckAt:'2026-11-09T01:00:00Z',nextCheckKind:'followup'};
 await automation.getByRole('button',{name:'刷新收集状态'}).click();
 await automation.getByText(/2026\/11\/9 09:00:00（工作日补拉）/).waitFor();
 const panel=page.getByRole('region',{name:'按月补跑周报评分'});
 const monthInput=panel.getByLabel('补跑评分月份'),start=panel.getByRole('button',{name:'补跑本月未完成评分',exact:true}),refresh=panel.getByRole('button',{name:'刷新评分进度',exact:true});
 await start.waitFor();await page.waitForFunction(()=>!document.querySelector('.report-rescore button[type="submit"]').disabled);
 assert.equal(await monthInput.inputValue(),'2026-10','default month is the previous completed month in Beijing');
 assert.equal(posts.length,0,'opening settings never starts scoring or changes automation settings');
 assert(await panel.getByText('尚无2026年10月的补跑记录。选择月份后点击补跑，已成功的记录不会重复评分。',{exact:true}).isVisible());
 await start.click();await panel.getByText('正在补跑评分',{exact:true}).waitFor();assert.equal(posts.length,1);assert.deepEqual(posts[0],{mode:'rescore',targetMonth:'2026-10'});assert(await start.isDisabled());
 assert(await panel.getByText('重评时，旧评分依据可供回看。月度候选分只汇总已完成分析的有效周报，最终分由管理人员确认。',{exact:true}).isVisible());
 state=snapshot({phase:'analysis',analyzed:1,failed:1,remaining:1,active:1,diagnostics:[{reportId:'fixture-report',weekEnd:'2026-10-16',moduleId:'results',criterionId:'evidence',code:'quote_not_found',path:'modules.results.criteria.evidence.evidence',attempt:2,providerResponse:'PRIVATE_PROVIDER_RESPONSE_MUST_NOT_RENDER'}]});
 await refresh.click();await panel.getByText('原文证据未通过校验 · 第2次尝试',{exact:true}).waitFor();
 assert((await panel.innerText()).includes('quote_not_found · modules.results.criteria.evidence.evidence'));
 assert(!(await panel.innerText()).includes('PRIVATE_PROVIDER_RESPONSE'));
 assert.equal(await panel.locator('.report-rescore-progress dd').nth(1).innerText(),'1');assert.equal(await panel.locator('.report-rescore-progress dd').nth(3).innerText(),'1');
 state={...state,running:false,phase:'partial',active:0};running=false;
 await refresh.click();await panel.getByText('本次补跑有失败项',{exact:true}).waitFor();assert(await start.isEnabled());
 state=snapshot({phase:'analysis',active:1,diagnostics:[{weekEnd:'2026-10-16',code:'upstream_rate_limit',path:'$',attempt:1,retryAfterMs:120000,providerResponse:'PRIVATE_RATE_LIMIT_RESPONSE'}]});running=true;
 await refresh.click();await panel.getByText('AI 服务请求限流，后续请求会排队，重试等待至少 120 秒 · 第1次尝试',{exact:true}).waitFor();assert(await start.isDisabled());
 assert(!(await panel.innerText()).includes('PRIVATE_RATE_LIMIT_RESPONSE'));
 state=snapshot({running:false,phase:'paused',blockedReason:'upstream_quota_exhausted',remaining:2,failed:1,diagnostics:[{weekEnd:'2026-10-16',code:'upstream_quota_exhausted',path:'$',attempt:1}]});running=false;
 await refresh.click();await panel.getByText('补跑已暂停，未完成项可继续处理',{exact:true}).waitFor();assert(await start.isEnabled());
 assert((await panel.innerText()).includes('尚未请求的周报仍保留在待处理队列'));
 assert(!(await panel.innerText()).includes('本次补跑已完成'));
 assert.equal(await panel.locator('.report-rescore-progress dd').nth(5).innerText(),'2');
 state=snapshot({running:false,phase:'paused',blockedReason:'upstream_retry_after_too_long',remaining:2,diagnostics:[{weekEnd:'2026-10-16',code:'upstream_rate_limit',path:'$',attempt:1,retryAfterMs:86400000,retryAfterExceeded:true}]});
 await refresh.click();await panel.getByText('AI 服务要求长时间等待，本次补跑已暂停，未处理项保留待续跑 · 第1次尝试',{exact:true}).waitFor();
 state=snapshot({running:false,phase:'partial',analyzed:1,failed:1,remaining:1,active:0});await refresh.click();await panel.getByText('本次补跑有失败项',{exact:true}).waitFor();
 await panel.scrollIntoViewIfNeeded();await page.screenshot({path:dir+'/rescore-progress-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:dir+'/rescore-progress-mobile.png',fullPage:true});
 busyOnNextPost=true;await start.click();await panel.getByText('已有周报任务运行中，本次未重复创建任务；完成后可补跑所选月份。',{exact:true}).waitFor();assert.equal(posts.length,2);assert(await start.isDisabled());
 state=snapshot({running:false,phase:'partial',failed:1,remaining:1});running=false;await refresh.click();await start.isEnabled();
 await monthInput.fill('2026-09');assert.equal(posts.length,2,'changing month is read-only until explicit click');
 failOnNextPost=true;await start.click();await panel.getByRole('alert').getByText('评分补跑未启动，请刷新状态后重试。',{exact:true}).waitFor();assert.deepEqual(posts[2],{mode:'rescore',targetMonth:'2026-09'});assert.equal(await monthInput.inputValue(),'2026-09');
 state=snapshot({running:false,phase:'done',analyzed:3,cached:1,failed:0,remaining:0});running=false;
 await monthInput.fill('2026-10');await refresh.click();await panel.getByText('本次补跑已完成',{exact:true}).waitFor();assert.equal(posts.length,3);
 state=snapshot({running:true,phase:'analysis',analyzed:2,cached:1,remaining:1,active:1});running=false;
 await refresh.click();await panel.getByText('上次任务已中断，可继续补跑',{exact:true}).waitFor();assert(await start.isEnabled(),'a stale persisted running status must not lock retries after restart');assert.equal(await panel.locator('.report-rescore-progress dd').nth(4).innerText(),'0');assert.equal(posts.length,3);
 state=snapshot({running:false,phase:'interrupted',analyzed:2,cached:1,remaining:1,active:0,diagnostics:[{weekEnd:'2026-10-16',code:'upstream_rate_limit',path:'$',attempt:4}]});
 await refresh.click();await panel.getByText('上次任务已中断，可继续补跑',{exact:true}).waitFor();assert(await start.isEnabled(),'an explicitly interrupted status also offers continuation after startup recovery');assert((await panel.innerText()).includes('当前阶段：待续跑'));assert.equal(posts.length,3);
 scoringStartMonth='2026-11';
 await page.reload();
 await panel.locator('input[min="2026-11"]').waitFor();
 assert.equal(await page.getByLabel('AI 评分起始月').inputValue(),'2026-11');
 assert.equal(await monthInput.inputValue(),'2026-11','default month respects the saved scoring cutoff');
 await monthInput.fill('2026-10');
 assert(await start.isDisabled(),'the manual rescore UI excludes older months');
 assert.equal(posts.length,3);
 assert.equal(await page.getByRole('button',{name:/确认质量分|审核通过/}).count(),0);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 const result={ok:true,previousMonthDefault:true,explicitMonthScopedPosts:true,openingAndRefreshReadOnly:true,cachedAndFailedProgressVisible:true,safeDiagnosticsVisible:true,rateLimitWaitVisible:true,quotaPauseKeepsRemaining:true,excessiveRetryDelayPauses:true,oldScorePreservationExplained:true,busy409NoDuplicateStart:true,failedStartKeepsMonth:true,completedProgressVisible:true,interruptedTaskRetryAvailable:true,noHumanApproval:true,mobileNoOverflow:true,providerRequests:0,businessDataWrites:0,artifacts:dir};
 await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));console.log('Test artifacts retained:',dir);}
