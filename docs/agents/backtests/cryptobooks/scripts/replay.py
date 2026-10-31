# CRYPTOBOOKS (2026-10-31): a replay of a 0 % maker on one Revolut X crypto book, quoting around the outside fair.
# Fair at second s: Binance's last trade of second s-1 (one second of latency) times the book's trailing basis (the
# centre of the last three hours of Revolut X prints against the outside price, from prints before s only; tape.py).
# The quotes: bid fair*(1-d-k), ask fair*(1+d-k), k = KAPPA*d*(inventory-target)/target (a skew back to the target).
# They are re-priced every second the fair has moved THETA bps from the price they were set at (U=1), or at each minute
# only (U=60, the loop as it runs), and after a fill. Each re-priced side is an order placed (Revolut X counts 1,000 a
# day an account; MAX_ORDERS_DAY: once the UTC day's are spent, nothing rests until midnight).
# Fills: only by the public taker orders (prints of one ms and side): a taker buy fills our ask if the ask is below the
# first price it paid (we would have been the best ask: "taker"), else with the part it took above our ask ("sweep");
# times SHARE (a haircut for queue and competition, 1 = all of it); never more than the order's size left; at our price. With ARB on, an arbitrageur also takes the whole of any of our quotes that sits
# beyond the true fair of the second by more than X_ARB bps (9 bps taker fee + 1 bp) for ARB_DELAY seconds running (0:
# at once, the pessimistic case; the tape's own pickers took stale quotes a median 57-114 s after, tape.py's ages).
# Money: capital C, held as cash and coin; the coin starts at the target; bids need cash, asks need coin; no bid while
# the coin is worth more than the cap. Reported a UTC day, in pounds (a USD book at the minute's GBP/USD): total P&L
# (marked at the fair), what holding the starting coin did (passive), and the rest (the quoting's own result).
# WINDOWS (method d): quote only inside the given [start, end) seconds; outside them, with a target of 0, only the ask
# that sells the coin back to flat.
# A hedged variant (HEDGE = h bps): each fill is closed at once on Binance at the next second's price less h, so the
# result is sum(maker edge against that price - h) and no coin is carried beyond the pre-positioned stock.
import collections, datetime as dt, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import in_halt, load_tape, taker_orders  # noqa: E402

TRAIL = 3 * 3600


def basis_steps(tape, F, t0):
    """[(sec, centre bps)] from prints before sec, the trailing TRAIL s's (median buy dev + median sell dev) / 2."""
    devs = []
    for ms, p, q, s in tape:
        sec = ms // 1000
        i = sec - 1 - t0
        if 0 <= i < len(F):
            devs.append((sec, s, 1e4 * math.log(p / F[i])))
    steps, j = [], 0
    last = None
    for idx in range(0, len(devs), 10):  # every tenth print is often enough for a three-hour median
        sec = devs[idx][0]
        while devs[j][0] < sec - TRAIL:
            j += 1
        bs = [x[2] for x in devs[j:idx] if x[1] > 0]
        ss = [x[2] for x in devs[j:idx] if x[1] < 0]
        if len(bs) >= 5 and len(ss) >= 5:
            c = (statistics.median(bs) + statistics.median(ss)) / 2
            if c != last:
                steps.append((sec, c))
                last = c
    return steps


