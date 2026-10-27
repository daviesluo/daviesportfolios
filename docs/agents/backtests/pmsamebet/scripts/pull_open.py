"""PMSAMEBET step 1: every open Polymarket event with its markets (keyless Gamma `/events/keyset`, closed=false).

Writes $PM_DATA/open_events.json: a list of events, each trimmed to the fields the candidate finder and the spread
measurement read (title, slug, negRisk, tags, and per market the question, description, end date, tokens, best
bid/ask, fee schedule, volume, liquidity). Public reads only.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/pull_open.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
MK = ("id", "conditionId", "question", "description", "endDate", "clobTokenIds", "outcomes", "outcomePrices",
      "bestBid", "bestAsk", "lastTradePrice", "feeSchedule", "feesEnabled", "negRisk", "negRiskOther",
      "groupItemTitle", "volumeNum", "volume24hr", "liquidityNum", "active", "closed", "acceptingOrders",
      "resolutionSource", "orderPriceMinTickSize", "slug", "umaResolutionStatus")
EV = ("id", "slug", "title", "description", "endDate", "negRisk", "negRiskAugmented", "resolutionSource",
      "volume24hr", "volume", "liquidity", "startDate")


def main():
    out, cursor, pages = [], None, 0
    while True:
        params = {"closed": "false", "limit": 100}
        if cursor:
            params["after_cursor"] = cursor
        d = pmnet.get(GAMMA + "/events/keyset", params)
        for e in d.get("events") or []:
            r = {k: e.get(k) for k in EV}
            r["tags"] = [t.get("slug") for t in (e.get("tags") or []) if isinstance(t, dict)]
            r["markets"] = [{k: m.get(k) for k in MK} for m in (e.get("markets") or [])]
            out.append(r)
        pages += 1
        cursor = d.get("next_cursor")
        if pages % 20 == 0:
            print("pages", pages, "events", len(out), flush=True)
        if not cursor or not d.get("events"):
            break
    pmnet.dump(os.path.join(pmnet.DATA, "open_events.json"), out)
    print("events", len(out), "markets", sum(len(e["markets"]) for e in out))


if __name__ == "__main__":
    main()
