import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,mkdir,writeFile,rename,rm}from'node:fs/promises';import path from'node:path';import os from'node:os';
import{createCloudState}from'../cloud-state.mjs';import{createForumService}from'../forum-service.mjs';import{createPublicMirror}from'../public-data-cache.mjs';
const response=v=>({ok:true,text:async()=>JSON.stringify(v)});
test('new Supabase secret stays server-side and is not misused as a JWT',async()=>{
 const calls=[],store=createCloudState({url:'https://state.example.com',key:'sb_secret_test_only',fetcher:async(u,o)=>{calls.push([u,o]);return response(u.includes('/rpc/')?{revision:1}:[]);}});
 await store.read('ai:2026-11-27');await store.write('batch:abc',{status:'running'});
 assert.equal(calls[0][1].headers.apikey,'sb_secret_test_only');assert.equal(calls[0][1].headers.Authorization,undefined);assert.match(calls[1][0],/rpc\/zhijian_put_state$/);
 assert.equal(createCloudState(),null);assert.throws(()=>createCloudState({required:true}));assert.throws(()=>createCloudState({url:'https://state.example.com',key:'sb_publishable_test'}));
 await assert.rejects(store.read('../.env'));assert.equal(calls.length,2);
});
test('cloud reservation uses atomic RPC, then idempotent settlement with no provider credentials in state',async()=>{
 const calls=[],store=createCloudState({url:'https://state.example.com',key:'sb_secret_test_only',fetcher:async(u,o)=>{calls.push([u,JSON.parse(o.body)]);return response({id:'reservation',ledger:{date:'2026-11-27',costCNY:0,reservedCNY:1}});}});
 const row=await store.reserveBudget('2026-11-27',1,5);await store.settleBudget(row.id,{actual:.5});
 assert.match(calls[0][0],/zhijian_reserve_ai$/);assert.equal(calls[0][1].p_amount,1);assert.equal(calls[1][1].p_actual,.5);assert.ok(!JSON.stringify(calls).includes('sb_secret'));
 const full=createCloudState({url:'https://state.example.com',key:'sb_secret_test_only',fetcher:async()=>response({error:'budget-exhausted'})});await assert.rejects(full.reserveBudget('2026-11-27',1,5),/额度/);
});
test('complete batch, body and comments survive a new backend instance without local runtime files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'fund-cloud-state-')),date=new Date(Date.now()-86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),id='stock000001',rows=new Map();
 const store={read:async k=>rows.has(k)?{value:structuredClone(rows.get(k)),revision:1}:null,write:async(k,v)=>{rows.set(k,structuredClone(v));return{revision:1};}};
 const put=async(p,v)=>{p=path.join(root,p);await mkdir(path.dirname(p),{recursive:true});await writeFile(p+'.tmp',JSON.stringify(v));await rename(p+'.tmp',p);};
 try{
  await put('dist/data/v10/objects.json',{objects:[{id}]});
  const forum=createForumService(root,{stateStore:store,runWorker:async()=>put('.private/forum/'+id+'/'+date+'.json',{objectId:id,date,status:'complete',records:[{id:'1',objectId:id,date,content:'业务进展',comments:[{id:'c',text:'关注公告'}],coverage:{body:'complete',comments:'complete'}}]})});
  const batch=await forum.startBatch([id],date);let result;
  for(let i=0;i<50;i++){result=await forum.getBatch(batch.id);if(result.status==='complete')break;await new Promise(r=>setTimeout(r,5));}assert.equal(result.status,'complete');
  await rm(path.join(root,'.private'),{recursive:true,force:true});const restored=createForumService(root,{stateStore:store});assert.equal((await restored.getBatch(batch.id)).status,'complete');const material=await restored.get(id,date);assert.equal(material.records[0].content,'业务进展');assert.equal(material.records[0].comments.length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('backend fetches fresh public material and deduplicates refreshes without changing daily workflows',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'fund-public-mirror-'));let n=0,clock=1000;
 const mirror=createPublicMirror(root,{now:()=>clock,ttl:100,fetcher:async()=>{n++;return new Response(JSON.stringify({objectId:'stock000001',records:[{id:'new',objectId:'stock000001'}]}));}});
 try{
  const values=await Promise.all([mirror.read('v12/posts/stocks/000001.json'),mirror.read('v12/posts/stocks/000001.json')]);assert.equal(n,1);assert.equal(values[0].records[0].id,'new');await mirror.read('v12/posts/stocks/000001.json');assert.equal(n,1);clock+=101;await mirror.read('v12/posts/stocks/000001.json');assert.equal(n,2);await assert.rejects(mirror.read('../../.env.local'));
 }finally{await rm(root,{recursive:true,force:true});}
});
