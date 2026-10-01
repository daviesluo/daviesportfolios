"""Screening on Ken French's CRSP-based files, 1926-07 -> 2015-12-31 ONLY.

Every series is truncated at SCREEN_END the moment it is parsed, before any
statistic is computed, and the script asserts that no later row survives.
2016-01-01 -> 2026-08 (the files' last month) is the held-out window a future
pre-registration may use; nothing here reads it.

Outputs screen_french.json: effect sizes used ONLY to size power checks.
They are screening numbers, not evidence.
"""
import csv, gzip, io, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KF = os.path.join(HERE, "..", "inputs")
SCREEN_END = 20151231          # inclusive, daily key
SCREEN_END_M = 201512          # inclusive, monthly key
OUT = {"screen_end": "2015-12-31", "source": "Ken French data library, files built from CRSP 202608",
       "note": "screening only; held-out window 2016-01 -> 2026-08 never read"}


def read_block(path, first_header_contains, daily):
    """Return (dates, columns, matrix) for the FIRST block of a French CSV."""
    rows, cols, started = [], None, False
    with gzip.open(path + ".gz", "rt", encoding="latin-1") as f:
        for line in f:
            s = line.strip()
            if not started:
                if s.startswith(",") and first_header_contains in s:
                    cols = [c.strip() for c in s.split(",")[1:]]
                    started = True
                continue
            if not s or not s[0].isdigit():
                break
            parts = [p.strip() for p in s.split(",")]
            key = int(parts[0])
            if daily and len(parts[0]) != 8:
                break
            if not daily and len(parts[0]) != 6:
                break
            rows.append((key, [float(x) for x in parts[1:]]))
    end = SCREEN_END if daily else SCREEN_END_M
    rows = [r for r in rows if r[0] <= end]            # THE CUT
    assert rows and max(r[0] for r in rows) <= end
    dates = np.array([r[0] for r in rows])
    raw = np.array([r[1] for r in rows])
    raw[raw <= -99.98] = np.nan                         # -99.99 / -999 missing codes, compared before dividing:
    m = raw / 100.0                                     # -99.99 / 100 is not <= -0.9999 in floating point
    return dates, cols, m


def ann_stats(x, per_year):
    x = x[~np.isnan(x)]
    mu, sd = x.mean(), x.std(ddof=1)
    return {"n": int(len(x)), "mean_ann_pct": round(100 * mu * per_year, 3),
            "sd_ann_pct": round(100 * sd * math.sqrt(per_year), 3),
            "sharpe_or_ir": round(mu / sd * math.sqrt(per_year), 3) if sd > 0 else None,
            "t": round(mu / sd * math.sqrt(len(x)), 2) if sd > 0 else None}


def years_for_t2(ir):
    return None if not ir or ir <= 0 else round((2.0 / ir) ** 2, 1)


def maxdd(r):
    eq = np.cumprod(1 + np.nan_to_num(r))
    peak = np.maximum.accumulate(eq)
    return round(100 * (eq / peak - 1).min(), 1)


# ---------------------------------------------------------------- daily market
d, cols, m = read_block(os.path.join(KF, "F-F_Research_Data_Factors_daily.csv"), "Mkt-RF", True)
mkt_rf, rf = m[:, cols.index("Mkt-RF")], m[:, cols.index("RF")]
ym = d // 100


def tom_flags(dates):
    """TOM window per McConnell & Xu (2008): last trading day of a month and
    the first three trading days of the next. Returns event id per day (-1 = not TOM)."""
    ymv = dates // 100
    n = len(dates)
    ev = -np.ones(n, dtype=int)
    starts = np.r_[0, np.nonzero(np.diff(ymv))[0] + 1]   # first day of each month
    for k, s in enumerate(starts):
        if s == 0:
            continue
        idx = [s - 1] + [s + j for j in range(3) if s + j < n and ymv[s + j] == ymv[s]]
        if len(idx) == 4:
            ev[idx] = k
    return ev


