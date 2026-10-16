"""The IG strategy search: every family of params/frozen.json, scored at IG's costs on two eras and two sources.

Reads only inputs/ (scripts/pull.py writes it) and the committed inputs of sibling studies (Cboe VIX futures and the
Yahoo hourly ES=F of ig_research, the FXCM fix table of statarb_search2). Writes results/search.json (deterministic).
Run from the repository root: python3 -I docs/agents/backtests/ig_search/scripts/search.py
"""
import csv
import datetime as dt
import gzip
import json
import math
import os
import random
import statistics as st
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BT = os.path.dirname(HERE)
INP = os.path.join(HERE, "inputs")
P = json.load(open(os.path.join(HERE, "params", "frozen.json")))
C = P["ig_costs"]
SP = C["spreads_points"]
ET = ZoneInfo("America/New_York")
LON = ZoneInfo("Europe/London")
BPS = 1e4
SEED = P["bar"]["bootstrap"]["seed"]
DRAWS = P["bar"]["bootstrap"]["draws"]


# ------------------------------------------------------------------------------------------------------------------
# Statistics

def boot95(x):
    x = list(x)
    n = len(x)
    if n < 3:
        return None
    rng = random.Random(SEED)
    means = sorted(sum(x[rng.randrange(n)] for _ in range(n)) / n for _ in range(DRAWS))
    return [round(BPS * means[int(0.025 * DRAWS)], 2), round(BPS * means[int(0.975 * DRAWS) - 1], 2)]


def stats(x, per_year=None):
    """x: per-trade (or per-month) returns as fractions of notional."""
    x = [float(v) for v in x if v is not None and not math.isnan(v)]
    n = len(x)
    if n < 3:
        return {"n": n}
    m = sum(x) / n
    sd = st.stdev(x)
    cum = peak = dd = 0.0
    for v in x:
        cum += v
        peak = max(peak, cum)
        dd = min(dd, cum - peak)
    out = {"n": n, "mean_bps": round(BPS * m, 2), "t": round(m / (sd / math.sqrt(n)), 2) if sd else None,
           "boot95_bps": boot95(x), "hit": round(sum(v > 0 for v in x) / n, 3), "worst_bps": round(BPS * min(x), 1),
           "max_drawdown_pct": round(100 * dd, 2)}
    if per_year:
        out["per_year"] = round(per_year, 2)
        out["annual_pct"] = round(100 * m * per_year, 2)
        out["annual_vol_pct"] = round(100 * sd * math.sqrt(per_year), 2)
        out["sharpe"] = round(m / sd * math.sqrt(per_year), 2) if sd else None
    return out


def eras_of(name):
    for dv in P.get("deviations", []):
        if name in dv.get("eras", {}):
            return dv["eras"][name]
    e = P["families"][name].get("eras", "default")
    if isinstance(e, dict) and "train" in e:
        return e
    return P["eras"]["default"]


ROWS = {}


def monthly_sums(rows):
    m = {}
    for d, r in rows:
        m[d[:7]] = m.get(d[:7], 0.0) + r
    return sorted(m.items())


def split(rows, era, name=None):
    """rows: list of (date_str, value). Returns stats per era with per-year from the era's span. With a name, the arm's
    monthly sums (at one unit of notional) are kept for the portfolio step."""
    if name:
        ROWS[name] = monthly_sums(rows)
    out = {}
    for nm in ("train", "test"):
        a, b = era[nm]
        v = [r for d, r in rows if a <= d <= b]
        if not v:
            out[nm] = {"n": 0}
            continue
        ds = [d for d, r in rows if a <= d <= b]
        yrs = max((dt.date.fromisoformat(max(ds)) - dt.date.fromisoformat(min(ds))).days / 365.25, 0.5)
        out[nm] = {**stats(v, len(v) / yrs), "from": min(ds), "to": max(ds)}
    return out


def verdict(res):
    tr, te = res.get("train", {}), res.get("test", {})
    ok = (te.get("n", 0) >= 10 and te.get("mean_bps", -1) > 0 and (te.get("t") or 0) >= 2.5 and (te.get("boot95_bps") or [-1])[0] > 0
          and tr.get("mean_bps", -1) > 0 and (tr.get("t") or 0) >= 2.0)
    return "candidate" if ok else "fails the bar"


# ------------------------------------------------------------------------------------------------------------------
# Data

def daily():
    df = pd.read_csv(os.path.join(INP, "daily.csv.gz"), index_col="date", parse_dates=True)
    return df.sort_index()


