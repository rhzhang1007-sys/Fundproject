import test from 'node:test';import assert from 'node:assert/strict';
import {dataPath,createDataFetcher} from '../dist/data-source.mjs';
test('Pages data fallback preserves the exact deployed revision, including normalized sibling shard paths',async()=>{
 const calls=[],revision='a'.repeat(40),remote={ok:true,json:async()=>({funds:{'000001':{snapshot:{date:'2026-11-26'}}}})};
 const fetcher=async(url,opts)=>{calls.push([url,opts]);return calls.length===1?{ok:false,status:404}:remote;};
 const res=await createDataFetcher({revision,fetcher})('./data/v10/../v11/observations/01.json',{cache:'no-store'});
 assert.equal(res,remote);assert.equal(calls[1][0],`https://raw.githubusercontent.com/rhzhang1007-sys/Fundproject/${revision}/prototype/dist/data/v11/observations/01.json`);assert.equal(calls[1][1].credentials,'omit');
});
test('local data stays local and missing data does not become a fabricated empty result',async()=>{
 let n=0;const local={ok:true};assert.equal(await createDataFetcher({fetcher:async()=>{n++;return local;}})('./data/catalog.json'),local);assert.equal(n,1);
 const absent={ok:false,status:404};assert.equal(await createDataFetcher({fetcher:async()=>absent})('./data/v11/observations/99.json'),absent);
 let calls=0;await assert.rejects(createDataFetcher({fetcher:async()=>{calls++;throw Error('offline');}})('./data/v11/observations/99.json'),/offline/);assert.equal(calls,2);
});
test('data fallback never turns API calls, hidden files or escaped paths into public repository requests',async()=>{
 for(const p of ['/api/ai','https://example.com/data/x.json','./data/../../.private/state.json','./data/.private/state.json','./data/x.json?key=x','./data/%2e%2e/.env.json'])assert.equal(dataPath(p),null);
 let n=0;await createDataFetcher({fetcher:async()=>{n++;return {ok:false};}})('/api/ai');assert.equal(n,1);
 assert.throws(()=>createDataFetcher({revision:'main'}));
});
