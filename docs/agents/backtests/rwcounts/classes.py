# The exclusion classes, fixed before any arm is run (2026-10-04). Applied to a market by its question and category
# in RW's selection (the latest row of the market, as metaFor reads it; the classes are a market's, not a day's).
import json, re, datetime
CLASSES = {
  # Davies' two kinds, the main session's own regexes (Postgres \m...\M == word boundaries)
  "P": {"q": r"\b(posts?|tweets?|truth social)\b"},
  "V": {"q": r"\bviews?\b"},
  # The categories the main session found negative in RW's own accounts
  "F": {"cat": ["finance_prices_fees"]},
  "G": {"cat": ["general_fees"]},
  # "Similar kind", named before running: a market that resolves on a number the public can watch accumulate or move
  # while the market trades (a running count, a live score, a rank, a share, a running total), so traders who watch it
  # can take a stale quote, and most of all near the end -- the same mechanism as post and view counts.
  "C": {"q": r"\b(streams?|first week sales|transits?|tomatometer|app store|market share|committed|box office|livebench)\b",
        "cat": ["mentions_fees"]},
}
def member(cls, q, cat):
    d = CLASSES[cls]
    if "q" in d and q and re.search(d["q"], q, re.I): return True
    if "cat" in d and cat in d["cat"]: return True
    return False
ARMS = {
  # x1 plus an exclusion, the exclusion applied from x1's own first minute (2026-09-28 00:00 UTC) exactly as x1 applies
  # noCats: a market of the class is not quoted; what it holds is held, marked at the adjusted mid and settled.
  "x1-P": ["P"], "x1-V": ["V"], "x1-PV": ["P", "V"], "x1-F": ["F"], "x1-G": ["G"], "x1-C": ["C"], "x1-PVC": ["P", "V", "C"],
  "x1-PVFG": ["P", "V", "F", "G"],
  # the milder rule: a class's market is quoted by x1's rule only until N hours before its end (the selection's end_date,
  # Gamma's endDate when the market was selected, as metaFor gives it for the minute); x1's same-day rule still applies
  "x1-PV-L12": ["P", "V", "late12"], "x1-PV-L24": ["P", "V", "late24"], "x1-PV-L48": ["P", "V", "late48"],
  "x1-PVC-L12": ["P", "V", "C", "late12"], "x1-PVC-L24": ["P", "V", "C", "late24"], "x1-PVC-L48": ["P", "V", "C", "late48"],
  # the same exclusions on x4 and x5 (their rest rules from 2026-10-02 20:00 as frozen; the exclusion from 09-28 00:00)
  "x4-PV": ["P", "V"], "x5-PV": ["P", "V"], "x4-PVC": ["P", "V", "C"], "x5-PVC": ["P", "V", "C"],
  # the longer sample: RW itself less the class from RW's first minute (2026-09-25 00:00), every other rule RW's
  "rw-P": ["P"], "rw-V": ["V"], "rw-PV": ["P", "V"], "rw-C": ["C"], "rw-PVC": ["P", "V", "C"],
}
if __name__ == "__main__":
    sel = json.load(open("data/small.json"))["selection"]
    last = {}
    for s in sorted(sel, key=lambda s: s["day"]):
        if s["day"] >= "2026-09-25": last[s["cond"]] = s
    out = {"written_at": datetime.datetime.utcnow().isoformat() + "Z", "classes": CLASSES, "arms": ARMS, "members": {}}
    for cls in CLASSES:
        ms = [(c[:10], s["cat"], s["q"], s["end_date"]) for c, s in last.items() if member(cls, s["q"], s["cat"])]
        out["members"][cls] = ms
        print(f"== {cls}: {len(ms)} markets")
        for m in ms: print("  ", m[0], m[1], "|", m[2][:90], "| end", m[3])
    json.dump(out, open("classes_frozen.json", "w"), indent=1)
