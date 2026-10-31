# CRYPTOBOOKS-2 (2026-10-31): the XRP/GBP maker's rule, tested (rule.py). For BOOK (XRP-GBP; SOL-GBP as the second arm):
#  1. the plateau: d x theta x kappa x Q on the whole tape, read by week (in 10-17 -> 10-23, out 10-24 -> the end) and day;
#  2. the rule card's cell (CARD) under one change at a time: latency, loop period, adaptive distance, the stop, the
#     regime gate, a competitor ahead or reacting, the arbitrageur's delay, the capital, GBP/USD held constant, the
#     Binance staleness guard;
#  3. for each: P(mean <= 0) by a circular block bootstrap of days (3-day blocks) and of hours (12-hour blocks),
#     the worst hour, day and week, placements and cancels a day, and the split by the book's own regime
#     (best.regimes: an hour is "wide" when its taker orders paid a median 8 bps or more over the fair).
# Writes results/rule_<BOOK>.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> python3 -I xrp_study.py BOOK [TAG]
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair, Minutes  # noqa: E402
from replay import Book  # noqa: E402
from best import regimes  # noqa: E402
from rule import boot, sim  # noqa: E402

SPLIT = 1792800000  # 2026-10-24 00:00 UTC
DAY31 = 1793404800  # 2026-10-31 00:00 UTC
CARD = dict(d_min=14.0, theta=5.0, kappa=0.5, Q=200.0, cap=600.0)


def summ(r, reg, t_split=SPLIT):
    days = r["days"]
    dk = sorted(days)
    ins = [days[k] for k in dk if k < "2026-10-24"]
    out = [days[k] for k in dk if "2026-10-24" <= k < "2026-10-31"]
    d31 = [days[k] for k in dk if k >= "2026-10-31"]
    hrs = [v for h, v in r["hours"]]
    tight = [v for h, v in r["hours"] if reg.get(h, "tight") == "tight"]
    wide = [v for h, v in r["hours"] if reg.get(h) == "wide"]
    return {k: r[k] for k in ("a_day", "fills_a_day", "arb_fills", "stops", "placed_a_day", "cancels_a_day", "turnover_gbp_a_day",
                              "placed_max_a_second", "placed_max_a_minute",
                              "edge_bps", "inv_mean", "inv_max", "worst_hour", "worst_day", "worst_week")} | {
        "in_a_day": round(sum(ins) / len(ins), 3) if ins else None, "out_a_day": round(sum(out) / len(out), 3) if out else None,
        "d31_total": round(sum(d31), 2) if d31 else None,
        "days_pos": sum(1 for v in days.values() if v > 0), "days_n": len(days),
        "p_days": boot(list(days.values()), 3), "p_hours": boot(hrs, 12),
        "tight_a_day": round(24 * sum(tight) / len(tight), 3) if tight else None, "tight_hours": len(tight),
        "p_tight_hours": boot(tight, 12), "wide_an_hour": round(sum(wide) / len(wide), 3) if wide else None, "wide_hours": len(wide),
        "days": r["days"]}


def main(book, tag=""):
    fair = Fair()
    bk = Book(book, fair, tag=tag)
    reg = regimes(bk)
    out = {"book": book, "card": CARD, "tag": tag}
    # 1. the plateau
    grid = {}
    for d in (6, 8, 10, 12, 14, 16, 20):
        for th in (3, 5, 10, 15):
            for kap in (0.0, 0.5, 1.0):
                r = sim(bk, fair, d_min=d, theta=th, kappa=kap, Q=200.0, cap=600.0, t_to=DAY31)
                s = summ(r, reg)
                grid[f"d{d}_th{th}_k{kap}"] = {k: s[k] for k in ("a_day", "in_a_day", "out_a_day", "p_days", "placed_a_day", "cancels_a_day",
                                                                   "worst_day", "fills_a_day")}
        print(book, "plateau d", d, flush=True)
    out["plateau"] = grid
    for q in (50.0, 100.0, 300.0):
        r = sim(bk, fair, **(CARD | {"Q": q, "t_to": DAY31}))
        out.setdefault("size", {})[str(q)] = summ(r, reg) | {"days": None}
    # 2. one change at a time on the card
    variants = {
        "card": {}, "d12": {"d_min": 12.0}, "d16": {"d_min": 16.0},
        "penny": {"penny": True}, "penny_d10": {"penny": True, "d_min": 10.0}, "penny_d18": {"penny": True, "d_min": 18.0},
        "penny_no_arb": {"penny": True, "arb": False},
        "theta10": {"theta": 10.0}, "main_account_950": {"theta": 10.0, "budget": 950},
        "lat2_noarb": {"lat": 2, "arb": False}, "lat5_noarb": {"lat": 5, "arb": False}, "lat15_noarb": {"lat": 15, "arb": False},
        "lat2": {"lat": 2}, "lat5": {"lat": 5}, "lat15": {"lat": 15}, "lat60": {"lat": 60},
        "loop2": {"U": 2}, "loop5": {"U": 5}, "loop15": {"U": 15}, "loop60": {"U": 60, "theta": 0.0},
        "vol1": {"vol_k": 1.0}, "vol1.5": {"vol_k": 1.5}, "vol2": {"vol_k": 2.0}, "vol1.5_d8": {"vol_k": 1.5, "d_min": 8.0},
        "stop100": {"stop": 100.0}, "stop200": {"stop": 200.0}, "stop300": {"stop": 300.0},
        "gate4": {"gate": 4.0}, "gate6": {"gate": 6.0}, "gate8": {"gate": 8.0},
        "ahead100": {"ahead": 100.0}, "ahead500": {"ahead": 500.0}, "ahead2000": {"ahead": 2000.0},
        "react30_200": {"react": 30, "react_size": 200.0}, "react5_1000": {"react": 5, "react_size": 1000.0},
        "react30_5000": {"react": 30, "react_size": 5000.0},
        "no_arb": {"arb": False}, "arb5": {"x_arb": 5.0},
        "cap120": {"cap": 120.0, "Q": 40.0}, "cap1200": {"cap": 1200.0, "Q": 400.0},
        "stale10": {"stale_guard": 10}, "stale30": {"stale_guard": 30},
    }
    res = {}
    for name, kw in variants.items():
        r = sim(bk, fair, **(CARD | kw))
        res[name] = summ(r, reg)
        print(book, name, res[name]["a_day"], res[name]["out_a_day"], res[name]["p_days"], res[name]["placed_a_day"], flush=True)
    # GBP/USD held constant: rebuild the fair with a flat FX
    f2 = Fair()
    f2.fx = Minutes([(0, f2.fx.at(f2.t0))])
    f2._cache = {}
    bk2 = Book(book, f2, tag=tag)
    res["fx_const"] = summ(sim(bk2, f2, **CARD), reg)
    out["variants"] = res
    with open(os.path.join(ROOT, "results", f"rule_{book}{tag}.json"), "w") as f:
        json.dump(json.loads(json.dumps(out)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "")
