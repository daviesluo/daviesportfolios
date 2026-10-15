"""S1a of SPEC-for-verification.md: does FXCM's weekend-gap fade (STATARB-2 E0) transfer to IG's own AUD/USD hours?

Frozen in params/g2_s1a_frozen.json ("s1a") on 2026-10-15, before any IG history was pulled. Input: the hourly CSV
ig_parse.py writes from the `fxw` plan's pulls (data/fxw_<account>_<epic>.csv) and the committed FXCM weekend table.
Output: results/s1a_<account>.json, with every weekend's row, the five transfer conditions and the two scorings.

  python3 -I docs/agents/backtests/ig_deepdive/scripts/s1a_transfer.py data/fxw_sb_<EPIC>.csv --account sb
  python3 -I docs/agents/backtests/ig_deepdive/scripts/s1a_transfer.py --selftest

The documented hours are IG's forex product page (fact F11): Sunday 21:00 to Friday 21:59 London time. Without a G1
openingHours value the Friday close is 22:00 UK and the Sunday open 21:00 UK; each row says which applied.
Bar timestamps: ig_parse.py's `bar_start_utc`. The stamp convention is checked here, not assumed: the share of
weekends whose first Sunday bar starts exactly at the documented open is printed, and a share under one half with
the next hour holding most first bars is reported as "stamp looks like bar end: re-parse with --stamp end".
"""
import csv
import datetime as dt
import gzip
import json
import math
import os
import statistics as st
import sys
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BT = os.path.dirname(HERE)
PARAMS = json.load(open(os.path.join(HERE, "params", "g2_s1a_frozen.json")))
S = PARAMS["s1a"]
G2 = PARAMS["g2"]
UK = ZoneInfo("Europe/London")
UTC = dt.timezone.utc
H = dt.timedelta(hours=1)
BPS = 1e4


def uk(d, hh, mm):
    return dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=UK).astimezone(UTC)


def fridays():
    a = dt.date.fromisoformat(G2["anchor_friday"])
    return [a - dt.timedelta(weeks=i) for i in range(G2["weekends"])]


def load_bars(path):
    out = []
    with open(path) as fh:
        for r in csv.DictReader(fh):
            f = lambda k: float(r[k]) if r[k] != "" else None  # noqa: E731
            out.append({"t": dt.datetime.fromisoformat(r["bar_start_utc"].replace("Z", "+00:00")),
                        **{k: f(k) for k in ("bid_open", "bid_high", "bid_low", "bid_close", "ask_open", "ask_high", "ask_low", "ask_close")}})
    out.sort(key=lambda b: b["t"])
    return out


def load_fxcm():
    out = {}
    with gzip.open(os.path.join(BT, "statarb_search2", "inputs", "fx", "fxcm_AUDUSD_weekends.csv.gz"), "rt") as fh:
        for r in csv.DictReader(fh):
            fri, sun = int(r["fri_utc"]), int(r["sun_utc"])
            fd = dt.datetime.fromtimestamp(fri, UTC)
            if fd.weekday() != 4 or not 40 * 3600 <= sun - fri <= 60 * 3600:
                continue
            fmid = (float(r["fri_bid"]) + float(r["fri_ask"])) / 2
            smid = (float(r["sun_bid_open"]) + float(r["sun_ask_open"])) / 2
            out[fd.date().isoformat()] = {"fri_utc": fd.isoformat(), "sun_utc": dt.datetime.fromtimestamp(sun, UTC).isoformat(),
                                          "gap_bps": round(BPS * math.log(smid / fmid), 2)}
    return out


def mid(b, which):
    bid, ask = b[f"bid_{which}"], b[f"ask_{which}"]
    return None if bid is None or ask is None else (bid + ask) / 2


