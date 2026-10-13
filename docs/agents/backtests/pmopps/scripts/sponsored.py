"""PMOPPS: one snapshot of Polymarket's reward listing, native against sponsored (keyless CLOB `/rewards/markets/current`).

How much of the day's reward money is sponsored, over how many markets, how large a pool, and whether the sponsored
pools sit in markets the native programme leaves alone. Writes $PM_DATA/sponsored.json and prints the summary.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/sponsored.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

CLOB = "https://clob.polymarket.com"


def num(x):
    try: return float(x)
    except (TypeError, ValueError): return 0.0


rows = {}
for sp in ("false", "true"):
    cur, pages = "", 0
    while True:
        d = pmnet.get(CLOB + "/rewards/markets/current", {"sponsored": sp, **({"next_cursor": cur} if cur else {})})
        for r in d.get("data") or []:
            c = r.get("condition_id")
            rows.setdefault(c, {"native": 0.0, "sponsored": 0.0, "total": 0.0, "max_spread": r.get("rewards_max_spread"), "min_size": r.get("rewards_min_size")})
            x = rows[c]
            x["native"] = max(x["native"], num(r.get("native_daily_rate")))
            x["sponsored"] = max(x["sponsored"], num(r.get("sponsored_daily_rate")))
            x["total"] = max(x["total"], num(r.get("total_daily_rate")) or num(r.get("native_daily_rate")) + num(r.get("sponsored_daily_rate")))
            x["listed_sponsored"] = x.get("listed_sponsored", False) or sp == "true"
        cur = d.get("next_cursor"); pages += 1
        if not cur or cur == "LTE=" or not d.get("data"): break
pmnet.dump(os.path.join(pmnet.DATA, "sponsored.json"), {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "rows": rows})
tot = sum(x["total"] for x in rows.values()); nat = sum(x["native"] for x in rows.values()); spo = sum(x["sponsored"] for x in rows.values())
sp = [x for x in rows.values() if x["sponsored"] > 0]
only = [x for x in sp if x["native"] <= 0]
print(f"read {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}: {len(rows)} rewarded markets, ${tot:,.0f} a day "
      f"(native ${nat:,.0f}, sponsored ${spo:,.0f} = {100 * spo / max(1, tot):.1f} %)")
print(f"markets with a sponsored rate: {len(sp)}; sponsored only (no native rate): {len(only)}, ${sum(x['sponsored'] for x in only):,.0f} a day")
for lo, hi in ((0, 10), (10, 50), (50, 200), (200, 1e9)):
    xs = [x for x in sp if lo <= x["sponsored"] < hi]
    print(f"  sponsored ${lo:g}-{hi:g} a day: {len(xs)} markets, ${sum(x['sponsored'] for x in xs):,.0f}")
big = sorted(sp, key=lambda x: -x["sponsored"])[:5]
print("largest sponsored rates:", [round(x["sponsored"], 1) for x in big], "their min sizes:", [x["min_size"] for x in big])
