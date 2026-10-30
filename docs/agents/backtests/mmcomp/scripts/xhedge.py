# MMCOMP-2 part A: "rest one tick inside the other maker on Revolut X, hedge at once on Coinbase", replayed with every cost
# the first pass left out (2026-10-10 02:00 -> 10-29 00:00 UTC, USDC-GBP and USDT-GBP):
#   - the hedge's delay: Coinbase's touch every 30 s (cb_touch at :00, REVX-FAIR's copy; cb_book_levels' best level at :30,
#     data/cb30_*.txt.gz), the hedge at the first Coinbase read at or after fill + d, d = 0, 15, 30, 60, 90 s;
#   - the queue against the other maker: 'first' (one tick inside it, so first: a print at or through our price fills us; a
#     price we would only have joined fills only when traded through), 'half' (half each print), 'through' (the maker matches
#     us at once: only prints strictly through our price fill us);
#   - Coinbase's taker fee 0.1 bps (the stable-pair rate) or 0.45 (the dearest tier the reference names); a hedge larger than
#     Coinbase's best level pays one tick more on the rest;
#   - inventory on both venues: capital C split in four (Revolut X pounds and coins, Coinbase pounds and coins), a side quotes
#     only while both its legs have Q; every UTC midnight coins Revolut X -> Coinbase (or back) restore the split when the
#     imbalance is >= the batch floor, Revolut X's withdrawal costing GBP 3 + network (USDC on Solana GBP 0.05, USDT GBP 1.00
#     assumed), Coinbase's USDC withdrawal free and USDT 0.01 % (at most 20) + GBP 1.00; pounds go back by bank, free, 24 h
#     later; coins arrive an hour after they are sent;
#   - Revolut X's order count: a new order every minute our wanted price moves, and after every fill.
# Coins held are constant across the two venues (every fill is hedged), so the P&L is the spread alone; the coins' value moves
# with GBP/USD as LIVE's do and is not counted here.
# python3 -I docs/agents/backtests/mmcomp/scripts/xhedge.py   -> results/xhedge.json
import bisect, collections, gzip, json, math, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
import load as L

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "results", "xhedge.json")
START, END = 1791598800000, 1793232000000
DAYS = (END - START) / L.DAY
T = L.TICK
RX_OUT = {"USDC-GBP": 3.05, "USDT-GBP": 4.00}            # GBP a Revolut X withdrawal
CB_OUT = {"USDC-GBP": lambda g: 0.0, "USDT-GBP": lambda g: min(0.0001 * g, 15.0) + 1.0}


def cb_series(bk):
    rows = [(c[0], c[1], c[2], c[3], c[4]) for c in L.cb(bk)]
    for line in gzip.open(os.path.join(HERE, "..", "data", f"cb30_{bk}.txt.gz"), "rt"):
        f = line.strip().split("|")
        if len(f) == 5:   # the level recorder stores prices in 0.0001 and sizes in 0.01 coin
            rows.append((int(f[0]), float(f[1]) * 1e-4, float(f[2]) * 1e-4, float(f[3]) * 0.01, float(f[4]) * 0.01))
    rows = [r for r in rows if r[1] > 0 and r[2] > r[1]]
    rows.sort()
    return rows


