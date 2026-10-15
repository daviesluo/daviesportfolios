"""Rewrite MANIFEST.json: the sha256 of every file under ig_deepdive/ but the manifest itself.

Run from anywhere: python3 docs/agents/backtests/ig_deepdive/scripts/build_manifest.py
"""
import hashlib
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOTE = ("2026-10-14: historical measurements read committed sibling inputs under statarb_search2 and ig_research; "
        "no IG account or quote was read. 2026-10-15: the demo verification's frozen parameters (params/), the G0 "
        "source refresh (inputs/sources/), the G3 replication and the S1a scripts; IG demo data, once pulled, under "
        "inputs/ig/ and data/.")


def main():
    files = []
    for root, _, names in os.walk(HERE):
        for n in names:
            p = os.path.join(root, n)
            rel = os.path.relpath(p, HERE)
            if rel == "MANIFEST.json" or "__pycache__" in rel:
                continue
            with open(p, "rb") as fh:
                files.append({"path": rel, "sha256": hashlib.sha256(fh.read()).hexdigest()})
    files.sort(key=lambda f: f["path"])
    out = {"generated": "by scripts/build_manifest.py", "note": NOTE, "files": files}
    with open(os.path.join(HERE, "MANIFEST.json"), "w") as fh:
        json.dump(out, fh, indent=1)
        fh.write("\n")


if __name__ == "__main__":
    main()
