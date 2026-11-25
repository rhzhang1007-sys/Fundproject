"""News owns these public shards; the forum corpus never writes them."""
import argparse,json
from pathlib import Path
from build_global_foundation import load,write,shard
ROOT=Path(__file__).resolve().parents[2]
def publish(root=ROOT):
    root=Path(root);dist=root/'prototype/dist/data';known={r['id'] for r in load(dist/'v10/objects.json')['objects']};groups={f'{kind}s/{i:02d}.json':dict(schemaVersion=1,objects={}) for kind in ['fund','stock'] for i in range(100)};source=load(dist/'v07/events.json');count=0
    for row in source.get('events',[]):
        seen=set()
        for entity in row.get('entities',[]):
            kind=entity.get('kind');code=entity.get('code','');oid=str(kind)+code
            if kind not in ('fund','stock') or oid not in known or oid in seen:continue
            seen.add(oid);key=f'{kind}s/{shard(code)}.json';groups[key]['objects'].setdefault(oid,dict(news=[]))['news'].append(row);count+=1
    for key,value in groups.items():write(dist/'v12/news'/key,value)
    result=dict(sourceEvents=len(source.get('events',[])),objectAssociations=count,lastCheckedAt=source.get('lastCheckedAt'));write(dist/'v12/news-shard-status.json',result);return result
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=ROOT);a=p.parse_args();print(json.dumps(publish(a.root),ensure_ascii=False))
