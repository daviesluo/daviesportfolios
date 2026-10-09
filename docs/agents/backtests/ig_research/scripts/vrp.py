"""VRP: is there a volatility risk premium a UK spread-bettor can harvest at IG, and what is left after IG's spreads?

The rules, written before the first run:
  VAR   monthly (first trading day of each month, non-overlapping): implied variance (VIX/100)^2 * 30/365 against the
        realised sum of squared daily S&P 500 log returns over the next 21 trading days (^GSPC closes). Reported in
        vol points (VIX - realised vol, both annualised) and as the share of months the seller kept.
  BENCH CBOE's option-strategy benchmarks (real SPX option prices, cash-collateralised): PUT (monthly ATM put write),
        WPUT (weekly), BXM (buy-write), CNDR (monthly 20-delta / 5-delta iron condor), against the S&P 500 with
        dividends (SPY adjusted close) and the 3-month bill: annual return, vol, Sharpe, worst drawdown, by era.
        IG's cost overlay (its options are quoted all-in, its own spread and the market's; sold at the bid, held to
        expiry, which charges no spread): half of IG's published range per option sold, per cycle, in bps of today's
        US 500 level: monthly US 500 options 0.8-2 points, weekly 0.8-2, daily 0.4-1.0.
  STRAD sell an at-the-money straddle each day (IG's daily US 500 options settle at the cash close) priced at VIX1D,
        and each week (Friday close to Friday close, IG's weekly options) priced at VIX9D: premium / S = sqrt(2/pi) *
        k * IV * sqrt(calendar days / 365); P&L / S = premium / S - |ln(S1/S0)|. VIX1D and VIX9D are variance-swap
        rates and sit ABOVE at-the-money vol (they price the put skew), so k = 1 overstates the premium; k = 0.9 and
        0.8 are reported beside it. Capped variants (an iron butterfly's wings at +/- 1.5 and 3 times the premium)
        cap the loss but do NOT pay for the wings: an upper bound for that structure.
  VXS   short the front VIX future (CBOE settlements, inputs/cboe/VX_monthly.csv.gz, 2013-05 ->), rolled to the next
        contract five trading days before expiry; IG's VIX futures bet (spread 0.1, margin 20 %, guaranteed stop
        premium 0.2). Variants: a guaranteed stop at +30 % / +50 % of the entry level, triggered on the day's high, filled
        at the stop plus the 0.2 premium, flat until the next roll.
Output: results/vrp.json (deterministic).
"""
import datetime as dt, math, os, statistics as st
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from common import daily, cboe, fred, read_csv_gz, INP, LEVEL, summ, by_era, by_year, dump

ERAS = {"all": ("1900-01-01", "2026-12-31"), "to2010": ("1900-01-01", "2010-12-31"),
        "2011on": ("2011-01-01", "2026-12-31"), "last5y": ("2021-10-09", "2026-12-31")}


def spx():
    px = daily("^GSPC")
    return {d: v[1] for d, v in px.items() if d >= "1989-01-01"}


def var_month(c, vix):
    days = sorted(d for d in c if d >= "1990-01-02" and d in vix)
    allc = sorted(c)
    idx = {d: i for i, d in enumerate(allc)}
    out, seen = [], set()
    for d in days:
        if d[:7] in seen:
            continue
        seen.add(d[:7])
        i = idx[d]
        if i + 21 >= len(allc):
            break
        rv = sum(math.log(c[allc[j + 1]] / c[allc[j]]) ** 2 for j in range(i, i + 21))
        iv = (vix[d] / 100) ** 2 * 30 / 365
        out.append((d, vix[d] - 100 * math.sqrt(rv * 365 / 30), iv - rv))
    return out


def ann_stats(series, rf, step_days):
    """series: [(date, level)], sampled; returns annual figures from log changes."""
    ks = [d for d, _ in series]
    rets = [(ks[i], math.log(series[i][1] / series[i - 1][1])) for i in range(1, len(series))]
    n_per_year = 365.25 / step_days
    m = st.mean(v for _, v in rets)
    sd = st.pstdev(v for _, v in rets)
    rfm = st.mean(rf.get(d, 0) for d, _ in rets) / n_per_year
    cum, peak, mdd = 0, 0, 0
    for _, v in rets:
        cum += v
        peak = max(peak, cum)
        mdd = min(mdd, cum - peak)
    return {"from": ks[0], "to": ks[-1], "ann_return_pct": round(100 * (math.exp(m * n_per_year) - 1), 2),
            "ann_vol_pct": round(100 * sd * math.sqrt(n_per_year), 2),
            "sharpe": round((m - rfm) / sd * math.sqrt(n_per_year), 2), "max_dd_pct": round(100 * (math.exp(mdd) - 1), 1),
            "worst_step_pct": round(100 * (math.exp(min(v for _, v in rets)) - 1), 1)}


