"""ESG: the S&P 500 futures' weekend gap, the window IG's weekend markets price, and a fade of it on the US 500 DFB.

Data: Yahoo's hourly ES=F bars, the last 730 days (inputs/yahoo_1h/ES=F.csv.gz; timestamps are bar starts, UTC).
IG's weekday US 500 closes 22:00 UK on Friday and reopens 23:00 UK on Sunday with CME's 18:00 ET session; its Weekend
Wall Street / US Tech 100 / UK 100 / Germany 40 trade Saturday 08:00 to Sunday 22:40 UK in between (review §A).

The rule, written before the first run:
  F  = the close of the last hourly bar starting on Friday (ET); S = the open of the first bar on Sunday (ET);
  g  = ln(S / F). Described: |g| quantiles and the share above IG's weekend spreads.
  ESG_G (G 0.25 %, 0.5 %): fade g at S, exit at the open of the first Monday bar at or after 09:30 ET (X1; the bars start on the hour, so 10:00 ET)
  or at the open of Monday's 16:00 ET bar (X2).
  Cost: half of 1.5 points (22.00-23.00 UK band) to enter, half of 0.4 to exit; no funding (opened after Sunday 22:00 UK,
  closed before Monday 22:00 UK). In bps at the 2026-10-08 level.
Output: results/es_sunday.json. 730 days is about 100 weekends: descriptive, no bar.
"""
import datetime as dt, math, os
from zoneinfo import ZoneInfo
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from common import read_csv_gz, INP, LEVEL, summ, dump

ET = ZoneInfo("America/New_York")


def main():
    rows = read_csv_gz(os.path.join(INP, "yahoo_1h", "ES=F.csv.gz"))
    bars = []
    for r in rows:
        try:
            bars.append((dt.datetime.fromtimestamp(int(r["t"]), ET), float(r["open"]), float(r["close"])))
        except (TypeError, ValueError):
            continue
    bars.sort()
    cost = (0.75 + 0.2) / LEVEL["US500"]
    weekends, out = [], {}
    for i in range(1, len(bars)):
        a, b = bars[i - 1], bars[i]
        if a[0].weekday() == 4 and b[0].weekday() == 6:
            mon = b[0].date() + dt.timedelta(days=1)
            x1 = next((x for x in bars[i:] if x[0].date() == mon and (x[0].hour, x[0].minute) >= (9, 30)), None)
            x2 = next((x for x in bars[i:] if x[0].date() == mon and x[0].hour >= 16), None)
            if not x1 or not x2:
                continue
            weekends.append({"sun": b[0].isoformat(), "g": math.log(b[1] / a[2]), "x1": math.log(x1[1] / b[1]),
                             "x2": math.log(x2[1] / b[1])})
    ag = sorted(abs(w["g"]) for w in weekends)
    q = lambda p: round(1e4 * ag[min(len(ag) - 1, int(p * len(ag)))], 1)
    out["weekends"] = len(weekends)
    out["first"], out["last"] = weekends[0]["sun"], weekends[-1]["sun"]
    out["abs_gap_bps"] = {"p25": q(.25), "median": q(.5), "p75": q(.75), "p90": q(.9), "max": round(1e4 * ag[-1], 1)}
    # IG weekend spreads in bps of today's level (Weekend Wall Street 20 pts is quoted on the Dow: no Dow series here)
    for name, pts, lvl in (("Weekend US Tech 100", 16, LEVEL["USTECH"]), ("Weekend UK 100", 8, LEVEL["UK100"]),
                           ("Weekend Germany 40", 14, LEVEL["DE40"])):
        bps = 1e4 * pts / lvl
        out.setdefault("weekend_spread_bps", {})[name] = round(bps, 2)
        out.setdefault("share_of_ES_gaps_above_half_that_spread", {})[name] = round(
            sum(v * 1e4 > bps / 2 for v in ag) / len(ag), 3)
    # does the gap continue or revert by Monday? slope of the Monday move on the gap
    for k in ("x1", "x2"):
        xs = [w["g"] for w in weekends]
        ys = [w[k] for w in weekends]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
        out[f"slope_{k}_on_gap"] = round(b, 3)
    for G in (0.0025, 0.005):
        for k in ("x1", "x2"):
            tr = [(-1 if w["g"] > 0 else 1) * w[k] - cost for w in weekends if abs(w["g"]) >= G]
            out[f"ESG_{G * 100:g}_{k}"] = summ(tr, len(tr) / (len(weekends) / 52.18))
    out["cost_bps_round_trip"] = round(1e4 * cost, 2)
    dump("es_sunday.json", out)
    print(out)


if __name__ == "__main__":
    main()
