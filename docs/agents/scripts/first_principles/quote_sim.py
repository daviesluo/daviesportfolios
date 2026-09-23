"""Shared simulator for the pre-registered resting-quote studies (PR1, PR2).

A book is a list of bars `(t_ms, o, h, l, c, v_base, q_vol)`. For every hour start the caller supplies a
fair value (or None). Rungs are resting post-only orders at fair*(1-k) (bids) and fair*(1+k) (asks).
A rung's order fills only if the bar traded (v > 0) and the price went strictly through it. After a
fill, an exit order rests at the current fair (repriced each hour) and fills strictly through; after
`stop_ms` the position is closed at the bar close as a taker. Everything is deterministic.
"""
import math, random


def round_tick(p, tick, up):
    if tick <= 0:
        return p
    n = p / tick
    n = math.ceil(n - 1e-9) if up else math.floor(n + 1e-9)
    return round(n * tick, 12)


class Params:
    def __init__(self, rungs, notional, tick, maker_fee, taker_fee, half_spread, stop_ms,
                 active_delay_bars, exit_delay_bars, through_ticks=0, capacity_frac=None,
                 reprice_frac=0.0005, bar_ms=3600000):
        self.rungs = rungs                  # list of k (fractions)
        self.notional = notional            # USD per rung
        self.tick = tick
        self.maker_fee = maker_fee          # fraction per maker fill
        self.taker_fee = taker_fee          # fraction folded into the taker exit price
        self.half_spread = half_spread      # fraction
        self.stop_ms = stop_ms
        self.active_delay_bars = active_delay_bars   # 0: active in the bar it is (re)priced at; 1: from the next bar
        self.exit_delay_bars = exit_delay_bars       # bars after the fill bar before the exit order is live
        self.through_ticks = through_ticks  # extra ticks the market must trade through (stress)
        self.capacity_frac = capacity_frac  # None, or fraction of the fill bar's quote volume
        self.reprice_frac = reprice_frac
        self.bar_ms = bar_ms


def run_book(bars, fair_at_hour, usd_per_quote_at, P, book_name):
    """Simulate one book. fair_at_hour: dict hour_ms -> fair or None. usd_per_quote_at(t_ms) -> USD value
    of one unit of the quote currency (1.0 for USD/USDT books). Returns (trips, orders_placed)."""
    H = 3600000
    thr = P.through_ticks * P.tick
    rungs = []
    for side in ("bid", "ask"):
        for k in P.rungs:
            rungs.append({"side": side, "k": k, "mode": "idle", "price": None, "fair_at": None,
                          "active_from": None, "entry": None, "t_e": None, "i_e": None, "qty": None,
                          "notional_q": None, "xprice": None, "x_active_from": None})
    trips = []
    orders = 0
    fair = None
    n = len(bars)
    for i in range(n):
        t, o, h, l, c, v, qv = bars[i]
        hour = t - (t % H)
        if t % H == 0 or i == 0:
            fair = fair_at_hour.get(hour)
            for r in rungs:
                if r["mode"] in ("idle", "quote"):
                    if fair is None:
                        r["mode"] = "idle"; r["price"] = None
                        continue
                    need = r["mode"] == "idle" or r["fair_at"] is None or abs(fair / r["fair_at"] - 1) > P.reprice_frac
                    if need:
                        if r["side"] == "bid":
                            p = round_tick(fair * (1 - r["k"]), P.tick, up=False)
                        else:
                            p = round_tick(fair * (1 + r["k"]), P.tick, up=True)
                        if r["mode"] != "quote" or p != r["price"]:
                            orders += 1
                        r.update(mode="quote", price=p, fair_at=fair, active_from=i + P.active_delay_bars)
                elif r["mode"] == "position" and fair is not None:
                    xp = round_tick(fair, P.tick, up=(r["side"] == "bid"))
                    if xp != r["xprice"]:
                        orders += 1
                        r["xprice"] = xp
        traded = v > 0
        for r in rungs:
            if r["mode"] == "quote" and traded and i >= r["active_from"]:
                p = r["price"]
                hit = (l < p - thr) if r["side"] == "bid" else (h > p + thr)
                if hit:
                    usdq = usd_per_quote_at(t)
                    if usdq is None or usdq <= 0:
                        continue
                    notional_usd = P.notional
                    if P.capacity_frac is not None:
                        notional_usd = min(P.notional, P.capacity_frac * qv * usdq)
                        if notional_usd <= 0:
                            continue
                    nq = notional_usd / usdq            # notional in quote currency
                    qty = nq / p
                    xp = round_tick(fair if fair is not None else p, P.tick, up=(r["side"] == "bid"))
                    orders += 1                          # the exit order
                    r.update(mode="position", entry=p, t_e=t, i_e=i, qty=qty, notional_q=nq, xprice=xp,
                             x_active_from=i + P.exit_delay_bars)
                    continue
            if r["mode"] == "position":
                done = None
                if traded and i >= r["x_active_from"]:
                    xp = r["xprice"]
                    if r["side"] == "bid" and h > xp + thr:
                        done = (xp, "maker")
                    elif r["side"] == "ask" and l < xp - thr:
                        done = (xp, "maker")
                if done is None and t >= r["t_e"] + P.stop_ms:
                    adj = P.taker_fee + P.half_spread
                    done = (c * (1 - adj), "taker") if r["side"] == "bid" else (c * (1 + adj), "taker")
                if done is None and i == n - 1:
                    adj = P.taker_fee + P.half_spread
                    done = (c * (1 - adj), "taker_end") if r["side"] == "bid" else (c * (1 + adj), "taker_end")
                if done is not None:
                    px, how = done
                    q = r["qty"]
                    if r["side"] == "bid":
                        pnl_q = q * (px - r["entry"])
                    else:
                        pnl_q = q * (r["entry"] - px)
                    fees_q = P.maker_fee * r["notional_q"] + (P.maker_fee * q * px if how == "maker" else 0.0)
                    usdq = usd_per_quote_at(t) or usd_per_quote_at(r["t_e"])
                    pnl_usd = (pnl_q - fees_q) * usdq
                    trips.append({"book": book_name, "side": r["side"], "k": r["k"], "t_entry": r["t_e"], "t_exit": t,
                                  "entry": r["entry"], "exit": px, "how": how, "notional_usd": r["notional_q"] * usdq,
                                  "pnl_usd": pnl_usd, "i_entry": r["i_e"]})
                    r.update(mode="idle", price=None, fair_at=None, entry=None, t_e=None, i_e=None, qty=None,
                             notional_q=None, xprice=None, x_active_from=None)
    return trips, orders


