"""FXW-IG: STATARB-2's AUD/USD Sunday-gap fade (reviews/2026-10-09-stat-arb-search-2.md §3.2, §4.2) re-priced at IG.

Reads STATARB-2's committed weekend table (../statarb_search2/inputs/fx/fxcm_AUDUSD_weekends.csv.gz, unchanged) and
asks what IG's quote would have to be for the edge to survive. The rule is STATARB-2's E0 at G = 20 bps, unchanged
(fade at the first quote, take profit when the mid touches Friday's mid, else close at +24 h, 1 bp to exit), with
three things changed, each fixed before this run:
  1. the entry is FXCM's first-minute MID plus half an assumed IG spread s (s = FXCM's own, 8.35, 12, 16, 20, 30, 40
     bps), so the breakeven opening spread can be read off;
  2. IG's overnight funding: a position held through 22:00 UK pays tom-next plus 1.5 % a year; charged here as a flat
     1 bp a trade (two nights at a 3.5 % worst-case carry plus the fee: an upper bound for AUD/USD in 2016-2026);
  3. the timing, described: FXCM's archive opens at 17:00 New York (21:00 UTC in summer, 22:00 UTC in winter, i.e.
     22:00 UK all year), while IG's weekday FX opens at 21:00 UK -- an hour BEFORE the first FXCM minute.
Output: results/fxw_ig.json (deterministic).
"""
import csv, datetime as dt, gzip, io, json, math, os
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from common import summ, dump, HERE

SRC = os.path.join(os.path.dirname(HERE), "statarb_search2", "inputs", "fx", "fxcm_AUDUSD_weekends.csv.gz")


def main():
    wk = []
    for r in csv.DictReader(io.StringIO(gzip.open(SRC).read().decode())):
        fri, sun = int(r["fri_utc"]), int(r["sun_utc"])
        if dt.datetime.utcfromtimestamp(fri).weekday() != 4 or not (40 * 3600 <= sun - fri <= 60 * 3600):
            continue
        fmid = (float(r["fri_bid"]) + float(r["fri_ask"])) / 2
        sb, sa = float(r["sun_bid_open"]), float(r["sun_ask_open"])
        smid = (sb + sa) / 2
        wk.append(dict(sun=sun, g=math.log(smid / fmid), fmid=fmid, smid=smid, sb=sb, sa=sa, m24=float(r["mid_24h"]),
                       m1=float(r["mid_1h"]), fill=int(r["fill_min"]) if r["fill_min"] else None))
    out = {"weekends": len(wk), "source": os.path.relpath(SRC, HERE)}
    from zoneinfo import ZoneInfo
    uk = ZoneInfo("Europe/London")
    hours = {}
    for w in wk:
        t = dt.datetime.fromtimestamp(w["sun"], uk)
        hours[f"{t.hour:02d}:{t.minute // 10}x UK"] = hours.get(f"{t.hour:02d}:{t.minute // 10}x UK", 0) + 1
    out["fxcm_first_minute_uk_time"] = dict(sorted(hours.items()))
    sel = [w for w in wk if abs(w["g"]) >= 0.002]
    years = (wk[-1]["sun"] - wk[0]["sun"]) / (365.25 * 86400)
    out["trades"], out["per_year"] = len(sel), round(len(sel) / years, 2)
    fills = [w["fill"] for w in sel if w["fill"] is not None and w["fill"] <= 1440]
    out["take_profit_within"] = {f"{m}min": round(sum(f <= m for f in fills) / len(sel), 3) for m in (1, 5, 15, 60, 240, 1440)}
    for s in ("fxcm", 8.35, 12, 16, 20, 30, 40):
        x = []
        for w in sel:
            d = -1 if w["g"] > 0 else 1
            if s == "fxcm":
                entry = w["sa"] if d == 1 else w["sb"]
            else:
                entry = w["smid"] * (1 + d * s / 2e4)
            exit_ = w["fmid"] if (w["fill"] is not None and w["fill"] <= 1440) else w["m24"]
            x.append(d * math.log(exit_ / entry) - 1e-4 - 1e-4)  # 1 bp exit, 1 bp funding
        out[f"E0_spread_{s}"] = summ(x, len(sel) / years)
    # the gross reversion from FXCM's first MID (no spread): what any opening spread has to come out of
    out["E0_from_mid_gross"] = summ([(-1 if w["g"] > 0 else 1) * math.log(
        (w["fmid"] if (w["fill"] is not None and w["fill"] <= 1440) else w["m24"]) / w["smid"]) for w in sel])
    # how much of the reversion is gone after the first hour (E1 from the +1 h mid, no take-profit)
    out["E1_from_1h_mid_gross"] = summ([(-1 if w["g"] > 0 else 1) * math.log(w["m24"] / w["m1"]) for w in sel])
    dump("fxw_ig.json", out)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
