import {analysisV7} from './v14-analysis.mjs';import {detailPeriods,overlapV7,checkedNav,navMetrics,outsideSample,percent as prettyPercent} from './v14-compute.mjs';
import {percent} from './v15-ui.mjs';
export const ANALYSIS_MODULES=[
 {name:'组合结构',items:[['overlap','股票重叠','overlap','哪些股票被多只基金共同持有'],['diversification','持股分散','pie','持股数量与权重集中度'],['managers','经理关联','people','基金经理与所管基金的联系']]},
 {name:'历史风险',items:[['risk','风险贡献','shield','资金比例与波动来源'],['drawdown','历史回撤','chart','区间里的下跌与恢复'],['experience','持有体验','pulse','正收益日与区间收益']]},
 {name:'基金比较',items:[['fees','费用比较','coins','在相同费用项目下比较费率'],['peers','同类表现','trophy','同类走势与统计评分'],['changes','披露变化','file','不同报告期的持仓变化']]}
];
export const moduleById=id=>ANALYSIS_MODULES.flatMap(g=>g.items).find(x=>x[0]===id)||ANALYSIS_MODULES[0].items[0];
export function portfolioOverlap(funds){
 const eligible=funds.filter(f=>(!f.status||f.status==='has-stock')&&detailPeriods(f).length),missing=funds.filter(f=>(!f.status||f.status==='has-stock')&&!detailPeriods(f).length);
 if(eligible.length<2)return {ready:false,reason:'选择两只已有同期持仓的基金进行比较',eligible,missing,rows:[]};
 const dates=detailPeriods(eligible[0]).map(p=>p.asOf).filter(d=>eligible.every(f=>detailPeriods(f).some(p=>p.asOf===d))).sort().reverse();if(!dates.length)return {ready:false,reason:'请在两基金比较中选择相同报告期的基金',eligible,missing,rows:[]};
 const asOf=dates[0],map=new Map();let coverage=0;for(const f of eligible){const p=detailPeriods(f).find(p=>p.asOf===asOf);for(const r of p.rows){const weight=f.share/100*r.weight/100;coverage+=weight;const row=map.get(r.code)||{code:r.code,name:r.name,weight:0,paths:[]};row.weight+=weight;if(weight>0)row.paths.push({id:f.id,code:f.code,name:f.name,weight,fundWeight:r.weight/100});map.set(r.code,row);}}
 const all=[...map.values()].sort((a,b)=>b.weight-a.weight),rows=all.filter(r=>r.paths.length>=2).map(r=>({...r,count:r.paths.length,duplicate:r.weight-Math.max(...r.paths.map(p=>p.weight))})).sort((a,b)=>b.duplicate-a.duplicate||b.weight-a.weight);
 return {ready:true,asOf,eligible,missing,coverage,all,rows,common:rows.length,sharedExposure:rows.reduce((s,r)=>s+r.weight,0),duplicateExposure:rows.reduce((s,r)=>s+r.duplicate,0),includedFunds:eligible.length,totalFunds:funds.length};
}
export function pairOverlap(a,b){
 if(!a||!b||a.id===b.id)return {ready:false,reason:'选择两只不同的基金',rows:[]};const pair=overlapV7([a,b]).pairs[0];if(!pair)return {ready:false,reason:'两只基金暂未收录同期半年度或年度持仓',rows:[]};
 const ap=detailPeriods(a).find(p=>p.asOf===pair.asOf),bp=detailPeriods(b).find(p=>p.asOf===pair.asOf),bm=new Map(bp.rows.map(r=>[r.code,r]));const rows=ap.rows.filter(r=>r.weight>0&&(bm.get(r.code)?.weight||0)>0).map(r=>({code:r.code,name:r.name,aWeight:r.weight/100,bWeight:bm.get(r.code).weight/100,minWeight:Math.min(r.weight,bm.get(r.code).weight)/100})).sort((a,b)=>b.minWeight-a.minWeight);
 return {...pair,ready:true,rows,common:rows.length};
}
export function analysisData(model,data,selected=''){
 const base=analysisV7(model,data),fund=base.funds.find(f=>f.id===selected)||base.funds[0];return {...base,fund,portfolioOverlap:portfolioOverlap(base.funds),moduleById,checked:fund?checkedNav(fund.adjusted,fund.profile||fund,base.calendar,base.asOf):null};
}
export function analysisMaterialsV15(model,data,selected='',module='overlap'){
 const a=analysisData(model,data,selected),f=a.fund,periods=[a.structure.asOf,a.portfolioOverlap.asOf].filter(Boolean),m=[];
 const add=(id,title,text,date=a.asOf)=>m.push({id:'analysis-'+id,text:title+'\n'+text,url:null,date,locator:title});
 const scope=`报告日：${a.portfolioOverlap.asOf||a.structure.asOf||'待更新'}。方法版本：${data.manifest.method}。数据版本：${data.manifest.version}。`;
 add('structure','组合结构',scope+'\n'+(a.structure.ready?`已披露股票${a.structure.nominal}只；按权重计算有效持股${a.structure.effective.toFixed(1)}只；名义与有效的比值${a.structure.multiple.toFixed(2)}倍；已展开组合比例${percent(a.structure.coverage)}。`:a.structure.reason)+'\n'+(a.portfolioOverlap.ready?`多基金共同持有${a.portfolioOverlap.common}只股票；这些股票合计占组合${percent(a.portfolioOverlap.sharedExposure)}；重复路径占比${percent(a.portfolioOverlap.duplicateExposure)}。\n共同持股：`+a.portfolioOverlap.rows.slice(0,15).map(x=>`${x.name}，${x.count}只基金持有，合计占组合${percent(x.weight)}`).join('；'):a.portfolioOverlap.reason));
 add('pairs','同期两基金重叠',a.overlap.pairs.slice(0,15).map(x=>`${x.a}与${x.b}：${x.asOf}股票重叠度${percent(x.value)}；两基金已披露比例${percent(x.coverageA)}、${percent(x.coverageB)}。`).join('\n')||'添加两只基金后比较');
 add('risk','组合历史风险',a.risk.ready?`区间${a.risk.from}至${a.risk.to}；${a.risk.n}个有效日收益。组合最大回撤${percent(a.risk.path.maxDrawdown)}，${a.risk.path.recoveryDate?'恢复到前高：'+a.risk.path.recoveryDate:'截至区间末尚未恢复到前高'}。\n`+a.risk.deviations.map(x=>`${x.name}：资金比例${percent(x.weight)}，波动贡献${percent(x.riskShare)}，偏离${Number.isFinite(x.deviation)?(100*x.deviation).toFixed(2)+'个百分点':'待计算'}。`).join('\n'):a.risk.reason);
 add('managers','基金经理关联',a.funds.map(x=>`${x.name}：${(x.managerDetails||[]).map(y=>y.name+'（同管理人主档中关联'+y.count+'个基金代码）').join('、')||'经理资料待更新'}`).join('\n')+'\n共同经理：'+(a.managers.map(x=>x.name+'关联'+x.funds.map(y=>y.name).join('、')).join('；')||'当前所持基金经理不同'));
 if(f){const n=f.metrics,fee=f.feeCompare,score=f.peerScore,q=f.peerR2;
  add('fund',f.name+'历史体验',n?.ready?`基金代码${f.code}；区间${n.from}至${n.to}；${n.n}个日收益；来源净值测算区间收益${percent(n.totalReturn)}；最大回撤${percent(n.maxDrawdown)}；前高${n.peakDate}，低点${n.troughDate}；${n.recoveryDays===null?'截至末日尚未恢复到前高':'低点后'+n.recoveryDays+'个自然日恢复到前高'}；正收益日占比${percent(n.positiveDayRatio)}；回撤恢复效率${Number.isFinite(n.recoveryEfficiency)?percent(n.recoveryEfficiency)+'/交易日':'尚未恢复或无回撤'}。\n把历史最差20日的收益设为0后的区间收益${percent(n.returnExWorst20)}，用于观察下跌日影响。`:n?.reason||'净值历史待更新');
  add('fees',f.name+'费用比较',fee?.ready?`基金代码${f.code}；比较范围${fee.basis}，${fee.n}个代码；费用项目${fee.components}；本基金年费率${percent(fee.value)}；组内最低${percent(fee.minimum)}；低于本基金费率的样本占比${percent(fee.percentile)}；按费率从低到高并列第${fee.rank}位。`:fee?.reason||'费率资料待更新');
  add('peers',f.name+'同类表现',(q?.ready&&Number.isFinite(q.value)?`在${q.from}至${q.to}的${q.observations}个日收益中，与${q.n}个其他同类基金均值的R²为${q.value.toFixed(3)}，均值已剔除本基金。`:'同类收益相似度待更新。')+'\n'+(score?.ready?`六项统计的当前加权分为${score.score.toFixed(1)}；同口径评分分位${Number.isFinite(score.percentile)?percent(score.percentile):'待更新'}。各项：`+score.factors.filter(x=>x.ready).map(x=>`${x.name}${x.score.toFixed(1)}分，权重${(100*x.weight).toFixed(1)}%`).join('；'):'评分资料待更新。'));
  add('changes',f.name+'披露变化',f.trend?.ready?`${f.trend.from}至${f.trend.to}，已披露持仓的集中度HHI从${f.trend.previous.hhi.toFixed(4)}变为${f.trend.current.hhi.toFixed(4)}；股票权重余弦距离${f.trend.cosineDistance.toFixed(4)}。`:'当前只有一期可比的半年度或年度明细。');
 }
 return m;
}
