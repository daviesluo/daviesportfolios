"""M4: who provides liquidity on rewarded markets, and what they earn (fp4).

From the M1 snapshot, the rewarded markets with the largest daily pools (and a
fixed-rule sample of the rest). For each, the last few days of fills with maker
rows included (/v2/trades?taker_only=false): the rows of a transaction other
than its taker row are its makers. Every maker wallet that shows up is then read
through /v2/user-stats, which splits a wallet's all-time result into trade P&L,
fees paid, maker rebates, liquidity-reward income, holding-reward ("yield")
income and the rest. Public reads only. Writes the JSON named on the command line.

usage: m4_makers.py <snap dir> <out json> [top_markets] [days]
"""
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

DATA_API = "https://data-api.polymarket.com"


def fnum(x, d=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return d


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    return xs[f] if f == c else xs[f] + (xs[c] - xs[f]) * (k - f)


def trades_since(cond, since, taker_only):
    rows, cursor = [], None
    while True:
        params = {"condition": cond, "limit": 1000, "taker_only": "true" if taker_only else "false"}
        if cursor:
            params["cursor"] = cursor
        d = pmnet.get(DATA_API + "/v2/trades", params)
        data = d.get("data") or []
        rows.extend(data)
        cursor = (d.get("pagination") or {}).get("next_cursor")
        if not cursor or not data or data[-1].get("timestamp", 0) < since or len(rows) > 60000:
            break
    return [r for r in rows if r.get("timestamp", 0) >= since]


def main():
    snap, outp = sys.argv[1], sys.argv[2]
    top = int(sys.argv[3]) if len(sys.argv) > 3 else 25
    days = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0
    markets = {m["conditionId"]: m for m in pmnet.load(os.path.join(snap, "markets.json"))}
    rw = pmnet.load(os.path.join(snap, "rewards_native.json")) + pmnet.load(os.path.join(snap, "rewards_sponsored.json"))
    rate = defaultdict(float)
    for r in rw:
        rate[r["condition_id"]] = max(rate[r["condition_id"]], fnum(r.get("total_daily_rate")) or fnum(r.get("native_daily_rate")))
    ranked = sorted((c for c in rate if c in markets), key=lambda c: -rate[c])
    chosen = ranked[:top] + [c for c in ranked[top:] if int(c[-2:], 16) % 97 == 0][:top]
    since = time.time() - days * 86400
    maker_vol = defaultdict(float)
    maker_mkts = defaultdict(set)
    per_market = []
    for c in chosen:
        allrows = trades_since(c, since, False)
        taker_rows = trades_since(c, since, True)
        taker_keys = Counter((r.get("transaction_hash"), r.get("proxy_wallet"), r.get("side"), r.get("token_id")) for r in taker_rows)
        n_maker = 0
        for r in allrows:
            k = (r.get("transaction_hash"), r.get("proxy_wallet"), r.get("side"), r.get("token_id"))
            if taker_keys.get(k):
                taker_keys[k] -= 1
                continue
            n_maker += 1
            usd = fnum(r.get("size")) * fnum(r.get("price"))
            maker_vol[r.get("proxy_wallet")] += usd
            maker_mkts[r.get("proxy_wallet")].add(c)
        per_market.append({"cond": c, "q": (markets[c].get("question") or "")[:90], "rate": rate[c], "rows": len(allrows),
                           "taker_rows": len(taker_rows), "maker_rows": n_maker})
    wallets = sorted(maker_vol, key=lambda w: -maker_vol[w])
    stats = []
    for w in wallets[:400]:
        d = pmnet.get(DATA_API + "/v2/user-stats", {"user": w})
        s = ((d or {}).get("data") or {})
        a = s.get("all_time_pnl") or {}
        stats.append({"wallet": w, "maker_usd_window": round(maker_vol[w], 2), "markets_in_sample": len(maker_mkts[w]),
                      "join_date": s.get("join_date"), "trade_count": a.get("trade_count"), "volume_usdc": a.get("volume_usdc"),
                      "trade_pnl": a.get("trade_pnl"), "fees_paid": a.get("fees_paid"), "maker_rebate": a.get("maker_rebate"),
                      "reward_income": a.get("reward_income"), "sponsored_income": a.get("sponsored_income"),
                      "yield_income": a.get("yield_income"), "wallet_income": a.get("wallet_income"),
                      "economic_pnl": a.get("economic_pnl"), "realized_pnl": a.get("realized_pnl"),
                      "unrealized_pnl": a.get("unrealized_pnl")})
    def agg(rows):
        eco = [fnum(r["economic_pnl"]) for r in rows if r["economic_pnl"] is not None]
        inc = [fnum(r["wallet_income"]) for r in rows if r["wallet_income"] is not None]
        trd = [fnum(r["trade_pnl"]) for r in rows if r["trade_pnl"] is not None]
        return {"n": len(rows), "economic_pnl_sum": round(sum(eco), 2), "economic_pnl_p50": q(eco, 0.5),
                "share_economic_pnl_positive": round(sum(1 for x in eco if x > 0) / max(1, len(eco)), 3),
                "wallet_income_sum": round(sum(inc), 2), "trade_pnl_sum": round(sum(trd), 2),
                "reward_income_sum": round(sum(fnum(r["reward_income"]) for r in rows), 2),
                "maker_rebate_sum": round(sum(fnum(r["maker_rebate"]) for r in rows), 2),
                "yield_income_sum": round(sum(fnum(r["yield_income"]) for r in rows), 2),
                "fees_paid_sum": round(sum(fnum(r["fees_paid"]) for r in rows), 2),
                "volume_usdc_sum": round(sum(fnum(r["volume_usdc"]) for r in rows), 2)}
    earners = [r for r in stats if fnum(r["reward_income"]) > 0]
    small = [r for r in stats if 0 < fnum(r["volume_usdc"]) < 50000]
    # third-party wallets are kept by rank only: their addresses are public, but nothing here needs them
    for i, r in enumerate(sorted(stats, key=lambda r: -r["maker_usd_window"])):
        r["rank_by_maker_usd"] = i + 1
        r.pop("wallet", None)
    out = {"markets": per_market, "days": days, "maker_wallets": len(wallets), "stats_read": len(stats),
           "all": agg(stats), "reward_earners": agg(earners), "small_volume_lt_50k": agg(small),
           "small_reward_earners": agg([r for r in small if fnum(r["reward_income"]) > 0]),
           "top_by_reward_income": sorted(stats, key=lambda r: -fnum(r["reward_income"]))[:15],
           "rows": stats}
    pmnet.dump(outp, out)
    print(json.dumps({k: out[k] for k in ("maker_wallets", "stats_read", "all", "reward_earners", "small_volume_lt_50k", "small_reward_earners")}, indent=1))


if __name__ == "__main__":
    main()
