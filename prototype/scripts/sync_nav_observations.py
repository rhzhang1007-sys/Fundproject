"""Merge daily source NAV into browser observations; never promotes it to total return."""
import argparse,json
from collections import defaultdict
from pathlib import Path
from build_global_foundation import load,write,shard
ROOT=Path(__file__).resolve().parents[2]

def sync(root=ROOT,snapshot=None):
    root=Path(root);dist=root/'prototype/dist/data';snapshot=Path(snapshot) if snapshot else dist/'v12/nav/latest.json';payload=load(snapshot);known={o['code'] for o in load(dist/'v10/objects.json')['objects'] if o['kind']=='fund'};groups=defaultdict(list);unknown=[]
    for row in payload.get('funds',[]):
        if row['code'] not in known:unknown.append(row['code']);continue
        groups[shard(row['code'])].append(row)
    updated=0
    for key,rows in groups.items():
        path=dist/'v11/observations'/f'{key}.json';data=load(path) if path.exists() else dict(schemaVersion=1,funds={})
        for row in rows:
            ob=data['funds'].setdefault(row['code'],{})
            if not ob.get('snapshot') or row['date']>=ob['snapshot']['date']:ob['snapshot']=row;updated+=1
            # Retain the fetched observation separately; a missing history is not invented.
            history=ob.get('history')
            if history and history.get('status')=='ok' and row.get('nav') is not None:
                points={p[0]:p for p in history.get('points',[])};points[row['date']]=[row['date'],row['nav'],row.get('accNav'),row.get('dayChange')];history['points']=[points[d] for d in sorted(points)];history['count']=len(points)
            ob['lastSnapshotFetchedAt']=payload.get('fetchedAt');ob['totalReturnVerified']=False
        write(path,data)
    report=dict(updated=updated,unknownCodes=unknown,asOf=payload.get('asOf'),source='daily-nav-source-observations',verifiedTotalReturn=False);write(dist/'v12/nav-sync-status.json',report);return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--snapshot',type=Path);a=p.parse_args();print(json.dumps(sync(a.root,a.snapshot),ensure_ascii=False))
