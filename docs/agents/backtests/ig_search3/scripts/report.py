"""Print the ranked table of every arm for the review, from results/search.json (markdown on stdout).

Run: python3 -I docs/agents/backtests/ig_search3/scripts/report.py
GBP figures: at IG's minimum stake, at the frozen level (params costs); capital = the minimum stake's margin plus the
worst single test-era trade at that stake.
"""
import json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = json.load(open(os.path.join(HERE, "params", "frozen.json")))
R = json.load(open(os.path.join(HERE, "results", "search.json")))
IDX = P["costs"]["index"]
FX = P["costs"]["fx"]
HAND = {"IMOM": "hand (clock)", "LASTHALF": "hand (clock)", "ORB30": "hand (two stop-entry orders)",
        "GAPFADE": "hand (clock + limit)", "DOW": "hand (clock)", "TOM_ID": "hand (clock)",
        "FOMC_PRE": "hand (clock)", "FOMC_POST": "hand (screen at 14:05)", "MACRO_LONG": "hand (clock)",
        "MACRO_MOM": "hand (clock)", "EIA": "hand (screen at 10:35)", "FXW": "hand (Sunday open) or software on CFD"}


def notional(mkt):
    if mkt in IDX:
        c = IDX[mkt]
        if mkt == "WTI":
            return c["min_gbp_per_pt"] * c["level"] / c["point"]
        return c["min_gbp_per_pt"] * c["level"]
    pip = 0.01 if mkt.endswith("JPY") else 0.0001
    return FX["min_gbp_per_pip"] * FX["levels"][mkt] / pip


def margin(mkt):
    return (IDX[mkt]["margin"] if mkt in IDX else (0.05 if "AUD" in mkt or "NZD" in mkt else 0.0333)) * notional(mkt)


def row(name, mkt, r, fam):
    te, tr = r.get("test", {}), r.get("train", {})
    if not te.get("n"):
        return None
    n = notional(mkt)
    gbp_trade = n * te["mean_bps"] / 1e4
    tpy = r.get("trades_per_year_test", 0)
    worst = n * te["worst_bps"] / 1e4
    ss = r.get("second_source", {})
    ss_txt = ss.get("second_source_bar") or "none"
    if ss.get("B", {}).get("n"):
        ss_txt += f" (B {ss['B']['mean_bps']:+.1f}, t {ss['B'].get('t')}, n {ss['B']['n']})"
    elif ss.get("B_test", {}).get("n"):
        ss_txt += f" (HD test {ss['B_test']['mean_bps']:+.1f}, t {ss['B_test'].get('t')}, n {ss['B_test']['n']}; gap corr {ss.get('gap_corr_fxcm_hd')})"
    return {"arm": f"{name} {mkt}", "t": te.get("t") or 0,
            "cells": [f"{name} {mkt}", f"{tpy:.0f}", f"{te['mean_bps']:+.2f}", f"{te.get('t')}",
                      f"[{te['boot95_bps'][0]:+.1f}, {te['boot95_bps'][1]:+.1f}]" if "boot95_bps" in te else "-",
                      f"{tr.get('mean_bps', 0):+.2f} (t {tr.get('t')}, n {tr.get('n')})", f"{te['n']}",
                      ss_txt, f"{gbp_trade * tpy:+.0f}", f"{worst:.0f}", f"{margin(mkt) - worst:.0f}",
                      HAND[fam], r.get("verdict_first_source", "")]}


def main():
    rows = []
    for k, r in R["arms"].items():
        fam, mkt = k.split(".")
        if "test" not in r:
            continue
        x = row(fam, mkt, r, fam)
        if x:
            rows.append(x)
    for pair, r in R["fx"].items():
        x = row("FXW", pair, r, "FXW")
        if x:
            rows.append(x)
    rows.sort(key=lambda x: -x["t"])
    hdr = ["arm", "trades/yr", "net bps/trade (test)", "t (test)", "bootstrap 95 %", "train net bps", "test n",
           "second source", "GBP/yr at min stake", "worst trade GBP", "capital GBP", "Term 9(12)", "verdict"]
    print("| " + " | ".join(hdr) + " |")
    print("|" + "---|" * len(hdr))
    for x in rows:
        print("| " + " | ".join(x["cells"]) + " |")


if __name__ == "__main__":
    main()
