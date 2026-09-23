"""PR5 — PR3's rule on Revolut X's USDC/GBP and USDT/GBP books, fills read from the public trade tape.
Pre-registered in prereg_pr5_revx_gbp_stable_long.md (sha256 in .sha256, UTC time in .frozen_at).

Conventions (PR3's): the loop acts at the start of minute t on data up to t-1; an order placed at t is live from t+1.
A fill in minute m is seen at the turn of m+1, so the exit is placed at m+1 and live from m+2.

What the tape changes (each stated in the pre-registration):
* A resting bid at p fills only on a print strictly below p (an ask: strictly above) whose timestamp is at or after the
  start of the order's live minute. Fill at p.
* Size min($100, 10 % of the quote volume printed in that minute, GBP -> USD at X).
* Post-only: when an order goes live, the last print before that instant decides whether the market was already through
  it (bid: last < p, or last == p and it was a BUY, i.e. the ask sat at p; ask: mirror). Such an order is rejected and
  cannot fill; the loop re-places it at the first turn whose last print is no longer through its (current) price, and
  it goes live the minute after, checked again. Applies to entries and exits.
* The 24-hour taker stop closes at the last print at or before the end of that minute, minus/plus fee and half-spread.
usage: pr5_sim.py OUT.json
"""
import gzip, json, os, sys, bisect, random, statistics as st, datetime, math, collections

# Inputs: the committed copy (docs/agents/backtests/inputs/pr5_2026-09-23), gzipped, or PR5_DATA = the research folder.
S = os.environ.get("PR5_DATA") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../backtests/inputs/pr5_2026-09-23")
_LAYOUT = {"data/trades/": "trades/", "data/fx/": "fx/", "data/candles/": "candles/"}


def _open(path):
    """A research-folder path, as fetched or as committed (the committed copy drops `data/` and is gzipped)."""
    if os.path.exists(path):
        return open(path)
    rel = os.path.relpath(path, S).replace(os.sep, "/")
    for a, b in _LAYOUT.items():
        if rel.startswith(a):
            rel = b + rel[len(a):]
    return gzip.open(os.path.join(S, rel) + ".gz", "rt")
M = 60000
TICK = 1e-4
FEE = 0.0009
HALF_SPREAD = 0.000067
RUNGS = [0.001, 0.002, 0.003]
REPRICE = 0.0005
BOOKS = ["USDC-GBP", "USDT-GBP"]
USD_OF = {"USDC-GBP": "USDC-USD", "USDT-GBP": "USDT-USD"}


def ms(s):
    return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


START = {"USDC-GBP": ms("2025-11-26T00:00"), "USDT-GBP": ms("2025-12-16T00:00")}   # the listing dates (candle volume begins)
PRIM_END = ms("2026-08-26T00:00")
PR3_0, PR3_MID, END = ms("2026-08-26T00:00"), ms("2026-09-09T18:00"), ms("2026-09-23T00:00")
if os.environ.get("PR5_DRYRUN"):
    # the pre-freeze dry run: the whole pipeline on data PR3 already saw only (its IS half as the "primary")
    START = {"USDC-GBP": PR3_0, "USDT-GBP": PR3_0}
    PRIM_END = PR3_MID
CFG = json.load(_open(os.path.join(S, "config.json")))     # {"fair_proxy": "F1"|"F2"|"F3", "fx": "EXN"} — frozen with the prereg


# ---------------------------------------------------------------- inputs
def load_prints(sym):
    out = []
    for l in _open(os.path.join(S, "data", "trades", f"{sym}.jsonl")):
        r = json.loads(l)
        if r["region"] != "UK":
            continue
        pt = round(float(r["price"]) / TICK)
        assert abs(pt * TICK - float(r["price"])) < 1e-9, r
        out.append((r["ts"], pt, float(r["qty"]), r["side"]))
    out.sort(key=lambda x: x[0])
    return out


def fx_series():
    ser = json.load(_open(os.path.join(S, "data", "fx", f"series_{CFG['fx']}.json")))
    return {t: v for t, v in ser}


