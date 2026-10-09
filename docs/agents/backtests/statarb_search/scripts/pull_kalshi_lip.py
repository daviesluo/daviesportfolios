"""S3: Kalshi's liquidity / volume incentive programs, keyless (GET /trade-api/v2/incentive_programs, every page).

Saves the programs active at the pull instant to inputs/kalshi/incentive_programs_<date>.json.gz and prints aggregates: active programs on the
pull instant, their reward per day by type, and the largest series. `period_reward` is read as centi-cents
(1/10,000 of a dollar), per Kalshi's API reference for incentive programs; the dollar figure is printed both ways
so the unit can be checked against Kalshi's own announcement.
usage: python3 pull_kalshi_lip.py
"""
import collections, datetime, gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get_json

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    rows, cur = [], ""
    while True:
        u = "https://api.elections.kalshi.com/trade-api/v2/incentive_programs?limit=1000" + (f"&cursor={cur}" if cur else "")
        st, d = get_json(u)
        if st != 200 or d is None:
            raise SystemExit(f"kalshi {st}")
        rows += d.get("incentive_programs") or []
        cur = d.get("next_cursor") or ""
        time.sleep(0.3)
        if not cur:
            break
    now = datetime.datetime.now(datetime.timezone.utc)
    os.makedirs(os.path.join(HERE, "inputs", "kalshi"), exist_ok=True)
    fn = os.path.join(HERE, "inputs", "kalshi", f"incentive_programs_{now:%Y-%m-%d}.json.gz")
    P = lambda s: datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    act = [r for r in rows if P(r["start_date"]) <= now < P(r["end_date"])]
    with gzip.open(fn, "wt") as f:   # only the programs active at the pull instant (the full list is ~17 MB)
        json.dump({"pulled_at": now.isoformat(), "programs_listed": len(rows), "active_programs": act}, f, sort_keys=True)
    out = {"programs": len(rows), "active": len(act), "pulled_at": now.isoformat()}
    by = collections.defaultdict(float)
    ser = collections.defaultdict(float)
    for r in act:
        days = (P(r["end_date"]) - P(r["start_date"])).total_seconds() / 86400
        perday = r["period_reward"] / days
        by[r["incentive_type"]] += perday
        ser[r["market_ticker"].split("-")[0]] += perday
    out["reward_per_day_raw_units_by_type"] = {k: round(v) for k, v in by.items()}
    out["reward_per_day_usd_if_centicents"] = {k: round(v / 10000, 2) for k, v in by.items()}
    out["reward_per_day_usd_if_cents"] = {k: round(v / 100, 2) for k, v in by.items()}
    out["top_series_usd_per_day_if_centicents"] = [(k, round(v / 10000, 2)) for k, v in sorted(ser.items(), key=lambda x: -x[1])[:15]]
    out["active_markets"] = len({r["market_ticker"] for r in act})
    out["target_size_median"] = sorted(float(r.get("target_size_fp") or 0) for r in act)[len(act) // 2] if act else None
    out["discount_factor_bps"] = dict(collections.Counter(r.get("discount_factor_bps") for r in act))
    print(json.dumps(out, indent=1))
    json.dump(out, open(os.path.join(HERE, "results", f"kalshi_lip_{now:%Y-%m-%d}.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
