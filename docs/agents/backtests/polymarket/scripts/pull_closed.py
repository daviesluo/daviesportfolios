"""Every CLOSED Polymarket market whose end date falls in a window (fp4, data pull D1).

Gamma keyset pages, month by month, keeping the fields the tests and the
measurements read. Writes $PM_DATA/closed/<YYYY-MM>.json. Keyless.

usage: pull_closed.py 2024-10 2026-09
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
KEEP = [
    "id", "question", "conditionId", "questionID", "slug", "endDate", "startDate", "createdAt", "closedTime",
    "outcomes", "outcomePrices", "active", "closed", "archived", "enableOrderBook", "orderPriceMinTickSize",
    "orderMinSize", "volumeNum", "liquidityNum", "clobTokenIds", "negRisk", "negRiskOther", "groupItemTitle",
    "rewardsMinSize", "rewardsMaxSpread", "holdingRewardsEnabled", "feesEnabled", "feeType", "feeSchedule",
    "umaResolutionStatuses", "umaBond", "umaReward", "resolvedBy", "sportsMarketType", "gameStartTime",
    "automaticallyResolved", "resolutionSource", "lastTradePrice", "bestBid", "bestAsk",
]
EV_KEEP = ["id", "slug", "title", "enableNegRisk", "negRiskAugmented", "seriesSlug", "endDate", "startDate"]


def month_bounds(ym):
    y, m = map(int, ym.split("-"))
    start = f"{y:04d}-{m:02d}-01T00:00:00Z"
    y2, m2 = (y + 1, 1) if m == 12 else (y, m + 1)
    end = f"{y2:04d}-{m2:02d}-01T00:00:00Z"
    return start, end


def months(a, b):
    y, m = map(int, a.split("-"))
    y2, m2 = map(int, b.split("-"))
    out = []
    while (y, m) <= (y2, m2):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def pull_month(ym):
    path = os.path.join(pmnet.DATA, "closed", ym + ".json")
    if os.path.exists(path):
        return None
    start, end = month_bounds(ym)
    out, cursor, pages = [], None, 0
    while True:
        params = {"limit": 100, "closed": "true", "end_date_min": start, "end_date_max": end}
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


def main():
    a, b = sys.argv[1], sys.argv[2]
    for ym in months(a, b):
        t = time.time()
        r = pull_month(ym)
        print(ym, r, round(time.time() - t, 1), flush=True)


if __name__ == "__main__":
    main()
