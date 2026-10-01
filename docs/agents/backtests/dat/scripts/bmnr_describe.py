"""DAT study, BMNR (an ether treasury since mid-2025): DESCRIPTIVE ONLY (design.md §1, §8 step 5), run after the MSTR
screen's verdict was written down (notes/verdict_mstr_screen.md). No test, no threshold, no pre-registration.

ETH held: every "holdings are comprised of N ETH" / "ETH holdings total N" in BMNR's 8-K press releases (EX-99),
counted from the first US close after EDGAR accepted the filing. Shares: the dated counts BMNR itself published
(SHARES, each with its source); between two counts log(shares) is interpolated, which looks ahead within each gap,
so the series runs only from the first count (2025-07-28) to the last (2026-05-31). The first count is BMNR's
"fully diluted" figure, the others basic. ETH at the US close: Coinbase's hourly candle ending 16:00 ET.

Writes ../results/bmnr_descriptive.json: mNAV (market cap over ETH × price) by month, its daily AR(1) and half-life,
ETH per share, BMNR against ETH over the span and from the highest mNAV, and how many years a test like H1 would
need (power.py's simulation at BMNR's own persistence and noise). Run: python3 .../scripts/bmnr_describe.py
"""
import bisect, datetime as dt, gzip, json, math, os, re
import numpy as np
from common import ET, INP, design_sha, html_text, ols, r6, write_json
from power import sim_beta

SEC = os.path.join(INP, "sec", "0001829311")
DESC = os.path.join(INP, "descriptive")
HELD = re.compile(r"(?:holdings? (?:are )?comprised of|ETH holdings(?:\s*1)?\s+total(?:s)?)\s+([\d,]{5,})", re.I)
SHARES = [  # (as-of date, shares, source)
    ("2025-07-28", 121739533, "8-K 2025-07-29 EX-99.1: 'fully diluted common shares outstanding is 121,739,533'"),
    ("2025-08-31", 234712310, "10-K filed 2025-11-21, cover"),
    ("2025-11-20", 384067823, "10-K filed 2025-11-21, cover"),
    ("2025-11-30", 408578823, "10-Q filed 2026-01-13, note 7"),
    ("2026-01-12", 454862451, "10-Q filed 2026-01-13, cover"),
    ("2026-02-28", 493905227, "10-Q filed 2026-04-14, balance sheet"),
    ("2026-05-31", 579652432, "10-Q filed 2026-07-14, balance sheet"),
]


def yahoo_rows(sym):
    j = json.load(gzip.open(os.path.join(DESC, f"yahoo_{sym}_1d.json.gz")))
    return [(r[0], float(r[5])) for r in j["rows"]]


def coin_close_at(coin):
    rows = json.load(gzip.open(os.path.join(DESC, f"coinbase_{coin}-USD_1h.json.gz")))
    return {int(r[0]): float(r[4]) for r in rows}


def at(c1h, day, hh=16):
    end = dt.datetime.fromisoformat(day).replace(hour=hh, tzinfo=ET)
    t = int(end.timestamp()) - 3600
    for k in range(48):
        if t - 3600 * k in c1h:
            return c1h[t - 3600 * k]
    raise ValueError(day)


