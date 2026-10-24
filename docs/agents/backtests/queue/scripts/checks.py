"""QUEUE's check 3 (`docs/agents/reviews/2026-09-28-queue-prereg.md`, "Checks before anything is scored"): the queue layer
pins its rules on made-up books and prints, and each check also fails when its rule is removed or altered, shown on a
deliberately broken copy of the scorer (its own source with one named text patch, asserted to apply exactly once). No
market data is read. Written 2026-10-24, before the export. Also here, as "Data" item 4 asks, the ports of PR5's
`fxBarAt`, `fairHours` and `median` pinned on the cases `agents/quotes.test.ts` gives them, and the port of `bookLevels`
check 6 reads the snapshots with.

Every expected value below is worked out by hand in the comment beside it. The world: one book at par, X = 1, fair
1.0000, minutes from t = 0; rung k = 1 tick (a bid at 9999, an ask at 10001) unless a check says otherwise; a seed BUY at
1.0000 just before the start, through no quote. An order placed at the turn of minute 0 goes live at L = 60,000 ms.

    python3 -I docs/agents/backtests/queue/scripts/checks.py      (prints each check; exits 1 on a failure)
"""
import json, math, os, sys, types

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import qsim as Q  # noqa: E402
import inputs as I  # noqa: E402
import bar as BAR  # noqa: E402

M = 60000
SEED = (-30000, 10000, 1.0, "buy", "seed")


def load(name, patches):
    """A copy of scripts/<name>.py with `patches` [(old, new)] applied, each exactly once, as a fresh module."""
    path = os.path.join(HERE, name + ".py")
    src = open(path).read()
    for old, new in patches:
        n = src.count(old)
        assert n == 1, f"{name}: a patch applies {n} times: {old[:70]!r}"
        src = src.replace(old, new)
    mod = types.ModuleType(name + "_broken")
    mod.__file__ = path
    exec(compile(src, path + " (broken copy)", "exec"), mod.__dict__)
    return mod


def world(Qm, prints, rows=(), n=30, F=None, rule="q1"):
    pr = sorted([SEED] + [(p[0], p[1], p[2], p[3], p[4] if len(p) > 4 else f"p{i:03d}") for i, p in enumerate(prints)],
                key=lambda p: (p[0], p[4]))
    valid, faulty = Qm.make_rows(rows)
    return Qm.QBook("USDC-USD", pr, 0, n * M, [1.0] * n, F if F is not None else [1.0] * n, valid, faulty)


def row(ts, su, bids, asks, reads=1):
    return (ts, su, reads, [[p, q, 1] for p, q in bids], [[p, q, 1] for p, q in asks])


def go(Qm, B, rungs=(0.0001,), rule="q1", **kw):
    c = {}
    cfg = Qm.Cfg(rule, list(rungs), 0.00005, markouts=kw.pop("markouts", False), **kw)
    trips, orders = Qm.run(B, cfg, collect=c)
    return trips, orders, c


def fills(c, side=None):
    return [(f["kind"], f["ts"], f["ticks"], round(f["coins"], 6)) for f in c["fills"] if side is None or f["side"] == side]


# ------------------------------------------------------------------ the pins: each returns (ok, detail) for a module
def pin_join_covering(Qm):
    # A row 0:50 -> 1:40 holds 500 at 0.9999 and covers L = 1:00, read again after it: the bid joins at 1:40 + 2 s, behind
    # 500. A SELL of 50 at 9999 at 1:10 fills and moves nothing; after the join a SELL of 500 fills 0 (500 - 500) and one
    # of 1 fills 1 coin.
    B = world(Qm, [(70000, 9999, 50.0, "sell"), (110000, 9999, 500.0, "sell"), (115000, 9999, 1.0, "sell")],
              [row(50000, 100000, [(0.9999, 500)], [(1.0001, 300)])])
    _, _, c = go(Qm, B)
    got = fills(c, "bid")
    return got == [("queue", 115000, 9999, 1.0)], got


