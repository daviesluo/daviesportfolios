"""PR5 live at £120 (2026-10-01): every setting of the live executor checked against the committed PRE-TEST inputs, the
order governor at Davies' 900, the paper-test interaction, and the inventory. A design study; nothing here is a rule.

Davies, 2026-10-01: PR5's GBP stablecoin quotes go live on their own Revolut X sub-account, now holding £120, at £10 a
rung; the governor withdraws entries at 900 POSTs a UTC day instead of 600. Review:
docs/agents/reviews/2026-10-01-pr5-live-go.md.

Inputs: only what was committed before PR5's paper test began (2026-09-23 15:09 UTC): the frozen study's trades, the USD
books' hourly candles and Exness GBP/USD (`docs/agents/backtests/inputs/pr5_2026-09-23`, read through the frozen loaders),
plus today's public order books and Yahoo GBP/USD for the conversion's price (`inputs/public_2026-10-01.json.gz`, keyless
reads). No figure of PR5's own paper record, of its dry-run, of PR5V, variant-2 or PR5-W is read.

Imports, unchanged and hash-checked: the frozen `pr5_sim.py` (56fbad85…) and PR5V's `pr5v_sim.py` (54ad4198…, which
reproduces the frozen simulator trip for trip at PR5's settings, `backtests/pr5v/check_repro.json`, and models the order
governor). `run_book` below is the frozen `simulate()` minute loop again, with three additions that are off by default:
sizing in GBP, a mark-to-market of the open positions each minute, and a LIVE BOOK of real £10 orders resting in the
venue's book beside the paper rule. With the additions off it reproduces `simulate()` trip for trip and order for
order, which the script asserts on both windows before it reports anything.

The live book (the interaction model). The executor rests real orders at the paper rule's prices (or one tick behind),
about 30 s after the paper counts them live (PR5-R's measured lag: 28.8–33.4 s, median 30.6 s). A real resting order
takes flow that would otherwise have traded further: a seller sweeping the bids fills every order at a better price,
then the queue already resting at our price, then ours, and only what is left prints beyond it. So for each taker group
(the prints of one millisecond and one aggressor side), each of our resting orders takes from the quantity that printed
strictly beyond its price, best price first, and the prints that remain are the original ones less that quantity from the
far end. Our own fills print AT our price, which proves no paper fill (the rule needs a print strictly through). The
paper rule then runs on that tape: its fills, its post-only refusals (the last print) and its 24-hour stops all read
it. A print beyond one of our bids by an aggressive BUYER (an ask resting below our bid) is treated the same way, as the
ask would have crossed our bid on arrival. Not modelled: the executor's guards, governor and loss stop (they rarely
bind, measured separately below), cancels that fail, and partial knowledge of the queue ahead (ours is always last).

usage: python3 docs/agents/backtests/pr5_live/go_live_120.py   (from the repository root; writes go_live_120.json beside it)
"""
import bisect, collections, datetime, gzip, hashlib, json, math, os, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../../.."))
SIM_DIR = os.path.join(ROOT, "docs/agents/scripts/pr5")
PR5V_DIR = os.path.join(ROOT, "docs/agents/scripts/pr5v")
FROZEN_SIM_SHA = "56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a"
PR5V_SIM_SHA = "54ad41982d143758ece6ee8e5bb48d5a4aafe1dc0429ccc0af6d1c57282de27a"
sys.path.insert(0, SIM_DIR)
sys.path.insert(0, PR5V_DIR)
import pr5_sim as P   # noqa: E402
import pr5v_sim as V  # noqa: E402

sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
if sha(os.path.join(SIM_DIR, "pr5_sim.py")) != FROZEN_SIM_SHA:
    raise SystemExit("pr5_sim.py is not the committed frozen copy")
if sha(os.path.join(PR5V_DIR, "pr5v_sim.py")) != PR5V_SIM_SHA:
    raise SystemExit("pr5v_sim.py is not the committed copy PR5V froze")

M, H, DAY = 60000, 3600000, 86400000
TICK = P.TICK
CAPITAL_GBP = 120.0
RUNGS_N = 12
RUNG_GBP = CAPITAL_GBP / RUNGS_N                     # £10
LIVE_LAG_MS = 30000                                  # the executor places ~30 s into the paper's live minute
DUST_GBP = 0.1                                       # the venue's minimum order, both books: 0.1 GBP
BASE_STEP = 1e-5
LOSS_FRACTION = 0.01                                 # the executor's daily loss stop: −1 % of capital
STOP_BOUND = 0.005                                   # the 24-hour stop's IOC: fair ± 50 bps
TAKER = P.FEE + P.HALF_SPREAD


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M")


def floor_step(x):
    return math.floor(x / BASE_STEP + 1e-9) * BASE_STEP


# ---------------------------------------------------------------------------------------------------------------- port
class Order:
    """The frozen `Order`, with an id: the executor keys a paper decision by (order id, live minute)."""
    __slots__ = ("side", "price", "fair_at", "live", "state", "oid")
    _n = 0

    def __init__(self, side, price, fair_at, live):
        Order._n += 1
        self.side, self.price, self.fair_at, self.live, self.state, self.oid = side, price, fair_at, live, "pending", Order._n


class LiveOrder:
    __slots__ = ("rung", "leg", "oside", "price", "rem", "qty0", "live_from", "fair")

    def __init__(self, rung, leg, oside, price, qty, live_from, fair):
        self.rung, self.leg, self.oside, self.price, self.rem, self.qty0, self.live_from, self.fair = rung, leg, oside, price, qty, qty, live_from, fair


class LiveRung:
    __slots__ = ("held", "avg", "opened", "entry", "exit", "refused", "last_stop", "trips", "fills", "entry_keys", "exit_refused_at")

    def __init__(self):
        self.held, self.avg, self.opened = 0.0, 0.0, None
        self.entry = self.exit = None
        self.refused = set()
        self.last_stop = None
        self.trips, self.fills = [], []
        self.entry_keys = {}
        self.exit_refused_at = None                                           # the last print when the venue last refused its exit


