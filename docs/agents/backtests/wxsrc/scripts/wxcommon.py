"""WXSRC's shared helpers: where raw pulls go, the user agent, and PMLATE's market parser and station time zones.

Public reads only: no key, no signed call, no order, no account. The HTTP helper is fp4's `pmnet.py` and the market
parser, METAR reader and station time zones are PMLATE's (`../../pmlate/scripts/`), imported unchanged, because
committed results pin those files' hashes. WXSRC_DATA names the folder raw pulls go to (not committed; hashed in
`MANIFEST.json`).
"""
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "pmlate", "scripts"))
import common as C  # noqa: E402  (PMLATE's; it imports fp4's pmnet)

C.pmnet.UA = "wxsrc-research/1.0 (daviesportfolios; public data only)"
UA = C.pmnet.UA
DATA = os.environ.get("WXSRC_DATA", os.path.abspath("wxsrc_data"))
RESULTS = os.path.join(HERE, "..", "results")


def dump_gz(path, obj):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt") as f:
        json.dump(obj, f, sort_keys=True, separators=(",", ":"))
    os.replace(tmp, path)


def load_gz(path):
    with gzip.open(path, "rt") as f:
        return json.load(f)


def write_result(name, obj):
    """A committed result: sorted keys, indent 1, trailing newline (byte-stable across runs)."""
    p = os.path.join(RESULTS, name)
    with open(p, "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True, ensure_ascii=False)
        f.write("\n")
    return p


def q(xs, p):
    xs = sorted(x for x in xs if x is not None)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def pct(xs, ps=(0.1, 0.25, 0.5, 0.75, 0.9)):
    xs = [x for x in xs if x is not None]
    out = {"n": len(xs)}
    for p in ps:
        v = q(xs, p)
        out[f"p{int(p * 100)}"] = round(v, 1) if isinstance(v, float) else v
    return out
