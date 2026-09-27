"""VIEWS: the PMLATE question for views — what the stale side leaves once the deadline has fixed the count (question 3).

At the deadline T the count is the last batch the API published before it (the recorder: batches ~5 minutes apart, so
up to 5 minutes early). From T on, every bracket is decided: the winner's YES is worth 1, every other YES 0. History
has no counter, so the winner stands in for the count at T; that is exact when the resolution followed the counter at
T, and the cases where it may not are the resolution risk (`resolution.py`).

For every exploration event with a high-confidence T (`posting.py`), the stale-side prints after T + δ — a loser's YES
sold to a resting bid at y (a taker selling it, or buying its NO at 1 − y), a gross edge of y a share; the winner's
YES bought from a resting ask at y, an edge of 1 − y — with:

* the time profile: of all the stale side's gross edge after T, the share still untaken at T + δ, δ from 1 s to 1 h
  (the data API stamps a print ~2 s after its match, reference §3.39, so a print at T + 1 s may have matched at T − 1 s);
* PMLATE's fill model (USLATE's, frozen there): from T + δ, each stale print with an edge of at least 1¢ fills us
  for HALF its size at its own price (the loser's NO at 1 − y, the winner's YES at y), in time order, until the market
  has cost $100; each market's own fee, shares × rate × (p (1 − p)) ** exponent at the fill price p; held to
  resolution. P&L by event and by date, and the capital, annualised on the peak.

Descriptive, no bar: this is exploration. The months are 2025-03 → 2026-05 (the split); 2026-06 → 09 is held out.

usage: stale_late.py <universe json> <split json> <posting json> <out json>
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402
from near_t import yes_view  # noqa: E402

DELAYS = [1, 2, 5, 10, 30, 60, 120, 300, 900, 3600]
CAP_USD = 100.0
SHARE = 0.5
G_MIN = 0.01


def fee(rate, exp, p):
    return (rate or 0.0) * (p * (1.0 - p)) ** (exp or 1)


def stale_prints(e, rows, t0):
    """Every stale print of the event at or after t0: (ts, market cond, our price, shares printed, gross edge a share,
    fee rate, fee exponent)."""
    out = []
    mk = {m["cond"]: m for m in e["markets"] if m["payout_yes"] in (0.0, 1.0)}
    for r in rows:
        if r[0] < t0 or r[1] not in mk:
            continue
        m = mk[r[1]]
        side, y = yes_view(r[2], r[3], r[4])
        if side is None:
            continue
        if m["payout_yes"] == 1.0 and side == "BUY":
            g, px = 1.0 - y, y
        elif m["payout_yes"] == 0.0 and side == "SELL":
            g, px = y, 1.0 - y
        else:
            continue
        if g <= 0:
            continue
        out.append((r[0], r[1], px, r[5], g, m["fee_rate"], m["fee_exp"]))
    return out


def rule(e, rows, act, g_min=G_MIN, share=SHARE, cap=CAP_USD):
    """PMLATE's fill: half of each later stale print (edge ≥ g_min) at its own price, $100 a market, held to the payout."""
    spent = defaultdict(float)
    fills = []
    for ts, cond, px, size, g, rate, exp in stale_prints(e, rows, act):
        if g < g_min - 1e-12 or px >= 1.0:
            continue
        sh = share * size
        if spent[cond] + sh * px > cap:
            sh = (cap - spent[cond]) / px
        if sh <= 1e-9:
            continue
        spent[cond] += sh * px
        f = sh * fee(rate, exp, px)
        fills.append({"ts": ts, "cond": cond, "shares": sh, "price": px, "fee": f, "pnl": sh * (1.0 - px) - f})
    return fills


