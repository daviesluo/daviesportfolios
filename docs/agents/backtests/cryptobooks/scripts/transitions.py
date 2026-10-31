# CRYPTOBOOKS-2 (2026-10-31): does the edge vanish the hour the fast layer comes back? The rule card (xrp_study.CARD,
# rule.py) on the whole tape (10-17 -> today), each hour labelled by its own pair spread (regimes_hist.day_spread on the
# hour's prints: >= 16 bps wide, else tight; hours with too few pairs keep the label before them). Reported: the card's
# P&L in tight and wide hours, in the first 1 / 3 hours after a wide -> tight switch and after a tight -> wide one, and the
# switches themselves. Writes results/transitions.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> python3 -I transitions.py TAG BOOK...
import collections, datetime as dt, json, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair, load_tape  # noqa: E402
from replay import Book  # noqa: E402
from regimes_hist import WIDE, day_spread  # noqa: E402
from rule import boot, sim  # noqa: E402
from xrp_study import CARD  # noqa: E402


def main(tag, books):
    fair = Fair()
    res = {}
    for name in books:
        tape = load_tape(name)
        if tag:
            tape = sorted(set(tape + load_tape(name, tag)))
        last = max(r[0] for r in tape) // 1000
        by = collections.defaultdict(list)
        for r in tape:
            by[r[0] // 3600000].append(r)
        label, prev = {}, "tight"
        for h in sorted(by):
            s, n = day_spread(sorted(by[h]))
            if s is not None:
                prev = "wide" if s >= WIDE else "tight"
            label[h] = prev
        bk = Book(name, fair, tag=tag)
        r = sim(bk, fair, **(CARD | {"t_to": (last // 3600) * 3600}))
        hrs = [(h, v) for h, v in r["hours"] if h in label]
        sw, after_wt, after_tw = [], {1: [], 3: []}, {1: [], 3: []}
        for i in range(1, len(hrs)):
            a, b = label[hrs[i - 1][0]], label[hrs[i][0]]
            if a != b:
                sw.append([dt.datetime.utcfromtimestamp(hrs[i][0] * 3600).strftime("%m-%d %H:00"), b])
                for k in (1, 3):
                    vals = [v for h, v in hrs[i:i + k]]
                    (after_wt if b == "tight" else after_tw)[k].extend(vals)
        tight = [v for h, v in hrs if label[h] == "tight"]
        wide = [v for h, v in hrs if label[h] == "wide"]
        res[name] = {"hours": len(hrs), "tight_hours": len(tight), "wide_hours": len(wide),
                     "tight_gbp_an_hour": round(statistics.mean(tight), 4) if tight else None,
                     "wide_gbp_an_hour": round(statistics.mean(wide), 4) if wide else None,
                     "p_tight_hours": boot(tight, 12), "p_wide_hours": boot(wide, 6),
                     "first_hour_after_wide_to_tight": round(statistics.mean(after_wt[1]), 4) if after_wt[1] else None,
                     "first_3h_after_wide_to_tight": round(statistics.mean(after_wt[3]), 4) if after_wt[3] else None,
                     "first_hour_after_tight_to_wide": round(statistics.mean(after_tw[1]), 4) if after_tw[1] else None,
                     "switches": sw}
        print(name, {k: v for k, v in res[name].items() if k != "switches"}, len(sw), flush=True)
    with open(os.path.join(ROOT, "results", "transitions.json"), "w") as f:
        json.dump(json.loads(json.dumps(res)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
