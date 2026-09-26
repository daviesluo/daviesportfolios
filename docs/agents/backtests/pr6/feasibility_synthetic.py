"""Feasibility only, on made-up prints (no market data): can PR5's simulate() and exit_only(), imported unchanged, run a
book whose fair is 1.0000 with rungs of 1, 2 and 3 ticks? Prints the order prices it places and the synthetic trips."""
import collections, os, sys

REPO = "/home/user/daviesportfolios/.claude/worktrees/agent-ae3a8957301d1380a"
sys.path.insert(0, os.path.join(REPO, "docs/agents/scripts/pr5"))
import pr5_sim as P

M = P.M


class FakeParBook:
    def __init__(self, n, prints, dark=()):
        self.book, self.t0, self.n = "USDC-USD", 0, n
        self.X = [1.0] * n
        self.F = [None if i in dark else 1.0 for i in range(n)]
        self.all_prints = sorted(prints)
        self.pts = [p[0] for p in self.all_prints]
        self.by_min = collections.defaultdict(list)
        for p in self.all_prints:
            if p[0] >= 0:
                self.by_min[p[0] // M].append(p)
        self.qvol = {i: sum(q * pt * P.TICK for ts, pt, q, s in ps) for i, ps in self.by_min.items()}
    last_before = P.Book.last_before
    last_at_or_before = P.Book.last_at_or_before


P.RUNGS = [0.0001, 0.0002, 0.0003]
P.HALF_SPREAD = 0.00005
print("bid ticks", [P.rt(1.0, k, "bid") for k in P.RUNGS], "ask ticks", [P.rt(1.0, k, "ask") for k in P.RUNGS],
      "exit of a long", P.rt_exit(1.0, "bid"), "exit of a short", P.rt_exit(1.0, "ask"))
# a book at 1.0000/1.0001; a sell at 0.9996 in minute 5 goes through all three bids; a buy at 1.0001 in minute 9 exits them
prints = [(-30000, 10000, 500.0, "sell"), (5 * M + 10, 9996, 3000.0, "sell"), (7 * M, 10000, 10.0, "sell"),
          (8 * M, 9999, 10.0, "sell"), (9 * M + 10, 10001, 3000.0, "buy")]
B = FakeParBook(40, prints)
trips, orders = P.simulate(B)
print("trips", [(t["side"], round(t["k"] / 1e-4), t["t_entry"] // M, t["entry"], t["t_exit"] // M, t["exit"], t["how"],
                 round(t["notional_usd"], 4), round(t["pnl_usd"], 6)) for t in trips])
print("orders by day", dict(orders))
# a print AT the bid's price never fills it
B2 = FakeParBook(20, [(-30000, 10000, 1.0, "buy"), (3 * M, 9999, 5000.0, "sell")])
print("at-price trips", P.simulate(B2)[0])
# a dark minute withdraws the entry quotes and places none
B3 = FakeParBook(20, [(-30000, 10000, 1.0, "buy"), (6 * M, 9990, 5000.0, "sell")], dark=set(range(3, 10)))
print("dark trips", [(t["side"], round(t["k"] / 1e-4), t["t_entry"] // M) for t in P.simulate(B3)[0]])
# the twin machinery: enter at the last print of minute 5 (0.9996), exit at par on the buy in minute 9
print("twin", round(P.exit_only(B, 5, "bid", 100.0, 1.0), 6))
