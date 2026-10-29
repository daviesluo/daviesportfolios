"""Part 3c of the fair-price study: inventory skew. The entry rungs are priced around fair × (1 − s × net), where net is the
number of rungs holding a long (filled bids) less the number holding a short (filled asks) at the turn; exits stay at the
unskewed fair. So a book that holds coins quotes both its entries lower (buys less readily, sells more readily), and one that
is short quotes them higher. s is in bps per rung held: 0, 0.5, 1, 2, 3.

`gsim` is PR5's frozen `pr5_sim.simulate`, its source read from the frozen file and edited in exactly two places (each edit
must match once): the skewed fair is computed after the minute's fair, and the entry branch reads it instead of the fair.
With s = 0 it is the frozen simulator: every book's trips are asserted equal to `simulate`'s. Books, inputs, windows and costs
are hist.py's (the engine's fair and the cb_own + 6 h basis fair, both arms).
usage: python3 -I skew.py OUT.json.gz
"""
import gzip, inspect, json, multiprocessing as mp, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hist as HI  # noqa: E402
P = HI.P
SKEWS = [0.0, 0.00005, 0.0001, 0.0002, 0.0003]
BASES = ["engine", "cb_own+b6h_1.0", "hold:engine", "hold:cb_own+b6h_1.0"]


def make_gsim():
    src = inspect.getsource(P.simulate)
    a = '        f = B.F[i]\n'
    assert src.count(a) == 1
    src = src.replace(a, a + '        net = sum(1 if r["side"] == "bid" else -1 for r in rungs if r["mode"] == "position")\n'
                            '        fe = None if f is None else f * (1 - SKEW * net)\n')
    start = src.index('            if r["mode"] in ("idle", "quote"):')
    end = src.index('            elif r["mode"] == "position":')
    block = src[start:end]
    nb, k = re.subn(r"\bf\b", "fe", block)
    assert k == 9, k                     # the entry branch's nine reads of f (checked by hand against the frozen source)
    src = src[:start] + nb + src[end:]
    src = src.replace("def simulate(", "def gsim(", 1)
    ns = dict(vars(P))
    exec(compile(src, "gsim", "exec"), ns)
    return ns


def task(key):
    B, S = HI.build(key)
    hours = {"revx": HI.revx_hours(), "screen": {c: v for c, v in HI.CI.load_usd().items() if c in ("USDC", "USDT")}}
    half = json.load(open(os.path.join(HI.BT, "scq_venues", "inputs", "touch.json")))[key]["half_spread"]
    fs = HI.fairs(S, hours)
    ns = make_gsim()
    out = {}
    saved = (P.TICK, P.FEE, P.HALF_SPREAD)
    try:
        P.TICK, P.FEE, P.HALF_SPREAD = S["tick"], HI.TAKER, half
        ns["TICK"], ns["FEE"], ns["HALF_SPREAD"] = S["tick"], HI.TAKER, half
        for base in BASES:
            B.F, B.X = fs[base]
            for s in SKEWS:
                ns["SKEW"] = s
                tr, orders = ns["gsim"](B, size=100.0)
                if s == 0.0:
                    ref, _ = P.simulate(B, size=100.0)
                    assert [(x["t_entry"], x["t_exit"], x["pnl_usd"]) for x in tr] == [(x["t_entry"], x["t_exit"], x["pnl_usd"]) for x in ref], (key, base)
                out[f"{base}|skew{round(s * 1e4, 1)}"] = {"orders": sum(orders.values()), "trips": [[x["t_entry"], x["t_exit"], round(x["pnl_usd"], 6), round(x["notional_usd"], 4), x["how"][0], x["side"][0], x["k"]] for x in tr]}
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD = saved
    print("done", key, flush=True)
    return key, out


def main(out):
    with mp.Pool(4) as pool:
        rs = pool.map(task, HI.KEYS)
    json.dump({"window": {"T0": HI.T0, "TS": HI.TS, "T1": HI.T1}, "books": {k: {"runs": r, "meta": {}} for k, r in rs}}, gzip.open(out, "wt"))


if __name__ == "__main__":
    main(sys.argv[1])
