"""M6: do strike and date ladders ever price out of order after fees? (fp4, a kill measurement)

A ladder is an event whose markets ask the same question at ordered thresholds:
"above $X" / "reach $X" (a higher X can never be likelier) and "by <date>" (a
later date can never be less likely). For two rungs where rung A must be at least
as likely as rung B, buying YES on A and NO on B pays at least 1 in every state,
so it is free money when ask_YES(A) + (1 - bid_YES(B)) + fees < 1, i.e. when B's
YES bid exceeds A's YES ask by more than the fees. Every open ladder of the M1
snapshot's market list, read now through the public books. Writes the JSON named.

usage: m6_ladders.py <snap dir> <out json>
"""
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

CLOB = "https://clob.polymarket.com"
# "hit X" and "reach X" say nothing about the side X is on (an approval rating can "hit" 20 % by falling), so
# only words that fix the direction count; "hit (HIGH)" does
UP = re.compile(r"(\babove\b|\bover\b|\bgreater than\b|\bat least\b|\bmore than\b|\bexceeds?\b|\bhit \(high\))[^\d$]*\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m|b)?", re.I)
DOWN = re.compile(r"\b(below|under|less than|dip to|fall to|drop to)\b[^\d$]*\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m|b)?", re.I)
BY = re.compile(r"\bby\b\s+([A-Z][a-z]+ \d{1,2}(?:,? \d{4})?)", re.I)
MULT = {"k": 1e3, "m": 1e6, "b": 1e9}


def num(m):
    v = float(m.group(2).replace(",", ""))
    return v * MULT.get((m.group(3) or "").lower(), 1.0)


def parse_date(s, year_hint):
    s = s.replace(",", "")
    for fmt in ("%B %d %Y", "%b %d %Y"):
        try:
            return datetime.strptime(s, fmt).timestamp()
        except ValueError:
            pass
    for fmt in ("%B %d", "%b %d"):
        try:
            return datetime.strptime(f"{s} {year_hint}", fmt + " %Y").timestamp()
        except ValueError:
            pass
    return None


def fnum(x, d=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return d


def main():
    snap, outp = sys.argv[1], sys.argv[2]
    markets = pmnet.load(os.path.join(snap, "markets.json"))
    ev = defaultdict(list)
    for m in markets:
        if not (m.get("enableOrderBook") and m.get("acceptingOrders")) or m.get("negRisk"):
            continue
        e = (m.get("events") or [{}])[0].get("id")
        ev[e].append(m)
    ladders = []
    for eid, ms in ev.items():
        if len(ms) < 2:
            continue
        for kind, rx in (("up", UP), ("down", DOWN), ("by", BY)):
            keyed = []
            for m in ms:
                q = m.get("question") or ""
                # "hit (LOW) $X", "dip to", "fall to" ask about a fall: a HIGHER X is the likelier one
                falls = bool(re.search(r"\(low\)|\bdip\b|\bfalls?\b|\bdrops?\b|\bbelow\b|\bunder\b|\bless than\b", q, re.I))
                if kind == "up" and falls:
                    continue
                if kind == "down":
                    mm = re.search(r"\$\s*([\d,]+(?:\.\d+)?)\s*(k|m|b)?", q, re.I) if falls else None
                    if not mm:
                        continue
                    k = float(mm.group(1).replace(",", "")) * MULT.get((mm.group(2) or "").lower(), 1.0)
                    stem = q[:mm.start()] + "#" + q[mm.end():]
                    keyed.append((stem, k, m))
                    continue
                mm = rx.search(q)
                if not mm:
                    continue
                if kind == "by":
                    # the year of a date written without one: the end date's, read in US Eastern time (a
                    # "by Dec 31" market ends at 04:59 UTC on January 1 of the next year)
                    end = m.get("endDate") or "2026-06-01T00:00:00Z"
                    try:
                        yh = datetime.fromtimestamp(datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp() - 12 * 3600).year
                    except ValueError:
                        yh = int(end[:4])
                    k = parse_date(mm.group(1), yh)
                else:
                    k = num(mm)
                if k is None:
                    continue
                stem = rx.sub("#", q)
                keyed.append((stem, k, m))
            stems = defaultdict(list)
            for stem, k, m in keyed:
                stems[stem].append((k, m))
            for stem, rungs in stems.items():
                if len(rungs) >= 2 and len({k for k, _ in rungs}) == len(rungs):
                    ladders.append((kind, eid, sorted(rungs, key=lambda x: x[0])))
    toks = []
    for _, _, rungs in ladders:
        for _, m in rungs:
            try:
                toks.append(json.loads(m["clobTokenIds"])[0])
            except (ValueError, TypeError, IndexError):
                pass
    books = {}
    for i in range(0, len(toks), 100):
        for b in pmnet.post(CLOB + "/books", [{"token_id": t} for t in toks[i:i + 100]]):
            books[b.get("asset_id")] = b
    pairs, viol = 0, []
    for kind, eid, rungs in ladders:
        tops = []
        for k, m in rungs:
            try:
                b = books.get(json.loads(m["clobTokenIds"])[0])
            except (ValueError, TypeError, IndexError):
                b = None
            if not b or not b.get("bids") or not b.get("asks"):
                tops.append(None)
                continue
            bb = max(fnum(o["price"]) for o in b["bids"])
            ba = min(fnum(o["price"]) for o in b["asks"])
            r = fnum((m.get("feeSchedule") or {}).get("rate"), 0.0) if m.get("feesEnabled") else 0.0
            tops.append((bb, ba, r, m))
        # "up": a lower threshold is at least as likely; "down": a higher one is; "by": a later date is
        order = list(range(len(rungs)))
        for i in order:
            for j in order:
                if i == j or tops[i] is None or tops[j] is None:
                    continue
                likelier = (i < j) if kind == "up" else (i > j)
                if kind == "by":
                    likelier = i > j
                if not likelier:
                    continue
                pairs += 1
                bb_i, ba_i, r_i, m_i = tops[i]
                bb_j, ba_j, r_j, m_j = tops[j]
                cost = ba_i + (1 - bb_j) + r_i * ba_i * (1 - ba_i) + r_j * (1 - bb_j) * bb_j
                if cost < 1:
                    viol.append({"kind": kind, "event": eid, "likelier": (m_i.get("question") or "")[:90], "ask_likelier": ba_i,
                                 "other": (m_j.get("question") or "")[:90], "bid_other": bb_j, "edge_per_share": round(1 - cost, 4),
                                 "end": m_i.get("endDate")})
    out = {"ladders": len(ladders), "by_kind": {k: sum(1 for x in ladders if x[0] == k) for k in ("up", "down", "by")},
           "rung_pairs_checked": pairs, "violations_after_fees": len(viol),
           "violations": sorted(viol, key=lambda v: -v["edge_per_share"])[:30]}
    pmnet.dump(outp, out)
    print(json.dumps({k: v for k, v in out.items() if k != "violations"}, indent=1))
    for v in out["violations"][:10]:
        print(v)


if __name__ == "__main__":
    main()
