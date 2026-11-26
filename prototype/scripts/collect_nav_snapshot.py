#!/usr/bin/env python3
"""全市场基金当日净值快照。

数据源：天天基金每日净值表（含场内ETF/LOF）；按官方客户端的列顺序读取。
用途：每日 8:30 定时采集，延伸已有历史序列；只有通过质量检查的数据进入历史指标。

设计要点：
- 幂等：同一天重复执行覆盖当天文件，不追加。
- 原子写：先写临时文件再改名，中断不会留下半份数据。
- 完整性校验：应得条数与实际条数、缺净值条数、重复代码数全部写入 meta。
- 口径：保留单位净值与累计净值原值；来源日增长率的分红与折算处理未经独立核验。
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
from public_transport import CurlPublicFetcher,SourceRefused
FETCHER=CurlPublicFetcher(1,timeout=25)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / 'prototype/dist/data/v12/nav'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) FundprojectPublicResearch/1.0'
ADAPTER = 'eastmoney-daily-nav-v2'
BASE = ('https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx'
        '?t=1&lx=1&letter=&gsid=&text=&sort=bzdm,asc&page={page},{size}&atfc=&onlySale=0&isLatest=0')


def parse_daily_payload(text, page, size):
    """Read only the official client's named arrays; never evaluate JavaScript."""
    def field(name):
        match = re.search(r'\b'+name+r'\s*:', text)
        if not match: raise ValueError('每日净值缺少字段 '+name)
        return json.JSONDecoder().raw_decode(text[match.end():].lstrip())[0]
    rows, days, total, actual = field('datas'), field('showday'), int(field('record')), int(field('curpage'))
    if not isinstance(rows,list) or not isinstance(days,list) or len(days)!=2 or actual!=page:
        raise ValueError('每日净值结构或分页异常')
    for day in days: date.fromisoformat(day)
    if days[0]<=days[1] or len(rows)!=min(size,max(0,total-(page-1)*size)):
        raise ValueError('每日净值日期或条数异常')
    return [parse_daily_row(row,days) for row in rows], total


def parse_daily_row(row,days):
    # Official getTrByData: 3/4 latest NAV/acc NAV, 5/6 previous, 8 daily growth.
    if not isinstance(row,list) or len(row)<21 or not re.fullmatch(r'\d{6}',str(row[0])):
        return None
    def num(value):
        try: v=float(value)
        except (ValueError,TypeError): return None
        return v if math.isfinite(v) else None
    nav=num(row[3]);current=nav is not None and nav>0
    if not current: nav=num(row[5])
    if nav is None or nav<=0:return None
    optional=21 if current else 22
    day=str(row[optional]) if len(row)>optional and re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(row[optional])) else days[0 if current else 1]
    try: date.fromisoformat(day)
    except ValueError:return None
    acc=num(row[4 if current else 6]);change=num(row[8]) if current else None
    if acc is not None and acc<=0:acc=None
    return dict(code=row[0],name=row[1],type='',date=day,nav=nav,accNav=acc,dayChange=change,sourceAdapter=ADAPTER)


