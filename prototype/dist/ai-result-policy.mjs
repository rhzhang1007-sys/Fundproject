// Source comparison improves a result; it must not discard useful prose.
import {readResultJSON} from './ai-evidence.mjs';
const clean=s=>String(s??'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/https?:\/\/[^\s<>）)]+/gi,'').trim();
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function sourceExcerptResult(materials,reason=''){
 const rows=materials.filter(m=>m.text?.trim()).slice(0,5);return {title:'所选材料 · 原文要点',overview:{text:rows.length?'已整理所选材料的原文要点，可展开查看来源。':'本次尚无可供整理的原文材料。',sourceIds:rows.slice(0,3).map(m=>m.id)},points:rows.map((m,i)=>({heading:'原文 '+(i+1),text:(m.text.split('正文：')[1]?.split('评论：')[0]||m.text).trim().slice(0,2600),sourceIds:[m.id]})),quality:{kind:'source-excerpts',numberWarnings:0,unmappedBlocks:0,reason:reason?'AI解读本次未完成，先保留原文要点。':''}};
}
export function resolveResult(raw,task,materials,question,validate){
 try{const result=validate(raw,task,materials,question);return {...result,quality:{kind:'analysis',numberWarnings:0,unmappedBlocks:0}};}catch{}
 let parsed;try{parsed=readResultJSON(raw);}catch{}
 const known=new Map(materials.map(m=>[m.id,m])),quality={kind:'analysis',numberWarnings:0,unmappedBlocks:0};
 function block(p){
  if(typeof p==='string')p={text:p};if(!p||!p.text)return null;
  let text=clean(p.text).slice(0,3000),heading=clean(p.heading).slice(0,200);if(!text)return null;
  const sourceIds=[...new Set((Array.isArray(p.sourceIds)?p.sourceIds:[]).filter(id=>known.has(id)))];
  if(!sourceIds.length)quality.unmappedBlocks++;
  const checkIds=sourceIds.length?sourceIds:materials.map(m=>m.id);
  for(let attempt=0;attempt<80;attempt++){
   try{validate(JSON.stringify({title:'解读',points:[{text,heading,sourceIds:checkIds}]}),'summary',materials);break;}
   catch(e){if(e.code!=='AI_UNGROUNDED_NUMBER')break;const value=e.details?.value;if(!value)break;
    // Hide the unsupported numeric span while retaining the surrounding analysis.
    let pattern=new RegExp('(?<![\\d.])'+escape(value)+'(?![\\d.])(?:\\s*(?:个百分点|亿元|万元|万股|亿股|元|%|％|倍))?','g');
    let next=text.replace(pattern,'〔数值待对照〕'),nextHeading=heading.replace(pattern,'〔数值待对照〕');
    if(next===text&&nextHeading===heading){const number=value.match(/[-+]?\d+(?:\.\d+)?/)?.[0];if(!number)break;pattern=new RegExp('(?<![\\d.])'+escape(number)+'(?![\\d.])(?:\\s*(?:个百分点|亿元|万元|万股|亿股|元|%|％|倍))?','g');next=text.replace(pattern,'〔数值待对照〕');nextHeading=heading.replace(pattern,'〔数值待对照〕');}
    if(next===text&&nextHeading===heading)break;text=next;heading=nextHeading;quality.numberWarnings++;
   }
  }
  try{validate(JSON.stringify({title:'解读',points:[{text,heading,sourceIds:checkIds}]}),'summary',materials);}catch(e){if(e.code==='AI_UNGROUNDED_NUMBER'||!materials.length){text=text.replace(/[-+]?\d+(?:\.\d+)?/g,'〔数值待对照〕');heading=heading.replace(/[-+]?\d+(?:\.\d+)?/g,'〔数值待对照〕');quality.numberWarnings++;}}
  return {text,...(heading?{heading}:{}),sourceIds};
 }
 let overview,points=[],title='AI解读';
 if(parsed&&typeof parsed==='object'){
  title=clean(parsed.title||parsed.claim||title).slice(0,180);overview=block(parsed.overview);points=(Array.isArray(parsed.points)?parsed.points:[]).slice(0,30).map(block).filter(Boolean);
 }
 if(!points.length&&!overview){
  let prose=clean(raw).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  if(/^[{[]/.test(prose)){const parts=[...prose.matchAll(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/g)].map(m=>{try{return JSON.parse('"'+m[1]+'"');}catch{return '';}});prose=parts.join('\n\n');}
  if(/^(?:NO_JSON|null|undefined|error)$/i.test(prose))prose='';
  const paragraphs=prose.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean).slice(0,8);points=paragraphs.map(block).filter(Boolean);
 }
 title=block({text:title,sourceIds:materials.map(m=>m.id)})?.text.slice(0,180)||'AI解读';
 if(!points.length&&overview)points=[overview];if(!points.length){const fallback=sourceExcerptResult(materials,'empty-model-result');return task==='verify'?{...fallback,verdict:'unverifiable'}:fallback;}
 if(!overview)overview=points[0];
 // A repaired answer must never invent a positive verification verdict.
 const verdict=task==='verify'?'unverifiable':undefined;
 return {title,overview,points,...(verdict?{verdict}:{}),quality};
}
