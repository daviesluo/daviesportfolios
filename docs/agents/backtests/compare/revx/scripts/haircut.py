"""STRATEGY-COMPARE (Revolut X half), the live haircut: how LIVE's own realised record compares with the replay this study's
headline rests on, over the same days, and why.

LIVE (PR5's `_2` sub-account) has traded since 2026-10-01 16:29:53 UTC: £120, twelve rungs of £10, until 2026-10-27 03:09 UTC,
then £600, £50 a rung; weekends quoted from 2026-10-23 21:00 UTC. The replay is the PR5-OPT engine unchanged
(`pr5_opt/scripts/sim.py`) on PR5's own stored minutes and the recorded prints (REVX-FAIR's `fair_price/data`), with LIVE's
schedule: £120 from 10-01 16:30 to 10-27 00:00, £600 from 10-27 00:00 to 10-29 00:00, both books, LIVE's "at" fill, the weekend
rule from 10-23 21:00. Trips still open at 10-29 00:00 are left out of both sides.

The record splits in two (sql/trip_buckets.sql cuts LIVE's and the twins' trips at £1 of entry notional):
  dust    a partial fill of a few pence (a 0.133-coin print, about £0.10, at the rung's price) makes the rung held, and its exit
          follows. Revolut X moves money in whole pennies, so a sell of £0.0999 books £0.09 and a buy of £0.1004 costs £0.11:
          about 2p lost a trip, whatever the rung's size. The replay has no pennies (and treats a fill of £0.10 or less as no
          holding), so it cannot see this. Its cost is a fixed number of pounds a day, measured on the £120 LIVE twin (the
          executor's own code on a simulated account that moves pennies as the venue does: paper, `inputs/twin_trips.json`).
  normal  every other trip. LIVE's against the replay's over the same days is the efficiency e, a ratio.
Inputs (never committed: LIVE's are real money):
  LIVE_TRIPS  sql/trip_buckets.sql on `agent_quote_live_orders`, as {book: {"dust": [n, pnl], "normal": [n, pnl]}}
  LIVE_DAYS   sql/live_days.sql on the same table, as {book: {day: [trips, pnl, stops]}}
Output: ratios and the twin's (paper) figures only: e per book, the dust drag per book in £ a day and trips a day, the replay's
own dust trips a day, and, for context, Σ LIVE ÷ Σ replay over all trips by day with a day-block bootstrap's 80 % interval
(3-day circular blocks of the paired days, 10,000 resamples, seed 20261029).
usage: LIVE_TRIPS=<json> LIVE_DAYS=<json> python3 -I haircut.py OUT.json
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
DUST_GBP = 1.0
BLOCK, NB, SEED = 3, 10000, 20261029
TWIN = json.load(open(os.path.join(HERE, "..", "inputs", "twin_trips.json")))


def replay():
    _, _, fm, fp = L.load_engine_inputs()
    daily = {b: collections.defaultdict(float) for b in L.BOOKS}
    buckets = {b: {"dust": [0, 0.0], "normal": [0, 0.0], "dust_120": [0, 0.0], "normal_120": [0, 0.0]} for b in L.BOOKS}
    for cap, a, b_ in ((120.0, T0, SWITCH), (600.0, SWITCH, T1)):
        tr, _ = L.sim.run(fm, fp, a, b_, capital=cap, xhold=True, xhold_from=WEEKEND_FROM, fill="at")
        for x in tr:
            if x["how"] == "open": continue
            daily[x["book"]][L.day(x["tExit"])] += x["pnl"]
            k = "dust" if x["gbp"] < DUST_GBP else "normal"
            for key in ((k, k + "_120") if cap == 120.0 else (k,)):
                buckets[x["book"]][key][0] += 1; buckets[x["book"]][key][1] += x["pnl"]
    return daily, buckets


def ratio_boot(a, b):
    """Σ a ÷ Σ b over DAYS and its bootstrap 80 % interval (paired days, 3-day circular blocks)."""
    n = len(a)
    point = sum(a) / sum(b) if abs(sum(b)) > 1e-12 else None
    rnd = random.Random(SEED); rs = []
    for _ in range(NB):
        idx = []
        while len(idx) < n:
            i = rnd.randrange(n); idx.extend((i + j) % n for j in range(BLOCK))
        idx = idx[:n]
        sb = sum(b[i] for i in idx)
        if abs(sb) > 1e-12: rs.append(sum(a[i] for i in idx) / sb)
    rs.sort()
    q = lambda p: round(rs[int(p * (len(rs) - 1))], 3)
    return {"point": None if point is None else round(point, 3), "p10": q(0.10), "p90": q(0.90)}


def main(out):
    live = json.load(open(os.environ["LIVE_TRIPS"]))
    live_days = json.load(open(os.environ["LIVE_DAYS"]))
    daily, bk = replay()
    tdays = TWIN["days"]
    res = {"days": [DAYS[0], DAYS[-1]], "dust_below_gbp": DUST_GBP, "twin_days": tdays}
    for b in L.BOOKS:
        e = live[b]["normal"][1] / bk[b]["normal"][1]
        e_twin = TWIN[b]["normal"][1] / bk[b]["normal_120"][1]
        res[b] = {
            "e_live_over_replay_normal": round(e, 3),
            "e_twin_over_replay_normal_120": round(e_twin, 3),
            "dust_twin_gbp_day": round(TWIN[b]["dust"][1] / tdays, 4),
            "dust_twin_trips_day": round(TWIN[b]["dust"][0] / tdays, 2),
            "dust_twin_gbp_trip": round(TWIN[b]["dust"][1] / max(1, TWIN[b]["dust"][0]), 4),
            "dust_replay_trips_day_120": round(bk[b]["dust_120"][0] / tdays, 2),
            "dust_live_trips_day": round(live[b]["dust"][0] / (len(DAYS) - 0.69), 2),
            "replay_normal_trips": bk[b]["normal"][0], "live_normal_trips": live[b]["normal"][0],
        }
        lv = [live_days[b].get(d, [0, 0.0])[1] / CAP[d] * 1e4 for d in DAYS]
        rp = [daily[b].get(d, 0.0) / CAP[d] * 1e4 for d in DAYS]
        res[b]["all_trips_live_over_replay_daily"] = ratio_boot(lv, rp)
        res[b]["dust_replay_gbp_trip_120"] = round(bk[b]["dust_120"][1] / max(1, bk[b]["dust_120"][0]), 5)
        print(b, json.dumps(res[b]), flush=True)
    # What the comparison applies: both books pooled (USDC-GBP's own e rests on 101 trips at £10 rungs and its twin does not
    # confirm it; its own dust record is one trip).
    e_pool = sum(live[b]["normal"][1] for b in L.BOOKS) / sum(bk[b]["normal"][1] for b in L.BOOKS)
    tw_n = sum(TWIN[b]["dust"][0] for b in L.BOOKS); tw_p = sum(TWIN[b]["dust"][1] for b in L.BOOKS)
    rp_n = sum(bk[b]["dust_120"][0] for b in L.BOOKS); rp_p = sum(bk[b]["dust_120"][1] for b in L.BOOKS)
    res["applied"] = {"e": round(min(1.0, e_pool), 3), "e_pooled_raw": round(e_pool, 3),
                      "penny_gbp_per_dust_trip": round(tw_p / tw_n - rp_p / max(1, rp_n), 4),
                      "twin_dust_gbp_trip": round(tw_p / tw_n, 4), "replay_dust_gbp_trip": round(rp_p / max(1, rp_n), 5)}
    print("applied", json.dumps(res["applied"]), flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1])