def parse_exchange_html(text):
    from html.parser import HTMLParser
    part=text.split('id="tableDiv"',1)
    if len(part)!=2:raise ValueError('场内净值表缺失')
    days=re.findall(r'<nobr>(\d{4}-\d{2}-\d{2})</nobr>',part[1])[:2]
    if len(days)!=2 or days[0]<=days[1]:raise ValueError('场内净值日期异常')
    for d in days:date.fromisoformat(d)
    class Table(HTMLParser):
        def __init__(self):super().__init__();self.rows=[];self.current=None;self.cells=[];self.cell=None;self.name='';self.anchor=False
        def handle_starttag(self,tag,attrs):
            attrs=dict(attrs)
            if tag=='tr':
                value=attrs.get('id','');self.current=value[2:] if re.fullmatch(r'tr\d{6}',value) else None;self.cells=[];self.name=''
            if self.current and tag=='td':self.cell=[]
            if self.current and tag=='a' and len(self.cells)==4 and not self.name:self.anchor=True
        def handle_data(self,data):
            if self.cell is not None:self.cell.append(data)
            if self.anchor:self.name+=data
        def handle_endtag(self,tag):
            if tag=='a':self.anchor=False
            if tag=='td' and self.cell is not None:self.cells.append(''.join(self.cell).strip());self.cell=None
            if tag=='tr' and self.current:
                self.rows.append((self.current,self.cells,self.name));self.current=None
    parser=Table();parser.feed(text);rows=[]
    def num(x):
        try:v=float(x.replace('%',''))
        except (ValueError,TypeError):return None
        return v if math.isfinite(v) else None
    for code,cells,name in parser.rows:
        if len(cells)!=14 or cells[3]!=code:raise ValueError('场内净值列或身份异常')
        current=num(cells[6]);is_current=current is not None and current>0;nav=current if is_current else num(cells[8]);acc=num(cells[7 if is_current else 9])
        if nav is None or nav<=0:continue
        rows.append(dict(code=code,name=name or code,type=cells[5],date=days[0 if is_current else 1],nav=nav,accNav=acc if acc is not None and acc>0 else None,dayChange=num(cells[11]) if is_current else None,sourceAdapter=ADAPTER,sourceUrl='https://fund.eastmoney.com/cnjy_dwjz.html'))
    if len(rows)<100:raise ValueError('场内净值表异常过少')
    return rows


def fetch_page(page, size, retries=3, expected_total=None):
    url = BASE.format(page=page, size=size)+'&dt='+str(int(time.time()*1000))
    last = None
    for i in range(retries):
        try:
            text=FETCHER(url)
            rows,total=parse_daily_payload(text,page,size)
            if expected_total is not None and total!=expected_total:raise ValueError('净值来源总数变动')
            return rows,total
        except SourceRefused:raise
        except Exception as exc:
            last = exc
            time.sleep(2 + 3 * i)
    raise RuntimeError(f'第 {page} 页失败：{last}')


def parse_row(raw):
    if raw is None:return None
    if isinstance(raw,dict):return raw
    # Compatibility with archived FundGuide rows: index 17 is DAILY GROWTH, not accumulated NAV.
    parts=raw.split(',')
    if len(parts)!=24 or not re.fullmatch(r'\d{6}',parts[0]):return None
    try:date.fromisoformat(parts[15]);nav=float(parts[16]);growth=float(parts[17])
    except (ValueError,TypeError):return None
    if not math.isfinite(nav) or nav<=0 or not math.isfinite(growth):return None
    return dict(code=parts[0],name=parts[1],type=parts[3],date=parts[15],nav=nav,accNav=None,dayChange=growth,sourceAdapter='guide-nav-only-corrected')


def collect(size, max_pages, sleep):
    records, bad, pages, duplicates, seen_pages = {}, 0, 0, 0, set()
    reported=None;errors=[];rows=[]
    for page in range(1, max_pages + 1):
        try:rows,total=fetch_page(page,size,expected_total=reported)
        except (ValueError,RuntimeError,OSError) as exc:
            errors.append(str(exc)[:200]);break
        reported=total
        pages += 1
        signature=json.dumps(rows,ensure_ascii=False,sort_keys=True)
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
    return records,bad,pages,duplicates,bool(errors or rows and len(rows)>=size),reported,errors


MOBILE = ('https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation'
          '?FCODE={code}&deviceid=fundproject&plat=Android&product=EFund&version=6.2.8')


def parse_mobile(code,data):
    if not isinstance(data,dict) or str(data.get('FCODE') or code)!=code:return None
    day=str(data.get('FSRQ') or '')[:10]
    try:date.fromisoformat(day)
    except ValueError:return None
    def num(value):
        try:v=float(value)
        except (TypeError,ValueError):return None
        return v if math.isfinite(v) else None
    nav=num(data.get('DWJZ'))
    if nav is None or nav<=0:return None
    return dict(code=code,name=data.get('SHORTNAME') or '',type=data.get('FTYPE') or '',date=day,nav=nav,accNav=num(data.get('LJJZ')),dayChange=num(data.get('RZDF')),filledFrom='fund-basic')

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
            row=parse_mobile(code,data)
            if row:
                with lock:found[code]=row
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


