"""Publish an audited, immutable snapshot of COMPLETED basics. Never reads holdings jobs."""
import argparse,hashlib,json,re
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[2]

def load(p):return json.loads(p.read_text())
def write(p,d):
    p.parent.mkdir(parents=True,exist_ok=True);temporary=p.with_suffix(p.suffix+'.tmp');temporary.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n');temporary.replace(p)
def shard(code):
    if code.isdigit():return f'{int(code)%100:02d}'
    value=0
    for char in code:value=(value*31+ord(char))%100
    return f'{value:02d}'
def present(v):return v is not None and v!='' and v!=[] and v!={}

def merge_fields(base,curated):
    out=dict(base)
    for k,v in curated.items():
        if not present(v):continue
        out[k]=merge_fields(out[k],v) if isinstance(v,dict) and isinstance(out.get(k),dict) else v
    return out

def build(root=ROOT,package=None):
    root=Path(root);package=Path(package or root/'output/公共数据包-2026-11-24');dist=root/'prototype/dist/data';out=dist/'v10'
    raw=package/'funds/fund-basics.jsonl';before=raw.stat();digest=hashlib.sha256(raw.read_bytes()).hexdigest()
    rows={};fields=Counter()
    for line in raw.open():
        r=json.loads(line);code=r.get('code')
        if not re.fullmatch(r'\d{6}',str(code)) or r.get('status')!='ok' or not r.get('shortName'):raise ValueError('Invalid completed foundation row')
        if code in rows:raise ValueError('Duplicate completed foundation identity')
        rows[code]=r;fields.update(k for k,v in r.items() if present(v))
    after=raw.stat()
    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('Foundation input changed; do not publish an active file')
    l1=load(dist/'v07/funds-l1.json');funds={c:dict(id='fund'+c,kind='fund',code=c,name=n,type=t) for c,n,t in l1}
    if not set(rows)<=set(funds):raise ValueError('Detail code absent from public directory')
    no_detail=load(package/'funds/no-detail.json')['items'];missing={r['code']:r for r in no_detail}
    if set(funds)-set(rows)!=set(missing):raise ValueError('No-detail reconciliation failed')
    curated_f={c['code']:c for c in load(package/'library/fund-cards.json')['cards']}
    curated_s={c['code']:c for c in load(package/'library/stock-cards.json')['cards']}
    stocks=load(package/'stocks/stock-master.json');stocks=stocks.get('stocks',stocks.get('securities',[])) if isinstance(stocks,dict) else stocks
    aliases=[];groups={('fund',f'{i:02d}'):[] for i in range(100)};groups.update({('stock',f'{i:02d}'):[] for i in range(100)})
    field_status={'default':'source-observation-not-individually-verified'}
    for code,identity in sorted(funds.items()):
        r=rows.get(code);card={**identity,'detailStatus':'available' if r else 'source-no-detail','industry':None,'industryBasis':'not-collected','holdingsStatus':'separate-versioned-dataset','sources':[{'id':'em-fund-basics-'+digest[:16],'url':f'https://fund.eastmoney.com/{code}.html','urlRole':'public-entry','retrievedAt':None}], 'fieldStatus':field_status if r else {},'analysisReady':False}
        if r:
            card.update({k:r[k] for k in ['fullName','establishedAt','managerCompany','custodian','managers','benchmarkText','investTarget','riskLevel','type'] if k in r})
            card.update(trackingIndex={'code':r.get('indexCode'),'name':r.get('indexName')},netAssets={'value':r.get('netAssetsValue'),'valueYi':r.get('netAssetsYi'),'asOf':r.get('netAssetsAsOf'),'currency':None},fees={'management':r.get('managementFee'),'custody':r.get('custodyFee'),'service':r.get('serviceFee')})
        else:card['missingReason']=missing[code].get('reason')
        cur=curated_f.get(code)
        if cur:
            card['sourceObservations']={'managerCompany':card.get('managerCompany'),'managers':card.get('managers'),'benchmarkText':card.get('benchmarkText'),'fees':card.get('fees')}
            # Merge only nonempty curated fields. Whole-card replacement previously lost assets/targets.
            card=merge_fields(card,{k:v for k,v in cur.items() if k not in ('kind','objectId','status','sources','keywords')})
            card['curatedSources']=cur.get('sources',[]);card['curatedFieldNames']=sorted(k for k,v in cur.items() if present(v));card['analysisReady']=False
        card['id']='fund'+code;card['kind']='fund'
        groups[('fund',shard(code))].append(card)
        aliases.append(dict(kind='fund',code=code,name=identity['name'],fullName=card.get('fullName'),matchKeywords=list(dict.fromkeys(x for x in [identity['name'],card.get('fullName')] if x))))
    stock_identities=[]
    for s in stocks:
        code=s['code'];identity=dict(id='stock'+code,kind='stock',code=code,name=s['name'],type=s.get('securityType') or '股票')
        stock_identities.append(identity);card={**s,**identity,'detailStatus':'available','analysisReady':False}
        cur=curated_s.get(code)
        if cur:card=merge_fields(card,{k:v for k,v in cur.items() if k not in ('kind','objectId','status')})
        card.update(id=identity['id'],kind='stock');groups[('stock',shard(code))].append(card)
        aliases.append({**{k:s.get(k) for k in ['code','name','fullName','exchange','matchKeywords','reviewKeywords']},'kind':'stock'})
    identities=[*funds.values(),*stock_identities]
    if len({x['id'] for x in identities})!=len(identities):raise ValueError('Duplicate public object identity')
    files={}
    for (kind,key),cards in groups.items():
        name=f'foundation/{kind}s/{key}.json';write(out/name,dict(schemaVersion=1,kind=kind,shard=key,cards=cards));files[name]=dict(count=len(cards),sha256=hashlib.sha256((out/name).read_bytes()).hexdigest(),bytes=(out/name).stat().st_size)
    built=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
    write(out/'objects.json',dict(schemaVersion=1,builtAt=built,objects=identities))
    write(out/'entity-aliases.json',dict(schemaVersion=1,entities=aliases))
    manifest=dict(schemaVersion=1,builtAt=built,funds=len(funds),fundDetails=len(rows),fundNoDetail=len(missing),stocks=len(stock_identities),inputSha256=digest,inputRetrievalDatesKnown=False,fundIndustryPresent=fields.get('industry',0),fieldCoverage=dict(fields),coverageBasis='completed-source-directory; not regulatory-universe-acceptance',files=files,holdingsInterface={'path':'relationships/{fund-code}.json','enabled':False,'schema':'fund-holdings-relations-v1','requires':['fundCode','asOf','complete','source','holdings']})
    write(out/'foundation-manifest.json',manifest)
    return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--package',type=Path);a=p.parse_args();m=build(a.root,a.package);print(json.dumps({k:v for k,v in m.items() if k!='files'},ensure_ascii=False))
