"""PMLATE data step 1: every daily temperature event of a date range, with every bucket.

Gamma's events tagged "Daily Temperature" (tag 103040; the tag exists from 2025-12-31, and the events before it are
fp4's WX list, `universe_wx.py`), by their scheduled end (12:00 UTC on the target date), a hundred a page. Each
market is parsed by `common.parse_market`: city, high or low, unit, whole-degree bucket, station (the ICAO code in
the resolution URL), resolution source (NWS time series, Weather Underground or the Hong Kong Observatory), tokens,
payout, closed time, the market's own fee schedule. Writes $PMLATE_DATA/univ/events_<from>_<to>.json.

usage: universe.py <from YYYY-MM-DD> <to YYYY-MM-DD, exclusive>
"""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

TAG = "103040"


def main():
    d0, d1 = sys.argv[1], sys.argv[2]
    events, unparsed = {}, []
    day = datetime.fromisoformat(d0)
    end = datetime.fromisoformat(d1)
    while day < end:
        lo, hi = day.strftime("%Y-%m-%dT00:00:00Z"), (day + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
        off = 0
        while True:
            page = C.pmnet.get(C.GAMMA + "/events", {"tag_id": TAG, "end_date_min": lo, "end_date_max": hi,
                                                     "limit": 100, "offset": off}) or []
            for ev in page:
                bks = []
                for m in ev.get("markets") or []:
                    m.setdefault("events", [{"id": ev.get("id"), "slug": ev.get("slug")}])
                    p = C.parse_market(m)
                    if p:
                        bks.append(p)
                    elif "temperature" in (m.get("question") or "").lower():
                        unparsed.append(m.get("question"))
                if not bks:
                    continue
                bks.sort(key=lambda b: (b["bucket"][0] if b["bucket"][0] is not None else -999))
                b0 = bks[0]
                stations = sorted({b["station"] for b in bks if b["station"]})
                events[str(ev.get("id"))] = {
                    "event": str(ev.get("id")), "slug": ev.get("slug"), "city": b0["city"], "date": b0["date"],
                    "hl": b0["hl"], "unit": b0["unit"], "station": stations[0] if len(stations) == 1 else None,
                    "station_conflict": len(stations) > 1, "source": b0["source"], "src_url": b0["src_url"],
                    "end": b0["end"], "closed": bool(ev.get("closed")), "neg_risk": bool(ev.get("negRisk")),
                    "buckets": bks,
                }
            if len(page) < 100:
                break
            off += 100
        print(day.date(), "events so far", len(events), flush=True)
        day += timedelta(days=1)
    C.dump_json(os.path.join(C.DATA, "univ", f"events_{d0}_{d1}.json"), {"events": events, "unparsed": unparsed})
    print("events", len(events), "buckets", sum(len(e["buckets"]) for e in events.values()), "unparsed", len(unparsed))


if __name__ == "__main__":
    main()