def rate(df, name, fallback):
    """A short rate as a daily fraction a year, forward-filled; monthly series stand for their month."""
    s = df[name].dropna() / 100 if name in df else pd.Series(dtype=float)
    if s.empty:
        return pd.Series(fallback, index=df.index)
    return s.reindex(df.index).ffill().fillna(fallback)


def bps_spread(m):
    s = SP[m]
    if "spread_pips" in s:
        pip = s.get("pip", 0.0001)
        return BPS * s["spread_pips"] * pip / s["level"]
    if "spread_points" in s:
        return BPS * s["spread_points"] * s.get("point", 1) / s["level"]
    return BPS * s["in_hours"] / s["level"]


def min_notional_gbp(m):
    s = SP[m]
    if "min_stake_gbp_per_pip" in s:
        return s["min_stake_gbp_per_pip"] * s["level"] / s.get("pip", 0.0001)
    return s["min_stake_gbp_per_point"] * s["level"] / s.get("point", 1)


ADMIN = {"US500": C["index_dfb"]["admin_fee_sb"], "UK100": C["index_dfb"]["admin_fee_sb"], "DE40": C["index_dfb"]["admin_fee_sb"],
         "JP225": C["index_dfb"]["admin_fee_sb"], "EURUSD": C["fx_dfb"]["admin_fee"], "GBPUSD": C["fx_dfb"]["admin_fee"],
         "USDJPY": C["fx_dfb"]["admin_fee"], "AUDUSD": C["fx_dfb"]["admin_fee"], "GOLD": C["spot_gold_silver"]["admin_fee"],
         "WTI": C["commodity_undated"]["admin_fee"], "UST10": C["bonds"]["admin_fee"]}


def excess_returns(df, source):
    """Daily excess log returns per market (the return of a funded position before IG's admin fee and spread)."""
    us = rate(df, "F:DTB3", 0.02)
    gb = rate(df, "F:IUDSOIA", np.nan).fillna(rate(df, "F:IR3TIB01GBM156N", 0.04))
    ez = rate(df, "F:IR3TIB01EZM156N", 0.02)
    jp = rate(df, "F:IR3TIB01JPM156N", 0.002)
    au = rate(df, "F:IR3TIB01AUM156N", 0.04)
    if source == "A":
        px = {"US500": "Y:^GSPC", "UK100": "Y:^FTSE", "DE40": "Y:^GDAXI", "JP225": "Y:^N225", "EURUSD": "Y:EURUSD=X",
              "GBPUSD": "Y:GBPUSD=X", "USDJPY": "Y:JPY=X", "AUDUSD": "Y:AUDUSD=X", "GOLD": "Y:GC=F", "WTI": "Y:CL=F", "UST10": "Y:^TNX"}
    else:
        px = {"US500": "D:USA500IDXUSD", "UK100": "D:GBRIDXGBP", "DE40": "D:DEUIDXEUR", "JP225": "D:JPNIDXJPY", "EURUSD": "F:DEXUSEU",
              "GBPUSD": "F:DEXUSUK", "USDJPY": "F:DEXJPUS", "AUDUSD": "F:DEXUSAL", "GOLD": "D:XAUUSD", "WTI": "F:DCOILWTICO", "UST10": "F:DGS10"}
    div = {"US500": 0.02, "UK100": 0.035, "DE40": 0.0, "JP225": 0.02}
    loc = {"US500": us, "UK100": gb, "DE40": ez, "JP225": jp}
    out = {}
    for m, col in px.items():
        if col not in df:
            continue
        p = df[col].dropna()
        p = p[p > 0]
        if len(p) < 300:
            continue
        days = p.index.to_series().diff().dt.days.fillna(1).clip(upper=5)
        if m == "UST10":
            y = p / 100
            r = -8 * y.diff() + (y.shift(1) - us.reindex(p.index)) * days / 365
        else:
            r = np.log(p / p.shift(1))
            if m == "WTI":
                r = r.clip(-0.4, 0.4)
            if m in div:
                r = r + (div[m] - loc[m].reindex(p.index)) * days / 365
            elif m in ("EURUSD", "GBPUSD", "AUDUSD"):
                f = {"EURUSD": ez, "GBPUSD": gb, "AUDUSD": au}[m]
                r = r + (f.reindex(p.index) - us.reindex(p.index)) * days / 365
            elif m == "USDJPY":
                r = r + (us.reindex(p.index) - jp.reindex(p.index)) * days / 365
            else:
                r = r - us.reindex(p.index) * days / 365
        # A gap of more than a week (a source's missing year: Dukascopy's throttle left holes) is not one day's return.
        gap = p.index.to_series().diff().dt.days
        r = r[gap <= 7]
        out[m] = r.dropna()
    return out


