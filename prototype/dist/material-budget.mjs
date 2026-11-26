const encoder=new TextEncoder(),decoder=new TextDecoder();
export const textBytes=text=>encoder.encode(String(text||'')).length;
export function clipBytes(text,limit){const bytes=encoder.encode(String(text||''));return bytes.length<=limit?String(text||''):decoder.decode(bytes.slice(0,Math.max(0,limit))).replace(/\uFFFD$/,'');}
// Small records keep their complete text; the remaining budget goes to long records.
export function materialBudgets(sizes,total=110000,maximum=28000){
 const caps=sizes.map(n=>Math.min(n,maximum));if(caps.reduce((a,b)=>a+b,0)<=total)return caps;
 let lo=0,hi=maximum;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(caps.reduce((s,n)=>s+Math.min(n,mid),0)<=total)lo=mid;else hi=mid-1;}return caps.map(n=>Math.min(n,lo));
}
export function fitTextMaterials(rows){
 const unique=[...new Map(rows.map(x=>[x.id,x])).values()].slice(0,30),budgets=materialBudgets(unique.map(x=>textBytes(x.text)));
 return unique.map((x,i)=>textBytes(x.text)<=budgets[i]?x:{...x,text:clipBytes(x.text,budgets[i]-100)+'\n[材料已节选，剩余内容未发送]'});
}
