"""VIEWS: what the traders' own comments say about the counter and the resolution (question 3's resolution risk).

Reads the pre-boundary comments `comments_pull.py` stored (created before 2026-06-01; nothing later was kept) and
counts, per theme, the comments that match, with a few dated examples (the text only, cut to 220 characters; no user
name). Themes: the counter's five-minute updates; freezes; "sync" jumps; view bots and their removal; disputes and
the evidence a resolution rests on; API or live-counter tools. A count is of comments, not of events or people.

usage: comments_evidence.py <out json>
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

THEMES = {
    "five_minute_updates": r"every (?:5|five) ?min|5 minute update|updates? (?:the )?(?:view )?count every|each 5 minute",
    "freeze": r"\bfroze\b|\bfrozen\b(?!-)|freez|stuck (?:views|on)|views? (?:still )?stuck|not updat|stopped updat",
    "sync_jump": r"\bsync(?:hroni[sz]\w*)?\b(?! with)",
    "bots_and_removal": r"\bbot(?:s|ted|ting)?\b|viewbot|fake views|remov\w* (?:the )?(?:bot|views)|views? (?:just )?disappear",
    "dispute_and_evidence": r"disput|screenshot|archive link|what counts as evidence|which website is uma|exact number at exactly",
    "api_and_live_counters": r"\bapi\b|live ?count|viewstats|social ?blade|mixerno|stats site",
}
EXAMPLES = 8
# the comments the write-up quotes, by their instant (UTC, to the second) — each must be found, or the script stops
CITED = ["2025-06-22T14:51:23Z", "2025-07-20T15:57:25Z", "2025-08-17T18:04:50Z", "2025-11-22T23:24:58Z",
         "2025-11-23T18:22:12Z", "2025-12-14T16:16:58Z", "2026-01-14T16:45:29Z", "2026-02-22T17:47:51Z",
         "2026-03-08T11:23:21Z", "2026-03-09T14:39:55Z", "2026-03-26T17:15:35Z", "2026-04-06T14:49:05Z",
         "2026-04-09T14:38:46Z", "2026-04-09T16:02:07Z", "2026-04-09T16:24:14Z", "2026-04-09T17:00:29Z"]


def main():
    cs = []
    for p in V.pmnet.list_json(os.path.join(V.DATA, "comments")):
        d = V.load(p)
        src = os.path.basename(p).replace(".json", "").replace(".gz", "")
        for c in d["comments"]:
            cs.append((c["t"], src, (c["body"] or "").replace("\n", " ")))
    cs.sort()
    out = {"comments": len(cs), "span_utc": [V.iso(cs[0][0]), V.iso(cs[-1][0])] if cs else None, "themes": {}}
    for name, pat in THEMES.items():
        rx = re.compile(pat, re.I)
        hits = [c for c in cs if rx.search(c[2])]
        step = max(1, len(hits) // EXAMPLES)
        out["themes"][name] = {"pattern": pat, "comments": len(hits),
                               "examples": [{"utc": V.iso(t), "where": s, "text": b[:220]} for t, s, b in hits[::step][:EXAMPLES]]}
    out["cited"] = []
    for u in CITED:
        hit = [c for c in cs if V.iso(c[0]) == u]
        if not hit:
            raise SystemExit(f"cited comment {u} not found")
        out["cited"] += [{"utc": u, "where": s, "text": b[:300]} for _, s, b in hit]
    with open(sys.argv[1], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True, ensure_ascii=False)
        f.write("\n")
    print(json.dumps({k: v["comments"] for k, v in out["themes"].items()}, indent=1), out["comments"], out["span_utc"])


if __name__ == "__main__":
    main()