# ------------------------------------------------------------------------------------------------------------------
# Families

def tsmom(df):
    res = {}
    for source in ("A", "B"):
        ex = excess_returns(df, source)
        for variant in ("TS12", "ENS"):
            monthly = {}           # month -> list of (market, net return)
            gross_monthly = {}     # the same before IG's spread and admin fee: what the costs take
            per_market = {m: [] for m in ex}
            flips = {m: 0 for m in ex}
            for m, r in ex.items():
                ends = r.groupby(r.index.to_period("M")).apply(lambda s: s.index[-1])
                pos_prev = 0.0
                for i in range(len(ends) - 1):
                    t0, t1 = ends.iloc[i], ends.iloc[i + 1]
                    hist = r[:t0]
                    if len(hist) < 260:
                        continue
                    sig = np.sign(hist.iloc[-252:].sum()) if variant == "TS12" else np.mean([np.sign(hist.iloc[-k:].sum()) for k in (21, 63, 252)])
                    vol = hist.iloc[-60:].std() * math.sqrt(252)
                    pos = float(sig * min(2.0, 0.10 / vol)) if vol > 0 else 0.0
                    nxt = r[t0:t1].iloc[1:]
                    gross = pos * nxt.sum()
                    days = (t1 - t0).days
                    cost = bps_spread(m) / 2 / BPS * abs(pos - pos_prev) + ADMIN[m] * abs(pos) * days / 365
                    gross_monthly.setdefault(str(t1.to_period("M")), []).append(gross)
                    if np.sign(pos) != np.sign(pos_prev) and pos != 0:
                        flips[m] += 1
                    pos_prev = pos
                    key = str(t1.to_period("M"))
                    monthly.setdefault(key, []).append(gross - cost)
                    per_market[m].append((t1.date().isoformat(), gross - cost))
            rows = [(k + "-28", float(np.mean(v))) for k, v in sorted(monthly.items())]
            era = eras_of("TSMOM")
            port = split(rows, era, "TSMOM_" + source + "_" + variant)
            res[f"{source}_{variant}"] = {
                "portfolio_monthly": port, "verdict": verdict(port),
                "markets": {m: {**split(v, era), "sign_flips": flips[m]} for m, v in per_market.items() if v},
                "markets_used": sorted(m for m, v in per_market.items() if v),
                "portfolio_monthly_before_ig_costs": split([(k + "-28", float(np.mean(v))) for k, v in sorted(gross_monthly.items())], era),
            }
            # The same without IG's admin fee and spreads: what the costs take.
            res[f"{source}_{variant}"]["note"] = "monthly portfolio returns, equal risk (10 % a market before averaging), net of IG spread and admin fee"
    # Typical position (median |10 % / sigma60| over the test era) per market: what a unit of capital holds.
    ex = excess_returns(df, "A")
    res["typical_abs_position_test"] = {}
    for m, r in ex.items():
        v = (r.rolling(60).std() * math.sqrt(252)).dropna()
        v = v[v.index >= pd.Timestamp(eras_of("TSMOM")["test"][0])]
        if len(v):
            res["typical_abs_position_test"][m] = round(float(np.median(np.minimum(2.0, 0.10 / v))), 3)
    # Cross-source check: daily excess-return correlation where both sources overlap.
    a, b = excess_returns(df, "A"), excess_returns(df, "B")
    res["source_correlation_daily"] = {m: round(float(pd.concat([a[m], b[m]], axis=1, sort=True).dropna().corr().iloc[0, 1]), 3)
                                       for m in a if m in b and len(pd.concat([a[m], b[m]], axis=1, sort=True).dropna()) > 250}
    return res


def us_rate(df):
    return rate(df, "F:DTB3", 0.02)


def event_window(px, days, entry_offset, exit_offset):
    """Close-to-close windows around event days: entry at the close `entry_offset` trading days from the event, exit at
    `exit_offset`. Returns list of (event date, log return, calendar days held)."""
    idx = px.index
    out = []
    for d in days:
        i = idx.searchsorted(pd.Timestamp(d))
        if i >= len(idx) or idx[i].date().isoformat() != d:
            continue
        a, b = i + entry_offset, i + exit_offset
        if a < 0 or b >= len(idx):
            continue
        out.append((d, math.log(px.iloc[b] / px.iloc[a]), (idx[b] - idx[a]).days))
    return out


