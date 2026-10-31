# CRYPTOBOOKS-2 (2026-10-31): the rule card (xrp_study.CARD, rule.py) on 2026-10-31, hour by hour, after every number
# of it was fixed on the tape to 10-30: does it earn while the fast layer is away, and what happens the hour it comes
# back? Each hour is labelled by the book's own prints (best.regimes: taker orders paid a median 8 bps or more over the
# fair = wide) and by the pair spread (regimes_hist.day_spread on the hour's prints), and carries the GBP stablecoin
# maker's state from the production watch (data/maker_events_1031.json: away 00:58 -> USDT-GBP 07:18 / USDC-GBP 08:04).
# Writes results/today2.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output, to 2026-11-01> python3 -I today2.py BOOK...
import collections, datetime as dt, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair, load_tape  # noqa: E402
from replay import Book  # noqa: E402
from best import regimes  # noqa: E402
from regimes_hist import day_spread  # noqa: E402
from rule import sim  # noqa: E402
from xrp_study import CARD  # noqa: E402

DAY = 1793404800
TAG = "1031b"


def main(books):
    fair = Fair()
    res = {}
    for name in books:
        tape = load_tape(name, TAG)
        last = max(r[0] for r in tape) // 1000
        bk = Book(name, fair, tag=TAG)
        reg = regimes(bk)
        by = collections.defaultdict(list)
        for r in tape:
            if r[0] // 1000 >= DAY:
                by[r[0] // 3600000].append(r)
        out = {"last_print_utc": dt.datetime.utcfromtimestamp(last).strftime("%H:%M:%S")}
        for vn, kw in (("card_600", {}), ("card_1200", {"cap": 1200.0, "Q": 400.0}), ("card_120", {"cap": 120.0, "Q": 40.0}),
                       ("lat2", {"lat": 2}), ("gate6", {"gate": 6.0})):
            r = sim(bk, fair, **(CARD | kw | {"t_from": DAY, "t_to": (last // 3600) * 3600}))
            hrs = {h: v for h, v in r["hours"]}
            out[vn] = {"total": r["total"], "fills": r["fills"], "placed": round(r["placed_a_day"] * r["span_days"]),
                       "edge_bps": r["edge_bps"], "inv_max": r["inv_max"], "worst_hour": r["worst_hour"],
                       "by_hour": [[dt.datetime.utcfromtimestamp(h * 3600).strftime("%H"), round(v, 3), reg.get(h, "tight"),
                                    day_spread(sorted(by.get(h, [])))[0]] for h, v in sorted(hrs.items())]}
            print(name, vn, out[vn]["total"], out[vn]["fills"], [x[1] for x in out[vn]["by_hour"]], flush=True)
        res[name] = out
    path = os.path.join(ROOT, "results", "today2.json")
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(res)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1:])
