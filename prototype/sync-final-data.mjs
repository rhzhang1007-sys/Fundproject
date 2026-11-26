// Import audited WB final data. No HTTP and no writes to WB inputs.
import fs from 'node:fs';import {readFile,writeFile,mkdir,stat,rename} from 'node:fs/promises';import path from 'node:path';import readline from 'node:readline';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {objectShard,validateRelations} from './dist/v10-objects.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.dirname(HERE),json=async p=>JSON.parse(await readFile(p,'utf8'));
const atomic=async(p,d)=>{await mkdir(path.dirname(p),{recursive:true});await writeFile(p+'.tmp',JSON.stringify(d)+'\n');await rename(p+'.tmp',p);};
export function sourcePeriod(code,p,retrievedAt){
 if(!/^\d{4}-(?:03-31|06-30|09-30|12-31)$/.test(p.asOf||'')||!Array.isArray(p.rows))throw Error('Invalid source report date');
 const map=new Map();for(const r of p.rows){if(!/^\d{6}$/.test(r.code)||!Number.isFinite(r.weight)||r.weight<0||r.weight>100)throw Error('Invalid source stock weight');(map.get(r.code)||map.set(r.code,[]).get(r.code)).push(r);}
 const holdings=[...map].map(([code,rows])=>({code,name:rows[0].name,weightPercent:rows.length===1?rows[0].weight:null,...(rows.length>1?{weightStatus:'source-lines-unresolved',sourceWeightVariants:rows.map(r=>r.weight)}:{})}));
 return {fundCode:code,asOf:p.asOf,complete:false,verified:false,denominator:'net-assets-percent-source-observation',source:'东方财富持仓披露表',url:'https://fundf10.eastmoney.com/ccmx_'+code+'.html',retrievedAt,publishedAt:null,rawRowCount:p.rows.length,rowLimitMayApply:true,sourceTier:'detailed-source',holdings};
}
export function mergePeriods(entry,incoming){const by=new Map((entry.periods||[]).map(p=>[p.asOf,p]));for(const p of incoming){const old=by.get(p.asOf);if(old?.verified)continue;if(!old||p.holdings.length>=old.holdings.length)by.set(p.asOf,p);}return {...entry,periods:[...by.values()].sort((a,b)=>b.asOf.localeCompare(a.asOf))};}
export async function syncFinal({root=ROOT,source=path.join(ROOT,'output/公共数据包-2026-11-24')}={}){
 const started=Date.now(),dist=path.join(root,'prototype/dist/data'),inputs=[],now=new Date().toISOString(),meta=new Map(),rawHoldings=new Map();
 async function lines(p,visit){const before=await stat(p),stream=fs.createReadStream(p),hash=createHash('sha256');stream.on('data',b=>hash.update(b));for await(const l of readline.createInterface({input:stream,crlfDelay:Infinity})){if(l.trim())visit(JSON.parse(l));}const after=await stat(p);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Source changed during import');inputs.push({path:path.relative(root,p),bytes:after.size,sha256:hash.digest('hex')});}
 async function snapshot(p){const a=await stat(p),raw=await readFile(p),b=await stat(p);if(a.size!==b.size||a.mtimeMs!==b.mtimeMs)throw Error('Source changed during import');inputs.push({path:path.relative(root,p),bytes:b.size,sha256:createHash('sha256').update(raw).digest('hex')});return JSON.parse(raw);}
 const states=await snapshot(path.join(source,'funds/holdings-status.json')),fof=new Map(),via=await snapshot(path.join(source,'funds/holdings-via-etf.json'));await lines(path.join(source,'funds/holdings-fof.jsonl'),r=>fof.set(r.code,r));await lines(path.join(source,'funds/fund-holdings-top100.jsonl'),r=>{meta.set(r.code,r.fetchedAt||null);const periods=(r.periods||[]).filter(p=>/^\d{4}-(?:03-31|06-30|09-30|12-31)$/.test(p.asOf||'')&&p.rows?.length);if(periods.length)rawHoldings.set(r.code,{periods});});
 let updated=0,protectedPeriods=0,sourceEntries=0,shardedDetailedFunds=0;const tiers={};
 for(let i=0;i<100;i++){
  const k=String(i).padStart(2,'0'),file=path.join(dist,`v11/relationships/${k}.json`),data=await json(file),src=await snapshot(path.join(source,`分片/holdings/${k}.json`)),resources=await json(path.join(dist,`v11/resources/funds/${k}.json`)),extra=await json(path.join(dist,`v13/funds/${k}.json`));
  shardedDetailedFunds+=Object.keys(src.funds).length;
  // Detailed display shards exclude smaller partial reports. They are still real
  // collected source rows and must not leave an older partial report on screen.
  const incoming={...src.funds,...Object.fromEntries([...rawHoldings].filter(([code])=>objectShard(code)===k))};
  for(const [code,r]of Object.entries(incoming)){if(objectShard(code)!==k||r.fundCode&&r.fundCode!==code)throw Error('Source shard identity mismatch');const old=data.funds[code]||{fundCode:code,periods:[]};protectedPeriods+=old.periods.filter(p=>p.verified).length;const next=mergePeriods(old,r.periods.map(p=>sourcePeriod(code,p,meta.get(code))));validateRelations(next,code);data.funds[code]=next;updated++;sourceEntries++;}
  for(const [code,entry]of Object.entries(data.funds)){
   entry.status=states.status[code]?.status||entry.status||'not-collected';entry.sourceTier=entry.periods.some(p=>/-06-30$|-12-31$/.test(p.asOf)&&p.holdings.length)?'detailed':'top10';tiers[entry.status]=(tiers[entry.status]||0)+1;
   const item={...(extra.funds[code]||{}),status:entry.status,statusObservedAt:states.builtAt,heldFunds:fof.get(code)?.heldFunds||[],heldBonds:fof.get(code)?.heldBonds||[],fundHoldingsAsOf:null,fundHoldingsFetchedAt:fof.get(code)?.fetchedAt||null,targetReference:(via.items||via)[code]||null};extra.funds[code]=item;
   const previous=(resources.objects['fund'+code]||[]).filter(s=>!s.id.startsWith('holdings-')&&!s.id.startsWith('fof-'));
   for(const p of entry.periods)previous.push({id:`holdings-${code}-${p.asOf}`,title:`${p.asOf} 股票持仓明细 · ${p.holdings.length}只`,entities:['fund'+code],publisher:p.source,cadence:'periodic',period:p.asOf,publishedAt:p.publishedAt||null,retrievedAt:p.retrievedAt,url:p.url,contentCoverage:'source-table',holdings:p.holdings,complete:p.complete,verified:p.verified});
   if(item.heldFunds.length)previous.push({id:'fof-'+code,title:'持有基金明细',entities:['fund'+code],publisher:'东方财富持仓披露表',cadence:'periodic',period:null,retrievedAt:item.fundHoldingsFetchedAt,url:'https://fundf10.eastmoney.com/ccmx_'+code+'.html',contentCoverage:'source-table',summary:item.heldFunds.map(x=>`${x.fundName}（${x.fundCode}）：${x.weight}%`).join('\n')});
   resources.objects['fund'+code]=previous;
  }
  await atomic(file,data);await atomic(path.join(dist,`v11/resources/funds/${k}.json`),resources);extra.builtAt=now;await atomic(path.join(dist,`v13/funds/${k}.json`),extra);
 }
 const hist=Array.from({length:100},()=>({}));let histories=0;
 await lines(path.join(root,'output/净值快照/history/nav-history.jsonl'),r=>{if(r.status!=='ok'||!Array.isArray(r.rows)||!r.rows.length)return;hist[Number(objectShard(r.code))][r.code]=r;histories++;});
 for(let i=0;i<100;i++){
  const k=String(i).padStart(2,'0'),op=path.join(dist,`v11/observations/${k}.json`),data=await json(op),rp=path.join(dist,`v11/resources/funds/${k}.json`),resources=await json(rp);
  for(const [code,r]of Object.entries(hist[i])){const old=data.funds[code]||{},merged=new Map((old.history?.points||[]).map(p=>[p[0],p]));for(const row of r.rows)merged.set(row[0],row);const points=[...merged.values()].sort((a,b)=>a[0].localeCompare(b[0])),p=points.at(-1),ob={...old,history:{status:'ok',points,count:points.length,basis:'source-nav-observation',totalReturnVerified:false,retrievedAt:r.fetchedAt||r.retrievedAt||null,ingestedAt:now},totalReturnVerified:false};if(!ob.snapshot||p[0]>ob.snapshot.date)ob.snapshot={code,name:r.name,date:p[0],nav:p[1],accNav:p[2],dayChange:p[3]};data.funds[code]=ob;const rows=resources.objects['fund'+code]||[];resources.objects['fund'+code]=[...rows.filter(s=>s.id!=='nav-'+code),{id:'nav-'+code,title:'基金净值历史',entities:['fund'+code],publisher:'东方财富净值接口',cadence:'profile',url:'https://fundf10.eastmoney.com/jjjz_'+code+'.html',contentCoverage:'source-values',publishedAt:null,period:p[0],navObservation:{snapshot:ob.snapshot,history:{status:'ok',from:points[0][0],to:p[0],count:points.length,basis:'source-nav-observation',totalReturnVerified:false}}}];}
  // Histories are loaded lazily from observations, not duplicated in resource shards.
  for(const rows of Object.values(resources.objects))for(const r of rows)if(r.navObservation?.history?.points){r.navObservation.history.count=r.navObservation.history.points.length;delete r.navObservation.history.points;}
  await atomic(op,data);await atomic(rp,resources);hist[i]=null;
 }
 const report={schemaVersion:1,finalBatch:true,ingestedAt:now,sourceEntries,shardedDetailedFunds,updated,protectedPeriods,histories,states:tiers,sourceInputs:inputs,networkRequests:0,seconds:(Date.now()-started)/1000};await atomic(path.join(dist,'v11/final-import-status.json'),report);const status=await json(path.join(dist,'v13/status.json'));Object.assign(status,{builtAt:now,states:tiers,detailedFunds:shardedDetailedFunds,historyFunds:histories,finalImport:'v11/final-import-status.json'});await atomic(path.join(dist,'v13/status.json'),status);return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){console.log(JSON.stringify(await syncFinal()));}
