"""PMSAMEBET step 7b: the tape test without hindsight — signal from past prints, fill only at later prints.

history.py takes the cheapest print of each leg within ±W of an anchor, which looks into the future and picks the best
of many prints: an upper bound. Here a rule sees only the past. At each print of any leg (time t), each leg's latest
ask print in [t − LOOKBACK, t] is its quote; when every leg has one and floor − Σ quotes − fees > THRESH, that is a
signal (at most one a cover a minute, and none while a signal of the cover is less than COOLDOWN old). The trade buys
every leg at its FIRST ask print strictly after t + LAT and no later than t + FILL (a print shows the price somebody
else paid then; filling there assumes our order would have been at least as early — still generous). The shares are
the smallest of those prints' sizes and of $100 (or $300) of capital at the signal's cost. Fees as books.fee.

Reads the trade tapes history.py cached ($PM_DATA/trades) for the relations it chose.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/history_strict.py <snapshot json> <results dir>
"""
import bisect
import gzip
import json
import os
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402
import books as B  # noqa: E402

LOOKBACK, LAT, FILL, THRESH, COOLDOWN = 120, 2, 120, 0.005, 300


def main():
    snap, res = sys.argv[1], sys.argv[2]
    rows = pmnet.load(snap)
    best = defaultdict(lambda: -9.0)
    for r in rows:
        if not r.get("missing_book"):
            best[r["id"]] = max(best[r["id"]], r["touch_edge"])
    R = [r for r in pmnet.load(os.path.join(pmnet.DATA, "relations.json"))
         if r["family"] in ("COMBO", "DUP", "FED") or best[r["id"]] >= 0.005]
    pair = {}
    for e in pmnet.load(os.path.join(pmnet.DATA, "rel_events.json")).values():
        for m in e["markets"]:
            t = m.get("clobTokenIds")
            t = json.loads(t) if isinstance(t, str) else (t or [])
            if len(t) == 2:
                pair[t[0]], pair[t[1]] = t[1], t[0]
    asks = defaultdict(list)
    seen = set()
    for r in R:
        for c in r["covers"]:
            for lg in c["legs"]:
                if lg["cid"] in seen:
                    continue
                seen.add(lg["cid"])
                p = os.path.join(pmnet.DATA, "trades", lg["cid"] + ".json.gz")
                if not os.path.exists(p):
                    continue
                with gzip.open(p, "rt") as f:
                    rec = json.load(f)
                for x in rec["trades"]:
                    tok, pr, s, ts = x["asset"], float(x["price"]), float(x["size"]), int(x["timestamp"])
                    if x["side"] == "BUY":
                        asks[tok].append((ts, pr, s))
                    elif tok in pair:
                        asks[pair[tok]].append((ts, 1.0 - pr, s))
    for k in asks:
        asks[k].sort()
    out, fam = [], defaultdict(lambda: {"signals": 0, "filled": 0, "pnl100": [], "pnl300": [], "edges": []})
    for r in R:
        for c in r["covers"]:
            legs = c["legs"]
            ev = [asks.get(lg["token"], []) for lg in legs]
            if min(len(x) for x in ev) == 0:
                continue
            times = [[x[0] for x in e] for e in ev]
            allt = sorted({x[0] for e in ev for x in e})
            last_sig = -10 ** 12
            for t in allt:
                if t - last_sig < COOLDOWN:
                    continue
                q, ok = 0.0, True
                for j, e in enumerate(ev):
                    i = bisect.bisect_right(times[j], t) - 1
                    if i < 0 or e[i][0] < t - LOOKBACK:
                        ok = False
                        break
                    q += e[i][1] + B.fee(e[i][1], legs[j]["fee_rate"], legs[j]["fee_exp"])
                if not ok or c["floor"] - q <= THRESH:
                    continue
                last_sig = t
                f = fam[r["family"]]
                f["signals"] += 1
                cost, size, ok = 0.0, float("inf"), True
                for j, e in enumerate(ev):
                    i = bisect.bisect_right(times[j], t + LAT)
                    if i >= len(e) or e[i][0] > t + FILL:
                        ok = False
                        break
                    cost += e[i][1] + B.fee(e[i][1], legs[j]["fee_rate"], legs[j]["fee_exp"])
                    size = min(size, e[i][2])
                row = {"id": r["id"], "family": r["family"], "cover": c["name"], "t": t, "signal_edge": round(c["floor"] - q, 4)}
                if ok:
                    edge = c["floor"] - cost
                    f["filled"] += 1
                    f["edges"].append(edge)
                    for cap, key in ((100.0, "pnl100"), (300.0, "pnl300")):
                        sh = min(size, cap / max(cost, 1e-6))
                        f[key].append(sh * edge)
                    row.update({"fill_edge": round(edge, 4), "shares": round(size, 2)})
                out.append(row)
    pmnet.dump(os.path.join(pmnet.DATA, "history_strict.json"), out)
    lines = [f"signal: past ask prints of every leg within {LOOKBACK} s sum to more than {THRESH} under the floor; "
             f"fill: each leg's first ask print in (t+{LAT} s, t+{FILL} s]; one signal a cover per {COOLDOWN} s"]
    tot100 = tot300 = 0.0
    for k in sorted(fam):
        f = fam[k]
        e = f["edges"]
        lines.append(f"{k}: signals {f['signals']}, all legs printed after the signal {f['filled']}, "
                     f"fill edge > 0 in {sum(1 for x in e if x > 0)}, mean fill edge {statistics.fmean(e) if e else 0:+.4f}, "
                     f"median {statistics.median(e) if e else 0:+.4f}; P&L at <= $100 a signal ${sum(f['pnl100']):+.2f}, "
                     f"at <= $300 ${sum(f['pnl300']):+.2f}")
        tot100 += sum(f["pnl100"])
        tot300 += sum(f["pnl300"])
    lines.append(f"all families: P&L ${tot100:+.2f} at <= $100 a signal, ${tot300:+.2f} at <= $300, over the tapes' 14 days")
    byrel = defaultdict(list)
    for x in out:
        if "fill_edge" in x:
            byrel[(x["id"], x["cover"])].append(x["fill_edge"])
    lines.append("covers with the most filled signals:")
    for (rid, cv), e in sorted(byrel.items(), key=lambda kv: -len(kv[1]))[:15]:
        lines.append(f"  {rid} {cv}: {len(e)} filled, mean edge {statistics.fmean(e):+.4f}, positive {sum(1 for x in e if x > 0)}")
    with open(os.path.join(res, "history_strict.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