def exit_path(bars, start_i, side, entry, fair_at_hour, P, usd_per_quote_at, notional_usd):
    """The same exit machinery for a position opened at bar start_i's close (the random-time null)."""
    H = 3600000
    t0 = bars[start_i][0]
    usdq0 = usd_per_quote_at(t0)
    if usdq0 is None or usdq0 <= 0:
        return None
    nq = notional_usd / usdq0
    q = nq / entry
    fair = fair_at_hour.get(t0 - (t0 % H))
    xp = round_tick(fair if fair is not None else entry, P.tick, up=(side == "bid"))
    thr = P.through_ticks * P.tick
    n = len(bars)
    for i in range(start_i + 1, n):
        t, o, h, l, c, v, qv = bars[i]
        if t % H == 0:
            f = fair_at_hour.get(t)
            if f is not None:
                xp = round_tick(f, P.tick, up=(side == "bid"))
        done = None
        if v > 0 and i >= start_i + P.exit_delay_bars:
            if side == "bid" and h > xp + thr:
                done = (xp, "maker")
            elif side == "ask" and l < xp - thr:
                done = (xp, "maker")
        if done is None and (t >= t0 + P.stop_ms or i == n - 1):
            adj = P.taker_fee + P.half_spread
            done = (c * (1 - adj), "taker") if side == "bid" else (c * (1 + adj), "taker")
        if done is not None:
            px, how = done
            pnl_q = q * (px - entry) if side == "bid" else q * (entry - px)
            fees_q = P.maker_fee * nq + (P.maker_fee * q * px if how == "maker" else 0.0)
            usdq = usd_per_quote_at(t) or usdq0
            return (pnl_q - fees_q) * usdq
    return None


def summarize(trips, t0, t1, capital, orders=None, days=None):
    sel = [x for x in trips if t0 <= x["t_entry"] < t1]
    tot = sum(x["pnl_usd"] for x in sel)
    wins = sum(1 for x in sel if x["pnl_usd"] > 0)
    cum, peak, mdd = 0.0, 0.0, 0.0
    for x in sorted(sel, key=lambda z: (z["t_exit"], z["t_entry"], z["book"], z["side"], z["k"])):
        cum += x["pnl_usd"]
        peak = max(peak, cum)
        mdd = max(mdd, peak - cum)
    out = {"trips": len(sel), "pnl_usd": round(tot, 4), "return_on_capital_pct": round(100 * tot / capital, 4),
           "win_rate": round(wins / len(sel), 4) if sel else None,
           "worst_trip_usd": round(min((x["pnl_usd"] for x in sel), default=0.0), 4),
           "best_trip_usd": round(max((x["pnl_usd"] for x in sel), default=0.0), 4),
           "max_drawdown_usd": round(mdd, 4),
           "taker_exits": sum(1 for x in sel if x["how"].startswith("taker")),
           "fill_notional_usd": round(sum(x["notional_usd"] for x in sel), 2)}
    if days:
        out["days"] = round(days, 2)
        out["fill_notional_usd_per_day"] = round(out["fill_notional_usd"] / days, 2)
        out["pnl_usd_per_day"] = round(tot / days, 4)
    return out
