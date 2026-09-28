"""Pins for what the fast-X study adds (fastx.py, fastx_sim.py). Each check also runs a deliberately broken version and
requires it to FAIL, so a check that cannot fail is not counted.

(a) fastx_sim with neither addition in use is the frozen engine: trip for trip, POST for POST, on three committed days,
    at 1 s turns with four keys and at the frozen minute; broken (the rule path's step 1 % wider), it differs.
(b) a minute series read through XS/FastMkt is the frozen Mkt's X at every instant tried; read 1 s later, it is not.
(c) a W-second bar is the bar's LAST tick, readable `lag` after the bar ends; the first tick, or readable at the bar's
    end, fail.
(d) the tick series asked at whole seconds equals a brute-force "latest tick at least L old" over real ticks; keeping
    the first tick of a second instead of the last fails.
(e) a stale fill is an entry bid above (ask below) the tick-level fair; a fill on the right side of fair is not.
(f) the re-price rules move the right quotes: a 0.04 % fall re-prices a 0.03 % bid and not a 0.30 % bid under D, both
    under A; a 0.04 % rise re-prices neither under A and both under the frozen step; toward and away swapped fails.
(g) keys per rung: with 3 bids on 2 keys and entries withdrawn at 2 POSTs a key, 3 are placed (2 on one key would
    place 2), and every POST carries its rung's key.
(h) keys needed reads POSTs day by day: two rungs of 500 a day on different days share one key under 600; a version
    that adds each rung's busiest day needs two.
(i) the mask: a fast X is dark wherever the study's own X is dark, and its changes are turns; without the mask it fails.
(j) the live lag measure finds a source polled each second that shows a reference 2.5 s late (polling included), and
    does not find it in one that is not late.
(k) the ceiling fills a print through two rungs $100 each at the rungs' distances and the free bound 10 % of the minute
    one tick inside the print; without the $100 or with a 100 % cap it differs. step_events and reach_600 on known series.
usage: test_fastx.py [OUT.txt]
"""
import os, random, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fastx as FX  # noqa: E402

FS, V, P, S = FX.FS, FX.V, FX.P, FX.S
M, H, DAY = FX.M, FX.H, FX.DAY
lines = []