def prefomc(df):
    days = json.load(open(os.path.join(INP, "fomc_dates.json")))
    era = eras_of("PREFOMC")
    us = us_rate(df)
    res = {"fomc_days": len(days)}
    for src, col in (("A", "Y:^GSPC"), ("B_dukascopy", "D:USA500IDXUSD"), ("B_fred", "F:SP500")):
        if col not in df:
            res[src] = {"not_available": col}
            continue
        px = df[col].dropna()
        rows = []
        for d, r, nights in event_window(px, days, -1, 0):
            cost = bps_spread("US500") / BPS + (us.get(pd.Timestamp(d), 0.03) + ADMIN["US500"]) * nights / 360 - 0.02 * nights / 365
            rows.append((d, r - cost))
        res[src] = split(rows, era, "PREFOMC_" + src)
        res[src]["verdict"] = verdict(res[src])
    return res


def month_days(px):
    """Per calendar month: the trading-day index positions."""
    g = {}
    for i, d in enumerate(px.index):
        g.setdefault((d.year, d.month), []).append(i)
    return g


def tom(df):
    era = eras_of("TOM")
    res = {}
    mk = {"US500": ("Y:^GSPC", "D:USA500IDXUSD", "F:DTB3", 0.02, 360), "UK100": ("Y:^FTSE", "D:GBRIDXGBP", "F:IUDSOIA", 0.035, 365),
          "DE40": ("Y:^GDAXI", "D:DEUIDXEUR", "F:IR3TIB01EZM156N", 0.0, 360)}
    for m, (ca, cb, rcol, dy, div_) in mk.items():
        r_loc = rate(df, rcol, 0.03)
        for src, col in (("A", ca), ("B", cb)):
            if col not in df:
                res[f"{m}_{src}"] = {"not_available": col}
                continue
            px = df[col].dropna()
            px = px[px > 0]
            g = month_days(px)
            keys = sorted(g)
            rows = []
            for k0, k1 in zip(keys, keys[1:]):
                a, b = g[k0], g[k1]
                if len(a) < 3 or len(b) < 4:
                    continue
                ia, ib = a[-2], b[2]
                ret = math.log(px.iloc[ib] / px.iloc[ia])
                nights = (px.index[ib] - px.index[ia]).days
                cost = bps_spread(m) / BPS + (r_loc.get(px.index[ia], 0.03) + ADMIN[m]) * nights / div_ - dy * nights / 365
                rows.append((px.index[ib].date().isoformat(), ret - cost))
            res[f"{m}_{src}"] = split(rows, era, f"TOM_{m}_{src}")
            res[f"{m}_{src}"]["verdict"] = verdict(res[f"{m}_{src}"])
    return res


def overnight(df):
    era = eras_of("OVERNIGHT")
    us = us_rate(df)
    res = {}
    for name in ("SPY", "QQQ"):
        o, c = df[f"Y:{name}:open"].dropna(), df[f"Y:{name}"].dropna()
        both = pd.concat([o, c], axis=1, keys=["o", "c"]).dropna()
        on, idn = [], []
        for i in range(1, len(both)):
            d0, d1 = both.index[i - 1], both.index[i]
            nights = (d1 - d0).days
            fund = (us.get(d0, 0.03) + ADMIN["US500"]) * nights / 360 - 0.013 * nights / 365
            on.append((d1.date().isoformat(), math.log(both.o.iloc[i] / both.c.iloc[i - 1]) - bps_spread("US500") / BPS - fund))
            idn.append((d1.date().isoformat(), math.log(both.c.iloc[i] / both.o.iloc[i]) - bps_spread("US500") / BPS))
        res[f"{name}_overnight"] = split(on, era, f"OVERNIGHT_{name}")
        res[f"{name}_overnight"]["verdict"] = verdict(res[f"{name}_overnight"])
        res[f"{name}_intraday"] = split(idn, era)
    return res


def fx_events():
    ev = {}
    with gzip.open(os.path.join(INP, "fx_events.csv.gz"), "rt") as fh:
        for r in csv.DictReader(fh):
            d, hm = r["london"][:10], r["london"][11:16]
            # The mid: a bid alone carries the spread's widening at the 22:00 UK rollover into the 23:00 and 00:00 legs.
            ev.setdefault(r["pair"], {}).setdefault(d, {})[hm] = (float(r["bid_open"]) + float(r["ask_open"])) / 2
    return ev


PAIR_IDX = {"EURUSD": ("Y:^GDAXI", 1), "GBPUSD": ("Y:^FTSE", 1), "USDJPY": ("Y:^N225", -1), "AUDUSD": ("Y:^AXJO", 1)}
PAIR_COST = {"EURUSD": "EURUSD", "GBPUSD": "GBPUSD", "USDJPY": "USDJPY", "AUDUSD": "AUDUSD"}


