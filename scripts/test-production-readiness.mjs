import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {evaluateProductionReadiness} from './check-production-readiness.mjs';
const healthy={config:{backupEnabled:true,alertsEnabled:true,recipientUserIds:['fixture-admin'],diskWarningPercent:85},disk:{usedPercent:45,availableBytes:20*1024**3},recipients:[{userId:'fixture-admin'}],backups:[{status:'completed',verification_status:'passed'}]},env={WEEKLY_REMINDER_ENABLED:'true',WEEKLY_UPDATE_REMINDER_ENABLED:'true'};
assert(evaluateProductionReadiness(healthy,env).ready);
for(const [code,change,flags] of [
 ['disk_capacity',{disk:{usedPercent:90.4,availableBytes:4*1024**3}},env],
 ['automatic_backup',{config:{...healthy.config,backupEnabled:false}},env],
 ['external_alerts',{config:{...healthy.config,alertsEnabled:false}},env],
 ['alert_recipient',{recipients:[]},env],
 ['verified_backup',{backups:[{status:'completed',verification_status:'failed'}]},env],
 ['weekly_submission_reminder',{},{}],['weekly_update_reminder',{},{}],
]){const result=evaluateProductionReadiness({...healthy,...change},flags);assert.equal(result.ready,false);assert(result.checks.some(c=>c.code===code&&!c.ready));}
await mkdir('outputs/tests',{recursive:true});const dir=await mkdtemp(path.resolve('outputs/tests/production-readiness-')),db=dir+'/test.sqlite';const run=s=>{const r=spawnSync('sqlite3',['-bail',db],{input:s,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};run(await readFile('db/schema.sql','utf8'));const before=run('SELECT count(*) FROM app_settings;SELECT count(*) FROM backup_runs;SELECT count(*) FROM operations_alerts;');
const checked=spawnSync(process.execPath,['scripts/check-production-readiness.mjs','--require-ready'],{env:{...process.env,WEEKLY_REPORT_DB_PATH:db,APP_DATA_DIR:dir,BACKUP_DIR:dir+'/backups',WEEKLY_REMINDER_ENABLED:'false',WEEKLY_UPDATE_REMINDER_ENABLED:'false'},encoding:'utf8'});assert.equal(checked.status,2,checked.stderr);const result=JSON.parse(checked.stdout);assert.equal(result.ready,false);assert.equal(result.messagesSent,0);assert.equal(result.databaseWrites,0);assert.equal(run('SELECT count(*) FROM app_settings;SELECT count(*) FROM backup_runs;SELECT count(*) FROM operations_alerts;'),before);assert.equal(run('PRAGMA integrity_check;'),'ok');
await writeFile(dir+'/result.json',JSON.stringify({ok:true,capacityBeforeBackupEnable:true,configurationGapsVisible:true,verifiedBackupRequired:true,invalidRecipientRejected:true,readOnlyCli:true,noProductionChanges:true,messagesSent:0,artifacts:dir},null,2));console.log('Production readiness checks passed; artifacts retained: '+dir);