def say(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    lines.append(s)


def fails(fn):
    try:
        fn()
    except AssertionError:
        return True
    return False


# ---------------------------------------------------------------------------------------------- (a)
R = S.Runner()
mk = V.committed_markets()
a0, a1 = P.ms("2026-09-01T00:00"), P.ms("2026-09-04T00:00")


def engine_pair(kw, broken=False):
    cfg = V.default_cfg(**kw)
    old = V.simulate([mk[b] for b in P.BOOKS], cfg, a0, a1)
    saved = FS.NS["_moved"], FS.NS["_steps"]
    if broken:                                            # the frozen expression replaced by a 1 % wider step
        FS.NS["_moved"] = lambda rule, R_, r, fa, f: abs(f / fa - 1) > R_ * 1.01
        FS.NS["_steps"] = lambda rule, R_, r: (R_ * 1.01, R_ * 1.01)
    try:
        new = FS.simulate([mk[b] for b in P.BOOKS], cfg, a0, a1)
    finally:
        FS.NS["_moved"], FS.NS["_steps"] = saved
    return FX.same_run(new, old)


REC = dict(rungs=FX.NINE, reprice=0.0003, cap="shared", gov=FX.GOV, acct=lambda b, s: f"{b}/{s}", **FX.LIVE1)
FRZ = dict(cap="per_rung")
for name, kw in (("recommended 1 s, 4 keys", REC), ("frozen as it runs", FRZ)):
    e = engine_pair(kw)
    assert e["trips_identical"] and e["posts_identical"] and e["trips"][0] > 5, e
    eb = engine_pair(kw, broken=True)
    assert not (eb["trips_identical"] and eb["posts_identical"]), eb
    say("(a)", name, "identical:", e["trips"], "trips,", e["posts"][0], "POSTs; broken engine differs")

# ---------------------------------------------------------------------------------------------- (b)
exn = sorted(P.fx_series().items())
rng = random.Random(11)
book = mk["USDT-GBP"]


def check_minute(lag_series, lag_frozen):
    fm = FX.FastMkt(book.book, book.prints, list(zip(book.hs, book.hc)), FX.minute_series("x", exn, lag_series))
    for _ in range(20000):
        tau = rng.randrange(a0, a1)
        assert fm.X(tau, 0) == book.X(tau, lag_frozen), tau
    for t in range(a0, a0 + 3 * H, 1000):                 # every whole second of three hours, and the instants
        assert fm.X(t, 0) == book.X(t, lag_frozen), t
    fr = sorted(set(book.change_instants(lag_frozen, a0, a1)))
    nw = sorted(set(fm.change_instants(0, a0, a1)))
    assert fr == nw


check_minute(5000, 5000)
assert fails(lambda: check_minute(6000, 5000))
say("(b) minute series through XS == frozen Mkt.X at 20,000 random instants and every second of 3 h; lag 6 s vs 5 s fails")

# ---------------------------------------------------------------------------------------------- (c)
ts = np.array([200, 900, 1100], dtype=np.int64)
md = np.array([1.30000, 1.30010, 1.30020])


def check_bars(build):
    xs = build(ts, md)
    assert xs.x(1999) is None                             # bar [0, 1 s) is readable from 2 s (its end + 1 s)
    assert xs.x(2000) == 1.30010 and xs.x(2999) == 1.30010  # its LAST tick
    assert xs.x(3000) == 1.30020                          # bar [1 s, 2 s), readable from 3 s
    assert xs.x(10 * M + 2000) == 1.30020                 # dark 10 minutes after the bar began (+ the read lag)
    assert xs.x(10 * M + 2001) is None


check_bars(lambda t, m: FX.bar_series("b1", t, m, 1000, 1000))
first_tick = lambda t, m: FX.XS("bad", [2000, 3000], [10 * M + 1000, 10 * M + 2000], [1.30000, 1.30020], True)  # noqa: E731
at_end = lambda t, m: FX.XS("bad", [1000, 2000], [10 * M + 1000, 10 * M + 2000], [1.30010, 1.30020], True)  # noqa: E731
assert fails(lambda: check_bars(first_tick)) and fails(lambda: check_bars(at_end))
say("(c) bars: the last tick, readable lag after the bar ends; first-tick and readable-at-end versions fail")

# ---------------------------------------------------------------------------------------------- (d)
tick_dir = FX.TICKS_DIR
h0 = P.ms("2026-08-26T12:00")
tk = FX.load_ticks(tick_dir, h0, h0 + 2 * H)
assert len(tk["ts"]) > 1000, "Dukascopy hours 2026-08-26 12-13h are needed for (d)"


def brute(tsa, mda, lag, tau):
    i = int(np.searchsorted(tsa, tau - lag, side="right")) - 1
    return float(mda[i]) if i >= 0 and tsa[i] >= tau - lag - 10 * M else None


def check_ticks(build, lag):
    xs = build(tk["ts"], tk["mid"], lag)
    for tau in range(h0, h0 + 2 * H, 1000):
        assert xs.x(tau) == brute(tk["ts"], tk["mid"], lag, tau), tau


for lag in (250, 1000):
    check_ticks(lambda t, m, L: FX.tick_series("t", t, m, L), lag)


def keep_first(t, m, lag):
    av = t + lag
    sec = -(-av // 1000) * 1000
    first = np.r_[True, sec[1:] != sec[:-1]]
    return FX.XS("bad", sec[first], (t + 10 * M + lag)[first], m[first], True)


assert fails(lambda: check_ticks(keep_first, 250))
say("(d) tick series == brute force at every whole second of 2 h (L = 0.25 s and 1 s,", len(tk["ts"]), "ticks); first-of-second fails")

# ---------------------------------------------------------------------------------------------- (e)
class _TF:
    def x_at(self, t):
        return 1.25


class _MK:
    def fairU(self, t):
        return 0.74 * 1.25


base = {"t_entry": 0, "fill_ts": 5, "book": "B", "k": 0.001, "notional_usd": 100.0}
trip_bad = dict(base, side="bid", entry=0.7401, pnl_usd=-0.02)
trip_ok = dict(base, side="bid", entry=0.7398, pnl_usd=0.03)
trip_ask = dict(base, side="ask", entry=0.7399, pnl_usd=-0.01)
st = FX.stale_fills([trip_bad, trip_ok, trip_ask], {"B": _MK()}, _TF(), 0, 10)
assert st["stale_fills"] == 2 and abs(st["stale_fill_pnl_usd"] + 0.03) < 1e-12, st
# the bid at 0.7398 is 2.70 bps under fair 0.74 where its rung is 10 bps: 7.30 bps short, $0.073 on $100
assert abs(st["mean_shortfall_vs_rung_bps"] - (10 - (0.74 - 0.7401) / 0.74 * 1e4 + 10 - (0.74 - 0.7398) / 0.74 * 1e4 + 10 - (0.7399 - 0.74) / 0.74 * 1e4) / 3) < 1e-6
say("(e) stale fills: a bid above fair and an ask below it counted, a bid below fair not:", st)

# ---------------------------------------------------------------------------------------------- (f)
def fake(fx, t_end=40 * M):
    hours = [(t, 0.74 * 1.25) for t in range(-2 * DAY, t_end, H)]
    return V.Mkt("USDC-GBP", [(-30000, 7400, 1.0, "buy")], fx, hours)


def reprices(rule, move, rungs=(0.0003, 0.003)):
    """Fair moves by `move` (a fraction; X falls to raise fair) at minute 10: which bids are re-priced?"""
    fx = [(t, 1.25 if t < 9 * M else 1.25 / (1 + move)) for t in range(-20 * M, 60 * M, M)]
    cfg = V.default_cfg(rungs={"bid": list(rungs), "ask": []}, reprice=0.0003, rule=rule, s_ms=1000, delta_ms=1000,
                        cancel_ms=1000, lagx_ms=5000, phase_ms=5000)
    r = FS.simulate([fake(fx)], cfg, 0, 30 * M)
    return sorted({p[5] for p in r["posts"] if p[3] == "reprice"})


D_, A_ = FX.RULES["D"], FX.RULES["A"]
assert reprices(D_, -0.0004) == [0.0003]                  # down 0.04 %: toward the bids; D keeps the 0.30 % bid
assert reprices(A_, -0.0004) == [0.0003, 0.003]           # A re-prices every bid on a move toward it
assert reprices(A_, +0.0004) == []                        # away by 0.04 % < 0.10 %: nothing
assert reprices(None, +0.0004) == [0.0003, 0.003]         # the frozen step: both
assert reprices(A_, +0.0011) == [0.0003, 0.003]           # away by more than 0.10 %: both


def swapped():
    saved = FS.NS["_steps"]

    def bad(rule, R_, r):
        a, b = saved(rule, R_, r)
        return b, a
    FS.NS["_steps"] = FS._steps = bad                     # the engine's bounds and the module's _moved both read it
    try:
        assert reprices(A_, +0.0004) == []
    finally:
        FS.NS["_steps"] = FS._steps = saved


assert fails(swapped)
say("(f) rules: D spares the far bid on a 0.04 % fall, A re-prices on toward moves only; swapping toward/away fails")

# ---------------------------------------------------------------------------------------------- (g)
fx = [(t, 1.25) for t in range(-20 * M, 60 * M, M)]
split = lambda b, s, k: "K1" if k == 0.001 else "K2"      # noqa: E731
cfg = V.default_cfg(rungs={"bid": [0.001, 0.002, 0.003], "ask": []}, gov={"entry_at": 2, "stop_at": 3}, acct_k=split)
r = FS.simulate([fake(fx)], cfg, 0, 10 * M)
placed = [p for p in r["posts"] if p[3] == "place"]
assert len(placed) == 3 and {(p[5], p[2]) for p in placed} == {(0.001, "K1"), (0.002, "K2"), (0.003, "K2")}, placed
cfg1 = V.default_cfg(rungs={"bid": [0.001, 0.002, 0.003], "ask": []}, gov={"entry_at": 2, "stop_at": 3})
assert sum(1 for p in FS.simulate([fake(fx)], cfg1, 0, 10 * M)["posts"] if p[3] == "place") == 2
assert FX.acct_split(2)("B", "bid", 0.00075) == "B/bid/0" and FX.acct_split(2)("B", "bid", 0.001) == "B/bid/1"
assert [FX.NINE[i] for i in range(9) if FX.acct_split(4)("B", "bid", FX.NINE[i]) == "B/bid/0"] == [0.0003, 0.00125, 0.003]
say("(g) keys per rung: 3 bids on 2 keys place 3 under a 2-POST governor, 1 key places 2; splits as declared")

# ---------------------------------------------------------------------------------------------- (h)
g, sp = FX._min_partition([[500, 0], [0, 500]], 600)
assert g == 1, (g, sp)
g2, _ = FX._min_partition([[500, 0], [0, 500], [200, 200]], 600)
assert g2 == 2
g3, sp3 = FX._min_partition([[350] * 3, [250] * 3, [240] * 3, [100] * 3], 600)
assert g3 == 2 and all(sum([[350] * 3, [250] * 3, [240] * 3, [100] * 3][i][0] for i in grp) < 600 for grp in sp3)
by_max = lambda vecs, lim: FX._min_partition([[max(v)] for v in vecs], lim)[0]  # noqa: E731
assert by_max([[500, 0], [0, 500]], 600) == 2
say("(h) keys needed: day-by-day sums (two 500s on different days share a key); busiest-day sums would need 2")

# ---------------------------------------------------------------------------------------------- (i)
lit = FX.XS("mask", [0, 20 * M], [5 * M, 30 * M], [1.0, 1.0], False)          # lit [0, 5 min] and [20, 30 min]
fast = FX.XS("x", list(range(0, 40 * M, 1000)), [t + 10 * M for t in range(0, 40 * M, 1000)], [1.25] * 2400, True)
def check_mask(fm):
    assert fm.X(4 * M, 0) == 1.25 and fm.X(6 * M, 0) is None and fm.X(19 * M, 0) is None and fm.X(21 * M, 0) == 1.25
    assert 5 * M + 1 in fm.change_instants(0, 0, 40 * M) and 20 * M in fm.change_instants(0, 0, 40 * M)


hours_ = [(t, 0.925) for t in range(-2 * DAY, 40 * M, H)]
check_mask(FX.FastMkt("USDC-GBP", [(-30000, 7400, 1.0, "buy")], hours_, fast, lit))
assert fails(lambda: check_mask(FX.FastMkt("USDC-GBP", [(-30000, 7400, 1.0, "buy")], hours_, fast, None)))
say("(i) the mask: dark wherever the study's own X is dark (a source that reopens earlier stays dark), lit elsewhere")

# ---------------------------------------------------------------------------------------------- (j)
import live_fx_analyze as LA  # noqa: E402

rs = np.random.RandomState(3)
rt = np.arange(0, 20 * M, 200, dtype=np.int64)                                 # a reference ticking every 0.2 s
rv = 1.3 * np.exp(np.cumsum(rs.normal(0, 2e-5, len(rt))))
src_t = np.arange(0, 20 * M, 1000, dtype=np.int64)                             # a source polled every second...
src_v = LA.at(rt, rv, src_t - 2500) * (1 + 1e-4)                               # ...showing the reference 2.5 s late, 1 bp high


def check_lag(v):
    g = LA.lag_vs(src_t, v, rt, rv, 60000, 20 * M)
    assert abs(g["lag_ms_best"] - 2500) <= 600 and abs(g["offset_bps_median"] - 1.0) < 0.5, g
    return g


got = check_lag(src_v)
assert fails(lambda: check_lag(LA.at(rt, rv, src_t) * (1 + 1e-4)))           # not late: must not read as 2.5 s
say("(j) live lag: a source showing the reference 2.5 s late is measured", got["lag_ms_best"], "ms behind; one not late is not")

# ---------------------------------------------------------------------------------------------- (k)
# fair 0.7400: bids at 0.7392 (0.1 %) and 0.7385 (0.2 %); a $1,000 print at 0.7380 goes through both, a $1,000 print at
# 0.7400 through no ask; the minute is $2,000, so 10 % a side is $200
mins = {0: [(1000, 7380, 1000.0, 0.74), (2000, 7400, 1000.0, 0.74)]}


def check_ceiling(size, vs):
    lad, lad_fill, free, free_fill = FX.ceiling_minutes(mins, [0.001, 0.002], size, vs)
    want_lad = 100 * (0.74 - 0.7392) / 0.7392 + 100 * (0.74 - 0.7385) / 0.7385
    assert abs(lad - want_lad) < 1e-9 and abs(lad_fill - 200) < 1e-9, (lad, lad_fill)
    assert abs(free - 200 * (0.74 - 0.7381) / 0.7381) < 1e-9 and abs(free_fill - 200) < 1e-9, (free, free_fill)


check_ceiling(100.0, 0.10)
assert fails(lambda: check_ceiling(1e9, 0.10)) and fails(lambda: check_ceiling(100.0, 1.0))
assert FX.step_events({0: 1.0, 1: 1.0002, 2: 1.00035, 3: 1.0006, 4: 1.0}, 0, 5 * DAY) == round(2 / 5, 1)
posts = [[t * 1000, 0, "K", "place", "bid", 0.001, True] for t in range(700)]
assert FX.reach_600(posts, 0, DAY) == {"key_days": 1, "earliest": "00:09", "median": "00:09"}
say("(k) the ceiling: a print through two rungs fills $100 each at its rung's distance, the free bound 10 % at one tick"
    " inside the print; without the $100 or with a 100 % cap it differs; step_events and reach_600 on known series")

say("all fastx checks pass")
if len(sys.argv) > 1:
    open(sys.argv[1], "w").write("\n".join(lines) + "\n")
