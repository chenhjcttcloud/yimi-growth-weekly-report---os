import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Exercise the actual shared component without changing any application data.
const source=`
import {useState,Fragment} from 'react';
import {createRoot} from 'react-dom/client';
import {AppSelect} from './src/components/AppSelect';
function Harness(){
 const [leader,setLeader]=useState(''),[status,setStatus]=useState(1),[custom,setCustom]=useState(''),[locked,setLocked]=useState(false),[submitted,setSubmitted]=useState('');
 return <main><h1>应用内选择器</h1><form onSubmit={e=>{e.preventDefault();setSubmitted(new FormData(e.currentTarget).get('leader'));}}>
 <fieldset disabled={locked}><label>负责人<AppSelect aria-label="负责人" name="leader" value={leader} onValueChange={setLeader} required searchPlaceholder="搜索姓名或部门…"><option value="">暂不设置</option>{Array.from({length:15},(_,i)=><option value={'person-'+i} disabled={i===8} key={i}>{'员工'+String(i).padStart(2,'0')} · {i%2?'产品推广':'国内事业部'}</option>)}</AppSelect></label></fieldset>
 <label htmlFor="status">状态</label><AppSelect id="status" value={status} onValueChange={value=>setStatus(Number(value))}><Fragment><option value={1}>使用中</option><option value={0} disabled>已停用</option><option value={2}>归档</option></Fragment></AppSelect>
 <label>自由输入<AppSelect aria-label="自由输入" value={custom} onValueChange={setCustom} allowCustomValue><option value="">请选择姓名</option><option value="张三">张三</option></AppSelect></label>
 <label>分组选择<AppSelect aria-label="分组选择" defaultValue="a" name="group"><optgroup label="可选组"><option value="a">甲</option><option value="b">乙</option></optgroup><optgroup label="已停用组" disabled><option value="c">丙</option></optgroup></AppSelect></label>
 <label>默认选择<AppSelect aria-label="默认选择" name="default" defaultValue="second"><option value="first">第一项</option><option value="second">第二项</option></AppSelect></label>
 <button type="submit">提交表单</button><button type="reset">重置表单</button></form>
 <button type="button" onClick={()=>setLocked(v=>!v)}>切换禁用</button><button type="button">外部按钮</button>
 <output aria-label="负责人值">{leader}</output><output aria-label="状态值">{status}</output><output aria-label="自定义值">{custom}</output><output aria-label="表单结果">{submitted}</output>
 <div id="edge"><AppSelect aria-label="边缘选择" defaultValue="1">{[1,2,3,4,5].map(i=><option key={i} value={i}>选项{i}</option>)}</AppSelect></div></main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle=await build({stdin:{contents:source,sourcefile:'select-harness.tsx',resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
const css=await readFile('src/styles/select.css','utf8');
const server=createServer((req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:14px system-ui;background:#f5f7f2;color:#243a2b;margin:25px}main{max-width:460px}form{display:grid;gap:12px}fieldset{padding:0;border:0;margin:0}label{display:grid;gap:7px}output{display:block;margin-top:8px}#edge{position:fixed;bottom:12px;right:12px;width:160px}'+css+'</style><div id="root"></div><script src="/bundle.js"></script></html>');
});
server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1100,height:950}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const leader=page.getByRole('combobox',{name:'负责人',exact:true});
 await leader.waitFor();assert.equal(await page.locator('select:visible').count(),0);
 await leader.click();
 const search=page.getByRole('searchbox',{name:'搜索负责人'});
 await search.fill('员工09');assert.equal(await page.getByRole('option').count(),1);
 await search.press('Enter');assert.equal(await page.getByLabel('负责人值',{exact:true}).textContent(),'person-9');
 assert(await leader.evaluate(el=>el===document.activeElement));
 await leader.press('Space');await search.fill('不存在的人');await page.getByText('没有匹配的选项',{exact:true}).waitFor();
 await search.press('Escape');assert.equal(await leader.getAttribute('aria-expanded'),'false');
 await leader.click();await search.fill('员工08');await page.getByRole('option').click({force:true});
 assert.equal(await page.getByLabel('负责人值',{exact:true}).textContent(),'person-9','disabled choices cannot change the value');
 await page.getByRole('button',{name:'外部按钮',exact:true}).click();assert.equal(await page.getByRole('listbox').count(),0);
 const status=page.getByRole('combobox',{name:'状态',exact:true});
 await status.press('ArrowDown');await status.press('ArrowDown');await status.press('Enter');
 assert.equal(await page.getByLabel('状态值',{exact:true}).textContent(),'2','arrows skip disabled options and keep numeric values');
 await leader.click();await search.press('Tab');assert(await status.evaluate(el=>el===document.activeElement),'Tab continues to the next control from the portalled search');
 await leader.click();await page.getByRole('button',{name:'切换禁用',exact:true}).click();assert(await leader.isDisabled());
 await leader.evaluate(el=>el.click());assert.equal(await page.getByRole('listbox').count(),0,'fieldset-disabled controls cannot open');
 await page.getByRole('button',{name:'切换禁用',exact:true}).click();
 await page.getByRole('combobox',{name:'自由输入',exact:true}).click();
 await page.getByRole('searchbox',{name:'搜索自由输入'}).fill('新同事');await page.getByRole('option',{name:'使用“新同事”',exact:true}).click();
 assert.equal(await page.getByLabel('自定义值',{exact:true}).textContent(),'新同事','former datalist free-entry behavior remains available');
 await page.getByRole('combobox',{name:'分组选择',exact:true}).click();assert.equal(await page.getByRole('option',{name:/丙/}).getAttribute('aria-disabled'),'true');
 await page.keyboard.press('Escape');
 await page.getByRole('combobox',{name:'默认选择',exact:true}).click();await page.getByRole('option',{name:'第一项',exact:true}).click();
 await page.getByRole('button',{name:'重置表单',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('select[name="default"]').value==='second'&&document.querySelector('select[name="leader"]').value==='person-9');
 assert((await page.getByRole('combobox',{name:'默认选择',exact:true}).textContent()).includes('第二项'));
 await page.getByRole('button',{name:'提交表单',exact:true}).click();assert.equal(await page.getByLabel('表单结果',{exact:true}).textContent(),'person-9','standard form submission receives the selected value');
 // Positioning is based on the viewport, not an overflowing/clipped page container.
 const edge=page.getByRole('combobox',{name:'边缘选择',exact:true});await edge.click();
 let box=await page.locator('.app-select-panel').boundingBox(),rect=await edge.boundingBox();
 assert(box.y>=10&&box.x>=10&&box.x+box.width<=1090&&box.y+box.height<=rect.y,'bottom-edge menus flip upward without overflowing');
 await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:844});await edge.click();
 box=await page.locator('.app-select-panel').boundingBox();assert(box.x>=10&&box.x+box.width<=380&&box.y>=10&&box.y+box.height<=834,'mobile menus stay within the viewport');
 await page.keyboard.press('Escape');await page.getByRole('combobox',{name:'负责人',exact:true}).click();
 await page.screenshot({path:'outputs/app-select-mobile.png',fullPage:false});
 assert.deepEqual(errors,[]);
 for(const file of await readdir('src',{recursive:true})){if(file.endsWith('.tsx')&&!file.endsWith('AppSelect.tsx'))assert(!/<(?:select|datalist)\b/.test(await readFile('src/'+file,'utf8')),`${file} must use the shared application dropdown`);}
 console.log('AppSelect tests passed: search, keyboard, focus, disabled/fieldset/grouped options, free entry, form/reset, mobile/edge positioning, no visible native menus, system-wide migration.');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
