# Q2 of params.json: are the Coinbase paper rows' fills realistic? For each paper entry fill of "with Euros" (base,
# cb_quote_trips) and "with Euros - 2" (hold, cb_hold_trips) in the window: (a) a print strictly beyond the rung in the fill's
# second; (b) post-only acceptance against the book read standing when the order went live; (c) where the rung sat in the
# book at the fill; (d) the paper size against 100 of the book's currency; (e) prints AT a live order's price that the
# through rule did not count, and whether Q1's pessimistic queue rule (back of the displayed size at go-live, cumulative
# size printed at the price against the order's side) would have filled it. Entry and exit orders both.
# python3 -I scripts/paper.py <raw dir>  ->  results/paper.json
import sys, os, json
from datetime import datetime, timezone
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load_cb, load_paper, T0_EPOCH, WIN_END_S

raw = sys.argv[1]
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
books, prints = load_cb(raw)
events, trips = load_paper(raw)


def secs(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() - T0_EPOCH


SC = {"USDT-EUR": 1e5}
def ticks_of(book, price):
    return int(round(price * SC.get(book, 1e4)))


# (a)-(d): each entry fill
fills = []
by_rung = {}
for e in events: by_rung.setdefault((e["arm"], e["book"], e["side"], e["k"]), []).append(e)
for k in by_rung: by_rung[k].sort(key=lambda e: e["t"])
for tr in trips:
    ft = secs(tr["fill_ts"])
    if not (0 <= ft < WIN_END_S): continue
    book, side, arm = tr["book"], tr["side"], tr["arm"]
    B, T = books[book], prints[book]
    tk = ticks_of(book, tr["entry"])
    evs = [e for e in by_rung.get((arm, book, side, tr["k"]), []) if e["kind"] == "order" and e["detail"].get("leg") == "entry"
           and e["detail"].get("oid") == tr["entry_oid"] and e["t"] < ft]
    live = (evs[-1]["t"] + 60) if evs else None
    s = int(np.floor(ft)); m = T.s == s
    beyond = (T.px[m] < tk) if side == "bid" else (T.px[m] > tk)
    i_live = B.at(live * 1000) if live is not None else -1
    acc = None
    if i_live >= 0:
        acc = bool(tk < B.a1[i_live]) if side == "bid" else bool(tk > B.b1[i_live])
    i_f = B.at(ft * 1000)
    sd = "b" if side == "bid" else "s"
    pos = None
    if i_f >= 0:
        Pv = B.bpx[i_f] if sd == "b" else B.apx[i_f]
        hit = np.nonzero(Pv == tk)[0]
        sz = B.size_at(i_f, sd, tk)
        dist = (B.b1[i_f] - tk) if sd == "b" else (tk - B.a1[i_f])
        pos = {"level": int(hit[0]) + 1 if hit.size else None, "size_at_price_coins": None if sz is None else sz / 100,
               "ticks_behind_touch": int(dist), "beyond_ten_levels": sz is None}
    size_ccy = tr["qty"] * tr["entry"]
    fills.append({"arm": arm, "book": book, "side": side, "k": tr["k"], "fill_s": ft, "ticks": tk, "live_s": live,
                  "a_through_print_in_second": bool(beyond.any()), "b_post_only_accepted": acc, "c": pos,
                  "d_size_ccy": round(size_ccy, 2), "how": tr["how"], "pnl_gbp": tr["pnl_gbp"]})

# (e): live intervals of every order, from the events
intervals = []
for key, evs in by_rung.items():
    arm, book, rside, k = key
    cur = None
    for j, e in enumerate(evs):
        t = e["t"]
        if cur is not None and cur.get("end") is None:
            if e["kind"] in ("order", "refused", "fill", "exit", "withdraw", "stop"):
                end = t
                if e["kind"] in ("fill", "exit"):
                    pts = e["detail"].get("print", {}).get("ts")
                    end = (pts / 1000.0 - T0_EPOCH) if isinstance(pts, (int, float)) else t + 60
                if e["kind"] == "refused": cur["refused"] = True
                cur["end"] = end
                cur["ended_by"] = e["kind"]
                intervals.append(cur); cur = None
        if e["kind"] == "order":
            leg = e["detail"].get("leg"); oside = rside if leg == "entry" else ("ask" if rside == "bid" else "bid")
            cur = {"arm": arm, "book": book, "rung_side": rside, "k": k, "leg": leg, "side": oside, "ticks": e["ticks"],
                   "live": t + 60, "end": None}
    if cur is not None:
        cur["end"] = WIN_END_S; cur["ended_by"] = "window"; intervals.append(cur)

res_e = {}
for iv in intervals:
    if iv.get("refused") or iv["end"] <= iv["live"] or iv["live"] >= WIN_END_S: continue
    B, T = books[iv["book"]], prints[iv["book"]]
    sd = "b" if iv["side"] == "bid" else "s"
    lo = np.searchsorted(T.s, int(np.ceil(iv["live"])), side="left")
    # a paper fill's own second is left out: a sweep through the order prints at its price in that second too
    hi = np.searchsorted(T.s, int(np.floor(iv["end"])) if iv["ended_by"] in ("fill", "exit") else iv["end"], side="left")
    px, mb, sz = T.px[lo:hi], T.mb[lo:hi], T.sz[lo:hi]
    mine = mb if sd == "b" else ~mb
    at = mine & (px == iv["ticks"])
    k = (iv["arm"], iv["leg"])
    r = res_e.setdefault(k, {"orders": 0, "paper_filled": 0, "with_at_price_print": 0, "queue_would_fill_unfilled": 0,
                             "queue_would_fill_earlier": 0, "queue_unknown_beyond_ten_levels": 0, "at_price_coins": 0.0})
    r["orders"] += 1
    filled = iv["ended_by"] in ("fill", "exit")
    r["paper_filled"] += int(filled)
    if not at.any(): continue
    r["with_at_price_print"] += 1
    r["at_price_coins"] += float(sz[at].sum()) / 100
    i0 = B.at(iv["live"] * 1000)
    if i0 < 0: continue
    ahead = B.size_at(i0, sd, iv["ticks"])
    if ahead is None:
        r["queue_unknown_beyond_ten_levels"] += 1; continue
    price = iv["ticks"] / (1e5 if iv["book"] == "USDT-EUR" else 1e4)
    q = 100.0 / price * 100                          # 100 of the book's currency, in hundredths of a coin
    cum = np.cumsum(np.where(at, sz, 0))
    if (cum >= ahead + q).any():
        if filled: r["queue_would_fill_earlier"] += 1
        else: r["queue_would_fill_unfilled"] += 1

summ = {}
for arm in ("base", "hold"):
    fa = [f for f in fills if f["arm"] == arm]
    if not fa: continue
    known = [f for f in fa if f["b_post_only_accepted"] is not None]
    cs = [f["c"] for f in fa if f["c"]]
    summ[arm] = {"entry_fills": len(fa), "a_through_print_found": sum(f["a_through_print_in_second"] for f in fa),
                 "b_post_only_accepted": sum(bool(f["b_post_only_accepted"]) for f in known), "b_checked": len(known),
                 "c_inside_ten_levels": sum(1 for c in cs if not c["beyond_ten_levels"]),
                 "c_ticks_behind_touch_median": float(np.median([c["ticks_behind_touch"] for c in cs])) if cs else None,
                 "c_ticks_behind_touch_min_max": [min(c["ticks_behind_touch"] for c in cs), max(c["ticks_behind_touch"] for c in cs)] if cs else None,
                 "d_size_full_100_share": round(sum(1 for f in fa if f["d_size_ccy"] >= 99.99) / len(fa), 3),
                 "d_size_median": float(np.median([f["d_size_ccy"] for f in fa])),
                 "by_book": {b: sum(1 for f in fa if f["book"] == b) for b in sorted({f["book"] for f in fa})},
                 "orders_e": {leg: res_e.get((arm, leg)) for leg in ("entry", "exit")}}
out = {"summary": summ, "fills": fills}
json.dump(out, open(os.path.join(HERE, "results", "paper.json"), "w"), indent=1)
print(json.dumps(summ, indent=1))
