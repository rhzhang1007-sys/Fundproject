// Fund-name themes and disclosed, mutually exclusive industry categories stay separate.
export function fundTheme(fund){
 const text=[fund.name,fund.indexName,fund.profile?.fullName].filter(Boolean).join(' ');
 for(const [label,rx]of [['新能源汽车',/新能源汽车|新能源车|电动车/],['新能源',/新能源/],['机器人',/机器人/],['CPO',/\bCPO\b|光电共封装/],['有色金属',/有色|稀有金属|工业金属/],['半导体',/半导体|芯片/],['医药',/医药|医疗/],['消费',/消费/],['金融',/银行|证券|金融/]])if(rx.test(text))return label;
 return null;
}
export function industryExposure(funds,records,total){
 const usable=funds.map(f=>({f,r:records.find(r=>r.fundCode===f.code&&r.complete)})).filter(x=>x.r);
 const dates=[...new Set(usable.map(x=>x.r.asOf))];
 if(dates.length!==1)return {ready:false,rows:[],coverage:0,asOf:null};
 const map=new Map();let covered=0;
 for(const {f,r}of usable){
  const amount=Number(f.amount);if(!Number.isFinite(amount)||amount<0)continue;covered+=amount;
  for(const row of r.rows){if(!Number.isFinite(row.weightPercent))continue;const p=map.get(row.code)||{code:row.code,name:row.name,weightPercent:0};p.weightPercent+=total>0?amount/total*row.weightPercent:0;map.set(row.code,p);}
 }
 return {ready:true,asOf:dates[0],coverage:total>0?covered/total*100:0,rows:[...map.values()].filter(r=>r.weightPercent>0).sort((a,b)=>b.weightPercent-a.weightPercent)};
}
