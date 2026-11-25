// Bounded public-only subprocess queue. Object IDs come from the public registry.
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
export function createForumService(here){
 let registry,queue=Promise.resolve();const jobs=new Map();
 const key=(id,date)=>id+'/'+date;
 async function check(id,date){registry??=new Set(JSON.parse(await readFile(path.join(here,'dist/data/v10/objects.json'),'utf8')).objects.map(x=>x.id));if(!registry.has(id)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('请选择已收录对象及有效日期');const age=Date.now()-Date.parse(date+'T00:00:00+08:00');if(age<0||age>30*86400000)throw Error('仅支持近30天公开帖子');}
 async function get(id,date){await check(id,date);let value={objectId:id,date,records:[],status:'not-collected'};try{value=JSON.parse(await readFile(path.join(here,'.private/forum',id,date+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}return {...value,...jobs.get(key(id,date))};}
 async function start(id,date){await check(id,date);const k=key(id,date),job=jobs.get(k);if(['running','queued'].includes(job?.status))return get(id,date);if([...jobs.values()].filter(x=>['running','queued'].includes(x.status)).length>=8)throw Error('读取队列繁忙，请稍后再试');jobs.set(k,{status:'queued'});queue=queue.catch(()=>{}).then(()=>new Promise(resolve=>{jobs.set(k,{status:'running'});const child=spawn(process.env.PYTHON||'python3',[path.join(here,'scripts/forum_object.py'),'--object',id,'--day',date,'--seconds','100'],{cwd:path.dirname(here),stdio:['ignore','ignore','ignore']});let finished=false;const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);jobs.set(k,error?{status:'partial',message:'本次读取未完成，已有内容已保留。'}:{});resolve();};const timer=setTimeout(()=>{child.kill('SIGTERM');finish(true);},125000);child.on('error',()=>finish(true));child.on('exit',code=>finish(code!==0));}));return get(id,date);}
 return {get,start};
}
