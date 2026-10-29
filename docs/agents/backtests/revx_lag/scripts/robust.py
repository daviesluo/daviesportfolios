"""REVX-LAG part 3: is the one candidate that passed (`exit1`, every exit one tick beyond fair) robust, and can a taker ever
take the lag against the recorded book?

1. exit1 under the fill assumptions that could flatter it, on live600 (each paired with today's rule under the SAME
   assumption): `at_share` 0.5 and 0.25 (our order gets only that share of a print AT its price: a queue ahead of it),
   LIVE's "at" with the share 1 as run, and PR5's through-only fill; and two ticks (`exit2`). Same bar and statistics as
   `lag_engine.py`.
2. The taker, on the recorded books (2026-09-26 → 10-29; REVX-FAIR's `book_*.txt`, LIVE's own resting orders taken out
   when $FP_LIVE is set): at each open minute whose forecast (lag_engine's m̂, fitted in sample) exceeds θ, buy at the
   recorded best ask with at least 50 coin (sell at the bid when it is below −θ), as of the decision (t + 85 s), pay
   0.09 %, and close 60 minutes later either at the recorded best bid as a taker (0.09 % again) or, as an upper bound, at
   the recorded mid with no fee. Mean bps a trade and trades a day.
usage: RX_EX=<file> [FP_LIVE=<live orders pull>] python3 -I robust.py OUT.json [WORKERS]
"""
import collections, json, math, os, statistics as st, sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lag_engine as E  # noqa: E402  (its forecast, rows, scoring; the engine unchanged)
import lag_data as L  # noqa: E402

M, H, DAY = L.M, L.H, L.DAY
VARIANTS = {
    "at_share1": dict(fill="at", at_share=1.0), "at_share0.5": dict(fill="at", at_share=0.5),
    "at_share0.25": dict(fill="at", at_share=0.25), "through": dict(fill="through"),
}
ARMS = {"base": {}, "exit1": {"exit_off": 1}, "exit2": {"exit_off": 2}}


def job(args):
    var, arm, part = args
    mins, prints, win = (E.HM, E.HP, L.HIST) if part == "hist" else (E.FM, E.FP, L.FWD)
    kw = dict(capital=600.0, xhold=True); kw.update(VARIANTS[var]); kw.update(ARMS[arm])
    tr, _ = L.sim.run(mins, prints, win[0], win[1], **kw)
    return (var, arm, part), [(x["book"], x["tExit"], x["pnl"], x["gbp"], x["how"], x["tEntry"]) for x in tr]


def taker():
    live = L.D.load_live_orders()
    out = {"books_cleaned_of_live_orders": bool(live)}
    for b in L.BOOKS:
        bs = L.D.BookSeries(b, live)
        r = {}
        for th in (10, 15, 20, 25):
            tt, um = [], []
            for t, (m, _) in E.FC[b].items():
                if t < L.FWD[0] or abs(m) <= th: continue
                T = t + 85_000
                bb, ba = bs.at(T, "bb"), bs.at(T, "ba")
                bb2, ba2, mid2 = bs.at(T + 60 * M, "bb"), bs.at(T + 60 * M, "ba"), bs.at(T + 60 * M, "mid")
                if not (bb and ba and bb2 and ba2 and mid2): continue
                if m > 0:
                    tt.append((math.log(bb2 / ba) * 1e4) - 18); um.append(math.log(mid2 / ba) * 1e4 - 9)
                else:
                    tt.append((math.log(bb / ba2) * 1e4) - 18); um.append(math.log(bb / mid2) * 1e4 - 9)
            days = (L.FWD[1] - L.FWD[0]) / DAY
            r[f"th{th}"] = {"trades_per_day": round(len(tt) / days, 1), "taker_both_bps": round(st.fmean(tt), 2) if tt else None,
                            "maker_exit_at_mid_bound_bps": round(st.fmean(um), 2) if um else None,
                            "share_taker_positive": round(sum(1 for x in tt if x > 0) / len(tt), 3) if tt else None}
        # the touch's own width, for scale
        spreads = [math.log(a / bb_) * 1e4 for bb_, a in zip(bs.bb, bs.ba) if bb_ and a]
        r["touch_bps_median"] = round(st.median(spreads), 2) if spreads else None
        out[b] = r
    return out


def main(out, workers):
    jobs = [(v, a, p) for v in VARIANTS for a in ARMS for p in ("hist", "fwd") if not (v != "at_share1" and a == "exit2")]
    with Pool(workers) as pool:
        runs = dict(pool.map(job, jobs))
    alld = [d for d in E.days_in(L.START["USDC-GBP"], L.HIST[1]) + E.days_in(L.FWD[0], L.FWD[1])]
    split = L.day(L.SPLIT)
    res = {}
    for v in VARIANTS:
        for arm in ("exit1", "exit2"):
            if (v, arm, "hist") not in runs: continue
            def daily(a):
                d = collections.defaultdict(float)
                for p in ("hist", "fwd"):
                    for bk, te, pnl, gbp, how, tE in runs[(v, a, p)]: d[L.day(te)] += pnl
                return d
            db, dc = daily("base"), daily(arm)
            dv = [dc.get(x, 0.0) - db.get(x, 0.0) for x in alld]
            ins = [x for d, x in zip(alld, dv) if d < split]; oos = [x for d, x in zip(alld, dv) if d >= split]
            mo = collections.defaultdict(float)
            for d, x in zip(alld, dv): mo[d[:7]] += x
            def rec(a, lo, hi):
                tr = [x for p in ("hist", "fwd") for x in runs[(v, a, p)] if lo <= x[1] < hi]
                return {"pnl_gbp": round(sum(x[2] for x in tr), 2), "trips": len(tr), "stops": sum(1 for x in tr if x[4] == "taker"),
                        "bps_trip": round(1e4 * sum(x[2] for x in tr) / max(1e-9, sum(x[3] for x in tr)), 2)}
            res[f"{v}|{arm}"] = {"is_gbp_year": round(365 * st.fmean(ins), 2), "oos_gbp_year": round(365 * st.fmean(oos), 2),
                                 "oos_boot90_pLe0": E.boot(oos), "months_pos": sum(1 for x in mo.values() if x > 1e-9),
                                 "months_n": sum(1 for x in mo.values() if abs(x) > 1e-9),
                                 "base_oos": rec("base", L.SPLIT, L.FWD[1]), "arm_oos": rec(arm, L.SPLIT, L.FWD[1])}
            print(v, arm, json.dumps(res[f"{v}|{arm}"]), flush=True)
    res["taker_recorded_books"] = taker()
    print("taker", json.dumps(res["taker_recorded_books"]), flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4)