def pin_read_lag(Qm):
    # (a) No row covers L; the first after it is read at 1:10 (200 at 9999): the join is at 1:12. A SELL of 10 at 1:11.5 is
    # applied before it and moves nothing; then 200 fills 0 and 3 fills 3.
    B = world(Qm, [(71500, 9999, 10.0, "sell"), (80000, 9999, 200.0, "sell"), (85000, 9999, 3.0, "sell")],
              [row(70000, 70000, [(0.9999, 200)], [(1.0001, 5)])])
    _, _, c = go(Qm, B)
    a = fills(c, "bid")
    # (b) Joined behind 500 at 1:42; a row read at 2:30 shows 100 (its cap falls at 2:32). A SELL of 450 at 2:31.5 comes
    # first: 500 - 450 = 50 ahead, then the cap min(50, 100) = 50; 50 fills 0, 2 fills 2.
    B = world(Qm, [(151500, 9999, 450.0, "sell"), (160000, 9999, 50.0, "sell"), (165000, 9999, 2.0, "sell")],
              [row(50000, 100000, [(0.9999, 500)], [(1.0001, 3)]), row(150000, 150000, [(0.9999, 100)], [(1.0001, 3)])])
    _, _, c = go(Qm, B)
    b = fills(c, "bid")
    return a == [("queue", 85000, 9999, 3.0)] and b == [("queue", 165000, 9999, 2.0)], {"join": a, "cap": b}


def pin_gap(Qm):
    # Live at L = 1:00 in a gap (a row 0:10 -> 0:40, the next read at 1:40 with 300 at 9999): the join is at 1:42. A SELL
    # of 20 at 1:30 fills and moves nothing; then 300 fills 0 and 1 fills 1.
    B = world(Qm, [(90000, 9999, 20.0, "sell"), (105000, 9999, 300.0, "sell"), (106000, 9999, 1.0, "sell")],
              [row(10000, 40000, [(0.9998, 1)], [(1.0001, 1)]), row(100000, 100000, [(0.9999, 300)], [(1.0001, 1)])])
    _, _, c = go(Qm, B)
    got = fills(c, "bid")
    return got == [("queue", 106000, 9999, 1.0)], got


def pin_other_aggressor(Qm):
    # Joined behind 100: a BUY of 100 at the bid's price moves nothing; then a SELL of 100 fills 0, one of 1 fills 1.
    B = world(Qm, [(110000, 9999, 100.0, "buy"), (115000, 9999, 100.0, "sell"), (116000, 9999, 1.0, "sell")],
              [row(50000, 100000, [(0.9999, 100)], [(1.0001, 3)])])
    _, _, c = go(Qm, B)
    got = fills(c, "bid")
    return got == [("queue", 116000, 9999, 1.0)], got


def pin_caps(Qm):
    # Joined behind 500; later rows show 100 (cap: 100) and then 900 (no raise): a SELL of 100 fills 0, one of 1 fills 1.
    B = world(Qm, [(150000, 9999, 100.0, "sell"), (151000, 9999, 1.0, "sell")],
              [row(50000, 100000, [(0.9999, 500)], [(1.0001, 3)]), row(120000, 120000, [(0.9999, 100)], [(1.0001, 3)]),
               row(140000, 140000, [(0.9999, 900)], [(1.0001, 3)])])
    _, _, c = go(Qm, B)
    got = fills(c, "bid")
    return got == [("queue", 151000, 9999, 1.0)], got


