"""Source-first news ingestion and explicit entity/topic tagging.

No model is needed to read public feeds, preserve dates, or identify explicit codes.
This module never reads the active fund-basics JSONL or writes the WorkBuddy package.
"""
from collections import defaultdict, deque
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlencode, urljoin
from zoneinfo import ZoneInfo
from refresh_public_data import SourceRefused

GENERIC={'太阳能','新能源','新能源汽车','机器人','人工智能','半导体','有色金属','传媒','科技','银行','金融','中国','ETF','CPO'}
TOPICS=[('earnings','业绩',r'业绩|净利润|营业收入|财报|年报|季报|中期报告'),('orders','订单与经营',r'订单|中标|签订|合同|产能|投产|经营'),('policy','政策与监管',r'政策|监管|证监会|央行|意见|办法|处罚|警示函'),('capital','资本事项',r'回购|增持|减持|分红|融资|定增|重组|收购|合并|清算|终止上市'),('product','基金产品',r'基金经理|费率|托管|申购|赎回|基金合同|产品资料|招募说明书'),('research','研究观点',r'研报|研究报告|评级|分析师|机构观点'),('market','市场交易',r'涨停|跌停|成交|大宗交易|资金流|停牌|复牌')]

def norm(text):return unicodedata.normalize('NFKC',str(text or '')).strip()
def tidy(text):
    import html
    return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',str(text or '')))).strip()

def topics(title):return [dict(id=i,label=label) for i,label,rx in TOPICS if re.search(rx,title)] or [dict(id='other',label='其他')]


class EntityIndex:
    """Aho-Corasick names + a scoped exact-code dictionary. Conflicts remain candidates."""
    def __init__(self,entities):
        self.entities={(e.get('kind','stock'),e['code']):e for e in entities}
        words=defaultdict(set)
        for key,e in self.entities.items():
            names=e.get('matchKeywords')
            if names is None:names=[e.get('name'),e.get('fullName'),*e.get('aliases',[])]
            for word in names:
                if isinstance(word,dict):continue
                word=norm(word)
                if len(word)<3 or word in GENERIC:continue
                words[word].add(key)
        self.codes=defaultdict(list)
        for key in self.entities:self.codes[key[1]].append(key)
        self.words=words;self.next=[{}];self.fail=[0];self.outputs=[[]]
        for word,keys in words.items():
            state=0
            for char in word:
                if char not in self.next[state]:
                    self.next[state][char]=len(self.next);self.next.append({});self.fail.append(0);self.outputs.append([])
                state=self.next[state][char]
            self.outputs[state].append((word,keys))
        q=deque(self.next[0].values())
        while q:
            state=q.popleft()
            for char,target in self.next[state].items():
                q.append(target);f=self.fail[state]
                while f and char not in self.next[f]:f=self.fail[f]
                self.fail[target]=self.next[f].get(char,0);self.outputs[target]+=self.outputs[self.fail[target]]

    def tag(self,text,explicit=()):
        text=norm(text);state=0;matches=[];hints=[];out={}
        for i,char in enumerate(text):
            while state and char not in self.next[state]:state=self.fail[state]
            state=self.next[state].get(char,0)
            for word,keys in self.outputs[state]:
                a=i+1-len(word);b=i+1
                if re.fullmatch(r'[A-Za-z0-9 .&-]+',word) and ((a and text[a-1].isalnum()) or (b<len(text) and text[b].isalnum())):continue
                matches.append((a,b,word,keys))
        # Suppress nested short names only at the same occurrence, never elsewhere in the article.
        matches.sort(key=lambda x:(x[0],-(x[1]-x[0])))
        farthest=-1
        for a,b,word,keys in matches:
            if b<=farthest:continue
            farthest=max(farthest,b)
            if len(keys)!=1:
                hints.append(dict(text=word,candidates=[dict(kind=k,code=c) for k,c in sorted(keys)]));continue
            key=next(iter(keys));e=self.entities[key]
            out[key]=dict(kind=key[0],code=key[1],name=e.get('name') or key[1],basis='unambiguous-name',matchedText=word)
        for role,code in re.findall(r'(基金|股票|证券)\s*(?:代码)?\s*[:：]?\s*(\d{6})(?!\d)',text):
            keys=[k for k in self.codes.get(code,[]) if role=='证券' or k[0]==('fund' if role=='基金' else 'stock')]
            if len(keys)==1:explicit=[*explicit,keys[0]]
        for key in explicit:
            key=tuple(key)
            if key in self.entities:
                e=self.entities[key];out[key]=dict(kind=key[0],code=key[1],name=e.get('name') or key[1],basis='source-security-code')
        return sorted(out.values(),key=lambda e:(e['kind'],e['code'])),hints


