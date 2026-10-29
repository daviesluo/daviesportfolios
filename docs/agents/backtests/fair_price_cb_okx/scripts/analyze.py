"""Tables of the fair-price study from hist.py's and prod.py's runs: P&L, trips, bps a trip, stops, by half, by book, and
each candidate against the engine's fair, paired by UTC day (entry day) with a day-block bootstrap (2,000 draws, seed
20261029, 5th and 95th percentiles of the mean daily difference).

The selection rule, fixed in this file before its output was read: within each family, the member with the highest
in-sample P&L summed over the four books (history IS, 2025-11-21 → 2026-05-15) is the family's pick; it is then read out of
sample (history OOS 2026-05-15 → 10-09) and on production (10-10/13 → 10-29) without being re-chosen. Rows that read the FX
bar of the minute being decided (`engine_fx_foresight`) are a bound, never a pick.
usage: python3 -I analyze.py HIST_RUNS.json.gz PROD_RUNS.json OUT.json
"""
import collections, gzip, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fpc as C  # noqa: E402

M, DAY = C.M, C.DAY
HB = ["coinbase:USDC-GBP", "coinbase:USDT-GBP", "coinbase:USDC-EUR", "coinbase:USDT-EUR"]


def family(name):
    n = name.split(":", 1)[-1]
    if n in ("engine", "par", "cb_own", "screen", "cb_live", "stored"):
        return "coin dollar"
    if n.startswith("engine+b"):
        return "engine + basis"
    if n.startswith("cb_own+b"):
        return "cb_own + basis"
    if n.startswith("cb_live+b"):
        return "cb_live + basis"
    if n.startswith("venue_"):
        return "venue only"
    if n.startswith("xbook"):
        return "cross-book FX"
    return "fx timing (bound)"


def stats(trips, t0, t1, pnl_ix=2):
    sel = [x for x in trips if t0 <= x[0] < t1]
    pnl = sum(x[pnl_ix] for x in sel)
    nt = sum(x[3] for x in sel)
    d = collections.Counter()
    for x in sel:
        d[C.day_of(x[0])] += x[pnl_ix]
    return {"trips": len(sel), "pnl": round(pnl, 4), "bps_per_trip": round(1e4 * pnl / nt, 2) if nt else None,
            "stops": sum(1 for x in sel if x[4] == "t"), "stop_pnl": round(sum(x[pnl_ix] for x in sel if x[4] == "t"), 4),
            "bids": sum(1 for x in sel if x[5] == "b"), "asks": sum(1 for x in sel if x[5] == "a"), "daily": dict(d)}


def compare(runs, books, names, base, windows, pnl_ix, per_year_days):
    """runs[(book, name)] -> trips. For each name: per window the four books' totals and each book, and the paired bootstrap
    of the daily total against `base`."""
    out = {}
    for name in names:
        r = {}
        for w, (t0, t1) in windows.items():
            days = C.days_between(t0, t1)
            tot = {"pnl": 0.0, "trips": 0, "stops": 0, "stop_pnl": 0.0, "bids": 0, "asks": 0}
            daily, bdaily, per = collections.Counter(), collections.Counter(), {}
            notional = 0.0
            for b in books:
                s = stats(runs[(b, name)], t0, t1, pnl_ix)
                sb = stats(runs[(b, base)], t0, t1, pnl_ix)
                per[b] = {k: v for k, v in s.items() if k != "daily"} | {"vs_base": round(s["pnl"] - sb["pnl"], 4)}
                for k in tot:
                    tot[k] += s[k]
                for d, v in s["daily"].items():
                    daily[d] += v
                for d, v in sb["daily"].items():
                    bdaily[d] += v
                notional += sum(x[3] for x in runs[(b, name)] if t0 <= x[0] < t1)
            ndays = len(days)
            tot = {k: round(v, 4) if isinstance(v, float) else v for k, v in tot.items()}
            tot["per_year"] = round(tot["pnl"] / ndays * per_year_days, 2) if ndays else None
            tot["bps_per_trip"] = round(1e4 * tot["pnl"] / notional, 2) if notional else None
            dv = [daily.get(d, 0.0) for d in days]
            if dv:
                mu = sum(dv) / len(dv)
                tot["daily_sd"] = round((sum((v - mu) ** 2 for v in dv) / len(dv)) ** 0.5, 4)
                tot["worst_day"] = round(min(dv), 4)
                cum = peak = mdd = 0.0
                for v in dv:
                    cum += v; peak = max(peak, cum); mdd = max(mdd, peak - cum)
                tot["max_drawdown_by_day"] = round(mdd, 4)
            bs = C.bootstrap_paired(daily, bdaily, days)
            r[w] = {"total": tot, "books": per, "days": ndays,
                    "vs_base_per_year": None if bs is None else {k: (round(v * 365, 2) if k != "share_gt0" else round(v, 3)) for k, v in bs.items()}}
        out[name] = r
    return out


