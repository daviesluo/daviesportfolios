# USD-GBP-LOOP (2026-10-31): the loop Davies proposed (reviews/2026-10-31-usd-gbp-loop.md), every leg a maker and the coins
# never leaving Revolut X:
#   forward  a bid under fair on the coin's USD book (USDT-USD / USDC-USD, where the UK flow sells) buys the coin with
#            dollars; an ask at or over fair on its GBP book (USDT-GBP / USDC-GBP, where LIVE quotes) sells it for pounds;
#            the pounds go to the Revolut app by hand, become dollars at the app's rate, and come back to refund the bids;
#   reverse  the mirror: a bid on the GBP book, an ask on the USD book, dollars -> pounds in the app.
# Fair is PR5's own: fairU (the 24-hour median of the USD book's closes, agent_quote_minutes as fair_price/data/minutes
# stored it) on the USD book, fairU / X on the GBP book (X the minute's GBP/USD, the last one held through an FX closure).
# ORDERS (each leg, one post-only order of Q dollars' worth): from the recorder's snapshot of that book, live 5 s after it,
# "improve" (a tick inside the touch when the spread allows) or "join" (at the touch, behind every coin the snapshot shows),
# (Q $40 at £120's $161, $100 at £600 and £1,200), never better for the taker than fair less mb bps (bids) or fair plus ma ticks (asks). The ask sells only coin held.
# FILLS: usd_a_deep.py's rule on each book's public prints (data/other_usd_prints.txt.gz; fair_price/data/prints.txt.gz for
# the GBP books, which include LIVE's own fills: a taker we fill there may be one LIVE filled). Prints under 1 of the quote
# currency (the 0.10 bot) fill nothing and are counted.
# THE APP: at the scheduled times every pound (dollar) on Revolut X becomes dollars (pounds) at X x (1 - fx bps) [weekday]
# or X x (1 - fx - wk bps) [an FX closure, X the last held]: by hand, free and instant both ways (Davies, 2026-10-31).
# BOOKS: equity each UTC midnight = dollars + coins x fairU + pounds x X (in dollars); a day's P&L is its change, so the
# coins' moves against fairU and GBP/USD's on the pounds waiting for the app are in it.
#   python3 -I docs/agents/backtests/mmcomp/scripts/usd_gbp_loop.py -> results/usd_gbp_loop.json (+ the GBP-leg fills'
#   minutes for the LIVE-overlap SQL in results/usd_gbp_loop_gbp_fills.txt)
import bisect, collections, datetime as dt, gzip, json, math, os, random, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.dont_write_bytecode = True
for p in (HERE, os.path.join(BT, "fair_price", "scripts")):
    if p not in sys.path: sys.path.insert(0, p)
import fp_data
from usd_a_deep import Book, prints as usd_prints, boot, TICK, DAY, M

OUT = os.path.join(HERE, "..", "results", "usd_gbp_loop.json")
OUT_FILLS = os.path.join(HERE, "..", "results", "usd_gbp_loop_gbp_fills.txt")
T0, T1 = 1790467200000, 1793232000000          # 2026-09-27 00:00 -> 2026-10-29 00:00 UTC
DECIDE_MS = 5_000


def closure(t):
    d = dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc)
    return (d.weekday() == 4 and d.hour >= 21) or d.weekday() == 5 or (d.weekday() == 6 and d.hour < 21)


class Fair:
    def __init__(self, mins):
        self.t = [r[0] for r in mins]; self.x = []; self.fu = []
        lx = lfu = None
        for t, x, fu, lag in mins:
            lx = x or lx; lfu = fu or lfu
            self.x.append(lx); self.fu.append(lfu)

    def at(self, T):
        i = bisect.bisect_right(self.t, T) - 1
        if i < 0: return None, None
        return self.x[i], self.fu[i]


def gbp_prints(book, P):
    return [(t, pt, q, sd, pt * TICK * q) for (t, pt, q, sd, pid) in P.get(book, [])]


