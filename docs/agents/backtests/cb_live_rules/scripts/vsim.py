"""CB-LIVE-RULES: PR5's frozen simulator with its constants made parameters, for the candidates of the live rule set.

`vsim(B, size, **opts)` is `pr5_sim.simulate` (docs/agents/scripts/pr5/pr5_sim.py) line for line on its default path (no
stress, no side_aware, no full), with these knobs; at their defaults it IS that function, which `check` asserts trip for trip:
  rungs     [(side, k, weight)]: the rungs, each at `size × weight` (default the six of PR5: 0.1 / 0.2 / 0.3 % a side, weight 1)
  reprice   the move of fair that re-prices a resting order (default 0.0005)
  exit_off  ticks beyond fair for an exit: a long's ask at ceil(f) + n, a short's bid at floor(f) − n (default 0; Revolut X's
            variant-8 is 1)
  stop_min  minutes before the taker stop (default 1440); taker its cost (default P.FEE + P.HALF_SPREAD)
  share     the fill cap, a share of the minute's printed value (default 0.10, the engine's)
  thr       ticks a print must be beyond the quote to fill it (default 0: strictly through; 1 is a crude queue: the price level
            must clear by a tick)
  golive    a list that, when given, receives (t, side, price ticks, accepted) for every order going live (for the post-only
            check against the recorded touch)
The module's constants (P.TICK, P.FEE, P.HALF_SPREAD) are set by the caller as for `P.simulate`.
"""
import collections, math


def vsim(B, P, size=100.0, rungs=None, reprice=None, exit_off=0, stop_min=1440, taker=None, share=0.10, thr=0, golive=None):
    TICK = P.TICK
    M = 60000
    reprice = P.REPRICE if reprice is None else reprice
    taker = (P.FEE + P.HALF_SPREAD) if taker is None else taker
    if rungs is None:
        rungs = [(s, k, 1.0) for s in ("bid", "ask") for k in P.RUNGS]
    R = [{"side": s, "k": k, "w": w, "mode": "idle", "o": None} for s, k, w in rungs]
    rt, blocks, Order = P.rt, P.blocks, P.Order

    def rt_exit(f, pos_side):
        return math.ceil(f / TICK - 1e-9) + exit_off if pos_side == "bid" else math.floor(f / TICK + 1e-9) - exit_off

    def through(side, price, q):
        return q < price - thr if side == "bid" else q > price + thr

    trips, orders_by_day = [], collections.Counter()
    lastX = None
    n = B.n
    for i in range(n):
        t = B.t0 + i * M
        x = B.X[i]
        if x: lastX = x
        f = B.F[i]
        day = t // 86400000
        lp_turn = None
        for r in R:
            if r["mode"] in ("idle", "quote"):
                o = r["o"]
                if f is None:
                    if r["mode"] == "quote":
                        r["mode"], r["o"] = "idle", None
                    continue
                if r["mode"] == "idle":
                    r["o"] = Order(r["side"], rt(f, r["k"], r["side"]), f, i + 1); r["mode"] = "quote"
                    orders_by_day[day] += 1
                    continue
                if o.state == "rejected":
                    if abs(f / o.fair_at - 1) > reprice:
                        o.price, o.fair_at = rt(f, r["k"], r["side"]), f
                    if lp_turn is None: lp_turn = [B.last_before(t)]
                    if not blocks(o.side, o.price, lp_turn[0]):
                        o.live, o.state = i + 1, "pending"; orders_by_day[day] += 1
                    continue
                if abs(f / o.fair_at - 1) > reprice:
                    o.price, o.fair_at, o.live, o.state = rt(f, r["k"], r["side"]), f, i + 1, "pending"
                    orders_by_day[day] += 1
            elif r["mode"] == "position":
                o = r["o"]
                xs = "ask" if r["side"] == "bid" else "bid"
                if o is None:
                    if f is not None:
                        r["o"] = Order(xs, rt_exit(f, r["side"]), f, i + 1); orders_by_day[day] += 1
                elif o.state == "rejected":
                    if f is not None and abs(f / o.fair_at - 1) > reprice:
                        o.price, o.fair_at = rt_exit(f, r["side"]), f
                    if lp_turn is None: lp_turn = [B.last_before(t)]
                    if not blocks(o.side, o.price, lp_turn[0]):
                        o.live, o.state = i + 1, "pending"; orders_by_day[day] += 1
                elif f is not None and abs(f / o.fair_at - 1) > reprice:
                    o.price, o.fair_at, o.live, o.state = rt_exit(f, r["side"]), f, i + 1, "pending"
                    orders_by_day[day] += 1
        lp_live = None
        for r in R:
            o = r["o"]
            if o is not None and o.state == "pending" and o.live == i:
                if lp_live is None: lp_live = [B.last_before(t)]
                o.state = "rejected" if blocks(o.side, o.price, lp_live[0]) else "live"
                if golive is not None:
                    golive.append((t, o.side, o.price, o.state == "live", r["mode"]))
        ps = B.by_min.get(i)
        if ps:
            for ts, q, qty, aggr in ps:
                for r in R:
                    o = r["o"]
                    if o is None or o.state != "live":
                        continue
                    if not through(o.side, o.price, q):
                        continue
                    if r["mode"] == "quote":
                        if not lastX:
                            continue
                        usd = min(size * r["w"], share * B.qvol[i] * lastX)
                        if usd <= 0:
                            continue
                        nq = usd / lastX
                        p = o.price * TICK
                        r.update(mode="position", o=None, entry=p, t_e=t, i_e=i, qty=nq / p, nq=nq, fill_ts=ts)
                    elif r["mode"] == "position":
                        _close(r, trips, B.book, t, o.price * TICK, "maker", lastX)
        for r in R:
            if r["mode"] == "position" and r["i_e"] != i and (t >= r["t_e"] + stop_min * M or i == n - 1):
                c = B.last_at_or_before(t + M - 1) * TICK
                px = c * (1 - taker) if r["side"] == "bid" else c * (1 + taker)
                _close(r, trips, B.book, t, px, "taker", lastX)
    return trips, orders_by_day


def _close(r, trips, book, t, px, how, lastX):
    pnl_q = r["qty"] * (px - r["entry"]) if r["side"] == "bid" else r["qty"] * (r["entry"] - px)
    xr = lastX or 1.0
    trips.append({"book": book, "side": r["side"], "k": r["k"], "t_entry": r["t_e"], "t_exit": t, "entry": round(r["entry"], 6),
                  "exit": round(px, 8), "how": how, "notional_usd": r["nq"] * xr, "pnl_usd": pnl_q * xr, "fill_ts": r["fill_ts"]})
    r.update(mode="idle", o=None)


def check(B, P, size):
    """vsim at its defaults against P.simulate: the same trips (as sorted lists) or an AssertionError."""
    a, _ = P.simulate(B, size=size)
    b, _ = vsim(B, P, size=size)
    key = lambda tr: sorted((x["t_entry"], x["t_exit"], x["side"], x["k"], round(x["pnl_usd"], 9)) for x in tr)
    assert key(a) == key(b), "vsim differs from pr5_sim.simulate"
    return len(a)
