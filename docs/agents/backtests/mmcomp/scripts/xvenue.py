# MMCOMP part 6: what the recorded books say a strategy "like the other maker's" would earn, 2026-10-10 02:00 -> 10-29 00:00 UTC
# (where Revolut X's snapshots and Coinbase's touch overlap), on USDC-GBP and USDT-GBP. Paper arithmetic only.
#   A  taker cross: buy Revolut X's ask and sell Coinbase's bid (or the reverse) when the gap beats both taker fees
#      (Revolut X 9 bps; Coinbase stable pairs 0.45 bps, its dearest published tier). Revolut X's snapshot at about :40
#      against Coinbase's touch read at :00 the same minute.
#   B  rest on Revolut X, hedge on Coinbase: a post-only bid one tick above Revolut X's best bid (never at or through the ask),
#      no higher than Coinbase's bid less a margin m; a sell print at or below it fills it (first in its queue), up to Q
#      pounds; the coins are sold at once on Coinbase at the bid of the next Coinbase read (<= 60 s later), paying 0.45 bps.
#      The ask side the same way round. Every fill is counted at the print's own time and size; the GBP 0.10 prints are left
#      out. No transfer cost is counted (a one-sided book on each venue needs coins moved Revolut X -> Coinbase and pounds
#      back; Revolut X's withdrawal fee was not read).
#   C  FX lead-lag taker: when fair (Revolut X's USD book's 24 h median / Yahoo's GBP/USD minute bar) has moved so that
#      Revolut X's ask is more than 9 bps + m under fair (or its bid that far over), take it, and close at the book's mid
#      30 minutes later as a maker (no second fee): what the recorded minutes would have paid.
# python3 -I docs/agents/backtests/mmcomp/scripts/xvenue.py   -> results/xvenue.json
import bisect, collections, json, math, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
import load as L

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "xvenue.json")
START, END = 1791598800000, 1793232000000   # 2026-10-10 02:00, 2026-10-29 00:00
RX_TAKER, CB_TAKER = 9.0, 0.45
fx = L.gbpusd()
res = {"window": "2026-10-10 02:00 -> 2026-10-29 00:00 UTC", "fees_bps": {"rx_taker": RX_TAKER, "cb_taker": CB_TAKER}}


def at_or_before(ts, t):
    i = bisect.bisect_right(ts, t) - 1
    return i


