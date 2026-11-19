import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {renderCoachingComparison} from './lib/report-quality-coaching-comparison.mjs';

// All identities, report contents and scores below are synthetic. Retain every
// fixture and screenshot in ignored outputs; no application server or DB is used.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/report-quality-coaching-comparison-'));
const injection='<script>globalThis.comparisonInjected=true;fetch("https://example.invalid/private")</script><img src="https://example.invalid/image" onerror="globalThis.comparisonInjected=true"> & " \' ';
const ordering=['results','problems','nextPlan','reflection'];
const moduleNames={results:'本周成果',problems:'问题与挑战',nextPlan:'下周计划',reflection:'思考与复盘'};
const earned={results:22.5,problems:18.25,nextPlan:19.75,reflection:15.5};
const maxima={results:30,problems:25,nextPlan:25,reflection:20};
const cases=Array.from({length:4},(_,index)=>({
 id:'synthetic-'+index,category:['阶段推进','内部协同','问题清楚','计划与复盘'][index],employeeName:'虚构员工'+(index+1)+(index===0?injection:''),department:'合成测试团队',weekStart:'2026-11-09',weekEnd:'2026-11-13',sourceHash:'synthetic-source-'+index,
 facts:{results:'合成原文成果 '+index+injection,problems:'合成原文问题 '+index,nextPlan:'合成原文计划 '+index,reflection:'合成原文复盘 '+index},
 old:{scores:[61.234,72.345,83.456,94.567],totalScore:77.777,version:'synthetic-old-v1',promptVersion:'synthetic-old-prompt',model:'synthetic-old-model',generatedAt:'2026-11-14T01:00:00Z',assessment:{modules:ordering.map(id=>({id,candidateScore:99,reason:'旧保存理由 '+moduleNames[id]+(index===0?injection:'')}))}},
}));
const results=cases.map((sample,index)=>({caseId:sample.id,model:'synthetic-coach-model',reviewPromptVersion:'synthetic-review-prompt-v1',generatedAt:'2026-11-19T04:00:00Z',assessment:{
 version:'synthetic-coach-preview-v1',promptVersion:'synthetic-coach-prompt',previewOnly:true,humanConfirmationRequired:true,publicationMode:'preview_only',totalScore:76.001,
 // Deliberately shuffled. Rendering must match IDs rather than array positions.
 modules:['nextPlan','reflection','results','problems'].map(id=>({id,module:moduleNames[id],reason:'新理由 '+moduleNames[id]+(index===0?injection:''),strengths:['已经说明本周状态','能看到下一步安排'],suggestions:['建议一：补充关键节点。','建议二：说明协作安排。','多余第三条不得出现'],earnedPoints:earned[id],maxPoints:maxima[id],candidateScore:90,confidence:.8,evidenceLevel:'C',criteria:[{label:'不应展示的细项',reason:'不应展示的细项理由',evidence:[{quote:'不应展示的证据',level:'A'}]}]})),
 verification:{recommended:true,reason:'不应作为额外建议出现',wording:'如有需要可进一步核实'},summary:'不应额外扩展的总结',anomalies:[],questions:[],factConflict:false,recommendHumanReview:false,
}}));
const options={cases,results,generatedAt:'2026-11-19T04:00:00Z',model:'synthetic-coach-model',ruleVersion:'synthetic-coach-preview-v1',promptVersion:'synthetic-coach-prompt',reviewPromptVersion:'synthetic-review-prompt-v1'};
const before=JSON.stringify(options),html=renderCoachingComparison(options);
assert.equal(JSON.stringify(options),before,'the renderer must not mutate source cases or assessments');
assert(html.startsWith('<!doctype html>'));
assert(html.includes('复核提示词：synthetic-review-prompt-v1'));
assert.equal((html.match(/<dt>复核提示词版本<\/dt>/g)||[]).length,4);
const withoutReview=renderCoachingComparison({...options,reviewPromptVersion:undefined,results:results.map(({reviewPromptVersion,...result})=>result)});
assert(!withoutReview.includes('复核提示词'));
const escapedReview=renderCoachingComparison({...options,reviewPromptVersion:injection});assert(escapedReview.includes('复核提示词：&lt;script&gt;'));assert(!escapedReview.includes('<script>'));
assert(html.includes('&lt;script&gt;globalThis.comparisonInjected'));
assert(!html.includes('<script>'));
assert(html.includes('本评分仅用于评价周报的信息完整度、沟通价值与复盘质量，不代表对员工绩效或工作价值的最终评价。'));
assert(html.includes('本地私人校准 · 不得公开'));
assert(!html.includes('多余第三条不得出现'));
assert(!html.includes('不应展示的细项'));
assert(!html.includes('不应展示的证据'));
assert(!html.includes('不应作为额外建议出现'));
assert(!html.includes('扣分依据'));
assert(!html.includes('缺失证据'));
assert(!/<(?:script|link|img|iframe|form|input|button|audio|video)\b/i.test(html));
assert(!/<[a-z][^>]*\s(?:src|href|action)\s*=/i.test(html));
assert(html.includes("connect-src 'none'"));assert(html.includes("script-src 'none'"));
assert.throws(()=>renderCoachingComparison({...options,results:[results[0],results[0]]}),/invalid_comparison_result_id/);
assert.throws(()=>renderCoachingComparison({...options,cases:[cases[0],cases[0]]}),/invalid_comparison_case_id/);
const partial=renderCoachingComparison({...options,results:results.slice(0,3)});assert(partial.includes('候选分析尚未完成。'));
assert(renderCoachingComparison({cases:[],results:[]}).includes('尚未提供真实案例'));
const file=path.join(dir,'comparison.html');await writeFile(file,html);
await writeFile(path.join(dir,'synthetic-cases.json'),JSON.stringify(options,null,2));
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),requests=[],errors=[];
 await context.route('**/*',route=>{const url=route.request().url();if(/^https?:/i.test(url)){requests.push(url);return route.abort();}return route.continue();});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pathToFileURL(file).href);await page.locator('.case').last().waitFor();
 assert.equal(await page.locator('.case').count(),4);assert.equal(await page.locator('script,link,img,iframe,form,input,button').count(),0);
 assert.equal(await page.evaluate(()=>Boolean(globalThis.comparisonInjected)),false);
 assert.deepEqual(await page.locator('[data-old-total]').allTextContents(),Array(4).fill('77.777 / 100'));
 assert.deepEqual(await page.locator('[data-new-total]').allTextContents(),Array(4).fill('76.001 / 100'),'display the saved candidate total rather than summing module points');
 const first=page.locator('.case').first();
 assert.deepEqual(await first.locator('[data-coaching-module]').evaluateAll(nodes=>nodes.map(node=>node.dataset.coachingModule)),['results','problems','reflection','nextPlan']);
 assert((await first.locator('[data-coaching-module="reflection"] > header').innerText()).includes('15.5 / 20'));
 assert((await first.locator('[data-coaching-module="nextPlan"] > header').innerText()).includes('19.75 / 25'));
 assert((await first.locator('[data-old-module="reflection"] > header').innerText()).includes('94.567'));
 assert((await first.locator('[data-old-module="nextPlan"] > header').innerText()).includes('83.456'));
 for(const module of await page.locator('[data-coaching-module]').all()){
  assert.equal(await module.locator('.coach-section').count(),3);assert.equal(await module.locator('.suggestions li').count(),2);assert(!/证据等级|A级|A 级|B级|B 级|置信度|evidenceLevel/.test(await module.innerText()));
 }
 for(const source of await page.locator('.original-text').all())assert.equal(await source.getAttribute('open'),null,'private original reports are collapsed by default');
 assert.equal(await first.locator('.source-grid').isVisible(),false);
 await first.locator('.original-text > summary').click();assert.equal(await first.locator('.source-grid article').count(),4);assert(await first.locator('.source-grid').isVisible());
 assert((await first.locator('.source-grid').innerText()).includes(injection));
 await first.locator('.original-text > summary').click();
 assert(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(dir,'comparison-desktop.png'),fullPage:true,animations:'disabled'});
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(dir,'comparison-overview-desktop.png'),animations:'disabled'});
 await page.locator('.case').nth(1).screenshot({path:path.join(dir,'comparison-case-desktop.png'),animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth+1));
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(dir,'comparison-mobile.png'),animations:'disabled'});
 await page.locator('.case').nth(1).screenshot({path:path.join(dir,'comparison-case-mobile.png'),animations:'disabled'});
 const body=await page.locator('body').innerText();assert(body.includes('本评分仅用于评价周报的信息完整度、沟通价值与复盘质量，不代表对员工绩效或工作价值的最终评价。'));
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').length),0);
 const result={ok:true,syntheticCases:4,htmlEscaped:true,oldSavedScoresPreserved:true,newSavedTotalPreserved:true,moduleIdsMapped:true,maxTwoSuggestions:true,originalsCollapsed:true,noLevelsInCoachCards:true,exactDisclaimer:true,optionalReviewPromptMetadata:true,noScriptsFormsOrNetworkResources:true,desktopMobileNoOverflow:true,externalRequests:0,artifacts:dir};
 await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();console.log('Artifacts retained:',dir);}
