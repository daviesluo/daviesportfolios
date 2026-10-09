"""L3: a maker on the live recording, quoting both sides of each window's Up book around the model's fair price and
re-quoting once a second, its quotes live LAMBDA seconds after the second they were computed at (the loop's reaction
time: 0.7-1.0 s for an Edge loop each second, reference 3.39; 0.2 s for an always-on Worker with a socket).

Quote: Up bid = fair - h, Up ask = fair + h, rounded outward to the 1 c tick, post-only (never crossing the touch the
quote lands on), $SIZE a side, only while the window has more than 10 s left and 0.05 < fair < 0.95. A taker print (the WS side is the taker's side: checked in the review)
fills a quote when it trades THROUGH it (strictly better for the taker than our price: our order would have been
ahead of the level it hit), or, the optimistic bracket, AT or through it. Filled size: the print's size, up to what is
left of the quote. P&L to the outcome; maker rebate estimated as 20 % of the fill's fee-equivalent (pm_fees.ts);
markouts at the Up mid 5 s and 30 s later. Usage: l3_maker.py ref.jsonl clob.jsonl binance_1s.json.gz outcomes.json out.json"""
import json, sys, os, math, bisect, random, statistics as st
sys.path.insert(0, os.path.dirname(__file__)); import model
import importlib.util
spec = importlib.util.spec_from_file_location("l2", os.path.join(os.path.dirname(__file__), "l2_opportunities.py"))
# reuse L2's fair price and book readers without running its scan: load its definitions only
src = open(spec.origin).read().split("MARGINS = (0.0, 0.02, 0.05)")[0]
sys.argv = [sys.argv[0], sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]]
G = {"__file__": spec.origin}; exec(compile(src, spec.origin, "exec"), G)
fair_up, book_at, clob, OUTC = G["fair_up"], G["book_at"], G["clob"], G["OUTC"]
t_lo = max(G["cb"][0][0], G["cl_recv"][0][0]) + 130000; t_hi = min(G["cb"][-1][0], G["cl_recv"][-1][0])
prints = {}
for r in clob:
    if r["k"] == "tr":
        pu = r["p"] if r["a"] == "Up" else round(1 - r["p"], 6)
        taker_buys_up = (r["a"] == "Up") == (r["sd"] == "BUY")
        prints.setdefault(r["m"], []).append((r["t"], pu, taker_buys_up, r["s"]))
def mid_up(m, t):
    b = book_at(m, t)
    return (b[1][0][0] + b[2][0][0]) / 2 if b and b[1] and b[2] else None
out = {"hours": round((t_hi - t_lo) / 3.6e6, 3)}
for LAM in (0.2, 1.0):
    for h in (0.01, 0.02, 0.03, 0.05):
        for mode in ("through", "at"):
            SIZE = 100.0; tot = {"fills": 0, "shares": 0.0, "pnl": 0.0, "rebate": 0.0, "mk5": 0.0, "mk30": 0.0, "notional": 0.0}; perw = {}
            for slug, pr in prints.items():
                if not slug.startswith("btc-updown-"): continue
                o = OUTC.get(slug)
                if not o or o.get("up_won") is None or o.get("priceToBeat") is None: continue
                dur = 300 if "-5m-" in slug else 900; s = int(slug.rsplit("-", 1)[1]); e = s + dur
                pt = [x[0] for x in pr]
                for sec in range(max(s, t_lo // 1000 + 1), min(e - 10, t_hi // 1000)):
                    q = fair_up(sec * 1000, s, e, o["priceToBeat"])
                    if q is None or not (0.05 < q < 0.95): continue
                    bid = math.floor((q - h) * 100 + 1e-9) / 100; ask = math.ceil((q + h) * 100 - 1e-9) / 100
                    a0, a1 = sec * 1000 + int(LAM * 1000), (sec + 1) * 1000 + int(LAM * 1000)
                    # post-only, as the repo's Polymarket order path posts: a quote that would cross the book as it
                    # stands when it lands is moved one tick behind the other side's touch
                    bk = book_at(slug, a0)
                    if not bk or not bk[1] or not bk[2]: continue
                    bid = min(bid, round(bk[2][0][0] - 0.01, 2)); ask = max(ask, round(bk[1][0][0] + 0.01, 2))
                    if bid <= 0 or ask >= 1: continue
                    left = {"bid": SIZE / bid if bid > 0 else 0, "ask": SIZE / (1 - ask) if ask < 1 else 0}
                    for i in range(bisect.bisect_left(pt, a0), bisect.bisect_left(pt, a1)):
                        t, pu, buy_up, sz = pr[i]
                        if buy_up and (pu > ask + 1e-9 or (mode == "at" and abs(pu - ask) < 1e-9)) and left["ask"] > 0:
                            n = min(sz, left["ask"]); left["ask"] -= n
                            y = 0 if o["up_won"] else 1; px = 1 - ask  # we sold Up at ask = bought Down at 1 - ask
                            mk = [mid_up(slug, t + H) for H in (5000, 30000)]
                            mk = [(1 - v) if v is not None else y for v in mk]
                        elif (not buy_up) and (pu < bid - 1e-9 or (mode == "at" and abs(pu - bid) < 1e-9)) and left["bid"] > 0:
                            n = min(sz, left["bid"]); left["bid"] -= n
                            y = 1 if o["up_won"] else 0; px = bid
                            mk = [mid_up(slug, t + H) for H in (5000, 30000)]
                            mk = [v if v is not None else y for v in mk]
                        else:
                            continue
                        reb = 0.2 * model.fee(px) * n; pnl = n * (y - px) + reb
                        tot["fills"] += 1; tot["shares"] += n; tot["pnl"] += pnl; tot["rebate"] += reb; tot["notional"] += n * px
                        tot["mk5"] += n * (mk[0] - px) + reb; tot["mk30"] += n * (mk[1] - px) + reb
                        perw[slug] = perw.get(slug, 0.0) + pnl
            rng = random.Random(7); v = list(perw.values())
            bt = sorted(sum(rng.choice(v) for _ in v) for _ in range(2000)) if len(v) > 1 else None
            out[f"lambda{LAM}|h{h}|{mode}"] = {"fills": tot["fills"], "windows": len(perw), "notional_usd": round(tot["notional"]), "pnl_usd": round(tot["pnl"], 2),
                "pnl_per_usd": round(tot["pnl"] / tot["notional"], 4) if tot["notional"] else None, "rebate_usd": round(tot["rebate"], 2),
                "markout5s_per_usd": round(tot["mk5"] / tot["notional"], 4) if tot["notional"] else None, "markout30s_per_usd": round(tot["mk30"] / tot["notional"], 4) if tot["notional"] else None,
                "pnl_usd_per_day": round(tot["pnl"] / out["hours"] * 24), "boot_p5_p95_usd": [round(bt[100], 1), round(bt[1900], 1)] if bt else None}
json.dump(out, open(sys.argv[5], "w"), indent=1, sort_keys=True)
for k, v in out.items(): print(k, v)
