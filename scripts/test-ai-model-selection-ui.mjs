import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

await mkdir('outputs/tests',{recursive:true});
const directory=await mkdtemp(path.resolve('outputs/tests/ai-model-selection-'));
const component=path.resolve('src/components/SystemConfiguration.tsx');
await writeFile(path.join(directory,'entry.tsx'),`
 import {createRoot} from 'react-dom/client';
 import {SystemConfiguration} from ${JSON.stringify(component)};
 createRoot(document.getElementById('root')!).render(<SystemConfiguration section="ai"/>);
`);
await build({entryPoints:[path.join(directory,'entry.tsx')],outfile:path.join(directory,'app.js'),
  bundle:true,jsx:'automatic',platform:'browser',format:'esm',logLevel:'silent'});
const files=new Map([
  ['/', ['text/html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>']],
  ['/app.js',['text/javascript',await readFile(path.join(directory,'app.js'))]],
  ['/app.css',['text/css',await readFile(path.join(directory,'app.css'))]],
]);
const server=createServer((request,response)=>{
  const file=files.get(request.url);
  if(!file){response.writeHead(404).end();return;}
  response.writeHead(200,{'content-type':file[0]}).end(file[1]);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const provider='https://fixture-ai.invalid/v1';
const configuration={ai:{baseUrl:provider,model:'custom-existing',keyConfigured:true},policy:{},currentMonth:'2026-11'};
const saves=[],unexpected=[],pageErrors=[];
let listings=0,listingMode='available',browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base){unexpected.push(url.origin);return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname==='/api/system-settings'&&request.method()==='GET'){
      return route.fulfill({json:configuration});
    }
    if(url.pathname==='/api/system-settings/ai/models'&&request.method()==='GET'){
      listings++;
      if(listingMode==='unavailable'){
        return route.fulfill({status:502,json:{ok:false,error:'ai_models_unavailable'}});
      }
      const baseUrl=listingMode==='different-provider'?'https://other-fixture.invalid/v1':configuration.ai.baseUrl;
      return route.fulfill({json:{ok:true,baseUrl,models:['fixture-fast','fixture-pro']}});
    }
    if(url.pathname==='/api/system-settings/ai/usage'&&request.method()==='GET'){
      return route.fulfill({json:{ok:true,days:30,startDate:'2026-10-13',endDate:'2026-11-11',modules:[]}});
    }
    if(url.pathname==='/api/system-settings/ai'&&request.method()==='POST'){
      const saved=request.postDataJSON();
      saves.push(saved);
      configuration.ai={...configuration.ai,...saved};
      return route.fulfill({json:{ok:true}});
    }
    unexpected.push(request.method()+' '+url.pathname);
    return route.fulfill({status:404,json:{ok:false}});
  });
  await page.goto(base);
  const model=page.getByRole('combobox',{name:'模型名称',exact:true});
  await model.waitFor();
  await model.click();
  assert.equal(await page.getByRole('option',{name:/custom-existing/}).getAttribute('aria-selected'),'true');
  await page.getByRole('option',{name:'fixture-pro',exact:true}).click();
  assert.equal(saves.length,0,'loading and choosing a model do not save settings');
  assert.equal(listings,1);
  const address=page.getByRole('textbox',{name:'API 服务地址',exact:true});
  const manual=page.getByRole('textbox',{name:'模型名称',exact:true});
  await address.fill('https://other-fixture.invalid/v1');
  await manual.waitFor();
  assert.equal(await model.count(),0,'unsaved service addresses cannot use the old model list');
  assert.equal(await manual.inputValue(),'fixture-pro');
  assert.equal(listings,1,'editing a draft address makes no provider request');
  await address.fill(provider);
  await model.waitFor();
  await page.getByRole('button',{name:'保存 AI 配置',exact:true}).click();
  await page.getByText('AI 服务配置已保存，后续调用立即使用新配置。',{exact:true}).waitFor();
  assert.deepEqual(saves,[{baseUrl:provider,model:'fixture-pro'}]);

  const refresh=page.getByRole('button',{name:/刷新模型/});
  listingMode='unavailable';
  await refresh.click();
  await page.getByText('暂时无法读取模型列表，可手动填写。',{exact:true}).waitFor();
  await manual.waitFor();
  assert.equal(await manual.inputValue(),'fixture-pro','discovery failure preserves the configured model');
  await manual.fill('fixture-manual');
  await page.getByRole('button',{name:'保存 AI 配置',exact:true}).click();
  await page.getByText('AI 服务配置已保存，后续调用立即使用新配置。',{exact:true}).waitFor();
  assert.deepEqual(saves.at(-1),{baseUrl:provider,model:'fixture-manual'});

  listingMode='different-provider';
  const response=page.waitForResponse(r=>r.url()===base+'/api/system-settings/ai/models');
  await refresh.click();
  await response;
  await page.getByText('API 服务地址已变更，请刷新配置后重新读取模型列表。',{exact:true}).waitFor();
  await manual.waitFor();
  assert.equal(await model.count(),0,'models from a different saved address cannot be selected');
  assert.equal(await manual.inputValue(),'fixture-manual');
  assert.deepEqual(unexpected,[]);
  assert.deepEqual(pageErrors,[]);
  console.log('AI model selection passed: automatic discovery, explicit save, manual fallback and provider-address guard.');
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
  console.log('Test artifacts retained:',directory);
}
