#!/usr/bin/env python3
"""全市场基金当日净值快照。

数据源：天天基金 FundGuideapi（一次分页可覆盖全市场，含净值日期、单位净值、累计净值）。
用途：每日 8:30 定时采集，作为风险指标的唯一净值来源。

设计要点：
- 幂等：同一天重复执行覆盖当天文件，不追加。
- 原子写：先写临时文件再改名，中断不会留下半份数据。
- 完整性校验：应得条数与实际条数、缺净值条数、重复代码数全部写入 meta。
- 口径：保留单位净值与累计净值原值；日增长率不含分红，跨分红日不可直接用。
- 只保存当日快照；历史序列另行按需回补，避免仓库体积失控。
"""
import argparse
import json
import math
import re
import sys
import time
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from public_transport import CurlPublicFetcher
FETCHER=CurlPublicFetcher(1,timeout=25)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / 'prototype/dist/data/v12/nav'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) FundprojectPublicResearch/1.0'
BASE = ('https://fund.eastmoney.com/data/FundGuideapi.aspx'
        '?dt=0&ft=all&sd=&ed=&sc=z&st=desc&zf=diy&sh=list&pi={page}&pn={size}')
FIELDS = ['code', 'name', 'pinyin', 'type', 'blank', 'dayChange', 'w1', 'm1', 'm3', 'm6',
          'y1', 'y2', 'y3', 'ytd', 'flag', 'date', 'nav', 'accNav', 'flag2', 'fee', 'n20', 'n21', 'fee2', 'fee3']


def fetch_page(page, size, retries=4):
    url = BASE.format(page=page, size=size)
    last = None
    for i in range(retries):
        try:
            text=FETCHER(url)
            match = re.search(r'\{[\s\S]*\}', text)
            if not match:
                raise RuntimeError('响应不含 JSON')
            payload=json.loads(match.group(0))
            if not isinstance(payload,dict) or not isinstance(payload.get('datas'),list):raise ValueError('净值批量接口结构异常')
            return payload['datas']
        except Exception as exc:
            last = exc
            time.sleep(2 + 3 * i)
    raise RuntimeError(f'第 {page} 页失败：{last}')


def parse_row(raw):
    parts = raw.split(',')
    if len(parts) != 24:
        return None
    row = dict(zip(FIELDS, parts))
    if not re.fullmatch(r'\d{6}', row['code']):
        return None
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', row['date'] or ''):
        return None
    try: date.fromisoformat(row['date'])
    except ValueError: return None
    def num(value):
        value = (value or '').strip()
        if not re.fullmatch(r'-?\d+(\.\d+)?', value):
            return None
        parsed=float(value)
        return parsed if math.isfinite(parsed) else None
    return {'code': row['code'], 'name': row['name'].strip(), 'type': row['type'].strip(),
            'date': row['date'], 'nav': num(row['nav']), 'accNav': num(row['accNav']),
            'dayChange': num(row['dayChange'])}


def collect(size, max_pages, sleep):
    records, bad, pages, duplicates, seen_pages = {}, 0, 0, 0, set()
    for page in range(1, max_pages + 1):
        rows = fetch_page(page, size)
        pages += 1
        signature=tuple(rows)
        if rows and signature in seen_pages:raise ValueError('净值接口重复页，不能视为完成')
        seen_pages.add(signature)
        for raw in rows:
            parsed = parse_row(raw)
            if parsed is None:
                bad += 1
                continue
            if parsed['code'] in records:duplicates+=1
            if parsed['code'] in records and records[parsed['code']]!=parsed:raise ValueError('同一基金代码净值冲突')
            records[parsed['code']] = parsed
        print(f'  第 {page} 页 {len(rows)} 条，累计 {len(records)}', flush=True)
        if len(rows) < size:
            break
        time.sleep(sleep)
    return records, bad, pages, duplicates, bool(rows and len(rows)>=size)


MOBILE = ('https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation'
          '?FCODE={code}&deviceid=fundproject&plat=Android&product=EFund&version=6.2.8')


def fill_missing(codes, sleep=0.05, workers=10, minutes=20):
    """批量列表不含场内 ETF/LOF，用单只详情接口补齐单位净值。"""
    import threading
    from concurrent.futures import ThreadPoolExecutor
    lock = threading.Lock()
    transport_lock = threading.Lock()
    found = {}
    deadline = time.monotonic() + minutes * 60
    skipped = {'n': 0}

    def one(code):
        if time.monotonic() > deadline:
            with lock:
                skipped['n'] += 1
            return
        try:
            with transport_lock:
                if time.monotonic()>deadline:
                    with lock:skipped['n']+=1
                    return
                data=json.loads(FETCHER(MOBILE.format(code=code))).get('Datas') or {}
            nav, day, acc, chg = data.get('DWJZ'), data.get('FSRQ'), data.get('LJJZ'), data.get('RZDF')
            if not nav or not day:
                return
            with lock:
                found[code] = {'code': code, 'name': data.get('SHORTNAME') or '',
                               'type': data.get('FTYPE') or '', 'date': day,
                               'nav': float(nav),
                               'accNav': float(acc) if acc not in (None, '', '--') else None,
                               'dayChange': float(chg) if chg not in (None, '', '--') else None,
                               'filledFrom': 'fund-basic'}
        except Exception:
            return
        finally:
            time.sleep(sleep)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(one, codes))
    return found, skipped['n']


