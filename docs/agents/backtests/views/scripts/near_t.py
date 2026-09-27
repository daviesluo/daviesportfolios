"""VIEWS: where the price goes near the deadline T, on the exploration events (question 2 of the brief).

For every exploration event with an estimated deadline (`posting.py`; `p_confidence` high enters the headline, low is
reported apart), at T − 6 h, − 1 h, − 15 min, − 5 min, T, + 2, + 5 and + 15 min:

* the eventual winner's book midpoint (the CLOB's minute `/prices-history`, the last point at or before the instant);
* whether the market's favourite (the highest midpoint) is the winner;
* the stale side, from the prints (the resting book is not archived; what traded against it is): in the quarter hour
  after each instant, the shares and dollars of edge a taker took from the side the outcome makes wrong — a loser's
  YES bought by a resting bid (a taker selling it, or buying its NO) at y, edge y a share; the winner's YES sold by a
  resting ask (a taker buying it) at y, edge 1 − y — at a gross edge of at least 1¢.

A binary event (one market) has "the winner" as its winning side. Metadata and midpoints only; P&L is `stale_late.py`.

usage: near_t.py <universe json> <split json> <posting json> <out json>
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

POINTS = [("T-6h", -21600), ("T-1h", -3600), ("T-15m", -900), ("T-5m", -300), ("T", 0), ("T+2m", 120), ("T+5m", 300),
          ("T+15m", 900)]
G_MIN = 0.01
STALE_WIN_S = 900


def yes_view(side, oi, price):
    """A print as the YES token's taker side and price: a NO buy at q is a YES sell at 1 − q."""
    if oi == 0:
        return side, price
    if oi == 1:
        return ("SELL" if side == "BUY" else "BUY"), 1.0 - price
    return None, None


def stale(rows_by_cond, markets, t0, t1, g_min=G_MIN):
    """Shares, gross edge ($) and prints on the stale side between t0 and t1, over every market of the event."""
    sh = edge = n = 0.0
    for m in markets:
        if m["payout_yes"] not in (0.0, 1.0):
            continue
        won = m["payout_yes"] == 1.0
        for r in rows_by_cond.get(m["cond"], ()):
            if r[0] < t0 or r[0] >= t1:
                continue
            side, y = yes_view(r[2], r[3], r[4])
            if side is None:
                continue
            if won and side == "BUY" and 1 - y >= g_min:
                sh += r[5]; edge += r[5] * (1 - y); n += 1
            elif not won and side == "SELL" and y >= g_min:
                sh += r[5]; edge += r[5] * y; n += 1
    return round(sh, 2), round(edge, 2), int(n)


