# MAKER-OTHER-BOOKS (2026-10-31): did the crypto books' takers pay more while the stablecoin maker was away? If one switch
# turned the maker off on every book it makes, a crypto book it makes would be wider in its two long absences (2026-10-20
# 06:06-16:34 and 2026-10-29 21:17 -> 10-30 11:06 UTC, the same minute on all four stablecoin books) than at the same hours
# a day before and after. Per print of $10 or more: what the taker paid against Coinbase's one-minute close of that minute
# (bps, + = paid; GBP books priced on Coinbase's GBP book, or its USD book x BTC-GBP / BTC-USD), and gap60 (a taker buy's
# price over the nearest taker sell within 60 s, bps). USDT-USD is the positive control: the maker does make it.
# Inputs: data/other_crypto_prints.txt.gz, data/other_usd_prints.txt.gz, data/other_cb_windows.txt.gz.
#   python3 -I other_books_crypto.py -> results/other_crypto.json
import bisect, collections, datetime as dt, gzip, json, os, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
OUT = os.path.join(HERE, "..", "results", "other_crypto.json")
ms = lambda *a: int(dt.datetime(*a, tzinfo=dt.timezone.utc).timestamp() * 1000)
W = {"C2a 10-19": (ms(2026, 10, 19, 6, 6), ms(2026, 10, 19, 16, 34)), "A2 10-20 absent": (ms(2026, 10, 20, 6, 6), ms(2026, 10, 20, 16, 34)),
     "C2b 10-21": (ms(2026, 10, 21, 6, 6), ms(2026, 10, 21, 16, 34)),
     "C1 10-28/29": (ms(2026, 10, 28, 21, 17), ms(2026, 10, 29, 11, 6)), "A1 10-29/30 absent": (ms(2026, 10, 29, 21, 17), ms(2026, 10, 30, 11, 6))}
cb = collections.defaultdict(dict)
for l in gzip.open(os.path.join(DATA, "other_cb_windows.txt.gz"), "rt"):
    p, t, c = l.strip().split("|"); cb[p][int(t)] = float(c)


def fair(book, t):
    m = t // 60000 * 60000
    coin, q = book.split("-")
    if q == "USD": return cb[f"{coin}-USD"].get(m)
    g = cb.get(f"{coin}-GBP", {}).get(m)
    if g: return g
    u, bu, bg = cb[f"{coin}-USD"].get(m), cb["BTC-USD"].get(m), cb["BTC-GBP"].get(m)
    return u * bg / bu if u and bu and bg else None


P = collections.defaultdict(list)
for f in ("other_crypto_prints.txt.gz", "other_usd_prints.txt.gz"):
    for l in gzip.open(os.path.join(DATA, f), "rt"):
        pid, b, t, px, q, sd = l.strip().split("|")
        if f.startswith("other_usd") and b != "USDT-USD": continue
        P[b].append((int(t), float(px), float(q), sd))
res = {"windows": {k: [dt.datetime.utcfromtimestamp(a / 1000).isoformat(), dt.datetime.utcfromtimestamp(b / 1000).isoformat()] for k, (a, b) in W.items()}, "books": {}}
for b in sorted(P):
    rows = sorted(P[b])
    usdx = 1.0 if b.endswith("USD") else None
    out = {}
    for wn, (a, z) in W.items():
        sel = [r for r in rows if a <= r[0] < z]
        if not sel: continue
        paid, ntl = [], 0.0
        for t, p, q, sd in sel:
            f = fair(b, t)
            val = p * q * (1.0 if b.endswith("USD") else (cb["BTC-USD"].get(t // 60000 * 60000, 0) / cb["BTC-GBP"].get(t // 60000 * 60000, 1) if cb["BTC-GBP"].get(t // 60000 * 60000) else 1.33))
            if val < 10 or not f: continue
            ntl += val
            paid.append((1 if sd == "buy" else -1) * 1e4 * (p / f - 1))
        buys = [(t, p) for t, p, q, sd in sel if sd == "buy" and p * q * 1.33 >= 10]
        sells = [(t, p) for t, p, q, sd in sel if sd == "sell" and p * q * 1.33 >= 10]
        st_ = [t for t, _ in sells]
        gaps = []
        for t, p in buys:
            i = bisect.bisect_left(st_, t - 60000); best = None
            while i < len(sells) and sells[i][0] <= t + 60000:
                d = abs(sells[i][0] - t)
                if best is None or d < best[0]: best = (d, sells[i][1])
                i += 1
            if best: gaps.append(1e4 * (p / best[1] - 1))
        out[wn] = {"prints_10usd_plus": len(paid), "usd": round(ntl), "paid_bps_median": round(st.median(paid), 2) if paid else None,
                   "paid_bps_mean": round(st.fmean(paid), 2) if paid else None, "gap60_bps_median": round(st.median(gaps), 2) if gaps else None, "gap60_pairs": len(gaps)}
    res["books"][b] = out
    print(b, {k: (v["prints_10usd_plus"], v["paid_bps_median"], v["gap60_bps_median"]) for k, v in out.items()}, flush=True)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
