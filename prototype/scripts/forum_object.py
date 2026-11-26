"""Resumable public material for one known object/day, shared by web and daily jobs."""
import argparse,hashlib,json,time
from datetime import datetime,timedelta,date
from pathlib import Path
from zoneinfo import ZoneInfo
import refresh_public_data as u
from public_transport import CurlPublicFetcher
from public_comments import read_comments
from public_post_material import merge_material, hydrate, pending
from build_global_foundation import ROOT,load,write
import sina_forum as sina

def collect(root,object_id,day,seconds=100,providers=('eastmoney','sina'),initial=None,known_only=False,post_ids=None):
    root=Path(root);registry=load(root/'prototype/dist/data/v10/objects.json')['objects'];obj=next((x for x in registry if x['id']==object_id),None)
    if not obj:raise ValueError('Object not catalogued')
    target=date.fromisoformat(day);now=datetime.now(ZoneInfo('Asia/Shanghai'))
    if not now.date()-timedelta(days=29)<=target<=now.date():raise ValueError('Day outside public retention window')
    path=root/f'prototype/.private/forum/{object_id}/{day}.json';d=initial if initial is not None else load(path) if path.exists() else {'objectId':object_id,'date':day,'records':[],'sources':{}}
    deadline=time.monotonic()+max(30,min(900,seconds));started=time.monotonic();cap=30
    def save():
        d['updatedAt']=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds');write(path,d)
    sources=d.setdefault('sources',{});records={r['id']:r for r in d['records']}
    public=root/f'prototype/dist/data/v12/posts/{obj["kind"]}s/{obj["code"]}.json'
    if public.exists():
        for r in load(public).get('records',[]):
            if r.get('objectId')==object_id and r.get('date')==day:records[r['id']]=merge_material(records.get(r['id'],{}),r)
    wanted=set(post_ids or [])
    if known_only and not any(not wanted or r['id'] in wanted for r in records.values()):raise ValueError('未找到所选日期的已收录帖子')
    def persist():d['records']=sorted(records.values(),key=lambda r:(r.get('publishedAt') or '',r['id']),reverse=True)[:cap];save()
    if len(providers)>1 and d.get('visits',0)%2:providers=tuple(reversed(providers))
    d['visits']=d.get('visits',0)+1
    # Known URLs go straight to material requests, even if listing pages time out.
    if 'eastmoney' in providers and sources.get('eastmoney',{}).get('cooldownUntil','')<=now.isoformat():
        fetch=CurlPublicFetcher(deadline=deadline,timeout=12,max_attempts=1)
        for row in records.values():
            if time.monotonic()>deadline-26:break
            if row.get('source')!='东方财富股吧' or wanted and row['id'] not in wanted or not pending(row):continue
            try:hydrate(fetch,row,3)
            except u.SourceRefused:
                sources.setdefault('eastmoney',{'page':1,'status':'pending'}).update(error='source-refused',cooldownUntil=(now+timedelta(hours=24)).isoformat());break
            persist()
    if known_only:d['knownPostsOnly']=True
    for provider in providers:
        task=sources.setdefault(provider,{'page':1,'status':'pending'})
        if provider=='sina' and task.get('parserVersion')!=2:task.clear();task.update(page=1,status='pending',parserVersion=2)
        if provider=='sina' and (obj['kind']!='stock' or not obj['code'].startswith(('0','3','6'))):task['status']='unsupported-board';continue
        if task.get('cooldownUntil','')>now.isoformat():continue
        fetch=CurlPublicFetcher(deadline=deadline,timeout=18)
        try:
            # One list page per visit, then enrich available posts immediately.
            for list_visit in range(0 if known_only else 6):
                if task['status'] in ('window-complete','daily-cap-reached') or time.monotonic()>=deadline-25:break
                if provider=='eastmoney':
                    code=('of' if obj['kind']=='fund' else '')+obj['code'];raw=u._forum_payload(fetch,code,task['page'])
                    signature=hashlib.sha256(','.join(str(x.get('post_id')) for x in raw).encode()).hexdigest()
                    if raw and signature==task.get('lastSignature'):raise ValueError('Repeated source page')
                    rows=[u._forum_row(x,code,now.date().isoformat()) for x in raw if u.forum_native(x,code)]
                    dates=[str(x.get('post_publish_time'))[:10] for x in raw if u.forum_native(x,code) and x.get('post_top_status') in (None,0)]
                    ordered=all(dates[i]>=dates[i+1] for i in range(len(dates)-1)) and (not dates or not task.get('lastDate') or dates[0]<=task['lastDate'])
                    task.update(lastSignature=signature,lastDate=dates[-1] if dates else task.get('lastDate'))
                    if not raw or ordered and dates and dates[-1]<day:task['status']='window-complete'
                    else:task['status']='pending-pages'
                else:
                    symbol=('sh' if obj['code'].startswith('6') else 'sz')+obj['code']
                    url=f'https://guba.sina.com.cn/?s=bar&name={symbol}&type=0&page={task["page"]}'
                    html=sina.read_html(fetch,url);rows,next_url=sina.listing(html,symbol,object_id,now)
                    signature=hashlib.sha256(','.join(r['id'] for r in rows).encode()).hexdigest()
                    if rows and signature==task.get('lastSignature'):raise ValueError('Repeated Sina page')
                    task.update(lastSignature=signature,status='pending-pages' if next_url else 'window-complete')
                task['page']+=1
                for r in rows:
                    if r['date']==day and (r['id'] in records or len(records)<cap):records[r['id']]=merge_material(records.get(r['id'],{}),r)
                if len(records)>=cap:task['status']='daily-cap-reached'
                persist()
                if any(r['date']==day for r in rows):break
            candidates=[r for r in records.values() if (r['source']=='新浪股市汇')==(provider=='sina') and (not wanted or r['id'] in wanted) and not(known_only and provider=='eastmoney')]
            for row in candidates:
                if time.monotonic()>deadline-24:break
                if provider=='eastmoney':
                    if (row.get('coverage') or {}).get('body')!='complete':
                        if pending(row):hydrate(fetch,row,3)
                    elif pending(row):hydrate(fetch,row,3)
                else:
                    if (row.get('coverage') or {}).get('body')=='complete' and (row.get('coverage') or {}).get('comments')=='complete':continue
                    url=row.get('nextCommentPage') or row['url'];next_url=sina.detail(sina.read_html(fetch,url),row,now)
                    if row['date']!=day:records.pop(row['id'],None);persist();continue
                    if next_url:row['nextCommentPage']=next_url
                    else:row.pop('nextCommentPage',None)
                persist()
            task.pop('error',None)
        except u.SourceRefused:
            task.update(error='source-refused',cooldownUntil=(now+timedelta(hours=24)).isoformat())
        except (ValueError,RuntimeError,OSError,TimeoutError) as exc:task['error']=str(exc)[:180]
        persist()
    selected=[r for r in records.values() if not known_only or not wanted or r['id'] in wanted]
    complete=(known_only or all(t['status'] in ('window-complete','daily-cap-reached','unsupported-board') for t in sources.values())) and all((r.get('coverage') or {}).get('body')=='complete' and (r.get('coverage') or {}).get('comments')=='complete' for r in selected)
    d.update(status='complete' if complete else 'partial',seconds=round(time.monotonic()-started,3),message='已保存取得的正文与评论；来源限制或剩余页可稍后继续。',postLimitPerObjectPerDay=cap,scheduledLLM=False);persist();return d

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--object',required=True);ap.add_argument('--day',required=True);ap.add_argument('--seconds',type=int,default=100);ap.add_argument('--known-only',action='store_true');ap.add_argument('--post-ids',default='');args=ap.parse_args()
    d=collect(ROOT,args.object,args.day,args.seconds,known_only=args.known_only,post_ids=args.post_ids.split(',') if args.post_ids else None);print(json.dumps({k:v for k,v in d.items() if k!='records'},ensure_ascii=False))
