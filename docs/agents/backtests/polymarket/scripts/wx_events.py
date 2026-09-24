"""WX data step 1: every resolved daily-temperature event, parsed (fp4, test WX).

From the closed-market pulls, every "Will the highest|lowest temperature in
<city> be <bucket> on <date>?" market, grouped by its Gamma event: the city, high
or low, the unit, each bucket as a continuous interval (the resolution source
reports whole degrees: "between 45-46°F" is [44.5, 46.5), "34°C" is [33.5, 34.5),
"44°F or below" is (-inf, 44.5)), the station (the ICAO code in the Wunderground
URL; LaGuardia and London City for the 2025 markets whose source field is empty,
as their descriptions say; the Hong Kong Observatory's own site), the payout of
each bucket and its tokens. Unparsed questions are counted. Station coordinates
come from aviationweather.gov's public station list. Writes $PM_DATA/wx/events.json.
"""
import glob
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

Q = re.compile(r"(?P<hl>highest|lowest) temperature in (?P<city>.+?) (?:be )?(?:be )?(?:between |be tween )?"
               r"(?P<a>-?\d+(?:\.\d+)?)\s*(?:[-–]\s*(?P<b>-?\d+(?:\.\d+)?))?\s*°\s*(?P<u>[FC])"
               r"(?P<tail> or below| or lower| or higher| or above)?\s+on (?P<mon>[A-Z][a-z]+) (?P<day>\d+)", re.I)
ICAO = re.compile(r"wunderground\.com/history/daily/[^\s\"']*/([A-Z0-9]{4})\b")
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}
FALLBACK = {"nyc": "KLGA", "new york city": "KLGA", "london": "EGLC"}
HKO = {"lat": 22.302, "lon": 114.174}
AWC = "https://aviationweather.gov/api/data/stationinfo"


def ts(s):
    if not s:
        return None
    s = s.strip().replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def interval(a, b, tail):
    a = float(a)
    if b is not None:
        return [a - 0.5, float(b) + 0.5]
    t = (tail or "").strip().lower()
    if t in ("or below", "or lower"):
        return [None, a + 0.5]
    if t in ("or higher", "or above"):
        return [a - 0.5, None]
    return [a - 0.5, a + 0.5]


def main():
    events = defaultdict(lambda: {"markets": []})
    unparsed = []
    for f in pmnet.list_json(os.path.join(pmnet.DATA, "closed")):
        for m in pmnet.load(f):
            q = m.get("question") or ""
            if not re.search(r"(highest|lowest) temperature in", q, re.I):
                continue
            mm = Q.search(q)
            if not mm:
                unparsed.append(q)
                continue
            try:
                toks = json.loads(m.get("clobTokenIds") or "[]")
                op = [float(x) for x in json.loads(m.get("outcomePrices") or "[]")]
            except ValueError:
                unparsed.append(q)
                continue
            if len(toks) != 2 or len(op) != 2:
                unparsed.append(q)
                continue
            end = ts(m.get("endDate"))
            ey = datetime.fromtimestamp(end, timezone.utc).year if end else None
            mon = MONTHS.get(mm.group("mon").lower())
            if not mon or not ey:
                unparsed.append(q)
                continue
            em = datetime.fromtimestamp(end, timezone.utc).month
            year = ey - 1 if (mon == 12 and em == 1) else (ey + 1 if (mon == 1 and em == 12) else ey)
            date = f"{year:04d}-{mon:02d}-{int(mm.group('day')):02d}"
            city = mm.group("city").strip()
            src = m.get("resolutionSource") or ""
            ic = ICAO.search(src)
            station = ic.group(1) if ic else ("HKO" if "hong kong" in city.lower() else FALLBACK.get(city.lower()))
            ev = (m.get("events") or [{}])[0]
            key = ev.get("id") or f"{city}|{date}|{mm.group('hl')}"
            e = events[key]
            e.update({"event": key, "slug": ev.get("slug"), "city": city, "date": date, "hl": mm.group("hl").lower(),
                      "unit": mm.group("u").upper()})
            e.setdefault("stations", set()).add(station)
            e["markets"].append({"cond": m["conditionId"], "tokens": toks, "payout_yes": op[0], "iv": interval(mm.group("a"), mm.group("b"), mm.group("tail")),
                                 "end": end, "closed": ts(m.get("closedTime")), "start": ts(m.get("startDate")) or ts(m.get("createdAt")),
                                 "tick": m.get("orderPriceMinTickSize"), "fee_rate": ((m.get("feeSchedule") or {}).get("rate") if m.get("feesEnabled") else None),
                                 "vol": m.get("volumeNum"), "q": q[:100]})
    out, stations = [], set()
    for key, e in events.items():
        st = sorted(s for s in e.pop("stations") if s)
        e["station"] = st[0] if len(st) == 1 else None
        e["station_conflict"] = len(st) > 1
        e["markets"].sort(key=lambda x: (x["iv"][0] if x["iv"][0] is not None else -1e9))
        e["winners"] = sum(1 for x in e["markets"] if x["payout_yes"] >= 1.0)
        out.append(e)
        if e["station"] and e["station"] != "HKO":
            stations.add(e["station"])
    coords = {"HKO": HKO}
    st = sorted(stations)
    for i in range(0, len(st), 40):
        d = pmnet.get(AWC, {"ids": ",".join(st[i:i + 40]), "format": "json"})
        for s in d or []:
            coords[s.get("icaoId")] = {"lat": s.get("lat"), "lon": s.get("lon"), "site": s.get("site")}
    out.sort(key=lambda e: (e["date"], e["city"], e["hl"]))
    pmnet.dump(os.path.join(pmnet.DATA, "wx", "events.json"), {"events": out, "stations": coords, "unparsed": unparsed})
    print("events", len(out), "markets", sum(len(e["markets"]) for e in out), "unparsed", len(unparsed),
          "stations", len(coords), "no station", sum(1 for e in out if not e["station"]),
          "one winner", sum(1 for e in out if e["winners"] == 1))


if __name__ == "__main__":
    main()
