// Private server-side state over Supabase REST. The service key never reaches the browser.
import {randomUUID} from 'node:crypto';
export function createCloudState({url='',key='',required=false,fetcher=fetch}={}){
 if(!url&&!key&&!required)return null;
 if(!url||!key)throw Error('请填写云端存储地址和服务端密钥');
 const base=new URL(url);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('云端存储地址须为HTTPS来源地址');
 const headers={apikey:key,'Content-Type':'application/json'};
 if(key.startsWith('eyJ')){let role;try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role;}catch{}if(role!=='service_role')throw Error('请使用数据库服务端密钥');headers.Authorization='Bearer '+key;}
 else if(!key.startsWith('sb_secret_'))throw Error('请使用数据库服务端Secret key');
 const valid=k=>{if(typeof k!=='string'||!/^(?:ai|batch|forum):[A-Za-z0-9:_-]{1,180}$/.test(k))throw Error('云端状态标识无效');};
 async function call(route,options={}){
  let r;try{r=await fetcher(base.origin+'/rest/v1/'+route,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(15000)});}catch{throw Error('云端状态暂时不可用');}
  if(!r.ok){const e=Error(r.status===409?'云端状态正在更新，请重试':'云端状态暂时不可用');e.conflict=r.status===409;throw e;}
  const text=await r.text();if(Buffer.byteLength(text)>6_000_000)throw Error('云端状态过大');return text?JSON.parse(text):null;
 }
 return {
  async read(k){valid(k);const rows=await call('zhijian_backend_state?key=eq.'+encodeURIComponent(k)+'&select=value,revision&limit=1');if(!Array.isArray(rows))throw Error('云端状态格式无效');return rows[0]||null;},
  async write(k,value,expected=null){valid(k);if(Buffer.byteLength(JSON.stringify(value))>4_000_000)throw Error('云端状态过大');const row=await call('rpc/zhijian_put_state',{method:'POST',body:JSON.stringify({p_key:k,p_value:value,p_expected:expected})});if(!row||!Number.isSafeInteger(row.revision)||row.revision<1)throw Error('云端状态格式无效');return row;},
  async reserveBudget(day,amount,budget){const row=await call('rpc/zhijian_reserve_ai',{method:'POST',body:JSON.stringify({p_day:day,p_amount:amount,p_budget:budget,p_id:randomUUID()})});if(row?.error==='budget-exhausted')throw Error('今日默认AI额度已用完，可使用自己的接口');if(!row?.id||!row.ledger)throw Error('云端用量记录格式无效');return row;},
  async settleBudget(id,{actual=null,refund=false}={}){const row=await call('rpc/zhijian_settle_ai',{method:'POST',body:JSON.stringify({p_id:id,p_actual:actual,p_refund:refund})});if(!row?.ledger)throw Error('云端用量记录格式无效');return row.ledger;}
 };
}
