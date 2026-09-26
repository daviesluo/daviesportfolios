"""USLATE: take what is left on the losing side once a METAR report has decided a temperature bucket (the test).

The rule (`reviews/2026-09-26-pmlate-prereg-uslate.md` governs; this file is its code):
* a bucket is decided by the first report of the local day whose running extreme makes it dead (a high's running
  maximum above its top, a low's running minimum below its bottom) or locked (an "X or higher" high reached, an
  "X or below" low reached);
* the loop may act at the report's observation time + the station's 90th-percentile AWC receipt delay + 90 s;
* from then until the market closes, every stale-side print whose gross edge g — a dead bucket's YES price, a locked
  bucket's 1 − YES — is at least 1¢ fills us for half its size at its own price (we buy the dead bucket's NO at 1 − y,
  the locked bucket's YES at y), in time order, until the bucket has cost $100;
* the taker fee is each market's own schedule, shares × rate × (p × (1 − p)) ** exponent at the fill price p;
* held to resolution; payout from the market's result.

Arms: the primary, a stress arm (each fill one tick worse — 0.001 where y < 0.04 or y > 0.96, else 0.01 — and fees
doubled), a calibration null (each fill's token pays 1 with probability equal to its price; 10,000 draws), a
bootstrap over the distinct target dates (2,000 draws), and descriptive arms that change one thing at a time.

usage: uslate_test.py <input json.gz> <out json> [--split YYYY-MM-DD] [--days N]
"""
import gzip
import json
import math
import random
import sys
from collections import defaultdict

SEED = 20260926
CAP_USD = 100.0
SHARE = 0.5
G_MIN = 0.01
EXTRA_S = 90


def fee(rate, exp, p):
    return (rate or 0.0) * (p * (1.0 - p)) ** (exp or 1)


def run(events, lag="p90", extra=EXTRA_S, g_min=G_MIN, cap=CAP_USD, share=SHARE, tick_worse=False, fee_mult=1.0,
        which=None):
    """Every fill of the rule under one set of parameters: [date, event, bucket index, ts, shares, price, fee,
    payout, closed, wrong, source]."""
    fills = []
    for e in events:
        if which is not None and e["us"] != which:
            continue
        lag_s = e["lag_p50"] if (lag == "p50" and e["lag_p50"] is not None) else e["lag_p90"]
        for i, b in enumerate(e["buckets"]):
            act = b["obs"] + lag_s + extra
            won = b["payout_yes"] == 1.0
            wrong = (b["state"] == "dead" and won) or (b["state"] == "locked" and not won)
            payout = (1.0 - b["payout_yes"]) if b["state"] == "dead" else b["payout_yes"]
            spent = 0.0
            for ts, stale, y, size in b["prints"]:
                if ts < act or not stale:
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
                f = fee_mult * sh * fee(b["fee_rate"], b.get("fee_exp", 1), px)
                fills.append([e["date"], e["event"], i, ts, sh, px, f, payout, b["closed"] or (b["obs"] + 172800),
                              wrong, e.get("source")])
                if spent >= cap - 1e-9:
                    break
    return fills


def pnl(f):
    return f[4] * (f[7] - f[5]) - f[6]


def peak_capital(fills):
    ev = []
    for f in fills:
        c = f[4] * f[5]
        ev.append((f[3], c))
        ev.append((f[8], -c))
    ev.sort()
    cur = peak = 0.0
    for _, c in ev:
        cur += c
        peak = max(peak, cur)
    return peak


def summary(fills, days):
    tot = sum(pnl(f) for f in fills)
    by_date = defaultdict(float)
    for f in fills:
        by_date[f[0]] += pnl(f)
    cap = peak_capital(fills)
    buckets = {(f[1], f[2]) for f in fills}
    wrong = [f for f in fills if f[9]]
    return {"pnl": round(tot, 6), "fills": len(fills), "bucket_deaths": len(buckets), "dates": len(by_date),
            "cost": round(sum(f[4] * f[5] for f in fills), 6), "fees": round(sum(f[6] for f in fills), 6),
            "peak_capital": round(cap, 6),
            "annualised_on_peak": round((tot / cap) * 365.0 / days, 6) if cap > 0 else None,
            "wrong_bucket_deaths": len({(f[1], f[2]) for f in wrong}), "wrong_pnl": round(sum(pnl(f) for f in wrong), 6),
            "wrong_cost": round(sum(f[4] * f[5] for f in wrong), 6)}


