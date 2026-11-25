#!/usr/bin/env python3
"""每日快讯增量采集（东方财富 7×24）。

与一次性回填的区别：只取最近若干页，按 id 去重后并入同一文件，
不覆盖历史；30 天以前的记录由调用方决定是否归档。

输出：output/新闻回填/fast-news.jsonl（追加去重，按日期倒序重写）
"""
import argparse
import json
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from public_transport import CurlPublicFetcher
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / '新闻回填' / 'fast-news.jsonl'
UA = 'Mozilla/5.0 FundprojectPublicResearch/1.0'
API = ('https://np-listapi.eastmoney.com/comm/web/getFastNewsList'
       '?client=web&biz=web_724&fastColumn=102&sortEnd={end}&pageSize=100&req_trace=1')


def fetch_page(end, retries=3):
    return json.loads(CurlPublicFetcher()(API.format(end=end))) or {}


def load_existing():
    items, ids = [], set()
    if not OUT.exists():
        return items, ids
    for line in OUT.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except ValueError:
            continue
        r['id']=str(r.get('id') or '')
        if r['id'] and r['id'] not in ids:
            ids.add(r['id'])
            items.append(r)
    return items, ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pages', type=int, default=8)
    ap.add_argument('--keep-days', type=int, default=30)
    args = ap.parse_args()

    items, ids = load_existing()
    before = len(items)
    end, added, pages = '', 0, 0
    today=datetime.now(ZoneInfo('Asia/Shanghai')).date()
    cutoff = (today - timedelta(days=args.keep_days-1)).isoformat()
    items=[r for r in items if cutoff<=r.get('date','')<=today.isoformat()]
    cursors=set()

    for _ in range(args.pages):
        try:
            data = fetch_page(end)
        except Exception as exc:
            print(f'取第 {pages + 1} 页失败：{exc}')
            break
        block = data.get('data') or {}
        rows = block.get('fastNewsList') or []
        if not rows:
            break
        pages += 1
        for x in rows:
            text = str(x.get('summary') or '').strip()
            day = str(x.get('showTime') or '')[:10]
            if not text or len(day) != 10 or day < cutoff:
                continue
            identity=str(x.get('code') or '')
            if not identity or identity in ids:
                continue
            ids.add(identity)
            items.append({'kind': '快讯', 'entityCode': None, 'entityName': None,
                          'title': text, 'contentCoverage':'source-feed', 'date': day, 'source': '东方财富快讯',
                          'id': str(x.get('code') or ''), 'url': ''})
            added += 1
        end = block.get('sortEnd') or ''
        if not end or str(end) in cursors or all(str(x.get('showTime') or '')[:10]<cutoff for x in rows):
            break
        cursors.add(str(end))
        time.sleep(0.4)

    items.sort(key=lambda r: (r.get('date') or '', r.get('id') or ''), reverse=True)
    tmp = OUT.with_suffix('.tmp')
    with tmp.open('w', encoding='utf-8') as f:
        for r in items:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    tmp.replace(OUT)
    days = len({r['date'] for r in items})
    print(f'翻 {pages} 页，新增 {added} 条；总量 {before} → {len(items)}，覆盖 {days} 天')


if __name__ == '__main__':
    main()