def fair_usd_minutes(sym, t0, t1):
    """fairU for every minute start t in [t0, t1): the chosen proxy of PR3's 24-hour median of the USD book."""
    proxy = CFG["fair_proxy"]
    out = {}
    if proxy == "F3":
        hours = json.load(_open(os.path.join(S, "data", "candles", f"{sym}_60.json")))["rows"]
        ht = [int(h["start"]) for h in hours]; hc = [float(h["close"]) for h in hours]
        cache = {}
        for t in range(t0, t1, M):
            i, j = bisect.bisect_left(ht, t - 1440 * M), bisect.bisect_right(ht, t - 60 * M)
            if (i, j) not in cache:
                cache[(i, j)] = st.median(hc[i:j]) if j > i else None
            out[t] = cache[(i, j)]
        return out
    pr = [(ts, pt * TICK) for ts, pt, q, s in load_prints(sym)]
    pt_ = [a for a, _ in pr]; pv = [b for _, b in pr]
    if proxy == "F1":
        win = []
        i = j = 0
        for t in range(t0, t1, M):
            while j < len(pr) and pt_[j] < t:
                bisect.insort(win, pv[j]); j += 1
            while i < j and pt_[i] < t - 1440 * M:
                win.pop(bisect.bisect_left(win, pv[i])); i += 1
            out[t] = st.median(win) if win else None
        return out
    if proxy == "F2":
        # forward-filled last print per minute, median of the last 1,440 minute values
        g0 = t0 - 1440 * M
        k, last, ff = 0, None, []
        for m in range(g0, t1, M):
            while k < len(pr) and pt_[k] < m + M:
                last = pv[k]; k += 1
            ff.append(last)
        win, dq = [], collections.deque()
        for idx, t in enumerate(range(t0, t1, M)):
            gi = idx + 1440          # ff index of minute t; the window is ff[gi-1440 : gi]
            if idx == 0:
                for v in ff[0:1440]:
                    dq.append(v)
                    if v is not None: bisect.insort(win, v)
            else:
                v = ff[gi - 1]; dq.append(v)
                if v is not None: bisect.insort(win, v)
                old = dq.popleft()
                if old is not None: win.pop(bisect.bisect_left(win, old))
            out[t] = st.median(win) if win else None
        return out
    raise ValueError(proxy)


