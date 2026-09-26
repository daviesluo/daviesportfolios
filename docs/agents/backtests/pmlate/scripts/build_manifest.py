"""PMLATE: the pull manifest — every committed file of the study and every raw pull, with sha256 and size.

The raw pulls stay out of the repository (they live under $PMLATE_DATA); this file records what they were and the
public URLs they came from, so a later session can tell a re-pull from the original. Writes `MANIFEST.json` beside
`scripts/`.

usage: build_manifest.py
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SOURCES = {
    "univ/events_<from>_<to>.json.gz": "GET https://gamma-api.polymarket.com/events?tag_id=103040&end_date_min=<day>T00:00:00Z&end_date_max=<day+1>T00:00:00Z&limit=100&offset=<k> (universe.py)",
    "univ/events_wx.json.gz": "fp4's committed polymarket/inputs/wx_inputs.json.gz + GET https://gamma-api.polymarket.com/markets?closed=true&condition_ids=… (universe_wx.py)",
    "obs/<ICAO>.json.gz": "GET https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=<id>&data=metar&report_type=3|4&tz=Etc/UTC&format=onlycomma&… ; GET https://aviationweather.gov/api/data/metar?ids=<ICAO>&format=json&date=<end>&hours=72 (obs_pull.py, metar.py)",
    "prints/ev_<event>.json.gz": "GET https://data-api.polymarket.com/v2/trades?event_id=<event>&limit=1000&cursor=…&_=<ms> (prints_pull.py)",
    "prints/<condition>.json.gz": "GET https://data-api.polymarket.com/v2/trades?condition=<condition>&limit=1000&cursor=…&_=<ms> (common.prints_of)",
    "rw/events.json.gz": "GET https://gamma-api.polymarket.com/markets?condition_ids=… and /events/<id> (rw_events.py)",
    "count/universe_<from>_<to>.json.gz": "GET https://gamma-api.polymarket.com/events?tag_id=972|146&closed=true&end_date_min=…&end_date_max=…&limit=100&offset=<k> (count_universe.py)",
    "count/prints/ev_<event>.json.gz": "GET https://data-api.polymarket.com/v2/trades?event_id=<event>&limit=1000&cursor=…&_=<ms> (count_prints.py)",
    "count/xt/xt_<handle>_<start>_<end>.json.gz": "GET https://xtracker.polymarket.com/api/users/<handle>/posts?startDate=<iso>&endDate=<iso> (count_common.xt_posts)",
    "count/desc/ev_<event>.json.gz": "GET https://gamma-api.polymarket.com/events/<event> (count_measure.py)",
}


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk(base):
    out = {}
    for dirpath, _, files in os.walk(base):
        for n in sorted(files):
            p = os.path.join(dirpath, n)
            rel = os.path.relpath(p, base)
            if rel in ("MANIFEST.json", "RAW_FILES.json") or "__pycache__" in rel:
                continue
            out[rel] = {"sha256": sha(p), "bytes": os.path.getsize(p)}
    return dict(sorted(out.items()))


def fold(files, min_files=40):
    """A folder of many pulls is recorded by its count, its bytes and one digest: sha256 over its sorted
    'name sha256' lines (the per-file list stays with the pulls)."""
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
    committed = walk(ROOT)
    raw_files = walk(C.DATA) if os.path.isdir(C.DATA) else {}
    raw = fold(raw_files)
    man = {"study": "PMLATE (phase 1): the informed taker on Polymarket's same-day temperature and count markets",
           "committed": committed, "raw_pulls_not_committed": raw, "sources": SOURCES,
           "raw_total_bytes": sum(v["bytes"] for v in raw_files.values()), "raw_total_files": len(raw_files)}
    with open(os.path.join(ROOT, "MANIFEST.json"), "w") as f:
        json.dump(man, f, indent=1, sort_keys=True)
        f.write("\n")
    with open(os.path.join(C.DATA, "RAW_FILES.json"), "w") as f:
        json.dump(raw_files, f, indent=0, sort_keys=True)
    print("committed", len(committed), "raw", len(raw_files), "raw bytes", man["raw_total_bytes"])


if __name__ == "__main__":
    main()
