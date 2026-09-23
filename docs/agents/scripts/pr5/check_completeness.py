"""Is the pulled tape complete? Three independent counts from the venue's own UK candles.

1. Daily (interval=1440, region=UK; the day runs London midnight to London midnight): the sum of the day's UK print
   quantities against the candle's volume, on every day both cover in full.
2. Hourly (interval=60, region=UK): the same per hour.
3. Minute (PR3's committed 1-minute UK candles, 2026-08-26 -> 2026-09-23): per minute, print volume against candle volume;
   in traded minutes, the last print against the close and the prints' range against the high/low.
A candle volume is printed with a varying number of decimals; a match means |sum - volume| <= 0.5 unit in its last place
(+1e-9). Every comparison is made twice: with prints bucketed by their own timestamp, and with the venue's candle
bucketing as measured (a print in the first 1,000 ms of a minute is counted in the PREVIOUS minute's candle: on
USDC-GBP's 28 PR3 days that shift takes the minute matches from 40,276 to 40,314 of 40,318).
usage: check_completeness.py END_MS(exclusive; the pull's end) SYM [SYM ...]
"""
import json, os, sys, gzip, bisect, collections, datetime
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_IN = "/home/user/daviesportfolios/docs/agents/backtests/inputs/first_principles_2026-09-23/revx_hist"


SHIFT = 1000


def load_prints(sym, uk_only=True, shift=0):
    out = []
    for l in open(os.path.join(S, "data", "trades", f"{sym}.jsonl")):
        r = json.loads(l)
        if uk_only and r["region"] != "UK":
            continue
        ts = r["ts"]
        if shift and ts % 60000 < shift:
            ts -= shift          # the candle builder counts it in the previous minute
        out.append((ts, float(r["price"]), float(r["qty"]), r["side"], r["id"]))
    out.sort(key=lambda x: x[0])
    return out


def tol(vs):
    d = len(vs.split(".")[1]) if "." in vs else 0
    return 0.5 * 10 ** (-d) + 1e-9


LISTING = {"USDC-GBP": 1764172800000, "USDT-GBP": 1765843200000}   # 2025-11-26 / 2025-12-16 00:00 UTC: candle volume begins


def cmp_candles(prints, rows, end_ms, interval_ms, first_print_ts, since=0):
    ts = [p[0] for p in prints]
    starts = [int(r["start"]) for r in rows]
    res = {"candles_compared": 0, "match": 0, "miss": 0, "candle_vol_zero_prints_zero": 0, "candle_vol_zero_prints_nonzero": 0,
           "candle_vol_nonzero_prints_zero": 0, "sum_candle_vol": 0.0, "sum_print_vol": 0.0, "misses": []}
    for k, r in enumerate(rows):
        a = starts[k]
        b = starts[k + 1] if k + 1 < len(starts) else a + interval_ms
        if b > end_ms or a < since or (a < first_print_ts - interval_ms * 2 and float(r["volume"]) == 0):
            continue
        i, j = bisect.bisect_left(ts, a), bisect.bisect_left(ts, b)
        pv = sum(p[2] for p in prints[i:j])
        cv = float(r["volume"])
        res["candles_compared"] += 1
        res["sum_candle_vol"] += cv; res["sum_print_vol"] += pv
        if cv == 0 and j == i: res["candle_vol_zero_prints_zero"] += 1
        elif cv == 0: res["candle_vol_zero_prints_nonzero"] += 1
        elif j == i: res["candle_vol_nonzero_prints_zero"] += 1
        if abs(pv - cv) <= tol(r["volume"]) + 1e-6 * max(cv, 1):
            res["match"] += 1
        else:
            res["miss"] += 1
            if len(res["misses"]) < 400:
                res["misses"].append({"start": datetime.datetime.fromtimestamp(a / 1000, datetime.timezone.utc).isoformat(),
                                      "candle_volume": r["volume"], "print_volume": round(pv, 6), "prints": j - i,
                                      "diff": round(pv - cv, 6)})
    res["sum_candle_vol"] = round(res["sum_candle_vol"], 4); res["sum_print_vol"] = round(res["sum_print_vol"], 4)
    res["match_rate"] = round(res["match"] / res["candles_compared"], 6) if res["candles_compared"] else None
    res["misses_prints_exceed_candle"] = sum(1 for m in res["misses"] if m["diff"] > 0)
    res["misses_candle_exceeds_prints"] = sum(1 for m in res["misses"] if m["diff"] < 0)
    return res


