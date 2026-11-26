"""Audit real forum coverage, rotate source samples, and retain bounded retry tasks.
No model calls or HTTP. Zero posts is accepted only with a proven list boundary.
"""
import argparse,json,hashlib
from pathlib import Path
from datetime import datetime,timedelta,date
from zoneinfo import ZoneInfo
from build_global_foundation import load,write
from forum_schedule import collection_day
TZ=ZoneInfo('Asia/Shanghai');ROOT=Path(__file__).resolve().parents[2]
DONE={'source-window-complete','daily-cap-reached','window-complete'}

def assess(oid,day,task,forum):
    rows=[r for r in forum.get('records',[]) if r.get('date')==day]
    listed=bool(task.get('coveredFrom','9999')<=day<=task.get('throughDay',''))
    if day in task.get('dayWindows',{}):listed=task['dayWindows'][day] in DONE
    cov=forum.get('listCoverage') or {}
    listed=listed or cov.get('status') in DONE and cov.get('start','9999')<=day<=cov.get('end','') or len(rows)>=30
    body=sum(bool(r.get('content')) and (r.get('coverage') or {}).get('body')=='complete' for r in rows)
    comments=sum((r.get('coverage') or {}).get('comments')=='complete' and ((r.get('coverage') or {}).get('reportedComments') is None or r['coverage']['reportedComments']==len(r.get('comments') or [])) for r in rows)
    status='not-listed' if not listed else 'no-posts-confirmed' if not rows else 'material-pending' if body<len(rows) or comments<len(rows) else 'ready'
    return dict(objectId=oid,date=day,status=status,selectedPosts=len(rows),bodies=body,commentsCompletePosts=comments,stage='list' if not listed else 'material',complete=status in ('ready','no-posts-confirmed'))

def audit(root=ROOT,as_of=None,queue=True,output=None,sample_size=16):
    root=Path(root);dist=root/'prototype/dist/data';now=datetime.now(TZ);day=as_of or collection_day();target=(day-timedelta(days=1)).isoformat();oldest=(day-timedelta(days=3)).isoformat()
    registry=load(dist/'v10/objects.json')['objects'];known={x['id'] for x in registry};state_path=dist/'v10/forum-state.json';state=load(state_path) if state_path.exists() else {'objects':{}}
    # Audit what the website actually receives. Legacy private corpus files can
    # contain pre-cap raw rows and are not a frontend coverage denominator.
    base=dist/'v10/activity';forums={};integrity=[]
    for p in base.glob('*/*.json'):
        try:
            for oid,item in load(p).get('objects',{}).items():
                if oid not in known:integrity.append({'kind':'unknown-object','objectId':oid});continue
                forums[oid]=item.get('forum',{})
        except (ValueError,OSError):integrity.append({'kind':'invalid-shard','file':p.name})
    for p in (dist/'v12/posts').glob('*/*.json'):
        d=load(p);oid=d.get('objectId')
        if oid in known:forums.setdefault(oid,{})['records']=d.get('records',[])
    total_posts=body=comments=0
    for oid,forum in forums.items():
        seen=set();counts={}
        for r in forum.get('records',[]):
            key=(r.get('id'),r.get('date'));date_ok=False
            try:date_ok=date.fromisoformat(r.get('date','')).isoformat()==r.get('date')
            except (TypeError,ValueError):pass
            if r.get('objectId')!=oid or not date_ok or key in seen:integrity.append({'kind':'post-identity-date-or-duplicate','objectId':oid,'postId':r.get('id')})
            seen.add(key);counts[r.get('date')]=counts.get(r.get('date'),0)+1
            if r.get('date')==target:
                total_posts+=1;body+=int(bool(r.get('content')) and (r.get('coverage') or {}).get('body')=='complete');comments+=len(r.get('comments') or [])
        if any(n>30 for n in counts.values()):integrity.append({'kind':'daily-cap','objectId':oid})
    # A rotating stratified sample always includes both kinds when both exist.
    groups=[[x for x in registry if x['kind']==kind] for kind in ('fund','stock')];cursor=state.get('auditCursor',0);sample=[]
    for group in groups:
        for i in range(min(len(group),(sample_size+1)//2)):
            x=group[(cursor+i)%len(group)];sample.append(assess(x['id'],target,state.get('objects',{}).get(x['id'],{}),forums.get(x['id'],{})))
    pending={}
    for item in state.get('retryQueue',[]):
        if item.get('objectId') in known and oldest<=item.get('date','')<=target:
            result=assess(item['objectId'],item['date'],state.get('objects',{}).get(item['objectId'],{}),forums.get(item['objectId'],{}))
            if not result['complete']:pending[(item['objectId'],item['date'])]={**item,'stage':result['stage']}
    candidates=sample[:]
    # Explicit source failures join the sample-driven retries. The ordinary
    # directory cursor still owns broad coverage; this is a bounded repair queue.
    for oid,task in state.get('objects',{}).items():
        if oid in known and task.get('lastError'):candidates.append(assess(oid,target,task,forums.get(oid,{})))
    for result in candidates:
        if result['complete']:continue
        key=(result['objectId'],result['date']);pending.setdefault(key,dict(objectId=key[0],date=key[1],stage=result['stage'],reason=result['status'],attempts=0,nextAttemptAt=now.isoformat(timespec='seconds')))
    retry=sorted(pending.values(),key=lambda x:(x.get('nextAttemptAt',''),x['date'],x['objectId']))[:500]
    all_status=[assess(x['id'],target,state.get('objects',{}).get(x['id'],{}),forums.get(x['id'],{})) for x in registry]
    checked=sum(x['status']!='not-listed' for x in all_status);material_complete=sum(x['complete'] for x in all_status)
    last=state.get('updatedAt');stale=True
    try:stale=(now-datetime.fromisoformat(last)).total_seconds()>7200
    except (TypeError,ValueError):pass
    report=dict(schemaVersion=1,checkedAt=now.isoformat(timespec='seconds'),targetDay=target,status='invalid' if integrity else 'delayed' if stale else 'partial' if material_complete<len(registry) else 'ready',scope=len(registry),listWindowsComplete=checked,materialObjectsComplete=material_complete,unconfirmedObjects=len(registry)-checked,selectedPosts=total_posts,readableCompleteBodies=body,acquiredComments=comments,lastCollectorAt=last,collectorStale=stale,integrityErrors=integrity[:100],integrityErrorCount=len(integrity),sample=sample,sampleComplete=sum(x['complete'] for x in sample),retryQueueSize=len(retry),requiresManualPerObjectCheck=False)
    if queue:
        state['retryQueue']=retry;state['auditCursor']=cursor+(sample_size+1)//2;state['lastAuditAt']=report['checkedAt'];write(state_path,state)
    write(Path(output) if output else dist/'v10/forum-health.json',report);return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--no-queue',action='store_true');p.add_argument('--output',type=Path);a=p.parse_args();r=audit(a.root,queue=not a.no_queue,output=a.output);print(json.dumps({k:v for k,v in r.items() if k not in ('sample','integrityErrors')},ensure_ascii=False));raise SystemExit(2 if r['integrityErrorCount'] else 0)
