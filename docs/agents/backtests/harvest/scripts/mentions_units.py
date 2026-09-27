"""HARVEST, mentions ("what will X say during Z"): the confirmation instant C and the confirmed outcome of every
exploration market.

No public source dates the end of these events to the second: the rules name a scheduled start at most ("9PM ET on
April 1"), and the resolution source is the video, which no keyless feed transcribes with timestamps. The one public,
timestamped record that the result is known is the UMA proposal (on chain, and shown on the market page as
"proposed"): UMA's liveness on these markets is two hours, so an undisputed market's proposal came at or before its
close − 2 h. C = close − 7200 s is therefore an instant at which the outcome had been publicly proposed — later than
the event's end, so everything measured from it is a lower bound on what the end of the event left.

The confirmed outcome is the proposal standing at C, which for an undisputed market is the result. A disputed market
(`umaResolutionStatuses` holds "disputed") is read once from the data API's `/v2/resolutions?condition=`: its first
proposal (`proposed_price`) against the final `price` says whether a harvester following the first proposal was
trapped. Those markets are listed with that flag and left out of the measured units (`record_ok: false`): the first
proposal's instant is in no keyless record, and close − 2 h on a disputed market is after the last proposal, which
would count the dispute's resolution as the confirmation.
YES and NO outcomes are kept apart (`w`): a YES mention can be confirmed as soon as it is said, a NO only after the
event, and neither has a keyless timestamped transcript here.

usage: mentions_units.py <universe other> <split json> <out units json> <out floors json>
"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402

LIVENESS = 7200


def first_proposal(cond):
    path = os.path.join(H.DATA, "res", cond + ".json")
    if not H.exists(path):
        H.dump(path, H.pmnet.get(H.DATA_API + "/v2/resolutions", {"condition": cond, "_": H.bust()}))
    rows = H.load(path).get("data") or []
    if not rows:
        return None, None
    r = rows[0]
    f = lambda x: None if x in (None, "") else (0 if int(x) >= 5 * 10 ** 17 else 1)  # noqa: E731
    return f(r.get("proposed_price")), r


def main():
    uni = H.jfile(sys.argv[1])["events"]
    split = H.jfile(sys.argv[2])
    units, floors, disputed = [], {}, []
    skipped = Counter()
    for eid in sorted(split["categories"]["mentions"]["exploration"], key=int):
        e = uni[eid]
        cs = []
        for m in e["markets"]:
            r = H.winner_index(m)
            if r is None or m["closed_time"] is None:
                skipped["not_one_winner"] += 1
                continue
            c = m["closed_time"] - LIVENESS
            p1 = None
            if "disputed" in m["uma"]:
                p1, rec = first_proposal(m["cond"])
                disputed.append({"event": eid, "cond": m["cond"], "q": m["q"][:120], "uma": m["uma"],
                                 "first_proposal": p1, "final": r, "first_overturned": p1 is not None and p1 != r,
                                 "volume": m["vol"]})
            cs.append(c)
            units.append({"cat": "mentions", "event": eid, "cond": m["cond"], "title": m["title"], "q": m["q"][:120],
                          "C": c, "kind": "yes" if r == 0 else "no", "w": r, "r": r, "closed": m["closed_time"],
                          "fees": m["fees"], "fee_rate": m["fee_rate"], "fee_exp": m["fee_exp"] or 1,
                          "rebate": m["rebate"], "tick": m["tick"], "series": (e["series"] or [None])[0],
                          "first_proposal_overturned": bool(p1 is not None and p1 != r),
                          "record_ok": "disputed" not in m["uma"]})
        if cs:
            floors[eid] = int(min(cs) - 3600)
    out = {"category": "mentions", "C_rule": "market close - 7200 s (UMA liveness): the outcome publicly proposed",
           "units": units, "disputed": disputed, "skipped": dict(skipped),
           "first_proposal_overturned": {"markets": len(units), "disputed": len(disputed),
                                          "overturned": sum(1 for d in disputed if d["first_overturned"]),
                                          "overturned_volume": round(sum(d["volume"] for d in disputed
                                                                         if d["first_overturned"]), 2)}}
    H.write_json(sys.argv[3], out)
    H.write_json(sys.argv[4], {"floors": floors})
    print("events", len(floors), "units", len(units), "yes", sum(1 for u in units if u["w"] == 0),
          "disputed", len(disputed), out["first_proposal_overturned"], dict(skipped))


if __name__ == "__main__":
    main()
