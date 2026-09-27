"""HARVEST phase 1: the per-category table of the review, assembled from the committed results (harvest.py, power.py,
makers.py) and the category inputs (for the trap lists that live there). Writes results/summary.json and prints the
table.

usage: summary.py <results dir> <inputs dir> <out json>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402
from harvest import r2  # noqa: E402

CATS = [("econ", "econ_excl_dissent"), ("counts", None), ("mentions", None), ("quakes", None),
        ("temperature", "temperature_excl_top")]
SOURCE = {
    "econ": "the publisher's release instant (BLS/BEA/DOL 08:30 ET, FOMC 14:00 ET, BoC 09:45 ET, BoE 12:00 London, "
            "ECB 14:15 Frankfurt); the value from ALFRED's first-release vintage, the Fed's statement, BoC/BoE/ECB series",
    "counts": "Polymarket's public tracker: a bucket dies at the capture that passes it; the window end + 600 s for the "
              "rest",
    "mentions": "the UMA proposal, bounded by the market's close − 2 h (no keyless end time or transcript)",
    "quakes": "USGS ComCat as it stood at C (superseded origin versions): publication of the quake that passes a "
              "bucket; the window end + 600 s for the rest",
    "temperature": "the station's reports (IEM, PMLATE's input): the day's final extreme at local midnight + 600 s",
}


def main():
    rdir, idir, outp = sys.argv[1:4]
    power = H.jfile(os.path.join(rdir, "power.json"))["rules"]
    makers = H.jfile(os.path.join(rdir, "makers.json"))
    rows = {}
    for cat, alt in CATS:
        d = H.jfile(os.path.join(rdir, cat + ".json"))
        a = H.jfile(os.path.join(rdir, alt + ".json")) if alt else None
        p60, p300 = d["pool"]["60"], d["pool"]["300"]
        pw = power.get(cat, {})
        row = {
            "C_source": SOURCE[cat], "events": d["events"], "markets": d["units"], "days": d["days"],
            "unverifiable_markets": d["unverifiable_units"], "closed_before_C": d["closed_before_C_units"],
            "trap_markets": d["trap_units"], "trap_rate": d["trap_rate_units"], "trap_events": d["trap_events"],
            "trap_cost_from_C": {"A": d["pool"]["0"]["A_trap"], "B": d["pool"]["0"]["B_trap"]},
            "lock_median_h": d["lock_all_markets_median_h"],
            "A_pool_per_day": {"60s": p60["A_net_per_day"], "300s": p300["A_net_per_day"]},
            "A_pool_best_date_share": {"60s": p60["A_by_date"]["best_share"], "300s": p300["A_by_date"]["best_share"]},
            "A_pool_total": {"0s": d["pool"]["0"]["A_net"], "60s": p60["A_net"], "300s": p300["A_net"],
                             "1800s": d["pool"]["1800"]["A_net"]},
            "A_rule_per_day": {"60s": d["mode_a_rule"]["60"]["pnl_per_day"], "300s": d["mode_a_rule"]["300"]["pnl_per_day"]},
            "B_pool_per_day_60s": p60["B_net_per_day"], "B_pool_best_date_share_60s": p60["B_by_date"]["best_share"],
            "B_pool_total": {"0s": d["pool"]["0"]["B_net"], "60s": p60["B_net"], "300s": p300["B_net"],
                             "1800s": d["pool"]["1800"]["B_net"]},
            "B_tick_ahead_pool_per_day_60s": r2(p60.get("B_tick_ahead", 0.0) / d["days"]),
            "B_rule_tick_per_day_60s": d["mode_b_rule_tick_ahead"]["60"]["pnl_per_day"],
            "B_rule_level_0.99_per_day_60s": d["mode_b_rule_level"]["60s_b0.99"]["pnl_per_day"],
            "bands_from_60s": d["band_from_60s"],
            "power": {k: {"total": v["total"], "dates": v["dates"], "best_share": v["concentration"]["best_share"],
                          "z_vs_null": v["z_vs_null"], "heldout_dates": v["heldout"]["expected_dates"],
                          "heldout_expected_total": v["heldout"]["expected_total"],
                          "heldout_null_p95": v["heldout"]["expected_null_p95"]} for k, v in pw.items()},
            "makers_from_60s": makers.get(cat),
        }
        if a:
            row["without_top_event"] = {
                "excluded": a["excluded_events"],
                "A_pool_per_day": {"60s": a["pool"]["60"]["A_net_per_day"], "300s": a["pool"]["300"]["A_net_per_day"]},
                "B_pool_per_day_60s": a["pool"]["60"]["B_net_per_day"],
                "A_pool_best_date_share_60s": a["pool"]["60"]["A_by_date"]["best_share"],
                "B_pool_best_date_share_60s": a["pool"]["60"]["B_by_date"]["best_share"],
                "A_pool_total": {"0s": a["pool"]["0"]["A_net"], "60s": a["pool"]["60"]["A_net"],
                                 "300s": a["pool"]["300"]["A_net"]},
                "bands_from_60s": a["band_from_60s"]}
        rows[cat] = row
    men = H.jfile(os.path.join(idir, "mentions.json.gz"))
    disp = men.get("disputed", [])
    rows["mentions"]["first_proposal"] = {
        "disputed_markets": len(disp),
        "overturned": sum(1 for x in disp if x["first_overturned"]),
        "overturned_no_first": sum(1 for x in disp if x["first_overturned"] and x["first_proposal"] == 1),
        "overturned_yes_first": sum(1 for x in disp if x["first_overturned"] and x["first_proposal"] == 0),
        "overturned_volume": r2(sum(x["volume"] for x in disp if x["first_overturned"])),
        "worst_case_at_100_a_market": -100.0 * sum(1 for x in disp if x["first_overturned"])}
    cnt = H.jfile(os.path.join(idir, "counts.json.gz"))
    rows["counts"]["trap_by_settle"] = cnt.get("trap_by_settle")
    rows["counts"]["record_not_ok_events"] = sorted(k for k, v in cnt.get("events", {}).items() if not v["record_ok"])
    H.write_json(outp, rows)
    print(f"{'category':12} {'mkts':>5} {'A60/d':>8} {'A300/d':>8} {'Ar60/d':>7} {'B60/d':>8} {'Btk/d':>7} "
          f"{'trap':>6} {'lock h':>6} {'bestA60':>7} {'bestB60':>7}")
    for cat, r in rows.items():
        print(f"{cat:12} {r['markets']:>5} {r['A_pool_per_day']['60s']:>8} {r['A_pool_per_day']['300s']:>8} "
              f"{r['A_rule_per_day']['60s']:>7} {r['B_pool_per_day_60s']:>8} {r['B_rule_tick_per_day_60s']:>7} "
              f"{r['trap_rate']:>6} {r['lock_median_h']:>6} {r['A_pool_best_date_share']['60s']!s:>7} "
              f"{r['B_pool_best_date_share_60s']!s:>7}")


if __name__ == "__main__":
    main()
