# REVX-FAIR (2026-10-29), part 3: the one lead of replay.py looked at harder, on USDC-GBP alone.
#
# The lead: USDC-GBP's fair moved by w x (Coinbase's USDC-GBP mid / fair - 1 - its EMA over hl minutes), i.e. by how far
# Coinbase's live GBP price of a dollar coin has moved off its usual gap to our fair: a live GBP/USD, there at weekends too.
# replay.py chose w 0.5 (hl 1440) on the first half; this checks that the sign does not hang on w, hl, the fill rule, the
# weekend, or one week. Added after replay.py's first run, and labelled so in the review. USDT-GBP is left at today's fair.
#
#   FP_LIVE=<live_orders pull> python3 -I scripts/lead.py
import os, sys, json, statistics as st, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import replay as R
import fp_data as D

DAY, M = D.DAY, D.M


def main():
    mins = D.load_minutes(); prints = D.load_prints(); live = D.load_live_orders()
    I = R.Inputs(mins, live)
    mins3 = {b: [(t, x, fu) for (t, x, fu, lag) in v] for b, v in mins.items()}
    win, split = R.CBW, R.CB_SPLIT
    B = 'USDC-GBP'

    def cand(w, hl, where):
        def f(b, t, fv):
            if b != B: return fv
            held = I.fs[b][t][3]
            if where == 'weekday' and held: return fv
            if where == 'closure' and not held: return fv
            m = I.series('cb_mid', b).get(t); e = I.ema('cb_mid', b, hl).get(t)
            if not m or e is None: return fv
            dev = m / fv - 1 - e
            return fv * (1 + w * dev) if abs(dev) < 0.005 else fv
        return f

    out = {'book': B, 'window': ['2026-10-11', '2026-10-29', '2026-10-20'], 'runs': {}}
    base = {}
    for fill, share in (('at', 1.0), ('at50', 0.5), ('through', 1.0)):
        R.REFUSED[0] = 0
        tr, _ = R.sim.run(mins3, prints, win[0], win[1], fill='through' if fill == 'through' else 'at', at_share=share)
        base[fill] = [t for t in tr if t['book'] == B]
    grid = [(w, hl, 'all') for w in (0.25, 0.5, 0.75, 1.0) for hl in (360, 1440, 2880)] + [(0.5, 1440, 'weekday'), (0.5, 1440, 'closure')]
    for (w, hl, where) in grid:
        for fill, share in (('at', 1.0), ('at50', 0.5), ('through', 1.0)):
            tr, _ = R.sim.run(mins3, prints, win[0], win[1], fill='through' if fill == 'through' else 'at', at_share=share, fair_adj=cand(w, hl, where))
            tr = [t for t in tr if t['book'] == B]
            p = R.paired(base[fill], tr, win, split)
            db, dc = R.daily(base[fill], *win), R.daily(tr, *win)
            weeks = collections.defaultdict(float)
            for k in db: weeks[(k - win[0]) // (7 * DAY)] += (dc[k] - db[k]) / R.CAP * 1e4
            r = {'diffBpsDay': p['diffBpsDay'], 'boot90_pLe0': p['boot90_pLe0'], 'h1': p['h1'], 'h2': p['h2'],
                 'weeks': [round(weeks[k], 2) for k in sorted(weeks)], 'trips': len(tr), 'baseTrips': len(base[fill]),
                 'perTripBps': round(1e4 * sum(t['pnl'] for t in tr) / max(1e-9, sum(t['gbp'] for t in tr)), 2),
                 'basePerTripBps': round(1e4 * sum(t['pnl'] for t in base[fill]) / max(1e-9, sum(t['gbp'] for t in base[fill])), 2)}
            out['runs'][f'w{w}|hl{hl}|{where}|{fill}'] = r
            print(w, hl, where, fill, r['diffBpsDay'], r['boot90_pLe0'], r['h1'], r['h2'], r['weeks'], r['trips'], r['baseTrips'], flush=True)
    # The same nudge on USDT-GBP, but measured on the USDC book: Coinbase's USDC-GBP deviation as a live GBP/USD correction,
    # leaving USDT's own peg to its USD book (Coinbase's USDT-GBP mixes in USDT's peg; replay.py's cb_dev on it lost).
    T = 'USDT-GBP'
    fsC = I.fs[B]

    def cand_t(w, hl):
        def f(b, t, fv):
            if b != T: return fv
            fc = fsC.get(t, (None,))[0]
            m = I.series('cb_mid', B).get(t); e = I.ema('cb_mid', B, hl).get(t)
            if not (fc and m) or e is None: return fv
            dev = m / fc - 1 - e
            return fv * (1 + w * dev) if abs(dev) < 0.005 else fv
        return f
    baseT = {}
    for fill, share in (('at', 1.0), ('at50', 0.5), ('through', 1.0)):
        tr, _ = R.sim.run(mins3, prints, win[0], win[1], fill='through' if fill == 'through' else 'at', at_share=share)
        baseT[fill] = [t for t in tr if t['book'] == T]
    out['usdt_with_usdc_nudge'] = {}
    for (w, hl) in [(0.5, 1440), (1.0, 1440), (0.5, 360), (0.75, 1440)]:
        for fill, share in (('at', 1.0), ('at50', 0.5), ('through', 1.0)):
            tr, _ = R.sim.run(mins3, prints, win[0], win[1], fill='through' if fill == 'through' else 'at', at_share=share, fair_adj=cand_t(w, hl))
            tr = [t for t in tr if t['book'] == T]
            p = R.paired(baseT[fill], tr, win, split)
            r = {'diffBpsDay': p['diffBpsDay'], 'boot90_pLe0': p['boot90_pLe0'], 'h1': p['h1'], 'h2': p['h2'], 'trips': len(tr), 'baseTrips': len(baseT[fill])}
            out['usdt_with_usdc_nudge'][f'w{w}|hl{hl}|{fill}'] = r
            print('USDT', w, hl, fill, r, flush=True)
    json.dump(out, open(os.path.join(D.HERE, 'results', 'lead_usdc_cb.json'), 'w'), indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
