# CRYPTOBOOKS (2026-10-31): is the crypto books' tight inner liquidity the GBP stablecoin maker's?
# Through 2026-10-30 most public prints on Revolut X's crypto books traded within a few bps of the outside fair (tape.py),
# while the visible books read on 10-31 (this study's poll, MAKER-OTHER-BOOKS' of 02:38-04:37) were 16-60 bps wide and
# printed at that wide touch. The stablecoin maker's presence on USDT-GBP, as the share of each UTC hour's minutes in which
# the production watch saw it (`agent_maker_minutes`, SQL in the review, data/maker_hourly_usdtgbp.txt.gz), is set
# against each crypto book's hourly effective half-spread: (median buy dev - median sell dev) / 2 of the hour's taker
# orders against the outside fair of the second before (as tape.py), hours with at least three of each side.
# Writes results/inner.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> python3 -I inner.py BOOK...
import collections, gzip, json, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair, in_halt, load_tape, takers  # noqa: E402


def main(books):
    pres = {}
    with gzip.open(os.path.join(ROOT, "data", "maker_hourly_usdtgbp.txt.gz"), "rt") as f:
        for line in f:
            a, b = line.strip().split("|")
            pres[int(a) // 3600] = float(b)
    fair = Fair()
    path = os.path.join(ROOT, "results", "inner.json")
    res = json.load(open(path)) if os.path.exists(path) else {}
    for book in books:
        try:
            tk = takers(load_tape(book))
        except (FileNotFoundError, EOFError):
            continue
        F = fair.series(book)
        hours = collections.defaultdict(lambda: ([], []))
        for ms, w, q, s, vw, k in tk:
            sec = ms // 1000
            if not (fair.t0 + 10 < sec < fair.t1 - 10) or in_halt(sec):
                continue
            hours[sec // 3600][0 if s > 0 else 1].append(1e4 * math.log(vw / F[sec - 1 - fair.t0]))
        rows = []
        for h, (b, s_) in sorted(hours.items()):
            if len(b) >= 3 and len(s_) >= 3 and h in pres:
                rows.append((h, pres[h], (statistics.median(b) - statistics.median(s_)) / 2, len(b) + len(s_)))
        on = [r[2] for r in rows if r[1] >= 0.9]
        off = [r[2] for r in rows if r[1] <= 0.1]
        mid = [r[2] for r in rows if 0.1 < r[1] < 0.9]
        n = len(rows)
        mx = statistics.mean(r[1] for r in rows) if rows else 0
        my = statistics.mean(r[2] for r in rows) if rows else 0
        sxx = sum((r[1] - mx) ** 2 for r in rows)
        syy = sum((r[2] - my) ** 2 for r in rows)
        sxy = sum((r[1] - mx) * (r[2] - my) for r in rows)
        out = {"book": book, "hours": n, "hours_maker_on": len(on), "hours_maker_off": len(off),
               "half_spread_on_p50": round(statistics.median(on), 1) if on else None,
               "half_spread_off_p50": round(statistics.median(off), 1) if off else None,
               "half_spread_partial_p50": round(statistics.median(mid), 1) if mid else None,
               "corr_presence_halfspread": round(sxy / math.sqrt(sxx * syy), 3) if sxx > 0 and syy > 0 else None,
               "off_hours": [[r[0] * 3600, r[1], round(r[2], 1), r[3]] for r in rows if r[1] <= 0.1]}
        res[book] = out
        print(book, n, len(on), len(off), out["half_spread_on_p50"], out["half_spread_off_p50"], out["half_spread_partial_p50"],
              out["corr_presence_halfspread"], flush=True)
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(res)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1:])
