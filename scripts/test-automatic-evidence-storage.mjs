import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {brotliCompressSync,constants} from 'node:zlib';
import path from 'node:path';
import {encodeAutomaticEvidence,decodeAutomaticEvidence} from '../server/automatic-evidence-storage.mjs';

// Synthetic evidence only; keep every artifact and never access production.
await mkdir('outputs/tests',{recursive:true});
const artifacts=await mkdtemp(path.resolve('outputs/tests/automatic-evidence-storage-'));
const MAX_BYTES=64*1024*1024,marker='_growthEvidenceStorage';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const checks=[];
function check(name,run){run();checks.push(name);}
const original={userId:'fixture-evidence-worker',reviewNote:'合成自动评分：保留完整原文。',qualityCandidate:null,legitimateReason:{verified:false,labels:['合成',0,null]},deduction:0,reports:Array.from({length:12},(_,index)=>({id:'fixture-report-'+index,content:{results:'合成成果：完成验收并记录业务价值。'.repeat(100),problems:'合成问题：当前接口需要核对。'.repeat(80),nextPlan:'合成计划：周五交付。'.repeat(80),reflection:'合成复盘：提前核对需求。'.repeat(80),unicode:'🧪 中文 e\u0301 É 𠮷\u2028\u2029',aiAnalysisAttempts:[{at:'fixture-only',attempt:index,diagnostic:'保留诊断原文'}]},qualityAssessment:{modules:[{reason:'合成理由'.repeat(100),criteria:[{evidence:[{quote:'合成原文',start:0,end:4}]}]}]}}))};
const json=' \r\n'+JSON.stringify(original,null,2)+'\n';
const stored=encodeAutomaticEvidence(json),envelope=JSON.parse(stored);
check('large evidence compresses',()=>{assert.equal(envelope[marker],'brotli-json-v1');assert(Buffer.byteLength(stored)<Buffer.byteLength(json)/4);assert.equal(envelope.uncompressedBytes,Buffer.byteLength(json));assert.equal(envelope.sha256,sha256(Buffer.from(json)));});
check('all original bytes and Unicode restored',()=>{assert.equal(decodeAutomaticEvidence(stored),json);assert.deepEqual(Buffer.from(decodeAutomaticEvidence(stored)),Buffer.from(json));assert.deepEqual(JSON.parse(decodeAutomaticEvidence(stored)),original);});
check('summary preserves null false zero composite and missing values',()=>{for(const key of ['userId','reviewNote','qualityCandidate','legitimateReason','deduction'])assert.deepEqual(envelope[key],original[key]);const missing=JSON.parse(encodeAutomaticEvidence(JSON.stringify({reports:original.reports})));for(const key of ['userId','reviewNote','qualityCandidate','legitimateReason','deduction'])assert.equal(Object.hasOwn(missing,key),false);});
check('small and old plain JSON pass through unchanged',()=>{for(const value of ['{}','null','[]',' { "legacy": true, "score": 0 }\n','malformed old evidence']){assert.equal(encodeAutomaticEvidence(value),value);assert.equal(decodeAutomaticEvidence(value),value);}});
check('large malformed legacy and unknown data remain untouched on encode',()=>{const value='not-json-'.repeat(2000);assert.equal(encodeAutomaticEvidence(value),value);assert.equal(decodeAutomaticEvidence(value),value);});
check('already encoded evidence is not encoded twice',()=>{assert.equal(encodeAutomaticEvidence(stored),stored);});
check('incompressible content is retained when envelope would grow',()=>{const value=JSON.stringify({reviewNote:randomBytes(12000).toString('base64')});assert.equal(encodeAutomaticEvidence(value),value);});
const altered=patch=>JSON.stringify({...envelope,...patch});
function rejects(value){assert.throws(()=>decodeAutomaticEvidence(value),error=>error.code==='automatic_evidence_storage_invalid');}
check('unsupported codec marker rejected',()=>rejects(altered({[marker]:'unknown-v2'})));
check('checksum format and checksum corruption rejected',()=>{rejects(altered({sha256:'bad'}));rejects(altered({sha256:'0'.repeat(64)}));});
check('declared byte lengths are bounded and verified',()=>{for(const size of [0,-1,1.5,'123',null,MAX_BYTES+1,envelope.uncompressedBytes-1,envelope.uncompressedBytes+1])rejects(altered({uncompressedBytes:size}));});
check('strict base64 corruption and padding rejected',()=>{for(const data of ['',null,17,envelope.data+' ',envelope.data.slice(0,-1),envelope.data.replace(/^[A-Za-z]/,'!'),'AAAA=','____'])rejects(altered({data}));});
check('broken compressed bytes rejected',()=>rejects(altered({data:Buffer.from('not brotli').toString('base64')})));
check('non-string arguments rejected',()=>{for(const value of [null,{},undefined,1]){assert.throws(()=>encodeAutomaticEvidence(value),TypeError);assert.throws(()=>decodeAutomaticEvidence(value),TypeError);}});
const prefix='{"payload":"',suffix='"}',large=prefix+'x'.repeat(MAX_BYTES-Buffer.byteLength(prefix+suffix))+suffix;
check('exact 64 MiB boundary roundtrips',()=>{assert.equal(Buffer.byteLength(large),MAX_BYTES);const encoded=encodeAutomaticEvidence(large);assert.equal(JSON.parse(encoded).uncompressedBytes,MAX_BYTES);assert.equal(decodeAutomaticEvidence(encoded),large);});
check('larger evidence stays original without data loss',()=>{const value=large+' ';assert.equal(encodeAutomaticEvidence(value),value);assert.equal(decodeAutomaticEvidence(value),value);});
check('compressed output cannot exceed declared cap',()=>{const raw=Buffer.from(large+' ');const bomb={...envelope,uncompressedBytes:MAX_BYTES,sha256:sha256(raw),data:brotliCompressSync(raw,{params:{[constants.BROTLI_PARAM_QUALITY]:3,[constants.BROTLI_PARAM_LGWIN]:22}}).toString('base64')};rejects(JSON.stringify(bomb));});
await writeFile(artifacts+'/fixture-original.json',json);
await writeFile(artifacts+'/fixture-stored.json',stored);
const result={ok:true,checks:checks.length,scenarios:checks,originalBytes:Buffer.byteLength(json),storedBytes:Buffer.byteLength(stored),storedRatio:Buffer.byteLength(stored)/Buffer.byteLength(json),byteForByte:true,legacyPassthrough:true,summaryFieldsRetained:true,maximumUncompressedBytes:MAX_BYTES,limitBoundaryVerified:true,corruptPayloadRejected:true,productionWrites:0,externalRequests:0,deletions:0,artifacts};
await writeFile(artifacts+'/result.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
