import{checkedNav,feeParts}from'./v14-compute.mjs';import{portfolioOverlap,pairOverlap}from'./v15-analysis-model.mjs';
import{disclosedStructure,portfolioResearch,pathExperience,rollingExperience,entryExperience,holdingsEvolution,comparablePair,alignResearch}from'./v16-compute.mjs';
export const ANALYSIS_MODULES=[
 {name:'理解组合构成',items:[['overlap','股票重叠','overlap','看清共同持股与重复路径'],['diversification','持股分散','pie','从股票数量走向实际集中度'],['managers','组合角色','people','哪些基金同步，哪些带来差异']]},
 {name:'理解风险与体验',items:[['risk','风险来源','shield','日常波动、下跌联动与尾部损失'],['drawdown','下跌与修复','chart','回撤深度、持续时间与修复路径'],['experience','持有体验','pulse','不同买入时点和持有期限的结果']]},
 {name:'理解基金差异',items:[['peers','相似基金','trophy','相似持仓，上涨和下跌有何不同'],['fees','成本与差异','coins','费率差与实际走势差异一起看'],['changes','持仓演变','file','前列股票、集中度与经理背景']]}
];
export const moduleById=id=>ANALYSIS_MODULES.flatMap(x=>x.items).find(x=>x[0]===id)||ANALYSIS_MODULES[0].items[0];
export function researchAnalysis(model,data,ui={}){
 const funds=model.funds.map(f=>{const r=data?.funds?.[f.code]||{},study=data?.research?.funds?.[f.code]||{},profile=f.profile||study.profile||{},checked=checkedNav(r.adjusted,profile,data?.manifest?.calendar||[],data?.manifest?.asOf);return {...f,...r,id:f.id,code:f.code,name:study.profile?.name||f.name,profile,amount:f.amount,share:f.share,study,checked,history:checked.ready?pathExperience(checked.points):{ready:false,reason:checked.reason},rolling:checked.ready?rollingExperience(checked.points):[],entries:checked.ready?entryExperience(checked.points):[],evolution:holdingsEvolution(r)};});
 const calendar=data?.manifest?.calendar||[],asOf=data?.manifest?.asOf||'',fund=funds.find(f=>f.id===ui.analysisFund)||funds[0],risk=portfolioResearch(funds,calendar,asOf),peerCode=ui.analysisPeer||fund?.study?.peers?.[0]?.code,peerData=data?.funds?.[peerCode],peerStudy=data?.research?.funds?.[peerCode],peer=peerData&&peerStudy?{...peerData,code:peerCode,id:'fund'+peerCode,name:peerStudy.profile.name,profile:peerStudy.profile}:null,pair=peer&&fund?comparablePair(fund,peer,calendar,asOf):null;
 const joint=peer&&risk.ready?alignResearch([...funds,peer],calendar,asOf):null,commonCalendar=joint?.ready?calendar.filter(d=>d>=joint.from&&d<=joint.to):null,scenarioBase=commonCalendar?portfolioResearch(funds,commonCalendar,asOf):null,replacement=commonCalendar?portfolioResearch(funds.map(f=>f.id===fund.id?{...peer,share:f.share,amount:f.amount}:f),commonCalendar,asOf):null;
 return {funds,fund,calendar,asOf,risk,peer,pair,replacement,scenarioBase,structure:disclosedStructure(funds),portfolioOverlap:portfolioOverlap(funds),selectedPeer:peerCode};
}
const pct=x=>Number.isFinite(x)?(x*100).toFixed(2)+'%':'未计算',pp=x=>Number.isFinite(x)?(x*100).toFixed(2)+'个百分点':'未计算';
export function selectResearchMaterials(materials,task,ui={}){
 const moduleSets={overlap:['structure','overlap','selected-pair'],diversification:['structure','overlap'],managers:['risk','roles'],risk:['risk'],drawdown:[ui.historyScope==='fund'?'fund':'experience'],experience:[ui.historyScope==='fund'?'fund':'experience'],peers:['comparison'],fees:['comparison','same-weight'],changes:['evolution']};
 const taskSets={analysis_overview:['structure','overlap','risk','experience','roles'],analysis_cost:['comparison','same-weight'],analysis_history:[ui.historyScope==='fund'?'fund':'experience']},keys=task==='analysis_module'?moduleSets[ui.analysisModule]:taskSets[task];if(!keys)return materials;const ids=new Set(['context',...keys].map(x=>'research-'+x));return materials.filter(x=>ids.has(x.id));
}
export function researchMaterials(model,data,ui={}){
 const a=researchAnalysis(model,data,ui),m=[],add=(id,title,text)=>m.push({id:'research-'+id,text:title+'\n'+text,date:a.asOf,url:null,locator:title}),s=a.structure,r=a.risk,f=a.fund;
 add('context','分析口径','当前模块：'+moduleById(ui.analysisModule)[1]+'。区间截至'+a.asOf+'。'+a.funds.map(f=>f.name+'（'+f.code+'）占组合'+pct(f.share/100)).join('；')+'。金额不在输入中。所有数值已由程序计算，不自行换算或增加数值。');
 if(s.ready)add('structure','已披露组合结构','报告日'+s.asOf+'；已展开组合'+pct(s.coverage)+'；名义持股'+s.nominal+'只；有效持股'+s.effective.toFixed(1)+'只；前十股票占组合'+pct(s.top10)+'。'+s.rows.slice(0,10).map(x=>x.name+' '+pct(x.weight)).join('；'));
 const o=a.portfolioOverlap;if(o.ready)add('overlap','共同持股','报告日'+o.asOf+'；共同持股'+o.common+'只；共同持有占比'+pct(o.sharedExposure)+'；重复路径占比'+pct(o.duplicateExposure)+'。重叠高表示已披露股票接近，不能仅凭重叠认定同行业、风险相同或可直接替换。');
 if(r.ready){
  add('risk','组合风险结构','共同区间'+r.from+'至'+r.to+'，'+r.rows.length+'个日收益；当前固定权重波动率'+pct(r.risk.annualVol)+'；分散带来的波动降幅'+pct(r.risk.reduction)+'；最差5%交易日平均收益'+pct(-r.tail.value)+'；有效分散比'+r.risk.diversificationRatio.toFixed(2)+'。'+r.roles.map(x=>x.name+'：资金占比'+pct(x.weight)+'，单基金年化波动'+pct(x.annualVol)+'，波动贡献'+pct(x.riskShare)+'，尾部损失贡献'+pct(x.tailShare)+'，剔除且其余按比例归一后波动变化'+pp(x.removeVolChange)).join('；'));
  const pairs=[];for(let i=0;i<a.funds.length;i++)for(let j=i+1;j<a.funds.length;j++)pairs.push({i,j,c:r.risk.correlation[i][j],d:r.downCorrelation?.[i][j]});pairs.sort((a,b)=>(b.c??-2)-(a.c??-2));add('roles','基金共同变化',r.from+'至'+r.to+'；组合下跌日'+r.downDays+'个。'+pairs.slice(0,8).map(x=>a.funds[x.i].name+'与'+a.funds[x.j].name+'：日常相关系数'+x.c?.toFixed(3)+'，组合下跌日相关系数'+(Number.isFinite(x.d)?x.d.toFixed(3):'未计算')).join('；'));
  add('experience','组合持有体验','期初按当前比例投入，基金间不调仓。区间收益'+pct(r.experience.totalReturn)+'；最大回撤'+pct(r.experience.maxDrawdown)+'；回撤压力指数'+pct(r.experience.ulcer)+'；低于前高的交易观察点占比'+pct(r.experience.underwaterShare)+'；最长连续未创新高'+r.experience.longestUnderwater+'个交易日。'+r.rolling.filter(x=>x.ready).map(x=>x.days+'交易日持有窗口'+x.n+'个：盈利窗口占比'+pct(x.winShare)+'，中位收益'+pct(x.median)+'，10%分位'+pct(x.p10)+'，90%分位'+pct(x.p90)).join('；')+'。滚动窗口相互重叠，频率不是未来概率。');
 }
 if(f){
  if(f.history.ready)add('fund',f.name+'持有体验','区间'+f.history.from+'至'+f.history.to+'；收益'+pct(f.history.totalReturn)+'；最大回撤'+pct(f.history.maxDrawdown)+'；回撤压力指数'+pct(f.history.ulcer)+'；最长未创新高'+f.history.longestUnderwater+'交易日。'+f.rolling.filter(x=>x.ready).map(x=>x.days+'交易日：盈利窗口占比'+pct(x.winShare)+'，收益中位数'+pct(x.median)).join('；'));
  if(f.evolution.ready){const e=f.evolution;add('evolution',f.name+'前列持仓演变',e.from+'至'+e.to+'同类型披露，比较各期前'+e.k+'只；持续在列'+e.common+'只；前列留存率'+pct(e.persistence)+'；前列集中度'+pct(e.topWeightA)+'变为'+pct(e.topWeightB)+'。'+e.rows.map(x=>x.name+'：'+x.status).join('；')+'。“离开前列”不等于清仓，权重变化不直接归因于主动交易。');}
 }
 if(a.pair?.ready){const p=a.pair,c=p.capture,fa=feeParts(f.profile),fb=feeParts(a.peer.profile);add('comparison',f.name+'与'+a.peer.name+'对照','共同区间'+p.from+'至'+p.to+'；日收益相关系数'+p.correlation?.toFixed(3)+'；收益差年化波动'+pct(p.trackingError)+'；已披露股票重叠'+pct(p.stock.overlap)+'（'+p.stock.asOf+'）。以下先本基金、后对照基金：区间收益'+pct(p.a.totalReturn)+' / '+pct(p.b.totalReturn)+'；波动率'+pct(p.a.annualVol)+' / '+pct(p.b.annualVol)+'；最大回撤'+pct(p.a.maxDrawdown)+' / '+pct(p.b.maxDrawdown)+'；回撤压力'+pct(p.a.ulcer)+' / '+pct(p.b.ulcer)+'；管理与托管年费率'+pct(fa.two)+' / '+pct(fb.two)+'。以对照基金为参照的月度上涨参与率'+pct(c.up)+'（'+c.upMonths+'个上涨月）、下跌参与率'+pct(c.down)+'（'+c.downMonths+'个下跌月）。比例低于100%代表相应方向幅度较小，不构成综合优劣判断。');
  if(a.replacement?.ready){const r=a.scenarioBase;add('same-weight','同权重历史结构对照','保持其他基金不变，把本基金权重交给选定对照基金，仅作历史研究情景。原组合 / 对照结构：当前固定权重波动率'+pct(r.risk.annualVol)+' / '+pct(a.replacement.risk.annualVol)+'；最差5%日均收益'+pct(-r.tail.value)+' / '+pct(-a.replacement.tail.value)+'；最大回撤'+pct(r.experience.maxDrawdown)+' / '+pct(a.replacement.experience.maxDrawdown)+'。这是当前选定基金的事后对照，不是推荐交易。');}
 }
 if(ui.analysisModule==='overlap'&&ui.overlapMode==='pair'){const A=fundsFind(a,ui.overlapA),B=fundsFind(a,ui.overlapB,A?.id),p=pairOverlap(A,B);if(p.ready)add('selected-pair','选定两基金的重叠',A.name+'与'+B.name+'；'+p.asOf+'；重叠度'+pct(p.value)+'；共同持股'+p.common+'只。');}
 return m;
}
function fundsFind(a,id,exclude){return a.funds.find(f=>f.id===id&&f.id!==exclude)||a.funds.find(f=>f.id!==exclude);}
