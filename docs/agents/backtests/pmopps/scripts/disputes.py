"""PMOPPS: buying the proposed outcome while a resolution is disputed (fp4's B16, never tested), on history.

Universe: every closed market of pull_closed.py (volume >= $20,000, end 2025-01 -> 2026-10) whose UMA statuses
(Gamma's `umaResolutionStatuses`) include "disputed", up/down crypto series out. For each: the first proposal
(`proposed_price` of the data API's /v2/resolutions), the payout (Gamma's `outcomePrices`), and the YES token's hourly
price (CLOB `/prices-history`, fidelity 60) over the 5 days before the market closed.

The dispute's own time is not in any keyless record read here, so the entry is placed against the CLOSE: at close - H
hours (H = 6, 24, 48), and only when that is at least 2 h after the scheduled end (a proposal and its 2 h liveness come
after the end). Markets that closed sooner than that are counted and left out. That uses one thing a trader would not
know, how long resolution will take, and it is said so in the review. The trade: buy the first-proposed outcome at the
hourly price + `HALF` (half a spread) + the taker fee (rate x p x (1 - p), the category's rate), hold to the payout.
The opposite trade (the disputer's side) is read beside it.

Writes $PM_DATA/disputes.json (the per-market rows) and prints the summary.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/disputes.py
"""
import glob
import json
import os
import random
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

DATA_API, CLOB = "https://data-api.polymarket.com", "https://clob.polymarket.com"
HALF = 0.01
FEE = {"politics": 0.04, "finance_prices": 0.04, "finance": 0.04, "tech": 0.04, "mentions": 0.04, "culture": 0.05,
       "economics": 0.05, "weather": 0.05, "general": 0.05, "sports": 0.05, "sports_v2": 0.05, "sports_v3": 0.05,
       "crypto": 0.07, "crypto_v2": 0.07}


def ts(s):
    if not s: return None
    s = s.strip().replace(" ", "T")
    if s.endswith("+00"): s += ":00"
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def fee_rate(m):
    ft = (m.get("feeType") or "")
    ft = ft[:-5] if ft.endswith("_fees") else ft.replace("_fees_", "_")
    return FEE.get(ft, 0.0 if not ft else 0.05)


mk = []
for p in sorted(glob.glob(os.path.join(pmnet.DATA, "closed", "*.json"))):
    for m in json.load(open(p)):
        st = json.loads(m.get("umaResolutionStatuses") or "[]")
        slug = (m.get("slug") or "") + " " + " ".join((e.get("seriesSlug") or "") for e in m.get("events") or [])
        if "disputed" in st and "updown" not in slug and "up-or-down" not in slug:
            m["_st"] = st; mk.append(m)
cache_p = os.path.join(pmnet.DATA, "disputes_raw.json")
cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
for m in mk:
    c = m["conditionId"]
    if c in cache: continue
    r = pmnet.get(DATA_API + "/v2/resolutions", {"condition": c}).get("data") or [{}]
    tok = json.loads(m.get("clobTokenIds") or "[]")
    end, close = ts(m["endDate"]), ts(m["closedTime"])
    h = []
    if tok and close:
        h = pmnet.get(CLOB + "/prices-history", {"market": tok[0], "startTs": int(close - 5 * 86400), "endTs": int(close), "fidelity": 60}).get("history") or []
    cache[c] = {"res": r[0], "hist": h}
pmnet.dump(cache_p, cache)

