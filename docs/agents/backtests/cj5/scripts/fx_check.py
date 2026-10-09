"""The FX and USD references, checked before any P&L: is EXN interbank over 2020-2026, does the October splice to Yahoo
agree with it, did the stablecoins hold their peg, and how far is the chosen fairU from PR5's own (Revolut X's USD books).

* EXN minute mid against FXCM's 1-minute bid/ask mid on one week a quarter (2020-W19 -> 2026-W06; FXCM answers 404 for
  2026-W18..W31) and against Yahoo's hourly GBPUSD=X closes (2 years), weekdays only, as PR5's fx_build.py compares;
* EXN against Yahoo's 1-minute closes where both exist (2026-09-10 -> 09-30), the month before the splice;
* this study's EXN series against PR5's committed series_EXN on their common minutes (the same source, built again);
* USDC and USDT hourly closes: the extremes by year and every hour more than 50 bps from $1 (the de-peg check), and
  the chosen USDT source against Bitstamp's USDT/USD; fairU (F3) against Revolut X's F3 where both exist.
usage: python3 -I fx_check.py RAW_DIR   -> ../results/fx_check.json
"""
import bisect, csv, datetime, glob, gzip, io, json, os, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inputs as I  # noqa: E402
from vbook import fair_f3, P  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M = 60000


def dist(devs):
    if not devs:
        return None
    a = sorted(abs(x) for x in devs)
    q = lambda arr, p: arr[min(len(arr) - 1, int(p * (len(arr) - 1)))]
    return {"n": len(devs), "median_bps": round(st.median(devs), 3), "median_abs_bps": round(st.median(a), 3),
            "p95_abs_bps": round(q(a, 0.95), 3), "p99_abs_bps": round(q(a, 0.99), 3), "max_abs_bps": round(a[-1], 2)}


def weekday(t):
    d = datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc)
    return not (d.weekday() == 5 or (d.weekday() == 6 and d.hour < 21) or (d.weekday() == 4 and d.hour >= 21))


