"""Join public news/forum references to every known identity, without a holding dependency."""
from datetime import datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import json
from refresh_public_data import public_event_allowed
from build_global_foundation import load,write,shard

def publish(root,as_of=None,forum_target=None):
    root=Path(root);dist=root/'prototype/dist/data';today=as_of or datetime.now(ZoneInfo('Asia/Shanghai')).date();start=(today-timedelta(days=29)).isoformat();end=today.isoformat();target=forum_target or (today-timedelta(days=1)).isoformat()
    registry=load(dist/'v10/objects.json')['objects'];known={x['id'] for x in registry};groups={}
    for kind in ['fund','stock']:
        for i in range(100):
            name=f'{kind}s/{i:02d}.json';path=root/'prototype/.public-corpus/activity'/name;public_path=dist/'v10/activity'/name;data=load(path) if path.exists() else load(public_path) if public_path.exists() else dict(schemaVersion=1,objects={})
            for oid,value in list(data['objects'].items()):
                if oid not in known:raise ValueError('Unknown stored object identity')
                value['news']=[];forum=value.setdefault('forum',{})
                for field in ['records','metrics','claims']:forum[field]=[r for r in forum.get(field,[]) if start<=r.get('date','')<=end]
            groups[name]=data
    from news_llm_queue import material_sha
    analysis_path=dist/'v10/news-analysis.json';analysis=load(analysis_path).get('records',{}) if analysis_path.exists() else {}
    orphan=set();news_source=load(dist/'v07/events.json');events=news_source.get('events',[])
    for event in events:
        if not start<=event['date']<=end:continue
        organized=analysis.get(event['id']);event=dict(event)
        if organized and organized.get('materialSha')==material_sha(event):event['analysis']=organized
        for entity in event.get('entities') or []:
            oid=entity.get('kind','')+entity.get('code','')
            if oid not in known:
                if entity.get('kind') not in ('market','unassigned'):orphan.add(oid)
                continue
            key=f"{entity['kind']}s/{shard(entity['code'])}.json";entry=groups[key]['objects'].setdefault(oid,{'news':[],'forum':{}})
            if not any(x['id']==event['id'] for x in entry['news']):entry['news'].append(event)
    # One-time migration preserves earlier public posts; new readers write directly to shards.
    legacy=dist/'v08/forum.json'
    seed=dist/'v11/forum-seed.json'
    for source in [p for p in [legacy,seed] if p.exists()]:
        old=load(source)
        if source==seed:
            old['records']=[r for r in old.get('records',[]) if start<=r.get('date','')<=end]
            write(seed,old)
        for field in ['records','metrics','claims']:
            for row in old.get(field,[]):
                oid=row['objectId']
                if oid not in known or not start<=row.get('date','')<=end:continue
                kind='fund' if oid.startswith('fund') else 'stock';key=f'{kind}s/{shard(oid[len(kind):])}.json';entry=groups[key]['objects'].setdefault(oid,{'news':[],'forum':{}})['forum'];items=entry.setdefault(field,[])
                identity=(lambda x:x.get('url') or x.get('id')) if field=='records' else (lambda x:x.get('date'))
                if not any(identity(x)==identity(row) for x in items):items.append(row)
    active_post_paths=set()
    # Seed newly reviewed public source material after restoring an older private cache.
    # This avoids a resumable cloud run erasing body/comment samples already delivered.
    for path in (dist/'v12/posts').glob('*/*.json'):
        data=load(path);oid=data.get('objectId')
        if oid not in known:continue
        kind='fund' if oid.startswith('fund') else 'stock';key=f'{kind}s/{shard(oid[len(kind):])}.json'
        entry=groups[key]['objects'].setdefault(oid,dict(news=[],forum={}))['forum'];rows={r['id']:r for r in entry.get('records',[])}
        for row in data.get('records',[]):
            if row.get('objectId')!=oid or not start<=row.get('date','')<=target:continue
            old=rows.get(row['id'])
            if not old:rows[row['id']]=row
            elif row.get('content') and not old.get('content'):
                old['content']=row['content'];old['comments']=row.get('comments',[]);old['coverage']=row.get('coverage') or {}
        entry['records']=list(rows.values())
    for key,value in groups.items():
        write(root/'prototype/.public-corpus/activity'/key,value)
        public=dict(schemaVersion=1,objects={})
        for oid,entry in value['objects'].items():
            forum=entry.get('forum',{})
            # Source material is useful independently of any generated opinions.
            by_day={}
            for r in forum.get('records',[]):by_day.setdefault(r['date'],[]).append(r)
            forum['records']=[r for rows in by_day.values() for r in sorted(rows,key=lambda r:(r.get('publishedAt') or r['date'],r['id']),reverse=True)[:30]]
            records=[]
            for row in sorted((r for r in forum.get('records',[]) if r['date']<=target),key=lambda r:(r['date'],r.get('publishedAt') or '',r['id']),reverse=True)[:900]:
                item={k:row.get(k) for k in ['id','objectId','title','url','date','publishedAt','source','readCount','commentCount','content','coverage','boardVerified','nativeBoard']}
                item['comments']=[{k:c.get(k) for k in ['id','text','at','replyTo']} for c in row.get('comments',[])]
                records.append(item)
            kind='fund' if oid.startswith('fund') else 'stock';code=oid[len(kind):]
            post_path=f'v12/posts/{kind}s/{code}.json'
            if records:
                active_post_paths.add(dist/post_path)
                write(dist/post_path,dict(schemaVersion=1,objectId=oid,records=records))
            metadata=[{k:v for k,v in r.items() if k not in ('content','comments')} for r in records]
            metrics=sorted(forum.get('metrics',[]),key=lambda x:x['date'])[-1:]
            public['objects'][oid]=dict(news=[e for e in entry.get('news',[]) if public_event_allowed(e)],forum=dict(records=metadata,materialPath=post_path,claims=[],metrics=metrics,listCoverage=forum.get('listCoverage'),storedPostCount=len(forum.get('records',[]))))
        write(root/'prototype/.public-corpus/activity'/key,value)
        write(dist/'v10/activity'/key,public)
    # Retired rolling-window files carry no forever-public copies of old comments.
    for old in (dist/'v12/posts').glob('*/*.json'):
        if old not in active_post_paths:old.unlink()
    state_path=dist/'v10/forum-state.json';state=load(state_path) if state_path.exists() else {};states=state.get('objects',{});target=forum_target or (today-timedelta(days=1)).isoformat();complete=sum(x.get('throughDay','')>=target for x in states.values())
    selected=[r for g in groups.values() for v in g['objects'].values() for r in v.get('forum',{}).get('records',[]) if r['date']==target]
    bodies=sum(r.get('coverage',{}).get('body')=='complete' for r in selected);comments=sum(r.get('coverage',{}).get('comments')=='complete' for r in selected)
    coverage=dict(schemaVersion=1,scope={'funds':sum(x['kind']=='fund' for x in registry),'stocks':sum(x['kind']=='stock' for x in registry),'allDirectoryIdentitiesQueued':True,'basis':'known-source-directory; not confirmed regulatory universe'},asOf=end,forum={'targetDay':target,'listedThroughTarget':complete,'pending':len(registry)-complete,'allComplete':complete==len(registry),'allMaterialComplete':complete==len(registry) and bodies==len(selected) and comments==len(selected),'selectedPostsOnTarget':len(selected),'bodiesCompleteOnTarget':bodies,'commentsCompleteOnTarget':comments,'objectsWithStoredPosts':sum(bool(v.get('forum',{}).get('records')) for g in groups.values() for v in g['objects'].values()),'scheduledOpinionAggregation':False,'postLimitPerObjectPerDay':30,'commentsMayBePartial':True},news={'retentionDays':30,'lastCheckedAt':news_source.get('lastCheckedAt') or news_source.get('builtAt'),'records':sum(start<=e['date']<=end for e in events),'unassignedRecords':sum(any(t.get('kind')=='unassigned' for t in e.get('entities',[])) for e in events),'unresolvedIdentities':sorted(orphan)},publicLibrary={'identityShells':len(registry),'fundDetailRecords':load(dist/'v10/foundation-manifest.json')['fundDetails'],'fullTextCoverage':'partial; never implied by identity shells'})
    write(dist/'v10/coverage.json',coverage);return coverage

if __name__=='__main__':print(json.dumps(publish(Path(__file__).resolve().parents[2]),ensure_ascii=False))
