"""PMLATE, the count family's universe: every closed post-count event (Gamma tag 972, "tweets-markets") and every
closed video-view event (the MrBeast week-1 series and the "youtube" tag) that ended in a date range, with its buckets.

Writes $PMLATE_DATA/count/universe_<from>_<to>.json: per event its series, title, window (from the title), end,
closed time, every bucket (count range, tokens, payout, fee schedule) and its volume.

usage: count_universe.py <from YYYY-MM-DD> <to YYYY-MM-DD, exclusive>
"""
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import count_common as K  # noqa: E402

TAGS = {"972": "posts", "146": "youtube"}


def main():
    d0, d1 = sys.argv[1], sys.argv[2]
    events = {}
    for tag, fam in TAGS.items():
        off = 0
        while True:
            page = C.pmnet.get(C.GAMMA + "/events", {"tag_id": tag, "closed": "true", "end_date_min": d0 + "T00:00:00Z",
                                                     "end_date_max": d1 + "T00:00:00Z", "limit": 100, "offset": off}) or []
            for ev in page:
                mk = []
                for m in ev.get("markets") or []:
                    try:
                        op = [float(x) for x in json.loads(m.get("outcomePrices") or "[]")]
                        toks = json.loads(m.get("clobTokenIds") or "[]")
                    except (ValueError, TypeError):
                        op, toks = [], []
                    fs = m.get("feeSchedule") or {}
                    mk.append({"cond": m.get("conditionId"), "q": (m.get("question") or "")[:140],
                               "title": m.get("groupItemTitle"), "bucket": K.count_bucket(m.get("question"), m.get("groupItemTitle")),
                               "yes": str(toks[0]) if toks else None, "payout_yes": op[0] if len(op) == 2 and m.get("closed") else None,
                               "closed_time": C.ts(m.get("closedTime")), "end": C.ts(m.get("endDate")),
                               "fee_rate": fs.get("rate") if m.get("feesEnabled") else 0.0, "vol": m.get("volumeNum") or 0})
                series = [s.get("slug") for s in ev.get("series") or []]
                events[str(ev.get("id"))] = {"event": str(ev.get("id")), "family": fam, "slug": ev.get("slug"),
                                             "title": ev.get("title"), "series": series[0] if series else None,
                                             "start": C.ts(ev.get("startDate")), "end": C.ts(ev.get("endDate")),
                                             "neg_risk": bool(ev.get("negRisk")), "markets": mk,
                                             "volume": sum(x["vol"] for x in mk)}
            if len(page) < 100:
                break
            off += 100
    C.dump_json(os.path.join(C.DATA, "count", f"universe_{d0}_{d1}.json"), {"events": events})
    by = Counter((e["family"], e["series"]) for e in events.values())
    vol = Counter()
    for e in events.values():
        vol[(e["family"], e["series"])] += e["volume"]
    for k, n in by.most_common(60):
        print(k, n, f"volume ${vol[k]:,.0f}")
    print("events", len(events))


if __name__ == "__main__":
    main()
