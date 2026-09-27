"""WXSRC A2b: the Hong Kong Observatory's running maximum and minimum, as the public saw it, from DATA.GOV.HK's archive.

The Hong Kong markets resolve on the Observatory's Daily Extract ("Absolute Daily Max (deg. C)", 0.1 °C). The
Observatory also publishes, keylessly, "the maximum and minimum air temperature from 1-minute mean temperatures since
midnight" for each station, updated every ten minutes (`latest_since_midnight_maxmin.csv`, DATA.GOV.HK dataset
hk-hko-rss-max-and-min-air-temp-since-midnight). DATA.GOV.HK's historical archive keeps every version it captured,
stamped with its capture time in Hong Kong time (`/v1/historical-archive/list-file-versions`, then the file itself from
the archive's public S3 bucket). The capture time is an upper bound on when the version was public.

For each Hong Kong day in [from, to) this lists the versions and fetches each one, keeping the "HK Observatory" row:
the data slot (`Date time`, HKT), the running max and min, and the capture instant. Writes one file a day,
$WXSRC_DATA/hko/sincemidnight_<YYYY-MM-DD>.json.gz, and skips a day already written. The archive lists a day only once
it is over in Hong Kong ("invalid end parameter (later than yesterday)").

usage: hko_archive.py <from YYYY-MM-DD> <to YYYY-MM-DD, exclusive>
"""
import csv
import io
import os
import sys
import time

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wxcommon as X  # noqa: E402

C = X.C
SRC = "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_since_midnight_maxmin.csv"
LIST = "https://api.data.gov.hk/v1/historical-archive/list-file-versions"
GET = "https://api.data.gov.hk/v1/historical-archive/get-file"
S3 = "https://s3-ap-southeast-1.amazonaws.com/historical-resource-archive"
HKT = ZoneInfo("Asia/Hong_Kong")
C.pmnet.MIN_GAP.setdefault("api.data.gov.hk", 0.35)
C.pmnet.MIN_GAP.setdefault("s3-ap-southeast-1.amazonaws.com", 0.1)


def versions(day):
    d = C.pmnet.get(LIST, {"url": SRC, "start": day.strftime("%Y%m%d"), "end": day.strftime("%Y%m%d")})
    return d.get("timestamps") or []


def fetch(stamp):
    # the API answers 302 to the archive's S3 object; urllib follows it
    body = C.pmnet.get(GET, {"url": SRC, "time": stamp}, raw=True).decode("utf-8", "replace")
    for row in csv.reader(io.StringIO(body)):
        if len(row) >= 4 and row[1].strip() == "HK Observatory":
            return row[0].strip(), row[2].strip(), row[3].strip()
    return None


def main():
    d0, d1 = datetime.fromisoformat(sys.argv[1]), datetime.fromisoformat(sys.argv[2])
    day = d0
    while day < d1:
        path = os.path.join(X.DATA, "hko", f"sincemidnight_{day:%Y-%m-%d}.json.gz")
        if os.path.exists(path):
            day += timedelta(days=1)
            continue
        vs = versions(day)
        out, n = [], 0
        for st in vs:
            r = fetch(st)
            cap = datetime.strptime(st, "%Y%m%d-%H%M").replace(tzinfo=HKT).timestamp()
            if r is None:
                out.append({"capture": st, "capture_ts": cap, "slot": None})
                continue
            slot, mx, mn = r
            slot_ts = datetime.strptime(slot, "%Y%m%d%H%M").replace(tzinfo=HKT).timestamp()
            out.append({"capture": st, "capture_ts": cap, "slot": slot, "slot_ts": slot_ts,
                        "max": float(mx) if mx not in ("", "N/A") else None,
                        "min": float(mn) if mn not in ("", "N/A") else None})
            n += 1
        # one file a Hong Kong day, written when the day is complete (a failure loses at most that day)
        X.dump_gz(path, {"source": SRC, "archive": LIST + " + " + GET, "day": f"{day:%Y-%m-%d}", "rows": out,
                         "read_at": int(time.time())})
        print(day.date(), "versions", len(vs), "with HKO row", n, flush=True)
        day += timedelta(days=1)


if __name__ == "__main__":
    main()
