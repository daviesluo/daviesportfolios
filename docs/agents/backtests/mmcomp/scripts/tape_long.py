# MMCOMP part 1: Revolut X's UK GBP stablecoin books over their whole committed tape (USDC-GBP 2025-10-01, USDT-GBP 2025-12-10,
# to 2026-10-29 00:00 UTC), day by day and week by week, from prints alone (no book history exists before 2026-09-26):
#   gap60    the median price gap, in bps, between a buy print and the sell print next to it within 60 s (buy minus sell);
#            PR5's study's measure of the touch
#   hspread  each hour with prints on both sides: median(buy price vs fair) - median(sell price vs fair), the median hour, bps;
#            fair = Revolut X's USD book's 24-hour median close / GBP/USD
#   buy/sell where buys and sells print against fair (median bps)
#   beta     how far a side's print price follows fair between two prints of that side 1-30 minutes apart (OLS slope of
#            dln price on dln fair, prints of GBP 1 or more); 1 = the quote is re-priced with GBP/USD, 0 = it stands still
#   follow   of those pairs with |dln fair| >= 3 bps, the share whose price moved at least one tick the same way
#   dust     prints of GBP 0.095-0.105 (the GBP 0.10 bot), and sizes: distinct print sizes of GBP 1 or more
# python3 -I docs/agents/backtests/mmcomp/scripts/tape_long.py   -> results/tape_long.json
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
import load as L

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "tape_long.json")
fx = L.gbpusd()


def fair_of(usd):
    def f(t):
        x, u = fx.at(t), usd.at(t)
        return u / x if x and u else None
    return f


def study(book):
    ps = L.prints(book)
    fair = fair_of(L.usd(book))
    by = {}   # key -> dict of lists

    def slot(k):
        return by.setdefault(k, {"n": 0, "gbp": 0.0, "dust": 0, "sizes": set(), "gap": [], "hours": {}, "dev_b": [], "dev_s": [],
                                 "bx": [], "by": [], "fol": [0, 0], "big": 0})
    for i, (t, px, qty, side, _) in enumerate(ps):
        gbp = px * qty
        f = fair(t)
        for k in (L.day(t), L.week(t)):
            s = slot(k)
            s["n"] += 1
            s["gbp"] += gbp
            if 0.095 <= gbp <= 0.105:
                s["dust"] += 1
            if gbp >= 1:
                s["big"] += 1
                s["sizes"].add(round(qty, 4))
                if f:
                    d = L.bps(px, f)
                    (s["dev_b"] if side == "buy" else s["dev_s"]).append(d)
                    h = s["hours"].setdefault(t // 3_600_000, ([], []))
                    (h[0] if side == "buy" else h[1]).append(d)
    # gap60: adjacent opposite-side prints (of GBP 1 or more) within 60 s
    big = [p for p in ps if p[1] * p[2] >= 1]
    for a, b in zip(big, big[1:]):
        if a[3] != b[3] and b[0] - a[0] <= 60_000:
            buy, sell = (a, b) if a[3] == "buy" else (b, a)
            g = L.bps(buy[1], sell[1])
            for k in (L.day(b[0]), L.week(b[0])):
                slot(k)["gap"].append(g)
    # beta: consecutive same-side prints of GBP 1 or more, 1-30 minutes apart
    last = {}
    for t, px, qty, side, _ in big:
        f = fair(t)
        if side in last and f:
            t0, p0, f0 = last[side]
            if 60_000 <= t - t0 <= 30 * 60_000:
                x, y = math.log(f / f0), math.log(px / p0)
                for k in (L.day(t), L.week(t)):
                    s = slot(k)
                    s["bx"].append(x)
                    s["by"].append(y)
                    if abs(x) >= 3e-4:
                        s["fol"][1] += 1
                        if y * x > 0 and abs(y) >= 0.5 * L.TICK / px:
                            s["fol"][0] += 1
        if f:
            last[side] = (t, px, f)
    out = {}
    for k, s in sorted(by.items()):
        hs = [L.median(b) - L.median(s_) for b, s_ in s["hours"].values() if b and s_]
        sxx = sum(x * x for x in s["bx"])
        days = 7 if "W" in k else 1
        out[k] = {
            "prints": s["n"], "prints_ge1": s["big"], "dust": s["dust"], "gbp": round(s["gbp"]), "sizes": len(s["sizes"]),
            "gap60_med": r2(L.median(s["gap"])), "gap60_n": len(s["gap"]),
            "hspread_med": r2(L.median(hs)), "hours": len(hs),
            "buy_dev_med": r2(L.median(s["dev_b"])), "sell_dev_med": r2(L.median(s["dev_s"])),
            "beta": r2(sum(x * y for x, y in zip(s["bx"], s["by"])) / sxx) if sxx else None, "beta_n": len(s["bx"]),
            "follow": r2(s["fol"][0] / s["fol"][1]) if s["fol"][1] else None, "follow_n": s["fol"][1],
        }
    return out


def r2(x):
    return None if x is None else round(x, 2)


res = {b: study(b) for b in ("USDC-GBP", "USDT-GBP")}
json.dump(res, open(OUT, "w"), indent=0, sort_keys=True)
for b, rows in res.items():
    print(b)
    print("key        prints  ge1 dust      gbp sizes gap60 hspr  buy   sell  beta  (n)  follow (n)")
    for k, r in rows.items():
        if "W" in k:
            print(f"{k:9} {r['prints']:6} {r['prints_ge1']:5} {r['dust']:4} {r['gbp']:9} {r['sizes']:5} {r['gap60_med']!s:5} {r['hspread_med']!s:5} "
                  f"{r['buy_dev_med']!s:5} {r['sell_dev_med']!s:5} {r['beta']!s:5} {r['beta_n']:4} {r['follow']!s:5} {r['follow_n']}")
