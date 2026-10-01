"""Calendar windows around the month end, screened on data to 2015-12-31 ONLY.

Windows are trading days relative to T, the last trading day of a month
(T+0 = T, T+1 = first trading day of the next month), taken from:
  * McConnell & Xu (2008) turn of the month, TOM = [0, +3] (EQ1's window);
  * Etula, Rinne, Suominen & Vaittinen, "Dash for Cash", RFS 2020 (sample to
    2013-12): selling pressure S = [-8, -4], positive reversal P = [-3, -1],
    buying pressure B = [0, +3], P+B = [-3, +3], negative reversal N = [+4, +8].
No window is chosen here; each is the published one.

Series: CRSP VW market excess (F-F daily, 1926-07 on), CRSP top size decile VW
(minus RF), and Fama-French international daily market excess returns (USD,
1990-07 on): Europe, Japan, Asia Pacific ex Japan, North America, Developed ex US.

For each window and period: the mean window excess return a month (raw), the
abnormal one (minus n_days x the period's mean daily excess), t-statistics, and
a volatility-scaled t (each event divided by the trailing 63-day daily sd
ending the day before the window, times sqrt(n_days)): a WLS-style statistic
that down-weights turbulent months, evaluated here only to size power.
Output: ../results/screen_calendar.json
"""
import json, math, os
import numpy as np
from common import read_block, month_turns, window_sum, tstat, r, INP

HERE = os.path.dirname(os.path.abspath(__file__))
WINDOWS = {"TOM_0_3": (0, 3), "S_m8_m4": (-8, -4), "P_m3_m1": (-3, -1), "PB_m3_p3": (-3, 3),
           "N_p4_p8": (4, 8)}
OUT = {"screen_end": "2015-12-31", "windows": {k: list(v) for k, v in WINDOWS.items()},
       "note": "screening only; nothing after 2015-12-31 is parsed"}


def load_us():
    d, c, m = read_block("F-F_Research_Data_Factors_daily", "Mkt-RF", True)
    mkt, rf = m[:, c.index("Mkt-RF")], m[:, c.index("RF")]
    d2, c2, m2 = read_block("Portfolios_Formed_on_ME_daily", "Hi 10", True,
                            block_title="Average Value Weighted Returns -- Daily")
    assert np.array_equal(d, d2)
    top = m2[:, c2.index("Hi 10")] - rf
    return d, {"US_CRSP_VW": mkt, "US_top_decile": top}


def load_intl():
    out = {}
    for name, f in [("Europe", "Europe_3_Factors_Daily"), ("Japan", "Japan_3_Factors_Daily"),
                    ("AsiaPac_exJ", "Asia_Pacific_ex_Japan_3_Factors_Daily"),
                    ("NorthAmerica", "North_America_3_Factors_Daily"),
                    ("Dev_exUS", "Developed_ex_US_3_Factors_Daily")]:
        d, c, m = read_block(f, "Mkt-RF", True)
        out[name] = (d, m[:, c.index("Mkt-RF")])
    return out


def events(dates, x):
    """Per month turn: dict window -> raw sum; plus the trailing sd before each window."""
    ev = []
    for kT, ym in month_turns(dates):
        row = {"ym": ym}
        ok = True
        for w, (lo, hi) in WINDOWS.items():
            s = window_sum(x, kT, lo, hi)
            a = kT + lo
            if s is None or a - 63 < 0:
                ok = False
                break
            sd = np.nanstd(x[a - 63:a], ddof=1)
            row[w] = s
            row[w + "_sd"] = sd * math.sqrt(hi - lo + 1)
        if ok:
            ev.append(row)
    return ev


