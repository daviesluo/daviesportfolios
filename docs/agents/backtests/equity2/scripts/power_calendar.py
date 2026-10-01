"""Power and money for the month-end calendar hypotheses, from pre-2016 data only.

Per-event statistics, in mean DAILY excess return (so no drift term enters the null):
  D_TOM    = TOM[0,+3]/4  - mean excess of the month's other days (EQ1's hypothesis, per day)
  D_PB     = PB[-3,+3]/7  - mean excess of the month's other days
  D_S      = S[-8,-4]/5   - mean excess of the month's other days   (expected < 0)
  D_SPREAD = PB[-3,+3]/7  - S[-8,-4]/5                              (Dash for Cash, both legs)
"Other days" are the trading days of the event's calendar month span T-20 .. T+8 outside the window, a fixed set
per event. The held-out test has n = 127 month turns (T in 2016-01 .. 2026-07, every window inside the French files'
2026-08 end). Expected t = mean / sd * sqrt(n), from the screen periods; power one-sided.

Money, per year, against holding the index (excess over T-bills; T212's cash rate is taken as the T-bill rate):
  B&H = 252 x mean daily excess; TOM-only and PB-only = 12 x window mean - 12 x round trip; dodge-S (out over
  S[-8,-4], in otherwise) = B&H - 12 x S mean - 12 x round trip.
Round trips: 8 bps (an LSE GBP line such as CSP1; EQ1's unverified assumption), 4 bps (CSPX, the USD line),
3 bps (a basket of the largest US stocks at the close). All UNVERIFIED estimates.
Output: ../results/power_calendar.json
"""
import json, math, os
import numpy as np
from scipy.stats import norm
from common import read_block, month_turns, r

HERE = os.path.dirname(os.path.abspath(__file__))
N_HELD = 127
Z = {"a05": norm.ppf(0.95), "a025": norm.ppf(0.975), "a0167": norm.ppf(1 - 0.05 / 3)}
RT = {"isa_gbp_line_8bps": 0.0008, "usd_line_4bps": 0.0004, "us_basket_3bps": 0.0003}
W = {"TOM": (0, 3), "PB": (-3, 3), "S": (-8, -4)}


def series():
    d, c, m = read_block("F-F_Research_Data_Factors_daily", "Mkt-RF", True)
    rf = m[:, c.index("RF")]
    out = {"US_CRSP_VW": (d, m[:, c.index("Mkt-RF")])}
    d2, c2, m2 = read_block("Portfolios_Formed_on_ME_daily", "Hi 10", True, block_title="Average Value Weighted Returns -- Daily")
    out["US_top_decile"] = (d2, m2[:, c2.index("Hi 10")] - rf)
    for nm, f in [("Europe", "Europe_3_Factors_Daily"), ("Japan", "Japan_3_Factors_Daily"),
                  ("AsiaPac_exJ", "Asia_Pacific_ex_Japan_3_Factors_Daily"), ("Dev_exUS", "Developed_ex_US_3_Factors_Daily")]:
        di, ci, mi = read_block(f, "Mkt-RF", True)
        out[nm] = (di, mi[:, ci.index("Mkt-RF")])
    return out


def event_stats(d, x):
    ev = {}
    for kT, ym in month_turns(d):
        if kT - 20 < 0 or kT + 8 >= len(x):
            continue
        span = np.arange(kT - 20, kT + 9)
        e = {}
        for w, (lo, hi) in W.items():
            idx = np.arange(kT + lo, kT + hi + 1)
            other = np.setdiff1d(span, idx)
            e[w + "_raw"] = float(np.nansum(x[idx]))
            e["D_" + w] = float(np.nanmean(x[idx]) - np.nanmean(x[other]))
        e["D_SPREAD"] = e["PB_raw"] / 7 - e["S_raw"] / 5
        ev[ym] = e
    return ev


