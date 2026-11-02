import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import {createOperations} from '../server/operations.mjs';

// Exercise the actual server SQL contract: an empty value is encoded as NULL.
// Keep every fixture and log; no external services or live databases are used.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/operations-runtime-alerts-')),db=dir+'/test.sqlite';
const source=await readFile('server/index.mjs','utf8'),begin=source.indexOf('function sqlValue('),end=source.indexOf('\nasync function readJsonBody',begin);
assert(begin>=0&&end>begin);const sql=vm.runInNewContext(source.slice(begin,end)+';sqlValue');assert.equal(sql(''),'NULL');
function run(statement,json=false){const result=spawnSync('sqlite3',['-bail',...(json?['-json']:[]),db],{input:statement,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return json?JSON.parse(result.stdout||'[]'):result.stdout.trim();}
const query=async statement=>run(statement,true),exec=async statement=>run(statement);
run(await readFile('db/schema.sql','utf8'));
run("INSERT INTO employees(user_id,name,is_active) VALUES('receiver','测试接收人',1),('stopped','已停用接收人',0);");
let time=new Date('2026-10-30T02:00:00Z'),issues=[{key:'report_sync_failure',message:'测试周报同步异常'}],deliveries=0,deliveryMode='fail';
const ops=createOperations({query,exec,sql,dbPath:db,dataDir:dir+'/data',uploadDir:dir+'/uploads',backupDir:dir+'/backups',now:()=>time,diskUsage:async()=>({usedPercent:90.4,availableBytes:4*1024**3}),monitor:async()=>issues.map(issue=>({...issue})),deliver:async()=>{deliveries++;if(deliveryMode==='fail')throw Error('fixture temporary failure');if(deliveryMode==='reject')throw Object.assign(Error('fixture rejected'),{retryable:false});return 'fixture-message';}});
const first=await ops.check();assert.equal(first.issues,2);
let rows=run('SELECT id,issue_key,recipient_user_id,status,attempts,message FROM operations_alerts ORDER BY issue_key;',true);
assert.equal(rows.length,2,'disabled outbound notifications still record disk and service issues');
assert(rows.every(row=>row.recipient_user_id===''&&row.status==='recorded'&&row.attempts===0));assert.equal(deliveries,0);
const originalRecorded=rows;await ops.check();assert.deepEqual(run('SELECT id,issue_key,recipient_user_id,status,attempts,message FROM operations_alerts ORDER BY issue_key;',true),originalRecorded,'same-day internal issues deduplicate without replacing history');
let overview=await ops.overview();assert.equal(overview.readiness.capacityWarning,true);assert.equal(overview.readiness.automaticBackupEnabled,false);assert.equal(overview.readiness.externalAlertsEnabled,false);assert.equal(overview.readiness.hasAlertRecipient,false);assert.equal(overview.readiness.latestBackupRestoreVerified,false);
assert(overview.readiness.issues.some(issue=>issue.code==='disk_capacity'));assert(overview.readiness.issues.some(issue=>issue.code==='backup_disabled'));assert(overview.readiness.issues.some(issue=>issue.code==='alerts_disabled'));
issues=[];await ops.check();assert.equal(run("SELECT count(*) AS n FROM operations_alerts WHERE issue_key='report_sync_failure' AND status='recorded';",true)[0].n,1,'resolved internal issue remains available as history');
const value={backupEnabled:false,backupTime:'03:00',alertsEnabled:true,recipientUserIds:['receiver'],diskWarningPercent:85};
await assert.rejects(ops.save({...value,recipientUserIds:[]}),/alert_recipient_required/);await assert.rejects(ops.save({...value,recipientUserIds:['stopped']}),/active_recipient_required/);
await ops.save(value);await ops.check();assert.equal(deliveries,1);assert.equal(run("SELECT status FROM operations_alerts WHERE issue_key='disk_capacity' AND recipient_user_id='receiver';",true)[0].status,'failed');
await ops.check();assert.equal(deliveries,1,'same-minute repeated check does not retry');
deliveryMode='success';time=new Date(time.getTime()+5*60000);await ops.check();assert.equal(deliveries,2);await ops.check();assert.equal(deliveries,2);
const sent=run("SELECT * FROM operations_alerts WHERE issue_key='disk_capacity' AND recipient_user_id='receiver';",true)[0];assert.equal(sent.status,'sent');assert.equal(sent.attempts,2);assert.equal(run('SELECT count(*) AS n FROM operations_alert_attempts WHERE alert_id='+sql(sent.id)+';',true)[0].n,2);
assert.equal(run("SELECT count(*) AS n FROM operations_alerts WHERE recipient_user_id='' AND status='recorded';",true)[0].n,2,'enabling delivery does not overwrite internal history');
deliveryMode='reject';issues=[{key:'rejected_provider',message:'测试明确拒绝'}];await ops.check();assert.equal(deliveries,3);const rejected=run("SELECT status,last_error,next_attempt_at FROM operations_alerts WHERE issue_key='rejected_provider';",true)[0];assert.equal(rejected.status,'failed');assert.equal(rejected.last_error,'delivery_rejected');assert.equal(rejected.next_attempt_at,null);
await ops.save({...value,alertsEnabled:false});issues=[{key:'after_disabled',message:'关闭外发后仍记录'}];await ops.check();assert.equal(deliveries,3);assert.equal(run("SELECT status FROM operations_alerts WHERE issue_key='after_disabled' AND recipient_user_id='';",true)[0].status,'recorded');
run("INSERT INTO backup_runs(id,kind,directory,status,started_at,verification_status) VALUES('verified','manual','fixture-backup','completed','2026-10-30T02:05:00Z','passed');");overview=await ops.overview();assert.equal(overview.readiness.latestBackupRestoreVerified,true);assert(overview.readiness.issues.some(issue=>issue.code==='backup_disabled'));
// A real storage error must be reported instead of being treated as a recorded alert.
run("CREATE TRIGGER fixture_alert_storage_failure BEFORE INSERT ON operations_alerts WHEN NEW.issue_key='fixture_storage_failure' BEGIN SELECT RAISE(ABORT,'fixture_alert_storage_failure'); END;");
issues=[{key:'fixture_storage_failure',message:'模拟写入失败'}];await assert.rejects(ops.check(),/fixture_alert_storage_failure/);issues=[];assert.equal((await ops.check()).issues,1,'the running guard is released after a storage error');
assert.equal(run('PRAGMA integrity_check;'),'ok');
const result={ok:true,actualRuntimeSqlAdapter:true,disabledDeliveryRecordsIssues:true,internalDedupPreservesHistory:true,enabledDeliveryAndRetry:true,rejectedProviderNoRetry:true,disableStopsExternalDelivery:true,readinessShowsDisabledAndVerifiedStates:true,storageFailureSurfaced:true,guardRecoversAfterFailure:true,realMessagesSent:0,productionTouched:false,artifacts:dir};await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
