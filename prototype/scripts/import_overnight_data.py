"""Read completed local observations and publish versioned, lazy frontend datasets.

No network, collection, private portfolios, or modification of WorkBuddy inputs.
Source row limits and an unverified return basis never confer analysis eligibility.
"""
import hashlib,json,re,statistics
from collections import Counter,defaultdict
from datetime import date,datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from build_global_foundation import ROOT,build,load,write,shard
from public_news import EntityIndex,_event,runtime_entities
from refresh_public_data import merge_events

class FrozenInputs:
    def __init__(self,root):self.root=Path(root);self.inputs={}
    def read(self,relative,lines=False):
        path=self.root/relative;before=path.stat();raw=path.read_bytes();after=path.stat()
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('Input is changing: '+relative)
        self.inputs[relative]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'mtimeNs':after.st_mtime_ns}
        return [json.loads(x) for x in raw.splitlines() if x.strip()] if lines else json.loads(raw)
    def confirm(self):
        for relative,m in self.inputs.items():
            st=(self.root/relative).stat()
            if (st.st_size,st.st_mtime_ns)!=(m['bytes'],m['mtimeNs']):raise ValueError('Input changed before publication: '+relative)

def period_record(fund_code,period,retrieved):
    # Duplicate codes lack category headers. Preserve alternatives; do not guess a sum.
    by=defaultdict(list)
    for row in period['rows']:
        if not re.fullmatch(r'\d{6}',str(row.get('code'))) or not isinstance(row.get('weight'),(int,float)) or not 0<=row['weight']<=100:raise ValueError('Invalid holding observation')
        by[row['code']].append(row)
    rows=[]
    for code,variants in by.items():
        rows.append({'code':code,'name':variants[0]['name'],'weightPercent':variants[0]['weight'] if len(variants)==1 else None,**({'weightStatus':'source-lines-unresolved','sourceWeightVariants':[r['weight'] for r in variants]} if len(variants)>1 else {})})
    return {'fundCode':fund_code,'asOf':period['asOf'],'label':period.get('label'),'complete':False,'verified':False,'denominator':'net-assets-percent-source-observation','source':'东方财富持仓披露表','url':f'https://fundf10.eastmoney.com/ccmx_{fund_code}.html','retrievedAt':retrieved,'publishedAt':None,'rawRowCount':len(period['rows']),'rowLimitMayApply':True,'holdings':rows}

