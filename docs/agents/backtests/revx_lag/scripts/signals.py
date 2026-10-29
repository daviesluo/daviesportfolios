"""REVX-LAG part 1, the mechanism: is Revolut X's GBP book predictable from what LIVE knows when it decides, and who trades it?

For every weekday minute t outside the FX closure, on each book (as of t, nothing stamped at or after t):
  G   the book's gap to fair, bps: ln(VWAP of the book's prints in [t − 15 min, t) / fair(t)); with none, the last print of the
      two hours before. fair(t) is the fair LIVE's engine priced paper minute t on.
  dX  GBP/USD's move over the last 15 minutes, bps: ln(X(t) / X(t − 15 min)), Exness at the minute's start. A rise lowers
      fair (pounds per coin) by about as much.
  D   Coinbase's premium over Revolut X: ln(Coinbase's price of the coin as of t / fair(t)) − G, bps.
The target, the book's move over the fill horizon: m_h = ln(VWAP of the prints in [t + 1 min, t + 1 min + h) / book(t)), bps,
h = 15, 60 and 240 minutes. A least-squares fit of m_h on (G, dX, D) on the in-sample half (to 2026-05-12) is judged on the
out-of-sample half: its coefficients, both halves' R², and the sign hit rate of the forecast where it is over 2 bps.

The flow: print sizes, the share of prints that buy, and how buying leans with G, dX and D (the probability a print is a buy,
by tercile of each), so it can be said who trades these books and whether they follow GBP/USD or Coinbase.

usage: RX_EX=<file> python3 -I signals.py OUT.json
"""
import bisect, collections, json, math, os, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lag_data as L  # noqa: E402

M, H = L.M, L.H
HS = (15, 60, 240)


def vwap(ts, px, qty, a, b):
    i, j = bisect.bisect_left(ts, a), bisect.bisect_left(ts, b)
    q = sum(qty[i:j])
    return (sum(p * w for p, w in zip(px[i:j], qty[i:j])) / q) if q > 0 else None


def last_before(ts, px, t, within):
    i = bisect.bisect_left(ts, t) - 1
    return px[i] if i >= 0 and t - ts[i] <= within else None


def ols(X, y):
    """Least squares with an intercept: coefficients [a, b1, b2, …]."""
    k = len(X[0]) + 1
    XtX = [[0.0] * k for _ in range(k)]; Xty = [0.0] * k
    for row, yy in zip(X, y):
        r = [1.0] + list(row)
        for i in range(k):
            Xty[i] += r[i] * yy
            for j in range(k):
                XtX[i][j] += r[i] * r[j]
    # solve by Gaussian elimination
    A = [XtX[i] + [Xty[i]] for i in range(k)]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(A[r][c]))
        A[c], A[p] = A[p], A[c]
        for r in range(k):
            if r != c and A[c][c]:
                f = A[r][c] / A[c][c]
                A[r] = [x - f * y for x, y in zip(A[r], A[c])]
    return [A[i][k] / A[i][i] for i in range(k)]


def r2(coef, X, y):
    pred = [coef[0] + sum(c * x for c, x in zip(coef[1:], row)) for row in X]
    my = st.fmean(y)
    sst = sum((v - my) ** 2 for v in y)
    sse = sum((v - p) ** 2 for v, p in zip(y, pred))
    big = [(p, v) for p, v in zip(pred, y) if abs(p) > 2]
    hit = sum(1 for p, v in big if p * v > 0) / len(big) if big else None
    return round(1 - sse / sst, 4) if sst else None, (round(hit, 3) if hit is not None else None), len(big)


