// v7 display calculations. Fractions internally; source fields retain their units.
import {portfolioRisk,historicalPath,isoDate} from './quant.mjs';
export const V7_METHOD='analysis-v7-reviewed-2026-11-25';
export const FACTOR_WEIGHTS={cost:.25,downside:.25,experience:.20,stability:.15,size:.10,holdingsChange:.05};
export const FACTOR_NAMES={cost:'成本',downside:'下行',experience:'正收益日',stability:'排名稳定',size:'规模位置（试验）',holdingsChange:'持仓权重变化'};
const finite=Number.isFinite,mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
export const percent=v=>finite(v)?(v*100).toFixed(2)+'%':null;
export function sizeBucket(v){return !finite(v)||v<0?null:v<2?'小于2亿':v<10?'2-10亿':v<50?'10-50亿':'50亿以上';}
export function feePart(v){if(finite(v?.annualDecimal))return v.annualDecimal;if(finite(v?.rawPercentValue))return v.rawPercentValue/100;if(typeof v==='string'&&/^\s*\d+(?:\.\d+)?\s*%\s*$/.test(v))return parseFloat(v)/100;return null;}
export function feeParts(card){const f=card.fees||{},parts=[feePart(f.management),feePart(f.custody),feePart(f.service??f.salesService)];return {parts,total:parts.every(finite)?parts.reduce((s,x)=>s+x,0):null,two:parts.slice(0,2).every(finite)?parts[0]+parts[1]:null};}
export function peerKey(card){const bucket=sizeBucket(card.netAssets?.valueYi);return card.type&&bucket&&!/美元|欧元|港币|英镑|澳元|日元/.test(card.name||'')?card.type+'|'+bucket:null;}
export function reportType(asOf){return /-06-30$|-12-31$/.test(asOf||'')?'periodic':/-03-31$|-09-30$/.test(asOf||'')?'quarterly':null;}
export function detailPeriods(f){return (f.detailPeriods||[]).filter(p=>reportType(p.asOf)==='periodic'&&p.rows?.length&&p.rows.every(r=>finite(r.weight)&&r.weight>=0&&r.weight<=100)&&new Set(p.rows.map(r=>r.code)).size===p.rows.length&&p.rows.reduce((s,r)=>s+r.weight,0)<=100.5);}
export function overlapV7(funds){const pairs=[],missing=[];for(let i=0;i<funds.length;i++)for(let j=i+1;j<funds.length;j++){
 const a=funds[i],b=funds[j],aps=detailPeriods(a),bps=detailPeriods(b),dates=aps.map(p=>p.asOf).filter(d=>bps.some(p=>p.asOf===d)).sort().reverse();
 if(!dates.length){missing.push({a:a.name,b:b.name,reason:'缺少同期半年度或年度的详细持仓'});continue;}
 const ap=aps.find(p=>p.asOf===dates[0]),bp=bps.find(p=>p.asOf===dates[0]),bm=new Map(bp.rows.map(r=>[r.code,r.weight/100]));let value=0,amount=0;
 for(const r of ap.rows){const x=r.weight/100,y=bm.get(r.code)||0;value+=Math.min(x,y);amount+=2*Math.min(a.amount*x,b.amount*y);}
 const af=feeParts(a.profile||a),bf=feeParts(b.profile||b),feeBasis=af.total!==null&&bf.total!==null?'管理＋托管＋销售服务':'管理＋托管',rates=feeBasis==='管理＋托管'?[af.two,bf.two]:[af.total,bf.total];
 pairs.push({aId:a.id,bId:b.id,a:a.name,b:b.name,asOf:dates[0],value,amount,coverageA:ap.rows.reduce((s,r)=>s+r.weight/100,0),coverageB:bp.rows.reduce((s,r)=>s+r.weight/100,0),rowsA:ap.rows.length,rowsB:bp.rows.length,complete:ap.complete===true&&bp.complete===true,feeEstimate:rates.every(finite)?amount/2*(rates[0]+rates[1]):null,feeBasis});
 }return {pairs:pairs.sort((a,b)=>b.amount-a.amount),missing};}
