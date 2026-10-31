# USD-A-DEEP (2026-10-31): MMCOMP's A on Revolut X's USD stablecoin books, replayed as it would trade
# (reviews/2026-10-31-usd-books-a-deep.md). Davies, 2026-10-31: "第 2 名继续深度研究".
#
# THE QUOTE. One post-only order a side of Q dollars on USDT-USD or USDC-USD, decided from the recorder's five-level snapshot
# (fair_price/data/book_<BOOK>.txt.gz, read 40-52 s into a minute, stored when it changed) and live DECIDE_MS after it:
#   improve  one tick inside the best price when the spread leaves room (first in the queue), else joining it;
#   join     at the best price, behind every coin the snapshot shows there;
#   through  at the best price, filled only by a print strictly through it.
# An order is never priced where its close would not pay m bps. A new price is a new order (counted), its queue reset.
# A snapshot older than seen_until + 75 s leaves the side unquoted.
# THE FILLS. Keyless public prints (data/other_usd_prints.txt.gz). A print of $1 or more whose taker sold (bought) at or under
# (over) our bid (ask) fills us at OUR price, after the queue ahead at that price has had its share; any remainder of our
# order rests. Prints under $1 (the venue-wide $0.10 bot) are counted apart and fill nothing (they would leave dust).
# THE CLOSE, per fill:
#   par   Revolut's own 1:1 USD<->USDC/USDT conversion in the Revolut app (announced 2025-10-31; whether a UK account has it,
#         and what moving coins between Revolut X and the app costs, are unconfirmed): a bought coin is worth exactly $1, a
#         sold one is replaced at $1. No fee assumed; the move is by hand (no withdrawal API), once a UTC day.
#   cbgbp a UK Coinbase account (no USD wallet assumed): the coin sold (bought) on Coinbase's USDC-GBP / USDT-GBP at its touch
#         at the first 30-second read >= fill + LAT (mmcomp/data/cb30_*), taker 0.45 bp, the pounds turned into dollars (or
#         back) at the minute's GBP/USD (load.gbpusd) less fx bps; coins moved Revolut X -> Coinbase when the drift reaches a
#         batch: £3 service + network (USDC on Solana £0.05, USDT £1 assumed), Coinbase -> Revolut X free (USDC) or 0.01 % + £1.
# CAPITAL. C dollars on Revolut X, half in dollars for the bid and half in coin for the ask, put back to half each 00:00
# UTC (by the close's own route); a side whose leg holds under Q is off until then.
# OUT. Per row: fills, $ a day, bps a fill, days > 0, worst day, max drawdown, P(mean day <= 0) by a 3-day block bootstrap
# (seed 20261031) on the whole window and each half, orders a day, transit, markouts (Revolut X mid 1 and 5 minutes after,
# + = for us), the maker's presence at each fill (run2.Ref), and the bot prints that touched our price.
#   python3 -I docs/agents/backtests/mmcomp/scripts/usd_a_deep.py -> results/usd_a_deep.json
import bisect, collections, gzip, json, math, os, random, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import load as LD
from run2 import Ref

OUT = os.path.join(HERE, "..", "results", "usd_a_deep.json")
DATA = os.path.join(HERE, "..", "data")
TICK, DAY, M = 1e-4, 86_400_000, 60_000
T0, T1 = 1790467200000, 1793232000000          # 2026-09-27 00:00 -> 2026-10-29 00:00 UTC (the snapshots end)
T0CB = 1791676800000                            # 2026-10-11 00:00: the first whole day of Coinbase's 30-second touch
DECIDE_MS, STALE_MS = 5_000, 75_000
CB_FEE = 0.45e-4
SEED, NB, BLOCK = 20261031, 10000, 3
COIN = {"USDT-USD": "USDT", "USDC-USD": "USDC"}
NET_GBP = {"USDC": 0.05, "USDT": 1.0}


def prints(book):
    out = []
    for l in gzip.open(os.path.join(DATA, "other_usd_prints.txt.gz"), "rt"):
        pid, b, t, px, q, sd = l.strip().split("|")
        if b == book: out.append((int(t), round(float(px) / TICK), float(q), sd, float(px) * float(q)))
    out.sort()
    return out


def cb30(coin):
    t, b, a = [], [], []
    for l in gzip.open(os.path.join(DATA, f"cb30_{coin}-GBP.txt.gz"), "rt"):
        f = l.strip().split("|")
        if len(f) == 5 and int(f[2]) > int(f[1]) > 0:
            t.append(int(f[0])); b.append(int(f[1]) * 1e-4); a.append(int(f[2]) * 1e-4)
    return t, b, a


