"""IDX: index calendar and session effects as IG daily funded bets (DFBs), net of IG's spread and overnight funding.

The rules, written before the first run (every arm is reported; none is dropped):
  Markets and proxies (daily bars, inputs/yahoo_d): US500 = SPY (1995 ->, its dividends added on the ex-date, as a
  long DFB is credited them); USTECH = QQQ (1999-03 ->, dividends likewise); UK100 = ^FTSE (1997 ->, SONIA's start;
  a long DFB is credited the index's dividends, taken as ISF.L's trailing-12-month yield from 2010, 3.5 % a year
  before, spread over calendar days) -- REPLACED after the first run: Yahoo's ^FTSE open equals the previous close
  on 93-100 % of days from 2001 (a stale field, not a price), so UK100 is ISF.L (iShares Core FTSE 100 on the LSE,
  2009 ->, its own opening auction and dividends; SONIA funding); DE40 = ^GDAXI (1999 ->, ECB deposit rate's start; a performance index, no
  dividend). An index's opening print stands in for IG's price at the open (IG quotes from the futures; see review).
  Costs: one full IG spread a round trip at the cash-hours width (common.SPREAD_PTS, bps at the 2026-10-08 level);
  a DFB held through 22:00 UK pays (benchmark + 3.4 %) / divisor a night if long, (3.4 % - benchmark) if short, and a
  weekend or holiday counts its calendar nights.
  ON     long from the cash close to the next cash open (funded over the night).
  ID     long from the open to the close (no funding): the control for ON.
  DOW_d  long close to close on weekday d (one night funded, three for Monday).
  PREHOL long close to close on the last trading day before a weekday the exchange is shut (US500 and UK100).
  FOMC   US500 long close to close on a scheduled FOMC statement day (inputs/fomc_dates.json); FOMC_m1 the day before.
  GAPF_G fade the opening gap when |ln(open / previous close)| >= G (0.25 %, 0.5 %, 1 %), open to close, no funding.
Eras: all; to 2010; 2011 -> 2026-10-08; the last five years. FOMC adds Lucca and Moench's 1994-2011 and after it.
Multiple testing: every arm here counts toward the review's Bonferroni bar.
Output: results/idx_calendar.json (deterministic).
"""
import bisect, datetime as dt, math
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from common import (daily, Rate, spread_bps, ADMIN_FEE, DIVISOR, summ, by_era, by_year, dump, read_csv_gz, INP)
import json, os

ERAS = {"all": ("1900-01-01", "2026-12-31"), "to2010": ("1900-01-01", "2010-12-31"),
        "2011on": ("2011-01-01", "2026-12-31"), "last5y": ("2021-10-09", "2026-12-31")}
MK = {"US500": ("SPY", "USD", "1995-01-03"), "USTECH": ("QQQ", "USD", "1999-03-10"),
      "UK100": ("ISF.L", "GBP", "2009-01-05"), "DE40": ("^GDAXI", "EUR", "1999-01-04")}


def ftse_yield():
    """Trailing-12-month ISF.L dividend over its close, by date (2010 on); 3.5 % before."""
    rows = read_csv_gz(os.path.join(INP, "yahoo_d", "ISF.L.csv.gz"))
    divs = [(r["t"], float(r["div"])) for r in rows if r["div"]]
    px = {r["t"]: float(r["close"]) for r in rows if r["close"] not in ("", "None")}
    out = {}
    for d, c in px.items():
        if d < "2010-01-01":
            continue
        lo = (dt.date.fromisoformat(d) - dt.timedelta(days=365)).isoformat()
        out[d] = sum(v for dd, v in divs if lo < dd <= d) / c
    keys = sorted(out)

    def at(day):
        if day < "2010-01-01":
            return 0.035
        i = bisect.bisect_right(keys, day) - 1
        return out[keys[i]] if i >= 0 else 0.035
    return at


def nights(d0, d1):
    return (dt.date.fromisoformat(d1) - dt.date.fromisoformat(d0)).days


