const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function readResultJSON(raw){
 const text=String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 try{return JSON.parse(text);}catch{}
 // Some compatible services surround valid JSON with prose. Decode only a
 // complete JSON object; never execute model text or infer missing references.
 const start=text.indexOf('{');if(start<0)throw Error('模型未返回规定格式');
 let depth=0,quoted=false,escaped=false;
 for(let i=start;i<text.length;i++){const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(text.slice(start,i+1));}catch{break;}}}
 throw Error('模型未返回规定格式');
}
export function normalizeEvidenceDates(text,materials){
 let out=String(text||'');
 for(const date of new Set(materials.flatMap(m=>[String(m.date||'').slice(0,10),...(String(m.text||'').match(/\d{4}-\d{2}-\d{2}/g)||[])]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)))){
  const [y,m,d]=date.split('-'),month=String(Number(m)),day=String(Number(d));
  const variants=[`${y}-${m}-${d}`,`${y}/${m}/${d}`,`${y}.${m}.${d}`,`${y}/${month}/${day}`,`${y}.${month}.${day}`,`${y}年${month}月${day}日`,`${y}${m}${d}`];
  for(const v of variants)out=out.replace(new RegExp('(?<!\\d)'+escape(v)+'(?!\\d)','g'),'日期');
  // Month.day is a date only in a date position. A price such as 11.24元
  // remains a numeric claim even when the source date happens to be Nov 24.
  for(const v of new Set([`${m}.${d}`,`${month}.${day}`,`${m}/${d}`,`${month}/${day}`]))out=out.replace(new RegExp('(^|截至|日期[：:]?|[（(【])'+escape(v)+'(?=$|[日号帖评）)】]|[\\u4e00-\\u9fff])','g'),(whole,prefix,offset)=>{const after=out.slice(offset+whole.length);return /^(?:元|万|亿|倍|点|股|份|%|％)/.test(after)?whole:prefix+'日期';});
 }
 return out;
}
export function evidenceNumberError(value,field,sourceIds){const error=new Error(field==='title'?'模型标题加入了材料中没有的数字':'模型加入了材料中没有的数字');error.code='AI_UNGROUNDED_NUMBER';error.details={field,value:String(value).slice(0,30),sourceIds:sourceIds.slice(0,30)};return error;}
export function financialClaims(text){const normalized=String(text||'').normalize('NFKC').replace(/万块(?:钱)?/g,'万元').replace(/亿块(?:钱)?/g,'亿元').replace(/(\d)块(?:钱)?/g,'$1元');return [...normalized.matchAll(/([-+]?\d+(?:\.\d+)?)\s*(个百分点|个基点|基点|亿元|万元|万股|亿股|元|%|‰|倍)/g)].map(m=>({value:Number(m[1]),key:Number(m[1])+'|'+m[2],text:m[0]}));}
export function unmatchedFinancialClaims(output,source){
 const evidence=financialClaims(source),keys=new Set(evidence.map(x=>x.key)),values=new Set(evidence.map(x=>x.value));
 // Forum prices sometimes omit 元. Such a number must occur in the actual
 // title/body/comment text; batch counts and comment labels cannot justify it.
 const facts=String(source).replace(/^(?:本批|本帖|关联对象).*$/gm,'').replace(/评论\d+(?:（[^）]*）)?[：:]/g,'评论：'),bare=new Set((facts.match(/[-+]?\d+(?:\.\d+)?/g)||[]).map(Number));
 return financialClaims(output).filter(c=>!keys.has(c.key)&&(values.has(c.value)||!bare.has(c.value)));
}
