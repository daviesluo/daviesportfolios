# P&L by the app's one definition: positionFromFills / applyFill / unrealisedUsd in
# supabase/functions/_shared/agents_strategy.ts (lines 86-124), books split by symbol|mode as strategyBooks
# (agents/index.ts) does, each fill as toFill (agents/tick.ts:350): ts = filled_at, base = filled_base,
# price = avg_fill_price, fee = fee_usd. Marks: Revolut X UK mid from agent_basis (queries.sql Q10).
import json, datetime as dt
from collections import defaultdict

FLAT = dict(base=0.0, avgCost=0.0, realisedUsd=0.0, feesUsd=0.0, openedAt=None, highWater=None)

def apply_fill(p, f):
    if f["base"] <= 0 or f["price"] <= 0: return p
    if f["side"] == "buy":
        base = p["base"] + f["base"]
        avg = (p["base"] * p["avgCost"] + f["base"] * f["price"]) / base
        return dict(base=base, avgCost=avg, realisedUsd=p["realisedUsd"] - f["feeUsd"], feesUsd=p["feesUsd"] + f["feeUsd"],
                    openedAt=p["openedAt"] if p["base"] > 0 else f["ts"],
                    highWater=max(p["highWater"] or f["price"], f["price"]) if p["base"] > 0 else f["price"])
    base = max(0.0, p["base"] - f["base"])
    sold = min(p["base"], f["base"])
    realised = sold * (f["price"] - p["avgCost"]) - f["feeUsd"]
    return dict(base=base, avgCost=p["avgCost"] if base > 0 else 0.0, realisedUsd=p["realisedUsd"] + realised,
                feesUsd=p["feesUsd"] + f["feeUsd"], openedAt=p["openedAt"] if base > 0 else None,
                highWater=p["highWater"] if base > 0 else None)

def position_from_fills(fills):
    fills = sorted(fills, key=lambda f: (f["ts"], 0 if f["side"] == "buy" else 1))
    p = dict(FLAT)
    for f in fills: p = apply_fill(p, f)
    return p

def ts(s): return dt.datetime.fromisoformat(s).timestamp()

HERE = __import__("os").path.dirname(__import__("os").path.abspath(__file__))
orders = json.load(open(f"{HERE}/../results/orders.json"))
MARK_NOW = {"BTC/USD": 83409.58, "ETH/USD": 2680.655, "SOL/USD": 118.092, "AVAX/USD": 10.8995, "SUI/USD": 1.16125}   # agent_basis 2026-10-01 00:25:01 UTC
MARK_T = {  # agent_basis rows at or before each row's last capital change
    "trend-4h": ("2026-09-27T20:00:37+00:00", {"BTC/USD": 84720.26, "ETH/USD": 2691.115, "SOL/USD": 123.0315}),
    "trend-1h": ("2026-09-27T21:35:40+00:00", {"BTC/USD": 84590.915, "ETH/USD": 2686.57, "SOL/USD": 122.834}),
    "momentum-1d": ("2026-09-27T21:35:40+00:00", {"BTC/USD": 84590.915, "ETH/USD": 2686.57, "SOL/USD": 122.834}),
    "trend-4h-live": ("2026-09-25T02:42:24+00:00", {}),   # no position and no fill before it
}
CAPITAL = {"trend-4h": 1000, "trend-1h": 1000, "momentum-1d": 1000, "trend-4h-live": 100}
START = {"trend-4h": "2026-09-20T18:23:35+00:00", "trend-1h": "2026-09-20T18:23:35+00:00", "momentum-1d": "2026-09-20T18:23:35+00:00", "trend-4h-live": "2026-09-24T22:51:15+00:00"}
NOW = "2026-10-01T00:25:01+00:00"

def books(rows, until=None):
    by = defaultdict(list)
    for o in rows:
        t = ts(o["filled_at"])
        if until is not None and t > until: continue
        by[(o["symbol"], o["mode"])].append(dict(ts=t, side=o["side"], base=o["filled_base"], price=o["avg_fill_price"], feeUsd=o["fee_usd"]))
    return {k: position_from_fills(v) for k, v in by.items()}

out = {}
for sid in ["trend-4h-live", "trend-4h", "trend-1h", "momentum-1d"]:
    rows = [o for o in orders if o["strategy_id"] == sid]
    bk = books(rows)
    realised = sum(p["realisedUsd"] for p in bk.values())
    fees = sum(p["feesUsd"] for p in bk.values())
    unreal = sum(p["base"] * (MARK_NOW[s] - p["avgCost"]) if p["base"] > 0 else 0.0 for (s, m), p in bk.items())
    openpos = {f"{s}|{m}": dict(base=round(p["base"], 9), avgCost=round(p["avgCost"], 4), mark=MARK_NOW[s], costUsd=round(p["base"] * p["avgCost"], 2), valueUsd=round(p["base"] * MARK_NOW[s], 2)) for (s, m), p in bk.items() if p["base"] > 0}
    cap = CAPITAL[sid]
    # Since the last capital change: (realised + unrealised now) - (realised + unrealised at T), the app's own quantities at both ends.
    tT, markT = MARK_T[sid]
    bT = books(rows, until=ts(tT))
    realT = sum(p["realisedUsd"] for p in bT.values())
    unrealT = sum(p["base"] * (markT[s] - p["avgCost"]) if p["base"] > 0 else 0.0 for (s, m), p in bT.items())
    feesT = sum(p["feesUsd"] for p in bT.values())
    since = (realised + unreal) - (realT + unrealT)
    fills = len(rows)
    days = (ts(NOW) - ts(START[sid])) / 86400
    out[sid] = dict(capitalUsd=cap, fills=fills, entries=sum(1 for o in rows if o["side"] == "buy"), exits=sum(1 for o in rows if o["side"] == "sell"),
                    realisedUsd=round(realised, 4), unrealisedUsd=round(unreal, 4), totalUsd=round(realised + unreal, 4),
                    realisedPct=round(100 * realised / cap, 3), unrealisedPct=round(100 * unreal / cap, 3), totalPct=round(100 * (realised + unreal) / cap, 3),
                    feesUsd=round(fees, 6), feesPct=round(100 * fees / cap, 4), open=openpos,
                    sinceCapitalChange=dict(at=tT, totalUsd=round(since, 4), totalPct=round(100 * since / cap, 3), feesUsd=round(fees - feesT, 6),
                                             fillsAfter=sum(1 for o in rows if ts(o["filled_at"]) > ts(tT))),
                    daysRunning=round(days, 2), fillsPer90Days=round(fills * 90 / days, 1))
print(json.dumps(out, indent=1))
json.dump(out, open(f"{HERE}/../results/pnl_out.json", "w"), indent=1)
