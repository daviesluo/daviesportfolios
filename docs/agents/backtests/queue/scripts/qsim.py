"""QUEUE's scorer: PR5's turn re-implemented, with the queue layer of `docs/agents/reviews/2026-09-28-queue-prereg.md`
on top. Written 2026-10-24, after the freeze and before the window's export (2026-11-02), as the pre-registration's
check 2 asks: "The scorer is written after the freeze, in docs/agents/backtests/queue/. It re-implements PR5's turn with
the queue layer on top."

With the layer off (`layer=False`: the last-print post-only test, fills on prints strictly through only) `run` is PR5's
frozen `simulate()` (`docs/agents/scripts/pr5/pr5_sim.py`, sha256 56fbad85...) minute for minute: check 2 runs it on PR6's
and PR5's committed inputs and compares every stored field of their 8,341 and 8,192 primary round trips. With the layer
on it adds, as the pre-registration's "The queue fill" says:

* rule 1, going live: refused by the last-print test or by the book at L (a bid at or above its best ask, an ask at or
  below its best bid; the book at T is the valid row with the greatest ts <= T whose seen_until >= T - 120 s); a refused
  order is re-placed at a turn only if the last print is not through it and the book at the turn does not show it
  crossing (with no book, the last print alone);
* rule 2, joining: behind the covering row's level at min(seen_until, L + 60 s) + 2,000 ms when a valid row covers L, was
  read again after it, and holds the price within its depth; otherwise at the ts + 2,000 ms of the first valid row after L
  that holds it; never before; a level absent within the depth is a queue of 0, a price beyond the depth joins nothing;
* rule 3, at-price prints on the taking side use up the queue ahead first, and the rest fills the order;
* rule 4, each later valid row holding the price caps the queue ahead (min), at its ts + 2,000 ms; a print stamped at or
  before a reading's instant is applied before it;
* rule 5, a print strictly through fills as the frozen rules do, joined or not, at the frozen size;
* rule 6, an entry fills once (its at-price fill is the print's excess, at most the order's $100); an exit fills in
  pieces, each at X of its own minute; a through print or the 24-hour stop closes what is left;
* rule 7, the rule's own orders at one price form one queue in join order (ties: the earlier turn, then rung 1, 2, 3):
  fill_j = min(rem_j, max(0, q - A_j - sum_{i<j} rem_i)), then A_j <- max(0, A_j - (q - sum_{i<j} fill_i));
* rule 8, a re-price, re-placement or withdrawal ends the order's place;
* faulty rows (an empty side, best bid >= best ask) are not read at all.

Arms: `stress` (book quantities x 1.5, a through fill one tick further, the stop twice), `join="optimistic"` (3b),
`book_refusal=False` (3c), `lag_ms=30000` (3d), `join="middle"` (3h); the frozen rules' own fills are `layer=False` (3a).
Rules: "q1" (fair 1.0000 or dark, the frozen fraction prices), "q2" (fair in ticks, rungs in ticks, re-priced whenever
the fair differs), "q3" (PR5's: f = fairU / X, prices by `rt` / `rt_exit`, re-priced past 0.05 %).

Where the pre-registration is silent the narrowest reading is taken and named in `GAPS` (score.py prints them).
"""
import bisect, collections, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
sys.dont_write_bytecode = True
PR5_DIR = os.path.join(REPO, "docs", "agents", "scripts", "pr5")
if PR5_DIR not in sys.path:
    sys.path.insert(0, PR5_DIR)
import pr5_sim as P  # noqa: E402  (its helpers only: blocks, through, rt, rt_exit, FEE; never edited)

M, DAY, TICK = 60000, 86400000, 1e-4
FEE = P.FEE
INF = float("inf")
STALE_MS = 120000          # the book at T: its row's seen_until at least T - 120 s
READ_LAG_MS = 2000         # against prints, a reading is placed at its instant + 2,000 ms
JOIN_MAX_MS = 60000        # a covering row joins at min(seen_until, L + 60 s) + 2,000 ms
DEPTH = 5

