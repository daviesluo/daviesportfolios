"""Synthetic checks of the fill / post-only logic in pr5_sim.simulate (no market data)."""
import sys, os, bisect, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pr5_sim as P
M = P.M


class FakeBook:
    def __init__(self, n, fair, prints):
        self.book, self.t0, self.n = "USDC-GBP", 0, n
        self.X = [1.25] * n
        self.F = [fair] * n
        self.all_prints = sorted(prints)
        self.pts = [p[0] for p in self.all_prints]
        self.by_min = collections.defaultdict(list)
        for p in self.all_prints:
            if p[0] >= 0: self.by_min[p[0] // M].append(p)
        self.qvol = {i: sum(q * pt * P.TICK for ts, pt, q, s in ps) for i, ps in self.by_min.items()}
    last_before = P.Book.last_before
    last_at_or_before = P.Book.last_at_or_before


fair = 0.7400      # bid rung k=0.1% -> floor(0.7400*0.999/1e-4) = 7392; ask -> ceil(7407.4) = 7408
# (a) market through the 0.1 % bid when it goes live (last print 7390 < 7392): refused; a print at 7395 at minute 5 ends it;
#     re-placed at turn 6, live at 7; a SELL at 7391 in minute 8 fills it; the exit ask at 7400 fills on a BUY at 7401 in minute 12
prints = [(-30000, 7390, 5000.0, "sell"), (5 * M + 100, 7395, 5000.0, "buy"), (8 * M + 100, 7391, 5000.0, "sell"), (12 * M + 100, 7401, 5000.0, "buy")]
B = FakeBook(30, fair, prints)
trips, orders = P.simulate(B)
bid1 = [t for t in trips if t["side"] == "bid" and t["k"] == 0.001]
print("(a)", [(t["t_entry"] // M, t["entry"], t["t_exit"] // M, t["exit"], t["how"]) for t in trips])
assert len(bid1) == 1 and bid1[0]["t_entry"] // M == 8 and abs(bid1[0]["entry"] - 0.7392) < 1e-9 and bid1[0]["t_exit"] // M == 12
# (b) without the refusal rule the same bid fills on the first through print after go-live? minute 8 too (7390 is before t0)
trips_nb, _ = P.simulate(B, no_block=True)
print("(b) no_block", [(t["t_entry"] // M, t["side"], t["k"]) for t in trips_nb])
# (c) a print AT the price never fills
B2 = FakeBook(30, fair, [(-30000, 7400, 1.0, "buy"), (3 * M, 7392, 5000.0, "sell"), (4 * M, 7408, 5000.0, "buy")])
trips2, _ = P.simulate(B2)
print("(c)", trips2)
assert trips2 == []
# (d) a SELL print exactly AT the bid before go-live does not refuse it (the bid side sat there); a BUY at it does
assert P.blocks("bid", 7392, (7392, "sell")) is False and P.blocks("bid", 7392, (7392, "buy")) is True
assert P.blocks("ask", 7408, (7408, "buy")) is False and P.blocks("ask", 7408, (7408, "sell")) is True
# (e) size: 10 % of the minute's quote volume, capped at $100
B3 = FakeBook(30, fair, [(-30000, 7400, 1.0, "buy"), (3 * M + 5, 7380, 50.0, "sell"), (9 * M, 7420, 10000.0, "buy")])
trips3, _ = P.simulate(B3)
print("(e)", [(t["side"], t["k"], round(t["notional_usd"], 4)) for t in trips3])
exp = 0.10 * 50.0 * 0.7380 * 1.25
assert all(abs(t["notional_usd"] - exp) < 1e-6 for t in trips3 if t["t_entry"] // M == 3)
print("all synthetic checks pass")
