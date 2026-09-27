"""WXSRC A2d (exploration month only): who takes the stale side first, and on what clock.

For every informative bucket death of PMLATE's September sample (the definitions of `station_edge.py`), the first
stale print with a gross edge of at least 1¢ after the deciding report's observation: its taker (the data API's
`proxy_wallet`, first eight hex digits), its delay after the observation and after AWC's receipt of that report.
Per wallet with at least five first prints: how many, at how many stations, and the median of both delays. A wallet
whose first prints sit a few seconds after AWC's receipt is reading the public METAR chain; one that acts before the
report exists anywhere public is reading something nearer the station.

usage: takers.py <out json>   (reads $PMLATE_DATA)
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wxcommon as X  # noqa: E402
import station_edge as S  # noqa: E402


def main():
    outp = sys.argv[1]
    D, _ = S.deaths()
    by = defaultdict(list)
    for d in D:
        if d["wrong"] or not d["informative"]:
            continue
        f = next(((dt, w) for dt, sz, g, net, w in d["stale"] if g >= 0.01), None)
        if not f:
            continue
        rc = (d["obs"] + f[0] - d["receipt"]) if d["receipt"] else None
        by[f[1]].append({"station": d["station"], "us": d["station"].startswith("K"), "after_obs": f[0],
                         "after_receipt": rc})
    out = {}
    for w, xs in sorted(by.items(), key=lambda kv: -len(kv[1])):
        if len(xs) < 5:
            continue
        rcs = [x["after_receipt"] for x in xs if x["after_receipt"] is not None]
        out[w] = {"first_prints": len(xs), "stations": len({x["station"] for x in xs}),
                  "us_share": round(sum(x["us"] for x in xs) / len(xs), 3),
                  "after_obs_s": X.pct([x["after_obs"] for x in xs], (0.1, 0.5, 0.9)),
                  "after_awc_receipt_s": X.pct(rcs, (0.1, 0.5, 0.9)),
                  "before_receipt_share": round(sum(1 for r in rcs if r < 0) / len(rcs), 3) if rcs else None,
                  "top_stations": sorted({x["station"] for x in xs},
                                         key=lambda s: (-sum(1 for x in xs if x["station"] == s), s))[:6]}
    res = {"sample": "informative bucket deaths, 2026-09-01 → 09-26 (PMLATE's exploration month)",
           "wallets_with_5_plus": out,
           "all_first_prints": sum(len(v) for v in by.values()), "distinct_wallets": len(by)}
    with open(outp, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    for w, v in list(out.items())[:15]:
        print(w, v["first_prints"], v["stations"], v["us_share"], "obs p50", v["after_obs_s"]["p50"],
              "rc p10/50/90", v["after_awc_receipt_s"]["p10"], v["after_awc_receipt_s"]["p50"],
              v["after_awc_receipt_s"]["p90"], "before rc", v["before_receipt_share"], v["top_stations"])


if __name__ == "__main__":
    main()
