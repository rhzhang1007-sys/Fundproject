"""Check GitHub runner activity; request one collector continuation when overdue.
Uses the Actions GITHUB_TOKEN only. Does not fetch posts or call a model.
"""
import os,json,re,argparse
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from urllib.request import Request,urlopen
from forum_schedule import collection_day,batch_allowed
ROOT=Path(__file__).resolve().parents[2]

def decision(runs,now=None,stale_minutes=45):
    now=now or datetime.now(timezone.utc)
    if any(r.get('status') in ('queued','in_progress','waiting','pending','requested') for r in runs):return dict(dispatch=False,reason='collector-active')
    ordered=sorted(runs,key=lambda r:r.get('updated_at') or r.get('created_at') or '',reverse=True)
    if not ordered:return dict(dispatch=True,reason='no-collector-run')
    stamp=ordered[0].get('updated_at') or ordered[0]['created_at'];age=(now-datetime.fromisoformat(stamp.replace('Z','+00:00'))).total_seconds()/60
    return dict(dispatch=age>stale_minutes,reason='collector-overdue' if age>stale_minutes else 'recent-collector-run',lastRunId=ordered[0].get('id'),minutesSinceRun=round(age,1))

def run(root=ROOT,requester=None):
    config=json.loads((Path(root)/'prototype/config/public-updates.json').read_text())
    if not(config.get('enabled') is True and config.get('forumDaily',{}).get('enabled') is True):return dict(dispatch=False,reason='disabled')
    state_path=Path(root)/'prototype/dist/data/v10/forum-state.json';state=json.loads(state_path.read_text()) if state_path.exists() else {}
    allowed,reason=batch_allowed(state,config.get('forumDaily',{}),collection_day(config.get('forumDaily',{})),datetime.now(ZoneInfo('Asia/Shanghai')).isoformat())
    if not allowed:return dict(dispatch=False,reason=reason)
    token=os.environ.get('GITHUB_TOKEN');repo=os.environ.get('GITHUB_REPOSITORY','')
    if not token or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo):raise ValueError('Missing Actions authorization')
    def request(route,body=None):
        if requester:return requester(route,body)
        headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
        if body is not None:headers['Content-Type']='application/json'
        req=Request('https://api.github.com/repos/'+repo+route,headers=headers,data=json.dumps(body).encode() if body is not None else None,method='POST' if body is not None else 'GET')
        with urlopen(req,timeout=25) as r:raw=r.read(2_000_000)
        return json.loads(raw) if raw else {}
    runs=request('/actions/workflows/global-forum.yml/runs?per_page=10').get('workflow_runs',[]);result=decision(runs)
    if result['dispatch']:request('/actions/workflows/global-forum.yml/dispatches',{'ref':'main','inputs':{'verify_checkpoint_only':False}})
    return result

if __name__=='__main__':
    try:print(json.dumps(run(),ensure_ascii=False))
    except Exception as e:print(json.dumps({'status':'watchdog-failed','errorType':type(e).__name__}));raise SystemExit(2)
