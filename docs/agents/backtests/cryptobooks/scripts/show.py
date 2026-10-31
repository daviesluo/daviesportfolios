# CRYPTOBOOKS: print the review's tables from results/*.json (no computation of its own).
#   python3 -I show.py
import json, os

R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results")


def load(n):
    p = os.path.join(R, n)
    return json.load(open(p)) if os.path.exists(p) else {}


tape, poll, inner, best, stale, today, risk = (load(x) for x in ("tape.json", "poll.json", "inner.json", "best.json", "stale.json",
                                                                   "today.json", "risk.json"))
print("| book | prints/day | $ volume/day (median day) | order $ p50 / p90 | taker buys | paid over fair, bps (eff. half-spread) |"
      " inner on / off | taker gain 1s/5s/30s/300s | picks >9 bps $/day (age p50 s) | visible spread now | depth ±25 bps $ (bid/ask) |"
      " mid follows half a move, s |")
for b in sorted(tape, key=lambda k: -tape[k]["usd_volume_a_day"]):
    t = tape[b]
    i = inner.get(b, {})
    p = poll.get("books", {}).get(b, {})
    m = t["markout_taker_gain_mean"]
    pk = t["picks_over_9bps"]
    resp = (p.get("response_to_outside_move") or {}).get("5", {})
    print(f"| {b} | {t['prints_a_day']:.0f} | {t['usd_volume_a_day']:,} ({t['usd_volume_daily_median']:,}) | {t['order_usd_p50']} / "
          f"{t['order_usd_p90']:,} | {t['buy_share_of_orders']:.0%} | {t['half_spread_eff']} | {i.get('half_spread_on_p50')} / "
          f"{i.get('half_spread_off_p50')} | {m.get('1')} / {m.get('5')} / {m.get('30')} / {m.get('300')} | {pk['usd_net_a_day']} "
          f"({(pk['age_s_p25_p50_p75'] or [None, None])[1]}) | {p.get('spread_bps_p50')} | {(p.get('depth_usd_p50') or {}).get('25')} | "
          f"{resp.get('half_way_s_p50')} ({resp.get('events')}) |")
print()
print("| book | chosen in-sample (d, theta, kappa) | out £/day £600 | P(<=0) | £1,200 | minute loop | no arb | half fills | Binance hedge |"
      " tight £/day | wide £/hour | orders/day | fills/day | inventory mean / max £ | 10-31 £/hour (600) |")
for b, x in best.items():
    if "base_600" not in x:
        continue
    c = x["chosen_in_sample"]
    v = x["base_600"]
    td = today.get(b, {}).get("base_600", {})
    print(f"| {b} | {c['d_bps']}, {c['theta_bps']}, {c['kappa']} | {v['total_a_day']} | {v['p_mean_le0']} | {x['base_1200']['total_a_day']} | "
          f"{x['minute_loop_600']['total_a_day']} | {x['no_arb_600']['total_a_day']} | {x['half_fills_600']['total_a_day']} | "
          f"{x['hedged_binance10_600']['total_a_day']} | {v['gbp_a_tight_day']} | {v['gbp_a_wide_hour']} | {v['orders_a_day']} | "
          f"{v['fills_a_day']} | {v['inventory_gbp_mean']} / {v['inventory_gbp_max']} | {td.get('gbp_an_hour')} |")
print()
print("| book | take T15 L1 H300 £600: week 1 at take / RX-mid exit / taker exit | week 2 | 10-31 |")
st1031 = load("stale1031.json")
for b, x in stale.items():
    k = x.get("T15_L1_H300_C600") or {}
    if "in_week1" not in k:
        continue
    f = lambda d: f"{d.get('takes')} takes: {d.get('gbp_a_day_at_take')} / {d.get('gbp_a_day_rx_mid_exit')} / {d.get('gbp_a_day_taker_exit')}"
    t = (st1031.get(b, {}).get("T15_L1_H300_C600") or {}).get("both", {})
    print(f"| {b} | {f(k['in_week1'])} | {f(k['out_week2'])} | {f(t) if t else '-'} |")
print()
print("| coin | sd 1 min bps | 1 h | 1 day | worst hour bps | worst day bps | £300 worst hour / day |")
for c, x in risk.items():
    print(f"| {c} | {x['1m']['sd_bps']} | {x['1h']['sd_bps']} | {x['1d']['sd_bps']} | {x['worst_rolling_hour_bps']} | "
          f"{x['worst_rolling_day_bps']} | {x['loss_gbp_worst_hour']['300']} / {x['loss_gbp_worst_day']['300']} |")
