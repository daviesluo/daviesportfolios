"""VIEWS: the public comments on the view events, for reading their resolution (resolution risk, question 3).

Polymarket files the comments of an event that belongs to a series under the SERIES (measured 2026-09-27: event
241960 answers none, its series 10061 answers them all). So this walks Gamma's keyless
`/comments?parent_entity_type=Series&parent_entity_id=<id>&limit=100&offset=<k>` (newest first, every page
cache-busted) for the series of the exploration events, and `parent_entity_type=Event` for exploration events outside a
series. A comment created at or after the split's boundary (2026-06-01) is dropped as it arrives, unread and unstored:
the held-out months stay unread. Writes $VIEWS_DATA/comments/series_<id>.json.gz and ev_<id>.json.gz.

usage: comments_pull.py <universe json> <split json>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

MAX_PAGES = 400


def walk(kind, pid, boundary):
    """Every comment, by `/comments/keyset` (the offset form refuses an offset past a few hundred)."""
    out, cursor, dropped = [], None, 0
    for _ in range(MAX_PAGES):
        params = {"parent_entity_type": kind, "parent_entity_id": pid, "limit": 100, "_": V.bust()}
        if cursor:
            params["after_cursor"] = cursor
        page = V.pmnet.get(V.GAMMA + "/comments/keyset", params) or {}
        d = page if isinstance(page, list) else (page.get("comments") or page.get("data") or [])
        cursor = None if isinstance(page, list) else (page.get("next_cursor") or page.get("nextCursor"))
        for c in d:
            t = V.ts(c.get("createdAt"))
            if t is None or t >= boundary:
                dropped += 1
                continue
            out.append({"id": c.get("id"), "t": t, "body": c.get("body"),
                        "user": ((c.get("profile") or {}).get("name") or (c.get("userAddress") or "")[-6:]),
                        "parent_comment": c.get("parentCommentID")})
        if not d or not cursor:
            break
    return out, dropped


def main():
    split = V.jfile(sys.argv[2])
    ex = set(split["exploration_events"])
    boundary = V.ts(split["boundary"])
    series, lone = set(), set()
    for eid in ex:
        raw = V.load(os.path.join(V.DATA, "univ", "ev", eid + ".json"))
        ss = [str(s.get("id")) for s in raw.get("series") or [] if s.get("id")]
        (series.update(ss) if ss else lone.add(eid))
    os.makedirs(os.path.join(V.DATA, "comments"), exist_ok=True)
    for sid in sorted(series, key=int):
        p = os.path.join(V.DATA, "comments", f"series_{sid}.json")
        if V.exists(p):
            continue
        c, dropped = walk("Series", sid, boundary)
        V.dump(p, {"series": sid, "comments": c, "dropped_at_or_after_boundary": dropped})
        print("series", sid, len(c), "kept", dropped, "dropped", flush=True)
    for eid in sorted(lone, key=int):
        p = os.path.join(V.DATA, "comments", f"ev_{eid}.json")
        if V.exists(p):
            continue
        c, dropped = walk("Event", eid, boundary)
        V.dump(p, {"event": eid, "comments": c, "dropped_at_or_after_boundary": dropped})
        print("event", eid, len(c), "kept", dropped, "dropped", flush=True)


if __name__ == "__main__":
    main()