def pick(table, names, win="IS"):
    fam = collections.defaultdict(list)
    for n in names:
        fam[family(n)].append(n)
    res = {}
    for f, ns in fam.items():
        if f == "fx timing (bound)":
            continue
        best = max(ns, key=lambda n: table[n][win]["total"]["pnl"])
        res[f] = best
    return res


def main(hist_path, prod_path, out_path):
    res = {}
    if hist_path != "-":
        h = json.load(gzip.open(hist_path, "rt"))
        T0, TS, T1 = h["window"]["T0"], h["window"]["TS"], h["window"]["T1"]
        runs = {}
        names = None
        for b, d in h["books"].items():
            for n, r in d["runs"].items():
                runs[(b, n)] = r["trips"]
            names = names or sorted(d["runs"])
        W = {"IS": (T0, TS), "OOS": (TS, T1), "all": (T0, T1)}
        res["hist"] = {}
        sk = "|skew0.0" if any("|skew" in n for n in names) else ""     # skew.py's runs: the unskewed engine is the base
        for arm, base in (("base", "engine" + sk), ("hold", "hold:engine" + sk)):
            ns = [n for n in names if (n.startswith("hold:") == (arm == "hold"))]
            tab = compare(runs, HB, ns, base, W, 2, 365)
            res["hist"][arm] = {"table": tab, "picks": pick(tab, ns), "orders": {n: sum(h["books"][b]["runs"][n]["orders"] for b in HB) for n in ns}}
            # per book: the best in-sample candidate of each book on its own, read out of sample
            pb = {}
            for b in HB:
                cand = [n for n in ns if family(n) != "fx timing (bound)"]
                best = max(cand, key=lambda n: tab[n]["IS"]["books"][b]["pnl"])
                pb[b] = {"pick": best, "IS": tab[best]["IS"]["books"][b], "OOS": tab[best]["OOS"]["books"][b],
                         "base_IS": tab[base]["IS"]["books"][b], "base_OOS": tab[base]["OOS"]["books"][b]}
            res["hist"][arm]["per_book_picks"] = pb
    if prod_path != "-":
        p = json.load(gzip.open(prod_path, "rt") if prod_path.endswith(".gz") else open(prod_path))
        runs = collections.defaultdict(list)
        names = set()
        for k, v in p["runs"].items():
            arm, b, n = k.split("|")
            runs[(arm, b, n)] = v
            names.add(n)
        names = sorted(names)
        res["prod"] = {"reproduce": p["reproduce"]}
        for arm in ("base", "hold"):
            t0 = C.iso_ms("2026-10-10T00:00:00Z" if arm == "base" else "2026-10-13T00:00:00Z")
            TS, T1 = C.iso_ms("2026-10-20T00:00:00Z"), C.iso_ms("2026-10-29T00:00:00Z")
            rr = {(b, n): runs[(arm, b, n)] for b in C.BOOKS for n in names}
            tab = compare(rr, C.BOOKS, names, "stored", {"first": (t0, TS), "second": (TS, T1), "all": (t0, T1)}, 7, 365)
            res["prod"][arm] = {"table": tab}
    json.dump(res, open(out_path, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(*sys.argv[1:4])
