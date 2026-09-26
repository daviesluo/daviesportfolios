"""PR6's layer checks, on made-up prints only: no market data is read. `score.py` runs them before it reads a PR6
print, and scores nothing if one fails; alone, `checks.py` prints them and exits 1 on a failure.

They pin what this layer hands PR5's unchanged simulator (pre-registration, "The simulator is PR5's code"):
the rung ticks (9999, 9998, 9997; 10001, 10002, 10003), the exits at 10000, the de-peg guard (a last print 31 ticks
from par darkens the minute, 30 ticks does not, and a dark minute places no entry), no fill on a print at the quote's
own price, the size cap, and each book's stop cost.
"""
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pr6_sim as S  # noqa: E402

P, M = S.P, S.M


def fake(book, prints, n, guard=True):
    return S.ParBook(book, sorted(prints, key=lambda p: p[0]), 0, n * M, guard=guard)


def run():
    res = {}

    def check(name, ok, detail):
        res[name] = {"ok": bool(ok), "detail": detail}

    # 1. the rungs and the exits, as PR5's own price functions compute them with this layer's constants
    S.use_book("USDC-USD")
    bids = [P.rt(1.0, k, "bid") for k in P.RUNGS]
    asks = [P.rt(1.0, k, "ask") for k in P.RUNGS]
    check("rung_ticks", bids == [9999, 9998, 9997] and asks == [10001, 10002, 10003], {"bids": bids, "asks": asks})
    exits = [P.rt_exit(1.0, "bid"), P.rt_exit(1.0, "ask")]
    check("exit_ticks_at_par", exits == [10000, 10000], exits)

    # 2. one whole cycle through simulate(): a sell at 0.9996 fills the three bids; a buy at 1.0004 exits them at par
    #    and fills the three asks; a sell at 0.9999 exits those at par. $100 each; each trip earns its rung.
    pr = [(-30000, 10000, 500.0, "sell"), (5 * M + 10, 9996, 3000.0, "sell"), (9 * M + 10, 10004, 3000.0, "buy"),
          (13 * M + 10, 9999, 3000.0, "sell")]
    tr, _ = S.simulate(fake("USDC-USD", pr, 30))
    got = sorted((t["side"], round(t["k"] / 1e-4), t["t_entry"] // M, t["entry"], t["t_exit"] // M, t["exit"], t["how"],
                  round(t["notional_usd"], 9)) for t in tr)
    want = sorted([("bid", n, 5, round(1 - n * 1e-4, 6), 9, 1.0, "maker", 100.0) for n in (1, 2, 3)]
                  + [("ask", n, 9, round(1 + n * 1e-4, 6), 13, 1.0, "maker", 100.0) for n in (1, 2, 3)])
    check("cycle_entries_at_the_rungs_exits_at_par", got == want, {"got": [list(g) for g in got]})
    pnl_ok = len(tr) == 6 and all(abs(t["pnl_usd"] - 100.0 / t["entry"] * abs(1.0 - t["entry"])) < 1e-9 for t in tr)
    check("cycle_each_trip_earns_its_rung", pnl_ok, sorted(round(t["pnl_usd"], 9) for t in tr))

    # 3. a print AT a quote's own price never fills it
    pr = [(-30000, 10000, 1.0, "buy"), (3 * M, 9999, 5000.0, "sell"), (4 * M, 10001, 5000.0, "buy")]
    tr, _ = S.simulate(fake("USDC-USD", pr, 30))
    check("no_fill_on_a_print_at_the_quotes_price", tr == [], len(tr))

    # 4. the guard: a minute is dark when the last print before it is more than 30 ticks from par
    for lp, want_f in ((9969, None), (9970, 1.0), (10030, 1.0), (10031, None)):
        B = fake("USDC-USD", [(-1000, lp, 1.0, "sell")], 3)
        check(f"guard_last_print_{lp}", B.F == [want_f] * 3, B.F)
    #    ... and a dark minute places no entry. A buy at 1.0040 before the start darkens minutes 0-5. It is above the
    #    bids, so post-only would accept them: only the guard keeps them out. So a sell at 0.9996 in minute 5 fills
    #    nothing. That sell lifts the guard at the turn of minute 6; a buy at 1.0000 in minute 6 leaves the bids
    #    acceptable when they go live at 7; a sell at 0.9996 in minute 10 fills all three; a buy at 1.0001 in minute 12
    #    exits them. Without the guard the same prints fill the three bids in minute 5.
    pr = [(-1000, 10040, 1.0, "buy"), (5 * M + 10, 9996, 5000.0, "sell"), (6 * M + 10, 10000, 10.0, "buy"),
          (10 * M + 10, 9996, 5000.0, "sell"), (12 * M + 10, 10001, 5000.0, "buy")]
    B = fake("USDC-USD", pr, 30)
    tr, _ = S.simulate(B)
    ents = sorted((t["side"], round(t["k"] / 1e-4), t["t_entry"] // M) for t in tr)
    B0 = fake("USDC-USD", pr, 30, guard=False)
    tr0, _ = S.simulate(B0)
    ents0 = sorted((t["side"], round(t["k"] / 1e-4), t["t_entry"] // M) for t in tr0)
    check("guard_places_no_entry_in_a_dark_minute",
          ents == [("bid", 1, 10), ("bid", 2, 10), ("bid", 3, 10)] and B.F[:6] == [None] * 6 and B.F[6:12] == [1.0] * 6
          and ents0 == [("bid", 1, 5), ("bid", 2, 5), ("bid", 3, 5)],
          {"with_guard": [list(e) for e in ents], "F": B.F[:12], "without_guard": [list(e) for e in ents0]})

    # 5. the size cap: min($100, 10 % of the minute's USD volume)
    pr = [(-30000, 10000, 1.0, "buy"), (3 * M + 5, 9996, 50.0, "sell"), (9 * M, 10004, 10000.0, "buy")]
    tr, _ = S.simulate(fake("USDC-USD", pr, 30))
    small = [round(t["notional_usd"], 9) for t in tr if t["t_entry"] // M == 3]
    big = [round(t["notional_usd"], 9) for t in tr if t["t_entry"] // M == 9]
    check("size_cap", small == [round(0.1 * 50.0 * 0.9996, 9)] * 3 and big == [100.0] * 3, {"small": small, "big": big})

    # 6. each book's stop: a long filled at 0.9999 with no print above par for a day is closed, 1,440 minutes after its
    #    fill minute, at the last print x (1 - (0.0009 + half spread)): 0.5 bp on USDC-USD, 2 bps on USDT-USD. The two
    #    books run one after the other, so this also shows the constant is set per book.
    for book, hs in (("USDC-USD", 0.00005), ("USDT-USD", 0.0002)):
        pr = [(-30000, 10000, 1.0, "buy"), (2 * M + 5, 9998, 5000.0, "sell")]
        tr, _ = S.simulate(fake(book, pr, 1600))
        want_px = 9998 * P.TICK * (1 - (0.0009 + hs))
        ok = (len(tr) == 1 and tr[0]["side"] == "bid" and round(tr[0]["k"] / 1e-4) == 1 and tr[0]["how"] == "taker"
              and tr[0]["t_exit"] // M == 2 + 1440 and abs(tr[0]["exit"] - want_px) < 1e-8)
        check(f"stop_cost_{book}", ok, [[t["side"], round(t["k"] / 1e-4), t["t_exit"] // M, t["exit"], t["how"]] for t in tr])
    return all(v["ok"] for v in res.values()), res


if __name__ == "__main__":
    ok, res = run()
    for k, v in res.items():
        print("ok  " if v["ok"] else "FAIL", k, v["detail"])
    print("all PR6 layer checks pass" if ok else "a PR6 layer check FAILED")
    sys.exit(0 if ok else 1)
