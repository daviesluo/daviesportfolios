"""PMLATE: station observations (METAR / SPECI) from two keyless archives, and the day's running extreme.

* Iowa Environmental Mesonet's ASOS/METAR archive (`asos.py`): every routine report (report_type 3) and every special
  (report_type 4) of a station, raw text, over any range; US stations by their three-letter id, the rest by ICAO.
* aviationweather.gov's METAR API: the same reports with the instant AWC RECEIVED each (`receiptTime`), for the most
  recent days only. It is the clock PMLATE times the market against: a report is public from its receipt, not from its
  observation time.

Temperatures: a US report's remarks carry tenths of a degree Celsius (`T0211 0156` → 21.1 °C), which is how ASOS encodes
its whole-°F reading, so °F = round(tenths × 9/5 + 32) recovers the station's own whole degree; the body's whole °C
(`21/16`) is the value every other station reports, and the one a °C market reads. `temp_in(unit)` returns the whole
degree in the market's unit that a person reading the source would see.
"""
import csv
import io
import json
import os
import re
from datetime import datetime, timedelta, timezone

import common as C

BODY = re.compile(r"\s(M?\d{2})/(M?\d{2})?(?=\s|$)")
TGRP = re.compile(r"\sT([01])(\d{3})([01])(\d{3})\b")


def _c(s):
    return -int(s[1:]) if s.startswith("M") else int(s)


def parse_temp(raw):
    """(tenths °C or None, body whole °C or None) from a raw METAR."""
    t = TGRP.search(" " + raw)
    tenths = None
    if t:
        tenths = (-1 if t.group(1) == "1" else 1) * int(t.group(2)) / 10.0
    body = None
    # the body's temperature group comes before RMK
    main = raw.split(" RMK")[0]
    b = BODY.search(" " + main + " ")
    if b:
        body = _c(b.group(1))
    return tenths, body


def temp_in(obs, unit):
    """The whole degree a reader of the source sees, in the market's unit."""
    if unit == "F":
        if obs.get("tenths") is not None:
            return C.round_half_up(C.f_of_c(obs["tenths"]))
        if obs.get("body") is not None:
            return C.round_half_up(C.f_of_c(obs["body"]))
        return None
    if obs.get("body") is not None:
        return obs["body"]
    if obs.get("tenths") is not None:
        return C.round_half_up(obs["tenths"])
    return None


def iem(icao, t0, t1, cache_dir):
    """Every routine and special report of `icao` whose observation time is in [t0, t1) (UTC datetimes), oldest first:
    {ts, kind ('routine'|'special'), raw, tenths, body}. Cached per station and range."""
    key = f"{icao}_{t0:%Y%m%d}_{t1:%Y%m%d}.json"
    path = os.path.join(cache_dir, key) if cache_dir else None
    if path and C.pmnet.exists(path):
        return C.pmnet.load(path)
    out = []
    for rt, kind in ((3, "routine"), (4, "special")):
        params = {"station": C.iem_id(icao), "data": "metar", "year1": t0.year, "month1": t0.month, "day1": t0.day,
                  "hour1": t0.hour, "minute1": t0.minute, "year2": t1.year, "month2": t1.month, "day2": t1.day,
                  "hour2": t1.hour, "minute2": t1.minute, "tz": "Etc/UTC", "format": "onlycomma", "latlon": "no",
                  "missing": "M", "trace": "T", "direct": "no", "report_type": rt}
        body = C.pmnet.get(C.IEM, params, raw=True).decode("utf-8", "replace")
        for row in csv.DictReader(io.StringIO(body)):
            raw = (row.get("metar") or "").strip()
            if not raw or raw == "M":
                continue
            ts_ = datetime.strptime(row["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).timestamp()
            tenths, bdy = parse_temp(raw)
            out.append({"ts": ts_, "kind": kind, "raw": raw[:200], "tenths": tenths, "body": bdy})
    out.sort(key=lambda o: (o["ts"], o["kind"]))
    if path:
        C.pmnet.dump(path, out)
    return out


def awc(icao, t_end, hours, cache_dir):
    """AWC's reports of `icao` in the `hours` before `t_end` (UTC datetime), with their receipt instants:
    {obs_ts, receipt_ts, report_ts, type, raw, temp_c}. AWC serves only recent days; older ranges come back empty."""
    key = f"awc_{icao}_{t_end:%Y%m%d%H%M}_{hours}.json"
    path = os.path.join(cache_dir, key)
    if C.pmnet.exists(path):
        return C.pmnet.load(path)
    body = C.pmnet.get(C.AWC + "/metar", {"ids": icao, "format": "json", "date": t_end.strftime("%Y%m%d_%H%M"),
                                          "hours": hours}, raw=True)
    # 204 with no body: AWC has no report of this station in the range (it does not carry every station)
    d = json.loads(body) if body and body.strip() else []
    out = []
    for x in d:
        rc = C.ts(x.get("receiptTime"))
        out.append({"obs_ts": x.get("obsTime"), "receipt_ts": rc, "report_ts": C.ts(x.get("reportTime")),
                    "type": x.get("metarType"), "raw": (x.get("rawOb") or "")[:200], "temp_c": x.get("temp")})
    out.sort(key=lambda o: (o["obs_ts"] or 0))
    C.pmnet.dump(path, out)
    return out


def local_day_bounds(date, tzname):
    """[start, end) of the local civil day `date` (YYYY-MM-DD) as Unix seconds."""
    from zoneinfo import ZoneInfo
    z = ZoneInfo(tzname)
    y, m, d = map(int, date.split("-"))
    s = datetime(y, m, d, tzinfo=z)
    e = (s + timedelta(days=1)).replace(tzinfo=None).replace(tzinfo=z)
    return s.timestamp(), e.timestamp()


def running(obs, unit, hl, t0, t1, kinds=("routine", "special")):
    """The day's reports in [t0, t1) of the given kinds, each with the running extreme after it (max for a high, min
    for a low), in the market's whole degrees: [(ts, value, running)]."""
    out, cur = [], None
    for o in obs:
        if not (t0 <= o["ts"] < t1) or o["kind"] not in kinds:
            continue
        v = temp_in(o, unit)
        if v is None:
            continue
        cur = v if cur is None else (max(cur, v) if hl == "highest" else min(cur, v))
        out.append((o["ts"], v, cur))
    return out
