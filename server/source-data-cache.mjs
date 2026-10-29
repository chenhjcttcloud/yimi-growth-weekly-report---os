import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompress,gzip,constants} from 'node:zlib';
import {promisify} from 'node:util';

const sourceNames=Object.freeze(['prototypeData','kimiInsights','kimiInsightsByPeriod','monthlyMeetingInsights','scoring360']);
const allowedNames=new Set(sourceNames);
const brotli=promisify(brotliCompress),gzipAsync=promisify(gzip);
const fail=code=>Object.assign(new Error(code),{code});
const integer=(value,min,label)=>{if(!Number.isSafeInteger(value)||value<min)throw new TypeError(label);return value;};
function freezeJson(value){
  const pending=[value],seen=new WeakSet();
  while(pending.length){const item=pending.pop();if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);Object.freeze(item);for(const child of Object.values(item))pending.push(child);}
  return value;
}

// Only source-file snapshots are cached. Grade publication, identity and
// permissions remain live database operations outside this module.
export function createSourceDataCache({directory,names=sourceNames,maxEntries=5,maxBytes=32*1024*1024,maxReadAttempts=3,readFile=readFileSync,statFile=statSync}={}){
  if(typeof directory!=='string'||!directory)throw new TypeError('source_directory_required');
  if(!Array.isArray(names)||names.some(name=>!allowedNames.has(name)))throw new TypeError('source_name_not_allowed');
  const configuredNames=[...new Set(names)],configured=new Set(configuredNames),base=path.resolve(directory);
  integer(maxEntries,0,'invalid_source_cache_capacity');integer(maxBytes,1,'invalid_source_cache_bytes');integer(maxReadAttempts,1,'invalid_source_read_attempts');
  maxEntries=Math.min(maxEntries,configuredNames.length);
  const cache=new Map();let cachedBytes=0;
  const metrics={hits:0,reads:0,parses:0,evictions:0,retries:0};
  const nameOf=name=>{if(typeof name!=='string'||!configured.has(name))throw fail('source_name_not_allowed');return name;};
  const filename=name=>path.join(base,name+'.json');
  function discard(name){const previous=cache.get(name);if(previous){cache.delete(name);cachedBytes-=previous.bytes;}}
  function stamp(name){
    try{
      const file=filename(name),s=statFile(file,{bigint:true});
      if(!s.isFile())throw fail('source_not_file');
      if(s.mtimeNs===undefined||s.ctimeNs===undefined)throw fail('source_version_unavailable');
      return {version:JSON.stringify([file,...['dev','ino','size','mtimeNs','ctimeNs'].map(key=>String(s[key]))]),size:s.size};
    }catch(error){discard(name);if(error.code==='source_not_file'||error.code==='source_version_unavailable')throw error;throw fail('source_data_unavailable');}
  }
  function remember(name,entry){
    discard(name);
    if(!maxEntries||entry.bytes>maxBytes)return;
    cache.set(name,entry);cachedBytes+=entry.bytes;
    while(cache.size>maxEntries||cachedBytes>maxBytes){const oldest=cache.keys().next().value;discard(oldest);metrics.evictions++;}
  }
  function entryFor(name){
    nameOf(name);
    for(let attempt=0;attempt<maxReadAttempts;attempt++){
      const before=stamp(name),previous=cache.get(name);
      if(previous?.version===before.version){
        const after=stamp(name);
        if(after.version!==before.version){metrics.retries++;continue;}
        cache.delete(name);cache.set(name,previous);metrics.hits++;return previous;
      }
      let text;
      try{metrics.reads++;text=readFile(filename(name),'utf8');}
      catch{discard(name);throw fail('source_data_unavailable');}
      const after=stamp(name);
      if(before.version!==after.version||BigInt(Buffer.byteLength(text))!==after.size){discard(name);metrics.retries++;continue;}
      let value;
      try{metrics.parses++;value=freezeJson(JSON.parse(text));}
      catch{discard(name);throw fail('source_json_invalid');}
      const entry={version:after.version,value,bytes:Buffer.byteLength(text)};
      remember(name,entry);return entry;
    }
    discard(name);throw fail('source_changed_during_read');
  }
  function snapshot(requested=configuredNames){
    if(!Array.isArray(requested))throw fail('source_name_not_allowed');
    const list=[...new Set(requested.map(nameOf))];
    for(let attempt=0;attempt<maxReadAttempts;attempt++){
      const before=list.map(name=>stamp(name)),entries=list.map(name=>entryFor(name)),after=list.map(name=>stamp(name));
      if(list.every((name,index)=>before[index].version===entries[index].version&&before[index].version===after[index].version)){
        const versionKey=createHash('sha256').update(JSON.stringify(list.map((name,index)=>[name,entries[index].version]))).digest('hex');
        return Object.freeze({data:Object.freeze(Object.fromEntries(list.map((name,index)=>[name,entries[index].value]))),versionKey});
      }
      metrics.retries++;
    }
    throw fail('source_changed_during_read');
  }
  return Object.freeze({
    read:name=>structuredClone(entryFor(name).value),
    snapshot,
    inspect:()=>Object.freeze({...metrics,entries:cache.size,cachedBytes,maxEntries,maxBytes}),
  });
}

