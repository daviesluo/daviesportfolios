"""Checks of what pr5v_sim adds to the frozen rule (check_repro.py covers the frozen part):
(a) the random-time twin run through `inject` equals the frozen `exit_only`, on 300 random twins of the tightened market;
(b) the shared cap: two bids a print goes through share its quantity and the minute's cap, nearest the market first;
(c) a 1 s loop places the exit one step after the fill, live `delta` later;
(d) a stale quote: a re-priced bid stays fillable at its old price until its cancel lands, and its replacement is unsent;
(e) the governor withdraws the entries of an account at `entry_at` POSTs.
usage: test_pr5v.py
"""
import collections, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pr5v_sim as V  # noqa: E402
P = V.P
M, DAY = V.M, V.DAY


def fake(prints, fair=0.7400, x=1.25, t_end=40 * M):
    """A book whose fair is `fair` GBP: USD hours at fair * x for two days before, X = x every minute."""
    fx = [(t, x) for t in range(-20 * M, t_end + 20 * M, M)]
    hours = [(t, fair * x) for t in range(-2 * DAY, t_end, 3600000)]
    return V.Mkt("USDC-GBP", sorted(prints), fx, hours)


# (a) twins
fxm = P.fx_series()
mk = V.committed_markets()
rng = random.Random(7)
n_ok = 0
for b in P.BOOKS:
    B = P.Book(b, P.PR3_0, P.END, fxm)
    pool = [i for i in sorted(B.by_min) if B.X[i]]
    for _ in range(150):
        i = pool[rng.randrange(len(pool))]
        side = rng.choice(["bid", "ask"])
        usd = min(100.0, 0.10 * B.qvol[i] * B.X[i])
        want = P.exit_only(B, i, side, usd, B.X[i])
        last = B.by_min[i][-1]
        m0 = P.PR3_0 + i * M
        r = V.simulate([mk[b]], V.default_cfg(no_entries=True, rungs={"bid": [], "ask": []}), m0 - M, P.END,
                       collect_posts=False, inject=(0, side, 0.0, last[1], usd, last[0], B.X[i]), stop_when_flat=True)
        got = sum(t["pnl_usd"] for t in r["trips"])
        assert abs(got - want) < 1e-12, (b, i, side, want, got)
        n_ok += 1
print("(a) twins identical:", n_ok)

# (b) shared cap: bids at 0.1 % (7392) and 0.2 % (7385); one SELL print at 7380 of 200 USDC in minute 5, nothing else
pr = [(-30000, 7400, 1.0, "buy"), (5 * M + 100, 7380, 200.0, "sell")]
cfg = V.default_cfg(rungs={"bid": [0.001, 0.002], "ask": []}, cap="shared", size=100.0)
r = V.simulate([fake(pr)], cfg, 0, 40 * M)
pos = sorted(((t["k"], round(t["notional_usd"], 6)) for t in r["trips"]))
vol_usd = (1.0 * 7400 * 1e-4 * 0 + 200.0 * 7380 * 1e-4) * 1.25       # minute 5's volume in USD
cap_usd = 0.10 * vol_usd                                              # the shared minute cap
print("(b)", pos, "cap", round(cap_usd, 6))
assert pos[0] == (0.001, round(cap_usd, 6)) and len(pos) == 1        # the nearest bid takes the whole cap, the other none
r2 = V.simulate([fake(pr)], V.default_cfg(rungs={"bid": [0.001, 0.002], "ask": []}, cap="per_rung"), 0, 40 * M)
assert len(r2["trips"]) == 2                                          # frozen: each rung its own 10 %

# (c) a 1 s loop: fill at 5:00.1, exit placed at the 5:01 step, live at 5:02, filled by a BUY at 5:03 through 7400
pr = [(-30000, 7400, 1.0, "buy"), (5 * M + 100, 7390, 5000.0, "sell"), (5 * M + 3000, 7401, 5000.0, "buy")]
cfg = V.default_cfg(rungs={"bid": [0.001], "ask": []}, s_ms=1000, delta_ms=1000, cancel_ms=1000)
r = V.simulate([fake(pr)], cfg, 0, 40 * M)
t = r["trips"][0]
print("(c)", t["t_entry"], t["t_exit"], t["exit"], t["how"])
assert t["t_entry"] == 5 * M and t["t_exit"] == 5 * M + 3000 and t["how"] == "maker"
exits = [p for p in r["posts"] if p[3] == "exit"]
assert exits and exits[0][0] == 5 * M + 1000

# (d) stale quote: fair moves at minute 10 (X falls, fair rises 0.2 %); the old bid at 7392 is still up until 10:01,
#     a SELL at 10:00.5 through it fills it, flagged stale, and the replacement POST is marked unsent
fx = [(t, 1.25 if t < 9 * M else 1.25 / 1.002) for t in range(-20 * M, 60 * M, M)]
hours = [(t, 0.74 * 1.25) for t in range(-2 * DAY, 60 * M, 3600000)]
mkd = V.Mkt("USDC-GBP", [(-30000, 7400, 1.0, "buy"), (10 * M + 500, 7391, 5000.0, "sell")], fx, hours)
cfg = V.default_cfg(rungs={"bid": [0.001], "ask": []}, s_ms=1000, delta_ms=1000, cancel_ms=1000)
r = V.simulate([mkd], cfg, 0, 40 * M)
st = [t for t in r["trips"] if t["stale_entry"]]
print("(d)", [(t["t_entry"], t["entry"], t["stale_entry"]) for t in r["trips"]], r["stats"]["stale_fills"])
assert st and abs(st[0]["entry"] - 0.7392) < 1e-9 and r["stats"]["stale_fills"] == 1
assert any(p[3] == "reprice" and p[6] is False for p in r["posts"])

# (e) governor: entry_at=2 on one account; the frozen three bids place 3 orders at minute 0 -> the third is refused
cfg = V.default_cfg(rungs={"bid": [0.001, 0.002, 0.003], "ask": []}, gov={"entry_at": 2, "stop_at": 3})
r = V.simulate([fake([(-30000, 7400, 1.0, "buy")])], cfg, 0, 10 * M)
n = sum(1 for p in r["posts"] if p[3] == "place")
print("(e) placed", n, "withdrawn", r["stats"]["gov_withdrawn"])
assert n == 2
print("all pr5v checks pass")
