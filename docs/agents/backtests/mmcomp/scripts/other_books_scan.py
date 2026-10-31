# MAKER-OTHER-BOOKS (2026-10-31): read the books polled by other_books_poll.py and say, per book, how wide and deep it is,
# what traded on it in 24 hours (the venue's tickers), and which resting orders look like a ladder of one automated maker:
# single orders whose exact quantity (to the last decimal) sits on both sides of the book in most reads, and the same exact
# quantity on another book of the same coin. Also the GBP stablecoin maker's own mark, one order of 4,950-5,060 coins within
# 60 bps of the mid, read by read on the four stablecoin books and USDC-EUR (EEA), for the synchronisation test.
#   python3 -I other_books_scan.py <poll.jsonl.gz> -> results/other_books_scan.json
import collections, gzip, json, os, statistics as st, sys, time, zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "other_books_scan.json")
STABLE = ("USDT-GBP", "USDC-GBP", "USDT-USD", "USDC-USD", "USDC-EUR")


def load(p):
    raw = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(open(p, "rb").read()).decode()
    out = []
    for l in raw.split("\n"):
        try: out.append(json.loads(l))
        except ValueError: pass
    return out


rows = load(sys.argv[1])
books = [r for r in rows if r.get("bids") and r.get("asks")]
ticks = [r for r in rows if "tickers" in r]
errors = sum(1 for r in rows if "error" in r)
by = collections.defaultdict(list)
for r in books: by[r["book"]].append(r)
# a dollar rate for each quote currency, read by read: GBP and EUR from BTC's books against BTC-USD
fx_at = {}
for r in books:
    if r["book"] in ("BTC-GBP", "BTC-USD", "BTC-EUR"): fx_at.setdefault(int(r["t"] // 150), {})[r["book"]] = (float(r["bids"][0][0]) + float(r["asks"][0][0])) / 2


def fx(r):
    q = r["book"].split("-")[1]
    if q in ("USD", "USDC", "USDT"): return 1.0
    for k in (int(r["t"] // 150), int(r["t"] // 150) - 1, int(r["t"] // 150) + 1):
        m = fx_at.get(k, {})
        if "BTC-USD" in m and f"BTC-{q}" in m: return m["BTC-USD"] / m[f"BTC-{q}"]
    return None


res = {"reads": len(books), "errors": errors, "from": time.strftime("%Y-%m-%d %H:%M", time.gmtime(min(r["t"] for r in books))),
       "to": time.strftime("%Y-%m-%d %H:%M", time.gmtime(max(r["t"] for r in books))), "books": {}, "stable_maker_timeline": []}
qty_books = collections.defaultdict(set)     # exact quantity -> books holding it on both sides
for b, rs in sorted(by.items()):
    sp, d10, d25 = [], [], []
    both = collections.Counter()
    for r in rs:
        bb, ba = float(r["bids"][0][0]), float(r["asks"][0][0])
        m = (bb + ba) / 2; f = fx(r)
        sp.append(1e4 * (ba - bb) / m)
        if f:
            d10.append(f * sum(float(p) * float(q) for side in ("bids", "asks") for p, q, n in r[side] if abs(float(p) / m - 1) <= 10e-4))
            d25.append(f * sum(float(p) * float(q) for side in ("bids", "asks") for p, q, n in r[side] if abs(float(p) / m - 1) <= 25e-4))
        bq = {q for p, q, n in r["bids"] if n == 1}; aq = {q for p, q, n in r["asks"] if n == 1}
        for q in bq & aq: both[q] += 1
    ladder = sorted(q for q, c in both.items() if c >= 0.5 * len(rs) and float(q) not in (1.0, 10.0, 100.0, 1000.0))
    for q in ladder: qty_books[q].add(b)
    last = rs[-1]; f = fx(last); m = (float(last["bids"][0][0]) + float(last["asks"][0][0])) / 2
    res["books"][b] = {"region": rs[0]["region"], "reads": len(rs), "spread_bps_median": round(st.median(sp), 1),
                       "spread_bps_p10_p90": [round(sorted(sp)[int(0.1 * (len(sp) - 1))], 1), round(sorted(sp)[int(0.9 * (len(sp) - 1))], 1)],
                       "depth_usd_10bps_median": round(st.median(d10)) if d10 else None, "depth_usd_25bps_median": round(st.median(d25)) if d25 else None,
                       "symmetric_ladder_orders": len(ladder),
                       "ladder_usd": sorted(round(float(q) * m * (f or 0)) for q in ladder)}
for q, bs in qty_books.items():
    if len(bs) > 1:
        res.setdefault("ladder_quantities_on_several_books", {})[q] = sorted(bs)
for b in res["books"]:
    res["books"][b]["ladder_shared_with"] = sorted({x for q, bs in qty_books.items() if b in bs for x in bs} - {b})
if ticks:
    for x in ticks[-1]["tickers"]:
        b = x["symbol"].replace("/", "-")
        if b in res["books"]:
            res["books"][b]["quote_volume_24h"] = x.get("quote_volume_24h")
# the stablecoin maker's own order, read by read
cyc = collections.defaultdict(dict)
for r in books:
    if r["book"] in STABLE: cyc[int(r["t"] // 150)][r["book"]] = r
for k in sorted(cyc):
    line = {"t": time.strftime("%H:%M", time.gmtime(min(r["t"] for r in cyc[k].values())))}
    for b, r in sorted(cyc[k].items()):
        m = (float(r["bids"][0][0]) + float(r["asks"][0][0])) / 2
        hit = [f"{s[0]}{1e4 * abs(float(p) / m - 1):.0f}:{q}" for s in ("bids", "asks") for p, q, n in r[s]
               if n == 1 and 4950 <= float(q) <= 5060 and abs(float(p) / m - 1) <= 60e-4]
        line[b] = hit
    res["stable_maker_timeline"].append(line)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
for b, v in res["books"].items(): print(b, {k: v[k] for k in ("spread_bps_median", "depth_usd_10bps_median", "symmetric_ladder_orders", "ladder_shared_with", "quote_volume_24h") if k in v})
print(sum(1 for l in res["stable_maker_timeline"] if any(l.get(b) for b in STABLE)), "of", len(res["stable_maker_timeline"]), "cycles show the stable maker's order")
