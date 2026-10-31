# CRYPTOBOOKS (2026-10-31): what Revolut X's public crypto tape says against Binance's one-second price.
# For every UK book with a pulled tape (trades.py) over 2026-10-17 -> 10-31, outside the 10-20 halt:
#  - volume: prints, taker orders (prints of one ms and side folded), quote and dollar volume a day, buy share, sizes;
#  - where takers traded against the outside fair of the second before (dev, bps), split by side: the book's centre
#    against the outside price (its basis, by day) and its effective half-spread;
#  - markouts: the taker's gain at 0 / 1 / 5 / 30 / 300 s, side x (fair(t+h) / price), against the basis-corrected fair
#    (the trailing three hours' centre), so a maker's gain on that fill is its negative; and the move part alone
#    (fair(t+h) / fair(t)), which is the adverse selection a maker pays beyond the spread;
#  - staleness: OLS of dev on the side and the outside move over the last k seconds; a slope of -1 means the price the
#    taker met had not moved at all over those k seconds, 0 that it had moved fully;
#  - picks: taker orders whose instant gain beat the 9 bps taker fee (a stale quote taken), and 19 bps (the fee and a
#    10 bps Binance hedge); a pick's age is how many seconds back the outside price last stood at the print's price.
# Writes results/tape.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> python3 -I tape.py BOOK...
import collections, datetime as dt, json, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair, in_halt, load_tape, pct, takers  # noqa: E402

H = [0, 1, 5, 30, 300]
K = [1, 2, 3, 5, 10, 20, 30, 60, 120, 300]
TRAIL = 3 * 3600


def ols(rows):
    """y = a + b*side + c*x, returns c (and its t)."""
    n = len(rows)
    if n < 30:
        return None, None
    # normal equations for [1, s, x]
    S = [[0.0] * 3 for _ in range(3)]
    r = [0.0] * 3
    for y, s, x in rows:
        v = (1.0, s, x)
        for i in range(3):
            r[i] += v[i] * y
            for j in range(3):
                S[i][j] += v[i] * v[j]
    # solve 3x3
    import copy
    A = copy.deepcopy(S)
    b = r[:]
    for i in range(3):
        p = max(range(i, 3), key=lambda k: abs(A[k][i]))
        A[i], A[p] = A[p], A[i]
        b[i], b[p] = b[p], b[i]
        for k in range(i + 1, 3):
            f = A[k][i] / A[i][i]
            for j in range(i, 3):
                A[k][j] -= f * A[i][j]
            b[k] -= f * b[i]
    x = [0.0] * 3
    for i in (2, 1, 0):
        x[i] = (b[i] - sum(A[i][j] * x[j] for j in range(i + 1, 3))) / A[i][i]
    res = sum((y - x[0] - x[1] * s - x[2] * xx) ** 2 for y, s, xx in rows) / (n - 3)
    # var of c: res * inv(S)[2][2]; invert S by cofactors
    a, bb, c, d, e, f, g, h, i = S[0][0], S[0][1], S[0][2], S[1][0], S[1][1], S[1][2], S[2][0], S[2][1], S[2][2]
    det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g)
    inv22 = (a * e - bb * d) / det
    se = math.sqrt(max(res * inv22, 1e-18))
    return x[2], x[2] / se


