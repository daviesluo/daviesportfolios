# CRYPTOBOOKS-2 (2026-10-31): what the light recorder (record.py, data/rec*_*.jsonl.gz) shows.
#  - the regime now: per read of each book, the touch's distance from the outside fair (Binance's mid x Kraken's
#    USDT/USD / Kraken's GBP/USD, corrected by the session's median basis); "inner on" when both sides sit within 6 bps;
#    the share of reads with it on, by 10-minute bucket, and the reads with it on at all;
#  - the regime signal a live quoter would read: the others' touch (the book less our own orders) at 6 bps or less from
#    the fair on both sides for 3 reads running = on (stop quoting new bids), off after 10 reads without it;
#  - the fair's sources: Binance against Coinbase (its own trade time gives Coinbase's staleness) and Kraken's GBP book:
#    the median gap in bps, and which leads, by the correlation of 2-s moves at lags -10..+10 s.
# Writes results/rec.json. Pure Python, no network.
#   python3 -I rec_an.py <tag, e.g. rec1>
import bisect, collections, datetime as dt, json, math, os, statistics, sys, zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT  # noqa: E402

KR = {"XRP": "XRPGBP", "SOL": "SOLGBP", "ETH": "XETHZGBP", "BTC": "XXBTZGBP"}
INNER = 6.0


def lines(path):
    raw = open(path, "rb").read()
    txt = zlib.decompressobj(31).decompress(raw).decode(errors="ignore")
    for l in txt.splitlines():
        try:
            yield json.loads(l)
        except ValueError:
            pass


def series_at(ser, t):
    ts, vs = ser
    i = bisect.bisect_right(ts, t) - 1
    return vs[i] if i >= 0 else None


