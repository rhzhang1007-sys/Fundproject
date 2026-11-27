// Execution markers for staggered cron retries; data completeness is reported separately.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export const localDay=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now);
export function needsRetry(marker){return marker?.retryNeeded===true||['partial','incomplete'].includes(marker?.sourceCoverageStatus);}
export function shouldRun(marker,job,day=localDay(),settings={},now=new Date()){
 if(!marker||marker.job!==job||marker.executionDay!==day||marker.executed!==true)return true;
 if(!needsRetry(marker)&&!(job==='nav'&&marker.adapter!=='eastmoney-daily-nav-v2'))return false;
 if((marker.attemptsToday||1)>=Number(settings.maxAttemptsPerDay||4))return false;
 const at=Date.parse(marker.at);if(Number.isFinite(at)&&localDay(new Date(at))===day&&now-new Date(at)<Number(settings.retryMinutes||45)*60000)return false;
 return true;
}
async function read(p){try{return JSON.parse(await readFile(p,'utf8'));}catch{return null;}}
export async function runtime({action,job,root=path.dirname(HERE),day=localDay()}={}){
 if(!['nav','index','news'].includes(job)||!['check','mark'].includes(action))throw Error('Unknown daily runtime job/action');
 const dist=path.join(root,'prototype/dist/data'),file=path.join(dist,'v14/runtime',job+'.json');
 const settings=(await read(path.join(root,'prototype/config/public-updates.json')))?.dailyDispatch||{};
 if(action==='check')return {run:shouldRun(await read(file),job,day,settings),job,day};
 const status=await read(path.join(dist,job==='nav'?'v12/nav/latest.json':job==='index'?'v13/index-status.json':'v09/update-status.json'));
 const date=s=>s&&Number.isFinite(Date.parse(s))?localDay(new Date(s)):null;
 const ok=job==='nav'?date(status?.fetchedAt)===day&&status?.meta?.freshRecords>0&&status.sourceAdapter==='eastmoney-daily-nav-v2':job==='index'?date(status?.attemptedAt)===day&&(status?.updated>0||status?.alreadyCurrent>0):status?.newsReady===true&&date(status?.attemptedAt)===day;
 if(!ok)throw Error('No successful source execution for this day; retry remains enabled');
 const previous=await read(file),runId=process.env.GITHUB_RUN_ID||null,sameDay=previous?.executionDay===day;
 const attemptsToday=sameDay&&runId&&previous?.runId===runId?(previous.attemptsToday||1):sameDay?(previous.attemptsToday||1)+1:1;
 const marker={schemaVersion:2,job,executionDay:day,executed:true,attemptsToday,...(job==='nav'?{adapter:status.sourceAdapter}:{}),retryNeeded:['partial','incomplete'].includes(status.status)||(status.errors||[]).length>0||(status.incompleteSources||[]).length>0||(status.meta?.sourceErrors||[]).length>0||(status.meta?.sourceConflicts||[]).length>0||status.meta?.paginationTruncated===true,runId,at:new Date().toISOString(),sourceCoverageStatus:status.status||((status.errors||[]).length?'partial':'source-bounded'),sourceCoverageComplete:false};
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(marker)+'\n');await rename(file+'.tmp',file);return marker;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [action,job]=process.argv.slice(2);const r=await runtime({action,job});console.log(action==='check'?'run='+String(r.run):JSON.stringify(r));}
