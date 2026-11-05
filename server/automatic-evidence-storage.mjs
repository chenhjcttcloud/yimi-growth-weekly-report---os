import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import {TextDecoder} from 'node:util';

const MARKER='_growthEvidenceStorage',FORMAT='brotli-json-v1';
const MIN_BYTES=8*1024,MAX_BYTES=64*1024*1024;
const SUMMARY_KEYS=['userId','reviewNote','qualityCandidate','legitimateReason','deduction'];
const sha256=value=>createHash('sha256').update(value).digest('hex');
const invalid=reason=>Object.assign(new Error('automatic_evidence_storage_invalid:'+reason),{code:'automatic_evidence_storage_invalid'});
function requireString(value){if(typeof value!=='string')throw new TypeError('automatic_evidence_json_required');}
function parse(value){try{return JSON.parse(value);}catch{return undefined;}}
function hasMarker(value){return value!==null&&typeof value==='object'&&Object.hasOwn(value,MARKER);}

// Only new automatic evidence uses this representation. Legacy rows, small
// snapshots and snapshots above the decoder's bounded capacity remain intact.
export function encodeAutomaticEvidence(jsonString){
 requireString(jsonString);
 const bytes=Buffer.byteLength(jsonString,'utf8');
 if(bytes<MIN_BYTES||bytes>MAX_BYTES)return jsonString;
 const original=parse(jsonString);
 if(original===undefined)return jsonString;
 if(hasMarker(original)){decodeAutomaticEvidence(jsonString);return jsonString;}
 const raw=Buffer.from(jsonString,'utf8');
 // Preserve even unusual pre-existing JS strings without a lossy UTF-8 roundtrip.
 if(raw.toString('utf8')!==jsonString)return jsonString;
 const compressed=brotliCompressSync(raw,{params:{[constants.BROTLI_PARAM_QUALITY]:3,[constants.BROTLI_PARAM_LGWIN]:22}});
 const envelope={[MARKER]:FORMAT,sha256:sha256(raw),uncompressedBytes:raw.length,data:compressed.toString('base64')};
 for(const key of SUMMARY_KEYS)if(original!==null&&typeof original==='object'&&Object.hasOwn(original,key))envelope[key]=original[key];
 const stored=JSON.stringify(envelope);
 return Buffer.byteLength(stored,'utf8')<raw.length?stored:jsonString;
}

// Return the exact original string, not a reserialized approximation. Keeping
// summary fields above the compressed payload lets overview SQL avoid decoding.
export function decodeAutomaticEvidence(jsonString){
 requireString(jsonString);
 const envelope=parse(jsonString);
 if(!hasMarker(envelope))return jsonString;
 if(envelope[MARKER]!==FORMAT)throw invalid('format');
 const size=envelope.uncompressedBytes;
 if(!Number.isSafeInteger(size)||size<=0||size>MAX_BYTES)throw invalid('size');
 if(typeof envelope.sha256!=='string'||!/^[a-f0-9]{64}$/.test(envelope.sha256))throw invalid('checksum');
 const data=envelope.data;
 // Buffer.from(base64) silently ignores bad characters and padding; demand a
 // canonical representation before allocating or invoking the decompressor.
 if(typeof data!=='string'||!data.length||data.length>Math.ceil(MAX_BYTES/3)*4||data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw invalid('base64');
 const compressed=Buffer.from(data,'base64');
 if(compressed.toString('base64')!==data)throw invalid('base64');
 let raw;
 try{raw=brotliDecompressSync(compressed,{maxOutputLength:size});}catch{throw invalid('decompression');}
 if(raw.length!==size)throw invalid('length');
 if(sha256(raw)!==envelope.sha256)throw invalid('checksum');
 try{return new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw invalid('utf8');}
}