class Book:
    def __init__(self, name, fair, tag=""):
        self.name = name
        self.F = fair.series(name)
        self.t0 = fair.t0
        self.fx = fair.fx
        tape = load_tape(name)
        if tag:
            tape = sorted(set(tape + load_tape(name, tag)))
        tape = [r for r in tape if fair.t0 + 60 <= r[0] // 1000 < fair.t1 - 400]
        self.orders = [o for o in taker_orders(tape) if not in_halt(o[0] // 1000)]
        self.steps = basis_steps(tape, self.F, self.t0)
        self.gbp = name.endswith("-GBP")


def run(bk, d_bps, cap_gbp, target_frac=0.5, Q_gbp=50.0, U=1, theta=3.0, kappa=1.0, arb=False, x_arb=10.0,
        hedge=None, t_from=None, t_to=None, windows=None, share=1.0, arb_delay=0, max_orders_day=None):
    F, t0 = bk.F, bk.t0
    d = d_bps / 1e4
    s_start = max(bk.steps[0][0] + 1, t_from or 0) if bk.steps else None
    if s_start is None:
        return None
    s_end = min(t0 + len(F) - 302, t_to or 10 ** 12)
    usd_gbp = (lambda s: 1.0) if bk.gbp else (lambda s: 1.0 / bk.fx.at(s))
    # capital in the book's quote currency
    k0 = 1.0 / usd_gbp(s_start)
    C = cap_gbp * k0
    Q = Q_gbp * k0
    oi = 0
    while oi < len(bk.orders) and bk.orders[oi][0] // 1000 < s_start:
        oi += 1
    si = 0
    while si + 1 < len(bk.steps) and bk.steps[si + 1][0] <= s_start:
        si += 1
    c = bk.steps[si][1]
    f0 = F[s_start - 1 - t0] * math.exp(c / 1e4)
    target = C * target_frac
    coin = target / f0
    cash = C - target
    coin_start_day = coin
    bid = ask = None
    bid_left = ask_left = 0.0
    ref = None
    placed = 0
    fills = []  # (sec, side of ours: +1 bought / -1 sold, qty, price, fair at fill, cause)
    day_rows = collections.OrderedDict()
    hour_rows = collections.OrderedDict()
    eq_day0 = cash + coin * f0
    fair_day0 = f0
    eq_h0, day_key, hour_key = eq_day0, None, None
    passive_day = 0.0
    need_requote = True
    fb = fa = False
    hedge_day = collections.defaultdict(float)
    wi, was_active = 0, None
    stale_a = stale_b = None
    inv_samples = []
    placed_day0 = 0
    for s in range(s_start, s_end):
        if windows is None:
            active = True
        else:
            while wi < len(windows) and windows[wi][1] <= s:
                wi += 1
            active = wi < len(windows) and windows[wi][0] <= s
        if active != was_active:
            need_requote = True
            was_active = active
        while si + 1 < len(bk.steps) and bk.steps[si + 1][0] <= s:
            si += 1
            c = bk.steps[si][1]
        ec = math.exp(c / 1e4)
        f_know = F[s - 1 - t0] * ec
        f_true = F[s - t0] * ec
        # bookkeeping at hour / day boundaries (marked at the fair known now)
        if s % 3600 == 0 or hour_key is None:
            eq = cash + coin * f_know
            if hour_key is not None:
                hour_rows[hour_key] = (eq - eq_h0) * usd_gbp(s)
            hour_key, eq_h0 = s // 3600, eq
            inv_samples.append(coin * f_know * usd_gbp(s))
        if s % 86400 == 0 or day_key is None:
            eq = cash + coin * f_know
            if day_key is not None:
                passive = coin_start_day * (f_know - fair_day0)
                day_rows[day_key] = {"total": (eq - eq_day0) * usd_gbp(s), "passive": passive * usd_gbp(s),
                                     "hedged": hedge_day.get(day_key, 0.0)}
            day_key = dt.datetime.utcfromtimestamp(s).date().isoformat()
            eq_day0, fair_day0, coin_start_day = eq, f_know, coin
            placed_day0 = placed
        if in_halt(s):
            bid = ask = None
            need_requote = True
            while oi < len(bk.orders) and bk.orders[oi][0] // 1000 <= s:
                oi += 1
            continue
        if max_orders_day is not None and placed - placed_day0 >= max_orders_day:
            bid = ask = None  # the day's orders are spent: nothing rests until 00:00 UTC
            bid_left = ask_left = 0.0
            need_requote = True
        # re-price
        due = need_requote or (U == 1 and ref is not None and abs(1e4 * math.log(f_know / ref)) > theta) or (U > 1 and s % U == 0)
        if due and (max_orders_day is None or placed - placed_day0 < max_orders_day):
            ref = f_know
            inv = coin * f_know
            if hedge is None:
                skew = kappa * d * ((inv - target) / target if target > 0 else inv / max(cap_gbp * k0, 1e-9))
            else:
                skew = 0.0
            nb = ref * (1 - d - skew)
            na = ref * (1 + d - skew)
            if hedge is None:
                can_bid = active and cash >= 1.0 and inv < cap_gbp * k0
                can_ask = coin * na >= 1.0 and (active or target_frac == 0)  # outside a window: only selling back to flat
            else:
                can_bid = can_ask = active
            new_bid = nb if can_bid else None
            new_ask = na if can_ask else None
            if new_bid != bid or fb:
                placed += new_bid is not None
                bid = new_bid
                bid_left = (min(Q, cash) / nb) if (bid and hedge is None) else (Q / nb if bid else 0.0)
            if new_ask != ask or fa:
                placed += new_ask is not None
                ask = new_ask
                ask_left = min(Q / na, coin) if (ask and hedge is None) else (Q / na if ask else 0.0)
            need_requote = False
            fb = fa = False
        # the public takers of this second
        while oi < len(bk.orders) and bk.orders[oi][0] // 1000 <= s:
            ms, side, prints = bk.orders[oi]
            oi += 1
            if side > 0 and ask and ask_left > 0:
                if ask < prints[0][0]:
                    q, how = sum(x[1] for x in prints), "taker"
                else:
                    q, how = sum(x[1] for x in prints if x[0] > ask), "sweep"
                q = min(q * share, ask_left)
                if q > 0:
                    ask_left -= q
                    coin -= q if hedge is None else 0
                    cash += q * ask if hedge is None else 0
                    fills.append((s, -1, q, ask, f_true, how))
                    need_requote = fa = True
            elif side < 0 and bid and bid_left > 0:
                if bid > prints[0][0]:
                    q, how = sum(x[1] for x in prints), "taker"
                else:
                    q, how = sum(x[1] for x in prints if x[0] < bid), "sweep"
                q = min(q * share, bid_left)
                if q > 0:
                    bid_left -= q
                    coin += q if hedge is None else 0
                    cash -= q * bid if hedge is None else 0
                    fills.append((s, 1, q, bid, f_true, how))
                    need_requote = fb = True
        # the arbitrageur against a stale quote
        if arb:
            sa = ask is not None and ask_left > 0 and ask < f_true * (1 - x_arb / 1e4)
            sb = bid is not None and bid_left > 0 and bid > f_true * (1 + x_arb / 1e4)
            stale_a = (stale_a or s) if sa else None
            stale_b = (stale_b or s) if sb else None
            if sa and s - stale_a >= arb_delay:
                q = ask_left
                ask_left = 0.0
                coin -= q if hedge is None else 0
                cash += q * ask if hedge is None else 0
                fills.append((s, -1, q, ask, f_true, "arb"))
                need_requote = fa = True
            if sb and s - stale_b >= arb_delay:
                q = bid_left
                bid_left = 0.0
                coin += q if hedge is None else 0
                cash -= q * bid if hedge is None else 0
                fills.append((s, 1, q, bid, f_true, "arb"))
                need_requote = fb = True
    # close the last partial day
    s = s_end
    ec = math.exp(c / 1e4)
    f_know = F[s - 1 - t0] * ec
    eq = cash + coin * f_know
    if day_key is not None and day_key not in day_rows:
        day_rows[day_key] = {"total": (eq - eq_day0) * usd_gbp(s), "passive": coin_start_day * (f_know - fair_day0) * usd_gbp(s),
                             "partial": True}
    if hour_key is not None:
        hour_rows[hour_key] = (eq - eq_h0) * usd_gbp(s)
    # the hedged variant: each fill closed on Binance one second later at h bps
    if hedge is not None:
        hd = collections.defaultdict(float)
        hh = collections.defaultdict(float)
        for (sf, side, q, p, ft, cause) in fills:
            ec_ = ft / F[sf - t0]
            f_h = F[sf + 1 - t0] * ec_
            # we bought at p (side +1): sell on Binance at f_h*(1-h); we sold at p: buy back at f_h*(1+h)
            pnl = q * (f_h * (1 - hedge / 1e4) - p) if side > 0 else q * (p - f_h * (1 + hedge / 1e4))
            g = pnl * usd_gbp(sf)
            hd[dt.datetime.utcfromtimestamp(sf).date().isoformat()] += g
            hh[sf // 3600] += g
        day_rows = collections.OrderedDict((k, {"total": hd.get(k, 0.0), "passive": 0.0}) for k in day_rows)
        hour_rows = collections.OrderedDict((k, hh.get(k, 0.0)) for k in hour_rows)
    days = sum(1 for _ in day_rows) or 1
    span_days = (s_end - s_start) / 86400
    edge = [((ft - p) / ft if side > 0 else (p - ft) / ft) * 1e4 for (sf, side, q, p, ft, cause) in fills]
    mk = {}
    for h in (1, 5, 30, 300):
        v = []
        for (sf, side, q, p, ft, cause) in fills:
            i = sf + h - t0
            if i < len(F):
                ec_ = ft / F[sf - t0]
                fh = F[i] * ec_
                v.append(1e4 * ((fh - p) / p if side > 0 else (p - fh) / p))
        mk[h] = round(statistics.mean(v), 2) if v else None
    gross = sum(q * p * (usd_gbp(sf)) for (sf, side, q, p, ft, cause) in fills)
    return {
        "book": bk.name, "d_bps": d_bps, "cap_gbp": cap_gbp, "Q_gbp": Q_gbp, "U": U, "theta": theta, "kappa": kappa,
        "target_frac": target_frac, "arb": arb, "hedge_bps": hedge, "span_days": round(span_days, 2),
        "fills": len(fills), "fills_a_day": round(len(fills) / span_days, 1),
        "arb_fills": sum(1 for f in fills if f[5] == "arb"),
        "sweep_fills": sum(1 for f in fills if f[5] == "sweep"),
        "turnover_gbp_a_day": round(gross / span_days, 1), "orders_a_day": round(placed / span_days, 1),
        "edge_at_fill_bps_mean": round(statistics.mean(edge), 2) if edge else None,
        "inventory_gbp_mean": round(statistics.mean(inv_samples), 1) if inv_samples else None,
        "inventory_gbp_max": round(max(inv_samples), 1) if inv_samples else None,
        "spread_gbp_a_day": round(sum(q * abs(p - ft) * usd_gbp(sf) * (1 if (side > 0) == (p < ft) else -1)
                                      for (sf, side, q, p, ft, cause) in fills) / max(span_days, 1e-9), 3),
        "markout_maker_bps_mean": mk,
        "days": day_rows, "hours": hour_rows,
    }


def summary(r):
    tot = [v["total"] for v in r["days"].values()]
    pas = [v["passive"] for v in r["days"].values()]
    own = [a - b for a, b in zip(tot, pas)]
    sd = r["span_days"] or 1
    return {"total_a_day": round(sum(tot) / sd, 3), "passive_a_day": round(sum(pas) / sd, 3), "own_a_day": round(sum(own) / sd, 3),
            "days_own_pos": sum(1 for x in own if x > 0), "days": len(own),
            "worst_day_total": round(min(tot), 2) if tot else None, "worst_day_own": round(min(own), 2) if own else None,
            "worst_hour_total": round(min(r["hours"].values()), 2) if r["hours"] else None}


def boot_p(hourly, block=12, n=4000, seed=7):
    """P(mean <= 0) by a circular block bootstrap of hourly results, blocks of BLOCK hours."""
    import random
    x = list(hourly)
    m = len(x)
    if m < block * 2:
        return None
    rnd = random.Random(seed)
    k = m // block
    le = 0
    for _ in range(n):
        tot = 0.0
        for _ in range(k):
            st = rnd.randrange(m)
            for j in range(block):
                tot += x[(st + j) % m]
        if tot <= 0:
            le += 1
    return round(le / n, 4)
