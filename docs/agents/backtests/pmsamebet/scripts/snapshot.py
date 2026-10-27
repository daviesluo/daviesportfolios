"""PMSAMEBET step 5: one read of every relation's covers on the live books, summarised by family.

Writes $PM_DATA/snapshot_<UTC>.json (every cover row) and results/snapshot_summary.txt: per family, how many
relations have a cover with a positive touch edge, the edge distribution, the capacity and profit while the edge is
positive, and the top rows.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/snapshot.py <results dir>
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402
import books as B  # noqa: E402


def main():
    res = sys.argv[1]
    R = pmnet.load(os.path.join(pmnet.DATA, "relations.json"))
    rows, _ = B.snapshot(R)
    t = rows[0]["t"]
    pmnet.dump(os.path.join(pmnet.DATA, f"snapshot_{t.replace(':', '')}.json"), rows)
    fam = defaultdict(list)
    for r in rows:
        fam[r["family"]].append(r)
    best = {}
    for r in rows:
        if r.get("missing_book"):
            continue
        k = r["id"]
        if k not in best or r["touch_edge"] > best[k]["touch_edge"]:
            best[k] = r
    with open(os.path.join(res, "snapshot_summary.txt"), "w") as f:
        f.write(f"read {t} UTC; relations {len(R)}; cover rows {len(rows)}; "
                f"rows without a book {sum(1 for r in rows if r.get('missing_book'))}\n")
        f.write("edge = floor − Σ best asks − taker fees, in $ a share; capacity = shares/capital while the walked edge > 0\n\n")
        for fm in sorted(fam):
            rel = [b for b in best.values() if b["family"] == fm]
            pos = [b for b in rel if b["touch_edge"] > 0]
            e = sorted(b["touch_edge"] for b in rel)
            med = e[len(e) // 2] if e else None
            f.write(f"{fm}: relations priced {len(rel)}; best cover edge > 0 in {len(pos)}; "
                    f">= 0.5c {sum(1 for b in rel if b['touch_edge'] >= 0.005)}; >= 1c {sum(1 for b in rel if b['touch_edge'] >= 0.01)}; "
                    f">= 2c {sum(1 for b in rel if b['touch_edge'] >= 0.02)}; median best edge {med}\n")
            f.write(f"   sum over positive relations: capacity ${sum(b['cap_capital'] for b in pos):.2f}, "
                    f"profit at capacity ${sum(b['cap_profit'] for b in pos):.2f}, profit at $100 each ${sum(b['profit_at_100'] for b in pos):.2f}\n")
            for b in sorted(pos, key=lambda b: -b["cap_profit"])[:12]:
                f.write(f"   {b['id']} {b['cover']} legs {b['legs']} edge {b['touch_edge']:.4f} cap {b['cap_shares']:.0f} sh "
                        f"${b['cap_capital']:.2f} profit ${b['cap_profit']:.2f} (@$100 {b['profit_at_100']:.2f}) end {b['end'][:10]}\n")
    print(open(os.path.join(res, "snapshot_summary.txt")).read())


if __name__ == "__main__":
    main()
