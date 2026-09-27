"""HARVEST phase 1: what the other side of the book paid after a market's result was confirmed by a public source, per
category, in two modes. Reads one committed category input (`inputs_build.py`); writes one result JSON.

Every unit is one market with C (the confirmation instant from the category's public source), w (the outcome that
source confirmed at C) and r (the outcome the market resolved to). A print is a taker's fill; the data API stamps it
about 2 s after its match (speed/results/print_time_lag.json), so "+1 s" is a stamp, not a match time. For a print at
or after C, in the terms of the confirmed winner W:

* **Mode A** (someone took a resting order that sold W below 1): the taker BOUGHT W at p, or SOLD the loser at p —
  the same resting order is a W offer at 1 − p to anyone (one book: a loser bid at q is a W ask at 1 − q). W's price
  pw = p or 1 − p. Per share: 1 − pw − the taker fee at pw (the market's own schedule) if W won; −(pw + fee) if not.
  Only what someone took is seen: a lower bound on what rested.
* **Mode B** (a resting maker bought W below 1 from a late taker): the taker SOLD W at p, or BOUGHT the loser at p.
  W's price bw = p or 1 − p. Per share for the maker: 1 − bw if W won, −bw if not; makers pay no fee. The maker rebate
  (the schedule's rebate rate × the fee-equivalent, from a daily pool) is reported apart and never added.

Delays: for d in 0, 1, 2, 3, 5, 10, 60, 300, 1800 s, the totals over prints at or after C + d — what was still there for a
trader acting at C + d ("until the market closes" is d = 0: everything from C to the close). A unit whose public
record cannot reproduce its own result (`record_ok: false`: the tracker's history, the catalog's) is left out and
counted, and so is a market that closed before its C (nothing to harvest, and no trap: it was resolved before the
source confirmed anything).

Rule-like fills (descriptive, no bar):
* Mode A, USLATE's model: from C + d, half of each Mode A print with 1 − pw ≥ 1 ¢ at its own price, until the market
  has cost $100 (the last fill partial); the fee from the market's schedule; held to the result.
* Mode B, a resting bid on W at a fixed level b0 from C + d with $100 of room: filled only by a Mode B print strictly
  through it (bw < b0: the taker would have met this bid first), at b0, for the print's size; a print exactly at b0 is
  queue-dependent and not counted (its volume is reported). The upper bound is a maker one tick above every print
  (bw + tick, whole print, $100 a market): first in the queue at every level, at the cost of one tick.
Capital is each fill's cost from the fill to the market's close; the peak of the sum is reported, and the lock is the
median time from C to the close over the markets that filled.

Concentration: the rule's P&L by the UTC date of C, its best date's share, the total without it; the whole-print
pool by market and by taker wallet. Bands (from C + 60 s): a print with W's price at 0.95 or more is "clean" (the
market already agrees with the source); below 0.95 it is "contested" (a minute after C the market still doubts it).

usage: harvest.py <category input json.gz> <out json> [days in the exploration window, default 92]
                  [--exclude-events id,id,...] [--kinds kind,kind,...]
"""
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402

DELAYS = [0, 1, 2, 3, 5, 10, 60, 300, 1800]
BINS = [(0, 2), (2, 5), (5, 10), (10, 60), (60, 300), (300, 1800), (1800, 10 ** 12)]
CAP = 100.0
LEVELS = [0.95, 0.99, 0.995, 0.999]


def tick_at(p):
    return 0.001 if (p < 0.04 or p > 0.96) else 0.01


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    return xs[min(len(xs) - 1, int(p * len(xs)))]


def r2(x):
    return round(x + 0.0, 2)


def classify(u, row):
    """(mode, W's price, shares, taker wallet) of a print, or None for a print on neither side."""
    ts, side, oi, price, size, wallet = row
    if oi not in (0, 1) or size <= 0 or not (0.0 < price < 1.0):
        return None
    w = u["w"]
    if oi == w:
        return ("A", price, size, wallet) if side == 0 else ("B", price, size, wallet)
    return ("B", 1.0 - price, size, wallet) if side == 0 else ("A", 1.0 - price, size, wallet)