def monthend_fix(df):
    era = eras_of("MONTHEND_FIX")
    ev = fx_events()
    spx = df["Y:^GSPC"].dropna()
    res = {}
    fxcm = {}
    for pair in PAIR_IDX:
        p = os.path.join(BT, "statarb_search2", "inputs", "fx", f"fxcm_{pair}_fix.csv.gz")
        if os.path.exists(p):
            with gzip.open(p, "rt") as fh:
                fxcm[pair] = {r["date"]: r for r in csv.DictReader(fh)}
    for pair, (icol, orient) in PAIR_IDX.items():
        foreign = df[icol].dropna()
        days = sorted(ev.get(pair, {}))
        by_month = {}
        for d in days:
            if dt.date.fromisoformat(d).weekday() < 5:
                by_month.setdefault(d[:7], []).append(d)
        rows_a, rows_b = [], []
        for mth, ds in sorted(by_month.items()):
            d = ds[-1]
            t = pd.Timestamp(d)
            # Month-to-date to the previous close: from the last close of the previous month.
            def mtd(px):
                before = px[px.index < t]
                prev_month = before[before.index < pd.Timestamp(mth + "-01")]
                if before.empty or prev_month.empty:
                    return None
                return math.log(before.iloc[-1] / prev_month.iloc[-1])
            u, f = mtd(spx), mtd(foreign)
            if u is None or f is None:
                continue
            buy_foreign = u > f
            s = (1 if buy_foreign else -1) * orient
            cost = bps_spread(PAIR_COST[pair]) / BPS
            e = ev[pair][d]
            if "14:00" in e and "16:00" in e:
                rows_a.append((d, s * math.log(e["16:00"] / e["14:00"]) - cost))
            fx = fxcm.get(pair, {}).get(d)
            if fx and fx.get("l1400") and fx.get("l1600"):
                rows_b.append((d, s * math.log(float(fx["l1600"]) / float(fx["l1400"])) - cost))
        res[f"{pair}_A_fxcm_h1"] = split(rows_a, era, f"MONTHEND_{pair}_A")
        res[f"{pair}_A_fxcm_h1"]["verdict"] = verdict(res[f"{pair}_A_fxcm_h1"])
        res[f"{pair}_B_fxcm"] = split(rows_b, era, f"MONTHEND_{pair}_B")
    pooled = []
    for pair in PAIR_IDX:
        pass
    return res


def seasonal(df):
    era = eras_of("SEASONAL")
    us = us_rate(df)
    res = {}
    for name, months, srcs, admin in (("GOLD_SEP_NOV", (9, 11), (("A", "Y:GC=F"), ("B", "D:XAUUSD")), ADMIN["GOLD"]),
                                      ("WTI_MAR_APR", ((3, 4),), (("A", "Y:CL=F"), ("B", "F:DCOILWTICO")), ADMIN["WTI"])):
        for src, col in srcs:
            if col not in df:
                res[f"{name}_{src}"] = {"not_available": col}
                continue
            px = df[col].dropna()
            px = px[px > 0]
            g = month_days(px)
            keys = sorted(g)
            rows = []
            for k in keys:
                for mm in months:
                    first, last = (mm, mm) if isinstance(mm, int) else mm
                    if k[1] != first:
                        continue
                    prev = (k[0], first - 1) if first > 1 else (k[0] - 1, 12)
                    endk = (k[0], last)
                    if prev not in g or endk not in g:
                        continue
                    ia, ib = g[prev][-1], g[endk][-1]
                    nights = (px.index[ib] - px.index[ia]).days
                    r = math.log(px.iloc[ib] / px.iloc[ia]) - (us.get(px.index[ia], 0.02) + admin) * nights / 365
                    rows.append((px.index[ib].date().isoformat(), r - bps_spread("GOLD" if "GOLD" in name else "WTI") / BPS))
            res[f"{name}_{src}"] = split(rows, era, f"{name}_{src}")
            res[f"{name}_{src}"]["verdict"] = verdict(res[f"{name}_{src}"])
    return res


def session():
    era = eras_of("SESSION")
    ev = fx_events()
    legs = {"EURUSD": ("07:00", "12:00", -1, 0), "GBPUSD": ("07:00", "12:00", -1, 0), "USDJPY": ("00:00", "06:00", 1, 0),
            "AUDUSD": ("23:00", "05:00", -1, 1)}
    res = {}
    for pair, (t0, t1, side, prev_day) in legs.items():
        days = sorted(ev.get(pair, {}))
        rows = []
        for i, d in enumerate(days):
            if dt.date.fromisoformat(d).weekday() >= 5:
                continue
            if prev_day:
                if i == 0:
                    continue
                d0 = days[i - 1]
                if (dt.date.fromisoformat(d) - dt.date.fromisoformat(d0)).days != 1:
                    continue
                a, b = ev[pair][d0].get(t0), ev[pair][d].get(t1)
            else:
                a, b = ev[pair][d].get(t0), ev[pair][d].get(t1)
            if a and b:
                rows.append((d, side * math.log(b / a) - bps_spread(pair) / BPS))
        res[pair] = split(rows, era, f"SESSION_{pair}")
        res[pair]["verdict"] = verdict(res[pair])
    return res


