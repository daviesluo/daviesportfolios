"""VIEWS: each exploration event's posting instant P and deadline T = P + the window its rules count — ESTIMATED.

No YouTube read: the project's key is not used by a study, and YouTube's pages may not be read by a script. Every P
here is an estimate, and `p_source` says which kind:

* `noon` — MrBeast and MrBeast Gaming post at 12:00 ET (the recorder's reads: 12:00:01–12:00:04 ET on 2026-09-19 and
  09-26; the brief: 12:00:00–12:00:25 ET). The channel's posting instants come from its day-1 "next video" events: the
  12:00:10 ET, between the event's creation and the last instant its deadline could fall (the winning market's close
  − UMA's two-hour liveness − the window), after which the event's own prints jump the most (prints in the two hours
  after it minus the two hours before; at least 50 for a posting instant).
* `next` — any other event that counts the channel's NEXT video (week-1, a later day-1): P is the earliest of the
  channel's posting instants at or after the event's creation that leaves its deadline + 2 h before its winning
  market closed.
* `video` — an event created after its video went up (a named video's day-2…6, the week-1 twins): P is the latest of
  the channel's posting instants before the event's creation that fits the same way. The rules' own video id is not
  trusted for this: the day-3 and day-4 events of the 2026-03-21 video name the 03-07 video and resolved on the 03-21
  one. Where the rules' window and the title's differ, the window that fits is used and reported (`window_used`).
* `rules` — the rules state the posting time ("scheduled to release … on November 21 at 9:00 AM ET").
* `clock` — the rules count at a clock time ("at 12:00 PM ET on October 10, 2025"): T is that time, P is not needed.
* `burst` — any other channel: the first minute of the largest jump in the event's trading before its deadline could
  fall (the market reacts to the first counts a few minutes after posting, so P is later than the truth). LOW
  confidence; these events are listed, not used where minutes matter.
* `none` — nothing dates it.

`p_confidence` is `high` for a schedule-based P (or the rules' own time) whose deadline falls 2–12 h before the winning
market closed, `low` for everything else with a P; only `high` events enter the tables where minutes matter.

`close_minus_T_h` is the winning market's close − T in hours: under the two-hour liveness it cannot be below 2 unless
an early proposal went unchallenged, so a value under 2 marks an estimate to distrust.

usage: posting.py <universe json> <split json> <out json>
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

ET = ZoneInfo("America/New_York")
LIVENESS_S = 7200
NOON_CHANNELS = ("@MrBeast", "@MrBeastGaming")
MIN_JUMP = 50
SCHEDULED = re.compile(r"scheduled to release[^.]*?on (\w+ \d+)(?:, (\d{4}))? at (\d{1,2}):(\d{2}) ([AP]M) ET", re.I)
CLOCKED = re.compile(r"at (\d{1,2}):(\d{2}) ([AP]M) ET on (\w+ \d+), (\d{4})", re.I)


def noon(d):
    return datetime(d.year, d.month, d.day, 12, 0, 10, tzinfo=ET).timestamp()


def windows(e):
    """The windows the event could count: the rules' and, where it differs, the title's."""
    return sorted({w for w in (e.get("window_rules_h"), e.get("window_title_h"), e.get("window_h")) if w})


def close_win(e):
    """The winning market's close (the deadline + liveness bounds it); the latest close when no market won."""
    w = [m["closed_time"] for m in e["markets"] if m["payout_yes"] == 1.0 and m["closed_time"]]
    c = [m["closed_time"] for m in e["markets"] if m["closed_time"]]
    return min(w) if w else (max(c) if c else None)


def noon_candidates(e, rows):
    """(P, jump) for every 12:00:10 ET between the event's creation and the last instant its deadline could fall."""
    hi = close_win(e) - LIVENESS_S - min(windows(e)) * 3600
    d = datetime.fromtimestamp(e["created"], ET).date()
    out = []
    while True:
        p = noon(d)
        if p > hi:
            break
        if p >= e["created"]:
            n = sum(1 for r in rows if p <= r[0] < p + 7200)
            pre = sum(1 for r in rows if p - 7200 <= r[0] < p)
            out.append((p, n - pre))
        d += timedelta(days=1)
    return out


