"""PMSAMEBET step 7: the same covers on the trade tape — could both (all) legs have been bought at prints within a
minute or two of each other, for less than the floor?

For every market of the chosen relations the keyless data API's trades (taker prints) of the last DAYS days are read
(`/trades?market=<conditionId>`, paged to the API's offset cap). A taker BUY of a token at p shows that token's ask
at p; a taker SELL of a token at p shows the OTHER token's ask at 1 − p (the two books are one book mirrored). For each
cover, each print of its least-traded leg anchors a check: every other leg takes its cheapest ask print within ±W
seconds; when all legs have one, edge = floor − Σ prices − taker fees. Reported per relation: anchors checked, anchors
with every leg printed, minutes with edge > 0, > 0.5 c, > 1 c, the best edge, distinct episodes (positive minutes
merged across gaps under 5 minutes) and the shares the smallest leg print showed.

Relations taken: every COMBO, DUP and FED relation, and the other families' relations whose best cover had a touch
edge >= 0.5 c in the snapshot named.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/history.py <snapshot json> <days> <results dir>
"""
import bisect
import gzip
import json
import os
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402
import books as B  # noqa: E402

DATA_API = "https://data-api.polymarket.com"
WINDOWS = (60, 120)


def pull_trades(cid, since, folder):
    path = os.path.join(folder, cid + ".json.gz")
    if os.path.exists(path):
        with gzip.open(path, "rt") as f:
            return json.load(f)
    out, offset, capped = [], 0, False
    while True:
        try:
            d = pmnet.get(DATA_API + "/trades", {"market": cid, "limit": 500, "offset": offset, "takerOnly": "true"})
        except RuntimeError as e:
            if offset > 0 and "400" in str(e):
                capped = True
                break
            raise
        if not d:
            break
        out += d
        if min(x["timestamp"] for x in d) < since or len(d) < 500:
            break
        offset += 500
        if offset > 10000:
            capped = True
            break
    rec = {"cid": cid, "capped": capped, "trades": [
        {k: x.get(k) for k in ("asset", "side", "price", "size", "timestamp", "outcome")} for x in out if x["timestamp"] >= since]}
    with gzip.open(path, "wt") as f:
        json.dump(rec, f)
    return rec