def write_atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    tmp.replace(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--size', type=int, default=1000)
    ap.add_argument('--max-pages', type=int, default=60)
    ap.add_argument('--sleep', type=float, default=1.0)
    ap.add_argument('--expect-min', type=int, default=26000, help='低于该条数标记不完整（仅警告）')
    ap.add_argument('--fail-below', type=int, default=20000, help='低于该条数视为采集失败，退出码 2')
    ap.add_argument('--as-of', default=None, help='覆盖日期，仅用于补跑')
    ap.add_argument('--fill-limit', type=int, default=0, help='用单只接口补齐的基金数上限，0 表示不补')
    ap.add_argument('--fill-minutes', type=float, default=20, help='补齐阶段的时间上限（分钟），到时自动停止')
    ap.add_argument('--basics', type=Path, default=ROOT / 'output' / '公共数据包-2026-11-24' / 'funds' / 'fund-basics.jsonl')
    args = ap.parse_args()

    clock_started=time.monotonic()
    started = datetime.now(ZoneInfo('Asia/Shanghai'))
    today = args.as_of or started.date().isoformat()
    print(f'开始采集全市场净值 {today}', flush=True)

    records, bad, pages, duplicates, truncated = collect(args.size, args.max_pages, args.sleep)

    filled = 0
    if args.fill_limit:
        if args.basics.exists():
            basic_rows = [json.loads(l) for l in args.basics.read_text(encoding='utf-8').splitlines() if l.strip()]
        else:
            basic_rows=[{**r,'shortName':r['name']} for r in json.loads((ROOT/'prototype/dist/data/v10/objects.json').read_text())['objects'] if r['kind']=='fund' and re.fullmatch(r'\d{6}',r['code'])]
        known = {r['code']: r for r in basic_rows}
        missing = [c for c in known if c not in records]
        def rank(code):
            r = known[code]
            is_etf = 0 if 'ETF' in (r.get('shortName') or '') else (1 if (r.get('type') or '').startswith('指数型') else 2)
            return (is_etf, -(r.get('netAssetsYi') or 0))
        missing.sort(key=rank)
        missing = missing[:args.fill_limit]
        if missing:
            extra, skipped = fill_missing(missing, minutes=args.fill_minutes)
            records.update(extra)
            filled = len(extra)
            print(f'  补齐 {filled} 只，未及处理 {skipped} 只（时间预算 {args.fill_minutes} 分钟）', flush=True)
    counts = Counter(r['date'] for r in records.values())
    no_nav = sum(1 for r in records.values() if r['nav'] is None)
    dup = duplicates
    status = 'ok'
    warnings = []
    if len(records) < args.expect_min:
        status = 'incomplete'
        warnings.append(f'条数 {len(records)} 低于预期下限 {args.expect_min}（仍保存，供核对）')
    if truncated:
        status='incomplete';warnings.append('达到分页上限，列表未证实完整')
    if bad:
        warnings.append(f'{bad} 行字段不合法已跳过')
    if no_nav:
        warnings.append(f'{no_nav} 只无单位净值（可能为货币基金或停牌）')
    if len(counts) > 1:
        warnings.append(f'净值日期不唯一：{dict(counts)}')

    payload = {
        'schemaVersion': 1,
        'asOf': today,
        'fetchedAt': started.isoformat(timespec='seconds'),
        'source': '天天基金 FundGuideapi',
        'sourceUrl': BASE.format(page=1, size=args.size),
        'fieldNote': 'nav=单位净值；accNav=累计净值；dayChange=日增长率（不含分红）；date 为净值日期，非抓取日。',
        'status': status,
        'warnings': warnings,
        'meta': {'seconds': round(time.monotonic()-clock_started,3), 'pages': pages, 'records': len(records), 'badRows': bad, 'duplicateRows': dup, 'paginationTruncated': truncated, 'withoutNav': no_nav,
                 'filledFromDetail': filled, 'fillBudgetMinutes': args.fill_minutes,
                 'dateDistribution': dict(sorted(counts.items(), reverse=True)[:5])},
        'funds': list(records.values())
    }
    if len(records)<args.fail_below:
        write_atomic(args.out/'last-failed-attempt.json',payload)
        print('采集低于硬下限；保留上一有效快照');sys.exit(2)
    daily = args.out / 'daily' / f'{today}.json'
    write_atomic(daily, payload)
    write_atomic(args.out / 'latest.json', {**payload, 'dailyFile': str(daily.relative_to(args.out))})

    size_mb = daily.stat().st_size / 1024 / 1024
    print(f'完成：{len(records)} 只，{pages} 页，{size_mb:.2f}MB，状态 {status}')
    for w in warnings:
        print('  注意：', w)
    if len(records) < args.fail_below:
        print(f'采集失败：条数 {len(records)} 低于硬下限 {args.fail_below}')
        sys.exit(2)


if __name__ == '__main__':
    main()
