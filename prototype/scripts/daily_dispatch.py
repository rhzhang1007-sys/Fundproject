"""Wake overdue daily source jobs from an already-running Actions job. No LLM."""
import json,os,re
from pathlib import Path
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from urllib.request import Request,urlopen

ROOT=Path(__file__).resolve().parents[2]
TZ=ZoneInfo('Asia/Shanghai')
JOBS={'nav':('daily-nav.yml',5,10),'index':('daily-index.yml',5,20),'news':('daily-public-data.yml',5,30)}
ACTIVE={'queued','in_progress','waiting','pending','requested'}

def stamp(value):
    try:
        d=datetime.fromisoformat(value.replace('Z','+00:00'))
        return d.replace(tzinfo=TZ) if d.tzinfo is None else d.astimezone(TZ)
    except (ValueError,TypeError,AttributeError):return None

def decision(job,marker,runs,settings,now=None):
    now=(now or datetime.now(TZ)).astimezone(TZ);workflow,hour,minute=JOBS[job]
    result={'job':job,'workflow':workflow,'dispatch':False,'day':now.date().isoformat()}
    def stop(reason):return {**result,'reason':reason}
    if (now.hour,now.minute)<(hour,minute):return stop('before-due-time')
    if marker.get('executionDay')==result['day'] and marker.get('executed') is True and marker.get('retryNeeded') is not True and marker.get('sourceCoverageStatus') not in ('partial','incomplete'):return stop('source-already-executed-today')
    runs=[r for r in runs if not(job=='news' and r.get('event')=='push')]
    if any(r.get('status') in ACTIVE for r in runs):return stop('job-already-active')
    today=[r for r in runs if (t:=stamp(r.get('run_started_at') or r.get('created_at'))) and t.date()==now.date()]
    if len(today)>=int(settings.get('maxAttemptsPerDay',4)):return stop('daily-attempt-cap')
    latest=max((t for r in today if (t:=stamp(r.get('updated_at') or r.get('run_started_at') or r.get('created_at')))),default=None)
    if latest and now-latest<timedelta(minutes=int(settings.get('retryMinutes',45))):return stop('retry-backoff')
    return {**result,'dispatch':True,'reason':'overdue-source-job','attemptsToday':len(today)}

def wake(root,config,request,now=None):
    settings=config.get('dailyDispatch',{})
    if config.get('enabled') is not True or settings.get('enabled') is not True:return [{'dispatch':False,'reason':'disabled'}]
    root=Path(root);results=[]
    for job,(workflow,_,_) in JOBS.items():
        try:
            p=root/f'prototype/dist/data/v14/runtime/{job}.json';marker=json.loads(p.read_text()) if p.exists() else {}
            runs=request(f'/actions/workflows/{workflow}/runs?per_page=30').get('workflow_runs',[])
            value=decision(job,marker,runs,settings,now)
            if value['dispatch']:request(f'/actions/workflows/{workflow}/dispatches',{'ref':'main'})
            results.append(value)
        except Exception as e:results.append({'job':job,'dispatch':False,'reason':'daily-wakeup-failed','errorType':type(e).__name__})
    return results

def run(root=ROOT):
    root=Path(root);config=json.loads((root/'prototype/config/public-updates.json').read_text())
    if config.get('enabled') is not True or config.get('dailyDispatch',{}).get('enabled') is not True:return [{'dispatch':False,'reason':'disabled'}]
    token=os.environ.get('GITHUB_TOKEN');repo=os.environ.get('GITHUB_REPOSITORY','')
    if not token or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo):raise ValueError('Missing Actions authorization')
    def request(route,body=None):
        req=Request('https://api.github.com/repos/'+repo+route,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},data=json.dumps(body).encode() if body is not None else None,method='POST' if body is not None else 'GET')
        with urlopen(req,timeout=15) as r:raw=r.read(3_000_000)
        return json.loads(raw) if raw else {}
    return wake(root,config,request)

if __name__=='__main__':
    try:print(json.dumps(run(),ensure_ascii=False))
    except Exception as e:print(json.dumps({'status':'daily-wakeup-failed','errorType':type(e).__name__}));raise SystemExit(2)
