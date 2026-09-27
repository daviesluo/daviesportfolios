"""VIEWS data step 2: the universe — every closed tag-146 event, classified, with what its rules and markets say.

Reads the raw Gamma records `universe_pull.py` stored ($VIEWS_DATA/univ/ev/<id>.json.gz) and writes one committed file,
`inputs/universe.json`: per event its kind, channel, the videos its rules name, the window its rules count (and the
window its title says, where the two differ), whether it counts the channel's NEXT video, its creation and close
instants, and per market the bracket, tokens, payout, volume, fee schedule and UMA status history. Metadata only: no
price and no print is read here.

Kinds:
* `video_window` — a video's view counter at its posting time + N hours (the rules: "in the first 24 hours", "first
  24hrs", "within 24 hours of being posted", "first 7 days"). The study's subject.
* `clock_count` — a video's view counter at a stated clock time ("as displayed … at 12:00 PM ET on October 10").
* `multi_video` — any of a channel's videos reaching a count in a window by a date ("another MrBeast video … by").
* `channel_total` — a channel's total views or subscribers by a date.
* `chart` — YouTube's music charts (a daily count published by YouTube, not a video's counter).
* `other` — everything else under the tag (mentions, livestreams, challenges, people).

usage: universe_build.py <out json>
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

WIN = re.compile(r"(?:first|within)\s+(\d+)\s*(hrs?|hours?|days?|weeks?)\b", re.I)
CLOCK = re.compile(r"(?:as displayed|at the specified time|at\s+\d{1,2}:\d{2}\s*[AP]M\s*ET\s+on)", re.I)
NEXT = re.compile(r"\bnext\s+(?:YouTube\s+)?video\b|\bnext video\b|announced next video|\bupcoming episode\b", re.I)
TITLE_DAY = re.compile(r"\bday[\s-]*(\d)\b", re.I)
TITLE_WEEK = re.compile(r"\bweek[\s-]*1\b", re.I)
CHANNELS = [  # a channel named in words where the rules give no link (older rules), matched on the title and rules
    ("mrbeast gaming", "@MrBeastGaming"), ("mrbeast", "@MrBeast"), ("stokes twins", "@StokesTwins"),
    ("sidemen", "@Sidemen"), ("marques brownlee", "@mkbhd"), ("mkbhd", "@mkbhd"), ("pewdiepie", "@PewDiePie"),
    ("dream", "@dream"), ("rockstar", "@RockstarGames"), ("grand theft auto", "@RockstarGames"),
    ("gta", "@RockstarGames"), ("new heights", "@newheightshow"), ("taylor swift", "@TaylorSwift"),
    ("bad bunny", "@NFL"), ("sabrina carpenter", "@SabrinaCarpenter"), ("ronaldo", "@cristiano")]


def window_of(text):
    m = WIN.search(text or "")
    if not m:
        return None
    n, u = int(m.group(1)), m.group(2).lower()
    return n if u.startswith("h") else n * 24 if u.startswith("d") else n * 168


def title_window(title):
    m = TITLE_DAY.search(title or "")
    if m:
        return int(m.group(1)) * 24
    if TITLE_WEEK.search(title or ""):
        return 168
    return None


def kind_of(e, desc):
    t = f"{e.get('slug', '')} {e.get('title', '')}".lower()
    if "highest daily youtube view count" in t or (e.get("series") or [{}])[0].get("slug") == "youtube-music-views":
        return "chart"
    if re.search(r"billion views|million subscribers|subscribers by|biggest youtube channel", t):
        return "channel_total"
    if re.search(r"another mrbeast video|views on a mrbeast video|\bby (?:january|february|march|april|may|june|july|"
                 r"august|september|october|november|december)\b.*views|100m\+ week 1", t) and "# of views" not in t:
        return "multi_video"
    if "view" not in t:
        return "other"
    if CLOCK.search(desc) and not window_of(desc):
        return "clock_count"
    if window_of(desc) or title_window(e.get("title")):
        return "video_window"
    return "other"


def channel_of(e, desc):
    h = V.handle_of(desc)
    if h:
        return h, "rules link"
    t = f"{e.get('title', '')} {desc}".lower()
    for name, handle in CHANNELS:
        if name in t:
            return handle, "named in words"
    return None, None


def main():
    outp = sys.argv[1]
    d = os.path.join(V.DATA, "univ", "ev")
    events = []
    for p in V.pmnet.list_json(d):
        e = V.load(p)
        desc = e.get("description") or ((e.get("markets") or [{}])[0].get("description") or "")
        kind = kind_of(e, desc)
        ch, ch_how = channel_of(e, desc)
        series = [s.get("slug") for s in e.get("series") or []]
        wr, wt = window_of(desc), title_window(e.get("title"))
        mk = []
        for m in e.get("markets") or []:
            toks = V.jload(m.get("clobTokenIds"), [])
            op = V.jload(m.get("outcomePrices"), [])
            fs = m.get("feeSchedule") or {}
            try:
                payout = float(op[0]) if m.get("closed") and len(op) == 2 else None
            except (ValueError, TypeError):
                payout = None
            mk.append({
                "cond": m.get("conditionId"), "yes": str(toks[0]) if len(toks) == 2 else None,
                "no": str(toks[1]) if len(toks) == 2 else None, "title": m.get("groupItemTitle"),
                "q": (m.get("question") or "")[:200], "bracket": V.bracket(m.get("groupItemTitle"), m.get("question")),
                "payout_yes": payout, "vol": float(m.get("volumeNum") or m.get("volume") or 0),
                "fee_rate": (fs.get("rate") or 0.0) if m.get("feesEnabled") else 0.0,
                "fee_exp": fs.get("exponent") if m.get("feesEnabled") else None,
                "fees_enabled": bool(m.get("feesEnabled")), "tick": m.get("orderPriceMinTickSize"),
                "created": V.ts(m.get("createdAt")), "start": V.ts(m.get("startDate")),
                "closed_time": V.ts(m.get("closedTime")), "end": V.ts(m.get("endDate")),
                "uma": V.jload(m.get("umaResolutionStatuses"), []), "uma_status": m.get("umaResolutionStatus"),
                "neg_risk": bool(m.get("negRisk")), "res_src": (m.get("resolutionSource") or "")[:200],
            })
        closes = [x["closed_time"] for x in mk if x["closed_time"]]
        winners = [x for x in mk if x["payout_yes"] == 1.0]
        events.append({
            "event": str(e.get("id")), "slug": e.get("slug"), "title": e.get("title"), "series": series[0] if series else None,
            "kind": kind, "channel": ch, "channel_how": ch_how, "videos": V.videos_of(desc),
            "window_rules_h": wr, "window_title_h": wt, "window_h": wr if wr is not None else wt,
            "window_conflict": wr is not None and wt is not None and wr != wt,
            "next_video": bool(NEXT.search(desc)) and not V.videos_of(desc),
            "created": V.ts(e.get("createdAt")) or V.ts(e.get("creationDate")) or V.ts(e.get("startDate")),
            "start": V.ts(e.get("startDate")), "end": V.ts(e.get("endDate")),
            "closed_first": min(closes) if closes else None, "closed_last": max(closes) if closes else None,
            "neg_risk": bool(e.get("negRisk") or e.get("enableNegRisk")),
            "volume": round(sum(x["vol"] for x in mk), 2), "markets": mk,
            "winner": winners[0]["bracket"] if len(winners) == 1 else None, "winners": len(winners),
            "disputed": any("disputed" in x["uma"] for x in mk),
            "rules": desc[:4000],
        })
    events.sort(key=lambda x: (x["closed_first"] or 0, x["event"]))
    body = json.dumps({"source": "gamma-api.polymarket.com /events?tag_id=146&closed=true and /events/<id>, read 2026-09-27",
                       "events": events}, indent=0, sort_keys=True) + "\n"
    if outp.endswith(".gz"):
        import gzip
        with gzip.GzipFile(outp, "wb", mtime=0) as g:
            g.write(body.encode())
    else:
        with open(outp, "w") as f:
            f.write(body)
    from collections import Counter
    print(Counter(e["kind"] for e in events))


if __name__ == "__main__":
    main()
