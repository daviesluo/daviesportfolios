"""Variant-2's first engine read TrueFX about two minutes after the turn it decided: what that look-ahead is worth.

`quotes_ruled.ts` as committed on 2026-09-28 (`185b9fa`) read TrueFX once a call, at the call's clock, and gave it to
every minute of the call decided within three minutes of that clock. The call is a row of `edge-calls-every-minute`,
fired at :00, while PR5's engine waits until :25 to decide the minute before; so at m + ~1 s the call finds PR5's last
minute at m − 2 and decides that minute, t = m − 2, with a rate read at about t + 121 s. Arm d's turn at t is meant to
use data to t − 1 (its pre-registration's §2), and a re-price at that turn pulls the quote for the whole of minute t, so
the first engine chose which quotes rest through minute t (and priced the ones live from t + 1) on a rate from after
both minutes.

This prices that on the fast-X study's own days (the 28 days 2026-08-26 -> 09-23 and the fresh 09-23 -> 09-28), with
the study's engine (`fastx_sim.simulate`, rule D = {"frac": 1/3, "away": None}) at PR5V's REF timing, and GBP/USD from
Dukascopy's committed minute closes (`inputs/pr5v_fastx_2026-09-28/dukascopy_GBPUSD_1m_closes.json.gz`, the mid of each
minute's last tick), read at four instants relative to the turn at t:

    DUK_LA120  the close of [t+1m, t+2m): the rate about two minutes after the turn (the first engine, as it ran)
    DUK_LA60   the close of [t, t+1m): one minute after (the first engine, had the call found PR5 already done)
    DUK_M0     the close of [t-1m, t): the rate at the turn (no source can do better at this timing)
    DUK_C59    the close of [t-2m, t-1m): the rate a minute before the turn (a snapshot read in minute t-1: the fix)

X is dark whenever the study's own X is dark at REF timing (fastx.py's mask), so every series quotes on the same
minutes. Variant-1 is PR5V's arm `main` (`rec/ref`) on the study's own X (Exness for the 28 days, Yahoo for the fresh
five), which is what PR5V's engine replays. Before any new number, rule D and variant-1 on the study's own X reproduce
the pre-registration's §1 (593 trips $30.3004, 60 trips $3.7420; 563 trips $29.5129, 40 trips $2.5438).

    python3 docs/agents/scripts/pr5v/lookahead.py docs/agents/backtests/pr5v/lookahead.json
"""
import gzip, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import study as S  # noqa: E402  (frozen)
import fastx as FX  # noqa: E402

M = S.V.M
N0, N1, F0, F1 = S.N0, S.N1, S.F0, S.F1
CLOSES = os.path.join(S.ROOT, "docs/agents/backtests/inputs/pr5v_fastx_2026-09-28/dukascopy_GBPUSD_1m_closes.json.gz")
LAGS = {"DUK_LA120": -2 * M, "DUK_LA60": -M, "DUK_M0": 0, "DUK_C59": 59_000}
OWN = {"N": "EXN_M60/0", "F": "YAH_M60/0"}
V1 = "rec/ref"
RD = dict(FX.ARMS["rec/ref"], rule=FX.RULES["D"])
EXPECT = {("N", "rd"): (593, 30.3004), ("F", "rd"): (60, 3.7420), ("N", "v1"): (563, 29.5129), ("F", "v1"): (40, 2.5438)}


class Data(FX.Data):
    """The study's markets, with X from the committed minute closes at the lags above (no raw ticks needed)."""

    def __init__(self):
        FX.Data.__init__(self, ticks=False)
        self.closes = [(int(a), float(b)) for a, b in json.load(gzip.open(CLOSES))["rows"]]

    def _build(self, name):
        if name in LAGS:
            return FX.minute_series(name, self.closes, LAGS[name])
        return FX.Data._build(self, name)


def main():
    out_fn = sys.argv[1]
    D = Data()
    O = {"question": "what variant-2's first engine gained by reading GBP/USD about two minutes after the turn it decided",
         "series": {k: v // 1000 for k, v in LAGS.items()}, "own_x": OWN,
         "sha256": {"lookahead.py": FX.sha(os.path.abspath(__file__)), "fastx.py": FX.sha(os.path.join(HERE, "fastx.py")),
                    "fastx_sim.py": FX.sha(os.path.join(HERE, "fastx_sim.py")), "study.py": FX.sha(os.path.join(HERE, "study.py")),
                    "pr5v_sim.py": FX.sha(os.path.join(HERE, "pr5v_sim.py")), "closes": FX.sha(CLOSES)},
         "runs": {}, "paired": {}}
    daily = {}
    for span in ("N", "F"):
        a, b = (N0, N1) if span == "N" else (F0, F1)
        for xname in [OWN[span], *LAGS]:
            for arm_name, arm in (("v1", V1), ("rd", RD)):
                t = time.time()
                res = FX.run(D, span, xname, arm)
                sm = S.summary(res, span)
                w = "N28" if span == "N" else "FRESH"
                key = f"{span}|{'own' if xname == OWN[span] else xname}|{arm_name}"
                O["runs"][key] = {"trips": sm[w]["trips"], "pnl_usd": sm[w]["pnl_usd"], "usd_per_day": sm[w]["usd_per_day"],
                                  "worst_day_usd": sm[w]["worst_day_usd"], "posts_per_day": sm["orders"].get("all", {}).get("mean")}
                daily[key] = S.daily(res["trips"], a, b)
                print(key, O["runs"][key]["trips"], O["runs"][key]["pnl_usd"], O["runs"][key]["usd_per_day"], f"{time.time() - t:.0f}s", flush=True)
        for arm_name in ("rd", "v1"):
            n, p = EXPECT[(span, arm_name)]
            r = O["runs"][f"{span}|own|{arm_name}"]
            ok = r["trips"] == n and abs(r["pnl_usd"] - p) < 5e-4
            O.setdefault("repro", {})[f"{span}|{arm_name}"] = {"got": [r["trips"], r["pnl_usd"]], "expected": [n, p], "PASS": ok}
            if not ok:
                json.dump(O, open(out_fn, "w"), indent=1)
                raise SystemExit(f"reproduction FAILED for {span}|{arm_name}: no new number is reported")
        base = daily[f"{span}|own|v1"]
        for xname in ["own", *LAGS]:
            for arm_name in ("rd", "v1"):
                key = f"{span}|{xname}|{arm_name}"
                if key == f"{span}|own|v1":
                    continue
                diff = [round(x - y, 6) for x, y in zip(daily[key], base)]
                O["paired"][f"{key} - {span}|own|v1"] = {
                    "days": len(diff), "mean_usd_per_day": round(sum(diff) / len(diff), 4),
                    "better_days": sum(1 for x in diff if x > 1e-9), "worse_days": sum(1 for x in diff if x < -1e-9),
                    "bootstrap_7d": S.block_bootstrap(diff, 7) if span == "N" else None}
    json.dump(O, open(out_fn, "w"), indent=1)
    for k, v in O["paired"].items():
        print("PAIRED", k, v["mean_usd_per_day"], v["better_days"], v["worse_days"], (v["bootstrap_7d"] or {}), flush=True)


if __name__ == "__main__":
    main()
