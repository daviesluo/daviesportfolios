"""SPEED: the manifest — every committed file's size and SHA-256, and the raw data that stays outside the repository
(the September copies of PMLATE's pulls, in the study's scratch folder) hashed file by file.

usage: build_manifest.py <speed folder> <scratch data folder> <out json>
"""
import hashlib
import json
import os
import sys


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    root, data, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    committed = {}
    for dp, _, files in os.walk(root):
        for n in sorted(files):
            p = os.path.join(dp, n)
            rel = os.path.relpath(p, root)
            if rel == os.path.relpath(outp, root) or "__pycache__" in rel:
                continue
            committed[rel] = {"bytes": os.path.getsize(p), "sha256": sha(p)}
    raw, total = {}, 0
    for dp, _, files in os.walk(data):
        for n in sorted(files):
            p = os.path.join(dp, n)
            rel = os.path.relpath(p, data)
            raw[rel] = sha(p)
            total += os.path.getsize(p)
    out = {"committed": dict(sorted(committed.items())),
           "raw_outside_repo": {"what": "copies of PMLATE's September pulls (events, prints, station reports) and its "
                                        "post-count pulls, read by edge_vs_latency.py and count_edge.py",
                                "files": len(raw), "bytes": total, "sha256": dict(sorted(raw.items()))}}
    with open(outp, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print("committed", len(committed), "raw", len(raw), total)


if __name__ == "__main__":
    main()
