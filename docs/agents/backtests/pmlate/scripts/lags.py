"""PMLATE: each station's delay from a report's observation time to aviationweather.gov's receipt of it.

From the station files `obs_pull.py --awc` wrote: every report AWC holds for a station (its observation instant and
`receiptTime`), over the dates given. Per station: count, 10th / 50th / 90th / 99th percentile of the receipt delay in
seconds; and the pooled figures, US (ICAO K…) and the rest. USLATE's action time is a report's observation time plus
its station's 90th percentile plus 90 s (the pre-registration). Writes the table as JSON.

usage: lags.py <from YYYY-MM-DD> <to YYYY-MM-DD, exclusive> <out json>
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def pct(xs, p):
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def main():
    t0 = datetime.fromisoformat(sys.argv[1]).replace(tzinfo=timezone.utc).timestamp()
    t1 = datetime.fromisoformat(sys.argv[2]).replace(tzinfo=timezone.utc).timestamp()
    out, pooled = {}, {"US": [], "non-US": []}
    obsdir = os.path.join(C.DATA, "obs")
    for name in sorted(os.listdir(obsdir)):
        st = name.split(".")[0]
        o = C.load_json(os.path.join(obsdir, st + ".json"))
        lags = sorted(r["receipt_ts"] - r["obs_ts"] for r in o.get("awc", [])
                      if r.get("obs_ts") and r.get("receipt_ts") and t0 <= r["obs_ts"] < t1)
        if not lags:
            continue
        out[st] = {"n": len(lags), "p10": round(pct(lags, 0.1), 1), "p50": round(pct(lags, 0.5), 1),
                   "p90": round(pct(lags, 0.9), 1), "p99": round(pct(lags, 0.99), 1)}
        pooled["US" if st.startswith("K") else "non-US"] += lags
    summ = {k: {"n": len(v), "p50": round(pct(sorted(v), 0.5), 1), "p90": round(pct(sorted(v), 0.9), 1)} for k, v in pooled.items() if v}
    us_p90 = sorted(v["p90"] for k, v in out.items() if k.startswith("K"))
    summ["US_median_of_station_p90"] = us_p90[len(us_p90) // 2] if us_p90 else None
    res = {"from": sys.argv[1], "to": sys.argv[2], "stations": out, "pooled": summ}
    with open(sys.argv[3], "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps(summ, indent=1))


if __name__ == "__main__":
    main()