def peak(intervals):
    ev = []
    for t0, t1, c in intervals:
        ev.append((t0, c))
        ev.append((t1, -c))
    ev.sort()
    cur = best = 0.0
    for _, c in ev:
        cur += c
        best = max(best, cur)
    return best


def conc(by_date):
    tot = sum(by_date.values())
    if not by_date:
        return {"total": 0.0, "dates": 0, "best_date": None, "best_share": None, "without_best": 0.0}
    bd = max(sorted(by_date), key=lambda k: by_date[k])
    return {"total": r2(tot), "dates": len(by_date), "best_date": bd, "best_usd": r2(by_date[bd]),
            "best_share": round(by_date[bd] / tot, 4) if tot > 0 else None, "without_best": r2(tot - by_date[bd])}


def main():
    inp = H.jfile(sys.argv[1])
    pos = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and not sys.argv[i - 1].startswith("--")]
    days = float(pos[2]) if len(pos) > 2 else 92.0
    excl = set(sys.argv[sys.argv.index("--exclude-events") + 1].split(",")) if "--exclude-events" in sys.argv else set()
    kinds = set(sys.argv[sys.argv.index("--kinds") + 1].split(",")) if "--kinds" in sys.argv else None
    inp["units"] = [x for x in inp["units"] if x["event"] not in excl and (kinds is None or x.get("kind") in kinds)]
    unverifiable = [x for x in inp["units"] if x.get("record_ok") is False]
    closed_first = [x for x in inp["units"] if x.get("record_ok") is not False and (x["closed"] or 0) <= x["C"]]
    units = sorted((x for x in inp["units"] if x.get("record_ok") is not False and (x["closed"] or 0) > x["C"]),
                   key=lambda x: (x["C"], x["cond"]))
    pool_date = {d: {"A": defaultdict(float), "B": defaultdict(float)} for d in DELAYS}
    pool_event = {"A": defaultdict(float), "B": defaultdict(float)}
    b_price = defaultdict(lambda: [0, 0.0, 0.0])
    by_kind = {d: defaultdict(lambda: defaultdict(float)) for d in (0, 60, 300)}
    band = defaultdict(lambda: {"net": 0.0, "notional": 0.0, "dates": set(), "markets": set(), "trap_net": 0.0})
    profile = {"A": defaultdict(float), "B": defaultdict(float)}
    prints = inp["prints"]
    pool = {d: defaultdict(float) for d in DELAYS}
    wallets_b = {d: defaultdict(float) for d in DELAYS}
    unit_pool = defaultdict(lambda: defaultdict(float))
    sizes_b, sizes_a = [], []
    rule_a = {d: {"pnl": 0.0, "cost": 0.0, "fills": 0, "units": set(), "by_date": defaultdict(float), "iv": [],
                  "traps": 0.0, "lock": []} for d in (1, 60, 300)}
    rule_b = {(d, b0): {"pnl": 0.0, "cost": 0.0, "fills": 0, "units": set(), "by_date": defaultdict(float), "iv": [],
                        "traps": 0.0, "at_level_shares": 0.0, "lock": []} for d in (1, 60, 300) for b0 in LEVELS}
    rule_bt = {d: {"pnl": 0.0, "cost": 0.0, "fills": 0, "units": set(), "by_date": defaultdict(float), "iv": [],
                   "traps": 0.0, "lock": []} for d in (1, 60, 300)}
    n_trap_units = 0
    trap_units = []
    locks_all = []
    for u in units:
        trap = u["r"] is not None and u["w"] != u["r"]
        n_trap_units += int(trap)
        c, closed = u["C"], u["closed"] or 0
        date = H.day(c)
        rows = [r for r in prints.get(u["cond"], []) if r[0] >= c]
        if closed > c:
            locks_all.append(closed - c)
        fee_sched = {"fees": u["fees"], "fee_rate": u["fee_rate"], "fee_exp": u["fee_exp"], "rebate": u["rebate"]}
        # whole-print pools
        for r in rows:
            k = classify(u, r)
            if not k:
                continue
            mode, px, s, wal = k
            dt = r[0] - c
            fee = H.fee_per_share(fee_sched, px) if mode == "A" else 0.0
            val = ((1.0 - px - fee) if not trap else -(px + fee)) * s if mode == "A" else \
                ((1.0 - px) if not trap else -px) * s
            for d in DELAYS:
                if dt >= d:
                    P = pool[d]
                    P[mode + "_prints"] += 1
                    P[mode + "_shares"] += s
                    if mode == "A":
                        P["A_gross_ok"] += 0.0 if trap else (1.0 - px) * s
                        P["A_fee_ok"] += 0.0 if trap else fee * s
                        P["A_trap"] += val if trap else 0.0
                        P["A_net"] += val
                        P["A_notional"] += px * s
                    else:
                        P["B_ok"] += 0.0 if trap else (1.0 - px) * s
                        P["B_trap"] += val if trap else 0.0
                        P["B_net"] += val
                        P["B_rebate_ub"] += H.rebate_per_share(fee_sched, px) * s
                        tk = tick_at(px)
                        if px + tk < 1.0:
                            P["B_tick_ahead"] += ((1.0 - px - tk) if not trap else -(px + tk)) * s
                        wallets_b[d][wal] += (1.0 - px) * s
                    P["dates_" + mode + "_" + date] = 1.0
                    pool_date[d][mode][date] += val
            unit_pool[u["cond"]]["A" if mode == "A" else "B"] += val
            pool_event[mode][u["event"]] += val
            for a, b in BINS:
                if a <= dt < b:
                    profile[mode][f"{a}-{b if b < 10 ** 12 else 'close'}"] += val
            if dt >= 60:
                bd = band[mode + ("_contested_below_0.95" if px < 0.95 else "_clean_0.95_plus")]
                bd["net"] += val
                bd["notional"] += px * s
                bd["dates"].add(date)
                bd["markets"].add(u["cond"])
                bd["trap_net"] += val if trap else 0.0
            for d in (0, 60, 300):
                if dt >= d:
                    kk = by_kind[d][u.get("kind", "all") + ("_trap" if trap else "")]
                    kk[mode + "_net"] += val
                    kk[mode + "_prints"] += 1
            if mode == "B" and dt >= 60:
                pb = "<0.95" if px < 0.95 else "0.95-0.99" if px < 0.99 else "0.99-0.998" if px < 0.998 else ">=0.998"
                b_price[pb][0] += 1
                b_price[pb][1] += s
                b_price[pb][2] += val
            if dt >= 60:
                (sizes_a if mode == "A" else sizes_b).append(s)
        # rule-like fills
        for d, R in rule_a.items():
            cost = 0.0
            for r in rows:
                k = classify(u, r)
                if not k or k[0] != "A" or r[0] - c < d or 1.0 - k[1] < 0.01:
                    continue
                px, sh = k[1], k[2] / 2.0
                if cost + sh * px > CAP:
                    sh = (CAP - cost) / px
                if sh <= 0:
                    break
                fee = H.fee_per_share(fee_sched, px)
                pnl = sh * ((1.0 - px - fee) if not trap else -(px + fee))
                R["pnl"] += pnl
                R["traps"] += pnl if trap else 0.0
                R["cost"] += sh * px
                R["fills"] += 1
                R["units"].add(u["cond"])
                R["by_date"][date] += pnl
                R["iv"].append((r[0], max(closed, r[0]), sh * px))
                cost += sh * px
                if cost >= CAP - 1e-9:
                    break
            if u["cond"] in R["units"]:
                R["lock"].append(closed - c)
        for (d, b0), R in rule_b.items():
            room = CAP / b0
            for r in rows:
                k = classify(u, r)
                if not k or k[0] != "B" or r[0] - c < d:
                    continue
                px, s = k[1], k[2]
                if abs(px - b0) < 1e-9:
                    R["at_level_shares"] += s
                    continue
                if px >= b0 or room <= 0:
                    continue
                sh = min(room, s)
                room -= sh
                pnl = sh * ((1.0 - b0) if not trap else -b0)
                R["pnl"] += pnl
                R["traps"] += pnl if trap else 0.0
                R["cost"] += sh * b0
                R["fills"] += 1
                R["units"].add(u["cond"])
                R["by_date"][date] += pnl
                R["iv"].append((r[0], max(closed, r[0]), sh * b0))
            if u["cond"] in R["units"]:
                R["lock"].append(closed - c)
        for d, R in rule_bt.items():
            cost = 0.0
            for r in rows:
                k = classify(u, r)
                if not k or k[0] != "B" or r[0] - c < d:
                    continue
                px, s = k[1], k[2]
                b = px + tick_at(px)
                if b >= 1.0:
                    continue
                sh = s
                if cost + sh * b > CAP:
                    sh = (CAP - cost) / b
                if sh <= 0:
                    break
                pnl = sh * ((1.0 - b) if not trap else -b)
                R["pnl"] += pnl
                R["traps"] += pnl if trap else 0.0
                R["cost"] += sh * b
                R["fills"] += 1
                R["units"].add(u["cond"])
                R["by_date"][date] += pnl
                R["iv"].append((r[0], max(closed, r[0]), sh * b))
                cost += sh * b
                if cost >= CAP - 1e-9:
                    break
            if u["cond"] in R["units"]:
                R["lock"].append(closed - c)
        if trap:
            trap_units.append({"event": u["event"], "cond": u["cond"], "q": u["q"], "w": u["w"], "r": u["r"],
                               "A_net_from_C": r2(unit_pool[u["cond"]]["A"]),
                               "B_net_from_C": r2(unit_pool[u["cond"]]["B"])})

    def pool_out(P, d):
        o = {k: (r2(v) if not k.endswith(("_prints",)) else int(v)) for k, v in sorted(P.items())
             if not k.startswith("dates_")}
        o["A_dates"] = sum(1 for k in P if k.startswith("dates_A_"))
        o["B_dates"] = sum(1 for k in P if k.startswith("dates_B_"))
        o["A_net_per_day"] = r2(P["A_net"] / days)
        o["B_net_per_day"] = r2(P["B_net"] / days)
        o["A_by_date"] = conc(pool_date[d]["A"])
        o["B_by_date"] = conc(pool_date[d]["B"])
        return o

    def ev_share(dct):
        pos = sorted(((v, k) for k, v in dct.items() if v > 0), reverse=True)
        tot = sum(dct.values())
        return {"total": r2(tot), "events_positive": len(pos),
                "top": [[k, r2(v), round(v / tot, 4) if tot > 0 else None] for v, k in pos[:5]]}

    def rule_out(R):
        return {"pnl": r2(R["pnl"]), "pnl_per_day": r2(R["pnl"] / days), "trap_pnl": r2(R["traps"]),
                "cost": r2(R["cost"]), "fills": R["fills"], "markets": len(R["units"]),
                "peak_capital": r2(peak(R["iv"])), "lock_median_h": round(q(R["lock"], 0.5) / 3600, 2) if R["lock"]
                else None, "concentration": conc(R["by_date"]),
                **({"at_level_shares": r2(R["at_level_shares"])} if "at_level_shares" in R else {})}

    top_a = sorted(((v["A"], k) for k, v in unit_pool.items() if v["A"] > 0), reverse=True)
    top_b = sorted(((v["B"], k) for k, v in unit_pool.items() if v["B"] > 0), reverse=True)
    tot_a = sum(v for v, _ in top_a)
    tot_b = sum(v for v, _ in top_b)
    wb = sorted(wallets_b[60].values(), reverse=True)
    out = {
        "category": inp.get("category"), "days": days, "units": len(units),
        "excluded_events": sorted(excl), "kinds": sorted(kinds) if kinds else None,
        "events": len({u["event"] for u in units}), "trap_units": n_trap_units,
        "trap_rate_units": round(n_trap_units / len(units), 4) if units else None,
        "trap_events": len({x["event"] for x in trap_units}),
        "lock_all_markets_median_h": round(q(locks_all, 0.5) / 3600, 2) if locks_all else None,
        "unverifiable_units": len(unverifiable),
        "closed_before_C_units": len(closed_first),
        "unverifiable_events": len({x["event"] for x in unverifiable}),
        "pool": {str(d): pool_out(pool[d], d) for d in DELAYS},
        "pool_by_event_from_C": {"A": ev_share(pool_event["A"]), "B": ev_share(pool_event["B"])},
        "pool_by_kind": {str(d): {k: {kk: (r2(vv) if kk.endswith("_net") else int(vv)) for kk, vv in sorted(v.items())}
                                  for k, v in sorted(by_kind[d].items())} for d in (0, 60, 300)},
        "profile_net_by_seconds_after_C": {m: {k: r2(v) for k, v in sorted(profile[m].items(),
                                                                          key=lambda x: int(x[0].split("-")[0]))}
                                           for m in ("A", "B")},
        "band_from_60s": {k: {"net": r2(v["net"]), "net_per_day": r2(v["net"] / days), "notional": r2(v["notional"]),
                              "edge_per_dollar": round(v["net"] / v["notional"], 5) if v["notional"] else None,
                              "dates": len(v["dates"]), "markets": len(v["markets"]), "trap_net": r2(v["trap_net"])}
                          for k, v in sorted(band.items())},
        "mode_b_by_price_from_60s": {k: {"prints": v[0], "shares": r2(v[1]), "net": r2(v[2])}
                                     for k, v in sorted(b_price.items())},
        "mode_a_rule": {str(d): rule_out(R) for d, R in rule_a.items()},
        "mode_b_rule_level": {f"{d}s_b{b0}": rule_out(R) for (d, b0), R in sorted(rule_b.items())},
        "mode_b_rule_tick_ahead": {str(d): rule_out(R) for d, R in rule_bt.items()},
        "mode_b_takers_from_60s": {"wallets": len(wb), "top_wallet_share": round(wb[0] / sum(wb), 4) if wb and sum(wb) > 0
                                   else None, "top5_share": round(sum(wb[:5]) / sum(wb), 4) if wb and sum(wb) > 0
                                   else None},
        "print_sizes_from_60s": {"A": {"n": len(sizes_a), "p50": q(sizes_a, 0.5), "p90": q(sizes_a, 0.9),
                                       "max": max(sizes_a) if sizes_a else None},
                                 "B": {"n": len(sizes_b), "p50": q(sizes_b, 0.5), "p90": q(sizes_b, 0.9),
                                       "max": max(sizes_b) if sizes_b else None}},
        "market_concentration_from_C": {
            "A_positive_markets": len(top_a), "A_top1_share": round(top_a[0][0] / tot_a, 4) if top_a else None,
            "A_top5_share": round(sum(v for v, _ in top_a[:5]) / tot_a, 4) if top_a else None,
            "B_positive_markets": len(top_b), "B_top1_share": round(top_b[0][0] / tot_b, 4) if top_b else None,
            "B_top5_share": round(sum(v for v, _ in top_b[:5]) / tot_b, 4) if top_b else None,
            "A_top": [[r2(v), k] for v, k in top_a[:5]], "B_top": [[r2(v), k] for v, k in top_b[:5]]},
        "trap_list": trap_units,
    }
    H.write_json(sys.argv[2], out)
    p0, p60, p300 = out["pool"]["0"], out["pool"]["60"], out["pool"]["300"]
    print(out["category"], "units", out["units"], "traps", n_trap_units,
          "| A net from C", p0["A_net"], "+60", p60["A_net"], "+300", p300["A_net"],
          "| B net from C", p0["B_net"], "+60", p60["B_net"], "| lock h", out["lock_all_markets_median_h"])


if __name__ == "__main__":
    main()
