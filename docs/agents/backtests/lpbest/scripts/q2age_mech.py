# Q2-AGE, the mechanism and the paired reading (2026-10-13). Reads q2age.py's output (<work>/q2age.json) and LP-BEST's
# stateless day table (daytable_api.csv.gz): (1) each filter against Q2 day by day on the same days (a day-block
# bootstrap of the paired difference, and the worst day); (2) what young quiet books are like, among every quiet book of
# Q2's universe and among Q2's own picks: taker volume, how far the takers' trades ran in their favour in 60 minutes
# (the toxicity, `d_tox` per share), our fills and their 60-minute markout per share at RW's price, the formula, and how
# RW's per-dollar ranking rates them (`est0 / cap0`).
#   LPBEST_WORK=<scratch> LPBEST_API_TAPE=1 Q2AGE_CREATED=<created.json> python3 -I docs/agents/backtests/lpbest/scripts/q2age_mech.py > results/q2age_mech.txt
import os, sys, json
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, strat, q2age

R = 0.42
BUCKETS = ((0, 1, 'under 1 day'), (1, 3, '1-3 days'), (3, 7, '3-7 days'), (7, 30, '7-30 days'), (30, 1e9, '30 days +'))

if __name__ == '__main__':
    outs = json.load(open(os.path.join(lib.WORK, 'q2age.json')))
    by = {(o['eq'], o['min_age'], o['span']): o for o in outs}
    print("Q2-AGE, paired: each minimum age against Q2 on the same days. Day-block bootstrap of the daily difference (filter - Q2),"
          " 5,000 draws, seed 20261013; $ a day")
    rnd = np.random.default_rng(20261013)
    for eq in (316.0, 400.0):
        for span, days in (('TRAIN', strat.TRAIN), ('TEST', strat.TEST), ('ALL', strat.DAYS)):
            base = np.array([by[(eq, 0, 'ALL')]['daily'][d] for d in days])
            for a in q2age.AGES[1:]:
                f = np.array([by[(eq, a, 'ALL')]['daily'][d] for d in days])
                diff = f - base
                bs = diff[rnd.integers(0, len(diff), size=(5000, len(diff)))].mean(1)
                lo, hi = np.percentile(bs, [5, 95])
                print(f"  ${eq:.0f} {span:<5} >= {a} d: {diff.mean():+6.2f} [{lo:+6.2f}, {hi:+6.2f}]  days better {int((diff > 1e-9).sum())}/{len(diff)}"
                      f"  worst day {f.min():+6.2f} (Q2 {base.min():+6.2f})  sd {f.std(ddof=1):5.2f} (Q2 {base.std(ddof=1):5.2f})")
    df = strat.daytable()
    q = pd.concat([q2age.q2_eligible(df[df.day == d], 0) for d in strat.DAYS])
    q = q.assign(age=q2age.ages(q))
    picks = {(m, d) for o in [by[(316.0, 0, 'ALL')]] for m, d, *_ in o['mdays']}
    q['picked'] = [(int(m), d) in picks for m, d in zip(q.mid, q.day)]
    def row(x, name):
        sh = x.inside_shw.sum()
        return (f"  {name:<12}{len(x):>6}{x.d_vol.mean():>9.0f}{(x.d_tox.sum() / max(1e-9, x.d_vol.sum())) * 100:>9.2f}{x.inside_shw.mean():>9.1f}"
                f"{(x.inside_mo60w.sum() / max(1e-9, sh)) * 100:>10.2f}{x.inside_f2w.mean():>9.3f}{(R * x.inside_f2w + x.inside_mo60w).mean():>+9.3f}"
                f"{(x.est0 / x.cap0).median() * 1440:>11.3f}{x.p_vol_api.mean():>9.1f}")
    head = (f"  {'age':<12}{'mkt-days':>6}{'taker sh':>9}{'tox c/sh':>9}{'our sh':>9}{'mo60 c/sh':>10}{'formula':>9}{'net':>9}{'RW $/$/day':>11}{'prior24h':>9}")
    for lab, x in (("every quiet book of Q2's universe (touch >= 4 c, <= 50 shares in the prior 24 h)", q), ("Q2's own market-days (picked, or carried with stock)", q[q.picked])):
        print(f"\n== {lab}, by age at 00:00; a market-day each, stateless at RW's price (net = {R} x formula + 60-min markout)")
        print(head)
        for a0, a1, name in BUCKETS:
            xs = x[(x.age >= a0) & (x.age < a1)]
            if len(xs): print(row(xs, name))
        print(row(x, 'all'))
    # how often RW's ranking puts a young market in the day's picks, against its share of the quiet books
    print("\n== the share of young markets: among the quiet books, and among Q2's picks")
    for a0, a1, name in BUCKETS:
        n_all = int(((q.age >= a0) & (q.age < a1)).sum()); n_p = int(((q.age >= a0) & (q.age < a1) & q.picked).sum())
        print(f"  {name:<12} {n_all:>5} of {len(q)} quiet market-days ({100 * n_all / len(q):4.1f} %), {n_p:>3} of {int(q.picked.sum())} picks ({100 * n_p / max(1, q.picked.sum()):4.1f} %)")
    # PMOPPS' table (pool_age.py) called a market-day quiet on the day table's `p_vol`, pm-rec's own tape, which has no
    # print while a market is out of its recorded set (LP-BEST's tapecheck: 41 % of the data API's trades in quiet picks),
    # and over the whole day table rather than Q2's eligible set. Its quiet books, split by what the data API says.
    w = df[(df.p_vol <= 50) & (df.width0_c >= 4 - 1e-9)].copy()
    w['age'] = q2age.ages(w)
    w['api'] = np.where(w.p_vol_api.isna(), 'unread by the API', np.where(w.p_vol_api <= 50, 'quiet by the API', 'busy by the API'))
    w['net'] = R * w.inside_f2w + w.inside_mo60w
    print("\n== PMOPPS' quiet books (pm-rec's tape: p_vol <= 50, touch >= 4 c, the whole day table), by age and by what the data API says;"
          " $ in all at RW's price (net = 0.42 x formula + 60-min markout), market-days in brackets")
    print(f"  {'age':<12}" + ''.join(f"{k:>30}" for k in ('quiet by the API', 'busy by the API', 'unread by the API')))
    for a0, a1, name in (((0, 3, 'under 3 days'), (3, 1e9, '3 days +'))):
        xs = w[(w.age >= a0) & (w.age < a1)]
        print(f"  {name:<12}" + ''.join(f"{xs[xs.api == k].net.sum():>+20.2f} ({int((xs.api == k).sum()):>6})" for k in ('quiet by the API', 'busy by the API', 'unread by the API')))
