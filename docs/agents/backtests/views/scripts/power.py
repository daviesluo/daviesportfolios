"""VIEWS: the power check — how many deadlines each possible test would see, and what it could detect.

From committed results only:
* the deadline rate: MrBeast and MrBeast Gaming deadlines per week over the last eight ISO weeks of the universe
  (Gamma metadata; held-out events are counted by their metadata-only T, no price read);
* the depth: those channels' view-market volume by month (Gamma's figure; some 2026-03 events report none);
* the exploration rates: close calls (winner under 0.95 at T − 15 min) per deadline, deadlines with a post-T stale
  fill, the post-T rule's P&L per deadline;
* three tests: (a) the post-T taker on the held-out months, (b) a forward last-batch taker, (c) a forward trajectory
  rule, against the fp5 standard (≥ 25 dates, no date over 40 %, Holm over the family).

usage: power.py <universe_table json> <near_t json> <stale_late json> <out json>
"""
import json
import math
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

NOON = ("@MrBeast", "@MrBeastGaming")


def main():
    tab = V.jfile(sys.argv[1])
    nt = V.jfile(sys.argv[2])["summary_high"]
    sl = V.jfile(sys.argv[3])
    weeks = tab["summary"]["mrbeast_gaming_deadlines_per_iso_week"]
    last8 = sorted(weeks)[-8:]
    rate = sum(weeks[w] for w in last8) / 8.0
    vol, n = defaultdict(float), Counter()
    held_dl = set()
    for r in tab["events"]:
        if r["kind"] in ("video_window", "clock_count") and r["channel"] in NOON and r["T_utc"]:
            vol[r["T_utc"][:7]] += r["volume_usd"]
            n[r["T_utc"][:7]] += 1
            if r["split"] == "held_out":
                held_dl.add((r["channel"], r["T_utc"][:16]))
    ex_events = nt["events"]
    cc = nt["close_calls_winner_below_0.95_at_T-15m"]["events"]
    cc_rate = cc / ex_events
    arm = sl["arms"]["T+1s"]
    fill_rate = arm["events"] / sl["events"]
    ex_months = [m for m in vol if "2025-03" <= m <= "2026-05"]
    held_months = [m for m in vol if "2026-06" <= m <= "2026-09"]
    ex_vol = sum(vol[m] for m in ex_months) / max(1, sum(n[m] for m in ex_months))
    ho_vol = sum(vol[m] for m in held_months) / max(1, sum(n[m] for m in held_months))
    z = 2.5  # one-sided, about Holm's first step over a family of five at 0.05
    out = {
        "deadline_rate_per_week_last_8_weeks": round(rate, 2), "last_8_weeks": {w: weeks[w] for w in last8},
        "volume_by_month_mrbeast_gaming_usd": {m: round(vol[m]) for m in sorted(vol)},
        "events_by_month_mrbeast_gaming": {m: n[m] for m in sorted(n)},
        "mean_volume_per_event_usd": {"exploration_2025-03_2026-05": round(ex_vol), "held_out_2026-06_2026-09": round(ho_vol)},
        "exploration": {"deadlines_high_confidence": ex_events, "close_calls": cc, "close_call_rate": round(cc_rate, 4),
                        "deadlines_with_a_post_T_fill": arm["events"], "post_T_fill_rate": round(fill_rate, 4),
                        "post_T_rule_pnl_usd": arm["pnl"], "post_T_rule_pnl_per_deadline_usd": round(arm["pnl"] / ex_events, 2),
                        "best_date_share": arm["best_date_share"]},
        "a_post_T_taker_held_out": {
            "held_out_deadlines": len(held_dl),
            "expected_deadlines_with_a_fill": round(fill_rate * len(held_dl), 1),
            "expected_pnl_usd_scaled_by_volume": round(arm["pnl"] / ex_events * len(held_dl) * ho_vol / ex_vol, 2),
            "fp5_bar": "needs fills on >= 25 dates with no date over 40 %: the expected count of dates with a fill is "
                       "the expected deadlines with a fill, far under 25 -> no power; not pre-registered"},
        "b_forward_last_batch_taker": {
            "close_calls_per_week": round(rate * cc_rate, 3),
            "weeks_to_6_close_calls": round(6 / (rate * cc_rate), 1),
            "weeks_to_12_close_calls": round(12 / (rate * cc_rate), 1),
            "weeks_to_25_close_calls": round(25 / (rate * cc_rate), 1)},
        "c_forward_trajectory_rule": {
            f"mu_over_sigma_{k}": {"deadlines": math.ceil((z / k) ** 2), "weeks": round(math.ceil((z / k) ** 2) / rate, 1)}
            for k in (0.1, 0.2, 0.3, 0.5)},
    }
    with open(sys.argv[4], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