def monday_gap(df):
    """Deviation 2: Yahoo's hourly ES=F (2024-05 on) only, so one era and a descriptive result."""
    cost = (0.3 + 0.2) / SP["US500"]["level"]
    es = []
    with gzip.open(os.path.join(BT, "ig_research", "inputs", "yahoo_1h", "ES=F.csv.gz"), "rt") as fh:
        for r in csv.DictReader(fh):
            try:
                es.append((dt.datetime.fromtimestamp(int(r["t"]), ET), float(r["open"]), float(r["close"]), float(r["low"]), float(r["high"])))
            except (TypeError, ValueError, KeyError):
                continue
    es.sort()
    res = {"source": "Yahoo ES=F hourly, ig_research/inputs/yahoo_1h", "verdict": "not run, coverage (one era, deviation 2)"}
    for thr in (0.0025, 0.005, 0.0075):
        esg, fill = [], []
        for i in range(1, len(es)):
            a, b = es[i - 1], es[i]
            if not (a[0].weekday() == 4 and b[0].weekday() == 6):
                continue
            g = math.log(b[1] / a[2])
            if abs(g) < thr:
                continue
            side = -1 if g > 0 else 1
            mon = b[0].date() + dt.timedelta(days=1)
            path = [x for x in es[i:] if x[0] < dt.datetime(mon.year, mon.month, mon.day, 16, 0, tzinfo=ET)]
            x16 = next((x for x in es[i:] if x[0].date() == mon and x[0].hour >= 16), None)
            if not x16:
                continue
            esg.append(side * math.log(x16[1] / b[1]) - cost)
            exitp = x16[1]
            for x in path:
                if (side > 0 and x[4] >= a[2]) or (side < 0 and x[3] <= a[2]):
                    exitp = a[2]
                    break
            fill.append(side * math.log(exitp / b[1]) - cost)
        res[f"ESG_{thr * 100:g}pct"] = stats(esg)
        res[f"FILL_{thr * 100:g}pct"] = stats(fill)
    return res


def vix_carry(df):
    era = eras_of("VIX_CARRY")
    rows = list(csv.DictReader(gzip.open(os.path.join(BT, "ig_research", "inputs", "cboe", "VX_monthly.csv.gz"), "rt")))
    book = {}
    for r in rows:
        book.setdefault(r["trade_date"], {})[r["expiry"]] = (float(r["settle"]), float(r["high"] or 0))
    days = sorted(book)
    expiries = sorted({r["expiry"] for r in rows})
    res = {}
    for src, spot in (("A_cboe", None), ("B_fred", "F:VIXCLS")):
        if spot:
            vix = {d.date().isoformat(): v for d, v in df[spot].dropna().items()}
        else:
            vix = {}
            for r in csv.DictReader(gzip.open(os.path.join(BT, "ig_research", "inputs", "cboe", "VIX.csv.gz"), "rt")):
                m, d, y = r["DATE"].split("/")
                try:
                    vix[f"{y}-{m}-{d}"] = float(r["CLOSE"])
                except (KeyError, ValueError):
                    pass
        cycles = []
        cur = entry = None
        on = stopped = False
        acc = 0.0
        start = None
        for i in range(1, len(days)):
            d0, d1 = days[i - 1], days[i]
            import bisect
            left = bisect.bisect_right(days, d0)
            cands = [e for e in expiries if e > d0 and bisect.bisect_right(days, e) - left > 5 and e in book[d0]]
            if not cands:
                continue
            e = cands[0]
            if e != cur:
                if on and start:
                    cycles.append((start, acc))
                cur, entry = e, book[d0][e][0]
                v = vix.get(d0)
                on = bool(v) and entry / v >= 1.05 and v < 20
                stopped, acc, start = False, 0.0, d0
                if on:
                    acc -= 0.1 / entry
            if not on or stopped or e not in book[d1]:
                continue
            prev = book[d0][e][0]
            settle, high = book[d1][e]
            lvl = entry * 1.5
            if (high > 0 and high >= lvl) or (high == 0 and settle >= lvl):
                acc += (-(lvl - prev) - 0.2 - 0.1) / entry
                stopped = True
            else:
                acc += -(settle - prev) / entry
        if on and start:
            cycles.append((start, acc))
        # Notional is 10 % of capital: a cycle's return on capital is a tenth of its return on notional.
        res[src] = split([(d, 0.1 * r) for d, r in cycles], era, "VIX_CARRY_" + src)
        res[src]["verdict"] = verdict(res[src])
        res[src]["note"] = "per cycle, on capital at 10 % notional; guaranteed stop at +50 % with a 0.2-point premium"
    return res


