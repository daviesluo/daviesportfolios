"""Read sampler jsonl files and measure each keyless source against TrueFX: errors, latency, freshness, update rate,
level offset and lead/lag (by changes and by level), per pair.

usage: python3 -I analyse.py OUT.json FILE.jsonl [FILE.jsonl ...]
"""
import json, sys, statistics as st, math
from collections import defaultdict

out_path, files = sys.argv[1], sys.argv[2:]
import gzip
recs = []
for f in files:
    for line in (gzip.open(f, "rt") if f.endswith(".gz") else open(f)):
        recs.append(json.loads(line))

def q(xs, p):
    xs = sorted(xs)
    if not xs: return None
    k = (len(xs) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)

res = {"window": [min(r["sent"] for r in recs), max(r["recv"] for r in recs)], "sources": {}, "pairs": {}}
by_src = defaultdict(list)
for r in recs: by_src[r["src"]].append(r)
for s, rs in by_src.items():
    ok = [r for r in rs if "rows" in r]
    lat = [(r["recv"] - r["sent"]) * 1000 for r in ok]
    errs = defaultdict(int)
    for r in rs:
        if "err" in r: errs[r["err"][:60]] += 1
    res["sources"][s] = {"reads": len(rs), "ok": len(ok), "errors": dict(errs),
                         "latency_ms_p50": q(lat, .5), "latency_ms_p95": q(lat, .95), "latency_ms_max": max(lat) if lat else None}

# series: (source label, pair) -> list of (recv, src_ms or None, bid, ask)
series = defaultdict(list)
for r in recs:
    for row in r.get("rows", []):
        lab = r["src"].split("_")[0]
        series[(lab, row["pair"])].append((r["recv"], row.get("src_ms"), row["bid"], row["ask"]))
for k in series: series[k].sort()

for pair in ("GBPUSD", "EURUSD"):
    pr = {}
    tf = series.get(("truefx", pair), [])
    t0, t1 = res["window"]
    grid = [math.floor(t0) + 5 + i for i in range(int(t1 - t0) - 10)]
    def on_grid(ser, shift=0.0):
        # value known at grid time g + shift: the latest read received at or before then (by our receive time)
        out, j = [], -1
        for g in grid:
            while j + 1 < len(ser) and ser[j + 1][0] <= g + shift: j += 1
            out.append((ser[j][2] + ser[j][3]) / 2 if j >= 0 else None)
        return out
    base = on_grid(tf)
    for lab in ("truefx", "kraken", "bitstamp", "cb"):
        ser = series.get((lab, pair), [])
        if not ser: continue
        d = {}
        mids = [(a + b) / 2 for _, _, a, b in ser]
        spreads = [(b - a) / ((a + b) / 2) * 1e4 for _, _, a, b in ser]
        d["reads"] = len(ser)
        # how often the quote changed between consecutive reads
        ch = sum(1 for i in range(1, len(ser)) if (ser[i][2], ser[i][3]) != (ser[i - 1][2], ser[i - 1][3]))
        d["changed_share"] = ch / max(1, len(ser) - 1)
        d["spread_bps_p50"] = q(spreads, .5)
        ages = [(rv * 1000 - sm) for rv, sm, _, _ in ser if sm is not None]
        if ages:
            d["age_at_receipt_ms_p50"] = q(ages, .5); d["age_ms_p95"] = q(ages, .95); d["age_ms_min"] = min(ages)
            # does the source timestamp move between reads?
            d["src_ts_changed_share"] = sum(1 for i in range(1, len(ser)) if ser[i][1] != ser[i - 1][1]) / max(1, len(ser) - 1)
        if lab != "truefx":
            g = on_grid(ser)
            diffs = [(x - y) / y * 1e4 for x, y in zip(g, base) if x is not None and y is not None]
            d["offset_vs_truefx_bps_p50"] = q(diffs, .5)
            d["absdiff_vs_truefx_bps_p50"] = q([abs(x - q(diffs, .5)) for x in diffs], .5)
            # lead/lag by level: shift the source's series by s seconds; best s minimises median |diff - offset|
            lv = {}
            for sh in range(-8, 11):
                gs = on_grid(ser, sh)
                dd = [(x - y) / y * 1e4 for x, y in zip(gs, base) if x is not None and y is not None]
                off = q(dd, .5)
                lv[sh] = round(st.mean(abs(x - off) for x in dd), 4)
            d["level_mad_by_shift_s"] = lv
            d["best_level_shift_s"] = min(lv, key=lv.get)
            # lead/lag by changes: correlation of 1 s changes of the source (shifted) with TrueFX's
            cc = {}
            bd = [None if (base[i] is None or base[i - 1] is None) else base[i] - base[i - 1] for i in range(1, len(base))]
            for sh in range(-8, 11):
                gs = on_grid(ser, sh)
                sd = [None if (gs[i] is None or gs[i - 1] is None) else gs[i] - gs[i - 1] for i in range(1, len(gs))]
                xy = [(a, b) for a, b in zip(bd, sd) if a is not None and b is not None]
                if len(xy) < 30: continue
                ax = [a for a, _ in xy]; bx = [b for _, b in xy]
                ma, mb = st.mean(ax), st.mean(bx)
                va = sum((a - ma) ** 2 for a in ax); vb = sum((b - mb) ** 2 for b in bx)
                if va == 0 or vb == 0: continue
                cc[sh] = round(sum((a - ma) * (b - mb) for a, b in xy) / math.sqrt(va * vb), 3)
            d["change_corr_by_shift_s"] = cc
            if cc: d["best_change_shift_s"] = max(cc, key=cc.get)
        pr[lab] = d
    res["pairs"][pair] = pr

