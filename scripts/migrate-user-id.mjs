import {spawnSync} from 'node:child_process';
import {readFile,writeFile,readdir,mkdir,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const canonicalKey=s=>String(s).replaceAll('OpenIds','UserIds').replaceAll('OpenId','UserId').replaceAll('openIds','userIds').replaceAll('openId','userId').replaceAll('_OPEN_IDS','_USER_IDS').replaceAll('_OPEN_ID','_USER_ID').replaceAll('open_id','user_id').replaceAll('user_user_id','user_id').replaceAll('userUserId','userId').replaceAll('USER_USER_ID','USER_ID');
const q=s=>'"'+String(s).replaceAll('"','""')+'"';const sql=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,32);
export async function migrateUserIds({dbPath,dataDir,mapping,backupDir,apply=false}){
 if(!Array.isArray(mapping)||!mapping.length||mapping.some(m=>!m.openId?.startsWith('ou_')||!m.userId||m.userId.startsWith('ou_'))||new Set(mapping.map(m=>m.userId)).size!==mapping.length||new Set(mapping.map(m=>m.openId)).size!==mapping.length)throw Error('invalid_identity_mapping');
 const aliases=new Map(mapping.map(m=>[m.openId,m.userId]));
 const run=(statement,json=false)=>{const r=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),'-cmd','.timeout 10000',dbPath],{input:statement,encoding:'utf8',maxBuffer:256*1024*1024});if(r.status!==0)throw Error('migration_sql_failed: '+r.stderr.slice(0,300));return json?JSON.parse(r.stdout||'[]'):r.stdout;};
 const tables=run("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",true).map(t=>t.name);
 const columns=new Map(tables.map(t=>[t,run(`PRAGMA table_info(${q(t)});`,true)]));
 const legacy=columns.get('employees')?.some(c=>c.name==='open_id');
 if(!legacy){if(run("SELECT COUNT(*) n FROM schema_migrations WHERE version='2026-10-26-user-id-primary';",true)[0].n){if(apply&&backupDir){try{const plan=JSON.parse(await readFile(path.join(backupDir,'migration-plan.json'),'utf8'));for(const f of plan.pending){try{await rename(f.temp,f.target);}catch(e){if(e.code!=='ENOENT')throw e;}}}catch(e){if(e.code!=='ENOENT')throw e;}}return {alreadyMigrated:true};}throw Error('expected_legacy_database');}
 const files=[];for(const name of await readdir(dataDir))if(name.endsWith('.json')){const p=path.join(dataDir,name);files.push({name,path:p,text:await readFile(p,'utf8')});}
 const tokens=new Set();const rowsByTable=new Map();
 for(const t of tables){const rows=run(`SELECT rowid AS __migration_rowid__,* FROM ${q(t)};`,true);rowsByTable.set(t,rows);for(const r of rows)for(const [k,v]of Object.entries(r))if(typeof v==='string'&&k!=='raw_json'&&k!=='raw_response_json')for(const m of v.matchAll(/ou_[a-zA-Z0-9]+/g))tokens.add(m[0]);}
 for(const f of files)for(const m of f.text.matchAll(/ou_[a-zA-Z0-9]+/g))tokens.add(m[0]);
 const missing=[...tokens].filter(x=>!aliases.has(x));if(missing.length)throw Error('unmapped_identity_count:'+missing.length);
 const keyed=new Map();const weekIds=new Set();
 for(const f of files){const v=JSON.parse(f.text);for(const p of v.meta?.periods||[])if(p.id)weekIds.add(p.id);for(const r of v.weekly_scores||[])if(r['周期ID'])weekIds.add(r['周期ID']);}
 for(const table of ['personal_task_drafts','personal_coach_messages'])for(const row of rowsByTable.get(table)||[])if(row.week_id)weekIds.add(row.week_id);
 for(const r of rowsByTable.get('weekly_reports')||[]){const c=JSON.parse(r.content_json);if(c['周期ID'])weekIds.add(c['周期ID']);}
 for(const [oldId,newId] of aliases)for(const week of weekIds){keyed.set('personal-'+hash(`${oldId}:${week}`),'personal-'+hash(`${newId}:${week}`));for(let i=0;i<100;i++)keyed.set('p-'+hash(`${oldId}:${week}:${i}`),'p-'+hash(`${newId}:${week}:${i}`));}
 const contentKeys=new Set(['body','comment','description','evidence','summary','coachSummary','results','problems','nextPlan','reflection','reviewNote','reason','text','本周成果摘要','问题摘要','下周计划摘要','思考与复盘摘要']);
 function value(v,key=''){
  if(typeof v==='string'){if(contentKeys.has(key))return v;if(aliases.has(v))return aliases.get(v);if(keyed.has(v))return keyed.get(v);return /(?:user_?ids?|idempotency|target_id|candidate_id)$/i.test(canonicalKey(key))?v.replace(/ou_[a-zA-Z0-9]+/g,id=>aliases.get(id)||id):v;}
  if(Array.isArray(v))return v.map(x=>value(x,key));
  if(v&&typeof v==='object'){
   const next=Object.fromEntries(Object.entries(v).map(([k,x])=>[aliases.get(k)||canonicalKey(k),value(x,k)]));
   if(['employeeInsights','mustReadReports'].includes(key)&&!next.userId&&next.name){const people=(rowsByTable.get('employees')||[]).filter(e=>e.name===next.name);if(people.length===1)next.userId=aliases.get(people[0].open_id)||people[0].open_id;}
   if(next.owner&&!next.ownerUserId){const people=(rowsByTable.get('employees')||[]).filter(e=>e.name===next.owner);if(people.length===1)next.ownerUserId=aliases.get(people[0].open_id)||people[0].open_id;}
   return next;
  }return v;
 }
 for(const table of ['comments','reactions'])for(const r of rowsByTable.get(table)||[])if(String(r.target_id||'').startsWith('personal-')&&!keyed.has(r.target_id))throw Error('unmapped_personal_thread');
 for(const r of rowsByTable.get('personal_task_drafts')||[])if(String(r.id).startsWith('p-')&&!keyed.has(r.id))throw Error('unmapped_personal_task');
 const triggers=run("SELECT name,sql FROM sqlite_master WHERE type='trigger';",true);
 const commands=['PRAGMA foreign_keys=OFF;','BEGIN IMMEDIATE;'];
 for(const trigger of triggers)commands.push(`DROP TRIGGER ${q(trigger.name)};`);
 for(const t of tables)for(const c of columns.get(t)){const next=canonicalKey(c.name);if(next!==c.name)commands.push(`ALTER TABLE ${q(t)} RENAME COLUMN ${q(c.name)} TO ${q(next)};`);}
 let updates=0;
 for(const t of tables)for(const row of rowsByTable.get(t)){const set=[];for(const c of columns.get(t)){
  const old=row[c.name];if(typeof old!=='string')continue;
  let next=old;
  if(c.name==='raw_json'||c.name==='raw_response_json')continue;
  if(c.name.endsWith('_json')){try{next=JSON.stringify(value(JSON.parse(old)));}catch{throw Error('invalid_json:'+t+'.'+c.name);}}
  else if(c.name==='open_id'||c.name.endsWith('_open_id')||['id','target_id','idempotency_key','candidate_id','key'].includes(c.name))next=value(old,c.name);
  if(next!==old)set.push(`${q(canonicalKey(c.name))}=${sql(next)}`);
 }
 if(set.length){updates++;commands.push(`UPDATE ${q(t)} SET ${set.join(',')} WHERE rowid=${Number(row.__migration_rowid__)};`);}}
 commands.push("CREATE TABLE IF NOT EXISTS employee_identities(user_id TEXT PRIMARY KEY,open_id TEXT UNIQUE,union_id TEXT,updated_at TEXT NOT NULL DEFAULT(datetime('now')));");
 for(const m of mapping)commands.push(`INSERT INTO employee_identities(user_id,open_id,union_id) VALUES(${sql(m.userId)},${sql(m.openId)},${sql(m.unionId||'')}) ON CONFLICT(user_id) DO UPDATE SET open_id=excluded.open_id,union_id=excluded.union_id,updated_at=datetime('now');`);
 // Rebuild identity-keyed relationships and immutable monthly results without name keys.
 const currentSchema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
 const employees=rowsByTable.get('employees')||[];
 const resolvePerson=(id,name)=>{
  if(id)return aliases.get(id)||id;
  const matches=employees.filter(e=>e.name===name);
  if(matches.length!==1)throw Error('ambiguous_legacy_employee:'+name);
  return aliases.get(matches[0].open_id)||matches[0].open_id;
 };
 for(const row of rowsByTable.get('scoring360_assignments')||[])commands.push(`UPDATE scoring360_assignments SET evaluee_user_id=${sql(resolvePerson(row.evaluee_open_id,row.evaluee_name))},evaluator_user_id=${sql(resolvePerson(row.evaluator_open_id,row.evaluator_name))} WHERE id=${sql(row.id)};`);
 commands.push("ALTER TABLE performance_results ADD COLUMN employee_user_id TEXT;");
 for(const row of rowsByTable.get('performance_results')||[]){const evidence=value(JSON.parse(row.evidence_json));const id=resolvePerson(evidence.userId,row.employee_name);commands.push(`UPDATE performance_results SET employee_user_id=${sql(id)} WHERE rowid=${Number(row.__migration_rowid__)};`);}
 for(const table of ['scoring360_assignments','performance_results']){
  const start=currentSchema.indexOf('CREATE TABLE IF NOT EXISTS '+table+' (');
  const statement=start<0?'':currentSchema.slice(start,currentSchema.indexOf('\n);',start)+4);
  if(!statement)throw Error('migration_schema_missing:'+table);
  const fresh=table+'_user_id_new';commands.push(statement.replace('IF NOT EXISTS '+table,'IF NOT EXISTS '+fresh));
  const names=columns.get(table).map(c=>canonicalKey(c.name));if(table==='performance_results')names.push('employee_user_id');
  commands.push(`INSERT INTO ${q(fresh)}(${names.map(q).join(',')}) SELECT ${names.map(q).join(',')} FROM ${q(table)}; DROP TABLE ${q(table)}; ALTER TABLE ${q(fresh)} RENAME TO ${q(table)};`);
 }
 // Add tables introduced after the identity migration before their triggers.
 for(const match of currentSchema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\([\s\S]*?\);/g))if(!tables.includes(match[1])&&match[1]!=='employee_identities')commands.push(match[0]);
 // Restore current triggers: publication locks now compare canonical user IDs.
 for(const trigger of triggers)if(!trigger.name.startsWith('scoring360_')&&!trigger.name.startsWith('performance_'))commands.push(canonicalKey(trigger.sql)+';');
 for(const statement of currentSchema.matchAll(/CREATE TRIGGER [\s\S]*?END;/g))commands.push(statement[0]);

 commands.push("CREATE TEMP TABLE migration_fk_guard(ok INTEGER CHECK(ok=1)); INSERT INTO migration_fk_guard SELECT 0 FROM pragma_foreign_key_check; INSERT INTO schema_migrations(version) VALUES('2026-10-26-user-id-primary'); COMMIT; PRAGMA foreign_keys=ON;");
 const transformed=files.map(f=>({...f,next:JSON.stringify(value(JSON.parse(f.text)),null,2)+'\n'}));
 const report={mappedIdentities:mapping.length,tables:tables.length,updatedRows:updates,jsonFiles:files.length,triggerCount:triggers.length};
 if(!apply)return {dryRun:true,...report};
 if(!backupDir)throw Error('backup_directory_required');await mkdir(backupDir,{recursive:true,mode:0o700});
 run(`.backup ${sql(path.join(backupDir,'before.sqlite'))}`);
 for(const f of files)await writeFile(path.join(backupDir,f.name),f.text,{mode:0o600});
 const pending=transformed.map(f=>({target:f.path,temp:f.path+'.user-id-pending-'+randomUUID(),next:f.next}));
 for(const f of pending)await writeFile(f.temp,f.next,{mode:0o600});
 await writeFile(path.join(backupDir,'migration-plan.json'),JSON.stringify({report,pending:pending.map(({target,temp})=>({target,temp}))},null,2),{mode:0o600});
 run(commands.join('\n'));
 for(const f of pending)await rename(f.temp,f.target);
 const integrity=run('PRAGMA integrity_check;').trim();if(integrity!=='ok')throw Error('integrity_check_failed');
 return {applied:true,...report,integrity};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
 try{const result=await migrateUserIds({dbPath:arg('--db',process.env.WEEKLY_REPORT_DB_PATH),dataDir:arg('--data',process.env.APP_DATA_DIR),mapping:JSON.parse(await readFile(arg('--mapping'),'utf8')),backupDir:arg('--backup'),apply:process.argv.includes('--apply')});console.log(JSON.stringify(result));}catch(e){console.error(e.message);process.exitCode=1;}
}
