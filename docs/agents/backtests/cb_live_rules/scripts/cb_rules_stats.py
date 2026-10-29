"""CB-LIVE-RULES' numbers: cb_rules.py's runs → results/cb_rules.json, on STRATEGY-COMPARE's method.

Per candidate, in pounds and in % a year of its capital (the dollars its rungs fund, at GBP/USD of 2026-10-28), every figure
× e = 0.825 (the Revolut X half's LIVE realised ÷ its replay), by the UTC day of each trip's exit:
  * since 2026-09-01 (58 days): the headline, with an 80 % interval and P(year < 0) from 10,000 simulated years of 3-day
    circular blocks of those days (seed 20261029);
  * the blend, ½ out of sample + ½ the last three months; out of sample 2025-11-21 → 10-28; in sample 2024-10-01 → 2025-11-20;
  * the bars, written before any run was read, for a change to the baseline ("- 2" as it runs): the paired daily difference
    has out-of-sample P(≤ 0) < 0.10 (3-day block bootstrap, 10,000) with a mean above zero, is not negative since 09-01, and is
    positive in at least two thirds of the 25 calendar months. A candidate on another book or size is reported, not barred.
  * out of sample: trips a day, bps a trip, stops a year, fills under £1 (a live order that small is at Coinbase's minimum);
  * the post-only check (baseline and the EUR book, 10-10 → 10-28): orders the simulator let go live whose price the
    recorder's touch at the top of that minute shows crossing (a bid at or above the ask, an ask at or below the bid);
  * the coin the asks hold: a dollar position of the ask rungs' funding, marked daily at GBP/USD (Exness at 00:00 UTC): its
    realised P&L and yearly spread beside the strategy's.
usage: python3 -I cb_rules_stats.py RUNS.json.gz EXNESS_LONG.txt.gz OUT.json
"""
import collections, datetime, gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(BT, "compare", "cb", "scripts"))
sys.path.insert(0, os.path.join(BT, "fx_speed", "scripts"))
sys.path.insert(0, os.path.join(BT, "fair_price_cb_okx", "scripts"))
import numpy as np  # noqa: E402
import cb_compare_stats as S  # noqa: E402  (the windows, the simulated years, the block bootstrap)
import exness_long as EL  # noqa: E402
import fpc as C  # noqa: E402  (through cb_compare_stats' path: the touch)

E = 0.825
day = S.day
MONTHS_ALL = None


def series(trips, dd):
    d = collections.defaultdict(float)
    for x in trips:
        d[day(x[1])] += x[2]
    return np.array([d.get(k, 0.0) for k in dd])


def capital_usd(spec):
    usd = spec[3]
    r = spec[2].get("rungs")
    return usd * (sum(w for _, _, w in r) if r else 6.0)


