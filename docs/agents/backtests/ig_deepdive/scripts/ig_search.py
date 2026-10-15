"""A wider search for IG spread-bet and CFD strategies, beyond the spec's four (review section 6), on public data.

Every rule below was written before its first run; every arm is reported; none is dropped or re-tuned. The family is
the eight arms marked [arm]; a candidate needs t >= 3.0 on its headline (Bonferroni over eight at 5 %, two-sided, is
2.73; 3.0 leaves room for the arms the 2026-10-09 review already spent), and the same sign in both halves.

  IM  intraday momentum (Gao, Han, Li and Zhou, JFE 2018): the first hour's return, from the previous session's close
      to 10:30 ET, signs a position held over the last half hour (15:30 to 16:00 ET). Yahoo's one-hour regular-session
      bars for SPY and QQQ (730 days; bars start 9:30, 10:30, …, 15:30 ET). Cost: one IG in-hours spread a round trip,
      US 500 0.4 pt and US Tech 100 1 pt (facts F17; US Tech 100 from the same page), as bps at the 2026-10-08 levels
      the 2026-10-09 review used; no funding (flat before 22:00 UK).
        [arm] IM_SPY, [arm] IM_QQQ: every day.
        [arm] IM_SPY_BIG, [arm] IM_QQQ_BIG: only days whose |first-hour return| exceeds the median of the 60 days before.
  CARRY  emerging-market FX carry as rolling spot spread bets: long MXN, ZAR, HUF, PLN against USD, equal notional,
      each held only in months whose start shows its 3-month interbank rate above the US one by more than IG's fee
      (OECD MEI series via FRED, monthly, the last value known at the month's start). Daily: minus the change in
      ln(USD/xxx) plus (r_xxx - r_US - fee) / 365. Fee: IG's FX funding charge, 0.80 % a year (fact F12: 0.0022 % a day)
      and, as a second reading, 1.5 % (fact F13), the two pages disagreeing. Spread: IG's minimum spot spread a round
      trip each time a pair enters or leaves (USD/MXN 50, USD/ZAR 90, USD/HUF 20, USD/PLN 25 points; F-table of the
      forex page). Spot from Yahoo daily (USDMXN=X, USDZAR=X, USDHUF=X, USDPLN=X).
        [arm] CARRY_BASKET at 0.80 %; [arm] CARRY_BASKET at 1.5 % (reported as the same arm's second cost).
        Each pair alone is described, not tested.
  FUND  descriptive, no arm: a long US 500 DFB's funding at today's SOFR (FRED) + 3.4 % (F14), against stepping out over
      22:00 UK each day (0.6 pt a round trip at the 21:00-14:30 band, F17), and what the step-out misses: the S&P
      futures' 21:00-23:00 UK return and the weekend gap from Yahoo's hourly ES=F (the committed 730 days).
  TAX  arithmetic, no data: a spread bet's untaxed result against a CFD's under UK capital gains tax at 18 % and 24 %
      with losses allowable, for the FXW and CARRY numbers above.

Run: python3 -I docs/agents/backtests/ig_deepdive/scripts/ig_search.py [--pull]
`--pull` reads Yahoo and FRED into inputs/search/ (gzip'd answers and a log of URL, status and sha256).
Writes results/ig_search.json.
"""
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
import os
import statistics as st
import sys
import urllib.request
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "inputs", "search")
UTC = dt.timezone.utc
ET = ZoneInfo("America/New_York")
UK = ZoneInfo("Europe/London")
BPS = 1e4
UA = "Mozilla/5.0 (X11; Linux x86_64) daviesportfolios-research/1.0"
LEVEL = {"SPY": 7765.36, "QQQ": 30725.81}          # US 500 and US Tech 100 at the 2026-10-08 close (2026-10-09 review)
SPREAD_PTS = {"SPY": 0.4, "QQQ": 1.0}
YAHOO_1H = ["SPY", "QQQ"]
FX = {"MXN": ("USDMXN=X", "IR3TIB01MXM156N", 50e-4), "ZAR": ("USDZAR=X", "IR3TIB01ZAM156N", 90e-4),
      "HUF": ("USDHUF=X", "IR3TIB01HUM156N", 20e-2), "PLN": ("USDPLN=X", "IR3TIB01PLM156N", 25e-4)}
FRED = ["IR3TIB01USM156N", "SOFR"] + [v[1] for v in FX.values()]


