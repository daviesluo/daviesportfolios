"""VIEWS: resolution risk — where a view market's resolution may not follow the counter at the deadline (question 3).

History keeps no counter, so a disagreement between the counter at T and the resolution cannot be counted directly.
What can be read, per exploration event with a high-confidence T:

* UMA's own record: a market whose status history holds a dispute (Gamma's `umaResolutionStatuses`);
* the rules against themselves: an event whose rules count a different window from its title (the title's day 1 against
  the rules' 48 hours), or name a video that is not the one the event counts;
* contention in the close: brackets of one event that resolved hours apart (a proposal held back or re-made);
* the market's own doubt after T: the winner's midpoint under 0.99 at T + 15 min, or stale-side prints worth ≥ 5¢ a
  share more than 10 minutes after T (someone paid for a different outcome after the count was fixed);
* the public comments (before the split's boundary only) within the hour before T to six hours after the last close,
  that name a dispute, the resolution, a proposal or the count.

usage: resolution.py <universe json> <split json> <posting json> <near_t json> <out json>
"""
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402
from stale_late import stale_prints  # noqa: E402

KEY = re.compile(r"disput|resol|propos|uma\b|oracle|wrong|screenshot|count(?:er|ed)?\b|view count|clarif|refund|"
                 r"24 ?h|48 ?h|deadline|exact|freez|stuck|update", re.I)


def main():
    uni = {e["event"]: e for e in V.jfile(sys.argv[1])["events"]}
    split = V.jfile(sys.argv[2])
    held = set(split["held_out_events"])
    post = {r["event"]: r for r in V.jfile(sys.argv[3])["events"]}
    nt = {x["event"]: x for x in V.jfile(sys.argv[4])["events"]}
    comments = []
    cdir = os.path.join(V.DATA, "comments")
    for p in V.pmnet.list_json(cdir):
        comments += V.load(p)["comments"]
    comments.sort(key=lambda c: c["t"])
    out = []
    for eid, r in post.items():
        if eid in held or r.get("p_confidence") != "high":
            continue
        e = uni[eid]
        T = r["T"]
        flags = []
        if e["disputed"]:
            flags.append("uma_dispute: " + ", ".join(m["title"] or "?" for m in e["markets"] if "disputed" in m["uma"]))
            hist = V.mids(eid)
            for m in e["markets"]:
                if "disputed" not in m["uma"]:
                    continue
                h = hist.get(m["yes"]) or []
                at = lambda t: next((p for tt, p in reversed(h) if tt <= t), None)  # noqa: E731
                flags.append(f"disputed {m['title']}: paid {m['payout_yes']}, statuses {m['uma']}, mid at T-1h {at(T - 3600)}, "
                             f"T {at(T)}, T+15m {at(T + 900)}")
        if e["window_conflict"]:
            flags.append(f"window_conflict: rules {e['window_rules_h']} h, title {e['window_title_h']} h; resolved on "
                         f"{r.get('window_used')} h by the close times")
        closes = sorted(m["closed_time"] for m in e["markets"] if m["closed_time"])
        if closes and closes[-1] - closes[0] > 3 * 3600:
            late = [m["title"] for m in e["markets"] if m["closed_time"] and m["closed_time"] - closes[0] > 3 * 3600]
            flags.append(f"close_spread_h {round((closes[-1] - closes[0]) / 3600, 2)}: late {late}")
        x = nt.get(eid)
        if x and (x["points"]["T+15m"]["winner_mid"] or 1) < 0.99:
            flags.append(f"winner_mid_T+15m {x['points']['T+15m']['winner_mid']}")
        rows = V.prints(eid)
        big = [s for s in stale_prints(e, rows, T + 600) if s[4] >= 0.05]
        if big:
            wc = next((m["cond"] for m in e["markets"] if m["payout_yes"] == 1.0), None)
            wlow = [s[2] for s in big if s[1] == wc]
            flags.append(f"stale_prints_edge_ge_5c_after_T+10m {len(big)}, gross ${round(sum(s[3] * s[4] for s in big), 2)}, "
                         f"first at T+{int(big[0][0] - T)} s" + (f", winner's YES as low as {min(wlow):.3f}" if wlow else ""))
        if not flags:
            continue
        lo, hi = T - 3600, (closes[-1] if closes else T) + 6 * 3600
        cm = [{"t_minus_T_s": int(c["t"] - T), "body": (c["body"] or "")[:300]}
              for c in comments if lo <= c["t"] <= hi and KEY.search(c["body"] or "")]
        out.append({"event": eid, "slug": e["slug"], "T_utc": r["T_utc"], "winner": e["winner"], "flags": flags,
                    "comments": cm[:60], "comments_matched": len(cm)})
    out.sort(key=lambda z: z["T_utc"])
    res = {"events_flagged": len(out), "events_examined": sum(1 for k, r in post.items() if k not in held and r.get("p_confidence") == "high"),
           "comments_read": len(comments), "events": out}
    with open(sys.argv[5], "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    for z in out:
        print(z["T_utc"], z["slug"][:55], z["winner"], z["flags"], "comments", z["comments_matched"])


if __name__ == "__main__":
    main()
