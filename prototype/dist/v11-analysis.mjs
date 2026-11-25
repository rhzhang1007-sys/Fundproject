import {alignTotalReturns,portfolioRisk,historicalPath,expectedShortfall,trackingMetrics,isoDate} from './quant.mjs';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>Number.isFinite(v)?(v*100).toFixed(2)+'%':'—',money=v=>Number.isFinite(v)?'¥'+v.toLocaleString('zh-CN',{maximumFractionDigits:2}):'—';
const metric=(name,value,sub='')=>`<div class="v8-metric"><span>${h(name)}</span><strong>${h(value??'—')}</strong>${sub?`<small>${h(sub)}</small>`:''}</div>`;
const formula=text=>`<details class="v8-formula"><summary>公式</summary><p>${h(text)}</p></details>`;
const dayDiff=(a,b)=>(Date.parse(b)-Date.parse(a))/86400000;
export function structureV2(model){
 const fs=model.funds,eligible=f=>(f.periods||[]).filter(p=>p.complete===true||p.holdings.length>=20);
 const common=fs.length?eligible(fs[0]).map(p=>p.asOf).filter(d=>fs.every(f=>eligible(f).some(p=>p.asOf===d))).sort().reverse():[];
 if(!common.length)return {ready:false,reason:'缺少同报告期的详细持仓',coverage:model.covered/100};
 const asOf=common[0],positions=new Map(),selected=[];let unknown=false;
 for(const f of fs){const p=eligible(f).find(p=>p.asOf===asOf);selected.push({fund:f,period:p});for(const row of p.holdings){if(!Number.isFinite(row.weightPercent)||row.weightPercent<0||row.weightPercent>100){unknown=true;continue;}const old=positions.get(row.code)||{code:row.code,name:row.name,weight:0};old.weight+=f.share/100*row.weightPercent/100;positions.set(row.code,old);}}
 const companies=[...positions.values()].sort((a,b)=>b.weight-a.weight),coverage=companies.reduce((s,c)=>s+c.weight,0);
 if(unknown||coverage<.5)return {ready:false,reason:unknown?'部分股票占比待核':'同报告期已展开比例低于50%',asOf,coverage,companies};
 const hhi=companies.reduce((s,c)=>s+(c.weight/coverage)**2,0),effective=1/hhi;
 const pairs=[];
 for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++){const a=selected[i],b=selected[j],bm=new Map(b.period.holdings.map(r=>[r.code,r.weightPercent/100]));pairs.push({a:a.fund.name,b:b.fund.name,weight:a.period.holdings.reduce((s,r)=>s+Math.min(r.weightPercent/100,bm.get(r.code)||0),0)});}
 return {ready:true,asOf,coverage,companies,hhi,effective,nominal:companies.length,multiple:companies.length/effective,top5:companies.slice(0,5).reduce((s,c)=>s+c.weight,0)/coverage,pairs,complete:selected.every(x=>x.period.complete===true)};
}
export function riskV2(model,data={}){
 const ids=model.funds.map(f=>f.id),weights=model.funds.map(f=>f.share/100),aligned=alignTotalReturns(data.series||[],ids,data.calendar||[],{asOf:data.asOf||new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})});
 if(!aligned.ready)return {ready:false,reason:'总回报尚未核验或有效日收益不足200条',aligned};
 const risk=portfolioRisk(aligned.rows.map(r=>r.values),weights);
 const riskReady=aligned.n>=200&&risk.volatilities.every(v=>v>0)&&Boolean(risk.riskShares);
 const path=historicalPath(aligned,weights),maxIndex=weights.indexOf(Math.max(...weights));
 const established=model.funds.some(f=>!isoDate(f.profile?.establishedAt)||dayDiff(f.profile.establishedAt,aligned.to)<365);
 const pathReady=path.ready&&!established&&dayDiff(path.from,path.to)>=365;
 const pathReason=!path.ready?'历史区间存在缺失':established?'成立日期未齐或不足一年':dayDiff(path.from,path.to)<365?'历史区间不足一年':'';
 const counter=pathReady?historicalPath({...aligned,rows:aligned.rows.map(r=>({...r,values:[r.values[maxIndex]]}))},[1]):null;
 const directional=[];for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)directional.push({a:model.funds[i].name,b:model.funds[j].name,fraction:aligned.rows.filter(r=>r.values[i]>0&&r.values[j]>0||r.values[i]<0&&r.values[j]<0).length/aligned.n,correlation:risk.correlation[i][j]});
 const losses=aligned.rows.map(r=>-r.values.reduce((s,x,i)=>s+x*weights[i],0));
 return {ready:riskReady,reason:riskReady?'':aligned.n<200?'有效日收益不足200条':'存在零波动序列',pathReason,aligned,risk,deviations:riskReady?risk.riskShares.map((x,i)=>({name:model.funds[i].name,weight:weights[i],riskShare:x,deviation:x-weights[i]})):[],path:pathReady?{...path,recoveryDays:path.maxDrawdown===0?0:path.recoveryDate?dayDiff(path.troughDate,path.recoveryDate):null}:null,counter:counter?.ready?{...counter,name:model.funds[maxIndex].name,recoveryDays:counter.maxDrawdown===0?0:counter.recoveryDate?dayDiff(counter.troughDate,counter.recoveryDate):null}:null,tail:aligned.n>=200?expectedShortfall(losses):null,worst:-Math.max(...losses),directional};
}
export function captureRatio(rows){
 if(!Array.isArray(rows)||rows.some(r=>r.length!==2||r.some(x=>!Number.isFinite(x)||x<=-1)))throw Error('捕获比输入无效');
 const one=sign=>{const selected=rows.filter(r=>sign*r[1]>0);if(!selected.length)return null;const growth=i=>selected.reduce((g,r)=>g*(1+r[i]),1)-1,b=growth(1);return Math.abs(b)>1e-12?growth(0)/b:null;};
 return {up:one(1),down:one(-1)};
}
export function benchmarkV2(model,data={}){
 if(!model.funds.length)return {capture:null,tracking:[]};
 const weights=model.funds.map(f=>f.share/100),alignIndex=(ids,benchmark)=>{
  if(!benchmark?.verified||!['total-return','price-return'].includes(benchmark.basis))return null;
  const aligned=alignTotalReturns([...(data.series||[]),{...benchmark,basis:'nav-total-return'}],[...ids,benchmark.id],data.calendar||[],{asOf:data.asOf||new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})});return aligned.ready&&aligned.n>=200&&aligned.rows.every((r,i)=>!i||r.from===aligned.rows[i-1].date)?aligned:null;
 };
 const reference=(data.indices||[]).find(x=>x.id===data.marketReference),marketAligned=alignIndex(model.funds.map(f=>f.id),reference);let capture=null;
 if(marketAligned){const path=historicalPath({...marketAligned,rows:marketAligned.rows.map(r=>({...r,values:r.values.slice(0,-1)}))},weights);if(path.ready){capture={...captureRatio(marketAligned.rows.map((r,i)=>[path.points[i+1].value/path.points[i].value-1,r.values.at(-1)])),name:reference.name,basis:reference.basis,from:marketAligned.from,to:marketAligned.to};}}
 const tracking=model.funds.filter(f=>/ETF/.test(f.name+' '+f.type)&&!/联接/.test(f.name+' '+f.type)).map(f=>{const product=(data.products||[]).find(x=>x.fundId===f.id),index=(data.indices||[]).find(x=>x.id===product?.benchmarkId),aligned=alignIndex([f.id],index);return {name:f.name,benchmark:index?.name,basis:index?.basis,from:aligned?.from,to:aligned?.to,...(aligned?trackingMetrics(aligned.rows.map(r=>r.values)):{ready:false,reason:'缺少已核合同基准与同区间收益'})};});
 return {capture,tracking};
}
export function annualFee(f){
 const fees=f.profile?.fees||{};const value=x=>{if(Number.isFinite(x?.annualDecimal))return x.annualDecimal;if(Number.isFinite(x?.rawPercentValue))return x.rawPercentValue/100;const m=typeof x==='string'&&/^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(x);return m?Number(m[1])/100:null;};
 const parts=['management','custody','service'].map(k=>value(fees[k]));return parts.every(Number.isFinite)?parts.reduce((s,v)=>s+v,0):null;
}
export function factorEvidence(model,data={}){
 const s=structureV2(model),r=riskV2(model,data),b=benchmarkV2(model,data),lines=['确定性计算结果。以下比例来自当前选择的组合，不包含持仓金额。'];
 if(s.ready)lines.push(`持仓报告日 ${s.asOf}；已展开 ${pct(s.coverage)}；名义持股 ${s.nominal} 只；有效持股 ${s.effective.toFixed(1)} 只；分散幻觉倍数 ${s.multiple.toFixed(2)} 倍；前五家占已展开部分 ${pct(s.top5)}；HHI ${s.hhi.toFixed(4)}。`);else lines.push('结构：'+s.reason);
 if(r.ready){lines.push(`收益区间 ${r.aligned.from} 至 ${r.aligned.to}；有效日收益 ${r.aligned.n} 条；年化波动 ${pct(r.risk.annualVol)}；分散化比率 ${r.risk.diversificationRatio.toFixed(3)}。`);for(const x of r.deviations.slice(0,30))lines.push(`${x.name}：资金权重 ${pct(x.weight)}；波动贡献 ${pct(x.riskShare)}；偏离 ${(x.deviation*100).toFixed(2)} 个百分点。`);}else lines.push('风险：'+r.reason);
 if(r.path)lines.push(`最大回撤 ${pct(r.path.maxDrawdown)}；前高日 ${r.path.peakDate}；低点日 ${r.path.troughDate}；恢复日 ${r.path.recoveryDate||'尚未恢复'}；回本 ${r.path.recoveryDays===null?'尚未恢复':r.path.recoveryDays+' 天'}。`);else lines.push('回撤：'+(r.pathReason||r.reason));
 if(r.tail)lines.push(`历史 ES（5%）${pct(r.tail.value)}；最差单日 ${pct(r.worst)}。`);
 const fees=model.funds.map(annualFee);lines.push('组合年化持有费率 '+(fees.length&&fees.every(Number.isFinite)?pct(fees.reduce((n,v,i)=>n+v*model.funds[i].share/100,0)):'缺少费率字段'));
 if(b.capture)lines.push(`${b.capture.name}：上行捕获比 ${pct(b.capture.up)}；下行捕获比 ${pct(b.capture.down)}。`);
 return lines.join('\n');
}
export function renderAnalysisV2(model,bounds,data={},tab='structure'){
 const s=structureV2(model),r=riskV2(model,data),path=r.path,bm=benchmarkV2(model,data);const maxDev=r.ready?[...r.deviations].sort((a,b)=>Math.abs(b.deviation)-Math.abs(a.deviation))[0]:null;
 const titles={structure:'结构',risk:'风险',pressure:'承压',cost:'成本'};
 const headline=`<div class="v8-metrics v11-primary">${metric('分散幻觉倍数',s.ready?s.multiple.toFixed(2)+' 倍':'—',s.ready?`名义 ${s.nominal} 只 · 有效 ${s.effective.toFixed(1)} 只`:s.reason)}${metric('风险预算偏离',maxDev?(maxDev.deviation>=0?'+':'')+(maxDev.deviation*100).toFixed(2)+' 个百分点':'—',maxDev?maxDev.name:r.aligned?.ready?r.reason:'总回报尚未核验')}${metric('最大回撤 / 回本时长',path?pct(path.maxDrawdown)+' / '+(path.recoveryDays===null?'尚未恢复':path.recoveryDays+' 天'):'—',path?`${path.from} 至 ${path.to}`:r.pathReason||'总回报尚未核验')}</div>`;
 let body='';
 if(tab==='structure')body=`<small class="v8-muted">${h(s.asOf||'最新披露')} · 已展开 ${pct(s.coverage)}${s.ready?' · '+(s.complete?'完整披露':'已收录部分'):''}</small><div class="v8-metrics">${metric('最大已披露股票占组合',pct(s.companies?.[0]?.weight??(Number.isFinite(model.companies[0]?.share)?model.companies[0].share/100:null)))}${s.ready?metric('前五家占已展开部分',pct(s.top5))+metric('已展开部分 HHI',s.hhi.toFixed(4)):''}</div><div class="v8-bars">${(s.companies||model.companies.map(c=>({...c,weight:Number.isFinite(c.share)?c.share/100:null}))).slice(0,10).map(c=>`<div><span>${h(c.name)}</span><progress value="${Number.isFinite(c.weight)?c.weight:0}" max="${s.companies?.[0]?.weight||model.companies[0]?.share/100||1}"></progress><strong>${pct(c.weight)}</strong></div>`).join('')}</div>${s.pairs?.length?`<h3>已披露持仓重合</h3><table class="v7-table"><tbody>${s.pairs.map(p=>`<tr><td>${h(p.a)} / ${h(p.b)}</td><td>${pct(p.weight)}</td></tr>`).join('')}</tbody></table>`:''}<p class="v8-muted">有效持股数表示已展开股票在当前集中程度下，相当于多少只等权股票。</p>${formula('股票占组合 = Σ（基金资金权重 × 股票占基金净资产比）；pᵢ = 股票占组合 ÷ 已展开比例；有效持股数 = 1 / Σpᵢ²；分散幻觉倍数 = 名义持股数 / 有效持股数。名义只数按报告列示股票去重，含来源占比四舍五入为0的条目。仅前十大不计算。')}`;
 if(tab==='risk')body=r.ready?`<small>${h(r.aligned.from)} 至 ${h(r.aligned.to)} · ${r.aligned.n} 个有效日收益</small><div class="v8-metrics">${metric('年化波动',pct(r.risk.annualVol))}${metric('分散化比率',r.risk.diversificationRatio?.toFixed(3))}</div><table class="v7-table"><thead><tr><th>基金</th><th>资金权重</th><th>波动贡献</th><th>偏离（百分点）</th></tr></thead><tbody>${r.deviations.map(x=>`<tr><td>${h(x.name)}</td><td>${pct(x.weight)}</td><td>${pct(x.riskShare)}</td><td>${(x.deviation*100).toFixed(2)}</td></tr>`).join('')}</tbody></table>${r.directional.map(x=>`<p>${h(x.a)} / ${h(x.b)}：同向天数 ${pct(x.fraction)} <small>相关系数 ${x.correlation?.toFixed(3)}</small></p>`).join('')}`:`<p class="v8-muted">${h(r.reason)}</p>`;
 if(tab==='risk')body+='<p class="v8-muted">波动贡献用于比较各基金对组合波动的影响。</p>'+formula('Σ为去均值后除以n−1的日收益协方差。波动贡献份额 = wᵢ(Σw)ᵢ / (wᵀΣw)，允许负值；风险预算偏离 = 波动贡献份额 − 资金权重。分散化比率不表示风险高低。');
 if(tab==='risk')body+=`<details><summary>基准比较</summary>${bm.capture?`<small>${h(bm.capture.name)} · ${bm.capture.basis==='price-return'?'价格指数':'全收益指数'} · ${h(bm.capture.from)} 至 ${h(bm.capture.to)}</small><div class="v8-metrics">${metric('上行捕获比',pct(bm.capture.up))}${metric('下行捕获比',pct(bm.capture.down))}</div>`:'<p class="v8-muted">缺少已核参考基准与同区间收益。</p>'}${formula('分别选取基准上涨日和下跌日，复合组合与基准在这些日期的日收益，捕获比 = 组合复合收益 ÷ 基准复合收益；基准为零时不计算。组合不调仓。')}</details>`;
 if(tab==='pressure')body=`${path?`<div class="v8-metrics">${metric('前高日',path.peakDate)}${metric('低点日',path.troughDate)}${metric('恢复日',path.recoveryDate||'尚未恢复')}</div><p>只持 ${h(r.counter.name)}：最大回撤 ${pct(r.counter.maxDrawdown)} · ${r.counter.recoveryDays===null?'尚未恢复':r.counter.recoveryDays+' 天'}</p>`:''}${r.tail?`<div class="v8-metrics">${metric('历史 ES（5%）',pct(r.tail.value))}${metric('最差单日',pct(r.worst))}</div>`:'<p class="v8-muted">总回报尚未核验</p>'}<h3>情景测算</h3><form id="scenario-form" class="v8-inline-form"><label>对象<select name="scope"><option value="all">整个组合</option>${model.funds.map(f=>`<option value="${h(f.id)}">${h(f.name)}</option>`).join('')}</select></label><label>假设涨跌（%）<input name="shock" type="number" min="-100" max="100" value="-20" required></label><button class="v7-btn primary">计算</button></form><div id="scenario-result"></div>${formula('期初按当前资金权重投入，基金之间不调仓；回撤 = 1 − 组合价值 / 此前最高价值；回本天数 = 首次恢复日 − 低点日（自然日）；ES按最差5%概率质量加权。')}`;
 if(tab==='cost'){const fees=model.funds.map(f=>({name:f.name,weight:f.share/100,fee:annualFee(f)})),complete=fees.every(f=>f.fee!==null),rate=complete?fees.reduce((sum,x)=>sum+x.weight*x.fee,0):null;body=`<div class="v8-metrics">${metric('年化持有费率（来源值）',pct(rate))}${metric('按当前金额估算年费',rate===null?'—':money(rate*model.total))}</div><table class="v7-table"><thead><tr><th>基金</th><th>管理＋托管＋销售服务费</th></tr></thead><tbody>${fees.map(f=>`<tr><td>${h(f.name)}</td><td>${pct(f.fee)}</td></tr>`).join('')}</tbody></table><small class="v8-muted">费率条件见基金资料；不含交易、申购赎回费用。</small>${formula('组合年化费率 = Σ（资金权重 × 各基金管理费、托管费与销售服务费之和）。缺少任一费率时不计算组合值。费用占收益比与跟踪评价需要同区间已核总回报及合同基准。')}`;}
 if(tab==='cost')body+=`<details><summary>收益与跟踪比较</summary>${path&&path.totalReturn>0?(()=>{const fees=model.funds.map(f=>annualFee(f)),rate=fees.every(Number.isFinite)?fees.reduce((sum,x,i)=>sum+x*model.funds[i].share/100,0):null;return metric('费率占区间收益比',rate===null?'—':pct(rate*dayDiff(path.from,path.to)/365/path.totalReturn));})():'<p class="v8-muted">费用占收益比需要正的已核区间总回报。</p>'}${bm.tracking.map(x=>`<p>${h(x.name)} · ${x.ready?`${h(x.from)} 至 ${h(x.to)} · ${h(x.benchmark)}（${x.basis==='price-return'?'价格指数':'全收益指数'}）：年化跟踪误差 ${pct(x.trackingError)}；区间跟踪差异 ${pct(x.trackingDifference)}`:h(x.reason)}</p>`).join('')}${formula('跟踪误差 = 基金与合同基准日收益差的样本标准差 × √252；跟踪差异 = 基金区间复合收益 − 基准区间复合收益。费率占收益比为按当前费率估算的对照，并非从净值中再次扣费。')}</details>`;
 return `<h1 class="v7-h1">持仓分析</h1>${headline}<div class="v7-actions"><button data-act="analysis-ai" class="v7-btn">AI 解释指标</button></div><div class="v8-tabs">${Object.entries(titles).map(([id,name])=>`<button data-act="analysis-tab" data-id="${id}" class="${id===tab?'on':''}">${name}</button>`).join('')}</div><section class="v7-card">${body}</section><details class="v7-card"><summary>个人边界</summary><form id="bounds-form" class="v8-inline-form">${[['fund','单只基金上限（%）'],['company','单只股票上限（%）'],['loss','损失关注金额（元）'],['horizon','预计持有期（月）']].map(([key,label])=>`<label>${label}<input name="${key}" type="number" min="0" ${['fund','company'].includes(key)?'max="100"':''} value="${bounds[key]??''}"></label>`).join('')}<button class="v7-btn primary">保存</button></form><p class="v8-muted">基金上限 ${bounds.fund==null?'未设置':bounds.fund+'%'} · 股票上限 ${bounds.company==null?'未设置':bounds.company+'%'} · 损失关注 ${bounds.loss==null?'未设置':money(bounds.loss)}</p></details>`;
}
