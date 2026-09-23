"""Interbank GBP/USD at minute resolution: build every candidate series and check each against independent references.

Candidates (built here, from the raw files in data/fx/):
  K_mid  — Kraken's public GBP/USD tape: per minute, the mean of the minute's last BUY-aggressor print (the ask) and
           last SELL-aggressor print (the bid) when both printed, else the minute's last print.
  K_last — Kraken: the minute's last print.
  FXCM   — FXCM's archive: the mean of the minute's bid close and ask close (weeks 2025-W45 -> 2026-W17 and
           2026-W32 -> W37 only: the archive answers 404 for 2026-W18 -> W31 and for the current week).
  EXN    — Exness's public monthly tick archive (ticks.ex2archive.com, bid/ask quotes with ms timestamps): the mid of the
           minute's last quote (the minute's close), every month of the span.
References: Yahoo GBPUSD=X hourly (range=2y, the brief's cross-check: its bar close against the candidate's last
minute of that hour), Yahoo's 1-minute closes PR3 used (2026-08-30 -> 09-23), and FXCM where it exists.
Writes data/fx/series_<name>.json ([[minute_ms, value], ...]) and results/fx_checks.json.
"""
import json, os, gzip, glob, csv, io, bisect, statistics as st, datetime, collections

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FX = os.path.join(S, "data", "fx")
M = 60000
SPAN0 = int(datetime.datetime(2025, 11, 22, tzinfo=datetime.timezone.utc).timestamp() * 1000)
SPAN1 = int(datetime.datetime(2026, 9, 23, tzinfo=datetime.timezone.utc).timestamp() * 1000)


def kraken_prints():
    seen, out = set(), []
    for l in open(os.path.join(FX, "kraken", "tape.pages.jsonl")):
        for r in json.loads(l)["rows"]:
            if r[6] in seen:
                continue
            seen.add(r[6])
            out.append((int(r[6]), float(r[2]), float(r[0]), float(r[1]), r[3]))
    out.sort()
    ids = [o[0] for o in out]
    gaps = [(ids[i - 1], ids[i]) for i in range(1, len(ids)) if ids[i] != ids[i - 1] + 1]
    return out, gaps


def kraken_minutes(prints):
    by = collections.OrderedDict()
    for tid, t, p, v, side in prints:
        m = int(t * 1000) // M * M
        d = by.setdefault(m, {"last": None, "b": None, "s": None, "n": 0})
        d["last"] = p; d[side] = p; d["n"] += 1
    mid, last = [], []
    for m, d in by.items():
        last.append((m, d["last"]))
        mid.append((m, (d["b"] + d["s"]) / 2 if d["b"] is not None and d["s"] is not None else d["last"]))
    return mid, last


def fxcm_minutes():
    out = {}
    for fn in sorted(glob.glob(os.path.join(FX, "fxcm", "GBPUSD_*.csv.gz"))):
        with gzip.open(fn, "rt") as f:
            for row in csv.DictReader(f):
                t = datetime.datetime.strptime(row["DateTime"], "%m/%d/%Y %H:%M:%S.%f").replace(tzinfo=datetime.timezone.utc)
                m = int(t.timestamp() * 1000)
                out[m] = (float(row["BidClose"]) + float(row["AskClose"])) / 2
    return sorted(out.items())