ev = tom_flags(d)
OUT["tom"] = {}
for label, lo, hi in [("1926-1989", 19260701, 19891231), ("1990-2015", 19900101, 20151231),
                      ("1990-2002", 19900101, 20021231), ("2003-2015", 20030101, 20151231)]:
    sel = (d >= lo) & (d <= hi)
    e = ev[sel]; x = mkt_rf[sel]
    in_tom = e >= 0
    # per-event 4-day excess return (sum of daily excess) vs the average 4-day excess outside TOM
    ids = np.unique(e[in_tom])
    tom4 = np.array([x[e == i].sum() for i in ids])
    out_daily = x[~in_tom]
    diff_per_event = tom4 - 4 * out_daily.mean()
    # strategy: in the market (excess) only on TOM days, T-bills otherwise -> monthly excess series
    strat = np.where(in_tom, x, 0.0)
    m_ids = (d[sel] // 100)
    months = np.unique(m_ids)
    strat_m = np.array([strat[m_ids == mm].sum() for mm in months])
    OUT["tom"][label] = {
        "events": int(len(ids)),
        "tom4_mean_pct": round(100 * tom4.mean(), 3), "tom4_sd_pct": round(100 * tom4.std(ddof=1), 3),
        "nontom_daily_mean_pct": round(100 * out_daily.mean(), 4),
        "tom_daily_mean_pct": round(100 * x[in_tom].mean(), 4),
        "diff_per_event_pct": round(100 * diff_per_event.mean(), 3),
        "diff_t": round(diff_per_event.mean() / diff_per_event.std(ddof=1) * math.sqrt(len(ids)), 2),
        "events_for_t2_at_this_effect": round((2 * diff_per_event.std(ddof=1) / diff_per_event.mean()) ** 2, 0)
        if diff_per_event.mean() > 0 else None,
        "timing_strategy_excess": ann_stats(strat_m, 12),
        "buy_hold_excess": ann_stats(np.array([x[m_ids == mm].sum() for mm in months]), 12),
        "share_of_days_in_market": round(in_tom.mean(), 3),
    }

# ---------------------------------------------------------------- monthly market trend (10-month SMA)
dm, cm, mmn = read_block(os.path.join(KF, "F-F_Research_Data_Factors.csv"), "Mkt-RF", False)
mret = mmn[:, cm.index("Mkt-RF")] + mmn[:, cm.index("RF")]
rfm = mmn[:, cm.index("RF")]
tr = np.cumprod(1 + mret)
sig = np.full(len(tr), np.nan)
for t in range(9, len(tr)):
    sig[t] = 1.0 if tr[t] > tr[t - 9:t + 1].mean() else 0.0   # price above its 10-month average at month end
hold = np.r_[np.nan, sig[:-1]]                                   # act next month: no look-ahead
strat = np.where(hold == 1, mret, rfm)
OUT["trend_10m_sma_us_market"] = {}
for label, lo, hi in [("1927-1989", 192701, 198912), ("1990-2015", 199001, 201512), ("2003-2015", 200301, 201512)]:
    sel = (dm >= lo) & (dm <= hi) & ~np.isnan(hold)
    s, b, r = strat[sel], mret[sel], rfm[sel]
    switches = np.abs(np.diff(hold[sel])).sum()
    yrs = sel.sum() / 12
    OUT["trend_10m_sma_us_market"][label] = {
        "months": int(sel.sum()),
        "timing_excess": ann_stats(s - r, 12), "buyhold_excess": ann_stats(b - r, 12),
        "active_vs_buyhold": ann_stats(s - b, 12),
        "years_for_t2_active": years_for_t2(ann_stats(s - b, 12)["sharpe_or_ir"]),
        "maxdd_timing_pct": maxdd(s), "maxdd_buyhold_pct": maxdd(b),
        "switches_per_year": round(switches / yrs, 2),
        "share_months_invested": round(np.nanmean(hold[sel]), 3),
    }

# ---------------------------------------------------------------- industry momentum, 12 industries, VW
di, ci, mi = read_block(os.path.join(KF, "12_Industry_Portfolios.csv"), "NoDur", False)
K = 3
gross = np.cumprod(1 + np.nan_to_num(mi), axis=0)
act, turn, dates_used = [], [], []
prev = None
for t in range(12, len(di)):
    # formation: months t-12 .. t-2 (skip the most recent month), hold month t
    past = gross[t - 2] / gross[t - 13] - 1
    top = set(np.argsort(-past)[:K])
    r_top = mi[t, list(top)].mean()
    r_all = np.nanmean(mi[t])
    act.append(r_top - r_all); dates_used.append(di[t])
    if prev is not None:
        turn.append(len(top - prev) / K)
    prev = top
act, dates_used, turn = np.array(act), np.array(dates_used), np.array(turn)
OUT["industry_momentum_top3_of_12"] = {}
for label, lo, hi in [("1927-1989", 192701, 198912), ("1990-2015", 199001, 201512), ("2003-2015", 200301, 201512)]:
    sel = (dates_used >= lo) & (dates_used <= hi)
    st = ann_stats(act[sel], 12)
    OUT["industry_momentum_top3_of_12"][label] = {
        "active_vs_equal_weight_12": st, "years_for_t2": years_for_t2(st["sharpe_or_ir"]),
        "mean_share_of_book_replaced_per_month": round(turn[sel[1:]].mean(), 3),
    }

# ---------------------------------------------------------------- short-term reversal, big caps (monthly, prior 1 month)
dr, cr, mr = read_block(os.path.join(KF, "6_Portfolios_ME_Prior_1_0.csv"), "SMALL", False)
OUT["strev_columns"] = cr
big_lo, big_hi = mr[:, cr.index("BIG LoPRIOR")], mr[:, cr.index("BIG HiPRIOR")]
# the big-cap market proxy: the three big portfolios at the 30/40/30 breakpoint weights
# (an approximation of their value weights, labelled as such in the report)
big_all = 0.3 * mr[:, cr.index("BIG LoPRIOR")] + 0.4 * mr[:, cr.index("ME2 PRIOR2")] + 0.3 * mr[:, cr.index("BIG HiPRIOR")]
OUT["strev_big_caps_monthly"] = {}
for label, lo, hi in [("1927-1989", 192701, 198912), ("1990-2015", 199001, 201512), ("2003-2015", 200301, 201512)]:
    sel = (dr >= lo) & (dr <= hi)
    ls = ann_stats((big_lo - big_hi)[sel], 12)
    lo_only = ann_stats((big_lo - big_all)[sel], 12)
    OUT["strev_big_caps_monthly"][label] = {
        "long_short_BigLo_minus_BigHi": ls, "long_only_BigLo_minus_Big_avg": lo_only,
        "years_for_t2_long_only_gross": years_for_t2(lo_only["sharpe_or_ir"]),
    }

json.dump(OUT, open(os.path.join(HERE, "..", "results", "screen_french.json"), "w"), indent=1)
print(json.dumps(OUT, indent=1))
