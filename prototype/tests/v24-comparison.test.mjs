import test from 'node:test';import assert from 'node:assert/strict';
import {comparisonEntry,comparisonGroup,comparisonWindows,COMPARISON_METHOD,createComparisonStore} from '../dist/v24-comparison.mjs';
import {peerGroupView} from '../dist/v24-compare-view.mjs';
const catalogue=()=>({schemaVersion:1,version:'test',method:COMPARISON_METHOD,asOf:'2026-11-25',windows:{year:{from:'2025-11-01',to:'2026-11-25',observations:252},long:{from:'2023-11-27',to:'2026-11-25',observations:725}},funds:Object.fromEntries(Array.from({length:62},(_,i)=>{const code=String(i).padStart(6,'0'),stats={totalReturn:i/100,annualVol:.2,maxDrawdown:i/1000,ulcer:.1,win63:.6};return [code,{code,name:'基金'+i,type:i===61?'债券型':'指数型-股票',family:i%2?'联接':'ETF',indexCode:i<4?'IDX':'OTHER',fee:i===60?null:.006,windows:{year:i===60?null:stats,long:stats}}];}))});
test('whole-category comparisons include every share class, while search and pagination preserve full-group ranks',()=>{
 const c=catalogue(),a=comparisonGroup(c,'000000'),b=comparisonGroup(c,'000000',{peerPage:1,peerSearch:'基金5'});
 assert.equal(a.comparisonCount,60);assert.equal(a.rows.length,61);assert.equal(a.visible.length,26);assert.equal(a.pages,3);assert.ok(!a.rows.some(x=>x.type==='债券型'));assert.deepEqual(a.statistics,b.statistics);assert.equal(a.statistics.totalReturn.n,60);assert.equal(a.statistics.totalReturn.rank,60);assert.equal(a.statistics.maxDrawdown.rank,1);assert.equal(a.statistics.totalReturn.median,.3);assert.equal(a.rows.find(x=>x.code==='000060').totalReturn,undefined);
 const second=comparisonGroup(c,'000000',{peerPage:1});assert.notEqual(a.visible[1].code,second.visible[1].code);assert.equal(second.visible[0].code,'000000');
});
test('index, product family and similar-holding scopes are explicit and do not silently cap the full category',()=>{
 const c=catalogue();assert.equal(comparisonGroup(c,'000000',{peerScope:'index'}).comparisonCount,3);assert.equal(comparisonGroup(c,'000000',{peerFamily:'联接'}).comparisonCount,30);assert.equal(comparisonGroup(c,'000000',{peerScope:'similar'},[{code:'000050'}]).comparisonCount,1);
 const x=comparisonGroup(c,'000000',{peerSearch:'not-found'});assert.equal(x.filteredCount,0);assert.equal(x.comparisonCount,60);assert.equal(x.visible.length,1);
});
test('ties share ranks and each statistic uses only its known values, keeping zero separate from missing',()=>{
 const c=catalogue();c.funds['000001'].windows.year.totalReturn=0;c.funds['000002'].fee=0;
 const g=comparisonGroup(c,'000000');assert.equal(g.statistics.totalReturn.rank,59);assert.equal(g.statistics.fee.n,60);assert.equal(g.rows.find(x=>x.code==='000002').fee,0);assert.equal(g.rows.find(x=>x.code==='000060').fee,null);
});
test('fixed windows use only the last three calendar years and require every date, including the endpoint',()=>{
 const dates=Array.from({length:1500},(_,i)=>new Date(Date.UTC(2022,0,1+i)).toISOString().slice(0,10)),asOf=dates.at(-1),m={calendar:dates,asOf},p={code:'000001',name:'样本基金',type:'股票型',fees:{management:'0.5%',custody:'0.1%'}},nav={basis:'forward-adjusted-from-daily-growth',quality:'clean',crossCheck:'agree',points:dates.map((d,i)=>[d,1+i*.001])};
 const w=comparisonWindows(dates,asOf),x=comparisonEntry(p,nav,m);assert.equal(w.year.dates.length,253);assert.ok(w.long.dates[0]>dates[0]);assert.ok(x.windows.year);assert.ok(x.windows.long);assert.equal(x.windows.year.maxDrawdown,0);
 assert.equal(comparisonEntry(p,{...nav,points:nav.points.slice(0,-1)},m).windows.year,null);assert.equal(comparisonEntry(p,{...nav,points:nav.points.filter((_,i)=>i!==1490)},m).windows.year,null);assert.equal(comparisonEntry(p,{...nav,crossCheck:'divergent'},m).windows.year,null);
});
test('comparison loader keeps the accepted catalogue when a remote format fails validation',async()=>{
 const local=catalogue(),store=createComparisonStore(async url=>({ok:true,json:async()=>url.startsWith('http')?{...local,method:'unexpected'}:local}));assert.equal((await store.load()).version,'test');
});
test('group table stays bounded, exposes all-category controls and escapes source names',()=>{
 const c=catalogue();c.funds['000000'].name='<img src=x>';const a={fund:{id:'fund000000',code:'000000',name:'目标基金',study:{peers:[]}},funds:[{id:'fund000000',code:'000000',name:'目标基金'}]},html=peerGroupView(a,{comparisonCatalogue:c});
 assert.match(html,/同类型全部/);assert.match(html,/60个份额/);assert.match(html,/其他同类中位数/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img'));assert.ok((html.match(/深入对比/g)||[]).length<=25);assert.ok(!html.includes('NaN'));
});
