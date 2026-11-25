"""Deterministic v2 factors. Public per-fund output; private portfolios stay in the browser.

A NAV observation is NOT a verified total-return series. Missing adjustment/history
never becomes zero risk. This program does not fetch dividends or fabricate returns.
"""
import argparse,json,math,time,re
from collections import Counter
from datetime import date,datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from build_global_foundation import load,write,shard

ROOT=Path(__file__).resolve().parents[2]
VERSION='factor-v2-2026-11-25'

def number(x):return type(x) in (int,float) and math.isfinite(x)
def weights_ok(weights):
    if not weights or any(not number(x) or x<0 for x in weights) or abs(sum(weights)-1)>1e-8:raise ValueError('Weights must sum to one')

def structure(funds,weights):
    weights_ok(weights)
    if len(funds)!=len(weights):raise ValueError('Holding dimensions differ')
    eligible=lambda f:[p for p in f.get('periods',[]) if p.get('complete') is True or len(p.get('holdings',[]))>=20]
    common=set(p['asOf'] for p in eligible(funds[0]))
    for f in funds[1:]:common&={p['asOf'] for p in eligible(f)}
    if not common:return dict(ready=False,reason='missing-common-detailed-disclosure')
    as_of=max(common);positions={};selected=[]
    for f,w in zip(funds,weights):
        p=next(p for p in eligible(f) if p['asOf']==as_of);selected.append(p);seen=set()
        for r in p['holdings']:
            code=r.get('code');v=r.get('weightPercent')
            if not code or code in seen or not number(v) or not 0<=v<=100:return dict(ready=False,reason='invalid-or-duplicate-position',asOf=as_of)
            seen.add(code);positions[code]=positions.get(code,0)+w*v/100
    positions={c:v for c,v in positions.items() if v>0};coverage=sum(positions.values())
    if coverage<.5:return dict(ready=False,reason='disclosure-coverage-below-50-percent',asOf=as_of,coverage=coverage)
    hhi=sum((v/coverage)**2 for v in positions.values());effective=1/hhi
    return dict(ready=True,asOf=as_of,coverage=coverage,complete=all(p.get('complete') is True for p in selected),nominal=len(positions),effective=effective,hhi=hhi,multiple=len(positions)/effective,top5=sum(sorted(positions.values(),reverse=True)[:5])/coverage,maximumExposure=max(positions.values()),basis='observed-holdings-normalized-within-disclosed-part')

def expected_shortfall(losses,tail=.05):
    if not losses or not 0<tail<1 or any(not number(x) for x in losses):raise ValueError('Invalid tail input')
    mass=len(losses)*tail;left=mass;value=0
    for x in sorted(losses,reverse=True):
        take=min(1,left);value+=take*x;left-=take
        if left<=1e-12:break
    return value/mass

def portfolio_risk(rows,weights):
    weights_ok(weights);n=len(rows);k=len(weights)
    if n<200:return dict(ready=False,reason='fewer-than-200-daily-returns',n=n)
    if any(len(r)!=k or any(not number(x) or x<=-1 for x in r) for r in rows):raise ValueError('Invalid daily returns')
    means=[sum(r[i] for r in rows)/n for i in range(k)]
    cov=[[sum((r[i]-means[i])*(r[j]-means[j]) for r in rows)/(n-1) for j in range(k)] for i in range(k)]
    cw=[sum(cov[i][j]*weights[j] for j in range(k)) for i in range(k)]
    variance=sum(w*x for w,x in zip(weights,cw))
    if variance<=1e-12 or any(cov[i][i]<=1e-12 for i in range(k)):return dict(ready=False,reason='zero-volatility',n=n)
    shares=[w*x/variance for w,x in zip(weights,cw)]
    volatility=math.sqrt(variance*252);reference=sum(w*math.sqrt(cov[i][i]*252) for i,w in enumerate(weights))
    losses=[-sum(w*x for w,x in zip(weights,r)) for r in rows]
    return dict(ready=True,n=n,covariance=cov,annualVol=volatility,riskShares=shares,deviations=[v-w for v,w in zip(shares,weights)],diversificationRatio=reference/volatility,es05=expected_shortfall(losses),worstDay=-max(losses))

