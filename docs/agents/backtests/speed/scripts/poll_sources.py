"""SPEED step 2: how soon after a station's observation time each KEYLESS public source shows it.

Polls, politely and in parallel, every source below for a fixed set of stations and records, for every observation a
source shows, the instant this machine first saw it (`seen`) and the previous poll of that source that did not show it
(`prev`): the observation appeared between the two. Some sources also say when they themselves received or wrote the
report (AWC's `receiptTime`; tgftp's `Last-Modified`), which is kept as `meta`. Nothing is keyed, nothing is signed,
no key embedded in any page is used, and every request carries a User-Agent naming this project.

Sources (interval; requests per minute):
* awc_api    aviationweather.gov /api/data/metar, all stations in one request, hours=2      (10 s; 6/min; limit 100/min)
* awc_cache  aviationweather.gov /data/cache/metars.cache.csv.gz, conditional GET         (15 s; 4/min; "once a minute")
* iem_cur    IEM /api/1/currents.json, all stations in one request                        (15 s; 4/min)
* iem_mtr    IEM AFOS text products MTR<id> (MADIS 5-minute "HF" METARs), 6 US stations    (60 s; 6/min)
* nws_latest api.weather.gov /stations/<id>/observations/latest, the 12 market stations    (15 s; 48/min)
* nws_list   api.weather.gov /stations/<id>/observations?limit=5, 20 US stations           (60 s; 20/min)
* tgftp_st   tgftp.nws.noaa.gov metar/stations/<ICAO>.TXT, conditional GET, 30 stations   (30 s; 60/min, mostly 304)
* tgftp_cyc  tgftp.nws.noaa.gov metar/cycles/<HH>Z.TXT, the current and previous cycle, byte ranges (10 s; 12/min)
* vatsim     metar.vatsim.net/<ICAO>, 14 stations                                          (30 s; 28/min)
* nws_xml    forecast.weather.gov/xml/current_obs/<ICAO>.xml, the 12 market stations      (60 s; 12/min)
* fmi        opendata.fmi.fi WFS, Helsinki-Vantaa (EFHK, fmisid 100968), 1-minute t2m      (30 s; 2/min)
* dwd_poi    opendata.dwd.de weather_reports/poi/10870-BEOB.csv, Munich airport (EDDM)    (60 s; 1/min)
* jma        www.jma.go.jp bosai/amedas latest_time.txt (AMeDAS, incl. Haneda 44166)      (30 s; 2/min)
* nea_sg     api.data.gov.sg v1 air-temperature (Singapore, 1-minute)                     (30 s; 2/min)
* msc_swob   dd.weather.gc.ca swob-ml latest CYYZ-MAN-swob.xml, conditional GET (Toronto)  (30 s; 2/min)
* clock      data-api.binance.vision /api/v3/time, three samples every ten minutes (this machine's clock offset)

Writes JSON lines under <out dir>: `obs.jsonl` (one line per first sighting), `polls.jsonl` (one per request: source,
start, end, status, bytes) and `clock.jsonl`. Observations a source already showed at its first poll are marked
`initial` and are not a latency sample.

usage: poll_sources.py <out dir> <minutes>
"""
import csv
import gzip
import hashlib
import io
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

UA = "daviesportfolios-speed-study/1.0 (research; public data only)"
US_MARKET = ["KATL", "KAUS", "KBKF", "KDAL", "KDEN", "KHOU", "KLAX", "KLGA", "KMIA", "KORD", "KSEA", "KSFO"]
US_EXTRA = ["KJFK", "KNYC", "KMDW", "KIAH", "KDFW", "KPHX", "KBOS", "KDCA"]
NON_US = ["EGLC", "EHAM", "EDDM", "EFHK", "LFPB", "CYYZ", "RJTT", "RKSI", "WSSS", "ZSPD"]
ALL = US_MARKET + US_EXTRA + NON_US
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
END = time.time() + 60 * float(sys.argv[2] if len(sys.argv) > 2 else 150)
LOCK = threading.Lock()
FILES = {}
METAR_T = re.compile(r"\b(\d{2})(\d{2})(\d{2})Z\b")