def score(bars, i0, target, side, horizon_h):
    """Close-only and range-crossing exits from the entry bar i0 (enter at its executable open)."""
    e = bars[i0]
    entry = e["ask_open"] if side > 0 else e["bid_open"]
    end = e["t"] + dt.timedelta(hours=horizon_h)
    window = [b for b in bars[i0:] if b["t"] < end]
    xs = "bid" if side > 0 else "ask"                       # the exit side
    last = next((b for b in reversed(window) if b[f"{xs}_close"] is not None), e)
    close_exit = range_exit = None
    for b in window:
        c = b[f"{xs}_close"]
        if close_exit is None and c is not None and (c >= target if side > 0 else c <= target):
            close_exit = (b["t"], c)
        ext = b[f"{xs}_high"] if side > 0 else b[f"{xs}_low"]
        if range_exit is None and ext is not None and (ext >= target if side > 0 else ext <= target):
            range_exit = (b["t"], target)
    fallback = (last["t"], last[f"{xs}_close"])
    out = {}
    for name, (t, px) in (("close_only", close_exit or fallback), ("range_crossing", range_exit or fallback)):
        out[name] = {"exit_bar_utc": t.isoformat(), "exit": px, "at_target": (close_exit if name == "close_only" else range_exit) is not None,
                     "pnl_bps_before_funding": round(BPS * side * math.log(px / entry), 2)}
    return entry, out


def weekend_rows(bars, account, fridays_list, fxcm, friday_close_hm=(22, 0), sunday_open_hm=(21, 0)):
    bars = sorted(bars, key=lambda b: b["t"])
    rows = []
    for fri in fridays_list:
        sun = fri + dt.timedelta(days=2)
        mon = fri + dt.timedelta(days=3)
        close = uk(fri, *friday_close_hm)
        open_ = uk(sun, *sunday_open_hm)
        mon22 = uk(mon, 22, 0)
        row = {"friday": fri.isoformat(), "friday_close_utc": close.isoformat(), "sunday_open_utc": open_.isoformat(),
               "hours_source": "documented (F11)"}
        ref = next((b for b in reversed(bars) if b["t"] < close and b["t"] >= close - dt.timedelta(hours=6)
                    and b["bid_close"] is not None and b["ask_close"] is not None), None)
        idx = next((i for i, b in enumerate(bars) if open_ <= b["t"] < open_ + dt.timedelta(hours=24) and b["bid_open"] is not None
                    and b["ask_open"] is not None and b["ask_open"] > b["bid_open"]), None)
        row["friday_ref_bar_utc"] = ref["t"].isoformat() if ref else None
        row["first_bar_utc"] = bars[idx]["t"].isoformat() if idx is not None else None
        row["complete"] = ref is not None and idx is not None
        if row["complete"]:
            b0 = bars[idx]
            fmid, omid = mid(ref, "close"), mid(b0, "open")
            g = math.log(omid / fmid)
            row.update({"friday_ref_mid": fmid, "first_open_mid": omid, "gap_bps": round(BPS * g, 2),
                        "open_spread_bps": round(BPS * (b0["ask_open"] - b0["bid_open"]) / omid, 2),
                        "first_bar_uk": b0["t"].astimezone(UK).strftime("%a %H:%M")})
            first_uk = b0["t"].astimezone(UK)
            row["first_bar_by_2200_uk"] = first_uk <= uk(sun, 22, 0)
            have = {b["t"] for b in bars if b0["t"] <= b["t"] < mon22}
            expect, t = [], b0["t"]
            while t < mon22:
                expect.append(t)
                t += H
            row["missing_hours_to_mon_2200"] = sum(1 for x in expect if x not in have)
            if abs(g) >= S["signal_threshold_bps"] / BPS:
                side = 1 if g < 0 else -1
                entry, sc = score(bars, idx, fmid, side, S["horizon_hours"])
                row["trade"] = {"side": "long" if side > 0 else "short", "entry": entry, **sc}
        f = fxcm.get(fri.isoformat())
        if f:
            row["fxcm"] = f
            if row.get("first_bar_utc"):
                row["first_quote_minutes_ig_before_fxcm"] = round((dt.datetime.fromisoformat(f["sun_utc"]) - bars[idx]["t"]).total_seconds() / 60, 1)
        row["unexplained_gap"] = (not row["complete"]) or row.get("missing_hours_to_mon_2200", 0) > 0
        rows.append(row)
    return rows


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    pos = p * (len(xs) - 1)
    lo = math.floor(pos)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def corr(a, b):
    if len(a) < 3:
        return None
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    sa = math.sqrt(sum((x - ma) ** 2 for x in a))
    sb = math.sqrt(sum((y - mb) ** 2 for y in b))
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb) if sa and sb else None