def runtime_entities(root):
    root=Path(root)
    global_registry=root/'prototype/dist/data/v10/entity-aliases.json'
    if global_registry.exists():return json.loads(global_registry.read_text())['entities']
    stocks=json.loads((root/'prototype/dist/data/v09/security-identities.json').read_text())['stocks']
    funds=json.loads((root/'prototype/dist/data/v07/funds-l1.json').read_text())
    return [dict(**s,kind='stock') for s in stocks]+[dict(kind='fund',code=c,name=n,matchKeywords=[n]) for c,n,_ in funds]


def _event(id,title,text,published,url,source,kind,index,explicit=()):
    title=tidy(title);text=tidy(text)
    tags,hints=index.tag(title+' '+text,explicit)
    # An issuer code supplied by the disclosure source remains primary even when the
    # article also mentions another, already-known company.
    tags += [dict(kind=k,code=c,name=c,basis='source-code-unmatched-master') for k,c in explicit
             if (k,c) not in index.entities and re.fullmatch(r'\d{6}',c)]
    context_topics=topics(title)
    if not tags and any(t['id'] in ('policy','market') for t in context_topics):
        tags=[dict(kind='market',code='CN-MARKET',name='市场环境',basis='market-context-only')]
    if not tags:tags=[dict(kind='unassigned',code='CN-UNASSIGNED',name='待归属资讯',basis='source-read-entity-unresolved')]
    first=tags[0]
    return dict(id=id,sourceRecordId=id,entityCode=first['code'],entityName=first['name'],entityCodes=sorted({t['code'] for t in tags}),entities=tags,
        title=title,summary=text,date=published[:10],publishedAt=published,url=url,source=source,kind=kind,
        topics=topics(title),entityHints=hints,summaryBasis='source-excerpt' if kind=='资讯' else 'title-only',
        contentCoverage='source-feed' if kind=='资讯' else 'title-only',originPublishedAt=None,publicationTimeBasis='source-feed-publish-or-show-time',eventOccurredAt=None)


def fast_page(payload,index):
    if str(payload.get('code'))!='1' or not isinstance(payload.get('data'),dict):raise ValueError('Fast-news business response failed')
    data=payload['data'];rows=data.get('fastNewsList')
    if not isinstance(rows,list):raise ValueError('Fast-news schema changed')
    events=[];dates=[]
    for x in rows:
        at=str(x.get('showTime') or '');datetime.strptime(at[:19],'%Y-%m-%d %H:%M:%S');dates.append(at[:10])
        explicit=[]
        for raw in x.get('stockList') or []:
            m=re.fullmatch(r'(0|1|2)\.(\d{6})',str(raw))
            if m:
                market,code=m.groups();keys=index.codes.get(code,[])
                stock=index.entities.get(('stock',code))
                exchange={'0':'SZSE','1':'SSE','2':'BSE'}[market]
                if stock and stock.get('exchange')==exchange:explicit.append(('stock',code))
                # This mixed security list also contains indices. A number matching
                # only a fund directory entry does not prove that fund is the issuer.
        code=str(x.get('code') or '')
        if not code.isdigit():raise ValueError('Missing article identity')
        e=_event('fast:'+code,x.get('title'),x.get('summary'),at,f'https://finance.eastmoney.com/a/{code}.html','东方财富快讯','资讯',index,explicit)
        if e:
            e['sourceSecurityRefs']=[raw for raw in x.get('stockList') or [] if isinstance(raw,str) and re.fullmatch(r'\d{1,3}\.[A-Z0-9]{1,16}',raw)]
            events.append(e)
    return events,dates,str(data.get('sortEnd') or '')