def write(name, obj):
    with LOCK:
        f = FILES.get(name)
        if f is None:
            f = FILES[name] = open(os.path.join(OUT, name), "a", buffering=1)
        f.write(json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n")


def fetch(src, url, headers=None, timeout=25):
    """(status, headers, body, t0, t1). Never raises; status 0 is a network error."""
    h = {"User-Agent": UA}
    h.update(headers or {})
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body, st, hd = r.read(), r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        body, st, hd = (e.read() if e.fp else b""), e.code, dict(e.headers or {})
    except Exception as e:  # noqa: BLE001
        body, st, hd = repr(e)[:200].encode(), 0, {}
    t1 = time.time()
    write("polls.jsonl", {"src": src, "url": url[:160], "t0": round(t0, 3), "t1": round(t1, 3), "status": st,
                          "bytes": len(body)})
    return st, hd, body, t0, t1


def metar_obs(raw, now):
    """A METAR's observation instant from its DDHHMMZ group, in the month that puts it closest before `now`."""
    m = METAR_T.search(raw)
    if not m:
        return None
    d, hh, mm = int(m.group(1)), int(m.group(2)), int(m.group(3))
    base = datetime.fromtimestamp(now, timezone.utc)
    best = None
    for dm in (0, -1):
        y, mo = base.year, base.month + dm
        if mo == 0:
            y, mo = y - 1, 12
        try:
            t = datetime(y, mo, d, hh, mm, tzinfo=timezone.utc).timestamp()
        except ValueError:
            continue
        if t <= now + 3600 and (best is None or abs(now - t) < abs(now - best)):
            best = t
    return best


class Source:
    """Tracks which observations a source has shown; logs each one the first time it appears."""

    def __init__(self, name):
        self.name = name
        self.seen = set()
        self.last_ok = {}   # scope (station or '*') -> t1 of the last successful poll
        self.first_done = set()

    def saw(self, scope, st, obs, key, t1, meta=None):
        k = (st, key)
        if k in self.seen:
            return
        self.seen.add(k)
        initial = scope not in self.first_done
        write("obs.jsonl", {"src": self.name, "st": st, "obs": obs, "key": key[:200], "seen": round(t1, 3),
                            "prev": self.last_ok.get(scope), "initial": initial, "meta": meta or {}})

    def done(self, scope, t1):
        self.last_ok[scope] = round(t1, 3)
        self.first_done.add(scope)


def every(interval, fn):
    nxt = time.time()
    while time.time() < END:
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            write("errors.jsonl", {"t": time.time(), "fn": fn.__name__, "err": repr(e)[:300]})
        nxt += interval
        time.sleep(max(0.0, nxt - time.time()))


def spread(interval, items, fn):
    """Call fn(item) for each item, spaced evenly over `interval`, forever until END."""
    gap = interval / max(1, len(items))
    nxt = time.time()
    while time.time() < END:
        for it in items:
            if time.time() >= END:
                return
            try:
                fn(it)
            except Exception as e:  # noqa: BLE001
                write("errors.jsonl", {"t": time.time(), "fn": fn.__name__, "item": it, "err": repr(e)[:300]})
            nxt += gap
            time.sleep(max(0.0, nxt - time.time()))


def lm(hd):
    v = hd.get("Last-Modified") or hd.get("last-modified")
    try:
        return parsedate_to_datetime(v).timestamp() if v else None
    except (TypeError, ValueError):
        return None


def iso_ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return None


# ------------------------------------------------------------------------------------------------ sources

S_AWC = Source("awc_api")


def awc_api():
    st, hd, body, t0, t1 = fetch("awc_api", "https://aviationweather.gov/api/data/metar?ids=" + ",".join(ALL)
                                 + "&format=json&hours=2")
    if st != 200:
        return
    for x in json.loads(body or b"[]"):
        raw = x.get("rawOb") or ""
        S_AWC.saw("*", x.get("icaoId"), x.get("obsTime"), raw, t1,
                  {"receipt": iso_ts(x.get("receiptTime") or ""), "type": x.get("metarType"), "temp": x.get("temp")})
    S_AWC.done("*", t1)


S_CACHE = Source("awc_cache")
_cache_state = {"lm": None, "etag": None}


def awc_cache():
    h = {}
    if _cache_state["etag"]:
        h["If-None-Match"] = _cache_state["etag"]
    st, hd, body, t0, t1 = fetch("awc_cache", "https://aviationweather.gov/data/cache/metars.cache.csv.gz", h)
    if st == 304:
        S_CACHE.done("*", t1)
        return
    if st != 200:
        return
    _cache_state["etag"] = hd.get("ETag") or hd.get("etag")
    text = gzip.decompress(body).decode("utf-8", "replace")
    want = set(ALL)
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 3 or row[1] not in want:
            continue
        S_CACHE.saw("*", row[1], iso_ts(row[2]), row[0], t1, {"file_lm": lm(hd)})
    S_CACHE.done("*", t1)


S_IEM = Source("iem_cur")
IEM_ID = {s: (s[1:] if s.startswith("K") else s) for s in ALL}
IEM_BACK = {v: k for k, v in IEM_ID.items()}


def iem_cur():
    q = "&".join("station=" + IEM_ID[s] for s in ALL)
    st, hd, body, t0, t1 = fetch("iem_cur", "https://mesonet.agron.iastate.edu/api/1/currents.json?" + q)
    if st != 200:
        return
    for row in json.loads(body).get("data") or []:
        if not str(row.get("network") or "").endswith("ASOS"):
            continue
        icao = IEM_BACK.get(row.get("station"))
        if not icao:
            continue
        S_IEM.saw("*", icao, iso_ts(row.get("utc_valid") or ""), (row.get("raw") or "") + "|" + str(row.get("utc_valid")),
                  t1, {"tmpf": row.get("tmpf"), "network": row.get("network")})
    S_IEM.done("*", t1)


S_MTR = Source("iem_mtr")


def iem_mtr(icao):
    st, hd, body, t0, t1 = fetch("iem_mtr", "https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py?pil=MTR"
                                 + icao[1:] + "&limit=4&fmt=text")
    if st != 200:
        return
    for line in body.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if not line.startswith(icao):
            continue
        S_MTR.saw(icao, icao, metar_obs(line, t1), line, t1, {"hf": "MADISHF" in line})
    S_MTR.done(icao, t1)


S_NWSL = Source("nws_latest")
S_NWSO = Source("nws_list")


def _nws_feature(src, icao, p, t1, hd):
    ts_ = iso_ts(p.get("timestamp") or "")
    raw = p.get("rawMessage") or ""
    tv = (p.get("temperature") or {}).get("value")
    src.saw(icao, icao, ts_, (p.get("timestamp") or "") + "|" + raw, t1,
            {"raw": bool(raw), "temp_c": tv, "lm": lm(hd), "cc": hd.get("Cache-Control")})


def nws_latest(icao):
    st, hd, body, t0, t1 = fetch("nws_latest", f"https://api.weather.gov/stations/{icao}/observations/latest",
                                 {"Accept": "application/geo+json"})
    if st != 200:
        return
    _nws_feature(S_NWSL, icao, json.loads(body).get("properties") or {}, t1, hd)
    S_NWSL.done(icao, t1)


def nws_list(icao):
    st, hd, body, t0, t1 = fetch("nws_list", f"https://api.weather.gov/stations/{icao}/observations?limit=5",
                                 {"Accept": "application/geo+json"})
    if st != 200:
        return
    for f in json.loads(body).get("features") or []:
        _nws_feature(S_NWSO, icao, f.get("properties") or {}, t1, hd)
    S_NWSO.done(icao, t1)


S_TGS = Source("tgftp_st")
_tgs_lm = {}


def tgftp_st(icao):
    h = {"If-Modified-Since": _tgs_lm[icao]} if icao in _tgs_lm else {}
    st, hd, body, t0, t1 = fetch("tgftp_st", f"https://tgftp.nws.noaa.gov/data/observations/metar/stations/{icao}.TXT", h)
    if st == 304:
        S_TGS.done(icao, t1)
        return
    if st != 200:
        return
    if hd.get("Last-Modified"):
        _tgs_lm[icao] = hd["Last-Modified"]
    lines = [x.strip() for x in body.decode("utf-8", "replace").splitlines() if x.strip()]
    if len(lines) >= 2:
        raw = lines[1]
        S_TGS.saw(icao, icao, metar_obs(raw, t1), raw, t1, {"lm": lm(hd)})
    S_TGS.done(icao, t1)


S_TGC = Source("tgftp_cyc")
_cyc = {}   # hour -> {"off": int, "tail": str, "lm": ...}


def tgftp_cyc():
    now = datetime.now(timezone.utc)
    cur = (now + timedelta(minutes=15)).hour
    want = set(ALL)
    for hh in (cur, (cur - 1) % 24):
        stt = _cyc.setdefault(hh, {"off": 0, "tail": "", "first": True})
        url = f"https://tgftp.nws.noaa.gov/data/observations/metar/cycles/{hh:02d}Z.TXT"
        h = {"Range": f"bytes={stt['off']}-"} if stt["off"] else {}
        st, hd, body, t0, t1 = fetch("tgftp_cyc", url, h)
        if st == 416:
            continue
        if st not in (200, 206):
            continue
        total = None
        cr = hd.get("Content-Range") or ""
        if "/" in cr:
            try:
                total = int(cr.split("/")[-1])
            except ValueError:
                total = None
        if st == 200 and stt["off"]:
            clen = len(body)
            if clen >= stt["off"]:
                body = body[stt["off"]:]
            else:   # the file was rewritten (a new day's cycle): start over
                stt.update(off=0, tail="")
        elif st == 206 and total is not None and total < stt["off"]:
            stt.update(off=0, tail="")
            continue
        stt["off"] += len(body)
        text = stt["tail"] + body.decode("utf-8", "replace")
        parts = text.split("\n")
        stt["tail"] = parts[-1]
        scope = f"cyc{hh}"
        for line in parts[:-1]:
            line = line.strip()
            tok = line.split(" ")
            if not tok:
                continue
            icao = tok[1] if tok[0] in ("METAR", "SPECI") and len(tok) > 1 else tok[0]
            if icao in want:
                S_TGC.saw(scope, icao, metar_obs(line, t1), line, t1, {"file_lm": lm(hd), "hh": hh})
        S_TGC.done(scope, t1)


S_VAT = Source("vatsim")


def vatsim(icao):
    st, hd, body, t0, t1 = fetch("vatsim", f"https://metar.vatsim.net/{icao}")
    if st != 200:
        return
    raw = body.decode("utf-8", "replace").strip()
    if raw.startswith(icao):
        S_VAT.saw(icao, icao, metar_obs(raw, t1), raw, t1)
    S_VAT.done(icao, t1)


S_XML = Source("nws_xml")
RFC = re.compile(r"<observation_time_rfc822>([^<]+)</observation_time_rfc822>")
TF = re.compile(r"<temp_f>([^<]+)</temp_f>")


def nws_xml(icao):
    st, hd, body, t0, t1 = fetch("nws_xml", f"https://forecast.weather.gov/xml/current_obs/{icao}.xml")
    if st != 200:
        return
    t = body.decode("latin-1", "replace")
    m = RFC.search(t)
    if m:
        try:
            ob = parsedate_to_datetime(m.group(1)).timestamp()
        except (TypeError, ValueError):
            ob = None
        tf = TF.search(t)
        S_XML.saw(icao, icao, ob, m.group(1), t1, {"temp_f": tf.group(1) if tf else None, "lm": lm(hd)})
    S_XML.done(icao, t1)


S_FMI = Source("fmi")
FMI_T = re.compile(r"<BsWfs:Time>([^<]+)</BsWfs:Time>\s*<BsWfs:ParameterName>t2m</BsWfs:ParameterName>\s*"
                   r"<BsWfs:ParameterValue>([^<]+)</BsWfs:ParameterValue>")


def fmi():
    start = (datetime.now(timezone.utc) - timedelta(minutes=20)).strftime("%Y-%m-%dT%H:%M:00Z")
    st, hd, body, t0, t1 = fetch("fmi", "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature"
                                 "&storedquery_id=fmi::observations::weather::simple&fmisid=100968&parameters=t2m"
                                 "&timestep=1&starttime=" + start)
    if st != 200:
        return
    for tm, v in FMI_T.findall(body.decode("utf-8", "replace")):
        if v.strip().lower() == "nan":
            continue
        S_FMI.saw("*", "EFHK", iso_ts(tm), tm, t1, {"t2m": v})
    S_FMI.done("*", t1)


S_DWD = Source("dwd_poi")
_dwd = {}


def dwd_poi():
    h = {"If-Modified-Since": _dwd["lm"]} if _dwd.get("lm") else {}
    st, hd, body, t0, t1 = fetch("dwd_poi", "https://opendata.dwd.de/weather/weather_reports/poi/10870-BEOB.csv", h)
    if st == 304:
        S_DWD.done("*", t1)
        return
    if st != 200:
        return
    _dwd["lm"] = hd.get("Last-Modified")
    for row in csv.reader(io.StringIO(body.decode("utf-8", "replace")), delimiter=";"):
        if len(row) > 2 and re.match(r"^\d\d\.\d\d\.\d\d$", row[0]) and re.match(r"^\d\d:\d\d$", row[1]):
            t = datetime.strptime(row[0] + " " + row[1], "%d.%m.%y %H:%M").replace(tzinfo=timezone.utc).timestamp()
            S_DWD.saw("*", "EDDM", t, row[0] + " " + row[1], t1, {"lm": lm(hd)})
    S_DWD.done("*", t1)


S_JMA = Source("jma")


def jma():
    st, hd, body, t0, t1 = fetch("jma", "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt")
    if st != 200:
        return
    s = body.decode("utf-8", "replace").strip()
    S_JMA.saw("*", "RJTT", iso_ts(s), s, t1, {"lm": lm(hd), "age": hd.get("Age")})
    S_JMA.done("*", t1)


S_NEA = Source("nea_sg")


def nea_sg():
    st, hd, body, t0, t1 = fetch("nea_sg", "https://api.data.gov.sg/v1/environment/air-temperature")
    if st != 200:
        return
    d = json.loads(body)
    for it in d.get("items") or []:
        S_NEA.saw("*", "WSSS", iso_ts(it.get("timestamp") or ""), it.get("timestamp") or "", t1)
    S_NEA.done("*", t1)


S_MSC = Source("msc_swob")
_msc = {}
MSC_T = re.compile(r'name="date_tm"[^>]*value="([^"]+)"')


def msc_swob():
    h = {"If-Modified-Since": _msc["lm"]} if _msc.get("lm") else {}
    st, hd, body, t0, t1 = fetch("msc_swob", "https://dd.weather.gc.ca/today/observations/swob-ml/latest/CYYZ-MAN-swob.xml", h)
    if st == 304:
        S_MSC.done("*", t1)
        return
    if st != 200:
        return
    _msc["lm"] = hd.get("Last-Modified")
    m = MSC_T.search(body.decode("utf-8", "replace"))
    if m:
        S_MSC.saw("*", "CYYZ", iso_ts(m.group(1)), m.group(1), t1, {"lm": lm(hd)})
    S_MSC.done("*", t1)


def clock():
    for _ in range(3):
        st, hd, body, t0, t1 = fetch("clock", "https://data-api.binance.vision/api/v3/time")
        if st == 200:
            srv = json.loads(body)["serverTime"] / 1000.0
            write("clock.jsonl", {"t0": round(t0, 3), "t1": round(t1, 3), "server": srv,
                                  "offset_s": round(srv - (t0 + t1) / 2, 3), "rtt_s": round(t1 - t0, 3)})
        time.sleep(1)


def main():
    os.makedirs(OUT, exist_ok=True)
    write("run.jsonl", {"start": time.time(), "end": END, "stations": {"us_market": US_MARKET, "us_extra": US_EXTRA,
                                                                        "non_us": NON_US}, "ua": UA})
    jobs = [
        lambda: every(10, awc_api), lambda: every(15, awc_cache), lambda: every(15, iem_cur),
        lambda: spread(60, ["KLGA", "KORD", "KAUS", "KMIA", "KSEA", "KDEN"], iem_mtr),
        lambda: spread(15, US_MARKET, nws_latest), lambda: spread(60, US_MARKET + US_EXTRA, nws_list),
        lambda: spread(30, ALL, tgftp_st), lambda: every(10, tgftp_cyc),
        lambda: spread(30, US_MARKET + ["EGLC", "RJTT"], vatsim), lambda: spread(60, US_MARKET, nws_xml),
        lambda: every(30, fmi), lambda: every(60, dwd_poi), lambda: every(30, jma), lambda: every(30, nea_sg),
        lambda: every(30, msc_swob), lambda: every(600, clock),
    ]
    th = [threading.Thread(target=j, daemon=True) for j in jobs]
    for t in th:
        t.start()
        time.sleep(0.3)
    for t in th:
        t.join()
    write("run.jsonl", {"finished": time.time()})


if __name__ == "__main__":
    main()