class Book:
    def __init__(self, bk):
        seen = LD.book_seen(bk)
        rows = LD.book(bk)
        self.t = [r[0] for r in rows]; self.u = [max(seen.get(r[0], r[0]), r[0]) for r in rows]
        self.bids = [r[1] for r in rows]; self.asks = [r[2] for r in rows]

    def at(self, T):
        i = bisect.bisect_right(self.t, T) - 1
        if i < 0 or T > self.u[i] + STALE_MS: return None
        return i

    def mid(self, T):
        i = self.at(T)
        if i is None or not self.bids[i] or not self.asks[i]: return None
        return (self.bids[i][0][0] + self.asks[i][0][0]) / 2


def boot(v):
    n = len(v)
    if n < 3: return None
    rnd = random.Random(SEED); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(st.fmean(s[:n]))
    out.sort()
    return [round(out[int(0.05 * NB)], 3), round(out[int(0.95 * NB)], 3), round(sum(1 for x in out if x <= 0) / NB, 4)]


def run(bk, P, B, R, CB, FX, close, queue, sides, m, Q, C, t0, t1, lat=30_000, fx_bps=0.0, batch=None, gate=None, split=0.5):
    coin = COIN[bk]
    cbt, cbb, cba = CB
    def cb_at(T):
        i = bisect.bisect_left(cbt, T)
        if i >= len(cbt) or cbt[i] - T > 120_000: return None
        return cbb[i], cba[i]
    def close_px(T):
        """(the price a bought coin is worth in $, the price a sold coin costs in $) for a fill at T, or None"""
        if close == "par": return 1.0, 1.0
        c = cb_at(T + lat); x = FX.at(T + lat)
        if c is None or x is None: return None
        return c[0] * (1 - CB_FEE) * x * (1 - fx_bps * 1e-4), c[1] * (1 + CB_FEE) * x * (1 + fx_bps * 1e-4)
    # events: snapshots decide, prints fill
    snaps = [i for i, t in enumerate(B.t) if t0 - 2 * M <= t < t1]
    ev = [(B.t[i] + DECIDE_MS, 0, i) for i in snaps] + [(p[0], 1, k) for k, p in enumerate(P) if t0 <= p[0] < t1]
    ev.sort()
    o = {"bid": None, "ask": None}            # {ticks, usd_left, queue}
    usd, coins = C * split, C * (1 - split)   # dollars for the bid, coin (at $1) for the ask
    fills, orders = [], collections.Counter()
    bot_touch = 0
    day = None
    daily_pnl = collections.defaultdict(float)
    transfers = collections.Counter(); xfer_cost = collections.defaultdict(float)
    drift = 0.0                                # coins bought on Revolut X minus sold there (cbgbp: what must move)
    held_max = 0.0
    for T, kind, k in ev:
        d = T // DAY * DAY
        if d != day:
            # 00:00: put the two legs back to half each, by the close's own route
            if day is not None:
                if close == "cbgbp" and batch:
                    while abs(drift) >= batch:
                        s = 1 if drift > 0 else -1
                        x = FX.at(d) or 1.33
                        cost = (3.0 + NET_GBP[coin]) * x if s > 0 else (0.0 if coin == "USDC" else (batch * 1e-4 + 1.0 * x))
                        xfer_cost[d] += cost; daily_pnl[d] -= cost; transfers[d] += 1
                        drift -= s * batch
                held_max = max(held_max, abs(drift))
                usd, coins = C * split, C * (1 - split)
            day = d
        if kind == 0:
            i = k
            if gate is not None and not gate(T): want = {"bid": None, "ask": None}
            else:
                bids, asks = B.bids[i], B.asks[i]
                want = {"bid": None, "ask": None}
                if bids and asks:
                    bb, ba = round(bids[0][0] / TICK), round(asks[0][0] / TICK)
                    cp = close_px(T)
                    if cp is not None:
                        if "bid" in sides and usd >= Q:
                            p = bb + 1 if queue == "improve" and ba - bb >= 2 else bb
                            lim = math.floor(cp[0] * (1 - m * 1e-4) / TICK + 1e-9)
                            p = min(p, lim)
                            qa = 0.0 if (queue == "improve" and p > bb) else sum(q for pp, q, n in bids if round(pp / TICK) == p)
                            want["bid"] = (p, qa)
                        if "ask" in sides and coins >= Q:
                            p = ba - 1 if queue == "improve" and ba - bb >= 2 else ba
                            lim = math.ceil(cp[1] * (1 + m * 1e-4) / TICK - 1e-9)
                            p = max(p, lim)
                            qa = 0.0 if (queue == "improve" and p < ba) else sum(q for pp, q, n in asks if round(pp / TICK) == p)
                            want["ask"] = (p, qa)
            for s in ("bid", "ask"):
                w = want[s]
                if w is None: o[s] = None; continue
                if o[s] is not None and o[s]["ticks"] == w[0]: continue
                o[s] = {"ticks": w[0], "left": Q, "queue": w[1]}
                orders[d] += 1
            continue
        t, pt, q, sd, val = P[k]
        s = "bid" if sd == "sell" else "ask"
        r = o[s]
        if r is None: continue
        hit = (pt <= r["ticks"]) if s == "bid" else (pt >= r["ticks"])
        if not hit: continue
        if val < 1.0:
            bot_touch += 1
            continue
        coins_avail = q
        at_price = pt == r["ticks"]
        if queue == "through" and at_price: continue
        if queue == "join" and at_price:
            take_q = min(r["queue"], coins_avail); r["queue"] -= take_q; coins_avail -= take_q
            if coins_avail <= 1e-9: continue
        px = r["ticks"] * TICK
        fill_usd = min(r["left"], coins_avail * px, usd if s == "bid" else coins * px)
        if fill_usd < 1.0: continue
        c = fill_usd / px
        cp = close_px(t)
        if cp is None: continue
        pnl = c * cp[0] - fill_usd if s == "bid" else fill_usd - c * cp[1]
        r["left"] -= fill_usd
        if s == "bid": usd -= fill_usd; coins += c * px; drift += c
        else: coins -= fill_usd; usd += fill_usd; drift -= c
        if r["left"] < 1.0: o[s] = None
        m1, m5 = B.mid(t + M), B.mid(t + 5 * M)
        sg = 1 if s == "bid" else -1
        mk = R.at(t)
        present = mk is not None and (R.mb[mk] is not None or R.ma[mk] is not None)
        fills.append({"t": t, "side": s, "usd": fill_usd, "bps": 1e4 * pnl / fill_usd, "pnl": pnl,
                      "m1": None if m1 is None else sg * 1e4 * (m1 / px - 1), "m5": None if m5 is None else sg * 1e4 * (m5 / px - 1),
                      "maker": present, "at": at_price})
        daily_pnl[d] += pnl
    days = list(range(t0, t1, DAY))
    v = [daily_pnl.get(x, 0.0) for x in days]
    cum = peak = dd = 0.0
    for x in v:
        cum += x; peak = max(peak, cum); dd = min(dd, cum - peak)
    h = len(v) // 2
    fm = [f for f in fills if f["maker"]]; fa = [f for f in fills if not f["maker"]]
    q5 = lambda xs: [round(sorted(xs)[int(p * (len(xs) - 1))], 2) for p in (0.1, 0.5, 0.9)] if xs else None
    return {"days": len(v), "fills": len(fills), "fills_a_day": round(len(fills) / len(v), 1),
            "buys": sum(1 for f in fills if f["side"] == "bid"), "sells": sum(1 for f in fills if f["side"] == "ask"),
            "usd_filled_a_day": round(sum(f["usd"] for f in fills) / len(v)),
            "bps_fill_mean": round(st.fmean([f["bps"] for f in fills]), 2) if fills else None,
            "usd_a_day": round(sum(v) / len(v), 3), "usd_a_day_halves": [round(sum(v[:h]) / h, 3), round(sum(v[h:]) / (len(v) - h), 3)],
            "days_positive": sum(1 for x in v if x > 1e-9), "worst_day": round(min(v), 3), "best_day": round(max(v), 3),
            "max_drawdown": round(dd, 3), "boot_all": boot(v), "boot_first_half": boot(v[:h]), "boot_second_half": boot(v[h:]),
            "transfer_cost_a_day": round(sum(xfer_cost.values()) / len(v), 3), "transfers": sum(transfers.values()),
            "coins_to_move_a_day": round(sum(f["usd"] * (1 if f["side"] == "bid" else -1) for f in fills) / len(v)),
            "transit_max_usd": round(held_max), "orders_a_day_mean": round(sum(orders.values()) / len(v), 1),
            "orders_a_day_max": max(orders.values()) if orders else 0,
            "markout_1m_bps": q5([f["m1"] for f in fills if f["m1"] is not None]),
            "markout_5m_bps": q5([f["m5"] for f in fills if f["m5"] is not None]),
            "fills_maker_present": len(fm), "bps_maker_present": round(st.fmean([f["bps"] for f in fm]), 2) if fm else None,
            "fills_maker_absent": len(fa), "bps_maker_absent": round(st.fmean([f["bps"] for f in fa]), 2) if fa else None,
            "fills_at_price": sum(1 for f in fills if f["at"]), "bot_prints_at_our_price": bot_touch}