S = series()
EV = {k: event_stats(*v) for k, v in S.items()}
OUT = {"n_heldout_events": N_HELD, "round_trips": RT, "z": {k: r(v) for k, v in Z.items()}}
PER = [("1926-1989", 192607, 198912), ("1990-2015", 199001, 201512), ("2003-2015", 200301, 201512), ("1990-07_2015", 199007, 201512)]
for name, ev in EV.items():
    d, x = S[name]
    OUT[name] = {}
    for lab, a, b in PER:
        ks = [k for k in ev if a <= k <= b]
        if len(ks) < 100:
            continue
        sel = (d // 100 >= a) & (d // 100 <= b)
        mu_all = float(np.nanmean(x[sel]))
        res = {"events": len(ks)}
        for stat in ["D_TOM", "D_PB", "D_S", "D_SPREAD"]:
            v = np.array([ev[k][stat] for k in ks])
            eff = -v.mean() if stat == "D_S" else v.mean()       # D_S's hypothesis is negative
            et = eff / v.std(ddof=1) * math.sqrt(N_HELD)
            res[stat] = {"mean_bps_per_day": r(1e4 * v.mean(), 2), "sd_bps_per_day": r(1e4 * v.std(ddof=1), 2),
                         "screen_t": r(eff / v.std(ddof=1) * math.sqrt(len(v)), 2),
                         "heldout_expected_t": r(et, 2),
                         "power_a05": r(norm.cdf(et - Z["a05"])), "power_holm2_first": r(norm.cdf(et - Z["a025"])),
                         "power_holm3_first": r(norm.cdf(et - Z["a0167"])),
                         "power_half_effect_a05": r(norm.cdf(et / 2 - Z["a05"]))}
        # money
        tom, pb, s = (np.array([ev[k][w + "_raw"] for k in ks]) for w in ("TOM", "PB", "S"))
        bh = 252 * mu_all
        money = {"bh_excess_ann_pct": r(100 * bh, 2), "bh_vol_ann_pct": r(100 * np.nanstd(x[sel], ddof=1) * math.sqrt(252), 2)}
        for cn, c in RT.items():
            money[cn] = {"tom_only_minus_bh_ann_pct": r(100 * (12 * tom.mean() - 12 * c - bh), 2),
                         "pb_only_minus_bh_ann_pct": r(100 * (12 * pb.mean() - 12 * c - bh), 2),
                         "dodge_s_minus_bh_ann_pct": r(100 * (-12 * s.mean() - 12 * c), 2),
                         "pb_only_excess_ann_pct": r(100 * (12 * pb.mean() - 12 * c), 2),
                         "pb_only_vol_ann_pct": r(100 * pb.std(ddof=1) * math.sqrt(12), 2),
                         "tom_only_excess_ann_pct": r(100 * (12 * tom.mean() - 12 * c), 2)}
        res["money"] = money
        OUT[name][lab] = res

# multi-market: equal-weight average of D_SPREAD (and D_S) over US_CRSP_VW, Europe, Japan, AsiaPac_exJ, common events
names = ["US_CRSP_VW", "Europe", "Japan", "AsiaPac_exJ"]
for lab, a, b in [("1990-07_2015", 199007, 201512), ("2003-2015", 200301, 201512)]:
    ks = sorted(set.intersection(*[set(k for k in EV[n] if a <= k <= b) for n in names]))
    blk = {}
    for stat in ["D_SPREAD", "D_S", "D_PB"]:
        M = np.array([[EV[n][k][stat] for k in ks] for n in names])
        sgn = -1.0 if stat == "D_S" else 1.0
        eff = sgn * M.mean(axis=1)
        C = np.cov(M)
        w = np.ones(len(names)) / len(names)
        et_avg = (w @ eff) / math.sqrt(w @ C @ w) * math.sqrt(N_HELD)
        et_us = eff[0] / math.sqrt(C[0, 0]) * math.sqrt(N_HELD)
        blk[stat] = {"effects_bps_per_day": {n: r(1e4 * e, 2) for n, e in zip(names, eff)},
                     "corr": [[r(v, 2) for v in row] for row in np.corrcoef(M)],
                     "heldout_expected_t_us_only": r(et_us, 2), "heldout_expected_t_avg4": r(et_avg, 2),
                     "power_us_only_a05": r(norm.cdf(et_us - Z["a05"])), "power_avg4_a05": r(norm.cdf(et_avg - Z["a05"])),
                     "power_avg4_half_effect": r(norm.cdf(et_avg / 2 - Z["a05"]))}
    OUT["multi_market_" + lab] = {"events": len(ks), **blk}
json.dump(OUT, open(os.path.join(HERE, "..", "results", "power_calendar.json"), "w"), indent=1, sort_keys=True)
print("ok")
