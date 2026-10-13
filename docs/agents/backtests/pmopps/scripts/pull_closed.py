"""PMOPPS: every CLOSED Polymarket market with at least $20,000 of volume whose end date falls in a month (keyless).

Gamma's keyset pages (`/markets/keyset`, `volume_num_min`), month by month, keeping the fields the studies read.
Writes $PM_DATA/closed/<YYYY-MM>.json. Public reads only.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/pull_closed.py 2025-01 2026-10
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
MIN_VOL = 20000
KEEP = [
    "id", "question", "conditionId", "questionID", "slug", "endDate", "startDate", "createdAt", "closedTime",
    "outcomes", "outcomePrices", "volumeNum", "clobTokenIds", "negRisk", "negRiskOther", "groupItemTitle",
    "feeType", "umaResolutionStatuses", "umaResolutionStatus", "umaBond", "umaReward", "umaEndDate", "resolvedBy",
    "sportsMarketType", "gameStartTime", "automaticallyResolved", "resolutionSource", "orderPriceMinTickSize",
]
EV_KEEP = ["id", "slug", "title", "enableNegRisk", "negRiskAugmented", "seriesSlug"]


def month_bounds(ym):
    y, m = map(int, ym.split("-"))
    y2, m2 = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y:04d}-{m:02d}-01T00:00:00Z", f"{y2:04d}-{m2:02d}-01T00:00:00Z"


def months(a, b):
    y, m = map(int, a.split("-")); y2, m2 = map(int, b.split("-")); out = []
    while (y, m) <= (y2, m2):
        out.append(f"{y:04d}-{m:02d}"); y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def pull_month(ym):
    path = os.path.join(pmnet.DATA, "closed", ym + ".json")
    if os.path.exists(path):
        return None
    start, end = month_bounds(ym)
    out, cursor, pages = [], None, 0
    while True:
        params = {"limit": 100, "closed": "true", "end_date_min": start, "end_date_max": end, "volume_num_min": MIN_VOL}
        if cursor:
            params["after_cursor"] = cursor
        d = pmnet.get(GAMMA + "/markets/keyset", params)
        for m in d.get("markets", []):
            r = {k: m.get(k) for k in KEEP}
            r["events"] = [{k: e.get(k) for k in EV_KEEP} for e in (m.get("events") or [])]
            out.append(r)
        pages += 1
        cursor = d.get("next_cursor")
        if not cursor or not d.get("markets"):
            break
    pmnet.dump(path, out)
    return len(out), pages


if __name__ == "__main__":
    for ym in months(sys.argv[1], sys.argv[2]):
        t = time.time()
        print(ym, pull_month(ym), round(time.time() - t, 1), flush=True)
