"""G3 of SPEC-for-verification.md: recompute the 2026-10-14 proxy claims from committed inputs, independently.

Written from the spec's words and the inputs' headers, not from fxw_risk.py / vol_gated.py / es_sunday.py: nothing is
imported from them or from ig_research/scripts/common.py. Their committed results are read only at the end, to print
where this recomputation agrees and where it does not. Parameters: params/g2_s1a_frozen.json ("g3").

  A. FXW, STATARB-2 E0 on the FXCM weekend table, four pairs, assumed opening spreads 12/20/30/40 bps charged half at
     entry, plus 2 bps exit and funding; eras, directions, gap buckets, 60/240-minute delays, 24 h adverse excursion;
     whole-trade bootstrap (10,000 draws, seed 20261014); and the AUD historical bar.
  B. Model-priced S&P 500 straddles: daily (VIX1D) and weekly (VIX9D) at pricing ratios 0.8, 0.9 and 1.0, the
     2026-10-14 gates at 0.8, and each tenor's breakeven pricing ratio, by interpolation on a 0.01 grid and exactly.
  C. Short front VX: always and the three cycle-start gates, +30 % and +50 % modelled stops.
  D. ESG: the Yahoo ES=F Sunday-gap fade, and the coverage verdict for a longer source (section 3.4 of the review).

Run from the repository root: python3 -I docs/agents/backtests/ig_deepdive/scripts/g3_replicate.py
Writes results/g3_replication.json (deterministic).
"""
import bisect
import csv
import datetime as dt
import gzip
import json
import math
import os
import random
import statistics as st
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BT = os.path.dirname(HERE)
P = json.load(open(os.path.join(HERE, "params", "g2_s1a_frozen.json")))["g3"]
UTC = dt.timezone.utc
BPS = 1e4


def gz_rows(path):
    with gzip.open(path, "rt", newline="") as fh:
        return list(csv.DictReader(fh))


def stats(x, years=None):
    """Mean, t (sample sd, n-1) and the population-sd t the 2026-10-14 scripts printed, hit rate, total, drawdown."""
    n = len(x)
    if n < 2:
        return {"n": n, "mean_bps": round(BPS * x[0], 2) if n else None}
    m = sum(x) / n
    sd1, sd0 = st.stdev(x), st.pstdev(x)
    cum = peak = dd = 0.0
    for v in x:
        cum += v
        peak = max(peak, cum)
        dd = min(dd, cum - peak)
    out = {"n": n, "mean_bps": round(BPS * m, 2), "t": round(m / (sd1 / math.sqrt(n)), 2),
           "t_pop": round(m / (sd0 / math.sqrt(n)), 2), "hit": round(sum(v > 0 for v in x) / n, 3),
           "total_bps": round(BPS * sum(x), 1), "max_dd_bps": round(BPS * dd, 1)}
    if years:
        out["annual_bps"] = round(BPS * sum(x) / years, 1)
    return out


def boot95(x, seed=P["bootstrap"]["seed"], draws=P["bootstrap"]["draws"]):
    """Whole-trade bootstrap of the mean: 2.5th and 97.5th percentiles of the resampled means, in bps."""
    if len(x) < 2:
        return None
    rng = random.Random(seed)
    n = len(x)
    means = sorted(sum(x[rng.randrange(n)] for _ in range(n)) / n for _ in range(draws))
    return [round(BPS * means[int(0.025 * draws)], 2), round(BPS * means[int(0.975 * draws) - 1], 2)]


def block(x, years=None):
    return {**stats(x, years), "boot95_bps": boot95(x)}


def quant(sorted_x, q):
    """Linear interpolation between order statistics."""
    if not sorted_x:
        return None
    pos = q * (len(sorted_x) - 1)
    lo = math.floor(pos)
    hi = min(lo + 1, len(sorted_x) - 1)
    return sorted_x[lo] + (sorted_x[hi] - sorted_x[lo]) * (pos - lo)


# ------------------------------------------------------------------------------------------------------------------
# A. FXW

