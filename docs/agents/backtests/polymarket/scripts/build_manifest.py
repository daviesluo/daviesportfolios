"""The sha256 and size of every committed fp4 file and every raw pull behind it (fp4).

Writes `MANIFEST.json` beside `scripts/`: the committed inputs, results and
scripts, and — because the raw pulls (several GB of Gamma months, books, prints)
are not committed — the hash and size of each raw file under $PM_DATA, so a re-run
can show it read the same bytes. `terms/` holds the Terms of Use, the page that frames
them and the geoblock list as read on 2026-09-24 (the study's §0 quotes them).

usage: build_manifest.py <backtests/polymarket dir>
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk(root, skip=()):
    out = {}
    for d, _, files in os.walk(root):
        for n in sorted(files):
            p = os.path.join(d, n)
            rel = os.path.relpath(p, root)
            if any(rel.startswith(s) for s in skip) or "__pycache__" in rel or rel == "MANIFEST.json":
                continue
            out[rel] = {"sha256": sha(p), "bytes": os.path.getsize(p)}
    return dict(sorted(out.items()))


def main():
    root = sys.argv[1]
    man = {"committed": walk(root)}
    raw = {}
    for sub in ("closed", "fav", "wx", "rw", "resolutions", "m3", "m3b", "terms"):
        p = os.path.join(pmnet.DATA, sub)
        if not os.path.isdir(p):
            continue
        files = walk(p)
        # the per-minute books and per-market prints are many: keep a digest of the folder, and the count
        if len(files) > 200:
            h = hashlib.sha256()
            for k, v in files.items():
                h.update((k + v["sha256"]).encode())
            raw[sub] = {"files": len(files), "bytes": sum(v["bytes"] for v in files.values()), "digest_of_sorted_file_hashes": h.hexdigest()}
        else:
            raw[sub] = files
    snaps = [d for d in os.listdir(pmnet.DATA) if d.startswith("snap_")]
    for s in sorted(snaps):
        raw[s] = walk(os.path.join(pmnet.DATA, s))
    man["raw_not_committed"] = raw
    with open(os.path.join(root, "MANIFEST.json"), "w") as f:
        json.dump(man, f, indent=1, sort_keys=True)
    print("committed", len(man["committed"]), "raw groups", len(raw))


if __name__ == "__main__":
    main()