def weekly(series):
    out, last = [], None
    for d, v in series:
        wk = dt.date.fromisoformat(d).isocalendar()[:2]
        if wk != last:
            out.append((d, v))
            last = wk
    return out


def bench(c):
    spy = {r["t"]: float(r["adjclose"]) for r in read_csv_gz(os.path.join(INP, "yahoo_d", "SPY.csv.gz"))
           if r["adjclose"] not in ("", "None")}
    tb = fred("DTB3")
    out = {}
    idx = {k: cboe(k) for k in ("PUT", "WPUT", "BXM", "CNDR")}
    idx["SPX_TR(SPY)"] = spy
    for era, (lo, hi) in {"2006-02_on": ("2006-02-01", "2026-12-31"), "2011on": ("2011-01-01", "2026-12-31"),
                          "last5y": ("2021-10-09", "2026-12-31"), "2016on": ("2016-01-01", "2026-12-31")}.items():
        for k, s in idx.items():
            ser = weekly([(d, s[d]) for d in sorted(s) if lo <= d <= hi])
            if len(ser) > 52:
                out.setdefault(era, {})[k] = ann_stats(ser, tb, 7)
    return out


def ig_overlay():
    """IG's spread as a yearly drag on each benchmark, at today's US 500 level (points -> bps)."""
    L = LEVEL["US500"]
    o = {}
    for k, (cycles, legs, lo, hi) in {"PUT": (12, 1, 0.8, 2.0), "WPUT": (52, 1, 0.8, 2.0), "BXM": (12, 1, 0.8, 2.0),
                                      "CNDR": (12, 4, 0.8, 2.0)}.items():
        o[k] = {"pct_of_spx_a_year": [round(100 * cycles * legs * lo / 2 / L, 3), round(100 * cycles * legs * hi / 2 / L, 3)]}
    # CNDR is collateralised by its wing width, not by the index: 20-delta to 5-delta at one month is about
    # (1.645 - 0.842) * sigma * sqrt(1/12) of the index; at the VIX's 2011-2026 median (17.2) that is 3.99 % of 7,765.
    w = (1.645 - 0.842) * 0.172 * math.sqrt(1 / 12) * L
    o["CNDR"]["wing_points_est"] = round(w, 1)
    o["CNDR"]["pct_of_collateral_a_year"] = [round(100 * 12 * 4 * 0.4 / w, 1), round(100 * 12 * 4 * 1.0 / w, 1)]
    return o


