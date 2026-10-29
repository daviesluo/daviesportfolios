"""HOLDMIN verdict (2026-10-29; Davies: "那你研究下variant-4的结果，如果基本可以肯定效果正面的话，加入实盘live的规则里…"): LIVE's own
days replayed with and without variant-4's £1 holding line (`holdMin {gbp: 1}`; the engine's `hold_min_gbp`).

The replay is haircut.py's: the PR5-OPT engine unchanged on PR5's stored minutes and the recorded prints, LIVE's schedule (£120,
twelve rungs of £10, from 2026-10-01 16:30 to 10-27 00:00; £600, £50 rungs, from 10-27 00:00 to 10-29 00:00; both books; LIVE's
"at" fill; the weekend rule from 10-23 21:00). Each run twice: the venue's £0.10 line (as LIVE runs) and the £1 line. Each trip
by its UTC exit day, both before and after the haircut (`results/haircut.json` "applied": trips of £1+ × e, dust trips under £1
plus the penny cost); trips still open at 10-29 00:00 left out of both. Per book: the window's mean a day in bps of that day's
capital, the paired difference (£1 line − as LIVE) with a circular 3-day block bootstrap's 80 % interval and P(≤ 0) (10,000
resamples, seed 20261029), dust trips a day, stops, and the mean minutes a trip is held.
usage: python3 -I holdmin_live.py OUT.json
"""
import collections, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "revx_lag", "scripts"))
import lag_data as L  # noqa: E402

ms = L.ms
T0, SWITCH, T1 = ms(2026, 10, 1, 16, 30), ms(2026, 10, 27), ms(2026, 10, 29)
WEEKEND_FROM = ms(2026, 10, 23, 21)
DAYS = [L.day(t) for t in range(ms(2026, 10, 1), T1, L.DAY)]
CAP = {d: (600.0 if d >= "2026-10-27" else 120.0) for d in DAYS}
BLOCK, NB, SEED, DUST_GBP = 3, 10000, 20261029, 1.0
HC = json.load(open(os.path.join(HERE, "..", "results", "haircut.json")))["applied"]


def run(fm, fp, hold):
    trips = []
    for cap, a, b_ in ((120.0, T0, SWITCH), (600.0, SWITCH, T1)):
        tr, _ = L.sim.run(fm, fp, a, b_, capital=cap, xhold=True, xhold_from=WEEKEND_FROM, fill="at", hold_min_gbp=hold)
        trips += [x for x in tr if x["how"] != "open"]
    return trips


def daily(trips, book, adj):
    d = collections.defaultdict(float)
    for x in trips:
        if x["book"] != book: continue
        p = x["pnl"]
        if adj: p = p + HC["penny_gbp_per_dust_trip"] if x["gbp"] < DUST_GBP else p * HC["e"]
        d[L.day(x["tExit"])] += p
    return [d.get(day, 0.0) / CAP[day] * 1e4 for day in DAYS]


def boot(v):
    rnd = random.Random(SEED); n = len(v); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(sum(s[:n]) / n)
    out.sort()
    return round(out[int(0.1 * (NB - 1))], 2), round(out[int(0.9 * (NB - 1))], 2), round(sum(1 for m in out if m <= 0) / NB, 4)


def main(out):
    _, _, fm, fp = L.load_engine_inputs()
    runs = {"as_live": run(fm, fp, L.sim.MIN_GBP), "hold1": run(fm, fp, 1.0)}
    res = {"days": [DAYS[0], DAYS[-1]], "n_days": len(DAYS), "haircut": HC}
    for b in L.BOOKS:
        r = {}
        for arm, tr in runs.items():
            mine = [x for x in tr if x["book"] == b]
            r[arm] = {"trips": len(mine), "dust_trips": sum(1 for x in mine if x["gbp"] < DUST_GBP),
                      "dust_trips_day": round(sum(1 for x in mine if x["gbp"] < DUST_GBP) / (len(DAYS) - 0.69), 2),
                      "stops": sum(1 for x in mine if x["how"] == "taker"),
                      "mean_hold_min": round(sum((x["tExit"] - x["tEntry"]) / 60e3 for x in mine if x["tEntry"]) / max(1, len(mine)), 1),
                      "bps_day_raw": round(sum(daily(tr, b, False)) / len(DAYS), 3), "bps_day_after_haircut": round(sum(daily(tr, b, True)) / len(DAYS), 3)}
        for adj in (False, True):
            v = [h - a for h, a in zip(daily(runs["hold1"], b, adj), daily(runs["as_live"], b, adj))]
            p10, p90, ple0 = boot(v)
            r["diff_after_haircut" if adj else "diff_raw"] = {"bps_day": round(sum(v) / len(v), 3), "p10": p10, "p90": p90, "p_le0": ple0,
                                                              "days_ahead": sum(1 for x in v if x > 1e-9), "days_behind": sum(1 for x in v if x < -1e-9)}
        res[b] = r
        print(b, json.dumps(r), flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1])