def collect_fast(fetch,index,start,end,max_pages=80,page_size=100):
    rows=[];seen=set();scanned=0
    cursor=''
    for page in range(max_pages):
        params=dict(client='web',biz='web_724',fastColumn='102',sortEnd=cursor,pageSize=page_size,req_trace='fundproject-public-news')
        payload=json.loads(fetch('https://np-listapi.eastmoney.com/comm/web/getFastNewsList?'+urlencode(params)))
        events,dates,next_cursor=fast_page(payload,index);scanned+=len(payload['data']['fastNewsList'])
        rows.extend(e for e in events if start<=e['date']<=end)
        if not dates:return rows,dict(status='source-exhausted',pages=page+1,scanned=scanned)
        # Sorting is source-defined. Validate descending date order before using an old boundary.
        if dates==sorted(dates,reverse=True) and max(dates)<start:return rows,dict(status='date-boundary',pages=page+1,scanned=scanned)
        if not next_cursor or next_cursor in seen:raise ValueError('Fast-news pagination repeated/missing cursor')
        seen.add(next_cursor);cursor=next_cursor
    return rows,dict(status='partial-page-limit',pages=max_pages,scanned=scanned)


def fund_page(payload,index):
    if payload.get('ErrCode') not in (0,None) or not isinstance(payload.get('Data'),list):raise ValueError('Fund announcement schema/business error: '+str(payload.get('ErrCode'))+' '+str(payload.get('ErrMsg') or '')[:100])
    events=[];dates=[]
    for x in payload['Data']:
        code=str(x.get('FUNDCODE') or '');date=str(x.get('PUBLISHDATEDesc') or x.get('PUBLISHDATE') or '')[:10]
        datetime.strptime(date,'%Y-%m-%d');dates.append(date)
        aid=str(x.get('ID') or '')
        if not re.fullmatch(r'AN\d+',aid) or not re.fullmatch(r'\d{6}',code):raise ValueError('Invalid fund announcement identity')
        e=_event('fundann:'+aid,x.get('TITLE'),'',date,f'https://fund.eastmoney.com/gonggao/{code},{aid}.html','基金公告（东方财富披露索引）','公告',index,[('fund',code)])
        if e:events.append(e)
    return events,dates


def collect_fund_announcements(fetch,index,start,end,max_pages=100):
    rows=[];seen=set();scanned=0
    for page in range(1,max_pages+1):
        try:
            data=json.loads(fetch('https://api.fund.eastmoney.com/f10/JJGG?'+urlencode(dict(fundcode='',pageIndex=page,pageSize=100,type=0))))
            events,dates=fund_page(data,index)
        except SourceRefused:raise
        except (ValueError,RuntimeError,OSError) as exc:
            fallback,check=collect_cninfo_funds(fetch,index,start,end,min(max_pages,100))
            return rows+fallback,dict(status='partial-source-fallback',primaryError=str(exc),primaryScanned=scanned,fallback=check,scope='CNINFO fund-disclosure column; not all domestic fund announcements')
        scanned+=len(data['Data'])
        signature=tuple(x.get('ID') for x in data['Data'])
        if signature and signature in seen:raise ValueError('Fund announcement pagination repeated')
        seen.add(signature);rows.extend(e for e in events if start<=e['date']<=end)
        if not dates or (dates==sorted(dates,reverse=True) and max(dates)<start):return rows,dict(status='date-boundary',pages=page,scanned=scanned)
    return rows,dict(status='partial-page-limit',pages=max_pages,scanned=scanned)


