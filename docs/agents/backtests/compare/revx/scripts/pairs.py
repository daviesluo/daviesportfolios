"""STRATEGY-COMPARE, Revolut X: each variant against LIVE on the same book and size, day by day, from `results/daily.json.gz`
(compare.py's marked-to-market days after the haircut). For the days since 2026-09-01 (the headline's) and out of sample
(from 2026-05-12): the mean difference in % a year on capital, a circular 3-day block bootstrap's 80 % interval of it (the
paired days resampled together, 10,000 times, seed 20261029) and the share of resampled means at or below 0.
usage: python3 -I pairs.py RESULTS_DIR
"""
import gzip, json, os, random, sys

POST, SPLIT, BLOCK, NB, SEED = "2026-09-01", "2026-05-12", 3, 10000, 20261029


def boot(v, rnd):
    n = len(v); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(sum(s[:n]) / n)
    out.sort()
    return out


def main(d):
    daily = json.load(gzip.open(os.path.join(d, "daily.json.gz"), "rt"))
    res = {}
    for key in sorted(daily):
        arm, book, size = key.split("|")
        if arm == "live": continue
        base, x = daily[f"live|{book}|{size}"], daily[key]
        assert base["days"] == x["days"]
        cap = float(size)
        r = {}
        for name, lo in (("post", POST), ("oos", SPLIT)):
            v = [a - b for day, a, b in zip(x["days"], x["adj"], base["adj"]) if day >= lo]
            bs = boot(v, random.Random(SEED))
            k = 100 * 365 / cap
            r[name] = {"diff_pct_yr": round(k * sum(v) / len(v), 2), "p10": round(k * bs[int(0.1 * (NB - 1))], 2),
                       "p90": round(k * bs[int(0.9 * (NB - 1))], 2), "p_le0": round(sum(1 for m in bs if m <= 0) / NB, 3)}
        res[key] = r
        print(key, json.dumps(r), flush=True)
    # The dust stress (the review's §0 point 4): each USDT-GBP row's headline if dust trips run at the rate and cost of PR5-OPT's
    # four £600 twins weighted to USDT-GBP over their first 0.85 days (28 trips, −£1.774: 8.2 a day a book at £0.0634), in place
    # of the replay's own count at the haircut's £0.0242.
    rows = json.load(open(os.path.join(d, "compare.json")))["rows"]
    rate, cost, c0 = 28 / (4 * 0.85), 1.774 / 28, 0.0242
    stress = {}
    for key, m in sorted(rows.items()):
        arm, book, size = key.split("|")
        if book != "USDT-GBP": continue
        extra = rate * cost - m["post"]["dust_trips_day"] * c0
        stress[key] = round(m["headline_pct_yr"] - 100 * 365 * extra / float(size), 1)
    res["dust_stress_headline"] = {"trips_day": round(rate, 2), "gbp_trip": round(cost, 4), "rows": stress}
    print("dust stress", json.dumps(res["dust_stress_headline"]), flush=True)
    json.dump(res, open(os.path.join(d, "pairs.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1])
