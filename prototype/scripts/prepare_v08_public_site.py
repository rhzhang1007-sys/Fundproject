"""Prepare the active static app only. No local accounts, Team Hub, database or legacy UI."""
import argparse
import json
from pathlib import Path
import re
import shutil
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
PAGES_TARGET_BYTES = 850_000_000


def prepare(root, destination, *, profile='full', revision='', api_origin=None):
    source = root / 'prototype/dist'
    if profile not in ('full','pages'):raise ValueError('Unknown public package profile')
    if profile=='pages' and not re.fullmatch('[a-f0-9]{40}',revision):raise ValueError('Pages requires the exact public-data commit')
    if api_origin:
        u=urlparse(api_origin)
        if u.scheme!='https' or not u.netloc or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:raise ValueError('Public API origin must be an HTTPS origin')
    initial=(source/'initial-holdings.mjs').read_text()
    initial_shards={code[-2:] for code in re.findall(r"code:'([0-9]{6})'",initial)}
    def filtered(folder,names):
        relative=Path(folder).relative_to(source).as_posix()
        if profile=='pages' and relative=='data/v11/observations':return [n for n in names if n.endswith('.json') and n[:-5] not in initial_shards]
        if profile=='pages' and relative=='data/v12/nav':return names
        return []
    def tree(src,dst):shutil.copytree(src,dst,dirs_exist_ok=True,ignore=filtered)
    allowed = {'index.html', 'natural.css', 'v07.css', 'v08.css', 'v15.css'}
    pending = ['v08.mjs']
    while pending:
        name = pending.pop()
        if name in allowed:
            continue
        allowed.add(name)
        text = (source / name).read_text()
        for rel in re.findall(r"(?:from\s*|import\s*)['\"]\./([^'\"]+)['\"]", text):
            if not rel.endswith('.mjs') or '/' in rel:
                raise ValueError('Unexpected module dependency')
            pending.append(rel)
    for name in allowed:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, target)
    for name in ['data/analytics.json', 'data/v07/funds-l1.json', 'data/v07/events.json', 'data/v08/forum.json', 'data/v08/evidence.json', 'data/v08/reference.json', 'data/v09/industry.json', 'data/v09/security-identities.json', 'vendor/book-open.svg']:
        target = destination / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source / name, target)
    for name in ['data/v08/llm-usage.json','data/v09/update-status.json','data/v09/market-daily.json']:
        extra=source/name
        if extra.exists():
            target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(extra,target)
    global_data=source/'data/v10'
    if global_data.exists():
        for filename in ['objects.json','entity-aliases.json','foundation-manifest.json','coverage.json']:
            if (global_data/filename).exists():
                target=destination/'data/v10'/filename;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(global_data/filename,target)
        for folder in ['foundation','activity','relationships']:
            if (global_data/folder).exists():tree(global_data/folder,destination/'data/v10'/folder)
    if (source/'data/v12').exists():tree(source/'data/v12',destination/'data/v12')
    if (source/'data/v13').exists():tree(source/'data/v13',destination/'data/v13')
    if (source/'data/v14').exists():tree(source/'data/v14',destination/'data/v14')
    if (source/'data/v16').exists():tree(source/'data/v16',destination/'data/v16')
    if (source/'data/v17').exists():tree(source/'data/v17',destination/'data/v17')
    if (source/'data/v24').exists():tree(source/'data/v24',destination/'data/v24')
    catalog=json.loads((source/'data/catalog.json').read_text());catalog.pop('defaultWeights',None);catalog['sources']=[s for s in catalog.get('sources',[]) if s.get('visibility')!='internal']
    overnight=source/'data/v11'
    if overnight.exists():tree(overnight,destination/'data/v11')
    target=destination/'data/catalog.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')))
    # This source file contains public fund data; remove the old default portfolio proportions.
    data = json.loads((source / 'data/v07/portfolio.json').read_text())
    data.pop('defaults', None)
    target = destination / 'data/v07/portfolio.json'; target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    archived = source / 'data/archive'
    if archived.exists():
        tree(archived, destination / 'data/archive')
    for removed in ('app.mjs', 'v07.mjs', 'v07-history.mjs', 'management-ui.mjs', 'index-v06.html', 'data/comments.json'):
        if (destination / removed).exists():
            raise ValueError('Legacy file unexpectedly present in public output')
    if profile=='pages':
        cfg=destination/'deployment-config.mjs';text=cfg.read_text()
        text=re.sub(r"export const DATA_REVISION=.*?;",'export const DATA_REVISION='+json.dumps(revision)+';',text)
        if api_origin is not None:text=re.sub(r"export const API_ORIGIN=.*?;",'export const API_ORIGIN='+json.dumps(api_origin.rstrip('/'))+';',text)
        cfg.write_text(text)
        # Forum material grows every day. Keep analysis/holdings local and move
        # only large, public forum JSON to the existing immutable fallback reader.
        files=[p for p in destination.rglob('*') if p.is_file()]
        size=sum(p.stat().st_size for p in files)
        initial_codes=set(re.findall(r"code:'([0-9]{6})'",initial))
        movable=[p for folder in ['data/v10/activity','data/v12/posts'] for p in (destination/folder).rglob('*.json')]
        movable.sort(key=lambda p:(p.parent.name=='funds' and p.stem in initial_codes,-p.stat().st_size,p.as_posix()))
        for p in movable:
            if size<=PAGES_TARGET_BYTES:break
            size-=p.stat().st_size;p.unlink()
        files=[p for p in destination.rglob('*') if p.is_file()];size=sum(p.stat().st_size for p in files)
        omitted=[]
        for p in (source/'data').rglob('*.json'):
            rel=p.relative_to(source)
            shifted=rel.as_posix().startswith(('data/v11/observations/','data/v12/nav/','data/v10/activity/','data/v12/posts/'))
            if shifted and not (destination/rel).exists():omitted.append(dict(path=rel.as_posix(),url=f'https://raw.githubusercontent.com/rhzhang1007-sys/Fundproject/{revision}/prototype/dist/{rel.as_posix()}'))
        report=dict(profile='pages',revision=revision,siteBytes=size,limitBytes=1_000_000_000,remoteFiles=omitted,localDataFiles=sum(1 for p in files if p.suffix=='.json'),sourceDataDeleted=False)
        (destination/'pages-data-index.json').write_text(json.dumps(report,ensure_ascii=False,separators=(',',':')))
        if sum(p.stat().st_size for p in destination.rglob('*') if p.is_file())>=950_000_000:raise ValueError('Pages package exceeds the reserved size budget')
    return len(list(destination.rglob('*')))


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--profile',choices=['full','pages'],default='full');parser.add_argument('--revision',default='');parser.add_argument('--api-origin',default=None)
    args = parser.parse_args(); dest = args.destination.resolve()
    if not (dest.is_relative_to(ROOT / 'tmp') or dest.is_relative_to(ROOT / 'output')):
        raise ValueError('Destination must be inside project tmp/ or output/')
    if dest.exists() and any(dest.iterdir()):
        raise ValueError('Use an empty destination to avoid stale public files')
    count = prepare(ROOT, dest,profile=args.profile,revision=args.revision,api_origin=args.api_origin)
    print(f'Prepared active public assets: {count}; no upload or deployment')


if __name__ == '__main__':
    main()