def pin_faulty(Qm):
    # (a) A row whose best bid equals its best ask (9999 / 9999) covers L: read as valid it would refuse the bid (9999 >= the
    # best ask) and join it behind 50; faulty, it does neither. The bid goes live and joins at the next valid row (read at
    # 2:10, 10 at 9999): a SELL of 5 at 1:50 does nothing, 10 fills 0, 1 fills 1. A row with an empty side is in it too.
    B = world(Qm, [(110000, 9999, 5.0, "sell"), (140000, 9999, 10.0, "sell"), (141000, 9999, 1.0, "sell")],
              [row(50000, 100000, [(0.9999, 50)], [(0.9999, 7)]), row(101000, 101000, [(0.9999, 1)], []),
               row(130000, 130000, [(0.9999, 10)], [(1.0001, 3)])])
    _, _, c = go(Qm, B)
    a = fills(c, "bid")
    # (b) A crossed row (best bid 10002 above best ask 10001) covers L: valid, it would refuse the ask at 10001 (at or below
    # the best bid); faulty, it does not, and a BUY through it at 1:10 (10002) fills it at the frozen size.
    B = world(Qm, [(70000, 10002, 5000.0, "buy")], [row(50000, 100000, [(1.0002, 5)], [(1.0001, 5)])])
    _, _, c = go(Qm, B)
    b = fills(c, "ask")
    # (c) The bid joins behind 0 at 2:02 and a SELL of 3 fills it at 2:10. Its markout five minutes on reads the book at
    # 7:10: the latest row at or before it (read at 5:50) is faulty, so the markout is missing, although the valid row
    # before it (seen until 6:40) would still be the book at that instant.
    B = world(Qm, [(130000, 9999, 3.0, "sell")],
              [row(50000, 400000, [(0.9998, 1)], [(1.0002, 1)]), row(350000, 350000, [(1.0002, 1)], [(1.0001, 1)])])
    _, _, c = go(Qm, B, markouts=True)
    m = [f["markout_5m_bps"] for f in c["fills"] if f["side"] == "bid"]
    ok = a == [("queue", 141000, 9999, 1.0)] and b == [("through", 70000, 10001, round(min(100.0, 0.1 * 5000 * 1.0002) / 1.0001, 6))] and m == [None]
    return ok, {"equal_row": a, "crossed_row": b, "markout": m}


def pin_void(Qm):
    # (a) One row (0:50 -> 1:40) and 28 void minutes after it. The bid joined at 1:42 behind 0 (no level at 9999): a SELL of 7
    # at 9999 in void minute 5 fills 7.
    rows = [row(50000, 100000, [(0.9998, 40)], [(1.0001, 3)])]
    B = world(Qm, [(300000, 9999, 7.0, "sell")], rows)
    _, _, c = go(Qm, B)
    a = fills(c, "bid")
    void = len(I.void_minutes(B.rows, 0, 30 * M))
    # (b) An order waiting to join (no row after L): a SELL at its price in a void minute fills nothing; a SELL through it
    # (9998) fills at the frozen size, 10 % of the minute's 5 x 0.9998 = $0.4999.
    B = world(Qm, [(300000, 9999, 7.0, "sell"), (400000, 9998, 5.0, "sell")], [row(10000, 20000, [(0.9998, 1)], [(1.0001, 1)])])
    _, _, c = go(Qm, B)
    b = fills(c, "bid")
    ok = a == [("queue", 300000, 9999, 7.0)] and void == 28 and b == [("through", 400000, 9999, round(0.1 * 5 * 0.9998 / 0.9999, 6))]
    return ok, {"joined": a, "void_minutes": void, "waiting": b}


def pin_depth(Qm):
    # The bid at 9997 (k = 3 ticks) is beyond a row's five bids (10005 ... 10001): it joins nothing there. A SELL of 10 at 9997
    # at 2:30 does nothing; a row read at 3:20 shows its price within the depth (one level, 9998): it joins behind 0, and a
    # SELL of 6 at 3:30 fills 6. Separately, a SELL through it (9996, 10 coins) fills at the frozen size: $0.9996.
    five = [(1.0005, 1), (1.0004, 1), (1.0003, 1), (1.0002, 1), (1.0001, 1)]
    B = world(Qm, [(150000, 9997, 10.0, "sell"), (210000, 9997, 6.0, "sell")],
              [row(50000, 100000, five, [(1.0010, 1)]), row(200000, 200000, [(0.9998, 4)], [(1.0010, 1)])])
    _, _, c = go(Qm, B, rungs=(0.0003,))
    a = fills(c, "bid")
    B = world(Qm, [(150000, 9996, 10.0, "sell")], [row(50000, 100000, five, [(1.0010, 1)])])
    _, _, c = go(Qm, B, rungs=(0.0003,))
    b = fills(c, "bid")
    ok = a == [("queue", 210000, 9997, 6.0)] and b == [("through", 150000, 9997, round(0.1 * 10 * 0.9996 / 0.9997, 6))]
    return ok, {"beyond_then_within": a, "through": b}