def cot_contra(df):
    era = eras_of("CROSS")["COT_CONTRA"] if isinstance(eras_of("CROSS"), dict) and "COT_CONTRA" in eras_of("CROSS") else P["families"]["CROSS"]["eras"]["COT_CONTRA"]
    rows = list(csv.DictReader(gzip.open(os.path.join(INP, "cot.csv.gz"), "rt")))
    mk = {"GOLD": (("A", "Y:GC=F"), ("B", "D:XAUUSD")), "WTI": (("A", "Y:CL=F"), ("B", "F:DCOILWTICO")),
          "SP500_EMINI": (("A", "Y:^GSPC"), ("B", "D:USA500IDXUSD")), "UST10": (("A", "Y:^TNX"), ("B", "F:DGS10")),
          "EUR": (("A", "Y:EURUSD=X"), ("B", "F:DEXUSEU")), "JPY": (("A", "Y:JPY=X"), ("B", "F:DEXJPUS"))}
    cost_m = {"GOLD": "GOLD", "WTI": "WTI", "SP500_EMINI": "US500", "UST10": "UST10", "EUR": "EURUSD", "JPY": "USDJPY"}
    res = {}
    for src in ("A", "B"):
        allrows = []
        for name, srcs in mk.items():
            col = dict(srcs)[src]
            if col not in df:  # noqa: SIM102
                continue
            px = df[col].dropna()
            px = px[px > 0]
            r = [x for x in rows if x["market"] == name]
            r.sort(key=lambda x: x["date"])
            share = []
            for x in r:
                try:
                    oi = float(x["oi"])
                    share.append((x["date"], (float(x["nc_long"]) - float(x["nc_short"])) / oi if oi else None))
                except ValueError:
                    continue
            for i in range(156, len(share)):
                d, s = share[i]
                hist = [v for _, v in share[i - 156:i] if v is not None]
                if s is None or len(hist) < 100:
                    continue
                pct = sum(v < s for v in hist) / len(hist)
                if 0.1 <= pct <= 0.9:
                    continue
                side = -1 if pct > 0.9 else 1
                # Futures long JPY = short USD/JPY; a long note future = falling yield.
                if name == "JPY":
                    side = -side
                fri = pd.Timestamp(d) + pd.Timedelta(days=3)
                j = px.index.searchsorted(fri)
                k = j + 20
                if k >= len(px) or (px.index[k] - px.index[j]).days > 40:
                    continue        # 20 trading days that span a hole in the source are not four weeks
                if name == "UST10":
                    y0, y1 = px.iloc[j] / 100, px.iloc[k] / 100
                    ret = -8 * (y1 - y0)
                else:
                    ret = math.log(px.iloc[k] / px.iloc[j])
                nights = (px.index[k] - px.index[j]).days
                cost = bps_spread(cost_m[name]) / BPS + ADMIN[cost_m[name]] * nights / 365
                allrows.append((px.index[k].date().isoformat(), side * ret - cost))
        allrows.sort()
        res[src] = split(allrows, era, "COT_CONTRA_" + src)
        res[src]["verdict"] = verdict(res[src])
        res[src]["note"] = "every extreme week opens a 4-week trade (overlapping trades counted each); funding as excess over the rate is not modelled"
    return res


def real_yield_gold(df):
    era = P["families"]["CROSS"]["eras"]["REAL_YIELD_GOLD"]
    ry = df["F:DFII10"].dropna()
    us = us_rate(df)
    res = {}
    for src, col in (("A", "Y:GC=F"), ("B", "D:XAUUSD")):
        if col not in df:
            res[src] = {"not_available": col}
            continue
        px = df[col].dropna()
        px = px[px > 0]
        ends = px.groupby(px.index.to_period("M")).apply(lambda s: s.index[-1])
        rows = []
        for i in range(3, len(ends) - 1):
            t0, t1 = ends.iloc[i], ends.iloc[i + 1]
            a = ry[:t0]
            b = ry[:ends.iloc[i - 3]]
            if a.empty or b.empty or (t1 - t0).days > 35:
                continue            # a month that spans a hole in the source is not a month
            side = 1 if a.iloc[-1] - b.iloc[-1] < 0 else -1
            nights = (t1 - t0).days
            r = math.log(px[t1] / px[t0]) - us.get(t0, 0.02) * nights / 365
            rows.append((t1.date().isoformat(), side * r - ADMIN["GOLD"] * nights / 365 - bps_spread("GOLD") / BPS))
        res[src] = split(rows, era, "REAL_YIELD_GOLD_" + src)
        res[src]["verdict"] = verdict(res[src])
    return res


