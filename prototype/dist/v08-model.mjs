export function normalizeAmounts(rows) {
  if(!Array.isArray(rows)||rows.length>500)throw Error('持仓数量无效');
  const codes=new Set();let totalCents=0;
  const items=rows.map(r=>{
    const code=String(r.code||'').trim(),raw=String(r.amount??'').trim();
    if(!/^\d{6}$/.test(code)||codes.has(code))throw Error('基金代码无效或重复');
    if(!/^\d+(\.\d{1,2})?$/.test(raw))throw Error('金额最多保留两位小数');
    const cents=Math.round(Number(raw)*100);
    if(!Number.isSafeInteger(cents)||cents<=0||cents>1e14)throw Error('请填写大于0的持有金额');
    codes.add(code);totalCents+=cents;return {code,name:String(r.name||code),type:String(r.type||''),amount:cents/100};
  });
  if(!Number.isSafeInteger(totalCents))throw Error('金额合计过大');
  return {schemaVersion:1,currency:'CNY',items,total:totalCents/100,weights:Object.fromEntries(items.map(r=>[r.code,r.amount*100/totalCents*100]))};
}
export function holdingsModel(account,publicFunds) {
  const amounts=normalizeAmounts(account.items||[]);
  const funds=amounts.items.map(item=>{
    const f=publicFunds.find(f=>f.code===item.code);
    return {...(f||{}),...item,id:f?.id||'fund'+item.code,share:amounts.weights[item.code],holdings:f?.holdings||[],disclosure:f?.disclosure||null};
  });
  const map=new Map();
  for(const f of funds)for(const row of f.holdings){
    const c=map.get(row.code)||{id:'stock'+row.code,code:row.code,name:row.name,share:0,amount:0,paths:[]};
    const share=f.share*row.weight/100;c.share+=share;c.amount+=f.amount*row.weight/100;
    c.paths.push({fundId:f.id,code:f.code,name:f.name,weight:row.weight,contribution:share,asOf:f.disclosure?.asOf||null});map.set(row.code,c);
  }
  const companies=[...map.values()].sort((a,b)=>b.share-a.share||a.code.localeCompare(b.code));
  return {...amounts,funds,companies,covered:companies.reduce((s,c)=>s+c.share,0)};
}
export function graphSubset(model,focus='portfolio') {
  if(focus.startsWith('fund')){
    const f=model.funds.find(x=>x.id===focus);return {kind:'fund',root:f,funds:f?[f]:[],companies:f?[...f.holdings].sort((a,b)=>b.weight-a.weight).slice(0,10).map(r=>model.companies.find(c=>c.code===r.code)).filter(Boolean):[]};
  }
  if(focus.startsWith('stock')){
    const c=model.companies.find(c=>c.id===focus);return {kind:'company',root:c,companies:c?[c]:[],funds:c?model.funds.filter(f=>c.paths.some(p=>p.fundId===f.id)):[]};
  }
  return {kind:'portfolio',root:null,funds:model.funds.slice(0,8),companies:model.companies.filter(c=>c.share>0).slice(0,10)};
}
export function eventSelection(events,model,mode,id,now,older=false) {
  const end=String(now).slice(0,10),start=new Date(Date.parse(end+'T00:00:00Z')-29*86400000).toISOString().slice(0,10);
  const f=model.funds.find(f=>f.id===id),codes=mode==='fund'?new Set([f?.code,...(f?.holdings.map(x=>x.code)||[])]):new Set([String(id||'').replace(/^stock/,'')]);
  if(mode==='fund'&&!f)return [];
  return events.filter(e=>{
    const entities=e.entities?.length?e.entities: (e.entityCodes||[e.entityCode]).map(code=>({code,kind:null}));
    const match=entities.some(t=>codes.has(t.code)&&(mode==='fund'||t.kind!=='fund'));
    return match&&e.date<=end&&(older||e.date>=start);
  }).sort((a,b)=>b.date.localeCompare(a.date));
}
