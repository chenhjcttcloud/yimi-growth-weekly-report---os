import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {preparePeerCommentPolicyUpgrade} from './prepare-peer-comment-policy-upgrade.mjs';

await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/peer-comment-upgrade-preparation-'));
const current=await readFile('db/schema.sql','utf8');
const baseline=spawnSync('git',['show','HEAD:db/schema.sql'],{encoding:'utf8',maxBuffer:2*1024*1024});
assert.equal(baseline.status,0,baseline.stderr);
const names=['performance_collaboration_complete','weighted_result_validation','person_weighted_result_validation'];
const oldPredicate="(r.id IS NULL OR trim(COALESCE(r.comment,''))='')";
const newPredicate='(r.id IS NULL OR r.score IS NULL OR r.score<0 OR r.score>100)';
const extract=(schema,name)=>{
 const definition=schema.match(new RegExp('^CREATE TRIGGER IF NOT EXISTS '+name+'\\b[\\s\\S]*?\\bEND;','m'))?.[0];
 assert(definition,'Missing test fixture trigger '+name);return definition;
};
// Build the legacy fixture from the repository baseline, including after this
// change is committed, without altering any existing database or trigger.
let legacy=baseline.stdout;
for(const name of names){const definition=extract(legacy,name);legacy=legacy.replace(definition,definition.replace(newPredicate,oldPredicate));}
const initialize=(name,schema)=>{
 const db=path.join(dir,name+'.sqlite');
 const result=spawnSync('sqlite3',['-bail',db],{input:schema,encoding:'utf8',maxBuffer:2*1024*1024});
 assert.equal(result.status,0,result.stderr);return db;
};
const schemaSnapshot=db=>{
 const result=spawnSync('sqlite3',['-readonly','-bail','-json',db,"SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name;"],{encoding:'utf8',maxBuffer:2*1024*1024});
 assert.equal(result.status,0,result.stderr);return result.stdout;
};
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const db=initialize('legacy',legacy),beforeSchema=schemaSnapshot(db),beforeHash=await digest(db),out=path.join(dir,'legacy-review.json');
assert.deepEqual(await preparePeerCommentPolicyUpgrade({dbPath:db,outputPath:out}),{output:out,readOnly:true,databaseWrites:0,requiresReplacement:3,alreadyCurrent:0});
const plan=JSON.parse(await readFile(out,'utf8'));
assert.equal(plan.appliesChanges,false);assert.equal(plan.requiresExplicitAuthorization,true);
assert.equal(plan.entries.length,3);
for(const entry of plan.entries){
 assert.equal(entry.status,'requires_replacement');
 assert(entry.beforeSql.includes(oldPredicate));assert(entry.afterSql.includes(newPredicate));
 assert.equal(entry.afterSql.replace(newPredicate,oldPredicate).replace(' IF NOT EXISTS','').replace(/;$/,''),entry.beforeSql);
}
assert.equal(schemaSnapshot(db),beforeSchema,'Preparation must not change installed schema');
assert.equal(await digest(db),beforeHash,'Preparation must not change database bytes');
assert.equal((await stat(out)).mode&0o777,0o600);
const retained=await readFile(out,'utf8');
await assert.rejects(preparePeerCommentPolicyUpgrade({dbPath:db,outputPath:out}),{code:'EEXIST'});
assert.equal(await readFile(out,'utf8'),retained,'Existing review artifacts must remain intact');

const upgraded=initialize('current',current),upgradedOut=path.join(dir,'current-review.json');
assert.equal((await preparePeerCommentPolicyUpgrade({dbPath:upgraded,outputPath:upgradedOut})).requiresReplacement,0);
assert.equal(JSON.parse(await readFile(upgradedOut,'utf8')).requiresExplicitAuthorization,false);

const changed=legacy.replace(extract(legacy,names[0]),extract(legacy,names[0]).replace('ROUND(AVG(r.score),1)','ROUND(SUM(r.score),1)'));
assert.notEqual(changed,legacy);
const drifted=initialize('drifted',changed),driftOutput=path.join(dir,'drifted-review.json');
await assert.rejects(preparePeerCommentPolicyUpgrade({dbPath:drifted,outputPath:driftOutput}),/Unrecognized trigger definition/);
await assert.rejects(stat(driftOutput),{code:'ENOENT'});
const absent=path.join(dir,'absent.sqlite');
await assert.rejects(preparePeerCommentPolicyUpgrade({dbPath:absent,outputPath:path.join(dir,'absent-review.json')}),{code:'ENOENT'});
await assert.rejects(stat(absent),{code:'ENOENT'});
assert.equal(schemaSnapshot(db),beforeSchema);
assert.equal(await digest(db),beforeHash);
console.log('Passed: legacy/current trigger recognition, exact three-rule review, read-only database/schema preservation, drift rejection, missing database protection and exclusive private output.');
console.log('Artifacts retained:',dir);
