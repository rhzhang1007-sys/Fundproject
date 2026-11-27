// Derived only from the existing accepted NAVs and public foundation. No collection.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {comparisonEntry,comparisonWindows,COMPARISON_METHOD} from './dist/v24-comparison.mjs';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function buildPeerComparison({root=ROOT}={}){
 const started=Date.now(),base=path.join(root,'prototype/dist/data'),read=async p=>JSON.parse(await readFile(path.join(base,p),'utf8')),manifest=await read('v14/manifest.json'),funds={};
 for(let i=0;i<100;i++){
  const shard=String(i).padStart(2,'0'),[profiles,nav]=await Promise.all([read('v10/foundation/funds/'+shard+'.json'),read('v14/nav/'+shard+'.json')]);
  if(nav.version!==manifest.version)throw Error('Comparison requires a single accepted NAV version');
  for(const p of profiles.cards)funds[p.code]=comparisonEntry(p,nav.funds[p.code],manifest);
 }
 const windows=Object.fromEntries(Object.entries(comparisonWindows(manifest.calendar,manifest.asOf)).map(([k,w])=>[k,{label:w.label,from:w.dates[0],to:w.dates.at(-1),observations:w.dates.length-1}]));
 const version=createHash('sha256').update(COMPARISON_METHOD+manifest.version+JSON.stringify(funds)).digest('hex').slice(0,16),data={schemaVersion:1,method:COMPARISON_METHOD,version,sourceVersion:manifest.version,asOf:manifest.asOf,windows,funds,builtAt:new Date().toISOString()},out=path.join(base,'v24');await mkdir(out,{recursive:true});const file=path.join(out,'peer-comparisons.json');await writeFile(file+'.tmp',JSON.stringify(data)+'\n');await rename(file+'.tmp',file);
 return {version,sourceVersion:manifest.version,asOf:manifest.asOf,funds:Object.keys(funds).length,yearReady:Object.values(funds).filter(x=>x.windows.year).length,longReady:Object.values(funds).filter(x=>x.windows.long).length,seconds:(Date.now()-started)/1000};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildPeerComparison()));
