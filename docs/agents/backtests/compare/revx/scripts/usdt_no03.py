"""USDT-NO03 (2026-10-29; Davies, 22:45, on RX-USDC's finding that the 0.3 % rung costs a lot on USDC-GBP: "目前的usdt实盘策略也研究回测一下这项"):
does LIVE as it now runs (USDT-GBP alone, six rungs of £100 at £600, the £1 holding line, the weekend rule) do better without
its 0.3 % rungs, and with its exits a tick beyond fair?

RX-USDC's harness (rx_usdc.py, STRATEGY-COMPARE's method: the PR5-OPT engine unchanged, every Revolut X UK print since USDT-GBP's
listing on 2025-12-16, LIVE's "at" fill, the weekend on the held X, days marked to market, the live haircut), on USDT-GBP alone,
at £600 (LIVE) and £1,200 (variant-1's size). A side's capital is half the book's; each arm splits it over the rungs:
  base     LIVE as is: a third on each of 0.1 / 0.2 / 0.3 % (£100 each at £600).
  no03     no 0.3 % rung: half on each of 0.1 / 0.2 % (£150 each at £600).
  no03a    no 0.3 %: a third on 0.1 %, two thirds on 0.2 % (£100 / £200).
  no03b    no 0.3 %: two thirds on 0.1 %, a third on 0.2 % (£200 / £100).
  x1       base with every exit a tick beyond fair (`exitOffset` 1; variant-6's rule).
  x1no03   no03 with x1.
Each arm paired by day with base: the mean difference in % a year, a circular 3-day block bootstrap's 80 % interval and P(≤ 0)
(10,000, seed 20261029), days ahead and behind, since 09-01, out of sample (from 05-12) and the last 30 days (from 09-29).
usage: python3 -I usdt_no03.py OUT.json [WORKERS]
"""
import json, os, sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare as C  # noqa: E402
import usdt_only as U  # noqa: E402

L = C.L
BOOK = "USDT-GBP"
SIZES = (600.0, 1200.0)
RUNGS = C.RUNGS
THIRD = 1 / 3
ARMS = {
    "base": {"k": {0.001: THIRD, 0.002: THIRD, 0.003: THIRD}},
    "no03": {"k": {0.001: 0.5, 0.002: 0.5}},
    "no03a": {"k": {0.001: THIRD, 0.002: 2 * THIRD}},
    "no03b": {"k": {0.001: 2 * THIRD, 0.002: THIRD}},
    "x1": {"k": {0.001: THIRD, 0.002: THIRD, 0.003: THIRD}, "exit_off": 1},
    "x1no03": {"k": {0.001: 0.5, 0.002: 0.5}, "exit_off": 1},
}
WINDOWS = (("post", "2026-09-01"), ("oos", C.SPLIT), ("last30", "2026-09-29"))


def job(a):
    arm, cap, part = a
    o = ARMS[arm]
    hm, hp, fm, fp = C.INPUTS
    mins, prints, win = (hm, hp, L.HIST) if part == "hist" else (fm, fp, L.FWD)
    side = cap / 2
    size = {(BOOK, s, k): side * o["k"].get(k, 0.0) for s in ("bid", "ask") for k in RUNGS}
    retired = tuple((BOOK, s, k) for s in ("bid", "ask") for k in RUNGS if k not in o["k"])
    kw = dict(capital=cap, xhold=True, fill="at", at_share=1.0, size=size, retired=retired, hold_min_gbp=1.0)
    if o.get("exit_off"): kw["exit_off"] = o["exit_off"]
    marks = {}
    tr, _ = L.sim.run({BOOK: mins[BOOK]}, prints, win[0], win[1], marks=marks, **kw)
    return a, ([(x["tEntry"], x["tExit"], x["pnl"], x["gbp"], x["how"]) for x in tr], marks)


def main(out, workers):
    hc = json.load(open(os.path.join(HERE, "..", "results", "haircut.json")))["applied"]
    jobs = [(a, s, p) for a in ARMS for s in SIZES for p in ("hist", "fwd")]
    with Pool(workers) as pool:
        runs = dict(pool.map(job, jobs))
    res = {"haircut": hc, "book": BOOK, "windows": dict(WINDOWS), "rows": {}}
    for s in SIZES:
        series = {}
        for a in ARMS:
            (th, mh), (tf, mf) = runs[(a, s, "hist")], runs[(a, s, "fwd")]
            m, dl = C.metrics(th + tf, {**mh, **mf}, BOOK, s, hc)
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
