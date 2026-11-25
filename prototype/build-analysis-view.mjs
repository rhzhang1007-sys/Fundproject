// Read existing WB/public snapshots and aggregate display data. No HTTP or collection.
import {readFile,writeFile,mkdir,rename,stat,readdir} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {V7_METHOD,feeParts,peerKey,names,checkedNav,navMetrics,concentrationTrend,quantile,rSquared,scoreFactors} from './dist/v14-compute.mjs';
import {objectShard as shard} from './dist/v10-objects.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.dirname(HERE);
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const write=async(p,d)=>{await mkdir(path.dirname(p),{recursive:true});await writeFile(p+'.tmp',JSON.stringify(d)+'\n');await rename(p+'.tmp',p);};
export async function buildView({root=ROOT,source=null,asOf=null,navSource=null}={}){
 const started=Date.now(),dist=path.join(root,'prototype/dist/data'),out=path.join(dist,'v14'),inputs=[];
 asOf??=new Date(Date.parse(today()+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const snapshot=async p=>{const a=await stat(p),raw=await readFile(p),b=await stat(p);if(a.size!==b.size||a.mtimeMs!==b.mtimeMs)throw Error('WB输入正在更新，保留已有前端快照');inputs.push({path:path.relative(root,p),bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')});return raw;};
 const registry=(await json(path.join(dist,'v10/objects.json'))).objects.filter(x=>x.kind==='fund'),cards=new Map();
 for(let i=0;i<100;i++)for(const c of (await json(path.join(dist,`v10/foundation/funds/${String(i).padStart(2,'0')}.json`))).cards)cards.set(c.code,c);
 const calendar=(await json(path.join(dist,'v11/market.json'))).calendar.dates.filter(d=>d<=asOf);
 let nav={},details={},states={},rawBasics=null,crossAcc={};
 if(source){
  const base=path.resolve(source),navPath=path.resolve(root,navSource||'output/净值快照/history/nav-adjusted.jsonl');
  const raw=await snapshot(navPath);for(const line of raw.toString().split(/\r?\n/).filter(Boolean)){const r=JSON.parse(line);nav[r.code]=r;}
  // Existing WB raw history provides date-matched accumulated NAV endpoints only.
  // This is the same source and remains a heuristic, not external verification.
  try{const rawHistory=await snapshot(path.join(path.dirname(navPath),'nav-history.jsonl'));for(const line of rawHistory.toString().split(/\r?\n/).filter(Boolean)){const r=JSON.parse(line),n=nav[r.code];if(!n)continue;const points=n.points.filter(p=>p[0]<=asOf),wanted=new Set([points[0]?.[0],points.at(-1)?.[0]]);crossAcc[r.code]=new Map((r.rows||[]).filter(p=>wanted.has(p[0])).map(p=>[p[0],p[2]]));}}catch(e){console.error('Existing raw history unavailable or being updated; date-matched screening stays pending.');}
  states=JSON.parse(await snapshot(path.join(base,'funds/holdings-status.json'))).status;
  rawBasics=(await snapshot(path.join(base,'funds/fund-basics.jsonl'))).toString().split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
  // Use the accepted, identity-bound website records. WB's in-progress display
  // shards repeated one portfolio for 5,563 different codes and are isolated.
  for(let i=0;i<100;i++){const d=JSON.parse(await snapshot(path.join(dist,`v11/relationships/${String(i).padStart(2,'0')}.json`)));for(const [code,r]of Object.entries(d.funds)){if(r.fundCode!==code)throw Error('Accepted holdings identity mismatch');details[code]={periods:r.periods.map(p=>({...p,rows:p.holdings.map(x=>({code:x.code,name:x.name,weight:x.weightPercent})),complete:p.complete===true}))};}}
 }else{
  for(let i=0;i<100;i++){const k=String(i).padStart(2,'0');try{Object.assign(nav,(await json(path.join(out,`nav/${k}.json`))).funds);Object.assign(details,(await json(path.join(out,`holdings/${k}.json`))).funds);Object.assign(states,(await json(path.join(out,`funds/${k}.json`))).funds);}catch{}}
  try{inputs.push(...(await json(path.join(out,'manifest.json'))).inputs);}catch{}
 }
 const rawMap=new Map((rawBasics||[]).map(r=>[r.code,r]));
 // Reuse public observations for the date-matched heuristic; no new source is read.
 for(let i=0;i<100;i++){
  const observations=(await json(path.join(dist,`v11/observations/${String(i).padStart(2,'0')}.json`))).funds;
  for(const [code,n] of Object.entries(nav)){if(shard(code)!==String(i).padStart(2,'0'))continue;const originalTo=n.to;n.points=(n.points||[]).filter(p=>p[0]<=asOf);let last=n.points?.at(-1);if(!last)continue;const m=new Map((observations[code]?.history?.points||[]).map(p=>[p[0],p]));let extended=false;
   if(!source&&n.quality==='clean')
   for(const d of calendar.filter(d=>d>last[0]&&d<=asOf)){const p=m.get(d);if(!p||!Number.isFinite(p[3])||p[3]<=-100)break;const r=p[3]/100;if(Math.abs(r)>.22){n.quality='flagged';n.qualityNote='新增来源日增长率需复核';break;}last=[d,last[1]*(1+r)];n.points.push(last);extended=true;}
   n.to=n.points.at(-1)[0];n.count=n.points.length;n.totalReturn=n.points.at(-1)[1]/n.points[0][1]-1;
   if(extended||originalTo!==n.to){const a=crossAcc[code]?.get(n.points[0][0])??m.get(n.points[0][0])?.[2],b=crossAcc[code]?.get(n.to)??m.get(n.to)?.[2];n.crossCheck=Number.isFinite(a)&&a>0&&Number.isFinite(b)&&b>0?(Math.abs(n.points.at(-1)[1]/n.points[0][1]-b/a)<=.02?'agree':'divergent'):'unavailable';n.crossDiff=Number.isFinite(a)&&a>0&&Number.isFinite(b)&&b>0?Math.abs(n.points.at(-1)[1]/n.points[0][1]-b/a):null;n.totalReturnAccBasis=Number.isFinite(a)&&a>0&&Number.isFinite(b)&&b>0?b/a-1:null;}
   n.crossCheckMeaning='同源不同净值口径的保守筛查；不等于独立来源核实，也不证明两口径经济含义相同';
  }
 }
 const codeHash=createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).update(await readFile(path.join(HERE,'dist/v14-compute.mjs'))).digest('hex');
 const version=createHash('sha256').update(codeHash+V7_METHOD+asOf+JSON.stringify(inputs)+JSON.stringify(Object.entries(nav).map(([c,r])=>[c,r.to,r.count,r.quality]))).digest('hex').slice(0,16),managers=new Map(),records=new Map();
 for(const obj of registry){const card=cards.get(obj.code)||obj,raw=rawMap.get(obj.code),company=raw?.managerCompany||card.managerCompany||'',managerNames=names(raw?.managers??card.managers);for(const name of managerNames){const key=company+'|'+name;const m=managers.get(key)||{key,name,company,count:0};m.count++;managers.set(key,m);}}
 const singleIndex={};for(const card of cards.values()){const k=card.trackingIndex?.code;if(k)(singleIndex[k]??=[]).push(card);}
 const groups=new Map();
 for(const obj of registry){const card=cards.get(obj.code)||obj,checked=checkedNav(nav[obj.code],card,calendar,asOf),detail=details[obj.code]||{},detailPeriods=detail.periods?.map(p=>({...p,rows:p.rows||p.holdings?.map(r=>({code:r.code,name:r.name,weight:r.weightPercent})),complete:p.complete===true}))||[];
  const item={...obj,profile:card,detailPeriods,adjusted:nav[obj.code],status:states[obj.code]?.status||states[obj.code]?.holdingStatus||'not-collected',checked,metrics:navMetrics(checked),fees:feeParts(card),peerKey:peerKey(card)};
  item.trend=concentrationTrend(item);const raw=rawMap.get(obj.code),company=raw?.managerCompany||card.managerCompany||'';item.managerDetails=!source&&states[obj.code]?.managerDetails?states[obj.code].managerDetails:names(raw?.managers??card.managers).map(name=>managers.get(company+'|'+name));records.set(obj.code,item);if(item.peerKey)(groups.get(item.peerKey)||groups.set(item.peerKey,[]).get(item.peerKey)).push(item);
 }
 function feeCompare(item){const form=r=>/联接/.test(r.name)?'link':/ETF/.test(r.name)?'etf':'other';let pool=singleIndex[item.profile.trackingIndex?.code]?.map(c=>records.get(c.code)).filter(r=>r&&r.type===item.type&&form(r)===form(item))||[],basis='同指数';if(pool.length<2){pool=groups.get(item.peerKey)||[];basis='同类型与规模档';}
  const total=pool.filter(r=>r.fees.total!==null),useTotal=item.fees.total!==null&&total.length>=(basis==='同指数'?2:5),eligible=(useTotal?total:pool.filter(r=>r.fees.two!==null));const value=useTotal?item.fees.total:item.fees.two,min=eligible.length?Math.min(...eligible.map(r=>useTotal?r.fees.total:r.fees.two)):null;
  if(value===null||min===null||eligible.length<(basis==='同指数'?2:5))return {ready:false,reason:'缺少同口径费率或可比样本'};
  const lower=eligible.filter(r=>(useTotal?r.fees.total:r.fees.two)<value-1e-12).length;return {ready:true,basis,components:useTotal?'管理＋托管＋销售服务':'管理＋托管（销售服务未齐）',value,minimum:min,differenceRate:Math.max(0,value-min),rank:1+lower,n:eligible.length,percentile:lower/eligible.length,items:eligible.map(r=>({code:r.code,name:r.name,rate:useTotal?r.fees.total:r.fees.two})).sort((a,b)=>a.rate-b.rate).slice(0,6)};
 }
 const dates=calendar.slice(-251),start=dates[0],end=dates.at(-1);
 for(const members of groups.values()){
  const series=[];
  for(const r of members){const m=new Map(r.checked.points||[]);if(dates.length===251&&dates.every(d=>m.has(d))){const points=dates.map(d=>[d,m.get(d)]);r.reference=navMetrics({ready:true,points,from:start,to:end});r.peerReturns=points.slice(1).map((p,i)=>p[1]/points[i][1]-1);series.push(r);} }
  const sums=dates.slice(1).map((_,i)=>series.reduce((s,r)=>s+r.peerReturns[i],0));
  if(series.length>=31)for(const r of series)r.peerR2={ready:true,value:rSquared(r.peerReturns.map((v,i)=>[v,(sums[i]-v)/(series.length-1)])),n:series.length-1,observations:250,from:start,to:end,basis:'同类型与规模档等权均值（剔除本基金）'};
  const anchors=[];for(let y=1;y<=3;y++){const d=new Date(end+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-y);const cut=d.toISOString().slice(0,10);anchors.push(calendar.filter(t=>t>=cut&&(Date.parse(t)-Date.parse(cut))/86400000<=7).find(t=>members.filter(r=>r.checked.ready&&r.checked.points.some(p=>p[0]===t)&&r.checked.to===end).length>=30));}
  const stable=members.filter(r=>r.checked.ready&&r.checked.to===end&&anchors.every(d=>d&&r.checked.points.some(p=>p[0]===d)));
  if(stable.length>=30){const values=stable.map(r=>{const m=new Map(r.checked.points);return anchors.map(d=>m.get(end)/m.get(d)-1);});for(let i=0;i<stable.length;i++){const ranks=anchors.map((_,k)=>quantile(values.map(v=>v[k]),values[i][k])),avg=ranks.reduce((s,x)=>s+x,0)/3;stable[i].stability=Math.sqrt(ranks.reduce((s,x)=>s+(x-avg)**2,0)/3);stable[i].stabilityWindow={anchors,to:end,n:stable.length};}}
  const cohorts={cost:[],downside:series.map(r=>r.reference.maxDrawdown),experience:series.map(r=>r.reference.positiveDayRatio),stability:stable.length>=30?stable.map(r=>r.stability):[],size:members.filter(r=>r.profile.netAssets?.asOf).map(r=>r.profile.netAssets.valueYi).filter(Number.isFinite),holdingsChange:members.filter(r=>r.trend.ready).map(r=>r.trend.cosineDistance).filter(Number.isFinite)};
  const useTotal=members.filter(x=>x.fees.total!==null).length>=30,feeValues=members.map(x=>useTotal?x.fees.total:x.fees.two).filter(Number.isFinite);
  for(const r of members){r.feeCompare=feeCompare(r);r.peerScore=scoreFactors({cost:useTotal?r.fees.total:r.fees.two,downside:r.reference?.maxDrawdown,experience:r.reference?.positiveDayRatio,stability:r.stability,size:r.profile.netAssets?.asOf?r.profile.netAssets.valueYi:null,holdingsChange:r.trend.ready?r.trend.cosineDistance:null},{...cohorts,cost:feeValues});r.peerScore.costBasis=useTotal?'管理＋托管＋销售服务':'管理＋托管';r.peer={key:r.peerKey,count:members.length,from:start,to:end,returnSamples:series.length,medianDrawdown:series.length>=30?[...cohorts.downside].sort((a,b)=>a-b)[Math.floor(series.length/2)]:null,targetDrawdown:r.reference?.maxDrawdown??null};}
  const masks=new Map();for(const r of members.filter(r=>r.peerScore?.ready)){const k=r.peerScore.factors.filter(f=>f.ready).map(f=>f.key).join('|');(masks.get(k)||masks.set(k,[]).get(k)).push(r);}
  for(const pool of masks.values())for(const r of pool){r.peerScore.comparableCount=pool.length;r.peerScore.percentile=pool.length>=30?quantile(pool.map(x=>x.peerScore.score),r.peerScore.score):null;}
 }
 const changedEvents=[];for(const file of await readdir(path.join(dist,'v12/news/funds'))){const d=await json(path.join(dist,'v12/news/funds',file));for(const [id,v] of Object.entries(d.objects||{}))for(const e of v.news||[])if(/离任|增聘|基金经理变更|基金经理调整/.test(e.title))changedEvents.push([id,e]);}
 const stage=path.join(root,'tmp/v7-display-build');await mkdir(stage,{recursive:true});let usable=0;
 for(let i=0;i<100;i++){
  const k=String(i).padStart(2,'0'),funds={},ns={},hs={};
  for(const r of records.values()){if(shard(r.code)!==k)continue;const changes=[...new Map(changedEvents.filter(([id,e])=>id===r.id&&e.date<=asOf&&e.date>=new Date(Date.parse(asOf)-89*86400000).toISOString().slice(0,10)).map(([,e])=>[e.id,{id:e.id,date:e.date,title:e.title,url:e.url}])).values()];funds[r.code]={code:r.code,status:r.status,metrics:r.metrics,peer:r.peer,peerR2:r.peerR2||{ready:false,reason:'需至少30个其他同类及250个共同日收益'},peerScore:r.peerScore||{ready:false,reason:'缺少类型或规模分组'},feeCompare:r.feeCompare||feeCompare(r),managerDetails:r.managerDetails,managerChanges:changes,managerChangeWindow:'仅已收录资料（当前主要为近30天）',trend:r.trend};if(r.metrics.ready)usable++;if(r.adjusted)ns[r.code]=r.adjusted;if(r.detailPeriods.length)hs[r.code]={periods:r.detailPeriods};}
  await write(path.join(stage,`funds/${k}.json`),{schemaVersion:1,version,funds});await write(path.join(stage,`nav/${k}.json`),{schemaVersion:1,version,funds:ns});await write(path.join(stage,`holdings/${k}.json`),{schemaVersion:1,version,funds:hs});
 }
 const manifest={schemaVersion:1,version,method:V7_METHOD,asOf,builtAt:new Date().toISOString(),funds:records.size,withAdjustedHistory:Object.keys(nav).length,usableRisk:usable,inputs,calendar,verifiedTotalReturn:false,waitingForWBNextBatch:true,collectionPerformed:false,peerWindow:{from:start,to:end,returns:250}};
 await write(path.join(stage,'manifest.json'),manifest);await mkdir(out,{recursive:true});for(const folder of ['funds','nav','holdings']){await mkdir(path.join(out,folder),{recursive:true});for(const file of await readdir(path.join(stage,folder)))await write(path.join(out,folder,file),await json(path.join(stage,folder,file)));}await write(path.join(out,'manifest.json'),manifest);
 return {version,funds:records.size,withAdjustedHistory:Object.keys(nav).length,usableRisk:usable,seconds:(Date.now()-started)/1000,collectionPerformed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const a=process.argv.slice(2),arg=k=>a.includes(k)?a[a.indexOf(k)+1]:null;console.log(JSON.stringify(await buildView({source:arg('--source'),asOf:arg('--as-of'),navSource:arg('--nav')})));}
