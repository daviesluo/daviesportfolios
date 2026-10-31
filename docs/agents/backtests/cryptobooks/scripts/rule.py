# CRYPTOBOOKS-2 (2026-10-31): the full rule of the XRP/GBP maker, as one engine, on the public tape (replay.py's fill
# model, which stays as CRYPTOBOOKS' results pin it). Per second s:
#  - fair: Binance's last trade of the coin in second s-LAT (LAT >= 1 s of data latency) x USDT/USD / GBP/USD x the book's
#    trailing basis (replay.basis_steps); with STALE_GUARD G, no quote rests while Binance has printed nothing for G s
#    (the .u8 mask of binance_1s.py; absent, the guard is off);
#  - distance: d = max(D_MIN, VOL_K x sigma60), sigma60 the last 300 s of one-second Binance returns scaled to 60 s
#    (VOL_K 0: fixed d);
#  - quotes: bid fair*(1-d-k), ask fair*(1+d-k), k = KAPPA*d*coin/CAP (lean against held coin); a bid only while the coin is
#    worth less than CAP and pounds are left, an ask only for coin held (it starts in pounds and sells only what it bought);
#    each quote Q pounds; a side is re-priced when the fair has moved THETA bps since it was set (checked every U s), or
#    after a fill; a re-price is a cancel and a placement;
#  - fills: the public taker orders (replay.py's rule), less AHEAD pounds of a competitor resting at our price before us,
#    and, with REACT r, a competitor who improves one tick in front of a quote that has rested r s, after which only the
#    part of a taker order beyond REACT_SIZE pounds reaches us;
#  - the arbitrageur (ARB): any quote X_ARB bps beyond the true fair of the second is taken whole at once;
#  - the stop: when the coin held is marked STOP bps under its average cost, all of it is sold at once as a taker, at the
#    fair less 9 bps less EXIT_SLIP bps, and nothing is bid for COOLDOWN s;
#  - PENNY: each side one tick inside the others' touch when that is farther than d (the touch estimated as the median
#    distance from the fair of the first price of the side's last PENNY_N public taker orders within PENNY_WINDOW s);
#  - the regime gate (GATE w): quote only while the median of the last 20 public taker orders paid w bps or more over the
#    fair (the fast inner layer away); its coin is still offered when the gate closes;
#  - BUDGET: placements a UTC day (one main account's 1,000; a sub-account has no daily limit, reference §2);
#  - FX_CONST: GBP/USD held at its first value (a test of how much the FX source matters: the basis absorbs it).
# Reported a UTC day and hour in pounds: P&L marked to the fair, fills, placements and cancels, inventory, stops.
import collections, datetime as dt, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import BN_DIR, in_halt  # noqa: E402

TICK_BPS = 1.0  # one tick of a competitor's improvement, about 1 bp on XRP-GBP (0.0001 at 0.93) and SOL-GBP (0.001 at 71)

DEFAULT = dict(d_min=12.0, vol_k=0.0, theta=10.0, kappa=0.5, Q=200.0, cap=600.0, lat=1, U=1, arb=True, x_arb=10.0,
               ahead=0.0, react=None, react_size=200.0, stop=None, exit_slip=20.0, cooldown=3600, stale_guard=None,
               gate=None, budget=None, penny=False, penny_n=5, penny_window=600, t_from=None, t_to=None)


def load_mask(fair, coin):
    p = os.path.join(BN_DIR, f"{coin}.u8")
    if not os.path.exists(p):
        return None
    m = open(p, "rb").read()
    return m if len(m) == fair.n else None


