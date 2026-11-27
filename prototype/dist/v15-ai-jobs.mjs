// Jobs survive SPA navigation. No UI/dialog dependency; results are saved before notification.
export function createAIJobs({save,onChange=()=>{},onComplete=()=>{}}){
 const jobs=new Map();let tail=Promise.resolve();
 function start({scope,title,key,work}){const existing=[...jobs.values()].find(j=>j.key===key&&['queued','running'].includes(j.status));if(existing)return existing;
 const job={id:crypto.randomUUID(),scope,title,key,status:'queued',message:'已加入分析队列，完成后将在这里提醒。',createdAt:new Date().toISOString()};jobs.set(job.id,job);onChange(job);
  job.promise=tail.then(async()=>{job.status='running';job.message='正在分析，完成后将在这里提醒，可继续浏览。';onChange(job);try{const value=await work(message=>{job.message=message;onChange(job);});value.createdAt??=job.createdAt;value.jobId??=job.id;job.value=value;job.saved=await save(value,job);job.value.saved=job.saved;job.status='complete';job.message=job.saved?'分析完成，已保存到我的资料库。':'分析完成；浏览器存储不足，请复制结果。';onChange(job);onComplete(job);return value;}catch(e){job.status='failed';job.message=e.name==='AbortError'?'读取超时，请重试。':e.message==='Failed to fetch'?'连接未完成，请稍后重试。':e.message;onChange(job);return null;}});tail=job.promise.then(()=>{});return job;
 }
 return {start,get:id=>jobs.get(id),latest:scope=>[...jobs.values()].filter(j=>j.scope===scope).at(-1),latestComplete:scope=>[...jobs.values()].filter(j=>j.scope===scope&&j.status==='complete').at(-1),all:()=>[...jobs.values()]};
}