def run_market(mkt):
    sym, ccy, start = MK[mkt]
    px = daily(sym)
    days = [d for d in sorted(px) if d >= start and d <= "2026-10-08"]
    rate = Rate(ccy)
    fy = None  # ISF.L carries its own dividends (ftse_yield() kept for the ^FTSE variant of the first run)
    sp = spread_bps(mkt) / 1e4
    div_ = DIVISOR[mkt]
    arms = {k: [] for k in ["ON", "ID", "PREHOL", "FOMC", "FOMC_m1"] + [f"DOW_{i}" for i in range(5)] +
            [f"GAPF_{g}" for g in ("0.25", "0.5", "1")]}
    gross = {k: [] for k in arms}
    fomc = set(json.load(open(os.path.join(INP, "fomc_dates.json")))["days"])
    dayset = set(days)
    for i in range(1, len(days)):
        d0, d1 = days[i - 1], days[i]
        o0, c0, _ = px[d0]
        o1, c1, dv = px[d1]
        n = nights(d0, d1)
        if n > 5:
            continue  # a hole in the data, not a weekend
        r = rate.at(d0)
        if r is None:
            continue
        divy = dv / c0 + (fy(d0) * n / 365 if fy else 0.0)
        fund_long = (r + ADMIN_FEE) * n / div_
        on = math.log(o1 / c0) + divy
        idr = math.log(c1 / o1)
        cc = math.log(c1 / c0) + divy
        arms["ON"].append((d1, on - sp - fund_long)); gross["ON"].append((d1, on))
        arms["ID"].append((d1, idr - sp)); gross["ID"].append((d1, idr))
        wd = dt.date.fromisoformat(d1).weekday()
        if wd < 5:
            arms[f"DOW_{wd}"].append((d1, cc - sp - fund_long)); gross[f"DOW_{wd}"].append((d1, cc))
        # pre-holiday: the next weekday after d1 is not a trading day (and the data continues past it)
        nxt = dt.date.fromisoformat(d1) + dt.timedelta(days=1)
        while nxt.weekday() >= 5:
            nxt += dt.timedelta(days=1)
        if i + 1 < len(days) and nxt.isoformat() not in dayset and days[i + 1] > nxt.isoformat() \
                and nights(d1, days[i + 1]) <= 5:
            arms["PREHOL"].append((d1, cc - sp - fund_long)); gross["PREHOL"].append((d1, cc))
        if mkt == "US500" and d1 in fomc:
            arms["FOMC"].append((d1, cc - sp - fund_long)); gross["FOMC"].append((d1, cc))
        if mkt == "US500" and i + 1 < len(days) and days[i + 1] in fomc:
            arms["FOMC_m1"].append((d1, cc - sp - fund_long)); gross["FOMC_m1"].append((d1, cc))
        g = on  # the gap net of the dividend drop
        for G in ("0.25", "0.5", "1"):
            if abs(g) >= float(G) / 100:
                pos = -1 if g > 0 else 1
                arms[f"GAPF_{G}"].append((d1, pos * idr - sp)); gross[f"GAPF_{G}"].append((d1, pos * idr))
    out = {"proxy": sym, "first": days[0], "last": days[-1], "spread_bps_round_trip": round(1e4 * sp, 2),
           "funding_now_bps_a_night_long": round(1e4 * (rate.at(days[-1]) + ADMIN_FEE) / div_, 2), "arms": {}}
    span = (dt.date.fromisoformat(days[-1]) - dt.date.fromisoformat(days[0])).days / 365.25
    for k, rows in arms.items():
        if not rows:
            continue
        net = [v for _, v in rows]
        out["arms"][k] = {"net": summ(net, len(net) / span), "gross": summ([v for _, v in gross[k]], len(net) / span),
                          "eras_net": by_era(rows, ERAS), "eras_gross": by_era(gross[k], ERAS),
                          "by_year_net_bps": by_year(rows)}
        if k.startswith("FOMC"):
            out["arms"][k]["eras_net"].update(by_era(rows, {"LM_1994_2011": ("1994-01-01", "2011-12-31"),
                                                            "post_2012": ("2012-01-01", "2026-12-31")}))
            out["arms"][k]["eras_gross"].update(by_era(gross[k], {"LM_1994_2011": ("1994-01-01", "2011-12-31"),
                                                                  "post_2012": ("2012-01-01", "2026-12-31")}))
    return out


def main():
    res = {m: run_market(m) for m in MK}
    res["arms_counted"] = sum(len(v["arms"]) for v in res.values() if isinstance(v, dict) and "arms" in v)
    dump("idx_calendar.json", res)
    for m in MK:
        print(m, res[m]["first"], res[m]["spread_bps_round_trip"], res[m]["funding_now_bps_a_night_long"])
        for k, v in res[m]["arms"].items():
            a, g = v["net"], v["gross"]
            e = v["eras_net"]
            print(f"  {k:9s} n{a['n']:5d} /yr{a['per_year']:6.1f} gross{g['mean_bps']:7.2f} net{a['mean_bps']:7.2f} "
                  f"t{a['t']:6.2f} | to2010 {e['to2010'].get('mean_bps', '-')!s:>6} t{e['to2010'].get('t', '-')!s:>5}"
                  f" | 2011on {e['2011on'].get('mean_bps', '-')!s:>6} t{e['2011on'].get('t', '-')!s:>5}"
                  f" | 5y {e['last5y'].get('mean_bps', '-')!s:>6} t{e['last5y'].get('t', '-')!s:>5} ann{a['annual_bps']:8.1f}"
                  f" dd{a['max_dd_bps']:7.0f}")
    print("arms", res["arms_counted"])


if __name__ == "__main__":
    main()