def summarise(rows):
    tb = S["transfer_bar"]
    comp = [r for r in rows if r["complete"]]
    spreads = [r["open_spread_bps"] for r in comp]
    paired = [r for r in comp if "fxcm" in r]
    ig_g = [r["gap_bps"] for r in paired]
    fx_g = [r["fxcm"]["gap_bps"] for r in paired]
    big = [r for r in paired if abs(r["fxcm"]["gap_bps"]) >= tb["fxcm_gap_ratio"]["fxcm_abs_gap_bps_min"]]
    ratios = [abs(r["gap_bps"]) / abs(r["fxcm"]["gap_bps"]) for r in big]
    by22 = [r for r in comp if r["first_bar_by_2200_uk"]]
    unexplained = [r for r in rows if r["unexplained_gap"]]
    starts_at_open = sum(1 for r in comp if r["first_bar_utc"] == r["sunday_open_utc"])
    starts_hour_after = sum(1 for r in comp if r["first_bar_utc"] == (dt.datetime.fromisoformat(r["sunday_open_utc"]) + H).isoformat())
    c = {
        "1_complete_weekends_ge_45": {"value": len(comp), "pass": len(comp) >= tb["min_complete_weekends"]},
        "2_median_open_spread_le_20": {"value": round(q(spreads, .5), 2) if spreads else None, "pass": bool(spreads) and q(spreads, .5) <= tb["median_opening_spread_bps_max"]},
        "2_p75_open_spread_le_30": {"value": round(q(spreads, .75), 2) if spreads else None, "pass": bool(spreads) and q(spreads, .75) <= tb["p75_opening_spread_bps_max"]},
        "3_gap_correlation_ge_0_5": {"value": round(corr(ig_g, fx_g), 3) if corr(ig_g, fx_g) is not None else None, "paired": len(paired),
                                     "pass": (corr(ig_g, fx_g) or -1) >= tb["gap_correlation_min"]},
        "4_median_gap_ratio_ge_0_7": {"value": round(q(ratios, .5), 3) if ratios else None, "weekends": len(big),
                                      "pass": "not run, coverage" if len(big) < tb["fxcm_gap_ratio"]["min_weekends_else_not_run_coverage"] else q(ratios, .5) >= tb["fxcm_gap_ratio"]["median_ratio_min"]},
        "5a_first_bar_by_2200_share_ge_0_8": {"value": round(len(by22) / len(comp), 3) if comp else None, "pass": bool(comp) and len(by22) / len(comp) >= tb["first_bar_by_share_min"]},
        "5b_unexplained_gap_share_lt_0_1": {"value": round(len(unexplained) / len(rows), 3), "pass": len(unexplained) / len(rows) < tb["unexplained_gap_share_max"]},
    }
    verdict = "PASS" if all(v["pass"] is True for v in c.values()) else (
        "NOT RUN, coverage" if any(v["pass"] == "not run, coverage" for v in c.values()) and all(v["pass"] in (True, "not run, coverage") for v in c.values()) else "FAIL")
    trades = [r for r in comp if "trade" in r]
    sc = {}
    for name in ("close_only", "range_crossing"):
        vals = [r["trade"][name]["pnl_bps_before_funding"] - S_FUNDING for r in trades]
        sc[name] = {"n": len(vals), "mean_bps_after_funding_line": round(sum(vals) / len(vals), 2) if vals else None,
                    "t": round(st.mean(vals) / (st.stdev(vals) / math.sqrt(len(vals))), 2) if len(vals) > 2 and st.stdev(vals) else None,
                    "at_target_share": round(sum(r["trade"][name]["at_target"] for r in trades) / len(trades), 3) if trades else None}
    return {"weekends": len(rows), "complete": len(comp), "conditions": c, "transfer_verdict": verdict,
            "stamp_check": {"first_bar_at_documented_open": starts_at_open, "first_bar_an_hour_later": starts_hour_after,
                            "note": ("stamp looks like bar end: re-parse with --stamp end" if comp and starts_at_open < len(comp) / 2 and starts_hour_after > len(comp) / 2 else "consistent with bar start")},
            "open_spread_bps_quantiles": {k: round(q(spreads, v), 2) for k, v in (("p25", .25), ("p50", .5), ("p75", .75), ("p90", .9))} if spreads else None,
            "scoring_hourly_approximation": sc, "funding_line_bps": S_FUNDING,
            "note": "neither scoring is a fill claim; the funding line is the frozen 2 bps assumption"}