def book_stats(book, fair):
    F = fair.series(book)
    t0, n = fair.t0, fair.n
    fx = fair.fx
    tape = [r for r in load_tape(book) if t0 + 400 <= r[0] // 1000 < t0 + n - 400 and not in_halt(r[0] // 1000)]
    if not tape:
        return None
    tk = takers(tape)
    days = sorted({dt.datetime.utcfromtimestamp(r[0] / 1000).date().isoformat() for r in tape})
    ndays = (tape[-1][0] - tape[0][0]) / 86400e3
    usd = (lambda sec: fx.at(sec)) if book.endswith("-GBP") else (lambda sec: 1.0)
    qv = sum(p * q for _, p, q, _ in tape)
    uv = sum(p * q * usd(ms // 1000) for ms, p, q, _ in tape)
    daily = collections.defaultdict(float)
    for ms, p, q, _ in tape:
        daily[dt.datetime.utcfromtimestamp(ms / 1000).date().isoformat()] += p * q * usd(ms // 1000)
    sizes = [vw * q * usd(ms // 1000) for ms, _, q, _, vw, _ in tk]
    # dev at the print against the outside fair of the second before
    devs = []
    for ms, worst, q, s, vw, k in tk:
        sec = ms // 1000
        f0 = F[sec - 1 - t0]
        devs.append((sec, s, 1e4 * math.log(vw / f0), q * vw * usd(sec)))
    # trailing centre (basis): (median buy dev + median sell dev) / 2 over the last TRAIL s
    centre = []
    j = 0
    win_b, win_s = collections.deque(), collections.deque()
    for idx, (sec, s, d, _) in enumerate(devs):
        while j < idx and devs[j][0] < sec - TRAIL:
            j += 1
        bs = [x[2] for x in devs[j:idx] if x[1] > 0]
        ss = [x[2] for x in devs[j:idx] if x[1] < 0]
        if len(bs) >= 5 and len(ss) >= 5:
            centre.append((statistics.median(bs) + statistics.median(ss)) / 2)
        else:
            centre.append(None)
    buys = [d for _, s, d, _ in devs if s > 0]
    sells = [d for _, s, d, _ in devs if s < 0]
    by_day = collections.defaultdict(lambda: ([], []))
    for sec, s, d, _ in devs:
        by_day[dt.datetime.utcfromtimestamp(sec).date().isoformat()][0 if s > 0 else 1].append(d)
    basis_day = {k: round((statistics.median(v[0]) + statistics.median(v[1])) / 2, 1) for k, v in sorted(by_day.items())
                 if len(v[0]) >= 10 and len(v[1]) >= 10}
    # markouts against the basis-corrected fair
    mk = {h: [] for h in H}
    mv = {h: [] for h in H}
    wsum = {h: [0.0, 0.0] for h in H}
    picks = [0, 0.0, 0.0]
    picks19 = [0, 0.0, 0.0]
    ages = []
    stale_rows = {k: [] for k in K}
    for (ms, worst, q, s, vw, kk), (sec, _, d, notional), c in zip(tk, devs, centre):
        if c is None:
            continue
        f0 = F[sec - 1 - t0] * math.exp(c / 1e4)
        for h in H:
            i = sec - 1 + h - t0
            if i >= n:
                continue
            fh = F[i] * math.exp(c / 1e4)
            g = s * 1e4 * math.log(fh / vw)
            mk[h].append(g)
            mv[h].append(s * 1e4 * math.log(fh / f0))
            wsum[h][0] += g * notional
            wsum[h][1] += notional
        g0 = s * 1e4 * math.log(f0 / vw)
        if g0 > 9:
            picks[0] += 1
            picks[1] += notional
            picks[2] += (g0 - 9) / 1e4 * notional
            i0 = sec - 1 - t0
            age = None
            for k in range(0, 301):
                if i0 - k < 0:
                    break
                if s * math.log(F[i0 - k] * math.exp(c / 1e4) / vw) <= 0:
                    age = k
                    break
            ages.append(age if age is not None else 999)
        if g0 > 19:
            picks19[0] += 1
            picks19[1] += notional
            picks19[2] += (g0 - 19) / 1e4 * notional
        for k in K:
            i = sec - 1 - t0
            if i - k < 0:
                continue
            x = 1e4 * math.log(F[i] / F[i - k])
            stale_rows[k].append((d - c, s, x))
    out = {
        "book": book, "days": len(days), "span_days": round(ndays, 2), "prints": len(tape), "taker_orders": len(tk),
        "prints_a_day": round(len(tape) / ndays, 1), "taker_orders_a_day": round(len(tk) / ndays, 1),
        "quote_volume_a_day": round(qv / ndays), "usd_volume_a_day": round(uv / ndays),
        "usd_volume_daily_median": round(statistics.median(daily.values())),
        "buy_share_of_orders": round(sum(1 for r in tk if r[3] > 0) / len(tk), 3),
        "order_usd_p50": round(pct(sizes, 0.5), 1), "order_usd_p90": round(pct(sizes, 0.9), 1),
        "order_usd_mean": round(statistics.mean(sizes), 1),
        "share_orders_over_1k": round(sum(1 for x in sizes if x > 1000) / len(sizes), 3),
        "dev_buy_p50": round(statistics.median(buys), 1) if buys else None,
        "dev_sell_p50": round(statistics.median(sells), 1) if sells else None,
        "half_spread_eff": round((statistics.median(buys) - statistics.median(sells)) / 2, 1) if buys and sells else None,
        "basis_by_day": basis_day,
        "markout_taker_gain_mean": {h: round(statistics.mean(v), 2) for h, v in mk.items() if v},
        "markout_taker_gain_p50": {h: round(statistics.median(v), 2) for h, v in mk.items() if v},
        "markout_taker_gain_usd_weighted": {h: round(w[0] / w[1], 2) for h, w in wsum.items() if w[1]},
        "move_after_mean": {h: round(statistics.mean(v), 2) for h, v in mv.items() if v},
        "picks_over_9bps": {"orders": picks[0], "share": round(picks[0] / max(1, len(mk[0])), 3),
                            "usd": round(picks[1]), "usd_net_of_fee": round(picks[2], 2),
                            "usd_net_a_day": round(picks[2] / ndays, 2),
                            "age_s_p25_p50_p75": [pct(ages, 0.25), pct(ages, 0.5), pct(ages, 0.75)] if ages else None,
                            "age_le_1s_share": round(sum(1 for a in ages if a <= 1) / len(ages), 3) if ages else None,
                            "age_ge_5s_share": round(sum(1 for a in ages if 5 <= a < 999) / len(ages), 3) if ages else None},
        "picks_over_19bps": {"orders": picks19[0], "usd": round(picks19[1]), "usd_net_of_fee_and_hedge": round(picks19[2], 2),
                             "usd_net_a_day": round(picks19[2] / ndays, 2)},
        "staleness_slope": {k: (lambda c: [round(c[0], 3), round(c[1], 1)] if c[0] is not None else None)(ols(v))
                            for k, v in stale_rows.items()},
    }
    return out


def main(books):
    fair = Fair()
    path = os.path.join(ROOT, "results", "tape.json")
    res = json.load(open(path)) if os.path.exists(path) else {}
    for b in books:
        try:
            r = book_stats(b, fair)
        except FileNotFoundError:
            r = None
        if r:
            res[b] = r
            print(json.dumps(r))
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(res)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1:])
