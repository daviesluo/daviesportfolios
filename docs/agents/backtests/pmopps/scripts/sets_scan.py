"""PMOPPS: negative-risk sets and date ladders, minute by minute, on pm-rec's recorded books (2026-10-04 19:00 ->
2026-10-12 23:59 UTC).

A NEGATIVE-RISK set (one event, exactly one market resolves YES, not augmented with an unnamed "Other") pays $1 to
whoever holds every YES, and n - 1 to whoever holds every NO. So, at one minute, with every market of the event in
the recorded books:
  - buy every YES at its best ask: an edge when sum(ask) + taker fees < 1;
  - buy every NO (at 1 - each YES best bid): an edge when sum(bid) - fees > 1.
A DATE LADDER (one event, "... by <date>" markets, an earlier date implies the later one) pays at least $1 to whoever
holds the later YES and the earlier NO: an edge when the earlier market's best bid > the later's best ask + fees.
Every leg is a taker at the recorded touch, walked down the recorded levels (10 c of each side) while the next set
still has an edge; fee = rate x p x (1 - p) a share at the market's fee type (reference §2d's table). Capital is
locked until the event resolves.

Writes $PM_DATA/sets_scan.json (every minute with a gross edge, and per event the minutes it was complete) and prints
the summary.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/sets_scan.py <pmrec dir> <events.json>
"""
import glob
import gzip
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime
from multiprocessing import Pool

PMREC, EVJ = sys.argv[1], sys.argv[2]
OUT = os.path.join(os.environ.get("PM_DATA", "."), "sets_scan.json")
FEE = {"politics_fees": 0.04, "finance_prices_fees": 0.04, "tech_fees": 0.04, "mentions_fees": 0.04, "culture_fees": 0.05,
       "economics_fees": 0.05, "weather_fees": 0.05, "general_fees": 0.05, "sports_fees_v2": 0.05, "sports_fees_v3": 0.05,
       "crypto_fees_v2": 0.07, "crypto_fees": 0.07, "sports_fees": 0.03, None: 0.0}


def ep(s):
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


# pm-rec's id -> condition, fee type (every day's dump: a market seen on any day)
idof, fee = {}, {}
for p in sorted(glob.glob(os.path.join(PMREC, "markets_*.gz"))):
    with gzip.open(p, "rt") as f:
        for line in f:
            x = json.loads(line)
            if "cond" in x:
                idof[x["cond"]] = x["id"]; fee[x["cond"]] = x.get("fee_type")
events = json.load(open(EVJ))
sets, ladders = {}, {}
for slug, e in events.items():
    ms = e.get("markets") or []
    if len(ms) < 2 or any(m.get("conditionId") not in idof for m in ms):
        continue
    ids = [idof[m["conditionId"]] for m in ms]
    if e.get("negRisk") and not e.get("augmented") and not any(m.get("negRiskOther") for m in ms):
        sets[slug] = ids
    elif not e.get("negRisk"):
        qs = [(m.get("question") or "").lower() for m in ms]
        if all(re.search(r"\bby\b", q) for q in qs) and all(m.get("endDate") for m in ms):
            order = sorted(range(len(ms)), key=lambda i: ms[i]["endDate"])
            ends = [ms[i]["endDate"] for i in order]
            if len(set(ends)) == len(ends):
                ladders[slug] = [ids[i] for i in order]
need = {i for v in sets.values() for i in v} | {i for v in ladders.values() for i in v}
cond_of = {v: k for k, v in idof.items()}
rate = {i: FEE.get(fee.get(cond_of.get(i)), 0.05) for i in need}


def frame_books(path):
    """Each minute of one hour's books object: id -> (bids [(p, s)], asks [(p, s)]) for the ids needed."""
    out = {}
    minute = None
    with gzip.open(path, "rt") as f:
        for line in f:
            if line.startswith("{"):
                minute = ep(json.loads(line)["minute"]); out[minute] = {}; continue
            x = json.loads(line)
            if x[0] in need:
                out[minute][x[0]] = ([(p / 1e4, s / 100) for p, s in zip(x[3], x[4])], [(p / 1e4, s / 100) for p, s in zip(x[5], x[6])])
    return out


