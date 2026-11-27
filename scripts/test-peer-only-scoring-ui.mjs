import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

// The caller supplies a unique verified build; this test never rebuilds assets.
assert(process.env.TEST_STATIC_DIR,'TEST_STATIC_DIR must point at the dedicated peer-only verified build');
const staticDir=path.resolve(process.env.TEST_STATIC_DIR);await access(path.join(staticDir,'index.html'));
await mkdir('outputs/tests',{recursive:true});
const artifacts=await mkdtemp(path.resolve('outputs/tests/peer-only-scoring-ui-'));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(request,response)=>{
 const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname),file=path.resolve(staticDir,'.'+pathname);
 if(!file.startsWith(staticDir+path.sep)&&file!==staticDir){response.writeHead(403);response.end();return;}
 try{const target=pathname==='/'?path.join(staticDir,'index.html'):file;response.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream'});response.end(await readFile(target));}catch{response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const november='2026-11',october='2026-10';
const policy=month=>({rule:month>=november?'peers_100':'weighted_30_70',weights:month>=november?{manager:0,peers:100}:{manager:30,peers:70},effectiveMonth:november});
const people=[{userId:'target',name:'合成零分员工',department:'同一测试部门',active:true},{userId:'pending',name:'合成待互评员工',department:'同一测试部门',active:true},{userId:'none',name:'合成无配评员工',department:'同一测试部门',active:true},{userId:'old',name:'合成十一月旧加权员工',department:'同一测试部门',active:true}];
const emptyStats={expected:0,submitted:0,onTime:0,late:0,missing:0,pendingTimestamp:0,pendingCalendar:0,rate:null};
const manager={kind:'manager',expectedIds:['head'],expected:1,submitted:1,complete:true,score:80};
const noManager={kind:'not_required',expectedIds:[],expected:0,submitted:0,complete:true,score:null,disabled:true};
function monthly(month,id){
 const legacy=month===october||id==='old',person=people.find(row=>row.userId===id),complete=['target','old'].includes(id),expected=id==='none'?0:2,submitted=complete?2:id==='pending'?1:0;
 return {...person,month,reports:[],timeliness:emptyStats,quality:{status:'no_reports',currentAverage:null,candidateScore:null,finalScore:null,pendingAnalysis:0,analyzedCount:0,expectedCount:0,canConfirm:false},collaborationPolicy:policy(month),peerCandidate:id==='target'?month===november?0:95:id==='old'?90:id==='pending'?80:null,managerProgress:month===october?manager:noManager,collaborationExpected:expected,collaborationSubmitted:submitted,peerComplete:expected>0&&expected===submitted,collaborationComplete:complete,collaborationCandidate:complete?id==='target'?month===november?0:90.5:87:null};
}
function result(month,id){const row=monthly(month,id);if(!row.collaborationComplete)return null;const legacy=month===october||id==='old';return {month,employee_user_id:id,employee_name:row.name,kind:'collaboration',scoring_rule:legacy?'weighted_30_70':'peers_100',confirmed_by:'系统自动发布',confirmed_at:month+'-30T02:00:00Z',result:{score:row.collaborationCandidate,peerScore:row.peerCandidate,managerScore:legacy?80:null,weights:legacy?{manager:30,peers:70}:{manager:0,peers:100},publicationMode:legacy?'weighted_30_70':'peers_only'}};}
function assignments(month,id){const row=monthly(month,id);return Array.from({length:row.collaborationExpected},(_,index)=>({id:month+'-'+id+'-'+index,evaluee_user_id:id,evaluator_user_id:'peer-'+index,evaluator_name:'合成同部门评分人'+index,score:index<row.collaborationSubmitted?String(row.peerCandidate):'',comment:'合成只读协作评价',submitted_at:index<row.collaborationSubmitted?month+'-30T01:00:00Z':''}));}
const cycle=(month,id)=>({id:month+'-cycle',month,label:'合成本月互评',start_date:month+'-01',end_date:month+'-30',status:'open',expected:40,submitted:37,pending:['其他被评人的待评人'],...(id?{assignments:assignments(month,id)}:{detailsDeferred:true})});
const overview=month=>({scopeMonth:month,collaborationPolicy:policy(month),months:[november,october],employees:people,monthly:people.map(person=>monthly(month,person.userId)),collaborations:[cycle(month)],results:people.map(person=>result(month,person.userId)).filter(Boolean)});
function workspace(month){return {employee:people[0],months:[november,october],month,selectedWeekId:'',weeks:[],monthSummary:{...emptyStats,upcoming:0},history:[november,october].map(value=>({month:value,quality:null,monthlyQuality:{status:'no_reports',currentAverage:null,candidateScore:null,finalScore:null,pendingAnalysis:0,analyzedCount:0,expectedCount:0},collaboration:result(value,'target').result.score,collaborationRule:result(value,'target').scoring_rule,collaborationPolicy:policy(value),timeliness:null})),ratingProgress:{peerComplete:true,managerKind:'none',managerExpected:0,managerSubmitted:0,managerComplete:true},tasks:[],comments:[],messages:[],likeCount:0,liked:false,aiConfigured:false,taskCreateEnabled:false};}
const requests=[],unexpected=[],outbound=[],businessWrites=[],errors=[];let role='boss',browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.addInitScript(()=>{const RealDate=Date,at=RealDate.parse('2026-11-30T10:00:00+08:00');globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base){outbound.push(url.origin);return route.abort();}if(!url.pathname.startsWith('/api/'))return route.continue();
  requests.push({path:url.pathname,method:request.method(),params:Object.fromEntries(url.searchParams)});
  if(request.method()!=='GET'&&!url.pathname.startsWith('/api/usage/')){businessWrites.push(url.pathname);return route.fulfill({status:405,json:{error:'synthetic_read_only'}});}
  const month=url.searchParams.get('month')==='latest'?november:url.searchParams.get('month')||november;let body;
  switch(url.pathname){
   case '/api/me':body={user:role==='boss'?{userId:'boss',name:'合成老板'}:people[0],access:{role:role==='boss'?'boss':'member',currentEmployee:role==='boss'?{userId:'boss',name:'合成老板'}:people[0],visibleEmployees:people,canManageScoring360:role==='boss',canManagePersonnel:role==='boss',canViewSettings:role==='boss',canViewBossDashboard:role==='boss'}};break;
   case '/api/management-data':body={prototypeData:{meta:{periods:[]}}};break;
   case '/api/performance/manage':body=overview(month);break;
   case '/api/performance/employee-month':{const id=url.searchParams.get('employeeId');assert(people.some(person=>person.userId===id));body={monthly:monthly(month,id),results:[result(month,id)].filter(Boolean),collaborations:[cycle(month,id)]};break;}
   case '/api/personal/workspace':body=workspace(month);break;
   case '/api/departments':body={ok:true,month,collaborationPolicy:policy(month),canScore:month===october,currentUserId:'boss',departments:[{id:'team',name:'同一测试部门',leader_user_id:'target'}],employees:people,scores:[],personScores:month===october?[{leader_user_id:'target',month,score:80,comment:'合成十月历史老板评价',scorer_name:'合成老板',created_at:month+'-30T02:00:00Z'}]:[],leaderScoreTargets:month===october?[{leaderUserId:'target',departmentIds:['team'],name:people[0].name,ratingRequired:true}]:[]};break;
   case '/api/manager-reviews':body={ok:true,month,collaborationPolicy:policy(month),canReview:false,hasResponsibilities:false,tasks:[]};break;
   case '/api/notifications':body={items:[],unreadCount:0};break;
   case '/api/dev/views':body={ok:false};break;
   case '/api/usage/visit':case '/api/usage/heartbeat':body={ok:true};break;
   default:unexpected.push(url.pathname);return route.fulfill({status:404,json:{error:'unexpected_synthetic_route'}});
  }
  return route.fulfill({status:200,json:body});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 const visit=(month,id='target',tab='review')=>page.goto(base+'/?'+new URLSearchParams({page:'collaboration-scores',scoreMonth:month,scoreEmployeeId:id,scoreTarget:'1',scoreDetailTab:tab}));
 const main=page.locator('.pf-review-main');
 await visit(november);await main.getByText('月度综合评分 · 0.0 分',{exact:true}).waitFor();
 await main.getByText('该员工同事互评（100%）进度',{exact:true}).waitFor();assert(!/评分（30%）|均分（70%）/.test(await main.innerText()));
 assert.equal(await page.locator('.manager-reviews-panel').count(),0);assert.equal(await page.getByRole('spinbutton').count(),0);
 await page.getByRole('tab',{name:'协作明细',exact:true}).click();
 await main.getByText('该员工待评：全部完成',{exact:true}).waitFor();assert.match(await main.innerText(),/该员工\s*2\s*\/\s*2\s*已完成/);assert.match(await main.innerText(),/全轮\s*37\s*\/\s*40\s*已完成/);
 assert.equal(await main.getByText('其他被评人的待评人',{exact:true}).count(),0);assert.equal(await main.getByText('同事互评已完成 · 0.0 分',{exact:true}).count(),2);
 await page.locator('.content-shell').evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:path.join(artifacts,'01-november-peer-only-desktop.png'),fullPage:true});
 await page.locator('.pf-person').filter({hasText:people[1].name}).click();await page.getByRole('tab',{name:'协作明细',exact:true}).click();await main.getByText('该员工待评：合成同部门评分人1',{exact:true}).waitFor();
 assert.match(await main.innerText(),/该员工\s*1\s*\/\s*2\s*已完成/);assert.equal(await main.getByText('同事互评待评分',{exact:true}).count(),1);
 await page.locator('.pf-person').filter({hasText:people[2].name}).click();await page.getByRole('tab',{name:'协作明细',exact:true}).click();await main.getByText('该员工待评：尚未配置同事评分人',{exact:true}).waitFor();assert.equal(await main.getByText('该员工待评：全部完成',{exact:true}).count(),0);
 await page.locator('.pf-person').filter({hasText:people[3].name}).click();await page.getByRole('tab',{name:'结果概览',exact:true}).click();await main.getByText('同事互评均分（70%）',{exact:true}).waitFor();assert.match(await main.innerText(),/历史30%评分\s*·\s*80\.0\s*分/);await main.getByText('月度综合评分 · 87.0 分',{exact:true}).waitFor();
 assert.match(await main.innerText(),/80\.0\s*分/,'saved November weighted result displays its original manager component');
 assert(!/请先同步|0\s*\/\s*0/.test(await main.innerText()),'new-month not_required progress cannot overwrite a saved thirty-percent component');
 await page.getByRole('tab',{name:'协作明细',exact:true}).click();await main.getByText('该员工待评：全部完成',{exact:true}).waitFor();
 assert.match(await main.innerText(),/80\.0\s*分/,'details also use the saved manager component');assert(!/请先同步|0\s*\/\s*0/.test(await main.innerText()));
 await main.screenshot({path:path.join(artifacts,'03-november-saved-weighted-history.png'),animations:'disabled'});
 await visit(october);await main.getByText('月度综合评分 · 90.5 分',{exact:true}).waitFor();await main.getByText('该员工同事互评（70%）进度',{exact:true}).waitFor();
 await visit(november);await main.getByText('月度综合评分 · 0.0 分',{exact:true}).waitFor();await page.setViewportSize({width:390,height:844});await page.locator('.content-shell').evaluate(element=>{element.scrollTop=0;});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(artifacts,'02-november-peer-only-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1100});

 await page.goto(base+'/?page=scores&scoreTab=leaders&scoreMonth='+november);
 await page.getByRole('heading',{name:'历史负责人评分',exact:true,level:2}).waitFor();
 const picker=page.getByRole('button',{name:'负责人评分月份',exact:true});assert.match(await picker.innerText(),/10\s*月/);
 await picker.click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'2026 年 11 月',exact:true}).click();
 await page.locator('.boss-leader-panel').getByText('本月同事互评占100%，不再单独进行负责人或老板评分。可切换旧月份查看原口径记录。',{exact:true}).waitFor();assert.equal(await page.locator('.boss-leader-panel').getByRole('spinbutton').count(),0);
 role='member';await page.goto(base+'/?page=collaboration-scores&personalMonth='+november+'&personalUser=target');
 await page.getByRole('heading',{name:'360 协同得分',level:2,exact:true}).waitFor();await page.getByText('同事互评100%',{exact:false}).first().waitFor();assert.match(await page.locator('.pf-metrics').innerText(),/0\.0/);assert(!/30%|70%/.test(await page.locator('.pf-metrics').innerText()));
 assert.equal(await page.getByRole('button',{name:'导出Excel',exact:true}).count(),0);assert.equal(await page.getByRole('spinbutton').count(),0);
 assert.deepEqual(unexpected,[]);assert.deepEqual(outbound,[]);assert.deepEqual(businessWrites,[]);assert.deepEqual(errors,[]);
 const proof={ok:true,syntheticOnly:true,newMonthPeers100:true,zeroIsPublished:true,partialAndNoAssignmentsHonest:true,personalVersusWholeCycleProgress:true,oldOctoberWeightedPreserved:true,oldNovemberWeightedRuleTakesPrecedence:true,noNewThirtyPercentForms:true,bossHistoricalDefaultOctober:true,personalScoresNoManagerGate:true,desktopAndMobile:true,noBusinessWrites:true,noOutbound:true,requests,artifacts};
 await writeFile(path.join(artifacts,'result.json'),JSON.stringify(proof,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(proof));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(artifacts,'requests.json'),JSON.stringify({requests,unexpected,outbound,businessWrites,errors},null,2),{mode:0o600,flag:'wx'});console.log('Synthetic artifacts retained:',artifacts);}