def main():
    inp, outp = sys.argv[1], sys.argv[2]
    split = sys.argv[sys.argv.index("--split") + 1] if "--split" in sys.argv else None
    with gzip.open(inp, "rt") as g:
        data = json.load(g)
    events = data["events"]
    d0, d1 = data["from"], data["to"]
    days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else \
        (int((__import__("datetime").date.fromisoformat(d1) - __import__("datetime").date.fromisoformat(d0)).days))
    prim = run(events)
    s = summary(prim, days)
    by_date = defaultdict(float)
    for f in prim:
        by_date[f[0]] += pnl(f)
    halves = None
    if split:
        h1 = sum(v for d, v in by_date.items() if d < split)
        h2 = sum(v for d, v in by_date.items() if d >= split)
        halves = {"first": round(h1, 6), "second": round(h2, 6)}
    rng = random.Random(SEED)
    nulls = []
    for _ in range(10000):
        t = 0.0
        for f in prim:
            t += f[4] * ((1.0 if rng.random() < f[5] else 0.0) - f[5]) - f[6]
        nulls.append(t)
    nulls.sort()
    null95 = nulls[int(0.95 * len(nulls))] if nulls else None
    rng2 = random.Random(SEED)
    dates = sorted(by_date)
    boots = []
    for _ in range(2000):
        boots.append(sum(by_date[rng2.choice(dates)] for _ in range(len(dates))) if dates else 0.0)
    boots.sort()
    boot5 = boots[int(0.05 * 2000)] if boots else None
    best = max(by_date.items(), key=lambda kv: kv[1]) if by_date else (None, 0.0)
    stress = summary(run(events, tick_worse=True, fee_mult=2.0), days)
    bar = {
        "1_total_and_halves_positive": s["pnl"] > 0 and (halves is None or (halves["first"] > 0 and halves["second"] > 0)),
        "2_above_null_p95": null95 is not None and s["pnl"] > null95,
        "3_stress_positive": stress["pnl"] > 0,
        "4_at_least_60_buckets_on_25_dates": s["bucket_deaths"] >= 60 and s["dates"] >= 25,
        "5_date_bootstrap_p5_positive": boot5 is not None and boot5 > 0,
        "6_best_date_under_40pct_and_rest_positive": s["pnl"] > 0 and best[1] <= 0.4 * s["pnl"] and (s["pnl"] - best[1]) > 0,
        "7_worth_money_4pct_a_year_on_peak_capital": s["annualised_on_peak"] is not None and s["annualised_on_peak"] > 0.04,
    }
    desc = {
        "lag_p50_plus_60s": summary(run(events, lag="p50", extra=60), days),
        "lag_p90_plus_300s": summary(run(events, extra=300), days),
        "lag_p90_plus_600s": summary(run(events, extra=600), days),
        "g_min_0.005": summary(run(events, g_min=0.005), days),
        "g_min_0.02": summary(run(events, g_min=0.02), days),
        "g_min_0.05": summary(run(events, g_min=0.05), days),
        "uncapped": summary(run(events, cap=float("inf")), days),
        "share_100pct": summary(run(events, share=1.0), days),
        "us_only": summary(run(events, which=True), days),
        "non_us_only": summary(run(events, which=False), days),
    }
    by_src = defaultdict(list)
    for f in prim:
        by_src[str(f[10])].append(f)
    desc["by_source"] = {k: summary(v, days) for k, v in sorted(by_src.items())}
    out = {"input": {"from": d0, "to": d1, "stations": data.get("stations"), "counts": data.get("counts"),
                     "events": len(events), "buckets_decided": sum(len(e["buckets"]) for e in events)},
           "rule": {"cap_usd": CAP_USD, "share": SHARE, "g_min": G_MIN, "lag": "station p90 AWC receipt delay",
                    "extra_s": EXTRA_S, "seed": SEED},
           "primary": s, "halves": halves, "null": {"draws": len(nulls), "p95": round(null95, 6) if null95 is not None else None,
                                                  "mean": round(sum(nulls) / len(nulls), 6) if nulls else None,
                                                  "p_value": round(sum(1 for x in nulls if x >= s["pnl"]) / len(nulls), 6) if nulls else None},
           "date_bootstrap": {"draws": 2000, "p5": round(boot5, 6) if boot5 is not None else None,
                              "p50": round(boots[1000], 6) if boots else None},
           "best_date": {"date": best[0], "pnl": round(best[1], 6)}, "stress": stress, "bar": bar,
           "passes": all(bar.values()), "descriptive": desc,
           "by_date": {d: round(v, 6) for d, v in sorted(by_date.items())}}
    with open(outp, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps({k: out[k] for k in ("primary", "halves", "null", "date_bootstrap", "best_date", "bar", "passes")}, indent=1))
    print("stress", json.dumps(stress))
    for k, v in desc.items():
        if k != "by_source":
            print(k, json.dumps(v))


if __name__ == "__main__":
    main()
