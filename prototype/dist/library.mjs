import {safeUrl} from './core.mjs';

export function splitTags(value) {
  return [...new Set(String(value || '').split(/[,，\n]/).map(s=>s.trim()).filter(Boolean))].slice(0,30);
}
export function cleanEntry(raw) {
  if(!raw || typeof raw.title!=='string') return null;
  const get=(key,max)=>typeof raw[key]==='string'?raw[key].slice(0,max):'';
  const analysisContext=cleanContext(raw.analysisContext);
  return {analysisContext,...(cleanAI(raw.aiResult)?{aiResult:cleanAI(raw.aiResult)}:{}),id:get('id',100)||crypto.randomUUID(),referenceId:get('referenceId',100),title:get('title',180),url:safeUrl(get('url',2000)),excerpt:get('excerpt',20000),folder:get('folder',100)||'未分类',tags:splitTags(raw.tags).join('，'),note:get('note',20000),images:Array.isArray(raw.images)?raw.images.filter(s=>typeof s==='string').slice(0,12):[],createdAt:get('createdAt',50)||new Date().toISOString(),updatedAt:get('updatedAt',50)||new Date().toISOString()};
}
function cleanAI(raw){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.materials)||!Array.isArray(raw.result?.points))return null;
 const materials=raw.materials.slice(0,30).filter(m=>typeof m.id==='string'&&typeof m.text==='string').map(m=>({id:m.id.slice(0,200),text:m.text.slice(0,1500),date:typeof m.date==='string'?m.date.slice(0,40):null,url:safeUrl(m.url),locator:typeof m.locator==='string'?m.locator.slice(0,250):''})),ids=new Set(materials.map(m=>m.id));
 const block=p=>typeof p?.text==='string'?{heading:typeof p.heading==='string'?p.heading.slice(0,200):'',text:p.text.slice(0,3000),sourceIds:Array.isArray(p.sourceIds)?p.sourceIds.filter(id=>ids.has(id)).slice(0,30):[]}:null;
 const result={title:String(raw.result.title||'AI解读').slice(0,200),points:raw.result.points.slice(0,30).map(block).filter(Boolean)};if(raw.result.overview)result.overview=block(raw.result.overview);if(raw.result.quality)result.quality={kind:raw.result.quality.kind==='source-excerpts'?'source-excerpts':'analysis',numberWarnings:Math.max(0,Math.min(100,Number(raw.result.quality.numberWarnings)||0)),unmappedBlocks:Math.max(0,Math.min(100,Number(raw.result.quality.unmappedBlocks)||0))};if(['supported','contradicted','unverifiable'].includes(raw.result.verdict))result.verdict=raw.result.verdict;
 return {result,materials,task:typeof raw.task==='string'?raw.task.slice(0,60):'summary',scope:['news','sources','discussion','library','analysis'].includes(raw.scope)?raw.scope:null,createdAt:typeof raw.createdAt==='string'?raw.createdAt.slice(0,50):null,libraryEntryId:typeof raw.libraryEntryId==='string'?raw.libraryEntryId.slice(0,100):null};
}
export function inDateRange(value,start,end) {
  const date=typeof value==='string'?value.slice(0,10):'';
  if(start && end && start>end) return false;
  if((start||end)&&!date) return false;
  return (!start||date>=start)&&(!end||date<=end);
}

let database;
function db() {
  if(!database)database=new Promise((resolve,reject)=>{
    const req=indexedDB.open('zhijian-attachments-v1',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('images');
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  return database;
}
async function transaction(mode,action) {
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('images',mode);let result;
    const req=action(tx.objectStore('images'));
    req.onsuccess=()=>{result=req.result;};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export async function putImage(blob) {
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(blob.type))throw Error('支持 PNG、JPG、WebP 和 GIF 图片');
  if(blob.size>10*1024*1024)throw Error('每张图片最多10MB');
  const id=crypto.randomUUID();await transaction('readwrite',store=>store.put(blob,id));return id;
}
export async function getImage(id){return transaction('readonly',store=>store.get(id));}
export async function deleteImage(id){return transaction('readwrite',store=>store.delete(id));}
export async function imageDataURL(id){const blob=await getImage(id);if(!blob)return null;return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});}
export async function importImage(data){
  if(typeof data!=='string'||!/^data:image\/(png|jpeg|webp|gif);base64,/.test(data))throw Error('备份图片格式无效');
  const [header,encoded]=data.split(',');const binary=atob(encoded);const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  return putImage(new Blob([bytes],{type:header.slice(5,header.indexOf(';'))}));
}

function cleanContext(x){
 if(!x||typeof x!=='object'||Array.isArray(x))return null;
 const str=k=>typeof x[k]==='string'?x[k].slice(0,180):null;
 const weights=x.weights&&typeof x.weights==='object'&&!Array.isArray(x.weights)?Object.fromEntries(Object.entries(x.weights).filter(([k,v])=>k.length<100&&typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100)):null;
 return {createdAt:str('createdAt'),objectId:str('objectId'),objectName:str('objectName'),recordId:str('recordId'),recordLabel:str('recordLabel'),methodVersion:str('methodVersion'),dataVersion:str('dataVersion'),datasetHash:str('datasetHash'),weights,reportDates:Array.isArray(x.reportDates)?x.reportDates.filter(v=>typeof v==='string').slice(0,100):[],sampleFrom:str('sampleFrom'),sampleTo:str('sampleTo')};
}
