"""CB-LIVE-RULES: is "Stablecoin quotes with Euros - 2" the rule set to take live on Coinbase, and what should change first?
Davies, 2026-10-29: "Coinbase做好实盘搭建并且准备with Euros - 2这个策略的live上线（你也可以先研究下coinbase还有没有别的改进空间，确保这个策略一切最优）".

THE BASELINE is "- 2" as it runs (cb_nudge.ts on cb_usdc.ts' driver): USDC-GBP alone, six $50 rungs (0.1 / 0.2 / 0.3 % a side),
PR5's re-price at 0.05 %, exits at fair, the 24-hour taker stop (Coinbase's 0.0045 % plus half the touch), the coin at
`cb_live` with its de-peg guard, the rate as `cb_fx.ts` reads it (Exness at t + 57 s, FX-SPEED-LONG's L3_raw), held through a
closure up to 60 hours, the release blackout [T − 1, T + 5], and the Revolut X nudge inside closures where Revolut X's
USDC-GBP book is recorded (from 2026-10-09; before that the fair is un-nudged, which is then the rule exactly). The record is
CMP-CB's (`compare/cb/scripts/cb_compare.py`'s `Book`): Coinbase's minute bars 2024-10-01 → 10-08, then the engines' own
minute record 10-10 → 10-28. A rung is dollars, so the simulator's X is the book currency's dollar rate; P&L in pounds at the
exit minute's GBP/USD.

THE CANDIDATES change one thing each (`CANDS`), then the combination named in the review after the first pass (`COMBO`). The
simulator is `vsim.vsim`, PR5's frozen `simulate` with its constants as parameters, checked to be that function at its
defaults (`vsim.check`, run first, on the baseline's own inputs).
usage: python3 -I cb_rules.py EXNESS_LONG.txt.gz OUT.json.gz
"""
import datetime, gzip, json, multiprocessing as mp, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "compare", "cb", "scripts"))
import numpy as np  # noqa: E402
import cb_compare as K  # noqa: E402
import vsim as V  # noqa: E402

CL, C, P, EL = K.CL, K.C, K.P, K.EL
M, DAY = K.M, K.DAY
T0, T1 = K.T0, K.T1
RX_FROM = K.TH          # Revolut X's USDC-GBP book is read from 2026-10-09
TOUCH0 = CL.TP0["base"]  # the recorder's touch from 2026-10-10

# one change at a time against the baseline: (book, fair variant, vsim options, rung $)
D6 = [("bid", k, 1.0) for k in (0.001, 0.002, 0.003)] + [("ask", k, 1.0) for k in (0.001, 0.002, 0.003)]
def rungs(ks_bid, ks_ask, w_bid=None, w_ask=None):
    wb = w_bid or [1.0] * len(ks_bid); wa = w_ask or [1.0] * len(ks_ask)
    return [("bid", k, w) for k, w in zip(ks_bid, wb)] + [("ask", k, w) for k, w in zip(ks_ask, wa)]

