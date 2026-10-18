"""Deviation 3's clock check on HistData's index files: for each year-season, the median |1-minute return| in the 15
minutes after the cash open over the 15 minutes before (r0), and the same with both windows an hour earlier (r-) and
later (r+). Pass: r0 >= 1.5 and r0 > max(r-, r+). WTI: Wednesdays around 10:30 ET. Writes inputs/hd_tzcheck2.json.

Reads the raw HistData cache through pull.py (python3 -P scripts/tzcheck.py from the folder holding pull.py).
"""
import datetime as dt, json, os, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pull as PL  # noqa: E402

UTC = dt.timezone.utc


def ratio(by_day, anchor_min, shift):
    a, b = [], []
    for mins in by_day.values():
        for k in range(anchor_min + shift, anchor_min + shift + 15):
            if k in mins:
                a.append(mins[k])
        for k in range(anchor_min + shift - 15, anchor_min + shift):
            if k in mins:
                b.append(mins[k])
    if len(a) < 200 or len(b) < 200 or st.median(b) == 0:
        return None
    return st.median(a) / st.median(b)


def main():
    out = {}
    for mkt, sym in PL.HD_INDEX.items():
        tz, (oh, om), _ = PL.SESS[mkt]
        anchor = oh * 60 + om if mkt != "WTI" else 10 * 60 + 30
        bars = PL.hd_bars(sym, range(2010, 2027))
        groups = {}
        prev = None
        for b in bars:
            if prev and b[0] - prev[0] == 60 and prev[4] > 0:
                lt = dt.datetime.fromtimestamp(b[0], UTC).astimezone(tz)
                if lt.weekday() < 5 and (mkt != "WTI" or lt.weekday() == 2):
                    key = f"{lt.year}-{'summer' if 4 <= lt.month <= 10 else 'winter'}"
                    groups.setdefault(key, {}).setdefault(lt.date(), {})[lt.hour * 60 + lt.minute] = abs(b[4] / prev[4] - 1)
            prev = b
        res = {}
        for key in sorted(groups):
            r0, rm, rp = (ratio(groups[key], anchor, s) for s in (0, -60, 60))
            ok = r0 is not None and r0 >= 1.5 and r0 > max(x for x in (rm, rp, 0) if x is not None)
            res[key] = {"r0": None if r0 is None else round(r0, 2), "r_minus_1h": None if rm is None else round(rm, 2),
                        "r_plus_1h": None if rp is None else round(rp, 2), "pass": ok}
        out[mkt] = res
        print(mkt, sum(v["pass"] for v in res.values()), "of", len(res), "pass", file=sys.stderr)
    json.dump(out, open(os.path.join(PL.INP, "hd_tzcheck2.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