export function structureV7(funds){
 if(!funds.length)return {ready:false,reason:'请添加持仓'};const dates=detailPeriods(funds[0]).map(p=>p.asOf).filter(d=>funds.every(f=>detailPeriods(f).some(p=>p.asOf===d))).sort().reverse();
 if(!dates.length)return {ready:false,reason:'缺少全部所持基金同期的详细持仓'};
 const positions=new Map();for(const f of funds){const p=detailPeriods(f).find(p=>p.asOf===dates[0]);for(const row of p.rows){const old=positions.get(row.code)||{code:row.code,name:row.name,weight:0};old.weight+=f.share/100*row.weight/100;positions.set(row.code,old);}}
 const rows=[...positions.values()].sort((a,b)=>b.weight-a.weight),coverage=rows.reduce((s,r)=>s+r.weight,0);if(coverage<.5)return {ready:false,reason:'同期已展开比例低于50%',asOf:dates[0],coverage};
 const hhi=rows.reduce((s,r)=>s+(r.weight/coverage)**2,0);return {ready:true,asOf:dates[0],coverage,hhi,nominal:rows.length,effective:1/hhi,multiple:rows.length*hhi,rows,complete:funds.every(f=>detailPeriods(f).find(p=>p.asOf===dates[0]).complete===true)};
}
export function checkedNav(nav,card,calendar,asOf){
 const fail=reason=>({ready:false,reason,quality:nav?.quality||'missing',points:[]});
 if(!nav)return fail('复权净值历史未接入');if(nav.crossCheck!=='agree')return fail(nav.crossCheck==='divergent'?'来源两种净值口径存在分歧，相关收益指标待核':'来源净值口径筛查尚未通过');if(nav.quality!=='clean')return fail('来源质量标记待核，不计算波动与回撤');
 if(/货币/.test(card.type||''))return fail('货币基金的收益展示口径不用于此净值回撤测算');
 if(/美元|欧元|港币|英镑|澳元|日元/.test(card.name||'')||card.currency&&card.currency!=='CNY')return fail('缺少统一人民币收益口径');
 if((nav.filledFromNav||0)>0||(nav.skipped||0)>0)return fail('序列有净值差分填补或跳过记录，不能按完整复权序列计算');
 const points=(nav.points||[]).filter(p=>p[0]<=asOf),dates=points.map(p=>p[0]);if(points.length<2||dates.some((d,i)=>!isoDate(d)||i&&d<=dates[i-1])||points.some(p=>!finite(p[1])||p[1]<=0))return fail('复权序列日期或数值无效');
 const allowed=new Set(calendar),onCalendar=points.filter(p=>allowed.has(p[0]));if(onCalendar.length<201)return fail('有效日收益不足200条');
 const map=new Map(onCalendar),from=onCalendar[0][0],to=onCalendar.at(-1)[0],expected=calendar.filter(d=>d>=from&&d<=to);if(expected.some(d=>!map.has(d)))return fail('观察区间存在缺失交易日，不拼接缺口');
 return {ready:true,points:onCalendar,from,to,n:onCalendar.length-1,quality:'clean',basis:nav.basis||'source-adjusted-observation',verifiedTotalReturn:false};
}
export function navMetrics(checked){
 if(!checked.ready)return {ready:false,reason:checked.reason};const points=checked.points,rows=points.slice(1).map((p,i)=>({from:points[i][0],date:p[0],values:[p[1]/points[i][1]-1]}));
 if(rows.some(r=>!finite(r.values[0])||r.values[0]<=-1))return {ready:false,reason:'来源日收益无效'};
 const path=historicalPath({ready:true,rows},[1]),returns=rows.map(r=>r.values[0]),risk=portfolioRisk(rows.map(r=>r.values),[1]);
 const removed=returns.map((r,i)=>({r,i})).sort((a,b)=>a.r-b.r).slice(0,20),excluded=new Set(removed.map(x=>x.i)),exWorst20=returns.length>20?Math.expm1(returns.reduce((s,r,i)=>s+(excluded.has(i)?0:Math.log1p(r)),0)):null;
 const recoveryDays=path.maxDrawdown===0?0:path.recoveryDate?(Date.parse(path.recoveryDate)-Date.parse(path.troughDate))/86400000:null;
 const tradingRecovery=path.maxDrawdown===0?0:path.recoveryDate?points.filter(p=>p[0]>path.troughDate&&p[0]<=path.recoveryDate).length:null;
 return {ready:true,from:checked.from,to:checked.to,n:returns.length,totalReturn:path.totalReturn,maxDrawdown:path.maxDrawdown,peakDate:path.peakDate,troughDate:path.troughDate,recoveryDate:path.recoveryDate,recoveryDays,tradingRecovery,recoveryEfficiency:tradingRecovery>0?path.maxDrawdown/tradingRecovery:null,positiveDayRatio:returns.filter(r=>r>0).length/returns.length,returnExWorst20:exWorst20,removedDays:removed.map(x=>rows[x.i].date),annualVol:risk.annualVol};
}
export function portfolioV7(funds,calendar,asOf){
 if(!funds.length)return {ready:false,reason:'请添加持仓'};const checked=funds.map(f=>checkedNav(f.adjusted,f.profile||f,calendar,asOf));const missing=checked.map((r,i)=>r.ready?null:funds[i].name+'：'+r.reason).filter(Boolean);if(missing.length)return {ready:false,reason:missing.join('；')};
 const from=checked.map(r=>r.from).sort().at(-1),to=checked.map(r=>r.to).sort()[0],dates=calendar.filter(d=>d>=from&&d<=to),maps=checked.map(r=>new Map(r.points));if(dates.length<201)return {ready:false,reason:'共同区间不足200个有效日收益'};
 if(maps.some(m=>dates.some(d=>!m.has(d))))return {ready:false,reason:'共同交易日尚未对齐'};
 const rows=dates.slice(1).map((d,i)=>({from:dates[i],date:d,values:maps.map(m=>m.get(d)/m.get(dates[i])-1)})),weights=funds.map(f=>f.share/100),risk=portfolioRisk(rows.map(r=>r.values),weights),path=historicalPath({ready:true,rows},weights);
 if(!finite(risk.annualVol)||path.points.some(p=>!finite(p.value)))return {ready:false,reason:'序列测算结果无效'};
 return {ready:true,from:dates[0],to,n:rows.length,risk,path:{...path,recoveryDays:path.maxDrawdown===0?0:path.recoveryDate?(Date.parse(path.recoveryDate)-Date.parse(path.troughDate))/86400000:null},deviations:funds.map((f,i)=>({name:f.name,code:f.code,weight:weights[i],riskShare:risk.riskShares?.[i]??null,deviation:risk.riskShares?risk.riskShares[i]-weights[i]:null}))};
}
export function concentrationTrend(f){const ps=detailPeriods(f).sort((a,b)=>a.asOf.localeCompare(b.asOf));if(ps.length<2)return {ready:false,reason:'缺少两期同类详细披露'};const one=p=>{const sum=p.rows.reduce((s,r)=>s+r.weight,0);return sum>=50?{asOf:p.asOf,rows:p.rows.length,coverage:sum/100,hhi:p.rows.reduce((s,r)=>s+(r.weight/sum)**2,0)}:null;};const a=one(ps.at(-2)),b=one(ps.at(-1));if(!a||!b)return {ready:false,reason:'可比披露的已展开比例低于50%'};
 const am=new Map(ps.at(-2).rows.map(r=>[r.code,r.weight])),bm=new Map(ps.at(-1).rows.map(r=>[r.code,r.weight])),keys=new Set([...am.keys(),...bm.keys()]);let dot=0,aa=0,bb=0;for(const k of keys){const x=am.get(k)||0,y=bm.get(k)||0;dot+=x*y;aa+=x*x;bb+=y*y;}
 return {ready:true,from:a.asOf,to:b.asOf,previous:a,current:b,delta:b.hhi-a.hhi,cosineDistance:aa&&bb?Math.max(0,Math.min(1,1-dot/Math.sqrt(aa*bb))):null};}