def pin_book_refusal(Qm):
    # (a) The book at L (read 0:50 -> 2:50) shows a best ask of 9999: the bid at 9999 is refused. The last print stays the
    # seed (not through it), so the frozen rule would re-place it at once; the book at the turns of 1:00, 2:00 and 3:00
    # still shows it crossing (seen until 2:50, within 120 s), so it is not; at 4:00 the book is the row read at 3:20 (best
    # ask 10001) and it is re-placed, live at 5:00, where a SELL through it at 5:10 fills it. Orders that day: the bid's
    # placement and one re-placement, the ask's placement and the filled bid's exit at 6:00: 4 (re-placed every turn, it
    # would be refused again and counted each time).
    rows = [row(50000, 170000, [(0.9998, 1)], [(0.9999, 1)]), row(200000, 200000, [(0.9998, 1)], [(1.0001, 1)])]
    B = world(Qm, [(310000, 9998, 3000.0, "sell")], rows)
    _, orders, c = go(Qm, B)
    a = fills(c, "bid")
    # (b) The same crossing book, seen last 121 s before L (dark until the turn of 4:00, so L = 5:00, the row seen until
    # 2:59): stale, it does not refuse the bid, and the SELL at 5:10 fills it.
    F = [None] * 4 + [1.0] * 26
    B = world(Qm, [(310000, 9998, 3000.0, "sell")], [row(50000, 179000, [(0.9998, 1)], [(0.9999, 1)])], F=F)
    _, _, c = go(Qm, B)
    b = fills(c, "bid")
    ok = (a == [("through", 310000, 9999, round(100 / 0.9999, 6))] and orders.get(0) == 4
          and b == [("through", 310000, 9999, round(100 / 0.9999, 6))])
    return ok, {"crossing": a, "orders_day0": orders.get(0), "stale": b}


def pin_pieces(Qm):
    # The bid joins behind 0 at 1:42 (no level at 9999): a SELL of 30 fills 30 coins, and the rest of the order lapses (a
    # second SELL of 30 adds nothing). Its exit (ask 10000, placed at 2:00, live 3:00, joined at 4:02 behind 0) takes a
    # BUY of 10 at 10000 (4:05) as a piece, and a BUY through it (10001, 5:10) closes the other 20: one trip of 30 coins,
    # 2 pieces, exit minute 5:00, P&L 30 x 0.0001 = $0.003.
    rows = [row(50000, 100000, [(0.9998, 3)], [(1.0002, 3)]), row(170000, 250000, [(0.9998, 3)], [(1.0002, 3)])]
    B = world(Qm, [(110000, 9999, 30.0, "sell"), (111000, 9999, 30.0, "sell"), (245000, 10000, 10.0, "buy"), (310000, 10001, 1.0, "buy")], rows)
    trips, _, c = go(Qm, B)
    t = [x for x in trips if x["side"] == "bid"]
    got = [(round(x["qty"], 9), x["pieces"], x["t_exit"], x["how"], round(x["pnl_usd"], 9), x["exit"]) for x in t]
    want = [(30.0, 2, 300000, "maker", 0.003, 1.0)]
    # A dust entry (0.5 coins, $0.49995) is a round trip, and does not count toward condition 4.
    B = world(Qm, [(110000, 9999, 0.5, "sell")], [row(50000, 100000, [(0.9998, 3)], [(1.0002, 3)])])
    trips, orders, _ = go(Qm, B)
    return got == want and len(trips) == 1, {"pieces": got, "dust_trips": len(trips)}


def pin_dust_counts(BARm):
    trips = [{"t_entry": 0, "pnl_usd": 0.01, "entry_notional_usd": 0.49995}, {"t_entry": 0, "pnl_usd": 0.01, "entry_notional_usd": 1.0}]
    _, d = BARm.conditions(trips, [], {}, 0, 7 * 86400000, 28 * 86400000, True)
    return d["trips_from_1usd"] == 1 and d["trips_under_1usd"] == 1, d["trips_from_1usd"]


