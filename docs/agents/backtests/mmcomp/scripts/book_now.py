# MMCOMP part 2: Revolut X's UK GBP stablecoin books as recorded (agent_book_levels, five levels a side, read once a minute at
# about :40 and stored when changed; 2026-09-26 -> 2026-10-29 00:00 UTC, REVX-FAIR's committed copy), day by day:
#   spread   the touch in ticks (0.0001) and bps, time-weighted median and share of minutes at one tick
#   top      the touch's size (coins) and order count, both sides, medians
#   depth    coins within 10 bps of the mid, both sides together, median
#   reprice  how many minutes a day the best bid or best ask price changed
#   fxbeta   OLS slope of the mid's 10-minute change on fair's (Revolut X USD book's 24 h median / GBP/USD), and the
#            correlation, on non-overlapping 10-minute steps; a quoting algorithm that tracks GBP/USD gives a slope near 1
#   sizes    the touch's most frequent sizes (coins, rounded to 0.001) over the window: a recurring size is one order's
#            signature
# LIVE's own resting orders are NOT taken out here (they are not committed); part 5 (sql/ours_at_touch.sql) measures them.
# python3 -I docs/agents/backtests/mmcomp/scripts/book_now.py   -> results/book_now.json
import collections, json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
import load as L

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "book_now.json")
fx = L.gbpusd()


def wmed(pairs):
    pairs = sorted(pairs)
    tot = sum(w for _, w in pairs)
    acc = 0
    for v, w in pairs:
        acc += w
        if acc >= tot / 2:
            return v
    return None


def study(bk):
    snaps = L.book(bk)
    usd = L.usd(bk)
    days = collections.defaultdict(lambda: {"sp": [], "one": [0, 0], "bq": [], "aq": [], "bo": [], "ao": [], "depth": [], "rep": 0, "n": 0})
    sizes = collections.Counter()
    sizes_day = collections.defaultdict(collections.Counter)
    prev = None
    for i, (t, bids, asks) in enumerate(snaps):
        if not bids or not asks:
            continue
        nxt = snaps[i + 1][0] if i + 1 < len(snaps) else t + 60_000
        w = max(1, min(nxt - t, 3_600_000)) / 60_000
        bb, ba = bids[0][0], asks[0][0]
        mid = (bb + ba) / 2
        d = days[L.day(t)]
        ticks = round((ba - bb) / L.TICK)
        d["sp"].append((ticks, w))
        d["one"][0] += w * (ticks == 1)
        d["one"][1] += w
        d["bq"].append(bids[0][1]); d["aq"].append(asks[0][1])
        d["bo"].append(bids[0][2] or 0); d["ao"].append(asks[0][2] or 0)
        d["depth"].append(sum(q for p, q, _ in bids if L.bps(mid, p) <= 10) + sum(q for p, q, _ in asks if L.bps(p, mid) <= 10))
        d["n"] += 1
        if prev and (prev[0] != bb or prev[1] != ba):
            d["rep"] += 1
        prev = (bb, ba)
        for q in (bids[0][1], asks[0][1]):
            sizes[round(q, 3)] += 1
            sizes_day[L.day(t)][round(q, 3)] += 1
    # FX tracking: the mid at each 10-minute mark (last snapshot at or before it) against fair
    mids = L.Series([(t, (b[0][0] + a[0][0]) / 2) for t, b, a in snaps if b and a], max_age=30 * 60_000)
    steps = collections.defaultdict(list)
    t0 = (snaps[0][0] // 600_000 + 1) * 600_000
    t = t0
    while t + 600_000 <= snaps[-1][0]:
        m0, m1 = mids.at(t), mids.at(t + 600_000)
        x0, x1, u0, u1 = fx.at(t), fx.at(t + 600_000), usd.at(t), usd.at(t + 600_000)
        if m0 and m1 and x0 and x1 and u0 and u1:
            steps[L.day(t)].append((math.log((u1 / x1) / (u0 / x0)), math.log(m1 / m0)))
        t += 600_000
    out = {}
    for k in sorted(days):
        d = days[k]
        st = steps.get(k, [])
        sxx = sum(x * x for x, _ in st)
        syy = sum(y * y for _, y in st)
        sxy = sum(x * y for x, y in st)
        sp = wmed(d["sp"])
        out[k] = {"snaps": d["n"], "spread_ticks_med": sp, "spread_bps_med": round(sp * 1e4 * L.TICK / 0.75, 2) if sp else None,
                  "one_tick_share": round(d["one"][0] / d["one"][1], 3) if d["one"][1] else None,
                  "bid_qty_med": round(L.median(d["bq"])), "ask_qty_med": round(L.median(d["aq"])),
                  "bid_orders_med": L.median(d["bo"]), "ask_orders_med": L.median(d["ao"]),
                  "depth10_med": round(L.median(d["depth"])), "reprices": d["rep"],
                  "fxbeta": round(sxy / sxx, 2) if sxx else None, "fxcorr": round(sxy / math.sqrt(sxx * syy), 2) if sxx and syy else None,
                  "fx_steps": len(st),
                  "top_sizes": [[s, n] for s, n in sizes_day[k].most_common(4)]}
    return {"days": out, "top_sizes_window": [[s, n] for s, n in sizes.most_common(25)]}


res = {b: study(b) for b in ("USDC-GBP", "USDT-GBP")}
json.dump(res, open(OUT, "w"), indent=0, sort_keys=True)
for b, r in res.items():
    print(b, "top sizes over the window:", r["top_sizes_window"][:15])
    print("day        snaps tk  bps  1tick  bidq   askq  bo ao  depth10 repr fxb  fxc (n)  top sizes")
    for k, v in r["days"].items():
        print(f"{k} {v['snaps']:5} {v['spread_ticks_med']!s:3} {v['spread_bps_med']!s:5} {v['one_tick_share']!s:5} {v['bid_qty_med']:6} {v['ask_qty_med']:6} "
              f"{v['bid_orders_med']!s:2} {v['ask_orders_med']!s:2} {v['depth10_med']:7} {v['reprices']:4} {v['fxbeta']!s:5} {v['fxcorr']!s:5} {v['fx_steps']:3} {v['top_sizes'][:3]}")
