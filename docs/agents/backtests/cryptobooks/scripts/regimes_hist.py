# CRYPTOBOOKS-2 (2026-10-31): when were Revolut X's crypto GBP books wide before, and for how long?
# The measure needs no outside price: the books' effective spread from their own prints, a day's 13:00-16:00 UTC sample
# (hist_pull.py; the 14-day tape and today's pull are cut to the same hours): each taker buy against the median of the
# taker sells within 60 s either side of it, log(buy / sell) in bps; the day's median of those (at least 5 pairs).
# The fast layer there, it reads about 4-8 bps; away, 25-60. A day is "wide" at 16 bps or more. Validated on the 14 days
# with Binance (tape.py's hourly paid-over-fair x 2, the same hours). Writes results/regimes_hist.json.
#   python3 -I regimes_hist.py BOOK...
import bisect, collections, datetime as dt, gzip, json, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT  # noqa: E402

WIDE = 16.0


def read(path):
    rows = []
    if not os.path.exists(path):
        return rows
    with gzip.open(path, "rt") as f:
        for line in f:
            p = line.rstrip("\n").split("|")
            if len(p) >= 5:
                rows.append((int(p[1]), float(p[2]), float(p[3]), 1 if p[4] == "buy" else -1))
    return rows


def day_spread(rows):
    sells = sorted((ms, px) for ms, px, q, s in rows if s < 0)
    st = [x[0] for x in sells]
    out = []
    for ms, px, q, s in rows:
        if s < 0:
            continue
        i0 = bisect.bisect_left(st, ms - 60000)
        i1 = bisect.bisect_right(st, ms + 60000)
        if i1 > i0:
            ps = statistics.median(x[1] for x in sells[i0:i1])
            out.append(1e4 * (px / ps - 1))
    return (round(statistics.median(out), 1), len(out)) if len(out) >= 5 else (None, len(out))


def main(books):
    res = {}
    for book in books:
        rows = read(os.path.join(ROOT, "data", f"hist_{book}.txt.gz"))
        for extra in (f"tape_{book}.txt.gz", f"tape1031_{book}.txt.gz", f"tape1031b_{book}.txt.gz"):
            rows += read(os.path.join(ROOT, "data", extra))
        by = collections.defaultdict(set)
        for r in rows:
            t = dt.datetime.utcfromtimestamp(r[0] / 1000)
            if 13 <= t.hour < 16:
                by[t.date().isoformat()].add(r)
        days = {}
        for d in sorted(by):
            s, n = day_spread(sorted(by[d]))
            days[d] = {"spread_bps": s, "pairs": n, "prints": len(by[d])}
        # runs of wide days
        runs, cur = [], None
        for d in sorted(days):
            w = days[d]["spread_bps"] is not None and days[d]["spread_bps"] >= WIDE
            if w and cur is None:
                cur = [d, d]
            elif w:
                cur[1] = d
            elif cur is not None and days[d]["spread_bps"] is not None:
                runs.append(cur)
                cur = None
        if cur is not None:
            runs.append(cur + ["open"])
        vals = [v["spread_bps"] for v in days.values() if v["spread_bps"] is not None]
        months = collections.defaultdict(list)
        for d, v in days.items():
            if v["spread_bps"] is not None:
                months[d[:7]].append(v["spread_bps"])
        res[book] = {"days": days, "wide_runs": runs, "n_days": len(vals), "wide_days": sum(1 for x in vals if x >= WIDE),
                     "by_month_p50": {m: round(statistics.median(v), 1) for m, v in sorted(months.items())},
                     "by_month_wide_days": {m: sum(1 for x in v if x >= WIDE) for m, v in sorted(months.items())}}
        print(book, res[book]["n_days"], res[book]["wide_days"], res[book]["by_month_p50"], runs[-6:], flush=True)
    path = os.path.join(ROOT, "results", "regimes_hist.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    old.update(res)
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(old)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1:])