def main():
    FX = LD.gbpusd()
    res = {"flow": {}, "window_par": "2026-09-27 -> 2026-10-29 UTC", "window_cbgbp": "2026-10-11 -> 2026-10-29 UTC", "rows": {}}
    for bk in ("USDT-USD", "USDC-USD"):
        P = prints(bk); B = Book(bk); R = Ref(bk); CB = cb30(COIN[bk])
        # capacity: the real takers' dollars a day, by side and by how far under (over) par they traded
        nd = (T1 - T0) / DAY; fl = collections.Counter()
        for t, pt, q, sd, val in P:
            if T0 <= t < T1 and val >= 1:
                e = (1 - pt * TICK) * 1e4 if sd == "sell" else (pt * TICK - 1) * 1e4
                fl[sd + "_all"] += val
                for k in (2, 5, 10):
                    if e >= k: fl[f"{sd}_{k}bps_from_par"] += val
        res["flow"][bk] = {k: round(v / nd) for k, v in sorted(fl.items())}
        print(bk, res["flow"][bk], flush=True)
        def present(T):
            i = R.at(T)
            return i is not None and (R.mb[i] is not None or R.ma[i] is not None)
        rows = collections.OrderedDict()
        for C in (805, 1610):            # £600 and £1,200 at 1.342
            for queue in ("improve", "join", "through"):
                for m in (0, 2, 5):
                    rows[f"par|{queue}|two|m{m}|Q100|C{C}"] = dict(close="par", queue=queue, sides=("bid", "ask"), m=m, Q=100, C=C, t0=T0, t1=T1)
            rows[f"par|improve|two|m2|Q250|C{C}"] = dict(close="par", queue="improve", sides=("bid", "ask"), m=2, Q=250, C=C, t0=T0, t1=T1)
            rows[f"par|improve|bid|m2|Q100|C{C}"] = dict(close="par", queue="improve", sides=("bid",), m=2, Q=100, C=C, t0=T0, t1=T1)
            rows[f"par|improve|bidall|m2|Q100|C{C}"] = dict(close="par", queue="improve", sides=("bid",), m=2, Q=100, C=C, t0=T0, t1=T1, split=1.0)
            rows[f"par|join|bidall|m2|Q100|C{C}"] = dict(close="par", queue="join", sides=("bid",), m=2, Q=100, C=C, t0=T0, t1=T1, split=1.0)
            rows[f"par|improve|two|m2|Q100|C{C}|maker_present_only"] = dict(close="par", queue="improve", sides=("bid", "ask"), m=2, Q=100, C=C, t0=T0, t1=T1, gate=present)
            rows[f"par|improve|two|m2|Q100|C{C}|maker_absent_only"] = dict(close="par", queue="improve", sides=("bid", "ask"), m=2, Q=100, C=C, t0=T0, t1=T1, gate=lambda T: not present(T))
            # the same window as cbgbp, for a like-for-like comparison
            rows[f"par|improve|two|m2|Q100|C{C}|cbwindow"] = dict(close="par", queue="improve", sides=("bid", "ask"), m=2, Q=100, C=C, t0=T0CB, t1=T1)
            for fx in (0.0, 5.0, 20.0):
                for batch in (None, 2000, 5000):
                    for queue in ("improve", "join"):
                        rows[f"cbgbp|{queue}|two|m2|Q100|C{C}|fx{fx:g}|batch{batch}"] = dict(close="cbgbp", queue=queue, sides=("bid", "ask"), m=2, Q=100, C=C, t0=T0CB, t1=T1, fx_bps=fx, batch=batch)
            for lat in (0, 90_000):
                rows[f"cbgbp|improve|two|m2|Q100|C{C}|fx0|batch2000|lat{lat // 1000}"] = dict(close="cbgbp", queue="improve", sides=("bid", "ask"), m=2, Q=100, C=C, t0=T0CB, t1=T1, batch=2000, lat=lat)
        for name, kw in rows.items():
            r = run(bk, P, B, R, CB, FX, **kw)
            res["rows"][f"{bk}|{name}"] = r
            print(bk, name, {k: r[k] for k in ("fills_a_day", "bps_fill_mean", "usd_a_day", "usd_a_day_halves", "days_positive", "worst_day", "boot_all", "transfer_cost_a_day", "orders_a_day_mean")}, flush=True)
    json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
