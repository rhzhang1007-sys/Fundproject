"""Publish an existing collector commit, retrying only non-fast-forward races."""
import argparse,json,subprocess,time
from pathlib import Path

def publish(root,attempts=5,runner=subprocess.run,sleep=time.sleep):
    root=Path(root)
    if not 1<=attempts<=8:raise ValueError('Publish attempts must be between 1 and 8')
    def git(*args):
        return runner(['git',*args],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    for attempt in range(1,attempts+1):
        pulled=git('-c','rebase.autoStash=true','pull','--rebase','origin','main')
        if pulled.returncode:
            git('rebase','--abort')
            raise RuntimeError('Could not rebase collector commit; retained local commit')
        pushed=git('push','origin','HEAD:main')
        if not pushed.returncode:return {'status':'published','attempts':attempt}
        message=(pushed.stderr or '')+'\n'+(pushed.stdout or '')
        if not any(x in message.lower() for x in ['[rejected]','non-fast-forward','fetch first']):
            raise RuntimeError('Collector publish failed for a non-concurrency reason')
        if attempt<attempts:sleep(min(2**attempt,16))
    raise RuntimeError('Concurrent writes exceeded bounded retry; retained collector checkpoint')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);p.add_argument('--attempts',type=int,default=5);a=p.parse_args()
    try:print(json.dumps(publish(a.root,a.attempts)))
    except (RuntimeError,ValueError) as exc:print(json.dumps({'status':'publish-failed','reason':str(exc)}));raise SystemExit(1)
