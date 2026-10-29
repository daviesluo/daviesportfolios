"""FX-SPEED part 2: Revolut X, LIVE's rules at £600, with a faster GBP/USD than Yahoo's bar.

The engine is PR5-OPT's LIVE-realistic replay (`pr5_opt/scripts/sim.py`), imported unchanged, as REVX-FAIR ran it
(`fair_price/scripts/replay.py`, whose window, statistics and books this imports): PR5's `stepMinute` line for line, the
executor resting each paper minute t's orders from t + 90 s, LIVE's "at" fill and PR5's "through", weekends on the held X.
A candidate changes one thing, X, through the engine's `fair_adj` hook: fair = fairU / X_candidate (`fast.py`), wherever
the minute was priced on a live X; a minute priced on the held X inside a closure keeps it (Exness has no closure ticks).

Window FWD 2026-09-26 → 10-29 (33 days), halves at 10-12; paired with today's X by UTC day, 3-day circular block bootstrap
(10,000, seed 20261029), as REVX-FAIR. Nothing is fitted: L2 (the source read 2 s before the order goes live) is the primary
named before any run (the recorder's TrueFX arrives a median 1.4 s after its own stamp); the other L show the shape.
`yahoo_adj` passes the stored X back through the hook and must equal the base trip for trip (checked).

usage: python3 -I revx.py OUT.json      (about five minutes)
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "fair_price", "scripts"))
sys.path.insert(0, os.path.join(BT, "fair_price_cb_okx", "scripts"))
import replay as RP  # noqa: E402  (REVX-FAIR's runner, scoring and the engine it imports, read-only)
import fp_data as D  # noqa: E402
import fpc as C  # noqa: E402
import fast as F  # noqa: E402

M = D.M
GOLIVE_S = 90


def yahoo_gbp(mins):
    """Yahoo's GBP/USD bars by label: the PR5 minute record's X of minute t is the bar labelled t − 1; then the stored bars."""
    y = {}
    for t, x, fu, lag in mins["USDC-GBP"]:
        if x: y[t - M] = x
    ts, vs = C.load_fx()["GBPUSD"]
    for t, v in zip(ts, vs):
        y.setdefault(t, v)
    return y


def main(out):
    mins = D.load_minutes(); prints = D.load_prints()
    mins3 = {b: [(t, x, fu) for (t, x, fu, lag) in v] for b, v in mins.items()}
    rec = {b: {t: (x, fu) for t, x, fu, lag in v} for b, v in mins.items()}
    fast = F.Fast({"GBPUSD": yahoo_gbp(mins)})
    win, split = RP.FWD, RP.FWD_SPLIT

    def adj_for(rel, aligned):
        cache = {}

        def adj(b, t, f):
            x, fu = rec[b].get(t, (None, None))
            if not x or not fu or D.closure(t):
                return f                                   # held X in a closure, or no live X: unchanged
            if t not in cache:
                cache[t] = fast.x("GBPUSD", t, rel, aligned)
            xc = cache[t]
            return fu / xc if xc else f
        return adj

    cands = {"yahoo_adj": lambda b, t, f: (rec[b][t][1] / rec[b][t][0]) if (rec[b].get(t) and rec[b][t][0] and rec[b][t][1] and not D.closure(t)) else f}
    ins = F.instants(GOLIVE_S)
    for name, rel in ins.items():
        cands[f"{name}|aligned"] = adj_for(rel, True)
    for name in ("ex_ytime", "L2"):
        cands[f"{name}|raw"] = adj_for(ins[name], False)
    res = {"window": ["2026-09-26", "2026-10-29", "2026-10-12"], "golive_s": GOLIVE_S, "instants_rel_t_s": ins, "runs": {}}
    for fill in ("at", "through"):
        base, rf = RP.one(mins3, prints, win, fill, None)
        res["runs"][f"yahoo|{fill}"] = RP.summary(base, rf, win)
        for name, adj in cands.items():
            tr, rf2 = RP.one(mins3, prints, win, fill, adj)
            r = RP.summary(tr, rf2, win)
            r.update(RP.paired(base, tr, win, split))
            if name == "yahoo_adj":
                r["identical_to_base"] = [(a["tEntry"], a["tExit"], round(a["pnl"], 9)) for a in base] == [(a["tEntry"], a["tExit"], round(a["pnl"], 9)) for a in tr]
            res["runs"][f"{name}|{fill}"] = r
            print(name, fill, r["bpsDay"], r["diffBpsDay"], r["boot90_pLe0"], r["h1"], r["h2"], r["trips"], r["stops"], r["perTripBps"], flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1])
