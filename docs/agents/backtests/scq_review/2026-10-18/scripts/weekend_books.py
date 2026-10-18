# 2026-10-18 stablecoin quotes review, §5: Revolut X's GBP books at weekends against weekdays, from PR5's stored record
# (data/minutes.txt, data/prints.txt): each print of £1 or more against the fair PR5 would quote on (fairU / X, with X held
# at its last live value through the closure, PR5-W's rule, for the weekend), how far it printed from fair, how much traded.
# Writes results/weekend_books.json.   python3 -I scripts/weekend_books.py
import os, sys, json, bisect, statistics as st, collections
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'scripts'))
import replay as RP
mins, prints = RP.load()
T0, T1 = 1790380800000, 1792281600000   # 2026-09-26 -> 2026-10-18 UTC
out = {}
for b in RP.BOOKS:
    fair = {}
    last = None
    for t, x, fu in mins[b]:
        if x: last = x
        xx = x if x else (last if RP.closure(t) else None)
        fair[t] = fu / xx if (xx and fu) else None
    acc = collections.defaultdict(list); vol = collections.Counter(); days = collections.defaultdict(set)
    for (ms, ticks, q, sd, pid) in prints[b]:
        if not (T0 <= ms < T1): continue
        px = ticks * RP.TICK; g = px * q
        if g < 1: continue
        k = 'weekend' if RP.closure(ms) else 'weekday'
        days[k].add(ms // RP.DAY)
        vol[k] += g
        f = fair.get(ms // RP.M * RP.M)
        if f: acc[k].append(1e4 * abs(px / f - 1))
    out[b] = {k: {'printsOver1Gbp': len(acc[k]), 'gbp': round(vol[k]), 'hours': None,
                  'medianAbsDevBps': round(st.median(acc[k]), 2), 'shareBeyond10bps': round(sum(1 for v in acc[k] if v > 10) / len(acc[k]), 3),
                  'shareBeyond20bps': round(sum(1 for v in acc[k] if v > 20) / len(acc[k]), 3)} for k in acc}
# hours of each kind in the span, for per-hour rates
hrs = collections.Counter()
for t in range(T0, T1, RP.H): hrs['weekend' if RP.closure(t) else 'weekday'] += 1
for b in out:
    for k in out[b]:
        out[b][k]['hours'] = hrs[k]; out[b][k]['gbpPerHour'] = round(out[b][k]['gbp'] / hrs[k]); out[b][k]['printsPerHour'] = round(out[b][k]['printsOver1Gbp'] / hrs[k], 2)
json.dump(out, open(os.path.join(HERE, 'results', 'weekend_books.json'), 'w'), indent=1)
print(json.dumps(out, indent=1))
