import {safeUrl} from './core.mjs';
export const PUBLIC_DATA_BASE='https://raw.githubusercontent.com/rhzhang1007-sys/Fundproject/main/prototype/dist/data/';
export function publicDataUrl(path){
 if(!/^(?:v07\/events\.json|v09\/market-daily\.json|archive\/(?:index|\d{4}-(?:0[1-9]|1[0-2]))\.json)$/.test(path))throw Error('公开数据路径无效');
 return PUBLIC_DATA_BASE+path;
}
const dated=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function validatePublicData(path,value){
 if(!value||typeof value!=='object')throw Error('公开资料格式无效');
 if(path==='archive/index.json'){
  if(!Array.isArray(value.months)||value.months.some(x=>!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(x)))throw Error('归档目录无效');
 }else if(path==='v09/market-daily.json'){
  if(!Array.isArray(value.boards)||!Array.isArray(value.valuations)||value.boards.some(x=>!/^BK\d+$/.test(x.id)||!dated(x.asOf))||value.valuations.some(x=>!x.indexCode||!dated(x.asOf)))throw Error('市场资料格式无效');
 }else{
  if(!Array.isArray(value.events)||value.events.length>100000||new Set(value.events.map(x=>x.id)).size!==value.events.length||value.events.some(x=>!x.id||!x.title||!dated(x.date)||!safeUrl(x.url)))throw Error('事件资料格式无效');
 }
 return value;
}
export async function loadPublicData(path,fallback,{fetcher=fetch,timeout=8000}={}){
 const url=publicDataUrl(path),ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
 try{const response=await fetcher(url,{signal:ctl.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});if(!response.ok)throw Error('公开资料暂不可读');return validatePublicData(path,await response.json());}
 catch{return fallback;}finally{clearTimeout(timer);}
}
