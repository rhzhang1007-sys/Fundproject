"""Daily incremental public price observations for previously resolved indices only."""
import argparse,json,math,re,time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from build_global_foundation import ROOT,load,write
from public_transport import CurlPublicFetcher
from build_index_metrics import checked,summarize

def update(root=ROOT,minutes=15,workers=3):
    root=Path(root);out=root/'prototype/dist/data/v13/index-daily.json';data=load(out);started=time.monotonic();deadline=started+minutes*60;cutoff=datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
    def one(item):
        code,old=item
        try:
            fetch=CurlPublicFetcher(timeout=18,deadline=deadline);symbol=old['symbol']
            if not re.fullmatch(r'(sh|sz)\d{6}',symbol):raise ValueError('Unresolved index symbol')
            raw=fetch('https://hq.sinajs.cn/list='+symbol,binary=True).decode('gb18030');m=re.search(r'="([^,"]+)',raw)
            if not m or m[1]!=old.get('sinaName'):raise ValueError('Index quote identity changed')
            rows=json.loads(fetch('https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol='+symbol+'&scale=240&ma=no&datalen=30'))
            if not isinstance(rows,list) or not rows:raise ValueError('No incremental index observations')
            pts=checked([[r['day'],float(r['close'])] for r in rows]);pts=[p for p in pts if p[0]<=cutoff]
            if not pts:raise ValueError('No applicable index observations')
            merged=dict(checked(old['points']));merged.update(dict(pts));points=checked([[d,merged[d]] for d in sorted(merged)])
            return code,{**old,'points':points,'count':len(points),'to':points[-1][0],'updatedAt':datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),'observationMetrics':summarize(points)},None
        except (ValueError,RuntimeError,OSError,KeyError,TimeoutError,TypeError) as e:return code,old,str(e)[:140]
    pending=[(c,r) for c,r in data['series'].items() if not (r.get('to','')>=cutoff and r.get('updatedAt','')[:10]==cutoff)]
    with ThreadPoolExecutor(max_workers=max(1,min(workers,3))) as pool:results=list(pool.map(one,pending))
    errors=[];updated=0
    for code,row,error in results:
        data['series'][code]=row
        if error:errors.append({'code':code,'reason':error})
        else:updated+=1
    data['checkedAt']=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds');write(out,data)
    report={'resolvedScope':len(data['series']),'requestedScope':len(results),'alreadyCurrent':len(data['series'])-len(results),'updated':updated,'errors':errors,'seconds':round(time.monotonic()-started,3),'newMissingIndicesRequested':0,'eligibleForFundRisk':False};write(out.parent/'index-status.json',report);return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--budget-minutes',type=float,default=15);p.add_argument('--workers',type=int,default=3);a=p.parse_args();print(json.dumps(update(minutes=a.budget_minutes,workers=a.workers),ensure_ascii=False))
