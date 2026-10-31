# CRYPTOBOOKS-2: print the strategy review's tables from results/ (no computation of its own).
#   python3 -I show2.py
import json, os

R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results")


def load(n):
    p = os.path.join(R, n)
    return json.load(open(p)) if os.path.exists(p) else {}


for book in ("XRP-GBP", "SOL-GBP", "ETH-GBP"):
    r = load(f"rule_{book}1031b.json") or load(f"rule_{book}.json")
    if not r:
        continue
    print(f"\n{book} plateau, kappa 0.5: in / out £ a day at £600 (rows d bps, columns theta 3 / 5 / 10 / 15 bps)\n")
    print("| d | θ 3 | θ 5 | θ 10 | θ 15 |\n|---|---|---|---|---|")
    g = r["plateau"]
    for d in (6, 8, 10, 12, 14, 16, 20):
        print(f"| {d} | " + " | ".join(f"{g[f'd{d}_th{t}_k0.5']['in_a_day']} / {g[f'd{d}_th{t}_k0.5']['out_a_day']}" for t in (3, 5, 10, 15)) + " |")
    print(f"\n{book} the card and one change at a time (14 days + 10-31 to the pull; £)\n")
    print("| variant | £/day | in wk | out wk | 10-31 | P days | P hours | days > 0 | tight £/day | wide £/h | fills/day | placed/day |"
          " max/s | max/min | worst h / d / wk | inv mean / max |")
    print("|" + "---|" * 16)
    for k, v in r["variants"].items():
        print(f"| {k} | {v['a_day']} | {v['in_a_day']} | {v['out_a_day']} | {v['d31_total']} | {v['p_days']} | {v['p_hours']} | "
              f"{v['days_pos']}/{v['days_n']} | {v['tight_a_day']} | {v['wide_an_hour']} | {v['fills_a_day']} | {v['placed_a_day']} | "
              f"{v.get('placed_max_a_second')} | {v.get('placed_max_a_minute')} | {v['worst_hour']} / {v['worst_day']} / {v['worst_week']} | "
              f"{v['inv_mean']} / {v['inv_max']} |")
    if "size" in r:
        print("\nsize a quote at £600: " + "; ".join(f"£{k}: {v['a_day']}/day (P {v['p_days']})" for k, v in r["size"].items()))
t = load("transitions.json")
if t:
    print("\n| book | tight h | £/tight h | P | wide h | £/wide h | P | 1st h after wide->tight | 1st 3 h | 1st h after tight->wide | switches |")
    print("|" + "---|" * 11)
    for b, v in t.items():
        print(f"| {b} | {v['tight_hours']} | {v['tight_gbp_an_hour']} | {v['p_tight_hours']} | {v['wide_hours']} | {v['wide_gbp_an_hour']} | "
              f"{v['p_wide_hours']} | {v['first_hour_after_wide_to_tight']} | {v['first_3h_after_wide_to_tight']} | "
              f"{v['first_hour_after_tight_to_wide']} | {len(v['switches'])} |")
s = load("stale2.json")
if s:
    print("\n| book | takes/day | taker exit £/day | RX-mid exit £/day | P days | wk1 / wk2 £/day | 10-31 £ | L 1 / 2 / 5 / 15 / 30 / 60 s (taker exit) | IOC triggers/day (T 15) |")
    print("|" + "---|" * 9)
    for b, v in s.items():
        x = v["T15_L1_H300"]
        lat = " / ".join(str(v[f"T15_L{L}_H300"]["taker_exit_a_day"]) for L in (1, 2, 5, 15, 30, 60))
        print(f"| {b} | {x['takes_a_day']} | {x['taker_exit_a_day']} | {x['rx_mid_exit_a_day']} | {x['p_days_taker_exit']} | "
              f"{x['week1_a_day']} / {x['week2_a_day']} | {x['d31_total']} | {lat} | {v['ioc_upper_a_day'].get('15')} |")
h = load("regimes_hist.json")
if h:
    print("\n| book | days sampled | wide days (≥ 16 bps, 13-16 UTC) | monthly median spread bps | wide runs (first, last) |")
    print("|---|---|---|---|---|")
    for b, v in h.items():
        print(f"| {b} | {v['n_days']} | {v['wide_days']} | {v['by_month_p50']} | {v['wide_runs']} |")
d = load("today2.json")
if d:
    print("\n| book | 10-31 card £600 | £1,200 | £120 | lat 2 s | gate 6 | by hour (£, prints label, pair spread) |")
    print("|---|---|---|---|---|---|---|")
    for b, v in d.items():
        print(f"| {b} | {v['card_600']['total']} | {v['card_1200']['total']} | {v['card_120']['total']} | {v['lat2']['total']} | "
              f"{v['gate6']['total']} | {v['card_600']['by_hour']} |")
