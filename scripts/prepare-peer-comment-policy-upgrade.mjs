import {createHash} from 'node:crypto';
import {readFile,realpath,stat,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Preparation only: inspect installed rules and write a review artifact. This
// command never changes a database or executes the proposed trigger definitions.
const schemaPath=fileURLToPath(new URL('../db/schema.sql',import.meta.url));
const triggers=[
 ['performance_collaboration_complete','performance_results'],
 ['weighted_result_validation','monthly_weighted_results'],
 ['person_weighted_result_validation','monthly_person_weighted_results'],
];
const oldPredicate="(r.id IS NULL OR trim(COALESCE(r.comment,''))='')";
const newPredicate='(r.id IS NULL OR r.score IS NULL OR r.score<0 OR r.score>100)';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const canonical=sql=>sql.replace(/^CREATE TRIGGER IF NOT EXISTS\b/,'CREATE TRIGGER')
 .replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\s+/g,token=>/^\s+$/.test(token)?' ':token).trim().replace(/;$/,'');

export async function preparePeerCommentPolicyUpgrade({dbPath,outputPath}){
 if(typeof dbPath!=='string'||!dbPath||typeof outputPath!=='string'||!outputPath)throw Error('Both --db and --out are required');
 const database=await realpath(path.resolve(dbPath));
 if(!(await stat(database)).isFile())throw Error('The database must be an existing file');
 const output=path.resolve(outputPath);
 if(output===database)throw Error('The review artifact must be separate from the database');
 const schema=await readFile(schemaPath,'utf8');
 const definitions=triggers.map(([name,table])=>{
  const afterSql=schema.match(new RegExp('^CREATE TRIGGER IF NOT EXISTS '+name+'\\b[\\s\\S]*?\\bEND;','m'))?.[0];
  if(!afterSql||afterSql.split(newPredicate).length!==2||afterSql.includes(oldPredicate))throw Error('Unexpected target trigger definition: '+name);
  return {name,table,afterSql,oldSql:afterSql.replace(newPredicate,oldPredicate)};
 });
 const query="PRAGMA query_only=ON; SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' AND name IN ("+triggers.map(([name])=>"'"+name+"'").join(',')+") ORDER BY name;";
 const result=spawnSync('sqlite3',['-readonly','-bail','-cmd','.timeout 10000','-json',database,query],{encoding:'utf8',maxBuffer:1024*1024});
 if(result.error||result.status!==0)throw Error('Read-only trigger inspection failed');
 let installed;try{installed=JSON.parse(result.stdout||'[]');}catch{throw Error('Invalid read-only inspection response');}
 const entries=definitions.map(({name,table,afterSql,oldSql})=>{
  const before=installed.find(row=>row.name===name);
  if(!before||before.tbl_name!==table||typeof before.sql!=='string')throw Error('Required trigger missing or attached to a different table: '+name);
  const actual=canonical(before.sql),target=canonical(afterSql),legacy=canonical(oldSql);
  if(actual!==target&&actual!==legacy)throw Error('Unrecognized trigger definition; review schema drift first: '+name);
  return {name,table,status:actual===target?'already_current':'requires_replacement',beforeSql:before.sql,afterSql,beforeSha256:sha256(before.sql),afterSha256:sha256(afterSql)};
 });
 const plan={version:1,kind:'peer-comment-optional-review',preparedAt:new Date().toISOString(),database,schemaSource:schemaPath,schemaSha256:sha256(schema),readOnly:true,databaseWrites:0,appliesChanges:false,requiresExplicitAuthorization:entries.some(entry=>entry.status==='requires_replacement'),instructions:'Review these three scoring-rule definitions. This artifact performs no migration. Existing rules requiring replacement must be handled separately after explicit authorization under AGENTS.md.',entries};
 await writeFile(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
 return {output,readOnly:true,databaseWrites:0,requiresReplacement:entries.filter(entry=>entry.status==='requires_replacement').length,alreadyCurrent:entries.filter(entry=>entry.status==='already_current').length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--help')console.log('Usage: node scripts/prepare-peer-comment-policy-upgrade.mjs --db EXISTING.sqlite --out NEW-review.json\nRead-only preparation. No database changes are applied; existing output files are never overwritten.');
 else{
  try{
   if(args.length!==4||new Set([args[0],args[2]]).size!==2||![args[0],args[2]].every(arg=>['--db','--out'].includes(arg)))throw Error('Usage: --db EXISTING.sqlite --out NEW-review.json');
   const options=Object.fromEntries([[args[0],args[1]],[args[2],args[3]]]);
   console.log(JSON.stringify(await preparePeerCommentPolicyUpgrade({dbPath:options['--db'],outputPath:options['--out']}),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
 }
}
