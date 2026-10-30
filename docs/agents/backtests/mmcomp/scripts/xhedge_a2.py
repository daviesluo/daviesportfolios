# XHEDGE-A2 (2026-10-30; Davies, ~02:35 UTC: "A 策略可以单独做吗还是只能做像你刚才说的和做市商抢生意的那个做法？"): strategy A without
# competing with the other maker, replayed beside A1 on MMCOMP-2's model (xhedge.py: 2026-10-10 02:00 -> 10-29 00:00 UTC, the
# hedge at the first Coinbase read 30 s or more after the fill, 0.45 bps, £100 an order, £600 a venue split in pounds and coin,
# NO transfers, the £0.10 bot's prints left out as there).
#   A1      : one tick inside Revolut X's touch, capped at Coinbase's touch ± 2 bps; first in its queue (at or through fills it,
#             a price it only joins fills through);
#   A2 d    : Coinbase's mid × (1 ∓ d), floored/ceiled to the tick, capped at Coinbase's touch ± 2 bps; 'behind' never better
#             than Revolut X's own touch (bid <= its bid, ask >= its ask: the maker is always ahead), 'free' only post-only (never
#             crossing it). Only a print strictly through our price fills it: at a level the maker holds, it is ahead of us.
# Reported a book: trips (fills) a day, bps a fill net of the fee, £ a day, % of days positive, the minutes each side was off for
# want of inventory, and orders a day. The engine (agents/xhedge.ts) differs in two ways the study does not price: it fills the
# £0.10 prints as dust, and its inventory is in coins at the fill's price rather than pounds at par.
# python3 -I docs/agents/backtests/mmcomp/scripts/xhedge_a2.py   -> results/xhedge_a2.json
import bisect, collections, gzip, json, math, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
import load as L

HERE = os.path.dirname(os.path.abspath(__file__))


def cb_series(bk):
    """Coinbase's touch every 30 s, as xhedge.py reads it (cb_touch at :00, cb_book_levels' best level at :30)."""
    rows = [(c[0], c[1], c[2], c[3], c[4]) for c in L.cb(bk)]
    for line in gzip.open(os.path.join(HERE, "..", "data", f"cb30_{bk}.txt.gz"), "rt"):
        f = line.strip().split("|")
        if len(f) == 5:   # the level recorder stores prices in 0.0001 and sizes in 0.01 coin
            rows.append((int(f[0]), float(f[1]) * 1e-4, float(f[2]) * 1e-4, float(f[3]) * 0.01, float(f[4]) * 0.01))
    rows = [r for r in rows if r[1] > 0 and r[2] > r[1]]
    rows.sort()
    return rows
OUT = os.path.join(HERE, "..", "results", "xhedge_a2.json")
START, END = 1791598800000, 1793232000000
DAYS = (END - START) / L.DAY
T = L.TICK
FEE, DELAY, M_BPS, C, Q = 0.45, 30, 2.0, 1200.0, 100.0


