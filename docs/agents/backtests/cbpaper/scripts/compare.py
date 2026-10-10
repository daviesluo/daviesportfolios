"""Revolut X against Coinbase for PR5's frozen rule, and how a budget is best split between them (2026-10-10).

Davies, 2026-10-10: "先建起来吧，并且和Revolute X对比看哪个更好，投入的话资金该如何安排". Both venues run on the same frozen
`docs/agents/scripts/pr5/pr5_sim.py` `simulate`, imported read-only, the same interbank X and pounds sizing:
* Revolut X UK (USDC-GBP, USDT-GBP): CJ5's paired run's book (backtests/cj5/scripts/paired.py: Revolut X's UK prints,
  its own USD-book F3 fair, PR5's stop cost 0.09 % + 0.0067 %), each book from flat on its first day (2025-11-26,
  2025-12-16).
* Coinbase (USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR): SCQ-VENUES' minute bars (backtests/scq_venues/, proven equal to the
  prints for the simulator), fair from Bitstamp USDC/USD and Coinbase USDT-USD, the stop at 0.0045 % + half the touch;
  each book from flat on 2025-10-01.
Each book at rungs of £10 … £1,000 (six rungs a book: 6 × rung of capital), by entry day, in the windows below. Then:
* the correlation of the two venues' daily P&L at £100 a rung (Revolut X's window, and its last 90 days);
* the split of a budget of £500, £1,000, £2,000 and £5,000 that maximises £ a year: each book's rung chosen from the
  grid (or the book left out), capital 6 × rung, by dynamic programming over the books, on each window's yearly rate;
* the simple split the two accounts would run (one rung for Revolut X's two books, one for Coinbase's four), chosen on
  the worse of the last 90 days and the weeks since 2026-08-24.
usage: python3 -I compare.py   -> ../results/compare.json
"""
import collections, datetime, json, multiprocessing as mp, os, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BT = os.path.normpath(os.path.join(ROOT, ".."))
sys.path.insert(0, os.path.join(BT, "scq_venues", "scripts"))
sys.path.insert(0, os.path.join(BT, "cj5", "scripts"))
import paired as PD  # noqa: E402  (CJ5's: Revolut X's prints and hours)
import inputs as CI  # noqa: E402  (CJ5's: GBP/USD and the USD hourly series)
from vbook import VBook, P  # noqa: E402
import sv_sim as SV  # noqa: E402  (SCQ-VENUES' book builder for Coinbase)

M, DAY = 60000, 86400000
END = CI.ms("2026-10-09T00:00")
CB_T0 = CI.ms("2025-10-01T00:00")
RUNGS = [10.0, 15.0, 20.0, 25.0, 30.0, 40.0, 50.0, 75.0, 100.0, 150.0, 200.0, 300.0, 400.0, 500.0, 750.0, 1000.0]
WINDOWS = {"last_12_months": CI.ms("2025-10-09T00:00"), "since_2025-11-26": CI.ms("2025-11-26T00:00"), "last_90_days": CI.ms("2026-07-11T00:00"),
           "since_2026-08-24": CI.ms("2026-08-24T00:00"), "last_28_days": CI.ms("2026-09-11T00:00")}
RX = {"revx:USDC-GBP": "USDCGBP", "revx:USDT-GBP": "USDTGBP"}
CB = ["coinbase:USDC-GBP", "coinbase:USDT-GBP", "coinbase:USDC-EUR", "coinbase:USDT-EUR"]