def pin_rule7(Qm):
    # The worked case: queues ahead (100, 150), remainders (50, 50): a print of 120 gives 20 and 0 and leaves (0, 50); a
    # second of 100 gives 30 and 20.
    f1, a1 = Qm.queue_split([100.0, 150.0], [50.0, 50.0], 120.0)
    f2, a2 = Qm.queue_split(a1, [30.0, 50.0], 100.0)
    # Three exits joining at one instant take their turns in rung order: one SELL through all three bids (9996, 3,000 coins,
    # $100 each), their asks at 10000 placed together, live at 3:00, joined at 4:02 behind 0. A BUY of 150 at 10000 fills
    # rung 1's exit whole (100 / 0.9999 = 100.010001 coins) and 49.989999 of rung 2's, nothing of rung 3's.
    rows = [row(170000, 250000, [(0.9995, 1)], [(1.0002, 1)])]
    B = world(Qm, [(70000, 9996, 3000.0, "sell"), (250000, 10000, 150.0, "buy")], rows)
    trips, _, c = go(Qm, B, rungs=(0.0001, 0.0002, 0.0003))
    closed = [round(x["k"] * 1e4) for x in trips if x["t_exit"] == 240000]
    ok = f1 == [20.0, 0.0] and a1 == [0.0, 50.0] and f2 == [30.0, 20.0] and closed == [1]
    return ok, {"first": [f1, a1], "second": f2, "closed_at_4": closed}


def pin_reprice_loses_place(Qm):
    # Q2 (fair in ticks): the bid at 9999 joins behind 50 and a SELL of 50 brings it to the front. At 5:00 the fair moves to
    # 10001: re-priced to 10000, live 6:00 (a BUY at 10001 at 5:40 is the last print, not through it), it joins afresh
    # behind the 40 a row shows there (read 5:50 -> 6:40): a SELL of 40 at 10000 fills 0, one of 2 fills 2.
    F = [10000] * 5 + [10001] * 25
    rows = [row(50000, 100000, [(0.9999, 50)], [(1.0003, 1)]), row(350000, 400000, [(1.0000, 40)], [(1.0003, 1)])]
    B = world(Qm, [(110000, 9999, 50.0, "sell"), (340000, 10001, 1.0, "buy"), (410000, 10000, 40.0, "sell"),
                   (411000, 10000, 2.0, "sell")], rows, F=F)
    _, _, c = go(Qm, B, rungs=(1,), rule="q2")
    got = fills(c, "bid")
    return got == [("queue", 411000, 10000, 2.0)], got


def pin_stress(Qm):
    # Stress: the join behind 1.5 x 100 = 150 (a SELL of 150 fills 0, one of 1 fills 1) and a cap of 1.5 x 40 = 60 later
    # (60 fills 0, 1 fills 1, on the ask side the same way is not needed); a through fill needs one tick more: a SELL at
    # 9998 does not fill the bid at 9999, one at 9997 does.
    B = world(Qm, [(110000, 9999, 150.0, "sell"), (111000, 9999, 1.0, "sell")], [row(50000, 100000, [(0.9999, 100)], [(1.0001, 3)])])
    _, _, c = go(Qm, B, stress=True)
    a = fills(c, "bid")
    B = world(Qm, [(150000, 9999, 60.0, "sell"), (151000, 9999, 1.0, "sell")],
              [row(50000, 100000, [(0.9999, 100)], [(1.0001, 3)]), row(120000, 120000, [(0.9999, 40)], [(1.0001, 3)])])
    _, _, c = go(Qm, B, stress=True)
    b = fills(c, "bid")
    B = world(Qm, [(70000, 9998, 3000.0, "sell"), (80000, 9997, 3000.0, "sell")])
    _, _, c = go(Qm, B, stress=True)
    d = fills(c, "bid")
    ok = a == [("queue", 111000, 9999, 1.0)] and b == [("queue", 151000, 9999, 1.0)] and d == [("through", 80000, 9999, round(100 / 0.9999, 6))]
    return ok, {"join": a, "cap": b, "through": d}


def pin_q2_fair(Im):
    # Bars: 00:00 (VWAP "1.00185", 5 trades), 01:00 (no trade). At 02:00 the latest bar with a trade that has ended is
    # 00:00: 10019 ticks (binary floating point gives 10018). At 03:00 it started exactly 180 min before: still 10019. At
    # 03:01 none started at or after 00:01: dark.
    H = 3600
    bars = {0: ("1.00185", 5), H: ("1.00300", 0)}
    f = Im.q2_fair(bars, 2 * 3600000, 62)
    got = [f[0], f[60], f[61], round(float("1.00185") * 10000)]
    return got == [10019, 10019, None, 10018], got


