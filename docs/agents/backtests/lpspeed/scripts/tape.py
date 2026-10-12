"""LP-SPEED: live-prep's fills against pm-rec's print tape, second by second.

Usage (from the repository root, read-only inputs):
  python3 -I docs/agents/backtests/lpspeed/scripts/tape.py <fills.csv> <prints dir> > docs/agents/backtests/lpspeed/results/tape.txt

<fills.csv> is `sql/fills_export.sql`'s answer (data/fills.csv); <prints dir> holds pm-rec's hourly `prints` objects
(bucket `pm-rec`, `prints/<day>/<hh>.jsonl.gz`), downloaded keylessly through `pm_rec_archive`'s signed URLs. A print
line is [market id, unix s, taker side, outcome index (0 YES, 1 NO), price, size].

Everything is in YES-book terms: a BUY of YES at p and a SELL of NO at p rest as bids at p and 1 - p; a BUY of NO at p
and a SELL of YES at p as asks at 1 - p and p. A taker print buys YES (BUY YES, SELL NO) or sells YES (SELL YES, BUY NO).

What it measures, per fill:
  - the age of the DECISION the fill met: every turn re-reads the book and keeps an order only when the rule still wants
    its price, so a fill meets the latest turn's decision, not the post. A turn reads its books about 2-4 s into its
    minute and posts about 7 s in (orders' `ts`); the decision time is taken as the later of (created - 4 s) and the
    minute's :03 before the fill (the previous minute's when the fill came in the first 7 s);
  - warning prints: other prints in the market after the decision and before the fill's own second that show the book
    moving toward our order: for a bid, a print selling YES below the turn's best bid, or buying YES below its best
    ask (the ask came down); for an ask, the mirror. "Loose": any print selling YES at or below the best bid (for a bid);
  - a loop that re-decides every k seconds, at a random phase, with L seconds from its read to the venue carrying the
    cancel, avoids a fill with probability min(1, max(0, (fill - L - first warning) / k)) when the rule would reprice on
    the warning. Its dollar effect is that probability times the fill's markout (a negative markout avoided is a gain).
The tape is complete per minute (`complete` in each frame's header) for the books set, which holds every market a
Reward quotes path quotes or holds. What it cannot see: a book that moves with no print (quotes pulled or added), so the
warning is a lower bound on what a book-reading loop could react to.
"""
import csv
import glob
import gzip
import json
import math
import os
import statistics as st
import sys
from collections import defaultdict

fills_path, prints_dir = sys.argv[1], sys.argv[2]
LAT = [1.0, 2.0]
OFFSET = int(os.environ.get("TAPE_OFFSET_S", "3"))   # the tape's lag behind match_time, measured below
KS = [1, 2, 5, 10, 15, 30]


def f(x):
    return float(x) if x not in ("", None) else None


rows = list(csv.DictReader(open(fills_path)))
need = {r["rec_id"] for r in rows if r["rec_id"]}
tape = defaultdict(list)
frames = complete = 0
for p in sorted(glob.glob(os.path.join(prints_dir, "prints_*.jsonl.gz"))):
    with gzip.open(p, "rt") as fh:
        for line in fh:
            x = json.loads(line)
            if isinstance(x, dict):
                frames += 1
                complete += bool(x.get("complete"))
                continue
            if str(x[0]) in need:
                yes_px = x[4] if x[3] == 0 else 1 - x[4]
                buys_yes = (x[2] == "BUY") == (x[3] == 0)
                tape[str(x[0])].append((x[1], buys_yes, round(yes_px, 4), x[5]))
for k in tape:
    tape[k].sort()

out = []
for r in rows:
    q = float(r["price"])
    oside, outc = r["oside"], r["outcome"].lower()
    bid = (oside == "BUY") == (outc == "yes")
    qy = q if outc == "yes" else 1 - q
    size = float(r["size"])
    ts = int(r["match_s"])
    created = int(r["created_s"]) if r["created_s"] else int(float(r["ts_s"]))
    sec = ts % 60
    turn = (ts - sec) + 3 if sec >= 7 else (ts - sec) - 57
    dec = max(created - 4, turn)
    bb, ba = f(r["m0bb"]), f(r["m0ba"])
    if bb is None or ba is None:      # the minute's book: the one the order was quoted on, else
        bb, ba = f(r["seen_bb"]), f(r["seen_ba"])
    mk = {}
    for h in ("m1", "m5", "m15", "m60"):
        m = f(r[h])
        mk[h] = None if m is None else ((m - qy) if bid else (qy - m)) * size
    # The tape's stamp runs behind the match (the data API stamps a print ~2 s after it, reference section 3.39): its own
    # print is looked for up to 8 s after the match, and every print's time is taken back by the measured lag (OFFSET).
    allp = tape.get(r["rec_id"], [])
    own = [p for p in allp if ts - 2 <= p[0] <= ts + 8 and (p[1] != bid) and abs(p[2] - qy) <= 0.0151]
    own1 = min(own, key=lambda p: abs(p[0] - ts - OFFSET)) if own else None
    prints = [(p[0] - OFFSET,) + p[1:] for p in allp if dec < p[0] - OFFSET and p is not own1]
    before = [p for p in prints if p[0] < ts]
    if bid:
        tight = [p for p in before if (not p[1] and p[2] < bb - 1e-9) or (p[1] and p[2] < ba - 1e-9)]
        loose = [p for p in before if (not p[1] and p[2] <= bb + 1e-9) or (p[1] and p[2] < ba - 1e-9)]
    else:
        tight = [p for p in before if (p[1] and p[2] > ba + 1e-9) or (not p[1] and p[2] > bb + 1e-9)]
        loose = [p for p in before if (p[1] and p[2] >= ba - 1e-9) or (not p[1] and p[2] > bb + 1e-9)]
    out.append(dict(
        oid=r["oid"], gate=r["gate"], bid=bid, qy=qy, size=size, ts=ts, sec=sec, created=created, age_post=ts - created,
        age_dec=ts - dec, own=own1 is not None, own_lag=(own1[0] - ts) if own1 else None, n_before=len(before), tight=tight[0][0] if tight else None,
        loose=loose[0][0] if loose else None, sweep=int(r["maker_prices"] or 1) > 1, makers=int(r["makers"] or 1),
        at_touch=(abs(qy - bb) < 1e-9) if bid else (abs(qy - ba) < 1e-9), bb=bb, ba=ba, **mk))


