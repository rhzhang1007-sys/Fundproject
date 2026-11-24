export const TYPES = {opinion:'观点 / 预测', fact_claim:'具体事实说法', experience:'个人经历', question:'提问', unclear:'语义不明'};
export const SOURCE_TYPES = ['基金披露', '企业资料', '政府资料', '独立行业资料'];

export function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}

export function daysSince(value, today = '2026-10-22') {
  if (!value) return null;
  const start = Date.parse(value.slice(0, 10) + 'T00:00:00Z');
  const end = Date.parse(today.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(start) && Number.isFinite(end) ? Math.floor((end - start) / 86400000) : null;
}

export function exposure(funds, weightValues) {
  const weights = funds.map(f => Number(weightValues[f.id]));
  if (weights.some(w => !Number.isFinite(w) || w < 0 || w > 100) || Math.abs(weights.reduce((a,b)=>a+b,0)-100) > 0.001) {
    return {valid:false, reason:'两只基金的组合比例需合计 100%，且每项在 0—100% 之间。'};
  }
  const rows = [];
  funds.forEach((fund, i) => {
    const seen = new Set();
    for (const holding of fund.holdings) {
      if (seen.has(holding.entity)) throw new Error('同一基金存在重复持仓路径');
      seen.add(holding.entity);
      if (!Number.isFinite(holding.weight) || holding.weight < 0 || holding.weight > 100) throw new Error('持仓比例无效');
      rows.push({...holding, fund:fund.id, fundWeight:weights[i], contribution:weights[i]*holding.weight/100, asOf:fund.holdingsAsOf});
    }
    if (fund.holdings.reduce((sum,h)=>sum+h.weight,0)>100.001) throw new Error('录入持仓比例超过100%');
  });
  const known = rows.reduce((sum,r)=>sum+r.contribution,0);
  return {valid:true, known, unknown:100-known, rows};
}

export function publicClaims(comment) {
  if (!['fact_claim', 'opinion'].includes(comment.type) || comment.decision !== 'keep') return [];
  return (comment.claims || []).filter(c => !/(评论者|我自己|我的账户|本人)/.test(c));
}

export function sourceCoverage(sources) {
  const present = SOURCE_TYPES.filter(t => sources.some(s=>s.type === t));
  return {present, missing:SOURCE_TYPES.filter(t=>!present.includes(t)), ratio:present.length/SOURCE_TYPES.length};
}

const STOP = new Set(['新能源','宁德时代','现在','公司','我们','行业','这个','一个','可以','已经']);
export function tokens(text) {
  const clean = text.toLowerCase().replace(/\s+/g,'');
  const result = new Set((clean.match(/[a-z0-9]+/g)||[]).filter(w=>w.length>1));
  for (const group of clean.match(/[\u4e00-\u9fff]+/g)||[]) {
    for(let i=0;i<group.length-1;i++) { const token=group.slice(i,i+2); if(!STOP.has(token)) result.add(token); }
  }
  return result;
}

// A transparent lexical baseline, NOT an AI verdict or semantic evidence match.
export function retrieve(query, sources, entities = []) {
  const q = tokens(query);
  return sources.map(source => {
    const ts = tokens(source.title + source.summary + source.keywords.join(' '));
    const matches = [...q].filter(t=>ts.has(t));
    const objectMatch = entities.filter(e=>!['energy','fund516160','fund515700'].includes(e)).some(e=>source.entities.includes(e));
    return {source, score:matches.length + (objectMatch ? 2 : 0), matches, objectMatch};
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
}