def historical_path(rows,weights):
    weights_ok(weights)
    if not rows:return dict(ready=False,reason='no-history')
    if any(len(r['values'])!=len(weights) or (i and r['from']!=rows[i-1]['date']) for i,r in enumerate(rows)):return dict(ready=False,reason='missing-trading-days')
    values=list(weights);peak=1.;peak_day=rows[0]['from'];max_dd=0.;event_peak=peak_day;trough=peak_day;points=[(peak_day,1.)];event_value=1.
    for r in rows:
        if any(not number(v) or v<=-1 for v in r['values']):raise ValueError('Invalid path return')
        values=[v*(1+x) for v,x in zip(values,r['values'])];total=sum(values)
        if total>peak:peak=total;peak_day=r['date']
        dd=1-total/peak
        if dd>max_dd+1e-12:max_dd=dd;event_peak=peak_day;trough=r['date'];event_value=peak
        points.append((r['date'],total))
    recovery=next((d for d,v in points if d>trough and v>=event_value-1e-12),None) if max_dd>1e-12 else points[0][0]
    return dict(ready=True,fromDate=points[0][0],to=points[-1][0],totalReturn=points[-1][1]-1,maxDrawdown=max_dd,peakDate=event_peak,troughDate=trough,recoveryDate=recovery,recoveryDays=(date.fromisoformat(recovery)-date.fromisoformat(trough)).days if recovery else None,rule='initial-weights-buy-and-hold')

def capture_ratios(rows):
    if any(len(r)!=2 or any(not number(x) or x<=-1 for x in r) for r in rows):raise ValueError('Invalid benchmark pairs')
    def one(sign):
        selected=[r for r in rows if sign*r[1]>0]
        if not selected:return None
        b=math.prod(1+r[1] for r in selected)-1
        return (math.prod(1+r[0] for r in selected)-1)/b if abs(b)>1e-12 else None
    return dict(up=one(1),down=one(-1))

def tracking_metrics(rows):
    if len(rows)<2:return dict(ready=False,reason='benchmark-history-missing')
    if any(len(r)!=2 or any(not number(x) or x<=-1 for x in r) for r in rows):raise ValueError('Invalid benchmark pairs')
    differences=[a-b for a,b in rows];mean=sum(differences)/len(rows)
    return dict(ready=True,trackingError=math.sqrt(sum((x-mean)**2 for x in differences)/(len(rows)-1)*252),trackingDifference=math.prod(1+r[0] for r in rows)-math.prod(1+r[1] for r in rows))

def aligned_returns(series,calendar,as_of):
    if series.get('verified') is not True or series.get('basis')!='nav-total-return' or series.get('currency')!='CNY':return [],'verified-total-return-required'
    points=series.get('points',[]);observed={}
    for p in points:
        d=p.get('date');v=p.get('value')
        try:date.fromisoformat(d)
        except (ValueError,TypeError):return [],'invalid-return-date'
        if d in observed or not number(v) or v<=0:return [],'invalid-or-duplicate-return-value'
        if d<=as_of:observed[d]=v
    end=max(observed,default='');cut=as_of
    if end:
        d=date.fromisoformat(end)
        try:cut=d.replace(year=d.year-3).isoformat()
        except ValueError:cut=d.replace(year=d.year-3,day=28).isoformat()
    rows=[]
    if calendar!=sorted(set(calendar)):return [],'invalid-calendar'
    for a,b in zip(calendar,calendar[1:]):
        if b>end or a<cut:continue
        if a in observed and b in observed:rows.append(dict(**{'from':a},date=b,values=[observed[b]/observed[a]-1]))
    return rows,None

