"""HARVEST, earthquake counts: the confirmation instant C and the confirmed outcome of every bucket of every
exploration earthquake event, from USGS's public catalog (ComCat, the rules' resolution source) as it stood at C, not
from the market.

The window is the rules': "between <Month D, YYYY>, 12:00 AM ET, and <Month D, YYYY>, 11:59 PM ET" (weekly counts) or
"between market creation and <date> ET" (the "by <date>" and megaquake markets); the threshold is the title's
("6.5 or above", "7.0 or above"; a megaquake is 8.0). Every event of the window with a magnitude within 0.5 of the
threshold today is read with its superseded products (`/fdsnws/event/1/query?eventid=<id>&includesuperseded=true`):
the catalog's magnitude at instant t is the latest version (updateTime ≤ t) of the origin product of the source with
the highest preferred weight among those published by t, and the count n(t) is the number of window events whose
magnitude at t is at least the threshold.

* A count bucket is **dead** at the first t before the window's end with n(t) above its top (confirmed NO); an open-top
  bucket (">k", or a "by <date>" market) is **locked** at the first t with n(t) ≥ its floor (confirmed YES).
* Every other bucket is decided at the window's end: C = t1 + S (S = 600 s), confirmed YES for the bucket holding
  n(t1 + S), NO for the rest. The rules keep the market open 24 h "to allow for revisions to the recorded magnitude",
  which is this category's trap: a magnitude revised across the threshold after C.

`reconstructed_close` compares n at each market's close with its result: where they differ, the reconstruction of
the catalog (or the resolution) disagrees, and the units of that event are flagged `record_ok: false`.

usage: quakes_units.py <universe other> <split json> <out units json> <out floors json>
"""
import bisect
import os
import re
import sys
from collections import Counter
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402

ET = ZoneInfo("America/New_York")
USGS = "https://earthquake.usgs.gov/fdsnws/event/1/query"
SETTLE = 600
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}
DAY = r"(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}),? (20\d\d)"


def et(mon, d, y, h=0, mi=0):
    return datetime(int(y), MONTHS[mon.lower()], int(d), h, mi, tzinfo=ET).timestamp()


def threshold(title):
    if "megaquake" in title.lower():
        return 8.0
    m = re.search(r"(\d\.\d) or above", title)
    return float(m.group(1)) if m else None


def windows(e):
    """[(market, t0, t1)] for every market of the event."""
    d = e["desc"] or ""
    m = re.search(r"between " + DAY + r",? 12:00 AM ET,? and " + DAY + r",? 11:59 PM ET", d)
    out = []
    for mk in e["markets"]:
        if m:
            g = m.groups()
            out.append((mk, et(*g[:3]), et(*g[3:]) + 86400))
            continue
        q = re.search(r"by " + DAY, mk["q"]) or re.search(r"and " + DAY, d)
        if q:
            g = q.groups()
            out.append((mk, mk["created"] or e["created"], et(*g) + 86400))
    return out


def catalog(t0, t1, thr):
    """ComCat's events in [t0, t1) within 0.5 of the threshold today, each with its superseded origin versions."""
    iso = lambda t: datetime.utcfromtimestamp(t).strftime("%Y-%m-%dT%H:%M:%S")  # noqa: E731
    path = os.path.join(H.DATA, "usgs", f"list_{int(t0)}_{int(t1)}_{thr}.json")
    if not H.exists(path):
        H.dump(path, H.pmnet.get(USGS, {"format": "geojson", "starttime": iso(t0), "endtime": iso(t1),
                                        "minmagnitude": round(thr - 0.5, 1), "orderby": "time-asc"}))
    out = []
    for f in H.load(path)["features"]:
        eid = f["id"]
        p = os.path.join(H.DATA, "usgs", "ev", eid + ".json")
        if not H.exists(p):
            d = H.pmnet.get(USGS, {"eventid": eid, "format": "geojson", "includesuperseded": "true"})
            vs = []
            for pr in (d.get("properties") or {}).get("products", {}).get("origin", []):
                mag = (pr.get("properties") or {}).get("magnitude")
                if mag not in (None, "") and pr.get("status") != "DELETE":
                    vs.append([pr["updateTime"] / 1000.0, float(mag), pr.get("source"), pr.get("preferredWeight") or 0])
            H.dump(p, {"id": eid, "time": f["properties"]["time"] / 1000.0, "mag_now": f["properties"]["mag"],
                       "versions": sorted(vs)})
        out.append(H.load(p))
    return out