def collect_cninfo_funds(fetch,index,start,end,max_pages=100):
    rows=[];seen=set();scanned=0
    for page in range(1,max_pages+1):
        data=json.loads(fetch('https://www.cninfo.com.cn/new/hisAnnouncement/query',dict(pageNum=page,pageSize=30,column='fund',plate='',tabName='fulltext',seDate=start+'~'+end,searchkey='',isHLtitle='true')))
        items=data.get('announcements');total=data.get('totalAnnouncement')
        if items is None and total==0:items=[]
        if not isinstance(items,list) or type(total) is not int:raise ValueError('CNINFO fund disclosure schema changed')
        signature=tuple((x.get('announcementId'),x.get('secCode')) for x in items)
        if signature and signature in seen:raise ValueError('CNINFO fund pagination repeated')
        seen.add(signature);scanned+=len(items)
        for x in items:
            code=str(x.get('secCode') or '')
            if not re.fullmatch(r'\d{6}',code):continue
            at=datetime.fromtimestamp(x['announcementTime']/1000,ZoneInfo('Asia/Shanghai')).isoformat()
            if not start<=at[:10]<=end:continue
            e=_event('cninfo-fund:'+str(x['announcementId']),x['announcementTitle'],'',at,urljoin('https://static.cninfo.com.cn/',x['adjunctUrl']),'巨潮基金披露','公告',index,[('fund',code)])
            if e:rows.append(e)
        if not data.get('hasMore'):
            if scanned!=total:raise ValueError('CNINFO fund source total mismatch')
            return rows,dict(status='source-exhausted',pages=page,scanned=scanned,reportedTotal=total)
    return rows,dict(status='partial-page-limit',pages=max_pages,scanned=scanned,reportedTotal=total)


def company_page(data,index,plate,start,end):
    items=data.get('announcements');total=data.get('totalAnnouncement')
    if items is None and total==0:items=[]
    if not isinstance(items,list) or type(total) is not int or total<0:raise ValueError('Company announcements schema changed')
    expected={'sz':'SZ','sh':'SH','bj':'BJ'}[plate];rows=[]
    for x in items:
        # The historical endpoint uses column=szse for all three exchanges;
        # the explicit plate performs the actual filtering. Detect ignored filters.
        if not str(x.get('pageColumn','')).startswith(expected):raise ValueError('Company market filter ignored')
        code=str(x.get('secCode') or '');at=datetime.fromtimestamp(x['announcementTime']/1000,ZoneInfo('Asia/Shanghai')).isoformat()
        if not start<=at[:10]<=end:continue
        if not re.fullmatch(r'\d{6}',code):continue
        e=_event('cninfo:'+str(x['announcementId']),x.get('announcementTitle'),'',at,urljoin('https://static.cninfo.com.cn/',x['adjunctUrl']),'巨潮资讯','公告',index,[('stock',code)])
        if e:rows.append(e)
    return rows,items,total


def collect_company_announcements(fetch,index,start,end,max_pages=60):
    rows=[];checks={}
    for plate in ['sz','sh','bj']:
        seen=set();total=None;scanned=0
        for page in range(1,max_pages+1):
            data=json.loads(fetch('https://www.cninfo.com.cn/new/hisAnnouncement/query',dict(pageNum=page,pageSize=30,column='szse',plate=plate,tabName='fulltext',seDate=start+'~'+end,searchkey='',isHLtitle='true')))
            events,items,total=company_page(data,index,plate,start,end)
            signature=tuple((x.get('announcementId'),x.get('secCode')) for x in items)
            if signature and signature in seen:raise ValueError('Company announcement pagination repeated')
            seen.add(signature);scanned+=len(items)
            rows+=events
            if not data.get('hasMore'):break
        if not data.get('hasMore') and scanned!=total:raise ValueError('Company source total mismatch')
        checks[plate]=dict(status='source-exhausted' if not data.get('hasMore') else 'partial-page-limit',pages=page,scanned=scanned,reportedTotal=total)
    return rows,checks


def prepare_events(events):
    # Stable IDs make the same event safe to reference from different securities and UI controls.
    for e in events:
        e['id']='evt-'+hashlib.sha256((e['date']+'\n'+e.get('sourceRecordId',e['url'])).encode()).hexdigest()[:24]
    return events
