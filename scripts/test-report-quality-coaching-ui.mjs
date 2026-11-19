import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';

// Synthetic component integration only. Build into a fresh retained directory;
// never load application data, run a scoring job or write a real review.
const repo=process.cwd();
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/report-quality-coaching-ui-'));
const staticDir=path.join(dir,'dist');
const ids=['results','problems','nextPlan','reflection'];
const names={results:'本周成果',problems:'问题与挑战',reflection:'思考与复盘',nextPlan:'下周计划'};
const points={results:22.125,problems:18.25,reflection:15.5,nextPlan:19.75};
const maxima={results:30,problems:25,reflection:20,nextPlan:25};
const quote='【纯合成原文】完成阶段对齐，已确认下一节点。';
const injection='<script>globalThis.coachingInjected=true</script><img src="https://example.invalid/private">';
const coaching={version:'weekly-quality-coaching-2026-11-19-v1',promptVersion:'synthetic-approved-prompt',model:'synthetic-model',generatedAt:'2026-11-19T04:00:00Z',sourceHash:'synthetic-source',totalScore:76.001,
 evidenceLevel:'A',confidence:.99,verification:{recommended:true,wording:'额外核实文字不得变成第四个模块区块'},
 modules:['nextPlan','reflection','results','problems'].map(id=>({id,module:names[id],candidateScore:99,maxScore:100,earnedPoints:points[id],maxPoints:maxima[id],reason:'【合成新理由】'+names[id]+(id==='results'?injection:''),strengths:['【合成亮点】说明了阶段状态。'],suggestions:['【合成建议一】突出最主要的下一节点。','【合成建议一】突出最主要的下一节点。','【合成建议二】说明协作安排。','第三条建议不可出现'],deductions:['旧审计材料不能复制进新卡'],missing:['旧缺项不能复制进新卡'],evidenceLevel:'A',confidence:.99,evidence:[{quote,type:'reported_fact',level:'A'}],criteria:[{id:id+'-criterion',label:'新卡不展示细项',score:99,maxScore:100,reason:'新卡不展示细项理由',missing:[],evidenceLevel:'A',evidence:[{quote,type:'reported_fact',level:'A'}]}]}))};
