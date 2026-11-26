// One-time repair of the retired FundGuide column mapping. No HTTP; WB inputs stay read-only.
import fs from 'node:fs';import {readFile,writeFile,readdir}from'node:fs/promises';import readline from'node:readline';import path from'node:path';import{fileURLToPath}from'node:url';import{objectShard}from'./dist/v10-objects.mjs';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),json=async p=>JSON.parse(await readFile(p,'utf8')),save=(p,d)=>writeFile(p,JSON.stringify(d)+'\n');
export async function repair({root=ROOT,freshPath,badPath}={}){
 const dist=path.join(root,'prototype/dist/data'),fresh=await json(freshPath),bad=await json(badPath);if(fresh.sourceAdapter!=='eastmoney-daily-nav-v2')throw Error('Require reviewed daily NAV adapter');
 const known=new Set((await json(path.join(dist,'v10/objects.json'))).objects.filter(o=>o.kind==='fund').map(o=>o.code));
 const oldMap=new Map(bad.funds.filter(r=>!r.filledFrom).map(r=>[r.code,r])),newMap=new Map(fresh.funds.map(r=>[r.code,r])),raw=new Map();for await(const line of readline.createInterface({input:fs.createReadStream(path.join(root,'output/净值快照/history/nav-history.jsonl')),crlfDelay:Infinity})){if(line.trim()){const r=JSON.parse(line);if(r.status==='ok')raw.set(r.code,r.rows);}}
 let repairedSnapshots=0,repairedPoints=0,applied=0;
 for(let i=0;i<100;i++){const k=String(i).padStart(2,'0'),p=path.join(dist,`v11/observations/${k}.json`),d=await json(p),rp=path.join(dist,`v11/resources/funds/${k}.json`),resources=await json(rp);
  for(const [code,o]of Object.entries(d.funds)){const old=oldMap.get(code),current=newMap.get(code),original=new Map((raw.get(code)||[]).map(p=>[p[0],p]));
   if(old&&o.history?.points){o.history.points=o.history.points.map(p=>{if(p[0]===old.date&&p[1]===old.nav&&p[2]===old.accNav&&p[3]===old.dayChange){repairedPoints++;return original.get(p[0])||[p[0],p[1],null,old.accNav];}return p;});}
   if(old&&o.snapshot?.date===old.date&&o.snapshot?.nav===old.nav&&o.snapshot?.accNav===old.accNav){o.snapshot={...o.snapshot,accNav:null,dayChange:old.accNav,sourceAdapter:'guide-nav-only-corrected'};repairedSnapshots++;}
   if(current&&(!o.snapshot||current.date>=o.snapshot.date)){o.snapshot=current;o.lastSnapshotFetchedAt=fresh.fetchedAt;applied++;if(o.history?.status==='ok'){const m=new Map(o.history.points.map(p=>[p[0],p]));m.set(current.date,[current.date,current.nav,current.accNav,current.dayChange]);o.history.points=[...m.values()].sort((a,b)=>a[0].localeCompare(b[0]));o.history.count=m.size;}}
   for(const r of resources.objects['fund'+code]||[])if(r.navObservation){r.navObservation.snapshot=o.snapshot;if(o.history?.points?.length)r.navObservation.history={status:'ok',from:o.history.points[0][0],to:o.history.points.at(-1)[0],count:o.history.points.length,basis:'source-nav-observation',totalReturnVerified:false};r.period=o.snapshot?.date||r.period;}
  }
  // New source identities already exist in the website directory but may not have had a snapshot.
  for(const [code,r]of newMap)if(known.has(code)&&objectShard(code)===k&&!d.funds[code]){d.funds[code]={snapshot:r,lastSnapshotFetchedAt:fresh.fetchedAt,totalReturnVerified:false};applied++;}
  await save(p,d);await save(rp,resources);
 }
 for(const file of await readdir(path.join(dist,'v12/nav/daily'))){if(!file.endsWith('.json'))continue;const p=path.join(dist,'v12/nav/daily',file),d=await json(p);if(!d.sourceUrl?.includes('FundGuideapi'))continue;for(const r of d.funds)if(!r.filledFrom&&r.sourceAdapter!=='guide-nav-only-corrected'){r.dayChange=r.accNav;r.accNav=null;r.sourceAdapter='guide-nav-only-corrected';}d.fieldCorrection='导购表第17列是日增长率，未提供累计净值；原第5列不是日增长率。';await save(p,d);}
 await save(path.join(dist,'v12/nav/latest.json'),fresh);await save(path.join(dist,'v12/nav/daily',fresh.asOf+'.json'),fresh);
 const report={schemaVersion:1,at:new Date().toISOString(),adapter:fresh.sourceAdapter,repairedSnapshots,repairedPoints,applied,networkRequests:0,rawWBModified:false};await save(path.join(dist,'v12/nav-field-correction.json'),report);return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await repair({freshPath:process.argv[2],badPath:process.argv[3]})));
