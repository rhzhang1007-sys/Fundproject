// All weights and returns in this module are fractions, not percentages.
export const METHOD_VERSION='portfolio-v1.2026-11-06';
export const POLICY=Object.freeze({annualDays:252,minRiskSamples:200,minTailSamples:600,rollingWindow:60,minDownDays:40});
const EPS=1e-12;
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function isoDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value;}
export function checkedWeights(weights){if(!Array.isArray(weights)||!weights.length||weights.some(w=>!finite(w)||w<0)||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-8)throw Error('组合权重须为非负小数且合计1');return weights;}
export function covariance(rows){
 if(!Array.isArray(rows)||rows.length<2||!rows[0]?.length)throw Error('协方差至少需要两个有效日收益样本');
 const n=rows[0].length;if(rows.some(r=>r.length!==n||r.some(x=>!finite(x))))throw Error('收益样本维度或数值无效');
 const means=Array.from({length:n},(_,i)=>mean(rows.map(r=>r[i])));
 return means.map((_,i)=>means.map((_,j)=>rows.reduce((s,r)=>s+(r[i]-means[i])*(r[j]-means[j]),0)/(rows.length-1)));
}
export function correlation(matrix){return matrix.map((r,i)=>r.map((x,j)=>matrix[i][i]>EPS&&matrix[j][j]>EPS?Math.max(-1,Math.min(1,x/Math.sqrt(matrix[i][i]*matrix[j][j]))):null));}
export function portfolioRisk(rows,weights){
 checkedWeights(weights);if(rows.some(r=>r.length!==weights.length))throw Error('权重与收益维度不一致');
 const cov=covariance(rows),cw=cov.map(r=>r.reduce((s,x,j)=>s+x*weights[j],0));
 const variance=Math.max(0,cw.reduce((s,x,i)=>s+x*weights[i],0)),dailyVol=Math.sqrt(variance);
 const volatilities=cov.map((r,i)=>Math.sqrt(Math.max(0,r[i]))*Math.sqrt(POLICY.annualDays));
 const annualVol=dailyVol*Math.sqrt(POLICY.annualDays),referenceVol=volatilities.reduce((s,v,i)=>s+v*weights[i],0);
 return {covariance:cov,correlation:correlation(cov),variance,dailyVol,annualVol,volatilities,referenceVol,riskShares:variance>EPS?cw.map((x,i)=>weights[i]*x/variance):null,diversificationRatio:dailyVol>EPS?referenceVol/annualVol:null,reduction:referenceVol>EPS?1-annualVol/referenceVol:null};
}
export function expectedShortfall(losses,confidence=.95){
 if(!Array.isArray(losses)||!losses.length||losses.some(x=>!finite(x))||confidence<=0||confidence>=1)throw Error('尾部损失输入无效');
 const sorted=[...losses].sort((a,b)=>b-a),mass=losses.length*(1-confidence);let remaining=mass,sum=0;
 for(const value of sorted){const w=Math.min(1,remaining);sum+=w*value;remaining-=w;if(remaining<=EPS)break;}
 return {value:sum/mass,tailMass:mass,confidence,n:losses.length};
}
function yearsBefore(date,years){const d=new Date(date+'T00:00:00Z'),year=d.getUTCFullYear()-years,month=d.getUTCMonth(),day=d.getUTCDate();return new Date(Date.UTC(year,month,Math.min(day,new Date(Date.UTC(year,month+1,0)).getUTCDate()))).toISOString().slice(0,10);}
// A verified exchange calendar prevents multi-day gaps being treated as one day.
export function alignTotalReturns(series,ids,calendar,{years=3,asOf=null}={}){
 const fail=(reason,missing=[])=>({ready:false,reason,missing,rows:[],n:0,ids});
 if(!ids.length)return fail('未选择持有基金');
 const selected=ids.map(id=>series.find(s=>s.id===id));
 const missing=ids.filter((id,i)=>!selected[i]?.verified||selected[i]?.basis!=='nav-total-return'||!Array.isArray(selected[i]?.points)||selected[i].points.length<2);
 if(missing.length)return fail('缺少已核实分红、折算口径的历史总回报序列',missing);
 if(!Array.isArray(calendar)||calendar.length<2||calendar.some(d=>!isoDate(d))||new Set(calendar).size!==calendar.length||calendar.some((d,i)=>i&&d<=calendar[i-1]))return fail('交易日历尚未收集或顺序无效');
 const maps=[];
 for(const s of selected){
  if(s.currency!=='CNY')return fail('目前只支持同一人民币口径');
  const map=new Map();
  for(const p of s.points){if(!isoDate(p.date)||!finite(p.value)||p.value<=0||map.has(p.date))return fail('总回报序列有重复日期或无效值',[s.id]);map.set(p.date,p.value);}
  maps.push(map);
 }
 const availableEnds=maps.map(m=>[...m.keys()].filter(d=>!asOf||d<=asOf).sort().at(-1));
 if(availableEnds.some(d=>!d))return fail('所选截止日没有可用收益数据');
 const end=availableEnds.sort()[0],cut=yearsBefore(end,years),rows=[];let skipped=0,expected=0;
 for(let k=1;k<calendar.length;k++){
  const from=calendar[k-1],date=calendar[k];if(date>end||from<cut)continue;expected++;
  if(maps.some(m=>!m.has(from)||!m.has(date))){skipped++;continue;}
  rows.push({from,date,values:maps.map(m=>m.get(date)/m.get(from)-1)});
 }
 if(rows.length<2)return fail('可对齐的有效单日收益不足');
 return {ready:true,ids,rows,n:rows.length,from:rows[0].from,to:rows.at(-1).date,skipped,expected,years,complete:skipped===0,seriesVersions:selected.map(s=>({id:s.id,version:s.version||null,source:s.source||null}))};
}
export function rollingCorrelation(aligned,window=60){
 if(!aligned.ready||aligned.ids.length!==2)return [];
 const points=[];for(let i=window-1;i<aligned.rows.length;i++){
  const part=aligned.rows.slice(i-window+1,i+1);if(part.some((r,j)=>j&&r.from!==part[j-1].date))continue;
  points.push({date:part.at(-1).date,value:correlation(covariance(part.map(r=>r.values)))[0][1]});
 }return points;
}
export function historicalPath(aligned,weights,{from=null,to=null}={}){
 checkedWeights(weights);if(!aligned.ready)return {ready:false,reason:aligned.reason};
 const rows=aligned.rows.filter(r=>(!from||r.from>=from)&&(!to||r.date<=to));
 if(!rows.length)return {ready:false,reason:'所选区间没有有效样本'};
 if(from&&rows[0].from!==from||to&&rows.at(-1).date!==to)return {ready:false,reason:'区间起止日须有完整交易日数据'};
 if(rows.some((r,i)=>r.values.length!==weights.length||i&&r.from!==rows[i-1].date))return {ready:false,reason:'历史路径存在缺失交易日，请先补齐'};
 let holdings=weights.map(x=>x),peak=1,peakDate=rows[0].from,maxDD=0,eventPeak=peakDate,trough=peakDate;
 const points=[{date:peakDate,value:1,drawdown:0}];
 for(const row of rows){holdings=holdings.map((v,i)=>v*(1+row.values[i]));const value=holdings.reduce((s,x)=>s+x,0);if(value>peak){peak=value;peakDate=row.date;}const drawdown=1-value/peak;if(drawdown>maxDD+EPS){maxDD=drawdown;eventPeak=peakDate;trough=row.date;}points.push({date:row.date,value,drawdown});}
 const peakValue=points.find(p=>p.date===eventPeak).value,recovery=maxDD>EPS?points.find(p=>p.date>trough&&p.value>=peakValue-EPS)?.date||null:points[0].date;
 const end=points.at(-1),days=(Date.parse(end.date)-Date.parse(points[0].date))/86400000;
 return {ready:true,from:points[0].date,to:end.date,points,totalReturn:end.value-1,minReturn:Math.min(...points.map(p=>p.value))-1,maxDrawdown:maxDD,peakDate:eventPeak,troughDate:trough,recoveryDate:recovery,observedDays:(Date.parse(recovery||end.date)-Date.parse(eventPeak))/86400000,cagr:days>=365?end.value**(365/days)-1:null,contributions:holdings.map((v,i)=>v-weights[i]),rule:'initial-weights-buy-and-hold'};
}
export function trackingMetrics(rows){
 if(!Array.isArray(rows)||rows.length<2||rows.some(r=>r.length!==2||r.some(x=>!finite(x)||x<=-1)))return {ready:false,reason:'缺少可比的基金与合同基准收益'};
 const differences=rows.map(r=>r[0]-r[1]),m=mean(differences),v=differences.reduce((s,x)=>s+(x-m)**2,0)/(rows.length-1);
 const growth=i=>rows.reduce((v,r)=>v*(1+r[i]),1)-1;
 return {ready:true,trackingError:Math.sqrt(v*POLICY.annualDays),trackingDifference:growth(0)-growth(1),fundReturn:growth(0),benchmarkReturn:growth(1)};
}
export function scenarioImpact(share,shock,total=null){
 if(!finite(share)||share<0||share>1+EPS||!finite(shock)||shock< -1||shock>1||total!==null&&(!finite(total)||total<=0))return {valid:false,reason:'比例或情景参数无效'};
 return {valid:true,share,shock,portfolioReturn:share*shock,amount:total===null?null:total*share*shock,affectedAmount:total===null?null:total*share,total};
}