def run(snaps, st, seen, cb, ct, ps, arm, d_bps=None, cap="behind"):
    quarter = C / 4
    inv = {"rx_gbp": quarter, "rx_coin": quarter, "cb_gbp": quarter, "cb_coin": quarter}
    fills, edges, pnl = 0, [], 0.0
    byday = collections.Counter()
    blocked_min = collections.Counter()
    orders = 0
    last = {"bid": None, "ask": None}

    def fresh(i, t):
        return i >= 0 and t <= seen[snaps[i][0]] + 75_000

    def want(i, j):
        _, bids, asks = snaps[i]
        rb, ra = bids[0][0], asks[0][0]
        cbb, cba = cb[j][1], cb[j][2]
        cap_b = math.floor(cbb * (1 - M_BPS / 1e4) / T + 1e-9) * T
        cap_a = math.ceil(cba * (1 + M_BPS / 1e4) / T - 1e-9) * T
        if arm == "A1":
            return rb, ra, min(rb + T, ra - T, cap_b), max(ra - T, rb + T, cap_a)
        fair = (cbb + cba) / 2
        b = math.floor(fair * (1 - d_bps / 1e4) / T + 1e-9) * T
        a = math.ceil(fair * (1 + d_bps / 1e4) / T - 1e-9) * T
        if cap == "behind":
            b, a = min(b, rb), max(a, ra)
        return rb, ra, min(b, ra - T, cap_b), max(a, rb + T, cap_a)

    pi = 0
    for t in range(START + 30_000, END, 60_000):
        i = bisect.bisect_right(st, t) - 1
        j = bisect.bisect_right(ct, t) - 1
        if fresh(i, t) and j >= 0 and t - ct[j] <= 60_000:
            _, _, wb, wa = want(i, j)
            on = {"bid": inv["rx_gbp"] >= Q and inv["cb_coin"] >= Q, "ask": inv["rx_coin"] >= Q and inv["cb_gbp"] >= Q}
            for side, w in (("bid", wb), ("ask", wa)):
                if not on[side]:
                    blocked_min[side] += 1; last[side] = None; continue
                if last[side] is None or abs(last[side] - w) > 1e-9:
                    orders += 1; last[side] = w
        while pi < len(ps) and ps[pi][0] < t + 60_000:
            pt, px, qty, side, _ = ps[pi]; pi += 1
            if pt < t or 0.095 <= px * qty <= 0.105:
                continue
            ii = bisect.bisect_right(st, t) - 1
            jj = bisect.bisect_right(ct, t) - 1
            if not fresh(ii, t) or jj < 0 or t - ct[jj] > 60_000:
                continue
            rb, ra, ob, oa = want(ii, jj)
            k = bisect.bisect_left(ct, pt + DELAY * 1000)
            if k >= len(cb) or cb[k][0] - (pt + DELAY * 1000) > 90_000:
                continue
            if side == "sell":
                ours = ob
                if px > ours + 1e-12:
                    continue
                inside = ours > rb + 1e-12
                if not inside and not px < ours - 1e-12:
                    continue
                if inv["rx_gbp"] < Q or inv["cb_coin"] < Q:
                    continue
                q = min(Q, px * qty)
                h, hsz = cb[k][1], cb[k][3] * cb[k][1]
                e = L.bps(h, ours) - FEE
                if q > hsz:
                    e -= (q - hsz) / q * 1e4 * T / h
                inv["rx_gbp"] -= q; inv["rx_coin"] += q; inv["cb_coin"] -= q; inv["cb_gbp"] += q
            else:
                ours = oa
                if px < ours - 1e-12:
                    continue
                inside = ours < ra - 1e-12
                if not inside and not px > ours + 1e-12:
                    continue
                if inv["rx_coin"] < Q or inv["cb_gbp"] < Q:
                    continue
                q = min(Q, px * qty)
                h, hsz = cb[k][2], cb[k][4] * cb[k][2]
                e = L.bps(ours, h) - FEE
                if q > hsz:
                    e -= (q - hsz) / q * 1e4 * T / h
                inv["rx_coin"] -= q; inv["rx_gbp"] += q; inv["cb_gbp"] -= q; inv["cb_coin"] += q
            fills += 1; orders += 1; edges.append(e); pnl += q * e / 1e4
            byday[L.day(pt)] += q * e / 1e4
    days = sorted(byday)
    return {"fills_per_day": round(fills / DAYS, 1), "bps_per_fill": round(statistics.mean(edges), 2) if edges else None,
            "gbp_per_day": round(pnl / DAYS, 3), "pct_year_on_1200": round(pnl / DAYS * 365 / C * 100, 1),
            "days_positive": f"{sum(1 for v in byday.values() if v > 0)}/{round(DAYS)}",
            "bid_blocked_min_per_day": round(blocked_min["bid"] / DAYS), "ask_blocked_min_per_day": round(blocked_min["ask"] / DAYS),
            "orders_per_day": round(orders / DAYS),
            "before_after_10_13_gbp_per_day": [round(sum(v for k, v in byday.items() if k < "2026-10-13") / 2.92, 3),
                                               round(sum(v for k, v in byday.items() if k >= "2026-10-13") / 16.0, 3)]}


res = {"window": "2026-10-10 02:00 -> 2026-10-29 00:00 UTC", "days": round(DAYS, 2),
       "model": "£600 a venue a book (£300 pounds, £300 coin), £100 orders, no transfers, hedge at the first Coinbase read >= fill + 30 s, 0.45 bps"}
for bk in ("USDT-GBP", "USDC-GBP"):
    snaps = [s for s in L.book(bk) if s[1] and s[2]]
    st = [s[0] for s in snaps]
    seen = L.book_seen(bk)
    cb = cb_series(bk); ct = [c[0] for c in cb]
    ps = [p for p in L.prints(bk) if START <= p[0] < END]
    out = {"A1": run(snaps, st, seen, cb, ct, ps, "A1")}
    print(bk, "A1", out["A1"], flush=True)
    for cap in ("behind", "free"):
        for d in (3, 5, 7.5, 10, 15, 20, 30):
            k = f"A2|{cap}|d{d:g}"
            out[k] = run(snaps, st, seen, cb, ct, ps, "A2", d, cap)
            print(bk, k, out[k], flush=True)
    res[bk] = out
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