def build(root=ROOT,as_of=None):
    started=time.monotonic();root=Path(root);dist=root/'prototype/dist/data';as_of=as_of or (datetime.now(ZoneInfo('Asia/Shanghai')).date()-timedelta(days=1)).isoformat()
    date.fromisoformat(as_of);registry=[o for o in load(dist/'v10/objects.json')['objects'] if o['kind']=='fund']
    analytics=load(dist/'analytics.json');series={s['id']:s for s in analytics.get('series',[])};calendar=load(dist/'v11/market.json').get('calendar',{}).get('dates',[])
    groups={};counts=Counter();cache={};profiles={}
    for obj in registry:
        code=obj['code'];key=shard(code)
        if key not in cache:
            rel=dist/'v11/relationships'/f'{key}.json';obs=dist/'v11/observations'/f'{key}.json'
            cache[key]=(load(rel).get('funds',{}) if rel.exists() else {},load(obs).get('funds',{}) if obs.exists() else {})
            profile_path=dist/'v10/foundation/funds'/f'{key}.json';profiles[key]={p['code']:p for p in load(profile_path).get('cards',[])} if profile_path.exists() else {}
        rels,observations=cache[key];observation=observations.get(code,{})
        snap=observation.get('snapshot');snap=snap if snap and snap.get('date','')<=as_of else None
        # Use the last actual observation not newer than the cutoff, never a future row.
        history=[p for p in observation.get('history',{}).get('points',[]) if p[0]<=as_of]
        if not snap and history:
            p=max(history,key=lambda p:p[0]);snap=dict(code=code,date=p[0],nav=p[1],accNav=p[2] if len(p)>2 else None,dayChange=p[3] if len(p)>3 else None)
        profile=profiles[key].get(code,{})
        row=dict(id=obj['id'],code=code,asOf=as_of,version=VERSION,navObservation=snap,navBasis='unadjusted-source-observation',structure=structure([rels.get(code,{})],[1.]))
        if snap:counts['withNav']+=1;counts['navOnCutoff']+=snap['date']==as_of
        counts['structureReady']+=row['structure']['ready']
        if '货币' in obj.get('type',''):rows,reason=[],'money-market-yield-not-nav'
        else:rows,reason=aligned_returns(series.get(obj['id'],{}),calendar,as_of)
        row['risk']=dict(ready=False,reason=reason) if reason else portfolio_risk([r['values'] for r in rows],[1.])
        p=historical_path(rows,[1.]) if rows else dict(ready=False,reason=reason or 'no-history')
        if p.get('ready') and (date.fromisoformat(p['to'])-date.fromisoformat(p['fromDate'])).days<365:p=dict(ready=False,reason='less-than-one-year-history')
        if p.get('ready'):
            try:old_enough=(date.fromisoformat(p['to'])-date.fromisoformat(profile.get('establishedAt',''))).days>=365
            except (TypeError,ValueError):old_enough=False
            if not old_enough:p=dict(ready=False,reason='inception-missing-or-less-than-one-year')
        fees=[]
        for part in ['management','custody','service']:
            v=profile.get('fees',{}).get(part);v=v.get('annualDecimal') if isinstance(v,dict) and number(v.get('annualDecimal')) else v.get('rawPercentValue')/100 if isinstance(v,dict) and number(v.get('rawPercentValue')) else float(v.strip()[:-1])/100 if isinstance(v,str) and re.fullmatch(r'\s*\d+(?:\.\d+)?\s*%\s*',v) else None;fees.append(v)
        row['cost']=dict(annualFee=sum(fees) if all(number(v) and v>=0 for v in fees) else None,basis='source-fee-fields',feeReturnRatio=None)
        if p.get('ready') and p['totalReturn']>0 and row['cost']['annualFee'] is not None:row['cost']['feeReturnRatio']=row['cost']['annualFee']*(date.fromisoformat(p['to'])-date.fromisoformat(p['fromDate'])).days/365/p['totalReturn']
        def paired(index):
            if not index or not index.get('verified') or index.get('basis') not in ('total-return','price-return'):return []
            benchmark,why=aligned_returns({**index,'basis':'nav-total-return'},calendar,as_of);other={(r['from'],r['date']):r['values'][0] for r in benchmark}
            pairs=[dict(**r,values=[r['values'][0],other[(r['from'],r['date'])]]) for r in rows if (r['from'],r['date']) in other]
            return pairs if len(pairs)>=200 and all(not i or r['from']==pairs[i-1]['date'] for i,r in enumerate(pairs)) else []
        product=next((v for v in analytics.get('products',[]) if v.get('fundId')==obj['id']),{});index=next((v for v in analytics.get('indices',[]) if v.get('id')==product.get('benchmarkId')),None);pairs=paired(index)
        row['tracking']={**tracking_metrics([r['values'] for r in pairs]),'benchmarkId':product.get('benchmarkId'),'benchmarkBasis':index.get('basis') if index else None}
        market_index=next((v for v in analytics.get('indices',[]) if v.get('id')==analytics.get('marketReference')),None);pairs=paired(market_index);row['capture']=dict(ready=bool(pairs),**capture_ratios([r['values'] for r in pairs]),benchmarkBasis=market_index.get('basis') if market_index else None)
        row['pressure']=p;counts['riskReady']+=row['risk']['ready'];counts['pressureReady']+=p['ready']
        groups.setdefault(key,dict(schemaVersion=1,funds={} ))['funds'][code]=row
    for key,payload in groups.items():write(dist/'v12/factors'/f'{key}.json',payload)
    report=dict(schemaVersion=1,version=VERSION,asOf=as_of,funds=len(registry),**dict(counts),seconds=round(time.monotonic()-started,3),dividendsCollected=False,privatePortfolioUploaded=False)
    write(dist/'v12/factor-status.json',report);return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--as-of');a=p.parse_args();print(json.dumps(build(a.root,a.as_of),ensure_ascii=False))
