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
import refresh_public_data as u
from public_news import EntityIndex,runtime_entities,collect_fast,collect_fund_announcements,collect_company_announcements,prepare_events
from public_transport import CurlPublicFetcher
from market_public import collect_boards,collect_valuations,merge_valuations

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
    missing=[name for name in required if not (root/name).is_file()]
    prices=u._price()
    return dict(sourceFilesReady=not missing,missingFiles=missing,collectionEnabled=config.get('enabled') is True,
        publishEnabled=config.get('publishEnabled') is True,modelConfigured=bool(u.llm_config()[0]),
        modelPricesConfigured=all(x is not None for x in prices),budgetCNY=u._budget(),
        cronUTC='30 0 * * *',timezone='Asia/Shanghai',credentialsIncluded=False)


def run(root,config,collect=False,as_of=None,fetch=None):
    root=Path(root);day=as_of or datetime.now(ZoneInfo('Asia/Shanghai')).date();end=(day-timedelta(days=1)).isoformat()
    dest=root/'prototype/dist/data';now=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
    if not collect:return preflight(root,config)
    if config.get('enabled') is not True:raise ValueError('Daily collection disabled')
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
        previous.update(builtAt=now,lastCheckedAt=now,windowDays=config.get('windowDays',30),
            sourceChecks=status['sources'],status='source-bounded',objectScope=dict(stocks=sum(k[0]=='stock' for k in index.entities),funds=sum(k[0]=='fund' for k in index.entities)),
            coverageNote='来源分页窗口内已取得事件；不是全市场零遗漏声明')
        u.write_json(dest/'v07/events.json',previous);status['newsReady']=True
        progress('news-saved',activeEvents=len(previous['events']))
    if config.get('marketDaily',{}).get('enabled') and not fatal:
        market=config['marketDaily'];snapshot=u.load(dest/'v09/market-daily.json',{'boards':[],'valuations':[]})
        try:
            boards=collect_boards(fetch,end,int(market.get('maxBoardPages',30)))
            # Never replace an older valid daily snapshot with a future-dated empty set.
            if boards['boards']:
                snapshot.update(boards);status['marketReady']=True
            status['sources']['board-flows']=boards['sourceChecks']
        except u.SourceRefused as exc:
            status['errors'].append(dict(task='board-flows',reason=str(exc)));fatal=True
        except (ValueError,RuntimeError,TimeoutError,OSError) as exc:status['errors'].append(dict(task='board-flows',reason=str(exc)))
        if not fatal:
            try:
                observations=collect_valuations(lambda url:fetch(url,binary=True),market.get('indexCodes',['399808','930997']),end)
                snapshot['valuations']=merge_valuations(snapshot.get('valuations',[]),observations);status['marketReady']=True
                status['sources']['index-valuations']=dict(rows=len(observations),percentiles='not-calculated; historical-window-pending')
            except u.SourceRefused as exc:
                status['errors'].append(dict(task='index-valuations',reason=str(exc)));fatal=True
            except (ValueError,RuntimeError,TimeoutError,OSError,ImportError) as exc:status['errors'].append(dict(task='index-valuations',reason=str(exc)))
        if status['marketReady']:
            snapshot.update(updatedAt=now,targetDay=end);u.write_json(dest/'v09/market-daily.json',snapshot)
        progress('market',ready=status['marketReady'])
    # The existing 119 forum targets are a separate scope. Source-first news covers the whole
    # identity registry, while complete all-market forum crawling would require a separate budget.
    if config.get('forumDaily',{}).get('enabled') and not fatal:
        cap=int(config.get('forumDaily',{}).get('maxObjects',119));targets=(config.get('objects') or [])[:cap]
        successes=0
        for obj in targets:
            try:
                subset={**config,'objects':[obj],'sources':{'forumLists':True},'llmClaims':config.get('llmClaims',False)}
                # Reuse the same paced/refusal-aware network transport, not a second throttle.
                u.run(root,subset,collect=True,as_of=day,fetcher=fetch)
                successes+=1
                progress('forum',objectId=obj['kind']+obj['code'],completed=successes,targets=len(targets))
            except u.SourceRefused as exc:
                status['errors'].append(dict(task='forum',objectId=obj['kind']+obj['code'],reason=str(exc)));fatal=True;break
            except (ValueError,RuntimeError,TimeoutError,OSError) as exc:
                status['errors'].append(dict(task='forum',objectId=obj['kind']+obj['code'],reason=str(exc)))
                if isinstance(exc,TimeoutError):break
        status['forumReady']=successes==len(targets);status['forumScope']=dict(targets=len(targets),successful=successes,allMarket=False)
    status['incompleteSources']=[name for name,check in status['sources'].items() if partial_coverage(check)]
    status['status']='success' if status['newsReady'] and not status['errors'] and not status['incompleteSources'] else 'partial' if status['newsReady'] or status['marketReady'] else 'failed'
    status['networkRequests']=getattr(fetch,'calls',None)
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