def pin_lag(Qm):
    # Arm 3d on Q2: the bid at 9999 is re-priced at 5:00 (fair 10000 -> 10002) to 10001; the old order stays live until
    # 6:30, the new one is live from 6:30. (a) A SELL through the old price at 6:10 fills the old order at 9999 and the new
    # one is withdrawn. (b) A SELL at 6:30 that reaches both fills the old one, at 9999. In both a BUY at 10002 at 6:20 is
    # the last print before 6:30, so the new bid is not refused when it goes live.
    F = [10000] * 5 + [10002] * 25
    B = world(Qm, [(370000, 9998, 3000.0, "sell")], F=F)
    _, _, c = go(Qm, B, rungs=(1,), rule="q2", lag_ms=30000)
    a = [(f[1], f[2]) for f in fills(c, "bid")]
    B = world(Qm, [(380000, 10002, 1.0, "buy"), (390000, 9998, 3000.0, "sell")], F=F)
    _, _, c = go(Qm, B, rungs=(1,), rule="q2", lag_ms=30000)
    b = [(f[1], f[2]) for f in fills(c, "bid")]
    return a == [(370000, 9999)] and b == [(390000, 9999)], {"overlap": a, "both": b}


def pin_bootstrap(BARm):
    # All days +1: no resample at or below 0 (p = 0). All days 0: every resample is 0 (p = 1). 27 days at +1 and one at
    # -1,000: a resample is at or below 0 exactly when it draws that day, so p = 1 - (27/28)^28 = 0.6396 by hand; 10,000
    # resamples give it within three standard errors (0.0144). Holm's cases as the pre-registration states them.
    p_pos = BARm.day_bootstrap([1.0] * 28)
    p_zero = BARm.day_bootstrap([0.0] * 28)
    p_one = BARm.day_bootstrap([1.0] * 27 + [-1000.0])
    hand = 1 - (27 / 28) ** 28
    h = [BARm.holm(*x) for x in ((0.02, 0.04), (0.03, 0.01), (0.03, 0.04), (0.025, 0.025), (0.03, 0.03), (0.01, 0.06))]
    want_h = [(True, True), (True, True), (False, False), (True, True), (False, False), (True, False)]
    ok = p_pos == 0.0 and p_zero == 1.0 and abs(p_one - hand) <= 3 * math.sqrt(hand * (1 - hand) / 10000) and h == want_h
    return ok, {"all_positive": p_pos, "all_zero": p_zero, "one_loss_day": p_one, "by_hand": round(hand, 4), "holm": h}


def pin_pr5_ports(Im):
    # quotes.test.ts's cases: fxAt reads the bar of minute t - 1 (1.4), ten minutes back still counts (1.2), eleven is dark;
    # fairUAt takes the hours lying wholly inside the last 24 h (t-24 h, t-2 h, t-1 h: median 1.0001); median([3,1,2,4]) =
    # 2.5, of none None; the minute record's bar at t - 3 min (1.32) and dark 13 minutes on; 24 of 30 hours.
    t = 100 * 3600000
    bars = [(t - 12 * M, 1.1), (t - 10 * M, 1.2), (t - 2 * M, 1.3), (t - M, 1.4), (t, 1.5)]
    fx = lambda tt, bb: (Im.fx_bar_at(tt, bb) or (None, None))[1]  # noqa: E731
    a = [fx(t, bars), fx(t, bars[:2]), fx(t, bars[:1]), fx(t, [])]
    hours = [(t - 25 * 3600000, 9), (t - 24 * 3600000, 1.0002), (t - 2 * 3600000, 1.0000), (t - 3600000, 1.0001), (t, 9)]
    b = [Im.median(Im.fair_hours(t, hours)), Im.median([3, 1, 2, 4]), Im.median([])]
    t2 = 1758639600000                                    # Date.UTC(2026, 8, 23, 15, 0)
    bars2 = [(t2 - 12 * M, 1.30), (t2 - 3 * M, 1.32), (t2, 1.33)]
    hours2 = [(t2 - (30 - i) * 3600000, 1 + i / 1e4) for i in range(30)]
    c = [Im.fx_bar_at(t2, bars2), Im.fx_bar_at(t2 + 13 * M, bars2), len(Im.fair_hours(t2, hours2))]
    lv = Im.book_levels({"data": {"bids": [{"price": "0.7549", "quantity": "10", "count": 2}, {"price": "0.7550", "quantity": "5"}],
                                  "asks": [{"price": "0.7552", "quantity": "x"}, {"price": "0.7551", "quantity": "3", "count": 1}]}})
    ok = (a == [1.4, 1.2, None, None] and b == [1.0001, 2.5, None] and c == [(t2 - 3 * M, 1.32), None, 24]
          and lv == ([[0.755, 5.0, None], [0.7549, 10.0, 2.0]], [[0.7551, 3.0, 1.0]]))
    return ok, {"fx": a, "fair": b, "record": c, "book_levels": lv}


