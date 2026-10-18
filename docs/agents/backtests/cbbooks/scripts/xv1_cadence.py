# XV-1's transfer cadence: what moving the coins back costs against what the rule made, per cadence, from CBBOOKS-1's measured
# flows (results/cross.json, Q4 (ii) at m = 10 bps) and the fees read for Davies on 2026-10-18 (06:22-06:28 BST, by his
# assistant from the venues' help pages and in-app quotes, to be confirmed on the first transfer; the draft's §4).
# python3 -I scripts/xv1_cadence.py  ->  results/xv1_cadence.json
import os, json

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cross = json.load(open(os.path.join(HERE, "results", "cross.json")))
GBP_PER_COIN = 0.75            # USDC-GBP and USDT-GBP traded 0.746-0.761 in the window (describe.json's books)
GBP_PER_USD = 0.75
FEES = {
    # one withdrawal from Revolut X a coin a transfer: a £3 service fee plus the network fee quoted in the app
    "service_gbp": 3.0,
    "network_usd": {"USDC-GBP": 0.002, "USDT-GBP": 0.007},   # USDC on Polygon (Coinbase takes it); USDT on Ethereum only (Coinbase takes USDT as ERC-20 alone)
    "coinbase_deposit_gbp": 0.0, "coinbase_gbp_withdrawal_gbp": 0.0, "revolutx_gbp_deposit_gbp": 0.0,
}
GBP_TRANSIT_DAYS = 5           # Coinbase to the bank 1-3 working days: up to five calendar days over a weekend
MARGIN_DAYS = 1                # a day's flow kept in hand on each side
BAR_BPS = 5.0                  # the draft's test: a round of transfers under about 5 bps of the flow it moves
CADENCES = {"weekly": 7, "fortnightly": 14, "monthly": 30}
ETH_SENSITIVITY_USD = [0.007, 1.0, 5.0]

out = {"inputs": {"fees": FEES, "gbp_per_coin": GBP_PER_COIN, "gbp_transit_days": GBP_TRANSIT_DAYS, "margin_days": MARGIN_DAYS,
                  "source": "results/cross.json q4.*.rx_maker_cb_hedge['10bp'] (train 10-10 03:00 -> 10-14 03:00, test -> 10-18 03:00)"},
       "flows": {}, "cadences": {}}
for h in ("train", "test"):
    for b in ("USDC-GBP", "USDT-GBP"):
        d = cross["q4"][b]["rx_maker_cb_hedge"]["10bp"][h]
        out["flows"].setdefault(h, {})[b] = {"net_coins_a_day": d["net_coins_moved_rx_to_cb_a_day"],
                                             "flow_gbp_a_day": round(d["net_coins_moved_rx_to_cb_a_day"] * GBP_PER_COIN, 1),
                                             "gross_gbp_a_day": d["gbp_a_day"]}


def per_transfer(b, eth_usd=None):
    net = FEES["network_usd"][b] if (eth_usd is None or b == "USDC-GBP") else eth_usd
    return FEES["service_gbp"] + net * GBP_PER_USD + FEES["coinbase_deposit_gbp"]


for name, D in CADENCES.items():
    c = {"days": D}
    for h in ("train", "test"):
        f = out["flows"][h]
        rows = {}
        for b in ("USDC-GBP", "USDT-GBP"):
            moved = f[b]["flow_gbp_a_day"] * D
            rows[b] = {"cost_per_transfer_gbp": round(per_transfer(b), 4), "gbp_moved_per_transfer": round(moved, 0),
                       "cost_bps_of_flow": round(per_transfer(b) / moved * 1e4, 2), "passes_5bps": per_transfer(b) / moved * 1e4 <= BAR_BPS,
                       "min_days_for_5bps": round(per_transfer(b) / (f[b]["flow_gbp_a_day"] * BAR_BPS / 1e4), 1)}
        gross = sum(f[b]["gross_gbp_a_day"] for b in f)
        cost_day = sum(per_transfer(b) for b in f) / D
        flow = sum(f[b]["flow_gbp_a_day"] for b in f)
        # capital: the coin stock Coinbase sells from until the next transfer lands (it is also what Revolut X piles up: the
        # sum is constant), and the pounds Revolut X spends while Coinbase's pounds are on their way back (withdrawn daily, free)
        coins_gbp = flow * (D + MARGIN_DAYS); pounds_gbp = flow * (GBP_TRANSIT_DAYS + MARGIN_DAYS)
        cap = coins_gbp + pounds_gbp
        net_day = gross - cost_day
        sens = {f"eth_usd_{e}": round((gross - sum(per_transfer(b, e) for b in f) / D) * 365, 0) for e in ETH_SENSITIVITY_USD}
        c[h] = {"books": rows, "gross_gbp_a_day": round(gross, 4), "transfer_cost_gbp_a_day": round(cost_day, 4),
                "net_gbp_a_day": round(net_day, 4), "net_gbp_a_year": round(net_day * 365, 0),
                "net_gbp_a_year_by_eth_fee": sens,
                "capital_coins_gbp": round(coins_gbp, 0), "capital_pounds_gbp": round(pounds_gbp, 0), "capital_total_gbp": round(cap, 0),
                "net_pct_a_year_on_capital": round(net_day * 365 / cap * 100, 2),
                "gross_pct_a_year_on_capital": round(gross * 365 / cap * 100, 2),
                "usd_exposure_gbp": round(coins_gbp, 0),
                "one_sd_year_gbpusd_7pct_on_coins_gbp": round(coins_gbp * 0.07, 0)}
    out["cadences"][name] = c

json.dump(out, open(os.path.join(HERE, "results", "xv1_cadence.json"), "w"), indent=1)
for name, c in out["cadences"].items():
    for h in ("train", "test"):
        x = c[h]
        print(name, h, {b: (v["cost_bps_of_flow"], v["passes_5bps"], v["min_days_for_5bps"]) for b, v in x["books"].items()},
              "gross/d", x["gross_gbp_a_day"], "cost/d", x["transfer_cost_gbp_a_day"], "net/yr", x["net_gbp_a_year"], x["net_gbp_a_year_by_eth_fee"],
              "cap", x["capital_total_gbp"], "(coins", x["capital_coins_gbp"], ") net%", x["net_pct_a_year_on_capital"], "gross%", x["gross_pct_a_year_on_capital"])
