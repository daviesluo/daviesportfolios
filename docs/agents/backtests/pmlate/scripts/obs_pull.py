"""PMLATE data step 2: every station report of a universe's stations over its dates, and AWC's receipt instants.

For each METAR station of the events file (not the Hong Kong Observatory, which publishes no METAR): IEM's routine and
special reports from the day before the first target date to two days after the last, in one request per kind and
station per calendar year; and, when `--awc` is given, aviationweather.gov's reports of the same range with the
instant AWC received each, in three-day requests (AWC answers at most 400 reports a request and keeps about thirty
days). Writes $PMLATE_DATA/obs/<station>.json: {"iem": [...], "awc": [...]}.

usage: obs_pull.py <events file> [--awc]
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import metar as W  # noqa: E402


def main():
    evf = sys.argv[1]
    use_awc = "--awc" in sys.argv
    ev = C.load_json(evf)["events"]
    ev = ev.values() if isinstance(ev, dict) else ev
    by_st = {}
    for e in ev:
        st = e.get("station")
        if not st or st == "HKO":
            continue
        by_st.setdefault(st, []).append(e["date"])
    outdir = os.path.join(C.DATA, "obs")
    for st, dates in sorted(by_st.items()):
        path = os.path.join(outdir, st + ".json")
        d0 = datetime.fromisoformat(min(dates)).replace(tzinfo=timezone.utc) - timedelta(days=1)
        d1 = datetime.fromisoformat(max(dates)).replace(tzinfo=timezone.utc) + timedelta(days=2)
        have = C.load_json(path) if C.pmnet.exists(path) else {"iem": [], "awc": [], "ranges": []}
        if [d0.isoformat(), d1.isoformat()] not in have["ranges"]:
            iem = {(o["ts"], o["kind"]): o for o in have["iem"]}
            y = d0
            while y < d1:
                y_end = min(d1, datetime(y.year + 1, 1, 1, tzinfo=timezone.utc))
                for o in W.iem(st, y, y_end, None):
                    iem[(o["ts"], o["kind"])] = o
                y = y_end
            have["iem"] = sorted(iem.values(), key=lambda o: (o["ts"], o["kind"]))
            have["ranges"].append([d0.isoformat(), d1.isoformat()])
        if use_awc and not have.get("awc_done"):
            awc = {}
            t = min(d1, datetime.now(timezone.utc))
            floor = max(d0, datetime.now(timezone.utc) - timedelta(days=29))
            while t > floor:
                for r in W.awc(st, t, 72, os.path.join(C.DATA, "awc")):
                    if r["obs_ts"]:
                        awc[(r["obs_ts"], r["raw"][:40])] = r
                t -= timedelta(hours=72)
            have["awc"] = sorted(awc.values(), key=lambda r: r["obs_ts"])
            have["awc_done"] = True
        C.dump_json(path, have)
        print(st, "iem", len(have["iem"]), "awc", len(have["awc"]), flush=True)


if __name__ == "__main__":
    main()