def exness_minutes():
    import zipfile
    out = {}
    for fn in sorted(glob.glob(os.path.join(FX, "exness", "Exness_GBPUSD_*.zip"))):
        z = zipfile.ZipFile(fn)
        with z.open(z.namelist()[0]) as f:
            next(f)
            for line in f:
                parts = line.decode().rstrip("\n").split(",")
                ts = parts[2].strip('"')
                # "2026-09-01 00:00:00.422Z"
                t = datetime.datetime.strptime(ts[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=datetime.timezone.utc)
                m = int(t.timestamp()) * 1000 // M * M
                out[m] = (float(parts[3]) + float(parts[4])) / 2      # later ticks overwrite: the minute's close
    return sorted(out.items())


def yahoo_hourly():
    d = json.load(open(os.path.join(FX, "yahoo_GBPUSD_1h_2y.json")))["chart"]["result"][0]
    q = d["indicators"]["quote"][0]
    return [(t * 1000, c) for t, c in zip(d["timestamp"], q["close"]) if c is not None and t * 1000 % 3600000 == 0]


def yahoo_1m_pr3():
    y = json.load(gzip.open("/home/user/daviesportfolios/docs/agents/backtests/inputs/first_principles_2026-09-23/ref/yahoo_GBPUSD_1m.json.gz", "rt"))
    return [(r[0], r[4]) for r in y]


def dist(devs):
    if not devs:
        return None
    a = sorted(abs(x) for x in devs); s = sorted(devs)
    q = lambda arr, p: arr[min(len(arr) - 1, int(p * (len(arr) - 1)))]
    return {"n": len(devs), "median_bps": round(st.median(devs), 3), "mean_bps": round(st.mean(devs), 3),
            "p01": round(q(s, 0.01), 2), "p05": round(q(s, 0.05), 2), "p95": round(q(s, 0.95), 2), "p99": round(q(s, 0.99), 2),
            "median_abs": round(st.median(a), 3), "p95_abs": round(q(a, 0.95), 3), "p99_abs": round(q(a, 0.99), 3), "max_abs": round(a[-1], 2),
            "share_abs_gt_2bps": round(sum(1 for x in a if x > 2) / len(a), 4), "share_abs_gt_5bps": round(sum(1 for x in a if x > 5) / len(a), 4),
            "share_abs_gt_10bps": round(sum(1 for x in a if x > 10) / len(a), 4)}


def at_or_before(series_t, series_v, t, maxage):
    i = bisect.bisect_right(series_t, t) - 1
    if i < 0 or series_t[i] < t - maxage:
        return None
    return series_v[i]


def compare(cand, ref, ref_is_hourly, lag_min=0, weekday_only=True, t0=SPAN0, t1=SPAN1):
    ct = [t for t, _ in cand]; cv = [v for _, v in cand]
    devs, bymonth = [], collections.defaultdict(list)
    for t, v in ref:
        if not (t0 <= t < t1):
            continue
        # the reference's value is the price at the END of its bar (hourly: the last minute h+59; 1-minute: the minute itself)
        tt = t + (59 * M if ref_is_hourly else 0) + lag_min * M
        c = at_or_before(ct, cv, tt, 5 * M)
        if c is None:
            continue
        dt = datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc)
        if weekday_only and (dt.weekday() == 5 or (dt.weekday() == 6 and dt.hour < 21) or (dt.weekday() == 4 and dt.hour >= 21)):
            continue
        dv = (c / v - 1) * 1e4
        devs.append(dv); bymonth[dt.strftime("%Y-%m")].append(dv)
    return dist(devs), {k: {"n": len(v), "median_bps": round(st.median(v), 3), "median_abs": round(st.median([abs(x) for x in v]), 3),
                           "p95_abs": round(sorted(abs(x) for x in v)[int(0.95 * (len(v) - 1))], 3)} for k, v in sorted(bymonth.items())}


def main():
    kp, kgaps = kraken_prints()
    kmid, klast = kraken_minutes(kp)
    fx = fxcm_minutes()
    ex = exness_minutes()
    yh = yahoo_hourly()
    y1 = yahoo_1m_pr3()
    for name, ser in (("K_mid", kmid), ("K_last", klast), ("FXCM", fx), ("EXN", ex)):
        json.dump(ser, open(os.path.join(FX, f"series_{name}.json"), "w"))
    R = {"kraken_tape": {"prints": len(kp), "first": datetime.datetime.fromtimestamp(kp[0][1], datetime.timezone.utc).isoformat(),
                         "last": datetime.datetime.fromtimestamp(kp[-1][1], datetime.timezone.utc).isoformat(),
                         "trade_id_gaps": len(kgaps), "gap_examples": kgaps[:10], "minutes_with_prints": len(kmid)},
         "fxcm": {"minutes": len(fx), "first": datetime.datetime.fromtimestamp(fx[0][0] / 1000, datetime.timezone.utc).isoformat() if fx else None,
                  "last": datetime.datetime.fromtimestamp(fx[-1][0] / 1000, datetime.timezone.utc).isoformat() if fx else None},
         "exness": {"minutes": len(ex), "first": datetime.datetime.fromtimestamp(ex[0][0] / 1000, datetime.timezone.utc).isoformat(),
                    "last": datetime.datetime.fromtimestamp(ex[-1][0] / 1000, datetime.timezone.utc).isoformat()},
         "yahoo_hourly": {"bars": len(yh)}}
    for name, ser in (("K_mid", kmid), ("K_last", klast), ("FXCM", fx), ("EXN", ex)):
        d, bm = compare(ser, yh, True)
        R[f"{name}_vs_yahoo_1h"] = {"all": d, "by_month": bm}
        best = None
        for lag in (-2, -1, 0, 1, 2):
            dd, _ = compare(ser, y1, False, lag_min=lag)
            R.setdefault(f"{name}_vs_yahoo_1m_pr3_by_lag", {})[str(lag)] = dd
    for name, ser in (("K_mid", kmid), ("K_last", klast), ("EXN", ex)):
        d, bm = compare(ser, fx, False)
        R[f"{name}_vs_FXCM_1m"] = {"all": d, "by_month": bm}
    d, bm = compare(kmid, ex, False)
    R["K_mid_vs_EXN_1m"] = {"all": d, "by_month": bm}
    json.dump(R, open(os.path.join(S, "results", "fx_checks.json"), "w"), indent=1, sort_keys=True)
    for k, v in R.items():
        if isinstance(v, dict) and "all" in v:
            print(k, json.dumps(v["all"]))
        elif "by_lag" in k:
            print(k, {lag: (x and {kk: x[kk] for kk in ("n", "median_bps", "median_abs", "p95_abs")}) for lag, x in v.items()})
        else:
            print(k, json.dumps(v)[:300])


if __name__ == "__main__":
    main()
