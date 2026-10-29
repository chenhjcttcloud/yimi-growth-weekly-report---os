// HTTP content negotiation is separate from the source version cache. The
// caller must authorize every request before looking up a shared source body.
export function sourceResponseEncoding(header){
  if(!header)return 'identity';
  const accepted=new Map();
  for(const part of String(header).toLowerCase().split(',')){
    const [name,...parameters]=part.trim().split(';');
    if(!name)continue;
    const quality=parameters.map(value=>value.trim()).find(value=>value.startsWith('q='));
    const value=quality===undefined?1:Number(quality.slice(2));
    accepted.set(name,Number.isFinite(value)&&value>=0&&value<=1?value:0);
  }
  const wildcard=accepted.get('*');
  const quality=name=>accepted.get(name)??(name==='identity'?(wildcard===0?0:1):(wildcard??0));
  return ['br','gzip','identity'].map(name=>({name,q:quality(name)})).filter(item=>item.q>0).sort((a,b)=>b.q-a.q)[0]?.name||null;
}

export function sendSourceResponse(req,res,response){
  res.setHeader('cache-control','no-store');
  const vary=String(res.getHeader('vary')||'').split(',').map(value=>value.trim()).filter(Boolean);
  if(!vary.some(value=>value.toLowerCase()==='accept-encoding'))vary.push('Accept-Encoding');
  res.setHeader('vary',vary.join(', '));
  const encoding=sourceResponseEncoding(req.headers['accept-encoding']);
  if(!encoding){res.writeHead(406,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify({ok:false,error:'encoding_not_acceptable'}));return;}
  const body=response[encoding];
  const headers={'content-type':'application/json; charset=utf-8','content-length':body.byteLength};
  if(encoding!=='identity')headers['content-encoding']=encoding;
  res.writeHead(200,headers);res.end(body);
}
