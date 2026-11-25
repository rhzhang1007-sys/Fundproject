"""Public Sina stock-board HTML, including rendered post text and reply pagination.
No login, cookies, usernames or access-control bypass. Refusals stop this source.
"""
import re
from html.parser import HTMLParser
from datetime import datetime,timedelta
from urllib.parse import parse_qs,urlparse,urljoin

class Node:
    def __init__(self,tag='',attrs=()):self.tag=tag;self.attrs=dict(attrs);self.children=[]
    def text(self):return re.sub(r'\s+',' ',' '.join(x.text() if isinstance(x,Node) else x for x in self.children)).strip()
    def find(self,predicate):
        return ([self] if predicate(self) else [])+[y for x in self.children if isinstance(x,Node) for y in x.find(predicate)]
class Tree(HTMLParser):
    def __init__(self,text):
        super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root];self.feed(text)
    def handle_starttag(self,tag,attrs):
        n=Node(tag,attrs);self.stack[-1].children.append(n)
        if tag not in {'meta','link','br','img','input','hr','wbr','source','area','embed','param'}:self.stack.append(n)
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag==tag:self.stack=self.stack[:i];return
    def handle_data(self,text):
        if self.stack[-1].tag not in {'script','style'}:self.stack[-1].children.append(text)
def cls(n,value):return value in n.attrs.get('class','').split()
def read_html(fetch,url):
    raw=fetch(url,binary=True)
    if isinstance(raw,str):return raw
    return raw.decode('utf-8-sig' if re.search(br'<meta[^>]*charset\s*=\s*["\']?utf-8',raw[:4000],re.I) else 'gb18030')
def stamp(text,now):
    text=text.strip()
    m=re.fullmatch(r'(\d+)\s*(分钟|小时)前',text)
    if m:return (now-timedelta(**({'minutes':int(m[1])} if m[2]=='分钟' else {'hours':int(m[1])}))).strftime('%Y-%m-%d %H:%M:%S')
    for name,delta in [('今天',0),('昨天',1),('前天',2)]:
        if text.startswith(name):text=(now-timedelta(days=delta)).strftime('%Y-%m-%d')+' '+text[len(name):].strip()
    text=text.replace('月','-').replace('日',' ').strip()
    short=re.match(r'^(\d{1,2})-(\d{1,2})(.*)$',text)
    if short:
        text=f'{now.year}-{int(short[1]):02d}-{int(short[2]):02d}'+short[3]
        if text[:10]>now.strftime('%Y-%m-%d'):text=str(now.year-1)+text[4:]
    for pattern in ['%Y-%m-%d %H:%M:%S','%Y-%m-%d %H:%M','%Y-%m-%d']:
        try:return datetime.strptime(text,pattern).strftime('%Y-%m-%d %H:%M:%S')
        except ValueError:pass
    raise ValueError('Sina publication date unavailable')
def listing(text,symbol,object_id,now):
    tree=Tree(text).root
    # Identity evidence must be present in the page, not inferred from request URL.
    if symbol not in ''.join(n.attrs.get('content','') for n in tree.find(lambda n:n.tag=='meta')):raise ValueError('Sina board identity mismatch')
    records=[]
    for row in tree.find(lambda n:n.tag=='tr'):
        cells=row.find(lambda n:n.tag=='td')
        if len(cells)!=5:continue
        links=cells[2].find(lambda n:n.tag=='a' and 's=thread' in n.attrs.get('href',''))
        if not links:continue
        a=links[0];url=urljoin('https://guba.sina.com.cn',a.attrs['href']);q=parse_qs(urlparse(url).query);bid=q.get('bid',[''])[0];tid=q.get('tid',[''])[0]
        if not bid.isdigit() or not tid.isdigit():continue
        try:published=stamp(cells[4].text(),now)
        except ValueError:continue
        records.append({'id':'sina:'+bid+':'+tid,'objectId':object_id,'title':a.text(),'url':url,'date':published[:10],'publishedAt':published,'readCount':int(cells[0].text()) if cells[0].text().isdigit() else None,'commentCount':int(cells[1].text()) if cells[1].text().isdigit() else None,'source':'新浪股市汇','boardVerified':True,'nativeBoard':symbol,'coverage':{'body':'unknown','comments':'unknown'},'comments':[]})
    next_urls=[urljoin('https://guba.sina.com.cn',n.attrs['href']) for n in tree.find(lambda n:n.tag=='a' and n.text()=='下一页')]
    return records,next_urls[0] if next_urls else None
def detail(text,row,now):
    tree=Tree(text).root;body=tree.find(lambda n:n.attrs.get('id')=='thread_content')
    if not body:raise ValueError('Sina body not rendered')
    q=parse_qs(urlparse(row['url']).query)
    if not re.search(r"bid\s*:\s*['\"]"+re.escape(q['bid'][0]),text) or not re.search(r"tid\s*:\s*['\"]"+re.escape(q['tid'][0]),text):raise ValueError('Sina thread identity mismatch')
    times=tree.find(lambda n:cls(n,'iltp_time'));published=stamp(times[0].text(),now) if times else None
    if not published:raise ValueError('Sina thread date missing')
    comments={c['id']:c for c in row.get('comments',[])}
    for p in tree.find(lambda n:n.tag=='p' and n.attrs.get('id','').startswith('pContent_')):
        if p.text():comments[p.attrs['id']]={'id':p.attrs['id'],'text':p.text(),'at':None,'replyTo':None}
    text_body=body[0].text();clipped=len(text_body)>500000
    reported=re.search(r'回复\((\d+)\)',text);count=int(reported[1]) if reported else row.get('commentCount')
    row.update(content=text_body[:500000],publishedAt=published,date=published[:10],comments=list(comments.values()),commentCount=count)
    row['coverage']={'body':'partial' if clipped or not text_body else 'complete','comments':'complete' if type(count) is int and len(comments)==count else 'partial' if comments else 'unknown','fetchedComments':len(comments),'reportedComments':count,'bodySource':'public-rendered-html'}
    links=tree.find(lambda n:n.tag=='a' and n.text()=='下一页' and 's=thread' in n.attrs.get('href',''))
    return urljoin('https://guba.sina.com.cn',links[0].attrs['href']) if links else None
