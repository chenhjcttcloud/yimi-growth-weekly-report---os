import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
await mkdir('outputs/tests',{recursive:true});const dir=await mkdtemp(path.resolve('outputs/tests/business-regression-'));
const suites=[
 'weekly-report-schedule','report-automation','live-report-sync','month-end-score-reminders','china-work-calendar','weighted-monthly',
 'security-lifecycle','setup-operations','reminder-reliability','monthly-handoffs','feishu-user-tokens',
 'sso-roster','company-directory','employee-status-api','company-roster-ui','departments','system-settings','personal-scoring-reminders','feishu-leaders','feishu-department-sync','department-mirror-sync','department-mirror-scoring','department-mirror-ui','organization-layout',
 'personal-workspace','employee-preview','scoring360-policy','scoring-workbench',
 'scoring-workbench-ui','authorization-candidates','role-authorization','external-sharing-disabled','hardening-ui','automatic-performance','performance-policy-reads','personal-loading-scope','source-data-cache','management-client-data','management-transport','performance-loading','scoring-overview-loading','department-summary-loading','weighted-monthly-api','manager-reviews-ui','score-month-sync','month-end-reminders-api','app-select','business-workflow',
];
const env={...process.env,TEST_STATIC_DIR:dir+'/build',CHINA_CALENDAR_AUTO_UPDATE_ENABLED:'false',LARK_REPORT_AUTO_SYNC_ENABLED:'false',LARK_AUTH_MONITOR_ENABLED:'false',SCORING360_REMINDER_ENABLED:'false',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false',FEISHU_APP_ID:'',FEISHU_APP_SECRET:'',MOONSHOT_API_KEY:'',KIMI_API_KEY:''};
const results=[];
async function execute(name,command,args){
 const started=Date.now();let output='';
 const child=spawn(command,args,{env:{...env,LARK_REPORT_SYNC_STATUS_PATH:dir+'/'+name+'-sync.json'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 const code=await new Promise(resolve=>{child.on('error',error=>{output+=error.message;resolve(-1);});child.on('close',resolve);});
 const log=dir+'/'+name+'.log';await writeFile(log,output);const result={name,ok:code===0,code,milliseconds:Date.now()-started,log};results.push(result);console.log((result.ok?'PASS ':'FAIL ')+name);
 return result.ok;
}
let ok=await execute('typescript',path.join(root,'node_modules/.bin/tsc'),['-b']);
if(ok)ok=await execute('build',path.join(root,'node_modules/.bin/vite'),['build','--emptyOutDir','false','--outDir',dir+'/build']);
if(ok)for(const suite of suites)await execute(suite,process.execPath,['scripts/test-'+suite+'.mjs']);
const passed=results.filter(r=>r.ok).length,failed=results.filter(r=>!r.ok);
await writeFile(dir+'/result.json',JSON.stringify({ok:!failed.length,suites:suites.length,checks:results.length,passed,failed,results,realMessagesSent:0,artifacts:dir},null,2));
console.log(JSON.stringify({ok:!failed.length,passed,checks:results.length,failed:failed.map(r=>r.name),artifacts:dir}));
if(failed.length)process.exitCode=1;
