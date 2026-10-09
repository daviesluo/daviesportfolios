"""H0: how these markets resolve, and how well Binance stands in for Chainlink. Prints results/h0_resolution.json."""
import json, sys, os, statistics as st, datetime
sys.path.insert(0, os.path.dirname(__file__)); import model
M = json.load(open(sys.argv[1])); B = model.load_binance(sys.argv[2])
R = {r["slug"]: r for r in M}
out = {}
for kind, d in (("5m", 300), ("15m", 900)):
    rs = [r for r in M if f"-{kind}-" in r["slug"] and r["priceToBeat"] and r["finalPrice"] is not None]
    chain = sum(1 for r in rs if (p := R.get(f"btc-updown-{kind}-{int(r['slug'].rsplit('-',1)[1]) - d}")) and p["finalPrice"] == r["priceToBeat"])
    agree = agree_spot = n = 0; margins = []
    for r in rs:
        s = int(r["slug"].rsplit("-", 1)[1]); e = s + d
        if s - 120 < B["t0"] or e > B["t0"] + len(B["c"]) - 1: continue
        n += 1
        up_tw = model.mean_over(B, e - 60, e) >= model.mean_over(B, s - 60, s)
        up_sp = model.px(B, e) >= model.px(B, s)
        agree += up_tw == r["up_won"]; agree_spot += up_sp == r["up_won"]
        margins.append(abs(r["finalPrice"] / r["priceToBeat"] - 1) * 1e4)
    out[kind] = {"markets": len(rs), "priceToBeat_equals_previous_finalPrice": chain,
                 "up_share": round(sum(r["up_won"] for r in rs) / len(rs), 4),
                 "binance_twap60_agrees_with_outcome": [agree, n], "binance_spot_endpoints_agree": [agree_spot, n],
                 "median_abs_move_bps": round(st.median(margins), 2),
                 "share_abs_move_under_1bp": round(sum(m < 1 for m in margins) / len(margins), 4),
                 "volume_per_day_usd": round(sum(r["volume"] for r in rs) / 7), "median_volume_usd": round(st.median(r["volume"] for r in rs)),
                 "resolution_delay_s_p50_p90_max": (lambda L: [st.median(L), sorted(L)[int(.9 * len(L))], max(L)])([
                     (datetime.datetime.fromisoformat(r["closedTime"].replace(" ", "T").replace("+00", "+00:00")) - datetime.datetime.fromisoformat(r["end"].replace("Z", "+00:00"))).total_seconds()
                     for r in rs if r.get("closedTime")]),
                 "fee_schedule": rs[0]["feeSchedule"], "config": rs[0]["config"],
                 "rewards_fields": [rs[0]["rewardsMinSize"], rs[0]["rewardsMaxSpread"], rs[0]["holdingRewardsEnabled"]]}
print(json.dumps(out, indent=1, sort_keys=True))
