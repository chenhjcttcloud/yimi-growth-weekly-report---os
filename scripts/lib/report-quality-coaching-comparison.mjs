const DISCLAIMER = '本评分仅用于评价周报的信息完整度、沟通价值与复盘质量，不代表对员工绩效或工作价值的最终评价。';
const MODULES = [
  {id:'results',label:'本周成果',points:30,oldIndex:0,factKeys:['results','本周成果摘要']},
  {id:'problems',label:'问题与挑战',points:25,oldIndex:1,factKeys:['problems','问题摘要']},
  {id:'reflection',label:'思考与复盘',points:20,oldIndex:3,factKeys:['reflection','思考与复盘摘要']},
  {id:'nextPlan',label:'下周计划',points:25,oldIndex:2,factKeys:['nextPlan','plan','下周计划摘要']},
];

const text = value => typeof value==='string'||typeof value==='number'||typeof value==='boolean'?String(value):'';
const escape = value => text(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const numeric = value => (typeof value==='number'&&Number.isFinite(value)) || (typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value)));
// Preserve stored decimal precision. This view never derives totals or reweights old scores.
const score = value => numeric(value)?escape(value):'—';
const list = value => Array.isArray(value)?[...new Set(value.filter(item=>typeof item==='string'&&item.trim()).map(item=>item.trim()))]:[];
const moduleFor = (assessment,id) => Array.isArray(assessment?.modules)?assessment.modules.find(module=>module?.id===id):undefined;
const oldModuleScore = (sample,module) => {
  const stored=sample.old?.scores?.[module.oldIndex];
  return numeric(stored)?stored:moduleFor(sample.old?.assessment,module.id)?.candidateScore;
};
const contribution = (assessment,module) => {
  const saved=moduleFor(assessment,module.id);
  return saved&&numeric(saved.earnedPoints)?`${score(saved.earnedPoints)} / ${score(numeric(saved.maxPoints)?saved.maxPoints:module.points)}`:'—';
};
const time = value => {
  if(!value)return '未记录';
  const date=new Date(value);
  return Number.isFinite(date.getTime())?escape(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date)):escape(value);
};
const metadata = entries => `<dl class="metadata">${entries.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)||'未记录'}</dd></div>`).join('')}</dl>`;
const bullets = (items,className,empty) => items.length?`<ul class="${className}">${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`:`<p class="muted">${escape(empty)}</p>`;

function renderOld(sample){
  const saved=sample.old||{};
  return `<section class="column old-column" aria-label="旧版保存评分">
    <header class="column-heading"><span class="eyebrow">历史保存值</span><h3>旧版评分</h3><div class="total" data-old-total>${score(saved.totalScore)}<small> / 100</small></div><p>按保存值展示；不重算旧模块，不套用新权重。</p></header>
    ${MODULES.map(module=>{
      const assessment=moduleFor(saved.assessment,module.id);
      return `<article class="old-module" data-old-module="${module.id}"><header><h4>${module.label}</h4><span>${score(oldModuleScore(sample,module))}<small> / 100 · 原分</small></span></header><p>${escape(assessment?.reason)||'未保存该模块理由。原分保留，不补写历史依据。'}</p></article>`;
    }).join('')}
    <details class="provenance"><summary>旧版评分记录</summary>${metadata([['规则版本',saved.version],['提示词版本',saved.promptVersion],['评分模型',saved.model],['评分时间',text(saved.generatedAt)]])}</details>
  </section>`;
}

function renderCandidate(result){
  const assessment=result?.assessment;
  if(!assessment)return `<section class="column candidate-column" aria-label="成长教练候选"><header class="column-heading"><span class="eyebrow">只读预览 · 待人工确认</span><h3>成长教练候选</h3></header><p class="empty">候选分析尚未完成。这里不填入默认分，也不改变原有评分。</p></section>`;
  return `<section class="column candidate-column" aria-label="成长教练候选">
    <header class="column-heading"><span class="eyebrow">只读预览 · 待人工确认</span><h3>成长教练候选</h3><div class="total" data-new-total>${score(assessment.totalScore)}<small> / 100</small></div><p>四模块显示本次实际贡献分；仅用于此次私人校准。</p></header>
    ${MODULES.map(module=>{
      const saved=moduleFor(assessment,module.id);
      if(!saved)return `<article class="coach-module" data-coaching-module="${module.id}"><header><h4>${module.label}</h4><span>—</span></header><p class="muted">未生成此模块的候选分析。</p></article>`;
      // Criteria, evidence levels, confidence and verification are deliberately
      // absent from these cards. Optional verification must not add a second set of tips.
      const suggestions=list(saved.suggestions).slice(0,2);
      return `<article class="coach-module" data-coaching-module="${module.id}">
        <header><h4>${module.label}</h4><span>${contribution(assessment,module)}<small> 分</small></span></header>
        <div class="coach-section"><h5>理由</h5><p>${escape(saved.reason)||'本次未提供理由。'}</p></div>
        <div class="coach-section"><h5>做得好</h5>${bullets(list(saved.strengths),'strengths','本次未单独列出。')}</div>
        <div class="coach-section"><h5>可以补充</h5>${bullets(suggestions,'suggestions','本次未提出补充建议。')}</div>
      </article>`;
    }).join('')}
    <details class="provenance"><summary>候选分析记录</summary>${metadata([['规则版本',assessment.version],['提示词版本',assessment.promptVersion],...(result.reviewPromptVersion?[['复核提示词版本',result.reviewPromptVersion]]:[]),['评分模型',result.model],['评分时间',text(result.generatedAt)]])}</details>
  </section>`;
}

function renderSource(sample){
  return `<details class="original-text"><summary>展开本份周报的四模块原文 · 默认收起</summary><p class="muted">原文仅保存在本地对照文件中，请注意周围环境，阅读后收起。</p><div class="source-grid">${MODULES.map(module=>{
    const value=module.factKeys.map(key=>sample.facts?.[key]).find(value=>typeof value==='string'&&value.trim());
    return `<article><h4>${module.label}</h4><p>${escape(value)||'此模块原文为空。'}</p></article>`;
  }).join('')}</div>${metadata([['原文指纹',sample.sourceHash]])}</details>`;
}

/** A private, read-only HTML artifact. No browser scripts or network resources. */
export function renderCoachingComparison({cases=[],results=[],generatedAt,model,ruleVersion,promptVersion,reviewPromptVersion}={}){
  if(!Array.isArray(cases)||!Array.isArray(results))throw Error('invalid_comparison_input');
  const ids=new Set(),byCase=new Map();
  for(const sample of cases){
    if(typeof sample?.id!=='string'||!sample.id.trim()||ids.has(sample.id))throw Error('invalid_comparison_case_id');
    ids.add(sample.id);
  }
  for(const result of results){
    if(!ids.has(result?.caseId)||byCase.has(result.caseId))throw Error('invalid_comparison_result_id');
    byCase.set(result.caseId,result);
  }
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow,noarchive"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>周报质量 · 成长教练候选对照</title>
<style>
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:#f4f6f3;color:#24362f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7}main{width:min(1240px,calc(100% - 40px));margin:36px auto 60px}h1,h2,h3,h4,h5,p{margin-top:0}h1{font-size:30px;line-height:1.4;letter-spacing:-.6px;margin-bottom:10px}h2{font-size:21px;margin-bottom:5px}h3{font-size:20px;margin:4px 0 8px}h4{font-size:15px;margin-bottom:0}h5{font-size:12px;margin-bottom:5px}p{margin-bottom:10px}header p,.muted{color:#6b7b72;font-size:12px}.privacy{display:inline-block;padding:5px 11px;border:1px solid #e5c9a0;border-radius:6px;color:#855d2f;background:#fff6e8;font-size:12px;font-weight:600;margin-bottom:14px}.hero,.overview,.case{background:#fff;border:1px solid #dce4dc;border-radius:14px;box-shadow:0 3px 14px #263e2d05}.hero{padding:27px 30px}.hero .intro{max-width:900px;font-size:14px}.disclaimer{margin:18px 0 0;padding:13px 16px;background:#edf5ee;border-left:3px solid #5b906f;border-radius:0 6px 6px 0;font-size:13px;line-height:1.9}.run-meta{display:flex;flex-wrap:wrap;gap:6px 22px;color:#6b7b72;font-size:11px;margin-top:16px;overflow-wrap:anywhere}.overview{margin:20px 0 30px;padding:22px 24px}.overview h2{font-size:18px}.table-scroll{overflow-x:auto;border:1px solid #e1e7df;border-radius:9px}table{border-collapse:collapse;width:100%;min-width:940px;font-size:12px}th,td{text-align:left;padding:13px 14px;border-bottom:1px solid #e8ece6;vertical-align:top}th{color:#536b5c;background:#f4f7f1;font-size:11px;font-weight:600}th small,td small{display:block;color:#7b887d;font-size:10px;font-weight:400}tbody tr:last-child td{border-bottom:0}.table-person{font-weight:600;min-width:155px}.table-person small{font-weight:400;margin-top:3px}.old-cell,.new-cell{white-space:nowrap;font-variant-numeric:tabular-nums}.old-cell{color:#768278;font-size:11px}.new-cell{color:#236b4b;font-size:12px;font-weight:600;margin-top:4px}.table-total{font-size:19px;font-variant-numeric:tabular-nums}.table-total.new{color:#236b4b}.case{margin-bottom:28px;overflow:hidden}.case-heading{display:flex;justify-content:space-between;gap:20px;padding:23px 26px;border-bottom:1px solid #e0e7dd;align-items:flex-start}.case-heading p{margin-bottom:0}.case-heading>div{min-width:0;max-width:100%;overflow-wrap:anywhere}.category{display:inline-block;max-width:100%;padding:4px 10px;border-radius:6px;background:#eff3ec;color:#4d6e56;font-size:11px;overflow-wrap:anywhere}.comparison{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;padding:24px}.column{min-width:0}.column-heading{padding:0 4px 12px;border-bottom:1px solid #dfe7dc;margin-bottom:14px}.eyebrow{font-size:10px;font-weight:650;letter-spacing:1px;color:#6e8173}.candidate-column .eyebrow{color:#2d7757}.total{font-size:32px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.3;margin-bottom:10px}.total small{font-size:12px;font-weight:400;color:#7c897d}.candidate-column .total{color:#236b4b}.old-module,.coach-module{padding:15px 16px;border:1px solid #e1e7de;border-radius:9px;margin-bottom:12px;overflow-wrap:anywhere;break-inside:avoid}.old-module{background:#f8f9f6}.coach-module{background:#fbfef9;border-color:#d8e5d5}.old-module>header,.coach-module>header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}.old-module>header>span,.coach-module>header>span{white-space:nowrap;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}.coach-module>header>span{color:#236b4b}.old-module small,.coach-module small{font-size:10px;color:#7c897d;font-weight:400}.old-module p,.coach-section p,.coach-section li{font-size:12px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere}.old-module p{margin-bottom:0;color:#67776c}.coach-section+.coach-section{margin-top:12px}.coach-section p{margin-bottom:0}.coach-section ul{margin:0;padding-left:18px}.suggestions li+li,.strengths li+li{margin-top:3px}.provenance,.original-text{font-size:11px;color:#6a7e6e}.provenance{padding:10px 3px;border-top:1px solid #e2e8df}.provenance summary,.original-text summary{cursor:pointer;font-weight:600}.metadata{margin:10px 0 0;font-size:10px}.metadata>div{display:grid;grid-template-columns:84px minmax(0,1fr);gap:10px;margin:6px 0}.metadata dt{color:#7a887c}.metadata dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}.original-text{padding:17px 25px;background:#f7f8f4;border-top:1px solid #e1e7dc}.original-text>p{margin-top:12px}.source-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:15px;margin-top:14px}.source-grid article{background:#fff;padding:15px;border:1px solid #e1e7df;border-radius:8px;min-width:0}.source-grid p{margin:8px 0 0;font-size:12px;color:#53685a;white-space:pre-wrap;overflow-wrap:anywhere}.empty{padding:14px;border:1px dashed #d9e1d4;border-radius:8px;font-size:12px;color:#6d7f70}.footer{font-size:11px;color:#718374;line-height:1.9;margin:18px 4px;overflow-wrap:anywhere}summary:focus-visible{outline:2px solid #347a55;outline-offset:4px}@media(max-width:720px){main{width:calc(100% - 24px);margin:16px auto 36px}.hero{padding:20px 18px}h1{font-size:24px}.hero .intro{font-size:12px}.overview{padding:17px 14px}.comparison{grid-template-columns:minmax(0,1fr);gap:22px;padding:16px}.case-heading{padding:18px;flex-direction:column;gap:10px}.original-text{padding:15px 18px}.source-grid{grid-template-columns:minmax(0,1fr)}.run-meta{display:grid;gap:4px}.column-heading h3{font-size:18px}.disclaimer{font-size:12px}.case-heading h2{font-size:19px}}@media print{body{background:#fff}main{width:100%;margin:0}.hero,.overview,.case{box-shadow:none}.case{break-before:page}.original-text:not([open]) .source-grid{display:none}.table-scroll{overflow:visible}table{min-width:0;font-size:9px}th,td{padding:7px}.privacy{border:1px solid #bbb}}
</style></head><body><main>
<header class="hero"><span class="privacy">本地私人校准 · 不得公开</span><h1>周报质量：旧版与成长教练候选对照</h1><p class="intro">本页仅供人工校准${cases.length?`这 ${cases.length} 份周报`:''}。新候选待人工确认，不写回历史，也不进入月度结果或趋势；历史保存分、理由和权重保持原样。请勿公开、上传或转发本文件。</p><p class="disclaimer">${DISCLAIMER}</p><div class="run-meta"><span>生成时间：${time(generatedAt)}（北京时间）</span><span>候选模型：${escape(model)||'未记录'}</span><span>规则：${escape(ruleVersion)||'未记录'}</span><span>提示词：${escape(promptVersion)||'未记录'}</span>${reviewPromptVersion?`<span>复核提示词：${escape(reviewPromptVersion)}</span>`:''}</div></header>
<section class="overview" aria-label="新旧评分总览"><h2>评分对照总览</h2><p class="muted">旧模块为原保存分（/100），新模块为本次实际贡献分；两者口径分别标注，未换算旧分。手机可在表格内左右滑动。</p><div class="table-scroll"><table><thead><tr><th>样本</th><th>旧总分<small>保存值 / 100</small></th><th>新总分<small>候选值 / 100</small></th>${MODULES.map(module=>`<th>${module.label}<small>新贡献分 / ${module.points}</small></th>`).join('')}</tr></thead><tbody>${cases.map((sample,index)=>{
 const assessment=byCase.get(sample.id)?.assessment;
 return `<tr><td class="table-person">${index+1}. ${escape(sample.employeeName)||'姓名未提供'}<small>${escape(sample.category)}${sample.department?` · ${escape(sample.department)}`:''}</small><small>${escape(sample.weekStart)} — ${escape(sample.weekEnd)}</small></td><td class="table-total">${score(sample.old?.totalScore)}</td><td class="table-total new">${score(assessment?.totalScore)}</td>${MODULES.map(module=>`<td><div class="old-cell">旧 ${score(oldModuleScore(sample,module))} / 100</div><div class="new-cell">新 ${contribution(assessment,module)}</div></td>`).join('')}</tr>`;
}).join('')}</tbody></table></div>${!cases.length?'<p class="empty">尚未提供真实案例，本页不生成替代案例或默认评分。</p>':''}</section>
${cases.map((sample,index)=>`<article class="case" id="case-${index+1}"><header class="case-heading"><div><span class="eyebrow">样本 ${index+1}</span><h2>${escape(sample.employeeName)||'姓名未提供'}</h2><p>${escape(sample.department)||'部门未提供'} · ${escape(sample.weekStart)} — ${escape(sample.weekEnd)}</p></div><span class="category">${escape(sample.category)||'类别未提供'}</span></header><div class="comparison">${renderOld(sample)}${renderCandidate(byCase.get(sample.id))}</div>${renderSource(sample)}</article>`).join('')}
<p class="footer">只读本地分析产物。此页没有提交、重评、发布或保存操作，也不加载外部资源。关闭页面不会改变系统中的任何分数。</p>
</main></body></html>`;
}