# ------------------------------------------------------------------ the broken copies each pin must fail on
BROKEN = {
    "join_covering": [("qsim", [("o.J, o.A, o.jrow = min(B.rows[k].su, G + JOIN_MAX_MS) + READ_LAG_MS, level(B.rows[k], side, p) * mult, k",
                                 "o.J, o.A, o.jrow = G, level(B.rows[k], side, p) * mult, k")])],
    "read_lag": [("qsim", [("READ_LAG_MS = 2000 ", "READ_LAG_MS = 0 ")])],
    "gap": [("qsim", [("o.J, o.A, o.jrow = B.rows[j].R, level(B.rows[j], side, p) * mult, j", "o.J, o.A, o.jrow = G, level(B.rows[j], side, p) * mult, j")])],
    "other_aggressor": [("qsim", [('if eligible(o, ts) and o.side == side and o.price == q and joined(o, ts)',
                                   'if eligible(o, ts) and o.price == q and joined(o, ts)'),
                                  ('        side = "bid" if aggr == "sell" else "ask" if aggr == "buy" else None\n        if side is None:\n            return\n',
                                   '        side = None\n')])],
    "caps": [("qsim", [("            if qn < o.A:\n                o.A = qn\n", "            o.A = qn\n")])],
    "faulty": [("qsim", [("if not b or not a or b[0][0] >= a[0][0]:", "if not b or not a:")]),
               ("qsim", [("        if f >= 0 and self.faulty[f][0] > self.rows[k].ts:\n            return None\n", "")])],
    "void": [("qsim", [("return o.J is not None and (ts > o.J or (o.incl and ts >= o.J))", "return o.J is None or ts > o.J or (o.incl and ts >= o.J)")])],
    "depth": [("qsim", [('    lv = row.bids if side == "bid" else row.asks\n    if len(lv) < DEPTH:', '    lv = row.bids if side == "bid" else row.asks\n    if True:')])],
    "book_refusal": [("qsim", [("        if lay and cfg.book_refusal:\n            bk = B.book_at(t)", "        if False:\n            bk = B.book_at(t)")]),
                     ("qsim", [("STALE_MS = 120000 ", "STALE_MS = 122000 ")])],
    "pieces": [("qsim", [('fill_entry(r, o, o.price, fills[j], fills[j] * o.price * TICK, t, i, ts, pid, "queue", lastX, ghost)',
                          'fill_entry(r, o, o.price, rems[j], rems[j] * o.price * TICK, t, i, ts, pid, "queue", lastX, ghost)')]),
               ("qsim", [("        if not r.parts and coins >= r.left - r.qty * 1e-12:", "        if not r.parts:")])],
    "dust_counts": [("bar", [('counted = sum(1 for x in sel if x["entry_notional_usd"] >= 1.0)', 'counted = len(sel)')])],
    "rule7": [("qsim", [("group.sort(key=lambda g: (g[0], g[1], g[2]))", "group.sort(key=lambda g: (g[0], g[1], -g[2]))")])],
    "reprice_loses_place": [("qsim", [("        if o.state == \"live\" and lay:\n            plan_join(o, G)", "        if o.state == \"live\" and lay and o.J is None:\n            plan_join(o, G)"),
                                      ("                    o.price, o.fair_at, o.live, o.state, o.placed = entry_px(cfg, f, r.k, r.side), f, i + 1, \"pending\", i\n                    o.lose_place()\n",
                                       "                    o.price, o.fair_at, o.live, o.state, o.placed = entry_px(cfg, f, r.k, r.side), f, i + 1, \"pending\", i\n")])],
    "stress": [("qsim", [("    mult = 1.5 if cfg.stress else 1.0", "    mult = 1.0")]), ("qsim", [("    thr = 1 if cfg.stress else 0", "    thr = 0")])],
    "q2_fair": [("inputs", [("    return int((decimal.Decimal(vwap) * 10000).quantize(decimal.Decimal(1), rounding=decimal.ROUND_HALF_UP))",
                             "    return round(float(vwap) * 10000)")]),
                ("inputs", [("        if k >= 0 and starts[k] * 1000 >= t - DARK_AFTER_MS:", "        if k >= 0:")])],
    "lag": [("qsim", [("            for ghost in (True, False):\n                o = r.ghost if ghost else r.o\n                if not eligible(o, ts):",
                       "            for ghost in (False, True):\n                o = r.ghost if ghost else r.o\n                if not eligible(o, ts):")]),
            ("qsim", [("            o.expire = B.t0 + (i + 1) * M + lag\n            r.ghost = o", "            o.expire = B.t0 + (i + 1) * M + lag")])],
    "bootstrap": [("bar", [("        if s <= 0:", "        if s < 0:")])],
    "pr5_ports": [("inputs", [("    k = bisect.bisect_right(starts, t - M) - 1\n    return bars[k] if k >= 0 and bars[k][0] >= t - 10 * M else None",
                               "    k = bisect.bisect_right(starts, t) - 1\n    return bars[k] if k >= 0 and bars[k][0] >= t - 10 * M else None")])],
}