def main():
    uni = {e["event"]: e for e in V.jfile(sys.argv[1])["events"]}
    split = V.jfile(sys.argv[2])
    held = set(split["held_out_events"])
    post = V.jfile(sys.argv[3])["events"]
    rows_out = []
    for r in post:
        eid = r["event"]
        if eid in held or r.get("T") is None:
            continue
        e = uni[eid]
        T = r["T"]
        hist = V.mids(eid)
        prints = V.prints(eid)
        by_cond = defaultdict(list)
        for p in prints:
            by_cond[p[1]].append(p)
        mk = [m for m in e["markets"] if m.get("yes") and hist.get(m["yes"])]
        binary = len(e["markets"]) == 1
        win = [m for m in mk if m["payout_yes"] == 1.0]

        def mid(m, t):
            h = hist[m["yes"]]
            x = None
            for tt, p in h:
                if tt <= t:
                    x = p
                else:
                    break
            return x
        pts = {}
        for name, dt in POINTS:
            t = T + dt
            mids = {m["cond"]: mid(m, t) for m in mk}
            if binary and mk:
                y = mids[mk[0]["cond"]]
                wp = None if y is None else (y if mk[0]["payout_yes"] == 1.0 else 1 - y)
                fav_ok = None if y is None else ((y >= 0.5) == (mk[0]["payout_yes"] == 1.0))
            else:
                wp = mids.get(win[0]["cond"]) if win else None
                valid = {c: p for c, p in mids.items() if p is not None}
                fav_ok = (max(valid, key=valid.get) == win[0]["cond"]) if (valid and win) else None
            pts[name] = {"winner_mid": wp, "favourite_is_winner": fav_ok,
                         "stale_next_15m": stale(by_cond, e["markets"], t, t + STALE_WIN_S)}
        # when the market had it: the last minute before T + 15 min at which the winner's midpoint was below 0.95
        # (0.99); "decided" is the next minute, in seconds before T (a negative value is after T)
        decided = {}
        if win and not binary:
            h = [(tt, p) for tt, p in hist[win[0]["yes"]] if tt <= T + 900]
            for th in (0.95, 0.99):
                below = [tt for tt, p in h if p < th]
                decided[str(th)] = (None if not h else (round(T - h[0][0]) if not below else
                                    round(T - next((tt for tt, p in h if tt > below[-1]), T + 900))))
        rows_out.append({
            "event": eid, "slug": e["slug"], "channel": e["channel"], "window_h": r.get("window_used"),
            "decided_s_before_T": decided,
            "T_utc": r["T_utc"], "p_source": r["p_source"], "p_confidence": r["p_confidence"],
            "binary": binary, "volume": e["volume"], "fees": max((m["fee_rate"] for m in e["markets"]), default=0),
            "winner": e["winner"], "brackets": len(e["markets"]), "points": pts,
            "stale_after_T_to_close": stale(by_cond, e["markets"], T, 10 ** 11),
            "stale_T-5m_to_T": stale(by_cond, e["markets"], T - 300, T),
            "stale_T-15m_to_T-5m": stale(by_cond, e["markets"], T - 900, T - 300),
            "stale_T-1h_to_T-15m": stale(by_cond, e["markets"], T - 3600, T - 900),
        })

    def summarise(rows):
        s = {"events": len(rows)}
        for name, _ in POINTS:
            w = [x["points"][name]["winner_mid"] for x in rows if x["points"][name]["winner_mid"] is not None]
            f = [x["points"][name]["favourite_is_winner"] for x in rows if x["points"][name]["favourite_is_winner"] is not None]
            w.sort()
            q = lambda p: round(w[min(len(w) - 1, int(p * len(w)))], 4) if w else None  # noqa: E731
            s[name] = {"n": len(w), "winner_mid_p10": q(0.1), "winner_mid_p25": q(0.25), "winner_mid_median": q(0.5),
                       "share_winner_below_0.5": round(sum(1 for x in w if x < 0.5) / len(w), 4) if w else None,
                       "share_winner_below_0.8": round(sum(1 for x in w if x < 0.8) / len(w), 4) if w else None,
                       "share_winner_below_0.95": round(sum(1 for x in w if x < 0.95) / len(w), 4) if w else None,
                       "share_winner_below_0.99": round(sum(1 for x in w if x < 0.99) / len(w), 4) if w else None,
                       "favourite_is_winner": round(sum(f) / len(f), 4) if f else None,
                       "stale_next_15m_edge_usd": round(sum(x["points"][name]["stale_next_15m"][1] for x in rows), 2),
                       "stale_next_15m_events_with_any": sum(1 for x in rows if x["points"][name]["stale_next_15m"][2] > 0)}
        for k in ("stale_after_T_to_close", "stale_T-5m_to_T", "stale_T-15m_to_T-5m", "stale_T-1h_to_T-15m"):
            s[k] = {"edge_usd": round(sum(x[k][1] for x in rows), 2), "shares": round(sum(x[k][0] for x in rows), 2),
                    "prints": sum(x[k][2] for x in rows), "events_with_any": sum(1 for x in rows if x[k][2] > 0)}
        for th in ("0.95", "0.99"):
            d = sorted(x["decided_s_before_T"].get(th) for x in rows if x["decided_s_before_T"].get(th) is not None)
            if d:
                s[f"decided_{th}"] = {"n": len(d), "median_s_before_T": d[len(d) // 2],
                                      "share_decided_after_T-1h": round(sum(1 for v in d if v < 3600) / len(d), 4),
                                      "share_decided_after_T-15m": round(sum(1 for v in d if v < 900) / len(d), 4),
                                      "share_decided_after_T-5m": round(sum(1 for v in d if v < 300) / len(d), 4),
                                      "share_decided_after_T": round(sum(1 for v in d if v <= 0) / len(d), 4)}
        # a close call: the winner under 0.95 at T - 15 min
        cc = [x for x in rows if (x["points"]["T-15m"]["winner_mid"] if x["points"]["T-15m"]["winner_mid"] is not None else 1) < 0.95]
        s["close_calls_winner_below_0.95_at_T-15m"] = {"events": len(cc), "share": round(len(cc) / len(rows), 4) if rows else None,
                                                       "slugs": [x["slug"] for x in cc]}
        by_w = defaultdict(lambda: [0, 0])
        for x in rows:
            k = "day-1" if x["window_h"] == 24 else ("week-1" if x["window_h"] == 168 else ("days 2-6" if x["window_h"] else "clock"))
            by_w[k][0] += 1
            by_w[k][1] += int(x in cc)
        s["close_calls_by_window"] = {k: {"events": v[0], "close_calls": v[1]} for k, v in sorted(by_w.items())}
        return s
    hi = [x for x in rows_out if x["p_confidence"] == "high"]
    lo = [x for x in rows_out if x["p_confidence"] != "high"]
    out = {"rule": {"g_min": G_MIN, "stale_window_s": STALE_WIN_S, "points": [p[0] for p in POINTS],
                    "midpoint": "CLOB /prices-history fidelity 1, last point at or before the instant"},
           "summary_high": summarise(hi), "summary_low": summarise(lo), "events": rows_out}
    with open(sys.argv[4], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps(out["summary_high"], indent=1))


if __name__ == "__main__":
    main()