def absorb(group, resting):
    """One taker group (prints of one ms and one aggressor, as (ts, ticks, qty, aggr)) against our resting orders.
    Returns (the prints as they would have printed, [(order, qty taken)])."""
    bids = sorted((o for o in resting if o.oside == "bid" and o.rem > 1e-12), key=lambda o: -o.price)
    asks = sorted((o for o in resting if o.oside == "ask" and o.rem > 1e-12), key=lambda o: o.price)
    took, low, high = [], 0.0, 0.0
    for o in bids:
        avail = sum(p[2] for p in group if p[1] < o.price) - low
        a = min(o.rem, avail) if avail > 1e-12 else 0.0
        if a > 1e-12:
            took.append((o, a)); low += a
    for o in asks:
        avail = sum(p[2] for p in group if p[1] > o.price) - high
        a = min(o.rem, avail) if avail > 1e-12 else 0.0
        if a > 1e-12:
            took.append((o, a)); high += a
    if not took:
        return group, []
    ts, aggr = group[0][0], group[0][3]
    rest = [[p[1], p[2]] for p in sorted(group, key=lambda p: p[1])]          # ascending price
    k = low
    for lv in rest:                                                           # the far end of a sell: the lowest prices
        d = min(lv[1], k); lv[1] -= d; k -= d
    k = high
    for lv in reversed(rest):                                                 # the far end of a buy: the highest
        d = min(lv[1], k); lv[1] -= d; k -= d
    out = [(ts, q, qty, aggr) for q, qty in rest if qty > 1e-12]
    out += [(ts, o.price, a, aggr) for o, a in took]
    out.sort(key=lambda p: -p[1] if aggr == "sell" else p[1])                 # the sweep's own order
    return out, took


