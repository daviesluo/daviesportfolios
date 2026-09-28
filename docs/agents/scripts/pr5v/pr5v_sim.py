"""PR5v — PR5's frozen rule (`docs/agents/scripts/pr5/pr5_sim.py`, `simulate()`), generalised. New file; the frozen
simulator is imported for its input loaders and its pure helpers (`rt`, `rt_exit`, `blocks`, `through`) and is never
edited.

What is a parameter here and fixed there:
* the rung list per side, the re-price step, the size of a rung and the share of a minute's printed volume a fill may take;
* continuous time: a turn every `s_ms` (60,000 = today); an order placed at a turn goes live `delta_ms` later, or at the
  next minute start (`delta_ms=None`, the frozen convention); a re-priced order is cancelled first and its replacement
  goes live `cancel_ms + delta_ms` after the turn, while the OLD price stays fillable until `cancel_ms` after the turn
  (a stale quote can be picked off; `cancel_ms=0` is the frozen convention, where it vanishes at the turn);
* X for a turn at tau is the close of the latest GBP/USD minute bar whose minute started in
  [tau - lagx - 10 min, tau - lagx - 1 min]: with `lagx_ms=0` that is the frozen rule, and `lagx_ms=5000` means a bar is
  read 5 s after its minute ends. fairU is the frozen one: the median of the USD book's hourly closes with start in
  [tau - 24 h, tau - 1 h];
* the volume cap: `per_rung` is frozen (each rung takes up to `vol_share` of the minute's volume on its own);
  `shared` makes the orders on one side of one book share one cap a minute AND share each print's own quantity, nearest
  the market first; `shared_minute` shares the minute cap only (a decomposition). `exit_share=True` also puts exits in
  that queue and lets them fill in parts (the strict arm); otherwise an exit fills whole on any print through it (frozen);
* the order governor per account and UTC day (`gov`): entries withdrawn from `entry_at` POSTs, only stops from `stop_at`;
* `fast`: which actions a turn that is not a minute start may take ({"exit", "entry", "reprice"}; all by default),
  used only to split a cadence's gain into its parts.

Everything else is the frozen rule: fills on prints strictly through the price at or after the order's live instant,
the post-only refusal against the last print before that instant, re-placement of a refused order at the first turn
whose last print is no longer through it, exits resting at fair, the 24-hour taker stop at the last print of its step,
P&L in GBP x the latest X. With s_ms=60,000, delta_ms=None, lagx_ms=0, cancel_ms=0, per_rung, whole exits and no
governor it reproduces `simulate()` trip for trip and order for order (check_repro.py).

The loop visits only the steps where something can happen (a print, a change of X or fairU, a fill, a stop, a deferred
action); every other turn would do nothing, which is what makes a 1 s cadence over nine months cheap.
"""
import bisect, collections, heapq, math, os, sys, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pr5"))
import pr5_sim as P  # noqa: E402  (the frozen simulator: loaders and helpers only)

M = 60000
H = 3600000
DAY = 86400000
TICK = P.TICK
FEE = P.FEE
HALF_SPREAD = P.HALF_SPREAD
rt, rt_exit, blocks = P.rt, P.rt_exit, P.blocks
INF = float("inf")


