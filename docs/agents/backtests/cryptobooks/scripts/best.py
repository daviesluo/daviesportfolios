# CRYPTOBOOKS (2026-10-31): the realistic replay of the best candidates (replay.py), out of sample.
# For each book: the grid d (bps from the fair) x THETA (re-price step) x KAPPA (inventory skew) at a third of the capital
# a quote, target 0 (it sells only what it bought), U = 1 s, with the pessimistic arbitrageur on (it takes any of our
# quotes 10 bps beyond the true fair at once), 950 orders a UTC day (one account's 1,000; once spent nothing rests
# until midnight; a variant with two of Davies' own sub-accounts, 1,900). The cell with the best
# total on 2026-10-17 -> 10-23 (in) is read on 10-24 -> the tape's end (out), with the variants: no arbitrageur, one that
# waits 15 s, the loop's minute (U = 60), half the eligible fills (SHARE 0.5, for queue and competition), a 10 bps
# Binance hedge of every fill (b), and twice the capital. The out-of-sample hours give P(mean <= 0) by a block bootstrap
# (12-hour blocks), and each hour is labelled by the book's own regime: "wide" when its taker orders paid a median 8 bps
# or more over the outside fair (the tight inner layer away), else "tight".
# Writes results/best.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> python3 -I best.py BOOK...
import collections, json, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair  # noqa: E402
from replay import Book, boot_p, run, summary  # noqa: E402

SPLIT = 1792800000  # 2026-10-24 00:00 UTC
WIDE_BPS = 8.0
BUDGET = 950  # orders a UTC day: one account's 1,000 less a margin; once spent, nothing rests until midnight


def regimes(bk):
    """Hour -> 'wide' / 'tight' from the hour's taker orders against the outside fair of the second before."""
    by = collections.defaultdict(list)
    for ms, side, prints in bk.orders:
        sec = ms // 1000
        i = sec - 1 - bk.t0
        if 0 <= i < len(bk.F):
            p = sum(x[0] * x[1] for x in prints) / sum(x[1] for x in prints)
            by[sec // 3600].append(side * 1e4 * math.log(p / bk.F[i]))
    return {h: ("wide" if len(v) >= 3 and statistics.median(v) >= WIDE_BPS else "tight") for h, v in by.items()}


def main(books):
    fair = Fair()
    path = os.path.join(ROOT, "results", "best.json")
    res = json.load(open(path)) if os.path.exists(path) else {}
    for name in books:
        bk = Book(name, fair)
        if not bk.orders or not bk.steps:
            continue
        reg = regimes(bk)
        grid = {}
        for d in (5, 8, 12, 16, 20, 25):
            for th in (8, 10, 15):
                for kap in (0.5, 1.0):
                    r = run(bk, d, 600, target_frac=0.0, Q_gbp=200, U=1, theta=th, kappa=kap, arb=True, t_to=SPLIT,
                            max_orders_day=BUDGET)
                    if r:
                        grid[(d, th, kap)] = summary(r)["total_a_day"]
        if not grid:
            res[name] = {"note": "no cell under 1,000 orders a day"}
            continue
        (d, th, kap), ins = max(grid.items(), key=lambda kv: kv[1])
        out = {"chosen_in_sample": {"d_bps": d, "theta_bps": th, "kappa": kap, "in_total_a_day": ins},
               "grid_in": {f"d{k[0]}_th{k[1]}_k{k[2]}": v for k, v in sorted(grid.items())},
               "wide_hours_in": sum(1 for h, v in reg.items() if v == "wide" and h * 3600 < SPLIT),
               "wide_hours_out": sum(1 for h, v in reg.items() if v == "wide" and h * 3600 >= SPLIT),
               "hours_out": sum(1 for h in reg if h * 3600 >= SPLIT)}
        variants = {
            "base_600": dict(cap_gbp=600, Q_gbp=200, arb=True),
            "base_1200": dict(cap_gbp=1200, Q_gbp=400, arb=True),
            "no_arb_600": dict(cap_gbp=600, Q_gbp=200),
            "arb_after_15s_600": dict(cap_gbp=600, Q_gbp=200, arb=True, arb_delay=15),
            "minute_loop_600": dict(cap_gbp=600, Q_gbp=200, U=60, theta=0, arb=True),
            "half_fills_600": dict(cap_gbp=600, Q_gbp=200, share=0.5, arb=True),
            "hedged_binance10_600": dict(cap_gbp=600, Q_gbp=200, hedge=10.0, arb=True),
            "two_accounts_600": dict(cap_gbp=600, Q_gbp=200, arb=True, max_orders_day=2 * BUDGET),
        }
        for vn, kw in variants.items():
            args = dict(target_frac=0.0, U=1, theta=th, kappa=kap, max_orders_day=BUDGET)
            args.update(kw)
            cap = args.pop("cap_gbp")
            r = run(bk, d, cap, t_from=SPLIT, **args)
            if r is None:
                continue
            s = summary(r)
            hrs = r["hours"]
            tight = [v for h, v in hrs.items() if reg.get(h, "tight") == "tight"]
            wide = [v for h, v in hrs.items() if reg.get(h) == "wide"]
            out[vn] = {**s, "fills_a_day": r["fills_a_day"], "sweep_fills": r["sweep_fills"], "arb_fills": r["arb_fills"],
                       "orders_a_day": r["orders_a_day"], "turnover_gbp_a_day": r["turnover_gbp_a_day"],
                       "edge_bps": r["edge_at_fill_bps_mean"], "markout_bps": r["markout_maker_bps_mean"],
                       "inventory_gbp_mean": r["inventory_gbp_mean"], "inventory_gbp_max": r["inventory_gbp_max"],
                       "p_mean_le0": boot_p(list(hrs.values())), "p_mean_le0_tight_hours": boot_p(tight),
                       "gbp_tight_hours": round(sum(tight), 2), "tight_hours": len(tight),
                       "gbp_wide_hours": round(sum(wide), 2), "wide_hours": len(wide),
                       "gbp_a_tight_day": round(24 * sum(tight) / len(tight), 3) if tight else None,
                       "gbp_a_wide_hour": round(sum(wide) / len(wide), 3) if wide else None,
                       "days": {k: round(v["total"], 2) for k, v in r["days"].items()}}
            print(name, vn, out[vn]["total_a_day"], out[vn]["p_mean_le0"], out[vn]["gbp_a_tight_day"], out[vn]["gbp_a_wide_hour"],
                  out[vn]["orders_a_day"], flush=True)
        res[name] = out
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(res)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1:])