def main():
    idx = json.load(open(os.path.join(SEC, "filings_2025-05-01_2026-09-30.json")))["filings"]
    px = yahoo_rows("BMNR")
    dates = [d for d, _ in px]
    held = []
    for f in idx:
        if not f["form"].startswith("8-K"):
            continue
        for e in f.get("exhibits", []):
            m = HELD.findall(html_text(gzip.open(os.path.join(SEC, f"{f['accession']}_{e['name']}.gz")).read()))
            if m:
                t = dt.datetime.fromisoformat(f["acceptance_utc"].replace("Z", "+00:00")).astimezone(ET)
                k = bisect.bisect_left(dates, t.strftime("%Y-%m-%d"))
                if k < len(dates) and dates[k] == t.strftime("%Y-%m-%d") and t.hour >= 16:
                    k += 1
                held.append((k, int(m[0].replace(",", "")), f["accession"]))
    held.sort()
    eth = coin_close_at("ETH")
    s_dates = [dt.date.fromisoformat(d) for d, _, _ in SHARES]
    s_log = [math.log(n) for _, n, _ in SHARES]
    lo, hi = SHARES[0][0], SHARES[-1][0]
    rows = []
    for i, (d, p) in enumerate(px):
        if not (lo <= d <= hi):
            continue
        hs = [h for k, h, _ in held if k <= i]
        if not hs:
            continue
        x = dt.date.fromisoformat(d)
        j = bisect.bisect_right(s_dates, x) - 1
        if j >= len(SHARES) - 1:
            ln = s_log[-1]
        else:
            w = (x - s_dates[j]).days / (s_dates[j + 1] - s_dates[j]).days
            ln = s_log[j] + w * (s_log[j + 1] - s_log[j])
        n = math.exp(ln)
        e = at(eth, d)
        rows.append((d, p, n, hs[-1], e, p * n / (hs[-1] * e)))
    d_ = [r[0] for r in rows]
    m = np.array([r[5] for r in rows]); x = np.log(m)
    P = np.array([r[1] for r in rows]); E = np.array([r[4] for r in rows])
    N = np.array([r[2] for r in rows]); H = np.array([r[3] for r in rows])
    a, v, _ = ols(x[1:], np.c_[np.ones(len(x) - 1), x[:-1]])
    rho = a[1]
    hl = math.log(0.5) / math.log(rho) if 0 < rho < 1 else None
    by_month = {}
    for d, mm in zip(d_, m):
        by_month.setdefault(d[:7], []).append(mm)
    imax = int(np.argmax(m))
    below = [d for d, mm in zip(d_, m) if mm < 1]
    rel = lambda i0, i1: float(math.log(P[i1] / P[i0]) - math.log(E[i1] / E[i0]))
    # how long would an H1-style test need on BMNR (large effect: one SD of x moves the 60-day relative return 10 %)
    h = 60
    lp, le = np.log(P), np.log(E)
    dd = np.array([(lp[t + h] - lp[t]) - (le[t + h] - le[t]) for t in range(len(x) - h)])
    ii = np.arange(0, len(x) - h, h)
    rho_h = rho ** h
    su = float(np.std(dd, ddof=1)); sv = float(np.std(x[ii[1:]] - rho_h * x[ii[:-1]], ddof=1)) if len(ii) > 2 else None
    r1 = np.diff(lp) - np.diff(le)                                  # daily relative return
    corr = float(np.corrcoef(np.diff(x), r1)[0, 1])                 # innovation correlation, from daily changes
    rng = np.random.default_rng(20261001)
    years = {}
    if sv and corr is not None:
        b_large = -0.10 / float(np.std(x, ddof=1))
        for y in (1, 2, 3, 5, 10, 20):
            n_obs = (252 * y) // h
            if n_obs < 4:
                continue
            null = sim_beta(rng, n_obs, min(rho_h, 0.999), su, sv, min(max(corr, -0.99), 0.99), 0.0, 20000)
            alt = sim_beta(rng, n_obs, min(rho_h, 0.999), su, sv, min(max(corr, -0.99), 0.99), b_large, 10000)
            years[f"{y}y"] = r6(float((alt <= np.quantile(null, 0.05)).mean()))
    out = {"design_sha256": design_sha(), "label": "descriptive only; shares interpolated between published counts",
           "first": d_[0], "last": d_[-1], "days": len(d_), "shares_points": SHARES,
           "holdings_points": [(dates[k] if k < len(dates) else None, v, s) for k, v, s in held],
           "mnav_by_month": {k: {"min": r6(min(v)), "median": r6(float(np.median(v))), "max": r6(max(v))}
                             for k, v in sorted(by_month.items())},
           "mnav_first": r6(m[0]), "mnav_last": r6(m[-1]), "mnav_max": r6(m[imax]), "mnav_max_date": d_[imax],
           "first_close_below_1": below[0] if below else None, "days_below_1": len(below),
           "persistence": {"rho_daily": r6(rho), "half_life_days": r6(hl), "episodes_T_over_half_life": r6(len(x) / hl) if hl else None},
           "eth_per_share_first": r6(H[0] / N[0]), "eth_per_share_last": r6(H[-1] / N[-1]),
           "log_rel_return_whole_span": r6(rel(0, len(P) - 1)), "log_rel_return_from_max_mnav": r6(rel(imax, len(P) - 1)),
           "bmnr_log_return_whole_span": r6(float(math.log(P[-1] / P[0]))), "eth_log_return_whole_span": r6(float(math.log(E[-1] / E[0]))),
           "test_power_large_effect_h60_by_years": years, "sd_rel_return_60d": r6(su), "rho_60d": r6(rho_h),
           "corr_daily_dx_rel": r6(corr), "sd_x": r6(float(np.std(x, ddof=1)))}
    write_json("bmnr_descriptive.json", out)
    print(json.dumps({k: out[k] for k in ("first", "last", "days", "mnav_first", "mnav_max", "mnav_max_date", "mnav_last",
                                          "first_close_below_1", "days_below_1", "persistence", "eth_per_share_first",
                                          "eth_per_share_last", "log_rel_return_whole_span", "log_rel_return_from_max_mnav",
                                          "bmnr_log_return_whole_span", "eth_log_return_whole_span",
                                          "test_power_large_effect_h60_by_years", "sd_rel_return_60d", "rho_60d",
                                          "corr_daily_dx_rel", "sd_x")}, indent=1))
    for k, v in out["mnav_by_month"].items():
        print(k, v)


if __name__ == "__main__":
    main()
