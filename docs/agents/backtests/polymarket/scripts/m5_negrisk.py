"""M5: do negative-risk sets ever sum away from 1 after fees? (fp4, a kill measurement)

Every open negative-risk event of the M1 snapshot's market list, every one of its
markets' YES books read now (the CLOB's public /books; the YES book is the whole
book, the NO side is its mirror, checked in M1), and two trades priced at the
touch with taker fees: buy one YES of every outcome (pays exactly 1 when the set
is complete), and buy one NO of every outcome (pays n - 1). Augmented events,
whose named outcomes need not be complete, are reported apart. Depth is the
smallest touch size across legs. Writes the JSON named on the command line.

usage: m5_negrisk.py <snap dir> <out json> [rounds] [gap seconds]
"""
import json
import math
import os
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

CLOB = "https://clob.polymarket.com"


def fnum(x, d=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return d


def best(book):
    bids = sorted(((fnum(o["price"]), fnum(o["size"])) for o in book.get("bids") or []), key=lambda x: -x[0])
    asks = sorted(((fnum(o["price"]), fnum(o["size"])) for o in book.get("asks") or []), key=lambda x: x[0])
    return (bids[0] if bids else None), (asks[0] if asks else None), bids, asks


def fill_cost(levels, qty):
    """Cost of buying qty shares walking the ask levels; None when the book is too thin."""
    left, cost = qty, 0.0
    for p, s in levels:
        take = min(left, s)
        cost += take * p
        left -= take
        if left <= 1e-9:
            return cost
    return None


def main():
    snap, outp = sys.argv[1], sys.argv[2]
    rounds = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    gap = float(sys.argv[4]) if len(sys.argv) > 4 else 0
    markets = pmnet.load(os.path.join(snap, "markets.json"))
    ev = defaultdict(list)
    meta = {}
    for m in markets:
        if not m.get("negRisk") or not m.get("enableOrderBook") or not m.get("acceptingOrders"):
            continue
        e = (m.get("events") or [{}])[0]
        ev[e.get("id")].append(m)
        meta[e.get("id")] = e
    events = {k: v for k, v in ev.items() if len(v) >= 2}
    out = {"events": len(events), "rounds": []}
    for rd in range(rounds):
        tokens = []
        for ms in events.values():
            for m in ms:
                try:
                    tokens.append(json.loads(m["clobTokenIds"])[0])
                except (ValueError, TypeError, IndexError):
                    pass
        books = {}
        t_start = time.time()
        for i in range(0, len(tokens), 100):
            for b in pmnet.post(CLOB + "/books", [{"token_id": t} for t in tokens[i:i + 100]]):
                books[b.get("asset_id")] = b
        rows = []
        for eid, ms in events.items():
            legs, ok = [], True
            for m in ms:
                try:
                    tok = json.loads(m["clobTokenIds"])[0]
                except (ValueError, TypeError, IndexError):
                    ok = False
                    break
                b = books.get(tok)
                if not b:
                    ok = False
                    break
                bb, ba, bids, asks = best(b)
                fs = m.get("feeSchedule") or {}
                r = fnum(fs.get("rate"), 0.0) if m.get("feesEnabled") else 0.0
                legs.append({"bb": bb, "ba": ba, "bids": bids, "asks": asks, "r": r})
            if not ok or any(l["ba"] is None or l["bb"] is None for l in legs):
                continue
            n = len(legs)
            s_ask = sum(l["ba"][0] for l in legs)
            s_bid = sum(l["bb"][0] for l in legs)
            fee_yes = sum(l["r"] * l["ba"][0] * (1 - l["ba"][0]) for l in legs)
            fee_no = sum(l["r"] * (1 - l["bb"][0]) * l["bb"][0] for l in legs)
            # 10-share set at depth
            c10 = [fill_cost(l["asks"], 10) for l in legs]
            yes10 = None if any(c is None for c in c10) else 10 - sum(c10) - 10 * fee_yes
            e = meta[eid]
            rows.append({"event": eid, "title": (e.get("title") or "")[:80], "n": n, "augmented": bool(e.get("negRiskAugmented")),
                         "sum_ask": round(s_ask, 4), "sum_bid": round(s_bid, 4),
                         "buy_all_yes_edge": round(1 - s_ask - fee_yes, 4), "buy_all_no_edge": round(s_bid - 1 - fee_no, 4),
                         "buy_all_yes_10_shares_usd": None if yes10 is None else round(yes10, 3),
                         "min_touch_yes": min(l["ba"][1] for l in legs), "min_touch_no": min(l["bb"][1] for l in legs),
                         "end": e.get("endDate")})
        full = [r for r in rows if not r["augmented"]]
        aug = [r for r in rows if r["augmented"]]

        def summ(rs):
            return {"events": len(rs),
                    "sum_ask_p05": sorted(r["sum_ask"] for r in rs)[int(0.05 * len(rs))] if rs else None,
                    "sum_ask_p50": sorted(r["sum_ask"] for r in rs)[len(rs) // 2] if rs else None,
                    "sum_bid_p50": sorted(r["sum_bid"] for r in rs)[len(rs) // 2] if rs else None,
                    "sum_bid_p95": sorted(r["sum_bid"] for r in rs)[int(0.95 * len(rs))] if rs else None,
                    "yes_edge_gt0": sorted([r for r in rs if r["buy_all_yes_edge"] > 0], key=lambda r: -r["buy_all_yes_edge"])[:15],
                    "no_edge_gt0": sorted([r for r in rs if r["buy_all_no_edge"] > 0], key=lambda r: -r["buy_all_no_edge"])[:15],
                    "n_yes_edge_gt0": sum(1 for r in rs if r["buy_all_yes_edge"] > 0),
                    "n_no_edge_gt0": sum(1 for r in rs if r["buy_all_no_edge"] > 0),
                    "n_yes_edge_gt0_10_shares": sum(1 for r in rs if (r["buy_all_yes_10_shares_usd"] or -1) > 0)}
        out["rounds"].append({"t": t_start, "books": len(books), "complete_sets": summ(full), "augmented_sets": summ(aug)})
        print(json.dumps({"round": rd, "complete": {k: v for k, v in summ(full).items() if not isinstance(v, list)},
                          "augmented": {k: v for k, v in summ(aug).items() if not isinstance(v, list)}}), flush=True)
        if rd < rounds - 1:
            time.sleep(gap)
    pmnet.dump(outp, out)


if __name__ == "__main__":
    main()