def burst(rows, lo, hi):
    """The first minute of the largest jump in trading between lo and hi: the 30-minute window whose print count most
    exceeds the median 30-minute count of the six hours before it (at least 3× and 15 prints)."""
    if not rows or hi <= lo:
        return None
    c = Counter(r[0] // 60 for r in rows)
    m0, m1 = int(lo // 60), int(hi // 60)
    pre = {}
    acc = 0
    for m in range(m0 - 400, m1 + 31):
        acc += c.get(m, 0)
        pre[m] = acc
    win = lambda a, b: pre.get(b - 1, 0) - pre.get(a - 1, 0)  # noqa: E731
    best, best_m = 0.0, None
    for m in range(m0, m1):
        n = win(m, m + 30)
        if n < 15:
            continue
        base = sorted(win(m - 360 + 30 * k, m - 330 + 30 * k) for k in range(12))[6]
        s = n / max(base, 1.0)
        if s >= 3.0 and s > best:
            best, best_m = s, m
    if best_m is None:
        return None
    first = next((m for m in range(best_m, best_m + 30) if c.get(m, 0)), best_m)
    return float(first * 60)


def main():
    uni = V.jfile(sys.argv[1])["events"]
    ex = set(V.jfile(sys.argv[2])["exploration_events"])
    evs = [e for e in uni if e["event"] in ex]
    rows_of = {e["event"]: V.prints(e["event"]) for e in evs}
    rec = {}
    # 1. events that date themselves: the rules' own time, a clock time; the channel's posting instants from its
    #    day-1 "next video" events (a noon ET the prints jump after); other channels' bursts
    posts = defaultdict(set)
    for e in evs:
        r = {"event": e["event"], "slug": e["slug"], "channel": e["channel"], "window_h": e["window_h"],
             "windows": windows(e), "kind": e["kind"], "next_video": e["next_video"], "created": e["created"],
             "close_win": close_win(e), "P": None, "T": None, "p_source": "none"}
        m, c = SCHEDULED.search(e["rules"] or ""), CLOCKED.search(e["rules"] or "")
        if e["kind"] == "clock_count" and c:
            dt = datetime.strptime(f"{c.group(4)} {c.group(5)} {c.group(1)}:{c.group(2)} {c.group(3)}", "%B %d %Y %I:%M %p")
            r["T"], r["p_source"] = dt.replace(tzinfo=ET).timestamp(), "clock"
        elif m and e["window_h"]:
            yr = m.group(2) or datetime.fromtimestamp(e["created"], ET).year
            dt = datetime.strptime(f"{m.group(1)} {yr} {m.group(3)}:{m.group(4)} {m.group(5)}", "%B %d %Y %I:%M %p")
            r["P"], r["p_source"] = dt.replace(tzinfo=ET).timestamp(), "rules"
        elif e["window_h"] and e["channel"] in NOON_CHANNELS and e["next_video"] and e["window_h"] == 24:
            cands = noon_candidates(e, rows_of[e["event"]])
            if cands:
                p, jump = max(cands, key=lambda x: (x[1], x[0]))
                r["jump"] = jump
                if jump >= MIN_JUMP:
                    r["P"], r["p_source"] = p, "noon"
                    posts[e["channel"]].add(p)
        rec[e["event"]] = r

    def fits(r, p):
        """The window this P fits with (deadline + liveness before the winning market's close), smallest first."""
        for w in r["windows"]:
            if p + w * 3600 + LIVENESS_S <= r["close_win"]:
                return w
        return None
    # 2. every other MrBeast / Gaming event: a NEXT video takes the channel's first posting at or after its creation,
    #    an event created after its video went up the latest before its creation, each only where it fits
    for e in evs:
        r = rec[e["event"]]
        if r["p_source"] != "none" or not e["window_h"]:
            continue
        if r["channel"] in NOON_CHANNELS:
            ps = sorted(posts[r["channel"]])
            if e["next_video"]:
                fit = [p for p in ps if p >= e["created"] and fits(r, p)]
                late = [p for p in ps if e["created"] - 86400 <= p < e["created"] and fits(r, p)]
                if fit:
                    r["P"], r["p_source"] = fit[0], "next"
                elif late:  # created within a day AFTER the video went up (the title names it): that video
                    r["P"], r["p_source"] = late[-1], "video"
            else:
                fit = [p for p in ps if p <= e["created"] and fits(r, p)]
                if fit:
                    r["P"], r["p_source"] = fit[-1], "video"
            if r["P"] is None:
                cands = noon_candidates(e, rows_of[e["event"]])
                if cands:
                    p, jump = max(cands, key=lambda x: (x[1], x[0]))
                    if jump >= 20:
                        r["P"], r["p_source"], r["jump"] = p, "noon", jump
        if r["P"] is None:
            hi = r["close_win"] - LIVENESS_S - min(r["windows"]) * 3600
            b = burst(rows_of[e["event"]], e["created"], hi + 3600)
            if b:
                r["P"], r["p_source"] = b, "burst"
    # a posting instant is confirmed when the day-1 event that dated it wakes AT noon: at least 10 prints in the
    # quarter hour from 12:00:00 ET and three times the quarter hour before (2026-01-07's market woke after 15:00 ET)
    surge = {}
    for r in rec.values():
        if r["p_source"] == "noon" and r["window_h"] == 24 and r["next_video"]:
            rows = rows_of[r["event"]]
            p0 = r["P"] - 10
            a = sum(1 for x in rows if p0 <= x[0] < p0 + 900)
            b = sum(1 for x in rows if p0 - 900 <= x[0] < p0)
            surge[r["P"]] = {"after_15min": a, "before_15min": b, "ok": a >= 10 and a >= 3 * b}
            r["surge"] = surge[r["P"]]
    for r in rec.values():
        if r["P"] is not None and r["window_h"]:
            w = fits(r, r["P"]) or r["window_h"]
            r["window_used"] = w
            r["T"] = r["P"] + w * 3600
        # high confidence: a posting instant the day-1 market's noon surge confirms (or the rules' own time, or a clock
        # time), whose deadline sits 2-12 h before the winning market closed; anything else is listed but kept out of
        # every table where minutes matter
        cmt = (r["close_win"] - r["T"]) / 3600 if r["T"] is not None else None
        confirmed = r["p_source"] in ("rules", "clock") or (r["p_source"] in ("noon", "next", "video")
                                                             and surge.get(r["P"], {}).get("ok", False))
        r["p_confidence"] = "high" if (confirmed and cmt is not None and 2.0 <= cmt <= 12.0) else \
            ("low" if r["T"] is not None else "none")
        if r["T"] is not None:
            r["T_utc"] = V.iso(r["T"])
            r["close_minus_T_h"] = round((r["close_win"] - r["T"]) / 3600, 3)
        if r["P"] is not None:
            r["P_utc"] = V.iso(r["P"])
            r["P_et"] = datetime.fromtimestamp(r["P"], ET).strftime("%a %Y-%m-%d %H:%M:%S ET")
    out = sorted(rec.values(), key=lambda x: (x["T"] or 0, x["event"]))
    with open(sys.argv[3], "w") as f:
        json.dump({"note": "P and T are ESTIMATES (p_source says how); no YouTube read. Exploration events only.",
                   "events": out}, f, indent=1, sort_keys=True)
        f.write("\n")
    print(Counter(r["p_source"] for r in out))
    for r in out:
        print(r["slug"][:58].ljust(58), (r["channel"] or "")[:13].ljust(13), str(r["window_h"]).rjust(4),
              r["p_source"].ljust(6), r.get("P_et") or r.get("T_utc"), r.get("jump"), r.get("close_minus_T_h"))


if __name__ == "__main__":
    main()