def weekends(pair):
    out = []
    for r in gz_rows(os.path.join(BT, "statarb_search2", "inputs", "fx", f"fxcm_{pair}_weekends.csv.gz")):
        fri, sun = int(r["fri_utc"]), int(r["sun_utc"])
        f = dt.datetime.fromtimestamp(fri, UTC)
        # A true weekend: Friday's last minute on a Friday (UTC), the Sunday open 40 to 60 hours later.
        if f.weekday() != 4 or not 40 * 3600 <= sun - fri <= 60 * 3600:
            continue
        fmid = (float(r["fri_bid"]) + float(r["fri_ask"])) / 2
        omid = (float(r["sun_bid_open"]) + float(r["sun_ask_open"])) / 2
        out.append({
            "friday": f.date().isoformat(), "sun_utc": sun, "year": dt.datetime.fromtimestamp(sun, UTC).year,
            "fmid": fmid, "omid": omid, "g": math.log(omid / fmid),
            "m1": float(r["mid_1h"]), "m4": float(r["mid_4h"]), "m24": float(r["mid_24h"]),
            "fill": int(r["fill_min"]) if r["fill_min"] != "" else None,
            "hi": float(r["hi_24h"]), "lo": float(r["lo_24h"]),
            "fxcm_open_spread_bps": BPS * (float(r["sun_ask_open"]) - float(r["sun_bid_open"])) / omid,
        })
    return out


def fade(w, spread_bps, delay=0):
    """E0 at an assumed opening spread: enter against the gap, half the spread against the trade; exit at Friday's mid
    when the mid reaches it within 24 h (the table's fill minute), otherwise at the +24 h mid; 2 bps exit and funding.
    A delayed entry (60 or 240 minutes) uses that minute's mid and leaves out a trade already at target by then."""
    side = 1 if w["g"] < 0 else -1          # +1 long after a fall, -1 short after a rise
    hit = w["fill"] is not None and w["fill"] <= 1440
    if delay:
        if hit and w["fill"] <= delay:
            return None
        ref = w["m1"] if delay == 60 else w["m4"]
    else:
        ref = w["omid"]
    entry = ref * (1 + side * spread_bps / 2 / BPS)
    out = w["fmid"] if hit else w["m24"]
    return side * math.log(out / entry) - P["exit_and_funding_bps"] / BPS


def fxw():
    res = {}
    thr = 20 / BPS
    for pair in P["pairs"]:
        wk = weekends(pair)
        tr = [w for w in wk if abs(w["g"]) >= thr]
        first, last = dt.date.fromisoformat(wk[0]["friday"]), dt.date.fromisoformat(wk[-1]["friday"])
        years = (last - first).days / 365.25
        book = {"weekends": len(wk), "first_friday": wk[0]["friday"], "last_friday": wk[-1]["friday"], "years": round(years, 2),
                "trades": len(tr)}
        for s in P["assumed_opening_spreads_bps"]:
            book[f"spread_{s}"] = block([fade(w, s) for w in tr], years)
        if pair == "AUDUSD":
            base = {s: [fade(w, s) for w in tr] for s in (12, 20, 30)}
            for lo, hi in P["eras"]:
                book[f"era_{lo}_{hi}_at_12"] = block([v for w, v in zip(tr, base[12]) if lo <= w["year"] <= hi])
                book[f"era_{lo}_{hi}_at_20"] = block([v for w, v in zip(tr, base[20]) if lo <= w["year"] <= hi])
            book["era_2022_2026_at_20"] = block([v for w, v in zip(tr, base[20]) if w["year"] >= 2022])
            for name, cond in (("long_after_fall", lambda w: w["g"] < 0), ("short_after_rise", lambda w: w["g"] > 0)):
                for s in (12, 20):
                    book[f"{name}_at_{s}"] = block([v for w, v in zip(tr, base[s]) if cond(w)])
            for lo, hi in P["gap_buckets_bps"]:
                key = f"gap_{lo}_{hi if hi else 'plus'}_at_12"
                book[key] = block([v for w, v in zip(tr, base[12]) if lo <= abs(w["g"]) * BPS < (hi or 1e9)])
            for d in P["delays_min"]:
                for s in (12, 20, 30):
                    book[f"delay_{d}_at_{s}"] = block([v for w in tr if (v := fade(w, s, d)) is not None])
            mae = sorted(BPS * ((w["omid"] - w["lo"]) / w["omid"] if w["g"] < 0 else (w["hi"] - w["omid"]) / w["omid"]) for w in tr)
            fills = sorted(w["fill"] for w in tr if w["fill"] is not None and w["fill"] <= 1440)
            book["adverse_excursion_24h_bps"] = {q: round(quant(mae, v), 1) for q, v in (("p50", .5), ("p75", .75), ("p90", .9), ("p95", .95), ("max", 1.0))}
            book["adverse_excursion_note"] = "from the Sunday open mid to the 24 h low (long) or high (short), FXCM mid bars"
            book["worst_trade_at_12_bps"] = round(BPS * min(base[12]), 1)
            book["target_reached_share"] = round(len(fills) / len(tr), 3)
            book["median_minutes_to_target"] = quant(fills, .5)
            book["fxcm_own_open_spread_bps_median_on_trades"] = round(quant(sorted(w["fxcm_open_spread_bps"] for w in tr), .5), 2)
            bar = P["aud_historical_bar"]
            s20 = book["spread_20"]
            checks = {
                "1_trades_ge_80": book["trades"] >= bar["min_trades"],
                "2_at_20_mean_ge_10": s20["mean_bps"] >= bar["at_20bp"]["mean_bps_min"],
                "2_at_20_t_ge_3_4": s20["t"] >= bar["at_20bp"]["t_min"],
                "2_at_20_boot_lower_gt_0": s20["boot95_bps"][0] > 0,
                "3_same_positive_sign_at_12_and_30": book["spread_12"]["mean_bps"] > 0 and book["spread_30"]["mean_bps"] > 0,
                "4_2022_2026_mean_gt_0": book["era_2022_2026_at_20"]["mean_bps"] > 0,
                "5_headline_two_sided": True,
            }
            book["historical_bar"] = {"checks": checks, "pass": all(checks.values()),
                                      "note": "t is the sample-sd t; the population-sd t (t_pop) is printed beside it"}
        res[pair] = book
    return res