def walk(legs, fee_rates, side):
    """Sets bought by walking each leg's levels while one more set still pays. side 'yes': buy every YES at the asks
    (pays 1); side 'no': buy every NO at 1 - the YES bids (pays n - 1). Returns (sets, profit $, first-set edge c)."""
    lv = [list(l) for l in legs]
    n = len(lv)
    sets = profit = 0.0
    first = None
    while all(lv):
        px = [l[0][0] for l in lv]
        if side == "yes":
            cost = sum(p + r * p * (1 - p) for p, r in zip(px, fee_rates)); pay = 1.0
        else:
            cost = sum((1 - p) + r * p * (1 - p) for p, r in zip(px, fee_rates)); pay = n - 1.0
        edge = pay - cost
        if first is None: first = 100 * edge
        if edge <= 1e-9: break
        q = min(l[0][1] for l in lv)
        sets += q; profit += q * edge
        for l in lv:
            p, s = l[0]
            if s - q <= 1e-9: l.pop(0)
            else: l[0] = (p, s - q)
    return sets, profit, first


def scan(path):
    fb = frame_books(path)
    hits, complete = [], defaultdict(int)
    for minute, bk in fb.items():
        for slug, ids in sets.items():
            if not all(i in bk and bk[i][0] and bk[i][1] for i in ids):
                continue
            complete[("set", slug)] += 1
            fr = [rate[i] for i in ids]
            sb = sum(bk[i][0][0][0] for i in ids); sa = sum(bk[i][1][0][0] for i in ids)
            for side, legs in (("yes", [bk[i][1] for i in ids]), ("no", [bk[i][0] for i in ids])):
                gross = (1 - sa) if side == "yes" else (sb - 1)
                if gross > 1e-9:
                    s, pr, fe = walk(legs, fr, side)
                    hits.append(["set", slug, side, minute, len(ids), round(100 * gross, 3), round(fe, 3), round(s, 2), round(pr, 4)])
        for slug, ids in ladders.items():
            if not all(i in bk and bk[i][0] and bk[i][1] for i in ids):
                continue
            complete[("ladder", slug)] += 1
            for a in range(len(ids)):
                for b in range(a + 1, len(ids)):
                    e_, l_ = ids[a], ids[b]                       # earlier, later
                    bid_e, ask_l = bk[e_][0][0][0], bk[l_][1][0][0]
                    if bid_e - ask_l > 1e-9:
                        # buy the later YES at its asks and the earlier NO at 1 - its bids: pays >= 1
                        lv_l = list(bk[l_][1]); lv_e = list(bk[e_][0]); sets_ = pr = 0.0; first = None
                        while lv_l and lv_e:
                            pl, pe = lv_l[0][0], lv_e[0][0]
                            cost = pl + rate[l_] * pl * (1 - pl) + (1 - pe) + rate[e_] * pe * (1 - pe)
                            edge = 1 - cost
                            if first is None: first = 100 * edge
                            if edge <= 1e-9: break
                            q = min(lv_l[0][1], lv_e[0][1]); sets_ += q; pr += q * edge
                            for lv in (lv_l, lv_e):
                                p, s = lv[0]
                                if s - q <= 1e-9: lv.pop(0)
                                else: lv[0] = (p, s - q)
                        hits.append(["ladder", slug, f"{a}<{b}", minute, 2, round(100 * (bid_e - ask_l), 3), round(first, 3), round(sets_, 2), round(pr, 4)])
    return hits, dict(complete), len(fb)


if __name__ == "__main__":
    files = sorted(glob.glob(os.path.join(PMREC, "books_*.gz")))
    allh, comp, mins = [], defaultdict(int), 0
    with Pool(4) as pool:
        for h, c, n in pool.imap_unordered(scan, files):
            allh.extend(h); mins += n
            for k, v in c.items(): comp[k] += v
    allh.sort(key=lambda r: (r[0], r[1], r[2], r[3]))
    json.dump({"sets": len(sets), "ladders": len(ladders), "minutes": mins, "hits": allh,
               "complete": [[k[0], k[1], v] for k, v in sorted(comp.items())]}, open(OUT, "w"))
    print("neg-risk sets", len(sets), "date ladders", len(ladders), "frames", mins, "hits", len(allh),
          "complete event-minutes", sum(comp.values()))
