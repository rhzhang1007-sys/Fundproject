import {structureV2,riskV2} from './v11-analysis.mjs';
import {portfolioRisk,historicalPath,expectedShortfall,isoDate} from './quant.mjs';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>Number.isFinite(v)?(v*100).toFixed(2)+'%':'—',money=v=>Number.isFinite(v)?'¥'+v.toLocaleString('zh-CN',{maximumFractionDigits:2}):'—';
const metric=(name,value,sub='')=>`<div class="v8-metric"><span>${h(name)}</span><strong>${h(value)}</strong><small>${h(sub)}</small></div>`;
const formula=text=>`<details class="v8-formula"><summary>说明与公式</summary><p>${h(text)}</p></details>`;
export function overlapV3(model){
 const pairs=[],missing=[];const valid=p=>(p.complete||p.holdings?.length>=20)&&p.holdings.every(r=>Number.isFinite(r.weightPercent)&&r.weightPercent>=0&&r.weightPercent<=100)&&p.holdings.reduce((s,r)=>s+r.weightPercent,0)<=100.5;
 for(let i=0;i<model.funds.length;i++)for(let j=i+1;j<model.funds.length;j++){
  const a=model.funds[i],b=model.funds[j],dates=(a.periods||[]).filter(valid).map(p=>p.asOf).filter(d=>(b.periods||[]).some(p=>p.asOf===d&&valid(p))).sort().reverse();
  if(!dates.length){missing.push({a:a.name,b:b.name});continue;}
  const ap=a.periods.find(p=>p.asOf===dates[0]),bp=b.periods.find(p=>p.asOf===dates[0]),bm=new Map(bp.holdings.map(r=>[r.code,r.weightPercent/100]));let overlap=0,amount=0;
  for(const r of ap.holdings){const x=r.weightPercent/100,y=bm.get(r.code)||0;overlap+=Math.min(x,y);amount+=2*Math.min(a.amount*x,b.amount*y);}
  pairs.push({a:a.name,b:b.name,aId:a.id,bId:b.id,asOf:dates[0],overlap,amount,coverageA:ap.holdings.reduce((s,r)=>s+r.weightPercent/100,0),coverageB:bp.holdings.reduce((s,r)=>s+r.weightPercent/100,0),complete:ap.complete&&bp.complete});
 }
 return {pairs:pairs.sort((a,b)=>b.amount-a.amount),missing};
}
export function observationRisk(model,data){
 const fail=reason=>({ready:false,reason,basis:'source-daily-change'});
 if(model.funds.some(f=>/货币/.test(f.type)||/美元|欧元|港币|英镑|澳元|日元/.test(f.name)&&!f.profile?.currency||f.profile?.currency&&f.profile.currency!=='CNY'))return fail('含货币基金或非人民币份额，暂不合并测算');
 const calendar=(data.calendar||[]).filter(d=>d<=data.asOf),maps=model.funds.map(f=>new Map((f.observations?.history?.points||[]).map(p=>[p[0],p[3]])));
 if(!maps.length||maps.some(m=>m.size<201))return fail('历史日涨跌幅不足200条');
 const available=maps.map(m=>[...m.keys()].filter(d=>d<=data.asOf).sort().at(-1));if(available.some(x=>!x))return fail('所选日期无历史观察');
 const end=available.sort()[0],cut=new Date(end+'T00:00:00Z');cut.setUTCFullYear(cut.getUTCFullYear()-3);const from=[maps.map(m=>[...m.keys()].sort()[0]).sort().at(-1),cut.toISOString().slice(0,10)].sort().at(-1),rows=[];
 for(let i=1;i<calendar.length;i++){
  const d=calendar[i],prev=calendar[i-1];if(prev<from||d>end)continue;
  const values=maps.map(m=>m.get(d));if(values.some(x=>!Number.isFinite(x)||x<=-100)||maps.some(m=>!m.has(prev)))return fail('共同历史区间存在缺失日涨跌幅');
  rows.push({date:d,from:prev,values:values.map(x=>x/100)});
 }
 if(rows.length<200)return fail('共同区间不足200个交易日');
 const aligned={ready:true,rows,n:rows.length,from:rows[0].from,to:rows.at(-1).date},weights=model.funds.map(f=>f.share/100),risk=portfolioRisk(rows.map(r=>r.values),weights);
 if(!risk.riskShares)return fail('来源序列无有效波动');
 const path=historicalPath(aligned,weights);if(!path.ready)return fail(path.reason);
 return {ready:true,basis:'source-daily-change',aligned,risk,path:{...path,recoveryDays:path.maxDrawdown===0?0:path.recoveryDate?(Date.parse(path.recoveryDate)-Date.parse(path.troughDate))/86400000:null},deviations:model.funds.map((f,i)=>({name:f.name,weight:weights[i],riskShare:risk.riskShares[i],deviation:risk.riskShares[i]-weights[i]})),tail:expectedShortfall(rows.map(r=>-r.values.reduce((s,x,i)=>s+x*weights[i],0)))};
}
export function riskV3(model,data){const verified=riskV2(model,data);return verified.ready?{...verified,basis:'verified-total-return'}:observationRisk(model,data);}
export function feeV3(model,groups={}){
 return model.funds.map(f=>{
  const code=f.profile?.trackingIndex?.code,group=groups[code],items=(group?.items||[]).filter(r=>Number.isFinite(r.comparableRatePercent)),own=items.find(r=>r.code===f.code),min=items.length?Math.min(...items.map(r=>r.comparableRatePercent)):null;
  return {fund:f,index:group?.indexName,items:items.sort((a,b)=>a.comparableRatePercent-b.comparableRatePercent),own:own?.comparableRatePercent??null,difference:own&&min!==null?f.amount*(own.comparableRatePercent-min)/100:null};
 });
}
export function validateTargets(model,weights){
 const ids=model.funds.map(f=>f.id);if(ids.length!==Object.keys(weights).length||ids.some(id=>!Number.isFinite(weights[id])||weights[id]<0||weights[id]>100)||Math.abs(ids.reduce((s,id)=>s+weights[id],0)-100)>1e-6)throw Error('目标占比须覆盖全部持仓，合计100%');return weights;
}
export function targetV3(model,goal){
 try{validateTargets(model,goal?.weights||{});}catch{return {ready:false,reason:'请为当前持仓设置目标占比'};}
 const rows=model.funds.map(f=>({id:f.id,name:f.name,current:f.share,target:goal.weights[f.id],difference:f.share-goal.weights[f.id]}));
 const fail=reason=>({ready:true,rows,estimate:null,reason});
 if(!goal.baseline||model.funds.some(f=>!goal.baseline[f.id]?.nav||goal.baseline[f.id].amount!==f.amount))return fail('参考金额缺失或已修改，请重新保存目标与参考值');
 if(new Set(model.funds.map(f=>goal.baseline[f.id].date)).size!==1)return fail('参考净值日期尚未对齐，请在日期齐全后重新保存目标');
 const snapshots=model.funds.map(f=>f.observations?.snapshot);if(snapshots.some(n=>!isoDate(n?.date)||!Number.isFinite(n.nav)||n.nav<=0)||new Set(snapshots.map(n=>n.date)).size!==1)return fail('最新净值日期尚未对齐，仍可比较输入金额与目标');
 const date=snapshots[0].date;if(model.funds.some(f=>date<goal.baseline[f.id].date))return fail('最新净值早于参考日');
 const values=model.funds.map((f,i)=>f.amount*snapshots[i].nav/goal.baseline[f.id].nav),total=values.reduce((s,x)=>s+x,0);
 return {ready:true,rows,estimate:{date,total,rows:rows.map((r,i)=>({...r,value:values[i],weight:values[i]/total*100,drift:values[i]/total*100-r.target}))}};
}
export function factorEvidenceV3(model,bounds,data,goal){
 const o=overlapV3(model),r=riskV3(model,data),fees=feeV3(model,data.feeGroups),t=targetV3(model,goal);
 return ['当前组合确定性结果，金额不发送。',...o.pairs.map(p=>`${p.a} / ${p.b}：${p.asOf}已披露重叠 ${pct(p.overlap)}，覆盖 ${pct(p.coverageA)} / ${pct(p.coverageB)}。`),r.ready?`口径 ${r.basis==='verified-total-return'?'已核总回报':'来源日涨跌幅观察测算，分红折算未独立核验'}；${r.aligned.from} 至 ${r.aligned.to}，${r.aligned.n}日；年化波动 ${pct(r.risk.annualVol)}；最大回撤 ${pct(r.path?.maxDrawdown)}；回本 ${r.path?.recoveryDays??'未恢复'}天。`:r.reason,...fees.filter(x=>x.own!==null).map(x=>`${x.fund.name}：管理与托管年费率 ${x.own.toFixed(2)}%，同指数比较${x.items.length}只。`),...(t.rows||[]).map(x=>`${x.name}：输入金额占比 ${x.current.toFixed(2)}%，目标 ${x.target.toFixed(2)}%，配置差 ${x.difference.toFixed(2)}个百分点。`)].join('\n');
}
function horizonText(path,horizon,to){if(!path||!horizon||!isoDate(path.troughDate))return '';const d=new Date(path.troughDate+'T00:00:00Z'),m=d.getUTCMonth()+horizon,y=d.getUTCFullYear(),limit=new Date(Date.UTC(y,m,Math.min(d.getUTCDate(),new Date(Date.UTC(y,m+1,0)).getUTCDate()))).toISOString().slice(0,10);return path.recoveryDate?path.recoveryDate>limit?'历史恢复用时超过预计持有期限。':'历史恢复用时在预计持有期限内。':to>limit?'截至观察期末尚未恢复，已经超过预计持有期限。':'截至观察期末尚未恢复，仍不能确定恢复时长。';}
export function renderAnalysisV3(model,bounds,data={},tab='overlap',goal=null){
 const o=overlapV3(model),r=riskV3(model,data),s=structureV2(model),fees=feeV3(model,data.feeGroups),t=targetV3(model,goal),max=o.pairs[0],path=r.path;
 const tabs={overlap:'持仓重叠',risk:'风险与期限',cost:'同指数费率',target:'目标配置'};if(!tabs[tab])tab='overlap';
 const headline=max?`${max.a}与${max.b}存在已披露重叠。`:'查看重叠、历史承压、费率与目标配置。';
 const feeTotal=fees.length&&fees.every(x=>x.difference!==null)?fees.reduce((n,x)=>n+x.difference,0):null;
 let body='';
 if(tab==='overlap')body=`<h2>两只基金的共同股票</h2>${o.pairs.map(p=>`<article class="v13-pair"><h3>${h(p.a)} / ${h(p.b)}</h3><div class="v8-metrics">${metric('已披露重叠',pct(p.overlap))}${metric('匹配敞口金额（双边）',money(p.amount))}</div><small>${h(p.asOf)} · 披露覆盖 ${pct(p.coverageA)} / ${pct(p.coverageB)}</small></article>`).join('')||'<p class="v8-muted">需两只基金在同一报告期各有至少20只股票明细。</p>'}${o.missing.length?`<details><summary>${o.missing.length} 对暂缺同报告期明细</summary>${o.missing.slice(0,50).map(p=>`<p>${h(p.a)} / ${h(p.b)}</p>`).join('')}</details>`:''}${formula('重叠比例 = Σmin(A股票占基金净资产比，B对应股票占比)。匹配敞口金额（双边）= 2Σmin(A金额×A股票占比，B金额×B股票占比)。两边各计一次，仅反映已披露部分；多对金额不能相加。前十大不用于此项计算。')}<details><summary>集中度与分散程度</summary>${s.ready?`<p>已展开 ${pct(s.coverage)} · 名义持股 ${s.nominal} 只 · 有效持股 ${s.effective.toFixed(1)} 只 · HHI ${s.hhi.toFixed(4)}</p>`:`<p>${h(s.reason)}</p>`}${formula('有效持股数 = 1 / Σpᵢ²；pᵢ为某股票占已展开部分的比例。未展开部分不视为现金。')}</details>`;
 if(tab==='risk')body=`<h2>历史承压与持有期限</h2>${r.ready?`<small>${h(r.aligned.from)} 至 ${h(r.aligned.to)} · ${r.aligned.n} 日 · ${r.basis==='verified-total-return'?'已核总回报':'来源日涨跌幅观察测算'}</small><div class="v8-metrics">${metric('历史回撤对应金额',path?money(model.total*path.maxDrawdown):'—',path?pct(path.maxDrawdown):'')}${metric('回本时长',path?.recoveryDays===null?'尚未恢复':path?path.recoveryDays+' 天':'—',bounds.horizon?'预计持有 '+bounds.horizon+' 个月':'')}${metric('年化波动',pct(r.risk.annualVol))}</div>${bounds.horizon&&path?`<p>${h(horizonText(path,bounds.horizon,r.aligned.to))}</p>`:''}${bounds.loss&&path?`<p>${model.total*path.maxDrawdown>bounds.loss?'历史回撤测算超过':'历史回撤测算未超过'}损失关注金额 ${money(bounds.loss)}</p>`:''}<details><summary>各基金的波动贡献</summary><table class="v7-table"><thead><tr><th>基金</th><th>资金占比</th><th>波动贡献</th><th>偏离（百分点）</th></tr></thead><tbody>${r.deviations.map(x=>`<tr><td>${h(x.name)}</td><td>${pct(x.weight)}</td><td>${pct(x.riskShare)}</td><td>${(100*x.deviation).toFixed(2)}</td></tr>`).join('')}</tbody></table></details>`:`<p class="v8-muted">${h(r.reason)}</p>`}<h3>情景测算</h3><form id="scenario-form" class="v8-inline-form"><label>对象<select name="scope"><option value="all">整个组合</option>${model.funds.map(f=>`<option value="${h(f.id)}">${h(f.name)}</option>`).join('')}</select></label><label>假设涨跌（%）<input name="shock" type="number" min="-100" max="100" value="-20" required></label><button class="v7-btn primary">计算</button></form><div id="scenario-result"></div>${formula('按当前金额和资金占比还原历史路径，不调仓。回撤金额 = 当前总额×历史最大回撤；回本天数为低点至首次恢复前高的自然日。来源日涨跌幅未经分红、折算独立核验，不等于个人账户收益；保留所有有效涨跌，不删除大幅变动日。波动贡献 = wᵢ(Σw)ᵢ/(wᵀΣw)，允许负值。历史结果不代表未来。')}`;
 if(tab==='cost')body=`<h2>同指数基金的已知年费</h2><small>资料整理日 ${h(String(data.feesBuiltAt||'未提供').slice(0,10))}</small>${fees.map(x=>`<article class="v13-pair"><h3>${h(x.fund.name)}</h3><p>${h(x.index||'暂无同指数比较组')}</p>${x.own!==null?metric('与组内最低费率的年费差额',money(x.difference)):'<p class="v8-muted">缺少本基金可比费率。</p>'}<table class="v7-table"><thead><tr><th>基金</th><th>管理＋托管</th><th>销售服务</th></tr></thead><tbody>${x.items.map(i=>`<tr><td><a href="https://fundf10.eastmoney.com/jbgk_${h(i.code)}.html" target="_blank" rel="noopener noreferrer">${h(i.name)} · ${h(i.code)}</a></td><td>${i.comparableRatePercent.toFixed(2)}%</td><td>${Number.isFinite(i.service)?i.service.toFixed(2)+'%':'未提供'}</td></tr>`).join('')}</tbody></table></article>`).join('')}${formula('按当前金额估算年费差额 = 持有金额×（本基金管理与托管费率−同指数组最低管理与托管费率）。销售服务费未齐时不计入比较。差额不等于换仓净节省；未含交易、申赎费用、折溢价或跟踪差异。')}`;
 if(tab==='target')body=`<h2>当前配置与目标</h2><form id="target-form"><table class="v7-table"><thead><tr><th>基金</th><th>输入金额占比</th><th>目标（%）</th><th>配置差（百分点）</th></tr></thead><tbody>${model.funds.map(f=>`<tr><td>${h(f.name)}</td><td>${f.share.toFixed(2)}%</td><td><input aria-label="${h(f.name)}目标占比" name="${h(f.id)}" type="number" min="0" max="100" step="0.01" value="${h(goal?.weights?.[f.id]??'')}" required></td><td>${t.rows?.find(x=>x.id===f.id)?.difference.toFixed(2)??'—'}</td></tr>`).join('')}</tbody></table><button class="v7-btn primary">保存目标与参考值</button><button type="button" class="v7-btn" data-act="clear-target">清除目标</button></form>${t.estimate?`<h3>按净值推算的配置</h3><small>${h(t.estimate.date)} · 假设参考日起份额不变</small><table class="v7-table"><tbody>${t.estimate.rows.map(x=>`<tr><td>${h(x.name)}</td><td>${money(x.value)}</td><td>${x.weight.toFixed(2)}%</td><td>${x.drift.toFixed(2)} 个百分点</td></tr>`).join('')}</tbody></table>`:`<p class="v8-muted">${h(t.reason)}</p>`}<h3>已设置的上限</h3><p>单只基金 ${bounds.fund==null?'未设置':bounds.fund+'%'} · 单只股票 ${bounds.company==null?'未设置':bounds.company+'%'}</p>${model.funds.filter(f=>bounds.fund!=null&&f.share>bounds.fund).map(f=>`<p>${h(f.name)}：${f.share.toFixed(2)}%，超过基金上限。</p>`).join('')}${model.companies.filter(c=>bounds.company!=null&&Number.isFinite(c.share)&&c.share>bounds.company).map(c=>`<p>${h(c.name)}：已披露占比${c.share.toFixed(2)}%，超过股票上限。</p>`).join('')}${formula('配置差 = 输入金额占比−目标占比。净值推算金额 = 参考金额×最新单位净值/参考单位净值；仅在参考金额未修改、净值日期对齐时展示，不处理期间申赎、分红或折算。实际变化以账户为准。')}`;
 return `<h1 class="v7-h1">持仓分析</h1><p>${h(headline)}</p><div class="v8-metrics v11-primary">${metric('最大一对匹配敞口（双边）',max?money(max.amount):'—',max?'已披露部分':'需同报告期详细持仓')}${metric('历史回撤对应金额',path?money(model.total*path.maxDrawdown):'—',r.ready?r.basis==='source-daily-change'?'来源日涨跌幅观察测算':'按当前总额测算':r.reason)}${metric('可比年费差额',money(feeTotal),'管理与托管费率比较')}</div><div class="v7-actions"><button class="v7-btn" data-act="analysis-ai">AI分析</button></div><div class="v8-tabs">${Object.entries(tabs).map(([id,name])=>`<button data-act="analysis-tab" data-id="${id}" class="${tab===id?'on':''}">${name}</button>`).join('')}</div><section class="v7-card">${body}</section><details class="v7-card"><summary>个人边界</summary><form id="bounds-form" class="v8-inline-form">${[['fund','单只基金上限（%）'],['company','单只股票上限（%）'],['loss','损失关注金额（元）'],['horizon','预计持有期（月）']].map(([key,label])=>`<label>${label}<input name="${key}" type="number" min="0" value="${bounds[key]??''}"></label>`).join('')}<button class="v7-btn primary">保存</button></form></details>`;
}