def stats(dates, x, ev, lo_ym, hi_ym):
    sel = [e for e in ev if lo_ym <= e["ym"] <= hi_ym]
    dm = (dates // 100 >= lo_ym) & (dates // 100 <= hi_ym)
    mu_day = float(np.nanmean(x[dm]))
    res = {"events": len(sel), "mean_daily_excess_pct": r(100 * mu_day, 4)}
    for w, (lo, hi) in WINDOWS.items():
        n = hi - lo + 1
        raw = np.array([e[w] for e in sel])
        ab = raw - n * mu_day
        z = ab / np.array([e[w + "_sd"] for e in sel])
        zr = raw / np.array([e[w + "_sd"] for e in sel])
        res[w] = {"raw_mean_pct": r(100 * raw.mean()), "raw_sd_pct": r(100 * raw.std(ddof=1)),
                  "raw_t": r(tstat(raw), 2), "abn_mean_pct": r(100 * ab.mean()), "abn_t": r(tstat(ab), 2),
                  "abn_t_volscaled": r(tstat(z), 2), "raw_t_volscaled": r(tstat(zr), 2)}
    # TOM per EQ1: TOM sum minus 4 x mean of non-TOM days (EQ1's exact statistic)
    # the spread P+B minus S, and the dodge rule's active return (out over S): -S raw
    pb, s = np.array([e["PB_m3_p3"] for e in sel]), np.array([e["S_m8_m4"] for e in sel])
    spread = pb - s
    res["spread_PB_minus_S"] = {"mean_pct": r(100 * spread.mean()), "sd_pct": r(100 * spread.std(ddof=1)),
                                "t": r(tstat(spread), 2),
                                "t_volscaled": r(tstat(spread / np.array([e["PB_m3_p3_sd"] for e in sel])), 2)}
    res["corr_S_P"] = r(np.corrcoef(s, np.array([e["P_m3_m1"] for e in sel]))[0, 1])
    res["corr_S_PB"] = r(np.corrcoef(s, pb)[0, 1])
    res["dodge_S_active_vs_buyhold"] = {"mean_pct_per_month": r(-100 * s.mean()), "t": r(tstat(-s), 2),
                                        "ann_pct_gross": r(-1200 * s.mean(), 2)}
    return res


PERIODS = [("1926-1989", 192607, 198912), ("1990-2015", 199001, 201512), ("1995-06_2013", 199506, 201312),
           ("2003-2015", 200301, 201512), ("2014-2015", 201401, 201512), ("1990-07_2015", 199007, 201512)]

d, us = load_us()
OUT["US"] = {}
EV = {}
for name, x in us.items():
    ev = events(d, x)
    EV[name] = {e["ym"]: e for e in ev}
    OUT["US"][name] = {p: stats(d, x, ev, lo, hi) for p, lo, hi in PERIODS}

intl = load_intl()
OUT["INTL"] = {}
for name, (di, xi) in intl.items():
    ev = events(di, xi)
    EV[name] = {e["ym"]: e for e in ev}
    OUT["INTL"][name] = {p: stats(di, xi, ev, lo, hi) for p, lo, hi in PERIODS if lo >= 199007 or p == "1990-07_2015"}
    OUT["INTL"][name]["trading_days_1990_07_2015"] = int(((di // 100) >= 199007).sum())

# correlations of window returns between series, common events 1990-07 .. 2015-11 (pre-2016 turns)
names = ["US_CRSP_VW", "US_top_decile", "Europe", "Japan", "AsiaPac_exJ", "Dev_exUS", "NorthAmerica"]
common = sorted(set.intersection(*[set(k for k in EV[n] if 199007 <= k <= 201512) for n in names]))
OUT["corr_common_events"] = {"n_events": len(common), "first": common[0], "last": common[-1]}
for w in ["TOM_0_3", "S_m8_m4", "PB_m3_p3"]:
    M = np.array([[EV[n][k][w] for k in common] for n in names])
    C = np.corrcoef(M)
    OUT["corr_common_events"][w] = {names[i]: {names[j]: r(C[i, j]) for j in range(len(names))} for i in range(len(names))}
    sp = np.array([[EV[n][k]["PB_m3_p3"] - EV[n][k]["S_m8_m4"] for k in common] for n in names])
    OUT["corr_common_events"]["spread_PB_minus_S"] = {names[i]: {names[j]: r(np.corrcoef(sp)[i, j]) for j in range(len(names))} for i in range(len(names))}

json.dump(OUT, open(os.path.join(HERE, "..", "results", "screen_calendar.json"), "w"), indent=1, sort_keys=True)
print("ok")
