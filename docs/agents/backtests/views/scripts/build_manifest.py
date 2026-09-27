"""VIEWS: the pull manifest — every committed file of the study and every raw pull, with sha256 and size.

The raw pulls stay out of the repository (under $VIEWS_DATA); this records what they were and the public URLs they
came from, so a later session can tell a re-pull from the original. A folder of many pulls is recorded by its count,
bytes and one digest (sha256 over its sorted "name sha256" lines); the per-file list stays with the pulls
($VIEWS_DATA/RAW_FILES.json). Writes `MANIFEST.json` beside `scripts/`.

usage: build_manifest.py
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SOURCES = {
    "univ/events_list.json.gz": "GET https://gamma-api.polymarket.com/events?tag_id=146&closed=true&limit=100&offset=<k>&_=<ms> (universe_pull.py, 2026-09-27)",
    "univ/ev/<id>.json.gz": "GET https://gamma-api.polymarket.com/events/<id>?_=<ms> (universe_pull.py)",
    "prints/ev_<event>.json.gz": "GET https://data-api.polymarket.com/v2/trades?event_id=<event>&limit=1000&cursor=…&_=<ms>, exploration events only (prints_pull.py)",
    "hist/ev_<event>.json.gz": "GET https://clob.polymarket.com/prices-history?market=<YES token>&startTs=T-7h&endTs=T+3h&fidelity=1&_=<ms>, exploration events only (history_pull.py)",
    "comments/series_<id>.json.gz, comments/ev_<id>.json.gz": "GET https://gamma-api.polymarket.com/comments/keyset?parent_entity_type=Series|Event&parent_entity_id=<id>&limit=100&after_cursor=…&_=<ms>; comments created at or after 2026-06-01 dropped unread (comments_pull.py)",
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
    committed = walk(ROOT, skip=("MANIFEST.json",))
    raw_files = walk(V.DATA, skip=("RAW_FILES.json",)) if os.path.isdir(V.DATA) else {}
    man = {"study": "VIEWS phase 1: Polymarket's YouTube view-count markets (tag 146), 2026-09-27",
           "committed": committed, "raw_pulls_not_committed": fold(raw_files), "sources": SOURCES,
           "raw_total_bytes": sum(v["bytes"] for v in raw_files.values()), "raw_total_files": len(raw_files)}
    with open(os.path.join(ROOT, "MANIFEST.json"), "w") as f:
        json.dump(man, f, indent=1, sort_keys=True)
        f.write("\n")
    with open(os.path.join(V.DATA, "RAW_FILES.json"), "w") as f:
        json.dump(raw_files, f, indent=0, sort_keys=True)
    print("committed", len(committed), "raw", len(raw_files), "raw bytes", man["raw_total_bytes"])


if __name__ == "__main__":
    main()
