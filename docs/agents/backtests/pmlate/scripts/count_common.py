"""PMLATE, the count family: weekly post-count markets resolved on Polymarket's own tracker, and video-view markets.

Post counts. The rules name "the 'Post Counter' figure for posts found at https://xtracker.polymarket.com". The tracker
serves, keylessly: `/api/users` (every tracked account and its tracking windows, with their counts) and
`/api/users/<handle>/posts?startDate=&endDate=` (every post it captured, with `createdAt` — when it was posted — and
`importedAt` — when the tracker captured it, the instant the resolution source's counter moved). A bucket is a range
of counts [lo, hi] (None = open); the count only rises, so a bucket is dead once the running count passes hi, and an
"N or more" bucket is locked once the count reaches N.

Video views. The rules name the video's own YouTube view counter at seven days; YouTube keeps no public history of it,
so no running count can be rebuilt after the fact (see the study).
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

XT = "https://xtracker.polymarket.com/api"
C.pmnet.MIN_GAP.setdefault("xtracker.polymarket.com", 0.5)

RANGE = re.compile(r"(?P<a>\d[\d,]*)\s*(?:-|–|to)\s*(?P<b>\d[\d,]*)")
LESS = re.compile(r"(?:less than|fewer than|under)\s+(?P<a>\d[\d,]*)", re.I)
MORE = re.compile(r"(?P<a>\d[\d,]*)\s*(?:\+|or more|or higher)", re.I)


def count_bucket(question, group_title=None):
    """A count bucket [lo, hi] from a market's question or its group item title ("100-119", "<20", "200+")."""
    for text in (group_title or "", question or ""):
        t = text.replace(",", "")
        m = re.search(r"(?:post|tweet)\s+(\d+)\s*(?:-|–)\s*(\d+)", t, re.I) or RANGE.search(t)
        if m:
            return [int(m.group(1)), int(m.group(2))]
        m = LESS.search(t) or re.search(r"<\s*(\d+)", t)
        if m:
            return [None, int(m.group(1)) - 1]
        m = MORE.search(t) or re.search(r"(\d+)\s*\+", t)
        if m:
            return [int(m.group(1)), None]
    return None


def xt_users():
    return C.pmnet.get(XT + "/users", {"_": str(int(time.time() * 1000))})["data"]


def xt_posts(handle, start_iso, end_iso, cache_dir):
    """Every post the tracker captured for `handle` in [start, end], cached per window (a closed window does not
    change): [(created_ts, imported_ts, platform id)]."""
    path = os.path.join(cache_dir, f"xt_{handle}_{start_iso[:13]}_{end_iso[:13]}.json")
    if C.pmnet.exists(path):
        return C.pmnet.load(path)
    d = C.pmnet.get(XT + f"/users/{handle}/posts", {"startDate": start_iso, "endDate": end_iso})
    out = sorted((C.ts(p.get("createdAt")), C.ts(p.get("importedAt")), p.get("platformId")) for p in (d.get("data") or []))
    C.pmnet.dump(path, out)
    return out
