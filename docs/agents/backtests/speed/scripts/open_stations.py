"""SPEED: the stations behind the daily temperature events Polymarket lists as OPEN right now (Gamma tag 103040).

Live data only (no closed market, no price, no print). Writes the station list with each station's resolution source
(Weather Underground or NOAA's time series) and the number of open events, to choose the stations the latency poller
watches.

usage: open_stations.py <out json>
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "daviesportfolios-speed-study/1.0 (research; public data only)"
WU = re.compile(r"wunderground\.com/history/daily/[^\s\"']*/([A-Z0-9]{4})\b")
NWS = re.compile(r"weather\.gov/wrh/timeseries\?(?:[^\s\"']*&)?site=([A-Za-z0-9]{4})\b")


def get(url, params):
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    out, off = {}, 0
    while True:
        page = get("https://gamma-api.polymarket.com/events",
                   {"tag_id": "103040", "closed": "false", "limit": 100, "offset": off})
        for ev in page:
            for m in ev.get("markets") or []:
                src = (m.get("resolutionSource") or "") + " " + (m.get("description") or "")
                st = WU.search(src) or NWS.search(src)
                station = st.group(1).upper() if st else None
                source = "nws" if NWS.search(src) else ("wu" if WU.search(src) else "other")
                key = station or ("?" + (ev.get("title") or "")[:40])
                o = out.setdefault(key, {"events": set(), "source": set(), "titles": set()})
                o["events"].add(ev.get("id"))
                o["source"].add(source)
                o["titles"].add((ev.get("title") or "")[:60])
        if len(page) < 100:
            break
        off += 100
        time.sleep(0.5)
    res = {k: {"events": len(v["events"]), "source": sorted(v["source"]), "title": sorted(v["titles"])[0]}
           for k, v in sorted(out.items())}
    with open(sys.argv[1], "w") as f:
        json.dump({"read_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "stations": res}, f, indent=1)
        f.write("\n")
    for k, v in res.items():
        print(k, v["events"], v["source"], v["title"])


if __name__ == "__main__":
    main()