def straddles(c):
    v1, v9 = cboe("VIX1D"), cboe("VIX9D")
    days = sorted(c)
    res = {}
    for name, iv, step, cost_pts in (("daily_VIX1D", v1, "day", (0.4, 1.0)), ("weekly_VIX9D", v9, "week", (0.8, 2.0))):
        pairs = []
        if step == "day":
            for a, b in zip(days, days[1:]):
                if a in iv:
                    pairs.append((a, b))
        else:
            fr = [d for d in days if dt.date.fromisoformat(d).weekday() == 4 and d in iv]
            for a, b in zip(fr, fr[1:]):
                if (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days == 7:
                    pairs.append((a, b))
        for k in (1.0, 0.9, 0.8):
            for cap in (None, 1.5, 3.0):
                rows = []
                for a, b in pairs:
                    T = (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days / 365
                    prem = math.sqrt(2 / math.pi) * k * iv[a] / 100 * math.sqrt(T)
                    loss = abs(math.log(c[b] / c[a]))
                    if cap:
                        loss = min(loss, prem * (1 + cap))  # wings at +/- cap*premium beyond the strike: unpaid
                    rows.append((b, prem - loss - cost_pts[0] / LEVEL["US500"]))
                key = f"{name}_k{k}" + (f"_cap{cap}" if cap else "")
                per_year = len(rows) / ((dt.date.fromisoformat(rows[-1][0]) - dt.date.fromisoformat(rows[0][0])).days / 365.25)
                res[key] = {"net_low_cost": summ([v for _, v in rows], per_year),
                            "net_high_cost_mean_bps": round(1e4 * (st.mean(v for _, v in rows) -
                                                                   (cost_pts[1] - cost_pts[0]) / LEVEL["US500"]), 2),
                            "eras": by_era(rows, ERAS), "by_year_bps": by_year(rows), "worst_bps": round(1e4 * min(v for _, v in rows), 0)}
    return res


def vx_short():
    rows = read_csv_gz(os.path.join(INP, "cboe", "VX_monthly.csv.gz"))
    by = {}
    for r in rows:
        by.setdefault(r["trade_date"], {})[r["expiry"]] = (float(r["settle"]), float(r["high"] or 0))
    days = sorted(by)
    exps = sorted({r["expiry"] for r in rows})

    import bisect

    def front(d):
        """The contract held on day d: the nearest expiry with more than 5 trading days left after d."""
        i = bisect.bisect_right(days, d)
        for e in exps:
            if e > d and bisect.bisect_right(days, e) - i > 5:
                return e
        return None
    res = {}
    for stop in (None, 0.30, 0.50):
        pnl, entry, cur, stopped = [], None, None, False
        for i in range(1, len(days)):
            d0, d1 = days[i - 1], days[i]
            e0 = front(d0)
            if e0 is None or e0 not in by[d0] or e0 not in by[d1]:
                continue
            if e0 != cur:  # roll: open a new short at d0's settle, pay the IG spread (0.1 a round trip)
                cur, entry, stopped = e0, by[d0][e0][0], False
                pnl.append((d0, -0.1, entry))
            if stopped:
                continue
            s0, (s1, h1) = by[d0][e0][0], by[d1][e0]
            if stop and h1 >= entry * (1 + stop):
                lvl = entry * (1 + stop)
                pnl.append((d1, -(lvl - s0) - 0.2, entry))
                stopped = True
                continue
            pnl.append((d1, -(s1 - s0), entry))
        # in VIX points per unit; as % of the entry level (the notional a unit carries)
        rows = [(d, v / e) for d, v, e in pnl]
        daily_by = {}
        for d, v in rows:
            daily_by[d] = daily_by.get(d, 0) + v
        dr = sorted(daily_by.items())
        yrs = (dt.date.fromisoformat(dr[-1][0]) - dt.date.fromisoformat(dr[0][0])).days / 365.25
        key = "VXS" + (f"_stop{int(stop * 100)}" if stop else "")
        res[key] = {"daily_pct_of_notional": summ([v for _, v in dr], len(dr) / yrs), "by_year_pct": {
            y: round(v / 100, 1) for y, v in by_year(dr).items()}, "worst_day_pct": round(100 * min(v for _, v in dr), 1),
            "eras": by_era(dr, ERAS), "first": dr[0][0], "last": dr[-1][0]}
    return res


def main():
    c = spx()
    vix = cboe("VIX")
    vm = var_month(c, vix)
    out = {"VAR": {"months": len(vm), "from": vm[0][0], "to": vm[-1][0],
                   "vol_points": {e: {"mean": round(st.mean(v for d, v, _ in vm if lo <= d <= hi), 2),
                                      "share_positive": round(sum(v > 0 for d, v, _ in vm if lo <= d <= hi) /
                                                              sum(1 for d, *_ in vm if lo <= d <= hi), 3),
                                      "worst": round(min(v for d, v, _ in vm if lo <= d <= hi), 1)}
                                  for e, (lo, hi) in ERAS.items()},
                   "by_year_mean_vol_points": {}}}
    for y in sorted({d[:4] for d, *_ in vm}):
        out["VAR"]["by_year_mean_vol_points"][y] = round(st.mean(v for d, v, _ in vm if d[:4] == y), 2)
    out["BENCH"] = bench(c)
    out["IG_overlay"] = ig_overlay()
    out["STRAD"] = straddles(c)
    out["VXS"] = vx_short()
    dump("vrp.json", out)
    print({k: out["VAR"]["vol_points"][k] for k in ERAS})
    for era, d in out["BENCH"].items():
        print(era, {k: (v["ann_return_pct"], v["sharpe"], v["max_dd_pct"]) for k, v in d.items()})
    print(out["IG_overlay"])
    for k, v in out["STRAD"].items():
        n = v["net_low_cost"]
        print(k, n["n"], n["mean_bps"], n["t"], v["net_high_cost_mean_bps"], v["worst_bps"],
              {e: (x.get("mean_bps"), x.get("t")) for e, x in v["eras"].items()})
    for k, v in out["VXS"].items():
        n = v["daily_pct_of_notional"]
        print(k, n["annual_bps"], n["annual_sharpe"], n["max_dd_bps"], v["worst_day_pct"], v["by_year_pct"])


if __name__ == "__main__":
    main()
