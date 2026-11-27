import {peerGroupView} from './v24-compare-view.mjs';
import{ANALYSIS_MODULES,moduleById,researchAnalysis}from'./v16-analysis-model.mjs';
import{overlapView}from'./v15-analysis.mjs';import{feeParts}from'./v14-compute.mjs';
import{esc as h,icon,metric,formula,empty,percent as p,money}from'./v15-ui.mjs';
const btn=(act,label,id='',on=false)=>'<button type="button" class="v15-button '+(on?'is-selected':'')+'" data-act="'+act+'" data-id="'+h(id)+'">'+h(label)+'</button>';
const table=(heads,rows)=>'<div class="v15-table-wrap"><table class="v15-table"><thead><tr>'+heads.map(x=>'<th>'+h(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const tr=cells=>'<tr>'+cells.map(x=>'<td>'+x+'</td>').join('')+'</tr>',signed=x=>Number.isFinite(x)?(x>=0?'+':'')+(x*100).toFixed(2)+'个百分点':'—';
const sentence=(title,text)=>'<div class="v16-reading"><h3>'+h(title)+'</h3><p>'+text+'</p></div>';
function directory(active){return '<div class="v15-directory" aria-label="分析模块">'+ANALYSIS_MODULES.map(g=>'<section class="v15-module-group"><h2>'+h(g.name)+'</h2><div>'+g.items.map(([id,name,symbol,desc])=>'<button type="button" data-act="analysis-module" data-id="'+id+'" class="v15-module-link '+(active===id?'is-active':'')+'" aria-pressed="'+(active===id)+'">'+icon(symbol)+'<span><strong>'+h(name)+'</strong><small>'+h(desc)+'</small></span>'+icon('chevron','v15-chevron')+'</button>').join('')+'</div></section>').join('')+'</div>';}
function picker(a){return '<label class="v15-fund-picker"><span>所持基金</span><select id="v7-analysis-fund">'+a.funds.map(f=>'<option value="'+h(f.id)+'" '+(a.fund.id===f.id?'selected':'')+'>'+h(f.name)+' · '+f.code+'</option>').join('')+'</select></label>';}
const band=items=>'<div class="v15-stat-band">'+items.map(x=>metric(...x)).join('')+'</div>';
function plot(points,{drawdown=false,label='历史路径'}={}){
 if(points.length<2)return '';const values=points.map(x=>drawdown?x[1]:x[1]/points[0][1]-1),min=Math.min(0,...values),max=Math.max(.01,...values),range=max-min||1,w=860,height=190,xy=values.map((v,i)=>[20+i/(values.length-1)*820,15+(max-v)/range*150]),path=xy.map((q,i)=>(i?'L':'M')+q.map(v=>v.toFixed(2)).join(',')).join(' ');
 return '<figure class="v16-path"><svg viewBox="0 0 '+w+' '+height+'" role="img" aria-label="'+h(label)+'"><line x1="20" x2="840" y1="'+(15+max/range*150)+'" y2="'+(15+max/range*150)+'" stroke="#d7dce8"/><path d="'+path+'" fill="none" stroke="'+(drawdown?'#b56e59':'#6366f1')+'" stroke-width="2.3"/><text x="20" y="185">'+h(points[0][0])+'</text><text x="840" y="185" text-anchor="end">'+h(points.at(-1)[0])+'</text><text x="20" y="12">'+h(p(max))+'</text><text x="20" y="164">'+h(p(min))+'</text></svg><figcaption>'+h(label)+'</figcaption></figure>';
}
function diversification(a){
 const s=a.structure;if(!s.ready)return empty(s.reason);
 return band([['名义持股',s.nominal+'只'],['有效持股',s.effective.toFixed(1)+'只','按已披露股票权重'],['前十股票占组合',p(s.top10)]])+sentence('股票多，和权重分散是两件事','已披露的<strong>'+s.nominal+'只股票</strong>，按权重集中程度折算为<strong>'+s.effective.toFixed(1)+'只等权股票</strong>。基金之间的共同持股已合并。')+
 '<div class="v16-distribution">'+s.rows.slice(0,15).map(x=>'<div><span>'+h(x.name)+'</span><progress max="'+Math.max(s.rows[0].weight,.01)+'" value="'+x.weight+'"></progress><strong>'+p(x.weight)+'</strong></div>').join('')+'</div><p class="v15-scope-line">'+h(s.asOf)+' · 已展开组合 '+p(s.coverage)+'</p>'+
 formula('股票组合权重=Σ基金资金权重×股票占该基金净资产比例。已展开内部权重p=股票组合权重/已展开比例；有效持股=1/Σp²。未展开资产不填0、不当现金；股票只数按证券代码去重。');
}
function roles(a){
 const r=a.risk;if(!r.ready)return empty(r.reason);const n=a.funds.length,c=r.risk.correlation;
 const pairs=[];for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)pairs.push({i,j,c:c[i][j],down:r.downCorrelation?.[i][j]});
 pairs.sort((a,b)=>(b.c??-2)-(a.c??-2));
 return band([['组合年化波动',p(r.risk.annualVol)],['分散比',r.risk.diversificationRatio?.toFixed(2)||'—'],['组合波动降幅',p(r.risk.reduction),'相对各基金波动加权值']])+sentence('组合角色由共同变化决定','股票不同的基金也可能一起涨跌。先看日常相关性，再看<strong>组合下跌日是否更同步</strong>。')+
 table(['基金组合','日常相关性','组合下跌日相关性'],pairs.slice(0,8).map(x=>tr([h(a.funds[x.i].name)+'<br>'+h(a.funds[x.j].name),x.c?.toFixed(3)||'—',Number.isFinite(x.down)?x.down.toFixed(3):'—'])))+
 '<details class="v15-more"><summary>全部基金的相关性矩阵</summary>'+table(['基金',...a.funds.map(f=>f.code)],a.funds.map((f,i)=>tr([h(f.name),...c[i].map((v,j)=>'<span class="v16-correlation" style="--level:'+Math.abs(v??0)+'">'+(i===j?'1.00':v?.toFixed(2)||'—')+'</span>')])))+'</details>'+
 formula('分散比=Σ(wᵢσᵢ)/σ组合；波动降幅=1−σ组合/Σ(wᵢσᵢ)。相关性使用共同连续日收益；下跌相关性只在按当前固定权重计算的组合日收益小于0时计算。相关性接近1表示更同步，与行业名称分开理解。');
}
function risks(a){
 const r=a.risk;if(!r.ready)return empty(r.reason);
 return band([['年化波动率',p(r.risk.annualVol)],['最差5%日均收益',p(-r.tail.value),r.rows.length+'个日收益'],['分散后的波动降幅',p(r.risk.reduction)]])+sentence('谁主导日常波动，谁主导下跌尾部','对照<strong>资金占比、波动贡献和尾部损失贡献</strong>。三者差异可以揭示金额不大、影响却较大的基金。')+
 table(['基金','资金占比','波动贡献','尾部损失贡献','剔除后波动变化'],r.roles.map(x=>tr([h(x.name)+'<small>'+x.code+'</small>',p(x.weight),p(x.riskShare),p(x.tailShare),signed(x.removeVolChange)])))+
 '<p class="v15-scope-line">'+r.from+' 至 '+r.to+'</p>'+formula('波动贡献份额=wᵢ(Σw)ᵢ/(wᵀΣw)，Σ为样本协方差。尾部取组合最差5%的交易日，以分数权重处理边界日；尾部损失贡献=该基金在这些日子的加权平均损失/组合平均损失，允许负值。剔除测算移去一只基金，其余权重同比例归一，只比较同一历史区间，不修改实际持仓。');
}
function scopePicker(a,ui){return '<div class="v15-detail-tools"><div class="v15-segments">'+btn('history-scope','整个组合','portfolio',ui.historyScope!=='fund')+btn('history-scope','单只基金','fund',ui.historyScope==='fund')+'</div>'+(ui.historyScope==='fund'?picker(a):'')+'</div>';}
function selectedHistory(a,ui){return ui.historyScope==='fund'?{experience:a.fund.history,rolling:a.fund.rolling,entries:a.fund.entries,name:a.fund.name}:a.risk.ready?{experience:a.risk.experience,rolling:a.risk.rolling,entries:a.risk.entries,name:'当前组合'}:{experience:{ready:false,reason:a.risk.reason},rolling:[],entries:[],name:'当前组合'};}
function drawdowns(a,ui){
 const q=selectedHistory(a,ui),s=q.experience;if(!s.ready)return scopePicker(a,ui)+empty(s.reason);
 return scopePicker(a,ui)+band([['最大回撤',p(s.maxDrawdown)],['回撤压力指数',p(s.ulcer),'同时考虑深度与持续时间'],['最长未创新高',s.longestUnderwater+'交易日']])+plot(s.points.map((x,i)=>[x[0],-s.drawdowns[i]]),{drawdown:true,label:q.name+' · 距离此前高点的回撤'})+
 table(['高点起始','最深回落日','回撤','观察至','恢复状态'],s.episodes.map(x=>tr([x.start,x.trough,p(x.depth),x.end,x.ongoing?'仍在修复':x.days+'交易日恢复'])))+
 sentence('把最深的一次下跌，和长期承压分开','最大回撤描述最深的回落；回撤压力指数还会计入<strong>低于前高的持续时间</strong>。相同最大回撤，也可能有不同的持有过程。')+
 formula('回撤dₜ=1−净值/此前最高净值；回撤压力指数（Ulcer Index）=√平均(dₜ²)。最长未创新高按连续交易观察点计数，期末未恢复的区间保留为仍在修复。组合路径按期初当前权重投入，期间基金间不调仓；净值已计入基金持续费用。');
}
function experience(a,ui){
 const q=selectedHistory(a,ui),s=q.experience;if(!s.ready)return scopePicker(a,ui)+empty(s.reason);
 return scopePicker(a,ui)+band([['区间收益',p(s.totalReturn)],['低于前高的时间',p(s.underwaterShare)],['回撤超过10%的时间',p(s.deepShare)]])+sentence('持有期限，能否改变历史体验','把历史上每个交易日都当作起点，分别持有<strong>63、126、252个交易日</strong>。比较盈利窗口占比和收益分布，不只看今天回头计算的一条收益。')+
 table(['持有期限','历史窗口','盈利窗口占比','10%分位收益','中位收益','90%分位收益'],q.rolling.filter(x=>x.ready).map(x=>tr([x.days+'交易日',x.n+'个',p(x.winShare),p(x.p10),'<strong>'+p(x.median)+'</strong>',p(x.p90)])))+
 '<details class="v15-more"><summary>按月观察不同起点的持有结果</summary>'+table(['起始月','63交易日','126交易日','252交易日'],q.entries.map(x=>tr([x.month,...x.values.map(v=>'<span class="v16-return '+(v===null?'':v>=0?'positive':'negative')+'">'+p(v)+'</span>')])))+'</details>'+
 plot(s.points,{label:q.name+' · 期初归一后的历史收益路径'})+
 formula('持有h个交易日的收益=Vₜ₊ₕ/Vₜ−1；盈利窗口占比=正收益窗口数/完整窗口数，0收益不计为盈利。10%、50%、90%分位采用线性插值。窗口相互重叠，观察频率不是未来盈利概率；月度表取该月首个可用交易日为起点，未走满期限的格子留空。');
}
function peerChoice(a){
 const f=a.fund,rows=[...(f.study.peers||[])];if(a.peer&&!rows.some(x=>x.code===a.peer.code))rows.push({code:a.peer.code,name:a.peer.name,match:'同类对照',overlap:a.pair?.stock?.overlap,correlation:a.pair?.correlation,fee:feeParts(a.peer.profile)});
 return '<div class="v16-pair-pickers">'+picker(a)+'<label class="v15-fund-picker"><span>对照基金</span><select id="v16-peer-select" aria-label="对照基金">'+rows.map(x=>'<option value="'+x.code+'" '+(x.code===a.selectedPeer?'selected':'')+'>'+h(x.name)+' · '+x.code+'</option>').join('')+'</select></label></div><details class="v15-more v16-peer-list"><summary>查看'+rows.length+'只对照基金与匹配依据</summary>'+table(['对照基金','关联依据','已披露重叠','相关性','管理＋托管年费率',''],rows.map(x=>tr([h(x.name)+'<small>'+x.code+'</small>',h(x.match),p(x.overlap),x.correlation?.toFixed(3)||'—',p(x.fee?.two),btn('analysis-peer',x.code===a.selectedPeer?'已选对照':'对照这只',x.code,x.code===a.selectedPeer)])))+'</details>';
}
function captureChart(a){
 const c=a.pair.capture;if(!Number.isFinite(c.up)||!Number.isFinite(c.down))return '';
 const cap=Math.max(1.5,Math.ceil(Math.max(c.up,c.down)*2)/2),lo=Math.min(0,Math.floor(Math.min(c.up,c.down)*2)/2),pos=x=>42+(x-lo)/(cap-lo)*286,x=pos(c.down),y=332-pos(c.up),ref=pos(1);
 const text=c.up>=1?(c.down<1?'上涨参与较多，下跌幅度较小':'上涨参与较多，下跌幅度也较大'):(c.down<1?'上涨与下跌的幅度都较缓':'上涨参与较少，下跌参与较多');
 return '<div class="v16-capture"><svg viewBox="0 0 400 360" role="img" aria-label="上涨与下跌参与率对照"><line x1="42" x2="328" y1="'+(332-ref)+'" y2="'+(332-ref)+'" stroke="#cad0df" stroke-dasharray="4 4"/><line x1="'+ref+'" x2="'+ref+'" y1="20" y2="290" stroke="#cad0df" stroke-dasharray="4 4"/><path d="M42 20V290H328" fill="none" stroke="#8995aa"/><circle cx="'+ref+'" cy="'+(332-ref)+'" r="5" fill="#8995aa"/><circle cx="'+x+'" cy="'+y+'" r="8" fill="#6366f1"/><text x="42" y="14">上涨参与率</text><text x="200" y="329">下跌参与率 →</text><text x="'+(x+10)+'" y="'+(y-10)+'">本基金</text><text x="'+(ref+8)+'" y="'+(342-ref)+'">对照100%</text></svg><div><h3>上涨与下跌的参与方式</h3>'+band([['上涨参与率',p(c.up),c.upMonths+'个上涨月'],['下跌参与率',p(c.down),c.downMonths+'个下跌月']])+'<p>参照：'+h(a.peer.name)+'<br>'+h(c.from)+' 至 '+h(c.to)+'</p></div></div>';
}
function pairTable(a){
 const c=a.pair;if(!c?.ready)return empty(c?.reason||'选择一只基金作对照');
 return '<h3 class="v16-subtitle">'+h(a.fund.name)+' / '+h(a.peer.name)+'</h3><p class="v15-scope-line">共同区间 '+c.from+' 至 '+c.to+' · '+c.n+'个日收益</p>'+table(['共同区间的对照项','本基金','对照基金'],[['区间收益',c.a.totalReturn,c.b.totalReturn],['年化波动',c.a.annualVol,c.b.annualVol],['最大回撤',c.a.maxDrawdown,c.b.maxDrawdown],['回撤压力指数',c.a.ulcer,c.b.ulcer],['低于前高的时间',c.a.underwaterShare,c.b.underwaterShare]].map(x=>tr([h(x[0]),p(x[1]),p(x[2])])).concat([tr(['最长未创新高',c.a.longestUnderwater+'交易日',c.b.longestUnderwater+'交易日'])]));
}
function peers(a,ui){
 const mode=ui.peerView||'group',switcher='<div class="v15-segments v24-peer-mode" aria-label="基金对比方式">'+btn('peer-view','整体对比','group',mode==='group')+btn('peer-view','两只详比','pair',mode==='pair')+'</div>';
 if(mode==='group')return switcher+peerGroupView(a,ui);
 return switcher+peerPair(a);
}
function peerPair(a){
 return peerChoice(a)+(a.pair?.ready?captureChart(a)+pairTable(a)+sentence('结合上涨和下跌两方面理解差异','对照<strong>股票重叠、涨跌参与率、回撤压力和费用</strong>。上涨参与较少、下跌幅度也较小的基金，体现了更平缓的历史路径；继续结合相同持有期限，查看这种特点怎样影响持有过程。'):'')+
 formula('对照优先同指数、同产品形式；其次为同期已披露股票重叠≥10%、近252个共同日收益相关系数≥0.65的同类型基金。排除同一管理人下全称相同的份额重复。门槛是用于建立研究样本的固定筛选值，不是经过寻优的行业分类。上涨/下跌参与率取对照基金上涨/下跌月份中两者月收益几何均值之比，至少各6个月，未结束月份不纳入。对照均在同一可用区间重算，净值收益已扣持续费用。');
}
function costs(a){
 const f=a.fund;if(!a.peer||!a.pair?.ready)return peerChoice(a)+empty('选择对照基金后比较费用与走势差异');
 const x=feeParts(f.profile),y=feeParts(a.peer.profile),total=x.total!==null&&y.total!==null,fa=total?x.total:x.two,fb=total?y.total:y.two,pc=a.pair,before=a.scenarioBase||a.risk,after=a.replacement;
 return peerChoice(a)+band([['本基金年费率',p(fa)],['对照基金年费率',p(fb)],['年费率差',signed(fa!==null&&fb!==null?fa-fb:null),total?'管理＋托管＋销售服务':'管理＋托管']])+sentence('便宜多少，与走势改变多少一起看','两者共同区间的日收益相关系数为<strong>'+h(pc.correlation?.toFixed(3)||'—')+'</strong>，收益差的年化波动为<strong>'+p(pc.trackingError)+'</strong>。相同费率差，可能对应不同的结构变化。')+
 pairTable(a)+(after?.ready&&before.ready?'<h3 class="v16-subtitle">同权重历史结构对照</h3><p class="v15-scope-line">其他基金和资金权重保持一致 · '+before.from+' 至 '+before.to+'</p>'+table(['组合指标','原组合','对照结构'],[['年化波动',before.risk.annualVol,after.risk.annualVol],['最差5%日均收益',-before.tail.value,-after.tail.value],['最大回撤',before.experience.maxDrawdown,after.experience.maxDrawdown]].map(x=>tr([x[0],p(x[1]),p(x[2])]))):'')+
 formula('年费率只比较双方均有记录的费用项目。净值已经扣除基金持续费用，不再重复扣费。收益差年化波动=std(rA−rB)×√252。同权重对照把本基金权重交给选定对照基金，其余权重不变，两种结构在共同区间重算；未计交易费用、申赎费与折溢价，不执行或保存持仓变更。');
}
function changes(a){
 const f=a.fund,e=f.evolution,managers=f.managerDetails||[];
 return picker(a)+(e.ready?band([['前列持仓留存率',p(e.persistence)],['持续在列',e.common+' / '+e.k+'只'],['前列权重变化',signed(e.topWeightB-e.topWeightA)]])+'<p class="v15-scope-line">'+e.from+' → '+e.to+' · 同类型披露各取前'+e.k+'只</p>'+table(['股票','上期权重','本期权重','前列变化'],e.rows.map(x=>tr([h(x.name)+'<small>'+x.code+'</small>',x.previous===null?'—':p(x.previous/100),x.current===null?'—':p(x.current/100),h(x.status)]))):empty(e.reason))+
 '<details class="v15-more"><summary>经理与产品背景</summary><p>'+managers.map(x=>h(x.name)).join('、')+'</p>'+(f.managerChanges||[]).map(x=>'<p>'+h(x.date)+' · '+h(x.title)+'</p>').join('')+'</details>'+
 formula('只对照两期同类型披露：季度与季度、半年/年度详细披露与同类详细披露。各取前K只，K不超过10且不超过任一期已收录行数；留存率=两期共同在列股票数/K。进入或离开前列不等于建仓或清仓，缺席一期的权重留空。经理变更仅保留为背景，不从前后业绩直接归因。');
}
function dataDetails(a,data){return '<details class="v15-more v16-data"><summary>资料日期与计算依据</summary><p>分析截至 '+a.asOf+' · 数据版本 '+h(data.manifest.version)+'</p>'+table(['基金','连续净值','历史区间','详细持仓'],a.funds.map(f=>{const ps=f.detailPeriods||[],best=ps.filter(p=>/-06-30$|-12-31$/.test(p.asOf)).sort((a,b)=>b.asOf.localeCompare(a.asOf))[0];return tr([h(f.name),f.checked.ready?f.checked.n+'个日收益':h(f.checked.reason),f.checked.ready?f.checked.from+' 至 '+f.checked.to:'—',best?best.rows.length+'只 · '+best.asOf:'—']);}))+'<div class="v7-actions">'+btn('v7-reload','更新资料')+'</div></details>';}
function ai(ui,module){return '<section class="v15-ai-panel '+(ui.analysisAIOpen?'':'is-collapsed')+'" id="analysis-ai" aria-label="AI解读"><div class="v15-ai-panel-head">'+icon('spark')+'<h2>AI解读</h2><span>'+h(module[1])+'</span></div><form id="v15-analysis-ai-form"><div class="v15-ai-presets">'+btn('analysis-preset','解释当前模块','analysis_module')+btn('analysis-preset','理解组合角色','analysis_overview')+btn('analysis-preset','比较相似基金','analysis_cost')+btn('analysis-preset','理解持有体验','analysis_history')+'</div><label class="v15-question"><input name="question" maxlength="2000" placeholder="写下你想理解的问题" value="'+h(ui.analysisQuestion||'')+'" aria-label="持仓分析提问"><button type="submit" class="v15-send" aria-label="发送分析问题">'+icon('arrow')+'</button></label></form><div class="v15-ai-status" data-ai-scope="analysis" aria-live="polite"></div></section>';}
export function renderAnalysisV16(model,bounds,data,ui={}){
 const module=moduleById(ui.analysisModule),head='<div class="v15-pagehead"><div><h1>持仓分析</h1><span>我的持仓 · '+model.funds.length+'只基金 · '+money(model.total)+'</span></div><div class="v16-head-actions"><button type="button" class="v15-primary" data-act="toggle-analysis-ai">'+icon('spark')+'AI解读</button></div></div>',dir=directory(module[0]);
 if(!model.funds.length)return head+dir+empty('添加基金和金额，开始理解组合。',btn('edit-holdings','添加持仓'));
 if(!data?.manifest)return head+dir+empty(ui.analysisError||'正在读取净值与持仓资料…',ui.analysisError?btn('v7-reload','重新读取'):'');
 const a=researchAnalysis(model,data,ui),views={overlap:()=>overlapView(a,ui),diversification:()=>diversification(a),managers:()=>roles(a),risk:()=>risks(a),drawdown:()=>drawdowns(a,ui),experience:()=>experience(a,ui),peers:()=>peers(a,ui),fees:()=>costs(a),changes:()=>changes(a)};
 return head+dir+ai(ui,module)+'<section class="v15-detail" id="analysis-detail" aria-label="'+h(module[1])+'"><header class="v15-workspace-head"><div>'+icon(module[2])+'<h2>'+h(module[1])+'</h2></div><button class="v15-text-link" type="button" data-act="analysis-directory">分析目录 '+icon('arrow')+'</button></header>'+views[module[0]]()+dataDetails(a,data)+'</section>';
}
