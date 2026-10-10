"""Diversification: each candidate book's daily P&L against PR5's on Revolut X and CJ5's on CoinJar, the same days.

* PR5 on Revolut X: CJ5's paired run (backtests/cj5/scripts/paired.py, imported read-only): Revolut X's UK prints and its
  own USD-book F3 fair, PR5's stop cost (0.09 % + 0.0067 %), £100 a rung, each book from flat on its first day
  (USDC-GBP 2025-11-26, USDT-GBP 2025-12-16) to 2026-10-09 00:00 UTC. Computed here once and kept in
  ../results/pr5_revx_daily_100.json.
* CJ5: its committed trips at £100 (backtests/cj5/results/cj5_trips_100.json.gz), by entry day.
* Candidates: ../results/daily_100.json (sv_sim.py), by entry day; by book and by venues.py's packages.
Window: 2025-11-26 -> 2026-10-08 (317 days); a day with no trip is 0. Pearson correlation of daily P&L, and of weekly sums.
usage: python3 -I pairing.py   -> ../results/pairing.json
"""
import collections, datetime, gzip, json, os, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CJ5 = os.path.normpath(os.path.join(ROOT, "..", "cj5"))
sys.path.insert(0, os.path.join(CJ5, "scripts"))
sys.path.insert(1, HERE)
import paired as PD  # noqa: E402  (CJ5's)
import inputs as CI  # noqa: E402
from vbook import VBook, P  # noqa: E402

DAY = 86400000
A, Z = CI.ms("2025-11-26T00:00"), CI.ms("2026-10-09T00:00")
DAYS = [datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d") for t in range(A, Z, DAY)]


def pr5_daily():
    fn = os.path.join(ROOT, "results", "pr5_revx_daily_100.json")
    if os.path.exists(fn):
        return json.load(open(fn))["daily"]
    fx_t, fx_v = CI.load_fx()
    d = collections.Counter()
    saved = (P.FEE, P.HALF_SPREAD)
    P.FEE, P.HALF_SPREAD = 0.0009, 0.000067
    n = 0
    for b in CI.PRODUCTS:
        ht, hc = PD.rx_hours(P.USD_OF[PD.RX_BOOK[b]])
        B = VBook(PD.RX_BOOK[b], PD.rx_prints(PD.RX_BOOK[b]), PD.W0[b], Z, fx_t, fx_v, ht, hc, gbp=True)
        tr, _ = P.simulate(B, size=100.0)
        n += len(tr)
        for x in tr:
            d[PD.C.day_of(x["t_entry"])] += x["pnl_usd"]
    P.FEE, P.HALF_SPREAD = saved
    out = {k: round(v, 6) for k, v in sorted(d.items())}
    json.dump({"source": "cj5 paired.py's PR5_revx run, £100 a rung, by entry day", "trips": n, "total_gbp": round(sum(out.values()), 4), "daily": out},
              open(fn, "w"), indent=0, sort_keys=True)
    return out


def cj5_daily():
    with gzip.open(os.path.join(CJ5, "results", "cj5_trips_100.json.gz"), "rt") as f:
        trips = json.load(f)
    d = collections.Counter()
    for x in trips:
        d[PD.C.day_of(x["t_entry"])] += x["pnl_usd"]
    return d


def corr(a, b):
    xa, xb = [a.get(k, 0.0) for k in DAYS], [b.get(k, 0.0) for k in DAYS]
    if not st.pstdev(xa) or not st.pstdev(xb):
        return None
    wa, wb = collections.Counter(), collections.Counter()
    for i, k in enumerate(DAYS):
        wa[i // 7] += xa[i]; wb[i // 7] += xb[i]
    return {"daily": round(st.correlation(xa, xb), 4), "weekly": round(st.correlation(list(wa.values()), list(wb.values())), 4)}


def main():
    pr5, cj5 = pr5_daily(), cj5_daily()
    cand = json.load(open(os.path.join(ROOT, "results", "daily_100.json")))["daily"]
    from venues import PKG
    venues = {name: collections.Counter() for name in PKG}
    for name, books in PKG.items():
        for k in books:
            venues[name].update(cand[k])
    R = {"window": [DAYS[0], DAYS[-1]], "days": len(DAYS),
         "pr5_revx_total_gbp": round(sum(pr5.get(k, 0.0) for k in DAYS), 4), "cj5_total_gbp": round(sum(cj5.get(k, 0.0) for k in DAYS), 4),
         "pr5_vs_cj5": corr(pr5, cj5), "books": {}, "venues": {}}
    for k, d in cand.items():
        R["books"][k] = {"total_gbp": round(sum(d.get(x, 0.0) for x in DAYS), 4), "vs_pr5": corr(d, pr5), "vs_cj5": corr(d, cj5)}
    for v, d in venues.items():
        R["venues"][v] = {"total_gbp": round(sum(d.get(x, 0.0) for x in DAYS), 4), "vs_pr5": corr(d, pr5), "vs_cj5": corr(d, cj5)}
    json.dump(R, open(os.path.join(ROOT, "results", "pairing.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(R, indent=1))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "pr5":
        print(sum(pr5_daily().values()))
    else:
        main()
