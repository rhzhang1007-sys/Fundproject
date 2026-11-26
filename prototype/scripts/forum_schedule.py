"""A collection day rolls at 05:00 China time; overnight runs finish the same target."""
from datetime import datetime,timedelta,timezone
from zoneinfo import ZoneInfo

def collection_day(settings=None,now=None):
    now=now or datetime.now(ZoneInfo('Asia/Shanghai'));now=now.astimezone(ZoneInfo('Asia/Shanghai'));hour=int((settings or {}).get('dayBoundaryHourCST',5))
    return now.date()-timedelta(days=1) if now.hour<hour else now.date()

def batch_allowed(state,settings,day,now):
    stamp=state.get('cooldownUntil')
    if stamp:
        try:
            until=datetime.fromisoformat(stamp.replace('Z','+00:00'));current=datetime.fromisoformat(now.replace('Z','+00:00'))
            if until.tzinfo is None:until=until.replace(tzinfo=ZoneInfo('Asia/Shanghai'))
            if current.tzinfo is None:current=current.replace(tzinfo=ZoneInfo('Asia/Shanghai'))
            if until>current:return False,'source-cooldown'
        except (ValueError,TypeError):return False,'invalid-cooldown-state'
    if state.get('batchDate')==day.isoformat() and state.get('batchesStarted',0)>=int(settings.get('maxBatchesPerDay',72)):return False,'daily-batch-cap'
    return True,'ready'
