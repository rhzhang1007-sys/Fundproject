import test from 'node:test';import assert from 'node:assert/strict';
import {fundTheme,industryExposure} from '../dist/v09-industry.mjs';
test('基金名称主题与真实持仓行业分开，不由新能源名称推算100%汽车',()=>{
 assert.equal(fundTheme({name:'南方中证新能源ETF'}),'新能源');assert.equal(fundTheme({name:'平安中证新能源汽车产业ETF'}),'新能源汽车');
 assert.equal(fundTheme({name:'某某混合'}),null);
});
test('同报告期行业权重按持有金额折算，缺失部分不填0',()=>{
 const f=[{code:'1',amount:7000},{code:'2',amount:3000}],rs=[{fundCode:'1',complete:true,asOf:'2026-09-30',rows:[{code:'C',name:'制造业',weightPercent:88.08}]}];
 const x=industryExposure(f,rs,10000);assert.equal(x.coverage,70);assert.ok(Math.abs(x.rows[0].weightPercent-61.656)<1e-10);
});
test('不拼接不同时点行业表',()=>{
 const f=[{code:'1',amount:1},{code:'2',amount:1}],rs=[{fundCode:'1',complete:true,asOf:'2026-09-30',rows:[]},{fundCode:'2',complete:true,asOf:'2026-06-30',rows:[]}];
 assert.equal(industryExposure(f,rs,2).ready,false);
});