const legacy={version:'weekly-quality-v2-synthetic',totalScore:12.345,model:'synthetic-old-model',generatedAt:'2026-11-01T04:00:00Z',evidenceLevel:'A',modules:ids.map((id,index)=>({id,module:names[id],candidateScore:70-index*10,maxScore:100,reason:'【合成旧理由】'+names[id],strengths:['【合成旧亮点】已记录当前进度。'],deductions:['【合成旧补充】可以说明下一步。'],missing:['【合成旧待确认】阶段信息。'],confidence:.8,evidenceLevel:'A',evidence:[{quote,type:id==='nextPlan'?'plan':id==='reflection'?'judgment':'reported_fact',level:'A'}],criteria:[{id:id+'-criterion',label:'历史细项 '+names[id],score:7,maxScore:10,reason:'【合成旧细项理由】'+names[id],missing:['【合成旧细项待确认】'],evidenceLevel:'A',evidence:[{quote,type:'judgment',level:'A'}]}]}))};
const report={id:'synthetic-report',start:'2026-11-09',end:'2026-11-13',submitted:true,status:'准时',submittedAt:'2026-11-13T04:00:00Z',candidate:76.001,aiCandidate:76.001,qualityReviewVersion:'synthetic-review-version',qualityAssessment:coaching,evidence:[],anomalies:[],suggestions:'旧全局建议不可重复到新卡',contentVersion:'synthetic-content-v1',contentDeferred:true};
const fixture={coaching,legacy,report};
const relative=file=>'./'+path.relative(dir,path.join(repo,file)).split(path.sep).join('/');
const entry=`import React from 'react';
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {ReportQualityDetails} from ${JSON.stringify(relative('src/components/ReportQualityDetails.tsx'))};
import {ManagedQualityReport} from ${JSON.stringify(relative('src/components/ManagedQualityReport.tsx'))};
import ${JSON.stringify(relative('src/styles.css'))};
import ${JSON.stringify(relative('src/styles/v2.css'))};
import ${JSON.stringify(relative('src/styles/performance.css'))};
const fixture=${JSON.stringify(fixture)};
const before=JSON.stringify(fixture);globalThis.syntheticFixtureUnchanged=()=>JSON.stringify(fixture)===before;
function App(){const [updates,setUpdates]=useState(0);return <div style={{height:'100dvh',overflow:'auto'}}><main className="pf-page" style={{maxWidth:1000,margin:'24px auto',padding:'0 14px'}}>
<section id="coaching"><h2>新版评分说明 · 合成测试</h2><ReportQualityDetails assessment={fixture.coaching} weights={[1,2,3,94]}/></section>
<section id="legacy"><h2>历史评分说明 · 合成测试</h2><ReportQualityDetails assessment={fixture.legacy} weights={[10,20,30,40]} previous refresh={{state:'failed'}}/></section>
<section id="pending"><ReportQualityDetails pending/></section>
<section id="managed-coaching"><ManagedQualityReport report={fixture.report} userId="synthetic-user" month="2026-11" editable onUpdated={()=>setUpdates(value=>value+1)}/></section>
<section id="managed-legacy"><ManagedQualityReport report={{...fixture.report,id:'synthetic-old-report',qualityAssessment:fixture.legacy}} userId="synthetic-user" month="2026-11" editable onUpdated={()=>setUpdates(value=>value+1)}/></section>
<section id="managed-readonly"><ManagedQualityReport report={fixture.report} userId="synthetic-user" month="2026-11" editable={false} onUpdated={()=>setUpdates(value=>value+1)}/></section>
<p id="update-count">{updates}</p></main></div>}
createRoot(document.getElementById('root')).render(<App/>);`;
await writeFile(path.join(dir,'entry.jsx'),entry);
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic coaching UI</title></head><body><div id="root"></div><script type="module" src="./entry.jsx"></script></body></html>');
await build({configFile:false,root:dir,plugins:[react()],logLevel:'error',build:{outDir:staticDir,emptyOutDir:false,target:'esnext'}});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=createServer(async(request,response)=>{
 const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname),file=path.resolve(staticDir,'.'+pathname);
 if(!file.startsWith(staticDir+path.sep)&&file!==staticDir){response.writeHead(403);response.end();return;}
 try{const target=pathname==='/'?path.join(staticDir,'index.html'):file;response.writeHead(200,{'content-type':types[path.extname(target)]||'application/octet-stream'});response.end(await readFile(target));}catch{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const requests=[],external=[],errors=[];let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage();
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==base){external.push(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  requests.push({path:url.pathname,method:route.request().method(),body:route.request().method()==='POST'?route.request().postDataJSON():null});
  assert(['/api/performance/quality-review','/api/performance/report'].includes(url.pathname));
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.endsWith('/report')?{detail:{synthetic:'只有主动展开时读取原文'}}:{ok:true})});
 });
 page.on('pageerror',error=>errors.push(error.message));await page.goto(base);await page.locator('#coaching [data-quality-module]').last().waitFor();
 const active=page.locator('#coaching .quality-assessment');
 assert.equal(await active.getAttribute('data-quality-version'),'coaching');
 assert.deepEqual(await active.locator('[data-quality-module]').evaluateAll(nodes=>nodes.map(node=>node.dataset.qualityModule)),['results','problems','reflection','nextPlan']);
 assert(await active.getByText('AI 候选分 76.001 分',{exact:true}).isVisible(),'saved totals are displayed without deriving them from module or legacy weights');
 assert(await active.getByText('如需进一步确认',{exact:true}).isVisible());assert(await active.getByText('如有需要可进一步核实。',{exact:true}).isVisible());
 assert.equal(await active.getByText('额外核实文字不得变成第四个模块区块',{exact:true}).count(),0,'verification does not add model-supplied suggestions to the module feedback');
 for(const id of ids){
  const card=active.locator(`[data-quality-module="${id}"]`);
  assert.equal(await card.locator('.quality-module-score b').textContent(),String(points[id]));
  assert.equal(await card.locator('.quality-module-score small').textContent(),'/ '+maxima[id]+' 分');
  assert.equal(await card.locator('[data-quality-section]').count(),3);assert.equal(await card.locator('[data-quality-section="suggestions"] li').count(),2);
  assert.equal(await card.locator('details,.quality-criteria,.quality-evidence-quotes').count(),0);
 }
 const activeText=await active.innerText();
 assert(!/证据等级|A级|A 级|置信度|新卡不展示|第三条建议|旧审计材料|旧缺项|扣分依据|缺失证据/.test(activeText));
 assert.equal(await page.evaluate(()=>Boolean(globalThis.coachingInjected)),false);assert.equal(await page.locator('#coaching script,#coaching img').count(),0);
 const disclaimer='本评分仅用于评价周报的信息完整度、沟通价值与复盘质量，不代表对员工绩效或工作价值的最终评价。';
 assert(await active.getByText(disclaimer,{exact:true}).isVisible());assert.equal(await page.locator('.quality-disclaimer').count(),6);
 const historical=page.locator('#legacy .quality-assessment');
 assert(await historical.getByText('AI 候选分 12.3 分',{exact:true}).isVisible());assert(await historical.getByText('旧版分数 · 重评失败',{exact:true}).isVisible());
 for(const [index,id] of ids.entries()){
  const module=historical.locator(`[data-quality-module="${id}"]`),details=module.locator('.quality-legacy-details');
  assert.equal(await module.locator('.quality-module-score b').textContent(),String(70-index*10));assert.equal(await details.getAttribute('open'),null);
  assert.equal(await module.locator('.quality-module-contribution b').textContent(),String([7,12,15,16][index]),'legacy weights retain their original ID mapping');
  if(index>0)await module.locator(':scope>summary').click();
  await details.locator(':scope>summary').click();
  assert(await details.getByText('【合成旧细项理由】'+names[id],{exact:false}).isVisible());assert(await details.getByText(quote,{exact:true}).first().isVisible());
  assert(!/证据等级|A 级|A级|扣分依据|缺失证据/.test(await module.innerText()),'historical plan/reflection citations and fine-grained records never expose an evidence grade');
  await details.locator(':scope>summary').click();
 }
 assert(await page.locator('#pending').getByText('AI 分析完成后，将自动展示各模块得分、评分理由和可以补充的内容。当前未生成有效评分，不按 0 分处理。',{exact:true}).isVisible());
 const managed=page.locator('#managed-coaching');
 assert.equal(await managed.getByText('旧全局建议不可重复到新卡',{exact:true}).count(),0);
 assert.equal(requests.length,0,'mounting scoring details never loads source records or submits a review');
 await managed.getByText('复核这份周报',{exact:true}).click();
 const actions=managed.getByLabel('复核操作');
 assert.deepEqual(await actions.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value)),['','adjust_score','exclude_report','reanalyze']);
 await actions.selectOption('adjust_score');await managed.getByLabel('调整后的周报候选分').fill('77.5');await managed.getByLabel('复核原因').fill('纯合成管理复核说明');await managed.getByRole('button',{name:'保存复核'}).click();
 await page.locator('#update-count').getByText('1',{exact:true}).waitFor();
 assert.deepEqual(requests,[{path:'/api/performance/quality-review',method:'POST',body:{reportId:'synthetic-report',userId:'synthetic-user',month:'2026-11',version:'synthetic-review-version',action:'adjust_score',reason:'纯合成管理复核说明',score:77.5}}]);
 const oldManaged=page.locator('#managed-legacy');await oldManaged.getByText('复核这份周报',{exact:true}).click();
 assert.deepEqual(await oldManaged.getByLabel('复核操作').locator('option').evaluateAll(nodes=>nodes.map(node=>node.value)),['','adjust_score','validate_evidence','mark_not_applicable','exclude_report','reanalyze']);
 assert(await oldManaged.getByRole('option',{name:'记录管理核实',exact:true}).count());
 assert.equal(await page.locator('#managed-readonly').getByText('复核这份周报',{exact:true}).count(),0,'read-only recipients keep the existing review permissions');
 await managed.getByText('查看完整原始记录',{exact:true}).click();await managed.getByText('只有主动展开时读取原文',{exact:false}).waitFor();
 assert.equal(requests.filter(value=>value.path==='/api/performance/report').length,1);await managed.getByText('查看完整原始记录',{exact:true}).click();
 assert(await page.evaluate(()=>globalThis.syntheticFixtureUnchanged()),'rendering and synthetic management interactions never mutate saved assessments');
 await active.evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(dir,'coaching-desktop.png'),animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await active.evaluate(node=>node.scrollWidth<=node.clientWidth));
 await active.evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(dir,'coaching-mobile.png'),animations:'disabled'});
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,syntheticOnly:true,coachingSavedContributions:true,moduleIdOrder:true,maxTwoSuggestions:true,exactDisclaimer:true,legacyScoresAndWeightsPreserved:true,legacyDetailsCollapsed:true,noEvidenceGrades:true,managementReviewPermissions:true,sourceLazyLoading:true,inputNotMutated:true,desktopMobile:true,artifacts:dir}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));console.log('Synthetic UI artifacts retained:',dir);}
