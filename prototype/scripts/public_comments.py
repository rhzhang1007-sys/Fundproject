"""Public comment pagination, including child replies. Never treats a repeated page as complete."""
import json,hashlib
from urllib.parse import urlencode
import refresh_public_data as u

BASE='https://gbapi.eastmoney.com/'

def comment(x,parent=None):
    cid=str(x.get('reply_id') or '');text=u._text(str(x.get('reply_text') or ''))
    if not cid.isdigit() or not text:raise ValueError('Invalid public comment identity/text')
    # Public comments need no user ID, nickname, IP region or account metadata.
    return dict(id=cid,text=text,at=str(x.get('reply_publish_time') or x.get('reply_time') or '')[:19],replyTo=parent)

def read_comments(fetch,row,max_pages=3):
    state=row.setdefault('commentCursor',dict(page=1,topIds=[],children={},lastSignature=None,done=False))
    if state.get('blocked'):return dict(requests=0,complete=False)
    if state.get('done') and row.get('coverage',{}).get('comments')=='complete':return
    found={x['id']:x for x in row.get('comments',[]) if x.get('id')};tops=set(state.get('topIds',[]));children=state.setdefault('children',{});coverage=row.setdefault('coverage',{});requests=0;reported=None
    def call(route,params):
        nonlocal requests
        requests+=1;payload=json.loads(fetch(BASE+route+'?'+urlencode({**params,'plat':'Web','version':'2022','product':'Guba'})))
        if payload.get('rc')!=1:raise ValueError('Public comment source rejected/schema changed')
        return payload
    try:
        for _ in range(max_pages):
            if state.get('topDone'):break
            data=call('reply/api/Reply/WebArticleNewReplyList',dict(postid=row['id'],sort=1,sorttype=1,p=state['page'],ps=30,needHide='true'))
            items=data.get('re');reported=data.get('reply_total_count');count=data.get('count')
            if not isinstance(items,list) or type(count) is not int or type(reported) is not int or count<0 or reported<0:raise ValueError('Comment source counts missing')
            state['reportedTotal']=reported;state['reportedTop']=count
            signature=hashlib.sha256(','.join(str(x.get('reply_id')) for x in items).encode()).hexdigest()
            if items and signature==state.get('lastSignature'):raise ValueError('Repeated comment page; source did not paginate')
            state['lastSignature']=signature
            for x in items:
                parent=comment(x);tops.add(parent['id']);found[parent['id']]=parent
                child_rows=x.get('child_replys') or []
                if not isinstance(child_rows,list):raise ValueError('Child comment schema changed')
                for child in child_rows:found[str(child['reply_id'])]=comment(child,parent['id'])
                expected=x.get('reply_count')
                if type(expected) is int and expected>sum(v.get('replyTo')==parent['id'] for v in found.values()):children.setdefault(parent['id'],dict(page=1,expected=expected,lastSignature=None))
            state['page']+=1
            if len(tops)>=count:state['topDone']=True;break
            if not items:raise ValueError('Public comment source exhausted before reported count')
        for parent,task in list(children.items()):
            if requests>=max_pages:break
            data=call('reply/api/Reply/ArticleReplyDetail',dict(postid=row['id'],replyid=parent,sort=1,sorttype=1,p=task['page'],ps=10,needHide='true'))
            obj=data.get('re');items=obj.get('child_replys') if isinstance(obj,dict) else None
            if not isinstance(items,list):raise ValueError('Child comment detail schema changed')
            signature=tuple(str(x.get('reply_id')) for x in items)
            if items and list(signature)==task.get('lastSignature'):raise ValueError('Repeated child comment page')
            task.update(lastSignature=list(signature),page=task['page']+1)
            for child in items:found[str(child['reply_id'])]=comment(child,parent)
            if sum(v.get('replyTo')==parent for v in found.values())>=task['expected']:del children[parent]
            elif not items:raise ValueError('Child comments exhausted before reported count')
        total=state.get('reportedTotal');state['done']=bool(state.get('topDone') and not children and type(total) is int and len(found)==total)
        if state['done']:coverage.pop('commentError',None)
    except (ValueError,RuntimeError,OSError) as exc:
        if isinstance(exc,u.SourceRefused):raise
        coverage['commentError']=str(exc)[:160]
        if 'Repeated' in str(exc):state['blocked']='source-pagination-repeated'
    finally:
        state['topIds']=sorted(tops);row['comments']=list(found.values());coverage.update(comments='complete' if state.get('done') else 'partial' if found else 'unknown',fetchedComments=len(found),reportedComments=state.get('reportedTotal',row.get('commentCount')),commentSource='public-web-and-child-pagination')
    return dict(requests=requests,complete=state.get('done',False))
