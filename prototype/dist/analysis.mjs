import {validatePersonal} from './boundaries.mjs';
import {exposure} from './core.mjs';

const finite = value => value !== '' && value != null && Number.isFinite(Number(value));
const EPS = 1e-7;
export function portfolioAmount(portfolio, weights) {
  if (portfolio?.mode !== 'amount' || !portfolio.values) return null;
  const entries = Object.entries(weights);
  const values = entries.map(([id]) => Number(portfolio.values[id]));
  const total = values.reduce((a, b) => a + b, 0);
  if (!total || !Number.isFinite(total) || values.some(v => v < 0 || !Number.isFinite(v))) return null;
  return entries.every(([id, w]) => Math.abs(portfolio.values[id] / total * 100 - Number(w)) < EPS) ? total : null;
}

// Only recorded, dated holdings are expanded. A business edge is not an industry weight.
export function analyzePortfolio(catalog, weights, portfolio = null) {
  const result = exposure(catalog.funds, weights);
  if (!result.valid) throw Error(result.reason);
  const total = portfolioAmount(portfolio, weights);
  const byCompany = new Map();
  for (const row of result.rows.filter(r => r.contribution > 0)) {
    const company = byCompany.get(row.entity) || {id: row.entity, share: 0, paths: []};
    company.share += row.contribution;
    company.paths.push(row);
    byCompany.set(row.entity, company);
  }
  const companies = [...byCompany.values()].map(c => ({...c, amount: total === null ? null : total * c.share / 100})).sort((a, b) => b.share - a.share);
  const themes = catalog.nodes.filter(n => n.kind === 'industry' && n.id !== 'energy').map(n => {
    const ids = [...new Set(catalog.edges.filter(e => e.kind === 'business' && e.to === n.id).map(e => e.from))];
    const members = companies.filter(c => ids.includes(c.id));
    return {id: n.id, members, share: members.reduce((sum, c) => sum + c.share, 0)};
  });
  const knownHHI = result.known > EPS ? companies.reduce((sum, c) => sum + (c.share / result.known * 100) ** 2, 0) : null;
  const active=catalog.funds.filter(f=>Number(weights[f.id])>0);
  const completeStockHoldings=active.length>0&&active.every(f=>f.holdingsComplete===true&&f.holdingsAsOf&&f.holdingsAsOf===active[0].holdingsAsOf);
  return {...result, total, companies, themes, knownHHI, weights,completeStockHoldings};
}

export function compareFunds(a, b) {
  if (!a || !b || a.id === b.id) return {status: 'invalid', common: [], observed: null};
  const validate = fund => {
    const seen = new Set();
    let sum = 0;
    for (const h of fund.holdings || []) {
      if (seen.has(h.entity) || !Number.isFinite(h.weight) || h.weight < 0 || h.weight > 100) throw Error('基金持仓记录无效');
      seen.add(h.entity); sum += h.weight;
    }
    if (sum > 100 + EPS) throw Error('基金持仓记录超过100%');
    return sum;
  };
  const knownA = validate(a), knownB = validate(b);
  if (!a.holdings?.length || !b.holdings?.length) return {status: 'missing', common: [], observed: null, knownA, knownB};
  const common = a.holdings.filter(x => b.holdings.some(y => y.entity === x.entity)).map(x => {
    const y = b.holdings.find(y => y.entity === x.entity);
    return {id: x.entity, a: x.weight, b: y.weight, overlap: Math.min(x.weight, y.weight)};
  });
  const observed = common.reduce((sum, row) => sum + row.overlap, 0);
  const dated = Boolean(a.holdingsAsOf && b.holdingsAsOf);
  const sameDate = dated && a.holdingsAsOf === b.holdingsAsOf;
  const complete = sameDate && a.holdingsComplete === true && b.holdingsComplete === true;
  return {status: !sameDate ? 'mixed-date' : complete ? 'complete' : 'partial', common, observed, knownA, knownB};
}

export function validateTarget(target, catalog) {
  if (!target || typeof target !== 'object') return {valid: false, reason: '目标格式无效。'};
  if (!['fund', 'company'].includes(target.kind)) return {valid: false, reason: '请选择基金或企业。'};
  const exists = target.kind === 'fund' ? catalog.funds.some(f => f.id === target.id) : catalog.nodes.some(n => n.id === target.id && n.kind === 'company');
  if (!exists) return {valid: false, reason: '请选择已收录的对象。'};
  if (![target.min, target.max].every(finite)) return {valid: false, reason: '请填写上下限。'};
  const min = Number(target.min), max = Number(target.max);
  if (min < 0 || max > 100 || min > max) return {valid: false, reason: '范围须为0—100%，且下限不能超过上限。'};
  return {valid: true, target: {kind: target.kind, id: target.id, min, max}};
}

