"""VIEWS data step 1: every closed event under Gamma's YouTube tag (146), raw, and each one's full record.

`GET /events?tag_id=146&closed=true&limit=100&offset=<k>` until a short page, then `GET /events/<id>` for each event
(the full record: the rules, the series, every market with its outcome prices, fee schedule and UMA status). Every
read carries `_=<ms>`. Raw JSON, gzipped, under $VIEWS_DATA/univ/.

usage: universe_pull.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402


def main():
    out = os.path.join(V.DATA, "univ")
    os.makedirs(out, exist_ok=True)
    events, off = [], 0
    while True:
        page = V.pmnet.get(V.GAMMA + "/events", {"tag_id": V.TAG, "closed": "true", "limit": 100, "offset": off,
                                                 "_": V.bust()}) or []
        events += page
        print("offset", off, "page", len(page), flush=True)
        if len(page) < 100:
            break
        off += 100
    V.dump(os.path.join(out, "events_list.json"), {"read_at": V.bust(), "events": events})
    ids = sorted({str(e.get("id")) for e in events}, key=int)
    print("events", len(events), "distinct", len(ids), flush=True)
    for i, eid in enumerate(ids):
        p = os.path.join(out, "ev", eid + ".json")
        if V.exists(p):
            continue
        d = V.pmnet.get(V.GAMMA + "/events/" + eid, {"_": V.bust()})
        V.dump(p, d)
        if i % 50 == 0:
            print("full", i, flush=True)
    print("done", len(ids))


if __name__ == "__main__":
    main()