async function compressJson(identity){
  const [compressedGzip,compressedBrotli]=await Promise.all([
    gzipAsync(identity,{level:4}),
    brotli(identity,{params:{[constants.BROTLI_PARAM_QUALITY]:4,[constants.BROTLI_PARAM_MODE]:constants.BROTLI_MODE_TEXT}}),
  ]);
  return {identity,gzip:compressedGzip,br:compressedBrotli};
}
function publicBuffers(buffers){
  const result={sizes:Object.freeze(Object.fromEntries(Object.entries(buffers).map(([encoding,buffer])=>[encoding,buffer.length])))};
  // res.end() gets only its chosen encoding, and an accidental caller mutation
  // cannot corrupt the cached body delivered to the next authorized request.
  for(const encoding of ['identity','gzip','br'])Object.defineProperty(result,encoding,{enumerable:true,get:()=>Buffer.from(buffers[encoding])});
  return Object.freeze(result);
}

// Callers must authorize every request and use view + fresh snapshot.versionKey
// as the key. This module does not cache final grades or implement a time TTL.
export function createSourceResponseCache({maxEntries=3,maxBytes=32*1024*1024,maxInflight=Math.max(3,maxEntries*2),compress=compressJson}={}){
  integer(maxEntries,0,'invalid_response_cache_capacity');integer(maxBytes,1,'invalid_response_cache_bytes');integer(maxInflight,1,'invalid_response_cache_inflight');
  const ready=new Map(),pending=new Map();let cachedBytes=0;
  const metrics={hits:0,builds:0,coalesced:0,evictions:0,rejected:0};
  function remember(key,value,bytes){
    if(!maxEntries||bytes>maxBytes)return;
    ready.set(key,{value,bytes});cachedBytes+=bytes;
    while(ready.size>maxEntries||cachedBytes>maxBytes){const oldest=ready.keys().next().value,entry=ready.get(oldest);ready.delete(oldest);cachedBytes-=entry.bytes;metrics.evictions++;}
  }
  function get(key,valueOrFactory){
    if(typeof key!=='string'||!key||key.length>4096)return Promise.reject(fail('source_response_key_invalid'));
    const existing=ready.get(key);
    if(existing){ready.delete(key);ready.set(key,existing);metrics.hits++;return Promise.resolve(existing.value);}
    if(pending.has(key)){metrics.coalesced++;return pending.get(key);}
    if(pending.size>=maxInflight){metrics.rejected++;return Promise.reject(fail('source_response_busy'));}
    const promise=Promise.resolve().then(async()=>{
      metrics.builds++;
      const value=typeof valueOrFactory==='function'?await valueOrFactory():valueOrFactory;
      let json;
      try{json=JSON.stringify(value);}catch{throw fail('source_response_invalid');}
      if(json===undefined)throw fail('source_response_invalid');
      const buffers=await compress(Buffer.from(json));
      for(const encoding of ['identity','gzip','br'])if(!Buffer.isBuffer(buffers[encoding]))throw fail('source_response_invalid');
      const result=publicBuffers(buffers),bytes=Object.values(result.sizes).reduce((sum,n)=>sum+n,0);
      remember(key,result,bytes);return result;
    });
    pending.set(key,promise);
    promise.then(()=>pending.delete(key),()=>pending.delete(key));
    return promise;
  }
  return Object.freeze({get,inspect:()=>Object.freeze({...metrics,entries:ready.size,cachedBytes,inflight:pending.size,maxEntries,maxBytes,maxInflight})});
}