S_FUNDING = 2.0


def selftest():
    """Two weekends built by hand; every number below is worked out on paper."""
    fri = [dt.date(2026, 10, 9), dt.date(2026, 10, 2)]
    bars = []

    def bar(t, bo, bh, bl, bc, spread=0.0002):
        bars.append({"t": t, "bid_open": bo, "bid_high": bh, "bid_low": bl, "bid_close": bc,
                     "ask_open": bo + spread, "ask_high": bh + spread, "ask_low": bl + spread, "ask_close": bc + spread})
    for fr in fri:
        close = uk(fr, 22, 0)
        bar(close - H, 0.7000, 0.7001, 0.6999, 0.7000)            # Friday ref mid 0.7001
        sun_open = uk(fr + dt.timedelta(days=2), 21, 0)
        bar(sun_open, 0.6950, 0.6960, 0.6940, 0.6955)               # opens 0.6951 mid: gap ln(0.6951/0.7001) = -71.7 bps
        t = sun_open + H
        while t < uk(fr + dt.timedelta(days=3), 22, 0):
            bar(t, 0.6990, 0.7005, 0.6985, 0.6995)                  # bid_high 0.7005 >= 0.7001; closes 0.6995 < target
            t += H
    rows = weekend_rows(bars, "test", fri, {"2026-10-09": {"fri_utc": "x", "sun_utc": uk(fri[0] + dt.timedelta(days=2), 22, 0).isoformat(), "gap_bps": -70.0}})
    r = rows[0]
    assert r["complete"] and r["first_bar_uk"] == "Sun 21:00", r
    assert abs(r["gap_bps"] - round(BPS * math.log(0.6951 / 0.7001), 2)) < 1e-9, r["gap_bps"]
    assert abs(r["open_spread_bps"] - round(BPS * 0.0002 / 0.6951, 2)) < 1e-9
    tr = r["trade"]
    assert tr["side"] == "long" and abs(tr["entry"] - 0.6952) < 1e-12
    # Range-crossing: the second bar's bid high 0.7005 reaches 0.7001: exit at the target.
    assert tr["range_crossing"]["at_target"] and abs(tr["range_crossing"]["pnl_bps_before_funding"] - round(BPS * math.log(0.7001 / 0.6952), 2)) < 1e-9
    # Close-only: no bid close reaches 0.7001 within 24 h: the last bar starting before entry + 24 h, at its bid close 0.6995.
    assert not tr["close_only"]["at_target"] and abs(tr["close_only"]["pnl_bps_before_funding"] - round(BPS * math.log(0.6995 / 0.6952), 2)) < 1e-9
    assert tr["close_only"]["exit_bar_utc"] == (uk(dt.date(2026, 10, 11), 21, 0) + dt.timedelta(hours=23)).isoformat()
    assert r["missing_hours_to_mon_2200"] == 0 and not r["unexplained_gap"]
    assert r["first_quote_minutes_ig_before_fxcm"] == 60.0
    s = summarise(rows)
    assert s["complete"] == 2 and s["stamp_check"]["first_bar_at_documented_open"] == 2
    print("selftest ok:", json.dumps({"gap_bps": r["gap_bps"], "range": tr["range_crossing"]["pnl_bps_before_funding"], "close": tr["close_only"]["pnl_bps_before_funding"]}))


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    src = sys.argv[1]
    account = sys.argv[sys.argv.index("--account") + 1]
    bars = load_bars(src if os.path.isabs(src) else os.path.join(HERE, src))
    rows = weekend_rows(bars, account, fridays(), load_fxcm())
    out = {"input": os.path.relpath(src if os.path.isabs(src) else os.path.join(HERE, src), HERE), "account": account,
           "params": "params/g2_s1a_frozen.json", "summary": summarise(rows), "weekends": rows}
    path = os.path.join(HERE, "results", f"s1a_{account}.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True, default=str)
        fh.write("\n")
    print(json.dumps(out["summary"], indent=1, default=str))


if __name__ == "__main__":
    main()
