import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rename,stat,utimes} from 'node:fs/promises';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import path from 'node:path';
import {createSourceDataCache,createSourceResponseCache} from '../server/source-data-cache.mjs';

// Every file below is an isolated fixture retained in outputs. No production
// requests, real data, file deletion or provider access are part of this suite.
await mkdir('outputs/tests',{recursive:true});
const dir=await mkdtemp(path.resolve('outputs/tests/source-data-cache-')),data=dir+'/data';
await mkdir(data);
const names=['prototypeData','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights','scoring360'];
const fixture={label:'测试周报 🪴',status:'phase-A',rows:[{user_id:'fixture-staff',value:0,notes:'完成 3 项验收。'}]};
for(const name of names)await writeFile(data+'/'+name+'.json',JSON.stringify({...fixture,label:name}));
const sourcePath=data+'/prototypeData.json',source=JSON.parse(await readFile(sourcePath,'utf8'));
const reader=createSourceDataCache({directory:data});
const first=reader.read('prototypeData'),afterFirst=reader.inspect();
assert.deepEqual(first,source);assert.equal(afterFirst.reads,1);assert.equal(afterFirst.parses,1);
first.rows[0].notes='caller-only mutation';first.rows.push({value:900});
const second=reader.read('prototypeData');assert.deepEqual(second,source);assert.notEqual(first,second);assert.equal(reader.inspect().reads,1);
const frozen=reader.snapshot(['prototypeData']);assert(Object.isFrozen(frozen));assert(Object.isFrozen(frozen.data));assert(Object.isFrozen(frozen.data.prototypeData.rows[0]));
assert.throws(()=>{frozen.data.prototypeData.rows[0].value=5;},TypeError);
assert.equal(reader.snapshot(['prototypeData']).versionKey,frozen.versionKey);
assert.throws(()=>reader.read('../private'),{code:'source_name_not_allowed'});assert.throws(()=>reader.read('notConfigured'),{code:'source_name_not_allowed'});
assert.throws(()=>createSourceDataCache({directory:data,names:['unknown']}),/source_name_not_allowed/);

// Keep prior fixtures as separate files when simulating a producer update.
await writeFile(dir+'/prototype-initial.json',JSON.stringify(source));
const sameSize={...source,status:'phase-B'};assert.equal(Buffer.byteLength(JSON.stringify(sameSize)),Buffer.byteLength(JSON.stringify(source)));
await writeFile(sourcePath,JSON.stringify(sameSize));assert.deepEqual(reader.read('prototypeData'),sameSize);assert.notEqual(reader.snapshot(['prototypeData']).versionKey,frozen.versionKey);
const beforeRename=await stat(sourcePath,{bigint:true}),replacement=data+'/prototype-staged.json',renamed={...source,status:'phase-C'};
await writeFile(replacement,JSON.stringify(renamed));
await utimes(replacement,Number(beforeRename.atimeNs)/1e9,Number(beforeRename.mtimeNs)/1e9);
await rename(sourcePath,dir+'/prototype-before-replacement.json');await rename(replacement,sourcePath);
assert.notEqual((await stat(sourcePath,{bigint:true})).ino,beforeRename.ino);assert.deepEqual(reader.read('prototypeData'),renamed);
await writeFile(dir+'/prototype-before-invalid.json',JSON.stringify(renamed));await writeFile(sourcePath,'{"invalid":');
assert.throws(()=>reader.read('prototypeData'),{code:'source_json_invalid'});
assert.throws(()=>reader.snapshot(['prototypeData']),{code:'source_json_invalid'});
const repaired={...renamed,status:'phase-D'};await writeFile(sourcePath,JSON.stringify(repaired));assert.deepEqual(reader.read('prototypeData'),repaired);