class Book:
    """Everything the simulation reads for one GBP book, indexed by minute."""
    def __init__(self, book, t0, t1, fxmap):
        self.book = book
        self.t0, self.t1 = t0, t1
        self.n = (t1 - t0) // M
        pr = load_prints(book)
        self.all_prints = pr
        self.pts = [p[0] for p in pr]
        # prints grouped by minute index (only minutes inside [t0, t1))
        self.by_min = collections.defaultdict(list)
        for p in pr:
            if t0 <= p[0] < t1:
                self.by_min[(p[0] - t0) // M].append(p)
        # minute quote volume in GBP
        self.qvol = {i: sum(q * pt * TICK for ts, pt, q, s in ps) for i, ps in self.by_min.items()}
        fu = fair_usd_minutes(USD_OF[book], t0, t1)
        self.X = [None] * self.n
        self.F = [None] * self.n
        fxt = sorted(fxmap)
        for i in range(self.n):
            t = t0 + i * M
            # X(t): the latest FX minute close whose minute started in [t-10, t-1]
            k = bisect.bisect_right(fxt, t - M) - 1
            x = fxmap[fxt[k]] if k >= 0 and fxt[k] >= t - 10 * M else None
            self.X[i] = x
            u = fu.get(t)
            self.F[i] = (u / x) if (x and u) else None

    def last_before(self, t_ms):
        """(price_ticks, side) of the last print strictly before t_ms, or None."""
        k = bisect.bisect_left(self.pts, t_ms) - 1
        if k < 0:
            return None
        return self.all_prints[k][1], self.all_prints[k][3]

    def last_at_or_before(self, t_ms):
        k = bisect.bisect_right(self.pts, t_ms) - 1
        return self.all_prints[k][1] if k >= 0 else None


def blocks(side, price, lp):
    """Is the market through a post-only order of `side` at `price`, given the last print lp=(ticks, aggressor side)?"""
    if lp is None:
        return False
    q, s = lp
    if side == "bid":
        return q < price or (q == price and s == "buy")
    return q > price or (q == price and s == "sell")


def through(side, price, q, thr):
    return q < price - thr if side == "bid" else q > price + thr


def rt(f, k, side):
    if side == "bid":
        return math.floor(f * (1 - k) / TICK + 1e-9)
    return math.ceil(f * (1 + k) / TICK - 1e-9)


def rt_exit(f, pos_side):
    # a long (from a bid) exits with an ask rounded up; a short (from an ask) with a bid rounded down
    return math.ceil(f / TICK - 1e-9) if pos_side == "bid" else math.floor(f / TICK + 1e-9)


class Order:
    __slots__ = ("side", "price", "fair_at", "live", "state")
    # state: "pending" (placed, not yet live), "live", "rejected" (post-only refused; waiting for the market to leave)

    def __init__(self, side, price, fair_at, live):
        self.side, self.price, self.fair_at, self.live, self.state = side, price, fair_at, live, "pending"


def simulate(B, size=100.0, stress=False, side_aware=False, no_block=False, full=False, collect_orders=None):
    thr = 1 if stress else 0
    taker = (2 * FEE + 2 * HALF_SPREAD) if stress else (FEE + HALF_SPREAD)
    rungs = [{"side": s, "k": k, "mode": "idle", "o": None} for s in ("bid", "ask") for k in RUNGS]
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
        # ---- 1. the turn at the start of minute t (data up to t-1)
        for r in rungs:
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
                    if abs(f / o.fair_at - 1) > REPRICE:
                        o.price, o.fair_at = rt(f, r["k"], r["side"]), f          # new target; nothing placed yet
                    if lp_turn is None: lp_turn = [B.last_before(t)]
                    if not blocks(o.side, o.price, lp_turn[0]):
                        o.live, o.state = i + 1, "pending"; orders_by_day[day] += 1
                    continue
                if abs(f / o.fair_at - 1) > REPRICE:
                    o.price, o.fair_at, o.live, o.state = rt(f, r["k"], r["side"]), f, i + 1, "pending"
                    orders_by_day[day] += 1
            elif r["mode"] == "position":
                o = r["o"]           # the exit order (None until a fair exists)
                xs = "ask" if r["side"] == "bid" else "bid"
                if o is None:
                    if f is not None:
                        r["o"] = Order(xs, rt_exit(f, r["side"]), f, i + 1); orders_by_day[day] += 1
                elif o.state == "rejected":
                    if f is not None and abs(f / o.fair_at - 1) > REPRICE:
                        o.price, o.fair_at = rt_exit(f, r["side"]), f
                    if lp_turn is None: lp_turn = [B.last_before(t)]
                    if not blocks(o.side, o.price, lp_turn[0]):
                        o.live, o.state = i + 1, "pending"; orders_by_day[day] += 1
                elif f is not None and abs(f / o.fair_at - 1) > REPRICE:
                    o.price, o.fair_at, o.live, o.state = rt_exit(f, r["side"]), f, i + 1, "pending"
                    orders_by_day[day] += 1
        # ---- 2. go-live checks at the start of minute t
        lp_live = None
        for r in rungs:
            o = r["o"]
            if o is not None and o.state == "pending" and o.live == i:
                if no_block:
                    o.state = "live"
                else:
                    if lp_live is None: lp_live = [B.last_before(t)]
                    o.state = "rejected" if blocks(o.side, o.price, lp_live[0]) else "live"
        # ---- 3. prints during minute t
        ps = B.by_min.get(i)
        if ps:
            for ts, q, qty, aggr in ps:
                for r in rungs:
                    o = r["o"]
                    if o is None or o.state != "live":
                        continue
                    if not through(o.side, o.price, q, thr):
                        continue
                    if side_aware and ((o.side == "bid" and aggr != "sell") or (o.side == "ask" and aggr != "buy")):
                        continue
                    if r["mode"] == "quote":
                        if not lastX:
                            continue
                        usd = size if full else min(size, 0.10 * B.qvol[i] * lastX)
                        if usd <= 0:
                            continue
                        nq = usd / lastX
                        p = o.price * TICK
                        r.update(mode="position", o=None, entry=p, t_e=t, i_e=i, qty=nq / p, nq=nq, fill_ts=ts)
                    elif r["mode"] == "position":
                        px = o.price * TICK
                        _close(r, trips, B.book, t, px, "maker", lastX)
        # ---- 4. 24-hour taker stop (and the end of the data); a position entered this minute is not checked (PR3)
        for r in rungs:
            if r["mode"] == "position" and r["i_e"] != i and (t >= r["t_e"] + 1440 * M or i == n - 1):
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


# ---------------------------------------------------------------- the random-time twin (PR3's null)
def exit_only(B, i0, side, usd, lastX0):
    """Enter at the last print of minute i0 (a traded minute), then the same exit machinery as the rule."""
    t0 = B.t0 + i0 * M
    c0 = B.by_min[i0][-1][1] * TICK
    lastX = lastX0
    nq = usd / lastX; qty = nq / c0
    xs = "ask" if side == "bid" else "bid"
    o = None
    taker = FEE + HALF_SPREAD
    for i in range(i0 + 1, B.n):
        t = B.t0 + i * M
        x = B.X[i]
        if x: lastX = x
        f = B.F[i]
        if o is None:
            if f is not None:
                o = Order(xs, rt_exit(f, side), f, i + 1)
        elif o.state == "rejected":
            if f is not None and abs(f / o.fair_at - 1) > REPRICE:
                o.price, o.fair_at = rt_exit(f, side), f
            if not blocks(o.side, o.price, B.last_before(t)):
                o.live, o.state = i + 1, "pending"
        elif f is not None and abs(f / o.fair_at - 1) > REPRICE:
            o.price, o.fair_at, o.live, o.state = rt_exit(f, side), f, i + 1, "pending"
        if o is not None and o.state == "pending" and o.live == i:
            o.state = "rejected" if blocks(o.side, o.price, B.last_before(t)) else "live"
        done = None
        if o is not None and o.state == "live":
            for ts, q, qty_, aggr in B.by_min.get(i, ()):
                if through(o.side, o.price, q, 0):
                    done = o.price * TICK
                    break
        if done is None and (t >= t0 + 1440 * M or i == B.n - 1):
            c = B.last_at_or_before(t + M - 1) * TICK
            done = c * (1 - taker) if side == "bid" else c * (1 + taker)
        if done is not None:
            pnl_q = qty * (done - c0) if side == "bid" else qty * (c0 - done)
            return pnl_q * lastX
    return 0.0


# ---------------------------------------------------------------- summaries
def summarize(trips, t0, t1, cap, days):
    sel = [x for x in trips if t0 <= x["t_entry"] < t1]
    tot = sum(x["pnl_usd"] for x in sel)
    cum = peak = mdd = 0.0
    for x in sorted(sel, key=lambda z: (z["t_exit"], z["t_entry"], z["book"], z["side"], z["k"])):
        cum += x["pnl_usd"]; peak = max(peak, cum); mdd = max(mdd, peak - cum)
    hold = sorted((x["t_exit"] - x["t_entry"]) / M for x in sel)
    return {"trips": len(sel), "pnl_usd": round(tot, 4), "return_on_capital_pct": round(100 * tot / cap, 4) if cap else None,
            "win_rate": round(sum(1 for x in sel if x["pnl_usd"] > 0) / len(sel), 4) if sel else None,
            "worst_trip_usd": round(min((x["pnl_usd"] for x in sel), default=0), 4),
            "best_trip_usd": round(max((x["pnl_usd"] for x in sel), default=0), 4),
            "max_drawdown_usd": round(mdd, 4), "taker_exits": sum(1 for x in sel if x["how"] == "taker"),
            "taker_exit_pnl_usd": round(sum(x["pnl_usd"] for x in sel if x["how"] == "taker"), 4),
            "fill_notional_usd": round(sum(x["notional_usd"] for x in sel), 2),
            "fill_notional_usd_per_day": round(sum(x["notional_usd"] for x in sel) / days, 2) if days else None,
            "pnl_usd_per_day": round(tot / days, 4) if days else None,
            "median_hold_min": hold[len(hold) // 2] if hold else None}


def month_of(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m")


def run_all(books_full, books_pr3, size=100.0, **kw):
    trips, orders = [], collections.Counter()
    for b in BOOKS:
        tr, od = simulate(books_full[b], size=size, **kw)
        trips += tr; orders.update(od)
    trips3, orders3 = [], collections.Counter()
    for b in BOOKS:
        tr, od = simulate(books_pr3[b], size=size, **kw)
        trips3 += tr; orders3.update(od)
    return trips, orders, trips3, orders3


def prim_sel(trips):
    return [x for x in trips if START[x["book"]] <= x["t_entry"] < PRIM_END]


def main():
    out_fn = sys.argv[1]
    fxmap = fx_series()
    full = {b: Book(b, START[b], END, fxmap) for b in BOOKS}
    pr3 = {b: Book(b, PR3_0, END, fxmap) for b in BOOKS}
    days_b = {b: (PRIM_END - START[b]) / 86400000 for b in BOOKS}
    cap_years = sum(600.0 * d / 365.0 for d in days_b.values())
    prim_days = max(days_b.values())
    R = {"prereg": "prereg_pr5_revx_gbp_stable_long.md", "config": CFG, "capital_usd": 1200.0,
         "primary_window": {b: [datetime.datetime.fromtimestamp(START[b] / 1000, datetime.timezone.utc).isoformat(),
                                datetime.datetime.fromtimestamp(PRIM_END / 1000, datetime.timezone.utc).isoformat()] for b in BOOKS},
         "primary_days_by_book": {b: round(d, 3) for b, d in days_b.items()}, "capital_years_usd": round(cap_years, 3)}
    # coverage diagnostics
    R["coverage"] = {b: {"minutes": full[b].n, "minutes_with_fx": sum(1 for x in full[b].X if x),
                         "minutes_with_fair": sum(1 for x in full[b].F if x),
                         "minutes_with_prints": len(full[b].by_min)} for b in BOOKS}
    arms = {"primary": {}, "stress": {"stress": True}, "side_aware_fills": {"side_aware": True},
            "no_post_only_block": {"no_block": True}, "full_100_fills": {"full": True}}
    for name, kw in arms.items():
        trips, orders, trips3, orders3 = run_all(full, pr3, **kw)
        A = {"PRIMARY": summarize(prim_sel(trips), 0, 10**15, 1200.0, prim_days)}
        A["PR3_period_all_28d"] = summarize(trips3, PR3_0, END, 1200.0, (END - PR3_0) / 86400000)
        A["PR3_period_IS"] = summarize(trips3, PR3_0, PR3_MID, 1200.0, (PR3_MID - PR3_0) / 86400000)
        A["PR3_period_OOS"] = summarize(trips3, PR3_MID, END, 1200.0, (END - PR3_MID) / 86400000)
        od = [orders[d] for d in sorted(orders)]
        A["orders_per_day_mean"] = round(sum(orders.values()) / ((END - min(START.values())) / 86400000), 1)
        A["orders_per_day_max"] = max(od) if od else 0
        if name == "primary":
            prim_trips = trips
            P = prim_sel(trips)
            A["PRIMARY_by_book"] = {b: summarize([x for x in P if x["book"] == b], 0, 10**15, 600.0, days_b[b]) for b in BOOKS}
            A["PRIMARY_by_rung"] = {f"k={k*100:g}%": summarize([x for x in P if x["k"] == k], 0, 10**15, 400.0, prim_days) for k in RUNGS}
            A["PRIMARY_by_side"] = {s: summarize([x for x in P if x["side"] == s], 0, 10**15, 600.0, prim_days) for s in ("bid", "ask")}
            months = sorted({month_of(t) for b in BOOKS for t in range(START[b], PRIM_END, 86400000)})
            A["PRIMARY_by_month"] = {m: summarize([x for x in P if month_of(x["t_entry"]) == m], 0, 10**15, None, None) for m in months}
            A["PR3_period_by_month"] = {m: summarize([x for x in trips3 if month_of(x["t_entry"]) == m], PR3_0, END, None, None)
                                        for m in sorted({month_of(x["t_entry"]) for x in trips3})}
            A["PR3_period_by_book"] = {b: summarize([x for x in trips3 if x["book"] == b], PR3_0, END, 600.0, 28.0) for b in BOOKS}
        if name == "stress":
            stress_trips = trips
        R[name] = A
    # capacity: bigger rungs, same 10 % cap
    R["capacity"] = {}
    for size in (300.0, 1000.0, 3000.0):
        trips, orders, _, _ = run_all(full, pr3, size=size)
        P = prim_sel(trips)
        s = summarize(P, 0, 10**15, 12 * size, prim_days)
        s["return_per_year_on_locked_pct"] = round(100 * s["pnl_usd"] / (sum(2 * 3 * size * d / 365.0 for d in days_b.values())), 3)
        R["capacity"][f"rung_{int(size)}"] = s
    # ---- the null: random-time twins of every PRIMARY round trip
    P = sorted(prim_sel(prim_trips), key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"]))
    pools = {}
    for b in BOOKS:
        Bk = full[b]
        pools[b] = [i for i in sorted(Bk.by_min) if Bk.t0 + i * M < PRIM_END and Bk.X[i]]
    rng = random.Random(20260923)
    cache, draws = {}, []
    for d in range(2000):
        tot = 0.0
        for x in P:
            b = x["book"]
            i = pools[b][rng.randrange(len(pools[b]))]
            key = (b, i, x["side"])
            if key not in cache:
                Bk = full[b]
                usd = min(100.0, 0.10 * Bk.qvol[i] * Bk.X[i])
                cache[key] = exit_only(Bk, i, x["side"], usd, Bk.X[i]) if usd > 0 else 0.0
            tot += cache[key]
        draws.append(tot)
    draws.sort()
    p95 = draws[int(0.95 * (len(draws) - 1))]
    prim = R["primary"]["PRIMARY"]["pnl_usd"]
    R["null_random_time"] = {"draws": len(draws), "seed": 20260923, "mean": round(st.mean(draws), 4), "p50": round(draws[1000], 4),
                             "p95": round(p95, 4), "max": round(draws[-1], 4),
                             "share_draws_ge_primary": round(sum(1 for x in draws if x >= prim) / len(draws), 4),
                             "distinct_twins_simulated": len(cache)}
    # ---- the bar
    bym = R["primary"]["PRIMARY_by_month"]
    pos_months = sum(1 for m in bym.values() if m["pnl_usd"] > 0)
    tot = prim
    max_share = max((m["pnl_usd"] / tot for m in bym.values()), default=0) if tot > 0 else None
    R["bar"] = {"1_pnl_gt_0": prim > 0, "2_pnl_gt_null_p95": prim > p95, "3_stress_gt_0": R["stress"]["PRIMARY"]["pnl_usd"] > 0,
                "4_at_least_60_round_trips": R["primary"]["PRIMARY"]["trips"] >= 60,
                "5_positive_in_two_thirds_of_months": pos_months * 3 >= 2 * len(bym),
                "6_no_month_over_40pct": (max_share is not None and max_share <= 0.40)}
    R["bar"]["PASS"] = all(R["bar"].values())
    R["bar_detail"] = {"months": len(bym), "positive_months": pos_months, "max_month_share": round(max_share, 4) if max_share is not None else None}
    # reported, not part of the bar
    R["economics"] = {"pnl_per_capital_year_pct": round(100 * prim / cap_years, 3), "cash_rate_pct": 4.0,
                      "orders_per_day_mean": R["primary"]["orders_per_day_mean"], "orders_per_day_max": R["primary"]["orders_per_day_max"],
                      "order_budget_per_day": 1000}
    R["primary_trips"] = [{k: (round(v, 6) if isinstance(v, float) else v) for k, v in x.items()} for x in P]
    json.dump(R, open(out_fn, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
