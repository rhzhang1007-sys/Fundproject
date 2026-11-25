"""Extend the observed Shanghai trading calendar and existing price-index observations.
Never substitutes an index for a contract benchmark or marks price levels as total return.
"""
import argparse,json,math,time
from datetime import date,datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlencode
from public_transport import CurlPublicFetcher
from build_global_foundation import load,write
ROOT=Path(__file__).resolve().parents[2]
BASE='https://push2his.eastmoney.com/api/qt/stock/kline/get'

def parse(payload,cutoff,price=False):
    data=payload.get('data')
    if not isinstance(data,dict) or not isinstance(data.get('klines'),list):raise ValueError('Index source schema missing')
    found={}
    for line in data['klines']:
        fields=line.split(',');day=fields[0];date.fromisoformat(day)
        if day>cutoff:continue
        if day in found:raise ValueError('Duplicate index date')
        if price:
            v=float(fields[1])
            if not math.isfinite(v) or v<=0:raise ValueError('Invalid index level')
            found[day]=v
        else:found[day]=True
    return [[d,found[d]] for d in sorted(found)] if price else sorted(found)

def run(root=ROOT,as_of=None,fetch=None):
    start=time.monotonic();root=Path(root);dist=root/'prototype/dist/data';as_of=as_of or (datetime.now(ZoneInfo('Asia/Shanghai')).date()-timedelta(days=1)).isoformat();market=load(dist/'v11/market.json');fetch=fetch or CurlPublicFetcher(1,timeout=15);checks=[]
    def call(secid,price):
        begin=(date.fromisoformat(as_of)-timedelta(days=30)).strftime('%Y%m%d');url=BASE+'?'+urlencode(dict(secid=secid,klt=101,fqt=0,beg=begin,end=as_of.replace('-',''),fields1='f1,f3',fields2='f51,f53' if price else 'f51',ut='b2884a393a59ad64002292a3e90d46a5'))
        return parse(json.loads(fetch(url)),as_of,price)
    try:
        dates=call('1.000001',False)
        if not dates:raise ValueError('Empty calendar source')
        cal=market['calendar'];merged=sorted(set(cal.get('dates',[])+dates));cal.update(dates=merged,count=len(merged),**{'from':merged[0],'to':merged[-1]},lastCheckedAt=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'));checks.append(dict(kind='calendar',status='updated',to=merged[-1]))
    except (ValueError,RuntimeError,OSError,TimeoutError) as e:checks.append(dict(kind='calendar',status='partial',reason=str(e)[:120]))
    for key,series in market.get('indices',{}).get('series',{}).items():
        secid=series.get('secid') or {'000300':'1.000300','930997':'2.930997'}.get(series['code'])
        if not secid:continue
        try:
            points=call(secid,True)
            if not points:raise ValueError('Empty index source')
            merged={p[0]:p[1] for p in series.get('points',[])};merged.update(points);series.update(points=[[d,merged[d]] for d in sorted(merged)],count=len(merged),**{'from':min(merged),'to':max(merged)},verified=False);checks.append(dict(kind=key,status='updated',to=max(merged)))
        except (ValueError,RuntimeError,OSError,TimeoutError) as e:checks.append(dict(kind=key,status='partial',reason=str(e)[:120]))
    write(dist/'v11/market.json',market);report=dict(asOf=as_of,seconds=round(time.monotonic()-start,3),checks=checks,status='partial' if any(x['status']=='partial' for x in checks) else 'success');write(dist/'v12/market-sync-status.json',report);return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--as-of');a=p.parse_args();print(json.dumps(run(a.root,a.as_of),ensure_ascii=False))
