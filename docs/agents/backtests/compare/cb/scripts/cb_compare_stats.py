"""CMP-CB's numbers: cb_compare.py's runs → results/cb_compare.json, on the comparison's shared method (review §2).

Per row, book and capital, in pounds and in % of the capital (P&L ÷ capital, simple annualised, × 365 ÷ days):
  * windows by the UTC day of each trip's exit: in sample 2024-10-01 → 2025-11-20; out of sample 2025-11-21 → 2026-10-28;
    recent, the last three months, 2026-07-29 → 10-28 (92 days); since 2026-09-01 (58 days); June–August 2026; a day with no
    trip counts 0.
  * HEADLINE, the next twelve months: the rate since 2026-09-01, the comparison's regime date (the Revolut X half's books
    tightened in the week of 08-24, and Coinbase's break the same month in `break`). Beside it the blend: ½ × the out-of-sample
    daily mean + ½ × the recent one (the recent days are inside the out-of-sample ones too, so they carry about 63 % of its weight).
  * an 80 % interval and P(year < 0) for each: 10,000 simulated years of 365 days, each built of 3-day circular blocks (seed
    20261029), drawn from the days since 09-01, or for the blend from the out-of-sample days or the recent ones with equal odds:
    the spread of a realised year if the next one is like them. It carries no allowance for another break (§5 of the review).
  * `break`: since 09-01 against June–August (a block bootstrap of the difference), and the single split of the daily series that
    best separates its means (Welch t, at least 30 days a side), over the whole window and out of sample, with t at 09-01.
  * the live factor e (`--haircut`, 0.825 unless given: the Revolut X half's LIVE realised ÷ its replay, 10-01 → 10-28), a
    multiplier on every P&L figure in `with_haircut`; the figures outside it are before e. It leaves P(year < 0) as it is.
  * out of sample: trips a day, bps a trip (P&L over notional), stops a year, the worst day, the deepest drawdown of the cumulative
    daily P&L, and the capital deployed on average (each position's notional × its time held, clipped to the window, over capital
    × the window).
usage: python3 -I cb_compare_stats.py RUNS.json.gz OUT.json [--haircut 0.825]
"""
import collections, datetime, gzip, json, sys

import numpy as np

SEED, NB, BLOCK = 20261029, 10_000, 3
DAY = 86_400_000
day = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
ms = lambda s: int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
W = {"is": ("2024-10-01", "2025-11-21"), "oos": ("2025-11-21", "2026-10-29"), "recent": ("2026-07-29", "2026-10-29"),
     "sep": ("2026-09-01", "2026-10-29"), "jun_aug": ("2026-06-01", "2026-09-01"), "all": ("2024-10-01", "2026-10-29")}
E_DEFAULT = 0.825      # the Revolut X half's e: LIVE's realised ÷ its replay on the same days, 10-01 → 10-28, both books pooled
MIN_SIDE = 30          # a breakpoint leaves at least this many days on each side


def days(a, b):
    return [day(t) for t in range(ms(a), ms(b), DAY)]


