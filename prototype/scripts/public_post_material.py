"""Preserve collected text and hydrate a known public post without rescanning lists."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import refresh_public_data as u
from public_comments import read_comments

def merge_material(old, new):
    merged={**old,**new}
    if old.get('content') and (not new.get('content') or len(old['content'])>len(new['content'])):
        merged['content']=old['content']
    merged['comments']=list({str(c['id']):c for c in [*(old.get('comments') or []),*(new.get('comments') or [])] if c.get('id')}.values())
    coverage={**(old.get('coverage') or {}),**(new.get('coverage') or {})}
    if merged.get('content')==old.get('content') and (old.get('coverage') or {}).get('body')=='complete':coverage['body']='complete'
    count=merged.get('commentCount')
    if old.get('commentCount')!=count:
        merged.pop('commentCursor',None)
        coverage['comments']='partial' if merged['comments'] else 'unknown'
    elif (old.get('coverage') or {}).get('comments')=='complete' and not new.get('comments'):
        coverage['comments']='complete'
    coverage['fetchedComments']=len(merged['comments']);merged['coverage']=coverage
    return merged

def pending(row, now=None):
    now=now or datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
    return (row.get('materialRetryAfter') or '')<=now and ((row.get('coverage') or {}).get('body')!='complete' or (row.get('coverage') or {}).get('comments')!='complete')

def hydrate(fetch, row, pages=3):
    """Body and comment requests fail independently. Existing text is never erased."""
    failures=[];attempted=0;row['coverage']=row.get('coverage') or {};row['comments']=row.get('comments') or []
    if (row.get('coverage') or {}).get('body')!='complete':
        attempted+=1
        try:
            result=u.detail_record(fetch(row['url']),row.get('commentCount'),max_chars=500000,expected_post=row)
            merged=merge_material(row,result);row.clear();row.update(merged)
            if row['coverage'].get('body')!='complete':failures.append('body-not-readable')
        except u.SourceRefused:raise
        except (ValueError,RuntimeError,OSError) as exc:failures.append(str(exc)[:160])
    if (row.get('coverage') or {}).get('comments')!='complete':
        # A known zero is a source observation, not a fabricated empty response.
        if row.get('commentCount')==0 and not row.get('comments'):
            row.setdefault('coverage',{}).update(comments='complete',reportedComments=0,fetchedComments=0)
        else:
            attempted+=1
            try:read_comments(fetch,row,pages)
            except u.SourceRefused:raise
            except (ValueError,RuntimeError,OSError) as exc:failures.append(str(exc)[:160])
            if (row.get('coverage') or {}).get('commentError'):failures.append(row['coverage']['commentError'])
    now=datetime.now(ZoneInfo('Asia/Shanghai'));row['materialCheckedAt']=now.isoformat(timespec='seconds')
    if failures:
        row['materialErrors']=failures
        row['materialRetryAfter']=(now+timedelta(minutes=20)).isoformat(timespec='seconds')
    else:
        row.pop('materialErrors',None);row.pop('materialRetryAfter',None)
    return attempted
