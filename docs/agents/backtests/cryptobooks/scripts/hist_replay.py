# CRYPTOBOOKS-2 (2026-10-31): the rule card over a year, on the sampled 13:00-16:00 UTC windows (hist_pull.py's tape,
# hist_fair.py's Binance seconds and Coinbase GBP/USD): rule.sim with xrp_study.CARD, each window alone, quoting
# 13:30 -> 16:00 (its first half hour warms the basis from the window's own prints), starting in pounds and marked to
# the fair at 16:00. The same 13:30-16:00 slice of the 14 days with the full tape (rule_<BOOK>.json's hours) gives the
# scale from a window to a day. Reported by month and by the day's regime (regimes_hist: pair spread >= 16 bps = wide),
# with P(mean <= 0) by a circular block bootstrap of windows (5-window blocks). Writes results/hist_replay.json.
#   CRYPTOBOOKS_HF=<hist_fair.py's output> python3 -I hist_replay.py BOOK...
import array, collections, datetime as dt, gzip, json, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Minutes, taker_orders  # noqa: E402
from replay import basis_steps  # noqa: E402
from regimes_hist import WIDE, day_spread, read  # noqa: E402
from rule import boot, sim  # noqa: E402
from xrp_study import CARD  # noqa: E402

HF = os.environ.get("CRYPTOBOOKS_HF", os.path.join(ROOT, "hf"))
W0 = 12 * 3600 + 55 * 60


class WinBook:
    def __init__(self, name, F, t0, fx, tape):
        self.name, self.F, self.t0, self.fx, self.gbp = name, F, t0, fx, name.endswith("-GBP")
        self.orders = taker_orders(tape)
        self.steps = basis_steps(tape, F, t0)


class WinFair:
    def __init__(self, n, t0):
        self.n, self.t0, self.t1 = n, t0, t0 + n


def main(books):
    res = {}
    for book in books:
        coin = book.split("-")[0]
        tape = read(os.path.join(ROOT, "data", f"hist_{book}.txt.gz"))
        by = collections.defaultdict(list)
        for r in tape:
            by[dt.datetime.utcfromtimestamp(r[0] / 1000).date().isoformat()].append(r)
        rows = []
        for day in sorted(by):
            fp, xp = os.path.join(HF, f"{coin}_{day}.f64"), os.path.join(HF, f"fx_{day}.json")
            if not (os.path.exists(fp) and os.path.exists(xp)):
                continue
            a = array.array("d")
            a.frombytes(open(fp, "rb").read())
            fx = {int(k): v for k, v in json.load(open(xp)).items()}
            if not fx or any(x != x for x in a[:10]):
                continue
            t_day = int(dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc).timestamp())
            t0 = t_day + W0
            mins = sorted(fx)
            F = array.array("d")
            j = 0
            for i, v in enumerate(a):
                s = t0 + i
                while j + 1 < len(mins) and mins[j + 1] <= s:
                    j += 1
                g, u = fx[mins[j]]
                F.append(v * (u or 1.0) / g if book.endswith("-GBP") else v * (u or 1.0))
            gm = Minutes([(m, fx[m][0]) for m in mins])
            t = sorted(r for r in by[day] if t0 + 2 <= r[0] // 1000 < t0 + len(F) - 400)
            if len(t) < 20:
                continue
            bk = WinBook(book, F, t0, gm, t)
            if not bk.steps:
                continue
            r = sim(bk, WinFair(len(F), t0), **(CARD | {"t_from": t_day + 13 * 3600 + 1800, "t_to": t_day + 16 * 3600}))
            sp, _ = day_spread(t)
            rows.append({"day": day, "gbp": r["total"], "fills": r["fills"], "placed": round(r["placed_a_day"] * r["span_days"]),
                         "spread_bps": sp, "wide": sp is not None and sp >= WIDE, "prints": len(t)})
        g = [x["gbp"] for x in rows]
        tight = [x["gbp"] for x in rows if not x["wide"]]
        wide = [x["gbp"] for x in rows if x["wide"]]
        months = collections.defaultdict(list)
        for x in rows:
            months[x["day"][:7]].append(x["gbp"])
        res[book] = {"windows": len(rows), "gbp_a_window_mean": round(statistics.mean(g), 4) if g else None,
                     "gbp_a_window_p50": round(statistics.median(g), 4) if g else None,
                     "p_windows": boot(g, 5), "windows_pos": sum(1 for x in g if x > 0),
                     "tight_windows": len(tight), "tight_mean": round(statistics.mean(tight), 4) if tight else None,
                     "p_tight": boot(tight, 5), "wide_windows": len(wide), "wide_mean": round(statistics.mean(wide), 4) if wide else None,
                     "worst_window": round(min(g), 3) if g else None, "best_window": round(max(g), 3) if g else None,
                     "by_month": {m: [len(v), round(sum(v), 3), round(statistics.mean(v), 4)] for m, v in sorted(months.items())},
                     "rows": rows}
        print(book, {k: v for k, v in res[book].items() if k not in ("rows", "by_month")}, flush=True)
        print(res[book]["by_month"], flush=True)
    path = os.path.join(ROOT, "results", "hist_replay.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    old.update(res)
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(old)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1:])
