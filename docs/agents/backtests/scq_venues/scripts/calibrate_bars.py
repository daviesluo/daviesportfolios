"""Proof that minute bars lose nothing PR5's simulator reads: CJ5's committed CoinJar prints (both books, whole record)
run through `VBook` (the prints) and `BarBook` (their bars) give equal trips in every arm, at £10 and £100 a rung, but
`side_aware` (CoinJar's auction prints, which bars count with the buys; no other venue here has them). The committed
encoding (sv_inputs.py: no intra-minute time, volume to 0.01) is run too, `*_committed_encoding`, and its P&L compared.
usage: python3 -I calibrate_bars.py   -> ../results/calibrate_bars.json
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "../../cj5/scripts")))
import bars as BR  # noqa: E402
import inputs as I  # noqa: E402
import cj5_sim as C  # noqa: E402


def main():
    fx_t, fx_v = I.load_fx()
    usd = I.load_usd()
    cfg = I.load_config()
    BR.P.FEE = cfg["taker_fee"]
    out = {}
    saved = BR.P.through
    for b in I.PRODUCTS:
        BR.P.HALF_SPREAD = cfg["half_spread"][b]
        hours = usd[I.COIN[b]]
        pf = I.load_prints_full(b)
        args = (pf, b, C.START[b], C.END, fx_t, fx_v, [h[0] for h in hours], [h[1] for h in hours])
        r = BR.check_equivalence(*args, sizes=(10.0, 100.0), arms=("through", "stress", "side_aware", "full_size"))
        BR.P.through = lambda side, price, q, thr: (q <= price) if side == "bid" else (q >= price)
        r.update({k + "_at_price": v for k, v in BR.check_equivalence(*args, sizes=(100.0,), arms=("through",)).items()})
        BR.P.through = saved
        r.update({k + "_committed_encoding": v for k, v in BR.check_equivalence(*args, sizes=(10.0, 100.0), arms=("through",), encode=True).items()})
        out[b] = r
        print(b, json.dumps(r), flush=True)
    out["all_equal_but_side_aware"] = all(v["equal"] for b in I.PRODUCTS for k, v in out[b].items() if not k.startswith("side_aware") and "committed" not in k)
    json.dump(out, open(os.path.join(HERE, "..", "results", "calibrate_bars.json"), "w"), indent=1, sort_keys=True)
    print("all_equal_but_side_aware", out["all_equal_but_side_aware"])


if __name__ == "__main__":
    main()
