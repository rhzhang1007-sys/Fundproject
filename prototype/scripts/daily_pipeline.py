"""One unattended job: source-first news, dated market facts, optional forum LLM.

Public output commits are independent of a failed optional forum source. Every source
reports its own date window and pagination bound; 'all known objects' is not 'all news'.
"""
import argparse
from datetime import datetime,timedelta
import json
import os
from pathlib import Path
import time
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
import refresh_public_data as u
from public_news import EntityIndex,runtime_entities,collect_fast,collect_fund_announcements,collect_company_announcements,prepare_events
from public_transport import CurlPublicFetcher
from market_public import collect_boards,collect_focus_boards,collect_valuations,merge_valuations

ROOT=Path(__file__).resolve().parents[2]

def partial_coverage(value):
    if isinstance(value,dict):
        return str(value.get('status','')).startswith('partial-') or any(partial_coverage(v) for v in value.values())
    if isinstance(value,list):return any(partial_coverage(v) for v in value)
    return False

def progress(stage,**fields):
    # No API URL, credentials or source body text in operational logs.
    print(json.dumps(dict(stage=stage,at=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),**fields),ensure_ascii=False),flush=True)

def preflight(root,config):
    required=['prototype/dist/index.html','prototype/dist/data/v07/funds-l1.json','prototype/dist/data/v09/security-identities.json']
    if config.get('forumDaily',{}).get('mode')=='global-queue':required+=['prototype/dist/data/v10/objects.json','prototype/dist/data/v10/entity-aliases.json','prototype/dist/data/v10/foundation-manifest.json']
    missing=[name for name in required if not (root/name).is_file()]
    prices=u._price()
    price_info=u.pricing_details()
    url,_,model=u.llm_config()
    return dict(sourceFilesReady=not missing,missingFiles=missing,collectionEnabled=config.get('enabled') is True,
        publishEnabled=config.get('publishEnabled') is True,modelConfigured=bool(u.llm_config()[0]),
        modelPricesConfigured=all(x is not None for x in prices),modelPricingSource=price_info['source'],budgetCNY=u._budget(),
        modelMatchesDiscussedSelection=bool(model and model.lower() in ('glm-5.3-flashx','glm-5.3-flash')),
        providerMatchesDiscussedSelection=bool(url and urlparse(url).hostname=='api.zhizengzeng.com'),
        endpointIsChatCompletions=bool(url and urlparse(url).path.rstrip('/').endswith('/chat/completions')),
        cronUTC='30 0 * * *',timezone='Asia/Shanghai',credentialsIncluded=False)


