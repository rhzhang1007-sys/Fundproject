// Same-origin AI service. Secrets stay on the server; prompts are owned by the product.
import http from 'node:http';
import {readFile,writeFile,rename,mkdir,stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROMPTS,validateAIResult} from './dist/v08-ai.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export const PROMPT_VERSION='web-ai-2026-11-24-v1';
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
export async function readServerConfig(env=process.env){
 let file={};try{for(const line of (await readFile(path.join(HERE,'.env.local'),'utf8')).split(/\r?\n/)){const m=/^(WEB_LLM_[A-Z_]+)=(.*)$/.exec(line.trim());if(m)file[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}}catch{}
 const get=k=>env[k]??file[k]??'';const url=get('WEB_LLM_API_URL'),model=get('WEB_LLM_MODEL'),key=get('WEB_LLM_API_KEY');
 let input=Number(get('WEB_LLM_PRICE_IN')),output=Number(get('WEB_LLM_PRICE_OUT')),priceReviewAfter=null;
 if(!get('WEB_LLM_PRICE_IN').trim()&&!get('WEB_LLM_PRICE_OUT').trim())try{const catalog=JSON.parse(await readFile(path.join(HERE,'config/llm-pricing.json'),'utf8'));const entry=catalog.entries.find(x=>x.host===new URL(url).hostname&&x.model===model.toLowerCase());if(entry&&today()<=catalog.reviewAfter){input=entry.input;output=entry.output;priceReviewAfter=catalog.reviewAfter;}}catch{}
 let origin=get('WEB_LLM_ORIGIN').trim();if(origin){let parsed;try{parsed=new URL(origin);}catch{throw Error('WEB_LLM_ORIGIN须填网页的协议和域名；本机使用请留空');}if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('WEB_LLM_ORIGIN不能包含路径、查询参数或认证信息');origin=parsed.origin;}
 return {url,model,key,input,output,priceReviewAfter,origin,budget:Number(get('WEB_LLM_DAILY_BUDGET')||5),ledger:path.join(HERE,'.private/web-ai-usage.json')};
}
function validateInput(body){
 if(!body||!Object.hasOwn(PROMPTS,body.task)||Object.keys(body).some(k=>!['task','materials','question'].includes(k)))throw Error('请求格式无效');
 if(!Array.isArray(body.materials)||body.materials.length>30||typeof (body.question??'')!=='string'||(body.question||'').length>4000)throw Error('材料数量或问题长度无效');
 const ids=new Set();let total=0;
 for(const m of body.materials){if(!m||typeof m.id!=='string'||!m.id||ids.has(m.id)||typeof m.text!=='string'||m.text.length>30000||Object.keys(m).some(k=>!['id','text','url','date','locator'].includes(k)))throw Error('材料格式无效');ids.add(m.id);total+=Buffer.byteLength(m.text);}
 if(total>120000||(!body.materials.length&&body.task!=='verify'))throw Error('请选择适量资料');return body;
}
export function createHandler({root=path.join(HERE,'dist'),config,upstream=fetch,date=today}={}){
 let queue=Promise.resolve();const clients=new Map();
 const available=()=>Boolean(config.key&&config.model&&/^https:\/\//.test(config.url)&&config.input>0&&config.output>0&&config.budget>0&&(!config.priceReviewAfter||date()<=config.priceReviewAfter));
 async function generate(body){
  let ledger;try{ledger=JSON.parse(await readFile(config.ledger,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('用量记录无法读取');}
  if(!ledger||ledger.date!==date())ledger={date:date(),calls:0,costCNY:0,reservedCNY:0};
  const persist=async()=>{await mkdir(path.dirname(config.ledger),{recursive:true});const tmp=config.ledger+'.tmp';await writeFile(tmp,JSON.stringify(ledger));await rename(tmp,config.ledger);};
  const messages=[{role:'system',content:PROMPTS[body.task]},{role:'user',content:JSON.stringify({materials:body.materials,question:body.question||''})}];
  const cap=/^glm-5\.3/i.test(config.model)?8192:1600;const reserve=(Buffer.byteLength(JSON.stringify(messages))*config.input+cap*config.output)/1e6;
  if(ledger.costCNY+ledger.reservedCNY+reserve>config.budget)throw Error('今日默认AI额度已用完，可使用自己的接口');
  ledger.calls++;ledger.reservedCNY+=reserve;await persist();
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),45000);
  try{
   const response=await upstream(config.url,{method:'POST',signal:ctl.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},body:JSON.stringify({model:config.model,messages,temperature:/^glm-5\.3/i.test(config.model)?1:.1,max_tokens:cap})});
   if(!response.ok)throw Error('模型服务暂时不可用');
   const raw=await response.text();if(Buffer.byteLength(raw)>1000000)throw Error('模型响应过长');const value=JSON.parse(raw);
   if(value.usage&&Number.isSafeInteger(value.usage.prompt_tokens)&&value.usage.prompt_tokens>=0&&Number.isSafeInteger(value.usage.completion_tokens)&&value.usage.completion_tokens>=0){ledger.reservedCNY=Math.max(0,ledger.reservedCNY-reserve);ledger.costCNY+=(value.usage.prompt_tokens*config.input+value.usage.completion_tokens*config.output)/1e6;await persist();}
   if(value.choices?.[0]?.finish_reason==='length')throw Error('模型输出未完成，请减少所选材料');
   const result=validateAIResult(value.choices?.[0]?.message?.content||value.output_text||'',body.task,body.materials,body.question||'');return {result,promptVersion:PROMPT_VERSION};
  }finally{clearTimeout(timer);}
 }
 return async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   const host=req.headers.host||'';const allowedHost=config.origin?new URL(config.origin).host===host:/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host);
   if(!allowedHost)return json(res,403,{error:'站点地址不匹配'});
   if(url.pathname==='/api/ai/status'&&req.method==='GET')return json(res,200,{sharedAvailable:available(),model:available()?config.model:null,promptVersion:PROMPT_VERSION});
   if(url.pathname==='/api/ai'&&req.method==='POST'){
    // Same-origin only; never relay a client-supplied key, endpoint, model or system prompt.
    if(req.headers.origin&&req.headers.origin!==(config.origin||`http://${req.headers.host}`))return json(res,403,{error:'来源不匹配'});
    if(!available())return json(res,503,{error:'默认AI尚未配置，可在设置中使用自己的接口'});
    const ip=req.socket.remoteAddress;const recent=(clients.get(ip)||[]).filter(t=>t>Date.now()-60000);if(recent.length>=10)return json(res,429,{error:'请求较多，请稍后再试'});recent.push(Date.now());clients.set(ip,recent);
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'请求格式无效'});
    const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>200000)return json(res,413,{error:'材料过长'});chunks.push(c);}
    let body;try{body=validateInput(JSON.parse(Buffer.concat(chunks).toString()));}catch(e){return json(res,400,{error:e.message});}
    const result=queue.then(()=>generate(body));queue=result.catch(()=>{});
    try{return json(res,200,await result);}catch(e){const allowed=['用量记录无法读取','今日默认AI额度已用完，可使用自己的接口','模型服务暂时不可用','模型响应过长','模型输出未完成，请减少所选材料'];const message=allowed.includes(e.message)?e.message:e.name==='AbortError'?'请求超时':'模型结果未通过来源校验，请重试';return json(res,502,{error:message});}
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
 const server=http.createServer(createHandler({config}));server.listen(port,'127.0.0.1',()=>console.log(`持仓知见：http://127.0.0.1:${port}；默认AI${config.key?'已配置，需核对价格与连通':'尚未配置'}`));
}
