"""How well do the LSE lines (CSPX.L in USD, CSP1.L in GBp; both iShares Core S&P 500, accumulating) carry the US
month-end windows? Pre-2016 only: Yahoo daily closes requested with period2 = 2015-12-31 23:59:59 UTC, so no later
bar exists in the file; the meta's current-price fields are stripped before anything is read (strip_meta).

For each month turn with T in 2010-10 .. 2015-11: the US statistic on CRSP VW (H2 windows on NYSE days) and the same
windows on each line's own LSE trading days (T_L = the line's last trading day of the month), close to close.
Reported: per-event correlation of S-window sums, PB-window sums and D, and the means. Output: ../results/screen_lse_lines.json
"""
import json, math, os
from datetime import datetime, timezone
import numpy as np
from common import read_block, month_turns, r

HERE = os.path.dirname(os.path.abspath(__file__))
LSE = os.path.join(HERE, "..", "inputs", "lse")


def strip_meta(path):
    j = json.load(open(path))
    res = j["chart"]["result"][0]
    keep = {k: res["meta"].get(k) for k in ("currency", "exchangeName", "symbol", "instrumentType", "firstTradeDate")}
    if set(res["meta"]) - set(keep):
        res["meta"] = keep
        json.dump(j, open(path, "w"))
    return res


def line(sym):
    res = strip_meta(os.path.join(LSE, f"yahoo_{sym}_to2015.json"))
    ts = res["timestamp"]
    cl = res["indicators"]["adjclose"][0]["adjclose"] if "adjclose" in res["indicators"] else res["indicators"]["quote"][0]["close"]
    days = [int(datetime.fromtimestamp(t, timezone.utc).strftime("%Y%m%d")) for t in ts]
    pairs = [(dd, c) for dd, c in zip(days, cl) if c is not None and dd <= 20151231]
    d = np.array([p[0] for p in pairs]); p = np.array([p[1] for p in pairs], float)
    ret = np.r_[np.nan, p[1:] / p[:-1] - 1]
    return d, ret


def events(d, x, lo, hi):
    out = {}
    for kT, ym in month_turns(d):
        if lo <= ym <= hi and kT - 8 >= 1 and kT + 3 < len(x):
            s = np.nansum(x[kT - 8:kT - 3]); pb = np.nansum(x[kT - 3:kT + 4])
            out[ym] = {"S": s, "PB": pb, "D": pb / 7 - s / 5}
    return out


du, cu, mu = read_block("F-F_Research_Data_Factors_daily", "Mkt-RF", True)
us = events(du, mu[:, cu.index("Mkt-RF")] + mu[:, cu.index("RF")], 201010, 201511)
OUT = {"us_events": len(us)}
for sym in ("CSPX.L", "CSP1.L"):
    d, x = line(sym)
    ev = events(d, x, 201010, 201511)
    ks = sorted(set(ev) & set(us))
    o = {"events": len(ks)}
    for k in ("S", "PB", "D"):
        a = np.array([us[m][k] for m in ks]); b = np.array([ev[m][k] for m in ks])
        o[k] = {"corr_with_us": r(np.corrcoef(a, b)[0, 1]), "us_mean_pct": r(100 * a.mean()), "line_mean_pct": r(100 * b.mean()),
                "beta_line_on_us": r(np.cov(a, b)[0, 1] / np.var(a, ddof=1))}
    OUT[sym] = o
json.dump(OUT, open(os.path.join(HERE, "..", "results", "screen_lse_lines.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(OUT, indent=1))
