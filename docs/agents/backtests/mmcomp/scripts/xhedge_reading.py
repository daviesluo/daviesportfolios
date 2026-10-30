# The reading of "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" (docs/agents/reviews/2026-10-30-xhedge-prereg.md §5), frozen with it.
# Input: the pre-registration's reading statement's rows, saved as CSV with a header (arm,book,day,realised_gbp,fills,trips,
# bid_blocked,ask_blocked,orders), one row per arm, book and UTC day of the window, a day with nothing a row of zeros.
# For each arm and book: the sum, the mean a day, the circular 3-day block bootstrap of the mean (10,000 resamples,
# random.Random(20261030)), P(mean <= 0), the fills, and the bar: PASS when the sum > 0, P(mean <= 0) < 0.10 and the fills reach
# the arm's floor (inside 300, behind 100: the replay's 23.6 and 6.6 USDT-GBP fills a day over 28 days, with room).
#   python3 -I docs/agents/backtests/mmcomp/scripts/xhedge_reading.py <rows.csv>   -> prints the JSON verdict
import csv, json, random, statistics, sys

SEED, NB, BLOCK, P_BAR = 20261030, 10000, 3, 0.10
MIN_FILLS = {"inside": 300, "behind": 100}


def boot(v):
    n = len(v)
    rnd = random.Random(SEED)
    out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n)
            s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(statistics.fmean(s[:n]))
    out.sort()
    return out


def main(path):
    rows = list(csv.DictReader(open(path)))
    res = {}
    for arm, book in sorted({(r["arm"], r["book"]) for r in rows}):
        rs = sorted((r for r in rows if r["arm"] == arm and r["book"] == book), key=lambda r: r["day"])
        v = [float(r["realised_gbp"]) for r in rs]
        fills = sum(int(float(r["fills"])) for r in rs)
        b = boot(v)
        p = sum(1 for x in b if x <= 0) / NB
        res[f"{arm}|{book}"] = {
            "days": len(v), "sum_gbp": round(sum(v), 4), "mean_gbp_day": round(statistics.fmean(v), 4),
            "boot90": [round(b[int(0.05 * NB)], 4), round(b[int(0.95 * NB)], 4)], "p_le_0": round(p, 4), "fills": fills,
            "trips": sum(int(float(r["trips"])) for r in rs), "orders": sum(int(float(r["orders"])) for r in rs),
            "bid_blocked_min": sum(int(float(r["bid_blocked"])) for r in rs), "ask_blocked_min": sum(int(float(r["ask_blocked"])) for r in rs),
            "pass": sum(v) > 0 and p < P_BAR and fills >= MIN_FILLS[arm],
        }
    print(json.dumps(res, indent=1, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv[1])