def year_sims(oos, rec=None):
    """365-day years of 3-day circular blocks: from `oos` alone, or from `oos` and `rec` with equal odds a block."""
    oos = np.asarray(oos)
    rec = oos if rec is None else np.asarray(rec)
    rng = np.random.default_rng(SEED)
    nb = -(-365 // BLOCK)
    pick = rng.random((NB, nb)) < 0.5
    so, sr = rng.integers(0, len(oos), (NB, nb)), rng.integers(0, len(rec), (NB, nb))
    off = np.arange(BLOCK)
    vo = oos[(so[:, :, None] + off) % len(oos)]
    vr = rec[(sr[:, :, None] + off) % len(rec)]
    v = np.where(pick[:, :, None], vr, vo).reshape(NB, -1)[:, :365]
    return v.sum(axis=1)


def mean_boot(v):
    """3-day circular block bootstrap of a window's mean: the draws (for a difference of two windows)."""
    v = np.asarray(v)
    n = len(v)
    rng = np.random.default_rng(SEED)
    nb = -(-n // BLOCK)
    s = rng.integers(0, n, (NB, nb))
    return v[((s[:, :, None] + np.arange(BLOCK)) % n).reshape(NB, -1)[:, :n]].mean(axis=1)


def breakscan(v, dd):
    """The single split of a daily series that best separates its means (Welch t), with ≥ MIN_SIDE days a side: its date,
    t and the two means; and the same at 2026-09-01. A scan's largest t is not a p-value: it is read against the t at the
    date named in advance and against the monthly rates."""
    v = np.asarray(v)
    best = None
    for k in range(MIN_SIDE, len(v) - MIN_SIDE + 1):
        a, b = v[:k], v[k:]
        t = (b.mean() - a.mean()) / np.sqrt(a.var(ddof=1) / len(a) + b.var(ddof=1) / len(b))
        if best is None or abs(t) > abs(best[1]):
            best = (dd[k], float(t), float(a.mean()), float(b.mean()))
    k = dd.index("2026-09-01")
    a, b = v[:k], v[k:]
    t0 = (b.mean() - a.mean()) / np.sqrt(a.var(ddof=1) / len(a) + b.var(ddof=1) / len(b))
    return best, float(t0)


def drawdown(v):
    c = np.cumsum(v)
    return float((np.maximum.accumulate(np.concatenate(([0.0], c)))[1:] - c).max())


def main(path, out, haircut):
    R = json.load(gzip.open(path, "rt"))
    D = {k: days(*v) for k, v in W.items()}
    res = {"windows": {k: [v[0], D[k][-1], len(D[k])] for k, v in W.items()}, "haircut_e": haircut, "meta": R["meta"],
           "rungs": R["rungs"], "x": R["x"], "rows": {}}
    o0, o1 = ms(W["oos"][0]), ms(W["oos"][1])
    for key, trips in sorted(R["runs"].items()):
        row, book, cap = key.split("|")
        cap = float(cap)
        d = collections.defaultdict(float)
        for x in trips:
            d[day(x[1])] += x[2]
        ser = {k: [d.get(x, 0.0) for x in D[k]] for k in D}
        rate = {k: 100 * 365 * float(np.mean(v)) / cap for k, v in ser.items()}
        head = 0.5 * rate["oos"] + 0.5 * rate["recent"]
        yrs = year_sims(ser["oos"], ser["recent"])
        p10, p90 = np.percentile(yrs, [10, 90])
        sel = [x for x in trips if o0 <= x[1] < o1]
        notional = sum(x[3] for x in sel)
        dep = sum(x[3] * max(0, min(x[1], o1) - max(x[0], o0)) for x in trips) / (cap * (o1 - o0))
        n_oos = len(D["oos"])
        r = {
            "headline_pct_year": round(head, 2), "interval80_pct_year": [round(100 * p10 / cap, 2), round(100 * p90 / cap, 2)],
            "p_year_below_0": round(float((yrs < 0).mean()), 4),
            "headline_gbp_year": round(head * cap / 100, 2), "interval80_gbp_year": [round(float(p10), 2), round(float(p90), 2)],
            "is_pct_year": round(rate["is"], 2), "oos_pct_year": round(rate["oos"], 2), "recent_pct_year": round(rate["recent"], 2),
            "oos": {"trips_day": round(len(sel) / n_oos, 2), "bps_trip": round(1e4 * sum(x[2] for x in sel) / notional, 2) if notional else None,
                    "stops_year": round(365 * sum(1 for x in sel if x[4] == "t") / n_oos, 1), "worst_day_gbp": round(min(ser["oos"]), 2),
                    "max_drawdown_gbp": round(drawdown(ser["oos"]), 2), "max_drawdown_pct": round(100 * drawdown(ser["oos"]) / cap, 2),
                    "deployed_pct": round(100 * dep, 1), "gbp": round(sum(ser["oos"]), 2)},
            "recent_gbp": round(sum(ser["recent"]), 2), "is_gbp": round(sum(ser["is"]), 2),
        }
        # how much a whole month moves: each full calendar month of the out-of-sample year (2025-12 → 2026-09), annualised
        mo = collections.defaultdict(list)
        for x, v in zip(D["oos"], ser["oos"]):
            mo[x[:7]].append(v)
        mrates = {k: round(100 * 365 * float(np.mean(v)) / cap, 2) for k, v in sorted(mo.items()) if "2025-12" <= k <= "2026-09"}
        r["oos_months_pct_year"] = mrates
        r["oos_months_range"] = [min(mrates.values()), float(np.median(list(mrates.values()))), max(mrates.values())]
        # since 2026-09-01: the Revolut X half's regime date, its own simulated years
        ys = year_sims(ser["sep"])
        q10, q90 = np.percentile(ys, [10, 90])
        r["since_0901_pct_year"] = round(rate["sep"], 2)
        r["since_0901_interval80_pct_year"] = [round(100 * q10 / cap, 2), round(100 * q90 / cap, 2)]
        r["since_0901_p_year_below_0"] = round(float((ys < 0).mean()), 4)
        r["jun_aug_pct_year"] = round(rate["jun_aug"], 2)
        diff = mean_boot(ser["sep"]) - mean_boot(ser["jun_aug"])
        r["sep_minus_jun_aug"] = {"pct_year": round(rate["sep"] - rate["jun_aug"], 2),
                                  "boot80_pct_year": [round(100 * 365 * float(np.percentile(diff, p)) / cap, 2) for p in (10, 90)],
                                  "p_not_lower": round(float((diff >= 0).mean()), 4)}
        best, t0901 = breakscan(ser["all"], D["all"])
        bo, t0901o = breakscan(ser["oos"], D["oos"])
        r["break"] = {"all": {"date": best[0], "t": round(best[1], 2), "before_pct_year": round(100 * 365 * best[2] / cap, 2),
                              "after_pct_year": round(100 * 365 * best[3] / cap, 2), "t_at_0901": round(t0901, 2)},
                      "oos": {"date": bo[0], "t": round(bo[1], 2), "before_pct_year": round(100 * 365 * bo[2] / cap, 2),
                              "after_pct_year": round(100 * 365 * bo[3] / cap, 2), "t_at_0901": round(t0901o, 2)}}
        e = haircut
        r["with_haircut"] = {"haircut": e, "headline_pct_year": round(e * head, 2), "interval80_pct_year": [round(e * x, 2) for x in r["interval80_pct_year"]],
                             "since_0901_pct_year": round(e * rate["sep"], 2),
                             "since_0901_interval80_pct_year": [round(e * x, 2) for x in r["since_0901_interval80_pct_year"]],
                             "oos_pct_year": round(e * rate["oos"], 2), "recent_pct_year": round(e * rate["recent"], 2),
                             "is_pct_year": round(e * rate["is"], 2), "headline_gbp_year": round(e * head * cap / 100, 2),
                             "since_0901_gbp_year": round(e * rate["sep"] * cap / 100, 2),
                             "p_year_below_0": r["p_year_below_0"], "since_0901_p_year_below_0": r["since_0901_p_year_below_0"]}
        res["rows"][key] = r
        print(f"{key:28s} head {head:6.2f}% [{r['interval80_pct_year'][0]:6.2f}, {r['interval80_pct_year'][1]:6.2f}] P<0 {r['p_year_below_0']:.4f} | "
              f"since0901 {rate['sep']:6.2f} {r['since_0901_interval80_pct_year']} P<0 {r['since_0901_p_year_below_0']} | jun-aug {rate['jun_aug']:6.2f} "
              f"| IS {rate['is']:6.2f} OOS {rate['oos']:6.2f} recent {rate['recent']:6.2f} | break {r['break']} | {r['sep_minus_jun_aug']}")
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    h = float(sys.argv[sys.argv.index("--haircut") + 1]) if "--haircut" in sys.argv else E_DEFAULT
    main(sys.argv[1], sys.argv[2], h)
