import test from 'node:test';import assert from 'node:assert/strict';import {validateAIResult,PROMPTS} from '../dist/v08-ai.mjs';
const sources=[{id:'report',text:'2025年度产能772GWh。',url:'https://example.com/report',date:'2026-03-10'}];
test('三类提示各有任务，均约束数字、引用和联网声明',()=>{for(const p of Object.values(PROMPTS)){assert.match(p,/不编造/);assert.match(p,/不得声称已联网搜索/);}assert.match(PROMPTS.verify,/unverifiable/);});
test('结构化摘要只接受输入来源与数字',()=>{assert.equal(validateAIResult(JSON.stringify({title:'摘要',points:[{text:'2025年度产能772GWh。',sourceIds:['report']}]}),'summary',sources).points.length,1);});
test('未知来源、额外数字和自行生成的URL会被拒绝',()=>{
 for(const point of [{text:'产能772',sourceIds:['unknown']},{text:'产能1000',sourceIds:['report']},{text:'https://fake.test',sourceIds:['report']}])assert.throws(()=>validateAIResult(JSON.stringify({points:[point]}),'summary',sources));
});
test('无来源可以保留未核实，不能渲染成支持或矛盾',()=>{
 assert.equal(validateAIResult('{"verdict":"unverifiable","points":[{"text":"所给材料不足","sourceIds":[]}]}','verify',[]).verdict,'unverifiable');
 assert.throws(()=>validateAIResult('{"verdict":"supported","points":[{"text":"已确认","sourceIds":[]}]}','verify',[]));
});
test('标题中的数字也必须可追溯，来源日期可用于标题',()=>{
 assert.throws(()=>validateAIResult('{"title":"规模1000","points":[{"text":"产能772","sourceIds":["report"]}]}','summary',sources));
 assert.equal(validateAIResult('{"title":"2026资料","points":[{"text":"产能772","sourceIds":["report"]}]}','summary',sources).title,'2026资料');
});
test('格式不合格最多重试一次；HTTP拒绝不重复调用',async()=>{
 const {requestAI}=await import('../dist/v08-ai.mjs');const old=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:++calls===1?'NO_JSON':'{"title":"摘要","points":[{"text":"产能772","sourceIds":["report"]}]}'}}]})});
  await requestAI({url:'https://example.com/api',key:'test',model:'test'},'summary',sources);assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;return {ok:false,status:401};};
  await assert.rejects(requestAI({url:'https://example.com/api',key:'test',model:'test'},'summary',sources),/401/);assert.equal(calls,1);
 }finally{globalThis.fetch=old;}
});

test('自选AI填写根地址也能补全接口路径',async()=>{const {requestAI}=await import('../dist/v08-ai.mjs');const original=globalThis.fetch;let seen;globalThis.fetch=async(url)=>{seen=url;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({title:'摘要',points:[{text:'原文',sourceIds:['s']}]})}}]})};};try{await requestAI({url:'https://api.example.com',key:'test-only',model:'model'},'summary',[{id:'s',text:'原文'}]);assert.equal(seen,'https://api.example.com/v1/chat/completions');}finally{globalThis.fetch=original;}});

test('30帖中文正文和评论均保留摘录，总输入不超过120KB且去重',async()=>{const {postMaterials}=await import('../dist/v08-ai.mjs');const rows=Array.from({length:30},(_,i)=>({id:String(i),title:'标题'.repeat(1000),content:'正文'.repeat(10000),date:'2026-11-24',url:'https://example.com/'+i,comments:[{id:'c'+i,text:'评论'.repeat(10000)}],coverage:{comments:'partial'}}));const materials=postMaterials([...rows,rows[0]]);assert.equal(materials.length,30);assert.ok(materials.reduce((n,r)=>n+new TextEncoder().encode(r.text).length,0)<=120000);assert.ok(materials.every(r=>r.text.includes('正文正文')&&r.text.includes('评论评论')&&r.text.includes('原文摘录')&&!r.text.includes('\uFFFD')));});
