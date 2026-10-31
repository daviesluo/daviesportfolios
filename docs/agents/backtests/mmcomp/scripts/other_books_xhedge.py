# MAKER-OTHER-BOOKS (2026-10-31): MMCOMP's idea A on the USD books (reviews/2026-10-31-maker-other-books.md §4): rest one
# post-only order a tick inside the touch on Revolut X's USDT-USD or USDC-USD, and when a print reaches it, close the coins at
# once elsewhere: USDT at Coinbase's next minute close less half its one-tick spread (0.5 bp) and its dearest stable-pair taker
# fee (0.45 bp); USDC at par (Coinbase turns USDC into dollars 1:1 without a fee). Fills: each print of $1 or more whose taker
# sold at or below our bid (we buy) or bought at or above our ask (we sell), at the print's price, up to Q dollars; one fill a
# print. Our order never rests where the far venue would not pay: a bid only below the far price less m bps. No transfers are
# costed here: the coins pile up on one venue and the dollars on the other, and the review counts what has to move.
# Inputs: data/other_usd_prints.txt.gz, data/other_cb_usdt_usd.txt.gz (Coinbase USDT-USD one-minute closes).
#   python3 -I other_books_xhedge.py -> results/other_xhedge.json
import collections, gzip, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
OUT = os.path.join(HERE, "..", "results", "other_xhedge.json")
T0, T1 = 1790467200000, 1793404800000     # 2026-09-27 00:00 -> 2026-10-31 00:00 UTC
cb = {}
for l in gzip.open(os.path.join(DATA, "other_cb_usdt_usd.txt.gz"), "rt"):
    t, c = l.strip().split("|"); cb[int(t)] = float(c)
P = collections.defaultdict(list)
for l in gzip.open(os.path.join(DATA, "other_usd_prints.txt.gz"), "rt"):
    pid, b, t, px, q, sd = l.strip().split("|")
    t = int(t)
    if T0 <= t < T1 and float(px) * float(q) >= 1: P[b].append((t, float(px), float(q), sd))
days = (T1 - T0) / 86_400_000
res = {"window": "2026-09-27 -> 2026-10-31 UTC", "days": days, "books": {}}
for b in ("USDT-USD", "USDC-USD"):
    rows = sorted(P[b])
    out = {"prints_1usd_plus": len(rows), "usd_a_day": round(sum(p * q for _, p, q, _ in rows) / days)}
    for m in (0, 2):
        for Q in (100, 500):
            fills = {"buy": [], "sell": []}
            for t, p, q, sd in rows:
                if b == "USDT-USD":
                    c = cb.get((t // 60000 + 1) * 60000)        # the minute after the print: the hedge's price
                    if c is None: continue
                    far_bid, far_ask, cost = c - 0.00005, c + 0.00005, 0.45e-4
                else:
                    far_bid = far_ask = 1.0; cost = 0.0
                usd = min(Q, p * q)
                if sd == "sell" and p < far_bid * (1 - m * 1e-4):       # a taker sold to the bid: our bid inside it buys
                    fills["buy"].append((t, usd, 1e4 * (far_bid * (1 - cost) / p - 1)))
                if sd == "buy" and p > far_ask * (1 + m * 1e-4):        # a taker bought: our ask sells, bought back far
                    fills["sell"].append((t, usd, 1e4 * (p / (far_ask * (1 + cost)) - 1)))
            allf = fills["buy"] + fills["sell"]
            pnl = sum(u * e * 1e-4 for _, u, e in allf)
            net = sum(u for _, u, _ in fills["buy"]) - sum(u for _, u, _ in fills["sell"])
            byday = collections.Counter()
            for t, u, e in allf: byday[(t - T0) // 86_400_000] += u * e * 1e-4
            out[f"m{m}_Q{Q}"] = {"fills_a_day": round(len(allf) / days, 1), "buys": len(fills["buy"]), "sells": len(fills["sell"]),
                                 "edge_bps_mean": round(sum(e for _, _, e in allf) / len(allf), 2) if allf else None,
                                 "usd_a_day": round(pnl / days, 3), "days_positive": sum(1 for v in byday.values() if v > 0), "days_with_fills": len(byday),
                                 "coins_moved_a_day_usd": round(net / days)}
    res["books"][b] = out
    print(b, out, flush=True)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
