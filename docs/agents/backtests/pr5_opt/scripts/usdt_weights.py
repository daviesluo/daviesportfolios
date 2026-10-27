# PR5-OPT, 2026-10-27 (for variant-7 and -8): USDT-GBP's weight against USDC-GBP's, 1:1 (LIVE's rules) to USDT only, at £600,
# week by week on FWD ('at' and 'through'), HIST and LONG, and the largest USDT rung each needs. Writes results/usdt_weights.json.
#   python3 -I scripts/usdt_weights.py   (about four minutes)
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim, experiments as E, robust as R

W = {'1:1': None, '3:2': (3, 2), '2:1': (2, 1), '3:1': (3, 1), 'USDT only': (1, 0)}

if __name__ == '__main__':
    fm, fp = sim.load_fwd()
    hm, hp = sim.load_hist(E.HIST[0] - 3 * sim.DAY, E.HIST[1])
    lm, lp = sim.load_hist(E.LONG[0] - 3 * sim.DAY, E.LONG[1])
    out = {}
    for tag, m_, p_, rec, fk in [('fwd_at', fm, fp, E.FWD, {}), ('fwd_through', fm, fp, E.FWD, {'fill': 'through'}),
                                 ('hist_at', hm, hp, E.HIST, {}), ('long_at', lm, lp, E.LONG, {})]:
        base = None
        for name, w in W.items():
            kw = {} if w is None else {'size': E.sizes(lambda b, s, k, w=w: w[0] if b == 'USDT-GBP' else w[1])}
            marks = {}
            tr, cap = sim.run(m_, p_, rec[0] - 2 * sim.DAY, rec[1], marks=marks, **{**fk, **kw})
            s, bps = E.summary(tr, cap, *rec, marks)
            days, _ = E.daily(tr, *rec)
            wk = R.weekly(bps, days)
            r = out.setdefault(name, {})
            r[tag] = {'bpsDay': s['bpsDay'], 'trips': s['trips'], 'won': s['won'], 'stops': s['stops'], 'mtmWorstDayBps': s.get('mtmWorstDayBps'),
                      'mtmMaxDrawdownBps': s.get('mtmMaxDrawdownBps'), 'usdtRungGbp': round(600 / 6 * (w[0] / (w[0] + w[1])), 2) if w else 50.0}
            if base is None: base = (s['bpsDay'], wk)
            else:
                d = {k: wk[k] - base[1][k] for k in base[1]}
                r[tag].update({'vsBaseBpsDay': round(s['bpsDay'] - base[0], 3), 'upliftPct': round(100 * (s['bpsDay'] / base[0] - 1), 1),
                               'weeksAhead': sum(1 for v in d.values() if v > 1e-9), 'weeks': len(d), 'worstWeekBps': round(min(d.values()), 2)})
            print(tag, name, r[tag])
    json.dump(out, open(os.path.join(sim.HERE, 'results', 'usdt_weights.json'), 'w'), indent=1)