def money(x):
    return f"{x:+.2f}"


def summ(xs, key):
    v = [x[key] for x in xs if x[key] is not None]
    return sum(v), len(v)


print("LP-SPEED tape: live-prep fills against pm-rec's prints")
print(f"fills read: {len(rows)} (to 2026-10-12 09:00 UTC); prints frames read: {frames}, complete: {complete}")
print(f"markets with prints: {sum(1 for k in need if tape.get(k))} of {len(need)}")
lags = sorted(x["own_lag"] for x in out if x["own_lag"] is not None)
print(f"fills whose own taker print is on the tape (same market, -2..+8 s, at our price +-1.5c): {len(lags)}; tape stamp minus match_time: "
      f"median {st.median(lags)} s, p10 {lags[len(lags) // 10]}, p90 {lags[len(lags) * 9 // 10]} (prints are taken back by {OFFSET} s)")
print()
print("## a. post to fill, and decision to fill (seconds)")
for name, key in (("post (venue created_at) to fill", "age_post"), ("latest turn's decision to fill", "age_dec")):
    v = sorted(x[key] for x in out)
    qs = [v[int(p * (len(v) - 1))] for p in (0.1, 0.25, 0.5, 0.75, 0.9)]
    print(f"{name}: n {len(v)}, p10 {qs[0]}, p25 {qs[1]}, median {qs[2]}, p75 {qs[3]}, p90 {qs[4]}; <=1 s {sum(1 for a in v if a <= 1)}, <=5 s {sum(1 for a in v if a <= 5)}, <=15 s {sum(1 for a in v if a <= 15)}, <=60 s {sum(1 for a in v if a <= 60)}")