def main():
    snap, days, res = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    now = int(time.time())
    since = now - days * 86400
    rows = pmnet.load(snap)
    best = defaultdict(lambda: -9.0)
    for r in rows:
        if not r.get("missing_book"):
            best[r["id"]] = max(best[r["id"]], r["touch_edge"])
    R = [r for r in pmnet.load(os.path.join(pmnet.DATA, "relations.json"))
         if r["family"] in ("COMBO", "DUP", "FED") or best[r["id"]] >= 0.005]
    folder = os.path.join(pmnet.DATA, "trades")
    os.makedirs(folder, exist_ok=True)
    # token -> its sibling token, from the legs (every leg carries its market's id; siblings are read off the trades)
    cids = sorted({lg["cid"] for r in R for c in r["covers"] for lg in c["legs"]})
    print("relations", len(R), "markets", len(cids), flush=True)
    asks = defaultdict(list)   # token -> [(ts, price, size)]
    capped = []
    tokens_of_cid = defaultdict(set)
    for r in R:
        for c in r["covers"]:
            for lg in c["legs"]:
                tokens_of_cid[lg["cid"]].add(lg["token"])
    rel_ev = pmnet.load(os.path.join(pmnet.DATA, "rel_events.json"))
    pair = {}
    for e in rel_ev.values():
        for m in e["markets"]:
            t = m.get("clobTokenIds")
            t = json.loads(t) if isinstance(t, str) else (t or [])
            if len(t) == 2:
                pair[t[0]], pair[t[1]] = t[1], t[0]
    for i, cid in enumerate(cids):
        rec = pull_trades(cid, since, folder)
        if rec["capped"]:
            capped.append(cid)
        for x in rec["trades"]:
            tok, p, s, ts = x["asset"], float(x["price"]), float(x["size"]), int(x["timestamp"])
            if x["side"] == "BUY":
                asks[tok].append((ts, p, s))
            elif tok in pair:
                asks[pair[tok]].append((ts, 1.0 - p, s))
        if i % 100 == 0:
            print("markets read", i, flush=True)
    for tok in asks:
        asks[tok].sort()
    out = []
    for r in R:
        for c in r["covers"]:
            legs = c["legs"]
            ev = [asks.get(lg["token"], []) for lg in legs]
            for W in WINDOWS:
                row = {"id": r["id"], "family": r["family"], "cover": c["name"], "legs": len(legs), "W": W,
                       "prints_per_leg": [len(x) for x in ev], "anchors": 0, "complete": 0, "best_edge": None,
                       "min_pos": 0, "pos_shares": 0.0}
                if min(len(x) for x in ev) == 0:
                    out.append(row)
                    continue
                a = min(range(len(legs)), key=lambda i: len(ev[i]))
                per_min = {}
                for ts, p, s in ev[a]:
                    row["anchors"] += 1
                    total, size, ok = p + B.fee(p, legs[a]["fee_rate"], legs[a]["fee_exp"]), s, True
                    for j in range(len(legs)):
                        if j == a:
                            continue
                        times = [x[0] for x in ev[j]]
                        lo, hi = bisect.bisect_left(times, ts - W), bisect.bisect_right(times, ts + W)
                        if lo >= hi:
                            ok = False
                            break
                        q, qs = min((ev[j][k][1], ev[j][k][2]) for k in range(lo, hi))
                        total += q + B.fee(q, legs[j]["fee_rate"], legs[j]["fee_exp"])
                        size = min(size, qs)
                    if not ok:
                        continue
                    row["complete"] += 1
                    edge = c["floor"] - total
                    mnt = ts // 60
                    if mnt not in per_min or edge > per_min[mnt][0]:
                        per_min[mnt] = (edge, size)
                if per_min:
                    row["best_edge"] = round(max(v[0] for v in per_min.values()), 4)
                pos = sorted(m for m, v in per_min.items() if v[0] > 0)
                row["min_complete"] = len(per_min)
                row["min_pos"] = len(pos)
                row["min_pos_half_c"] = sum(1 for v in per_min.values() if v[0] > 0.005)
                row["min_pos_1c"] = sum(1 for v in per_min.values() if v[0] > 0.01)
                row["pos_shares"] = round(sum(per_min[m][1] for m in pos), 1)
                row["pos_profit_at_print_size"] = round(sum(per_min[m][1] * per_min[m][0] for m in pos), 2)
                ep, last = 0, None
                for m in pos:
                    if last is None or m - last > 5:
                        ep += 1
                    last = m
                row["episodes"] = ep
                out.append(row)
    pmnet.dump(os.path.join(pmnet.DATA, f"history_{days}d.json"), out)
    with open(os.path.join(res, f"history_{days}d_summary.txt"), "w") as f:
        f.write(f"read {time.strftime('%Y-%m-%dT%H:%MZ', time.gmtime(now))}; window {days} days; relations {len(R)}; "
                f"markets {len(cids)}; markets whose tape hit the offset cap {len(capped)}\n")
        f.write("per family and window W (s): covers with every leg printed within W of an anchor; minutes with edge > 0 / > 0.5c / > 1c;"
                " episodes; shares and $ the smallest leg print showed in the positive minutes\n")
        fams = sorted({x["family"] for x in out})
        for fm in fams:
            for W in WINDOWS:
                xs = [x for x in out if x["family"] == fm and x["W"] == W]
                comp = [x for x in xs if x.get("min_complete")]
                f.write(f"{fm} W={W}: covers {len(xs)}, with complete checks {len(comp)}, complete minutes "
                        f"{sum(x.get('min_complete', 0) for x in xs)}, minutes edge>0 {sum(x.get('min_pos', 0) for x in xs)}, "
                        f">0.5c {sum(x.get('min_pos_half_c', 0) for x in xs)}, >1c {sum(x.get('min_pos_1c', 0) for x in xs)}, "
                        f"episodes {sum(x.get('episodes', 0) for x in xs)}, shares {sum(x.get('pos_shares', 0) for x in xs):.0f}, "
                        f"profit at print size ${sum(x.get('pos_profit_at_print_size', 0) for x in xs):.2f}\n")
        f.write("\ncovers with a positive minute (W=120), by profit at print size:\n")
        top = sorted((x for x in out if x["W"] == 120 and x.get("min_pos")), key=lambda x: -x["pos_profit_at_print_size"])
        for x in top[:40]:
            f.write(f"  {x['id']} {x['cover']} legs {x['legs']} complete min {x['min_complete']} pos min {x['min_pos']} "
                    f">1c {x['min_pos_1c']} episodes {x['episodes']} best {x['best_edge']} shares {x['pos_shares']} "
                    f"${x['pos_profit_at_print_size']}\n")
    print(open(os.path.join(res, f"history_{days}d_summary.txt")).read())


if __name__ == "__main__":
    main()