def run(bk, snaps, st, seen, cb, ct, ps, m, d, queue, fee, C, Qmax, batch_min=500.0):
    quarter = C / 4
    inv = {"rx_gbp": quarter, "rx_coin": quarter, "cb_gbp": quarter, "cb_coin": quarter}   # pounds (coins at their price)
    pending = []            # (arrive_ms, key, gbp)
    fills, edges, pnl, gross_gbp = 0, [], 0.0, 0.0
    cost_transfer, transfers = 0.0, 0
    blocked = collections.Counter()
    byday = collections.Counter()
    next_mid = (START // L.DAY + 1) * L.DAY
    orders = 0
    last_want = {"bid": None, "ask": None}

    def fresh(i, t):
        return i >= 0 and t <= seen[snaps[i][0]] + 75_000

    def settle(t):
        nonlocal pending
        keep = []
        for a, k, g in pending:
            if a <= t:
                inv[k] += g
            else:
                keep.append((a, k, g))
        pending = keep

    def rebalance(t):
        nonlocal cost_transfer, transfers
        # coins: move from the venue with more to the one with less
        diff = (inv["rx_coin"] - inv["cb_coin"]) / 2
        if abs(diff) >= batch_min:
            if diff > 0:
                c = RX_OUT[bk]; inv["rx_coin"] -= diff; pending.append((t + 3_600_000, "cb_coin", diff))
            else:
                c = CB_OUT[bk](-diff); inv["cb_coin"] += diff; pending.append((t + 3_600_000, "rx_coin", -diff))
            cost_transfer += c; transfers += 1; byday[L.day(t)] -= c
        g = (inv["cb_gbp"] - inv["rx_gbp"]) / 2
        if abs(g) >= batch_min:
            if g > 0:
                inv["cb_gbp"] -= g; pending.append((t + L.DAY, "rx_gbp", g))
            else:
                inv["rx_gbp"] += g; pending.append((t + L.DAY, "cb_gbp", -g))

    # minute grid for the order count: our wanted prices at each fresh snapshot
    def want(i, j):
        _, bids, asks = snaps[i]
        rb, ra = bids[0][0], asks[0][0]
        cap_b = math.floor(cb[j][1] * (1 - m / 1e4) / T + 1e-9) * T
        cap_a = math.ceil(cb[j][2] * (1 + m / 1e4) / T - 1e-9) * T
        return rb, ra, min(rb + T, ra - T, cap_b), max(ra - T, rb + T, cap_a)

    pi = 0
    for t in range(START + 40_000, END, 60_000):
        while next_mid <= t:
            settle(next_mid); rebalance(next_mid); next_mid += L.DAY
        settle(t)
        i = bisect.bisect_right(st, t) - 1
        j = bisect.bisect_right(ct, t) - 1
        if fresh(i, t) and j >= 0 and t - ct[j] <= 90_000:
            _, _, wb, wa = want(i, j)
            for side, w in (("bid", wb), ("ask", wa)):
                if last_want[side] is None or abs(last_want[side] - w) > 1e-9:
                    orders += 1; last_want[side] = w
        # the prints of the next minute
        while pi < len(ps) and ps[pi][0] < t + 60_000:
            pt, px, qty, side, _ = ps[pi]; pi += 1
            if pt < START or 0.095 <= px * qty <= 0.105:
                continue
            ii = bisect.bisect_right(st, pt) - 1
            jj = bisect.bisect_right(ct, pt) - 1
            if not fresh(ii, pt) or jj < 0 or pt - ct[jj] > 90_000:
                continue
            rb, ra, ob, oa = want(ii, jj)
            k = bisect.bisect_left(ct, pt + d * 1000)      # the hedge: the first Coinbase read at or after fill + d
            if k >= len(cb) or cb[k][0] - (pt + d * 1000) > 90_000:
                continue
            if side == "sell":       # a taker sells into our bid
                ours = ob
                if ours <= 0 or px > ours + 1e-12:
                    continue
                joined = ours <= rb + 1e-12
                if (queue == "through" or joined) and not px < ours - 1e-12:
                    continue
                share = 0.5 if queue == "half" else 1.0
                if inv["rx_gbp"] < Qmax or inv["cb_coin"] < Qmax:
                    blocked["bid"] += 1; continue
                q = min(Qmax, px * qty * share)
                h, hsz = cb[k][1], cb[k][3] * cb[k][1]
                e = L.bps(h, ours) - fee
                if q > hsz:
                    e -= (q - hsz) / q * 1e4 * T / h
                inv["rx_gbp"] -= q; inv["rx_coin"] += q; inv["cb_coin"] -= q; inv["cb_gbp"] += q
            else:                    # a taker buys our ask
                ours = oa
                if px < ours - 1e-12:
                    continue
                joined = ours >= ra - 1e-12
                if (queue == "through" or joined) and not px > ours + 1e-12:
                    continue
                share = 0.5 if queue == "half" else 1.0
                if inv["rx_coin"] < Qmax or inv["cb_gbp"] < Qmax:
                    blocked["ask"] += 1; continue
                q = min(Qmax, px * qty * share)
                h, hsz = cb[k][2], cb[k][4] * cb[k][2]
                e = L.bps(ours, h) - fee
                if q > hsz:
                    e -= (q - hsz) / q * 1e4 * T / h
                inv["rx_coin"] -= q; inv["rx_gbp"] += q; inv["cb_gbp"] -= q; inv["cb_coin"] += q
            fills += 1; orders += 1; edges.append(e); pnl += q * e / 1e4; gross_gbp += q
            byday[L.day(pt)] += q * e / 1e4
    net = pnl - cost_transfer
    return {"fills_per_day": round(fills / DAYS, 1), "gbp_per_day": round(gross_gbp / DAYS),
            "edge_bps": round(statistics.mean(edges), 2) if edges else None,
            "transfer_bps_per_fill": round(cost_transfer / gross_gbp * 1e4, 2) if gross_gbp else None,
            "net_bps_per_fill": round(net / gross_gbp * 1e4, 2) if gross_gbp else None,
            "gross_gbp_per_day": round(pnl / DAYS, 3), "transfer_gbp_per_day": round(cost_transfer / DAYS, 3),
            "net_gbp_per_day": round(net / DAYS, 3), "net_pct_year": round(net / DAYS * 365 / C * 100, 1),
            "transfers": transfers, "blocked_prints": dict(blocked),
            "days_positive": f"{sum(1 for v in byday.values() if v > 0)}/{len(byday)}",
            # 10-10 02:00 -> 10-20 00:00 (9.9 days) and 10-20 -> 10-29 (9 days)
            "halves_net_gbp_per_day": [round(sum(v for k, v in byday.items() if k < "2026-10-20") / 9.92, 3),
                                       round(sum(v for k, v in byday.items() if k >= "2026-10-20") / 9.0, 3)],
            "rx_orders_per_day": round(orders / DAYS)}


res = {"window": "2026-10-10 02:00 -> 2026-10-29 00:00 UTC", "days": round(DAYS, 2)}
for bk in ("USDC-GBP", "USDT-GBP"):
    snaps = [s for s in L.book(bk) if s[1] and s[2]]
    st = [s[0] for s in snaps]
    seen = L.book_seen(bk)
    cb = cb_series(bk); ct = [c[0] for c in cb]
    gaps = [b - a for a, b in zip(ct, ct[1:])]
    ps = [p for p in L.prints(bk) if START <= p[0] < END]
    out = {"cb_reads": len(cb), "cb_gaps_over_120s": sum(1 for g in gaps if g > 120_000), "cb_longest_gap_s": round(max(gaps) / 1000)}
    grid = {}
    # the delay and queue grid at the base money (C 5,000, Q 100, m 2, fee 0.45)
    for d in (0, 15, 30, 60, 90):
        for queue in ("first", "half", "through"):
            grid[f"d{d}|{queue}"] = run(bk, snaps, st, seen, cb, ct, ps, 2.0, d, queue, 0.45, 5000.0, 100.0)
            print(bk, d, queue, grid[f"d{d}|{queue}"], flush=True)
    out["delay_queue_C5000_Q100_m2_fee0.45"] = grid
    sizes = {}
    for C, Q in ((600.0, 50.0), (600.0, 100.0), (1200.0, 100.0), (2400.0, 100.0), (5000.0, 100.0), (5000.0, 500.0), (20000.0, 500.0)):
        for xfer, bmin in (("none", float("inf")), ("batch500", 500.0), ("batch2000", 2000.0)):
            for fee in (0.1, 0.45):
                r = run(bk, snaps, st, seen, cb, ct, ps, 2.0, 30, "first", fee, C, Q, batch_min=bmin)
                sizes[f"C{C:g}|Q{Q:g}|{xfer}|fee{fee}"] = r
                print(bk, f"C{C:g}|Q{Q:g}|{xfer}|fee{fee}", r, flush=True)
    out["sizes_d30_first_m2"] = sizes
    # the margin m under Coinbase's touch: 0, 2 and 4 bps, at C 1,200, Q 100, no transfers
    out["margin_C1200_Q100_none"] = {f"m{m:g}": run(bk, snaps, st, seen, cb, ct, ps, m, 30, "first", 0.45, 1200.0, 100.0,
                                                    batch_min=float("inf")) for m in (0.0, 2.0, 4.0)}
    res[bk] = out
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
