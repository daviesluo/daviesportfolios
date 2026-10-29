"""MANIFEST.json of the fair-price study's folder: every file's sha256 and size, and for each production pull in inputs/prod/
the md5 the database computed over its text (the decompressed file less its final newline, as grab.py wrote it), so a re-pull
can be compared with what was read on 2026-10-29.
usage: python3 -I manifest.py
"""
import gzip, hashlib, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    files, pulls = {}, {}
    for d, _, fs in os.walk(ROOT):
        for f in sorted(fs):
            p = os.path.join(d, f)
            rel = os.path.relpath(p, ROOT).replace(os.sep, "/")
            if rel == "MANIFEST.json" or "__pycache__" in rel:
                continue
            b = open(p, "rb").read()
            files[rel] = {"sha256": hashlib.sha256(b).hexdigest(), "bytes": len(b)}
            if rel.startswith("inputs/prod/") and rel.endswith(".txt.gz"):
                t = gzip.decompress(b)
                if t.endswith(b"\n"):
                    t = t[:-1]
                pulls[os.path.basename(rel)[:-len(".txt.gz")]] = {"md5": hashlib.md5(t).hexdigest(), "lines": t.count(b"\n") + 1}
    json.dump({"files": dict(sorted(files.items())), "pulls": dict(sorted(pulls.items()))}, open(os.path.join(ROOT, "MANIFEST.json"), "w"), indent=1)
    print(len(files), "files;", len(pulls), "pulls")


if __name__ == "__main__":
    main()
