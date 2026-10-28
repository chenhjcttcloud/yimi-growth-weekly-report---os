import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'dev-views-test-'));
const children=[];
async function start(mode,enabled){
 const port=6600+Math.floor(Math.random()*600),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env, APP_DATA_DIR: "src/data",AUTH_MODE:mode,DEV_VIEW_SWITCH_ENABLED:String(enabled),SESSION_SECRET:'dev-view-regression-secret',SERVER_PORT:String(port),WEEKLY_REPORT_DB_PATH:path.join(dir,`${port}.sqlite`),SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 children.push(child);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)return base;}catch{}await new Promise(r=>setTimeout(r,50));}
 throw Error('server startup failed');
}
async function call(base,route,{body,cookie,origin,contentType='application/json'}={}){
 const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':contentType,...(cookie?{cookie}:{}),...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
try{
 const base=await start('mock',true);
 const initial=await call(base,'/api/dev/views');
 assert.equal(initial.status,200);assert.equal(initial.data.activeId,'boss');
 assert.equal(initial.data.views.filter(v=>v.group==='管理视角').length,2);
 const employee=initial.data.views.find(v=>v.role==='employee');assert(employee);
 const selected=await call(base,'/api/dev/views',{body:{id:employee.id}});
 assert.equal(selected.status,200);assert(selected.cookie);
 const me=await call(base,'/api/me',{cookie:selected.cookie});
 assert.equal(me.data.access.role,'member');assert.equal(me.data.access.canViewBossDashboard,false);assert.equal(me.data.devView.id,employee.id);
 assert.equal((await call(base,'/api/performance/manage',{cookie:selected.cookie})).status,403);
 assert.equal((await call(base,'/api/management-data',{cookie:selected.cookie})).status,403);
 assert.equal((await call(base,'/api/settings/status',{cookie:selected.cookie})).status,403);
 assert.equal((await call(base,'/api/system-settings',{cookie:selected.cookie})).status,403);
 assert.equal((await call(base,'/api/system-settings/ai',{cookie:selected.cookie,body:{}})).status,403);
 assert.equal((await call(base,'/api/performance/me',{cookie:selected.cookie})).status,200);
 assert.equal((await call(base,'/api/dev/views',{cookie:selected.cookie})).data.activeId,employee.id);
 const hr=await call(base,'/api/dev/views',{body:{id:'hr'},cookie:selected.cookie});
 assert.equal((await call(base,'/api/me',{cookie:hr.cookie})).data.access.role,'system_admin');
 assert.equal((await call(base,'/api/me',{cookie:hr.cookie})).data.user.userId,me.data.user.userId,'management switch must preserve employee identity');
 assert.equal((await call(base,'/api/personal/workspace?month=2026-01',{cookie:hr.cookie})).status,200);
 assert.equal((await call(base,'/api/performance/manage',{cookie:hr.cookie})).status,200);
 assert.equal((await call(base,'/api/departments',{cookie:hr.cookie})).data.canScore,false);
 assert.equal((await call(base,'/api/departments/score',{cookie:hr.cookie,body:{}})).status,403);
 assert.equal((await call(base,'/api/departments',{cookie:selected.cookie})).status,403);
 assert.equal((await call(base,'/api/me',{cookie:hr.cookie})).data.access.canViewBossDashboard,true);
 assert.equal((await call(base,'/api/boss-view-members',{cookie:hr.cookie})).status,200);
 assert.equal((await call(base,'/api/system-settings',{cookie:hr.cookie})).status,200);
 const settings=await call(base,'/api/settings/status',{cookie:hr.cookie});
 assert.equal(settings.status,200); assert.equal(settings.data.authMode,'mock');
 assert(settings.data.services.length>=5);
 assert(!JSON.stringify(settings.data).includes('dev-view-regression-secret'));
 const audit=await call(base,'/api/roster/audit');
 assert.equal(audit.data.counts.latestReports,2,'roster audit must include fixture reports, not just SQL imports');
 const boss=await call(base,'/api/dev/views',{body:{id:'boss'},cookie:hr.cookie});
 assert.equal((await call(base,'/api/me',{cookie:boss.cookie})).data.access.role,'boss');
 assert.equal((await call(base,'/api/dev/views',{body:{id:'unknown'}})).status,400);
 assert.equal((await call(base,'/api/dev/views',{body:{id:'boss'},origin:'http://untrusted.invalid'})).status,403);
 assert.equal((await call(base,'/api/dev/views',{body:{id:'boss'},contentType:'text/plain'})).status,415);
 const disabled=await start('mock',false);
 assert.equal((await call(disabled,'/api/dev/views')).status,404);
 assert.equal((await call(disabled,'/api/dev/views',{body:{id:'boss'}})).status,404);
 const production=await start('feishu',true);
 assert.equal((await call(production,'/api/dev/views')).status,404);
 assert.equal((await call(production,'/api/dev/views',{body:{id:'boss'}})).status,404);
 assert.equal((await call(production,'/api/me',{cookie:boss.cookie})).status,401);
 // Old ordinary login sessions remain valid and receive a persistent cookie.
 const signedCookie = payload => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return 'wos_session=' + body + '.' + createHmac('sha256','dev-view-regression-secret').update(body).digest('base64url');
 };
 const oldLogin = signedCookie({user:{userId:'persistent_login_test',name:'Test'},issuedAt:Date.now()-800*86400000});
 const resumed = await fetch(production+'/api/me',{headers:{cookie:oldLogin}});
 assert.equal(resumed.status,200);
 assert.match(resumed.headers.get('set-cookie'),/Max-Age=34560000/);
 const heartbeat = await fetch(production+'/api/usage/heartbeat',{method:'POST',headers:{cookie:oldLogin,'content-type':'application/json'},body:JSON.stringify({page:'growth',visible:true})});
 assert.equal(heartbeat.status,200);
 assert.match(heartbeat.headers.get('set-cookie'),/Max-Age=34560000/);
 const expiredShare = signedCookie({user:{userId:'external',role:'external_boss_view'},expiresAt:new Date(Date.now()-1000).toISOString()});
 assert.equal((await call(production,'/api/me',{cookie:expiredShare})).status,401);
 const logout = await fetch(production+'/auth/logout',{method:'POST',headers:{cookie:oldLogin},redirect:'manual'});
 assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 assert(!logout.headers.get('set-cookie').includes('Max-Age=34560000'));

 console.log('development view tests passed: boss / administrator / employee switching and legacy HR compatibility, server permissions, session persistence, origin validation, disabled and real-auth isolation');
}finally{
 await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill('SIGTERM');})));
 await rm(dir,{recursive:true,force:true});
}