def run(root=ROOT,as_of=None):
    root=Path(root);today=as_of or datetime.now(ZoneInfo('Asia/Shanghai')).date();base='output/公共数据包-2026-11-24/';frozen=FrozenInputs(root)
    holdings=frozen.read(base+'funds/fund-holdings.jsonl',True);tiers=frozen.read(base+'funds/holdings-tier.json');links=frozen.read(base+'funds/link-to-etf.json')
    stocks=frozen.read(base+'stocks/stock-master.json');calendar=frozen.read(base+'market/trade-calendar.json');indices=frozen.read(base+'market/index-series.json')
    nav=frozen.read('output/净值快照/latest.json');history=frozen.read('output/净值快照/history/nav-history.jsonl',True)
    forum=frozen.read('output/股吧回填/forum.jsonl',True);announcements=[];daily={}
    for p in sorted((root/'output/新闻回填/daily').glob('*.jsonl')):
        rows=frozen.read(p.relative_to(root).as_posix(),True);daily[p.stem]=len(rows);announcements+=rows
    fast=frozen.read('output/新闻回填/fast-news.jsonl',True)
    if len({r['code'] for r in holdings})!=len(holdings):raise ValueError('Duplicate fund holdings records')
    dates=calendar['dates']
    if dates!=sorted(set(dates)):raise ValueError('Calendar dates duplicated or unordered')
    frozen.confirm()
    # The completed stock master now includes the overnight BJSE additions.
    build(root)
    dist=root/'prototype/dist/data';out=dist/'v11';registry=load(dist/'v10/objects.json');known={r['id'] for r in registry['objects']}
    groups={f'{i:02d}':{} for i in range(100)};resources={k:{f'{i:02d}':{} for i in range(100)} for k in ['fund','stock']};unknown={};duplicate_periods=[]
    for record in holdings:
        code=record['code'];periods=[]
        for p in record.get('periods',[]):
            date.fromisoformat(p['asOf']);period=period_record(code,p,record.get('fetchedAt'));periods.append(period)
            if len(period['holdings'])!=period['rawRowCount']:duplicate_periods.append({'code':code,'asOf':p['asOf'],'rawRows':period['rawRowCount'],'uniqueSecurities':len(period['holdings'])})
            for row in period['holdings']:
                if 'stock'+row['code'] not in known:unknown.setdefault(row['code'],row['name'])
        periods.sort(key=lambda p:p['asOf'],reverse=True)
        groups[shard(code)][code]={'fundCode':code,'status':record['status'],'sourceTier':tiers['tier'].get(code),'periods':periods}
    # Keep the existing individually verified report as a separate dated snapshot.
    for fund in load(dist/'v07/portfolio.json')['funds']:
        source=fund.get('disclosure') or {}
        if not source.get('verified'):continue
        code=fund['code'];entry=groups[shard(code)][code]
        original={**source,'fundCode':code,'holdings':[{'code':r['code'],'name':r['name'],'weightPercent':r['weight']} for r in fund['holdings']]}
        entry['periods']=[p for p in entry['periods'] if p['asOf']!=source['asOf']]+[original];entry['periods'].sort(key=lambda x:x['asOf'],reverse=True)
    for code,name in unknown.items():
        identity={'id':'stock'+code,'kind':'stock','code':code,'name':name,'type':'持仓来源证券'};registry['objects'].append(identity);known.add(identity['id'])
        path=dist/f'v10/foundation/stocks/{shard(code)}.json';data=load(path);data['cards'].append({**identity,'detailStatus':'holdings-reference-only','exchange':None,'analysisReady':False,'sources':[]});write(path,data)
    write(dist/'v10/objects.json',registry)
    for key,records in groups.items():
        write(out/f'relationships/{key}.json',{'schemaVersion':2,'funds':records})
        for code,entry in records.items():
            sources=[]
            for p in entry['periods']:
                sources.append({'id':f'holdings-{code}-{p["asOf"]}','title':f'{p["asOf"]} 股票持仓明细 · {len(p["holdings"])}只','entities':['fund'+code],'publisher':p['source'],'cadence':'periodic','period':p['asOf'],'publishedAt':p.get('publishedAt'),'retrievedAt':p.get('retrievedAt'),'url':p['url'],'contentCoverage':'source-table','holdings':p['holdings'],'complete':p['complete'],'verified':p.get('verified',False)})
            resources['fund'][key]['fund'+code]=sources
    observations={f'{i:02d}':{} for i in range(100)}
    for r in nav['funds']:observations[shard(r['code'])].setdefault(r['code'],{})['snapshot']=r
    nav_issues=[];calendar_set=set(dates)
    for r in history:
        rows=r.get('rows',[]);ds=[p[0] for p in rows]
        if len(set(ds))!=len(ds) or ds!=sorted(ds):nav_issues.append({'code':r['code'],'issue':'duplicate-or-unordered-dates'});continue
        observations[shard(r['code'])].setdefault(r['code'],{})['history']={'status':r['status'],'points':rows,'basis':'source-nav-observation','totalReturnVerified':False,'retrievedAt':r.get('fetchedAt'),'offCalendarDates':sum(d not in calendar_set for d in ds)}
    linkmap={r['code']:r for r in links['items']}
    for key,values in observations.items():
        for code,value in values.items():
            source={'id':'nav-'+code,'title':'基金净值观察','entities':['fund'+code],'publisher':'东方财富净值接口','cadence':'profile','url':f'https://fundf10.eastmoney.com/jjjz_{code}.html','contentCoverage':'source-values','publishedAt':None,'period':value.get('snapshot',{}).get('date'),'navObservation':value}
            resources['fund'][key].setdefault('fund'+code,[]).append(source)
        write(out/f'observations/{key}.json',{'schemaVersion':1,'funds':values})
    write(out/'link-to-etf.json',{'schemaVersion':1,'basis':'inferred-from-manager-index-name','items':linkmap})
    write(out/'market.json',{'schemaVersion':1,'calendar':calendar,'indices':indices,'returnsVerified':False})
    # The existing role-aware matcher preserves conflicts rather than inferring identities.
    index=EntityIndex(runtime_entities(root));incoming=[];bad_events=[]
    for row in [*announcements,*fast]:
        if row['date']>today.isoformat():bad_events.append({'id':row['id'],'reason':'future-date'});continue
        code=str(row.get('entityCode') or '');name=row.get('entityName') or '';explicit=[]
        if code:
            candidates=[k for k in index.codes.get(code,[]) if index.entities[k].get('name')==name or name in (index.entities[k].get('matchKeywords') or [])]
            if len(candidates)==1:explicit=candidates
            elif ('stock',code) in index.entities:explicit=[('stock',code)]
            elif ('fund',code) in index.entities:explicit=[('fund',code)]
        is_fast=row['kind']=='快讯';identifier=('fast:' if is_fast else 'cninfo:')+str(row['id']);url=row.get('url') or f'https://finance.eastmoney.com/a/{row["id"]}.html'
        event=_event(identifier,row['title'],'',row['date'],url,row['source'],'资讯' if is_fast else '公告',index,explicit)
        # Backfill fast-news records store their feed text in title, not a PDF body.
        if is_fast:
            m=re.match(r'^【([^】]+)】(.*)',event['title'])
            if m:event['title']=m[1];event['summary']=m[2].strip()
            event['contentCoverage']='source-feed';event['summaryBasis']='source-excerpt';event['urlRole']='source-id-route' if not row.get('url') else 'article'
        incoming.append(event)
    previous=load(dist/'v07/events.json');events,_=merge_events(previous.get('events',[]),incoming,today,30)
    previous.update(events=events,lastCheckedAt=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'));write(dist/'v07/events.json',previous)
    for e in events:
        if e['kind']!='公告':continue
        for t in e.get('entities',[]):
            oid=t['kind']+t['code']
            if oid not in known or t['kind'] not in resources:continue
            sources=resources[t['kind']][shard(t['code'])].setdefault(oid,[])
            sources.append({'id':'document-'+e['id'],'title':e['title'],'entities':[oid],'publisher':e['source'],'kind':'disclosure','cadence':'periodic' if re.search('年报|年度报告|中期报告|季度报告',e['title']) else 'news','publishedAt':e['date'],'url':e['url'],'contentCoverage':'link-only','summary':''})
    for kind,shards in resources.items():
        for key,objects in shards.items():write(out/f'resources/{kind}s/{key}.json',{'schemaVersion':1,'objects':objects})
    seed=[]
    for obj in forum:
        for r in obj.get('rows',[]):
            if 'fund'!=obj['kind'] and 'stock'!=obj['kind']:continue
            seed.append({**{k:r.get(k) for k in ['objectId','title','date','readCount','commentCount','source','url']},'id':str(r['id']),'coverage':{'body':'not-read','comments':'not-read'},'body':'','listCoverage':'backfill-title-sample'})
    write(out/'forum-seed.json',{'schemaVersion':1,'records':seed,'metrics':[],'claims':[]})
    manifest=load(dist/'v10/foundation-manifest.json');manifest.update(stocks=len([x for x in registry['objects'] if x['kind']=='stock']),holdingsInterface={'enabled':True,'schema':'fund-holdings-relations-v2','path':'../v11/relationships/{shard}.json','completeFromRowCount':False})
    # Re-hash stock shards changed by newly referenced, still unidentified securities.
    for filename,record in manifest['files'].items():
        p=dist/'v10'/filename;record.update(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
    write(dist/'v10/foundation-manifest.json',manifest)
    from publish_object_activity import publish
    publish(root,today)
    snapshot_dates=Counter(r['date'] for r in nav['funds']);statuses=Counter(r['status'] for r in holdings)
    report={'builtAt':datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),'inputs':frozen.inputs,'holdings':{'records':len(holdings),'status':dict(statuses),'sourceTierCounts':tiers['counts'],'duplicateSecurityPeriods':duplicate_periods,'completeNotInferredFromTier':True,'additionalSecurityIdentities':len(unknown)},'stocks':{'records':len(stocks['stocks']),'withFullName':sum(bool(r.get('fullName')) for r in stocks['stocks'])},'calendar':{'count':len(dates),'from':dates[0],'to':dates[-1],'byYear':calendar.get('byYear')},'indices':{'resolved':indices['resolved'],'missing':indices['missing']},'nav':{'snapshotRecords':len(nav['funds']),'snapshotStatus':nav['status'],'snapshotDates':dict(snapshot_dates),'historyRecords':len(history),'historyStatus':dict(Counter(r['status'] for r in history)),'medianHistoryPoints':statistics.median(len(r.get('rows',[])) for r in history if r['status']=='ok'),'issues':nav_issues,'totalReturnVerified':False},'announcements':{'rawRecords':len(announcements),'dates':daily,'rawManifestNotUsedAsCount':True},'fastNews':len(fast),'eventsPublished':len(events),'eventsRejected':bad_events,'forum':{'objects':len(forum),'titleRecords':len(seed),'bodiesRead':0,'commentsRead':0},'linkMap':links['stats'],'newCollection':False}
    write(root/'output/昨夜数据验收与网页接入-2026-11-25/逐项验收结果.json',report);write(out/'manifest.json',{k:v for k,v in report.items() if k!='inputs'})
    return {k:v for k,v in report.items() if k in ['holdings','stocks','eventsPublished','fastNews','forum']}

if __name__=='__main__':print(json.dumps(run(),ensure_ascii=False))
