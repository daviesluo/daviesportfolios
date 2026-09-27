"""USLATE at a one-second loop — added after the freeze, descriptive, no bar.

Davies' standing rule (2026-09-26, `.claude/CLAUDE.md`): a study prices speed at one second, because pg_cron on the
project runs a job every 1–59 s. USLATE's primary, its bar and its verdict stay `uslate_test.py`'s as frozen; this
script only asks how much of the frozen rule's delay is the loop's and how much is the source's.

Every arm is the frozen test's own `run` on the same input (the same prints, half of each, the $100 cap, each
market's fee schedule, held to the payout); only the instant the loop may act moves:
* frozen: the report's observation + the station's p90 AWC receipt delay + 90 s — the pre-registered primary, run
  again here as a check (it must reproduce the primary's total, null and bootstrap exactly);
* p90 + 2 s: the same at a 1 s loop (a 1 s poll and the order);
* p50 + 2 s: the same at the station's median receipt delay;
* p50 + 60 s: the pre-registered descriptive arm, again, for its breakdown by station;
* observation + 2 s: a source with no delay — a bound, not an arm any public source allows (AWC receives a US report
  a median 3–4 minutes after its observation time), and it assumes our order stands beside the fastest takers' own
  prints.
For each: the test's summary, the halves, the best date and its share, the total without it, the calibration null's
p95, the date bootstrap's p5 (the test's seeds and draws), and the total by station. And the delay itself: each
station's p50 and p90 AWC receipt delay (the frozen table) with its market-days; over the input's market-days, the
station's p50 and p90 receipt delay, and the share of the frozen delay (p90 + 90 s) and of the 1 s delay (p90 + 2 s)
that the loop adds.

usage: uslate_speed.py <input json.gz> <out json> [--split YYYY-MM-DD]
"""
import copy
import gzip
import json
import os
import random
import sys
from collections import defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import uslate_test as T  # noqa: E402


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def describe(fills, days, split, station_of):
    s = T.summary(fills, days)
    by_date = defaultdict(float)
    by_station = defaultdict(float)
    for f in fills:
        by_date[f[0]] += T.pnl(f)
        by_station[station_of[f[1]]] += T.pnl(f)
    halves = None
    if split:
        halves = {"first": round(sum(v for d, v in by_date.items() if d < split), 6),
                  "second": round(sum(v for d, v in by_date.items() if d >= split), 6)}
    # the null and the bootstrap exactly as uslate_test.main draws them
    rng = random.Random(T.SEED)
    nulls = []
    for _ in range(10000):
        t = 0.0
        for f in fills:
            t += f[4] * ((1.0 if rng.random() < f[5] else 0.0) - f[5]) - f[6]
        nulls.append(t)
    nulls.sort()
    rng2 = random.Random(T.SEED)
    dates = sorted(by_date)
    boots = []
    for _ in range(2000):
        boots.append(sum(by_date[rng2.choice(dates)] for _ in range(len(dates))) if dates else 0.0)
    boots.sort()
    best = max(by_date.items(), key=lambda kv: kv[1]) if by_date else (None, 0.0)
    delays = [f[3] for f in fills]
    return {"summary": s, "halves": halves,
            "best_date": {"date": best[0], "pnl": round(best[1], 6),
                          "share_of_total": round(best[1] / s["pnl"], 4) if s["pnl"] > 0 else None,
                          "total_without_it": round(s["pnl"] - best[1], 6)},
            "null_p95": round(nulls[int(0.95 * len(nulls))], 6) if fills else None,
            "date_bootstrap_p5": round(boots[int(0.05 * len(boots))], 6) if dates else None,
            "dates_positive": sum(1 for v in by_date.values() if v > 0),
            "by_station": {k: round(by_station.get(k, 0.0), 6) for k in sorted(set(station_of.values()))},
            "fills_n": len(delays)}


def main():
    inp, outp = sys.argv[1], sys.argv[2]
    split = sys.argv[sys.argv.index("--split") + 1] if "--split" in sys.argv else None
    with gzip.open(inp, "rt") as g:
        data = json.load(g)
    events = data["events"]
    days = (date.fromisoformat(data["to"]) - date.fromisoformat(data["from"])).days
    no_delay = copy.deepcopy(events)
    for e in no_delay:
        e["lag_p90"] = 0.0
        e["lag_p50"] = 0.0
    arms = {
        "frozen_p90_plus_90s": T.run(events),
        "p90_plus_2s": T.run(events, extra=2),
        "p50_plus_2s": T.run(events, lag="p50", extra=2),
        "p50_plus_60s_preregistered_descriptive": T.run(events, lag="p50", extra=60),
        "observation_plus_2s_bound": T.run(no_delay, extra=2),
    }
    station_of = {e["event"]: e["station"] for e in events}
    p90 = [e["lag_p90"] for e in events]
    p50 = [e["lag_p50"] for e in events if e["lag_p50"] is not None]
    lags = {}
    for e in events:
        lags.setdefault(e["station"], {"p50": e["lag_p50"], "p90": e["lag_p90"], "market_days": 0})["market_days"] += 1
    out = {"input": {"file": os.path.basename(inp), "from": data["from"], "to": data["to"],
                     "stations": data.get("stations"), "events": len(events), "days": days},
           "station_delays_s": dict(sorted(lags.items())),
           "note": "added after the freeze; descriptive; no bar",
           "delay_s": {"station_p90_over_market_days": {"p10": q(p90, .1), "p50": q(p90, .5), "p90": q(p90, .9)},
                       "station_p50_over_market_days": {"p10": q(p50, .1), "p50": q(p50, .5), "p90": q(p50, .9)},
                       "loop_share_of_frozen_delay_at_median_station": round(90 / (q(p90, .5) + 90), 4),
                       "loop_share_of_1s_delay_at_median_station": round(2 / (q(p90, .5) + 2), 4)},
           "arms": {k: describe(v, days, split, station_of) for k, v in arms.items()}}
    with open(outp, "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print(json.dumps(out["delay_s"], indent=1))
    for k, v in out["arms"].items():
        s = v["summary"]
        print(f"{k:28} total {s['pnl']:10.2f} halves {v['halves']} buckets {s['bucket_deaths']:4} dates {s['dates']:4} "
              f"peak {s['peak_capital']:9.2f} ann {s['annualised_on_peak']} best {v['best_date']} "
              f"null95 {v['null_p95']} boot5 {v['date_bootstrap_p5']} wrong {s['wrong_bucket_deaths']} {s['wrong_pnl']:.2f}")


if __name__ == "__main__":
    main()
