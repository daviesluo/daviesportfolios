"""HARVEST, post counts: the confirmation instant C and the confirmed outcome of every bucket of every exploration
post-count event, from Polymarket's public tracker (xtracker.polymarket.com, the rules' resolution source), not from
the market.

The window [t0, t1) is the rules' ("from <Month D> <h:mm AM/PM> ET to <Month D, YYYY> <h:mm AM/PM> ET", PMLATE's
`count_measure.window`). The tracker gives every post it captured with `createdAt` (posted) and `importedAt`
(captured: the instant the counter the rules name moved). The public count at instant t is n(t) = the posts created in
[t0, t1) and captured by t.

* A bucket [lo, hi] is **dead** at the first capture that makes n > hi, if that comes before t1: C = that capture,
  confirmed NO.
* An open-top bucket ("N or more") is **locked** at the first capture that makes n ≥ N, if before t1: C = that
  capture, confirmed YES.
* Every other bucket is decided at the window's end: C = t1 + S (S = 600 s, a settle for the tracker's capture lag,
  whose p90 is 287 s, PMLATE phase 1), confirmed YES for the bucket holding n(t1 + S) and NO for the rest.

Prints: every event is walked from its earliest C − 1 h, except Elon Musk's (weekly, 48-hour, daily; hundreds of
thousands of prints a week), which are walked whole one event in three (id % 3 == 0) and otherwise from t1 + S − 1 h:
there only the window-end units are `measured`. S is a
  choice; `trap_by_settle` gives, over the events whose record is complete and still open at t1 + S, how often the
  winner is not the bucket holding n(t1 + S), for S = 0, 60, 300, 600, 1800, 7200 s.

A trap is a bucket whose resolution differs from its confirmed outcome. The tracker's posts are read once, paged
(`hcommon.xt_posts`), cached per window. **The tracker's history is not the counter as it stood**: on some windows it
now holds fewer posts than the resolution needs (Trump's May 12 – 19: 100 posts, none after May 17 12:30, resolved
"200+"), and one week (May 19 – 26) was resolved on every series days before its window ended, without UMA. An event
whose tracker record at its close cannot reproduce its resolution is marked `record_ok: false`: its units cannot be
confirmed from history and are reported apart, never counted as traps or as harvest. The print floors are C − 1 h at
the earliest C of each event.

usage: counts_units.py <universe other> <split json> <out units json> <out floors json>
"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pmlate", "scripts"))
import count_common as K  # noqa: E402  (count_bucket only; its one-page xt_posts is not used)
from count_measure import HANDLE, window  # noqa: E402

SETTLE = 600
ELON = {"elon-tweets", "elon-tweets-48h", "elon-tweet-daily"}
ELON_SAMPLE = 3   # Elon's events are walked whole one in three (event id % 3 == 0); the rest from t1 + S - 1 h
SETTLES = [0, 60, 300, 600, 1800, 7200]


def in_bucket(b, n):
    return (b[0] is None or n >= b[0]) and (b[1] is None or n <= b[1])


def main():
    uni = H.jfile(sys.argv[1])["events"]
    split = H.jfile(sys.argv[2])
    units, floors, events_out = [], {}, {}
    skipped = Counter()
    trap_settle = {str(s): [0, 0] for s in SETTLES + ["close"]}
    for eid in sorted(split["categories"]["counts"]["exploration"], key=int):
        e = uni[eid]
        ser = e["series"][0]
        w = window(e["desc"], e["end"])
        if not w or ser not in HANDLE:
            skipped["no_window_or_handle"] += 1
            continue
        t0, t1 = w
        posts = H.xt_posts(HANDLE[ser], t0, t1, os.path.join(H.DATA, "xt"))
        posts = [p for p in posts if p[0] is not None and t0 <= p[0] < t1 and p[1] is not None]
        if not posts:
            skipped["no_tracker_posts"] += 1
            continue
        caps = sorted(p[1] for p in posts)

        def n_at(t):
            import bisect
            return bisect.bisect_right(caps, t)
        closed = max(m["closed_time"] for m in e["markets"])
        mk = []
        for m in e["markets"]:
            b = K.count_bucket(m["q"], m["title"])
            if b is None or H.winner_index(m) is None:
                continue
            mk.append((m, b))
        if not mk:
            skipped["no_buckets"] += 1
            continue
        n_end = n_at(t1 + SETTLE)
        win_r = [b for m, b in mk if H.winner_index(m) == 0]
        record_ok = bool(win_r) and in_bucket(win_r[0], n_at(closed))
        for s in SETTLES + ["close"]:
            if not record_ok or (s != "close" and t1 + s > closed):
                continue
            ns = n_at(closed if s == "close" else t1 + s)
            trap_settle[str(s)][0] += 1
            trap_settle[str(s)][1] += int(not in_bucket(win_r[0], ns))
        first_c = None
        for m, b in mk:
            lo, hi = b
            kind, c, wv = "end", t1 + SETTLE, (0 if in_bucket(b, n_end) else 1)
            if hi is not None and len(caps) > hi and caps[hi] < t1:
                kind, c, wv = "dead", caps[hi], 1
            elif hi is None and lo is not None and lo >= 1 and len(caps) >= lo and caps[lo - 1] < t1:
                kind, c, wv = "locked", caps[lo - 1], 0
            first_c = c if first_c is None else min(first_c, c)
            units.append({"cat": "counts", "event": eid, "cond": m["cond"], "title": m["title"], "q": m["q"][:120],
                          "C": c, "kind": kind, "w": wv, "r": H.winner_index(m), "closed": m["closed_time"],
                          "fees": m["fees"], "fee_rate": m["fee_rate"], "fee_exp": m["fee_exp"] or 1,
                          "rebate": m["rebate"], "tick": m["tick"], "series": ser, "bucket": b,
                          "record_ok": record_ok})
        full = ser not in ELON or int(eid) % ELON_SAMPLE == 0
        floors[eid] = int(first_c - 3600) if full else int(t1 + SETTLE - 3600)
        for u in units:
            if u["event"] == eid:
                u["measured"] = full or u["kind"] == "end"
        events_out[eid] = {"series": ser, "title": e["title"], "t0": t0, "t1": t1, "closed": closed,
                           "posts": len(posts), "n_t1": n_at(t1), "n_settle": n_end, "n_close": n_at(closed),
                           "winner": win_r[0] if win_r else None, "volume": e["volume"], "record_ok": record_ok}
    traps = [u for u in units if u["r"] is not None and u["w"] != u["r"] and u["record_ok"]]
    out = {"category": "counts", "settle_s": SETTLE, "events": events_out, "units": units, "skipped": dict(skipped),
           "trap_by_settle": {k: {"events": v[0], "winner_outside_count": v[1]} for k, v in trap_settle.items()}}
    H.write_json(sys.argv[3], out)
    H.write_json(sys.argv[4], {"floors": floors})
    print("events", len(events_out), "record_ok", sum(1 for x in events_out.values() if x["record_ok"]),
          "units", len(units), "traps (record ok)", len(traps), "skipped", dict(skipped))
    print("by kind", Counter(u["kind"] for u in units), "traps by kind", Counter(u["kind"] for u in traps))
    print("trap_by_settle", out["trap_by_settle"])


if __name__ == "__main__":
    main()