PINS = [("join_covering", pin_join_covering, "qsim"), ("read_lag", pin_read_lag, "qsim"), ("gap", pin_gap, "qsim"),
        ("other_aggressor", pin_other_aggressor, "qsim"), ("caps", pin_caps, "qsim"), ("faulty", pin_faulty, "qsim"),
        ("void", pin_void, "qsim"), ("depth", pin_depth, "qsim"), ("book_refusal", pin_book_refusal, "qsim"),
        ("pieces", pin_pieces, "qsim"), ("dust_counts", pin_dust_counts, "bar"), ("rule7", pin_rule7, "qsim"),
        ("reprice_loses_place", pin_reprice_loses_place, "qsim"), ("stress", pin_stress, "qsim"),
        ("q2_fair", pin_q2_fair, "inputs"), ("lag", pin_lag, "qsim"), ("bootstrap", pin_bootstrap, "bar"),
        ("pr5_ports", pin_pr5_ports, "inputs")]
REAL = {"qsim": Q, "inputs": I, "bar": BAR}


def run():
    """Each pin on the scorer as it is (must hold) and on each of its broken copies (must not)."""
    out, ok_all = {}, True
    for name, fn, mod in PINS:
        ok, detail = fn(REAL[mod])
        broken = []
        for which, patches in BROKEN[name]:
            bm = load(which, patches)
            if mod != which:
                raise SystemExit(f"{name}: a broken copy of {which} for a pin on {mod}")
            try:
                bok, bdetail = fn(bm)
            except Exception as e:  # noqa: BLE001  (a broken copy may also fail by raising)
                bok, bdetail = False, f"raised {type(e).__name__}: {e}"
            broken.append({"patch": [p[0][:60] for p in patches], "holds_on_broken_copy": bool(bok), "detail": bdetail})
        good = bool(ok) and broken and not any(b["holds_on_broken_copy"] for b in broken)
        ok_all = ok_all and good
        out[name] = {"ok": good, "holds": bool(ok), "detail": detail, "broken_copies": broken}
    return ok_all, out


if __name__ == "__main__":
    ok, res = run()
    for k, v in res.items():
        print(("ok  " if v["ok"] else "FAIL"), k, json.dumps(v["detail"], default=str)[:220],
              "| broken copies fail:", [not b["holds_on_broken_copy"] for b in v["broken_copies"]])
    print("check 3:", "all pins hold and every broken copy fails" if ok else "FAILED")
    sys.exit(0 if ok else 1)