secs = defaultdict(int)
for x in out:
    secs[x["sec"] // 10 * 10] += 1
print("fills by second of the minute (the turn reads ~:02, posts ~:07): " + ", ".join(f":{s:02d}-{s+9:02d} {secs[s]}" for s in range(0, 60, 10)))
print()
print("## markouts by age since post (sum over fills, $; per fill in brackets); negative = the fill lost against the later mid")
bands = [(0, 2), (2, 10), (10, 60), (60, 10**9)]
for lo, hi in bands:
    g = [x for x in out if lo <= x["age_post"] < hi]
    parts = []
    for h in ("m1", "m5", "m60"):
        s, n = summ(g, h)
        parts.append(f"{h} {money(s)} ({money(s / n) if n else 'n/a'}, n {n})")
    print(f"post age [{lo}, {hi if hi < 10**9 else 'inf'}) s: fills {len(g)}; " + "; ".join(parts))
for gate in ("open", "reduce"):
    g = [x for x in out if x["gate"] == gate]
    s1, n1 = summ(g, "m1"); s60, n60 = summ(g, "m60")
    print(f"gate {gate}: fills {len(g)}; m1 {money(s1)} (n {n1}); m60 {money(s60)} (n {n60})")
s1, n1 = summ(out, "m1"); s5, n5 = summ(out, "m5"); s60, n60 = summ(out, "m60")
print(f"all: m1 {money(s1)} (n {n1}); m5 {money(s5)} (n {n5}); m60 {money(s60)} (n {n60})")
print()
print("## c. stale quotes: did the tape move toward the order between the latest decision and the fill?")
sw = [x for x in out if x["sweep"]]
print(f"fills in a taker trade that took more than one price level (a sweep): {len(sw)} of {len(out)}")
print(f"order at the turn's touch when filled: {sum(x['at_touch'] for x in out)} of {len(out)}")
for lab, key in (("tight (a level beyond the turn's touch traded)", "tight"), ("loose (our side traded at the touch or a level beyond)", "loose")):
    w = [x for x in out if x[key] is not None]
    lead = sorted(x["ts"] - x[key] for x in w)
    s1, n1 = summ(w, "m1"); s60, n60 = summ(w, "m60")
    print(f"{lab}: {len(w)} fills had a warning print first; lead before the fill: median {st.median(lead) if lead else 'n/a'} s, "
          f">=2 s {sum(1 for a in lead if a >= 2)}, >=5 s {sum(1 for a in lead if a >= 5)}, >=15 s {sum(1 for a in lead if a >= 15)}; "
          f"their markouts m1 {money(s1)} (n {n1}), m60 {money(s60)} (n {n60})")
nw = [x for x in out if x["loose"] is None]
s1, n1 = summ(nw, "m1"); s60, n60 = summ(nw, "m60")
print(f"no warning print at all (the fill's own taker came first): {len(nw)} fills; markouts m1 {money(s1)} (n {n1}), m60 {money(s60)} (n {n60})")
print()
print("## the k-second loop: expected fills avoided and their markout (cancel on the first warning print, random phase)")
print("k s | L s | signal | fills avoided (expected) | markout m1 avoided $ | markout m5 avoided $ | markout m60 avoided $")
res = {}
for sig in ("tight", "loose"):
    for L in LAT:
        for k in KS + [60]:
            fa = a1 = a5 = a60 = 0.0
            for x in out:
                if x[sig] is None:
                    continue
                if k == 60:
                    p = 0.0   # today: the next turn is after the fill by construction of the decision time
                else:
                    p = min(1.0, max(0.0, (x["ts"] - L - x[sig]) / k))
                fa += p
                a1 += p * (x["m1"] or 0); a5 += p * (x["m5"] or 0); a60 += p * (x["m60"] or 0)
            res[(sig, L, k)] = (fa, a1, a5, a60)
            print(f"{k} | {L:.0f} | {sig} | {fa:.1f} | {money(-a1)} | {money(-a5)} | {money(-a60)}")
print("(a positive $ is money the faster loop would have kept: the avoided fills' markouts were losses)")
print("buys only (gate open; a loop that cancels BUYs and leaves the exits resting), L = 1 s:")
for sig in ("tight", "loose"):
    for k in (1, 5, 10, 15, 30):
        fa = a5 = a60 = 0.0
        for x in out:
            if x[sig] is None or x["gate"] != "open":
                continue
            p = min(1.0, max(0.0, (x["ts"] - 1.0 - x[sig]) / k))
            fa += p; a5 += p * (x["m5"] or 0); a60 += p * (x["m60"] or 0)
        print(f"  {k} s, {sig}: fills avoided {fa:.1f}, markout m5 avoided {money(-a5)}, m60 avoided {money(-a60)}")
print()
print("## staleness test: if fills were stale quotes picked off, the older the turn's decision, the worse the markout")
for lo, hi in ((0, 15), (15, 30), (30, 45), (45, 70)):
    g = [x for x in out if lo <= x["age_dec"] < hi]
    sh = sum(x["size"] for x in g)
    s1, n1 = summ(g, "m1"); s60, n60 = summ(g, "m60")
    sh60 = sum(x["size"] for x in g if x["m60"] is not None)
    print(f"decision age [{lo}, {hi}) s: fills {len(g)}, shares {sh:.0f}; markout m1 {money(s1)} ({100 * s1 / sh:+.2f} c/share), "
          f"m60 {money(s60)} ({100 * s60 / sh60:+.2f} c/share)")
print()
print("## what each fill met, and what a faster loop could have seen (warnings with more than 1 s of lead first)")
cats = defaultdict(list)
for x in out:
    lead = max([x["ts"] - x[k] for k in ("tight", "loose") if x[k] is not None], default=None)
    behind = (x["qy"] < x["bb"] - 1e-9) if x["bid"] else (x["qy"] > x["ba"] + 1e-9)
    if lead is not None and lead > 1:
        c = "A. a print moved the book toward the order first (seen by a prints- or book-reading loop)"
    elif x["sweep"]:
        c = "B. one taker swept several levels, ours among them (no loop sees it before it lands)"
    elif behind:
        c = "C. behind the touch at the decision, filled alone: the levels ahead went without a print (a book-reading loop's upper bound)"
    else:
        c = "D. at the touch at the decision, one taker took it (a faster loop changes nothing unless the far side moved quietly)"
    cats[c].append(x)
for c in sorted(cats):
    g = cats[c]
    s1, n1 = summ(g, "m1"); s5, n5 = summ(g, "m5"); s60, n60 = summ(g, "m60")
    print(f"{c}: fills {len(g)}, shares {sum(x['size'] for x in g):.0f}; markout m1 {money(s1)}, m5 {money(s5)} (n {n5}), m60 {money(s60)} (n {n60})")
print()
days = (max(x["ts"] for x in out) - min(x["ts"] for x in out)) / 86400
print(f"days covered by these fills: {days:.2f}")