// Deterministic metadata probes avoid relying on filesystem millisecond
// timing. Real file read/rename/repair behavior is exercised above.
function memoryFiles(){
  const files=new Map(),calls={read:0,stat:0};let onRead=null,onStat=null;
  for(const [index,name] of names.entries())files.set(path.join(data,name+'.json'),{text:JSON.stringify({value:'old-'+name}),dev:1n,ino:BigInt(index+1),mtimeNs:1000000001n,ctimeNs:1000000001n});
  function metadata(file){return {dev:file.dev,ino:file.ino,size:BigInt(Buffer.byteLength(file.text)),mtimeNs:file.mtimeNs,ctimeNs:file.ctimeNs,mtimeMs:Number(file.mtimeNs)/1e6,ctimeMs:Number(file.ctimeNs)/1e6,isFile:()=>true};}
  return {files,calls,set onRead(fn){onRead=fn;},set onStat(fn){onStat=fn;},statFile:(filename,options)=>{calls.stat++;assert.equal(options.bigint,true);if(onStat)onStat(filename);const file=files.get(filename);if(!file)throw Object.assign(Error('fixture absent'),{code:'ENOENT'});if(file.statDenied)throw Object.assign(Error('fixture permission'),{code:'EACCES'});return metadata(file);},readFile:(filename,encoding)=>{calls.read++;assert.equal(encoding,'utf8');const file=files.get(filename);if(file.readDenied)throw Object.assign(Error('fixture permission'),{code:'EACCES'});const text=file.text;if(onRead)onRead(filename);return text;}};
}
const memory=memoryFiles(),nano=createSourceDataCache({directory:data,names:['prototypeData'],readFile:memory.readFile,statFile:memory.statFile});
const oldNano=nano.snapshot(['prototypeData']),nanoFile=memory.files.get(sourcePath),oldMtime=nanoFile.mtimeNs;
nanoFile.text=JSON.stringify({value:'new-prototypeData'});nanoFile.ctimeNs+=1n;
assert.equal(nanoFile.mtimeNs,oldMtime);assert.equal(Number(nanoFile.ctimeNs/1000000n),Number(oldMtime/1000000n),'both ctimes share the same millisecond');
assert.equal(nano.read('prototypeData').value,'new-prototypeData');assert.notEqual(nano.snapshot(['prototypeData']).versionKey,oldNano.versionKey);
nanoFile.ctimeNs+=1n;nanoFile.readDenied=true;assert.throws(()=>nano.read('prototypeData'),{code:'source_data_unavailable'});assert.equal(nano.inspect().entries,0);
nanoFile.readDenied=false;nanoFile.text=JSON.stringify({value:'permission-recovered'});nanoFile.ctimeNs+=1n;assert.equal(nano.read('prototypeData').value,'permission-recovered');
nanoFile.statDenied=true;assert.throws(()=>nano.snapshot(['prototypeData']),{code:'source_data_unavailable'});assert.equal(nano.inspect().entries,0);nanoFile.statDenied=false;
memory.files.delete(sourcePath);assert.throws(()=>nano.read('prototypeData'),{code:'source_data_unavailable'});memory.files.set(sourcePath,nanoFile);

const during=memoryFiles();let changed=false;during.onRead=filename=>{if(filename===sourcePath&&!changed){changed=true;const file=during.files.get(filename);file.text=JSON.stringify({value:'stable-new'});file.mtimeNs++;file.ctimeNs++;}};
const concurrent=createSourceDataCache({directory:data,readFile:during.readFile,statFile:during.statFile});assert.equal(concurrent.read('prototypeData').value,'stable-new');assert.equal(concurrent.inspect().reads,2);assert.equal(concurrent.inspect().parses,1);
const batch=memoryFiles();let batchChanged=false;batch.onRead=filename=>{if(filename.endsWith('/kimiInsights.json')&&!batchChanged){batchChanged=true;const file=batch.files.get(sourcePath);file.text=JSON.stringify({value:'batch-new'});file.ctimeNs++;}};
const coherent=createSourceDataCache({directory:data,readFile:batch.readFile,statFile:batch.statFile});const coherentResult=coherent.snapshot(['prototypeData','kimiInsights']);assert.equal(coherentResult.data.prototypeData.value,'batch-new');assert(coherent.inspect().retries>0);
const hot=memoryFiles();hot.onRead=filename=>{hot.files.get(filename).ctimeNs++;};const unstable=createSourceDataCache({directory:data,readFile:hot.readFile,statFile:hot.statFile,maxReadAttempts:2});assert.throws(()=>unstable.read('prototypeData'),{code:'source_changed_during_read'});assert.equal(unstable.inspect().entries,0);
const limited=createSourceDataCache({directory:data,maxEntries:2,maxBytes:4096});for(const name of names)limited.read(name);assert.equal(limited.inspect().entries,2);assert(limited.inspect().cachedBytes<=4096);assert(limited.inspect().evictions>=3);
const tiny=createSourceDataCache({directory:data,maxBytes:1});assert.deepEqual(tiny.read('prototypeData'),repaired);assert.equal(tiny.inspect().entries,0);
const uncached=createSourceDataCache({directory:data,maxEntries:0});uncached.read('prototypeData');uncached.read('prototypeData');assert.equal(uncached.inspect().reads,2);assert.equal(uncached.inspect().entries,0);
const other=createSourceDataCache({directory:dir+'/different',names:['prototypeData'],statFile:()=>({dev:1n,ino:1n,size:BigInt(Buffer.byteLength(nanoFile.text)),mtimeNs:nanoFile.mtimeNs,ctimeNs:nanoFile.ctimeNs,isFile:()=>true}),readFile:()=>nanoFile.text});assert.notEqual(other.snapshot().versionKey,nano.snapshot().versionKey);

