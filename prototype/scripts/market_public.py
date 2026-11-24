"""Daily public board flows and dated CSI valuation observations, without LLM arithmetic."""
from datetime import datetime
from io import BytesIO
import hashlib
import json
import math
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

QUOTE_UT='b2884a393a59ad64002292a3e90d46a5'  # Public web-client identifier, not a credential.

def number(x):
    if type(x) not in (int,float) or not math.isfinite(x):return None
    return x

def board_page(data,kind):
    if data.get('rc')!=0 or not isinstance(data.get('data'),dict) or not isinstance(data['data'].get('diff'),list):raise ValueError('Board-flow schema/business failure')
    rows=[]
    for x in data['data']['diff']:
        code=x.get('f12');name=x.get('f14');stamp=number(x.get('f124'))
        if not isinstance(code,str) or not code.startswith('BK') or not isinstance(name,str) or not stamp:raise ValueError('Board identity/date missing')
        date=datetime.fromtimestamp(stamp,ZoneInfo('Asia/Shanghai')).date().isoformat()
        rows.append(dict(id=code,name=name,kind=kind,asOf=date,sourceTimestamp=datetime.fromtimestamp(stamp,ZoneInfo('Asia/Shanghai')).isoformat(),close=number(x.get('f2')),changePercent=number(x.get('f3')),
            mainNetFlowCNY=number(x.get('f62')),mainNetFlowRatioPercent=number(x.get('f184')),
            flowDefinition='provider-size-classified-main-order-net-traded-value',flowUnit='CNY',
            scheme='eastmoney-'+kind+'-board; levels-and-constituents-may-overlap',
            sourceUrl='https://quote.eastmoney.com/bk/'+code+'.html'))
    return rows,int(data['data'].get('total') or 0)


def collect_boards(fetch,end,max_pages=30):
    rows=[];checks={}
    for kind,type_code in [('industry',2),('concept',3)]:
        seen=set();all_rows=[];total=0
        for page in range(1,max_pages+1):
            params=dict(pn=page,pz=100,np=1,fs=f'm:90+t:{type_code}',fields='f12,f14,f62,f184,f2,f3,f124',fid='f62',po=1,fltt=2,invt=2,ut=QUOTE_UT)
            raw=fetch('https://push2.eastmoney.com/api/qt/clist/get?'+urlencode(params));data=json.loads(raw)
            part,total=board_page(data,kind)
            for row in part:row.update(sourceRetrievedAt=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),sourcePayloadSha256=hashlib.sha256(raw.encode()).hexdigest())
            signature=tuple(x['id'] for x in part)
            if signature and signature in seen:raise ValueError('Board pagination repeated')
            seen.add(signature);all_rows+=part
            if len(all_rows)>=total or not part:break
        unique={r['id']:r for r in all_rows}
        if len(unique)!=total:raise ValueError('Incomplete board list; keep previous snapshot')
        # At 08:30 the public current snapshot should still describe yesterday. Never relabel today's values.
        accepted=[r for r in unique.values() if r['asOf']<=end]
        rows+=accepted
        checks[kind]=dict(reportedTotal=total,rows=len(unique),acceptedRows=len(accepted),status='source-total-matched' if len(accepted)==len(unique) else 'newer-source-date-not-relabelled')
    return dict(schemaVersion=1,boards=rows,sourceChecks=checks,percentiles=None,
        caveat='板块可重叠，主力成交净额按供应商口径，不是ETF净申购或市场资金新增。')


def valuation_xls(raw,expected_code,end):
    import xlrd
    book=xlrd.open_workbook(file_contents=raw);sheet=book.sheet_by_index(0)
    header=sheet.row_values(0)
    if len(header)!=10 or '总股本' not in str(header[6]) or '计算用股本' not in str(header[7]):raise ValueError('CSI valuation columns changed')
    rows=[];digest=hashlib.sha256(raw).hexdigest()
    for i in range(1,sheet.nrows):
        row=sheet.row_values(i);date=datetime.strptime(str(row[0]).split('.')[0],'%Y%m%d').date().isoformat()
        code=str(row[1]).split('.')[0]
        if code!=expected_code:raise ValueError('Valuation index identity mismatch')
        if date>end:continue
        rows.append(dict(indexCode=code,indexName=row[2],asOf=date,peTotalShares=number(row[6]),peCalculationShares=number(row[7]),
            dividendYieldTotalSharesPercent=number(row[8]),dividendYieldCalculationSharesPercent=number(row[9]),
            metricLabels=dict(peTotalShares=header[6],peCalculationShares=header[7]),
            pb=None,percentiles=None,percentileStatus='history-window-and-method-not-approved',
            sourceUrl=f'https://www.csindex.com.cn/zh-CN/indices/index-detail/{code}',
            sourceFileUrl=f'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/{code}indicator.xls',sourcePayloadSha256=digest))
    if not rows or len({r['asOf'] for r in rows})!=len(rows):raise ValueError('Empty/duplicate valuation observations')
    return rows


def merge_valuations(previous,incoming):
    rows={(r['indexCode'],r['asOf']):r for r in previous}
    fields=['peTotalShares','peCalculationShares','dividendYieldTotalSharesPercent','dividendYieldCalculationSharesPercent','pb','metricLabels']
    for r in incoming:
        key=(r['indexCode'],r['asOf']);old=rows.get(key);current=dict(r)
        if old:
            revisions=list(old.get('revisions',[]))
            if any(old.get(k)!=r.get(k) for k in fields):revisions.append({k:v for k,v in old.items() if k!='revisions'})
            if revisions:current['revisions']=revisions
            current['firstRetrievedAt']=old.get('firstRetrievedAt') or old.get('sourceRetrievedAt')
        rows[key]=current
    return sorted(rows.values(),key=lambda r:(r['indexCode'],r['asOf']))


def collect_valuations(fetch_binary,codes,end):
    records=[]
    for code in codes:
        if not str(code).isalnum():raise ValueError('Invalid index code')
        url=f'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/{code}indicator.xls'
        raw=fetch_binary(url);observations=valuation_xls(raw,str(code),end)
        for row in observations:row['sourceRetrievedAt']=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
        records+=observations
    return records
