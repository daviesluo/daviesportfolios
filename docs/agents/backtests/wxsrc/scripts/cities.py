"""WXSRC A1: every open daily-temperature market's city, station, resolution source and rules, from Gamma.

Gamma's events tagged "Daily Temperature" (tag 103040) that are not closed, a hundred a page, each read once with a
cache-busting parameter (Gamma is cached by CloudFront for five minutes). Each market is parsed by PMLATE's
`common.parse_market`: city, high or low, unit, whole-degree bucket, station (the ICAO code in the resolution URL),
resolution source (the NWS time series page, Weather Underground, or the Hong Kong Observatory). The rules text
(`description`) of one market per city and kind is kept word for word, because the rules say which reading counts
(whole degrees, the unit, "once finalized", revisions).

Writes $WXSRC_DATA/cities_open_<UTC stamp>.json.gz (the raw events) and results/cities_open.json (per city).

usage: cities.py
"""
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wxcommon as X  # noqa: E402

C = X.C
TAG = "103040"
HKO = re.compile(r"(weather\.gov\.hk|hko\.gov\.hk)[^\s\"')]*", re.I)
URL = re.compile(r"https?://[^\s\"')]+")


def main():
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    raw, off = [], 0
    at = str(int(time.time() * 1000))
    while True:
        page = C.pmnet.get(C.GAMMA + "/events", {"tag_id": TAG, "closed": "false", "limit": 100, "offset": off,
                                                 "_": at}) or []
        raw.extend(page)
        if len(page) < 100:
            break
        off += 100
    X.dump_gz(os.path.join(X.DATA, f"cities_open_{stamp}.json.gz"), {"read_at": stamp, "events": raw})
    cities = defaultdict(lambda: {"events": 0, "dates": set(), "kinds": set(), "stations": set(), "sources": set(),
                                  "src_urls": set(), "units": set(), "volume_usd": 0.0, "liquidity_usd": 0.0,
                                  "rules": {}, "rule_urls": set(), "fee": set(), "tick": set()})
    unparsed = []
    for ev in raw:
        bks = []
        for m in ev.get("markets") or []:
            m.setdefault("events", [{"id": ev.get("id"), "slug": ev.get("slug")}])
            p = C.parse_market(m)
            if p:
                bks.append((p, m))
            elif "temperature" in (m.get("question") or "").lower():
                unparsed.append(m.get("question"))
        if not bks:
            continue
        p0, m0 = bks[0]
        c = cities[p0["city"]]
        c["events"] += 1
        c["dates"].add(p0["date"])
        c["kinds"].add(p0["hl"])
        c["units"].add(p0["unit"])
        for p, m in bks:
            if p["station"]:
                c["stations"].add(p["station"])
            c["sources"].add(p["source"])
            if p["src_url"]:
                c["src_urls"].add(p["src_url"])
            c["fee"].add((p["fee_rate"], p["fee_exp"]))
            c["tick"].add(p["tick"])
            c["volume_usd"] += float(m.get("volumeNum") or 0)
            c["liquidity_usd"] += float(m.get("liquidityNum") or 0)
        desc = m0.get("description") or ""
        c["rules"].setdefault(p0["hl"], desc)
        for u in URL.findall(desc):
            c["rule_urls"].add(u.rstrip(".,"))
    out = {}
    for city, c in sorted(cities.items()):
        out[city] = {
            "events_open": c["events"], "dates": sorted(c["dates"]), "kinds": sorted(c["kinds"]),
            "stations": sorted(c["stations"]), "sources": sorted(c["sources"]), "src_urls": sorted(c["src_urls"]),
            "units": sorted(c["units"]), "open_volume_usd": round(c["volume_usd"], 2),
            "open_liquidity_usd": round(c["liquidity_usd"], 2), "rules": c["rules"],
            "rule_urls": sorted(c["rule_urls"]), "fee_rate_exp": sorted([list(x) for x in c["fee"]], key=str),
            "ticks": sorted(c["tick"], key=str),
        }
    res = {"read_at": stamp, "tag": TAG, "events_read": len(raw), "cities": out, "unparsed_questions": unparsed[:50],
           "source": "GET https://gamma-api.polymarket.com/events?tag_id=103040&closed=false&limit=100&offset=<k>&_=<ms>"}
    X.write_result("cities_open.json", res)
    print("events", len(raw), "cities", len(out), "unparsed", len(unparsed))
    for city, v in out.items():
        print(f"{city:22s} {','.join(v['stations']):10s} {','.join(v['sources']):8s} {','.join(v['units'])} "
              f"ev={v['events_open']:3d} vol=${v['open_volume_usd']:>12,.0f} liq=${v['open_liquidity_usd']:>10,.0f}")


if __name__ == "__main__":
    main()
