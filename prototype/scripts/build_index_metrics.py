#!/usr/bin/env python3
"""Price-index/ETF-price observations, kept separate from fund total-return factors.
Inputs are read as fixed snapshots. This program never downloads or adjusts dividends.
"""
import argparse,hashlib,json,math
from bisect import bisect_right
from datetime import date,datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[2]
PKG=ROOT/'output/公共数据包-2026-11-24'
MIN_POINTS=60
METHOD='index-price-observations-v2-2026-11-25'

def checked(points):
    if not isinstance(points,list) or not points:raise ValueError('No price observations')
    last=None;out=[]
    for p in points:
        if not isinstance(p,(list,tuple)) or len(p)<2:raise ValueError('Invalid price point')
        d= p[0];date.fromisoformat(d);v=p[1]
        if type(v) not in (int,float) or not math.isfinite(v) or v<=0 or last and d<=last:raise ValueError('Nonpositive/nonfinite price or unordered/duplicate date')
        out.append([d,v]);last=d
    return out

def returns(points):
    points=checked(points)
    return [b[1]/a[1]-1 for a,b in zip(points,points[1:])]

def max_drawdown(points):
    pts=checked(points);peak=pts[0][1];peak_date=pts[0][0]
    worst=dict(drawdown=0.,peakDate=peak_date,troughDate=peak_date,recoverDate=peak_date,recoverDays=0,peakValue=peak,troughValue=peak)
    for day,value in pts:
        if value>peak:peak,peak_date=value,day
        dd=1-value/peak
        if dd>worst['drawdown']+1e-12:worst.update(drawdown=dd,peakDate=peak_date,troughDate=day,peakValue=peak,troughValue=value,recoverDate=None,recoverDays=None)
    if worst['drawdown']>0:
        for day,value in pts:
            if day>worst['troughDate'] and value>=worst['peakValue']-1e-12:
                worst['recoverDate']=day;worst['recoverDays']=(date.fromisoformat(day)-date.fromisoformat(worst['troughDate'])).days;break
    return worst

def summarize(points):
    pts=checked(points)
    if len(pts)<MIN_POINTS:raise ValueError('Fewer than 60 price observations')
    rs=returns(pts);mean=sum(rs)/len(rs);var=sum((r-mean)**2 for r in rs)/(len(rs)-1);negative=[r for r in rs if r<0]
    end=date.fromisoformat(pts[-1][0])
    try:anchor=end.replace(year=end.year-1)
    except ValueError:anchor=end.replace(year=end.year-1,day=28)
    j=bisect_right([p[0] for p in pts],anchor.isoformat())-1
    annual_ready=j>=0 and (anchor-date.fromisoformat(pts[j][0])).days<=7
    moves=[dict(date=pts[i+1][0],returnValue=r) for i,r in enumerate(rs) if abs(r)>.15]
    return dict(**{'from':pts[0][0],'to':pts[-1][0]},points=len(pts),returnObservations=len(rs),annualVol=math.sqrt(var*252),
        downsideVol=math.sqrt(sum(min(r,0)**2 for r in rs)/len(rs)*252),negativeDayRMS=math.sqrt(sum(r*r for r in negative)/len(negative)*252) if negative else None,
        maxDrawdown=max_drawdown(pts),worstDay=min(rs),bestDay=max(rs),return1y=pts[-1][1]/pts[j][1]-1 if annual_ready else None,
        return1yFrom=pts[j][0] if annual_ready else None,return1yDays=(end-date.fromisoformat(pts[j][0])).days if annual_ready else None,
        return252Obs=pts[-1][1]/pts[-253][1]-1 if len(pts)>=253 else None,
        pricePercentile=sum(p[1]<=pts[-1][1] for p in pts)/len(pts),largeMoves=moves,jumpReviewRequired=bool(moves),
        percentileNote='样本内价格分位，不是估值分位',calendarVerified=False,eligibleForFundRisk=False)

def build(package=PKG,as_of=None):
    package=Path(package);as_of=as_of or (datetime.now(ZoneInfo('Asia/Shanghai')).date()-timedelta(days=1)).isoformat();date.fromisoformat(as_of)
    names={};inputs=[];series={};skipped=[]
    def rows(path):
        if not path.exists():return []
        before=path.stat();raw=path.read_bytes();after=path.stat()
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('Source changed during read; keep previous output')
        inputs.append(dict(path=str(path),sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw)))
        return [json.loads(line) for line in raw.splitlines() if line.strip()]
    for r in rows(package/'funds/fund-basics.jsonl'):
        if r.get('indexCode') and r.get('indexName'):names.setdefault(r['indexCode'],r['indexName'])
    for filename,via in [('index-proxy.jsonl','proxy'),('index-daily.jsonl','direct')]:
        for r in rows(package/'market'/filename):
            if r.get('status')!='ok':continue
            try:
                pts=checked(r.get('points'));pts=[p for p in pts if p[0]<=as_of]
                if len(pts)<MIN_POINTS:continue
                code=str(r['code']);series[code]={**r,'points':pts,'via':via}
            except (ValueError,TypeError,KeyError) as e:skipped.append(dict(code=r.get('code'),reason=str(e),source=filename))
    metrics={}
    for code,r in series.items():
        metric=summarize(r['points']);metrics[code]={**metric,'code':code,'name':r.get('name') or names.get(code),'sinaName':r.get('sinaName'),'via':r['via'],'basis':r.get('basis'),'proxyBasis':r.get('basis') if r['via']=='proxy' else None,'etfCode':r.get('etfCode')}
    return dict(schemaVersion=2,methodVersion=METHOD,builtAt=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),asOf=as_of,
        method=dict(annualization=252,minPoints=MIN_POINTS,returnBasis='adjacent-price-observations',downsideDenominator='all-return-observations',yearReturnMaxAnchorGapDays=7),
        note='价格观察统计。ETF场内价格及价格指数都不是基金已核总回报；不进入基金正式风险或合同跟踪评价。大幅变动只标记待核，不自动认定数据错误或风险事件。',
        count=len(metrics),skipped=skipped,inputs=inputs,metrics=metrics)

def main():
    p=argparse.ArgumentParser();p.add_argument('--package',type=Path,default=PKG);p.add_argument('--output',type=Path);p.add_argument('--as-of');a=p.parse_args();payload=build(a.package,a.as_of);out=a.output or a.package/'market/index-metrics.json';out.parent.mkdir(parents=True,exist_ok=True);tmp=out.with_suffix('.tmp');tmp.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n');tmp.replace(out);print(json.dumps(dict(count=payload['count'],skipped=len(payload['skipped']),asOf=payload['asOf'],eligibleForFundRisk=False)))
if __name__=='__main__':main()
