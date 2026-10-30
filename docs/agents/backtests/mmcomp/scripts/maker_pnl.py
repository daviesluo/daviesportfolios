# MMCOMP-2 part C: what the $5,000 maker earns on Revolut X's GBP books, from the public tape and the book record
# (2026-09-26 -> 10-29 00:00 UTC). Revolut X prints one trade per resting order matched, so a print at a price where the
# last fresh snapshot (<= 75 s since the recorder last saw it) shows ONE order of the maker's size (4,999.5-5,010 coins) on
# the side the taker hit is counted as the maker's fill ("sure"); a print at a level of several orders that include one of
# that size is counted apart ("shared", an upper bound). For each fill:
#   captured   the fill price against fair (fairU / GBP/USD, PR5's own), in the maker's favour, bps
#   vs_cb      the same against Coinbase's mid at the time (from 10-10, where cb_touch is recorded)
#   markouts   Revolut X's mid 1, 5, 30 and 60 minutes later against the fill price, in the maker's favour: the realised
#              spread if it unwinds at the mid then; captured minus it is its adverse selection
# then per day: fills, coins and pounds traded, and pounds earned at each horizon. Also what a quote ONE TICK INSIDE it would
# have taken of the same prints (they reach us first), at Q = 100 and 500 pounds a fill, and what that earns at the 30-minute
# mid (one tick less than the maker's price).
# python3 -I docs/agents/backtests/mmcomp/scripts/maker_pnl.py   -> results/maker_pnl.json
import bisect, collections, json, math, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
import load as L

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "maker_pnl.json")
START, END = 1790380800000, 1793232000000   # 2026-09-26, 2026-10-29
SPLIT = 1791849600000                       # 2026-10-13
fx = L.gbpusd()
H = (1, 5, 30, 60)


def is5k(level):
    return 4999.5 <= level[1] <= 5010


res = {"window": "2026-09-26 -> 2026-10-29 00:00 UTC"}
for bk in ("USDC-GBP", "USDT-GBP"):
    snaps = [s for s in L.book(bk) if s[1] and s[2]]
    st = [s[0] for s in snaps]
    seen = L.book_seen(bk)
    usd = L.usd(bk)
    mid = L.Series([(s[0], (s[1][0][0] + s[2][0][0]) / 2) for s in snaps], max_age=30 * 60_000)
    cb = L.cb(bk)
    cbm = L.Series([(c[0], (c[1] + c[2]) / 2) for c in cb if c[2] > c[1] > 0], max_age=120_000)
    ps = [p for p in L.prints(bk) if START <= p[0] < END and not (0.095 <= p[1] * p[2] <= 0.105)]
    rows = {"sure": [], "shared": []}
    for t, px, qty, side, _ in ps:
        i = bisect.bisect_right(st, t) - 1
        if i < 0 or t > seen[snaps[i][0]] + 75_000:
            continue
        _, bids, asks = snaps[i]
        levels = bids if side == "sell" else asks
        lev = next((l for l in levels if abs(l[0] - px) < 1e-9), None)
        if lev is None:
            continue
        if lev[2] == 1 and is5k(lev):
            kind = "sure"
        elif (lev[2] or 0) > 1 and lev[1] >= 4999.5:
            kind = "shared"
        else:
            continue
        sgn = 1 if side == "sell" else -1          # the maker bought (+) when the taker sold
        x, u = fx.at(t), usd.at(t)
        cap = sgn * L.bps((u / x), px) if x and u else None
        c0 = cbm.at(t)
        vs_cb = sgn * L.bps(c0, px) if c0 else None
        mk = {}
        for h in H:
            m1 = mid.at(t + h * 60_000)
            v = sgn * L.bps(m1, px) if m1 else None
            # a mid more than 50 bps off is an emptied book (a weekend's: 10-04's touch was 21 ticks with nothing within
            # 10 bps), not a price: left out, and counted
            mk[h] = v if v is not None and abs(v) <= 50 else None
        rows[kind].append((t, px, min(qty, lev[1]), cap, vs_cb, mk, side))
    out = {}
    days = (END - START) / L.DAY
    for kind, rs in rows.items():
        g = lambda r: r[1] * r[2]
        vol = sum(g(r) for r in rs)
        o = {"fills": len(rs), "fills_per_day": round(len(rs) / days, 1), "gbp_per_day": round(vol / days),
             "buys": sum(1 for r in rs if r[6] == "sell"), "sells": sum(1 for r in rs if r[6] == "buy")}
        w = [(g(r), r[3]) for r in rs if r[3] is not None]
        o["captured_vs_fair_bps"] = round(sum(a * b for a, b in w) / sum(a for a, _ in w), 2) if w else None
        w = [(g(r), r[4]) for r in rs if r[4] is not None]
        o["captured_vs_cb_mid_bps"] = round(sum(a * b for a, b in w) / sum(a for a, _ in w), 2) if w else None
        o["vs_cb_fills"] = len(w)
        for h in H:
            w = [(g(r), r[5][h]) for r in rs if r[5][h] is not None]
            tot = sum(a * b / 1e4 for a, b in w)
            o[f"realised_{h}m_bps"] = round(tot / sum(a for a, _ in w) * 1e4, 2) if w else None
            o[f"gbp_per_day_{h}m"] = round(tot / days, 2)
            for nm, lo, hi in (("before", START, SPLIT), ("from", SPLIT, END)):
                ww = [(g(r), r[5][h]) for r in rs if r[5][h] is not None and lo <= r[0] < hi]
                o[f"realised_{h}m_bps_{nm}_10_13"] = round(sum(a * b for a, b in ww) / sum(a for a, _ in ww), 2) if ww else None
        out[kind] = o
    # one tick inside the maker: the same 'sure' prints reach us first, at a price one tick better for the taker
    inside = {}
    for Q in (100.0, 500.0):
        tot_g, pnl30, n = 0.0, 0.0, 0
        for t, px, q, cap, vs_cb, mk, side in rows["sure"]:
            ours = px + L.TICK if side == "sell" else px - L.TICK
            take = min(Q, ours * q)
            if mk[30] is None:
                continue
            m30 = px * math.exp((1 if side == "sell" else -1) * mk[30] / 1e4)
            e = (1 if side == "sell" else -1) * L.bps(m30, ours)
            n += 1; tot_g += take; pnl30 += take * e / 1e4
        inside[f"Q{Q:g}"] = {"fills": n, "gbp_per_day": round(tot_g / days), "share_of_maker_gbp": round(tot_g / max(1e-9, sum(r[1] * r[2] for r in rows["sure"])), 3),
                             "realised_30m_bps": round(pnl30 / tot_g * 1e4, 2) if tot_g else None, "gbp_per_day_30m": round(pnl30 / days, 3)}
    out["one_tick_inside"] = inside
    res[bk] = out
    print(bk, json.dumps(out, indent=1), flush=True)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
