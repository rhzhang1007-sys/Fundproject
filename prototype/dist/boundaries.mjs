import {isoDate} from './quant.mjs';
export function validatePersonal(raw,catalog,data={}){
 if(raw==null)return {valid:true,value:{horizonMonths:null,lossLimit:null,riskCaps:[],industryCaps:[]}};
 const fail=reason=>({valid:false,reason});
 if(typeof raw!=='object'||Array.isArray(raw))return fail('个人边界格式无效');
 const horizon=raw.horizonMonths==null||raw.horizonMonths===''?null:Number(raw.horizonMonths);
 if(horizon!==null&&(!Number.isInteger(horizon)||horizon<1||horizon>1200))return fail('预计持有期限须为1至1200个月');
 const riskCaps=raw.riskCaps||[],industryCaps=raw.industryCaps||[];
 if(!Array.isArray(riskCaps)||riskCaps.length>100||riskCaps.some(r=>!catalog.funds.some(f=>f.id===r.id)||typeof r.max!=='number'||!Number.isFinite(r.max)||r.max<0||r.max>1)||new Set(riskCaps.map(r=>r.id)).size!==riskCaps.length)return fail('波动贡献关注线无效');
 // Saved industry boundaries may outlive the currently loaded mapping; preserve IDs, report unavailable.
 if(!Array.isArray(industryCaps)||industryCaps.length>100||industryCaps.some(r=>typeof r.id!=='string'||typeof r.name!=='string'||!Number.isFinite(r.max)||r.max<0||r.max>1)||new Set(industryCaps.map(r=>r.id)).size!==industryCaps.length)return fail('行业边界无效');
 let lossLimit=null;
 if(raw.lossLimit){const l=raw.lossLimit;if(!['amount','percent'].includes(l.unit)||typeof l.value!=='number'||!Number.isFinite(l.value)||l.value<=0||l.value>(l.unit==='percent'?1:1e15))return fail('损失关注线须大于0，比例不能超过100%');if(l.baseAmount!==null&&l.baseAmount!==undefined&&(!Number.isFinite(l.baseAmount)||l.baseAmount<=0||l.baseAmount>1e15))return fail('关注线基准金额无效');if(l.baseDate&&!isoDate(l.baseDate))return fail('关注线基准日期无效');lossLimit={unit:l.unit,value:l.value,baseAmount:l.baseAmount??null,baseDate:l.baseDate||null};}
 return {valid:true,value:{horizonMonths:horizon,lossLimit,riskCaps:riskCaps.map(r=>({id:r.id,max:r.max})),industryCaps:industryCaps.map(r=>({id:r.id,name:r.name,max:r.max}))}};
}
