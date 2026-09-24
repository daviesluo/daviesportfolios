"""WX data step 2: what a public forecast said 24 and 48 hours ahead, at every station (fp4, test WX).

Open-Meteo's keyless Previous Runs API: `temperature_2m_previous_day2` is the
value its default blend predicted 48 hours before each valid hour, and
`_previous_day1` 24 hours before (documented; archived from January 2024). For
every station of $PM_DATA/wx/events.json, hourly values over the events' dates
in the station's local time (`timezone=auto`), reduced to each local day's
maximum and minimum, in °C. Writes $PM_DATA/wx/forecasts.json. The test reads
only the 48-hour values (`max2`, `min2`).

Each station is saved as it arrives and a rerun skips the stations it has: the
free API has a daily request limit (it refused the 22nd station of a full run
on 2026-09-24 with "Daily API request limit exceeded"), so the pull may take more
than one day. A refusal stops the run with what it has; nothing is written for a
station it did not finish. (The next run, two minutes later, was served in full:
all 54 stations.)
"""
import os
import sys
from collections import defaultdict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

API = "https://previous-runs-api.open-meteo.com/v1/forecast"


def main():
    ev = pmnet.load(os.path.join(pmnet.DATA, "wx", "events.json"))
    path = os.path.join(pmnet.DATA, "wx", "forecasts.json")
    out = pmnet.load(path) if os.path.exists(path) else {}
    dates = defaultdict(set)
    for e in ev["events"]:
        if e.get("station"):
            dates[e["station"]].add(e["date"])
    left = 0
    for st, ds in sorted(dates.items()):
        if st in out:
            continue
        c = ev["stations"].get(st)
        if not c or c.get("lat") is None:
            continue
        d0 = (date.fromisoformat(min(ds)) - timedelta(days=1)).isoformat()
        d1 = (date.fromisoformat(max(ds)) + timedelta(days=1)).isoformat()
        try:
            d = pmnet.get(API, {"latitude": c["lat"], "longitude": c["lon"], "timezone": "auto", "start_date": d0, "end_date": d1,
                                "hourly": "temperature_2m_previous_day1,temperature_2m_previous_day2"}, timeout=180)
        except RuntimeError as err:
            print("stopped at", st, str(err)[:200], flush=True)
            left = 1
            break
        h = d.get("hourly") or {}
        days = defaultdict(lambda: {"v1": [], "v2": []})
        for t, v1, v2 in zip(h.get("time") or [], h.get("temperature_2m_previous_day1") or [], h.get("temperature_2m_previous_day2") or []):
            day = t[:10]
            if v1 is not None:
                days[day]["v1"].append(v1)
            if v2 is not None:
                days[day]["v2"].append(v2)
        out[st] = {"tz": d.get("timezone"), "utc_offset_s": d.get("utc_offset_seconds"),
                   "days": {k: {"max1": max(x["v1"]) if len(x["v1"]) >= 20 else None, "min1": min(x["v1"]) if len(x["v1"]) >= 20 else None,
                                "max2": max(x["v2"]) if len(x["v2"]) >= 20 else None, "min2": min(x["v2"]) if len(x["v2"]) >= 20 else None}
                            for k, x in sorted(days.items())}}
        pmnet.dump(path, out)
        print(st, d0, d1, len(out[st]["days"]), flush=True)
    todo = [s for s in dates if s not in out and (ev["stations"].get(s) or {}).get("lat") is not None]
    print("stations done", len(out), "left", len(todo), flush=True)
    sys.exit(1 if (left or todo) else 0)


if __name__ == "__main__":
    main()
