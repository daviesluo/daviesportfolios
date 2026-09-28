"""Does pr5v_sim.simulate, set to PR5's parameters and today's timing (s = 60 s, orders live the next minute, X read at
the minute's end, cancels instant, each rung's own 10 % cap, exits whole), reproduce the frozen pr5_sim.simulate trip for
trip and order for order? Runs both on the committed inputs over PR5's primary windows (each book from its listing to
2026-09-23, the frozen `Book` spans) and over the tightened market (2026-08-26 -> 09-23), in the primary and the stress
arms, and compares every field the frozen trips carry, exactly, and the orders per UTC day.
usage: check_repro.py OUT.json
"""
import collections, hashlib, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pr5v_sim as V  # noqa: E402
P = V.P

FROZEN_SHA = "56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a"
KEYS = ["book", "side", "k", "t_entry", "t_exit", "entry", "exit", "how", "notional_usd", "pnl_usd", "fill_ts"]


def main():
    out = {"frozen_sim_sha256": hashlib.sha256(open(os.path.join(HERE, "..", "pr5", "pr5_sim.py"), "rb").read()).hexdigest()}
    assert out["frozen_sim_sha256"] == FROZEN_SHA, "pr5_sim.py is not the committed frozen copy"
    out["pr5v_sim_sha256"] = hashlib.sha256(open(os.path.join(HERE, "pr5v_sim.py"), "rb").read()).hexdigest()
    fx = P.fx_series()
    mk = V.committed_markets()
    runs = {}
    for span in ("primary_windows", "tightened_2026-08-26_to_09-23"):
        for arm, stress in (("primary", False), ("stress", True)):
            res = {"books": {}}
            for b in P.BOOKS:
                t0 = P.START[b] if span == "primary_windows" else P.PR3_0
                a = time.time()
                ftr, fod = P.simulate(P.Book(b, t0, P.END, fx), stress=stress)
                fa = time.time() - a
                a = time.time()
                r = V.simulate([mk[b]], V.default_cfg(stress=stress), t0, P.END, collect_posts=False)
                va = time.time() - a
                key = lambda x: (x["t_entry"], x["side"], x["k"], x["fill_ts"])
                F = sorted(({k: x[k] for k in KEYS} for x in ftr), key=key)
                G = sorted(({k: x[k] for k in KEYS} for x in r["trips"]), key=key)
                same_trips = F == G
                diffs = [(f, g) for f, g in zip(F, G) if f != g][:3]
                vod = {d: n for d, n in r["orders_by_day"].items() if n}
                res["books"][b] = {"from": t0, "to": P.END, "frozen_trips": len(F), "pr5v_trips": len(G),
                                   "trips_identical": same_trips, "first_differences": diffs,
                                   "frozen_pnl_usd": round(sum(x["pnl_usd"] for x in F), 10),
                                   "pr5v_pnl_usd": round(sum(x["pnl_usd"] for x in G), 10),
                                   "frozen_orders": sum(fod.values()), "pr5v_orders": sum(vod.values()),
                                   "orders_per_day_identical": dict(fod) == vod,
                                   "seconds_frozen": round(fa, 1), "seconds_pr5v": round(va, 1)}
                print(span, arm, b, res["books"][b]["frozen_trips"], res["books"][b]["pr5v_trips"], same_trips,
                      dict(fod) == vod, res["books"][b]["frozen_pnl_usd"], res["books"][b]["pr5v_pnl_usd"],
                      f"{fa:.1f}s/{va:.1f}s", flush=True)
            res["all_identical"] = all(v["trips_identical"] and v["orders_per_day_identical"] for v in res["books"].values())
            runs[f"{span}/{arm}"] = res
    out["runs"] = runs
    out["PASS"] = all(v["all_identical"] for v in runs.values())
    json.dump(out, open(sys.argv[1], "w"), indent=1, sort_keys=True)
    print("PASS" if out["PASS"] else "FAIL")


if __name__ == "__main__":
    main()
