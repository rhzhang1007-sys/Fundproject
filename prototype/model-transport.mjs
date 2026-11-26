// Operator-configured endpoints only. Never discover a destination for a secret.
export function modelEndpoint(value){
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('模型接口须为不含认证信息的HTTPS地址');
 if(['/','/v1','/v1/'].includes(u.pathname))u.pathname='/v1/chat/completions';return u.href;
}
export function createModelTransport({url,backups=[],fetcher=fetch,now=Date.now}={}){
 const endpoints=[...new Set([url,...backups].map(modelEndpoint))],unavailable=new Map();let preferred=url,preferredUntil=0;
 return async(_url,options)=>{
  const order=[...endpoints].sort((a,b)=>((unavailable.get(a)||0)>now())-((unavailable.get(b)||0)>now())||(now()<preferredUntil?Number(b===preferred)-Number(a===preferred):0));let last;
  for(const endpoint of order){
   if(options.signal?.aborted)throw options.signal.reason;
   try{const r=await fetcher(endpoint,{...options,redirect:'error'});preferred=endpoint;preferredUntil=now()+300000;unavailable.delete(endpoint);return r;}
   catch(e){last=e;const code=e.cause?.code||e.code;
    // A received response is never retried. Only a known pre-request connection
    // failure can switch endpoint, avoiding a second billed model generation.
    if(!['UND_ERR_CONNECT_TIMEOUT','ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'].includes(code))throw e;
    unavailable.set(endpoint,now()+60000);
   }
  }
  if(last)last.requestNotSent=true;throw last||Error('模型连接失败');
 };
}
