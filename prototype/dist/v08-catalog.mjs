export function currentCatalog(portfolio, extra = [], reference = {nodes: [], edges: [], sources: []}) {
  const sourceNodes = reference.nodes || [];
  const companies = new Map();
  const list = [...portfolio.funds, ...extra.filter(x => !portfolio.funds.some(f => f.id === x.id)).map(f => ({...f, holdings: [], disclosure: null}))];
  const funds = list.map(f => ({...structuredClone(f), holdingsAsOf: f.disclosure?.asOf || null, holdingsComplete:f.disclosure?.complete===true,
    source: f.disclosure ? structuredClone(f.disclosure) : null,
    holdings: (f.holdings || []).map(row => {
      const old = sourceNodes.find(n => n.kind === 'company' && n.code === row.code);
      const id = old?.id || 'stock-' + row.code;
      companies.set(id, {...old, id, name: row.name, code: row.code, kind: 'company'});
      return {...row, entity: id};
    })}));
  const themes = sourceNodes.filter(n => n.kind === 'industry' && n.id !== 'energy');
  const business = (reference.edges || []).filter(e => e.kind === 'business' && companies.has(e.from));
  return {...reference, funds, nodes: [{id: 'portfolio', kind: 'portfolio', name: '我的组合'},
    ...funds.map(f => ({id: f.id, name: f.name, code: f.code, kind: 'fund'})), ...companies.values(), ...themes],
    edges: [...funds.map(f => ({from: 'portfolio', to: f.id, kind: 'watch'})),
      ...funds.flatMap(f => f.holdings.map(row => ({from: f.id, to: row.entity, kind: 'holding', weight: row.weight, asOf: f.holdingsAsOf}))), ...business]};
}