def run_book(B, size_usd=100.0, size_gbp=None, live=None, marks=False, stress=False):
    """The frozen `simulate(B, size)` minute loop. `size_gbp` sizes a rung in pounds (min(size_gbp, 10 % of the minute's
    GBP volume)) instead of dollars. `marks` records each UTC day's lowest realised-today-plus-marked P&L in GBP.
    `live` = {"behind": 0|1, "rungs": set of (side, k)} rests the executor's £10 orders in the book (see the docstring)."""
    thr = 1 if stress else 0
    taker = (2 * P.FEE + 2 * P.HALF_SPREAD) if stress else TAKER
    rungs = [{"side": s, "k": k, "mode": "idle", "o": None} for s in ("bid", "ask") for k in P.RUNGS]
    trips, orders_by_day = [], collections.Counter()
    lastX = None
    n = B.n
    k0 = bisect.bisect_left(B.pts, B.t0) - 1
    last = (B.all_prints[k0][1], B.all_prints[k0][3]) if k0 >= 0 else None   # the last print (ticks, aggressor) so far
    fills = []                                                                # paper fills: (leg, rung, t, ts, ticks, oid)
    day_low, mseries = {}, []                                                 # realised GBP by UTC day; (minute, day P&L)
    LV = None
    if live is not None:
        LV = {(r["side"], r["k"]): LiveRung() for r in rungs}
        snap = {}                                                             # the paper's entry targets after the last minute
    stats = collections.Counter()
    live_posts = collections.Counter()
    post_times = []

    def post(tau, kind):
        stats["live_posts"] += 1
        live_posts[tau // DAY] += 1
        stats["live_posts_" + kind] += 1
        post_times.append(tau)

    def live_turn(i, tau, snap):
        """The executor's turn at tau, carrying out the paper state after minute i-1 (fair F[i-1])."""
        f_prev = B.F[i - 1] if i > 0 else None
        for (side, k), L in LV.items():
            if (side, k) not in live["rungs"]:
                continue
            dust = DUST_GBP / ((L.avg or (f_prev or 0.75)))
            e = L.entry
            if e is not None and e.rem < e.qty0 - 1e-12:                      # an entry the venue (part-)filled
                if e.rem <= 1e-12 or (e.qty0 - e.rem) > dust:
                    L.entry = None                                            # filled, or the rest withdrawn
            holding = L.held > dust
            if holding:
                if L.entry is not None:
                    L.entry = None
                if L.opened is not None and tau >= L.opened + DAY and (L.last_stop is None or tau - L.last_stop >= H):
                    L.exit = None
                    c = last[0] * TICK if last else None
                    fair = f_prev
                    ok = c is not None and (fair is None or (c >= fair * (1 - STOP_BOUND) if side == "bid" else c <= fair * (1 + STOP_BOUND)))
                    post(tau, "stop")
                    if ok:
                        px = c * (1 - TAKER) if side == "bid" else c * (1 + TAKER)
                        close_live(L, side, px, tau, "stop")
                    else:
                        L.last_stop = tau; stats["live_stop_unfilled"] += 1
                    continue
                if f_prev is None:
                    continue
                xs = "ask" if side == "bid" else "bid"
                want = P.rt_exit(f_prev, side)
                if L.exit is not None and abs(f_prev / L.exit.fair - 1) <= P.REPRICE:
                    continue
                price = want + (live["behind"] if xs == "ask" else -live["behind"])
                if L.exit is None and live.get("exit_wait") and L.exit_refused_at is not None and (
                        L.exit_refused_at == last or (last is not None and P.blocks(xs, price, last))):
                    continue                                                  # the rule's own wait: no newer print, or still through it
                post(tau, "exit")
                if last is not None and P.blocks(xs, price, last):
                    L.exit = None; stats["live_exit_refused"] += 1
                    L.exit_refused_at = last
                    continue
                L.exit_refused_at = None
                L.exit = LiveOrder((side, k), "exit", xs, price, floor_step(L.held), tau, f_prev)
                continue
            if L.exit is not None:
                L.exit = None
            t = snap.get((side, k))
            if t is None:
                L.entry = None
                continue
            ticks, key = t
            price = ticks - live["behind"] if side == "bid" else ticks + live["behind"]
            if L.entry is not None and L.entry.price == price:
                continue
            L.entry = None
            if key in L.refused:
                continue
            post(tau, "entry")
            if last is not None and P.blocks(side, price, last):
                L.refused.add(key); stats["live_entry_refused"] += 1
                continue
            L.entry = LiveOrder((side, k), "entry", side, price, floor_step(RUNG_GBP / (price * TICK)), tau, f_prev)
            L.entry_keys[id(L.entry)] = key

    def close_live(L, side, px, ts, how):
        q = L.held
        pnl = q * (px - L.avg) if side == "bid" else q * (L.avg - px)
        L.trips.append({"t_entry": L.opened, "t_exit": ts, "entry": L.avg, "exit": px, "qty": q, "pnl_gbp": pnl, "how": how})
        L.held, L.avg, L.opened, L.exit = 0.0, 0.0, None, None

    def live_fill(o, a, ts):
        L = LV[o.rung]
        side = o.rung[0]
        o.rem -= a
        if o.leg == "entry":
            if L.held <= 0:
                L.opened = ts
            L.avg = (L.avg * L.held + o.price * TICK * a) / (L.held + a)
            L.held += a
            L.fills.append((ts, o.price, a, L.entry_keys.get(id(o))))
        else:
            q = min(a, L.held)
            px = o.price * TICK
            pnl = q * (px - L.avg) if side == "bid" else q * (L.avg - px)
            L.trips.append({"t_entry": L.opened, "t_exit": ts, "entry": L.avg, "exit": px, "qty": q, "pnl_gbp": pnl, "how": "maker"})
            L.held -= q
            if L.held <= DUST_GBP / px:
                L.held, L.avg, L.opened = 0.0, 0.0, None
                L.exit = None

    for i in range(n):
        t = B.t0 + i * M
        x = B.X[i]
        if x: lastX = x
        f = B.F[i]
        day = t // DAY
        # ---- 1. the turn at the start of minute t (the frozen code, the last print read from the tape as it printed)
        for r in rungs:
            if r["mode"] in ("idle", "quote"):
                o = r["o"]
                if f is None:
                    if r["mode"] == "quote":
                        r["mode"], r["o"] = "idle", None
                    continue
                if r["mode"] == "idle":
                    r["o"] = Order(r["side"], P.rt(f, r["k"], r["side"]), f, i + 1); r["mode"] = "quote"
                    orders_by_day[day] += 1
                    continue
                if o.state == "rejected":
                    if abs(f / o.fair_at - 1) > P.REPRICE:
                        o.price, o.fair_at = P.rt(f, r["k"], r["side"]), f
                    if not P.blocks(o.side, o.price, last):
                        o.live, o.state = i + 1, "pending"; orders_by_day[day] += 1
                    continue
                if abs(f / o.fair_at - 1) > P.REPRICE:
                    o.price, o.fair_at, o.live, o.state = P.rt(f, r["k"], r["side"]), f, i + 1, "pending"
                    orders_by_day[day] += 1
            elif r["mode"] == "position":
                o = r["o"]
                xs = "ask" if r["side"] == "bid" else "bid"
                if o is None:
                    if f is not None:
                        r["o"] = Order(xs, P.rt_exit(f, r["side"]), f, i + 1); orders_by_day[day] += 1
                elif o.state == "rejected":
                    if f is not None and abs(f / o.fair_at - 1) > P.REPRICE:
                        o.price, o.fair_at = P.rt_exit(f, r["side"]), f
                    if not P.blocks(o.side, o.price, last):
                        o.live, o.state = i + 1, "pending"; orders_by_day[day] += 1
                elif f is not None and abs(f / o.fair_at - 1) > P.REPRICE:
                    o.price, o.fair_at, o.live, o.state = P.rt_exit(f, r["side"]), f, i + 1, "pending"
                    orders_by_day[day] += 1
        # ---- 2. go-live at the start of minute t
        for r in rungs:
            o = r["o"]
            if o is not None and o.state == "pending" and o.live == i:
                o.state = "rejected" if P.blocks(o.side, o.price, last) else "live"
        # ---- 3. the prints of minute t; with a live book, as they would have printed beside it
        ps = B.by_min.get(i, [])
        if LV is not None:
            tau = t + LIVE_LAG_MS
            turned = False
            out = []
            groups, g = [], []
            for p in ps:
                if g and (p[0] != g[0][0] or p[3] != g[0][3]):
                    groups.append(g); g = []
                g.append(p)
            if g:
                groups.append(g)
            for g in groups:
                if not turned and g[0][0] >= tau:
                    live_turn(i, tau, snap); turned = True
                resting = [o for L in LV.values() for o in (L.entry, L.exit) if o is not None and o.live_from <= g[0][0]]
                cf, took = absorb(g, resting) if resting else (g, [])
                for o, a in took:
                    live_fill(o, a, g[0][0])
                    stats["live_fills_" + o.leg] += 1
                out += cf
                if cf:
                    last = (cf[-1][1], cf[-1][3])
            if not turned:
                live_turn(i, tau, snap)
            ps = out
        elif ps:
            last = (ps[-1][1], ps[-1][3])
        if ps:
            qvol = sum(qty * q * TICK for ts, q, qty, aggr in ps) if LV is not None else B.qvol[i]
            for ts, q, qty, aggr in ps:
                for r in rungs:
                    o = r["o"]
                    if o is None or o.state != "live":
                        continue
                    if not P.through(o.side, o.price, q, thr):
                        continue
                    if r["mode"] == "quote":
                        if not lastX:
                            continue
                        usd = min(size_usd, 0.10 * qvol * lastX) if size_gbp is None else lastX * min(size_gbp, 0.10 * qvol)
                        if usd <= 0:
                            continue
                        nq = usd / lastX
                        p = o.price * TICK
                        fills.append(("entry", (r["side"], r["k"]), t, ts, o.price, o.oid))
                        r.update(mode="position", o=None, entry=p, t_e=t, i_e=i, qty=nq / p, nq=nq, fill_ts=ts)
                    elif r["mode"] == "position":
                        fills.append(("exit", (r["side"], r["k"]), t, ts, o.price, o.oid))
                        _close(r, trips, B.book, t, o.price * TICK, "maker", lastX)
        # ---- 4. the 24-hour taker stop (and the end of the data), at the last print to the end of minute t
        for r in rungs:
            if r["mode"] == "position" and r["i_e"] != i and (t >= r["t_e"] + 1440 * M or i == n - 1):
                c = last[0] * TICK
                px = c * (1 - taker) if r["side"] == "bid" else c * (1 + taker)
                _close(r, trips, B.book, t, px, "taker", lastX)
        if LV is not None:
            snap = {}
            for r in rungs:
                o = r["o"]
                if r["mode"] == "quote" and o is not None and o.state != "rejected":
                    snap[(r["side"], r["k"])] = (o.price, (o.oid, o.live))
        if marks:
            # The executor's loss stop reads realised-today plus marked, every minute: the trips closed this minute count
            # from now on (in GBP, on their exit's UTC day), and every open position is marked at the last print.
            while stats["marked_trips"] < len(trips):
                day_low[day] = day_low.get(day, 0.0) + trips[stats["marked_trips"]]["pnl_gbp"]
                stats["marked_trips"] += 1
            mk = last[0] * TICK if last is not None else None
            open_pnl = 0.0 if mk is None else sum((r["qty"] * (mk - r["entry"]) if r["side"] == "bid" else r["qty"] * (r["entry"] - mk))
                                                  for r in rungs if r["mode"] == "position")
            mseries.append((t, day_low.get(day, 0.0) + open_pnl))
    if marks:
        return {"trips": trips, "orders_by_day": orders_by_day, "fills": fills, "marks": mseries, "live": LV, "stats": stats}
    return {"trips": trips, "orders_by_day": orders_by_day, "fills": fills, "day_low": day_low, "live": LV, "stats": stats, "live_posts": live_posts,
            "post_times": post_times}


def _close(r, trips, book, t, px, how, lastX):
    pnl_q = r["qty"] * (px - r["entry"]) if r["side"] == "bid" else r["qty"] * (r["entry"] - px)
    xr = lastX or 1.0
    trips.append({"book": book, "side": r["side"], "k": r["k"], "t_entry": r["t_e"], "t_exit": t, "entry": round(r["entry"], 6),
                  "exit": round(px, 8), "how": how, "notional_usd": r["nq"] * xr, "pnl_usd": pnl_q * xr, "fill_ts": r["fill_ts"],
                  "pnl_gbp": pnl_q, "nq_gbp": r["nq"]})
    r.update(mode="idle", o=None)


# ------------------------------------------------------------------------------------------------------- the analysis
KEYS = ["book", "side", "k", "t_entry", "t_exit", "entry", "exit", "how", "notional_usd", "pnl_usd", "fill_ts"]
WIN = {   # name: (start of each book's run, end of the run, entries counted from, entries counted to)
    "wide": (P.START, P.END, P.START, P.PRIM_END),               # the primary window: each book from its listing, the wide market
    "tight": ({b: P.PR3_0 for b in P.BOOKS}, P.END, {b: P.PR3_0 for b in P.BOOKS}, P.END),   # 2026-08-26 → 09-23, fresh
}
R5 = lambda x: round(x, 5)


def days_of(w):
    _, _, a, b = WIN[w]
    return (b - min(a.values())) / DAY


def in_win(w, x):
    _, _, a, b = WIN[w]
    return a[x["book"]] <= x["t_entry"] < b


def books(fx, w):
    starts, end, _, _ = WIN[w]
    return {b: P.Book(b, starts[b], end, fx) for b in P.BOOKS}


def summ(trips, w, capital, pnl="pnl_usd"):
    sel = [x for x in trips if in_win(w, x)]
    tot = sum(x[pnl] for x in sel)
    d = days_of(w)
    return {"trips": len(sel), "pnl": R5(tot), "per_day": R5(tot / d), "pct_per_year": round(100 * tot / capital * 365 / d, 2) if capital else None,
            "won": round(sum(1 for x in sel if x[pnl] > 0) / len(sel), 4) if sel else None, "taker_exits": sum(1 for x in sel if x["how"] == "taker")}


def fidelity(B_by_w):
    """The port is the frozen loop: identical trips (every field) and orders per UTC day, both windows, both arms."""
    out = {}
    for w, BB in B_by_w.items():
        for b, B in BB.items():
            for stress in (False, True):
                ref, rod = P.simulate(B, stress=stress)
                got = run_book(B, stress=stress)
                same = [{k: x[k] for k in KEYS} for x in ref] == [{k: x[k] for k in KEYS} for x in got["trips"]] and dict(rod) == dict(got["orders_by_day"])
                out[f"{w}/{b}/{'stress' if stress else 'primary'}"] = {"trips": len(ref), "identical": same}
                assert same, (w, b, stress)
    return out


def bucket(times):
    """The venue's day bucket on order POSTs (reference §2: 1,000 tokens, refilled continuously at 1,000 a day), from
    full: its lowest level, and the most POSTs inside any 24 hours."""
    times = sorted(times)
    lvl, lastt, low = 1000.0, None, 1000.0
    for t in times:
        if lastt is not None:
            lvl = min(1000.0, lvl + (t - lastt) * 1000.0 / DAY)
        lvl -= 1; low = min(low, lvl); lastt = t
    j, roll = 0, 0
    for i, t in enumerate(times):
        while times[j] <= t - DAY:
            j += 1
        roll = max(roll, i - j + 1)
    return {"posts": len(times), "dayBucketLowest": round(low, 1), "maxPostsInAny24h": roll}


def usd_hours(sym):
    rows = json.load(P._open(os.path.join(P.S, "data", "candles", f"{sym}_60.json")))["rows"]
    return [int(r["start"]) for r in rows], [float(r["close"]) for r in rows]


# -------------------------------------------------------------------------------------------------- 1. size and pay
def sizing(B_by_w, pub):
    """£10 a rung: the orders against the venue's minimums at today's prices, and the frozen rule at £10 a rung."""
    out = {"rungGbp": RUNG_GBP, "pairs": {s: pub["pairs"][s] for s in ("USDC/GBP", "USDT/GBP")}, "atTodaysFair": {}}
    for b, f in pub["fair"].items():
        rows = []
        for side in ("bid", "ask"):
            for k in P.RUNGS:
                tk = P.rt(f, k, side)
                base = floor_step(RUNG_GBP / (tk * TICK))
                rows.append({"side": side, "k": k, "price": round(tk * TICK, 4), "base": round(base, 5), "gbp": round(base * tk * TICK, 5),
                             "timesTheMinimum": round(base * tk * TICK / float(pub["pairs"][b.replace("-", "/")]["min_order_size_quote"]), 1)})
        out["atTodaysFair"][b] = {"fair": round(f, 6), "rungs": rows}
    out["frozenRuleAt10Gbp"] = {}
    for w, BB in B_by_w.items():
        trips = []
        for B in BB.values():
            trips += run_book(B, size_gbp=RUNG_GBP)["trips"]
        sel = [x for x in trips if in_win(w, x)]
        s = summ(trips, w, None, "pnl_gbp")
        s["pct_per_year_on_120"] = round(100 * s["pnl"] / CAPITAL_GBP * 365 / days_of(w), 2)
        s["entries_under_10gbp"] = sum(1 for x in sel if x["nq_gbp"] < RUNG_GBP - 1e-9)
        s["entries_under_venue_minimum"] = sum(1 for x in sel if x["nq_gbp"] < DUST_GBP)
        s["pnl_usd"] = R5(sum(x["pnl_usd"] for x in sel))
        s["by_book_side"] = {f"{b} {sd}": {"trips": sum(1 for x in sel if x["book"] == b and x["side"] == sd),
                                            "pnl_gbp": R5(sum(x["pnl_gbp"] for x in sel if x["book"] == b and x["side"] == sd))}
                             for b in P.BOOKS for sd in ("bid", "ask")}
        out["frozenRuleAt10Gbp"][w] = s
    return out


# ------------------------------------------------------------------------------------------------- 2. the loss stop
def loss_stop(B_by_w):
    """Each UTC day's lowest realised-today-plus-marked P&L, both books summed minute by minute, at £10 a rung."""
    out = {}
    for w, BB in B_by_w.items():
        _, _, a, b_end = WIN[w]
        per_min = collections.defaultdict(float)
        for B in BB.values():
            for t, v in run_book(B, size_gbp=RUNG_GBP, marks=True)["marks"]:
                per_min[t] += v
        lows = {}
        for t, v in per_min.items():
            if min(a.values()) <= t < b_end:
                d = t // DAY
                lows[d] = min(lows.get(d, 0.0), v)
        v = sorted(lows.values())
        out[w] = {"days": len(v), "worstDayLowGbp": R5(v[0]), "p1DayLowGbp": R5(v[int(0.01 * (len(v) - 1))]), "medianDayLowGbp": R5(st.median(v)),
                  "daysAtOrUnder": {f"-{x:g}": sum(1 for y in v if y <= -x) for x in (0.30, 0.60, 1.20, 2.40)},
                  "worstFive": [{"day": iso(d * DAY)[:10], "lowGbp": R5(lv)} for d, lv in sorted(lows.items(), key=lambda z: z[1])[:5]]}
    return out


# --------------------------------------------------------------------------- 3. the guards: de-peg, stale hours, stop bound
def guards(B_by_w):
    """Would the executor's entry guards have withdrawn the live order before a paper fill? The executor's turn at
    t+30 s reads the paper's minute t-1 (its fair, its last print, the USD book's last completed hour); a paper fill at
    ts in minute i was governed by the turn in minute i when ts >= t_i + 30 s, else by the turn in minute i-1."""
    out = {}
    hours = {u: usd_hours(u) for u in ("USDC-USD", "USDT-USD")}
    for w, BB in B_by_w.items():
        res = {"thresholdsBps": {}, "staleUsdHour": {}, "stopBound": {}}
        all_fills, gstate = [], {}
        for b, B in BB.items():
            ht, hc = hours[P.USD_OF[b]]
            run = run_book(B)
            trips = {(x["side"], x["k"], x["t_entry"]): x for x in run["trips"]}
            # per minute T: |USD last hour / 24 h median - 1|, |last GBP print / fair - 1| (bps), and the USD hour's age
            k0 = bisect.bisect_left(B.pts, B.t0) - 1
            lp = B.all_prints[k0][1] if k0 >= 0 else None
            usd_dev, gbp_dev, age_prod, age_spec = [None] * B.n, [None] * B.n, [None] * B.n, [None] * B.n
            for i in range(B.n):
                t = B.t0 + i * M
                for p in B.by_min.get(i, ()):
                    lp = p[1]
                f = B.F[i]
                if f is None:
                    continue
                j = bisect.bisect_right(ht, t - H) - 1                  # the newest hour that has closed by t
                lo, hi = bisect.bisect_left(ht, t - 1440 * M), bisect.bisect_right(ht, t - 60 * M)
                fu = st.median(hc[lo:hi]) if hi > lo else None
                if j >= 0 and fu:
                    usd_dev[i] = abs(hc[j] / fu - 1) * 1e4
                if lp is not None:
                    gbp_dev[i] = abs(lp * TICK / f - 1) * 1e4               # the last print to the end of minute T
                age_spec[i] = (t - (ht[j] + H)) / M if j >= 0 else None
                # production: the engine reads each hour about 27 s after it closes, before the venue lists it, so at minutes
                # :00-:58 its newest hour is the one before (PR5-R (d)); at :59 it has it
                cut = (t // H) * H - (H if (t // M) % 60 == 59 else 2 * H)
                jp = bisect.bisect_right(ht, cut) - 1
                age_prod[i] = (t - (ht[jp] + H)) / M if jp >= 0 else None
            gstate[b] = (usd_dev, gbp_dev)
            stale_miss, stale_pnl = 0, 0.0
            for leg, side_k, t, ts, ticks, oid in run["fills"]:
                if leg != "entry":
                    continue
                i = (t - B.t0) // M
                T = i - 1 if ts >= t + LIVE_LAG_MS else i - 2
                tr = trips.get((side_k[0], side_k[1], t))
                if tr is None or not in_win(w, tr):
                    continue
                all_fills.append((b, T, tr))
                if T >= 0 and age_prod[T] is not None and age_prod[T] > 120:
                    stale_miss += 1; stale_pnl += tr["pnl_usd"]
            n_f = sum(1 for x in B.F if x is not None)
            ages = [a for i, a in enumerate(age_prod) if a is not None and B.F[i] is not None]
            res["staleUsdHour"][b] = {"minutesWithFair": n_f, "paperEntriesTheLiveWouldMiss": stale_miss, "theirPnlUsdAt100": R5(stale_pnl),
                                      "productionLagOver120min": sum(1 for a in ages if a > 120),
                                      "productionLagOver180min": sum(1 for a in ages if a > 180), "productionLagMaxMin": max(ages, default=None),
                                      "productionLagP99Min": sorted(ages)[int(0.99 * (len(ages) - 1))] if ages else None,
                                      "specLagOver120min": sum(1 for a in age_spec if a is not None and a > 120)}
            # the 24-hour stops: the last print against fair at the stop (the IOC is bounded at fair ± 50 bps)
            # The executor bounds its stop at the paper's fair for the minute, or, while GBP/USD is dark (a weekend), at the
            # fair its exit was priced at (`f0` in the executor): here the last fair before the stop.
            devs, dark = [], 0
            for x in run["trips"]:
                if x["how"] != "taker" or x["t_exit"] == B.t0 + (B.n - 1) * M or not in_win(w, x):
                    continue
                i = (x["t_exit"] - B.t0) // M
                c = x["exit"] / (1 - TAKER) if x["side"] == "bid" else x["exit"] / (1 + TAKER)
                j = i - 1
                while j >= 0 and B.F[j] is None:
                    j -= 1
                dark += (B.F[i - 1] is None)
                f = B.F[j] if j >= 0 else x["entry"]
                devs.append((c / f - 1) * 1e4 * (1 if x["side"] == "bid" else -1))       # negative: against the position
            res["stopBound"][b] = {"stops": len(devs), "whileDark": dark, "within50bps": sum(1 for d in devs if d >= -50),
                                   "worstBps": round(min(devs), 1) if devs else None, "medianBps": round(st.median(devs), 1) if devs else None}
        tot_trips = len(all_fills)
        tot_pnl = sum(tr["pnl_usd"] for _, _, tr in all_fills)
        for thr in (25, 50, 75, 100):
            hit = [(b, tr) for b, T, tr in all_fills if T >= 0 and ((gstate[b][0][T] or 0) > thr or (gstate[b][1][T] or 0) > thr)]
            usd_only = sum(1 for b, T, tr in all_fills if T >= 0 and (gstate[b][0][T] or 0) > thr)
            mins = sum(1 for b in BB for i in range(BB[b].n) if (gstate[b][0][i] or 0) > thr or (gstate[b][1][i] or 0) > thr)
            res["thresholdsBps"][str(thr)] = {"minutesBlocked": mins, "paperEntriesTheLiveWouldMiss": len(hit), "ofEntries": tot_trips,
                                              "byUsdLeg": usd_only, "theirPnlUsdAt100": R5(sum(tr["pnl_usd"] for _, tr in hit)),
                                              "ofPnlUsdAt100": R5(tot_pnl), "theirWinRate": round(sum(1 for _, tr in hit if tr["pnl_usd"] > 0) / len(hit), 3) if hit else None}
        out[w] = res
    return out


# ------------------------------------------------------------------------------------------------- 4. the governor
def governor():
    """PR5V's simulator at PR5's settings (identical to the frozen rule without a governor), both books on ONE account,
    the governor counting every POST a UTC day: placements, re-prices, re-placements, exits and stops."""
    mk = V.committed_markets()
    out = {}
    spans = {"2025-12-16_to_09-23": (P.START["USDT-GBP"], P.END), "tight_2026-08-26_to_09-23": (P.PR3_0, P.END)}
    variants = {"none": None, "600/700": {"entry_at": 600, "stop_at": 700}, "900/950": {"entry_at": 900, "stop_at": 950},
                "900/930": {"entry_at": 900, "stop_at": 930}, "900/970": {"entry_at": 900, "stop_at": 970}}
    for span, (a, b) in spans.items():
        res = {}
        for name, gov in variants.items():
            r = V.simulate([mk[x] for x in P.BOOKS], V.default_cfg(gov=gov, acct=lambda book, side: 0), a, b)
            posts = sorted(p[0] for p in r["posts"] if p[6])
            per_day = collections.Counter(t // DAY for t in posts)
            days = list(range(a // DAY, b // DAY))
            v = sorted(per_day.get(d, 0) for d in days)
            bk = bucket(posts)
            after = []
            if gov:
                by_day = collections.defaultdict(list)
                for t in posts:
                    by_day[t // DAY].append(t)
                after = [len(ts) - gov["entry_at"] for ts in by_day.values() if len(ts) > gov["entry_at"]]
            kinds = collections.Counter(p[3] for p in r["posts"] if p[6])
            stops_day = collections.Counter(p[0] // DAY for p in r["posts"] if p[6] and p[3] == "stop")
            res[name] = {"trips": len(r["trips"]), "pnlUsdAt100": R5(sum(x["pnl_usd"] for x in r["trips"])),
                         "postsPerDay": {"mean": round(sum(v) / len(v), 1), "p95": v[int(0.95 * (len(v) - 1))], "max": v[-1]},
                         "daysOver": {str(x): sum(1 for y in v if y > x) for x in (600, 700, 900, 950, 1000)},
                         "daysEntriesWithdrawn": sum(1 for y in v if gov and y >= gov["entry_at"]),
                         "postsAfterTheEntryTier": {"max": max(after), "median": st.median(after), "days": len(after)} if after else None,
                         "stops": kinds.get("stop", 0), "mostStopsInADay": max(stops_day.values(), default=0), **bk}
        out[span] = res
    return out


# --------------------------------------------------------------------------------------------- 5. the interaction
def first_order(B_by_w):
    """For each paper fill, the quantity that printed strictly through the order's price in the proving print's taker
    group (same ms, same aggressor). A £10 order resting at that price takes that much first: at or under its size, that
    print no longer proves the fill. (First order: the rung's own order only, at full size.)"""
    out = {}
    for w, BB in B_by_w.items():
        tot, hit = collections.Counter(), collections.Counter()
        for b, B in BB.items():
            run = run_book(B)
            entries = {(x["side"], x["k"], x["t_entry"]) for x in run["trips"] if in_win(w, x)}
            groups = collections.defaultdict(list)
            for p in B.all_prints:
                groups[(p[0], p[3])].append(p)
            open_entry = {}
            for leg, (side, k), t, ts, ticks, oid in run["fills"]:
                if leg == "entry":
                    open_entry[(side, k)] = t
                t_e = t if leg == "entry" else open_entry.get((side, k))
                if (side, k, t_e) not in entries:
                    continue
                oside = side if leg == "entry" else ("ask" if side == "bid" else "bid")
                i = (t - B.t0) // M
                aggr = next(p[3] for p in B.by_min[i] if p[0] == ts and P.through(oside, ticks, p[1], 0))
                L = sum(p[2] for p in groups[(ts, aggr)] if P.through(oside, ticks, p[1], 0))
                Q = floor_step(RUNG_GBP / (ticks * TICK))
                key = f"{b} {leg} {side} {k}"
                tot[key] += 1
                hit[key] += L <= Q
        out[w] = {"fills": sum(tot.values()), "absorbed": sum(hit.values()), "share": round(sum(hit.values()) / sum(tot.values()), 4),
                  "by": {key: {"fills": tot[key], "absorbed": hit[key], "share": round(hit[key] / tot[key], 3)} for key in sorted(tot)}}
    return out


def coupled(B_by_w):
    """The paper rule beside the live book: what the live orders take from the paper's evidence, and what the live gets."""
    out = {}
    all_rungs = {(s, k) for s in ("bid", "ask") for k in P.RUNGS}
    bid_rungs = {("bid", k) for k in P.RUNGS}
    for w, BB in B_by_w.items():
        lo, hi = min(WIN[w][2].values()), WIN[w][3]
        base = [x for B in BB.values() for x in run_book(B)["trips"] if in_win(w, x)]
        bkey = {(x["book"], x["side"], x["k"], x["t_entry"]): x for x in base}
        res = {"paperBaseline": {"trips": len(base), "pnlUsdAt100": R5(sum(x["pnl_usd"] for x in base))}}
        variants = {"samePrice_12rungs": {"behind": 0, "rungs": all_rungs, "exit_wait": True},
                    "samePrice_bidsOnly": {"behind": 0, "rungs": bid_rungs, "exit_wait": True},
                    "oneTickBehind_12rungs": {"behind": 1, "rungs": all_rungs, "exit_wait": True},
                    "oneTickBehind_bidsOnly": {"behind": 1, "rungs": bid_rungs, "exit_wait": True},
                    # the executor before this change: a refused exit sent again on every turn
                    "samePrice_12rungs_exitSentEveryTurn": {"behind": 0, "rungs": all_rungs, "exit_wait": False},
                    "oneTickBehind_12rungs_exitSentEveryTurn": {"behind": 1, "rungs": all_rungs, "exit_wait": False}}
        for name, cfg in variants.items():
            trips, live_trips, live_fills, stats = [], [], 0, collections.Counter()
            same_decision = 0
            posts_day = collections.Counter()
            post_times = []
            by = collections.defaultdict(lambda: [0, 0.0, 0, 0.0])
            for b, B in BB.items():
                r = run_book(B, live=cfg)
                trips += r["trips"]
                stats.update(r["stats"])
                post_times += [x for x in r["post_times"] if lo <= x < hi]
                for d, nn in r["live_posts"].items():
                    if lo // DAY <= d < hi // DAY:
                        posts_day[d] += nn
                paper_oids = {f[5] for f in r["fills"] if f[0] == "entry"}
                for L in r["live"].values():
                    live_trips += [tr for tr in L.trips if tr["t_entry"] is not None and lo <= tr["t_entry"] < hi]
                    for ts, ticks, a, key in L.fills:
                        if lo <= ts < hi:
                            live_fills += 1
                            same_decision += bool(key and key[0] in paper_oids)
            sel = [x for x in trips if in_win(w, x)]
            ckey = {(x["book"], x["side"], x["k"], x["t_entry"]): x for x in sel}
            for x in base:
                kk = f"{x['book']} {x['side']} {x['k']}"
                by[kk][0] += 1; by[kk][1] += x["pnl_usd"]
            for x in sel:
                kk = f"{x['book']} {x['side']} {x['k']}"
                by[kk][2] += 1; by[kk][3] += x["pnl_usd"]
            pnl = sum(x["pnl_usd"] for x in sel)
            res[name] = {
                "paper": {"trips": len(sel), "pnlUsdAt100": R5(pnl), "deltaTrips": len(sel) - len(base),
                          "deltaPnlUsd": R5(pnl - res["paperBaseline"]["pnlUsdAt100"]),
                          "deltaPnlPct": round(100 * (pnl / res["paperBaseline"]["pnlUsdAt100"] - 1), 2),
                          "baselineTripsGone": sum(1 for k in bkey if k not in ckey), "tripsNotInBaseline": sum(1 for k in ckey if k not in bkey),
                          # what the trips that changed were worth: the paper's size is min($100, 10 % of the minute's volume)
                          "goneTrips": (lambda g: {"pnlUsd": R5(sum(x["pnl_usd"] for x in g)), "meanNotionalUsd": round(sum(x["notional_usd"] for x in g) / len(g), 2) if g else None})(
                              [bkey[k] for k in bkey if k not in ckey]),
                          "newTrips": (lambda g: {"pnlUsd": R5(sum(x["pnl_usd"] for x in g)), "meanNotionalUsd": round(sum(x["notional_usd"] for x in g) / len(g), 2) if g else None})(
                              [ckey[k] for k in ckey if k not in bkey]),
                          "baselineMeanNotionalUsd": round(sum(x["notional_usd"] for x in base) / len(base), 2),
                          "by": {kk: {"baseTrips": v[0], "trips": v[2], "basePnl": R5(v[1]), "pnl": R5(v[3])} for kk, v in sorted(by.items())}},
                "live": {"entryFills": live_fills, "entryFillsPerDay": round(live_fills / days_of(w), 2),
                         "entryFillsOnADecisionThePaperAlsoFilled": same_decision,
                         "roundTrips": len(live_trips), "pnlGbp": R5(sum(x["pnl_gbp"] for x in live_trips)),
                         "pnlGbpPerDay": R5(sum(x["pnl_gbp"] for x in live_trips) / days_of(w)),
                         "stopsUnfilledAtTheBound": stats.get("live_stop_unfilled", 0),
                         "entriesRefused": stats.get("live_entry_refused", 0), "exitsRefused": stats.get("live_exit_refused", 0),
                         "exitFills": stats.get("live_fills_exit", 0),
                         "postsPerDay": (lambda v: {"mean": round(sum(v) / len(v), 1), "p95": v[int(0.95 * (len(v) - 1))], "max": v[-1],
                                                    "daysOver900": sum(1 for x in v if x > 900), "daysOver950": sum(1 for x in v if x > 950),
                                                    "daysOver1000": sum(1 for x in v if x > 1000)})(sorted(posts_day.get(d, 0) for d in range(lo // DAY, hi // DAY))),
                         "postsByKind": {k[len("live_posts_"):]: v for k, v in stats.items() if k.startswith("live_posts_")},
                         "withoutAGovernor": bucket(post_times)},
            }
            print(w, name, res[name]["paper"]["deltaPnlPct"], res[name]["paper"]["deltaTrips"], json.dumps(res[name]["live"]), flush=True)
        out[w] = res
    return out


# ------------------------------------------------------------------------------------------------- 6. inventory
def public_inputs():
    doc = json.load(gzip.open(os.path.join(HERE, "inputs", "public_2026-10-01.json.gz"), "rt"))
    now = doc["pulled_at_ms"]
    x_bar = doc["yahoo_gbpusd_1m_last60"][-1]
    fair = {}
    for b, u in (("USDC-GBP", "USDC-USD"), ("USDT-GBP", "USDT-USD")):
        rows = [(int(r["start"]), float(r["close"])) for r in doc["candles"][u]["data"]]
        win = [c for s, c in rows if now - DAY <= s <= now - H]                # the rule's fairU: hours wholly inside the last day
        fair[b] = st.median(win) / x_bar[1]
    return {"pulledAt": iso(now), "x": x_bar[1], "xBar": iso(x_bar[0]), "fair": fair, "books": doc["books"], "pairs": doc["pairs"]}


def inventory(pub):
    """What £120 must hold and what converting it costs at today's books. The executor sizes a conversion at the best ask
    (rungBase(gbp, bestAsk)), bounds it at fair + 50 bps, and checks the account's free GBP at that bound plus the 9 bps
    fee (`runQuotesConvert`); the asks need, in coin, the sum of rungBase(£10, each ask's price)."""
    out = {"x": pub["x"], "xBar": pub["xBar"], "books": {}}
    bids_need = 0.0
    for b, f in pub["fair"].items():
        d = pub["books"][b]["data"]
        ask, bid = float(d["asks"][0]["price"]), float(d["bids"][0]["price"])
        bids = [floor_step(RUNG_GBP / (P.rt(f, k, "bid") * TICK)) * P.rt(f, k, "bid") * TICK for k in P.RUNGS]
        bids_need += sum(bids)
        asks_need = sum(floor_step(RUNG_GBP / (P.rt(f, k, "ask") * TICK)) for k in P.RUNGS)
        conv_base = floor_step(30.0 / ask)
        limit = math.floor(f * (1 + STOP_BOUND) / TICK + 1e-9) * TICK
        out["books"][b] = {
            "fair": round(f, 6), "bestBid": bid, "bestAsk": ask, "bestAskQty": float(d["asks"][0]["quantity"]), "askOverFairBps": round((ask / f - 1) * 1e4, 2),
            "spreadBps": round((ask / bid - 1) * 1e4, 2), "bidsGbp": R5(sum(bids)), "asksNeedCoin": R5(asks_need),
            "convert30": {"base": R5(conv_base), "spendGbp": R5(conv_base * ask), "coinNetOfA9bpsCoinFee": R5(conv_base * (1 - P.FEE)),
                          "marginOverAsksNeed_coinFee": R5(conv_base * (1 - P.FEE) - asks_need), "marginOverAsksNeed_gbpFee": R5(conv_base - asks_need),
                          "limit": round(limit, 4), "checkGbpAtLimit": R5(conv_base * limit * (1 + P.FEE)),
                          "costVsFairGbp": R5(conv_base * (ask - f) + conv_base * ask * P.FEE)},
        }
    out["sixBidsGbp"] = R5(bids_need)
    first, second = out["books"]["USDC-GBP"]["convert30"], out["books"]["USDT-GBP"]["convert30"]
    for bal in (120.0, 120.5, 121.0):
        out[f"account_{bal:g}"] = {
            # what runQuotesConvert refuses: free GBP (the total less every open buy) under the bound's cost plus the fee
            "withSixBidsResting": {"firstPasses": bal - bids_need >= first["checkGbpAtLimit"],
                                   "secondPasses": bal - first["spendGbp"] - bids_need >= second["checkGbpAtLimit"]},
            "withNoBidResting": {"firstPasses": bal >= first["checkGbpAtLimit"], "secondPasses": bal - first["spendGbp"] >= second["checkGbpAtLimit"]},
            "gbpLeftForTheBids_coinFee": R5(bal - first["spendGbp"] - second["spendGbp"]),
            "gbpLeftForTheBids_gbpFee": R5(bal - (first["spendGbp"] + second["spendGbp"]) * (1 + P.FEE)),
        }
    out["totalCostVsFairGbp"] = R5(first["costVsFairGbp"] + second["costVsFairGbp"])
    return out


def main():
    fx = P.fx_series()
    B_by_w = {w: books(fx, w) for w in WIN}
    pub = public_inputs()
    out = {"frozenSimSha256": FROZEN_SIM_SHA, "pr5vSimSha256": PR5V_SIM_SHA, "capitalGbp": CAPITAL_GBP, "rungGbp": RUNG_GBP,
           "windows": {w: {"entriesFrom": {b: iso(v) for b, v in WIN[w][2].items()}, "entriesTo": iso(WIN[w][3]), "days": round(days_of(w), 3)} for w in WIN}}
    out["fidelity"] = fidelity(B_by_w)
    # the committed figures the port must give back: the study's primary window and the tightened market at $100
    for w, want in (("wide", (8192, 707.90)), ("tight", (102, 11.6688))):
        trips = [x for B in B_by_w[w].values() for x in run_book(B)["trips"] if in_win(w, x)]
        got = (len(trips), round(sum(x["pnl_usd"] for x in trips), 4 if w == "tight" else 2))
        assert got == want, (w, got, want)
        out["fidelity"][f"{w}/committed"] = {"trips": got[0], "pnlUsd": got[1]}
    print("fidelity ok", flush=True)
    out["sizing"] = sizing(B_by_w, pub); print("sizing", json.dumps(out["sizing"]["frozenRuleAt10Gbp"]), flush=True)
    out["lossStop"] = loss_stop(B_by_w); print("loss stop", json.dumps(out["lossStop"]), flush=True)
    out["guards"] = guards(B_by_w); print("guards", json.dumps(out["guards"]), flush=True)
    out["governor"] = governor(); print("governor", json.dumps(out["governor"]), flush=True)
    out["firstOrder"] = first_order(B_by_w)
    print("first order", json.dumps({w: (v["fills"], v["absorbed"], v["share"]) for w, v in out["firstOrder"].items()}), flush=True)
    out["coupled"] = coupled(B_by_w)
    out["inventory"] = inventory(pub); print("inventory", json.dumps(out["inventory"]), flush=True)
    json.dump(out, open(os.path.join(HERE, "go_live_120.json"), "w"), indent=1, sort_keys=True)
    print("wrote go_live_120.json")


if __name__ == "__main__":
    main()
