import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Exercise the real browser adapter and old growth component with synthetic
// reports only. Bundles and fixtures are retained; no provider or server runs.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/pending-quality-aggregates-'));
const bundle=await build({entryPoints:['src/lib/data.ts'],bundle:true,write:false,format:'esm',platform:'node',target:'esnext'});
const uiBundle=await build({entryPoints:['src/pages/EmployeeGrowthPage.tsx'],bundle:true,write:false,format:'esm',platform:'node',target:'esnext',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
const period=end=>({id:'period-'+end,label:end.startsWith('2026-09')?'9月第一周':'8月第四周',range:end,start:end,end,submitted_count:2,exempt_people:[],status:'历史'});
function row(user,end,score){return {
 user_id:user,'姓名':'测试'+user,'部门':'测试团队','周期ID':'period-'+end,'周次':period(end).label,'开始日期':end,'结束日期':end,'提交时间':end+'T10:00:00Z','状态':'准时','总分':score,
 '本周成果摘要':'虚构交付结果','问题摘要':'虚构接口卡点','下周计划摘要':'周五前完成虚构验收','思考与复盘摘要':'虚构复盘方法',
 ...(score===null?{}:{'成果分':score,'问题分':score,'计划分':score,'复盘分':score,'等级':'B+'}),
};}
function fixture(rows){
 const users=[...new Set(rows.map(item=>item.user_id))];
 return {prototypeData:{meta:{current_week_id:'period-2026-09-04',generated_on:'2026-09-05',periods:[period('2026-08-28'),period('2026-09-04')]},employee_summary:users.map(user=>({user_id:user,'姓名':'测试'+user,'部门':'测试团队','周报数':rows.filter(item=>item.user_id===user).length,'平均分':80,'等级':'B+','自动等级':'B+'})),weekly_scores:rows},kimiInsights:{},kimiInsightsByPeriod:{},monthlyMeetingInsights:{},scoring360:{cycles:[],assignments:[],responses:[],results:[]}};
}
async function load(source,value,name){
 const filename=path.join(dir,name+'.mjs');
 const fetchStub=`const fetch=async url=>{if(url!=='/api/management-data?view=client')throw Error('unexpected_fixture_request');return {ok:true,json:async()=>(${JSON.stringify(value)})};};\n`;
 await writeFile(filename,fetchStub+source);
 return import(pathToFileURL(filename).href);
}
function assertAverages(adapter,current,previous,count){
 const periodBrief=adapter.departmentMeetingBriefsForPeriod('period-2026-09-04').find(item=>item.department==='测试团队');
 assert.equal(periodBrief.currentAverage,current,'department weekly mean excludes pending reports');
 assert.equal(periodBrief.previousAverage,previous,'previous weekly mean excludes pending reports');
 const month=adapter.monthlyMeetingBriefForMonth('2026-09'),department=month.departmentReviews.find(item=>item.department==='测试团队');
 assert.equal(month.averageScore,current,'company monthly mean excludes pending reports');
 assert.equal(department.currentAverage,current,'department monthly mean excludes pending reports');
 assert.equal(department.previousAverage,previous,'previous monthly mean excludes pending reports');
 assert.equal(month.comparison.scoreDelta,Math.round((current-previous)*10)/10);
 assert.equal(month.totalReports,count,'pending reports still count as submitted reports');
 assert.equal(month.submittedPeople,count,'pending reports still count as submitting employees');
 assert.equal(adapter.weeklyForPeriod('period-2026-09-04').length,count,'source period reports remain intact');
}
const pendingFixture=fixture([row('high','2026-08-28',80),row('pending','2026-08-28',null),row('high','2026-09-04',100),row('pending','2026-09-04',null)]);
const pending=await load(bundle.outputFiles[0].text,pendingFixture,'pending-adapter');
assertAverages(pending,100,80,2);
assert.equal(pending.appData.weeklyScores.filter(item=>item.qualityAvailable===false).length,2);
const zeroFixture=fixture([...pendingFixture.prototypeData.weekly_scores,row('zero','2026-09-04',0),row('zero','2026-08-28',0)]);
const zero=await load(bundle.outputFiles[0].text,zeroFixture,'zero-adapter');
assertAverages(zero,50,40,3);
assert.equal(zero.appData.weeklyScores.find(item=>item.userId==='zero').qualityAvailable,true,'valid zero is still an analysed score');
const legacyFixture=fixture([row('high','2026-08-28',70),row('other','2026-08-28',90),row('high','2026-09-04',100),row('other','2026-09-04',80)]);
const legacy=await load(bundle.outputFiles[0].text,legacyFixture,'legacy-adapter');
assertAverages(legacy,90,80,2);

const growthFixture=fixture([row('growth','2026-08-21',90),row('growth','2026-08-28',100),row('growth','2026-09-04',null)]);
const growth=await load(uiBundle.outputFiles[0].text,growthFixture,'pending-growth');
const props={selectedPeriodId:'period-2026-09-04',selectedEmployee:'测试growth',onSelectEmployee:()=>{},visibleEmployees:[{userId:'growth',name:'测试growth',department:'测试团队'}]};
const html=renderToStaticMarkup(React.createElement(growth.EmployeeGrowthPage,props));
assert(html.includes('class="v2-hero-score-num">待分析</span>'),'pending growth hero must not present zero');
assert(html.includes('分析完成后自动更新'),'pending score cannot show a numeric score delta');
assert(html.includes('近 2 周走势'),'growth sparkline includes only the two analysed weeks');
const zeroGrowthFixture=fixture([row('growth','2026-08-28',100),row('growth','2026-09-04',0)]);
const zeroGrowth=await load(uiBundle.outputFiles[0].text,zeroGrowthFixture,'zero-growth');
const zeroHtml=renderToStaticMarkup(React.createElement(zeroGrowth.EmployeeGrowthPage,props));
assert(zeroHtml.includes('class="v2-hero-score-num">0</span>'),'valid zero must still display as zero');
const result={ok:true,pendingExcludedFromAllMeetingAverages:true,validZeroIncluded:true,reportCountsPreserved:true,legacyCompleteScoresPreserved:true,growthPendingHero:true,growthTrendExcludesPending:true,externalRequests:0,artifacts:dir};
await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
