// Deterministic research statistics. All ratios use fractions internally.
import {checkedNav,detailPeriods,feeParts} from './v14-compute.mjs';
import {portfolioRisk,historicalPath} from './quant.mjs';
export const RESEARCH_METHOD='holdings-research-v16-2026-11-26';
const EPS=1e-12,finite=Number.isFinite;
export const average=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export function percentile(a,p){if(!a.length)return null;const x=[...a].sort((a,b)=>a-b),i=(x.length-1)*p,k=Math.floor(i);return x[k]+(x[Math.ceil(i)]-x[k])*(i-k);}
export function correlation(a,b){if(a.length!==b.length||a.length<2)return null;const x=average(a),y=average(b);let aa=0,bb=0,ab=0;for(let i=0;i<a.length;i++){aa+=(a[i]-x)**2;bb+=(b[i]-y)**2;ab+=(a[i]-x)*(b[i]-y);}return aa>EPS&&bb>EPS?Math.max(-1,Math.min(1,ab/Math.sqrt(aa*bb))):null;}
export function pathExperience(points){
 if(points.length<2)return {ready:false,reason:'需要连续净值历史'};
 const values=points.map(p=>p[1]),first=values[0],returns=values.slice(1).map((v,i)=>v/values[i]-1),drawdowns=[],episodes=[];let high=first,highDate=points[0][0],run=null,longest=0,maxDD=0;
 for(let i=0;i<points.length;i++){
  const [date,value]=points[i];if(value>=high-EPS){if(run){episodes.push({...run,end:date,ongoing:false,days:i-run.startIndex});run=null;}high=Math.max(high,value);highDate=date;}
  const dd=Math.max(0,1-value/high);drawdowns.push(dd);maxDD=Math.max(maxDD,dd);
  if(dd>EPS){if(!run)run={start:highDate,startIndex:Math.max(0,i-1),trough:date,depth:dd};if(dd>run.depth){run.depth=dd;run.trough=date;}longest=Math.max(longest,i-run.startIndex);}
 }
 if(run)episodes.push({...run,end:points.at(-1)[0],ongoing:true,days:points.length-1-run.startIndex});
 const annualVol=returns.length>=2?portfolioRisk(returns.map(r=>[r]),[1]).annualVol:null;
 return {ready:true,from:points[0][0],to:points.at(-1)[0],observations:returns.length,totalReturn:values.at(-1)/first-1,annualVol,maxDrawdown:maxDD,ulcer:Math.sqrt(average(drawdowns.map(x=>x*x))),underwaterShare:drawdowns.filter(x=>x>EPS).length/drawdowns.length,deepShare:drawdowns.filter(x=>x>=.1).length/drawdowns.length,longestUnderwater:longest,currentDrawdown:drawdowns.at(-1),episodes:episodes.sort((a,b)=>b.depth-a.depth).slice(0,5),drawdowns,points};
}
export function rollingExperience(points,horizons=[63,126,252]){
 return horizons.map(days=>{const values=[];for(let i=0;i+days<points.length;i++)values.push(points[i+days][1]/points[i][1]-1);return {days,n:values.length,ready:values.length>=30,winShare:values.length?values.filter(x=>x>0).length/values.length:null,p10:percentile(values,.1),median:percentile(values,.5),p90:percentile(values,.9),worst:values.length?Math.min(...values):null,best:values.length?Math.max(...values):null};});
}
export function entryExperience(points,horizons=[63,126,252]){
 const starts=new Map();points.forEach((p,i)=>{const month=p[0].slice(0,7);if(!starts.has(month))starts.set(month,i);});
 return [...starts].map(([month,i])=>({month,date:points[i][0],values:horizons.map(h=>i+h<points.length?points[i+h][1]/points[i][1]-1:null)}));
}
export function alignResearch(funds,calendar,asOf){
 if(!funds.length)return {ready:false,reason:'请添加持仓',missing:[]};
 const checked=funds.map(f=>checkedNav(f.adjusted,f.profile||f,calendar,asOf)),missing=checked.flatMap((x,i)=>x.ready?[]:[{code:funds[i].code,name:funds[i].name,reason:x.reason}]);
 if(missing.length)return {ready:false,reason:missing.map(x=>x.name+'：'+x.reason).join('；'),missing};
 const from=checked.map(x=>x.from).sort().at(-1),to=checked.map(x=>x.to).sort()[0],dates=calendar.filter(d=>d>=from&&d<=to),maps=checked.map(x=>new Map(x.points));
 if(dates.length<201||maps.some(m=>dates.some(d=>!m.has(d))))return {ready:false,reason:'共同连续区间不足200个日收益',missing:[]};
 const points=dates.map(d=>[d,...maps.map(m=>m.get(d))]),rows=points.slice(1).map((p,i)=>({date:p[0],from:points[i][0],values:maps.map((_,j)=>p[j+1]/points[i][j+1]-1)}));
 return {ready:true,from,to,dates,rows,points,checked};
}
// Exact 5% probability mass, including a fractional boundary observation.
export function tailAttribution(rows,weights,massFraction=.05){
 if(!rows.length||massFraction<=0||massFraction>1)return null;
 const scored=rows.map(r=>({...r,value:r.values.reduce((s,v,i)=>s+v*weights[i],0)})).sort((a,b)=>a.value-b.value),mass=rows.length*massFraction;let remaining=mass,sum=0;const contributions=weights.map(()=>0),dates=[];
 for(const row of scored){const n=Math.min(1,remaining);if(n<=EPS)break;sum-=n*row.value;row.values.forEach((v,i)=>contributions[i]-=n*weights[i]*v);dates.push({date:row.date,weight:n});remaining-=n;}
 const value=sum/mass;return {value,contributions:contributions.map(x=>x/mass),shares:value>EPS?contributions.map(x=>x/mass/value):null,mass,dates};
}
export function portfolioResearch(funds,calendar,asOf){
 const a=alignResearch(funds,calendar,asOf);if(!a.ready)return a;
 const weights=funds.map(f=>f.share/100),risk=portfolioRisk(a.rows.map(r=>r.values),weights),tail=tailAttribution(a.rows,weights),path=historicalPath({ready:true,rows:a.rows},weights),points=path.points.map(p=>[p.date,p.value]);
 const down=a.rows.filter(r=>r.values.reduce((s,v,i)=>s+v*weights[i],0)<0),downRisk=down.length>=30?portfolioRisk(down.map(r=>r.values),weights):null;
 const roles=funds.map((f,i)=>{const w=weights.map((v,j)=>i===j?0:v/(1-weights[i]));const without=weights.length>1&&weights[i]<1-EPS?portfolioRisk(a.rows.map(r=>r.values),w):null;
  return {code:f.code,name:f.name,weight:weights[i],annualVol:risk.volatilities[i],riskShare:risk.riskShares?.[i]??null,tailContribution:tail.contributions[i],tailShare:tail.shares?.[i]??null,withoutVol:without?.annualVol??null,removeVolChange:without?without.annualVol-risk.annualVol:null};});
 return {...a,risk,tail,path,experience:pathExperience(points),rolling:rollingExperience(points),entries:entryExperience(points),roles,downCorrelation:downRisk?.correlation||null,downDays:down.length,drawdownMethod:'期初权重投入、基金间不调仓',riskMethod:'按当前固定权重对同期日收益计算'};
}
export function stockSimilarity(a,b){
 const aps=detailPeriods(a),bps=detailPeriods(b),dates=aps.map(p=>p.asOf).filter(d=>bps.some(p=>p.asOf===d)).sort().reverse();
 if(!dates.length)return {ready:false};const asOf=dates[0],ap=aps.find(p=>p.asOf===asOf),bp=bps.find(p=>p.asOf===asOf),bm=new Map(bp.rows.map(r=>[r.code,r.weight/100]));let overlap=0,common=0;
 for(const r of ap.rows){const v=bm.get(r.code)||0;if(v>0&&r.weight>0)common++;overlap+=Math.min(r.weight/100,v);}
 return {ready:true,asOf,overlap,common,coverageA:ap.rows.reduce((s,r)=>s+r.weight/100,0),coverageB:bp.rows.reduce((s,r)=>s+r.weight/100,0)};
}
export function holdingsEvolution(f){
 const ps=(f.detailPeriods||[]).filter(p=>p.rows?.length&&p.rows.every(r=>finite(r.weight)&&r.weight>=0)),kind=p=>/-03-31$|-09-30$/.test(p.asOf)?'quarter':/-06-30$|-12-31$/.test(p.asOf)?'detail':null;
 const groups=['quarter','detail'].map(k=>ps.filter(p=>kind(p)===k).sort((a,b)=>a.asOf.localeCompare(b.asOf))).filter(x=>x.length>=2).sort((a,b)=>b.at(-1).asOf.localeCompare(a.at(-1).asOf));
 if(!groups.length)return {ready:false,reason:'需要两期同类型持仓披露'};
 const g=groups[0],[a,b]=g.slice(-2),k=Math.min(10,a.rows.length,b.rows.length),top=p=>[...p.rows].sort((a,b)=>b.weight-a.weight).slice(0,k),x=top(a),y=top(b),am=new Map(x.map((r,i)=>[r.code,{...r,rank:i+1}])),bm=new Map(y.map((r,i)=>[r.code,{...r,rank:i+1}])),codes=[...new Set([...am.keys(),...bm.keys()])],common=codes.filter(c=>am.has(c)&&bm.has(c)).length;
 return {ready:true,from:a.asOf,to:b.asOf,k,common,persistence:common/k,jaccard:common/codes.length,topWeightA:x.reduce((s,r)=>s+r.weight/100,0),topWeightB:y.reduce((s,r)=>s+r.weight/100,0),rows:codes.map(code=>({code,name:(bm.get(code)||am.get(code)).name,previous:am.get(code)?.weight??null,current:bm.get(code)?.weight??null,previousRank:am.get(code)?.rank??null,currentRank:bm.get(code)?.rank??null,status:!am.has(code)?'进入前列':!bm.has(code)?'离开前列':'持续在列'})).sort((a,b)=>(a.currentRank??99)-(b.currentRank??99))};
}
export function disclosedStructure(funds){
 const eligible=funds.filter(f=>detailPeriods(f).length);if(!eligible.length)return {ready:false,reason:'请读取基金持仓资料'};
 const dates=detailPeriods(eligible[0]).map(p=>p.asOf).filter(d=>eligible.every(f=>detailPeriods(f).some(p=>p.asOf===d))).sort().reverse();if(!dates.length)return {ready:false,reason:'缺少共同报告期'};
 const asOf=dates[0],map=new Map();for(const f of eligible)for(const r of detailPeriods(f).find(p=>p.asOf===asOf).rows){const old=map.get(r.code)||{code:r.code,name:r.name,weight:0};old.weight+=f.share/100*r.weight/100;map.set(r.code,old);}
 const rows=[...map.values()].filter(r=>r.weight>0).sort((a,b)=>b.weight-a.weight),coverage=rows.reduce((s,r)=>s+r.weight,0);if(coverage<=0)return {ready:false,reason:'披露中没有正股票权重'};
 const hhi=rows.reduce((s,r)=>s+(r.weight/coverage)**2,0),fundHHI=funds.reduce((s,f)=>s+(f.share/100)**2,0);
 return {ready:true,asOf,rows,coverage,nominal:rows.length,effective:1/hhi,multiple:rows.length*hhi,hhi,top10:rows.slice(0,10).reduce((s,r)=>s+r.weight,0),fundEffective:1/fundHHI,includedFunds:eligible.length,totalFunds:funds.length};
}
function monthNumber(s){return Number(s.slice(0,4))*12+Number(s.slice(5,7));}
export function monthlyPairs(a,b,asOf){
 const bm=new Map(b),m=new Map();for(const [date,v]of a)if(bm.has(date)&&date<=asOf)m.set(date.slice(0,7),{date,a:v,b:bm.get(date)});
 const ends=[...m.values()].sort((a,b)=>a.date.localeCompare(b.date)),out=[];for(let i=1;i<ends.length;i++){const x=ends[i-1],y=ends[i];if(y.date.slice(0,7)>=asOf.slice(0,7)||monthNumber(y.date)-monthNumber(x.date)!==1)continue;out.push({month:y.date.slice(0,7),a:y.a/x.a-1,b:y.b/x.b-1});}return out;
}
export function captureProfile(a,b,asOf){
 const months=monthlyPairs(a,b,asOf),calc=rows=>{if(rows.length<6)return null;const geo=key=>Math.expm1(average(rows.map(x=>Math.log1p(x[key])))),ref=geo('b');return Math.abs(ref)>1e-5?geo('a')/ref:null;},up=months.filter(x=>x.b>0),down=months.filter(x=>x.b<0);
 return {up:calc(up),down:calc(down),upMonths:up.length,downMonths:down.length,months:months.length,from:months[0]?.month||null,to:months.at(-1)?.month||null};
}
export function comparablePair(a,b,calendar,asOf){
 const aligned=alignResearch([{...a,share:50},{...b,share:50}],calendar,asOf);if(!aligned.ready)return {ready:false,reason:aligned.reason};
 const pa=aligned.points.map(p=>[p[0],p[1]]),pb=aligned.points.map(p=>[p[0],p[2]]),x=pathExperience(pa),y=pathExperience(pb),ra=aligned.rows.map(r=>r.values[0]),rb=aligned.rows.map(r=>r.values[1]),trackingError=portfolioRisk(ra.map((r,i)=>[r-rb[i]]),[1]).annualVol;
 return {ready:true,from:aligned.from,to:aligned.to,n:aligned.rows.length,correlation:correlation(ra,rb),trackingError,stock:stockSimilarity(a,b),capture:captureProfile(pa,pb,asOf),a:x,b:y,rollingA:rollingExperience(pa),rollingB:rollingExperience(pb),feeA:feeParts(a.profile||{}),feeB:feeParts(b.profile||{})};
}