export function targetStatus(target, model) {
  const lower = target.kind === 'fund' ? Number(model.weights[target.id] || 0) : model.companies.find(c => c.id === target.id)?.share || 0;
  const upper = target.kind === 'fund' || model.completeStockHoldings ? lower : Math.min(100, lower + model.unknown);
  if (lower > target.max + EPS) return {lower, upper, status: 'over', label: '超过上限', distance: lower - target.max};
  if (upper < target.min - EPS) return {lower, upper, status: 'under', label: '低于下限', distance: target.min - upper};
  if (lower >= target.min - EPS && upper <= target.max + EPS) return {lower, upper, status: 'within', label: '在目标内', distance: 0};
  return {lower, upper, status: 'unknown', label: '资料不足，暂不能判断', distance: null};
}

// A static arithmetic assumption, never a return prediction or total loss bound.
export function scenarioResult(model, scenario, catalog) {
  if (!finite(scenario.total) || Number(scenario.total) <= 0 || Number(scenario.total) > 1e15) return {valid: false, reason: '请填写本次测算的组合总金额（大于0）。'};
  if (!finite(scenario.shock) || Number(scenario.shock) < -100 || Number(scenario.shock) > 100) return {valid: false, reason: '假设涨跌幅须在-100%至100%之间。'};
  let share, partial = false, members = [];
  if (scenario.scope === 'all') share = 100;
  else if (catalog.funds.some(f => f.id === scenario.scope)) share = Number(model.weights[scenario.scope]);
  else if (catalog.nodes.some(n => n.id === scenario.scope && n.kind === 'company')) {
    members = model.companies.filter(c => c.id === scenario.scope);
    share = members.reduce((sum, c) => sum + c.share, 0); partial = model.unknown > EPS;
  } else if (catalog.nodes.some(n => n.id === scenario.scope && n.kind === 'industry' && n.id !== 'energy')) {
    const ids = new Set(catalog.edges.filter(e => e.kind === 'business' && e.to === scenario.scope).map(e => e.from));
    members = model.companies.filter(c => ids.has(c.id));
    if (!members.length) return {valid: false, reason: '该主题没有已录入的企业持仓关联，暂时无法测算。'};
    share = members.reduce((sum, c) => sum + c.share, 0); partial = true;
  } else return {valid: false, reason: '请选择已收录的测算对象。'};
  if (!Number.isFinite(share)) return {valid: false, reason: '对象的组合占比尚未填写。'};
  if (!share) return {valid: false, reason: '当前组合没有该对象的已录入持仓，暂时无法测算。'};
  const total = Number(scenario.total), shock = Number(scenario.shock), affected = total * share / 100;
  return {valid: true, share, affected, delta: affected * shock / 100, portfolioChange: share * shock / 100, total, shock, partial, members: members.map(c => c.id)};
}

