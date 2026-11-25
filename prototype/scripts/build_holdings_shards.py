#!/usr/bin/env python3
"""把 top100 持仓切成按代码分片，供前端按需取两只基金算重叠。

为什么需要：持仓原始文件是逐行 jsonl，前端无法随机取某一只；重叠计算需要
按代码取出两只基金的同期持仓。分片规则与既有 funds/stocks 分片一致。

分片规则：数字代码取模，其他代码采用与网页一致的字符哈希。
收录至少有一期半年度或年度明细的记录，不以20行门槛推断完整性。

输出：output/公共数据包-2026-11-24/分片/holdings/{00..99}.json
"""
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / 'output' / '公共数据包-2026-11-24'
SRC = PKG / 'funds' / 'fund-holdings-top100.jsonl'
OUT = PKG / '分片' / 'holdings'
SHARDS = 100


def shard_key(code):
    if code.isdigit():return f'{int(code) % SHARDS:02d}'
    value=0
    for ch in code:value=(value*31+ord(ch))%SHARDS
    return f'{value:02d}'


def shard_records(records):
    best = {}
    for r in records:
        if r.get('status') != 'ok':
            continue
        # 只保留季度末报告期，剔除非季度日期（页面解析带出的噪声）
        periods = [p for p in (r.get('periods') or [])
                   if (p.get('rows') or []) and (p.get('asOf') or '')[-5:] in ('03-31', '06-30', '09-30', '12-31')]
        if not periods:
            continue
        full = [p for p in periods if p.get('asOf','')[-5:] in ('06-30', '12-31') and len(p.get('rows') or []) > 0]
        if not full:
            continue
        rows = max(len(p['rows']) for p in full)
        if r['code'] not in best or rows > best[r['code']][0]:
            best[r['code']] = (rows, r)

    groups = {}
    for code, (_, r) in best.items():
        # Recompute for this record: the previous implementation reused the last
        # record's `periods` for every code, causing cross-fund contamination.
        periods=[p for p in r.get('periods',[]) if p.get('rows') and (p.get('asOf') or '')[-5:] in ('03-31','06-30','09-30','12-31')]
        groups.setdefault(shard_key(code), {})[code] = {
            'fundCode':code,
            'name': r.get('name'),
            'periods': [{'asOf': p.get('asOf'), 'rows': p['rows']} for p in periods]
        }
    return best,groups


def main():
    records=[json.loads(line) for line in SRC.read_text(encoding='utf-8').splitlines() if line.strip()]
    best,groups=shard_records(records)

    OUT.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    for prefix in sorted(groups):
        payload = {'schemaVersion': 1, 'prefix': prefix, 'count': len(groups[prefix]),
                   'note': '仅 top100 档；不同报告期不可合并', 'funds': groups[prefix]}
        text = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
        (OUT / f'{prefix}.json').write_text(text, encoding='utf-8')
        total_bytes += len(text.encode())

    manifest = {
        'schemaVersion': 1,
        'builtAt': datetime.now().isoformat(timespec='seconds'),
        'funds': len(best), 'shards': len(groups), 'totalBytes': total_bytes,
        'largestShardBytes': max((OUT / f'{p}.json').stat().st_size for p in groups),
        'loadRule': 'int(code) % 100 补两位；同一片在会话内缓存',
        'scope': '含半年度或年度明细的记录；条数与日期不代表全部披露',
        'usage': 'Q1 重叠：取两只基金同一 asOf 的 rows，按 Σ min(wa, wb) 计算'
    }
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'分片完成：{len(best)} 只基金，{len(groups)} 片，总 {total_bytes/1024/1024:.1f}MB，'
          f'最大片 {manifest["largestShardBytes"]/1024:.0f}KB')


if __name__ == '__main__':
    main()
