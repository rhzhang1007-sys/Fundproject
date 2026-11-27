import {checkedNav,feeParts} from './v14-compute.mjs';
import {pathExperience,rollingExperience,percentile} from './v16-compute.mjs';
import {createDataFetcher} from './data-source.mjs';
import {PUBLIC_DATA_BASE} from './v09-public-data.mjs';
export const COMPARISON_METHOD='same-type-common-window-v24-2026-11-27';
export const productFamily=p=>/联接/.test(p.name||'')?'联接':/ETF/.test(p.name||'')?'ETF':'其他';
export function comparisonWindows(calendar,asOf=calendar.at(-1)){
 const end=new Date(asOf+'T00:00:00Z');end.setUTCFullYear(end.getUTCFullYear()-3);const from=end.toISOString().slice(0,10),valid=calendar.filter(d=>d<=asOf);
 return {year:{label:'近252交易日',dates:valid.slice(-253)},long:{label:'近三年',dates:valid.filter(d=>d>=from)}};
}
export function comparisonEntry(profile,adjusted,manifest){
 const c=checkedNav(adjusted,profile,manifest.calendar,manifest.asOf),map=new Map(c.ready?c.points:[]),windows={};
 for(const [key,w] of Object.entries(comparisonWindows(manifest.calendar,manifest.asOf))){
  const dates=w.dates;if(!c.ready||dates.length<201||(key==='year'&&dates.length!==253)||dates.some(d=>!map.has(d))){windows[key]=null;continue;}
  const points=dates.map(d=>[d,map.get(d)]),s=pathExperience(points),rolling=rollingExperience(points,[63])[0];
  windows[key]={totalReturn:s.totalReturn,annualVol:s.annualVol,maxDrawdown:s.maxDrawdown,ulcer:s.ulcer,underwaterShare:s.underwaterShare,win63:rolling.ready?rolling.winShare:null};
 }
 return {code:profile.code,name:profile.name,type:profile.type||'',family:productFamily(profile),indexCode:profile.trackingIndex?.code||'',indexName:profile.trackingIndex?.name||'',fee:feeParts(profile).two,windows};
}
export function comparisonGroup(catalogue,code,ui={},similar=[]){
 const target=catalogue?.funds?.[code];if(!target)return null;
 const scope=ui.peerScope||'type',family=ui.peerFamily||'all',period=ui.peerHorizon==='long'?'long':'year',candidates=new Set([code,...similar.map(x=>x.code)]);
 const members=Object.values(catalogue.funds).filter(x=>x.code===code||(scope==='index'?target.indexCode&&x.indexCode===target.indexCode:scope==='similar'?candidates.has(x.code):target.type&&x.type===target.type)).filter(x=>x.code===code||family==='all'||x.family===family);
 const rows=members.map(x=>({...x,...(x.windows?.[period]||{}),ready:Boolean(x.windows?.[period])})),current=rows.find(x=>x.code===code),statistics={};
 for(const [key,direction] of [['totalReturn','desc'],['annualVol','asc'],['maxDrawdown','asc'],['ulcer','asc'],['win63','desc'],['fee','asc']]){
  const others=rows.filter(x=>x.code!==code&&Number.isFinite(x[key])).map(x=>x[key]),all=rows.filter(x=>Number.isFinite(x[key])),value=current?.[key];
  const median=percentile(others,.5);statistics[key]={value:Number.isFinite(value)?value:null,difference:Number.isFinite(value)&&Number.isFinite(median)?value-median:null,median,p25:percentile(others,.25),p75:percentile(others,.75),others:others.length,n:all.length,rank:Number.isFinite(value)?1+all.filter(x=>direction==='desc'?x[key]>value+1e-12:x[key]<value-1e-12).length:null};
 }
 const sort=['totalReturn','annualVol','maxDrawdown','ulcer','fee'].includes(ui.peerSort)?ui.peerSort:'totalReturn',direction=sort==='totalReturn'?-1:1,q=String(ui.peerSearch||'').trim().toLowerCase();
 const filtered=rows.filter(x=>x.code!==code&&(!q||(x.name+x.code).toLowerCase().includes(q))).sort((a,b)=>{const af=Number.isFinite(a[sort]),bf=Number.isFinite(b[sort]);return Number(bf)-Number(af)||(af&&bf?(a[sort]-b[sort])*direction:0)||a.code.localeCompare(b.code);});
 const pages=Math.max(1,Math.ceil(filtered.length/25)),page=Math.max(0,Math.min(pages-1,Number.isInteger(ui.peerPage)?ui.peerPage:0));
 return {target:current,rows,statistics,scope,period,window:catalogue.windows[period],asOf:catalogue.asOf,comparisonCount:rows.length-1,complete:rows.filter(x=>x.ready).length,page,pages,filteredCount:filtered.length,visible:[current,...filtered.slice(page*25,(page+1)*25)],method:catalogue.method};
}
export function createComparisonStore(fetcher=fetch){
 const fetchJSON=createDataFetcher({fetcher});let pending;
 const valid=x=>x?.schemaVersion===1&&x.method===COMPARISON_METHOD&&typeof x.version==='string'&&x.funds&&x.windows?.year?.from&&x.windows?.long?.from&&Object.entries(x.funds).every(([code,f])=>f.code===code);
 async function read(url){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),25000);try{const r=await fetchJSON(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:ctl.signal});if(!r.ok)throw Error('同类对比资料正在更新');const d=await r.json();if(!valid(d))throw Error('同类对比资料格式待更新');return d;}finally{clearTimeout(timer);}}
 return {load(){return pending??=(async()=>{const [a,b]=await Promise.allSettled([read('./data/v24/peer-comparisons.json'),read(PUBLIC_DATA_BASE+'v24/peer-comparisons.json')]),local=a.status==='fulfilled'?a.value:null,remote=b.status==='fulfilled'?b.value:null;if(remote&&(!local||remote.asOf>=local.asOf&&Object.keys(remote.funds).length>=Object.keys(local.funds).length))return remote;if(local)return local;if(remote)return remote;throw Error('同类对比资料暂未读到，请重新读取');})().catch(e=>{pending=null;throw e;});},reset(){pending=null;}};
}