def main(out):
    hm, hp, fm, fp = L.load_engine_inputs()
    pr = L.rx_prints(hp, fp)
    fair = L.fair_table(hm, fm)
    X, _ = L.exness_x(os.environ["RX_EX"])
    res = {}
    for b in L.BOOKS:
        cb = L.coinbase(b)
        ts = [p[0] for p in pr[b]]; px = [p[1] for p in pr[b]]; qty = [p[2] for p in pr[b]]
        rows = {h: [] for h in HS}
        series = []
        for t, (f, x, fu) in sorted(fair[b].items()):
            if t < L.START[b] or L.D.closure(t) or L.D.closure(t + 5 * H):
                continue
            bk = vwap(ts, px, qty, t - 15 * M, t) or last_before(ts, px, t, 2 * H)
            x0, x15 = X.at(t + 1), X.at(t - 15 * M + 1)
            c = cb.at(t)
            if not (bk and x0 and x15 and c):
                continue
            G = math.log(bk / f) * 1e4
            dX = math.log(x0 / x15) * 1e4
            Dv = math.log(c / f) * 1e4 - G
            series.append((t, G, dX, Dv))
            for h in HS:
                fut = vwap(ts, px, qty, t + M, t + M + h * M)
                if fut:
                    rows[h].append((t, (G, dX, Dv), math.log(fut / bk) * 1e4))
        r = {"minutes": len(series)}
        # the gap's own shape: distribution and persistence (hourly samples, AR(1) of G over 1 h, 4 h and 24 h)
        gs = [g for _, g, _, _ in series]
        r["gap_bps"] = {"median": round(st.median(gs), 2), "p10": round(sorted(gs)[len(gs) // 10], 2), "p90": round(sorted(gs)[9 * len(gs) // 10], 2),
                        "abs_over_10": round(sum(1 for g in gs if abs(g) > 10) / len(gs), 3)}
        gm = {t: g for t, g, _, _ in series}
        for lag in (60, 240, 1440):
            pairs = [(gm[t], gm[t + lag * M]) for t in gm if t % H == 0 and (t + lag * M) in gm]
            if len(pairs) > 30:
                a, b2 = zip(*pairs)
                ma, mb = st.fmean(a), st.fmean(b2)
                cov = sum((u - ma) * (v - mb) for u, v in pairs); va = sum((u - ma) ** 2 for u in a)
                r[f"gap_ar_{lag}m"] = round(cov / va, 3)
        for h in HS:
            ins = [(x, y) for t, x, y in rows[h] if t < L.SPLIT]; oos = [(x, y) for t, x, y in rows[h] if t >= L.SPLIT]
            coef = ols([x for x, _ in ins], [y for _, y in ins])
            r[f"h{h}"] = {"n_is": len(ins), "n_oos": len(oos), "coef_[a,G,dX,D]": [round(c, 4) for c in coef],
                          "r2_is_hit": r2(coef, [x for x, _ in ins], [y for _, y in ins]),
                          "r2_oos_hit": r2(coef, [x for x, _ in oos], [y for _, y in oos]),
                          "oos_refit_coef": [round(c, 4) for c in ols([x for x, _ in oos], [y for _, y in oos])]}
        # the flow: who trades, and does buying follow G, dX or D?
        sm = {t: (G, dX, Dv) for t, G, dX, Dv in series}
        buys = [(p[0], p[3] == "buy", p[2] * p[1]) for p in pr[b] if p[0] >= L.START[b]]
        sizes = sorted(v for _, _, v in buys)
        r["flow"] = {"prints": len(buys), "size_gbp_median": round(sizes[len(sizes) // 2], 2), "size_gbp_p90": round(sizes[9 * len(sizes) // 10], 2),
                     "buy_share": round(sum(1 for _, bb, _ in buys if bb) / len(buys), 3)}
        for j, name in enumerate(("G", "dX", "D")):
            vals = []
            for tt, bb, _ in buys:
                s = sm.get(tt // M * M)
                if s: vals.append((s[j], bb))
            vs = sorted(v for v, _ in vals)
            q1, q2 = vs[len(vs) // 3], vs[2 * len(vs) // 3]
            terc = [[bb for v, bb in vals if v < q1], [bb for v, bb in vals if q1 <= v < q2], [bb for v, bb in vals if v >= q2]]
            r["flow"][f"buy_share_by_{name}_tercile"] = {"cuts": [round(q1, 2), round(q2, 2)], "share": [round(sum(x) / len(x), 3) if x else None for x in terc]}
        res[b] = r
        print(b, json.dumps(r)[:1500], flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1])
