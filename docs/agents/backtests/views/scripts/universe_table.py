"""VIEWS: the universe table (question 1) — every closed tag-146 event, and the deadlines its view events count.

One row per event: kind, channel, the videos its rules name, the window (and the window used where rules and title
differ), the deadline T with how it was dated, its brackets and the winner, volume, fee schedule, UMA flags, and
whether the event is exploration or held out. T for an exploration event is `posting.py`'s. A held-out event's T is
dated from Gamma's record alone (its prints are never read): for MrBeast and MrBeast Gaming, the latest 12:00:10 ET
that leaves the deadline plus UMA's two-hour liveness before the winning market closed (and, for a NEXT video, at or
after the event's creation) — `p_source` "schedule (metadata only)". Every T is an estimate; `exact` is false on all
of them until the coordinator reads the videos' `publishedAt` through the Data API.

Deadlines: the events that count the same video at the same instant (a day-4 and its "higher strikes" twin) are one
deadline; the power checks count deadlines, not events.

usage: universe_table.py <universe json> <split json> <posting json> <out json>
"""
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402
from posting import close_win, windows, LIVENESS_S, NOON_CHANNELS  # noqa: E402

ET = ZoneInfo("America/New_York")


def schedule_T(e):
    """Metadata-only: the latest 12:00:10 ET whose deadline + liveness fits before the winning market's close."""
    cw = close_win(e)
    if cw is None or not e["window_h"] or e["channel"] not in NOON_CHANNELS:
        return None, None, None
    for w in windows(e):
        hi = cw - LIVENESS_S - w * 3600
        d = datetime.fromtimestamp(hi, ET).date()
        for _ in range(10):
            p = datetime(d.year, d.month, d.day, 12, 0, 10, tzinfo=ET).timestamp()
            if p <= hi and (not e["next_video"] or p >= e["created"]):
                return p, p + w * 3600, w
            d -= timedelta(days=1)
    return None, None, None


def main():
    uni = V.jfile(sys.argv[1])["events"]
    split = V.jfile(sys.argv[2])
    ex, held = set(split["exploration_events"]), set(split["held_out_events"])
    post = {r["event"]: r for r in V.jfile(sys.argv[3])["events"]}
    rows = []
    for e in uni:
        side = "exploration" if e["event"] in ex else ("held_out" if e["event"] in held else "not_studied")
        P = T = w = None
        src, conf = None, None
        if e["event"] in post:
            r = post[e["event"]]
            P, T, w, src, conf = r.get("P"), r.get("T"), r.get("window_used"), r["p_source"], r["p_confidence"]
        elif side == "held_out":
            P, T, w = schedule_T(e)
            src, conf = ("schedule (metadata only)", "prior") if T else ("none", "none")
        fees = sorted({(m["fee_rate"], m["fee_exp"]) for m in e["markets"]}, key=str)
        rows.append({
            "event": e["event"], "slug": e["slug"], "title": e["title"], "series": e["series"], "kind": e["kind"],
            "split": side, "channel": e["channel"], "videos_named": e["videos"], "next_video": e["next_video"],
            "window_rules_h": e["window_rules_h"], "window_title_h": e["window_title_h"], "window_used_h": w,
            "P_utc": V.iso(P) if P else None, "T_utc": V.iso(T) if T else None, "T_exact": False,
            "p_source": src, "p_confidence": conf,
            "brackets": [m["bracket"] for m in e["markets"]], "bracket_titles": [m["title"] for m in e["markets"]],
            "winner": e["winner"], "winner_title": next((m["title"] for m in e["markets"] if m["payout_yes"] == 1.0), None),
            "volume_usd": e["volume"], "fees": [{"rate": a, "exponent": b} for a, b in fees],
            "uma_disputed": e["disputed"], "created_utc": V.iso(e["created"]) if e["created"] else None,
            "closed_first_utc": V.iso(e["closed_first"]) if e["closed_first"] else None,
        })
    # deadlines: same channel, same T (to the minute), views kinds only
    dl = defaultdict(list)
    for r in rows:
        if r["kind"] in ("video_window", "clock_count") and r["T_utc"]:
            dl[(r["channel"], r["T_utc"][:16])].append(r["event"])
    by_split = Counter()
    for (ch, t), evs in dl.items():
        s = next(x["split"] for x in rows if x["event"] == evs[0])
        by_split[(s, ch in NOON_CHANNELS)] += 1
    weeks = defaultdict(int)
    for (ch, t), evs in dl.items():
        if ch in NOON_CHANNELS:
            d = datetime.fromisoformat(t)
            weeks[d.strftime("%G-W%V")] += 1
    views = [r for r in rows if r["kind"] in ("video_window", "clock_count")]
    summary = {
        "events_closed_under_tag_146": len(rows),
        "by_kind": dict(Counter(r["kind"] for r in rows)),
        "views_events": len(views),
        "views_volume_usd": round(sum(r["volume_usd"] for r in views), 2),
        "views_by_channel": {k: {"events": v, "volume_usd": round(sum(r["volume_usd"] for r in views if r["channel"] == k), 2)}
                             for k, v in Counter(r["channel"] for r in views).most_common()},
        "views_by_window_h": dict(sorted(Counter(str(r["window_used_h"] or r["window_rules_h"] or r["window_title_h"])
                                                 for r in views).items())),
        "views_by_split": {k: {"events": v, "volume_usd": round(sum(r["volume_usd"] for r in views if r["split"] == k), 2)}
                           for k, v in Counter(r["split"] for r in views).items()},
        "fee_regimes_views": dict(Counter(json.dumps(r["fees"]) for r in views)),
        "deadlines_dated": {f"{k[0]}|{'MrBeast+Gaming' if k[1] else 'other'}": v for k, v in by_split.items()},
        "mrbeast_gaming_deadlines_per_iso_week": dict(sorted(weeks.items())),
        "brackets_per_event_median": sorted(len(r["brackets"]) for r in views)[len(views) // 2],
        # the narrowest closed bracket of each MrBeast event, in millions, counted by the window it resolved on
        "mrbeast_narrowest_bracket_m_by_window_h": {
            str(w): dict(sorted(Counter(
                min((b[1] - b[0]) / 1e6 for b in r["brackets"] if b and b[0] is not None and b[1] is not None)
                for r in views if r["channel"] == "@MrBeast" and (r["window_used_h"] or r["window_rules_h"]) == w
                and any(b and b[0] is not None and b[1] is not None for b in r["brackets"])).items()))
            for w in (24, 48, 72, 96, 120, 144, 168)},
        "p_source_counts": dict(Counter(f"{r['split']}:{r['p_source']}:{r['p_confidence']}" for r in views)),
        "uma_disputed_events": sum(1 for r in views if r["uma_disputed"]),
    }
    out = {"note": "Every T is an estimate (T_exact false); see p_source. Held-out events: Gamma metadata only.",
           "summary": summary, "deadlines": {f"{c}|{t}": evs for (c, t), evs in sorted(dl.items(), key=lambda kv: kv[0][1])},
           "events": rows}
    with open(sys.argv[4], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