def main():
    uni = {e["event"]: e for e in V.jfile(sys.argv[1])["events"]}
    held = set(V.jfile(sys.argv[2])["held_out_events"])
    post = V.jfile(sys.argv[3])["events"]
    evs = [r for r in post if r["event"] not in held and r.get("p_confidence") == "high"]
    prof = defaultdict(float)     # gross edge still untaken at T + δ (whole prints)
    total_edge = 0.0
    per_event, arms = [], defaultdict(lambda: {"pnl": 0.0, "fills": 0, "markets": set(), "events": set(),
                                                "cost": 0.0, "by_date": defaultdict(float)})
    caps = []
    for r in evs:
        e = uni[r["event"]]
        rows = V.prints(r["event"])
        T = r["T"]
        sp = stale_prints(e, rows, T)
        edge = sum(s[3] * s[4] for s in sp if s[4] >= G_MIN)
        total_edge += edge
        for d in DELAYS:
            prof[d] += sum(s[3] * s[4] for s in sp if s[0] >= T + d and s[4] >= G_MIN)
        rec = {"event": r["event"], "slug": e["slug"], "T_utc": r["T_utc"], "stale_edge_after_T": round(edge, 2),
               "stale_prints_after_T": sum(1 for s in sp if s[4] >= G_MIN)}
        for d in DELAYS:
            fl = rule(e, rows, T + d)
            a = arms[d]
            p = sum(x["pnl"] for x in fl)
            a["pnl"] += p
            a["fills"] += len(fl)
            a["markets"] |= {x["cond"] for x in fl}
            if fl:
                a["events"].add(r["event"])
                a["by_date"][r["T_utc"][:10]] += p
            a["cost"] += sum(x["shares"] * x["price"] for x in fl)
            if d == 1:
                caps += [(x["ts"], x["shares"] * x["price"], (max(m["closed_time"] or 0 for m in e["markets"]) or T + 7200))
                         for x in fl]
            rec[f"rule_pnl_T+{d}s"] = round(p, 2)
        per_event.append(rec)
    # the capital the 1 s arm ties up: each fill's cost from its instant to its market's close, the peak of the sum
    evs_cap = sorted([(t, c) for t, c, _ in caps] + [(z, -c) for _, c, z in caps])
    cur = peak = 0.0
    for _, c in evs_cap:
        cur += c
        peak = max(peak, cur)
    days = 0
    ts_all = [r["T"] for r in evs]
    if ts_all:
        days = (max(ts_all) - min(ts_all)) / 86400
    out = {"events": len(evs), "span_days": round(days, 1), "total_stale_edge_after_T_usd": round(total_edge, 2),
           "share_untaken_at": {f"T+{d}s": round(prof[d] / total_edge, 4) if total_edge else None for d in DELAYS},
           "edge_untaken_usd_at": {f"T+{d}s": round(prof[d], 2) for d in DELAYS},
           "rule": {"share": SHARE, "cap_usd_per_market": CAP_USD, "g_min": G_MIN, "fees": "each market's schedule"},
           "arms": {}, "per_event": sorted(per_event, key=lambda x: -x["stale_edge_after_T"])}
    for d in DELAYS:
        a = arms[d]
        bd = dict(sorted(a["by_date"].items()))
        best = max(bd.items(), key=lambda kv: kv[1]) if bd else (None, 0.0)
        out["arms"][f"T+{d}s"] = {"pnl": round(a["pnl"], 2), "fills": a["fills"], "markets": len(a["markets"]),
                                  "events": len(a["events"]), "cost": round(a["cost"], 2),
                                  "best_date": best[0], "best_date_share": round(best[1] / a["pnl"], 4) if a["pnl"] > 0 else None,
                                  "by_date": {k: round(v, 2) for k, v in bd.items()}}
    # bounds, not rules: the same fill with no cap, from T + 1 s, and from T − 300 s (a reader who knew the final count
    # at the last batch, which lands up to five minutes before T — true only for the prints after that batch, so an
    # upper bound on what reading the batch at 1 s could take)
    for name, start, cap in (("uncapped_from_T+1s", 1, float("inf")), ("uncapped_from_T-300s_bound", -300, float("inf")),
                             ("capped_from_T-300s_bound", -300, CAP_USD)):
        tot, by_ev, n_f = 0.0, {}, 0
        for r in evs:
            e = uni[r["event"]]
            rows = V.prints(r["event"])
            fl = rule(e, rows, r["T"] + start, cap=cap)
            p = sum(x["pnl"] for x in fl)
            if fl:
                by_ev[e["slug"]] = round(p, 2)
            tot += p
            n_f += len(fl)
        best = max(by_ev.items(), key=lambda kv: kv[1]) if by_ev else (None, 0.0)
        out["arms"][name] = {"pnl": round(tot, 2), "fills": n_f, "events": len(by_ev), "best_event": best[0],
                             "best_event_share": round(best[1] / tot, 4) if tot > 0 else None,
                             "by_event": dict(sorted(by_ev.items(), key=lambda kv: -kv[1]))}
    out["arms"]["T+1s"]["peak_capital"] = round(peak, 2)
    out["arms"]["T+1s"]["annualised_on_peak"] = round(out["arms"]["T+1s"]["pnl"] / peak * 365 / days, 4) if peak and days else None
    with open(sys.argv[4], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps({k: out[k] for k in ("events", "span_days", "total_stale_edge_after_T_usd", "share_untaken_at",
                                          "edge_untaken_usd_at")}, indent=1))
    for d in DELAYS:
        a = out["arms"][f"T+{d}s"]
        print(d, a["pnl"], a["fills"], a["markets"], a["events"], a["best_date"], a["best_date_share"])
    for x in out["per_event"][:12]:
        print(x)


if __name__ == "__main__":
    main()
