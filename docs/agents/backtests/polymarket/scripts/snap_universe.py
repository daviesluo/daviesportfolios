"""Snapshot of Polymarket's live structure (fp4, measurement M1).

Pulls, keylessly: every open market from Gamma (keyset pages), every current
liquidity-reward configuration from the CLOB (native and sponsored), and the
order book of every token of every rewarded or liquid market. Writes the raw
pulls to $PM_DATA/snap_<UTC stamp>/ and prints nothing but counts.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"

KEEP = [
    "id", "question", "conditionId", "slug", "endDate", "startDate", "createdAt", "outcomes", "outcomePrices",
    "active", "closed", "archived", "restricted", "enableOrderBook", "acceptingOrders", "orderPriceMinTickSize",
    "orderMinSize", "volumeNum", "liquidityNum", "volume24hr", "volume1wk", "volume1mo", "clobTokenIds", "negRisk",
    "negRiskOther", "groupItemTitle", "clobRewards", "rewardsMinSize", "rewardsMaxSpread", "spread", "bestBid",
    "bestAsk", "lastTradePrice", "oneDayPriceChange", "holdingRewardsEnabled", "feesEnabled", "feeType",
    "feeSchedule", "umaResolutionStatuses", "umaBond", "umaReward", "customLiveness", "resolvedBy", "rfqEnabled",
    "competitive", "sportsMarketType", "gameStartTime", "secondsDelay", "makerBaseFee", "takerBaseFee",
]
EV_KEEP = ["id", "slug", "title", "enableNegRisk", "negRiskAugmented", "seriesSlug", "openInterest", "volume24hr",
           "endDate", "startDate", "restricted"]


def all_open_markets():
    out, cursor, pages = [], None, 0
    while True:
        params = {"limit": 100, "closed": "false"}
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
    return out, pages


def all_rewards(sponsored):
    out, cursor = [], None
    while True:
        params = {"sponsored": "true" if sponsored else "false"}
        if cursor:
            params["next_cursor"] = cursor
        d = pmnet.get(CLOB + "/rewards/markets/current", params)
        out.extend(d.get("data", []))
        cursor = d.get("next_cursor")
        if not cursor or cursor == "LTE=" or not d.get("data"):
            break
    return out


def books(token_ids):
    out = {}
    for i in range(0, len(token_ids), 100):
        chunk = token_ids[i:i + 100]
        res = pmnet.post(CLOB + "/books", [{"token_id": t} for t in chunk])
        for b in res:
            out[b.get("asset_id")] = b
    return out


def main():
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    base = os.path.join(pmnet.DATA, "snap_" + stamp)
    t0 = time.time()
    markets, pages = all_open_markets()
    pmnet.dump(os.path.join(base, "markets.json"), markets)
    rw = all_rewards(False)
    pmnet.dump(os.path.join(base, "rewards_native.json"), rw)
    rws = all_rewards(True)
    pmnet.dump(os.path.join(base, "rewards_sponsored.json"), rws)
    rewarded = {r["condition_id"] for r in rw} | {r["condition_id"] for r in rws}
    toks = []
    for m in markets:
        if not m.get("enableOrderBook") or not m.get("acceptingOrders"):
            continue
        if m["conditionId"] in rewarded or (m.get("volume24hr") or 0) >= 1000:
            try:
                toks.extend(json.loads(m["clobTokenIds"] or "[]"))
            except ValueError:
                pass
    bk = books(toks)
    pmnet.dump(os.path.join(base, "books.json"), bk)
    meta = {"stamp": stamp, "t_start": t0, "t_end": time.time(), "markets": len(markets), "gamma_pages": pages,
            "rewards_native": len(rw), "rewards_sponsored": len(rws), "book_tokens": len(bk)}
    pmnet.dump(os.path.join(base, "meta.json"), meta)
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
