# MMCOMP-2: print the tables the second review quotes from results/xhedge.json, results/maker_pnl.json and
# results/inner_rung2.json (whichever exist). python3 -I docs/agents/backtests/mmcomp/scripts/show.py
import json, os

R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results")


def load(n):
    p = os.path.join(R, n)
    return json.load(open(p)) if os.path.exists(p) else None


x = load("xhedge.json")
if x:
    for b in ("USDC-GBP", "USDT-GBP"):
        print(b, "Coinbase reads", x[b]["cb_reads"], "gaps > 120 s", x[b]["cb_gaps_over_120s"], "longest s", x[b]["cb_longest_gap_s"])
        print("  delay|queue: fills/d edge xfer net £/d days")
        for k, d in x[b]["delay_queue_C5000_Q100_m2_fee0.45"].items():
            print("   ", k, d["fills_per_day"], d["edge_bps"], d["transfer_bps_per_fill"], d["net_bps_per_fill"], d["net_gbp_per_day"], d["days_positive"])
        print("  sizes (d 30, first, m 2): fills/d £fills/d edge xfer net £net/d %yr transfers days halves orders/d")
        for k, d in x[b]["sizes_d30_first_m2"].items():
            print("   ", k, d["fills_per_day"], d["gbp_per_day"], d["edge_bps"], d["transfer_bps_per_fill"], d["net_bps_per_fill"],
                  d["net_gbp_per_day"], d["net_pct_year"], d["transfers"], d["days_positive"], d["halves_net_gbp_per_day"], d["rx_orders_per_day"])
        for k, d in x[b]["margin_C1200_Q100_none"].items():
            print("   margin", k, d["fills_per_day"], d["edge_bps"], d["net_gbp_per_day"], d["net_pct_year"], d["days_positive"], d["rx_orders_per_day"])
for n in ("maker_pnl.json", "inner_rung2.json"):
    v = load(n)
    if v:
        print(n, json.dumps(v, indent=1)[:6000])