def main(runs_path, ex_path, out):
    R = None
    for p in runs_path.split(","):          # the first pass, then the second (its baseline must be the first's, trip for trip)
        r = json.load(gzip.open(p, "rt"))
        if R is None:
            R = r
            continue
        assert r["runs"]["base"] == R["runs"]["base"], "the two passes' baselines differ"
        for k in ("runs", "extra", "specs"):
            R[k].update({kk: vv for kk, vv in r[k].items() if kk != "base"})
    ex = EL.Long(ex_path)
    g = ex.col("GBPUSD", 0)
    ref = float(g[(S.ms("2026-10-28") - EL.FROM) // 60000])
    D = {k: S.days(*v) for k, v in S.W.items()}
    allD = D["all"]
    months = sorted({x[:7] for x in allD})
    res = {"gbpusd_ref": ref, "e": E, "check_trips": R["check_trips"], "rows": {}, "pairs": {}}
    sers = {}
    for name, tr in R["runs"].items():
        spec = R["specs"][name]
        cap = capital_usd(spec) / ref
        s = series(tr, allD)
        sers[name] = s
        idx = {k: [allD.index(D[k][0]), allD.index(D[k][-1]) + 1] for k in ("is", "oos", "recent", "sep")}
        w = {k: s[a:b] for k, (a, b) in idx.items()}
        rate = {k: 100 * 365 * float(v.mean()) / cap for k, v in w.items()}
        ys = S.year_sims(w["sep"])
        yb = S.year_sims(w["oos"], w["recent"])
        o0, o1 = S.ms("2025-11-21"), S.ms("2026-10-29")
        sel = [x for x in tr if o0 <= x[1] < o1]
        nd = len(D["oos"])
        mo = collections.defaultdict(float)
        for k, v in zip(allD, s):
            mo[k[:7]] += v
        r = {"book": spec[0], "fair": spec[1], "opts": spec[2], "rung_usd": spec[3], "capital_usd": capital_usd(spec), "capital_gbp": round(cap, 2),
             "since_0901_pct": round(E * rate["sep"], 2), "since_0901_i80": [round(E * 100 * float(np.percentile(ys, p)) / cap, 2) for p in (10, 90)],
             "since_0901_p_year_lt0": round(float((ys < 0).mean()), 4), "since_0901_gbp_year": round(E * 365 * float(w["sep"].mean()), 2),
             "blend_pct": round(E * (0.5 * rate["oos"] + 0.5 * rate["recent"]), 2),
             "blend_i80": [round(E * 100 * float(np.percentile(yb, p)) / cap, 2) for p in (10, 90)], "blend_p_year_lt0": round(float((yb < 0).mean()), 4),
             "oos_pct": round(E * rate["oos"], 2), "recent_pct": round(E * rate["recent"], 2), "is_pct": round(E * rate["is"], 2),
             "oos_gbp_year": round(E * 365 * float(w["oos"].mean()), 2),
             "trips_day_oos": round(len(sel) / nd, 2), "bps_trip_oos": round(1e4 * sum(x[2] for x in sel) * ref / sum(x[3] for x in sel), 2) if sel else None,
             "stops_year_oos": round(365 * sum(1 for x in sel if x[4] == "t") / nd, 1),
             "fills_under_1gbp": sum(1 for x in tr if x[3] / ref < 1.0), "fills": len(tr),
             "months_pct": {k: round(E * 100 * 12 * v / cap, 1) for k, v in sorted(mo.items())},
             "orders": R["extra"][name]["orders"]}
        res["rows"][name] = r
    # paired against the baseline (the same book's baseline for a USDC-GBP change)
    base = sers["base"]
    for name, s in sers.items():
        spec = R["specs"][name]
        if name == "base" or spec[0] != "USDC-GBP" or spec[3] != 50 or name.startswith("size"):
            continue
        dlt = s - base
        a, b = allD.index(D["oos"][0]), allD.index(D["oos"][-1]) + 1
        oo = dlt[a:b]
        bm = S.mean_boot(oo)
        sa = allD.index(D["sep"][0])
        mo = collections.defaultdict(float)
        for k, v in zip(allD, dlt):
            mo[k[:7]] += v
        pos = sum(1 for v in mo.values() if v > 1e-9)
        p = {"oos_gbp_year": round(E * 365 * float(oo.mean()), 2), "oos_p_le0": round(float((bm <= 0).mean()), 4),
             "since_0901_gbp_year": round(E * 365 * float(dlt[sa:].mean()), 2), "is_gbp_year": round(E * 365 * float(dlt[:a].mean()), 2),
             "months_positive": [pos, len(mo)], "months_negative": sum(1 for v in mo.values() if v < -1e-9)}
        p["passes"] = bool(p["oos_gbp_year"] > 0 and p["oos_p_le0"] < 0.10 and p["since_0901_gbp_year"] >= 0 and pos * 3 >= 2 * len(mo))
        res["pairs"][name] = p
    # the post-only check against the recorder's touch
    touch = C.load_touch()
    for name in ("base", "eur"):
        b = R["specs"][name][0]
        tick = C.TICK[b]
        gl = R["extra"][name].get("golive") or []
        acc = [r for r in gl if r[3]]
        seen = cross = 0
        for t, side, price, ok, mode in acc:
            tc = touch[b].get(t // 60000)
            if not tc:
                continue
            seen += 1
            px = price * tick
            if (side == "bid" and px >= tc[2] - 1e-12) or (side == "ask" and px <= tc[1] + 1e-12):
                cross += 1
        res["rows"][name]["postonly"] = {"went_live": len(acc), "refused_by_last_print": sum(1 for r in gl if not r[3]), "with_touch": seen,
                                          "touch_would_cross": cross}
    # the coin the asks hold: a dollar position, marked at GBP/USD each day
    d0 = [S.ms(x) for x in allD]
    gd = np.array([float(g[(t - EL.FROM) // 60000]) for t in d0])
    gd = np.where(np.isnan(gd), np.nan, gd)
    for i in range(1, len(gd)):
        if np.isnan(gd[i]):
            gd[i] = gd[i - 1]
    usd_val = 1.0 / gd                          # pounds per dollar
    dpl = np.diff(usd_val, prepend=usd_val[0])   # the pounds a dollar held gains each day
    fx = {}
    for name in ("base", "asks_one", "bids_only", "eur"):
        spec = R["specs"][name]
        r = spec[2].get("rungs")
        ask_usd = spec[3] * (sum(w for s_, _, w in r if s_ == "ask") if r else 3.0)
        if spec[0] == "USDC-EUR":
            continue
        pl = ask_usd * dpl
        a = allD.index(D["oos"][0]); sa = allD.index(D["sep"][0])
        strat = sers[name]
        fx[name] = {"ask_usd": ask_usd, "fx_sd_gbp_year": round(float(pl[a:].std() * np.sqrt(365)), 2),
                    "fx_gbp_oos": round(float(pl[a:].sum()), 2), "fx_gbp_since_0901": round(float(pl[sa:].sum()), 2),
                    "strategy_sd_gbp_year_oos": round(float(strat[a:].std() * np.sqrt(365)), 2),
                    "strategy_gbp_year_since_0901": round(E * 365 * float(strat[sa:].mean()), 2),
                    "ratio_since_0901": round(E * 365 * float(strat[sa:].mean()) / float(np.sqrt((pl[a:].std() ** 2 + strat[a:].std() ** 2) * 365)), 2)}
    res["inventory_fx"] = fx
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)
    for name, r in res["rows"].items():
        print(f"{name:20s} sep {r['since_0901_pct']:6.1f} {r['since_0901_i80']} blend {r['blend_pct']:6.1f} oos {r['oos_pct']:6.1f} is {r['is_pct']:6.1f} "
              f"£/yr sep {r['since_0901_gbp_year']:7.1f} cap £{r['capital_gbp']:.0f} trips/d {r['trips_day_oos']} bps {r['bps_trip_oos']} stops {r['stops_year_oos']} "
              f"{res['pairs'].get(name, '')}")
    print(res["inventory_fx"])
    print({k: res["rows"][k].get("postonly") for k in ("base", "eur")})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
