import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {normalizeAmounts,holdingsModel,graphSubset,eventSelection} from '../dist/v08-model.mjs';
const p=JSON.parse(await readFile(new URL('../dist/data/v07/portfolio.json',import.meta.url)));
test('金额精确到分，自动归一化占比，不设默认个人持仓',()=>{
 assert.deepEqual(normalizeAmounts([]).items,[]);assert.equal(normalizeAmounts([]).total,0);
 const a=normalizeAmounts([{code:'516160',amount:'7000.01'},{code:'515700',amount:'3000.02'}]);assert.equal(a.total,10000.03);assert.ok(Math.abs(Object.values(a.weights).reduce((s,v)=>s+v,0)-100)<1e-9);
 assert.throws(()=>normalizeAmounts([{code:'516160',amount:'1.001'}]),/两位/);assert.throws(()=>normalizeAmounts([{code:'516160',amount:'-1'}]));assert.throws(()=>normalizeAmounts([{code:'516160',amount:1},{code:'516160',amount:2}]),/重复/);
});
test('7000/3000产生70/30占比，两基金已披露的相同股票被合并',()=>{
 const m=holdingsModel({items:[{code:'516160',amount:7000},{code:'515700',amount:3000}]},p.funds);assert.equal(m.total,10000);assert.equal(m.funds[0].share,70);assert.equal(m.companies.length,117);assert.ok(Math.abs(m.companies[0].share-9.348)<1e-9);assert.equal(m.funds[1].holdings.length,15);
});
test('图谱初始最多10只股票，单基金聚焦仍最多10只，企业聚焦只显示持有路径',()=>{
 const m=holdingsModel({items:[{code:'516160',amount:7000},{code:'515700',amount:3000}]},p.funds);
 assert.equal(graphSubset(m).companies.length,10);assert.equal(graphSubset(m,'fund516160').companies.length,10);assert.equal(graphSubset(m,'fund515700').companies.length,10);
 const s=graphSubset(m,'stock300750');assert.equal(s.companies.length,1);assert.equal(s.funds.length,2);assert.equal(s.funds[0].code,'516160');
});
test('新增基金只依用户金额纳入，不借用其他基金持仓',()=>{const m=holdingsModel({items:[{code:'000001',name:'基金甲',amount:1234}]},p.funds);assert.equal(m.funds[0].share,100);assert.equal(m.companies.length,0);});
test('时间轴按选定对象与30天窗口筛选，较早事件只在主动切换后出现',()=>{
 const m=holdingsModel({items:[{code:'516160',amount:1}]},p.funds);const es=[{id:'a',entityCode:'300750',date:'2026-11-03'},{id:'b',entityCode:'300750',date:'2026-10-20'},{id:'c',entityCode:'999999',date:'2026-11-03'}];
 assert.deepEqual(eventSelection(es,m,'fund','fund516160','2026-11-23').map(x=>x.id),['a']);assert.equal(eventSelection(es,m,'company','stock300750','2026-11-23',true).length,2);
});

test('基金自身公告、多股票标签和基金代码角色分别处理',()=>{
 const m=holdingsModel({items:[{code:'516160',amount:1}]},p.funds);
 const es=[{id:'fund',entityCode:'516160',entities:[{kind:'fund',code:'516160'}],date:'2026-11-24'},
 {id:'multi',entityCode:'000001',entityCodes:['000001','300750'],date:'2026-11-24'}];
 assert.deepEqual(eventSelection(es,m,'fund','fund516160','2026-11-24').map(x=>x.id),['fund','multi']);
 assert.equal(eventSelection(es,m,'company','stock516160','2026-11-24').length,0);
 assert.equal(eventSelection(es,m,'fund','fund-missing','2026-11-24').length,0);
});
test('同代码基金与股票的时间轴不会串对象',()=>{
 const m=holdingsModel({items:[{code:'000001',name:'华夏成长混合',amount:1}]},p.funds);
 const es=[{id:'fund',entities:[{kind:'fund',code:'000001'}],date:'2026-11-24'},
 {id:'stock',entities:[{kind:'stock',code:'000001'}],date:'2026-11-24'}];
 assert.deepEqual(eventSelection(es,m,'fund','fund000001','2026-11-24').map(x=>x.id),['fund']);
 assert.deepEqual(eventSelection(es,m,'company','stock000001','2026-11-24').map(x=>x.id),['stock']);
});
