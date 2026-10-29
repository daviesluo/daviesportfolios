"""REVX-LAG part 4: variant-7's Coinbase nudge, exactly as `agents/quotes_nudge.ts` runs it, over Revolut X's whole history and
on both books (family 3; variant-7 runs it on USDC-GBP alone since 2026-10-29 08:00, REVX-FAIR §5 found it on 18 days).

At paper minute t, with Coinbase's price of the coin as of t + 60 s (its minute's last print to 2026-10-08, the recorder's
touch from 10-10; none for ten minutes from a five-minute gap on, as `staleMs`): g = Coinbase / fair − 1; its EMA (half-life
1,440 minutes, updated where g exists); dev = g − EMA; the fair moves by half of dev, not at all when |dev| ≥ 0.5 %. Outside FX
closures; the first 72 hours of each book only warm the EMA (their minutes keep today's fair). Same rows, bar and statistics
as `lag_engine.py`, against today's rule.
usage: RX_EX=<file> python3 -I nudge.py OUT.json [WORKERS]
"""
import collections, json, os, statistics as st, sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lag_engine as E  # noqa: E402
import lag_data as L  # noqa: E402

M, H, DAY = L.M, L.H, L.DAY
CB = {b: L.coinbase(b) for b in L.BOOKS}


def nudge_adj():
    st_ = {b: {"e": None, "t": None} for b in L.BOOKS}

    def adj(b, t, f):
        if f is None or L.D.closure(t):
            return f
        m = CB[b].at(t + M)
        if not m:
            return f
        s = st_[b]
        g = m / f - 1
        if s["e"] is None:
            s["e"] = g
        else:
            s["e"] += (1 - 0.5 ** ((t - s["t"]) / M / 1440)) * (g - s["e"])
        s["t"] = t
        if t < L.START[b] + 72 * H:
            return f
        dev = g - s["e"]
        return f if abs(dev) >= 0.005 else f * (1 + 0.5 * dev)
    return adj


def job(args):
    row, arm, part = args
    mins, prints, win = (E.HM, E.HP, L.HIST) if part == "hist" else (E.FM, E.FP, L.FWD)
    kw = dict(E.ROWS[row])
    if arm == "nudge":
        kw["fair_adj"] = nudge_adj()
    # on the recorded window the EMA warms on the two days of minutes before it (the engine steps them before scoring)
    tr, _ =L.sim.run(mins, prints, win[0], win[1], **kw)
    return (row, arm, part), [(x["book"], x["tExit"], x["pnl"], x["gbp"], x["how"], x["tEntry"]) for x in tr]


def main(out, workers):
    jobs = [(r, a, p) for r in E.ROWS for a in ("base", "nudge") for p in ("hist", "fwd")]
    with Pool(workers) as pool:
        runs = dict(pool.map(job, jobs))
    alld = E.days_in(L.START["USDC-GBP"], L.HIST[1]) + E.days_in(L.FWD[0], L.FWD[1])
    split = L.day(L.SPLIT)
    res = {}
    for row in E.ROWS:
        R = {}
        for book in (None,) + L.BOOKS:
            def daily(a):
                d = collections.defaultdict(float)
                for p in ("hist", "fwd"):
                    for bk, te, pnl, gbp, how, tE in runs[(row, a, p)]:
                        if book is None or bk == book: d[L.day(te)] += pnl
                return d
            db, dc = daily("base"), daily("nudge")
            v = [dc.get(x, 0.0) - db.get(x, 0.0) for x in alld]
            ins = [x for d, x in zip(alld, v) if d < split]; oos = [x for d, x in zip(alld, v) if d >= split]
            mo = collections.defaultdict(float)
            for d, x in zip(alld, v): mo[d[:7]] += x
            R[book or "all"] = {"is_gbp_year": round(365 * st.fmean(ins), 2), "oos_gbp_year": round(365 * st.fmean(oos), 2),
                                "oos_boot90_pLe0": E.boot(oos), "months_pos": sum(1 for x in mo.values() if x > 1e-9),
                                "months_n": sum(1 for x in mo.values() if abs(x) > 1e-9)}
        res[row] = R
        print(row, json.dumps(R), flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4)
