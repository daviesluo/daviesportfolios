"""WXSRC A3: how soon after its data time each candidate KEYLESS source the speed study did not cover shows a new value.

Polls, with conditional GETs (If-None-Match / If-Modified-Since, so an unchanged file costs a 304), and records the
instant this machine first saw each new version, the previous poll that did not show it, and the source's own
Last-Modified. Nothing is keyed, nothing is signed, no key embedded in any page is used, and every request carries a
User-Agent naming this project. Each interval sits well inside what the source can bear (a static file on a CDN or
open-data server, a few requests a minute); none documents a lower limit.

Sources (interval):
* hko_max   the Hong Kong Observatory's "maximum and minimum air temperature from 1-minute mean temperatures since
            midnight" (DATA.GOV.HK, updated every ten minutes), the HK Observatory row                      (5 s)
* hko_1min  the same publisher's "latest 1-minute mean air temperature", the HK Observatory row              (5 s)
* msc_swob  Environment and Climate Change Canada's Datamart SWOB-ML for Toronto Pearson, CYYZ-MAN            (5 s)
* tgftp     NOAA's tgftp station file for CYYZ and VHHH (the METAR chain, for the same clock)                 (5 s)
* awc       aviationweather.gov's METAR API for CYYZ and VHHH with receiptTime                               (15 s)
* clock     data-api.binance.vision server time, every ten minutes (this machine's clock offset)

Writes JSON lines under <out dir>: `obs.jsonl` (first sightings), `polls.jsonl` (every request), `clock.jsonl`.

usage: poll_live.py <out dir> <minutes>
"""
import csv
import io
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

UA = "wxsrc-research/1.0 (daviesportfolios; public data only)"
OUT = sys.argv[1]
END = time.time() + 60 * float(sys.argv[2])
LOCK = threading.Lock()
FILES = {}
HKT = ZoneInfo("Asia/Hong_Kong")
METAR_T = re.compile(r"\b(\d{2})(\d{2})(\d{2})Z\b")


