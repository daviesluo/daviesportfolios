"""Descriptive (kill) measurement: spot returns around Binance's perpetual funding times (00:00, 08:00,
16:00 UTC) against all other hours, BTC/ETH/SOL/XRP 1-minute klines 2025-09-01 -> 2026-09-22
(research_fp/data/binance_year). For each funding time T: return from T-30m to T, T to T+30m, and
T-5m to T+5m; the same windows around every other whole hour as the baseline. Writes results/m_funding_hours.json."""
import json, os, statistics, datetime
SP = os.environ.get("FP_ROOT", ".")
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
res = {}
for s in ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]:
    rows = json.load(open(f"{SP}/research_fp/data/binance_year/{s}_1m.json"))
    close = {r[0]: r[4] for r in rows}
    op = {r[0]: r[1] for r in rows}
    agg = {"funding": {"pre30": [], "post30": [], "pm5": []}, "other": {"pre30": [], "post30": [], "pm5": []}}
    for r in rows:
        t = r[0]
        if t % 3600000: continue
        h = datetime.datetime.utcfromtimestamp(t / 1000).hour
        g = "funding" if h in (0, 8, 16) else "other"
        a = close.get(t - 31 * 60000); b = close.get(t - 60000); c = close.get(t + 29 * 60000)
        d5 = close.get(t - 6 * 60000); e5 = close.get(t + 4 * 60000)
        if a and b: agg[g]["pre30"].append(b / a - 1)
        if b and c: agg[g]["post30"].append(c / b - 1)
        if d5 and e5: agg[g]["pm5"].append(e5 / d5 - 1)
    out = {}
    for g, dd in agg.items():
        out[g] = {k: {"n": len(v), "mean_bps": round(sum(v) / len(v) * 1e4, 3), "median_bps": round(statistics.median(v) * 1e4, 3),
                      "mean_abs_bps": round(sum(abs(x) for x in v) / len(v) * 1e4, 3)} for k, v in dd.items()}
    res[s] = out
json.dump(res, open(os.path.join(S, "results", "m_funding_hours.json"), "w"), indent=1)
for s, o in res.items():
    print(s, "funding pre30 %.2f post30 %.2f pm5 %.2f | other pre30 %.2f post30 %.2f pm5 %.2f | |pm5| %.1f vs %.1f" % (
        o["funding"]["pre30"]["mean_bps"], o["funding"]["post30"]["mean_bps"], o["funding"]["pm5"]["mean_bps"],
        o["other"]["pre30"]["mean_bps"], o["other"]["post30"]["mean_bps"], o["other"]["pm5"]["mean_bps"],
        o["funding"]["pm5"]["mean_abs_bps"], o["other"]["pm5"]["mean_abs_bps"]))