export function outsideSample(card,checked){return [['2022年','2022-01-01','2022-12-31'],['2024年初','2024-01-01','2024-02-05']].map(([label,start,end])=>({label,start,end,reason:!isoDate(card.establishedAt)?'成立日期未接入':card.establishedAt>end?'该区间结束后才成立':card.establishedAt>start?'仅在该区间部分时间存续':!checked?.ready||checked.from>start||checked.to<end?'基金当时已存续，当前序列未覆盖整个区间':'当前序列包含该区间'}));}
export function names(value){return [...new Set((Array.isArray(value)?value.map(x=>typeof x==='string'?x:x.name):String(value||'').split(/[,，、;；]/)).map(x=>String(x||'').trim()).filter(x=>x&&!['无','--','暂无'].includes(x)))];}
export function managerOverlap(funds){const map=new Map();for(const f of funds)for(const m of f.managerDetails||[]){const old=map.get(m.key)||{...m,funds:[]};old.funds.push({code:f.code,name:f.name});map.set(m.key,old);}return [...map.values()].filter(x=>x.funds.length>=2);}
// Mid-ranks make ties neutral for score factors. Fee UI separately uses strict-lower share.
export function quantile(values,value){if(!values.length||!finite(value))return null;return (values.filter(x=>x<value).length+values.filter(x=>x===value).length/2)/values.length;}
export function rSquared(pairs){if(pairs.length<250)return null;const mx=mean(pairs.map(r=>r[0])),my=mean(pairs.map(r=>r[1]));let xx=0,yy=0,xy=0;for(const [x,y] of pairs){xx+=(x-mx)**2;yy+=(y-my)**2;xy+=(x-mx)*(y-my);}return xx>1e-16&&yy>1e-16?Math.min(1,Math.max(0,xy*xy/(xx*yy))):null;}
export function scoreFactors(raw,cohorts){const factors=[];for(const key of Object.keys(FACTOR_WEIGHTS)){const value=raw[key],values=cohorts[key]||[];if(!finite(value)||values.length<30){factors.push({key,name:FACTOR_NAMES[key],ready:false,reason:!finite(value)?'该项数据不足':'同口径样本不足30个'});continue;}const q=quantile(values,value);const score=key==='size'?100*(1-(2*q-1)**2):100*(['experience'].includes(key)?q:1-q);factors.push({key,name:FACTOR_NAMES[key],ready:true,value,score,n:values.length,originalWeight:FACTOR_WEIGHTS[key]});}
 const ready=factors.filter(x=>x.ready),weight=ready.reduce((s,x)=>s+x.originalWeight,0),enough=ready.length>=3&&ready.some(x=>['downside','experience'].includes(x.key));return {ready:enough,reason:enough?null:'至少需三个因子，且包含下行或正收益日因子',score:enough?ready.reduce((s,x)=>s+x.score*x.originalWeight/weight,0):null,partial:ready.length<6,factors:factors.map(x=>({...x,weight:x.ready?x.originalWeight/weight:null})),strongest:enough?[...ready].sort((a,b)=>b.score-a.score)[0].name:null,weakest:enough?[...ready].sort((a,b)=>a.score-b.score)[0].name:null};}