def credit_equity(df):
    era = eras_of("TSMOM")
    spread = (df["F:DBAA"] - df["F:DGS10"]).dropna()
    avg = spread.rolling(126).mean()
    ex = excess_returns(df, "A")["US500"]
    res = {}
    sig = (spread < avg).reindex(ex.index).ffill().shift(1)
    timed, always = [], []
    prev = False
    for d, r in ex.items():
        s = sig.get(d)
        if s is None or isinstance(s, float) and math.isnan(s):
            continue
        cost = ADMIN["US500"] / 252
        always.append((d.date().isoformat(), r - cost))
        tr = bps_spread("US500") / 2 / BPS if bool(s) != prev else 0.0
        timed.append((d.date().isoformat(), (r - cost if s else 0.0) - tr))
        prev = bool(s)
    # Monthly sums, so the statistics read months, not days.
    def monthly(rows):
        m = {}
        for d, r in rows:
            m[d[:7]] = m.get(d[:7], 0.0) + r
        return [(k + "-28", v) for k, v in sorted(m.items())]
    res["timed_monthly"] = split(monthly(timed), era, "CREDIT_EQUITY_timed")
    res["always_long_monthly"] = split(monthly(always), era)
    res["timed_minus_always_monthly"] = split([(a[0], a[1] - b[1]) for a, b in zip(monthly(timed), monthly(always))], era)
    res["verdict"] = verdict(res["timed_minus_always_monthly"])
    return res


def selftest():
    """Closed-form checks of the helpers every family uses."""
    x = [0.001, 0.003, -0.001, 0.001]
    s = stats(x)
    assert s["n"] == 4 and s["mean_bps"] == 10.0 and s["worst_bps"] == -10.0 and s["hit"] == 0.75
    assert abs(s["t"] - round(0.001 / (st.stdev(x) / 2), 2)) < 1e-9
    assert round(bps_spread("US500"), 4) == round(1e4 * 0.4 / 6700, 4)
    assert round(bps_spread("USDJPY"), 4) == round(1e4 * 0.94 * 0.01 / 150, 4)
    assert round(min_notional_gbp("US500")) == 6700 and round(min_notional_gbp("EURUSD")) == 5800
    idx = pd.to_datetime(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"])
    px = pd.Series([100.0, 101.0, 103.0, 102.0], index=idx)
    w = event_window(px, ["2026-01-07"], -1, 0)
    assert w == [("2026-01-07", math.log(103 / 101), 1)], w
    assert event_window(px, ["2026-01-05"], -1, 0) == []
    print("selftest ok")


def main():
    if "--selftest" in __import__("sys").argv:
        selftest()
        return
    df = daily()
    out = {"sources_coverage": {c: [df[c].first_valid_index().date().isoformat(), df[c].last_valid_index().date().isoformat(), int(df[c].notna().sum())]
                                for c in df.columns if df[c].notna().any()}}
    for name, fn in (("TSMOM", lambda: tsmom(df)), ("PREFOMC", lambda: prefomc(df)), ("TOM", lambda: tom(df)),
                     ("OVERNIGHT", lambda: overnight(df)), ("MONTHEND_FIX", lambda: monthend_fix(df)), ("SEASONAL", lambda: seasonal(df)),
                     ("SESSION", session), ("MONDAY_GAP", lambda: monday_gap(df)), ("VIX_CARRY", lambda: vix_carry(df)),
                     ("COT_CONTRA", lambda: cot_contra(df)), ("REAL_YIELD_GOLD", lambda: real_yield_gold(df)),
                     ("CREDIT_EQUITY", lambda: credit_equity(df))):
        out[name] = fn()
        print(name, "done")
    with open(os.path.join(HERE, "results", "search.json"), "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True, default=str)
        fh.write("\n")
    with open(os.path.join(HERE, "results", "arm_months.json"), "w") as fh:
        json.dump({k: [[m, round(v, 7)] for m, v in rows] for k, rows in sorted(ROWS.items())}, fh)
        fh.write("\n")


if __name__ == "__main__":
    main()
