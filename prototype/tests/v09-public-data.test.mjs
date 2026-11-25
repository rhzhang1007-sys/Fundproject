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

test('对象分片拒绝串角色和不属于该条新闻的模型引用',()=>{assert.match(publicDataUrl('v10/activity/funds/01.json'),/v10\/activity/);assert.throws(()=>validatePublicData('v10/activity/funds/01.json',{schemaVersion:1,objects:{stock000001:{news:[]}}}));const e={id:'e',title:'公告',date:'2026-11-24',url:'https://example.com',analysis:{points:[{text:'正文',sourceIds:['other']}]}};assert.throws(()=>validatePublicData('v07/events.json',{events:[e]}));});

test('每日净值与因子只从固定公开分片加载，旧远端不能覆盖新本地日期',async()=>{
 const {mergeObservations}=await import('../dist/v09-public-data.mjs');
 assert.match(publicDataUrl('v11/observations/60.json'),/v11\/observations/);assert.match(publicDataUrl('v12/factors/60.json'),/v12\/factors/);
 assert.throws(()=>publicDataUrl('v12/posts/funds/../../secrets.json'));
 const local={schemaVersion:1,funds:{'516160':{snapshot:{date:'2026-11-24',nav:2}}}},remote={schemaVersion:1,funds:{'516160':{snapshot:{date:'2026-11-23',nav:1}}}};
 assert.equal(mergeObservations(local,remote).funds['516160'].snapshot.nav,2);
 assert.throws(()=>validatePublicData('v11/observations/60.json',{schemaVersion:1,funds:{'516160':{snapshot:{date:'2026-02-30',nav:1}}}}));
});
test('帖子分片有正文与评论，并防止串基金股票身份',()=>{
 const value={schemaVersion:1,objectId:'fund516160',records:[{id:'1',objectId:'fund516160',date:'2026-11-24',url:'https://guba.eastmoney.com/news,of516160,1.html',content:'原文',comments:[{id:'2',text:'评论'}]}]};
 assert.equal(validatePublicData('v12/posts/funds/516160.json',value).records[0].comments.length,1);assert.throws(()=>validatePublicData('v12/posts/stocks/516160.json',value));
});

test('独立新闻分片保持基金股票身份和真实更新时间',()=>{const value={schemaVersion:1,lastCheckedAt:'2026-11-25T11:00:00+08:00',objects:{fund000001:{news:[]}}};assert.match(publicDataUrl('v12/news/funds/01.json'),/v12\/news/);assert.equal(validatePublicData('v12/news/funds/01.json',value).lastCheckedAt,value.lastCheckedAt);assert.throws(()=>validatePublicData('v12/news/stocks/01.json',value));});

test('帖子按对象和日期保留30条，合并元数据不抹掉正文评论',async()=>{const {mergePosts}=await import('../dist/v09-public-data.mjs');const a=Array.from({length:30},(_,i)=>({id:String(i),objectId:'fund1',date:'2026-11-24',content:'原始正文',comments:[{id:'c',text:'评论'}],coverage:{body:'complete',comments:'complete'}}));const b=Array.from({length:30},(_,i)=>({id:String(i),objectId:'stock2',date:'2026-11-24'}));assert.equal(mergePosts(a,b).length,60);const r=mergePosts(a,[{id:'0',objectId:'fund1',date:'2026-11-24'}]).find(x=>x.id==='0');assert.equal(r.content,'原始正文');assert.equal(r.comments.length,1);});
