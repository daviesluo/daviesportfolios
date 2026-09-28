"""PR5v at PR5's own minute: the configuration `study.py` chose, priced at the frozen rule's timing.

`study.py` chose nine rungs a side at a 0.03 % re-price on four keys, with a turn every second. "Stablecoin quotes -
variant" runs as a paper replay of PR5's own stored minutes, so it turns once a minute exactly as PR5's engine does
(`REF`: the turn at the start of each minute on data to the minute before, orders live the next minute, cancels at the
turn). This prices that configuration at that timing on the same 28 days and five fresh days, beside the 1 s loop the
study chose, the frozen rule as it runs, the study's in-sample top-five set, and the stress arm; and it pairs the
minute configuration with the frozen rule day by day, as the forward test will. Written 2026-09-28, after `study.py`,
with its code and inputs unchanged; it chooses nothing.

    python3 docs/agents/scripts/pr5v/ref_timing.py docs/agents/backtests/pr5v/ref_timing.json
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import study as S  # noqa: E402

V = S.V
GOV = {"entry_at": 600, "stop_at": 700}
ACCT4 = lambda book, side: f"{book}/{side}"  # noqa: E731
NINE = [0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003]
TOP5 = [0.0005, 0.00075, 0.001, 0.00125, 0.0015]


def main():
    R = S.Runner()
    out = {"inputs": {"ref_timing.py": S.sha(os.path.abspath(__file__)), "study.py": S.sha(os.path.join(HERE, "study.py")),
                      "pr5v_sim.py": S.sha(os.path.join(HERE, "pr5v_sim.py"))},
           "timing": {"REF": S.REF, "live(1, 1)": S.live(1, 1)}, "arms": {}}
    runs = {}

    def arm(name, rungs, spans=("N", "F"), **kw):
        s = {}
        for sp in spans:
            res = R.run(sp, rungs, **kw)
            if sp == "N":
                runs[name] = res
            sm = S.summary(res, sp)
            s.update({k: v for k, v in sm.items() if k not in ("orders", "stats")})
            s["orders_" + sp] = sm["orders"]
            s["stats_" + sp] = sm["stats"]
        out["arms"][name] = s
        print(name, S.brief(s), S.brief(s, "OOS"), S.brief(s, "N28"), f"FRESH ${s['FRESH']['usd_per_day']}/d" if "FRESH" in s else "", flush=True)

    arm("nine/0.03%/4 keys/minute", NINE, reprice=0.0003, gov=GOV, acct=ACCT4)
    arm("nine/0.03%/4 keys/minute/no governor", NINE, reprice=0.0003, acct=ACCT4)
    arm("nine/0.03%/4 keys/1 s", NINE, reprice=0.0003, gov=GOV, acct=ACCT4, **S.live(1, 1))
    arm("top5/0.03%/4 keys/minute", TOP5, reprice=0.0003, gov=GOV, acct=ACCT4)
    arm("frozen as it runs", S.FROZEN, cap="per_rung")
    arm("nine/0.03%/4 keys/minute/stress", NINE, reprice=0.0003, gov=GOV, acct=ACCT4, stress=True, spans=("N",))

    dV = S.daily(runs["nine/0.03%/4 keys/minute"]["trips"], S.N0, S.N1)
    dF = S.daily(runs["frozen as it runs"]["trips"], S.N0, S.N1)
    diff = [round(v - f, 6) for v, f in zip(dV, dF)]
    out["paired"] = {"what": "nine rungs at the minute against the frozen rule as it runs, by UTC day of entry, 08-26 -> 09-23",
                     "days": len(diff), "variant_daily": dV, "frozen_daily": dF,
                     "better_days": sum(1 for x in diff if x > 1e-9), "equal_days": sum(1 for x in diff if abs(x) <= 1e-9),
                     "bootstrap_1d": S.block_bootstrap(diff, 1), "bootstrap_7d": S.block_bootstrap(diff, 7)}
    print("PAIRED", out["paired"]["better_days"], out["paired"]["bootstrap_7d"], flush=True)
    json.dump(out, open(sys.argv[1], "w"), indent=1, default=str)


if __name__ == "__main__":
    main()
