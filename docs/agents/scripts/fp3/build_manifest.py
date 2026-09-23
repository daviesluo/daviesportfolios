"""sha256 and size of every file under research_fp3 (except the worktree and the manifest itself).
Writes MANIFEST.json {relative_path: {sha256, bytes}}."""
import hashlib, json, os
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
out = {}
for root, dirs, files in os.walk(S):
    dirs[:] = sorted(d for d in dirs if d not in ("wt", "__pycache__"))
    for f in sorted(files):
        p = os.path.join(root, f); rel = os.path.relpath(p, S)
        if rel == "MANIFEST.json": continue
        h = hashlib.sha256()
        with open(p, "rb") as fh:
            for b in iter(lambda: fh.read(1 << 20), b""): h.update(b)
        out[rel] = {"sha256": h.hexdigest(), "bytes": os.path.getsize(p)}
json.dump(out, open(os.path.join(S, "MANIFEST.json"), "w"), indent=0, sort_keys=True)
print(len(out), "files", sum(v["bytes"] for v in out.values()), "bytes")