GAPS = {
    "x_of_piece": "An exit piece is converted at 'X of its own minute': the frozen convention, the latest X at or before "
                  "that minute (PR5's lastX), since a dark minute has no X of its own.",
    "entry_notional": "A round trip's entry notional (condition 4's $1) is its coins x entry price x the X at the fill; "
                      "the trip's notional_usd stays the frozen nq x X at its close (equal for Q1 and Q2, X = 1).",
    "optimistic_beyond_depth": "Arm 3b joins at L behind the level in the book at L only where that book holds the price "
                               "within its depth; otherwise, as with no book, it joins as the primary.",
    "inclusive_join": "In arms 3b and 3h, whose join is at L itself, prints count from L: a print stamped at L or later "
                      "moves the order. In the primary a print stamped at or before the join's instant does not.",
    "covers": "A row covers T when ts <= T <= seen_until; 'the first valid row after L' is the first with ts > L.",
    "lag_pending": "Arm 3d: an order the turn removes keeps the life it would have had at its old price (its delayed "
                   "go-live and its tests, if it had not gone live yet) until 30 s after the start of the next minute; any "
                   "fill of it withdraws the rung's new order at that instant, and an exit piece leaves the rest to the "
                   "next turn's exit.",
}


# ------------------------------------------------------------------ the book record
class Row:
    """One valid row of `agent_book_levels`: a book the recorder found first at ts, last at seen_until."""
    __slots__ = ("ts", "su", "reads", "bids", "asks", "bq", "aq", "best_bid", "best_ask", "R")

    def __init__(self, ts, su, reads, bids, asks):
        self.ts, self.su, self.reads = ts, su, reads
        self.bids, self.asks = bids, asks                         # [(ticks, qty)], best first, at most five
        self.bq, self.aq = dict(bids), dict(asks)
        self.best_bid, self.best_ask = bids[0][0], asks[0][0]
        self.R = ts + READ_LAG_MS                                 # where the reading falls among prints


def make_rows(raw):
    """Valid rows (sorted by ts) and faulty ones from records (ts, seen_until, reads, bids, asks), each side a list of
    [price, qty, orders] as `bookLevels()` stores it, best first. Faulty: a side empty, or best bid >= best ask."""
    valid, faulty = [], []
    for ts, su, reads, bids, asks in sorted(raw, key=lambda r: r[0]):
        b = [(round(float(p) / TICK), float(q)) for p, q, *_ in bids]
        a = [(round(float(p) / TICK), float(q)) for p, q, *_ in asks]
        if not b or not a or b[0][0] >= a[0][0]:
            faulty.append((ts, su, reads))
        else:
            valid.append(Row(ts, su, reads, b, a))
    return valid, faulty


def holds(row, side, price):
    """Is `price` within the row's recorded depth on `side`? Fewer than five levels: the whole side is known."""
    lv = row.bids if side == "bid" else row.asks
    if len(lv) < DEPTH:
        return True
    return price >= lv[DEPTH - 1][0] if side == "bid" else price <= lv[DEPTH - 1][0]


def level(row, side, price):
    return (row.bq if side == "bid" else row.aq).get(price, 0.0)


def crosses(row, side, price):
    return price >= row.best_ask if side == "bid" else price <= row.best_bid


