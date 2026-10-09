"""S4: DeFi stable-against-stable pools (fees paid by swappers + incentive tokens), keyless from DefiLlama.

GET https://yields.llama.fi/pools (every pool DefiLlama tracks). Saves the stable subset to
inputs/defi/stable_pools_<date>.json.gz and prints the distribution of base (fee) and reward APY for pools with
stablecoin == true, ilRisk == "no", TVL >= $5M, by chain and project, against a cash rate of 4 %.
apyBase is the pool's fee yield over the last day annualised; apyMean30d the 30-day mean of total APY.
usage: python3 pull_defi_yields.py
"""
import datetime, gzip, json, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get_json

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASH = 4.0


def main():
    st, d = get_json("https://yields.llama.fi/pools", timeout=120)
    if st != 200:
        raise SystemExit(f"llama {st}")
    pools = d["data"]
    now = datetime.datetime.now(datetime.timezone.utc)
    stable = [p for p in pools if p.get("stablecoin") and p.get("ilRisk") == "no"]
    os.makedirs(os.path.join(HERE, "inputs", "defi"), exist_ok=True)
    with gzip.open(os.path.join(HERE, "inputs", "defi", f"stable_pools_{now:%Y-%m-%d}.json.gz"), "wt") as f:
        json.dump({"pulled_at": now.isoformat(), "pools": stable}, f, sort_keys=True)
    big = [p for p in stable if (p.get("tvlUsd") or 0) >= 5e6]
    lp = [p for p in big if p.get("exposure") == "multi"]          # two-sided pools: an LP, not a lending deposit
    lend = [p for p in big if p.get("exposure") == "single"]
    def summ(xs):
        b = [p.get("apyBase") or 0 for p in xs]
        r = [p.get("apyReward") or 0 for p in xs]
        m = [p.get("apyMean30d") or 0 for p in xs]
        tvl = sum(p["tvlUsd"] for p in xs)
        return {"n": len(xs), "tvl_usd_m": round(tvl / 1e6), "apyBase_median": round(statistics.median(b), 2) if b else None,
                "apyReward_median": round(statistics.median(r), 2) if r else None, "apyMean30d_median": round(statistics.median(m), 2) if m else None,
                "tvl_weighted_apyBase": round(sum((p.get("apyBase") or 0) * p["tvlUsd"] for p in xs) / tvl, 2) if tvl else None,
                "share_mean30d_over_cash+4": round(sum(1 for v in m if v > CASH + 4) / len(m), 3) if m else None}
    out = {"pulled_at": now.isoformat(), "all_pools": len(pools), "stable_noIL": len(stable), "lp_two_sided_tvl5m": summ(lp), "single_sided_tvl5m": summ(lend)}
    top = sorted(lp, key=lambda p: -(p.get("apyMean30d") or 0))[:25]
    out["lp_top25_by_apyMean30d"] = [{k: p.get(k) for k in ("chain", "project", "symbol", "tvlUsd", "apyBase", "apyReward", "apyMean30d", "pool", "poolMeta")} for p in top]
    fee = sorted(lp, key=lambda p: -(p.get("apyBase") or 0))[:15]
    out["lp_top15_by_apyBase"] = [{k: p.get(k) for k in ("chain", "project", "symbol", "tvlUsd", "apyBase", "apyReward", "apyMean30d")} for p in fee]
    json.dump(out, open(os.path.join(HERE, "results", f"defi_stable_{now:%Y-%m-%d}.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps({k: out[k] for k in ("all_pools", "stable_noIL", "lp_two_sided_tvl5m", "single_sided_tvl5m")}, indent=1))
    for p in out["lp_top25_by_apyMean30d"]:
        print(p["chain"], p["project"], p["symbol"], round(p["tvlUsd"] / 1e6, 1), p["apyBase"], p["apyReward"], p["apyMean30d"])


if __name__ == "__main__":
    main()
