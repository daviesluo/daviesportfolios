"""Descriptive: has Binance's Price Range Execution Rule (rolled out 2026-03-09 -> ~03-30) removed deep
one-minute wicks? For 17 coins with 1-minute klines on disk (research_fp: BTC/ETH/SOL/XRP from
2025-09-01; research_fp2: 13 alts from 2025-09-25), count minutes whose low is below
(1 - x) * mean(close of the previous 5 minutes), x in {3, 5, 10, 15, 20, 25} %, before 2026-03-09 and
after 2026-04-01, per 100,000 coin-minutes. Writes results/m_price_range_wicks.json."""
import json, os, datetime
SP = os.environ.get("FP_ROOT", ".")
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
files = {s: f"{SP}/research_fp/data/binance_year/{s}_1m.json" for s in ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]}
for s in ["ANKRUSDT", "AUCTIONUSDT", "AVAXUSDT", "BCHUSDT", "C98USDT", "CELOUSDT", "FETUSDT", "ICPUSDT", "KAVAUSDT", "NEARUSDT", "PENDLEUSDT", "SUIUSDT", "WUSDT"]:
    files[s] = f"{SP}/research_fp2/data/binance/{s}_1m.json"
PRE_END = int(datetime.datetime(2026, 3, 9, tzinfo=datetime.timezone.utc).timestamp() * 1000)
POST_START = int(datetime.datetime(2026, 4, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
XS = [0.03, 0.05, 0.10, 0.15, 0.20, 0.25]
rules = {r["symbol"]: r["rules"][0] for r in json.load(open(os.path.join(S, "data", "binance_executionRules_all.json")))["symbolRules"]}
out = {}
tot = {"pre": {"minutes": 0, **{str(x): 0 for x in XS}}, "post": {"minutes": 0, **{str(x): 0 for x in XS}}}
for s, fn in sorted(files.items()):
    rows = json.load(open(fn))
    c = {"pre": {"minutes": 0, **{str(x): 0 for x in XS}}, "post": {"minutes": 0, **{str(x): 0 for x in XS}}, "deepest_post": 0.0, "deepest_pre": 0.0}
    for i in range(5, len(rows)):
        t = rows[i][0]
        if rows[i - 5][0] != t - 300000: continue
        per = "pre" if t < PRE_END else ("post" if t >= POST_START else None)
        if per is None: continue
        ref = sum(rows[j][4] for j in range(i - 5, i)) / 5
        drop = 1 - rows[i][3] / ref
        c[per]["minutes"] += 1
        c["deepest_" + per] = max(c["deepest_" + per], drop)
        for x in XS:
            if drop > x: c[per][str(x)] += 1
    for per in ("pre", "post"):
        for k, v in c[per].items(): tot[per][k] += v
    c["range_rule"] = rules.get(s, {}).get("bidLimitMultDown")
    c["deepest_pre"] = round(c["deepest_pre"], 4); c["deepest_post"] = round(c["deepest_post"], 4)
    out[s] = c
rate = {per: {str(x): round(tot[per][str(x)] / tot[per]["minutes"] * 1e5, 3) for x in XS} for per in tot}
json.dump({"per_symbol": out, "totals": tot, "per_100k_coin_minutes": rate}, open(os.path.join(S, "results", "m_price_range_wicks.json"), "w"), indent=1)
print(json.dumps({"totals": tot, "rate_per_100k": rate}, indent=1))
for s, c in out.items(): print(s, c["range_rule"], "deepest pre", c["deepest_pre"], "post", c["deepest_post"], "pre>5%", c["pre"]["0.05"], "post>5%", c["post"]["0.05"])

# second pass: the same counts with 2025-10-10 (the one crash day in the pre window) left out, and wicks per day
days = {}
tot2 = {"pre_ex_1010": {"minutes": 0, **{str(x): 0 for x in XS}}}
for s, fn in sorted(files.items()):
    rows = json.load(open(fn))
    for i in range(5, len(rows)):
        t = rows[i][0]
        if rows[i - 5][0] != t - 300000 or t >= PRE_END: continue
        d = datetime.datetime.utcfromtimestamp(t / 1000).strftime("%Y-%m-%d")
        ref = sum(rows[j][4] for j in range(i - 5, i)) / 5
        drop = 1 - rows[i][3] / ref
        if drop > 0.05: days[d] = days.get(d, 0) + 1
        if d == "2025-10-10": continue
        tot2["pre_ex_1010"]["minutes"] += 1
        for x in XS:
            if drop > x: tot2["pre_ex_1010"][str(x)] += 1
rate2 = {str(x): round(tot2["pre_ex_1010"][str(x)] / tot2["pre_ex_1010"]["minutes"] * 1e5, 3) for x in XS}
top_days = sorted(days.items(), key=lambda kv: -kv[1])[:8]
res = json.load(open(os.path.join(S, "results", "m_price_range_wicks.json")))
res["pre_without_2025_10_10"] = {"totals": tot2["pre_ex_1010"], "per_100k": rate2, "top_days_by_5pct_wicks": top_days}
json.dump(res, open(os.path.join(S, "results", "m_price_range_wicks.json"), "w"), indent=1)
print("pre without 2025-10-10 per 100k:", rate2, "top days:", top_days)
