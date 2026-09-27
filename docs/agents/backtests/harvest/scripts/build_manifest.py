"""HARVEST: the pull manifest — every committed file of the study with sha256 and size, and every raw pull (under
$HARVEST_DATA, not committed) folded by folder, with the public URLs they came from. Writes `MANIFEST.json`.

usage: build_manifest.py
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402

ROOT = H.ROOT
SOURCES = {
    "univ/<name>_<from>_<to>.json.gz (committed as inputs/universe_*.json.gz)":
        "GET https://gamma-api.polymarket.com/events?tag_id=<tag>&closed=true&end_date_min=&end_date_max=&limit=100&offset=<k>&_=<ms> (universe_pull.py, 2026-09-27)",
    "prints/ev_<event>.json.gz (compacted into inputs/<category>.json.gz)":
        "GET https://data-api.polymarket.com/v2/trades?event_id=<event>&limit=1000&cursor=…&_=<ms>, exploration events only, walked back to a floor (prints_pull.py)",
    "maker/<cond>_{all,t}.json.gz (compacted into inputs/maker_sample.json.gz)":
        "GET https://data-api.polymarket.com/v2/trades?condition=<cond>&taker_only={false,true}&limit=1000&cursor=…&_=<ms> (maker_pull.py)",
    "pub/alfred_<series>_<vintage>.json.gz (committed in inputs/sources/pub)":
        "GET https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=<series>&vintage_date=<release day> (econ_units.py)",
    "pub/fred_<series>_*.json.gz": "GET https://fred.stlouisfed.org/graph/fredgraph.csv?id=<DFEDTARU|ECBDFR>&cosd=&coed=",
    "pub/boc_V39079_*.json.gz": "GET https://www.bankofcanada.ca/valet/observations/V39079/json?start_date=&end_date=",
    "pub/boe_IUDBEDR_*.json.gz": "GET https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&SeriesCodes=IUDBEDR&…",
    "pub/fomc_<day>.json.gz": "GET https://www.federalreserve.gov/newsevents/pressreleases/monetary<yyyymmdd>a.htm",
    "xt/xt2_<handle>_<t0>_<t1>.json.gz (committed in inputs/sources/xt)":
        "GET https://xtracker.polymarket.com/api/users/<handle>/posts?startDate=&endDate=&_=<ms>, paged by moving startDate (hcommon.xt_posts); created, imported, platform id only",
    "usgs/list_*.json.gz, usgs/ev/<id>.json.gz (committed in inputs/sources/usgs)":
        "GET https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=&endtime=&minmagnitude=<thr-0.5> and ?eventid=<id>&includesuperseded=true (origin versions only kept)",
    "res/<cond>.json.gz (committed in inputs/sources/res)":
        "GET https://data-api.polymarket.com/v2/resolutions?condition=<cond>&_=<ms>, disputed mention markets only (mentions_units.py)",
}


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk(base, skip=()):
    out = {}
    for dirpath, _, files in os.walk(base):
        for n in sorted(files):
            p = os.path.join(dirpath, n)
            rel = os.path.relpath(p, base)
            if rel in skip or "__pycache__" in rel:
                continue
            out[rel] = {"sha256": sha(p), "bytes": os.path.getsize(p)}
    return dict(sorted(out.items()))


def fold(files, min_files=40):
    by_dir = {}
    for rel, v in files.items():
        by_dir.setdefault(os.path.dirname(rel), []).append((rel, v))
    out = {}
    for d, items in sorted(by_dir.items()):
        if len(items) >= min_files:
            lines = "".join(f"{os.path.basename(r)} {v['sha256']}\n" for r, v in sorted(items))
            out[(d or ".") + "/"] = {"files": len(items), "bytes": sum(v["bytes"] for _, v in items),
                                     "digest": hashlib.sha256(lines.encode()).hexdigest()}
        else:
            out.update({r: v for r, v in items})
    return dict(sorted(out.items()))


def main():
    committed = fold(walk(ROOT, skip=("MANIFEST.json",)))
    raw = walk(H.DATA, skip=("RAW_FILES.json",)) if os.path.isdir(H.DATA) else {}
    man = {"study": "HARVEST phase 1: after a public confirmation, what the other side of Polymarket's book paid "
                    "(2026-09-27)",
           "exploration": "every market closed in [2026-03-01, 2026-06-01) UTC; held out [2026-06-01, 2026-09-25), no "
                          "print read", "committed": committed, "raw_pulls_not_committed": fold(raw),
           "raw_total_bytes": sum(v["bytes"] for v in raw.values()), "raw_total_files": len(raw), "sources": SOURCES}
    with open(os.path.join(ROOT, "MANIFEST.json"), "w") as f:
        json.dump(man, f, indent=1, sort_keys=True)
        f.write("\n")
    if os.path.isdir(H.DATA):
        with open(os.path.join(H.DATA, "RAW_FILES.json"), "w") as f:
            json.dump(raw, f, indent=0, sort_keys=True)
    print("committed entries", len(committed), "raw files", len(raw), "raw bytes", man["raw_total_bytes"])


if __name__ == "__main__":
    main()
