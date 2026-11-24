"""Prepare the active static app only. No local accounts, Team Hub, database or legacy UI."""
import argparse
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]


def prepare(root, destination):
    source = root / 'prototype/dist'
    allowed = {'index.html', 'natural.css', 'v07.css', 'v08.css'}
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
            if (global_data/folder).exists():shutil.copytree(global_data/folder,destination/'data/v10'/folder,dirs_exist_ok=True)
    catalog=json.loads((source/'data/catalog.json').read_text());catalog.pop('defaultWeights',None);catalog['sources']=[s for s in catalog.get('sources',[]) if s.get('visibility')!='internal']
    target=destination/'data/catalog.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')))
    # This source file contains public fund data; remove the old default portfolio proportions.
    data = json.loads((source / 'data/v07/portfolio.json').read_text())
    data.pop('defaults', None)
    target = destination / 'data/v07/portfolio.json'; target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    archived = source / 'data/archive'
    if archived.exists():
        shutil.copytree(archived, destination / 'data/archive', dirs_exist_ok=True)
    for removed in ('app.mjs', 'v07.mjs', 'v07-history.mjs', 'management-ui.mjs', 'index-v06.html', 'data/comments.json'):
        if (destination / removed).exists():
            raise ValueError('Legacy file unexpectedly present in public output')
    return len(list(destination.rglob('*')))


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args(); dest = args.destination.resolve()
    if not (dest.is_relative_to(ROOT / 'tmp') or dest.is_relative_to(ROOT / 'output')):
        raise ValueError('Destination must be inside project tmp/ or output/')
    if dest.exists() and any(dest.iterdir()):
        raise ValueError('Use an empty destination to avoid stale public files')
    count = prepare(ROOT, dest)
    print(f'Prepared active public assets: {count}; no upload or deployment')


if __name__ == '__main__':
    main()
