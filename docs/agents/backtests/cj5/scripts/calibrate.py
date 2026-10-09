"""Calibration: VBook + the frozen pr5_sim.simulate on PR5's own committed Revolut X inputs must give PR5's published
PRIMARY (docs/agents/backtests/pr5/pr5_run1.json.gz) figure for figure, in dollars and in pounds' clothing.

1. gbp=False: the same books pr5_sim.Book builds -> PRIMARY, the stress arm and the by-book split must equal pr5_run1.
2. gbp=True on the same inputs (size £100, the 10 % cap in pounds): reported beside, as PR5's figure in pounds.
usage: python3 -I calibrate.py   -> ../results/calibration.json
"""
import gzip, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vbook import VBook, P  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.normpath(os.path.join(HERE, "..", "pr5", "pr5_run1.json.gz"))


def rx_inputs():
    fxmap = P.fx_series()
    fx_t = sorted(fxmap); fx_v = [fxmap[t] for t in fx_t]
    books = {}
    for b in P.BOOKS:
        prints = P.load_prints(b)
        hours = json.load(P._open(os.path.join(P.S, "data", "candles", f"{P.USD_OF[b]}_60.json")))["rows"]
        books[b] = (prints, [int(h["start"]) for h in hours], [float(h["close"]) for h in hours])
    return fx_t, fx_v, books


def main():
    fx_t, fx_v, books = rx_inputs()
    pub = json.load(gzip.open(PUB, "rt"))
    R = {"published": {"PRIMARY": pub["primary"]["PRIMARY"], "stress_PRIMARY": pub["stress"]["PRIMARY"],
                       "PRIMARY_by_book": pub["primary"]["PRIMARY_by_book"]}}
    for gbp in (False, True):
        out = {}
        for arm, kw in (("primary", {}), ("stress", {"stress": True})):
            trips = []
            per_book = {}
            for b in P.BOOKS:
                pr, ht, hc = books[b]
                B = VBook(b, pr, P.START[b], P.END, fx_t, fx_v, ht, hc, gbp=gbp)
                tr, _ = P.simulate(B, size=100.0, **kw)
                trips += tr
                per_book[b] = tr
            prim = P.prim_sel(trips)
            days = max((P.PRIM_END - P.START[b]) / 86400000 for b in P.BOOKS)
            out[arm] = P.summarize(prim, 0, 10**15, 1200.0, days)
            if arm == "primary":
                out["by_book"] = {b: P.summarize(P.prim_sel(per_book[b]), 0, 10**15, 600.0, (P.PRIM_END - P.START[b]) / 86400000) for b in P.BOOKS}
        R["gbp" if gbp else "usd"] = out
    u = R["usd"]
    R["reproduces_published"] = (u["primary"] == R["published"]["PRIMARY"] and u["stress"] == R["published"]["stress_PRIMARY"]
                                 and u["by_book"] == R["published"]["PRIMARY_by_book"])
    json.dump(R, open(os.path.join(HERE, "results", "calibration.json"), "w"), indent=1, sort_keys=True)
    print("reproduces published:", R["reproduces_published"])
    print("usd primary", u["primary"]["trips"], u["primary"]["pnl_usd"], "published", R["published"]["PRIMARY"]["trips"], R["published"]["PRIMARY"]["pnl_usd"])
    print("gbp primary", R["gbp"]["primary"]["trips"], R["gbp"]["primary"]["pnl_usd"])


if __name__ == "__main__":
    main()