def merge_snapshots(fresh,previous,checked_at):
    merged={};chosen=set()
    for row in previous.get('funds',[]):
        try:date.fromisoformat(row['date'])
        except (ValueError,TypeError,KeyError):continue
        if not re.fullmatch(r'\d{6}',str(row.get('code',''))):continue
        row=dict(row)
        if 'FundGuideapi' in previous.get('sourceUrl','') and not row.get('filledFrom') and row.get('sourceAdapter')!='guide-nav-only-corrected':
            # Original adapter confused column 17 with accumulated NAV and column 5 with daily growth.
            row.update(dayChange=row.get('accNav'),accNav=None,sourceAdapter='guide-nav-only-corrected')
        merged[row['code']]={**row,'fetchedAt':row.get('fetchedAt') or previous.get('fetchedAt'),'cachedObservation':True}
    for code,row in fresh.items():
        if code not in merged or row['date']>=merged[code]['date']:
            merged[code]={**row,'fetchedAt':checked_at,'cachedObservation':False};chosen.add(code)
    return merged,len(chosen),len(merged)-len(chosen)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--size', type=int, default=50000)
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

    records, bad, pages, duplicates, truncated, reported, source_errors = collect(args.size, args.max_pages, args.sleep)

    exchange_rows=0;exchange_conflicts=[]
    if not FETCHER.refused:
        try:
            content=FETCHER('https://fund.eastmoney.com/cnjy_dwjz.html',binary=True)
            try:content=content.decode('utf-8')
            except UnicodeDecodeError:content=content.decode('gb18030')
            exchange=parse_exchange_html(content);exchange_rows=len(exchange)
            for row in exchange:
                old=records.get(row['code'])
                if old and old['date']==row['date'] and (old['nav']!=row['nav'] or old['accNav'] is not None and row['accNav'] is not None and old['accNav']!=row['accNav']):
                    exchange_conflicts.append(row['code']);records.pop(row['code'],None);continue
                if not old or row['date']>=old['date']:records[row['code']]=row
        except SourceRefused:source_errors.append('Exchange NAV source refused')
        except (ValueError,RuntimeError,OSError) as exc:source_errors.append('Exchange NAV: '+str(exc)[:150])
    filled = 0
    if args.fill_limit and not FETCHER.refused:
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
    fresh_count=len(records);fresh_dates=Counter(r['date'] for r in records.values());previous_path=args.out/'latest.json'
    try:previous=json.loads(previous_path.read_text()) if previous_path.exists() else {}
    except (ValueError,OSError):previous={}
    records,fresh_stored,reused=merge_snapshots(records,previous,started.isoformat(timespec='seconds'))
    counts = Counter(r['date'] for r in records.values())
    no_nav = sum(1 for r in records.values() if r['nav'] is None)
    dup = duplicates
    status = 'incomplete' if reused else 'ok'
    warnings = list(source_errors)
    if reused:warnings.append(f'沿用 {reused} 条先前观察，保留各自日期与采集时间')
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
        'source': '天天基金每日开放式与场内净值表；来源异常时保留先前观察日期',
        'sourceAdapter': ADAPTER,
        'sourceUrl': BASE.format(page=1, size=args.size),
        'fieldNote': 'nav=单位净值；accNav=累计净值；dayChange=来源日增长率（分红、折算处理未经独立核验）；date 为净值日期，非抓取日。',
        'status': status,
        'warnings': warnings,
        'meta': {'seconds': round(time.monotonic()-clock_started,3), 'pages': pages, 'records': len(records), 'badRows': bad, 'duplicateRows': dup, 'paginationTruncated': truncated, 'reportedBulkRows': reported, 'freshRecords': fresh_count, 'freshStoredRecords': fresh_stored, 'reusedRecords': reused, 'exchangeRecords':exchange_rows,'sourceConflicts':exchange_conflicts,'freshDateDistribution':dict(fresh_dates), 'sourceErrors':source_errors, 'withoutNav': no_nav,
                 'filledFromDetail': filled, 'fillBudgetMinutes': args.fill_minutes if args.fill_limit else 0,
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
