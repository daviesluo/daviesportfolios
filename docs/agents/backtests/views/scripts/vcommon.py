"""VIEWS' shared helpers: the view-count markets under Gamma's YouTube tag, their rules, brackets and deadlines.

Public reads only: no key, no signed call, no order, and no read of YouTube itself (its terms forbid automated access
outside the API, and the project's key is not used by a study). The HTTP helper and the print walk are PMLATE's
(`../../pmlate/scripts/common.py`, which uses fp4's `pmnet.py`), imported unchanged because committed results pin
their hashes. VIEWS_DATA names the folder raw pulls go to (not committed; hashed in the pull manifest).

Every data-API and Gamma read carries `_=<the read's own millisecond>`: both are cached by CloudFront for five
minutes (reference §4 item 36), so a read is never a copy of an earlier read of the same URL.
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "pmlate", "scripts"))
import common as P  # noqa: E402  PMLATE's helpers (pmnet, ts, iso, the gzip dump)

pmnet = P.pmnet
pmnet.UA = "views-research/1.0 (public data only)"
DATA = os.environ.get("VIEWS_DATA", os.path.abspath("views_data"))
GAMMA = P.GAMMA
DATA_API = P.DATA_API
CLOB = P.CLOB
TAG = "146"
ts = P.ts
iso = P.iso


def bust():
    return str(int(time.time() * 1000))


def load(path):
    return pmnet.load(path)


def dump(path, obj):
    pmnet.dump(path, obj)


def exists(path):
    return pmnet.exists(path)


# ------------------------------------------------------------------------------------------------ the rules

WINDOW = re.compile(r"\bfirst\s+(\d+)\s+(hours?|days?|weeks?)\b", re.I)
HANDLE = re.compile(r"youtube\.com/(@[A-Za-z0-9_.-]+)", re.I)
VIDEO = re.compile(r"(?:youtube\.com/(?:watch\?(?:[^\s)\"'<>]*&)?v=|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})", re.I)
DAYN = re.compile(r"\bday[\s-]*(\d)\b", re.I)


def window_hours(text):
    """The hours a market counts after posting, from its rules ("in the first 24 hours", "first 7 days"), else None.
    The same reading as the recorder's `windowHoursOf` (agents/views.ts)."""
    m = WINDOW.search(text or "")
    if not m:
        return None
    n, u = int(m.group(1)), m.group(2).lower()
    return n if u.startswith("hour") else n * 24 if u.startswith("day") else n * 168


def handle_of(text):
    m = HANDLE.search(text or "")
    return m.group(1).rstrip(".") if m else None


def videos_of(text):
    """Every distinct 11-character video id a text links, in order."""
    out = []
    for m in VIDEO.finditer(text or ""):
        if m.group(1) not in out:
            out.append(m.group(1))
    return out


MULT = {"k": 1e3, "m": 1e6, "b": 1e9, "": 1.0}
NUM = r"(\d+(?:[.,]\d+)?)\s*([kmb]?)"


def _n(x, suf):
    return float(x.replace(",", "")) * MULT[(suf or "").lower()]


def bracket(title, question=""):
    """A view bracket [lo, hi) in views from a market's group title or question: "70-80M" → [70e6, 80e6),
    "<50M" / "less than 50M" / "under 50M" → [None, 50e6), "100M+" / "100M or more" / "more than 100M" → [100e6, None).
    None when neither says. Brackets on these markets are half-open ("between 70M and 80M" means 70,000,000 ≤ v <
    80,000,000 unless the rules say otherwise; `rules_edges` records what each event's rules say)."""
    texts = [title or "", question or ""]
    # a title with no unit ("49–50" beside "48M–49M") says nothing about its scale: read the question first
    if title and question and not re.search(r"\d\s*(?:[kmb]\b|million|billion|thousand)", title, re.I):
        texts = [question, title]
    for t in texts:
        s = t.replace("–", "-").replace("—", "-").strip()
        s = re.sub(r"\s*\bmillion\b", "m", s, flags=re.I)
        s = re.sub(r"\s*\bbillion\b", "b", s, flags=re.I)
        s = re.sub(r"\s*\bthousand\b", "k", s, flags=re.I)
        m = re.search(r"(?:<|less than|fewer than|under|below)\s*" + NUM, s, re.I)
        if m:
            return [None, _n(m.group(1), m.group(2) or _suffix(s))]
        m = re.search(NUM + r"\s*(?:\+|or more|or higher|or above)", s, re.I) or \
            re.search(r"(?:>|≥|more than|over|above|at least)\s*" + NUM, s, re.I)
        if m:
            return [_n(m.group(1), m.group(2) or _suffix(s)), None]
        m = re.search(NUM + r"\s*(?:-|to|and)\s*" + NUM, s, re.I)
        if m:
            s2 = m.group(4) or _suffix(s)
            s1 = m.group(2) or s2
            return [_n(m.group(1), s1), _n(m.group(3), s2)]
    return None


def _suffix(s):
    m = re.search(r"\d\s*([kmb])\b", s, re.I)
    return m.group(1) if m else ""


def utc(t):
    return datetime.fromtimestamp(t, timezone.utc)


# ------------------------------------------------------------------------------------------------ committed inputs

INPUTS = os.path.normpath(os.path.join(HERE, "..", "inputs"))
_CACHE = {}


def _input(name):
    if name not in _CACHE:
        import gzip
        with gzip.open(os.path.join(INPUTS, name), "rt") as f:
            _CACHE[name] = json.load(f)["events"]
    return _CACHE[name]


def prints(eid):
    """An exploration event's prints from the committed input, oldest first: [ts, condition id, taker side
    ('BUY'/'SELL'), outcome index (0 YES, 1 NO), price, size]."""
    e = _input("exploration_prints.json.gz").get(str(eid))
    if e is None:
        return []
    c = e["conds"]
    return [[r[0], c[r[1]], "BUY" if r[2] == 0 else "SELL", r[3], r[4], r[5]] for r in e["rows"]]


def mids(eid):
    """An exploration event's minute midpoints by YES token from the committed input ({token: [[t, p], …]})."""
    e = _input("exploration_mids.json.gz").get(str(eid))
    return e["history"] if e else {}


def jfile(path):
    """A JSON file, plain or gzipped (the committed universe is `universe.json.gz`)."""
    import gzip
    if path.endswith(".gz"):
        with gzip.open(path, "rt") as f:
            return json.load(f)
    with open(path) as f:
        return json.load(f)


def jload(s, default):
    try:
        return json.loads(s) if isinstance(s, str) else (s if s is not None else default)
    except (ValueError, TypeError):
        return default