for bk in ("USDC-GBP", "USDT-GBP"):
    snaps = [s for s in L.book(bk) if s[1] and s[2]]
    st = [s[0] for s in snaps]
    seen = L.book_seen(bk)
    fresh = lambda i, t: t <= seen[snaps[i][0]] + 75_000     # the recorder saw this book within the last 75 s
    cb =[c for c in L.cb(bk) if c[1] > 0 and c[2] > c[1]]
    ct = [c[0] for c in cb]
    usd = L.usd(bk)
    days = (END - START) / L.DAY
    out = {}
    # basis and A
    gaps_buy, gaps_sell, basis = [], [], []
    a_trades, a_last = [], -10**15      # A as trades: at most one every 5 minutes, up to GBP 500, both legs at once
    for t in range(START + 40_000, END, 60_000):
        i, j = at_or_before(st, t), at_or_before(ct, t)
        if i < 0 or j < 0 or t - ct[j] > 90_000 or not fresh(i, t) or j + 1 >= len(cb) or ct[j + 1] - t > 90_000:
            continue
        _, bids, asks = snaps[i]
        # Coinbase's read before (~40 s) and after (~20 s): a gap must hold against both to count
        cbb, cba = min(cb[j][1], cb[j + 1][1]), max(cb[j][2], cb[j + 1][2])
        rb, ra = bids[0][0], asks[0][0]
        basis.append(L.bps((rb + ra) / 2, (cbb + cba) / 2))
        gaps_buy.append(L.bps(cbb, ra))     # buy RX ask, sell CB bid
        gaps_sell.append(L.bps(rb, cba))    # sell RX bid, buy CB ask
        thr0 = RX_TAKER + CB_TAKER
        for g, rq, cq, px in ((gaps_buy[-1], asks[0][1], min(cb[j][3], cb[j + 1][3]), ra), (gaps_sell[-1], bids[0][1], min(cb[j][4], cb[j + 1][4]), rb)):
            if g > thr0 and t - a_last >= 5 * 60_000:
                q = min(500.0, rq * px, cq * px)
                a_trades.append((g - thr0, q))
                a_last = t
    thr = RX_TAKER + CB_TAKER
    out["basis_rx_mid_vs_cb_mid_bps"] = {"median": round(L.median(basis), 2), "p10": round(L.q(basis, .1), 2), "p90": round(L.q(basis, .9), 2), "minutes": len(basis)}
    out["A_taker_cross"] = {"minutes_buyRX_sellCB_over_fees": sum(g > thr for g in gaps_buy), "minutes_sellRX_buyCB_over_fees": sum(g > thr for g in gaps_sell),
                            "gap_buyRX_sellCB_p99": round(L.q(gaps_buy, .99), 2), "gap_sellRX_buyCB_p99": round(L.q(gaps_sell, .99), 2),
                            "best_buyRX": round(max(gaps_buy), 2), "best_sellRX": round(max(gaps_sell), 2),
                            "trades_5min_apart": len(a_trades), "excess_bps_median": round(L.median([e for e, _ in a_trades]), 2) if a_trades else None,
                            "gbp_per_trade_median": round(L.median([q for _, q in a_trades])) if a_trades else None,
                            "pnl_gbp_per_day_at_500": round(sum(e * q / 1e4 for e, q in a_trades) / days, 3)}
    # B (and B without the hedge: the same fills closed on Revolut X at its mid 30 minutes later, as a maker, no fee;
    # an upper bound, since a resting exit at the mid is not sure to fill)
    mid = L.Series([(s[0], (s[1][0][0] + s[2][0][0]) / 2) for s in snaps], max_age=30 * 60_000)
    ps = [p for p in L.prints(bk) if START <= p[0] < END and not (0.095 <= p[1] * p[2] <= 0.105)]
    B = {}
    for m in (0.0, 2.0, 4.0):
        for Q in (100.0, 500.0):
            pnl, n, gbp, per = 0.0, 0, 0.0, []
            side_n = collections.Counter()
            byday, half, net = collections.Counter(), [0.0, 0.0], collections.Counter()
            nhs, nh_pnl = [], 0.0
            for t, px, qty, side, _ in ps:
                i, j = at_or_before(st, t), at_or_before(ct, t)
                if i < 0 or j < 0 or not fresh(i, t) or t - ct[j] > 90_000:
                    continue
                _, bids, asks = snaps[i]
                rb, ra = bids[0][0], asks[0][0]
                k = bisect.bisect_right(ct, t)     # the next Coinbase read after the fill
                if k >= len(cb) or cb[k][0] - t > 70_000:
                    continue
                if side == "sell":                 # a taker sold: our bid
                    cap = math.floor(cb[j][1] * (1 - m / 1e4) / L.TICK + 1e-9) * L.TICK
                    ours = min(rb + L.TICK, ra - L.TICK, cap)
                    if ours <= 0 or px > ours + 1e-12:
                        continue
                    if ours <= rb + 1e-12 and not px < ours - 1e-12:
                        continue                   # not inside the touch: behind the queue, filled only if traded through
                    fill_gbp = min(Q, px * qty, cb[k][3] * cb[k][1])   # no more than Coinbase's bid holds
                    edge = L.bps(cb[k][1], ours) - CB_TAKER
                    side_n["bid"] += 1
                    m30 = mid.at(t + 30 * 60_000)
                    nh = L.bps(m30, ours) if m30 else None
                else:                              # a taker bought: our ask
                    cap = math.ceil(cb[j][2] * (1 + m / 1e4) / L.TICK - 1e-9) * L.TICK
                    ours = max(ra - L.TICK, rb + L.TICK, cap)
                    if px < ours - 1e-12:
                        continue
                    if ours >= ra - 1e-12 and not px > ours + 1e-12:
                        continue
                    fill_gbp = min(Q, px * qty, cb[k][4] * cb[k][2])
                    edge = L.bps(ours, cb[k][2]) - CB_TAKER
                    side_n["ask"] += 1
                    m30 = mid.at(t + 30 * 60_000)
                    nh = L.bps(ours, m30) if m30 else None
                n += 1
                gbp += fill_gbp
                pnl += fill_gbp * edge / 1e4
                per.append(edge)
                if nh is not None:
                    nhs.append(nh)
                    nh_pnl += fill_gbp * nh / 1e4
                byday[L.day(t)] += fill_gbp * edge / 1e4
                half[t >= (START + END) // 2] += fill_gbp * edge / 1e4
                net[side] += fill_gbp
            B[f"m{m:g}_Q{Q:g}"] = {"fills": n, "by_side": dict(side_n), "fills_per_day": round(n / days, 1), "gbp_per_day": round(gbp / days),
                                  "edge_bps_mean": round(statistics.mean(per), 2) if per else None,
                                  "edge_bps_p10": round(L.q(per, .1), 2) if per else None,
                                  "pnl_gbp_per_day": round(pnl / days, 3),
                                  "nohedge_edge_bps_mean": round(statistics.mean(nhs), 2) if nhs else None,
                                  "nohedge_pnl_gbp_per_day": round(nh_pnl / days, 3),
                                  "days_positive": f"{sum(1 for v in byday.values() if v > 0)}/{len(byday)}",
                                  "halves_gbp_per_day": [round(h / (days / 2), 3) for h in half],
                                  # coins bought on Revolut X (and sold on Coinbase) less coins sold there, GBP a day: what
                                  # transfers between the venues would have to carry
                                  "net_coins_into_rx_gbp_per_day": round((net["sell"] - net["buy"]) / days)}
    out["B_rest_rx_hedge_cb"] = B
    # C
    mid = L.Series([(s[0], (s[1][0][0] + s[2][0][0]) / 2) for s in snaps], max_age=30 * 60_000)
    C = {}
    for m in (0.0, 3.0):
        trades = []
        last = -10**15
        for t in range(START + 40_000, END, 60_000):
            i = at_or_before(st, t)
            x, u = fx.at(t), usd.at(t)
            if i < 0 or not fresh(i, t) or not x or not u or t - last < 30 * 60_000:
                continue
            f = u / x
            _, bids, asks = snaps[i]
            rb, ra = bids[0][0], asks[0][0]
            later = mid.at(t + 30 * 60_000)
            if not later:
                continue
            if L.bps(f, ra) > RX_TAKER + m:
                trades.append(L.bps(later, ra) - RX_TAKER); last = t
            elif L.bps(rb, f) > RX_TAKER + m:
                trades.append(L.bps(rb, later) - RX_TAKER); last = t
        C[f"m{m:g}"] = {"trades": len(trades), "per_day": round(len(trades) / days, 2),
                        "net_bps_mean": round(statistics.mean(trades), 2) if trades else None,
                        "net_bps_median": round(L.median(trades), 2) if trades else None,
                        "won": sum(1 for x in trades if x > 0)}
    out["C_fx_leadlag_taker"] = C
    res[bk] = out

json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
print(json.dumps(res, indent=1, sort_keys=True))
