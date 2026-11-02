import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createOperations} from '../server/operations.mjs';

// Inspect readiness only. No settings, notifications, backups or cloud resources
// are changed by this script, including when a check fails.
export function evaluateProductionReadiness(view,env={}){
 const checks=[],add=(code,ready,message)=>checks.push({code,ready:Boolean(ready),message});
 const c=view.config||{},disk=view.disk||{},recipients=view.recipients||[];
 add('disk_capacity',Number.isFinite(disk.usedPercent)&&disk.usedPercent<(c.diskWarningPercent??85),'磁盘使用率应低于告警阈值；容量不足时先扩容或准备独立备份存储。');
 add('automatic_backup',c.backupEnabled===true,'每天自动备份应开启；发布时手动备份不能替代每日计划。');
 add('external_alerts',c.alertsEnabled===true,'飞书故障通知应开启。');
 add('alert_recipient',Array.isArray(c.recipientUserIds)&&c.recipientUserIds.some(id=>recipients.some(p=>p.userId===id)),'至少配置一位有效的在职告警接收人。');
 add('verified_backup',(view.backups||[]).some(b=>b.status==='completed'&&b.verification_status==='passed'),'至少保留一份已完成并通过恢复校验的备份。');
 add('weekly_submission_reminder',env.WEEKLY_REMINDER_ENABLED==='true','周报提交提醒尚未开启。');
 add('weekly_update_reminder',env.WEEKLY_UPDATE_REMINDER_ENABLED==='true','周报更新提醒尚未开启。');
 return {ready:checks.every(c=>c.ready),checks,disk:{usedPercent:disk.usedPercent,availableGiB:Number.isFinite(disk.availableBytes)?Math.round(disk.availableBytes/1024**3*10)/10:null},databaseWrites:0,messagesSent:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const db=process.env.WEEKLY_REPORT_DB_PATH;if(!db)throw Error('WEEKLY_REPORT_DB_PATH is required');
 const query=async statement=>{const r=spawnSync('sqlite3',['-readonly','-cmd','.timeout 10000','-json',db,statement],{encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error('readiness_query_failed');return JSON.parse(r.stdout||'[]');};
 const operations=createOperations({query,exec:async()=>{throw Error('readiness_must_be_readonly');},sql:()=>{throw Error('readiness_must_be_readonly');},dbPath:db,dataDir:process.env.APP_DATA_DIR||path.dirname(db),uploadDir:process.env.WEEKLY_REPORT_UPLOAD_DIR||'/app/outputs/uploads',backupDir:process.env.BACKUP_DIR||path.join(path.dirname(path.dirname(db)),'backups','automatic'),deliver:async()=>{throw Error('readiness_must_not_send');}});
 const result=evaluateProductionReadiness(await operations.overview(),process.env);console.log(JSON.stringify(result,null,2));if(process.argv.includes('--require-ready')&&!result.ready)process.exitCode=2;
}
