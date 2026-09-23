"""Which print-era proxy reproduces PR3's fair value? Decided on the 28 days where PR3's own input exists, before any P&L.

PR3's fairU(S,t) = median of the S/USD UK 1-minute candle closes of minutes [t-1440, t-1] (>= 60 closes). Those candles
exist for 28 days only. Proxies that exist for the whole span, all from the UK book:
  F1 — median of the UK print prices in [t-1440 min, t-1 min] (count-weighted; >= 1 print)
  F2 — time-weighted: median over the minutes [t-1440, t-1] of the last UK print at or before each minute's end
  F3 — median of the closes of the UK hourly candles lying wholly inside [t-1440 min, t) (mostly quote mids, like PR3's)
Every minute t from 2026-08-27 00:00 to 2026-09-23 00:00 on USDC-USD and USDT-USD; deviation = proxy/PR3 - 1 in bps.
usage: fair_check.py -> results/fair_check.json
"""
import json, os, sys, gzip, bisect, statistics as st, datetime
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_IN = "/home/user/daviesportfolios/docs/agents/backtests/inputs/first_principles_2026-09-23/revx_hist"
M = 60000
T0 = int(datetime.datetime(2026, 8, 27, tzinfo=datetime.timezone.utc).timestamp() * 1000)
T1 = int(datetime.datetime(2026, 9, 23, tzinfo=datetime.timezone.utc).timestamp() * 1000)


def rolling_median_fn(times, values, win):
    """median of values whose time lies in [t-win, t-1min] (times are minute starts or print times)."""
    import bisect as b
    def f(t):
        i, j = b.bisect_left(times, t - win), b.bisect_left(times, t)
        if j - i < 1:
            return None
        return st.median(values[i:j])
    return f


def main():
    out = {}
    for sym in (sys.argv[1:] or ["USDC-USD", "USDT-USD"]):
        bars = json.load(gzip.open(f"{REPO_IN}/{sym}_1m.json.gz", "rt"))
        # PR3's fair, exactly as its script computes it (a rolling window over the last 1,440 rows, >= 60)
        import collections
        pr3 = {}
        win, q = [], collections.deque()
        for r in bars:
            pr3[r[0]] = st.median(win) if len(win) >= 60 else None
            bisect.insort(win, r[4]); q.append(r[4])
            if len(q) > 1440:
                old = q.popleft(); win.pop(bisect.bisect_left(win, old))
        prints = [json.loads(l) for l in open(os.path.join(S, "data", "trades", f"{sym}.jsonl"))]
        uk = [(p["ts"], float(p["price"])) for p in prints if p["region"] == "UK"]
        pt = [a for a, _ in uk]; pv = [b for _, b in uk]
        F1 = rolling_median_fn(pt, pv, 1440 * M)
        # F2: per-minute last UK print (forward filled), then the median of the 1,440 minute values
        hours = json.load(open(os.path.join(S, "data", "candles", f"{sym}_60.json")))["rows"]
        ht = [int(h["start"]) for h in hours]; hc = [float(h["close"]) for h in hours]
        devs = {"F1": [], "F2": [], "F3": []}
        # minute grid of forward-filled last print
        m0 = T0 - 1440 * M
        grid_t = list(range(m0, T1, M))
        ff = []
        k = 0; last = None
        for m in grid_t:
            while k < len(pt) and pt[k] < m + M:
                last = pv[k]; k += 1
            ff.append(last)
        for idx, t in enumerate(range(T0, T1, M)):
            ref = pr3.get(t)
            if ref is None:
                continue
            a = F1(t)
            gi = (t - m0) // M
            window = [x for x in ff[gi - 1440: gi] if x is not None]
            b = st.median(window) if window else None
            i, j = bisect.bisect_left(ht, t - 1440 * M), bisect.bisect_right(ht, t - 60 * M)
            c = st.median(hc[i:j]) if j > i else None
            for name, v in (("F1", a), ("F2", b), ("F3", c)):
                if v is not None:
                    devs[name].append((v / ref - 1) * 1e4)
        res = {}
        for name, d in devs.items():
            a = sorted(abs(x) for x in d)
            res[name] = {"n": len(d), "median_bps": round(st.median(d), 3), "median_abs_bps": round(st.median(a), 3),
                         "p95_abs_bps": round(a[int(0.95 * (len(a) - 1))], 3), "max_abs_bps": round(a[-1], 3),
                         "share_exact_0": round(sum(1 for x in d if abs(x) < 1e-9) / len(d), 4)}
        res["uk_prints_in_window"] = sum(1 for x in pt if T0 - 1440 * M <= x < T1)
        out[sym] = res
        print(sym, json.dumps(res))
    syms = [s for s in out]
    score = {n: st.mean([out[s][n]["median_abs_bps"] for s in syms]) for n in ("F1", "F2", "F3")}
    out["mean_median_abs_bps"] = score
    out["chosen"] = min(score, key=lambda n: (score[n], st.mean([out[s][n]["p95_abs_bps"] for s in syms])))
    json.dump(out, open(os.path.join(S, "results", "fair_check.json"), "w"), indent=1, sort_keys=True)
    print("chosen", out["chosen"], score)


if __name__ == "__main__":
    main()
