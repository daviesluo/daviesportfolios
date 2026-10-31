# MAKER-OTHER-BOOKS (2026-10-31): the $5,000 order on the crypto books, printed whole. The stablecoin maker's near-touch
# order is $5,000 of coin at the coin's dollar price (5,008.01282 USDT at 0.9984), and on SOL-GBP / SOL-USD the poll found
# the same kind of order (51.68 SOL ~ $5,000, the same quantity on both books, re-sized each read). A taker who takes such an
# order whole prints $5,000 +- 0.3 % of coin; a person typing an amount rarely lands there. If the stablecoin maker's switch
# also turned the crypto $5,000 orders off, those prints would stop in its two long absences (other_books_crypto.py's windows).
# Counts per window and per hour of window, against the same hours a day before and after. GBP books valued at Coinbase's
# BTC-USD / BTC-GBP of the minute.
#   python3 -I other_books_5k.py -> results/other_5k.json
import collections, datetime as dt, gzip, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
OUT = os.path.join(HERE, "..", "results", "other_5k.json")
ms = lambda *a: int(dt.datetime(*a, tzinfo=dt.timezone.utc).timestamp() * 1000)
W = {"C2a 10-19": (ms(2026, 10, 19, 6, 6), ms(2026, 10, 19, 16, 34)), "A2 10-20 absent": (ms(2026, 10, 20, 6, 6), ms(2026, 10, 20, 16, 34)),
     "C2b 10-21": (ms(2026, 10, 21, 6, 6), ms(2026, 10, 21, 16, 34)),
     "C1 10-28/29": (ms(2026, 10, 28, 21, 17), ms(2026, 10, 29, 11, 6)), "A1 10-29/30 absent": (ms(2026, 10, 29, 21, 17), ms(2026, 10, 30, 11, 6))}
cb = collections.defaultdict(dict)
for l in gzip.open(os.path.join(DATA, "other_cb_windows.txt.gz"), "rt"):
    p, t, c = l.strip().split("|"); cb[p][int(t)] = float(c)


def gbpusd(t):
    m = t // 60000 * 60000
    for k in (m, m - 60000, m + 60000):
        if cb["BTC-USD"].get(k) and cb["BTC-GBP"].get(k): return cb["BTC-USD"][k] / cb["BTC-GBP"][k]
    return None


P = collections.defaultdict(list)
for l in gzip.open(os.path.join(DATA, "other_crypto_prints.txt.gz"), "rt"):
    pid, b, t, px, q, sd = l.strip().split("|")
    P[b].append((int(t), float(px), float(q), sd))
res = {"band_usd": [4985, 5015], "books": {}}
for b in sorted(P):
    out = {}
    for wn, (a, z) in W.items():
        n = hits = 0; vals = []
        for t, p, q, sd in P[b]:
            if not a <= t < z: continue
            x = 1.0 if b.endswith("USD") else gbpusd(t)
            if x is None: continue
            n += 1
            v = p * q * x
            if 4985 <= v <= 5015: hits += 1; vals.append(round(q, 6))
        h = (z - a) / 3.6e6
        out[wn] = {"prints": n, "whole_5k_prints": hits, "per_hour": round(hits / h, 2), "examples": vals[:5]}
    res["books"][b] = out
    print(b, {k: (v["prints"], v["whole_5k_prints"]) for k, v in out.items()}, flush=True)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
