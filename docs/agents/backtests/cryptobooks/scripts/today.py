# CRYPTOBOOKS (2026-10-31): the fresh out-of-sample day. Every parameter was chosen before 2026-10-31's prints were pulled:
# the maker's cell is best.py's in-sample choice for the book (results/best.json), the take is stale.py's T15, L1, H300.
# Both are replayed on 2026-10-31 00:00 UTC -> the last print of the day's pull (data/tape1031_<BOOK>.txt.gz, trades.py),
# against Binance's one-second closes of the same day (binance_1s.py reads today's from the public klines endpoint).
# Also: the day's hourly regime (the taker orders' median paid over the fair, as best.py's), so "wide" hours can be told.
# Writes results/today.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output, to 2026-11-01> python3 -I today.py BOOK...
import collections, json, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair, load_tape  # noqa: E402
from replay import Book, boot_p, run, summary  # noqa: E402
from best import BUDGET, regimes  # noqa: E402

DAY = 1793404800  # 2026-10-31 00:00 UTC


def main(books):
    fair = Fair()
    best = json.load(open(os.path.join(ROOT, "results", "best.json")))
    path = os.path.join(ROOT, "results", "today.json")
    res = json.load(open(path)) if os.path.exists(path) else {}
    for name in books:
        try:
            last = max(r[0] for r in load_tape(name, "1031")) // 1000
        except (FileNotFoundError, ValueError):
            continue
        bk = Book(name, fair, tag="1031")
        reg = regimes(bk)
        hours = sorted(h for h in reg if h * 3600 >= DAY and h * 3600 < last)
        # the day's own prints against the fair
        devs = collections.defaultdict(list)
        n = 0
        for ms, side, prints in bk.orders:
            sec = ms // 1000
            if DAY <= sec < last:
                n += 1
                p = sum(x[0] * x[1] for x in prints) / sum(x[1] for x in prints)
                devs[sec // 3600].append(side * 1e4 * math.log(p / bk.F[sec - 1 - bk.t0]))
        out = {"orders": n, "hours": len(hours), "wide_hours": sum(1 for h in hours if reg[h] == "wide"),
               "paid_over_fair_p50_by_hour": {str(h * 3600): round(statistics.median(v), 1) for h, v in sorted(devs.items())}}
        ch = (best.get(name) or {}).get("chosen_in_sample")
        if ch:
            for vn, kw in (("base_600", dict(cap_gbp=600, Q_gbp=200, arb=True)), ("base_1200", dict(cap_gbp=1200, Q_gbp=400, arb=True)),
                           ("no_arb_600", dict(cap_gbp=600, Q_gbp=200)), ("minute_loop_600", dict(cap_gbp=600, Q_gbp=200, U=60, theta=0, arb=True))):
                args = dict(target_frac=0.0, U=1, theta=ch["theta_bps"], kappa=ch["kappa"], max_orders_day=BUDGET)
                args.update(kw)
                cap = args.pop("cap_gbp")
                r = run(bk, ch["d_bps"], cap, t_from=DAY, t_to=last, **args)
                if r is None:
                    continue
                s = summary(r)
                hrs = (last - DAY) / 3600
                out[vn] = {"gbp_total": round(sum(v["total"] for v in r["days"].values()), 2), "hours": round(hrs, 2),
                           "gbp_an_hour": round(sum(v["total"] for v in r["days"].values()) / hrs, 3),
                           "fills": r["fills"], "arb_fills": r["arb_fills"], "orders": round(r["orders_a_day"] * r["span_days"]),
                           "edge_bps": r["edge_at_fill_bps_mean"], "markout_bps": r["markout_maker_bps_mean"],
                           "inventory_gbp_max": r["inventory_gbp_max"], "worst_hour": s["worst_hour_total"],
                           "p_mean_le0_hours": boot_p(list(r["hours"].values()), block=3)}
            out["params"] = ch
        res[name] = out
        print(name, json.dumps({k: v for k, v in out.items() if k != "paid_over_fair_p50_by_hour"}), flush=True)
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(res)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1:])
