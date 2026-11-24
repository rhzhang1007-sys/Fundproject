import {validatePersonal} from './boundaries.mjs';
export {validatePersonal} from './boundaries.mjs';
import {analyzePortfolio,compareFunds,portfolioAmount} from './analysis.mjs';
import {METHOD_VERSION,POLICY,alignTotalReturns,portfolioRisk,rollingCorrelation,historicalPath,expectedShortfall,trackingMetrics,isoDate} from './quant.mjs';
const EPS=1e-9;
export const EMPTY_ANALYTICS={schemaVersion:1,dataVersion:'unavailable',calendar:[],series:[],indices:[],industryMappings:[],disclosures:[],products:[]};
export function effectiveCatalog(catalog,data=EMPTY_ANALYTICS,weights=catalog.defaultWeights){
 const active=catalog.funds.filter(f=>Number(weights[f.id])>0),all=data.disclosures||[];
 const valid=r=>r.verified===true&&r.denominator==='net_assets'&&isoDate(r.asOf)&&Array.isArray(r.holdings)&&r.holdings.every(h=>typeof h.entity==='string'&&Number.isFinite(h.weight)&&h.weight>=0&&h.weight<=1);
 const dates=active.map(f=>all.filter(r=>r.fundId===f.id&&valid(r)&&r.complete===true).map(r=>r.asOf));
 const common=dates.length?dates[0].filter(d=>dates.every(ds=>ds.includes(d))).sort().at(-1):null;
 const funds=catalog.funds.map(f=>{
  const available=all.filter(r=>r.fundId===f.id&&valid(r));
  const r=common?available.find(r=>r.asOf===common&&r.complete):available.filter(r=>r.complete).sort((a,b)=>b.asOf.localeCompare(a.asOf))[0];
  if(!r)return f;
  return {...f,holdings:r.holdings.map(h=>({entity:h.entity,weight:h.weight*100})),holdingsAsOf:r.asOf,holdingsComplete:r.complete,source:r.sourceId||null,disclosureId:r.id,stockFraction:r.stockFraction??null,holdingsPublishedAt:r.publishedAt||null};
 });
 const edges=[...catalog.edges.filter(e=>e.kind!=='holding'),...funds.flatMap(f=>f.holdings.map(h=>({from:f.id,to:h.entity,kind:'holding',label:'披露 '+h.weight+'%',source:f.source||null,asOf:f.holdingsAsOf||null})))];
 return {...catalog,funds,edges};
}
export function structureAnalysis(catalog,weights,portfolio,data=EMPTY_ANALYTICS){
 const m=analyzePortfolio(catalog,weights,portfolio),active=catalog.funds.filter(f=>Number(weights[f.id])>0);
 const sameDate=active.every(f=>f.holdingsAsOf&&f.holdingsAsOf===active[0]?.holdingsAsOf);
 const complete=sameDate&&active.every(f=>f.holdingsComplete===true);
 const companies=m.companies.map(c=>({...c,fraction:c.share/100}));
 const eq=companies.reduce((s,c)=>s+c.fraction,0),hhi=complete&&eq>EPS?companies.reduce((s,c)=>s+(c.fraction/eq)**2,0):null;
 const classification=data.industryClassification,industryMap=data.industryMappings||[],industries=new Map();let unmapped=0;
 for(const c of companies){
  const reportDates=c.paths.map(p=>p.asOf);
  const mapping=classification&&industryMap.find(x=>x.entity===c.id&&x.classificationId===classification.id&&x.version===classification.version&&x.verified===true&&reportDates.every(d=>d&&(!x.validFrom||x.validFrom<=d)&&(!x.validTo||x.validTo>=d)));
  if(!mapping){unmapped+=c.fraction;continue;}
  const old=industries.get(mapping.industryId)||{id:mapping.industryId,name:mapping.industryName,fraction:0,members:[]};old.fraction+=c.fraction;old.members.push(c.id);industries.set(old.id,old);
 }
 return {...m,companies,complete,sameDate,reportDates:[...new Set(active.map(f=>f.holdingsAsOf).filter(Boolean))],top5:complete?companies.slice(0,5).reduce((s,c)=>s+c.fraction,0):null,hhi,effectiveCompanies:hhi?1/hhi:null,industries:[...industries.values()].sort((a,b)=>b.fraction-a.fraction),unmapped,classification:classification||null,industryComplete:complete&&unmapped<EPS};
}
export function riskAnalysis(catalog,weights,data=EMPTY_ANALYTICS,years=3){
 const active=catalog.funds.filter(f=>Number(weights[f.id])>0),ids=active.map(f=>f.id),w=ids.map(id=>Number(weights[id])/100);
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
 const aligned=alignTotalReturns(data.series||[],ids,data.calendar||[],{years,asOf:today});
 const gap=active.map(f=>({id:f.id,name:f.name,rawPoints:f.navSnapshot?.points?.length||0,totalReturnPoints:(data.series||[]).find(s=>s.id===f.id&&s.verified&&s.basis==='nav-total-return')?.points?.length||0}));
 const result={methodVersion:METHOD_VERSION,policy:POLICY,dataVersion:data.dataVersion||'unavailable',ids,weights:w,aligned,gap,ready:false,reason:aligned.reason||'',risk:null,path:null,tail:null,rolling:[],downMarket:null,tracking:[]};
 if(!aligned.ready)return result;
 if(aligned.n<POLICY.minRiskSamples){result.reason=`有效日收益${aligned.n}条，少于首版展示门槛${POLICY.minRiskSamples}条`;return result;}
 result.ready=true;result.reason='';result.risk=portfolioRisk(aligned.rows.map(r=>r.values),w);
 result.rolling=rollingCorrelation(aligned,POLICY.rollingWindow);
 result.path=historicalPath(aligned,w);
 const losses=aligned.rows.map(r=>-r.values.reduce((s,v,i)=>s+v*w[i],0));
 result.tail=aligned.n>=POLICY.minTailSamples?{ready:true,...expectedShortfall(losses)}:{ready:false,reason:`尾部样本较少：首版要求至少${POLICY.minTailSamples}个有效日收益，约30个最差5%样本权重`};
 const market=(data.indices||[]).find(x=>x.id===data.marketReference&&x.verified);
 if(market){
  const pair=alignTotalReturns([...(data.series||[]),{...market,basis:market.basis==='total-return'||market.basis==='price-return'?'nav-total-return':market.basis}], [...ids,market.id],data.calendar||[],{years,asOf:today});
  if(pair.ready){const down=pair.rows.filter(r=>r.values.at(-1)<0);result.downMarket={ready:down.length>=POLICY.minDownDays,name:market.name,n:down.length,bothDown:down.length?down.filter(r=>r.values.slice(0,-1).every(x=>x<0)).length/down.length:null,from:pair.from,to:pair.to};}
 }
 for(const f of active){
  const product=(data.products||[]).find(p=>p.fundId===f.id),index=(data.indices||[]).find(x=>x.id===product?.benchmarkId&&x.verified);
  if(!index){result.tracking.push({id:f.id,ready:false,reason:'合同基准或对应指数序列尚未收集'});continue;}
  const pair=alignTotalReturns([...(data.series||[]),{...index,basis:['total-return','price-return'].includes(index.basis)?'nav-total-return':index.basis}],[f.id,index.id],data.calendar||[],{years,asOf:today});
  result.tracking.push(pair.ready&&pair.n>=POLICY.minRiskSamples?{id:f.id,...trackingMetrics(pair.rows.map(r=>r.values)),benchmark:index.name,basis:index.basis,from:pair.from,to:pair.to}:{id:f.id,ready:false,reason:pair.reason||'基准配对样本不足'});
 }
 return result;
}
export function lossStatus(limit,portfolioReturn,total=null){
 if(!limit)return {status:'unset',label:'未设置损失关注线'};
 if(!Number.isFinite(portfolioReturn))return {status:'unknown',label:'尚无可比较的情景结果'};
 if(limit.unit==='amount'&&(!Number.isFinite(total)||total<=0))return {status:'unknown',label:'填写测算金额后可对照金额关注线'};
 if(limit.baseAmount&&total&&Math.abs(limit.baseAmount-total)>.005)return {status:'mismatch',label:'测算金额与关注线基准金额不同，请明确基准后对照'};
 const loss=Math.max(0,-portfolioReturn)*(limit.unit==='amount'?total:1),gap=loss-limit.value;
 return {status:gap>EPS?'over':'within',label:gap>EPS?'触及损失关注线':'本次情景未触及',loss,gap,unit:limit.unit};
}
export function boundaryAnalysis(catalog,structure,risk,preferences,data=EMPTY_ANALYTICS){
 const p=validatePersonal(preferences.personal,catalog,data);const personal=p.valid?p.value:{riskCaps:[],industryCaps:[],lossLimit:null,horizonMonths:null};
 const entries=[];
 for(const t of preferences.targets||[]){
  const value=t.kind==='fund'?Number(structure.weights[t.id])/100:structure.companies.find(c=>c.id===t.id)?.fraction??(structure.complete?0:null);
  const complete=t.kind==='fund'||structure.complete;
  const over=value!==null&&value>Number(t.max)/100+EPS;
  const under=complete&&value!==null&&value<Number(t.min)/100-EPS;
  entries.push({id:t.id,kind:t.kind,name:catalog.nodes.find(n=>n.id===t.id)?.name||catalog.funds.find(f=>f.id===t.id)?.name||t.id,value,min:t.min/100,max:t.max/100,status:over?'over':under?'under':complete?'within':'unknown',label:over?(t.kind==='fund'?'超过上限':'按披露估算超过上限'):under?'低于下限':complete?'在设定范围内':'资料不足，暂不能确认',basis:t.kind==='fund'?'当前输入':'历史披露折算'});
 }
 for(const cap of personal.riskCaps){const i=risk.ids.indexOf(cap.id),value=risk.ready&&risk.risk.riskShares&&i>=0?risk.risk.riskShares[i]:null;entries.push({id:cap.id,kind:'risk',name:catalog.funds.find(f=>f.id===cap.id)?.name||cap.id,value,max:cap.max,status:value===null?'unknown':value>cap.max+EPS?'over':'within',label:value===null?'收益资料待补':value>cap.max+EPS?'超过贡献关注线':'未超过关注线',basis:'当前权重与历史波动模型'});}
 for(const cap of personal.industryCaps){const value=structure.industries.find(x=>x.id===cap.id)?.fraction??null,over=value!==null&&value>cap.max+EPS;entries.push({id:cap.id,kind:'industry',name:cap.name,value,max:cap.max,status:over?'over':structure.industryComplete&&value!==null?'within':'unknown',label:over?'按披露估算超过上限':structure.industryComplete&&value!==null?'在设定范围内':'行业资料待补',basis:'同口径行业披露'});}
 return {personal,entries,configured:entries.length+(personal.lossLimit?1:0),alerts:entries.filter(x=>['over','under'].includes(x.status)).length,unknown:entries.filter(x=>x.status==='unknown').length};
}
export function diagnose(catalog,weights,portfolio,preferences={},data=EMPTY_ANALYTICS,years=3){
 const effective=effectiveCatalog(catalog,data,weights),structure=structureAnalysis(effective,weights,portfolio,data),risk=riskAnalysis(effective,weights,data,years);
 return {catalog:effective,structure,risk,boundaries:boundaryAnalysis(effective,structure,risk,preferences,data),methodVersion:METHOD_VERSION,dataVersion:data.dataVersion||'unavailable'};
}
export function frozenAnalysis(report){
 const r=report.risk;
 return {methodVersion:METHOD_VERSION,dataVersion:report.dataVersion,years:r.aligned.years||3,ids:r.ids,weights:r.weights,from:r.aligned.from||null,to:r.aligned.to||null,n:r.aligned.n||0,ready:r.ready,reason:r.reason,policy:POLICY,risk:r.risk,path:r.path?.ready?{ready:true,from:r.path.from,to:r.path.to,totalReturn:r.path.totalReturn,maxDrawdown:r.path.maxDrawdown,peakDate:r.path.peakDate,troughDate:r.path.troughDate,recoveryDate:r.path.recoveryDate}:null,tail:r.tail,coverage:report.structure.known/100,reportDates:report.structure.reportDates};
}
