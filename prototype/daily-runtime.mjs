// Execution markers for staggered cron retries; data completeness is reported separately.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export const localDay=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now);
export function shouldRun(marker,job,day=localDay()){return !marker||marker.job!==job||marker.executionDay!==day||marker.executed!==true||marker.retryNeeded===true;}
async function read(p){try{return JSON.parse(await readFile(p,'utf8'));}catch{return null;}}
export async function runtime({action,job,root=path.dirname(HERE),day=localDay()}={}){
 if(!['nav','index','news'].includes(job)||!['check','mark'].includes(action))throw Error('Unknown daily runtime job/action');
 const dist=path.join(root,'prototype/dist/data'),file=path.join(dist,'v14/runtime',job+'.json');
 if(action==='check')return {run:shouldRun(await read(file),job,day),job,day};
 const status=await read(path.join(dist,job==='nav'?'v12/nav/latest.json':job==='index'?'v13/index-status.json':'v09/update-status.json'));
 const date=s=>s&&Number.isFinite(Date.parse(s))?localDay(new Date(s)):null;
 const ok=job==='nav'?date(status?.fetchedAt)===day&&status?.meta?.freshRecords>0:job==='index'?date(status?.attemptedAt)===day&&(status?.updated>0||status?.alreadyCurrent>0):status?.newsReady===true&&date(status?.attemptedAt)===day;
 if(!ok)throw Error('No successful source execution for this day; retry remains enabled');
 const marker={schemaVersion:1,job,executionDay:day,executed:true,retryNeeded:(status.errors||[]).length>0,runId:process.env.GITHUB_RUN_ID||null,at:new Date().toISOString(),sourceCoverageStatus:status.status||((status.errors||[]).length?'partial':'source-bounded'),sourceCoverageComplete:false};
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(marker)+'\n');await rename(file+'.tmp',file);return marker;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [action,job]=process.argv.slice(2);const r=await runtime({action,job});console.log(action==='check'?'run='+String(r.run):JSON.stringify(r));}
