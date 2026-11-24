"""Resumable forum queue for EVERY directory identity. No portfolio or fixed whitelist.

Coverage is evidence, not a promise: queued/listed/body/comment/model states are separate.
A refused source cools down globally; pagination and budget never turn unknown into zero.
"""
import argparse,json,time,hashlib
from itertools import zip_longest
from collections import defaultdict
from datetime import datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import refresh_public_data as u
from build_global_foundation import load,write,shard
from public_transport import CurlPublicFetcher
from publish_object_activity import publish
from public_comments import read_comments

ROOT=Path(__file__).resolve().parents[2]

def run(root=ROOT,config=None,fetch=None,as_of=None,deadline=None):
    root=Path(root);dist=root/'prototype/dist/data';config=config or load(root/'prototype/config/public-updates.json')
    if config.get('enabled') is not True or config.get('forumDaily',{}).get('enabled') is not True:return dict(status='disabled',networkRequests=0)
    day=as_of or datetime.now(ZoneInfo('Asia/Shanghai')).date();target=(day-timedelta(days=1)).isoformat();window=(day-timedelta(days=29)).isoformat();now=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
    identities=load(dist/'v10/objects.json')['objects']
    funds=[x for x in identities if x['kind']=='fund'];stocks=[x for x in identities if x['kind']=='stock']
    registry=[x for pair in zip_longest(funds,stocks) for x in pair if x is not None];settings=config.get('forumDaily',{})
    pointer=dist/'v10/corpus-pointer.json';marker=root/'prototype/.public-corpus/checkpoint.json'
    if pointer.exists() and (not marker.exists() or load(marker).get('sha256')!=load(pointer).get('sha256')):raise ValueError('Restore the private corpus checkpoint before resuming')
    state_path=dist/'v10/forum-state.json';state=load(state_path) if state_path.exists() else dict(schemaVersion=1,cursor=0,detailCursor=0,objects={})
    if state.get('cooldownUntil','')>now:return dict(status='source-cooldown',scope=len(registry),cooldownUntil=state['cooldownUntil'])
    deadline=deadline or time.monotonic()+int(settings.get('batchSeconds',900))
    fetch=fetch or CurlPublicFetcher(config.get('requestIntervalSeconds',1),deadline=deadline)
    u.LLM_DEADLINE=deadline;u.MODEL_CIRCUIT_ERROR=None;u.LLM_LIVE_BILLING=True
    # Billing follows the real call date, not an old observation/backfill date.
    billing=datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat();u.init_llm(dist/'v08/llm-usage'/f'{billing}.json',billing)
    shards={};dirty=set();errors=[];listed=0;pages=0;visited=0;enriched=0
    def activity(obj):
        key=f"{obj['kind']}s/{shard(obj['code'])}.json"
        if key not in shards:
            path=root/'prototype/.public-corpus/activity'/key
            legacy_path=dist/'v10/activity'/key
            shards[key]=load(path) if path.exists() else load(legacy_path) if legacy_path.exists() else dict(schemaVersion=1,objects={})
        dirty.add(key);entry=shards[key]['objects'].setdefault(obj['id'],dict(news=[],forum={}))
        forum=entry.setdefault('forum',{})
        for field in ['records','metrics','claims']:forum[field]=[r for r in forum.get(field,[]) if window<=r.get('date','')<=day.isoformat()]
        return forum
    def checkpoint():
        for key in dirty:write(root/'prototype/.public-corpus/activity'/key,shards[key])
        dirty.clear();write(state_path,state)
    def refusal():
        state['cooldownUntil']=(datetime.now(ZoneInfo('Asia/Shanghai'))+timedelta(hours=24)).isoformat(timespec='seconds');state['lastError']='source-refused'
    remaining=max(1,deadline-time.monotonic());list_deadline=min(deadline-min(60,remaining/4),time.monotonic()+int(settings.get('listBatchSeconds',600)))
    try:
        while visited<min(len(registry),int(settings.get('maxVisitsPerBatch',len(registry)))) and time.monotonic()<list_deadline:
            i=state['cursor']%len(registry);obj=registry[i];state['cursor']=(i+1)%len(registry);visited+=1
            oid=obj['id'];task=state['objects'].setdefault(oid,{})
            if task.get('throughDay','')>=target or task.get('retryAfter','')>now:continue
            forum=activity(obj);code=('of' if obj['kind']=='fund' else '')+obj['code']
            if not task.get('scan') or task['scan']['from']<window:
                start=max(window,(datetime.strptime(task['throughDay'],'%Y-%m-%d').date()+timedelta(days=1)).isoformat() if task.get('throughDay') else window)
                task['scan']=dict(page=1,**{'from':start,'to':target},lastDate=None,lastSignature=None)
            scan=task['scan'];posts={r['id']:r for r in forum['records']}
            try:
                for _ in range(int(settings.get('pagesPerVisit',3))):
                    if time.monotonic()>=list_deadline:break
                    raw=u._forum_payload(fetch,code,scan['page']);pages+=1
                    signature=hashlib.sha256(','.join(str(x.get('post_id')) for x in raw).encode()).hexdigest()
                    if raw and signature==scan.get('lastSignature'):raise ValueError('Repeated forum source page')
                    dates=[];ordered=True;last=scan.get('lastDate')
                    for x in raw:
                        if x.get('post_top_status') in (None,0):
                            date=str(x.get('post_publish_time',''))[:10];datetime.strptime(date,'%Y-%m-%d')
                            if last and date>last:ordered=False
                            last=date;dates.append(date)
                        row=u._forum_row(x,code,day.isoformat())
                        if scan['from']<=row['date']<=scan['to']:
                            old=posts.get(row['id'],{});combined={**old,**row}
                            if old.get('commentCount')!=row.get('commentCount') and combined.get('coverage'):
                                combined['coverage']={**combined['coverage'],'comments':'partial'}
                                combined.pop('commentCursor',None)
                            posts[row['id']]=combined
                    if not ordered:raise ValueError('Forum publication order changed; boundary unproven')
                    scan.update(lastDate=last,lastSignature=signature,page=scan['page']+1)
                    forum['records']=list(posts.values());forum['listCoverage']=dict(status='pending-pages',start=scan['from'],end=scan['to'],nextPage=scan['page'],checkedAt=now)
                    if not raw or dates and dates[-1]<scan['from']:
                        task['throughDay']=scan['to'];task['coveredFrom']=min(task.get('coveredFrom',scan['from']),scan['from']);task.pop('retryAfter',None)
                        forum['listCoverage'].update(status='source-window-complete');by_day=defaultdict(list)
                        for row in posts.values():
                            if scan['from']<=row['date']<=scan['to']:by_day[row['date']].append(row)
                        metrics={x['date']:x for x in forum['metrics']}
                        metric_day=datetime.strptime(scan['from'],'%Y-%m-%d').date()
                        while metric_day.isoformat()<=scan['to']:
                            date=metric_day.isoformat();rows=by_day.get(date,[])
                            history=sorted([x for x in metrics.values() if x['date']<date and x.get('coverage')=='publication-boundary'],key=lambda x:x['date'])[-20:]
                            z=None
                            if len(history)==20:
                                mean=sum(x['sampledPosts'] for x in history)/20;sd=(sum((x['sampledPosts']-mean)**2 for x in history)/20)**.5
                                if sd:z=(len(rows)-mean)/sd
                            metrics[date]=dict(objectId=oid,date=date,sampledPosts=len(rows),readCount=sum(x['readCount'] for x in rows) if all(type(x.get('readCount')) is int for x in rows) else None,commentCount=sum(x['commentCount'] for x in rows) if all(type(x.get('commentCount')) is int for x in rows) else None,coverage='publication-boundary',zScore=z,countBasis='publication-day-posts; observed cumulative engagement')
                            metric_day+=timedelta(days=1)
                        forum['metrics']=list(metrics.values());task.pop('scan');listed+=1;break
            except u.SourceRefused:refusal();raise
            except TimeoutError:raise
            except (ValueError,RuntimeError,OSError) as exc:
                task['lastError']=str(exc)[:160];task['retryAfter']=(datetime.now(ZoneInfo('Asia/Shanghai'))+timedelta(hours=2)).isoformat(timespec='seconds');errors.append(dict(objectId=oid,stage='list',reason=task['lastError']))
                # A changed ordering cannot continue from a false boundary on the next run.
                if 'order changed' in str(exc):task.pop('scan',None)
            if visited%10==0:checkpoint()
        checkpoint()
        from news_llm_queue import run as run_news_llm
        news_model_status=run_news_llm(root,config)
        candidates=[obj for obj in registry if obj['id'] in state['objects'] and state['objects'][obj['id']].get('throughDay')]
        cache_path=dist/'v08/llm-cache.json';cache=u.load(cache_path,{})
        for _ in range(min(len(candidates),int(settings.get('detailObjectsPerBatch',30)))):
            if time.monotonic()>deadline-35 or not candidates:break
            i=state['detailCursor']%len(candidates);state['detailCursor']=(i+1)%len(candidates);obj=candidates[i];forum=activity(obj);oid=obj['id'];code=('of' if obj['kind']=='fund' else '')+obj['code']
            by_day=defaultdict(list);visit_details=0
            for row in forum['records']:by_day[row['date']].append(row)
            for date,rows in sorted(by_day.items()):
                if date>state['objects'][oid]['throughDay'] or len(rows)<=int(config.get('minPostsForClaims',5)):continue
                done=0
                for row in rows:
                    if row.get('coverage',{}).get('body')=='complete':continue
                    if visit_details>=int(settings.get('detailsPerVisit',5)) or time.monotonic()>deadline-35:break
                    try:
                        row.update(u.detail_record(fetch(row['url']),row.get('commentCount'),max_chars=500000));done+=1;visit_details+=1;enriched+=1
                    except u.SourceRefused:refusal();raise
                    except TimeoutError:raise
                    except (ValueError,RuntimeError,OSError) as exc:errors.append(dict(objectId=oid,stage='body',reason=str(exc)[:160]));break
                for row in rows:
                    if time.monotonic()>deadline-35:break
                    if row.get('coverage',{}).get('body')=='complete' and row.get('coverage',{}).get('comments')!='complete':
                        read_comments(fetch,row,int(settings.get('commentPagesPerVisit',3)))
                # A partial body is kept but never passed off as having read the complete corpus.
                if any(x.get('coverage',{}).get('body')!='complete' for x in rows):continue
                claims,why=u.cluster_forum(obj['name'],date,rows,cache,int(config.get('minPostsForClaims',5)))
                block=dict(objectId=oid,date=date,claims=claims,status=why,postCount=len(rows),commentsComplete=all(x.get('coverage',{}).get('comments')=='complete' for x in rows),basis='provided-posts-and-available-comments',promptVersion=u.PROMPT_VERSION)
                forum['claims']=[x for x in forum['claims'] if x['date']!=date]+[block]
                write(cache_path,cache);checkpoint()
                if u.LLM_STATE.get('stoppedByBudget') or u.MODEL_CIRCUIT_ERROR:break
            if u.LLM_STATE.get('stoppedByBudget') or u.MODEL_CIRCUIT_ERROR:break
    except u.SourceRefused:errors.append(dict(stage='public-source',reason='source-refused; global 24-hour cooldown'))
    except TimeoutError:errors.append(dict(stage='batch',reason='time-budget; remaining work retained'))
    finally:
        state['updatedAt']=now;checkpoint();u.persist_usage();write(dist/'v08/llm-usage.json',u.LLM_STATE);u.LLM_LIVE_BILLING=False
    coverage=publish(root,day)
    result=dict(schemaVersion=1,status='partial' if coverage['forum']['pending'] or errors else 'success',scope=len(registry),visited=visited,sourcePages=pages,completedWindows=listed,enrichedPosts=enriched,coverage=coverage['forum'],errors=errors,newsModel=locals().get('news_model_status',{'status':'pending'}),modelCircuit=u.MODEL_CIRCUIT_ERROR,networkRequests=getattr(fetch,'calls',None))
    write(dist/'v10/forum-batch-status.json',result);return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--collect',action='store_true');p.add_argument('--root',type=Path,default=ROOT);a=p.parse_args()
    if a.collect:print(json.dumps(run(a.root),ensure_ascii=False))
    else:
        rows=load(a.root/'prototype/dist/data/v10/objects.json')['objects'];print(json.dumps(dict(mode='offline-preflight',scope=len(rows),fixedWhitelist=False,networkUsed=False),ensure_ascii=False))