def main(raw):
    fx_t, fx_v = I.load_fx()
    fx = dict(zip(fx_t, fx_v))
    R = {}
    # FXCM sample weeks
    weeks = {}
    for fn in sorted(glob.glob(os.path.join(raw, "fx", "fxcm", "GBPUSD_*.csv.gz"))):
        devs = []
        for row in csv.DictReader(io.TextIOWrapper(gzip.open(fn), encoding="utf-8-sig")):
            t = int(datetime.datetime.strptime(row["DateTime"][:16], "%m/%d/%Y %H:%M").replace(tzinfo=datetime.timezone.utc).timestamp()) * 1000
            v = (float(row["BidClose"]) + float(row["AskClose"])) / 2
            if t in fx and weekday(t):
                devs.append((fx[t] / v - 1) * 1e4)
        weeks[os.path.basename(fn)[7:-7]] = dist(devs)
    R["EXN_vs_FXCM_1m_by_week"] = weeks
    # Yahoo hourly: its close against EXN's last minute of the hour
    y = json.load(open(os.path.join(raw, "fx", "yahoo", "GBPUSD_1h_2y.json")))["chart"]["result"][0]
    devs = []
    for t, c in zip(y["timestamp"], y["indicators"]["quote"][0]["close"]):
        tt = t * 1000 + 59 * M
        k = bisect.bisect_right(fx_t, tt) - 1
        if c and t * 1000 % 3600000 == 0 and k >= 0 and fx_t[k] >= tt - 5 * M and weekday(t * 1000) and t * 1000 < I.ms("2026-10-01T00:00"):
            devs.append((fx_v[k] / c - 1) * 1e4)
    R["EXN_vs_yahoo_1h_2y"] = dist(devs)
    # Yahoo 1m against EXN, September 2026 (the month before the splice)
    yh = {}
    for fn in sorted(glob.glob(os.path.join(raw, "fx", "yahoo", "GBPUSD_1m_*.json"))):
        r = json.load(open(fn))["chart"]["result"][0]
        for ts, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
            if c:
                yh[ts * 1000 // M * M] = c
    devs = [(yh[t] / fx[t] - 1) * 1e4 for t in yh if t in fx and t < I.ms("2026-10-01T00:00") and weekday(t)]
    R["yahoo_1m_vs_EXN_2026-09-10_to_09-30"] = dist(devs)
    # the same source built twice
    pr5 = P.fx_series()
    common = [t for t in pr5 if t in fx]
    R["EXN_vs_PR5_committed_EXN"] = {"common_minutes": len(common), "max_abs_diff": max(abs(pr5[t] - fx[t]) for t in common),
                                     "pr5_minutes": len(pr5)}
    # the stablecoins' dollar value
    usd = I.load_usd()
    dep = {}
    for c in ("USDC", "USDT"):
        rows = usd[c]
        by = {}
        for h, v in rows:
            yv = datetime.datetime.fromtimestamp(h / 1000, datetime.timezone.utc).strftime("%Y")
            b = by.setdefault(yv, [9, 0, 0])
            b[0] = min(b[0], v); b[1] = max(b[1], v); b[2] += 1
        far = [(h, v) for h, v in rows if abs(v - 1) > 0.005]
        eps, cur = [], None
        for h, v in far:
            if cur and h - cur["last"] <= 6 * 3600000:
                cur["last"] = h; cur["hours"] += 1; cur["min"] = min(cur["min"], v); cur["max"] = max(cur["max"], v)
            else:
                cur = {"first": h, "last": h, "hours": 1, "min": v, "max": v}; eps.append(cur)
        iso = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
        dep[c] = {"hours": len(rows), "first": iso(rows[0][0]), "last": iso(rows[-1][0]),
                  "by_year": {k: {"min": v[0], "max": v[1], "hours": v[2]} for k, v in sorted(by.items())},
                  "hours_beyond_50bps": len(far),
                  "episodes_beyond_50bps": [{"first": iso(e["first"]), "last": iso(e["last"]), "hours": e["hours"], "min": e["min"], "max": e["max"]} for e in eps]}
    bt = dict(usd["USDT_bitstamp"])
    dv = [(v / bt[h] - 1) * 1e4 for h, v in usd["USDT"] if h in bt]
    dep["USDT_coinbase_vs_bitstamp"] = dist(dv)
    R["depeg"] = dep
    # fairU against PR5's own F3 (Revolut X's USD books) on their common minutes
    rx = {}
    for b in P.BOOKS:
        hrs = json.load(P._open(os.path.join(P.S, "data", "candles", f"{P.USD_OF[b]}_60.json")))["rows"]
        rx[P.USD_OF[b]] = ([int(h["start"]) for h in hrs], [float(h["close"]) for h in hrs])
    cmp_ = {}
    for c, rxb in (("USDC", "USDC-USD"), ("USDT", "USDT-USD")):
        t0, t1 = max(I.ms("2025-11-28T00:00"), rx[rxb][0][0] + 86400000), I.ms("2026-09-23T00:00")
        a = fair_f3([h for h, _ in usd[c]], [v for _, v in usd[c]], t0, t1)
        b = fair_f3(rx[rxb][0], rx[rxb][1], t0, t1)
        d = [(a[t] / b[t] - 1) * 1e4 for t in range(t0, t1, 60 * M) if a.get(t) and b.get(t)]
        cmp_[c] = dist(d)
    R["fairU_vs_revx_F3_hourly_samples"] = cmp_
    json.dump(R, open(os.path.join(HERE, "results", "fx_check.json"), "w"), indent=1, sort_keys=True)
    for k in ("EXN_vs_yahoo_1h_2y", "yahoo_1m_vs_EXN_2026-09-10_to_09-30", "EXN_vs_PR5_committed_EXN", "fairU_vs_revx_F3_hourly_samples"):
        print(k, R[k])
    print({k: v["median_abs_bps"] if v else None for k, v in weeks.items()})
    for c in ("USDC", "USDT"):
        print(c, dep[c]["by_year"], dep[c]["episodes_beyond_50bps"][:12])
    print(dep["USDT_coinbase_vs_bitstamp"])


if __name__ == "__main__":
    main(sys.argv[1])