def write(name, obj):
    with LOCK:
        f = FILES.get(name)
        if f is None:
            f = FILES[name] = open(os.path.join(OUT, name), "a", buffering=1)
        f.write(json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n")


def fetch(src, url, headers=None, timeout=20):
    h = {"User-Agent": UA}
    h.update(headers or {})
    t0 = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
            body, st, hd = r.read(), r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        body, st, hd = (e.read() if e.fp else b""), e.code, dict(e.headers or {})
    except Exception as e:  # noqa: BLE001
        body, st, hd = repr(e)[:200].encode(), 0, {}
    t1 = time.time()
    write("polls.jsonl", {"src": src, "url": url[:160], "t0": round(t0, 3), "t1": round(t1, 3), "status": st,
                          "bytes": len(body)})
    return st, hd, body, t0, t1


def lm(hd):
    v = hd.get("Last-Modified") or hd.get("last-modified")
    try:
        return parsedate_to_datetime(v).timestamp() if v else None
    except (TypeError, ValueError):
        return None


class Cond:
    """Conditional GET state per URL, and the last successful poll (the 'prev' of a new sighting)."""

    def __init__(self):
        self.etag, self.lm, self.last_ok, self.seen = {}, {}, {}, set()

    def get(self, src, url):
        h = {}
        if self.etag.get(url):
            h["If-None-Match"] = self.etag[url]
        elif self.lm.get(url):
            h["If-Modified-Since"] = self.lm[url]
        st, hd, body, t0, t1 = fetch(src, url, h)
        if st == 200:
            self.etag[url] = hd.get("ETag") or hd.get("etag")
            self.lm[url] = hd.get("Last-Modified") or hd.get("last-modified")
        return st, hd, body, t0, t1

    def saw(self, src, key, obj, t1, url):
        if (src, key) in self.seen:
            return
        self.seen.add((src, key))
        obj.update({"src": src, "key": key, "seen": round(t1, 3), "prev": self.last_ok.get(url),
                    "initial": url not in self.last_ok})
        write("obs.jsonl", obj)


S = Cond()
HKO_MAX = "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_since_midnight_maxmin.csv"
HKO_1M = "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_temperature.csv"
SWOB = "https://dd.weather.gc.ca/today/observations/swob-ml/latest/CYYZ-MAN-swob.xml"
SWOB_T = re.compile(r'name="date_tm"[^>]*value="([^"]+)"')
SWOB_AIR = re.compile(r'name="air_temp"[^>]*value="([^"]+)"')


def hko(src, url):
    st, hd, body, t0, t1 = S.get(src, url)
    if st == 200:
        for row in csv.reader(io.StringIO(body.decode("utf-8", "replace"))):
            if len(row) >= 3 and row[1].strip() == "HK Observatory":
                slot = row[0].strip()
                ts_ = datetime.strptime(slot, "%Y%m%d%H%M").replace(tzinfo=HKT).timestamp()
                S.saw(src, slot, {"data_ts": ts_, "values": [x.strip() for x in row[2:]], "lm": lm(hd)}, t1, url)
    if st in (200, 304):
        S.last_ok[url] = round(t1, 3)


def swob():
    st, hd, body, t0, t1 = S.get("msc_swob", SWOB)
    if st == 200:
        t = body.decode("utf-8", "replace")
        m, a = SWOB_T.search(t), SWOB_AIR.search(t)
        if m:
            ts_ = datetime.fromisoformat(m.group(1).replace("Z", "+00:00")).timestamp()
            S.saw("msc_swob", m.group(1), {"st": "CYYZ", "data_ts": ts_, "air_temp": a.group(1) if a else None,
                                           "lm": lm(hd)}, t1, SWOB)
    if st in (200, 304):
        S.last_ok[SWOB] = round(t1, 3)


def metar_ts(raw, now):
    m = METAR_T.search(raw)
    if not m:
        return None
    base = datetime.fromtimestamp(now, timezone.utc)
    d, hh, mm = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return datetime(base.year, base.month, d, hh, mm, tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def tgftp(icao):
    url = f"https://tgftp.nws.noaa.gov/data/observations/metar/stations/{icao}.TXT"
    st, hd, body, t0, t1 = S.get("tgftp", url)
    if st == 200:
        lines = [x.strip() for x in body.decode("utf-8", "replace").splitlines() if x.strip()]
        if len(lines) >= 2:
            S.saw("tgftp", icao + "|" + lines[1][:40], {"st": icao, "data_ts": metar_ts(lines[1], t1), "raw": lines[1],
                                                      "lm": lm(hd)}, t1, url)
    if st in (200, 304):
        S.last_ok[url] = round(t1, 3)


def awc():
    url = "https://aviationweather.gov/api/data/metar?ids=CYYZ,VHHH&format=json&hours=2"
    st, hd, body, t0, t1 = fetch("awc", url)
    if st == 200:
        for x in json.loads(body or b"[]"):
            raw = x.get("rawOb") or ""
            S.saw("awc", (x.get("icaoId") or "") + "|" + raw[:40],
                  {"st": x.get("icaoId"), "data_ts": x.get("obsTime"), "raw": raw,
                   "receipt": x.get("receiptTime"), "temp": x.get("temp")}, t1, url)
        S.last_ok[url] = round(t1, 3)


def clock():
    for _ in range(3):
        st, hd, body, t0, t1 = fetch("clock", "https://data-api.binance.vision/api/v3/time")
        if st == 200:
            srv = json.loads(body)["serverTime"] / 1000.0
            write("clock.jsonl", {"t0": round(t0, 3), "t1": round(t1, 3), "server": srv,
                                  "offset_s": round(srv - (t0 + t1) / 2, 3), "rtt_s": round(t1 - t0, 3)})
        time.sleep(1)


def every(interval, fn, *a):
    nxt = time.time()
    while time.time() < END:
        try:
            fn(*a)
        except Exception as e:  # noqa: BLE001
            write("errors.jsonl", {"t": time.time(), "fn": fn.__name__, "err": repr(e)[:300]})
        nxt += interval
        time.sleep(max(0.0, nxt - time.time()))


def main():
    os.makedirs(OUT, exist_ok=True)
    write("run.jsonl", {"start": time.time(), "end": END, "ua": UA})
    jobs = [(5, hko, "hko_max", HKO_MAX), (5, hko, "hko_1min", HKO_1M), (5, swob), (5, tgftp, "CYYZ"),
            (5, tgftp, "VHHH"), (15, awc), (600, clock)]
    th = []
    for j in jobs:
        t = threading.Thread(target=every, args=j, daemon=True)
        t.start()
        th.append(t)
        time.sleep(0.7)
    for t in th:
        t.join()
    write("run.jsonl", {"finished": time.time()})


if __name__ == "__main__":
    main()