# ------------------------------------------------------------------------------------------------------------------
# B. Straddles

IR = os.path.join(BT, "ig_research", "inputs")
US500_LEVEL = 7765.36          # the 2026-10-08 close the 2026-10-09 review converted IG's points at (its common.py LEVEL)


def cboe(name):
    out = {}
    for r in gz_rows(os.path.join(IR, "cboe", f"{name}.csv.gz")):
        m, d, y = r["DATE"].split("/")
        v = r.get("CLOSE", r.get(name))
        try:
            out[f"{y}-{m}-{d}"] = float(v)
        except (TypeError, ValueError):
            pass
    return out


def spx_closes():
    out = {}
    for r in gz_rows(os.path.join(IR, "yahoo_d", "_GSPC.csv.gz")):
        try:
            o, c = float(r["open"]), float(r["close"])
        except (TypeError, ValueError):
            continue
        if o > 0 and c > 0 and r["t"] >= "1989-01-01":
            out[r["t"]] = c
    return out


def ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_frac(kind, k, years, sigma):
    """Black price as a fraction of the forward, zero rates: strike k times the forward."""
    v = sigma * math.sqrt(years)
    d1 = (-math.log(k) + v * v / 2) / v
    d2 = d1 - v
    return ncdf(d1) - k * ncdf(d2) if kind == "c" else k * ncdf(-d2) - ncdf(-d1)


