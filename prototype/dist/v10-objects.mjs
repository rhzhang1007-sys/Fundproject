import {loadPublicData} from './v09-public-data.mjs';
import {safeUrl} from './core.mjs';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function objectIdentity(id){const m=/^(fund|stock)([0-9A-Z]{1,12})$/.exec(String(id));if(!m)throw Error('对象代码无效');return {kind:m[1],code:m[2]};}
export function objectShard(code){if(/^\d+$/.test(code))return String(Number(code)%100).padStart(2,'0');let n=0;for(const c of code)n=(n*31+c.charCodeAt(0))%100;return String(n).padStart(2,'0');}
export function validateRelations(data,code,{asOf=null}={}){
 if(Array.isArray(data.periods)){
  if(data.fundCode!==code)throw Error('持仓基金不匹配');
  const selected=asOf?data.periods.find(p=>p.asOf===asOf):[...data.periods].sort((a,b)=>b.asOf.localeCompare(a.asOf))[0];
  if(!selected)return {holdings:[],disclosure:null,holdingStatus:data.status||'not-collected',periods:data.periods};
  return {...validateRelations(selected,code),holdingStatus:data.status,periods:data.periods};
 }
 if(data.fundCode!==code||!/^\d{4}-\d{2}-\d{2}$/.test(data.asOf||'')||typeof data.complete!=='boolean'||!data.source||!Array.isArray(data.holdings))throw Error('持仓关系格式无效');
 const codes=new Set();for(const row of data.holdings){const unresolved=row.weightPercent===null&&row.weightStatus==='source-lines-unresolved'&&Array.isArray(row.sourceWeightVariants)&&row.sourceWeightVariants.length>1&&row.sourceWeightVariants.every(v=>Number.isFinite(v)&&v>=0&&v<=100);if(!/^\d{6}$/.test(row.code)||codes.has(row.code)||!unresolved&&(!Number.isFinite(row.weightPercent)||row.weightPercent<0||row.weightPercent>100))throw Error('持仓关系数值无效');codes.add(row.code);}
 return {disclosure:{...data,holdings:undefined},holdings:data.holdings.map(x=>({...x,weight:x.weightPercent}))};
}
export function createObjectStore({fetcher=fetch}={}){
 const cache=new Map();let registry,manifest;
 async function json(path){if(!cache.has(path))cache.set(path,(async()=>{const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),10000);try{const r=await fetcher('./data/v10/'+path,{signal:ctl.signal,credentials:'omit'});if(!r.ok)throw Error('资料暂时无法读取');const value=await r.json();return /^\.\.\/v(?:11\/observations|12\/factors)\//.test(path)?await loadPublicData(path.slice(3),value,{fetcher,timeout:3000}):value;}finally{clearTimeout(timer);}})().catch(e=>{cache.delete(path);throw e;}));return cache.get(path);}
 async function objects(){if(!registry){const d=await json('objects.json');if(!Array.isArray(d.objects)||new Set(d.objects.map(x=>x.id)).size!==d.objects.length)throw Error('对象目录无效');registry=d.objects;}return registry;}
 async function card(id){const {kind,code}=objectIdentity(id),d=await json(`foundation/${kind}s/${objectShard(code)}.json`);const value=d.cards?.find(x=>x.id===id&&x.code===code&&x.kind===kind);if(!value)throw Error('未收录该对象');return value;}
 async function relations(code,options){manifest??=await json('foundation-manifest.json');if(!manifest.holdingsInterface?.enabled)return null;if(manifest.holdingsInterface.schema==='fund-holdings-relations-v2'){const d=await json(`../v11/relationships/${objectShard(code)}.json`);return validateRelations(d.funds[code]||{fundCode:code,status:'not-collected',periods:[]},code,options);}return validateRelations(await json(`relationships/${code}.json`),code);}
 async function resources(id){const {kind,code}=objectIdentity(id);const d=await json(`../v11/resources/${kind}s/${objectShard(code)}.json`);return d.objects?.[id]||[];}
 async function observations(code){const d=await json(`../v11/observations/${objectShard(code)}.json`);return d.funds?.[code]||null;}
 async function factors(code){const data=await json(`../v12/factors/${objectShard(code)}.json`);return data.funds?.[code]||null;}
 async function target(code){return (await json('../v11/link-to-etf.json')).items?.[code]||null;}
 async function search(q,kind=null,limit=50){q=q.trim().toLowerCase();if(!q)return [];return (await objects()).filter(x=>(!kind||x.kind===kind)&&`${x.code} ${x.name}`.toLowerCase().includes(q)).slice(0,limit);}
 return {objects,card,relations,resources,observations,factors,target,search};
}
export function profileSources(card){
 const source=card.sources?.find(x=>safeUrl(x.url));const rows=[];
 const text=[card.fullName,card.type,card.establishedAt,card.managerCompany,card.custodian,card.benchmarkText,card.investTarget].filter(Boolean).join('；');
 if(source&&text)rows.push({id:'profile-'+card.id,title:card.name+'基础信息',entities:[card.id],publisher:'公开来源字段',cadence:'profile',url:source.url,publishedAt:null,retrievedAt:null,summary:text,summaryCoverage:'source-fields-only',highlights:[{text}],contentCoverage:'source-fields-only'});
 for(const d of card.disclosures||[])if(safeUrl(d.url))rows.push({id:'disclosure-'+card.id+'-'+d.id,title:card.name+' · '+d.source,entities:[card.id],publisher:'基金披露',cadence:'periodic',url:d.url,publishedAt:d.publishedAt,period:d.asOf,summary:'',contentCoverage:'link-only'});
 if(card.dailyFactors){const f=card.dailyFactors,st=f.structure;rows.push({id:'factors-'+card.id,title:card.name+'每日指标',entities:[card.id],publisher:'持仓知见确定性计算',cadence:'periodic',publishedAt:f.asOf,period:st.asOf||f.asOf,url:'https://github.com/rhzhang1007-sys/Fundproject/blob/main/prototype/dist/data/v12/factors/'+objectShard(card.code)+'.json',summary:st.ready?`报告日 ${st.asOf}；已展开 ${(st.coverage*100).toFixed(2)}%；有效持股数 ${st.effective.toFixed(2)}；分散幻觉倍数 ${st.multiple.toFixed(2)}。`:'当前披露不满足结构指标计算条件。',contentCoverage:'computed-source-values'});}
 if(card.referencedTarget?.targetCode){const t=card.referencedTarget;rows.push({id:'target-'+card.id,title:'联接目标ETF参考（规则推断）',entities:[card.id],publisher:'同管理人、指数及名称匹配',cadence:'profile',url:'https://fund.eastmoney.com/'+t.targetCode+'.html',summary:t.targetName+'（'+t.targetCode+'）；'+t.reason+'。未取得联接基金持有目标ETF的实际比例，不计入股票穿透或结构指标。',contentCoverage:'inferred-reference'});}
 return rows;
}
export function profileMarkup(card){
 if(!card)return '';
 const managers=Array.isArray(card.managers)?card.managers.map(x=>x.name).join('、'):card.managers;
 const fees=card.fees||{},rate=x=>typeof x==='string'?x:Number.isFinite(x?.rawPercentValue)?x.rawPercentValue+'%':'—';
 const rows=card.kind==='fund'?[
 ['基金全称',card.fullName],['类型',card.type],['成立日期',card.establishedAt],['管理人',card.managerCompany],['托管人',card.custodian],['基金经理',managers],['跟踪指数',card.trackingIndex?.name],['业绩基准',card.benchmarkText],
 ['净资产（亿，币种见来源）',Number.isFinite(card.netAssets?.valueYi)?card.netAssets.valueYi.toFixed(4)+' · '+card.netAssets.asOf:null],
 ['管理费率 / 托管费率',rate(fees.management)+' / '+rate(fees.custody)],['投资目标',card.investTarget]
 ]:[['公司全称',card.fullName],['交易所',card.exchange],['行业',card.industry],['上市日期',card.listingDate]];
 return `<section class="v7-card v10-profile"><h2>${h(card.name)} <small class="v8-muted">${h(card.code)}</small></h2><dl class="v8-properties">${rows.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>`<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join('')}</dl>${card.kind==='fund'?`<small class="v8-muted">${card.curatedFieldNames?'基础字段与已核资料分别保留来源':'来源字段'} · ${card.detailStatus==='source-no-detail'?'暂无详情':'费率条件见原文'}</small>`:''}</section>`;
}