def mag_at(ev, t):
    best = {}
    for ut, mag, src, w in ev["versions"]:
        if ut <= t:
            best[src] = (w, ut, mag)
    if not best:
        return None
    return max(best.values())[2]


def count_path(evs, thr):
    """The instants where n(t) may change, and n at each: [(t, n)], ascending."""
    times = sorted({v[0] for ev in evs for v in ev["versions"]})
    path, last = [], None
    for t in times:
        n = sum(1 for ev in evs if (mag_at(ev, t) or 0) >= thr - 1e-9)
        if n != last:
            path.append((t, n))
            last = n
    return path


def n_at(path, t):
    i = bisect.bisect_right([p[0] for p in path], t) - 1
    return path[i][1] if i >= 0 else 0


def bucket(title, q):
    s = (title or "").strip()
    if s.startswith("≤"):
        return [None, int(s[1:])]
    if s.startswith(">"):
        return [int(s[1:]) + 1, None]
    if s.isdigit():
        return [int(s), int(s)]
    return [1, None]  # a "by <date>" / megaquake market: one or more


def main():
    uni = H.jfile(sys.argv[1])["events"]
    split = H.jfile(sys.argv[2])
    units, floors, evout = [], {}, {}
    skipped = Counter()
    for eid in sorted(split["categories"]["quakes"]["exploration"], key=int):
        e = uni[eid]
        thr = threshold(e["title"])
        ws = windows(e)
        if thr is None or not ws:
            skipped["no_threshold_or_window"] += 1
            continue
        first_c, rec = None, []
        for m, t0, t1 in ws:
            r = H.winner_index(m)
            if r is None:
                skipped["not_one_winner"] += 1
                continue
            evs = [x for x in catalog(t0, t1, thr) if t0 <= x["time"] < t1]
            path = count_path(evs, thr)
            b = bucket(m["title"], m["q"])
            lo, hi = b
            kind, c, wv = "end", t1 + SETTLE, None
            n_end = n_at(path, t1 + SETTLE)
            wv = 0 if ((lo is None or n_end >= lo) and (hi is None or n_end <= hi)) else 1
            for t, n in path:
                if t >= t1:
                    break
                if hi is not None and n > hi:
                    kind, c, wv = "dead", t, 1
                    break
                if hi is None and lo is not None and n >= lo:
                    kind, c, wv = "locked", t, 0
                    break
            n_close = n_at(path, m["closed_time"])
            ok_close = ((lo is None or n_close >= lo) and (hi is None or n_close <= hi)) == (r == 0)
            rec.append(ok_close)
            first_c = c if first_c is None else min(first_c, c)
            units.append({"cat": "quakes", "event": eid, "cond": m["cond"], "title": m["title"], "q": m["q"][:120],
                          "C": c, "kind": kind, "w": wv, "r": r, "closed": m["closed_time"], "fees": m["fees"],
                          "fee_rate": m["fee_rate"], "fee_exp": m["fee_exp"] or 1, "rebate": m["rebate"],
                          "tick": m["tick"], "threshold": thr, "bucket": b, "n_end": n_end, "n_close": n_close,
                          "window": [t0, t1]})
        if first_c is None:
            continue
        ok = all(rec)
        for u in units:
            if u["event"] == eid:
                u["record_ok"] = ok
        floors[eid] = int(first_c - 3600)
        evout[eid] = {"title": e["title"], "threshold": thr, "record_ok": ok, "volume": e["volume"]}
    traps = [u for u in units if u["w"] != u["r"] and u["record_ok"]]
    H.write_json(sys.argv[3], {"category": "quakes", "settle_s": SETTLE, "events": evout, "units": units,
                               "skipped": dict(skipped)})
    H.write_json(sys.argv[4], {"floors": floors})
    print("events", len(evout), "record_ok", sum(1 for v in evout.values() if v["record_ok"]), "units", len(units),
          "traps (record ok)", len(traps), Counter(u["kind"] for u in units), dict(skipped))
    for eid, v in evout.items():
        if not v["record_ok"]:
            print("record not ok", eid, v["title"], [(u["title"], u["n_close"], u["r"]) for u in units
                                                     if u["event"] == eid][:8])


if __name__ == "__main__":
    main()
