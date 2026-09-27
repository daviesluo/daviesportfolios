"""USLATE-FAST: USLATE's rule acted on the moment the fastest keyless source publishes the report (the test).

`reviews/2026-09-27-speed-prereg-uslate-fast.md` governs; this file is its code. It is USLATE's `uslate_test.py`
(imported unchanged: its fee, P&L, capital and summary) with one difference, the instant the loop may act:
* a bucket's deciding report is acted on at `pub` + 0.25 s, where `pub` is the instant the recorder first saw that
  report in tgftp.nws.noaa.gov's METAR cycle file (read every second) — not the observation time + the station's 90th
  percentile AWC delay + 90 s;
* a print counts only from act + 3 s on its data-API time, because that time runs 2–3 s behind the match itself
  (`results/print_time_lag.json`: p50 1.96 s, p90 2.96 s) — a print stamped earlier may have matched before we could.
Everything else is USLATE's: every stale-side print with g >= 1 ¢ from then fills half its size at its own price, in
time order, to $100 a bucket; the market's own fee; held to resolution; traps included.

The input is USLATE's format (`uslate_inputs.py`) with `pub` added to each bucket; a bucket without `pub` (the
recorder never saw its report) is left out and counted.

usage: uslate_fast_eval.py <input json.gz> <out json> [--split YYYY-MM-DD] [--days N]
"""
import gzip
import json
import os
import random
import sys
from collections import defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "pmlate", "scripts"))
import uslate_test as U  # noqa: E402

ACT_S = 0.25          # the 1 s loop's dispatch and the order, after the recorder's sighting
PRINT_LAG_S = 3.0     # the data API's print time behind the match (p90 2.96 s)
SEED = 20260927


def run_fast(events, act_s=ACT_S, lag_s=PRINT_LAG_S, g_min=U.G_MIN, cap=U.CAP_USD, share=U.SHARE, tick_worse=False,
             fee_mult=1.0):
    """Every fill under one set of parameters, in `uslate_test.run`'s row shape; and how many buckets had no `pub`."""
    fills, missing = [], 0
    for e in events:
        for i, b in enumerate(e["buckets"]):
            if b.get("pub") is None:
                missing += 1
                continue
            act = b["pub"] + act_s
            won = b["payout_yes"] == 1.0
            wrong = (b["state"] == "dead" and won) or (b["state"] == "locked" and not won)
            payout = (1.0 - b["payout_yes"]) if b["state"] == "dead" else b["payout_yes"]
            spent = 0.0
            for ts, stale, y, size in b["prints"]:
                if ts < act + lag_s or not stale:
                    continue
                g = y if b["state"] == "dead" else 1.0 - y
                if g < g_min - 1e-12:
                    continue
                px = 1.0 - y if b["state"] == "dead" else y
                if tick_worse:
                    px += 0.001 if (y < 0.04 or y > 0.96) else 0.01
                if px >= 1.0:
                    continue
                sh = share * size
                if spent + sh * px > cap:
                    sh = (cap - spent) / px
                if sh <= 1e-9:
                    break
                spent += sh * px
                f = fee_mult * sh * U.fee(b["fee_rate"], b.get("fee_exp", 1), px)
                fills.append([e["date"], e["event"], i, ts, sh, px, f, payout, b["closed"] or (b["obs"] + 172800),
                              wrong, e.get("source")])
                if spent >= cap - 1e-9:
                    break
    return fills, missing


def main():
    inp, outp = sys.argv[1], sys.argv[2]
    split = sys.argv[sys.argv.index("--split") + 1] if "--split" in sys.argv else None
    with gzip.open(inp, "rt") as g:
        data = json.load(g)
    events = [e for e in data["events"] if e.get("us")]
    days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else \
        (date.fromisoformat(data["to"]) - date.fromisoformat(data["from"])).days
    prim, missing = run_fast(events)
    s = U.summary(prim, days)
    by_date = defaultdict(float)
    for f in prim:
        by_date[f[0]] += U.pnl(f)
    halves = None
    if split:
        halves = {"first": round(sum(v for d, v in by_date.items() if d < split), 6),
                  "second": round(sum(v for d, v in by_date.items() if d >= split), 6)}
    rng = random.Random(SEED)
    nulls = sorted(sum(f[4] * ((1.0 if rng.random() < f[5] else 0.0) - f[5]) - f[6] for f in prim) for _ in range(10000))
    null95 = nulls[int(0.95 * len(nulls))]
    rng2 = random.Random(SEED)
    dates = sorted(by_date)
    boots = sorted(sum(by_date[rng2.choice(dates)] for _ in range(len(dates))) if dates else 0.0 for _ in range(2000))
    boot5 = boots[100]
    best = max(by_date.items(), key=lambda kv: kv[1]) if by_date else (None, 0.0)
    stress = U.summary(run_fast(events, tick_worse=True, fee_mult=2.0)[0], days)
    slow = U.summary(U.run(events, which=True), days)          # USLATE's own rule on the same days
    bar = {
        "1_total_and_halves_positive": s["pnl"] > 0 and (halves is None or (halves["first"] > 0 and halves["second"] > 0)),
        "2_above_null_p95": s["pnl"] > null95,
        "3_stress_positive": stress["pnl"] > 0,
        "4_at_least_15_buckets_on_8_dates": s["bucket_deaths"] >= 15 and s["dates"] >= 8,
        "5_date_bootstrap_p5_positive": boot5 > 0,
        "6_best_date_under_40pct_and_rest_positive": s["pnl"] > 0 and best[1] <= 0.4 * s["pnl"] and (s["pnl"] - best[1]) > 0,
        "7_worth_money_4pct_a_year_on_peak_capital": s["annualised_on_peak"] is not None and s["annualised_on_peak"] > 0.04,
        "8_beats_uslate_on_the_same_days": s["pnl"] > slow["pnl"],
    }
    desc = {"act_plus_1s": U.summary(run_fast(events, act_s=1.0)[0], days),
            "act_plus_5s": U.summary(run_fast(events, act_s=5.0)[0], days),
            "print_lag_0s": U.summary(run_fast(events, lag_s=0.0)[0], days),
            "share_100pct": U.summary(run_fast(events, share=1.0)[0], days),
            "uncapped": U.summary(run_fast(events, cap=float("inf"))[0], days)}
    out = {"input": {"from": data["from"], "to": data["to"], "events": len(events),
                     "buckets_decided": sum(len(e["buckets"]) for e in events), "buckets_without_pub": missing},
           "rule": {"act_s": ACT_S, "print_lag_s": PRINT_LAG_S, "cap_usd": U.CAP_USD, "share": U.SHARE, "g_min": U.G_MIN,
                    "seed": SEED},
           "primary": s, "halves": halves,
           "null": {"draws": 10000, "p95": round(null95, 6), "p_value": round(sum(1 for x in nulls if x >= s["pnl"]) / 10000, 6)},
           "date_bootstrap": {"draws": 2000, "p5": round(boot5, 6)}, "best_date": {"date": best[0], "pnl": round(best[1], 6)},
           "stress": stress, "uslate_same_days": slow, "bar": bar, "passes": all(bar.values()), "descriptive": desc,
           "by_date": {d: round(v, 6) for d, v in sorted(by_date.items())}}
    with open(outp, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps({k: out[k] for k in ("input", "primary", "halves", "null", "date_bootstrap", "bar", "passes")}, indent=1))


if __name__ == "__main__":
    main()
