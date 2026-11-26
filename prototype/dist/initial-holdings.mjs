import{normalizeAmounts}from'./v08-model.mjs';
// Product starting values. A saved account, including an empty one, always wins.
export const HOLDINGS_KEY='zhijian-holdings-v08';
export const INITIAL_ITEMS=[
 {code:'510500',name:'中证500ETF南方',amount:8036.42,theme:'中盘宽基'},
 {code:'512480',name:'半导体ETF国联安',amount:5672.18,theme:'半导体'},
 {code:'512010',name:'医药ETF易方达',amount:5489.77,theme:'医药'},
 {code:'159928',name:'消费ETF汇添富',amount:5217.63,theme:'主要消费'},
 {code:'512660',name:'军工ETF国泰',amount:4876.54,theme:'军工'},
 {code:'516160',name:'新能源ETF南方',amount:5962.31,theme:'新能源'},
 {code:'512800',name:'银行ETF华宝',amount:5873.26,theme:'银行'},
 {code:'515220',name:'煤炭ETF国泰',amount:4468.93,theme:'煤炭'},
 {code:'512980',name:'传媒ETF广发',amount:4402.96,theme:'传媒'}
];
export const INITIAL_ACCOUNT=normalizeAmounts(INITIAL_ITEMS.map(x=>({...x,type:'指数型-股票'})));
export function initializeHoldings(storage){
 const raw=storage.getItem(HOLDINGS_KEY);
 if(raw!==null){const stored=JSON.parse(raw);if(!stored||!Array.isArray(stored.items))throw Error('持仓格式无效');return {...stored,...normalizeAmounts(stored.items)};}
 const account={...structuredClone(INITIAL_ACCOUNT),savedAt:new Date().toISOString()};
 storage.setItem(HOLDINGS_KEY,JSON.stringify(account));return account;
}
