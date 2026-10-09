"""PAIRS: classic distance-method pairs trading (Gatev, Goetzmann and Rouwenhorst) on 98 large US names in ten sectors.

The rule, written before the first run (the textbook's, with sector-matched pairs):
  * prices: Yahoo's dividend-adjusted daily close; a period = 252 trading days to form, the next 126 to trade, a new
    period every 126 days from 2015-01-02 (overlapping, as the textbook).
  * formation: in each sector, every pair's sum of squared differences of the two cumulative-return indices; the 20
    smallest across all sectors are traded. sigma = the formation spread's standard deviation.
  * trading: indices restart at 1 on the first trading day; open when |spread| > 2 sigma ($1 long the low, $1 short the
    high), close when the spread crosses zero or the period ends; a pair may reopen.
  * return on committed capital per period = sum of the 20 pairs' payoffs / 20; the overlapping periods are averaged
    into a monthly series as the textbook does (each month is the mean of the periods live in it).
  * costs: 4 legs x 2 bps half-spread a round trip, plus the short's borrow: "broker" 0.5 %/yr on the gross position
    (a margin account with general-collateral borrow), "cfd" 5 %/yr (long pays benchmark + 2.5 %, short receives
    benchmark - 2.5 %: 5 % net on the $1 of each side, as UK CFD terms go).
Survivorship: the names are today's; HES and K (acquired in 2025) are missing; the bias makes this an upper bound.
Output: results/eq_pairs.json (deterministic).
"""
import gzip, json, math, os, statistics as st
import datetime as dt

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Y = os.path.join(HERE, "inputs", "yahoo", "pairs_d")
import importlib.util
spec = importlib.util.spec_from_file_location("py", os.path.join(os.path.dirname(os.path.abspath(__file__)), "pull_yahoo.py"))
PY = importlib.util.module_from_spec(spec)
spec.loader.exec_module(PY)
SECTORS = PY.PAIRS


def load(sym):
    p = os.path.join(Y, sym + ".json.gz")
    if not os.path.exists(p):
        return None
    j = json.loads(gzip.open(p).read())["chart"]["result"][0]
    adj = j["indicators"]["adjclose"][0]["adjclose"]
    return {dt.datetime.utcfromtimestamp(t).date(): a for t, a in zip(j["timestamp"], adj) if a}


def main():
    px = {s: load(s) for v in SECTORS.values() for s in v}
    px = {s: v for s, v in px.items() if v}
    spy = load("SPY")
    days = sorted(d for d in spy if d >= dt.date(2015, 1, 2))
    sector_of = {s: k for k, v in SECTORS.items() for s in v if s in px}
    results = {"names": len(px), "missing": sorted(s for v in SECTORS.values() for s in v if s not in px), "periods": []}
    monthly = {"gross": {}, "broker": {}, "cfd": {}}
    start = 0
    while start + 252 + 126 <= len(days):
        F = days[start:start + 252]
        T = days[start + 252:start + 378]
        names = [s for s in px if all(d in px[s] for d in (F[0], F[-1], T[0], T[-1]))]
        idx = {}
        for s in names:
            p0 = px[s][F[0]]
            seq = [px[s].get(d) for d in F]
            if any(v is None for v in seq):
                continue
            idx[s] = [v / p0 for v in seq]
        cands = []
        for sec, mem in SECTORS.items():
            m = [s for s in mem if s in idx]
            for i in range(len(m)):
                for j in range(i + 1, len(m)):
                    a, b = idx[m[i]], idx[m[j]]
                    ssd = sum((x - y) ** 2 for x, y in zip(a, b))
                    cands.append((ssd, m[i], m[j], st.pstdev([x - y for x, y in zip(a, b)])))
        cands.sort()
        top = cands[:20]
        per = {"form_start": str(F[0]), "trade_start": str(T[0]), "trade_end": str(T[-1]), "pairs": [], "trades": 0}
        pay = {"gross": 0.0, "broker": 0.0, "cfd": 0.0}
        daily_pnl = {k: [0.0] * len(T) for k in pay}
        for _, a, b, sig in top:
            A = [px[a].get(d) for d in T]
            B = [px[b].get(d) for d in T]
            # carry forward a missing day
            for arr in (A, B):
                for i in range(len(arr)):
                    if arr[i] is None:
                        arr[i] = arr[i - 1]
            na = [x / A[0] for x in A]
            nb = [x / B[0] for x in B]
            open_ = None
            for i in range(len(T)):
                s = na[i] - nb[i]
                if open_ is None and abs(s) > 2 * sig and i < len(T) - 1:
                    open_ = (i, 1 if s < 0 else -1)  # +1: long A short B
                elif open_ is not None and ((open_[1] == 1 and s >= 0) or (open_[1] == -1 and s <= 0) or i == len(T) - 1):
                    i0, d = open_
                    g = d * ((A[i] / A[i0] - 1) - (B[i] / B[i0] - 1))
                    held = (dt.date.fromisoformat(str(T[i])) - dt.date.fromisoformat(str(T[i0]))).days
                    pay["gross"] += g
                    pay["broker"] += g - 0.0008 - 0.005 * 2 * held / 365
                    pay["cfd"] += g - 0.0008 - 0.05 * 2 * held / 365 / 2
                    per["trades"] += 1
                    open_ = None
            per["pairs"].append(f"{a}/{b}")
        for k in pay:
            per[f"return_{k}_pct"] = round(100 * pay[k] / 20, 3)
        results["periods"].append(per)
        # spread each period's return evenly over its 6 months for the monthly average
        months = sorted({(d.year, d.month) for d in T})
        for k in pay:
            for mth in months:
                monthly[k].setdefault(mth, []).append(pay[k] / 20 / len(months))
        start += 126
    for k in monthly:
        # each month: the mean of the live portfolios' monthly returns (a portfolio's 6-month return / 6), as the textbook
        series = [sum(v) / len(v) for _, v in sorted(monthly[k].items())]
        ann = sum(series) / len(series) * 12
        sd = st.pstdev(series) * math.sqrt(12)
        by_year = {}
        for (y, _), v in zip(sorted(monthly[k]), series):
            by_year[y] = by_year.get(y, 0) + v
        results[f"annual_{k}"] = {"mean_pct_per_year": round(100 * ann, 2), "sd_pct": round(100 * sd, 2),
                                  "sharpe_excess_free": round(ann / sd, 2) if sd else None,
                                  "by_year_pct": {y: round(100 * v, 2) for y, v in sorted(by_year.items())}}
    json.dump(results, open(os.path.join(HERE, "results", "eq_pairs.json"), "w"), indent=1, sort_keys=True)
    for k in ("gross", "broker", "cfd"):
        print(k, results[f"annual_{k}"])
    print(len(results["periods"]), "periods;", sum(p["trades"] for p in results["periods"]), "trades")


if __name__ == "__main__":
    main()
