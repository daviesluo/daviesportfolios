"""WXSRC B4 data: HRRR's hourly 2 m temperature at the twelve US market stations, from NOAA's own archive on AWS.

NOAA's HRRR archive (`noaa-hrrr-bdp-pds`, NODD open data, "since 2014", hourly runs) keeps every run's surface file
with a `.idx` index of byte offsets, so one field is one HTTP range request: the `TMP:2 m above ground` message of
each forecast hour (about 1.3 MB), decoded with ecCodes, and the value at the grid point nearest each station kept.
The file's own S3 LastModified is recorded too: it is when the forecast hour was public (on 2026-09-10 the 12Z run's
f00 was posted 51 minutes after its initial time and f18 74 minutes after).

For each date in [from, to) and each run hour given, forecast hours 1 … N. Writes one cache file per run under
$WXSRC_DATA/hrrr/<YYYYmmddHH>.json.gz: {station: [[valid Unix s, °C], …], "posted": {fhour: Unix s}}.
Keyless; ecCodes and numpy come from pip (not part of the repository; `PYTHONPATH` points at them).

usage: hrrr_points.py <from YYYY-MM-DD> <to YYYY-MM-DD, exclusive> <run hours, comma-separated> <max fhour>
"""
import gzip
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wxcommon as X  # noqa: E402

import eccodes  # noqa: E402  (pip: eccodes + eccodeslib)
import numpy as np  # noqa: E402
from concurrent.futures import ThreadPoolExecutor  # noqa: E402
from email.utils import parsedate_to_datetime  # noqa: E402

NEAREST = {}   # station -> grid index, from the first message's latitudes and longitudes (HRRR's grid is fixed)

BUCKET = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com"
COORD = {"KATL": (33.62972, -84.44223), "KAUS": (30.1831, -97.68063), "KBKF": (39.713, -104.758),
         "KDAL": (32.83836, -96.83584), "KDEN": (39.84657, -104.65623), "KHOU": (29.64582, -95.28214),
         "KLAX": (33.93817, -118.3866), "KLGA": (40.77945, -73.88027), "KMIA": (25.78806, -80.31692),
         "KORD": (41.96017, -87.93161), "KSEA": (47.44467, -122.31442), "KSFO": (37.61961, -122.36561)}
FIELD = re.compile(r"^\d+:(\d+):d=\d+:TMP:2 m above ground:")


def get(url, rng=None, tries=5):
    for i in range(tries):
        h = {"User-Agent": X.UA}
        if rng:
            h["Range"] = f"bytes={rng[0]}-{rng[1]}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
                return r.read(), dict(r.headers)
        except Exception:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def field(run, fh):
    key = f"hrrr.{run:%Y%m%d}/conus/hrrr.t{run:%H}z.wrfsfcf{fh:02d}.grib2"
    idx, _ = get(f"{BUCKET}/{key}.idx")
    lines = idx.decode().splitlines()
    for i, ln in enumerate(lines):
        m = FIELD.match(ln)
        if m:
            a = int(m.group(1))
            b = int(lines[i + 1].split(":")[1]) - 1
            msg, hd = get(f"{BUCKET}/{key}", (a, b))
            return msg, hd.get("Last-Modified")
    return None, None


def nearest(gid):
    if not NEAREST:
        lats = eccodes.codes_get_array(gid, "latitudes")
        lons = eccodes.codes_get_array(gid, "longitudes")
        lons = np.where(lons > 180, lons - 360, lons)
        for st, (lat, lon) in COORD.items():
            d2 = (lats - lat) ** 2 + ((lons - lon) * np.cos(np.radians(lat))) ** 2
            NEAREST[st] = int(np.argmin(d2))
    return NEAREST


def one(args):
    run, fh = args
    msg, lm = field(run, fh)
    if msg is None:
        return fh, None, None
    gid = eccodes.codes_new_from_message(msg)
    try:
        idx = nearest(gid)
        vals = eccodes.codes_get_values(gid)
        return fh, {st: round(float(vals[i]) - 273.15, 2) for st, i in idx.items()}, lm
    finally:
        eccodes.codes_release(gid)


def main():
    d0, d1 = datetime.fromisoformat(sys.argv[1]), datetime.fromisoformat(sys.argv[2])
    hours = [int(x) for x in sys.argv[3].split(",")]
    fmax = int(sys.argv[4])
    day = d0
    while day < d1:
        for hh in hours:
            run = day.replace(hour=hh, tzinfo=timezone.utc)
            path = os.path.join(X.DATA, "hrrr", f"{run:%Y%m%d%H}.json.gz")
            if os.path.exists(path):
                continue
            out = {st: [] for st in COORD}
            out["posted"] = {}
            if not NEAREST:
                one((run, 1))
            with ThreadPoolExecutor(max_workers=4) as ex:
                res = list(ex.map(one, [(run, fh) for fh in range(1, fmax + 1)]))
            for fh, vals, lm in sorted(res, key=lambda r: r[0]):
                if vals is None:
                    continue
                valid = (run + timedelta(hours=fh)).timestamp()
                for st, v in vals.items():
                    out[st].append([valid, v])
                if lm:
                    out["posted"][str(fh)] = parsedate_to_datetime(lm).timestamp()
            X.dump_gz(path, out)
            print(run.isoformat(), "fields", len(out["posted"]), flush=True)
        day += timedelta(days=1)


if __name__ == "__main__":
    main()
