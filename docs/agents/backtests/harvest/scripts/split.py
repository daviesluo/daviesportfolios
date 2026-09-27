"""HARVEST: the categories, and the split between the months exploration reads and the months held out, decided from
Gamma's records alone before any price or print was read.

Categories (an event is in the first that takes it):

* `counts`   — post-count events (tag 972) whose rules give a counting window and whose account the public tracker
               (xtracker.polymarket.com) follows.
* `quakes`   — earthquake-count events (tags 103038, 100184) counted from USGS: weekly "How many X or above
               earthquakes <window>", "by <date>" counts and megaquake markets.
* `mentions` — "what will X say" events (tag 100343, not a post count).
* `econ`     — one scheduled release decides the event: the Fed's decision and its dissents, BLS's CPI, egg price,
               payrolls and unemployment, BEA's GDP, DOL's claims, and the ECB's, the Bank of England's and the Bank of
               Canada's decisions (series listed in RELEASE).
* temperature is PMLATE's committed input (split by target date in `temperature.py`), not a Gamma pull here.

The split: an event is **exploration** when every market of it closed in [2026-03-01, 2026-06-01) UTC and **held
out** when every market closed in [2026-06-01, 2026-09-25); an event straddling a boundary, or with a market still open
or closed on or after 2026-09-25 00:00 UTC, is in neither. No price, print or book of a held-out event is requested by
any script here; their Gamma records (outcomes, volumes, fees, UMA status) are read for the power check and disclosed.

usage: split.py <econ universe> <other universe> <out json>
"""
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402

EX0 = datetime(2026, 3, 1, tzinfo=timezone.utc).timestamp()
HO0 = datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp()
CUT = H.CUT
RELEASE = {
    "fomc", "dissent-at-fed-meeting", "us-annual-inflation", "us-monthly-inflation", "egg-prices-monthly",
    "jobs-added", "unemployment", "gdp-quarterly", "weekly-jobless-claims", "ecb-interest-rates",
    "bank-of-england-decision", "bank-of-canada-decision",
}
TRACKED = {"trump-truth-social", "elon-tweets", "elon-tweets-48h", "elon-tweet-daily", "whitehouse-daily-tweets",
           "khamenei-daily-tweets", "ted-cruz-daily-tweets", "zelenskyy-tweets", "nycmayor-tweets", "cz-tweets",
           "andrew-tate-tweets"}
QUAKE = re.compile(r"earthquake|megaquake", re.I)


def category(e):
    t = set(e["tags"])
    ser = (e["series"] or [None])[0]
    if "972" in t:
        return "counts" if ser in TRACKED else None
    if ("103038" in t or "100184" in t) and QUAKE.search(e["title"] or ""):
        return "quakes"
    if "100343" in t:
        return "mentions"
    if ser in RELEASE:
        return "econ"
    return None


def main():
    events = {}
    for f in sys.argv[1:3]:
        for eid, e in H.jfile(f)["events"].items():
            events.setdefault(eid, e)
    out = {"rule": "exploration: every market closed in [2026-03-01, 2026-06-01) UTC; held out: every market closed in "
                   "[2026-06-01, 2026-09-25); straddling or open or closed on/after the cut: neither",
           "categories": {}}
    for eid in sorted(events, key=int):
        e = events[eid]
        cat = category(e)
        if not cat:
            continue
        closes = [m["closed_time"] for m in e["markets"]]
        c = out["categories"].setdefault(cat, {"exploration": [], "held_out": [], "neither": 0,
                                                "volume": {"exploration": 0.0, "held_out": 0.0}})
        if not closes or any(x is None for x in closes) or max(closes) >= CUT:
            c["neither"] += 1
            continue
        lo, hi = min(closes), max(closes)
        if lo >= EX0 and hi < HO0:
            c["exploration"].append(eid)
            c["volume"]["exploration"] += e["volume"]
        elif lo >= HO0 and hi < CUT:
            c["held_out"].append(eid)
            c["volume"]["held_out"] += e["volume"]
        else:
            c["neither"] += 1
    for c in out["categories"].values():
        c["volume"] = {k: round(v, 2) for k, v in c["volume"].items()}
        c["counts"] = {"exploration": len(c["exploration"]), "held_out": len(c["held_out"])}
    H.write_json(sys.argv[3], out)
    for k, c in sorted(out["categories"].items()):
        print(k, c["counts"], c["volume"], "neither", c["neither"])


if __name__ == "__main__":
    main()