rows = []
for m in mk:
    c = m["conditionId"]; x = cache[c]; r = x["res"]
    try:
        pay = [float(v) for v in json.loads(m.get("outcomePrices") or "[]")]
    except ValueError:
        pay = []
    if len(pay) != 2 or pay[0] not in (0.0, 1.0) or r.get("proposed_price") is None:
        continue
    p1 = float(r["proposed_price"]) / (1e18 if float(r["proposed_price"]) > 1 else 1)   # YES's first proposed price
    if p1 not in (0.0, 1.0):
        continue
    end, close = ts(m["endDate"]), ts(m["closedTime"])
    row = {"cond": c[:12], "q": m["question"][:90], "vol": round(m["volumeNum"] or 0), "end": m["endDate"], "close": m["closedTime"],
           "hours_end_to_close": round((close - end) / 3600, 1) if end and close else None, "st": "-".join(s[0] for s in m["_st"]),
           "p1_yes": p1, "pay_yes": pay[0], "kept": p1 == pay[0], "fee": fee_rate(m)}
    for H in (6, 24, 48):
        t = close - H * 3600
        px = None
        if end and t >= end + 2 * 3600:
            pts = [q for q in x["hist"] if q["t"] <= t]
            if pts and t - pts[-1]["t"] <= 3 * 3600:
                px = float(pts[-1]["p"])
        row[f"yes_{H}"] = px
    rows.append(row)
pmnet.dump(os.path.join(pmnet.DATA, "disputes.json"), rows)


def trade(px_yes, side_yes, pay_yes, rate):
    """$ per $1 staked buying YES (side_yes) or NO at the hourly price + HALF + fee."""
    p = px_yes if side_yes else 1 - px_yes
    if not (0.0 < p < 1.0): return None
    cost = min(0.999, p + HALF) + rate * p * (1 - p)
    win = pay_yes if side_yes else 1 - pay_yes
    return win / cost - 1


print(f"disputed markets (vol >= $20k, end 2025-01 -> 2026-10, no up/down): {len(mk)}; with a 0/1 first proposal and payout: {len(rows)}")
print(f"first proposal kept: {sum(r['kept'] for r in rows)} of {len(rows)} ({100 * sum(r['kept'] for r in rows) / max(1, len(rows)):.1f} %)")
hs = sorted(r["hours_end_to_close"] for r in rows if r["hours_end_to_close"] is not None)
print(f"hours from the scheduled end to the close: p10 {hs[len(hs) // 10]:.1f}, p50 {hs[len(hs) // 2]:.1f}, p90 {hs[9 * len(hs) // 10]:.1f}")
for H in (6, 24, 48):
    xs = [r for r in rows if r[f"yes_{H}"] is not None]
    for lab, side in (("the proposed outcome", "prop"), ("the disputer's side", "opp")):
        res = []
        for r in xs:
            yes = (r["p1_yes"] == 1.0) if side == "prop" else (r["p1_yes"] == 0.0)
            v = trade(r[f"yes_{H}"], yes, r["pay_yes"], r["fee"])
            if v is not None: res.append((v, r))
        if not res: continue
        tot = sum(v for v, _ in res); n = len(res)
        price = sum((r[f"yes_{H}"] if ((r["p1_yes"] == 1.0) == (side == "prop")) else 1 - r[f"yes_{H}"]) for _, r in res) / n
        won = sum(1 for v, _ in res if v > 0) / n
        rnd = random.Random(20261013); bs = []
        for _ in range(4000):
            bs.append(sum(res[rnd.randrange(n)][0] for _ in range(n)) / n)
        bs.sort()
        print(f"entry at close - {H:>2} h, buy {lab:<22}: {n:>4} markets, mean price {price:.3f}, won {100 * won:5.1f} %, "
              f"return per $1 {tot / n:+.4f} [{bs[200]:+.4f}, {bs[3800]:+.4f}] (5-95 %), total on $1 each {tot:+.2f}")
print("\nby the number of disputes (entry at close - 24 h, the proposed outcome):")
for k in sorted({r["st"] for r in rows}):
    xs = [r for r in rows if r["st"] == k and r["yes_24"] is not None]
    vs = [trade(r["yes_24"], r["p1_yes"] == 1.0, r["pay_yes"], r["fee"]) for r in xs]
    vs = [v for v in vs if v is not None]
    if vs: print(f"  {k:<16} {len(vs):>4} markets, kept {sum(1 for r in xs if r['kept'])}, return per $1 {sum(vs) / len(vs):+.4f}")