def schedule(kind):
    """the instants the app conversion runs"""
    out = []
    for d in range(T0, T1, DAY):
        wd = dt.datetime.fromtimestamp(d / 1000, dt.timezone.utc).weekday()
        if kind == "daily_weekdays" and wd < 5: out.append(d + 8 * 3_600_000)
        elif kind == "daily": out.append(d + 8 * 3_600_000)
        elif kind == "twice_weekdays" and wd < 5: out += [d + 8 * 3_600_000, d + 17 * 3_600_000]
        elif kind == "weekly" and wd == 0: out.append(d + 8 * 3_600_000)
    return out


def run(coin, direction, queue, C, Q=100.0, mb=0.0, ma_ticks=0, fx_bps=0.0, wk_bps=0.0, conv="daily_weekdays",
        data=None, t0=T0, t1=T1, record=None):
    ubk, gbk = f"{coin}-USD", f"{coin}-GBP"
    UB, GB, UP, GP, F = data[ubk], data[gbk], data["P" + ubk], data["P" + gbk], data["F" + gbk]
    # the bid book and the ask book
    if direction == "forward": bidB, askB, bidP, askP, bid_ccy = UB, GB, UP, GP, "usd"
    else: bidB, askB, bidP, askP, bid_ccy = GB, UB, GP, UP, "gbp"
    x0, fu0 = F.at(t0)
    usd, gbp, coins = (C, 0.0, 0.0) if direction == "forward" else (0.0, C / x0, 0.0)
    ev = [(bidB.t[i] + DECIDE_MS, 0, "bid", i) for i in range(len(bidB.t)) if t0 - 2 * M <= bidB.t[i] < t1]
    ev += [(askB.t[i] + DECIDE_MS, 0, "ask", i) for i in range(len(askB.t)) if t0 - 2 * M <= askB.t[i] < t1]
    ev += [(p[0], 1, "bid", k) for k, p in enumerate(bidP) if t0 <= p[0] < t1]
    ev += [(p[0], 1, "ask", k) for k, p in enumerate(askP) if t0 <= p[0] < t1]
    ev += [(t, 2, "conv", 0) for t in schedule(conv) if t0 <= t < t1]
    ev += [(d, 3, "day", 0) for d in range(t0, t1 + DAY, DAY)]
    ev.sort()
    o = {"bid": None, "ask": None}
    fills = collections.Counter(); filled_usd = collections.Counter(); edge = collections.defaultdict(float)
    convs = []; equity = []; bot = 0; orders = collections.Counter(); inv_max = 0.0; idle_max = 0.0
    ask_at_live_exit = 0; ask_fills_list = []
    def eq(T):
        x, fu = F.at(T)
        return usd + coins * fu + gbp * x
    for T, kind, leg, k in ev:
        x, fu = F.at(T)
        if x is None or fu is None: continue
        if kind == 3:
            equity.append((T, eq(T))); continue
        if kind == 2:
            rate = x * (1 - (fx_bps + (wk_bps if closure(T) else 0.0)) * 1e-4)
            if direction == "forward" and gbp > 0.01:
                convs.append((T, gbp * x)); idle_max = max(idle_max, gbp * x); usd += gbp * rate; gbp = 0.0
            if direction == "reverse" and usd > 0.01:
                convs.append((T, usd)); idle_max = max(idle_max, usd); gbp += usd / (x * (1 + (fx_bps + (wk_bps if closure(T) else 0.0)) * 1e-4)); usd = 0.0
            continue
        B = bidB if leg == "bid" else askB
        on_usd_book = (B is UB)
        fair = fu if on_usd_book else fu / x
        if kind == 0:
            i = k
            bids, asks = B.bids[i], B.asks[i]
            want = None
            if bids and asks:
                bb, ba = round(bids[0][0] / TICK), round(asks[0][0] / TICK)
                if leg == "bid":
                    cash = usd if bid_ccy == "usd" else gbp * x
                    if cash >= Q and coins * fu < C:
                        p = bb + 1 if queue == "improve" and ba - bb >= 2 else bb
                        p = min(p, math.floor(fair * (1 - mb * 1e-4) / TICK + 1e-9))
                        qa = 0.0 if (queue == "improve" and p > bb) else sum(qq for pp, qq, n in bids if round(pp / TICK) == p)
                        want = (p, qa)
                else:
                    if coins * fu >= min(Q, 1.0) and coins * fu >= 1.0:
                        p = ba - 1 if queue == "improve" and ba - bb >= 2 else ba
                        p = max(p, math.ceil(fair / TICK - 1e-9) + ma_ticks)
                        qa = 0.0 if (queue == "improve" and p < ba) else sum(qq for pp, qq, n in asks if round(pp / TICK) == p)
                        want = (p, qa)
            if want is None: o[leg] = None; continue
            if o[leg] is not None and o[leg]["ticks"] == want[0]: continue
            o[leg] = {"ticks": want[0], "left": Q, "queue": want[1]}
            orders[T // DAY] += 1
            continue
        P = bidP if leg == "bid" else askP
        t, pt, q, sd, val = P[k]
        r = o[leg]
        if r is None: continue
        if leg == "bid" and sd != "sell": continue
        if leg == "ask" and sd != "buy": continue
        hit = (pt <= r["ticks"]) if leg == "bid" else (pt >= r["ticks"])
        if not hit: continue
        if val < 1.0: bot += 1; continue
        avail = q
        if queue == "join" and pt == r["ticks"]:
            tq = min(r["queue"], avail); r["queue"] -= tq; avail -= tq
            if avail <= 1e-9: continue
        px = r["ticks"] * TICK
        usd_per_ccy = 1.0 if on_usd_book else x
        if leg == "bid":
            cash_usd = usd if bid_ccy == "usd" else gbp * x
            f_usd = min(r["left"], avail * px * usd_per_ccy, cash_usd)
            if f_usd < 1.0: continue
            c = f_usd / (px * usd_per_ccy)
            if bid_ccy == "usd": usd -= f_usd
            else: gbp -= f_usd / x
            coins += c
        else:
            c = min(avail, coins, r["left"] / (px * usd_per_ccy))
            f_usd = c * px * usd_per_ccy
            if f_usd < 1.0: continue
            coins -= c
            if on_usd_book: usd += f_usd
            else: gbp += f_usd / x
            if not on_usd_book:
                ask_fills_list.append((t, r["ticks"], math.ceil(fair / TICK - 1e-9)))
                if r["ticks"] <= math.ceil(fair / TICK - 1e-9) + 1: ask_at_live_exit += 1
        r["left"] -= f_usd
        if r["left"] < 1.0: o[leg] = None
        fills[leg] += 1; filled_usd[leg] += f_usd
        edge[leg] += f_usd * ((fair / px - 1) if leg == "bid" else (px / fair - 1)) * 1e4
        inv_max = max(inv_max, coins * fu)
    if record is not None: record.extend(ask_fills_list)
    days = len(equity) - 1
    v = [equity[i + 1][1] - equity[i][1] for i in range(days)]
    cum = peak = dd = 0.0
    for z in v:
        cum += z; peak = max(peak, cum); dd = min(dd, cum - peak)
    h = days // 2
    conv_days = len({c[0] // DAY for c in convs})
    return {"days": days, "usd_a_day": round(sum(v) / days, 3), "usd_a_day_halves": [round(sum(v[:h]) / h, 3), round(sum(v[h:]) / (days - h), 3)],
            "days_positive": sum(1 for z in v if z > 1e-9), "worst_day": round(min(v), 3), "best_day": round(max(v), 3),
            "max_drawdown": round(dd, 3), "boot_all": boot(v), "boot_first_half": boot(v[:h]), "boot_second_half": boot(v[h:]),
            "fills_a_day": {k2: round(n / days, 1) for k2, n in fills.items()}, "usd_filled_a_day": {k2: round(n / days) for k2, n in filled_usd.items()},
            "edge_bps_vs_fair": {k2: round(edge[k2] / filled_usd[k2], 2) for k2 in edge if filled_usd[k2]},
            "conversions": len(convs), "conversion_days": conv_days, "conversion_usd_median": round(st.median([c[1] for c in convs])) if convs else 0,
            "waiting_for_app_max_usd": round(idle_max), "coin_held_max_usd": round(inv_max),
            "end_state_usd": {"usd": round(usd), "coin": round(coins * F.at(t1)[1]), "gbp_in_usd": round(gbp * F.at(t1)[0])},
            "orders_a_day_mean": round(sum(orders.values()) / days, 1), "orders_a_day_max": max(orders.values()) if orders else 0,
            "bot_prints_at_our_price": bot, "gbp_ask_fills_at_or_under_live_exit": ask_at_live_exit}


def main():
    mins = fp_data.load_minutes(); gp = fp_data.load_prints()
    data = {}
    for coin in ("USDT", "USDC"):
        data[f"{coin}-USD"] = Book(f"{coin}-USD"); data[f"{coin}-GBP"] = Book(f"{coin}-GBP")
        data[f"P{coin}-USD"] = usd_prints(f"{coin}-USD"); data[f"P{coin}-GBP"] = gbp_prints(f"{coin}-GBP", gp)
        data[f"F{coin}-GBP"] = Fair(mins[f"{coin}-GBP"])
    res = {"window": "2026-09-27 -> 2026-10-29 UTC", "rows": {}}
    rows = collections.OrderedDict()
    for coin in ("USDT", "USDC"):
        for direction in ("forward", "reverse"):
            for C, Q in ((161, 40.0), (805, 100.0), (1610, 100.0)):
                for queue in ("improve", "join"):
                    for fx in (0.0, 5.0, 10.0, 25.0):
                        rows[f"{coin}|{direction}|{queue}|C{C}|fx{fx:g}|daily_weekdays"] = dict(coin=coin, direction=direction, queue=queue, C=C, Q=Q, fx_bps=fx)
                rows[f"{coin}|{direction}|improve|C{C}|fx0|weekly"] = dict(coin=coin, direction=direction, queue="improve", C=C, Q=Q, conv="weekly")
                rows[f"{coin}|{direction}|improve|C{C}|fx0|twice_weekdays"] = dict(coin=coin, direction=direction, queue="improve", C=C, Q=Q, conv="twice_weekdays")
                rows[f"{coin}|{direction}|improve|C{C}|fx0|daily_incl_weekend"] = dict(coin=coin, direction=direction, queue="improve", C=C, Q=Q, conv="daily")
                rows[f"{coin}|{direction}|improve|C{C}|fx0|ask_live_exit_plus1"] = dict(coin=coin, direction=direction, queue="improve", C=C, Q=Q, ma_ticks=2)
                rows[f"{coin}|{direction}|improve|C{C}|fx0|mb2"] = dict(coin=coin, direction=direction, queue="improve", C=C, Q=Q, mb=2.0)
    rec = []
    for name, kw in rows.items():
        r = run(data=data, record=rec if name == "USDT|forward|improve|C805|fx0|daily_weekdays" else None, **kw)
        res["rows"][name] = r
        print(name, {k: r[k] for k in ("usd_a_day", "usd_a_day_halves", "days_positive", "worst_day", "max_drawdown", "fills_a_day", "edge_bps_vs_fair", "conversions", "waiting_for_app_max_usd", "orders_a_day_mean", "gbp_ask_fills_at_or_under_live_exit")}, flush=True)
    json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
    with open(OUT_FILLS, "w") as f:
        for t, tk, ft in rec: f.write(f"{t}|{tk}|{ft}\n")


if __name__ == "__main__":
    main()