# Yahoo's stored minute bars (env YAHOO=path to lines "pair,t (iso start),value", as `data/yahoo_*.txt`): at what instant
# does TrueFX's mid best match each bar's value? s seconds after the bar's start; a minute's close matches best near s = 60.
# Also whether each bar is the reciprocal of a rounded USD/GBP (5 decimals) or USD/EUR (4 decimals) quote.
import os, datetime
yp = os.environ.get("YAHOO")
if yp:
    bars = [dict(zip(("pair", "t", "value"), l.strip().split(","))) for l in open(yp) if l.strip()]
    res["yahoo"] = {}
    for pair in ("GBPUSD", "EURUSD"):
        tf = [(sm / 1000, (b + a) / 2) for rv, sm, b, a in series.get(("truefx", pair), []) if sm is not None]
        tf.sort()
        def tf_at(x):
            # TrueFX's mid as of instant x, by the source's own timestamp
            best = None
            for t, m in tf:
                if t <= x: best = m
                else: break
            return best
        ts = sorted((datetime.datetime.fromisoformat(b["t"].replace("Z", "+00:00")).timestamp(), float(b["value"])) for b in bars if b["pair"] == pair)
        ts = [(t, v) for t, v in ts if t >= res["window"][0] + 60 and t + 120 <= res["window"][1]]
        by = {}
        for sh in range(-60, 181, 5):
            dd = []
            for t, v in ts:
                m = tf_at(t + sh)
                if m is not None: dd.append(abs(v - m) / m * 1e4)
            if dd: by[sh] = round(st.mean(dd), 4)
        dp = 5 if pair == "GBPUSD" else 4
        allv = [float(b["value"]) for b in bars if b["pair"] == pair]
        recip = sum(1 for v in allv if abs(1 / round(1 / v, dp) - v) / v < 1e-7)
        res["yahoo"][pair] = {"bars": len(ts), "mean_absdiff_bps_by_shift_s": by, "best_shift_s": min(by, key=by.get) if by else None,
                              "bars_all": len(allv), f"bars_reciprocal_of_{dp}dp": recip}

json.dump(res, open(out_path, "w"), indent=1)
print(json.dumps(res, indent=1)[:6000])
