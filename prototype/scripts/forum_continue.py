"""Continue a productive partial batch without relying only on cron delivery."""
import json,os,re
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.request import Request,urlopen
from forum_schedule import collection_day,batch_allowed
ROOT=Path(__file__).resolve().parents[2]

def plan(config,state,batch,health,runs,current_id='',now=None):
    now=now or datetime.now(ZoneInfo('Asia/Shanghai'));settings=config.get('forumDaily',{})
    if not(config.get('enabled') is True and settings.get('enabled') is True):return {'dispatch':False,'reason':'disabled'}
    allowed,reason=batch_allowed(state,settings,collection_day(settings,now),now.isoformat())
    if not allowed:return {'dispatch':False,'reason':reason}
    if health.get('status')=='ready':return {'dispatch':False,'reason':'materials-complete'}
    if any(str(r.get('id'))!=str(current_id) and r.get('status') in ('queued','in_progress','waiting','pending','requested') for r in runs):return {'dispatch':False,'reason':'continuation-already-active'}
    productive=batch.get('completedWindows',0)+batch.get('enrichedPosts',0)+batch.get('repairs',{}).get('newReadableBodies',0)>0
    if not productive or batch.get('seconds',0)<300:return {'dispatch':False,'reason':'wait-for-scheduled-retry'}
    return {'dispatch':True,'reason':'productive-partial-batch','targetDay':health.get('targetDay')}

def run(root=ROOT):
    root=Path(root);dist=root/'prototype/dist/data/v10';load=lambda p:json.loads(p.read_text()) if p.exists() else {}
    config=load(root/'prototype/config/public-updates.json');state=load(dist/'forum-state.json');batch=load(dist/'forum-batch-status.json');health=load(dist/'forum-health.json')
    token=os.environ.get('GITHUB_TOKEN');repo=os.environ.get('GITHUB_REPOSITORY','')
    if not token or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo):raise ValueError('Missing Actions authorization')
    def request(route,body=None):
        req=Request('https://api.github.com/repos/'+repo+route,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},data=json.dumps(body).encode() if body is not None else None,method='POST' if body is not None else 'GET')
        with urlopen(req,timeout=25) as r:raw=r.read(2_000_000)
        return json.loads(raw) if raw else {}
    runs=request('/actions/workflows/global-forum.yml/runs?per_page=10').get('workflow_runs',[]);result=plan(config,state,batch,health,runs,os.environ.get('GITHUB_RUN_ID',''))
    if result['dispatch']:request('/actions/workflows/global-forum.yml/dispatches',{'ref':'main','inputs':{'verify_checkpoint_only':False}})
    return result
if __name__=='__main__':
    try:print(json.dumps(run(),ensure_ascii=False))
    except Exception as e:print(json.dumps({'status':'continuation-request-failed','errorType':type(e).__name__}));raise SystemExit(2)
