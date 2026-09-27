"""WXSRC: the manifest — sha256 and size of every committed file of the study, and of every raw pull kept out of git
(under $WXSRC_DATA; a folder of many files is summarised by a digest over its sorted (name, sha256) pairs), with the
URL pattern each pull came from, and the PMLATE raw pulls it read (by PMLATE's own manifest).

usage: build_manifest.py   (writes docs/agents/backtests/wxsrc/MANIFEST.json)
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
DATA = os.environ.get("WXSRC_DATA")

SOURCES = {
    "cities_open_<stamp>.json.gz": "GET https://gamma-api.polymarket.com/events?tag_id=103040&closed=false&limit=100&offset=<k>&_=<ms> (cities.py)",
    "hko/sincemidnight_<day>.json.gz (and the first three pulls, sincemidnight_<from>_<to>.json.gz)": "GET https://api.data.gov.hk/v1/historical-archive/list-file-versions?url=<the HKO since-midnight CSV>&start=<d>&end=<d>, then get-file?url=…&time=<stamp> (302 to the archive's S3 object) (hko_archive.py; hko_edge.py keeps each slot's first capture)",
    "hrrr/<YYYYmmddHH>.json.gz": "GET https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.<d>/conus/hrrr.t<HH>z.wrfsfcf<FF>.grib2.idx, then a Range GET of its TMP:2 m above ground message, decoded with ecCodes (hrrr_points.py)",
    "om/<model>/<station>/<run>.json.gz": "GET https://single-runs-api.open-meteo.com/v1/forecast?latitude=…&longitude=…&hourly=temperature_2m&models=<model>&run=<run>&forecast_hours=30&timezone=GMT (the first intraday_explore.py; abandoned when the host throttled, kept as pulled)",
    "live/": "poll_live.py's JSON lines: obs.jsonl, polls.jsonl, clock.jsonl, run.jsonl (HKO CSVs, MSC SWOB-ML CYYZ, tgftp CYYZ/VHHH, AWC CYYZ/VHHH, data-api.binance.vision's server time); hko_publish_probe.py's hko_probe.jsonl (the HKO since-midnight CSV every 2 s, cache-busted)",
}


def sha_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    out = {"study": "WXSRC (phase 1): the fastest source of the deciding observation per temperature city, and weather models",
           "committed": {}, "raw_pulls_not_committed": {}, "sources": SOURCES,
           "pmlate_raw_pulls_read": "PMLATE's September pulls (univ/events_2026-09-01_2026-09-27.json.gz, prints/ev_<event>.json.gz, "
                                    "obs/<ICAO>.json.gz), hashed in backtests/pmlate/MANIFEST.json; read, never changed"}
    for base, _, files in os.walk(ROOT):
        if "__pycache__" in base:
            continue
        for fn in sorted(files):
            p = os.path.join(base, fn)
            rel = os.path.relpath(p, ROOT)
            if rel == "MANIFEST.json":
                continue
            out["committed"][rel] = {"bytes": os.path.getsize(p), "sha256": sha_file(p)}
    if DATA and os.path.isdir(DATA):
        for entry in sorted(os.listdir(DATA)):
            p = os.path.join(DATA, entry)
            if os.path.isfile(p):
                out["raw_pulls_not_committed"][entry] = {"bytes": os.path.getsize(p), "sha256": sha_file(p)}
            else:
                pairs, size, n = [], 0, 0
                for b2, _, fs in os.walk(p):
                    for fn in sorted(fs):
                        q = os.path.join(b2, fn)
                        pairs.append((os.path.relpath(q, p), sha_file(q)))
                        size += os.path.getsize(q)
                        n += 1
                pairs.sort()
                out["raw_pulls_not_committed"][entry + "/"] = {
                    "files": n, "bytes": size,
                    "digest": hashlib.sha256("\n".join(f"{a} {b}" for a, b in pairs).encode()).hexdigest()}
    with open(os.path.join(ROOT, "MANIFEST.json"), "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print("committed", len(out["committed"]), "raw", len(out["raw_pulls_not_committed"]))


if __name__ == "__main__":
    sys.exit(main())
