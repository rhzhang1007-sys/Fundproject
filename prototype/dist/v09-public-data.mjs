import {safeUrl} from './core.mjs';
export const PUBLIC_DATA_BASE='https://raw.githubusercontent.com/rhzhang1007-sys/Fundproject/main/prototype/dist/data/';
export function publicDataUrl(path){
 if(!/^(?:v07\/events\.json|v09\/market-daily\.json|v10\/activity\/(?:funds|stocks)\/\d{2}\.json|v10\/coverage\.json|archive\/(?:index|\d{4}-(?:0[1-9]|1[0-2]))\.json)$/.test(path))throw Error('公开数据路径无效');
 return PUBLIC_DATA_BASE+path;
}
const dated=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function validatePublicData(path,value){
 if(!value||typeof value!=='object')throw Error('公开资料格式无效');
 if(path==='v10/coverage.json'){
  if(value.schemaVersion!==1||!value.scope)throw Error('覆盖信息无效');
 }else if(/^v10\/activity\//.test(path)){
  const kind=path.includes('/funds/')?'fund':'stock';
  if(value.schemaVersion!==1||!value.objects||typeof value.objects!=='object'||Array.isArray(value.objects))throw Error('对象资料格式无效');
  for(const [id,row] of Object.entries(value.objects)){if(!new RegExp('^'+kind+'[0-9A-Z]{1,12}$').test(id)||!Array.isArray(row.news))throw Error('对象标签无效');validatePublicData('v07/events.json',{events:row.news});for(const record of row.forum?.records||[])if(record.objectId!==id||!record.id||!dated(record.date)||!safeUrl(record.url))throw Error('帖子对象无效');}
 }else if(path==='archive/index.json'){
  if(!Array.isArray(value.months)||value.months.some(x=>!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(x)))throw Error('归档目录无效');
 }else if(path==='v09/market-daily.json'){
  if(!Array.isArray(value.boards)||!Array.isArray(value.valuations)||value.boards.some(x=>!/^BK\d+$/.test(x.id)||!dated(x.asOf))||value.valuations.some(x=>!x.indexCode||!dated(x.asOf)))throw Error('市场资料格式无效');
 }else{
  if(!Array.isArray(value.events)||value.events.length>100000||new Set(value.events.map(x=>x.id)).size!==value.events.length||value.events.some(x=>!x.id||!x.title||!dated(x.date)||!safeUrl(x.url)||x.analysis&&(!Array.isArray(x.analysis.points)||x.analysis.points.length>5||x.analysis.points.some(p=>typeof p.text!=='string'||!Array.isArray(p.sourceIds)||p.sourceIds.some(id=>id!==x.id)))))throw Error('事件资料格式无效');
 }
 return value;
}
export async function loadPublicData(path,fallback,{fetcher=fetch,timeout=8000}={}){
 const url=publicDataUrl(path),ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
 try{const response=await fetcher(url,{signal:ctl.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});if(!response.ok)throw Error('公开资料暂不可读');const remote=validatePublicData(path,await response.json());return path.startsWith('v10/activity/')&&fallback?.objects?mergeActivity(fallback,remote):remote;}
 catch{return fallback;}finally{clearTimeout(timer);}
}
export function mergeActivity(local,remote){
 const union=(a=[],b=[],key=x=>x.id)=>[...new Map([...a,...b].map(x=>[key(x),x])).values()];
 const objects={...local.objects};for(const [id,row] of Object.entries(remote.objects||{})){const old=objects[id]||{},a=old.forum||{},b=row.forum||{};objects[id]={...old,...row,news:union(old.news,row.news),forum:{...a,...b,records:union(a.records,b.records),metrics:union(a.metrics,b.metrics,x=>x.date),claims:union(a.claims,b.claims,x=>x.date)}};}return {schemaVersion:1,objects};
}
