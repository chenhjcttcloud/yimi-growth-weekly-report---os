import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readdir,lstat,copyFile,readFile,writeFile,statfs,chmod} from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const immutable=file=>pathToFileURL(file).href+'?immutable=1';
const run=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
async function fileHash(file){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');}
const defaults={backupEnabled:false,backupTime:'03:00',alertsEnabled:false,recipientUserIds:[],diskWarningPercent:85};

export async function ensureOperationsSchema({query,exec}){
 const columns=await query('PRAGMA table_info(operations_alerts);');
 for(const [name,type] of [['attempts','INTEGER NOT NULL DEFAULT 0'],['first_attempt_at','TEXT'],['last_attempt_at','TEXT'],['next_attempt_at','TEXT'],['claim_token','TEXT'],['last_error','TEXT']])if(!columns.some(c=>c.name===name))await exec(`ALTER TABLE operations_alerts ADD COLUMN ${name} ${type};`);
 // Retain pre-upgrade failures and give only recent failures a bounded retry window.
 await exec("UPDATE operations_alerts SET attempts=1,first_attempt_at=created_at,last_attempt_at=created_at,next_attempt_at=datetime(created_at,'+5 minutes'),last_error='delivery_failed' WHERE status='failed' AND first_attempt_at IS NULL;");
}

// Snapshots and verification restores are append-only. Never rotate or remove files.
export function createOperations({query,exec,sql,dbPath,dataDir,uploadDir,backupDir,deliver,monitor=async()=>[],now=()=>new Date(),diskUsage}){
 let busy=false,ticking=false,checking=false;
 const root=path.resolve(backupDir),clock=()=>{const d=now().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'});return {date:d.slice(0,10),time:d.slice(11,16)};};
 async function config(){const r=(await query("SELECT value_json FROM app_settings WHERE key='operations_config';"))[0];return {...defaults,...r?JSON.parse(r.value_json):{}};}
 async function initialize(){
  const stamp=now().toISOString(),cutoff=new Date(now().getTime()-40*60000).toISOString();
  await exec(`UPDATE backup_runs SET status='failed',error='interrupted_on_restart',finished_at=datetime('now') WHERE status='running';
UPDATE operations_alerts SET status=CASE WHEN julianday(first_attempt_at)>=julianday('${cutoff}') AND attempts<3 THEN 'failed' ELSE 'uncertain' END,next_attempt_at=datetime('${stamp}','+5 minutes'),last_error='interrupted_on_restart' WHERE status='pending';
UPDATE operations_alert_attempts SET status='uncertain',finished_at='${stamp}',error='interrupted_on_restart' WHERE status='pending';`);
 }
 async function save(body){
  if(typeof body.backupEnabled!=='boolean'||typeof body.alertsEnabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.backupTime||'')||!Number.isInteger(body.diskWarningPercent)||body.diskWarningPercent<50||body.diskWarningPercent>99||!Array.isArray(body.recipientUserIds)||body.recipientUserIds.length>10||body.recipientUserIds.some(id=>typeof id!=='string'))throw Error('invalid_operations_config');
  const ids=[...new Set(body.recipientUserIds)],people=await query('SELECT user_id FROM employees WHERE is_active=1;');
  if(ids.some(id=>!people.some(p=>p.user_id===id)))throw Error('active_recipient_required');
  if(body.alertsEnabled&&!ids.length)throw Error('alert_recipient_required');
  const value={backupEnabled:body.backupEnabled,backupTime:body.backupTime,alertsEnabled:body.alertsEnabled,recipientUserIds:ids,diskWarningPercent:body.diskWarningPercent};
  await exec(`INSERT INTO app_settings(key,value_json) VALUES('operations_config',${sql(JSON.stringify(value))}) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=datetime('now');`);return value;
 }
 async function disk(){if(diskUsage)return diskUsage();const value=await statfs(path.dirname(dbPath));return {usedPercent:Math.round((value.blocks-value.bavail)/value.blocks*1000)/10,availableBytes:value.bavail*value.bsize};}
 async function filesUnder(directory){
  const results=[];
  async function walk(dir,prefix=''){let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
   for(const entry of entries){const relative=path.join(prefix,entry.name),absolute=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('backup_symlink_requires_review');if(entry.isDirectory())await walk(absolute,relative);else if(entry.isFile())results.push({relative,absolute});}
  }await walk(directory);return results;
 }
 async function backup(kind='manual'){
  if(busy)throw Error('backup_running');busy=true;const id=randomUUID(),directory=path.join(root,'snapshots',now().toISOString().replace(/[:.]/g,'-')+'-'+id),stamp=now().toISOString();
  try{
   await exec(`INSERT INTO backup_runs(id,kind,directory,status,started_at) VALUES(${sql(id)},${sql(kind)},${sql(directory)},'running',${sql(stamp)});`);
   await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
   const db=path.join(directory,'growth.sqlite');
   await run('sqlite3',['-cmd','.timeout 10000',dbPath,`.backup '${db.replaceAll("'","''")}'`],{timeout:120000});await chmod(db,0o600);
   const entries=[{file:'growth.sqlite',sha256:await fileHash(db)}];
   for(const [label,source] of [['data',dataDir],['uploads',uploadDir]]){
    const resolved=path.resolve(source);if(root===resolved||root.startsWith(resolved+path.sep))throw Error('backup_path_overlaps_source');
    for(const entry of await filesUnder(resolved)){
     // The SQLite online snapshot above is authoritative; WAL/SHM are not standalone backups.
     if(entry.absolute===path.resolve(dbPath)||entry.absolute===path.resolve(dbPath)+'-wal'||entry.absolute===path.resolve(dbPath)+'-shm')continue;
     const dest=path.join(directory,label,entry.relative);await mkdir(path.dirname(dest),{recursive:true,mode:0o700});await copyFile(entry.absolute,dest,constants.COPYFILE_EXCL);await chmod(dest,0o600);entries.push({file:path.join(label,entry.relative),sha256:await fileHash(dest)});
    }
   }
   const check=await run('sqlite3',['-readonly',immutable(db),'PRAGMA integrity_check;'],{timeout:120000});if(check.stdout.trim()!=='ok')throw Error('backup_integrity_failed');
   const manifest=JSON.stringify({version:1,id,createdAt:stamp,files:entries},null,2);await writeFile(path.join(directory,'manifest.json'),manifest,{flag:'wx',mode:0o600});
   await exec(`UPDATE backup_runs SET status='completed',finished_at=${sql(now().toISOString())},manifest_hash=${sql(hash(manifest))},file_count=${entries.length} WHERE id=${sql(id)};`);
   return {id,status:'completed',fileCount:entries.length};
  }catch(e){await exec(`UPDATE backup_runs SET status='failed',finished_at=${sql(now().toISOString())},error='backup_failed' WHERE id=${sql(id)};`);throw Error(e.message==='backup_path_overlaps_source'?e.message:'backup_failed',{cause:e});}finally{busy=false;}
 }
 async function verify(id){
  if(busy)throw Error('backup_running');busy=true;
  try{
   const row=(await query(`SELECT * FROM backup_runs WHERE id=${sql(id)} AND status='completed';`))[0];if(!row)throw Error('backup_not_found');
   if(!path.resolve(row.directory).startsWith(path.join(root,'snapshots')+path.sep))throw Error('invalid_backup_path');
   const raw=await readFile(path.join(row.directory,'manifest.json'));if(hash(raw)!==row.manifest_hash)throw Error('backup_integrity_failed');
   const manifest=JSON.parse(raw.toString());if(manifest.id!==id||!manifest.files.some(e=>e.file==='growth.sqlite'))throw Error('backup_integrity_failed');
   const destination=path.join(root,'restore-checks',id+'-'+randomUUID());await mkdir(destination,{recursive:true,mode:0o700});
   for(const entry of manifest.files){
    if(typeof entry.file!=='string'||path.isAbsolute(entry.file)||entry.file.split(/[\\/]/).includes('..'))throw Error('backup_integrity_failed');
    const source=path.join(row.directory,entry.file);if((await lstat(source)).isSymbolicLink())throw Error('backup_integrity_failed');
    if(await fileHash(source)!==entry.sha256)throw Error('backup_integrity_failed');if(entry.file.startsWith('data/')&&entry.file.endsWith('.json'))JSON.parse(await readFile(source,'utf8'));
    const target=path.join(destination,entry.file);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await copyFile(source,target,constants.COPYFILE_EXCL);await chmod(target,0o600);
   }
   const check=await run('sqlite3',['-readonly',immutable(path.join(destination,'growth.sqlite')),"PRAGMA integrity_check; SELECT count(*) FROM employees; SELECT count(*) FROM app_settings;"],{timeout:120000});if(check.stdout.trim().split('\n')[0]!=='ok')throw Error('backup_integrity_failed');
   await exec(`UPDATE backup_runs SET verified_at=${sql(now().toISOString())},verification_status='passed' WHERE id=${sql(id)};`);return {id,status:'passed',files:manifest.files.length,restoreDirectory:destination};
  }catch(e){if(id)await exec(`UPDATE backup_runs SET verification_status='failed' WHERE id=${sql(id)} AND status='completed';`);throw Error(e.message==='backup_not_found'?e.message:'backup_integrity_failed');}finally{busy=false;}
 }
 async function overview(){return {config:await config(),backupDirectory:root,busy,disk:await disk(),backups:await query('SELECT id,kind,status,started_at,finished_at,file_count,error,verified_at,verification_status FROM backup_runs ORDER BY started_at DESC,rowid DESC LIMIT 30;'),alerts:await query('SELECT id,issue_key,message,status,created_at,attempts,next_attempt_at,last_error FROM operations_alerts ORDER BY created_at DESC,rowid DESC LIMIT 50;'),recipients:(await query('SELECT user_id,name,department FROM employees WHERE is_active=1 ORDER BY name;')).map(r=>({userId:r.user_id,name:r.name,department:r.department||''}))};}
 async function check(){
  if(checking)return {issues:0,skipped:'running'};checking=true;
  try{
  const c=await config(),usage=await disk(),issues=await monitor();
  if(usage.usedPercent>=c.diskWarningPercent)issues.push({key:'disk_capacity',message:`服务器磁盘已使用 ${usage.usedPercent}%，请检查容量；系统不会自动删除数据或备份。`});
  const latest=(await query('SELECT status,started_at FROM backup_runs ORDER BY started_at DESC,rowid DESC LIMIT 1;'))[0];
  if(c.backupEnabled&&(!latest||now()-new Date(latest.started_at)>36*3600000||latest.status==='failed'))issues.push({key:'backup_unhealthy',message:'自动备份尚未成功、已超过36小时或最近一次失败，请检查服务器备份目录。'});
  const day=clock().date;
  const stamp=now().toISOString(),cutoff=new Date(now().getTime()-40*60000).toISOString();
  await exec(`UPDATE operations_alerts SET status='uncertain',next_attempt_at=NULL,last_error='retry_window_expired' WHERE (status='failed' AND next_attempt_at IS NOT NULL OR status='pending') AND julianday(first_attempt_at)<julianday(${sql(cutoff)});`);
  const activeIssues=issues.map(i=>sql(i.key)).join(',')||"''";
  await exec(`UPDATE operations_alerts SET status='cancelled',next_attempt_at=NULL WHERE alert_date=${sql(day)} AND status IN ('ready','failed') AND issue_key NOT IN (${activeIssues});`);
  for(const issue of issues){
   const message=String(issue.message).slice(0,1000),recipients=c.alertsEnabled?c.recipientUserIds:[''];
   for(const recipient of recipients){
    const inserted=randomUUID(),claim=randomUUID();await exec(`INSERT OR IGNORE INTO operations_alerts(id,issue_key,alert_date,recipient_user_id,message,status) VALUES(${sql(inserted)},${sql(issue.key)},${sql(day)},${sql(recipient)},${sql(message)},${sql(recipient?'ready':'recorded')});`);
    if(!recipient)continue;
    await exec(`UPDATE operations_alerts SET status='pending',claim_token=${sql(claim)},attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,${sql(stamp)}),last_attempt_at=${sql(stamp)},next_attempt_at=NULL WHERE issue_key=${sql(issue.key)} AND alert_date=${sql(day)} AND recipient_user_id=${sql(recipient)} AND attempts<3 AND (status='ready' OR status='failed' AND next_attempt_at IS NOT NULL AND julianday(next_attempt_at)<=julianday(${sql(stamp)}) AND julianday(first_attempt_at)>=julianday(${sql(cutoff)}));`);
    const owned=`claim_token=${sql(claim)} AND status='pending'`,row=(await query(`SELECT id,attempts FROM operations_alerts WHERE ${owned};`))[0];if(!row)continue;
    const attempt=randomUUID();await exec(`INSERT INTO operations_alert_attempts(id,alert_id,attempt_no,status,started_at) VALUES(${sql(attempt)},${sql(row.id)},${Number(row.attempts)},'pending',${sql(stamp)});`);
    let delivered=false;
    try{
     const fresh=await config(),active=(await query(`SELECT is_active FROM employees WHERE user_id=${sql(recipient)};`))[0];
     if(!fresh.alertsEnabled||!fresh.recipientUserIds.includes(recipient)||Number(active?.is_active)!==1){await exec(`UPDATE operations_alerts SET status='cancelled' WHERE ${owned}; UPDATE operations_alert_attempts SET status='cancelled',finished_at=${sql(now().toISOString())} WHERE id=${sql(attempt)};`);continue;}
     const mid=await deliver(recipient,'【成长OS运行告警】\n'+message,row.id);if(!mid)throw Error();delivered=true;
     await exec(`BEGIN IMMEDIATE; UPDATE operations_alerts SET status='sent',message_id=${sql(mid)},last_error=NULL WHERE ${owned}; UPDATE operations_alert_attempts SET status='sent',finished_at=${sql(now().toISOString())},message_id=${sql(mid)} WHERE id=${sql(attempt)}; COMMIT;`);
    }catch(error){
     const uncertain=delivered,canRetry=!uncertain&&error.retryable!==false&&Number(row.attempts)<3,next=canRetry?new Date(now().getTime()+(Number(row.attempts)===1?5:15)*60000).toISOString():null,status=uncertain?'uncertain':'failed',reason=uncertain?'delivery_status_unknown':error.retryable===false?'delivery_rejected':'delivery_failed';
     await exec(`BEGIN IMMEDIATE; UPDATE operations_alerts SET status=${sql(status)},next_attempt_at=${sql(next)},last_error=${sql(reason)} WHERE ${owned}; UPDATE operations_alert_attempts SET status=${sql(status)},finished_at=${sql(now().toISOString())},error=${sql(reason)} WHERE id=${sql(attempt)}; COMMIT;`);
    }
   }
  }return {issues:issues.length};
  }finally{checking=false;}
 }
 async function tick(){if(ticking)return;ticking=true;try{const c=await config(),t=clock();if(c.backupEnabled&&!busy&&t.time>=c.backupTime){const existing=await query(`SELECT id FROM backup_runs WHERE kind='scheduled' AND schedule_date=${sql(t.date)};`);if(!existing.length){const claim=randomUUID();await exec(`INSERT OR IGNORE INTO backup_schedule_claims(date,id) VALUES(${sql(t.date)},${sql(claim)});`);if((await query(`SELECT id FROM backup_schedule_claims WHERE date=${sql(t.date)};`))[0]?.id===claim){try{const result=await backup('scheduled');await exec(`UPDATE backup_runs SET schedule_date=${sql(t.date)} WHERE id=${sql(result.id)};`);}catch{/* Failure remains visible and alerts below record it; no duplicate same-day jobs. */}}}}await check();}finally{ticking=false;}}
 return {initialize,config,save,backup,verify,overview,check,tick};
}
