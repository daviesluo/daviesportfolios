"""VIEWS: in the close calls, when the market turned to the eventual winner, and how fast the stale side went after.

A close call is an exploration event (high-confidence T) whose winner's midpoint was under 0.95 at T − 15 min. Its
flip is the first print, from T − 15 min on, after which the winner's YES never traded below 0.5 again before
T + 15 min: the moment the market's majority turned. History has no counter, so the flip stands in for the batch that
decided the count (the recorder will place that batch to the second). From the flip, the stale side's gross edge
(the same definition as `stale_late.py`, edge ≥ 1¢) still untaken 0…300 s later, second by second, and the bound a
reader acting at flip + δ could have taken with PMLATE's fill (half of each later stale print, $100 a market, fees).

Descriptive, exploration months only; the flip is found with hindsight (the winner is known), so this measures the
race after the turn, not a rule.

usage: flips.py <universe json> <split json> <posting json> <near_t json> <out json>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402
from near_t import yes_view  # noqa: E402
from stale_late import stale_prints, rule  # noqa: E402

DELTAS = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300]


def main():
    uni = {e["event"]: e for e in V.jfile(sys.argv[1])["events"]}
    held = set(V.jfile(sys.argv[2])["held_out_events"])
    post = {r["event"]: r for r in V.jfile(sys.argv[3])["events"]}
    nt = V.jfile(sys.argv[4])["events"]
    out = []
    agg = {d: 0.0 for d in DELTAS}
    agg_total = 0.0
    for x in nt:
        if x["event"] in held or x["p_confidence"] != "high" or x["binary"]:
            continue
        w = x["points"]["T-15m"]["winner_mid"]
        if w is None or w >= 0.95:
            continue
        e, T = uni[x["event"]], post[x["event"]]["T"]
        win = next(m for m in e["markets"] if m["payout_yes"] == 1.0)
        rows = V.prints(x["event"])
        wp = []
        for r in rows:
            if r[1] == win["cond"] and T - 900 <= r[0] <= T + 900:
                side, y = yes_view(r[2], r[3], r[4])
                if side is not None:
                    wp.append((r[0], y))
        below = [t for t, y in wp if y < 0.5]
        after = [t for t, y in wp if below and t > below[-1] and y >= 0.5]
        if not after:
            # the winner never traded under 0.5 in the half hour: no flip to time; recorded, not profiled
            out.append({"event": x["event"], "slug": e["slug"], "T_utc": x["T_utc"], "flip_minus_T_s": None,
                        "winner_mid_T-15m": w, "note": "winner never traded under 0.5 from T-15 min to T+15 min",
                        "decided_s_before_T": x.get("decided_s_before_T")})
            continue
        f = after[0]
        sp = [s for s in stale_prints(e, rows, f) if s[4] >= 0.01]
        tot = sum(s[3] * s[4] for s in sp)
        prof = {d: round(sum(s[3] * s[4] for s in sp if s[0] >= f + d), 2) for d in DELTAS}
        agg_total += tot
        for d in DELTAS:
            agg[d] += prof[d]
        rec = {"event": x["event"], "slug": e["slug"], "T_utc": x["T_utc"], "flip_minus_T_s": int(f - T),
               "winner_mid_T-15m": w, "stale_edge_from_flip_usd": round(tot, 2), "untaken_usd_at_flip_plus": prof,
               "rule_pnl_from_flip_plus": {str(d): round(sum(z["pnl"] for z in rule(e, rows, f + d)), 2) for d in (1, 2, 5, 10, 30, 60)}}
        out.append(rec)
    res = {"close_calls": len(out), "flips": sum(1 for r in out if r["flip_minus_T_s"] is not None),
           "stale_edge_from_flip_usd": round(agg_total, 2),
           "share_untaken_at_flip_plus": {str(d): round(agg[d] / agg_total, 4) if agg_total else None for d in DELTAS},
           "events": out}
    with open(sys.argv[5], "w") as f_:
        json.dump(res, f_, indent=1, sort_keys=True)
        f_.write("\n")
    print(json.dumps({k: res[k] for k in ("close_calls", "flips", "stale_edge_from_flip_usd", "share_untaken_at_flip_plus")}, indent=1))
    for r in out:
        print(r["slug"][:50], r["flip_minus_T_s"], r.get("stale_edge_from_flip_usd"), r.get("rule_pnl_from_flip_plus"),
              r.get("decided_s_before_T"))


if __name__ == "__main__":
    main()