class Mkt:
    """One GBP book: its prints, minute volumes, the GBP/USD minute bars and the USD book's hours."""

    def __init__(self, book, prints, fx_pairs, hours):
        self.book = book
        self.prints = prints                              # [(ts, ticks, qty, aggressor side)], time order
        self.pts = [p[0] for p in prints]
        self.qvol = {}
        for ts, pt, q, s in prints:                       # the frozen sum, in print order
            m = ts // M * M
            self.qvol[m] = self.qvol.get(m, 0) + q * pt * TICK
        self.fxs = [a for a, _ in fx_pairs]
        self.fxc = [b for _, b in fx_pairs]
        self.hs = [a for a, _ in hours]
        self.hc = [b for _, b in hours]
        self._fu = {}

    def X(self, tau, lagx):
        k = bisect.bisect_right(self.fxs, tau - lagx - M) - 1
        return self.fxc[k] if k >= 0 and self.fxs[k] >= tau - lagx - 10 * M else None

    def fairU(self, tau):
        i, j = bisect.bisect_left(self.hs, tau - 1440 * M), bisect.bisect_right(self.hs, tau - 60 * M)
        key = (i, j)
        v = self._fu.get(key, 0)
        if v == 0:
            v = st.median(self.hc[i:j]) if j > i else None
            self._fu[key] = v
        return v

    def last_before(self, t):
        k = bisect.bisect_left(self.pts, t) - 1
        return (self.prints[k][1], self.prints[k][3]) if k >= 0 else None

    def last_at_or_before(self, t):
        k = bisect.bisect_right(self.pts, t) - 1
        return self.prints[k][1] if k >= 0 else None

    def change_instants(self, lagx, t0, t1):
        """Every instant in [t0, t1) at which X or fairU may change value."""
        out = []
        a, z = bisect.bisect_left(self.fxs, t0 - 11 * M - lagx), bisect.bisect_left(self.fxs, t1)
        for b in self.fxs[a:z]:
            for c in (b + M + lagx, b + 10 * M + lagx + 1):
                if t0 <= c < t1:
                    out.append(c)
        a, z = bisect.bisect_left(self.hs, t0 - 1441 * M), bisect.bisect_left(self.hs, t1)
        for h in self.hs[a:z]:
            for c in (h + H, h + 1440 * M + 1):
                if t0 <= c < t1:
                    out.append(c)
        return out


def committed_markets(books=("USDC-GBP", "USDT-GBP")):
    """The committed PR5 inputs (Exness X), read with the frozen loaders."""
    fx = P.fx_series()
    fxp = sorted(fx.items())
    out = {}
    for b in books:
        hours = P.json.load(P._open(os.path.join(P.S, "data", "candles", f"{P.USD_OF[b]}_60.json")))["rows"]
        out[b] = Mkt(b, P.load_prints(b), fxp, [(int(h["start"]), float(h["close"])) for h in hours])
    return out


class Ord:
    __slots__ = ("side", "price", "fair_at", "live", "state", "post_i")

    def __init__(self, side, price, fair_at, live):
        self.side, self.price, self.fair_at, self.live, self.state, self.post_i = side, price, fair_at, live, "pending", None


class Rung:
    __slots__ = ("side", "k", "size", "acct", "mode", "o", "ghost", "entry", "t_e", "j_e", "qty", "nq", "fill_ts",
                 "stale_e", "left", "parts_pnl", "parts_gbp", "exit_ts", "stale_x", "x_e")

    def __init__(self, side, k, size, acct):
        self.side, self.k, self.size, self.acct = side, k, size, acct
        self.mode, self.o, self.ghost = "idle", None, None


class BookState:
    def __init__(self, mk, bi, cfg):
        self.mk, self.bi = mk, bi
        self.rungs = []
        for side in ("bid", "ask"):
            for k in cfg["rungs"][side]:
                self.rungs.append(Rung(side, k, cfg["size"], cfg["acct"](mk.book, side)))
        self.lastX = None
        self.dirty = True
        self.lo, self.hi = INF, -INF
        self.pp = 0                                      # next print to process
        self.min_live = INF                              # earliest live instant among pending orders


def default_cfg(**kw):
    cfg = dict(rungs={"bid": [0.001, 0.002, 0.003], "ask": [0.001, 0.002, 0.003]}, reprice=0.0005, size=100.0,
               vol_share=0.10, cap="per_rung", exit_share=False, s_ms=M, delta_ms=None, cancel_ms=0, lagx_ms=0,
               stress=False, gov=None, fast=("exit", "entry", "reprice"), acct=lambda book, side: 0, phase_ms=0,
               no_entries=False)
    cfg.update(kw)
    if isinstance(cfg["rungs"], (list, tuple)):
        cfg["rungs"] = {"bid": list(cfg["rungs"]), "ask": list(cfg["rungs"])}
    return cfg


