"""L4: how fast the Polymarket book answers a BTC move, and how often its touch changes (competition).
Event: Coinbase's mid moves >= X bps within 1 s (receive time), no other such event in the 5 s before. Response: the
first time after the event that the current 5m window's Up mid (or 15m's) has moved >= 1 tick (and >= 2 ticks) in
the move's direction from where it stood at the event, within 10 s; windows with < 20 s left are skipped.
Also: best-bid/ask price changes per minute, per book; and the depth a taker meets while the window is live and its Up
mid is 0.10-0.90: dollars to buy all of the Up ask at the touch (shares x price) and all of the Down ask there (the Up
bid's shares x (1 - bid)), for one level and for three, and how often the spread is one tick. Usage: l4_response.py ref.jsonl clob.jsonl out.json"""
import json, sys, bisect, statistics as st
ref = [json.loads(l) for l in open(sys.argv[1])]; clob = [json.loads(l) for l in open(sys.argv[2])]
cb = [(r["t"], (r["b"] + r["a"]) / 2) for r in ref if r["k"] == "cb"]; cbt = [x[0] for x in cb]
books = {}
for r in clob:
    if r["k"] == "bk" and r["m"].startswith("btc-updown-") and r["bb"] and r["ba"]:
        books.setdefault(r["m"], []).append((r["t"], (r["bb"][0][0] + r["ba"][0][0]) / 2, r["bb"][0][0], r["ba"][0][0]))
out = {}
for X in (1.0, 2.0, 3.0):
    ev = []; last = -10**12
    for i, (t, p) in enumerate(cb):
        j = bisect.bisect_left(cbt, t - 1000)
        if j < i and abs(p / cb[j][1] - 1) * 1e4 >= X and t - last > 5000:
            ev.append((t, 1 if p > cb[j][1] else -1)); last = t
    for dur in (300, 900):
        lat1, lat2, none = [], [], 0; n = 0
        for t, sgn in ev:
            s = (t // 1000) - (t // 1000) % dur; m = f"btc-updown-{dur // 60}m-{s}"
            if m not in books or s + dur - t / 1000 < 20: continue
            v = books[m]; vt = [x[0] for x in v]; k = bisect.bisect_right(vt, t) - 1
            if k < 0: continue
            m0 = v[k][1]; n += 1; got1 = got2 = None
            for tt, mid, b, a in v[k + 1:]:
                if tt > t + 10000: break
                if got1 is None and sgn * (mid - m0) >= 0.01 - 1e-9: got1 = tt - t
                if got2 is None and sgn * (mid - m0) >= 0.02 - 1e-9: got2 = tt - t; break
            if got1 is None: none += 1
            else: lat1.append(got1)
            if got2 is not None: lat2.append(got2)
        q = lambda v, p: round(sorted(v)[int(p * len(v))] / 1000, 3) if v else None
        out[f"move>={X}bps|{dur // 60}m"] = {"events": n, "answered_1tick_within_10s": len(lat1), "not_answered": none,
            "lat_1tick_s_p25_p50_p90": [q(lat1, .25), q(lat1, .5), q(lat1, .9)], "lat_2tick_s_p50": q(lat2, .5)}
rates = {}
for m, v in books.items():
    ch = sum(1 for a, b in zip(v, v[1:]) if (a[2], a[3]) != (b[2], b[3]))
    span = (v[-1][0] - v[0][0]) / 60000
    if span > 1: rates.setdefault("5m" if "-5m-" in m else "15m", []).append(ch / span)
out["touch_price_changes_per_minute_median"] = {k: round(st.median(v), 1) for k, v in rates.items()}
dep = {}
for r in clob:
    if r["k"] == "bk" and r["m"].startswith("btc-updown-") and r["bb"] and r["ba"]:
        D = 300 if "-5m-" in r["m"] else 900; s0 = int(r["m"].rsplit("-", 1)[1])
        b, bs = r["bb"][0]; a, as_ = r["ba"][0]
        if not (s0 * 1000 <= r["t"] < (s0 + D) * 1000 and 0.1 <= (a + b) / 2 <= 0.9): continue
        x = dep.setdefault(f"{D // 60}m", [[], [], [], [], []])
        x[0].append(as_ * a); x[1].append(bs * (1 - b))
        x[2].append(sum(p * q for p, q in r["ba"])); x[3].append(sum((1 - p) * q for p, q in r["bb"])); x[4].append(a - b <= 0.0101)
out["depth_usd_median"] = {k: {"up_ask_touch": round(st.median(v[0])), "down_ask_touch": round(st.median(v[1])), "up_ask_3_levels": round(st.median(v[2])),
                               "down_ask_3_levels": round(st.median(v[3])), "one_tick_spread_share": round(sum(v[4]) / len(v[4]), 3), "book_records": len(v[0])} for k, v in dep.items()}
json.dump(out, open(sys.argv[3], "w"), indent=1, sort_keys=True)
for k, v in out.items(): print(k, v)
