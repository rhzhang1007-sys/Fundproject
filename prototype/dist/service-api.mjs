import {API_ORIGIN} from './deployment-config.mjs';
export function createAPIResolver(value=''){
 let origin='';
 if(value.trim()){
  const u=new URL(value.trim());
  if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('后台地址须为HTTPS来源地址，不含路径或认证信息');
  origin=u.origin;
 }
 return route=>{if(typeof route!=='string'||!route.startsWith('/api/')||route.includes('\\')||/[\r\n]/.test(route))throw Error('后台接口路径无效');const u=new URL(route,'https://local.invalid');if(u.origin!=='https://local.invalid'||!u.pathname.startsWith('/api/'))throw Error('后台接口路径无效');return origin?origin+u.pathname+u.search:route;};
}
export const apiURL=createAPIResolver(API_ORIGIN);
