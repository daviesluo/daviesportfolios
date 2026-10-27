# PR5-OPT (2026-10-27): the shortlist from experiments.py, looked at harder. For each, against LIVE's rules at £600:
#   * week by week (ISO weeks, Monday 00:00 UTC) on FWD, HIST and LONG: in how many weeks the change was ahead, and its worst
#     week, so that no change is chosen on one week;
#   * weekdays and closures apart (the weekend is a third of FWD's P&L);
#   * a combination or two, and two equivalence checks of the simulator itself (an engine without the 0.3 % rungs is the
#     executor at £75 / £75 / £0; capital_gbp with a retired rung keeps each rung's share).
# Writes results/robust.json.   python3 -I scripts/robust.py   (about three minutes)
import os, sys, json, datetime, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim, experiments as E

DAY = sim.DAY


def weekly(bps, days):
    w = collections.defaultdict(float)
    for v, d in zip(bps, days):
        dt = datetime.date.fromisoformat(d)
        w[(dt - datetime.timedelta(days=dt.weekday())).isoformat()] += v
    return w


def parts(bps, days):
    wk = [v for v, d in zip(bps, days) if datetime.date.fromisoformat(d).weekday() >= 5]
    wd = [v for v, d in zip(bps, days) if datetime.date.fromisoformat(d).weekday() < 5]
    return round(sum(wd) / max(1, len(wd)), 3), round(sum(wk) / max(1, len(wk)), 3)


if __name__ == '__main__':
    fm, fp = sim.load_fwd()
    hm, hp = sim.load_hist(E.HIST[0] - 3 * DAY, E.HIST[1])
    lm, lp = sim.load_hist(E.LONG[0] - 3 * DAY, E.LONG[1])
    usdt21 = E.sizes(lambda b, s, k: 2 if b == 'USDT-GBP' else 1)
    usdt32 = E.sizes(lambda b, s, k: 3 if b == 'USDT-GBP' else 2)
    inner = E.sizes(lambda b, s, k: {0.001: 75, 0.002: 50, 0.003: 25}[k])
    s75750 = E.sizes(lambda b, s, k: {0.001: 1, 0.002: 1, 0.003: 0}[k])
    usdc_k = {('USDC-GBP', 'bid'): (0.00075, 0.0015, 0.0025), ('USDC-GBP', 'ask'): (0.00075, 0.0015, 0.0025)}
    usdc_k_usdt21 = {(b, s, k): (400.0 / 6 if b == 'USDT-GBP' else 200.0 / 6) for b in sim.BOOKS for s in ('bid', 'ask')
                     for k in ((0.00075, 0.0015, 0.0025) if b == 'USDC-GBP' else (0.001, 0.002, 0.003))}
    V = {
        'base': {},
        'book_usdt_2to1': {'size': usdt21},
        'book_usdt_3to2': {'size': usdt32},
        'size_inner_75_50_25': {'size': inner},
        'size_75_75_0 (executor)': {'size': s75750},
        'rungs_0.1_0.2 (engine)': {'rungs': (0.001, 0.002)},
        'rungs_usdc_0.075_0.15_0.25': {'rungs_bb': usdc_k},
        'hold_min_1gbp': {'hold_min_gbp': 1.0},
        'rungs_0.1_0.15_0.2_0.3': {'rungs': (0.001, 0.0015, 0.002, 0.003)},
        'combo usdt_2to1 + hold_min_1gbp': {'size': usdt21, 'hold_min_gbp': 1.0},
        'combo usdt_2to1 + usdc_0.075_0.15_0.25': {'rungs_bb': usdc_k, 'size': usdc_k_usdt21},
        'stop_48h': {'stop_ms': 48 * sim.H},
    }
    out = {}
    for tag, m_, p_, rec, fk in [('fwd_at', fm, fp, E.FWD, {}), ('fwd_through', fm, fp, E.FWD, {'fill': 'through'}),
                                 ('hist_at', hm, hp, E.HIST, {}), ('long_at', lm, lp, E.LONG, {})]:
        base_w = None
        for name, kw in V.items():
            tr, cap = sim.run(m_, p_, rec[0] - 2 * DAY, rec[1], **{**fk, **kw})
            s, bps = E.summary(tr, cap, *rec)
            days, _ = E.daily(tr, *rec)
            w = weekly(bps, days)
            if name == 'base': base_w, base_parts = w, parts(bps, days)
            r = out.setdefault(name, {})
            wd_, wk_ = parts(bps, days)
            r[tag] = {'bpsDay': s['bpsDay'], 'trips': s['trips'], 'won': s['won'], 'stops': s['stops'], 'worstDayBps': s['worstDayBps'],
                      'maxDrawdownBps': s['maxDrawdownBps'], 'weekdayBpsDay': wd_, 'closureDayBpsDay': wk_}
            if name != 'base':
                d = {k: w[k] - base_w[k] for k in base_w}
                full = [k for k in sorted(d)]
                r[tag]['weeksAhead'] = sum(1 for k in full if d[k] > 1e-9)
                r[tag]['weeksBehind'] = sum(1 for k in full if d[k] < -1e-9)
                r[tag]['weeks'] = len(full)
                r[tag]['worstWeekBps'] = round(min(d.values()), 2)
                r[tag]['bestWeekShare'] = round(max(d.values()) / sum(d.values()), 3) if sum(d.values()) > 0 else None
                r[tag]['weekdayDiff'] = round(wd_ - base_parts[0], 3)
                r[tag]['closureDayDiff'] = round(wk_ - base_parts[1], 3)
            print(tag, name, r[tag])
    json.dump(out, open(os.path.join(sim.HERE, 'results', 'robust.json'), 'w'), indent=1)
