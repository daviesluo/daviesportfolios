"""S5: Limitless (Base-chain prediction-market CLOB), keyless: every active market's reward settings and volume.

GET https://api.limitless.exchange/markets/active?limit=25&page=N. Each market carries `isRewardable` and
`settings` {minSize, maxSpread, dailyReward, effectiveDailyReward, c, rebateRate, takerDelayMs}: the same shape as
Polymarket's liquidity rewards (a size floor, a max spread from the midpoint, a daily pool, c = 3). Amounts with six
decimals (USDC base units) are converted. Saves inputs/limitless/active_<date>.json.gz and prints aggregates.
usage: python3 pull_limitless.py
"""
import datetime, gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get_json

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    rows, page = [], 1
    while True:
        st, d = get_json(f"https://api.limitless.exchange/markets/active?limit=25&page={page}")
        if st != 200 or not d or not d.get("data"):
            break
        rows += d["data"]
        page += 1
        time.sleep(0.3)
        if page > 100:
            break
    now = datetime.datetime.now(datetime.timezone.utc)
    os.makedirs(os.path.join(HERE, "inputs", "limitless"), exist_ok=True)
    keep = [{k: m.get(k) for k in ("id", "slug", "title", "isRewardable", "settings", "volume", "volumeFormatted", "expirationTimestamp", "tradeType", "categories", "prices")} for m in rows]
    with gzip.open(os.path.join(HERE, "inputs", "limitless", f"active_{now:%Y-%m-%d}.json.gz"), "wt") as f:
        json.dump({"pulled_at": now.isoformat(), "markets": keep}, f, sort_keys=True)
    rew = [m for m in rows if m.get("isRewardable")]
    dr = [float((m.get("settings") or {}).get("dailyReward") or 0) for m in rew]
    edr = [float((m.get("settings") or {}).get("effectiveDailyReward") or 0) for m in rew]
    vol = [float(m.get("volumeFormatted") or 0) for m in rows]
    out = {"pulled_at": now.isoformat(), "active_markets": len(rows), "rewardable": len(rew),
           "dailyReward_sum_raw": sum(dr), "effectiveDailyReward_sum_raw": sum(edr),
           "markets_with_positive_dailyReward": sum(1 for x in dr if x > 0),
           "volume_sum_usd_formatted": round(sum(vol), 2),
           "top_dailyReward": sorted(((float((m.get('settings') or {}).get('dailyReward') or 0), m["slug"][:60]) for m in rew), reverse=True)[:10],
           "rebateRate_counts": {}}
    for m in rew:
        k = str((m.get("settings") or {}).get("rebateRate"))
        out["rebateRate_counts"][k] = out["rebateRate_counts"].get(k, 0) + 1
    json.dump(out, open(os.path.join(HERE, "results", f"limitless_{now:%Y-%m-%d}.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