def simulate(mkts, cfg, t0, t1, collect_posts=True, inject=None, stop_when_flat=False):
    """Run the rule on every book in `mkts` (a list of Mkt) over [t0, t1) on one turn grid (turns at
    t0 + phase + j * s). Returns a dict with the trips, the POSTs (ts, book index, account, kind, side, k, sent), the
    frozen-compatible orders per UTC day (stops apart), the DELETEs per minute, and counts of refusals and stale fills.
    `inject` = (book index, side, k, entry ticks, usd, fill ts, X) opens one position at the step holding `fill ts` (the
    random-time null's twin); with `stop_when_flat` the run ends when it is closed."""
    S = cfg["s_ms"]
    assert (t1 - t0) % S == 0 and t0 % M == 0 and M % S == 0
    N = (t1 - t0) // S
    t0 = t0 + cfg["phase_ms"]
    no_entries = cfg["no_entries"]
    R = cfg["reprice"]
    thr = 1 if cfg["stress"] else 0
    taker = (2 * FEE + 2 * HALF_SPREAD) if cfg["stress"] else (FEE + HALF_SPREAD)
    lagx, delta, cancel = cfg["lagx_ms"], cfg["delta_ms"], cfg["cancel_ms"]
    vs = cfg["vol_share"]
    cap = cfg["cap"]
    exit_share = cfg["exit_share"]
    fast = set(cfg["fast"])
    fast_all = fast >= {"exit", "entry", "reprice"}
    gov = cfg["gov"]
    books = [BookState(mk, bi, cfg) for bi, mk in enumerate(mkts)]
    trips, posts = [], []
    orders_by_day, stops_by_day, deletes_by_min = collections.Counter(), collections.Counter(), collections.Counter()
    gcount = collections.Counter()                       # (account, day) -> POSTs
    stats = collections.Counter()
    dyn = []

    def live_at(tau, repl=False):
        if delta is None:
            return (tau // M + 1) * M
        return tau + (cancel if repl else 0) + delta

    def post(bk, r, tau, kind):
        day = tau // DAY
        if kind != "stop":
            orders_by_day[day] += 1
        else:
            stops_by_day[day] += 1
        gcount[(r.acct, day)] += 1
        if collect_posts:
            posts.append([tau, bk.bi, r.acct, kind, r.side, r.k, True])
        return len(posts) - 1

    def unpost(i, tau_post):
        day = tau_post // DAY
        orders_by_day[day] -= 1
        p = posts[i]
        gcount[(p[2], day)] -= 1
        p[6] = False
        stats["unposted_after_stale_fill"] += 1

    def push(j, bi):
        if j < N:
            heapq.heappush(dyn, (j, bi))

    def note_pending(bk, o):
        if o.live < bk.min_live:
            bk.min_live = o.live

    def activate(bk, t, strict):
        if bk.min_live > t or (strict and bk.min_live == t):
            return
        m = INF
        for r in bk.rungs:
            o = r.o
            if o is not None and o.state == "pending":
                if o.live < t or (not strict and o.live == t):
                    o.state = "rejected" if blocks(o.side, o.price, bk.mk.last_before(o.live)) else "live"
                    if o.state == "rejected":
                        stats["refused"] += 1
                        bk.dirty = True
                elif o.live < m:
                    m = o.live
        bk.min_live = m

    def withdraw(bk, r, tau):
        if r.o is not None and r.o.state != "rejected":
            deletes_by_min[tau // M] += 1
        r.mode, r.o = "idle", None

    def reprice(bk, r, o, price, f, tau, kind):
        if o.state == "live" and cancel > 0:
            r.ghost = (o.price, tau + cancel, tau)
        if o.state != "rejected":
            deletes_by_min[tau // M] += 1
        o.price, o.fair_at, o.live, o.state = price, f, live_at(tau, True), "pending"
        o.post_i = post(bk, r, tau, kind)
        note_pending(bk, o)

    def turn(bk, tau, j):
        mk = bk.mk
        x = mk.X(tau, lagx)
        if x:
            bk.lastX = x
        u = mk.fairU(tau)
        f = (u / x) if (x and u) else None
        if not bk.dirty and f is not None and bk.lo <= f <= bk.hi:
            return
        full = fast_all or (tau - t0) % M == 0
        day = tau // DAY
        lp_turn = None
        deferred = False
        for r in bk.rungs:
            n_acct = gcount[(r.acct, day)] if gov else 0
            if r.mode in ("idle", "quote"):
                o = r.o
                if f is None:
                    if r.mode == "quote":
                        if full or "reprice" in fast:
                            withdraw(bk, r, tau)
                        else:
                            deferred = True
                    continue
                if gov and n_acct >= gov["entry_at"]:
                    if r.mode == "quote":
                        withdraw(bk, r, tau)
                        stats["gov_withdrawn"] += 1
                    continue
                if r.mode == "idle":
                    if no_entries:
                        continue
                    if full or "entry" in fast:
                        r.o = Ord(r.side, rt(f, r.k, r.side), f, live_at(tau))
                        r.mode = "quote"
                        r.o.post_i = post(bk, r, tau, "place")
                        note_pending(bk, r.o)
                    else:
                        deferred = True
                    continue
                if o.state == "rejected":
                    if not (full or "entry" in fast):
                        deferred = True
                        continue
                    if abs(f / o.fair_at - 1) > R:
                        o.price, o.fair_at = rt(f, r.k, r.side), f
                    if lp_turn is None:
                        lp_turn = [mk.last_before(tau)]
                    if not blocks(o.side, o.price, lp_turn[0]):
                        o.live, o.state = live_at(tau), "pending"
                        o.post_i = post(bk, r, tau, "replace")
                        note_pending(bk, o)
                    continue
                if abs(f / o.fair_at - 1) > R:
                    if full or "reprice" in fast:
                        reprice(bk, r, o, rt(f, r.k, r.side), f, tau, "reprice")
                    else:
                        deferred = True
            elif r.mode == "position":
                o = r.o
                xs = "ask" if r.side == "bid" else "bid"
                if gov and n_acct >= gov["stop_at"]:
                    continue
                if o is None:
                    if f is not None:
                        if full or "exit" in fast:
                            r.o = Ord(xs, rt_exit(f, r.side), f, live_at(tau))
                            r.o.post_i = post(bk, r, tau, "exit")
                            note_pending(bk, r.o)
                        else:
                            deferred = True
                elif o.state == "rejected":
                    if not (full or "exit" in fast):
                        deferred = True
                        continue
                    if f is not None and abs(f / o.fair_at - 1) > R:
                        o.price, o.fair_at = rt_exit(f, r.side), f
                    if lp_turn is None:
                        lp_turn = [mk.last_before(tau)]
                    if not blocks(o.side, o.price, lp_turn[0]):
                        o.live, o.state = live_at(tau), "pending"
                        o.post_i = post(bk, r, tau, "exit_replace")
                        note_pending(bk, o)
                elif f is not None and abs(f / o.fair_at - 1) > R:
                    if full or "reprice" in fast:
                        reprice(bk, r, o, rt_exit(f, r.side), f, tau, "exit_reprice")
                    else:
                        deferred = True
        # what the next turn must look at
        lo, hi, dirty = -INF, INF, deferred
        for r in bk.rungs:
            if (r.mode == "idle" and not no_entries) or (r.mode == "position" and r.o is None):
                dirty = True
            if r.o is not None:
                fa = r.o.fair_at
                a = fa * (1 - R) * (1 + 1e-12)
                b = fa * (1 + R) * (1 - 1e-12)
                if a > lo:
                    lo = a
                if b < hi:
                    hi = b
            if gov and r.mode == "quote" and gcount[(r.acct, day)] >= gov["entry_at"]:
                dirty = True
        bk.lo, bk.hi, bk.dirty = lo, hi, dirty
        if deferred and not full:
            push(((tau - t0) // M + 1) * M // S, bk.bi)

    def open_pos(bk, r, price_ticks, usd, tau, j, ts, stale):
        nq = usd / bk.lastX
        p = price_ticks * TICK
        r.mode, r.o, r.ghost = "position", None, None
        r.entry, r.t_e, r.j_e, r.qty, r.nq, r.fill_ts, r.stale_e = p, tau, j, nq / p, nq, ts, stale
        r.left, r.parts_pnl, r.parts_gbp, r.exit_ts, r.stale_x, r.x_e = nq / p, 0.0, 0.0, None, False, bk.lastX
        bk.dirty = True
        push(-(-(tau + 1440 * M - t0) // S), bk.bi)       # the stop's step
        push(j + 1, bk.bi)

    def close(bk, r, tau, j, px, how, ts=None, stale=False):
        pnl_q = r.qty * (px - r.entry) if r.side == "bid" else r.qty * (r.entry - px)
        xr = bk.lastX or 1.0
        trips.append({"book": bk.mk.book, "side": r.side, "k": r.k, "t_entry": r.t_e, "t_exit": tau,
                      "entry": round(r.entry, 6), "exit": round(px, 8), "how": how, "notional_usd": r.nq * xr,
                      "pnl_usd": pnl_q * xr, "fill_ts": r.fill_ts, "exit_ts": ts, "stale_entry": r.stale_e,
                      "stale_exit": stale})
        r.mode, r.o, r.ghost = "idle", None, None
        bk.dirty = True
        push(j + 1, bk.bi)

    def close_part(bk, r, tau, j, px, qty, how, ts=None, stale=False):
        """exit_share: sell (or buy back) `qty` of the position at px; the trip closes when nothing is left."""
        xr = bk.lastX or 1.0
        pnl_q = qty * (px - r.entry) if r.side == "bid" else qty * (r.entry - px)
        r.parts_pnl += pnl_q * xr
        r.parts_gbp += qty * px
        r.left -= qty
        if r.left <= r.qty * 1e-9:
            trips.append({"book": bk.mk.book, "side": r.side, "k": r.k, "t_entry": r.t_e, "t_exit": tau,
                          "entry": round(r.entry, 6), "exit": round(r.parts_gbp / r.qty, 8), "how": how,
                          "notional_usd": r.nq * xr, "pnl_usd": r.parts_pnl, "fill_ts": r.fill_ts, "exit_ts": ts,
                          "stale_entry": r.stale_e, "stale_exit": stale})
            r.mode, r.o, r.ghost = "idle", None, None
            push(j + 1, bk.bi)
        bk.dirty = True

    def on_print(bk, tau, j, ts, q, qty, aggr):
        activate(bk, ts, False)
        m = ts // M * M
        cands = []                                       # (rung, price ticks, is_ghost)
        for r in bk.rungs:
            o = r.o
            if o is not None and o.state == "live" and o.live <= ts:
                if (q < o.price - thr) if o.side == "bid" else (q > o.price + thr):
                    cands.append((r, o.price, False))
                    continue
            g = r.ghost
            if g is not None:
                if ts >= g[1]:
                    r.ghost = None
                elif r.mode in ("quote", "position"):
                    gs = r.side if r.mode == "quote" else ("ask" if r.side == "bid" else "bid")
                    if (q < g[0] - thr) if gs == "bid" else (q > g[0] + thr):
                        cands.append((r, g[0], True))
        if any(r.o is not None and r.o.state == "rejected" for r in bk.rungs):
            bk.dirty = True
            push(j + 1, bk.bi)
        if not cands:
            return
        if cap == "per_rung":
            for r, price, ghost in cands:
                if r.mode == "quote":
                    if not bk.lastX:
                        continue
                    usd = min(r.size, vs * bk.mk.qvol[m] * bk.lastX)
                    if usd <= 0:
                        continue
                    if ghost:
                        _ghost_fill(bk, r, tau)
                    open_pos(bk, r, price, usd, tau, j, ts, ghost)
                elif r.mode == "position":
                    if ghost:
                        _ghost_fill(bk, r, tau)
                    if exit_share:
                        close_part(bk, r, tau, j, price * TICK, r.left, "maker", ts, ghost)
                    else:
                        close(bk, r, tau, j, price * TICK, "maker", ts, ghost)
            return
        # shared caps: one queue per side of the book, nearest the market first
        if not bk.lastX:
            cands = [c for c in cands if c[0].mode == "position"]
            if not cands:
                return
        side_of = lambda c: c[0].side if c[0].mode == "quote" else ("ask" if c[0].side == "bid" else "bid")
        by_side = collections.defaultdict(list)
        for c in cands:
            by_side[side_of(c)].append(c)
        pusd = qty * q * TICK * (bk.lastX or 0.0)
        for sd, lst in by_side.items():
            lst.sort(key=lambda c: (-c[1], c[0].k) if sd == "bid" else (c[1], c[0].k))
            key = (bk.bi, sd, m)
            if key not in budgets:
                budgets[key] = vs * bk.mk.qvol[m] * (bk.lastX or 0.0)
            pleft = pusd if cap == "shared" else INF
            for r, price, ghost in lst:
                if r.mode == "position" and not exit_share:
                    if ghost:
                        _ghost_fill(bk, r, tau)
                    close(bk, r, tau, j, price * TICK, "maker", ts, ghost)
                    continue
                room = min(budgets[key], pleft)
                if room <= 1e-12:
                    continue
                if r.mode == "quote":
                    usd = min(r.size, room)
                    if ghost:
                        _ghost_fill(bk, r, tau)
                    open_pos(bk, r, price, usd, tau, j, ts, ghost)
                else:
                    px = price * TICK
                    want = r.left * px * bk.lastX
                    usd = min(want, room)
                    if ghost:
                        _ghost_fill(bk, r, tau)
                    close_part(bk, r, tau, j, px, r.left if usd >= want else usd / (px * bk.lastX), "maker", ts, ghost)
                budgets[key] -= usd
                pleft -= usd

    def _ghost_fill(bk, r, tau):
        """A stale order filled before its cancel landed: its replacement is never sent."""
        stats["stale_fills"] += 1
        o = r.o
        if o is not None and o.post_i is not None and collect_posts:
            unpost(o.post_i, posts[o.post_i][0])
        r.o = None

    def stops(bk, tau, j):
        for r in bk.rungs:
            if r.mode == "position" and r.j_e != j and (tau >= r.t_e + 1440 * M or j == N - 1):
                c = bk.mk.last_at_or_before(tau + S - 1) * TICK
                px = c * (1 - taker) if r.side == "bid" else c * (1 + taker)
                if j != N - 1:
                    post(bk, r, tau, "stop")
                if r.o is not None and r.o.state != "rejected":
                    deletes_by_min[tau // M] += 1
                if exit_share:
                    close_part(bk, r, tau, j, px, r.left, "taker")
                else:
                    close(bk, r, tau, j, px, "taker")

    budgets = {}
    # the static steps: every print's step, every step where X or fairU may change, the first and the last
    static = []
    for bk in books:
        sset = {0, N - 1}
        pts = bk.mk.pts
        for ts in pts[bisect.bisect_left(pts, t0):bisect.bisect_left(pts, t0 + N * S)]:
            sset.add((ts - t0) // S)
        for c in bk.mk.change_instants(lagx, t0, t0 + N * S):
            sset.add(-(-(c - t0) // S))
        static.append(sorted(x for x in sset if x < N))
        bk.pp = bisect.bisect_left(bk.mk.pts, t0)
    ptr = [0] * len(books)
    if inject is not None:
        bi, side, k, ticks, usd, fts, x0 = inject
        bk = books[bi]
        bk.rungs = [Rung(side, k, usd, cfg["acct"](bk.mk.book, side))]
        bk.lastX = x0
        jf = (fts - t0) // S
        open_pos(bk, bk.rungs[0], ticks, usd, t0 + jf * S, jf, fts, False)
        bk.pp = bisect.bisect_right(bk.mk.pts, fts)
        for b2 in books:
            static[b2.bi] = [x for x in static[b2.bi] if x > jf]
    while True:
        if stop_when_flat and inject is not None and books[inject[0]].rungs[0].mode == "idle":
            break
        j = INF
        for bi, sl in enumerate(static):
            if ptr[bi] < len(sl) and sl[ptr[bi]] < j:
                j = sl[ptr[bi]]
        if dyn and dyn[0][0] < j:
            j = dyn[0][0]
        if j == INF or j >= N:
            break
        at = set()
        for bi, sl in enumerate(static):
            while ptr[bi] < len(sl) and sl[ptr[bi]] == j:
                ptr[bi] += 1
                at.add(bi)
        while dyn and dyn[0][0] <= j:
            at.add(heapq.heappop(dyn)[1])
        tau = t0 + j * S
        order = sorted(at)
        for bi in order:
            bk = books[bi]
            activate(bk, tau, True)
            turn(bk, tau, j)
            activate(bk, tau, False)
        for bi in order:
            bk = books[bi]
            pts, prs = bk.mk.pts, bk.mk.prints
            end = tau + S
            while bk.pp < len(pts) and pts[bk.pp] < end:
                ts, q, qty, aggr = prs[bk.pp]
                bk.pp += 1
                if ts >= tau:
                    on_print(bk, tau, j, ts, q, qty, aggr)
            stops(bk, tau, j)
    return {"trips": trips, "posts": posts, "orders_by_day": orders_by_day, "stops_by_day": stops_by_day,
            "deletes_by_min": deletes_by_min, "stats": stats}
