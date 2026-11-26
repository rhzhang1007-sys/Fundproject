"""Run bounded sample/error repairs inside the existing single corpus writer."""
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import time
import refresh_public_data as u
from public_post_material import merge_material

def repair_queue(root,state,registry,activity,checkpoint,deadline,collector=None,limit=4):
    if collector is None:
        from forum_object import collect
        collector=collect
    now=datetime.now(ZoneInfo('Asia/Shanghai'));today=now.date();known={x['id']:x for x in registry};attempted=0;improved=0
    for item in state.get('retryQueue',[]):
        if attempted>=limit or time.monotonic()>deadline-35:break
        if item.get('nextAttemptAt','')>now.isoformat() or not (today-timedelta(days=3)).isoformat()<=item.get('date','')<today.isoformat():continue
        obj=known.get(item.get('objectId'))
        if not obj:continue
        forum=activity(obj);day=item['date'];snapshots=forum.setdefault('repairSnapshots',{});initial={**snapshots.get(day,{}),'objectId':obj['id'],'date':day,'records':[r for r in forum.get('records',[]) if r.get('date')==day]};initial.setdefault('sources',{})
        attempted+=1
        try:
            result=collector(root,obj['id'],day,min(45,int(deadline-time.monotonic())),providers=('eastmoney',),initial=initial,known_only=item.get('stage')=='material')
            snapshots[day]={k:v for k,v in result.items() if k!='records'}
            for previous in list(snapshots):
                if previous<(today-timedelta(days=3)).isoformat():del snapshots[previous]
            if any(t.get('error')=='source-refused' for t in result.get('sources',{}).values()):raise u.SourceRefused('Repair source refused')
            old={r['id']:r for r in forum.get('records',[])}
            for row in result.get('records',[]):
                before=old.get(row['id'],{});improved+=int(bool(row.get('content')) and not before.get('content'))
                old[row['id']]=merge_material(before,row)
            forum['records']=list(old.values())
            if item.get('stage')=='list':
                status=result.get('sources',{}).get('eastmoney',{}).get('status','pending-pages')
                state['objects'].setdefault(obj['id'],{}).setdefault('dayWindows',{})[day]=status
            item.pop('error',None)
        except u.SourceRefused:raise
        except (ValueError,RuntimeError,OSError) as exc:item['error']=str(exc)[:160]
        tries=(item.get('attempts',0)%3)+1;item['attempts']=tries;item['lastAttemptAt']=now.isoformat(timespec='seconds');item['nextAttemptAt']=(now+timedelta(minutes=[20,60,240][tries-1])).isoformat(timespec='seconds')
        activity(obj);checkpoint()
    return dict(attempted=attempted,newReadableBodies=improved)
