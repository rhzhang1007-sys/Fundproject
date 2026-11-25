"""Snapshot completed WB records without changing any running collector or raw file."""
import hashlib,json,math
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from build_global_foundation import ROOT,load,write,shard
from import_overnight_data import period_record

def snapshot(path,inputs):
    # Fixed prefix: an appending writer cannot change what this snapshot includes.
    with path.open('rb') as f:
        size=path.stat().st_size;raw=f.read(size)
    if path.suffix=='.jsonl':
        tail=not raw.endswith(b'\n');parts=raw.splitlines()
        if tail and parts:
            try:json.loads(parts[-1])
            except (ValueError,UnicodeDecodeError):parts.pop()
        value=[json.loads(x) for x in parts if x.strip()]
    else:tail=False;value=json.loads(raw)
    inputs[str(path.relative_to(ROOT))]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'partialTail':tail}
    return value

def run(root=ROOT):
    root=Path(root);dist=root/'prototype/dist/data';base=root/'output/公共数据包-2026-11-24';inputs={}
    now=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds');groups={};changed=0
    for p in (dist/'v11/relationships').glob('*.json'):
        groups[p.stem]=load(p)['funds']
    for name in ['holdings-retry.jsonl','holdings-retry-index.jsonl','holdings-retry-all.jsonl','fund-holdings-top100.jsonl']:
        path=base/'funds'/name
        if not path.exists():continue
        for r in snapshot(path,inputs):
            code=r['code'];entry=groups[shard(code)].setdefault(code,{'fundCode':code,'periods':[]})
            by={p['asOf']:p for p in entry['periods']}
            for raw in r.get('periods',[]):
                p=period_record(code,raw,r.get('fetchedAt') or now);old=by.get(p['asOf'])
                if not old or not old.get('verified') and len(p['holdings'])>len(old['holdings']):by[p['asOf']]=p;changed+=1
            entry['periods']=sorted(by.values(),key=lambda p:p['asOf'],reverse=True)
    states=snapshot(base/'funds/holdings-status.json',inputs)
    fof={r['code']:r for r in snapshot(base/'funds/holdings-fof.jsonl',inputs)}
    via=snapshot(base/'funds/holdings-via-etf.json',inputs);via=via.get('items',via)
    if isinstance(via,list):via={r['code']:r for r in via}
    stats=Counter();deep=0
    for key,entries in groups.items():
        extras={}
        rp=dist/f'v11/resources/funds/{key}.json';resources=load(rp)
        for code,entry in entries.items():
            status=states['status'].get(code,{})
            # Actual source rows take precedence over an older status snapshot.
            state='has-stock' if any(p['holdings'] for p in entry['periods']) else status.get('status','source-missing')
            entry['status']=state;entry['sourceTier']='detailed' if any(len(p['holdings'])>=20 for p in entry['periods']) else 'top10'
            stats[state]+=1;deep+=entry['sourceTier']=='detailed'
            item={'status':state,'statusObservedAt':states.get('builtAt'),'note':status.get('note'),'heldFunds':fof.get(code,{}).get('heldFunds',[]),'heldBonds':fof.get(code,{}).get('heldBonds',[]),'fundHoldingsAsOf':None,'fundHoldingsFetchedAt':fof.get(code,{}).get('fetchedAt'),'targetReference':via.get(code)}
            extras[code]=item
            previous=[s for s in resources['objects'].get('fund'+code,[]) if not s['id'].startswith('holdings-') and not s['id'].startswith('fof-')]
            for p in entry['periods']:
                previous.append({'id':f'holdings-{code}-{p["asOf"]}','title':f'{p["asOf"]} 股票持仓明细 · {len(p["holdings"])}只','entities':['fund'+code],'publisher':p['source'],'cadence':'periodic','period':p['asOf'],'publishedAt':p.get('publishedAt'),'retrievedAt':p.get('retrievedAt'),'url':p.get('url'),'contentCoverage':'source-table','holdings':p['holdings'],'complete':p['complete'],'verified':p.get('verified',False)})
            if item['heldFunds']:
                previous.append({'id':'fof-'+code,'title':'持有基金披露观察','entities':['fund'+code],'publisher':'东方财富持仓披露表','cadence':'periodic','period':None,'retrievedAt':item['fundHoldingsFetchedAt'],'url':f'https://fundf10.eastmoney.com/ccmx_{code}.html','contentCoverage':'source-table','summary':'报告日期未提供；以下占比为来源表列值。\n'+'\n'.join(f'{x["fundName"]}（{x["fundCode"]}）：{x["weight"]}%' for x in item['heldFunds'])})
            resources['objects']['fund'+code]=previous
        write(dist/f'v11/relationships/{key}.json',{'schemaVersion':2,'funds':entries})
        write(rp,resources);write(dist/f'v13/funds/{key}.json',{'schemaVersion':1,'builtAt':now,'funds':extras})
    fees=snapshot(base/'market/fee-comparison.json',inputs)
    # Compare known management/custody components. Missing service remains unknown.
    for group in fees['indexes'].values():
        for row in group['items']:
            row['comparableRatePercent']=sum(row[k] for k in ('management','custody')) if all(isinstance(row.get(k),(int,float)) and math.isfinite(row[k]) and row[k]>=0 for k in ('management','custody')) else None
        for key in ['cheapest','mostExpensive','spreadTimes','savePer10kPerYear']:group.pop(key,None)
    fees['comparisonBasis']='management-and-custody-only';write(dist/'v13/fee-comparison.json',fees)
    # Histories may be appending. Only completed, valid observations are imported.
    history_path=root/'output/净值快照/history/nav-history.jsonl';hist=snapshot(history_path,inputs);hg={}
    for r in hist:
        rows=r.get('rows',[]);dates=[p[0] for p in rows]
        if r.get('status')=='ok' and dates==sorted(set(dates)) and all(len(p)>=4 for p in rows):hg[r['code']]=r
    for key in groups:
        p=dist/f'v11/observations/{key}.json';d=load(p)
        for code,r in hg.items():
            if shard(code)!=key:continue
            old=d['funds'].setdefault(code,{}).get('history',{})
            if len(r['rows'])>=len(old.get('points',[])):d['funds'][code]['history']={'status':'ok','points':r['rows'],'basis':'source-nav-observation','totalReturnVerified':False,'retrievedAt':r.get('fetchedAt')}
        write(p,d)
    report={'schemaVersion':1,'builtAt':now,'inputs':inputs,'states':dict(stats),'detailedFunds':deep,'updatedPeriods':changed,'fofWithFunds':sum(bool(r.get('heldFunds')) for r in fof.values()),'historyFunds':len(hg),'feeGroups':len(fees['indexes']),'completeNotInferredFromRowCount':True,'rawInputsModified':False}
    write(dist/'v13/status.json',report);write(root/'output/持仓分析v3与资料交互-2026-11-25/同步结果.json',report)
    return {k:v for k,v in report.items() if k!='inputs'}

if __name__=='__main__':print(json.dumps(run(),ensure_ascii=False))
