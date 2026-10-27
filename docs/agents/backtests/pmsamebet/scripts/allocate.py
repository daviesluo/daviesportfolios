"""PMSAMEBET step 5b: what a budget could lock from one snapshot, on the covers without a known hole.

Covers with a known hole are left out: a SEATMOV or COMBO 'T.YES+Sc.YES' (it pays nothing if a third party wins or the
combination event resolves to an outcome that takes no orders), DUP-MANCITY (the standalone also pays on an expulsion
that is later overturned), and every OSCAR/NOMWIN cover is kept (A.NO+B.YES has no hole beyond its texts). The R and D
versions of one seat or chamber are the same trade, so one relation a pair is kept (its best). Greedy by edge per
dollar, each relation filled to the smaller of its capacity and the budget left, its profit pro rata (an upper bound:
the walked edge falls as it fills).

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/allocate.py <snapshot json> <results dir>
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

HOLED = {("SEATMOV", "T.YES+Sc.YES"), ("COMBO", "T.YES+Sc.YES")}


def base(rid):
    rid = re.sub(r"-(R|D)$", "", rid)                       # SEATMOV-VA-03-HOU-R
    rid = re.sub(r"(SEN|HOU)(R|D)-", r"\1-", rid)          # COMBO-SENR-OIL80
    rid = re.sub(r"-([A-Z]{2})(R|D)-3WAY$", r"-\1-3WAY", rid)
    return rid


def main():
    snap, res = sys.argv[1], sys.argv[2]
    rows = [r for r in pmnet.load(snap) if not r.get("missing_book")]
    t = rows[0]["t"]
    keep = {}
    for r in rows:
        if (r["family"], r["cover"]) in HOLED or r["id"] == "DUP-MANCITY" or r["touch_edge"] <= 0 or r["cap_capital"] <= 0:
            continue
        b = base(r["id"])
        ratio = r["cap_profit"] / r["cap_capital"]
        if b not in keep or ratio > keep[b][0]:
            keep[b] = (ratio, r)
    ranked = sorted(keep.values(), key=lambda x: -x[0])
    lines = [f"snapshot {t} UTC; clean covers with a positive edge, one per seat/chamber pair: {len(ranked)}; "
             f"their capacity ${sum(r['cap_capital'] for _, r in ranked):.2f}, profit at capacity ${sum(r['cap_profit'] for _, r in ranked):.2f}"]
    by_fam = {}
    for _, r in ranked:
        f = by_fam.setdefault(r["family"], [0, 0.0, 0.0])
        f[0] += 1
        f[1] += r["cap_capital"]
        f[2] += r["cap_profit"]
    for k, (n, c, p) in sorted(by_fam.items()):
        lines.append(f"  {k}: {n} relations, capacity ${c:.2f}, profit at capacity ${p:.2f} ({100 * p / c:.2f} % of capital)")
    for budget in (100, 300, 1000, 5000):
        left, prof, used = float(budget), 0.0, []
        for ratio, r in ranked:
            if left <= 0:
                break
            take = min(left, r["cap_capital"])
            prof += take * ratio
            left -= take
            used.append(r["id"])
        lines.append(f"budget ${budget}: profit ${prof:.2f} ({100 * prof / budget:.2f} %) across {len(used)} relations; "
                     f"latest end date among them {max((r['end'] for _, r in ranked if r['id'] in used), default='-')[:10]}")
    lines.append("top 15 by edge per dollar:")
    for ratio, r in ranked[:15]:
        lines.append(f"  {r['id']} {r['cover']} legs {r['legs']}: {100 * ratio:.2f} % on ${r['cap_capital']:.2f} "
                     f"(profit ${r['cap_profit']:.2f}), end {r['end'][:10]}")
    with open(os.path.join(res, "allocate.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