CANDS = {
    "base": ("USDC-GBP", "nudge", {}, 50),
    # the fair
    "nudge_off": ("USDC-GBP", "hold", {}, 50),
    "nudge_all": ("USDC-GBP", "nudge_all", {}, 50),
    "weekend_dark": ("USDC-GBP", "dark", {}, 50),
    "blackout_off": ("USDC-GBP", "nudge_noblk", {}, 50),
    "blackout_wide": ("USDC-GBP", "nudge_wideblk", {}, 50),
    # orders
    "reprice_0.025": ("USDC-GBP", "nudge", {"reprice": 0.00025}, 50),
    "reprice_0.1": ("USDC-GBP", "nudge", {"reprice": 0.001}, 50),
    "exit_1tick": ("USDC-GBP", "nudge", {"exit_off": 1}, 50),
    "exit_2tick": ("USDC-GBP", "nudge", {"exit_off": 2}, 50),
    "stop_12h": ("USDC-GBP", "nudge", {"stop_min": 720}, 50),
    "stop_48h": ("USDC-GBP", "nudge", {"stop_min": 2880}, 50),
    "stop_7d": ("USDC-GBP", "nudge", {"stop_min": 10080}, 50),
    # rungs, the same $300 in all (weights sum to 6)
    "rungs_no01": ("USDC-GBP", "nudge", {"rungs": rungs([0.002, 0.003], [0.002, 0.003], [1.5, 1.5], [1.5, 1.5])}, 50),
    "rungs_no03": ("USDC-GBP", "nudge", {"rungs": rungs([0.001, 0.002], [0.001, 0.002], [1.5, 1.5], [1.5, 1.5])}, 50),
    "rungs_add005": ("USDC-GBP", "nudge", {"rungs": rungs([0.0005, 0.001, 0.002, 0.003], [0.0005, 0.001, 0.002, 0.003], [0.75] * 4, [0.75] * 4)}, 50),
    "rungs_add04": ("USDC-GBP", "nudge", {"rungs": rungs([0.001, 0.002, 0.003, 0.004], [0.001, 0.002, 0.003, 0.004], [0.75] * 4, [0.75] * 4)}, 50),
    "rungs_only01": ("USDC-GBP", "nudge", {"rungs": rungs([0.001], [0.001], [3.0], [3.0])}, 50),
    "weights_near": ("USDC-GBP", "nudge", {"rungs": rungs([0.001, 0.002, 0.003], [0.001, 0.002, 0.003], [1.5, 1.0, 0.5], [1.5, 1.0, 0.5])}, 50),
    "weights_far": ("USDC-GBP", "nudge", {"rungs": rungs([0.001, 0.002, 0.003], [0.001, 0.002, 0.003], [0.5, 1.0, 1.5], [0.5, 1.0, 1.5])}, 50),
    # the ask side holds the coin (a dollar position): fewer asks, less of it
    "asks_one": ("USDC-GBP", "nudge", {"rungs": rungs([0.001, 0.002, 0.003], [0.001])}, 50),
    "bids_only": ("USDC-GBP", "nudge", {"rungs": rungs([0.001, 0.002, 0.003], [])}, 50),
    "asks_only": ("USDC-GBP", "nudge", {"rungs": rungs([], [0.001, 0.002, 0.003])}, 50),
    # the second book
    "eur": ("USDC-EUR", "hold", {}, 50),
}
# size × queue: rung $50 / $100 / $200 / $400 (capital $300 → $2,400), the fill cap at 10 / 5 / 2 % of the minute, and a
# level that must clear by a tick
for usd in (50, 100, 200, 400):
    for qn, q in (("q10", {}), ("q5", {"share": 0.05}), ("q2", {"share": 0.02}), ("q10t1", {"thr": 1})):
        CANDS[f"size{usd}_{qn}"] = ("USDC-GBP", "nudge", q, usd)
        CANDS[f"eur_size{usd}_{qn}"] = ("USDC-EUR", "hold", q, usd)

COMBO = {}   # filled from the review's §4 after the first pass (see `combos` in main)

BOOKS = {}   # book -> dict of inputs, built in the parent and shared by fork


def nudge(ts, F, rx, scope):
    """`nudgeStep` (cb_nudge.ts) with scope "closures" or "all"."""
    ema, last, out = None, None, []
    for t, f in zip(ts, F):
        mid = rx.get(t)
        if not f or not mid:
            out.append(f); continue
        g = mid - f
        ema = g if (ema is None or last is None) else ema + (1 - 0.5 ** ((t - last) / M / 1440)) * (g - ema)
        last = t
        d = g - ema
        on = scope == "all" or CL.in_quote_closure(t)
        out.append(f + 0.5 * d if (on and abs(d / f) < 0.005) else f)
    return out


