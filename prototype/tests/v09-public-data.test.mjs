import test from 'node:test';import assert from 'node:assert/strict';
import {publicDataUrl,validatePublicData,loadPublicData} from '../dist/v09-public-data.mjs';
test('公开更新仅允许固定仓库的事件、市场和月份归档路径',()=>{
 assert.match(publicDataUrl('v07/events.json'),/^https:\/\/raw\.githubusercontent\.com\/rhzhang1007-sys\/Fundproject\/main\//);
 for(const path of ['../holdings.json','v08/llm-cache.json','https://evil.test/data','archive/2026-13.json'])assert.throws(()=>publicDataUrl(path));
});
test('坏来源保留本地资料，公开请求不带用户持仓或认证',async()=>{
 let request;const local={events:[]};const data=await loadPublicData('v07/events.json',local,{fetcher:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({events:[{id:'x'}]})};}});
 assert.equal(data,local);assert.equal(request.options.credentials,'omit');assert.equal(request.options.body,undefined);assert.equal(request.options.headers,undefined);
});
test('同记录重复及无日期事件不能替换网页当前数据',()=>{
 const event={id:'x',title:'公告',date:'2026-11-24',url:'https://example.com/notice'};
 assert.throws(()=>validatePublicData('v07/events.json',{events:[event,event]}));assert.throws(()=>validatePublicData('v07/events.json',{events:[{...event,date:null}]}));
 assert.equal(validatePublicData('v07/events.json',{events:[event]}).events.length,1);
});
