// AI/source-material service with one permitted frontend origin. Secrets stay on the server.
import http from 'node:http';
import {readFile,writeFile,rename,mkdir,stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROMPTS,resolveAIResult} from './dist/v08-ai.mjs';
import {createForumService} from './forum-service.mjs';
import {createNewsService} from './news-service.mjs';
import {modelEndpoint,createModelTransport} from './model-transport.mjs';
import {createCloudState} from './cloud-state.mjs';
import {createPublicMirror} from './public-data-cache.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export const PROMPT_VERSION='clear-insights-v24-2026-11-27';
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
export async function readServerConfig(env=process.env){
 let file={};try{for(const line of (await readFile(path.join(HERE,'.env.local'),'utf8')).split(/\r?\n/)){const m=/^(WEB_(?:LLM|STATE)_[A-Z_]+)=(.*)$/.exec(line.trim());if(m)file[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}}catch{}
 const get=k=>env[k]??file[k]??'';let url=get('WEB_LLM_API_URL');try{const endpoint=new URL(url);if(endpoint.pathname==='/'||endpoint.pathname==='/v1'||endpoint.pathname==='/v1/')endpoint.pathname='/v1/chat/completions';url=endpoint.href;}catch{}const model=get('WEB_LLM_MODEL'),key=get('WEB_LLM_API_KEY');
 let input=Number(get('WEB_LLM_PRICE_IN')),output=Number(get('WEB_LLM_PRICE_OUT')),priceReviewAfter=null;
 if(!get('WEB_LLM_PRICE_IN').trim()&&!get('WEB_LLM_PRICE_OUT').trim())try{const catalog=JSON.parse(await readFile(path.join(HERE,'config/llm-pricing.json'),'utf8'));const entry=catalog.entries.find(x=>x.host===new URL(url).hostname&&x.model===model.toLowerCase());if(entry&&today()<=catalog.reviewAfter){input=entry.input;output=entry.output;priceReviewAfter=catalog.reviewAfter;}}catch{}
 const parseOrigin=name=>{const value=get(name).trim();if(!value)return '';let parsed;try{parsed=new URL(value);}catch{throw Error(name+'须填协议和域名；本机使用请留空');}if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error(name+'不能包含路径、查询参数或认证信息');return parsed.origin;};
 const origin=parseOrigin('WEB_LLM_ORIGIN'),serviceOrigin=parseOrigin('WEB_LLM_SERVICE_ORIGIN')||(env.RENDER_EXTERNAL_URL?new URL(env.RENDER_EXTERNAL_URL).origin:''),listenHost=get('WEB_LLM_LISTEN_HOST').trim()||'127.0.0.1';
 if(!['127.0.0.1','localhost','0.0.0.0','::1','::'].includes(listenHost))throw Error('WEB_LLM_LISTEN_HOST无效');
 const backups=get('WEB_LLM_FALLBACK_URL').trim()?[modelEndpoint(get('WEB_LLM_FALLBACK_URL').trim())]:[];
 const stateStore=createCloudState({url:get('WEB_STATE_URL'),key:get('WEB_STATE_KEY'),required:get('WEB_STATE_REQUIRED')==='true'});
 return {url,backups,model,key,input,output,priceReviewAfter,origin,serviceOrigin,listenHost,stateStore,livePublicData:get('WEB_STATE_REQUIRED')==='true',budget:Number(get('WEB_LLM_DAILY_BUDGET')||5),ledger:path.join(HERE,'.private/web-ai-usage.json')};
}
function validateInput(body){
 if(!body||!Object.hasOwn(PROMPTS,body.task)||Object.keys(body).some(k=>!['task','materials','question'].includes(k)))throw Error('请求格式无效');
 if(!Array.isArray(body.materials)||body.materials.length>30||typeof (body.question??'')!=='string'||(body.question||'').length>4000)throw Error('材料数量或问题长度无效');
 const ids=new Set();let total=0;
 for(const m of body.materials){if(!m||typeof m.id!=='string'||!m.id||ids.has(m.id)||typeof m.text!=='string'||m.text.length>30000||Object.keys(m).some(k=>!['id','text','url','date','locator'].includes(k)))throw Error('材料格式无效');ids.add(m.id);total+=Buffer.byteLength(m.text);}
 if(total>120000||(!body.materials.length&&body.task!=='verify'))throw Error('请选择适量资料');return body;
}
export function createHandler({root=path.join(HERE,'dist'),config,upstream=fetch,date=today,forumService}={}){
 let queue=Promise.resolve();const clients=new Map();
 const mirror=config.livePublicData?createPublicMirror(HERE):null;
 const forum=forumService||createForumService(HERE,{stateStore:config.stateStore,mirror});
 const news=createNewsService({root:HERE,mirror});
 const transport=/^https:\/\//.test(config.url)?createModelTransport({url:config.url,backups:config.backups||[],fetcher:upstream}):upstream;
 const available=()=>Boolean(config.key&&config.model&&/^https:\/\//.test(config.url)&&config.input>0&&config.output>0&&config.budget>0&&(!config.priceReviewAfter||date()<=config.priceReviewAfter));
 async function generate(body,deadline=Date.now()+90000){
  let ledger,reservation;
  if(config.stateStore){const saved=await config.stateStore.read('ai:'+date());ledger=saved?.value;if(ledger&&ledger.date!==date())throw Error('用量记录无法读取');}
  else try{ledger=JSON.parse(await readFile(config.ledger,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('用量记录无法读取');}
  if(!ledger||ledger.date!==date())ledger={date:date(),calls:0,costCNY:0,reservedCNY:0};
  if(!Number.isFinite(ledger.costCNY)||ledger.costCNY<0||!Number.isFinite(ledger.reservedCNY)||ledger.reservedCNY<0)throw Error('用量记录无法读取');
  const persist=async()=>{await mkdir(path.dirname(config.ledger),{recursive:true});const tmp=config.ledger+'.tmp';await writeFile(tmp,JSON.stringify(ledger));await rename(tmp,config.ledger);};
  const messages=[{role:'system',content:PROMPTS[body.task]},{role:'user',content:JSON.stringify({materials:body.materials,question:body.question||''})}];
  const cap=/^glm-5\.3/i.test(config.model)?8192:1600;const reserve=(Buffer.byteLength(JSON.stringify(messages))*config.input+cap*config.output)/1e6;
  if(ledger.costCNY+ledger.reservedCNY+reserve>config.budget)throw Error('今日默认AI额度已用完，可使用自己的接口');
  if(Date.now()>=deadline)throw Error('模型请求超时');
  if(config.stateStore){reservation=await config.stateStore.reserveBudget(date(),reserve,config.budget);ledger=reservation.ledger;}else{ledger.calls++;ledger.reservedCNY+=reserve;}await persist();
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),deadline-Date.now());
  try{
   let response;try{response=await transport(config.url,{method:'POST',signal:ctl.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},body:JSON.stringify({model:config.model,messages,...(/^glm-5\.3/i.test(config.model)?{thinking:{type:'enabled'},reasoning_effort:'low'}:{}),temperature:/^glm-5\.3/i.test(config.model)?1:.1,max_tokens:cap})});}catch(e){if(e.requestNotSent){if(config.stateStore){try{ledger=await config.stateStore.settleBudget(reservation.id,{refund:true});}catch{console.error('AI reservation retained for later reconciliation');}}else ledger.reservedCNY=Math.max(0,ledger.reservedCNY-reserve);await persist();}if(e.name==='AbortError')throw e;const code=String(e.cause?.code||e.code||'NETWORK_ERROR');console.error(JSON.stringify({stage:'model-transport',code:/^[A-Z0-9_]{1,60}$/.test(code)?code:'NETWORK_ERROR'}));throw Error('模型连接失败，请稍后重试');}
   if(!response.ok)throw Error('模型服务暂时不可用');
   const raw=await response.text();if(Buffer.byteLength(raw)>1000000)throw Error('模型响应过长');const value=JSON.parse(raw);
   if(value.usage&&Number.isSafeInteger(value.usage.prompt_tokens)&&value.usage.prompt_tokens>=0&&Number.isSafeInteger(value.usage.completion_tokens)&&value.usage.completion_tokens>=0){const actual=(value.usage.prompt_tokens*config.input+value.usage.completion_tokens*config.output)/1e6;if(config.stateStore){try{ledger=await config.stateStore.settleBudget(reservation.id,{actual});}catch{console.error('AI reservation retained for later reconciliation');}}else{ledger.reservedCNY=Math.max(0,ledger.reservedCNY-reserve);ledger.costCNY+=actual;}await persist();}
   const draft=value.choices?.[0]?.message?.content||value.output_text||'';
   const result=resolveAIResult(draft,body.task,body.materials,body.question||'');
   return {result,promptVersion:PROMPT_VERSION};
  }finally{clearTimeout(timer);}
 }
 return async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   const host=req.headers.host||'',serviceOrigin=config.serviceOrigin||config.origin;const allowedHost=serviceOrigin?new URL(serviceOrigin).host===host:/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host);
   if(!allowedHost)return json(res,403,{error:'站点地址不匹配'});
   if(url.pathname.startsWith('/api/')){
    const origin=req.headers.origin,expected=config.origin||config.serviceOrigin||`http://${host}`;
    if(origin&&origin!==expected)return json(res,403,{error:'来源不匹配'});
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){
     const method=req.headers['access-control-request-method'],headers=String(req.headers['access-control-request-headers']||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
     if(!origin||!['GET','POST'].includes(method)||headers.some(x=>x!=='content-type'))return json(res,403,{error:'预检请求不匹配'});
     res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600','Cache-Control':'no-store'});return res.end();
    }
   }
   if(url.pathname==='/api/health'&&req.method==='GET'){if(config.stateStore)try{await config.stateStore.read('ai:'+date());}catch{return json(res,503,{status:'storage-setup'});}return json(res,200,{status:'ok'});}
   if(url.pathname==='/api/news/body'&&req.method==='GET'){
    if([...url.searchParams.keys()].some(k=>k!=='eventId'))return json(res,400,{error:'只接受已收录事件标识'});
    try{return json(res,200,await news.get(url.searchParams.get('eventId')));}catch(e){return json(res,422,{error:e.message});}
   }
   if(url.pathname==='/api/forum/batch'){
    if(req.method==='GET'){try{return json(res,200,await forum.getBatch(url.searchParams.get('jobId')));}catch(e){return json(res,400,{error:e.message});}}
    if(req.method!=='POST')return json(res,405,{error:'请求方式不支持'});
    if(req.headers.origin&&req.headers.origin!==(config.origin||config.serviceOrigin||`http://${req.headers.host}`))return json(res,403,{error:'来源不匹配'});
    let raw='',size=0;for await(const c of req){size+=c.length;if(size>15000)return json(res,413,{error:'对象数量过多'});raw+=c;}
    try{const x=JSON.parse(raw);if(Object.keys(x).some(k=>!['objectIds','date'].includes(k)))throw Error('请求格式无效');return json(res,202,await forum.startBatch(x.objectIds,x.date));}catch(e){return json(res,400,{error:e.message});}
   }
   if(url.pathname==='/api/forum'){
    if(req.method==='GET'){try{return json(res,200,await forum.get(url.searchParams.get('objectId'),url.searchParams.get('date')));}catch(e){return json(res,400,{error:e.message});}}
    if(req.method!=='POST')return json(res,405,{error:'请求方式不支持'});
    if(req.headers.origin&&req.headers.origin!==(config.origin||config.serviceOrigin||`http://${req.headers.host}`))return json(res,403,{error:'来源不匹配'});
    let body='',bytes=0;for await(const c of req){bytes+=c.length;if(bytes>2000)return json(res,413,{error:'请求过长'});body+=c;}
    try{const x=JSON.parse(body);if(Object.keys(x).some(k=>!['objectId','date','postIds','allMissing'].includes(k)))throw Error('请求格式无效');return json(res,202,await forum.start(x.objectId,x.date,x.postIds||[],{allMissing:x.allMissing===true}));}catch(e){return json(res,400,{error:e.message});}
   }
   if(url.pathname==='/api/ai/status'&&req.method==='GET')return json(res,200,{sharedAvailable:available(),model:available()?config.model:null,promptVersion:PROMPT_VERSION});
   if(url.pathname==='/api/ai'&&req.method==='POST'){
    // Only the configured frontend origin; never accept client-selected model credentials.
    if(req.headers.origin&&req.headers.origin!==(config.origin||config.serviceOrigin||`http://${req.headers.host}`))return json(res,403,{error:'来源不匹配'});
    if(!available())return json(res,503,{error:'默认AI尚未配置，可在设置中使用自己的接口'});
    const ip=req.socket.remoteAddress;const recent=(clients.get(ip)||[]).filter(t=>t>Date.now()-60000);if(recent.length>=10)return json(res,429,{error:'请求较多，请稍后再试'});recent.push(Date.now());clients.set(ip,recent);
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'请求格式无效'});
    const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>200000)return json(res,413,{error:'材料过长'});chunks.push(c);}
    let body;try{body=validateInput(JSON.parse(Buffer.concat(chunks).toString()));}catch(e){return json(res,400,{error:e.message});}
    const result=queue.then(()=>generate(body));queue=result.catch(()=>{});
    try{return json(res,200,await result);}catch(e){const allowed=['模型连接失败，请稍后重试','用量记录无法读取','今日默认AI额度已用完，可使用自己的接口','模型服务暂时不可用','模型响应过长'];return json(res,502,{error:allowed.includes(e.message)?e.message:e.name==='AbortError'?'请求超时，请稍后重试':'模型服务未返回可用内容，请稍后重试'});}
   }
   if(url.pathname.startsWith('/api/'))return json(res,404,{error:'接口不存在'});
   if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'请求方式不支持'});
   let requested;try{requested=decodeURIComponent(url.pathname);}catch{return json(res,400,{error:'路径无效'});}
   const resolved=path.resolve(root,'.'+(requested==='/'?'/index.html':requested));const real=await realpath(resolved);if(!real.startsWith(path.resolve(root)+path.sep))return json(res,404,{error:'文件不存在'});
   const info=await stat(real);if(!info.isFile())return json(res,404,{error:'文件不存在'});
   const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
   res.writeHead(200,{'Content-Type':types[path.extname(real)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:await readFile(real));
  }catch{return json(res,404,{error:'文件或接口暂不可用'});}
 };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||8765),config=await readServerConfig();
 const server=http.createServer(createHandler({config}));server.listen(port,config.listenHost,()=>console.log(`持仓知见：http://${config.listenHost}:${port}；默认AI${config.key?'已配置，需核对价格与连通':'尚未配置'}`));
}
