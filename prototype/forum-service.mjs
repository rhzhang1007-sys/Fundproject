// Public retrieval has its own worker queue. It never occupies a model request.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mergePosts} from './dist/v09-public-data.mjs';
export function createForumService(here,{runWorker,stateStore,mirror}={}){
 let registry,tail=Promise.resolve();const jobs=new Map(),batches=new Map();
 const stateKey=p=>{const rel=path.relative(path.join(here,'.private'),p).split(path.sep).join('/');if(/^forum\/(?:fund|stock)[0-9A-Z]+\/\d{4}-\d{2}-\d{2}\.json$/.test(rel))return 'forum:'+rel.slice(6,-5).replace('/',':');if(/^forum-batches\/[a-f0-9-]{36}\.json$/.test(rel))return 'batch:'+path.basename(p,'.json');return null;};
 const key=(id,date)=>id+'/'+date,read=async(p,f)=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const k=stateKey(p);if(stateStore&&k){const row=await stateStore.read(k);if(row)return row.value;}return f;}};
 async function check(id,date){registry??=new Set((await read(path.join(here,'dist/data/v10/objects.json'),{objects:[]})).objects.map(x=>x.id));if(!registry.has(id)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('请选择已收录对象及有效日期');const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()),age=Date.parse(today)-Date.parse(date);if(age<0||age>29*86400000)throw Error('仅支持近30天公开帖子');}
 async function snapshot(id,date){const kind=id.startsWith('fund')?'fund':'stock',code=id.slice(kind.length),cached=await read(path.join(here,'.private/forum',id,date+'.json'),{objectId:id,date,records:[],status:'not-collected'}),name='v12/posts/'+kind+'s/'+code+'.json',local=await read(path.join(here,'dist/data',name),{records:[]}),latest=mirror?await mirror.read(name,local):local,pub=latest?.objectId===id?latest:local;return {...cached,records:mergePosts(mergePosts(local.records,pub.records).filter(r=>r.date===date),cached.records||[])};}
 const counts=v=>({posts:v.records.length,bodies:v.records.filter(r=>r.content&&r.coverage?.body==='complete').length,comments:v.records.reduce((n,r)=>n+(r.comments?.length||0),0),pending:v.records.filter(r=>r.coverage?.body!=='complete'||r.coverage?.comments!=='complete').length});
 async function get(id,date){await check(id,date);const value=await snapshot(id,date),job=jobs.get(key(id,date));return {...value,...(job?{status:job.status,message:job.message,visits:job.visits}:{}),progress:counts(value)};}
 function spawnVisit(id,date,postIds,seconds){return new Promise(resolve=>{const child=spawn(process.env.PYTHON||'python3',[path.join(here,'scripts/forum_object.py'),'--object',id,'--day',date,'--seconds',String(seconds),...(postIds.length?['--known-only','--post-ids',postIds.join(',')]:[])],{cwd:path.dirname(here),stdio:['ignore','ignore','ignore']});let finished=false;const finish=ok=>{if(finished)return;finished=true;clearTimeout(timer);resolve(ok);};const timer=setTimeout(()=>{child.kill('SIGTERM');finish(false);},(seconds+20)*1000);child.on('error',()=>finish(false));child.on('exit',code=>finish(code===0));});}
 function visit(...args){const p=tail.catch(()=>{}).then(()=>runWorker?runWorker(...args):spawnVisit(...args));tail=p.catch(()=>{});return p;}
 async function start(id,date,postIds=[],{allMissing=false}={}){
  await check(id,date);if(!Array.isArray(postIds)||postIds.length>30||postIds.some(x=>typeof x!=='string'||!/^(?:\d{1,24}|sina:\d{1,24}:\d{1,24})$/.test(x)))throw Error('帖子标识无效');
  const k=key(id,date),previous=jobs.get(k);if(['running','queued'].includes(previous?.status)){previous.allScope ||= !postIds.length;postIds.forEach(x=>previous.postIds.add(x));previous.maxVisits=Math.max(previous.maxVisits,allMissing?6:2);return get(id,date);}
  if([...jobs.values()].filter(j=>['running','queued'].includes(j.status)).length>=8)throw Error('读取队列繁忙，请稍后再试');
  const initial=await snapshot(id,date);
  const local=path.join(here,'.private/forum',id,date+'.json');await mkdir(path.dirname(local),{recursive:true});const seed=local+'.seed-'+randomUUID();await writeFile(seed,JSON.stringify(initial));await rename(seed,local);
  const job={status:'queued',visits:0,message:'已加入独立补读队列',allScope:!postIds.length,postIds:new Set(postIds),maxVisits:allMissing?6:1};jobs.set(k,job);
  const selected=postIds.length?initial.records.filter(r=>postIds.includes(r.id)):initial.records;if(selected.length&&(!postIds.length||selected.length===postIds.length)&&(postIds.length||selected.length>=30||initial.status==='complete')&&counts({...initial,records:selected}).pending===0){job.status='complete';job.promise=Promise.resolve();return get(id,date);}
  job.promise=(async()=>{let unchanged=0,last='';
   for(let i=0;i<job.maxVisits;i++){
    job.status='running';job.visits++;const requested=job.allScope?[]:[...job.postIds];await visit(id,date,requested,job.maxVisits>1?60:100);
    const value=await snapshot(id,date),wanted=job.allScope?[]:[...job.postIds],selected=wanted.length?value.records.filter(r=>wanted.includes(r.id)):value.records,c=counts({...value,records:selected});
    if(stateStore)await stateStore.write('forum:'+id+':'+date,value);
    job.message=`已取得${c.bodies}篇正文、${c.comments}条评论`;
    if((wanted.length&&selected.length===wanted.length&&c.pending===0)||(!wanted.length&&value.status==='complete')){job.status='complete';break;}
    const states=Object.values(value.sources||{}),refused=states.some(s=>s.error==='source-refused'||s.cooldownUntil&&Date.parse(s.cooldownUntil)>Date.now())&&states.every(s=>['window-complete','daily-cap-reached','unsupported-board'].includes(s.status)||s.cooldownUntil&&Date.parse(s.cooldownUntil)>Date.now());if(refused){job.message='来源暂时无法读取，已保留取得的内容';break;}
    const signature=JSON.stringify([c,value.sources]);unchanged=signature===last?unchanged+1:0;last=signature;if(unchanged>=2)break;
   }
   if(job.status!=='complete')job.status='partial';return get(id,date);
  })().catch(()=>{job.status='partial';job.message='本次补读未完成，已取得的内容已保留';});
  return get(id,date);
 }
 async function persist(batch){const dir=path.join(here,'.private/forum-batches');await mkdir(dir,{recursive:true});const p=path.join(dir,batch.id+'.json');if(stateStore)await stateStore.write('batch:'+batch.id,batch);await writeFile(p+'.tmp',JSON.stringify(batch));await rename(p+'.tmp',p);}
 function publicBatch(b){return {id:b.id,date:b.date,status:b.status,total:b.objectIds.length,completed:b.completed.map(x=>x.objectId),finished:b.completed.length,partial:b.completed.filter(x=>x.status!=='complete').length,currentObject:b.currentObject||null};}
 async function execute(batch){if(batch.running)return;batch.running=true;batch.status='running';
  try{for(const id of batch.objectIds){if(batch.completed.some(x=>x.objectId===id))continue;batch.currentObject=id;await persist(batch);await start(id,batch.date,[],{allMissing:true});await jobs.get(key(id,batch.date))?.promise;const value=await get(id,batch.date);batch.completed.push({objectId:id,status:value.status});await persist(batch);}batch.status=batch.completed.some(x=>x.status!=='complete')?'partial':'complete';}
  catch{batch.status='partial';}finally{batch.running=false;batch.currentObject=null;await persist(batch);}
 }
 async function startBatch(objectIds,date){
  if(!Array.isArray(objectIds)||!objectIds.length||objectIds.length>256||new Set(objectIds).size!==objectIds.length)throw Error('一次请选择1至256个对象');for(const id of objectIds)await check(id,date);
  const same=[...batches.values()].find(b=>['running','queued'].includes(b.status)&&b.date===date&&JSON.stringify([...b.objectIds].sort())===JSON.stringify([...objectIds].sort()));if(same)return publicBatch(same);
  if([...batches.values()].filter(b=>b.running).length>=2)throw Error('已有补读任务运行中，请稍后再试');
  const b={id:randomUUID(),date,objectIds,completed:[],status:'queued',currentObject:null};batches.set(b.id,b);await persist(b);execute(b).catch(()=>{});return publicBatch(b);
 }
 async function getBatch(id){if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('补读任务标识无效');let b=batches.get(id);if(!b){b=await read(path.join(here,'.private/forum-batches',id+'.json'),null);if(!b)throw Error('未找到补读任务');for(const oid of b.objectIds)await check(oid,b.date);b.running=false;batches.set(id,b);if(['running','queued'].includes(b.status))execute(b).catch(()=>{});}return publicBatch(b);}
 return {get,start,startBatch,getBatch};
}