def day_of(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def rx_book(key):
    b = RX[key]
    fx_t, fx_v = CI.load_fx()
    ht, hc = PD.rx_hours(P.USD_OF[PD.RX_BOOK[b]])
    return VBook(PD.RX_BOOK[b], PD.rx_prints(PD.RX_BOOK[b]), PD.W0[b], END, fx_t, fx_v, ht, hc, gbp=True)


def cb_book(key):
    SV.W0 = CB_T0
    SV.END = END
    return SV.build_book(key)


def task(key):
    """One book at every rung: its trips' (entry ms, pnl £, notional £) and its first instant."""
    if key in RX:
        B = rx_book(key)
        saved = (P.FEE, P.HALF_SPREAD, P.TICK)
        P.FEE, P.HALF_SPREAD, P.TICK = 0.0009, 0.000067, 1e-4
        out = {}
        for r in RUNGS:
            tr, _ = P.simulate(B, size=r)
            out[r] = [(x["t_entry"], x["pnl_usd"], x["notional_usd"]) for x in tr]
        P.FEE, P.HALF_SPREAD, P.TICK = saved
        return key, B.t0, out
    SV.BUILT.clear()
    SV.BUILT[key] = B = cb_book(key)
    out = {}
    for r in RUNGS:
        _, _, _, slim, _ = SV.run(key, r, "through")
        out[r] = [(x["t_entry"], x["pnl"], x["notional"]) for x in slim]
    SV.BUILT.clear()
    return key, B.meta["t0"], out


def main():
    with mp.get_context("fork").Pool(4) as pool:
        res = pool.map(task, list(RX) + CB, chunksize=1)
    T, T0 = {k: o for k, _, o in res}, {k: t0 for k, t0, _ in res}
    R = {"rungs": RUNGS, "windows": {k: day_of(v) for k, v in WINDOWS.items()}, "first": {k: day_of(v) for k, v in T0.items()}, "books": {}}
    rate = {}
    for k in T:
        R["books"][k] = {}
        for w, a in WINDOWS.items():
            a2 = max(a, T0[k])
            days = (END - a2) / DAY
            row = {}
            for r in RUNGS:
                sel = [x for x in T[k][r] if x[0] >= a2]
                pnl = sum(x[1] for x in sel)
                row[str(int(r))] = {"gbp_per_year": round(pnl / days * 365, 2), "trips": len(sel), "fills_gbp_per_day": round(sum(x[2] for x in sel) / days, 2)}
                rate[(k, w, r)] = pnl / days * 365
            R["books"][k][w] = {"days": round(days, 1), "by_rung": row}
    # Venue totals per window and rung (both venues' books at one rung).
    R["venues"] = {}
    for v, keys in (("revx", list(RX)), ("coinbase", CB)):
        R["venues"][v] = {w: {str(int(r)): {"capital_gbp": 6 * r * len(keys), "gbp_per_year": round(sum(rate[(k, w, r)] for k in keys), 2),
                                             "pct_per_year": round(100 * sum(rate[(k, w, r)] for k in keys) / (6 * r * len(keys)), 2)} for r in RUNGS} for w in WINDOWS}
    # Correlation of daily P&L at £100 a rung.
    def daily(keys, r=100.0):
        d = collections.Counter()
        for k in keys:
            for t, p, _ in T[k][r]:
                d[day_of(t)] += p
        return d
    rx, cb = daily(list(RX)), daily(CB)
    R["correlation_100"] = {}
    for w in ("since_2025-11-26", "last_90_days", "since_2026-08-24"):
        a = WINDOWS[w]
        D = [day_of(t) for t in range(a, END, DAY)]
        xa, xb = [rx.get(x, 0.0) for x in D], [cb.get(x, 0.0) for x in D]
        R["correlation_100"][w] = {"days": len(D), "daily": round(st.correlation(xa, xb), 4),
                                    "weekly": round(st.correlation([sum(xa[i:i + 7]) for i in range(0, len(D), 7)], [sum(xb[i:i + 7]) for i in range(0, len(D), 7)]), 4),
                                    "revx_gbp": round(sum(xa), 2), "coinbase_gbp": round(sum(xb), 2)}
    # The budget split: a rung for each book (or none), capital 6 × rung, the most £ a year; DP over £10 steps of capital.
    books = list(RX) + CB
    R["allocation"] = {}
    for w in ("last_12_months", "last_90_days", "since_2026-08-24", "last_28_days"):
        R["allocation"][w] = {}
        for budget in (500, 1000, 2000, 5000):
            units = budget // 10
            best = {0: (0.0, {})}
            for k in books:
                nb = dict(best)
                for used, (val, pick) in best.items():
                    for r in RUNGS:
                        u = int(6 * r) // 10
                        if used + u > units:
                            continue
                        v = val + rate[(k, w, r)]
                        if used + u not in nb or v > nb[used + u][0] + 1e-9:
                            nb[used + u] = (v, {**pick, k: r})
                best = nb
            val, pick = max(best.values(), key=lambda x: x[0])
            cap = {v: sum(6 * r for k, r in pick.items() if k.startswith(v)) for v in ("revx", "coinbase")}
            R["allocation"][w][str(budget)] = {"gbp_per_year": round(val, 2), "pct_per_year": round(100 * val / budget, 2), "capital_used": sum(cap.values()),
                                               "revx_capital": cap["revx"], "coinbase_capital": cap["coinbase"], "rungs": {k: int(r) for k, r in sorted(pick.items())}}
            print(w, budget, R["allocation"][w][str(budget)], flush=True)
    # The simple split, as the two accounts would run: one rung for Revolut X's two books, one for Coinbase's four (or
    # none), chosen to maximise the WORSE of two recent windows' yearly rates (the last 90 days and since 2026-08-24), so a
    # split that only one regime favours does not win.
    R["simple_split"] = {}
    grid = [0.0] + RUNGS
    vr = lambda keys, w, r: 0.0 if r == 0 else sum(rate[(k, w, r)] for k in keys)
    for budget in (500, 1000, 2000, 5000):
        best = None
        for a in grid:
            for b in grid:
                cap = 12 * a + 24 * b
                if cap > budget:
                    continue
                ws = {w: vr(list(RX), w, a) + vr(CB, w, b) for w in ("last_12_months", "last_90_days", "since_2026-08-24", "last_28_days")}
                score = min(ws["last_90_days"], ws["since_2026-08-24"])
                if best is None or score > best[0] + 1e-9:
                    best = (score, a, b, cap, ws)
        score, a, b, cap, ws = best
        R["simple_split"][str(budget)] = {"revx_rung": a, "revx_capital": 12 * a, "coinbase_rung": b, "coinbase_capital": 24 * b, "capital_used": cap,
                                          "gbp_per_year": {w: round(v, 2) for w, v in ws.items()}, "worse_of_90d_and_since_08_24": round(score, 2)}
        print("simple", budget, R["simple_split"][str(budget)], flush=True)
    json.dump(R, open(os.path.join(ROOT, "results", "compare.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
