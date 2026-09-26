#!/usr/bin/env python3
"""Pooled shares of level-1 snapshots by touch width, over every depth file pulled
(Wednesdays and Saturdays, 2025-09-27 -> 2026-09-23). Writes out/depth_shares.json."""
import glob, json, os, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('d', os.path.join(HERE, 'analyze_depth.py'))
d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
out = {}
for sym in sorted(os.listdir(os.path.join(HERE, 'hist', 'depth'))):
    n = one = two = gt10 = gt30 = days = 0
    for f in sorted(glob.glob(os.path.join(HERE, 'hist', 'depth', sym, '*.zip'))):
        s = [x for x in d.read_file(f) if x[1] > 0 and x[2] > 0 and x[1] >= x[2]]
        if not s:
            continue
        days += 1
        for _, a, b, _, _ in s:
            w = (a - b) / ((a + b) / 2) * 1e4
            n += 1; gt10 += w > 10; gt30 += w > 30
            tick = {'USDCEUR': 1e-4, 'USDTEUR': 1e-4, 'USDTUSD': 1e-5, 'USDCUSD': 1e-5, 'USDTBRL': 1e-4,
                    'USDSUSDT': 1e-4, 'USDEUSDC': 1e-4}[sym]
            ticks = round((a - b) / tick)
            one += ticks <= 1; two += ticks <= 2
    out[sym] = {'days': days, 'snapshots': n, 'share_one_tick': round(one / n, 4), 'share_le_two_ticks': round(two / n, 4),
                'share_gt_10bps': round(gt10 / n, 4), 'share_gt_30bps': round(gt30 / n, 4)}
    print(sym, out[sym])
json.dump(out, open(os.path.join(HERE, 'out', 'depth_shares.json'), 'w'), indent=1)