# ------------------------------------------------------------------ one book's inputs
class QBook:
    """One book over [t0, t1): its prints (ts, ticks, qty, aggressor, id) in the order they are applied, each minute's X
    and fair (None: dark), and the recorded book's valid and faulty rows."""

    def __init__(self, book, prints, t0, t1, X, F, rows=(), faulty=()):
        self.book, self.t0, self.t1 = book, t0, t1
        self.n = (t1 - t0) // M
        self.all_prints = list(prints)
        self.pts = [p[0] for p in self.all_prints]
        self.by_min = collections.defaultdict(list)
        for p in self.all_prints:
            if t0 <= p[0] < t1:
                self.by_min[(p[0] - t0) // M].append(p)
        self.qvol = {i: sum(q * pt * TICK for ts, pt, q, *_ in ps) for i, ps in self.by_min.items()}
        assert len(X) == self.n and len(F) == self.n
        self.X, self.F = list(X), list(F)
        self.lastX = []
        lx = None
        for x in self.X:
            if x:
                lx = x
            self.lastX.append(lx)
        self.rows = list(rows)
        self.rts = [r.ts for r in self.rows]
        self.faulty = list(faulty)
        self.fts = [f[0] for f in self.faulty]
        self.print_minutes = sorted(self.by_min)
        self.f_change = [i for i in range(1, self.n) if self.F[i] != self.F[i - 1]]

    def last_before(self, t):
        k = bisect.bisect_left(self.pts, t) - 1
        return (self.all_prints[k][1], self.all_prints[k][3]) if k >= 0 else None

    def last_at_or_before(self, t):
        k = bisect.bisect_right(self.pts, t) - 1
        return self.all_prints[k][1] if k >= 0 else None

    def book_at(self, T):
        """Rule 1's book at T: the valid row with the greatest ts <= T, if its seen_until >= T - 120 s."""
        k = bisect.bisect_right(self.rts, T) - 1
        if k >= 0 and self.rows[k].su >= T - STALE_MS:
            return k
        return None

    def covering(self, T):
        k = bisect.bisect_right(self.rts, T) - 1
        if k >= 0 and self.rows[k].ts <= T <= self.rows[k].su:
            return k
        return None

    def mid_at(self, T):
        """The markout's mid at T: the book at T, or None when there is none or the latest row at or before T is faulty."""
        k = self.book_at(T)
        if k is None:
            return None
        f = bisect.bisect_right(self.fts, T) - 1
        if f >= 0 and self.faulty[f][0] > self.rows[k].ts:
            return None
        r = self.rows[k]
        return (r.best_bid + r.best_ask) / 2.0


# ------------------------------------------------------------------ the rule's orders and rungs
class Order:
    __slots__ = ("side", "price", "fair_at", "live", "state", "placed", "go", "had_book", "J", "incl", "A", "jrow", "ptr",
                 "qprev", "P", "expire", "joined_at_coins")

    def __init__(self, side, price, fair_at, live, placed):
        self.side, self.price, self.fair_at, self.live, self.state, self.placed = side, price, fair_at, live, "pending", placed
        self.go = None
        self.had_book = None
        self.J = None
        self.incl = False
        self.A = 0.0
        self.jrow = -1
        self.ptr = 0
        self.qprev = None
        self.P = 0.0
        self.expire = None
        self.joined_at_coins = None

    def lose_place(self):
        self.J, self.incl, self.A, self.jrow, self.ptr, self.qprev, self.P, self.go, self.had_book = None, False, 0.0, -1, 0, None, 0.0, None, None
        self.joined_at_coins = None


class Rung:
    __slots__ = ("side", "k", "ri", "mode", "o", "ghost", "entry", "ticks", "t_e", "i_e", "qty", "left", "nq", "fill_ts",
                 "fill_id", "kind", "parts", "stopped", "ent_usd", "x_e", "join_info")

    def __init__(self, side, k, ri):
        self.side, self.k, self.ri = side, k, ri
        self.mode, self.o, self.ghost = "idle", None, None


class Cfg:
    def __init__(self, rule, rungs, half_spread, layer=True, join="primary", book_refusal=True, lag_ms=0, stress=False,
                 size=100.0, reprice=0.0005, vol_share=0.10, markouts=False):
        self.rule, self.rungs, self.hs = rule, list(rungs), half_spread
        self.layer, self.join, self.book_refusal, self.lag, self.stress = layer, join, book_refusal, lag_ms, stress
        self.size, self.reprice, self.vs, self.markouts = size, reprice, vol_share, markouts


def entry_px(cfg, f, k, side):
    if cfg.rule == "q2":
        return f - k if side == "bid" else f + k
    return P.rt(f, k, side)


def exit_px(cfg, f, pos_side):
    if cfg.rule == "q2":
        return f
    return P.rt_exit(f, pos_side)


def moved(cfg, f, fa):
    if cfg.rule == "q2":
        return f != fa
    return abs(f / fa - 1) > cfg.reprice


def queue_split(As, rems, q):
    """Rule 7: a taking-side print of q coins at the price of the rule's orders j (in join order), each behind its own
    queue ahead A_j and the unfilled remainder of the rule's orders that joined before it, every value taken before the
    print: fill_j = min(rem_j, max(0, q - A_j - sum_{i<j} rem_i)); then A_j <- max(0, A_j - (q - sum_{i<j} fill_i))."""
    fills, ahead_rem = [], 0.0
    for A, rem in zip(As, rems):
        fills.append(min(rem, max(0.0, q - A - ahead_rem)))
        ahead_rem += rem
    newA, ahead_fill = [], 0.0
    for A, fl in zip(As, fills):
        newA.append(max(0.0, A - (q - ahead_fill)))
        ahead_fill += fl
    return fills, newA


# ------------------------------------------------------------------ the run
def run(B, cfg, inject=None, start_i=0, stop_when_flat=False, collect=None, skip=True):
    """PR5's minute loop on one book (`simulate()`'s order of steps: the turn, go-live at the minute's start, its prints,
    the 24-hour stop), with the queue layer when `cfg.layer`. Returns (trips, orders by UTC day). `inject` =
    (side, entry ticks, usd, minute index, fill ts): one position, no entries (the hourly shift's twin); `collect`, a
    dict, receives the joins, the entry fills (with their markouts) and the counts the arms report."""
    lay = cfg.layer
    thr = 1 if cfg.stress else 0
    mult = 1.5 if cfg.stress else 1.0
    taker = (2 * FEE + 2 * cfg.hs) if cfg.stress else (FEE + cfg.hs)
    lag = cfg.lag
    no_entries = inject is not None
    trips, orders = [], collections.Counter()
    rungs = [] if no_entries else [Rung(s, k, ri) for s in ("bid", "ask") for ri, k in enumerate(cfg.rungs)]
    n = B.n
    if collect is not None:
        collect.setdefault("joins", [])
        collect.setdefault("fills", [])
        collect.setdefault("no_book_golive_fills", 0)

    # -------------------------------------------------------------- the queue layer's pieces
    def plan_join(o, G):
        """Rule 2 (or arm 3b / 3h): where and behind what the order joins, read at its go-live instant G."""
        side, p = o.side, o.price
        if cfg.join in ("optimistic", "middle"):
            k = B.book_at(G) if cfg.join == "optimistic" else B.covering(G)
            if k is not None and holds(B.rows[k], side, p):
                o.J, o.incl, o.A, o.jrow = G, True, level(B.rows[k], side, p) * mult, k
                o.qprev, o.P, o.ptr = o.A, 0.0, k + 1
                o.joined_at_coins = o.A
                return
        k = B.covering(G)
        if k is not None and B.rows[k].su > G and holds(B.rows[k], side, p):
            o.J, o.A, o.jrow = min(B.rows[k].su, G + JOIN_MAX_MS) + READ_LAG_MS, level(B.rows[k], side, p) * mult, k
        else:
            j = bisect.bisect_right(B.rts, G)
            while j < len(B.rows) and not holds(B.rows[j], side, p):
                j += 1
            if j >= len(B.rows):
                o.J = None
                return
            o.J, o.A, o.jrow = B.rows[j].R, level(B.rows[j], side, p) * mult, j
        o.ptr = o.jrow + 1
        o.qprev, o.P = o.A, 0.0
        o.joined_at_coins = o.A

    def apply_caps(o, ts):
        """Rule 4 (or 3b's proportional rule): every later valid row read before the print at ts."""
        rows = B.rows
        while o.ptr < len(rows) and rows[o.ptr].R < ts:
            r = rows[o.ptr]
            o.ptr += 1
            if not holds(r, o.side, o.price):
                continue
            qn = level(r, o.side, o.price) * mult
            if cfg.join == "optimistic" and o.incl:
                base = o.qprev - o.P
                if base > 0 and qn < base:
                    o.A = o.A * qn / base
                o.qprev, o.P = qn, 0.0
            if qn < o.A:
                o.A = qn

    def golive(o, G):
        lp = B.last_before(G)
        bk = B.book_at(G) if lay else None
        o.had_book = bk is not None
        refused = P.blocks(o.side, o.price, lp)
        if not refused and lay and cfg.book_refusal and bk is not None and crosses(B.rows[bk], o.side, o.price):
            refused = True
        o.go = G
        o.state = "rejected" if refused else "live"
        if collect is not None:
            collect["golive"] = collect.get("golive", 0) + 1
            collect["refused"] = collect.get("refused", 0) + (1 if refused else 0)
        if o.state == "live" and lay:
            plan_join(o, G)

    def replace_ok(o, t, lp):
        if P.blocks(o.side, o.price, lp):
            return False
        if lay and cfg.book_refusal:
            bk = B.book_at(t)
            if bk is not None and crosses(B.rows[bk], o.side, o.price):
                return False
        return True

    def remove(r, i, keep_ghost=True):
        """The turn takes the rung's order away (rule 8): with a live lag, it stays live at its old price for a while."""
        o = r.o
        if lag and keep_ghost and o is not None and o.state in ("live", "pending"):
            o.expire = B.t0 + (i + 1) * M + lag
            r.ghost = o

    def open_pos(r, ticks, coins, nq, t, i, ts, pid, kind, x, o):
        p = ticks * TICK
        r.mode, r.o = "position", None
        r.entry, r.ticks, r.t_e, r.i_e, r.qty, r.left, r.nq = p, ticks, t, i, coins, coins, nq
        r.fill_ts, r.fill_id, r.kind, r.parts, r.stopped, r.ent_usd, r.x_e = ts, pid, kind, [], False, nq * x, x
        r.join_info = (o.go, o.J, o.joined_at_coins, o.had_book) if o is not None else None
        if collect is not None and o is not None:
            if o.had_book is False:
                collect["no_book_golive_fills"] += 1
            rec = {"book": B.book, "side": r.side, "k": r.k, "kind": kind, "ts": ts, "ticks": ticks, "coins": coins, "usd": nq * x,
                   "go": o.go, "J": o.J, "queue_at_join": o.joined_at_coins, "order_coins": cfg.size / x / p}
            if cfg.markouts:
                for h in (5, 60):
                    mid = B.mid_at(ts + h * M)
                    rec[f"markout_{h}m_bps"] = None if mid is None else ((mid - ticks) if r.side == "bid" else (ticks - mid)) / ticks * 1e4
            collect["fills"].append(rec)

    def close_whole(r, t, px, how, lastX):
        """PR5's `_close`, field for field."""
        pnl_q = r.qty * (px - r.entry) if r.side == "bid" else r.qty * (r.entry - px)
        xr = lastX or 1.0
        trips.append({"book": B.book, "side": r.side, "k": r.k, "t_entry": r.t_e, "t_exit": t, "entry": round(r.entry, 6),
                      "exit": round(px, 8), "how": how, "notional_usd": r.nq * xr, "pnl_usd": pnl_q * xr, "fill_ts": r.fill_ts,
                      "fill_id": r.fill_id, "fill_kind": r.kind, "entry_notional_usd": r.ent_usd, "qty": r.qty, "pieces": 1,
                      "ticks": r.ticks, "join": r.join_info})
        r.mode, r.o, r.ghost = "idle", None, None

    def close_piece(r, t, px, coins, how, lastX):
        """Rule 6: an exit fills in pieces, each at X of its own minute; the trip closes when nothing is left."""
        if not r.parts and coins >= r.left - r.qty * 1e-12:
            close_whole(r, t, px, how, lastX)               # one piece: the frozen close, to the bit
            return True
        xr = lastX or 1.0
        take = min(coins, r.left)
        r.parts.append((take, px, xr))
        r.left -= take
        if how == "taker":
            r.stopped = True
        if r.left > r.qty * 1e-12:
            return False
        sg = 1 if r.side == "bid" else -1
        pnl = sum((q * (x_ - r.entry) * sg) * xx for q, x_, xx in r.parts)
        qs = sum(q for q, _, _ in r.parts)
        trips.append({"book": B.book, "side": r.side, "k": r.k, "t_entry": r.t_e, "t_exit": t, "entry": round(r.entry, 6),
                      "exit": round(sum(q * x_ for q, x_, _ in r.parts) / qs, 8), "how": "taker" if r.stopped else "maker",
                      "notional_usd": r.nq * xr, "pnl_usd": pnl, "fill_ts": r.fill_ts, "fill_id": r.fill_id, "fill_kind": r.kind,
                      "entry_notional_usd": r.ent_usd, "qty": r.qty, "pieces": len(r.parts), "ticks": r.ticks, "join": r.join_info})
        r.mode, r.o, r.ghost = "idle", None, None
        return True

    def joined(o, ts):
        return o.J is not None and (ts > o.J or (o.incl and ts >= o.J))

    def eligible(o, ts):
        return o is not None and o.state == "live" and o.go is not None and o.go <= ts and (o.expire is None or ts <= o.expire)

    def fill_entry(r, o, ticks, coins, nq, t, i, ts, pid, kind, lastX, ghost):
        if ghost:
            r.ghost = None
            r.o = None                                           # its replacement is withdrawn at that instant
        open_pos(r, ticks, coins, nq, t, i, ts, pid, kind, lastX, o)

    def is_entry(r, o):
        return o.side == r.side

    def on_print(t, i, pr, lastX):
        ts, q, qty, aggr, pid = pr
        # 5. through: the frozen fill, joined or not, rung by rung (an old order before its replacement)
        for r in rungs:
            for ghost in (True, False):
                o = r.ghost if ghost else r.o
                if not eligible(o, ts):
                    continue
                if not P.through(o.side, o.price, q, thr):
                    continue
                if is_entry(r, o) and r.mode != "position":
                    if not lastX:
                        continue
                    usd = min(cfg.size, cfg.vs * B.qvol[i] * lastX)
                    if usd <= 0:
                        continue
                    nq = usd / lastX
                    fill_entry(r, o, o.price, nq / (o.price * TICK), nq, t, i, ts, pid, "through", lastX, ghost)
                elif not is_entry(r, o) and r.mode == "position":
                    if ghost:
                        r.ghost = None
                        r.o = None
                    if lay:
                        close_piece(r, t, o.price * TICK, r.left, "maker", lastX)
                    else:
                        close_whole(r, t, o.price * TICK, "maker", lastX)
                break
        if not lay:
            return
        # 3. and 7. at its price, on the taking side: the queue ahead first, the rule's own orders in join order
        side = "bid" if aggr == "sell" else "ask" if aggr == "buy" else None
        if side is None:
            return
        group = []
        for r in rungs:
            for ghost in (True, False):
                o = r.ghost if ghost else r.o
                if eligible(o, ts) and o.side == side and o.price == q and joined(o, ts) and (r.mode == "position") != is_entry(r, o):
                    group.append((o.J, o.placed, r.ri, r, o, ghost))
        if not group:
            return
        group.sort(key=lambda g: (g[0], g[1], g[2]))
        rems, As = [], []
        for _, _, _, r, o, ghost in group:
            apply_caps(o, ts)
            if is_entry(r, o):
                rems.append(cfg.size / lastX / (o.price * TICK) if lastX else 0.0)
            else:
                rems.append(r.left)
            As.append(o.A)
        fills, newA = queue_split(As, rems, qty)
        for j, (_, _, _, r, o, ghost) in enumerate(group):
            o.A = newA[j]
            if cfg.join == "optimistic" and o.incl:
                o.P += qty
        for j, (_, _, _, r, o, ghost) in enumerate(group):
            if fills[j] <= 0:
                continue
            if is_entry(r, o):
                if not lastX or r.mode == "position":
                    continue
                fill_entry(r, o, o.price, fills[j], fills[j] * o.price * TICK, t, i, ts, pid, "queue", lastX, ghost)
            elif r.mode == "position":
                if ghost:
                    r.ghost = None
                    r.o = None
                close_piece(r, t, o.price * TICK, fills[j], "maker", lastX)

    # -------------------------------------------------------------- the twin's position
    if inject is not None:
        side, ticks, usd, i0, fts = inject
        r = Rung(side, 0.0, 0)
        rungs.append(r)
        lx = B.lastX[i0] or 1.0
        open_pos(r, ticks, usd / lx / (ticks * TICK), usd / lx, B.t0 + i0 * M, i0, fts, None, "twin", lx, None)
        start_i = i0 + 1

    # -------------------------------------------------------------- the minutes
    i = start_i
    while i < n:
        if stop_when_flat and rungs and all(r.mode == "idle" for r in rungs):
            break
        t = B.t0 + i * M
        lastX = B.lastX[i]
        f = B.F[i]
        day = t // DAY
        lp_turn = None
        # 1. the turn at the start of minute t
        for r in rungs:
            if r.ghost is not None and r.ghost.expire is not None and r.ghost.expire < t:
                r.ghost = None
            if r.mode in ("idle", "quote"):
                o = r.o
                if f is None:
                    if r.mode == "quote":
                        remove(r, i)
                        r.mode, r.o = "idle", None
                    continue
                if no_entries:
                    continue
                if r.mode == "idle":
                    r.o = Order(r.side, entry_px(cfg, f, r.k, r.side), f, i + 1, i)
                    r.mode = "quote"
                    orders[day] += 1
                    continue
                if o.state == "rejected":
                    if moved(cfg, f, o.fair_at):
                        o.price, o.fair_at = entry_px(cfg, f, r.k, r.side), f
                    if lp_turn is None:
                        lp_turn = [B.last_before(t)]
                    if replace_ok(o, t, lp_turn[0]):
                        o.live, o.state, o.placed = i + 1, "pending", i
                        o.lose_place()
                        orders[day] += 1
                    continue
                if moved(cfg, f, o.fair_at):
                    if lag:
                        remove(r, i)
                        r.o = o = Order(r.side, o.price, o.fair_at, o.live, o.placed)
                    o.price, o.fair_at, o.live, o.state, o.placed = entry_px(cfg, f, r.k, r.side), f, i + 1, "pending", i
                    o.lose_place()
                    orders[day] += 1
            elif r.mode == "position":
                o = r.o
                xs = "ask" if r.side == "bid" else "bid"
                if o is None:
                    if f is not None:
                        r.o = Order(xs, exit_px(cfg, f, r.side), f, i + 1, i)
                        orders[day] += 1
                elif o.state == "rejected":
                    if f is not None and moved(cfg, f, o.fair_at):
                        o.price, o.fair_at = exit_px(cfg, f, r.side), f
                    if lp_turn is None:
                        lp_turn = [B.last_before(t)]
                    if replace_ok(o, t, lp_turn[0]):
                        o.live, o.state, o.placed = i + 1, "pending", i
                        o.lose_place()
                        orders[day] += 1
                elif f is not None and moved(cfg, f, o.fair_at):
                    if lag:
                        remove(r, i)
                        r.o = o = Order(o.side, o.price, o.fair_at, o.live, o.placed)
                    o.price, o.fair_at, o.live, o.state, o.placed = exit_px(cfg, f, r.side), f, i + 1, "pending", i
                    o.lose_place()
                    orders[day] += 1
        # 2. go-live at the start of minute t (with a live lag, inside the minute, among its prints)
        events = []
        for r in rungs:
            for o in (r.ghost, r.o):
                if o is not None and o.state == "pending" and o.live == i:
                    if lag:
                        events.append((t + lag, 0, r.ri, o))
                    else:
                        golive(o, t)
        # 3. the prints of minute t
        ps = B.by_min.get(i)
        if events:
            evs = sorted(events, key=lambda e: (e[0], e[1], e[2])) + [(p[0], 1, k, p) for k, p in enumerate(ps or ())]
            evs.sort(key=lambda e: (e[0], e[1], e[2]))
            for ev in evs:
                if ev[1] == 0:
                    golive(ev[3], ev[0])
                else:
                    on_print(t, i, ev[3], lastX)
        elif ps:
            for pr in ps:
                on_print(t, i, pr, lastX)
        # 4. the 24-hour stop (and the end of the data); a position entered this minute is not checked
        for r in rungs:
            if r.mode == "position" and r.i_e != i and (t >= r.t_e + 1440 * M or i == n - 1):
                c = B.last_at_or_before(t + M - 1) * TICK
                px = c * (1 - taker) if r.side == "bid" else c * (1 + taker)
                if lay:
                    close_piece(r, t, px, r.left, "taker", lastX)
                else:
                    close_whole(r, t, px, "taker", lastX)
        # the next minute in which something can happen: a print, a change of fair, a due stop, or anything unsettled
        i = next_minute(B, rungs, i, n) if skip else i + 1
    return trips, orders


def next_minute(B, rungs, i, n):
    """After minute i, the next minute whose step can change anything. Every other minute's turn finds each order resting
    at a fair it was priced at (or dark and nothing to quote), no order to send or check, no print and no stop, so
    `simulate()` would do nothing in it; skipping them leaves the run identical (check 2 runs both ways, `skip=False`
    turning every minute)."""
    nxt = i + 1
    if nxt >= n:
        return n
    for r in rungs:
        if r.ghost is not None:
            return nxt
        o = r.o
        if r.mode == "idle":
            if B.F[nxt] is not None:
                return nxt
            continue
        if o is None:
            if r.mode == "position" and B.F[nxt] is not None:
                return nxt
            continue
        if o.state != "live":
            return nxt
    cand = n - 1
    j = bisect.bisect_left(B.print_minutes, nxt)
    if j < len(B.print_minutes):
        cand = min(cand, B.print_minutes[j])
    j = bisect.bisect_left(B.f_change, nxt)
    if j < len(B.f_change):
        cand = min(cand, B.f_change[j])
    for r in rungs:
        if r.mode == "position":
            cand = min(cand, max(nxt, (r.t_e + 1440 * M - B.t0 + M - 1) // M))
    return max(nxt, cand)
