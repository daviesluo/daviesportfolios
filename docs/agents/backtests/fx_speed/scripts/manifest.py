"""FX-SPEED's MANIFEST.json: the four Exness archives read (URL, sha256, size, ticks) and the derived file's sha256.
usage (from fx_speed/): EXN_DIR=<the four zips> python3 -I scripts/manifest.py
"""
import hashlib, json, os, zipfile

d = os.environ["EXN_DIR"]
m = {"study": "FX-SPEED, docs/agents/reviews/2026-10-29-fx-second-sources.md §7", "read": "2026-10-29 07:54 UTC, keyless GET, no login",
     "exness_zips": {}, "derived": {}}
for f in sorted(os.listdir(d)):
    if not f.endswith(".zip"):
        continue
    p = os.path.join(d, f)
    pair, y, mo = f[:-4].split("_")[1:]
    with zipfile.ZipFile(p) as z:
        with z.open(z.infolist()[0]) as fh:
            n = sum(1 for _ in fh) - 1
    m["exness_zips"][f] = {"url": f"https://ticks.ex2archive.com/ticks/{pair}/{y}/{mo}/{f}",
                           "sha256": hashlib.sha256(open(p, "rb").read()).hexdigest(), "bytes": os.path.getsize(p), "ticks": n,
                           "note": "the current month's file is rewritten nightly; this copy ends 2026-10-28 23:59:59" if mo == "10" else ""}
for f in ("data/exness_offsets.txt.gz",):
    m["derived"][f] = {"sha256": hashlib.sha256(open(f, "rb").read()).hexdigest(),
                       "by": "EXN_DIR=<zips> python3 -I scripts/exness.py build data/exness_offsets.txt.gz"}
json.dump(m, open("MANIFEST.json", "w"), indent=1)
print(json.dumps(m, indent=1))
