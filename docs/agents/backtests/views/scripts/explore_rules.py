"""VIEWS exploration: what the closed tag-146 markets' records say about resolution and fees (printed; nothing written).

Counts every market's UMA status history, its fee schedule by the month it closed, and the phrases its rules use for
the window counted, so the universe builder parses what is there rather than what one event says.

usage: explore_rules.py
"""
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402


def main():
    d = os.path.join(V.DATA, "univ", "ev")
    evs = [V.load(p) for p in V.pmnet.list_json(d)]
    st = Counter()
    fees = defaultdict(Counter)
    phr = Counter()
    disputed = []
    for e in evs:
        slug = e.get("slug") or ""
        if "view" not in slug and "views" not in (e.get("title") or "").lower():
            continue
        desc = e.get("description") or ""
        for m in re.finditer(r"(first\s+\d+\s*\w+|on day \d|day \d|week 1|within \d+\s*\w+|\d+\s*hours? after)", desc, re.I):
            phr[m.group(1).lower()] += 1
        for m in e.get("markets") or []:
            s = V.jload(m.get("umaResolutionStatuses"), [])
            st[tuple(s)] += 1
            if "disputed" in s:
                disputed.append((slug, m.get("groupItemTitle"), s, m.get("outcomePrices"), m.get("closedTime")))
            ct = V.ts(m.get("closedTime"))
            mon = V.utc(ct).strftime("%Y-%m") if ct else "?"
            fs = m.get("feeSchedule") or {}
            fees[mon][(bool(m.get("feesEnabled")), fs.get("rate"), fs.get("exponent"), fs.get("takerOnly"))] += 1
    print("UMA status histories")
    for k, n in st.most_common():
        print(" ", n, k)
    print("disputed markets", len(disputed))
    for x in disputed:
        print(" ", x)
    print("fees by close month")
    for mon in sorted(fees):
        print(" ", mon, dict(fees[mon]))
    print("window phrases")
    for k, n in phr.most_common(40):
        print(" ", n, k)


if __name__ == "__main__":
    main()
