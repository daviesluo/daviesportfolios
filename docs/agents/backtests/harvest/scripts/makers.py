"""HARVEST: who rested the orders the late takers met — the maker sample (`maker_pull.py`), per category.

For every taker row at or after C + 60 s in a sampled market, classified as Mode A or Mode B (harvest.classify), the
maker rows of the same fill (same transaction and second) are the resting orders it met. Reported per category and
mode: the distinct maker wallets, the largest maker's share of the shares filled, the three largest makers' share,
the makers per market (median), and for Mode B the share of fills at W prices of 0.999 and above. It bounds what a new
maker could expect in the queue: when one or two wallets fill most of the late flow, a newcomer at the same price is
behind them; stepping a tick ahead is the only way in (the TICK-B ceiling).

usage: makers.py <maker sample json.gz> <out json>
"""
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402
from harvest import classify, q, r2  # noqa: E402


def main():
    sample = H.jfile(sys.argv[1])
    out = {}
    for cat in sorted(sample):
        agg = {m: {"shares": defaultdict(float), "per_market": [], "fills": 0, "at_0999": 0.0, "tot": 0.0,
                   "edge": defaultdict(float)} for m in ("A", "B")}
        for cond in sorted(sample[cat]):
            x = sample[cat][cond]
            u = x["unit"]
            by_tx = defaultdict(list)
            for r in x["rows"]:
                by_tx[(r[0], r[7])].append(r)
            mk_m = {"A": set(), "B": set()}
            for key in sorted(by_tx):
                rows = by_tx[key]
                takers = [r for r in rows if r[1] == 1]
                makers = [r for r in rows if r[1] == 0]
                if key[0] < u["C"] + 60 or not takers or not makers:
                    continue
                t = takers[0]
                k = classify(u, [t[0], t[2], t[3], t[4], t[5], t[6]])
                if not k:
                    continue
                mode, px = k[0], k[1]
                A = agg[mode]
                A["fills"] += 1
                for m in makers:
                    A["shares"][m[6]] += m[5]
                    A["edge"][m[6]] += (1.0 - px) * m[5] if mode == "B" else 0.0
                    mk_m[mode].add(m[6])
                    A["tot"] += m[5]
                    if mode == "B" and px >= 0.999 - 1e-9:
                        A["at_0999"] += m[5]
            for m in ("A", "B"):
                if mk_m[m]:
                    agg[m]["per_market"].append(len(mk_m[m]))
        res = {}
        for m, A in agg.items():
            sh = sorted(A["shares"].values(), reverse=True)
            tot = sum(sh)
            res[m] = {"fills": A["fills"], "maker_wallets": len(sh),
                      "top1_share": round(sh[0] / tot, 4) if tot else None,
                      "top3_share": round(sum(sh[:3]) / tot, 4) if tot else None,
                      "makers_per_market_p50": q(A["per_market"], 0.5),
                      "markets": len(A["per_market"])}
            if m == "B":
                ed = sorted(A["edge"].values(), reverse=True)
                res[m]["share_of_shares_at_0999_plus"] = round(A["at_0999"] / tot, 4) if tot else None
                res[m]["top1_share_of_edge"] = round(ed[0] / sum(ed), 4) if ed and sum(ed) > 0 else None
                res[m]["edge_usd"] = r2(sum(ed))
        out[cat] = {"markets_sampled": len(sample[cat]), "from_C_plus_s": 60, **res}
        print(cat, out[cat])
    H.write_json(sys.argv[2], out)


if __name__ == "__main__":
    main()