const payload={label:'真实类型一致性测试',numbers:[0,1.5,null],flag:false,nested:{text:'中文 🪴\n保留原文与引号 "quote"。'.repeat(500)},...JSON.parse('{"__proto__":{"safe":true}}')};
let release,builds=0;const gate=new Promise(resolve=>{release=resolve;}),responses=createSourceResponseCache({maxEntries:3});
const pendingOne=responses.get('client:one',async()=>{builds++;await gate;return payload;}),pendingTwo=responses.get('client:one',()=>{throw Error('duplicate factory');});assert.equal(pendingOne,pendingTwo);await Promise.resolve();assert.equal(builds,1);assert.equal(responses.inspect().inflight,1);release();
const encoded=await pendingOne;assert.deepEqual(JSON.parse(encoded.identity.toString('utf8')),payload);assert.deepEqual(JSON.parse(gunzipSync(encoded.gzip).toString('utf8')),payload);assert.deepEqual(JSON.parse(brotliDecompressSync(encoded.br).toString('utf8')),payload);
assert.equal(encoded.sizes.identity,encoded.identity.length);assert.equal(encoded.sizes.gzip,encoded.gzip.length);assert.equal(encoded.sizes.br,encoded.br.length);
const mutated=encoded.identity;mutated[0]=0;const again=await responses.get('client:one',()=>{throw Error('cache hit must not rebuild');});assert.deepEqual(JSON.parse(again.identity.toString()),payload);assert.notEqual(again.identity,again.identity);assert.equal(responses.inspect().builds,1);assert.equal(responses.inspect().coalesced,1);
for(let version=0;version<12;version++)await responses.get('client:version-'+version,{version});assert.equal(responses.inspect().entries,3);assert(responses.inspect().evictions>=10);
const smallResponse=createSourceResponseCache({maxEntries:10,maxBytes:100});for(let version=0;version<10;version++)await smallResponse.get('small:'+version,{version});assert(smallResponse.inspect().cachedBytes<=100);assert(smallResponse.inspect().entries<=2);
const noAdmission=createSourceResponseCache({maxEntries:0});await noAdmission.get('once',{ok:true});await noAdmission.get('once',{ok:true});assert.equal(noAdmission.inspect().entries,0);assert.equal(noAdmission.inspect().builds,2);
const oversize=createSourceResponseCache({maxBytes:1});assert.deepEqual(JSON.parse((await oversize.get('large',payload)).identity.toString()),payload);assert.equal(oversize.inspect().entries,0);
const failing=createSourceResponseCache();const cycle={};cycle.self=cycle;await assert.rejects(failing.get('bad-json',cycle),{code:'source_response_invalid'});assert.equal(failing.inspect().inflight,0);assert.equal(failing.inspect().entries,0);assert.deepEqual(JSON.parse((await failing.get('bad-json',{recovered:true})).identity.toString()),{recovered:true});
let letBusyComplete;const busyGate=new Promise(resolve=>{letBusyComplete=resolve;}),busy=createSourceResponseCache({maxInflight:2});const one=busy.get('one',async()=>{await busyGate;return {one:true};}),two=busy.get('two',async()=>{await busyGate;return {two:true};});assert.equal(busy.get('one',null),one);await assert.rejects(busy.get('three',{}),{code:'source_response_busy'});assert.equal(busy.inspect().inflight,2);letBusyComplete();await Promise.all([one,two]);assert.equal(busy.inspect().inflight,0);

const snapshotBefore=reader.snapshot(['prototypeData']),versioned=createSourceResponseCache();const wireBefore=await versioned.get('bootstrap:'+snapshotBefore.versionKey,snapshotBefore.data);
await writeFile(dir+'/prototype-before-wire-update.json',JSON.stringify(repaired));const newer={...repaired,status:'phase-E'};await writeFile(sourcePath,JSON.stringify(newer));const snapshotAfter=reader.snapshot(['prototypeData']);assert.notEqual(snapshotAfter.versionKey,snapshotBefore.versionKey);const wireAfter=await versioned.get('bootstrap:'+snapshotAfter.versionKey,snapshotAfter.data);assert.deepEqual(JSON.parse(wireBefore.identity.toString()),snapshotBefore.data);assert.deepEqual(JSON.parse(wireAfter.identity.toString()),snapshotAfter.data);
const sourceBytes=await readFile(sourcePath);assert.deepEqual(JSON.parse(sourceBytes),newer);
const result={ok:true,cloneIsolation:true,frozenSnapshot:true,fileVersionInvalidation:true,nanosecondAndCtimeInvalidation:true,atomicRenameDetected:true,invalidJsonAndPermissionFailClosed:true,concurrentReadRetries:true,coherentMultiFileSnapshot:true,persistentWritesRejectedByInterface:true,inflightCoalesced:true,responseEncodingRoundTrip:true,responseBufferIsolation:true,boundedSourceEntriesAndBytes:true,boundedResponseEntriesBytesAndInflight:true,failedBuildNotCached:true,snapshotVersionSelectsNewResponse:true,sourceFilesRetained:true,fixtureEncodingSizes:encoded.sizes,sourceStats:reader.inspect(),responseStats:responses.inspect(),realMessagesSent:0,realUpstreamRequests:0,artifacts:dir};
await writeFile(dir+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
