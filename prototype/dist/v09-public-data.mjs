import {safeUrl} from './core.mjs';
export const PUBLIC_DATA_BASE='https://raw.githubusercontent.com/rhzhang1007-sys/Fundproject/main/prototype/dist/data/';
export function publicDataUrl(path){
 if(!/^(?:v07\/events\.json|v09\/market-daily\.json|v10\/activity\/(?:funds|stocks)\/\d{2}\.json|v10\/coverage\.json|v11\/observations\/\d{2}\.json|v12\/factors\/\d{2}\.json|v12\/news\/(?:funds|stocks)\/\d{2}\.json|v12\/posts\/(?:funds|stocks)\/[0-9A-Z]{1,12}\.json|archive\/(?:index|\d{4}-(?:0[1-9]|1[0-2]))\.json)$/.test(path))throw Error('公开数据路径无效');
 return PUBLIC_DATA_BASE+path;
}
const dated=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function validatePublicData(path,value){
 if(!value||typeof value!=='object')throw Error('公开资料格式无效');
 if(path.startsWith('v11/observations/')||path.startsWith('v12/factors/')){
  if(value.schemaVersion!==1||!value.funds||typeof value.funds!=='object'||Array.isArray(value.funds))throw Error('每日基金分片无效');
  for(const [code,row] of Object.entries(value.funds))if(!/^[0-9A-Z]{1,12}$/.test(code)||!row||row.snapshot&&(!dated(row.snapshot.date)||row.snapshot.nav!=null&&!Number.isFinite(row.snapshot.nav))||row.asOf&&!dated(row.asOf))throw Error('每日基金日期或数值无效');
 }else if(path.startsWith('v12/posts/')){
  const kind=path.includes('/funds/')?'fund':'stock',code=path.split('/').at(-1).replace('.json','');
  if(value.schemaVersion!==1||value.objectId!==kind+code||!Array.isArray(value.records)||value.records.length>30)throw Error('帖子正文分片无效');
  for(const r of value.records)if(r.objectId!==value.objectId||!dated(r.date)||!safeUrl(r.url)||r.content!=null&&typeof r.content!=='string'||!Array.isArray(r.comments)||r.comments.some(c=>typeof c.text!=='string'))throw Error('帖子或评论格式无效');
 }else if(path==='v10/coverage.json'){
  if(value.schemaVersion!==1||!value.scope)throw Error('覆盖信息无效');
 }else if(/^(?:v10\/activity|v12\/news)\//.test(path)){
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
 try{const response=await fetcher(url,{signal:ctl.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});if(!response.ok)throw Error('公开资料暂不可读');const remote=validatePublicData(path,await response.json());if(path.startsWith('v11/observations/'))return mergeObservations(fallback,remote);if(path.startsWith('v12/factors/'))return {schemaVersion:1,funds:{...fallback?.funds,...Object.fromEntries(Object.entries(remote.funds).map(([code,row])=>[code,(fallback?.funds?.[code]?.asOf||'')>row.asOf?fallback.funds[code]:row]))}};if(path.startsWith('v12/posts/'))return {schemaVersion:1,objectId:remote.objectId,records:mergePosts(fallback?.records,remote.records)};return (path.startsWith('v10/activity/')||path.startsWith('v12/news/'))&&fallback?.objects?mergeActivity(fallback,remote):remote;}
 catch{return fallback;}finally{clearTimeout(timer);}
}
export function mergeActivity(local,remote){
 const union=(a=[],b=[],key=x=>x.id)=>[...new Map([...a,...b].map(x=>[key(x),x])).values()];
 const objects={...local.objects};for(const [id,row] of Object.entries(remote.objects||{})){const old=objects[id]||{},a=old.forum||{},b=row.forum||{};objects[id]={...old,...row,news:union(old.news,row.news),forum:{...a,...b,records:mergePosts(a.records,b.records),metrics:union(a.metrics,b.metrics,x=>x.date),claims:union(a.claims,b.claims,x=>x.date)}};}return {schemaVersion:1,objects,lastCheckedAt:[local.lastCheckedAt,remote.lastCheckedAt].filter(Boolean).sort().at(-1)};
}

export function mergePosts(a=[],b=[]){
 const key=r=>(r.objectId||'')+'|'+r.id,map=new Map(a.map(x=>[key(x),x]));
 for(const row of b){const old=map.get(key(row));if(!old){map.set(key(row),row);continue;}
  const combined={...old,...row};if(old.content&&(!row.content||old.content.length>row.content.length))combined.content=old.content;
  if(Array.isArray(old.comments)||Array.isArray(row.comments))combined.comments=[...new Map([...(old.comments||[]),...(row.comments||[])].map(c=>[c.id,c])).values()];
  combined.coverage={...old.coverage,...row.coverage};
  if(combined.content&&old.coverage?.body==='complete'&&!row.content)combined.coverage.body='complete';
  if(!Array.isArray(row.comments)&&old.coverage?.comments)combined.coverage.comments=old.coverage.comments;
  if(old.boardVerified&&!Object.hasOwn(row,'boardVerified'))combined.boardVerified=true;
  map.set(key(row),combined);
 }
 const sorted=[...map.values()].sort((x,y)=>y.date.localeCompare(x.date)||(y.publishedAt||'').localeCompare(x.publishedAt||'')),counts=new Map();return sorted.filter(r=>{const k=(r.objectId||'')+'|'+r.date,n=(counts.get(k)||0)+1;counts.set(k,n);return n<=30;});
}

export function mergeObservations(local={funds:{}},remote={funds:{}}){const funds={...local?.funds};for(const [code,row] of Object.entries(remote.funds||{})){const old=funds[code]||{},newer=(row.lastSnapshotFetchedAt||'')>(old.lastSnapshotFetchedAt||''),latest=(row.snapshot?.date||'')>(old.snapshot?.date||'')||row.snapshot?.date===old.snapshot?.date&&newer;funds[code]={...old,...row,snapshot:latest?row.snapshot:old.snapshot||row.snapshot,history:(row.history?.points?.length||0)>(old.history?.points?.length||0)?row.history:old.history||row.history};}return {schemaVersion:1,funds};}
