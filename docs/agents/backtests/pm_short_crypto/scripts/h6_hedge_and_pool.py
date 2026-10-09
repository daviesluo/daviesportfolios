"""H6: two pieces of arithmetic. (a) What a spot delta hedge of an Up/Down position needs: the BTC notional that offsets
a share's sensitivity, N x phi(z) / (sigma x sqrt(tau_eff)), at the money, mid-window, for $100 and $1,000 stakes, and
what one rebalance costs at Revolut X's 0.09 % taker fee. (b) The makers' side of the two test days from h2: taker
fees, the 20 % rebate pool, and the makers' gross result (minus the takers' P&L before fees).
Usage: h6_hedge_and_pool.py binance_1s.json.gz h2_prints.json out.json"""
import json, sys, os, math
sys.path.insert(0, os.path.dirname(__file__)); import model
B = model.load_binance(sys.argv[1]); H2 = json.load(open(sys.argv[2]))
v1 = model.rv1(B, B["t0"] + len(B["c"]) - 1, look=len(B["c"]) - 2)  # 1 s variance over the whole 7 days
out = {"sigma_1s_bps_7d": round(math.sqrt(v1) * 1e4, 4), "hedge": {}, "makers_two_days": {}}
for kind, dur, k in (("5m", 300, 1.75), ("15m", 900, 2.5)):
    for tau in (dur, dur // 2, 60):
        teff = tau - 40 if tau >= 60 else tau ** 3 / 3 / 3600
        sd = math.sqrt(k * v1 * teff)
        for stake in (100, 1000):
            n = stake / 0.5
            notional = n * 0.3989 / sd
            out["hedge"][f"{kind}|tau{tau}s|${stake}"] = {"sd_of_settlement_move_bps": round(sd * 1e4, 2), "btc_notional_usd": round(notional),
                "one_rebalance_cost_usd_revx": round(notional * 0.0009, 2), "a_1sd_1s_move_shifts_price_c": round(100 * 0.3989 * math.sqrt(k * v1) / sd, 2)}
for kind in ("5m", "15m"):
    h = H2[kind]; gross_taker = h["taker_pnl_usd"] + h["taker_fees_usd"]
    out["makers_two_days"][kind] = {"taker_fees_usd_per_day": round(h["taker_fees_usd"] / 2), "rebate_pool_20pc_per_day": round(0.2 * h["taker_fees_usd"] / 2),
        "makers_gross_usd_per_day": round(-gross_taker / 2), "makers_net_incl_rebate_per_day": round((-gross_taker + 0.2 * h["taker_fees_usd"]) / 2),
        "taker_usd_paid_per_day": round(h["usd_paid"] / 2)}
json.dump(out, open(sys.argv[3], "w"), indent=1, sort_keys=True)
print(json.dumps(out, indent=1, sort_keys=True))
