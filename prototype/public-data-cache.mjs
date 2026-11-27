// Read only fixed, already-public GitHub data paths. No credentials or model calls.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';import path from 'node:path';
export function createPublicMirror(root,{fetcher=fetch,now=Date.now,ttl=300000}={}){
 const jobs=new Map(),checked=new Map(),folder=path.join(root,'.private/public-data');
 return {async read(name,fallback=null){
  if(!/^(?:v07\/events\.json|v12\/posts\/(?:funds|stocks)\/[0-9A-Z]{1,12}\.json)$/.test(name))throw Error('公开资料路径无效');
  const file=path.join(folder,name),stored=async()=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return fallback;}};
  if(checked.has(name)&&now()-checked.get(name)<ttl)return stored();
  if(!jobs.has(name))jobs.set(name,(async()=>{
   try{
    const r=await fetcher('https://raw.githubusercontent.com/rhzhang1007-sys/Fundproject/main/prototype/dist/data/'+name,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('source');
    const parts=[];let bytes=0;for await(const p of r.body){bytes+=p.length;if(bytes>64_000_000)throw Error('size');parts.push(p);}
    let value=JSON.parse(Buffer.concat(parts).toString());
    if(name==='v07/events.json'){
     if(!Array.isArray(value.events))throw Error('schema');value={events:value.events.map(e=>({id:e.id,title:e.title,url:e.url,date:e.date}))};
    }else if(!Array.isArray(value.records)||typeof value.objectId!=='string'||value.records.some(r=>r.objectId!==value.objectId))throw Error('schema');
    await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(value));await rename(file+'.tmp',file);checked.set(name,now());return value;
   }catch{checked.set(name,now());return stored();}
  })().finally(()=>jobs.delete(name)));
  return jobs.get(name);
 }};
}
