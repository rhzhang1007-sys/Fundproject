// Derive the complete research catalogue from accepted snapshots. No network.
import{readFile,writeFile,mkdir}from'node:fs/promises';import path from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
import{objectShard}from'./dist/v10-objects.mjs';import{checkedNav,feeParts}from'./dist/v14-compute.mjs';
import{correlation,pathExperience,rollingExperience,captureProfile,stockSimilarity,holdingsEvolution,RESEARCH_METHOD}from'./dist/v16-compute.mjs';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function buildResearch({root=ROOT}={}){
 const started=Date.now(),base=path.join(root,'prototype/dist/data'),read=async p=>JSON.parse(await readFile(path.join(base,p))),manifest=await read('v14/manifest.json'),all=new Map(),inverted=new Map(),indices=new Map(),result={},end=manifest.asOf;
 for(let i=0;i<100;i++){const k=String(i).padStart(2,'0'),[cards,fs,ns,hs]=await Promise.all([read('v10/foundation/funds/'+k+'.json'),read('v14/funds/'+k+'.json'),read('v14/nav/'+k+'.json'),read('v14/holdings/'+k+'.json')]);
  for(const card of cards.cards){const rec=fs.funds[card.code]||{},f={code:card.code,name:card.name,type:card.type,profile:card,detailPeriods:hs.funds[card.code]?.periods||[],adjusted:ns.funds[card.code]},c=checkedNav(f.adjusted,card,manifest.calendar,end),full=c.ready?c.points:[],recent=full.slice(-253),basic=full.length?{from:c.from,to:c.to,observations:c.n}:null;
   const family=/联接/.test(card.name)?'联接':/ETF/.test(card.name)?'ETF':card.type,product=card.fullName&&card.managerCompany?card.managerCompany+'|'+card.fullName:card.code;
   const item={...f,product,family,ready:c.ready,historyReason:c.reason,returns:recent.slice(1).map((p,j)=>p[1]/recent[j][1]-1),dates:recent.map(p=>p[0]),stats:basic};
   // Release long daily histories after monthly and most recent return features.
   delete item.points;delete item.adjusted;all.set(card.code,item);
   const idx=card.trackingIndex?.code;if(idx){if(!indices.has(idx))indices.set(idx,[]);indices.get(idx).push(item);}
   const p=[...f.detailPeriods].filter(p=>/-06-30$|-12-31$/.test(p.asOf)).sort((a,b)=>b.asOf.localeCompare(a.asOf))[0];item.latestDetail=p;
   if(p)for(const row of p.rows){const key=p.asOf+'|'+row.code;if(!inverted.has(key))inverted.set(key,[]);inverted.get(key).push({code:card.code,weight:row.weight/100});}
  }
 }
 let withPeers=0,ready=0;
 for(const f of all.values()){
  const overlaps=new Map();if(f.latestDetail)for(const row of f.latestDetail.rows)for(const other of inverted.get(f.latestDetail.asOf+'|'+row.code)||[])if(other.code!==f.code)overlaps.set(other.code,(overlaps.get(other.code)||0)+Math.min(row.weight/100,other.weight));
  const sameIndex=new Set((indices.get(f.profile.trackingIndex?.code)||[]).map(x=>x.code)),possible=[...new Set([...sameIndex,...overlaps.keys()])].map(c=>all.get(c)).filter(x=>x&&x.code!==f.code&&x.product!==f.product&&x.family===f.family&&x.type===f.type&&x.ready&&(sameIndex.has(x.code)||(overlaps.get(x.code)||0)>=.1)).sort((a,b)=>Number(sameIndex.has(b.code))-Number(sameIndex.has(a.code))||(overlaps.get(b.code)||0)-(overlaps.get(a.code)||0)).slice(0,35),seen=new Set(),peers=[];
  for(const b of possible){if(seen.has(b.product))continue;let corr=null;if(f.ready&&f.dates.length>=201&&JSON.stringify(f.dates)===JSON.stringify(b.dates))corr=correlation(f.returns,b.returns);const same=sameIndex.has(b.code),overlap=overlaps.get(b.code)||0;if(!same&&(!(corr>=.65)||overlap<.1))continue;
   seen.add(b.product);peers.push({code:b.code,name:b.name,index:b.profile.trackingIndex?.name||null,match:same?'同指数':'相似持仓',overlap,holdingDate:f.latestDetail?.asOf||null,correlation:corr,fee:feeParts(b.profile)});
   if(peers.length>=12)break;
  }
  const compact={code:f.code,name:f.name,type:f.type,fullName:f.profile.fullName,managerCompany:f.profile.managerCompany,currency:f.profile.currency,fees:f.profile.fees,trackingIndex:f.profile.trackingIndex,sources:f.profile.sources,establishedAt:f.profile.establishedAt};
  result[f.code]={profile:compact,history:{ready:f.ready,reason:f.historyReason,from:f.stats?.from,to:f.stats?.to,count:f.stats?.observations},peers};
  if(f.ready)ready++;if(peers.length)withPeers++;
 }
 const version=createHash('sha256').update(manifest.version+RESEARCH_METHOD).update(await readFile(new URL('./dist/v16-compute.mjs',import.meta.url))).update(JSON.stringify(result)).digest('hex').slice(0,16),out=path.join(base,'v16');await mkdir(out,{recursive:true});
 for(let i=0;i<100;i++){const k=String(i).padStart(2,'0'),funds=Object.fromEntries(Object.entries(result).filter(([code])=>objectShard(code)===k));await writeFile(path.join(out,k+'.json'),JSON.stringify({schemaVersion:1,version,sourceVersion:manifest.version,funds})+'\n');}
 await writeFile(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,version,sourceVersion:manifest.version,method:RESEARCH_METHOD,asOf:end,funds:all.size,ready,withPeers,builtAt:new Date().toISOString()})+'\n');
 return{version,sourceVersion:manifest.version,funds:all.size,ready,withPeers,seconds:(Date.now()-started)/1000};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildResearch()));
