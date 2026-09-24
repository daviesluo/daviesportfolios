"""FAV, descriptive only (not a test, not pre-registered): how much of the loss is the fill? (fp4)

Re-prices the primary's out-of-sample trades (fav_test.py's own candidates, h = 24 h)
as if every fill had been at the price the site showed at the decision time — a
price M3b shows could not be traded — and at that price plus one tick, keeping
each trade's shares, payout and fee rate. Prints one JSON line; trades nothing.

usage: fav_shown_price.py <inputs .json.gz>
"""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import fav_test  # noqa: E402


def at(c, px):
    return sum(q * (c["payout"] - px) - c["r"] * px * (1 - px) * q for _, _, q in c["fills"])


def main():
    with gzip.open(sys.argv[1], "rb") as f:
        markets = json.loads(f.read())["markets"]
    trades, _ = fav_test.candidates(markets, "24", fav_test.STAKE)
    oos = [c for c in trades if fav_test.window(c["end"]) in ("OOS1", "OOS2")]
    sh = sum(fav_test.shares_of(c) for c in oos)
    out = {"oos_trades": len(oos),
           "mean_fill": round(sum(fav_test.cost_of(c) for c in oos) / sh, 6),
           "mean_shown_price": round(sum(c["pf"] * fav_test.shares_of(c) for c in oos) / sh, 6),
           "pnl_at_fills": round(sum(fav_test.pnl(c) for c in oos), 6),
           "pnl_at_shown_price": round(sum(at(c, c["pf"]) for c in oos), 6),
           "pnl_at_shown_price_plus_tick": round(sum(at(c, c["pf"] + c["tick"]) for c in oos), 6)}
    for lo, hi in ((0.90, 0.95), (0.95, 0.99)):
        b = [c for c in oos if lo <= c["pf"] < hi]
        out[f"band_{lo:.2f}_{hi:.2f}"] = {"trades": len(b), "at_fills": round(sum(fav_test.pnl(c) for c in b), 6),
                                           "at_shown_price": round(sum(at(c, c["pf"]) for c in b), 6)}
    print(json.dumps(out, sort_keys=True))


if __name__ == "__main__":
    main()