def sim(bk, fair, **kw):
    p = dict(DEFAULT)
    p.update(kw)
    F, t0 = bk.F, bk.t0
    n = len(F)
    mask = load_mask(fair, bk.name.split("-")[0]) if p["stale_guard"] else None
    s0 = max(bk.steps[0][0] + 1, p["t_from"] or 0, t0 + 400)
    s1 = min(t0 + n - 302, p["t_to"] or 10 ** 12)
    usd_gbp = (lambda s: 1.0) if bk.gbp else (lambda s: 1.0 / bk.fx.at(s))
    oi = 0
    while oi < len(bk.orders) and bk.orders[oi][0] // 1000 < s0:
        oi += 1
    si = 0
    while si + 1 < len(bk.steps) and bk.steps[si + 1][0] <= s0:
        si += 1
    c = bk.steps[si][1]
    k0 = 1.0 / usd_gbp(s0)
    CAP, Q = p["cap"] * k0, p["Q"] * k0
    AHEAD, RSIZE = p["ahead"] * k0, p["react_size"] * k0
    cash, coin, cost = CAP, 0.0, 0.0  # cost: what the coin held cost, in quote currency
    bid = ask = None
    bid_left = ask_left = 0.0
    bid_since = ask_since = None
    ref = None
    placed = cancels = stops = 0
    fills = []
    hours = collections.OrderedDict()
    days = collections.OrderedDict()
    eq_h = eq_d = cash
    hk = dk = None
    inv = []
    need = True
    cool_until = 0
    last_trade = s0
    # rolling sigma: squared one-second returns over 300 s
    r2 = collections.deque()
    r2sum = 0.0
    # the regime: the last 20 public orders' paid-over-fair
    paid = collections.deque(maxlen=20)
    touch_a, touch_b = collections.deque(maxlen=50), collections.deque(maxlen=50)  # the others' touch, from their prints
    gate_open = p["gate"] is None
    lat = max(1, int(p["lat"]))
    placed_d0 = 0
    per_s = collections.Counter()  # placements a second, for the request-rate requirement
    for s in range(s0, s1):
        while si + 1 < len(bk.steps) and bk.steps[si + 1][0] <= s:
            si += 1
            c = bk.steps[si][1]
        ec = math.exp(c / 1e4)
        f_know = F[s - lat - t0] * ec
        f_true = F[s - t0] * ec
        x = math.log(F[s - lat - t0] / F[s - lat - 1 - t0])
        r2.append(x * x)
        r2sum += x * x
        if len(r2) > 300:
            r2sum -= r2.popleft()
        if mask is not None and mask[s - lat - t0]:
            last_trade = s
        # books
        if s % 3600 == 0 or hk is None:
            eq = cash + coin * f_know
            if hk is not None:
                hours[hk] = (eq - eq_h) * usd_gbp(s)
            hk, eq_h = s // 3600, eq
            inv.append(coin * f_know * usd_gbp(s))
        if s % 86400 == 0 or dk is None:
            eq = cash + coin * f_know
            if dk is not None:
                days[dk] = (eq - eq_d) * usd_gbp(s)
            dk, eq_d = dt.datetime.utcfromtimestamp(s).date().isoformat(), eq
            placed_d0 = placed
        if in_halt(s):
            if bid or ask:
                cancels += (bid is not None) + (ask is not None)
            bid = ask = None
            need = True
            while oi < len(bk.orders) and bk.orders[oi][0] // 1000 <= s:
                oi += 1
            continue
        stale = mask is not None and s - last_trade > p["stale_guard"]
        if p["budget"] is not None and placed - placed_d0 >= p["budget"]:
            stale = True  # the UTC day's placements are spent (one account's 1,000): nothing rests until midnight
        # the stop
        if p["stop"] is not None and coin * f_true * usd_gbp(s) > 1.0 and cost > 0:
            if (coin * f_true) / cost - 1 < -p["stop"] / 1e4:
                px = f_true * (1 - (9.0 + p["exit_slip"]) / 1e4)
                cash += coin * px
                fills.append((s, -1, coin, px, f_true, "stop"))
                coin = cost = 0.0
                stops += 1
                cool_until = s + p["cooldown"]
                if ask is not None:
                    cancels += 1
                ask, ask_left = None, 0.0
                need = True
        # re-price
        if not stale and (need or (s % p["U"] == 0 and ref is not None and abs(1e4 * math.log(f_know / ref)) > p["theta"])
                          or (bid is None and ask is None and s % p["U"] == 0)):
            ref = f_know
            sig60 = math.sqrt(max(0.0, r2sum) / max(1, len(r2)) * 60) * 1e4  # the running sum can dip a hair under 0
            d = max(p["d_min"], p["vol_k"] * sig60) / 1e4
            k = p["kappa"] * d * (coin * f_know) / CAP
            db = da = d
            if p["penny"]:  # one tick inside the others' touch, estimated from their recent prints, never nearer than d
                eb = [x for t_, x in touch_b if t_ >= s - p["penny_window"]][-p["penny_n"]:]
                ea = [x for t_, x in touch_a if t_ >= s - p["penny_window"]][-p["penny_n"]:]
                if len(eb) >= 3:
                    db = max(d, (statistics.median(eb) - TICK_BPS) / 1e4)
                if len(ea) >= 3:
                    da = max(d, (statistics.median(ea) - TICK_BPS) / 1e4)
            nb = ref * (1 - db - k)
            na = ref * (1 + da - k)
            can_bid = gate_open and s >= cool_until and cash >= 1.0 and coin * f_know < CAP
            can_ask = coin * na >= 1.0
            new_bid = nb if can_bid else None
            new_ask = na if can_ask else None
            if new_bid != bid or fb_flag(bid_left, bid, Q, cash):
                if bid is not None:
                    cancels += 1
                placed += new_bid is not None
                if new_bid is not None:
                    per_s[s] += 1
                bid = new_bid
                bid_left = min(Q, cash) / nb if bid else 0.0
                bid_since = s
            if new_ask != ask or (ask is not None and ask_left < min(Q / na, coin) - 1e-12):
                if ask is not None:
                    cancels += 1
                placed += new_ask is not None
                if new_ask is not None:
                    per_s[s] += 1
                ask = new_ask
                ask_left = min(Q / na, coin) if ask else 0.0
                ask_since = s
            need = False
        elif stale and (bid is not None or ask is not None):
            cancels += (bid is not None) + (ask is not None)
            bid = ask = None
            need = True
        # takers
        while oi < len(bk.orders) and bk.orders[oi][0] // 1000 <= s:
            ms, side, prints = bk.orders[oi]
            oi += 1
            vw = sum(x[0] * x[1] for x in prints) / sum(x[1] for x in prints)
            fk = F[s - 1 - t0] * ec
            paid.append(side * 1e4 * math.log(vw / fk))
            (touch_a if side > 0 else touch_b).append((s, side * 1e4 * math.log(prints[0][0] / fk)))
            if p["gate"] is not None and len(paid) >= 10:
                gate_open = statistics.median(paid) >= p["gate"]
            if side > 0 and ask and ask_left > 0:
                q = sum(x[1] for x in prints) if ask < prints[0][0] else sum(x[1] for x in prints if x[0] > ask)
                q -= AHEAD / ask
                if p["react"] is not None and s - ask_since >= p["react"]:
                    q = sum(x[1] for x in prints if x[0] > ask) - RSIZE / ask
                q = min(max(q, 0.0), ask_left)
                if q > 0:
                    ask_left -= q
                    cost -= cost * q / coin if coin > 0 else 0
                    coin -= q
                    cash += q * ask
                    fills.append((s, -1, q, ask, f_true, "taker"))
                    need = True
            elif side < 0 and bid and bid_left > 0:
                q = sum(x[1] for x in prints) if bid > prints[0][0] else sum(x[1] for x in prints if x[0] < bid)
                q -= AHEAD / bid
                if p["react"] is not None and s - bid_since >= p["react"]:
                    q = sum(x[1] for x in prints if x[0] < bid) - RSIZE / bid
                q = min(max(q, 0.0), bid_left)
                if q > 0:
                    bid_left -= q
                    coin += q
                    cost += q * bid
                    cash -= q * bid
                    fills.append((s, 1, q, bid, f_true, "taker"))
                    need = True
        if p["arb"]:
            if ask and ask_left > 0 and ask < f_true * (1 - p["x_arb"] / 1e4):
                q = ask_left
                ask_left = 0.0
                cost -= cost * q / coin if coin > 0 else 0
                coin -= q
                cash += q * ask
                fills.append((s, -1, q, ask, f_true, "arb"))
                need = True
            if bid and bid_left > 0 and bid > f_true * (1 + p["x_arb"] / 1e4):
                q = bid_left
                bid_left = 0.0
                coin += q
                cost += q * bid
                cash -= q * bid
                fills.append((s, 1, q, bid, f_true, "arb"))
                need = True
    s = s1
    ec = math.exp(c / 1e4)
    eq = cash + coin * F[s - 1 - t0] * ec
    if hk is not None:
        hours[hk] = (eq - eq_h) * usd_gbp(s)
    if dk is not None:
        days[dk] = (eq - eq_d) * usd_gbp(s)
    span = (s1 - s0) / 86400
    edge = [1e4 * ((ft - px) / ft if sd > 0 else (px - ft) / ft) for (sf, sd, q, px, ft, cs) in fills if cs != "stop"]
    weeks = collections.defaultdict(float)
    for k_, v in days.items():
        weeks[dt.date.fromisoformat(k_).isocalendar()[1]] += v
    return {"span_days": round(span, 2), "total": round(sum(days.values()), 2), "a_day": round(sum(days.values()) / span, 3),
            "fills": len(fills), "fills_a_day": round(len(fills) / span, 1), "arb_fills": sum(1 for f in fills if f[5] == "arb"),
            "stops": stops, "placed_a_day": round(placed / span, 1), "cancels_a_day": round(cancels / span, 1),
            "placed_max_a_second": max(per_s.values()) if per_s else 0,
            "placed_max_a_minute": max(collections.Counter(k // 60 for k in per_s.elements()).values()) if per_s else 0,
            "turnover_gbp_a_day": round(sum(q * px * usd_gbp(sf) for (sf, sd, q, px, ft, cs) in fills) / span, 1),
            "edge_bps": round(statistics.mean(edge), 2) if edge else None,
            "inv_mean": round(statistics.mean(inv), 1) if inv else None, "inv_max": round(max(inv), 1) if inv else None,
            "worst_hour": round(min(hours.values()), 2) if hours else None, "worst_day": round(min(days.values()), 2) if days else None,
            "worst_week": round(min(weeks.values()), 2) if weeks else None,
            "days": {k_: round(v, 3) for k_, v in days.items()}, "hours": list(hours.items())}


def fb_flag(left, bid, Q, cash):
    """A bid partly filled is topped back up to its size at the next re-price."""
    return bid is not None and left < min(Q, cash) / bid - 1e-12


def boot(xs, block, n=4000, seed=20261031):
    import random
    x = list(xs)
    m = len(x)
    if m < 2 * block:
        return None
    rnd = random.Random(seed)
    k = max(1, m // block)
    le = 0
    for _ in range(n):
        t = 0.0
        for _ in range(k):
            st = rnd.randrange(m)
            for j in range(block):
                t += x[(st + j) % m]
        le += t <= 0
    return round(le / n, 4)
