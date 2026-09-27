"""VIEWS exploration: list every closed tag-146 event with what its rules say (printed; nothing written).

usage: explore_universe.py [--desc SLUG_SUBSTRING] [--all]
"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402


def main():
    d = os.path.join(V.DATA, "univ", "ev")
    evs = [V.load(p) for p in V.pmnet.list_json(d)]
    if "--desc" in sys.argv:
        sub = sys.argv[sys.argv.index("--desc") + 1]
        for e in evs:
            if sub in (e.get("slug") or ""):
                print("=" * 100)
                print(e.get("slug"), e.get("title"), e.get("startDate"), e.get("endDate"), e.get("closedTime"))
                print((e.get("description") or "")[:3000])
                for m in e.get("markets") or []:
                    print("  ", m.get("groupItemTitle"), "|", (m.get("question") or "")[:100], "|", m.get("outcomePrices"),
                          "|", m.get("umaResolutionStatus"), m.get("umaResolutionStatuses"), "| fee", m.get("feesEnabled"),
                          m.get("feeSchedule"), "| vol", m.get("volumeNum"), "| closed", m.get("closedTime"),
                          "| end", m.get("endDate"), "| resSrc", (m.get("resolutionSource") or "")[:80])
        return
    rows = []
    for e in evs:
        desc = e.get("description") or ""
        if not desc and e.get("markets"):
            desc = e["markets"][0].get("description") or ""
        series = [s.get("slug") for s in e.get("series") or []]
        rows.append((e.get("endDate") or "", e.get("slug"), (e.get("title") or "")[:70], series[0] if series else None,
                     len(e.get("markets") or []), round(float(e.get("volume") or 0)), V.window_hours(desc),
                     V.handle_of(desc), V.videos_of(desc)[:2]))
    rows.sort()
    c = Counter(r[3] for r in rows)
    for k, n in c.most_common():
        print(n, k)
    if "--all" in sys.argv:
        for r in rows:
            print(r)


if __name__ == "__main__":
    main()
