"""PMOPPS: time decay on deadline markets ("Will X happen by <date>?"), on history.

The idea: in a market that pays YES only if something happens before a deadline, the YES price must fall as the time
left shrinks, and if it falls too slowly a seller of YES (a buyer of NO) is paid for waiting. FAV (fp4) already read the
0.90-0.99 favourite a day and a week before the end and found favourites overpriced; this reads the middle of the range,
where the time value is, at 14, 7 and 3 days before the scheduled end.

Universe: closed markets of pull_closed.py (volume >= $20,000, end 2025-01 -> 2026-09) whose question says "by" or
"before" a date, not sports, not crypto prices, not up/down, with a 0/1 payout; a fixed one-in-two sample by the last hex
digit of the condition id (even) to bound the reads. The YES token's hourly price (CLOB `/prices-history`) at T - 14 d,
T - 7 d and T - 3 d (the last print at or before, within 6 h). The trade: buy NO at 1 - YES + HALF + the taker fee, hold
to the payout. Split 2025 (exploration) / 2026 (held out, read once with the rule chosen on 2025).

Writes $PM_DATA/theta.json and prints calibration by YES-price bucket and the rule's result.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/theta.py
"""
import glob
import json
import os
import random
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

CLOB = "https://clob.polymarket.com"
HALF = 0.01
FEE = {"politics": 0.04, "finance_prices": 0.04, "tech": 0.04, "mentions": 0.04, "culture": 0.05, "economics": 0.05,
       "weather": 0.05, "general": 0.05}
DAYS = (14, 7, 3)


def ts(s):
    if not s: return None
    s = s.strip().replace(" ", "T")
    if s.endswith("+00"): s += ":00"
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def fee_rate(m):
    ft = (m.get("feeType") or "")
    return FEE.get(ft[:-5] if ft.endswith("_fees") else ft, 0.0 if not ft else 0.05)


mk = []
for p in sorted(glob.glob(os.path.join(pmnet.DATA, "closed", "*.json"))):
    for m in json.load(open(p)):
        q = (m.get("question") or "").lower()
        slug = (m.get("slug") or "") + " " + " ".join((e.get("seriesSlug") or "") for e in m.get("events") or [])
        if not re.search(r"\b(by|before)\b", q): continue
        if "updown" in slug or "up-or-down" in slug or (m.get("feeType") or "").startswith(("sports", "crypto")): continue
        if m.get("sportsMarketType") or m.get("gameStartTime"): continue
        if (m.get("endDate") or "") >= "2026-10-01": continue
        if int(m["conditionId"][-1], 16) % 2: continue
        try:
            pay = [float(v) for v in json.loads(m.get("outcomePrices") or "[]")]
        except ValueError:
            continue
        if len(pay) != 2 or pay[0] not in (0.0, 1.0): continue
        m["_pay"] = pay[0]; mk.append(m)
cache_p = os.path.join(pmnet.DATA, "theta_raw.json")
cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
for n, m in enumerate(mk):
    c = m["conditionId"]
    if c in cache: continue
    tok = json.loads(m.get("clobTokenIds") or "[]"); end = ts(m["endDate"])
    if not tok or not end:
        cache[c] = []; continue
    try:
        cache[c] = pmnet.get(CLOB + "/prices-history", {"market": tok[0], "startTs": int(end - 15 * 86400), "endTs": int(end - 2 * 86400), "fidelity": 60}).get("history") or []
    except RuntimeError:
        cache[c] = []
    if n % 500 == 0:
        pmnet.dump(cache_p, cache); print(n, len(mk), flush=True)
pmnet.dump(cache_p, cache)

rows = []
for m in mk:
    end = ts(m["endDate"]); h = cache.get(m["conditionId"]) or []
    ev = (m.get("events") or [{}])[0].get("slug") or m["conditionId"]
    r = {"cond": m["conditionId"][:12], "ev": ev, "end": m["endDate"][:10], "pay": m["_pay"], "fee": fee_rate(m), "vol": round(m["volumeNum"] or 0)}
    for d in DAYS:
        t = end - d * 86400
        pts = [x for x in h if x["t"] <= t]
        r[f"y{d}"] = float(pts[-1]["p"]) if pts and t - pts[-1]["t"] <= 6 * 3600 else None
    rows.append(r)
pmnet.dump(os.path.join(pmnet.DATA, "theta.json"), rows)


def no_ret(y, pay, rate):
    p = 1 - y
    if not (0.0 < p < 1.0): return None
    return (1 - pay) / (min(0.999, p + HALF) + rate * p * (1 - p)) - 1


B = [0.0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1.01]
print(f"deadline markets (sampled one in two): {len(mk)}; with a price 14 / 7 / 3 days before: "
      + " / ".join(str(sum(1 for r in rows if r[f'y{d}'] is not None)) for d in DAYS))
for span, keep in (("2025 (exploration)", lambda r: r["end"] < "2026-01-01"), ("2026 (held out)", lambda r: r["end"] >= "2026-01-01")):
    print(f"\n== {span}")
    for d in DAYS:
        print(f"T - {d} days: YES bucket, markets, mean YES price, YES won %, NO's return per $1 after half-spread and fee")
        for lo, hi in zip(B, B[1:]):
            xs = [r for r in rows if keep(r) and r[f"y{d}"] is not None and lo <= r[f"y{d}"] < hi]
            if len(xs) < 5: continue
            rets = [v for v in (no_ret(r[f"y{d}"], r["pay"], r["fee"]) for r in xs) if v is not None]
            print(f"  [{lo:.2f}, {hi:.2f})  {len(xs):>5}  {sum(r[f'y{d}'] for r in xs) / len(xs):.3f}  {100 * sum(r['pay'] for r in xs) / len(xs):5.1f} %"
                  f"  {sum(rets) / max(1, len(rets)):+.4f}")
# The rule, fixed on 2025 and read on 2026: buy NO at T - 7 d when YES is in [0.10, 0.50).
print("\n== The rule read on both spans: buy NO at T - d when YES is in [lo, hi), $1 each, held to the payout")
for d in DAYS:
    for lo, hi in ((0.05, 0.2), (0.1, 0.5), (0.2, 0.5), (0.5, 0.8)):
        for span, keep in (("2025", lambda r: r["end"] < "2026-01-01"), ("2026", lambda r: r["end"] >= "2026-01-01")):
            xs = [r for r in rows if keep(r) and r[f"y{d}"] is not None and lo <= r[f"y{d}"] < hi]
            vs = [(v, r["ev"]) for v, r in ((no_ret(r[f"y{d}"], r["pay"], r["fee"]), r) for r in xs) if v is not None]
            if len(vs) < 10: continue
            # resampled by EVENT: markets of one event resolve together
            by = {}
            for v, e in vs: by.setdefault(e, []).append(v)
            evs = list(by); rnd = random.Random(20261013); bs = []
            for _ in range(2000):
                draw = [x for _ in evs for x in by[evs[rnd.randrange(len(evs))]]]
                bs.append(sum(draw) / len(draw))
            bs.sort()
            print(f"  T-{d:>2}d YES in [{lo:.2f}, {hi:.2f}) {span}: {len(vs):>5} trades in {len(evs):>4} events, return per $1 "
                  f"{sum(v for v, _ in vs) / len(vs):+.4f} [{bs[100]:+.4f}, {bs[1900]:+.4f}] (event bootstrap)")