export function makeSnapshot(catalog, weights, portfolio, label, now = new Date().toISOString()) {
  return {id: globalThis.crypto?.randomUUID?.() || now, createdAt: now, label: String(label).slice(0, 100),
    weights: Object.fromEntries(catalog.funds.map(f => [f.id, Number(weights[f.id])])),
    portfolio: portfolio ? structuredClone(portfolio) : null,
    recordKind: 'manual', schemaVersion: 2,
    nodeCatalog: catalog.nodes.map(n=>({id:n.id,name:n.name,kind:n.kind,code:n.code||''})),
    businessEdges: catalog.edges.filter(e=>e.kind==='business').map(e=>({...e})),
    funds: catalog.funds.map(f => ({id: f.id, asOf: f.holdingsAsOf || null, source: f.source, holdings: f.holdings.map(h => ({entity: h.entity, weight: h.weight}))}))};
}
export function snapshotSignature(snapshot) {
  return JSON.stringify([snapshot.weights, snapshot.portfolio?.mode, snapshot.portfolio?.values, snapshot.funds, snapshot.businessEdges ?? null, snapshot.analysisState ?? null, snapshot.portfolio?.asOf||null, snapshot.portfolio?.amountType||'current-value']);
}
export function snapshotChanges(before, after) {
  if (!before || !after) return [];
  const changes = [];
  for (const id of new Set([...Object.keys(before.weights), ...Object.keys(after.weights)])) {
    const a = Number(before.weights[id] || 0), b = Number(after.weights[id] || 0);
    if (Math.abs(a - b) > EPS) changes.push({kind: '用户调整', id, before: a, after: b, unit: '%'});
  }
  const aAmount = portfolioAmount(before.portfolio, before.weights), bAmount = portfolioAmount(after.portfolio, after.weights);
  if (aAmount !== bAmount) changes.push({kind: '金额记录', id: 'portfolio', before: aAmount, after: bAmount, unit: '元'});
  for (const next of after.funds) {
    const old = before.funds.find(f => f.id === next.id);
    if (!old) { changes.push({kind: '资料记录补充', id: next.id, text: '新增本地基金记录'}); continue; }
    const dateChanged = old.asOf !== next.asOf;
    const kind = old.asOf && next.asOf && dateChanged ? '披露版本更新' : '资料记录补充';
    if (dateChanged) changes.push({kind, id: next.id, text: `持仓日期：${old.asOf || '未录入'} → ${next.asOf || '未录入'}`});
    const entities = new Set([...old.holdings, ...next.holdings].map(h => h.entity));
    for (const id of entities) {
      const a = old.holdings.find(h => h.entity === id)?.weight, b = next.holdings.find(h => h.entity === id)?.weight;
      if (a !== b) changes.push({kind, id, fund: next.id, text: a === undefined ? `本地记录新增：${b}%` : b === undefined ? `本地记录不再列出（此前${a}%）` : `记录占比：${a}% → ${b}%`});
    }
  }
  return changes;
}

export function validateAnalysisBackup(data, catalog) {
  if (data?.format !== 'zhijian-analysis' || data.version !== 1) throw Error('这不是持仓分析备份。');
  if (!exposure(catalog.funds, data.weights || {}).valid) throw Error('备份的组合比例无效。');
  const targets = data.preferences?.targets;
  if (!Array.isArray(targets) || targets.length > 100 || targets.some(t => !validateTarget(t, catalog).valid)) throw Error('备份的个人目标无效。');
  if (!Array.isArray(data.history) || data.history.length > 1000) throw Error('备份的组合记录无效。');
  const personal=validatePersonal(data.preferences?.personal,catalog);
  if(!personal.valid)throw Error(personal.reason);
  const ids = new Set(catalog.funds.map(f => f.id));
  for (const snapshot of data.history) {
    if (!snapshot || !Number.isFinite(Date.parse(snapshot.createdAt)) || !exposure(catalog.funds, snapshot.weights || {}).valid || !Array.isArray(snapshot.funds) || snapshot.funds.length !== ids.size || new Set(snapshot.funds.map(f => f.id)).size !== ids.size) throw Error('备份中有无效的组合版本。');
    if(snapshot.businessEdges!==undefined&&(!Array.isArray(snapshot.businessEdges)||snapshot.businessEdges.some(e=>!e||e.kind!=='business'||typeof e.from!=='string'||typeof e.to!=='string')))throw Error('版本中的主题关系无效。');
    if(snapshot.nodeCatalog!==undefined&&(!Array.isArray(snapshot.nodeCatalog)||snapshot.nodeCatalog.some(n=>!n||typeof n.id!=='string'||typeof n.name!=='string')))throw Error('版本中的对象名称无效。');
    for (const fund of snapshot.funds) {
      if (!ids.has(fund.id) || !Array.isArray(fund.holdings)) throw Error('备份中有未知基金。');
      compareFunds({...fund, id: 'test-a'}, {...fund, id: 'test-b'});
    }
    if (snapshot.portfolio && snapshot.portfolio.mode !== 'percent' && portfolioAmount(snapshot.portfolio, snapshot.weights) === null) throw Error('版本金额与比例不一致。');
  }
  if (data.portfolio && data.portfolio.mode !== 'percent' && portfolioAmount(data.portfolio, data.weights) === null) throw Error('金额与组合比例不一致。');
  return {weights: data.weights, portfolio: data.portfolio || null, preferences: {targets: targets.map(t => validateTarget(t, catalog).target), scenario: data.preferences?.scenario || {}, personal:personal.value}, history: data.history};
}

// Optional amount affects only monetary output; proportion-only scenarios remain available.
export function optionalScenarioResult(model,scenario,catalog){
 const absent=scenario.total===''||scenario.total===null||scenario.total===undefined;
 const r=scenarioResult(model,{...scenario,total:absent?1:scenario.total},catalog);
 return r.valid&&absent?{...r,total:null,affected:null,delta:null}:r;
}