def straddles():
    closes = spx_closes()
    days = sorted(closes)
    pos = {d: i for i, d in enumerate(days)}
    rets = {days[i]: math.log(closes[days[i]] / closes[days[i - 1]]) for i in range(1, len(days))}

    def rv21(d):
        i = pos[d]
        if i < 21:
            return None
        return 100 * st.pstdev([rets[days[j]] for j in range(i - 20, i + 1)]) * math.sqrt(252)

    vix = cboe("VIX")
    out = {}
    for tenor, idx, leg_points in (("daily", cboe("VIX1D"), 1.0), ("weekly", cboe("VIX9D"), 2.0)):
        if tenor == "daily":
            pairs = [(a, b) for a, b in zip(days, days[1:]) if a in idx and rv21(a)]
        else:
            fr = [d for d in days if dt.date.fromisoformat(d).weekday() == 4 and d in idx and rv21(d)]
            pairs = [(a, b) for a, b in zip(fr, fr[1:]) if (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days == 7]
        years = (dt.date.fromisoformat(pairs[-1][1]) - dt.date.fromisoformat(pairs[0][0])).days / 365.25
        cost = leg_points / US500_LEVEL
        rows = []
        for a, b in pairs:
            h = (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days / 365
            iv = idx[a]
            rows.append({"iv": iv, "gap": iv - rv21(a), "term": iv / vix[a] if vix.get(a) else None, "h": h,
                         "move": math.log(closes[b] / closes[a]), "unit": math.sqrt(2 / math.pi) * iv / 100 * math.sqrt(h)})

        def naked(r, k):
            return k * r["unit"] - abs(r["move"]) - cost

        def fly(r, k):
            prem = k * r["unit"]
            sigma = k * r["iv"] / 100
            width = 2 * prem
            wing = bs_frac("c", 1 + width, r["h"], sigma) + bs_frac("p", 1 - width, r["h"], sigma) if width < 1 else 0.0
            return prem - wing - min(abs(r["move"]), width) - 2 * cost

        book = {"pairs": len(pairs), "first": pairs[0][0], "last": pairs[-1][1], "years": round(years, 2)}
        for k in (0.8, 0.9, 1.0):
            book[f"ungated_naked_ratio_{k}"] = {**stats([naked(r, k) for r in rows], years), "worst_bps": round(BPS * min(naked(r, k) for r in rows), 1)}
            book[f"ungated_iron_butterfly_ratio_{k}"] = {**stats([fly(r, k) for r in rows], years), "worst_bps": round(BPS * min(fly(r, k) for r in rows), 1)}
        gates = {"iv_minus_rv_ge_3": lambda r: r["gap"] >= 3, "iv_minus_rv_ge_5": lambda r: r["gap"] >= 5,
                 "iv_minus_rv_ge_3_and_iv_le_30": lambda r: r["gap"] >= 3 and r["iv"] <= 30}
        if tenor == "weekly":
            gates["iv_minus_rv_ge_3_and_term_ratio_le_1"] = lambda r: r["gap"] >= 3 and r["term"] is not None and r["term"] <= 1
        for name, g in gates.items():
            sel = [r for r in rows if g(r)]
            book[f"{name}_naked_ratio_0.8"] = stats([naked(r, 0.8) for r in sel], years)
            book[f"{name}_iron_butterfly_ratio_0.8"] = stats([fly(r, 0.8) for r in sel], years)
        # Breakeven: the pricing ratio at which the ungated mean is zero.
        grid = [round(0.5 + 0.01 * i, 2) for i in range(151)]
        for structure, fn in (("naked", naked), ("iron_butterfly", fly)):
            means = [sum(fn(r, k) for r in rows) / len(rows) for k in grid]
            be = None
            for (k0, m0), (k1, m1) in zip(zip(grid, means), zip(grid[1:], means[1:])):
                if m0 < 0 <= m1:
                    be = round(k0 + (k1 - k0) * (-m0) / (m1 - m0), 4)
                    break
            book[f"breakeven_ratio_{structure}_interpolated"] = be
        exact = (sum(abs(r["move"]) for r in rows) / len(rows) + cost) / (sum(r["unit"] for r in rows) / len(rows))
        book["breakeven_ratio_naked_exact"] = round(exact, 4)
        book["breakeven_note"] = ("the ratio of IG's straddle-implied volatility to the matching Cboe index at which the "
                                  "ungated model's mean is zero, after the 2026-10-09 leg cost; S4's screen compares "
                                  "IG's k_bid with this number")
        out[tenor] = book
    return out


# ------------------------------------------------------------------------------------------------------------------
# C. Front VX

def front_vx():
    rows = gz_rows(os.path.join(IR, "cboe", "VX_monthly.csv.gz"))
    book = {}
    for r in rows:
        book.setdefault(r["trade_date"], {})[r["expiry"]] = (float(r["settle"]), float(r["high"] or 0))
    days = sorted(book)
    expiries = sorted({r["expiry"] for r in rows})
    vix = cboe("VIX")

    def fronts(day):
        left = bisect.bisect_right(days, day)
        c = [e for e in expiries if e > day and bisect.bisect_right(days, e) - left > 5 and e in book[day]]
        return (c[0] if c else None), (c[1] if len(c) > 1 else None)

    gates = {"always": lambda f, s, v: True, "front_over_spot_ge_1": lambda f, s, v: f >= 1,
             "front_over_spot_ge_1_05": lambda f, s, v: f >= 1.05,
             "second_over_front_ge_1_03": lambda f, s, v: s is not None and s >= 1.03}
    out = {}
    for gname, gate in gates.items():
        for stop in (0.30, 0.50):
            pnl = {}
            cur = entry = None
            on = stopped = False
            cycles = stops = 0
            for i in range(1, len(days)):
                d0, d1 = days[i - 1], days[i]
                e, e2 = fronts(d0)
                if e is None or e not in book[d1]:
                    pnl[d1] = 0.0
                    continue
                if e != cur:
                    cur, entry = e, book[d0][e][0]
                    sec = book[d0][e2][0] if e2 and e2 in book[d0] else None
                    v = vix.get(d0)
                    on = bool(v) and gate(entry / v, sec / entry if sec else None, v)
                    stopped = False
                    if on:
                        cycles += 1
                        pnl[d0] = pnl.get(d0, 0.0) - 0.1 / entry       # half a 0.2-point spread to sell
                if not on or stopped:
                    pnl[d1] = pnl.get(d1, 0.0)
                    continue
                prev = book[d0][e][0]
                settle, high = book[d1][e]
                lvl = entry * (1 + stop)
                if (high > 0 and high >= lvl) or (high == 0 and settle >= lvl):
                    px = lvl if high > 0 else settle
                    pnl[d1] = (-(px - prev) - 0.2) / entry
                    stopped, stops = True, stops + 1
                else:
                    pnl[d1] = -(settle - prev) / entry
            ks = sorted(pnl)
            vals = [pnl[k] for k in ks]
            years = (dt.date.fromisoformat(ks[-1]) - dt.date.fromisoformat(ks[0])).days / 365.25
            m, sd = sum(vals) / len(vals), st.pstdev(vals)
            cum = peak = dd = 0.0
            for x in vals:
                cum += x
                peak = max(peak, cum)
                dd = min(dd, cum - peak)
            out[f"{gname}_stop_{int(stop * 100)}"] = {
                "annual_pct_of_notional": round(100 * sum(vals) / years, 2), "annual_sharpe": round(m / sd * math.sqrt(len(vals) / years), 2),
                "worst_drawdown_pct": round(100 * dd, 1), "cycles": cycles, "cycles_stopped": stops,
            }
    out["warning"] = ("daily settles and highs cannot prove an IG guaranteed stop's fill, its premium or its minimum "
                      "distance; no VX variant advances under the spec")
    return out


# ------------------------------------------------------------------------------------------------------------------
# D. ESG on Yahoo ES=F hourly

def esg():
    et = ZoneInfo("America/New_York")
    bars = []
    for r in gz_rows(os.path.join(IR, "yahoo_1h", "ES=F.csv.gz")):
        try:
            bars.append((dt.datetime.fromtimestamp(int(r["t"]), et), float(r["open"]), float(r["close"])))
        except (TypeError, ValueError):
            continue
    bars.sort()
    cost = (1.5 / 2 + 0.4 / 2) / US500_LEVEL   # half the 22:00-23:00 UK band's 1.5 points in, half of 0.4 out
    wk = []
    for i in range(1, len(bars)):
        a, b = bars[i - 1], bars[i]
        if a[0].weekday() == 4 and b[0].weekday() == 6:
            mon = b[0].date() + dt.timedelta(days=1)
            x10 = next((x for x in bars[i:] if x[0].date() == mon and (x[0].hour, x[0].minute) >= (9, 30)), None)
            x16 = next((x for x in bars[i:] if x[0].date() == mon and x[0].hour >= 16), None)
            if x10 and x16:
                wk.append({"sun": b[0].isoformat(), "g": math.log(b[1] / a[2]), "x10": math.log(x10[1] / b[1]), "x16": math.log(x16[1] / b[1])})
    years = len(wk) / 52.18
    out = {"weekends": len(wk), "first": wk[0]["sun"], "last": wk[-1]["sun"], "cost_bps": round(BPS * cost, 2)}
    for thr in (0.0025, 0.005, 0.0075):
        for k in ("x10", "x16"):
            out[f"fade_{thr * 100:g}pct_exit_{k}"] = stats([(-1 if w["g"] > 0 else 1) * w[k] - cost for w in wk if abs(w["g"]) >= thr], years)
    out["coverage_verdict"] = ("S3 not run, coverage: no lawfully reusable hourly ES history of at least eight years with "
                               "60 trades at 0.5 % was found (review section 3.4); ESG stays descriptive on the Yahoo trades")
    return out


# ------------------------------------------------------------------------------------------------------------------

def compare(mine):
    """Where this recomputation and the 2026-10-14 results agree (read only here)."""
    old = json.load(open(os.path.join(HERE, "results", "fxw_risk.json")))
    vol = json.load(open(os.path.join(HERE, "results", "vol_gated.json")))
    esg_old = json.load(open(os.path.join(BT, "ig_research", "results", "es_sunday.json")))
    rows = []

    def add(what, a, b):
        rows.append({"what": what, "this": a, "2026_10_14": b, "equal": a == b})

    for pair in P["pairs"]:
        add(f"{pair} trades", mine["A_fxw"][pair]["trades"], old[pair]["trades"])
        for s in P["assumed_opening_spreads_bps"]:
            add(f"{pair} mean at {s}", mine["A_fxw"][pair][f"spread_{s}"]["mean_bps"], old[pair][f"spread_{s}"]["mean_bps"])
            add(f"{pair} t_pop at {s}", mine["A_fxw"][pair][f"spread_{s}"]["t_pop"], old[pair][f"spread_{s}"]["t"])
    a = mine["A_fxw"]["AUDUSD"]
    add("AUD boot95 at 12", a["spread_12"]["boot95_bps"], old["AUDUSD"]["spread_12"]["boot95_bps"])
    for lo, hi in P["eras"]:
        add(f"AUD era {lo}-{hi} mean at 12", a[f"era_{lo}_{hi}_at_12"]["mean_bps"], old["AUDUSD"][f"era_{lo}_{hi}"]["mean_bps"])
    add("AUD long after fall at 12", a["long_after_fall_at_12"]["mean_bps"], old["AUDUSD"]["long_down_gap"]["mean_bps"])
    add("AUD short after rise at 12", a["short_after_rise_at_12"]["mean_bps"], old["AUDUSD"]["short_up_gap"]["mean_bps"])
    for d in (60, 240):
        add(f"AUD delay {d} mean at 12", a[f"delay_{d}_at_12"]["mean_bps"], old["AUDUSD"][f"delay_{d}_spread_12"]["mean_bps"])
    add("AUD worst trade at 12", a["worst_trade_at_12_bps"], old["AUDUSD"]["risk_geometry_12bp"]["worst_trade_bps"])
    add("AUD MAE max", a["adverse_excursion_24h_bps"]["max"], old["AUDUSD"]["risk_geometry_12bp"]["mae_bps_p50_p75_p90_p95_max"][4])
    add("AUD MAE p50/p75/p90/p95 (interpolated here, nearest rank there)",
        [a["adverse_excursion_24h_bps"][q] for q in ("p50", "p75", "p90", "p95")],
        old["AUDUSD"]["risk_geometry_12bp"]["mae_bps_p50_p75_p90_p95_max"][:4])
    for tenor in ("daily", "weekly"):
        for g in ("iv_minus_rv_ge_3", "iv_minus_rv_ge_5", "iv_minus_rv_ge_3_and_iv_le_30"):
            for s in ("naked", "iron_butterfly"):
                add(f"{tenor} {g} {s} mean", mine["B_straddles"][tenor][f"{g}_{s}_ratio_0.8"]["mean_bps"], vol["straddles"][tenor][f"{g}_{s}"]["mean_bps"])
        add(f"{tenor} ungated naked 0.8 mean", mine["B_straddles"][tenor]["ungated_naked_ratio_0.8"]["mean_bps"], vol["straddles"][tenor]["all_naked"]["mean_bps"])
    for k in ("always_stop_30", "front_over_spot_ge_1_stop_30", "front_over_spot_ge_1_05_stop_30", "second_over_front_ge_1_03_stop_30", "always_stop_50"):
        add(f"VX {k} annual %", mine["C_front_vx"][k]["annual_pct_of_notional"], round(vol["front_vx"][k]["annual_bps"] / 100, 2))
        add(f"VX {k} stops", mine["C_front_vx"][k]["cycles_stopped"], vol["front_vx"][k]["stops"])
    add("ESG 0.5 % Monday 16:00 n", mine["D_esg"]["fade_0.5pct_exit_x16"]["n"], esg_old["ESG_0.5_x2"]["n"])
    add("ESG 0.5 % Monday 16:00 mean", mine["D_esg"]["fade_0.5pct_exit_x16"]["mean_bps"], esg_old["ESG_0.5_x2"]["mean_bps"])
    return rows


def main():
    out = {"A_fxw": fxw(), "B_straddles": straddles(), "C_front_vx": front_vx(), "D_esg": esg()}
    out["comparison_with_2026_10_14"] = compare(out)
    path = os.path.join(HERE, "results", "g3_replication.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
        fh.write("\n")
    for r in out["comparison_with_2026_10_14"]:
        print(("same " if r["equal"] else "DIFF ") + r["what"], r["this"], r["2026_10_14"])


if __name__ == "__main__":
    main()