def main(tag):
    bn, kr, cb, cbt = collections.defaultdict(lambda: ([], [])), collections.defaultdict(lambda: ([], [])), \
        collections.defaultdict(lambda: ([], [])), collections.defaultdict(list)
    for r in lines(os.path.join(ROOT, "data", f"{tag}_ext.jsonl.gz")):
        if "error" in r:
            continue
        t = (r["t0"] + r["t"]) / 2
        if r["src"] == "binance":
            for s, (b, a) in r["q"].items():
                bn[s[:-4]][0].append(t)
                bn[s[:-4]][1].append((float(b) + float(a)) / 2)
        elif r["src"] == "kraken":
            for s, (b, a) in r["q"].items():
                kr[s][0].append(t)
                kr[s][1].append((float(b) + float(a)) / 2)
        elif r["src"] == "coinbase" and r["q"][0]:
            cb[r["p"]][0].append(t)
            cb[r["p"]][1].append((float(r["q"][0]) + float(r["q"][1])) / 2)
            if r.get("tt"):
                base, _, frac = r["tt"].rstrip("Z").partition(".")
                tt = dt.datetime.fromisoformat(base).replace(tzinfo=dt.timezone.utc).timestamp() + (float("0." + frac[:6]) if frac else 0.0)
                cbt[r["p"]].append(t - tt)
    books = collections.defaultdict(list)
    errors = 0
    for r in lines(os.path.join(ROOT, "data", f"{tag}_rx.jsonl.gz")):
        if "error" in r:
            errors += 1
            continue
        if r.get("b") and r.get("a"):
            books[r["book"]].append(r)
    out = {"errors": errors, "books": {}, "sources": {}}
    for book, rs in books.items():
        coin = book.split("-")[0]
        rows = []
        for r in rs:
            t = r["vts"] / 1000 if r.get("vts") else r["t"]
            m, u, g = series_at(bn[coin], t), series_at(kr["USDTZUSD"], t), series_at(kr["ZGBPZUSD"], t)
            if None in (m, u, g):
                continue
            f = m * u / g
            rows.append((t, float(r["b"][0][0]), float(r["a"][0][0]), f, float(r["b"][0][1]) * float(r["b"][0][0]), float(r["a"][0][1]) * float(r["a"][0][0])))
        if not rows:
            continue
        basis = statistics.median(1e4 * math.log((b + a) / 2 / f) for t, b, a, f, qb, qa in rows)
        on, buckets = [], collections.defaultdict(list)
        for t, b, a, f, qb, qa in rows:
            fc = f * math.exp(basis / 1e4)
            db, da = 1e4 * (1 - b / fc), 1e4 * (a / fc - 1)
            x = db <= INNER and da <= INNER
            on.append((t, x, db, da))
            buckets[int(t // 600) * 600].append(x)
        # the live signal with hysteresis
        state, run_on, run_off, flips = False, 0, 0, []
        for t, x, db, da in on:
            run_on = run_on + 1 if x else 0
            run_off = run_off + 1 if not x else 0
            if not state and run_on >= 3:
                state = True
                flips.append((t, "on"))
            elif state and run_off >= 10:
                state = False
                flips.append((t, "off"))
        out["books"][book] = {
            "reads": len(rows), "window_utc": [rows[0][0], rows[-1][0]], "basis_bps": round(basis, 1),
            "bid_from_fair_p50": round(statistics.median(x[2] for x in on), 1), "ask_from_fair_p50": round(statistics.median(x[3] for x in on), 1),
            "spread_p50": round(statistics.median(1e4 * (a - b) / ((a + b) / 2) for t, b, a, f, qb, qa in rows), 1),
            "inner_on_share": round(sum(1 for x in on if x[1]) / len(on), 4),
            "inner_on_by_10min": {dt.datetime.utcfromtimestamp(k).strftime("%H:%M"): round(sum(v) / len(v), 2) for k, v in sorted(buckets.items())},
            "signal_flips": [[dt.datetime.utcfromtimestamp(t).strftime("%H:%M:%S"), s] for t, s in flips]}
    # sources: Binance vs Coinbase (USD) and vs Kraken's GBP book
    for coin in sorted(bn):
        res = {}
        if coin in cb and cb[coin][0]:
            gaps = []
            for t, v in zip(*cb[coin]):
                m, u = series_at(bn[coin], t), series_at(kr["USDTZUSD"], t)
                if m and u:
                    gaps.append(1e4 * math.log(v / (m * u)))
            res["coinbase_vs_binance_bps_p50"] = round(statistics.median(gaps), 1) if gaps else None
            res["coinbase_last_trade_age_s_p50_p90"] = [round(statistics.median(cbt[coin]), 1), round(sorted(cbt[coin])[int(0.9 * len(cbt[coin]))], 1)] if cbt[coin] else None
            # lead-lag on a 2-s grid
            t0, t1 = max(bn[coin][0][0], cb[coin][0][0]), min(bn[coin][0][-1], cb[coin][0][-1])
            grid = [t0 + 2 * i for i in range(int((t1 - t0) / 2))]
            bs = [series_at(bn[coin], t) for t in grid]
            cs = [series_at(cb[coin], t) for t in grid]
            rb = [math.log(bs[i] / bs[i - 1]) for i in range(1, len(grid))]
            rc = [math.log(cs[i] / cs[i - 1]) for i in range(1, len(grid))]
            cc = {}
            for lag in range(-5, 6):  # lag in 2-s steps: positive = Binance leads Coinbase
                xs = [(rb[i], rc[i + lag]) for i in range(max(0, -lag), min(len(rb), len(rc) - lag))]
                if len(xs) > 50:
                    mx, my = statistics.mean(a for a, b in xs), statistics.mean(b for a, b in xs)
                    sxy = sum((a - mx) * (b - my) for a, b in xs)
                    sxx = sum((a - mx) ** 2 for a, b in xs)
                    syy = sum((b - my) ** 2 for a, b in xs)
                    cc[2 * lag] = round(sxy / math.sqrt(sxx * syy), 3) if sxx > 0 and syy > 0 else None
            res["corr_binance_leads_coinbase_by_s"] = cc
        k = KR.get(coin)
        if k and kr[k][0]:
            gaps = []
            for t, v in zip(*kr[k]):
                m, u, g = series_at(bn[coin], t), series_at(kr["USDTZUSD"], t), series_at(kr["ZGBPZUSD"], t)
                if m and u and g:
                    gaps.append(1e4 * math.log(v / (m * u / g)))
            res["kraken_gbp_vs_binance_bps_p50_p10_p90"] = [round(statistics.median(gaps), 1), round(sorted(gaps)[len(gaps) // 10], 1),
                                                            round(sorted(gaps)[9 * len(gaps) // 10], 1)]
        res["binance_reads"] = len(bn[coin][0])
        out["sources"][coin] = res
    g = kr["ZGBPZUSD"][1]
    out["kraken_gbpusd_range_bps"] = round(1e4 * math.log(max(g) / min(g)), 1) if g else None
    with open(os.path.join(ROOT, "results", f"{tag}.json"), "w") as f:
        json.dump(json.loads(json.dumps(out)), f, indent=1, sort_keys=True)
    for b, v in out["books"].items():
        print(b, {k: v[k] for k in v if k not in ("inner_on_by_10min",)})
    print(json.dumps(out["sources"]))


if __name__ == "__main__":
    main(sys.argv[1])
