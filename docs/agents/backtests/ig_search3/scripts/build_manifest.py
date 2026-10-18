"""Rewrite MANIFEST.json: the sha256 of every file under ig_search3/ but the manifest itself.

Run from anywhere: python3 docs/agents/backtests/ig_search3/scripts/build_manifest.py
"""
import hashlib
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOTE = ("2026-10-18: the IG strategy search, round 3. Small derived inputs are committed; raw pulls too large to commit are "
        "pinned by their sha256 in inputs/pull_log_*.json and re-fetched by scripts/pull.py.")


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
