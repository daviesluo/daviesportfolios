"""USLATE data step: the events `uslate_inputs.py` will read, as an events file `prints_pull.py` can walk.

The same files in the same order, the same filters (target date in [from, to), closed, kept once: the first file that
lists it), the same station split (US = ICAO beginning with K; no station and the Hong Kong Observatory left out), so
the print pull covers exactly the market-days the input is built from, and nothing earlier or later.

One more filter, the pre-registration's own word: its universe is every RESOLVED event. Gamma leaves an event's
`closed` flag set when it archives the event before its target date; its markets then stay `closed: false` with no
payout (four US events of 2026-05-22 and 05-23, archived on 05-18 and 05-19). `uslate_inputs.py` reads only the
event's flag, and `uslate_test.py` stops at `1.0 - None` on such a market's dead bucket, so an event any of whose
buckets has no payout is left out of the list (printed, by id): with no print file, the input script skips it and
counts it under `no_prints_file`.

usage: uslate_events.py <from> <to> <us|nonus|all> <out events json> <events file> [<events file> ...]
"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def main():
    d0, d1, which, outp = sys.argv[1:5]
    seen, keep, n = set(), {}, Counter()
    for f in sys.argv[5:]:
        ev = C.load_json(f)["events"]
        ev = list(ev.values()) if isinstance(ev, dict) else ev
        for e in sorted(ev, key=lambda x: (x["date"], x["event"])):
            if e["event"] in seen or not (d0 <= e["date"] < d1) or not e.get("closed", True):
                continue
            seen.add(e["event"])
            st = e.get("station")
            if not st or st == "HKO":
                n["no_metar_station"] += 1
                continue
            us = st.startswith("K")
            if (which == "us" and not us) or (which == "nonus" and us):
                continue
            if any(b.get("payout_yes") is None for b in e["buckets"]):
                n["unresolved"] += 1
                print("unresolved, left out:", e["event"], e["date"], e.get("city"), e.get("hl"), st)
                continue
            n[os.path.basename(f)] += 1
            keep[e["event"]] = {"event": e["event"], "date": e["date"], "station": st, "closed": True}
    C.dump_json(outp, {"events": keep})
    print(len(keep), dict(n))


if __name__ == "__main__":
    main()
