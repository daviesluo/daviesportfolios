"""RX-USDC (2026-10-29; Davies: "我也不想完全放弃revolut x的usdc盘，你用最新的"Stablecoin quotes USDT/GBP"的rules+之前测试的与coinbase价格
联动的那个优化…也上线一个revolut x的Stablecoin quotes USDC/GBP 策略…我把那个账户改为了120磅"): which rules for a £120 live book on Revolut
X's USDC-GBP alone.

STRATEGY-COMPARE's method (compare.py: the PR5-OPT engine unchanged, every Revolut X UK print since USDC-GBP's listing, LIVE's
"at" fill, the weekend on the held X, days marked to market, the live haircut), on USDC-GBP alone (six rungs, capital ÷ 6:
£20 at £120, £100 at £600), every arm with the £1 holding line unless it says otherwise. Arms:
  base    LIVE's rules as they run from 2026-10-29 22:30 (the £1 line), on USDC-GBP alone.
  nudge   + REVX-FAIR's Coinbase nudge (`quotes_nudge.ts`: w 0.5, a 24-hour half-life), Coinbase's USDC-GBP last print a minute to
          10-08, the recorder's touch from 10-10 (compare.py's `nudge_adj`).
  x1      + every exit a tick beyond fair (`exitOffset` 1).
  nx1     nudge and x1.
  no03    the 0.3 % rungs quote nothing, their pounds on the 0.1 % and 0.2 % rungs (`weights.k` 1 / 1 / 0: £30 a rung at £120).
  k1      the 0.1 % rungs alone (`weights.k` 1 / 0 / 0: £60 a rung at £120).
  x1no03, nx1no03, x1k1, nno03: the combinations.
  h05/h2  the holding line at £0.50 / £2 instead of £1 (a £20 rung's £1 line is 5 % of it).
  nowk    no weekend rule (dark through an FX closure, as LIVE before 10-23).
Each arm paired by day against base: the mean difference in % a year, a circular 3-day block bootstrap's 80 % interval and
P(≤ 0) (10,000 resamples, seed 20261029), days ahead and behind, for the days since 09-01, out of sample (from 05-12), the last
30 days (from 09-29) and the days the Coinbase touch was recorded (from 10-11, REVX-FAIR's window).
usage: python3 -I rx_usdc.py OUT.json [WORKERS]
"""
import collections, json, os, sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare as C  # noqa: E402
import usdt_only as U  # noqa: E402

L = C.L
BOOK = "USDC-GBP"
SIZES = (120.0, 600.0)
RUNGS = C.RUNGS
ARMS = {
    "base": {}, "nudge": {"nudge": True}, "x1": {"exit_off": 1}, "nx1": {"nudge": True, "exit_off": 1},
    "no03": {"k": (0.001, 0.002)}, "nno03": {"nudge": True, "k": (0.001, 0.002)},
    "x1no03": {"exit_off": 1, "k": (0.001, 0.002)}, "nx1no03": {"nudge": True, "exit_off": 1, "k": (0.001, 0.002)},
    "k1": {"k": (0.001,)}, "x1k1": {"exit_off": 1, "k": (0.001,)},
    "h05": {"hold_min": 0.5}, "h2": {"hold_min": 2.0}, "nowk": {"nowk": True},
}
WINDOWS = (("post", "2026-09-01"), ("oos", C.SPLIT), ("last30", "2026-09-29"), ("touch", "2026-10-11"))


def job(a):
    arm, cap, part = a
    o = ARMS[arm]
    hm, hp, fm, fp = C.INPUTS
    mins, prints, win = (hm, hp, L.HIST) if part == "hist" else (fm, fp, L.FWD)
    size = {(BOOK, s, k): cap / 6 for s in ("bid", "ask") for k in RUNGS}
    retired = ()
    if o.get("k"):
        ks = o["k"]   # the rungs that quote, the capital over them (`weights.k`: the others 0)
        size = {(BOOK, s, k): (cap / (2 * len(ks)) if k in ks else 0.0) for s in ("bid", "ask") for k in RUNGS}
        retired = tuple((BOOK, s, k) for s in ("bid", "ask") for k in RUNGS if k not in ks)
    kw = dict(capital=cap, xhold=not o.get("nowk"), fill="at", at_share=1.0, size=size, retired=retired, hold_min_gbp=o.get("hold_min", 1.0))
    stats = collections.Counter()
    if o.get("nudge"): kw["fair_adj"] = C.nudge_adj(BOOK, stats)
    if o.get("exit_off"): kw["exit_off"] = o["exit_off"]
    marks = {}
    tr, _ = L.sim.run({BOOK: mins[BOOK]}, prints, win[0], win[1], marks=marks, **kw)
    return a, ([(x["tEntry"], x["tExit"], x["pnl"], x["gbp"], x["how"]) for x in tr], marks), dict(stats)


def main(out, workers):
    hc = json.load(open(os.path.join(HERE, "..", "results", "haircut.json")))["applied"]
    jobs = [(a, s, p) for a in ARMS for s in SIZES for p in ("hist", "fwd")]
    with Pool(workers) as pool:
        got = pool.map(job, jobs)
    runs = {k: v for k, v, _ in got}
    nst = {k: s for k, _, s in got}
    res = {"haircut": hc, "book": BOOK, "windows": dict(WINDOWS), "rows": {}}
    for s in SIZES:
        series = {}
        for a in ARMS:
            (th, mh), (tf, mf) = runs[(a, s, "hist")], runs[(a, s, "fwd")]
            m, dl = C.metrics(th + tf, {**mh, **mf}, BOOK, s, hc)
            if ARMS[a].get("nudge"):
                t = collections.Counter(nst[(a, s, "hist")]) + collections.Counter(nst[(a, s, "fwd")])
                m["nudge"] = {k: round(t[k] / t["lit"], 4) for k in ("nudged", "stale", "cap", "warm")}
            series[a] = dict(zip(dl["days"], dl["adj"]))
            res["rows"][f"{a}|{int(s)}"] = m
        for a in ARMS:
            if a == "base": continue
            res["rows"][f"{a}|{int(s)}"]["vs_base"] = {w: U.paired(series[a], series["base"], s, lo) for w, lo in WINDOWS}
            print(int(s), a, json.dumps(res["rows"][f"{a}|{int(s)}"]["vs_base"]), flush=True)
        res["rows"][f"base|{int(s)}"]["monthly_pct_yr"] = U.monthly(series["base"], s)
        print(int(s), "base", res["rows"][f"base|{int(s)}"]["headline_pct_yr"], res["rows"][f"base|{int(s)}"]["oos_pct_yr"], flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4)
