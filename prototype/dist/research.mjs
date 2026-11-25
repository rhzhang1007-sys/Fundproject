export function monthWindow(today) {
  const end = String(today).slice(0,10);
  const d = new Date(end+'T00:00:00Z');
  if (!Number.isFinite(d.getTime())) throw Error('日期无效');
  const year=d.getUTCFullYear(),month=d.getUTCMonth(),day=d.getUTCDate();
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  const start=new Date(Date.UTC(year,month-1,Math.min(day,last))).toISOString().slice(0,10);
  return {start,end};
}
export function sourceCadence(s) {
  if (['news','periodic','policy','profile'].includes(s.cadence)) return s.cadence;
  if (/概要|产品与经理|产品资料|经理资料/.test(s.title)) return 'profile';
  if (/年报|年度报告|季度报告|半年报|中期报告/.test(s.title)) return 'periodic';
  if (/政策|行动方案|规划|办法/.test(s.title)) return 'policy';
  return 'news';
}
export function sourceFreshness(s,today) {
  const cadence=sourceCadence(s),window=monthWindow(today),date=s.publishedAt?.slice(0,10);
  const valid=Boolean(date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z')));
  if(cadence!=='news')return {cadence,kind:'long-cycle',label:cadence==='periodic'?'定期报告':cadence==='policy'?'政策 / 适用期另见正文':'产品 / 任职资料',window};
  if(!valid)return {cadence,kind:'undated',label:'发布日期待核实',window};
  if(date>window.end)return {cadence,kind:'future',label:'未来日期待核实',window};
  return date>=window.start?{cadence,kind:'recent',label:'近一个月动态',window}:{cadence,kind:'historical',label:'历史动态',window};
}
export function sortSources(sources) {
  return [...sources].sort((a,b)=>(b.publishedAt||b.period||'').localeCompare(a.publishedAt||a.period||'')||a.id.localeCompare(b.id));
}
// Existing records are not falsely presented as verbatim full-text quotations.
export function sourceHighlights(source) {
  const items=[];const seen=new Set();
  const add=(item)=>{const text=String(item.text||'').trim();if(!text||seen.has(text))return;seen.add(text);items.push({...item,text});};
  if(Array.isArray(source.summaryItems)&&source.summaryItems.length){
    for(const item of source.summaryItems){if(item&&typeof item==='object')add({title:item.title||'',text:item.text,kind:item.kind==='excerpt'?'excerpt':'paraphrase',locator:item.locator||''});}
    return items;
  }
  add({title:'资料内容',text:source.summary,kind:'collected',locator:source.locator||''});
  for(const text of source.keyPoints||[])add({title:'已有整理说明',text,kind:'paraphrase',locator:''});
  for(const point of source.dataPoints||[]){
    if(String(source.summary||'').replace(/\s+/g,'').includes(String(point.value).replace(/\s+/g,'')))continue;
    add({title:point.label,text:`${point.label}：${point.value}；对应时期：${point.period}`,kind:'collected',locator:source.locator||''});
  }
  return items;
}
export function searchObjects(catalog,category='all',query='') {
  const entries=[{id:'all',name:'整个组合',code:'',category:'portfolio'},...catalog.funds.map(f=>({...f,category:'fund'})),...catalog.nodes.filter(n=>n.kind==='company'||n.kind==='industry'&&n.id!=='energy').map(n=>({...n,category:n.kind==='company'?'company':'industry'}))];
  const words=String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(n=>(category==='all'||n.category===category)&&words.every(w=>[n.name,n.code,n.id].join(' ').toLowerCase().includes(w)));
}