def get(url):
    # FRED drops the connection for a browser-like agent; Yahoo wants one.
    req = urllib.request.Request(url, headers={"User-Agent": "daviesportfolios-research/1.0" if "stlouisfed" in url else UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return 200, r.read()
    except Exception as e:  # noqa: BLE001
        return getattr(e, "code", -1), b""


def pull():
    os.makedirs(OUT, exist_ok=True)
    log = []
    jobs = [(f"yahoo_1h_{s}.json.gz", f"https://query1.finance.yahoo.com/v8/finance/chart/{s}?interval=1h&range=730d") for s in YAHOO_1H]
    jobs += [(f"yahoo_1d_{v[0]}.json.gz", f"https://query1.finance.yahoo.com/v8/finance/chart/{v[0]}?interval=1d&range=max") for v in FX.values()]
    jobs += [(f"fred_{s}.csv.gz", f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={s}") for s in FRED]
    for name, url in jobs:
        status, body = get(url)
        log.append({"file": name, "url": url, "status": status, "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
                    "read_utc": dt.datetime.now(UTC).strftime("%Y-%m-%d %H:%M")})
        with gzip.GzipFile(os.path.join(OUT, name), "wb", mtime=0) as fh:
            fh.write(body)
    with open(os.path.join(OUT, "pull_log.json"), "w") as fh:
        json.dump(log, fh, indent=1)
        fh.write("\n")


def yahoo(name):
    d = json.loads(gzip.open(os.path.join(OUT, name)).read())["chart"]["result"][0]
    q = d["indicators"]["quote"][0]
    out = []
    for i, t in enumerate(d["timestamp"]):
        o, c = q["open"][i], q["close"][i]
        if o is not None and c is not None and o > 0 and c > 0:
            out.append((t, o, c))
    return out


def fred(series):
    out = {}
    for r in csv.DictReader(io.StringIO(gzip.open(os.path.join(OUT, f"fred_{series}.csv.gz")).read().decode())):
        v = r[series] if series in r else list(r.values())[1]
        if v not in ("", "."):
            out[list(r.values())[0]] = float(v) / 100
    return out


def stats(x, per_year=None):
    n = len(x)
    if n < 3:
        return {"n": n}
    m = sum(x) / n
    sd = st.stdev(x)
    h = n // 2
    out = {"n": n, "mean_bps": round(BPS * m, 3), "t": round(m / (sd / math.sqrt(n)), 2), "hit": round(sum(v > 0 for v in x) / n, 3),
           "first_half_mean_bps": round(BPS * sum(x[:h]) / h, 3), "second_half_mean_bps": round(BPS * sum(x[h:]) / (n - h), 3)}
    if per_year:
        out["annual_pct"] = round(100 * m * per_year, 2)
        out["annual_vol_pct"] = round(100 * sd * math.sqrt(per_year), 2)
        out["sharpe"] = round(m / sd * math.sqrt(per_year), 2)
        cum = peak = dd = 0.0
        for v in x:
            cum += v
            peak = max(peak, cum)
            dd = min(dd, cum - peak)
        out["max_drawdown_pct"] = round(100 * dd, 1)
    return out


# ------------------------------------------------------------------------------------------------------------------

def intraday_momentum():
    res = {}
    for sym in YAHOO_1H:
        bars = yahoo(f"yahoo_1h_{sym}.json.gz")
        days = {}
        for t, o, c in bars:
            et = dt.datetime.fromtimestamp(t, ET)
            days.setdefault(et.date(), {})[(et.hour, et.minute)] = (o, c)
        dates = sorted(d for d, b in days.items() if (9, 30) in b and (15, 30) in b)
        cost = SPREAD_PTS[sym] / LEVEL[sym]
        rows = []
        for prev, d in zip(dates, dates[1:]):
            pc = days[prev][(15, 30)][1]
            first = math.log(days[d][(9, 30)][1] / pc)
            o, c = days[d][(15, 30)]
            rows.append({"date": d.isoformat(), "first": first, "last": math.log(c / o)})
        allv = [(1 if r["first"] > 0 else -1) * r["last"] - cost for r in rows if r["first"] != 0]
        big = []
        for i, r in enumerate(rows):
            if i < 60 or r["first"] == 0:
                continue
            med = st.median(abs(x["first"]) for x in rows[i - 60:i])
            if abs(r["first"]) > med:
                big.append((1 if r["first"] > 0 else -1) * r["last"] - cost)
        xs, ys = [r["first"] for r in rows], [r["last"] for r in rows]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        slope = sum((a - mx) * (b - my) for a, b in zip(xs, ys)) / sum((a - mx) ** 2 for a in xs)
        res[sym] = {"days": len(rows), "first": rows[0]["date"], "last": rows[-1]["date"], "cost_bps": round(BPS * cost, 3),
                    "slope_last_on_first": round(slope, 4), f"IM_{sym}": stats(allv, 252), f"IM_{sym}_BIG": stats(big, 126)}
    return res


def carry():
    us = fred("IR3TIB01USM156N")
    spot = {}
    for ccy, (ysym, rate_id, spread) in FX.items():
        spot[ccy] = {dt.datetime.fromtimestamp(t, UTC).date(): c for t, o, c in yahoo(f"yahoo_1d_{ysym}.json.gz")}
    rates = {ccy: fred(FX[ccy][1]) for ccy in FX}

    def rate_at(series, d):
        """The newest monthly value for a month before d's month (what was known when d's month began)."""
        key = dt.date(d.year, d.month, 1).isoformat()
        months = [m for m in series if m < key]
        return series[max(months)] if months else None

    common = sorted(set.intersection(*(set(s) for s in spot.values())))
    common = [d for d in common if d >= dt.date(2005, 1, 1)]
    # Yahoo serves `range=max` FX history as monthly bars (stamped at each month's start, closed at its end): the unit
    # here is a calendar month, and a pair's rate is the one known when the month began.
    out = {"first": common[0].isoformat(), "last": common[-1].isoformat(), "months": len(common),
           "unit": "a calendar month: mean_bps is a month's return; annual figures scale by months a year"}
    for fee in (0.008, 0.015):
        daily, per_pair = [], {c: [] for c in FX}
        held = {c: False for c in FX}
        for d0, d1 in zip(common, common[1:]):
            tot, n = 0.0, 0
            for ccy, (ysym, rid, spread) in FX.items():
                r_x, r_u = rate_at(rates[ccy], d1), rate_at(us, d1)
                want = r_x is not None and r_u is not None and r_x - r_u > fee
                ret = 0.0
                if want != held[ccy]:
                    ret -= spread / spot[ccy][d0]          # a round trip's spread charged at each entry or exit
                    held[ccy] = want
                if want:
                    days = (d1 - d0).days
                    ret += -math.log(spot[ccy][d1] / spot[ccy][d0]) + (r_x - r_u - fee) * days / 365
                    per_pair[ccy].append(ret)
                    tot += ret
                    n += 1
            daily.append(tot / len(FX))
        key = f"fee_{fee * 100:g}pct"
        years = (common[-1] - common[0]).days / 365.25
        out[key] = {"CARRY_BASKET": stats(daily, len(daily) / years),
                    "since_2015": stats([v for d, v in zip(common[1:], daily) if d >= dt.date(2015, 1, 1)], len(daily) / years),
                    "per_pair_described": {c: stats(v, len(v) / years) for c, v in per_pair.items()}}
        # Worst calendar months of the basket.
        months = {}
        for d, v in zip(common[1:], daily):
            months[d.strftime("%Y-%m")] = months.get(d.strftime("%Y-%m"), 0.0) + v
        out[key]["worst_months_pct"] = sorted(((k, round(100 * v, 2)) for k, v in months.items()), key=lambda kv: kv[1])[:6]
    last = {c: (rate_at(rates[c], common[-1]), rate_at(us, common[-1])) for c in FX}
    out["latest_differentials_pct"] = {c: round(100 * (a - b), 2) if a is not None and b is not None else None for c, (a, b) in last.items()}
    return out


def funding():
    sofr = fred("SOFR")
    latest = max(sofr)
    rate = sofr[latest]
    long_carry = rate + 0.034
    step_out = 0.6 / LEVEL["SPY"] * 252
    es = []
    import gzip as _g
    with _g.open(os.path.join(BT, "ig_research", "inputs", "yahoo_1h", "ES=F.csv.gz"), "rt") as fh:
        for r in csv.DictReader(fh):
            try:
                es.append((int(r["t"]), float(r["open"]), float(r["close"])))
            except (TypeError, ValueError):
                continue
    es.sort()
    by_uk = [(dt.datetime.fromtimestamp(t, UK), o, c) for t, o, c in es]
    eve, wk = [], []
    for i in range(1, len(by_uk)):
        a, b = by_uk[i - 1], by_uk[i]
        if a[0].weekday() < 4 and a[0].hour == 21 and b[0].hour == 23 and b[0].date() == a[0].date():
            eve.append(math.log(b[1] / a[1]))               # 21:00 UK bar's open to the 23:00 bar's open: the step-out's hours
        if a[0].weekday() == 4 and b[0].weekday() == 6:
            wk.append(math.log(b[1] / a[2]))                # Friday's last bar close to Sunday's first open
    return {"sofr_latest": [latest, round(100 * rate, 3)], "long_dfb_funding_pct_a_year": round(100 * long_carry, 2),
            "step_out_cost_pct_a_year": round(100 * step_out, 2),
            "missed_2100_2300_uk_weekday_bps": stats(eve), "missed_weekend_gap_bps": stats(wk),
            "note": "a cost comparison for holding index beta on a DFB, not an edge; needing two dealt trades a day, it falls under Term 9(12)'s consent (F39) if automated"}


def tax(res_fxw_bps_per_trade=14.88, trades_per_year=7.93):
    out = {}
    for name, gross_pct in (("FXW at 20 bps, a year of notional", res_fxw_bps_per_trade * trades_per_year / 100),):
        for rate in (0.18, 0.24):
            out[f"{name}, CGT {int(rate * 100)} %"] = {"spread_bet_net_pct": round(gross_pct, 2), "cfd_net_pct_if_gains_taxed": round(gross_pct * (1 - rate), 2)}
    out["note"] = ("a spread bet's gain is untaxed and its loss unrelievable (F31, F33); a CFD's gain is taxed and its loss "
                   "allowable; Irish s.613(2) reads the same for betting winnings (F35); whether systematic betting is a "
                   "trade (F34) and which country taxes Davies are for an adviser")
    return out


def main():
    if "--pull" in sys.argv:
        pull()
    out = {"IM": intraday_momentum(), "CARRY": carry(), "FUND": funding(), "TAX": tax()}
    with open(os.path.join(HERE, "results", "ig_search.json"), "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True, default=str)
        fh.write("\n")
    print(json.dumps(out, indent=1, default=str)[:6000])


if __name__ == "__main__":
    main()