def run(root,config,collect=False,as_of=None,fetch=None):
    root=Path(root);day=as_of or datetime.now(ZoneInfo('Asia/Shanghai')).date();end=(day-timedelta(days=1)).isoformat()
    dest=root/'prototype/dist/data';now=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
    if not collect:return preflight(root,config)
    if config.get('enabled') is not True:raise ValueError('Daily collection disabled')
    u.MODEL_CIRCUIT_ERROR=None
    checks=preflight(root,config)
    if not checks['sourceFilesReady']:raise ValueError('Missing prepared source files')
    fetch=fetch or CurlPublicFetcher(config.get('requestIntervalSeconds',1),deadline=time.monotonic()+int(config.get('dailyDeadlineSeconds',2400)))
    u.LLM_DEADLINE=getattr(fetch,'deadline',None)
    index=EntityIndex(runtime_entities(root));status=dict(schemaVersion=1,attemptedAt=now,targetDay=end,newsReady=False,marketReady=False,forumReady=False,sources={},errors=[],model=checks)
    start=(day-timedelta(days=int(config.get('catchUpDays',2)))).isoformat()
    progress('start',targetDay=end,windowStart=start,modelConfigured=checks['modelConfigured'],modelPricesConfigured=checks['modelPricesConfigured'])
    incoming=[];fatal=False
    # Each feed is bulk/paginated, not one search for every fund or stock.
    feeds=[('fast-news',collect_fast,int(config.get('maxFastNewsPages',80))),
           ('fund-announcements',collect_fund_announcements,int(config.get('maxFundAnnouncementPages',100))),
           ('company-announcements',collect_company_announcements,int(config.get('maxCompanyAnnouncementPages',60)))]
    for name,collector,pages in feeds:
        if not config.get('newsSources',{}).get(name,True):continue
        try:
            events,coverage=collector(fetch,index,start,end,pages)
            incoming.extend(events);status['sources'][name]=dict(coverage=coverage,start=start,end=end,eventRows=len(events))
            progress(name,eventRows=len(events),coverage=coverage)
        except u.SourceRefused as exc:
            status['errors'].append(dict(task=name,reason=str(exc)));fatal=True;break
        except (ValueError,RuntimeError,TimeoutError,OSError) as exc:
            status['errors'].append(dict(task=name,reason=str(exc)))
            progress(name,status='failed',reason=str(exc))
    # Preserve old data on source failure. A successful feed containing no relevant hits is valid.
    if status['sources'] and not fatal:
        u.run(root,config,incoming=prepare_events(incoming),as_of=day)
        previous=u.load(dest/'v07/events.json',{'events':[]})
        previous.pop('statusNote',None);previous.pop('entities',None)
        checked_at=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
        previous.update(builtAt=checked_at,lastCheckedAt=checked_at,windowDays=config.get('windowDays',30),
            sourceChecks=status['sources'],status='source-bounded',objectScope=dict(stocks=sum(k[0]=='stock' for k in index.entities),funds=sum(k[0]=='fund' for k in index.entities)),
            coverageNote='来源分页窗口内已取得事件；不是全市场零遗漏声明')
        u.write_json(dest/'v07/events.json',previous);status['newsReady']=True
        progress('news-saved',activeEvents=len(previous['events']))
    if config.get('marketDaily',{}).get('enabled') and not fatal:
        market=config['marketDaily'];snapshot=u.load(dest/'v09/market-daily.json',{'boards':[],'valuations':[]});fresh_boards=[]
        try:
            boards=collect_boards(fetch,end,int(market.get('maxBoardPages',30)))
            # Never replace an older valid daily snapshot with a future-dated empty set.
            if boards['boards']:
                snapshot.update(boards);fresh_boards=boards['boards'];status['marketReady']=True
            status['sources']['board-flows']=boards['sourceChecks']
        except u.SourceRefused as exc:
            status['errors'].append(dict(task='board-flows',reason=str(exc)));fatal=True
        except (ValueError,RuntimeError,TimeoutError,OSError) as exc:
            status['errors'].append(dict(task='board-flows',reason=str(exc)))
            try:
                focused=collect_focus_boards(fetch,end,market.get('focusBoards',[]));status['sources']['board-flows-focus']=focused['sourceChecks']
                if focused['boards']:
                    combined={(r['kind'],r['id']):r for r in snapshot.get('boards',[])}
                    for row in focused['boards']:combined[(row['kind'],row['id'])]=row
                    snapshot['boards']=list(combined.values());snapshot['focusCoverage']=focused
                    fresh_boards=focused['boards'];status['marketReady']=True
            except u.SourceRefused as denied:status['errors'].append(dict(task='board-flows-focus',reason=str(denied)));fatal=True
            except (ValueError,RuntimeError,TimeoutError,OSError) as failed:status['errors'].append(dict(task='board-flows-focus',reason=str(failed)))
        if not fatal:
            try:
                observations=collect_valuations(lambda url:fetch(url,binary=True),market.get('indexCodes',['399808','930997']),end)
                snapshot['valuations']=merge_valuations(snapshot.get('valuations',[]),observations);status['marketReady']=True
                status['sources']['index-valuations']=dict(rows=len(observations),percentiles='not-calculated; historical-window-pending')
            except u.SourceRefused as exc:
                status['errors'].append(dict(task='index-valuations',reason=str(exc)));fatal=True
            except (ValueError,RuntimeError,TimeoutError,OSError,ImportError) as exc:status['errors'].append(dict(task='index-valuations',reason=str(exc)))
        if status['marketReady']:
            snapshot.update(updatedAt=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),targetDay=end);u.write_json(dest/'v09/market-daily.json',snapshot)
            # Archive by the source's actual trading date, never the job's calendar date.
            # Browser startup still loads only the current snapshot.
            by_day={}
            for row in fresh_boards:by_day.setdefault(row['asOf'],[]).append(row)
            for source_day,rows in by_day.items():
                u.write_json(dest/'v09/market-history'/f'{source_day}.json',dict(asOf=source_day,boards=rows,sourceChecks=snapshot.get('sourceChecks',{}),archivedAt=now))
        progress('market',ready=status['marketReady'])
    # The existing 119 forum targets are a separate scope. Source-first news covers the whole
    # identity registry, while complete all-market forum crawling would require a separate budget.
    if config.get('forumDaily',{}).get('enabled') and config.get('forumDaily',{}).get('mode')=='global-queue' and not fatal:
        from global_forum import run as run_global_forum
        result=run_global_forum(root,config,fetch,day,getattr(fetch,'deadline',None))
        status['forumScope']=result
        status['forumReady']=result.get('status')=='success'
        if not status['forumReady']:status['errors'].append(dict(task='forum-global',reason='pending-or-partial; inspect v10/coverage.json'))
    elif config.get('forumDaily',{}).get('enabled') and not fatal:
        cap=int(config.get('forumDaily',{}).get('maxObjects',len(config.get('objects') or [])));targets=(config.get('objects') or [])[:cap]
        successes=0;listed={}
        # Finish verified publication-day lists for every target before downloading
        # lengthy threads, so one busy stock cannot starve all later identities.
        for obj in targets:
            oid=obj['kind']+obj['code'];code=('of' if obj['kind']=='fund' else '')+obj['code']
            try:
                rows=u.forum_day(fetch,code,end,int(config.get('maxPostsPerObject',0)),int(config.get('maxForumPages',200)),day.isoformat())
                listed[oid]=rows
                subset={**config,'objects':[obj],'sources':{'forumLists':True},'forumDetails':False,'llmClaims':False}
                u.run(root,subset,collect=True,as_of=day,fetcher=fetch,forum_observations={oid:rows})
                progress('forum-list',objectId=oid,posts=len(rows),completed=len(listed),targets=len(targets))
            except u.SourceRefused as exc:
                status['errors'].append(dict(task='forum-list',objectId=oid,reason=str(exc)));fatal=True;break
            except (ValueError,RuntimeError,TimeoutError,OSError) as exc:
                status['errors'].append(dict(task='forum-list',objectId=oid,reason=str(exc)))
                if isinstance(exc,TimeoutError):break
        ordered=sorted((obj for obj in targets if obj['kind']+obj['code'] in listed),key=lambda obj:(obj['kind']!='fund',len(listed[obj['kind']+obj['code']])))
        if not fatal:
            for obj in ordered:
                oid=obj['kind']+obj['code']
                try:
                    subset={**config,'objects':[obj],'sources':{'forumLists':True},'llmClaims':config.get('llmClaims',False)}
                    u.run(root,subset,collect=True,as_of=day,fetcher=fetch,forum_observations={oid:listed[oid]})
                    successes+=1
                    progress('forum-details',objectId=oid,completed=successes,targets=len(targets))
                except u.SourceRefused as exc:
                    status['errors'].append(dict(task='forum-details',objectId=oid,reason=str(exc)));fatal=True;break
                except (ValueError,RuntimeError,TimeoutError,OSError) as exc:
                    status['errors'].append(dict(task='forum-details',objectId=oid,reason=str(exc)))
                    if isinstance(exc,TimeoutError):break
        status['forumReady']=successes==len(targets)
        status['forumScope']=dict(targets=len(targets),listed=len(listed),detailed=successes,successful=successes,allMarket=False)
    if (dest/'v10/objects.json').exists():
        from publish_object_activity import publish
        publish(root,day)
    if u.MODEL_CIRCUIT_ERROR:status['errors'].append(dict(task='model',reason=u.MODEL_CIRCUIT_ERROR))
    status['incompleteSources']=[name for name,check in status['sources'].items() if partial_coverage(check)]
    status['status']='success' if status['newsReady'] and not status['errors'] and not status['incompleteSources'] else 'partial' if status['newsReady'] or status['marketReady'] else 'failed'
    status['networkRequests']=getattr(fetch,'calls',None)
    status['finishedAt']=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
    u.write_json(dest/'v09/update-status.json',status)
    progress('complete',status=status['status'],newsReady=status['newsReady'],marketReady=status['marketReady'],forumReady=status['forumReady'])
    return status


def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--config',type=Path);p.add_argument('--collect',action='store_true');p.add_argument('--as-of')
    args=p.parse_args();cfg=u.load(args.config or args.root/'prototype/config/public-updates.json',{})
    day=datetime.strptime(args.as_of,'%Y-%m-%d').date() if args.as_of else None
    result=run(args.root,cfg,args.collect,day)
    print(json.dumps(result,ensure_ascii=False))
    if args.collect and result.get('status')=='failed':raise SystemExit(2)

if __name__=='__main__':main()