def build(b):
    tick = C.TICK[b]
    B = K.Book(b, tick)
    n = B.n
    i0 = (T0 - EL.FROM) // M
    pair = CL.PAIR[C.QUOTE[b]]
    sz = CL.sizing()
    B.X = [float(v) for v in sz[pair][i0:i0 + n]]                 # dollars per unit of the book's currency
    ut, uv = CL.usdt_minutes()
    rx_h = K.revx_hours_all()[C.COIN[b]]
    ts = [T0 + i * M for i in range(n)]
    U = CL.coin_value(C.COIN[b], ts, ut, uv, C.F3(rx_h), rx_h[0][0] + DAY)
    rel = CL.releases()
    blk = CL.blackout_mask(T0, n, rel)
    wide = np.zeros(n, dtype=bool)
    for T in rel:
        for i in range((T - 5 * M - T0) // M, (T + 15 * M - T0) // M + 1):
            if 0 <= i < n:
                wide[i] = True
    fairs = {}
    for name, hold in (("hold", True), ("dark", False)):
        X = CL.x_columns(pair, hold)[0]["L3_raw"][i0:i0 + n]
        base = [None if (U[i] is None or np.isnan(X[i])) else U[i] / float(X[i]) for i in range(n)]
        fairs[name] = [None if blk[i] else base[i] for i in range(n)]
        if hold:
            fairs["noblk"] = base
            fairs["wideblk"] = [None if wide[i] else base[i] for i in range(n)]
    if b == "USDC-GBP":
        rx = CL.rx_mids()
        fairs["nudge"] = nudge(ts, fairs["hold"], rx, "closures")
        fairs["nudge_all"] = nudge(ts, fairs["hold"], rx, "all")
        fairs["nudge_noblk"] = nudge(ts, fairs["noblk"], rx, "closures")
        fairs["nudge_wideblk"] = nudge(ts, fairs["wideblk"], rx, "closures")
    half = json.load(open(os.path.join(BT, "scq_venues", "inputs", "touch.json")))["coinbase:" + b]["half_spread"]
    return {"B": B, "fairs": fairs, "tick": tick, "half": half, "gbp": sz["GBPUSD"][i0:i0 + n], "ts0": T0}


def run(name, spec):
    b, fv, opts, usd = spec
    d = BOOKS[b]
    B = d["B"]
    B.F = d["fairs"][fv]
    saved = (P.TICK, P.FEE, P.HALF_SPREAD)
    gl = [] if name in ("base", "eur") else None
    try:
        P.TICK, P.FEE, P.HALF_SPREAD = d["tick"], CL.TAKER, d["half"]
        tr, orders = V.vsim(B, P, size=float(usd), golive=gl, **opts)
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD = saved
    g = d["gbp"]
    out = [[x["t_entry"], x["t_exit"], round(x["pnl_usd"] / g[(x["t_exit"] - T0) // M], 6), round(x["notional_usd"], 4), x["how"][0], x["side"][0], x["k"]]
           for x in tr]
    extra = {"orders": int(sum(orders.values()))}
    if gl is not None:
        extra["golive"] = [list(r) for r in gl if r[0] >= TOUCH0]
    return name, out, extra


def task(name):
    return run(name, ALL[name])


ALL = {}


def main(ex_path, out_path, combos_path=None):
    global ALL
    CL.EX = EL.Long(ex_path)
    for b in ("USDC-GBP", "USDC-EUR"):
        BOOKS[b] = build(b)
        print("built", b, flush=True)
    # vsim at its defaults is pr5_sim.simulate, on the baseline's own inputs
    d = BOOKS["USDC-GBP"]
    d["B"].F = d["fairs"]["nudge"]
    saved = (P.TICK, P.FEE, P.HALF_SPREAD)
    P.TICK, P.FEE, P.HALF_SPREAD = d["tick"], CL.TAKER, d["half"]
    n_check = V.check(d["B"], P, 50.0)
    P.TICK, P.FEE, P.HALF_SPREAD = saved
    print("vsim == pr5_sim.simulate on", n_check, "trips", flush=True)
    ALL = dict(CANDS)
    if combos_path:                          # the second pass: the baseline again and the combinations alone
        ALL = {"base": CANDS["base"]}
        for k, v in json.load(open(combos_path)).items():
            ALL[k] = (v[0], v[1], {kk: ([tuple(r) for r in vv] if kk == "rungs" else vv) for kk, vv in v[2].items()}, v[3])
    with mp.get_context("fork").Pool(4) as pool:
        res = pool.map(task, list(ALL))
    out = {"window": {"T0": T0, "T1": T1}, "check_trips": n_check, "specs": {k: [v[0], v[1], v[2], v[3]] for k, v in ALL.items()},
           "runs": {k: tr for k, tr, _ in res}, "extra": {k: e for k, _, e in res}}
    json.dump(out, gzip.open(out_path, "wt"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
