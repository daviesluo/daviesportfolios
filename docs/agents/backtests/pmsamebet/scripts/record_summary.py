"""PMSAMEBET step 6b: what the minute record of the books says — how often, how long and how much.

Reads $PM_DATA/record.jsonl (record.py). For each relation, each minute keeps its best cover (highest touch edge),
once over every cover and once over the clean covers only (allocate.py's rule: no SEATMOV/COMBO 'T.YES+Sc.YES', no
DUP-MANCITY). Per family: relation-minutes read, the share with a positive edge, the run lengths of positive stretches
(minutes in a row), how many stretches opened during the record (positive after a non-positive minute), the profit a
taker could have locked at each opening (capacity profit at that minute, and at $100 and $300 of capital), and the
median capacity while positive.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/record_summary.py <results dir>
"""
import json
import os
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

HOLED = {("SEATMOV", "T.YES+Sc.YES"), ("COMBO", "T.YES+Sc.YES")}


def summarise(recs, clean):
    best = {}
    for r in recs:
        if clean and ((r["family"], r["cover"]) in HOLED or r["id"] == "DUP-MANCITY"):
            continue
        k = (r["id"], r["t"])
        if k not in best or r["touch_edge"] > best[k]["touch_edge"]:
            best[k] = r
    series = defaultdict(list)
    for (rid, t), r in best.items():
        series[rid].append(r)
    fam = defaultdict(lambda: {"rel": 0, "min": 0, "pos": 0, "pos1c": 0, "runs": [], "opened": 0, "open100": 0.0,
                               "open300": 0.0, "opencap": 0.0, "cap": [], "always": 0, "ever": 0})
    rows = []
    for rid, xs in series.items():
        xs.sort(key=lambda r: r["t"])
        f = fam[xs[0]["family"]]
        f["rel"] += 1
        f["min"] += len(xs)
        pos = [r["touch_edge"] > 0 for r in xs]
        f["pos"] += sum(pos)
        f["pos1c"] += sum(1 for r in xs if r["touch_edge"] >= 0.01)
        f["always"] += all(pos)
        f["ever"] += any(pos)
        run = 0
        for i, p in enumerate(pos):
            if p:
                run += 1
                if i > 0 and not pos[i - 1]:
                    f["opened"] += 1
                    f["open100"] += xs[i]["profit_at_100"]
                    f["open300"] += xs[i]["profit_at_300"]
                    f["opencap"] += xs[i]["cap_profit"]
                f["cap"].append(xs[i]["cap_capital"])
            elif run:
                f["runs"].append(run)
                run = 0
        if run:
            f["runs"].append(run)
        rows.append((rid, xs[0]["family"], len(xs), sum(pos), max(r["touch_edge"] for r in xs),
                     statistics.median(r["cap_profit"] for r in xs)))
    return fam, rows, sorted({t for _, t in best})


def main():
    res = sys.argv[1]
    recs = [r for r in (json.loads(x) for x in open(os.path.join(pmnet.DATA, "record.jsonl"))) if not r.get("missing_book")]
    out = []
    for clean in (False, True):
        fam, rows, times = summarise(recs, clean)
        if not clean:
            out.append(f"minutes recorded {len(times)}: {times[0]} to {times[-1]} UTC; relations {len(rows)}")
            out.append("a relation-minute's edge is its best cover's touch edge at the asks (fees in)")
        out.append(f"\n=== {'clean covers only' if clean else 'every cover'} ===")
        for k in sorted(fam):
            f = fam[k]
            runs = sorted(f["runs"])
            out.append(f"{k}: relations {f['rel']}, relation-minutes {f['min']}, edge>0 {f['pos']} "
                       f"({100 * f['pos'] / max(1, f['min']):.1f} %), >=1c {f['pos1c']}; positive all along {f['always']}, ever {f['ever']}")
            if runs:
                out.append(f"   positive stretches {len(runs)}: median {statistics.median(runs)} min, "
                           f"p90 {runs[int(0.9 * (len(runs) - 1))]} min, longest {runs[-1]} min")
            out.append(f"   stretches opened during the record {f['opened']}: profit at the opening minute "
                       f"${f['open100']:.2f} at $100 each, ${f['open300']:.2f} at $300, ${f['opencap']:.2f} at capacity")
            if f["cap"]:
                out.append(f"   capacity while positive: median ${statistics.median(f['cap']):.0f} a relation-minute")
        if clean:
            out.append("\nclean: relations positive in >= 1 minute, by minutes positive:")
            for r in sorted(rows, key=lambda r: (-r[3], -r[4]))[:25]:
                if r[3]:
                    out.append(f"  {r[0]} ({r[1]}): {r[3]}/{r[2]} min positive, best edge {r[4]:.4f}, median capacity profit ${r[5]:.2f}")
    with open(os.path.join(res, "record_summary.txt"), "w") as f:
        f.write("\n".join(out) + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
