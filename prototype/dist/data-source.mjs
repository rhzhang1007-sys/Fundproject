import {DATA_REVISION} from './deployment-config.mjs';
const REPOSITORY='https://raw.githubusercontent.com/rhzhang1007-sys/Fundproject/';
export function dataPath(value){
 if(typeof value!=='string'||/^(?:[a-z]+:|\/\/)/i.test(value)||/[\\?#]/.test(value))return null;
 const url=new URL(value,'https://local.invalid/');
 if(!url.pathname.startsWith('/data/'))return null;
 const p=url.pathname.slice(6);return /^[a-zA-Z0-9_/-]+(?:\.[a-zA-Z0-9_-]+)*\.json$/.test(p)&&p.split('/').every(x=>!x.startsWith('.'))?p:null;
}
export function createDataFetcher({revision=DATA_REVISION,fetcher=fetch}={}){
 if(revision&&!/^[a-f0-9]{40}$/.test(revision))throw Error('公开资料版本无效');
 return async(value,options={})=>{
  let local,error;try{local=await fetcher(value,options);if(local.ok)return local;}catch(e){error=e;}
  const p=dataPath(value);if(!p){if(error)throw error;return local;}
  try{const remote=await fetcher(REPOSITORY+(revision||'main')+'/prototype/dist/data/'+p,{...options,credentials:'omit',referrerPolicy:'no-referrer'});if(remote.ok)return remote;}catch(e){error??=e;}
  if(local)return local;throw error||Error('公开资料暂不可读');
 };
}
export const fetchData=createDataFetcher();