def minute_check(sym, prints, end_ms):
    fn = os.path.join(REPO_IN, f"{sym}_1m.json.gz")
    if not os.path.exists(fn):
        return None
    bars = json.load(gzip.open(fn, "rt"))
    by_min = collections.defaultdict(list)
    for p in prints:
        by_min[p[0] // 60000 * 60000].append(p)
    t0, t1 = bars[0][0], bars[-1][0] + 60000
    res = {"minutes": 0, "candle_traded": 0, "print_minutes": 0, "vol_match": 0, "vol_miss": 0, "close_is_last_print": 0,
           "high_low_inside_prints": 0, "traded_minute_without_prints": 0, "print_minute_with_zero_candle_volume": 0, "miss_examples": []}
    have = set()
    for t, o, h, l, c, v in bars:
        if t >= end_ms:
            continue
        have.add(t)
        ps = by_min.get(t, [])
        res["minutes"] += 1
        if v > 0: res["candle_traded"] += 1
        if ps: res["print_minutes"] += 1
        pv = sum(p[2] for p in ps)
        if v > 0 and not ps: res["traded_minute_without_prints"] += 1
        if ps and v == 0: res["print_minute_with_zero_candle_volume"] += 1
        if abs(pv - v) <= 1e-4 + 1e-6 * v:
            res["vol_match"] += 1
        else:
            res["vol_miss"] += 1
            if len(res["miss_examples"]) < 20:
                res["miss_examples"].append({"t": datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).isoformat(), "candle_v": v, "print_v": round(pv, 6), "n": len(ps)})
        if ps and v > 0:
            last = max(ps, key=lambda p: (p[0], p[4]))
            if abs(last[1] - c) < 1e-9: res["close_is_last_print"] += 1
            lo, hi = min(p[1] for p in ps), max(p[1] for p in ps)
            if l >= lo - 1e-9 and h <= hi + 1e-9: res["high_low_inside_prints"] += 1
    extra = [m for m in by_min if t0 <= m < min(t1, end_ms) and m not in have]
    res["print_minutes_missing_from_candles"] = len(extra)
    res["window"] = [datetime.datetime.fromtimestamp(t0 / 1000, datetime.timezone.utc).isoformat(), datetime.datetime.fromtimestamp(t1 / 1000, datetime.timezone.utc).isoformat()]
    return res


def main():
    end_ms = int(sys.argv[1])
    out = {}
    for sym in sys.argv[2:]:
        allp = load_prints(sym, uk_only=False)
        R = {"prints_all_regions": len(allp), "prints_uk": sum(1 for p in allp if True) if False else len(load_prints(sym, uk_only=True))}
        for shift, tag in ((0, "own_timestamps"), (SHIFT, "candle_bucketing")):
            uk = load_prints(sym, uk_only=True, shift=shift)
            first = uk[0][0] if uk else 0
            for iv, name in ((1440, "daily"), (60, "hourly")):
                fn = os.path.join(S, "data", "candles", f"{sym}_{iv}.json")
                if os.path.exists(fn):
                    rows = json.load(open(fn))["rows"]
                    R[f"{name}_{tag}"] = cmp_candles(uk, rows, end_ms, iv * 60000, first)
                    if sym in LISTING:
                        R[f"{name}_{tag}_since_listing"] = cmp_candles(uk, rows, end_ms, iv * 60000, first, since=LISTING[sym])
            R[f"minute_vs_pr3_candles_{tag}"] = minute_check(sym, uk, end_ms)
        out[sym] = R
        print(sym, json.dumps({k: (v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if kk not in ("misses", "miss_examples")}) for k, v in R.items()}), flush=True)
    json.dump(out, open(os.path.join(S, "results", "completeness.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
