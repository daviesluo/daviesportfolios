# 2026-10-18 stablecoin quotes review, §5: PR5's rule with X held through the weekly closure (PR5-W's rule, `xhold`),
# weekend by weekend, against the same rule dark at weekends, on the committed tape from 2026-01-01 and on PR5's stored
# record from 2026-09-26. A weekend is a closure (Friday 21:00 -> Sunday 21:00 UTC); its figure is the held arm's P&L less
# the base arm's over trips ENTERED from that Friday 21:00 to the Monday 00:00 after it (the reopen tail included), as the
# Coinbase weekend test's bar 6 pairs them. Writes results/weekends.json.   python3 -I scripts/weekends.py
import os, sys, json, datetime, statistics as st, collections
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'scripts'))
import replay as RP, experiments as E
DAY = RP.DAY

def weekend_of(ms):
    d = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc)
    # the Friday 21:00 that opens the closure this instant belongs to (Fri 21:00 -> Mon 00:00), or None
    wd = d.weekday()
    if (wd == 4 and d.hour >= 21) or wd in (5, 6):
        fri = (d - datetime.timedelta(days=(wd - 4))).date()
        return fri.isoformat()
    return None

def per_weekend(mins, prints, t0, t1, size_usd=100.0, fill='through'):
    a, _ = RP.run(mins, prints, t_to=t1, xhold=True, size_usd=size_usd, fill=fill)
    b, _ = RP.run(mins, prints, t_to=t1, xhold=False, size_usd=size_usd, fill=fill)
    w = collections.Counter(); n = collections.Counter(); stops = collections.Counter(); reopen = collections.Counter()
    for t in a:
        if not (t0 <= t['tEntry'] < t1): continue
        k = weekend_of(t['tEntry'])
        if k: 
            w[k] += t['pnlGbp']; n[k] += 1; stops[k] += t['how'] == 'taker'
            if not RP.closure(t['tExit']) or t['how'] == 'taker': reopen[k] += t['pnlGbp']
    for t in b:
        if not (t0 <= t['tEntry'] < t1): continue
        k = weekend_of(t['tEntry'])
        if k: w[k] -= t['pnlGbp']
    ks = sorted(set(w) | set(n))
    vals = [w[k] for k in ks]
    return {'weekends': len(ks), 'positive': sum(1 for v in vals if v > 0), 'sumGbp': round(sum(vals), 4),
            'medianGbp': round(st.median(vals), 4) if vals else None, 'worstGbp': round(min(vals), 4) if vals else None, 'bestGbp': round(max(vals), 4) if vals else None,
            'bestShare': round(max(vals) / sum(vals), 3) if vals and sum(vals) > 0 else None,
            'byWeekend': {k: {'gbp': round(w[k], 4), 'trips': n[k], 'stops': stops[k], 'closedAfterReopenGbp': round(reopen[k], 4)} for k in ks}}

out = {'rule': 'replay.py xhold=True minus xhold=False, trips entered Fri 21:00 -> Mon 00:00 UTC, $100 a rung unless stated'}
mins, prints = RP.load()
out['fwd_through'] = per_weekend(mins, prints, 1790380800000, 1792281600000)
out['fwd_at'] = per_weekend(mins, prints, 1790380800000, 1792281600000, fill='at')
out['fwd_through_gbp10'] = per_weekend(mins, prints, 1790380800000, 1792281600000, size_usd=10 * 1.33)
hm, hp = E.load_hist(1767225600000 - 2 * DAY, 1790121600000)
out['hist_from_0101_through'] = per_weekend(hm, hp, 1767225600000, 1790121600000)
out['hist_from_0826_through'] = per_weekend(hm, hp, 1787702400000, 1790121600000)
json.dump(out, open(os.path.join(HERE, 'results', 'weekends.json'), 'w'), indent=1)
for k, v in out.items():
    if isinstance(v, dict): print(k, {kk: vv for kk, vv in v.items() if kk != 'byWeekend'})
print(json.dumps(out['fwd_through']['byWeekend'], indent=0))
