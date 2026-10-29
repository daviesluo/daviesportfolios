"""FX-SPEED-RX, why: how much of a GBP/USD move each venue's USDC-GBP and USDT-GBP prints carry, and how fast; how large the
X error is against the rungs and the re-price step.

1. Pass-through. For every weekday minute m whose GBP/USD move (Exness, m → m + 1 min) is at least 2 bps, the book's move
   from its last print before m + 1 min to its last print before m + 1 min + k (k = 0.5, 1, 2, 5, 15, 60 min), in log of the
   pound price of the coin. A coin worth a dollar moves by −ΔX: the slope of −(book move) on (FX move) is the share carried.
   Revolut X UK (its committed tape and the recorded prints) and Coinbase (the CB/OKX study's minute record, the last print of
   each minute) over the window both have, 2026-10-10 → 10-28, and Revolut X alone over its tape, 2025-12-16 → 2026-09-23.
2. The X error. |log X at go-live − log X at Yahoo's timing| in bps: Revolut X's executor rests at t + 90 s, Coinbase's
   simulator at t + 60 s; Yahoo's bar is the price of t − 32 s. Against the rungs (10, 20, 30 bps) and the 5 bps re-price step.
3. Prints: how many minutes a day carry one, and the median print size, on each venue.
usage: RX_EX=<file> python3 -I why.py OUT.json
"""
import bisect, collections, datetime, gzip, json, math, os, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "fair_price", "scripts"))
sys.path.insert(0, os.path.join(BT, "fair_price_cb_okx", "scripts"))
import fp_data as D  # noqa: E402
import fpc as C  # noqa: E402
import revx_long_ex as RX  # noqa: E402

M = 60_000
ms = lambda *a: int(datetime.datetime(*a, tzinfo=datetime.timezone.utc).timestamp() * 1000)  # noqa: E731
KS = (0.5, 1, 2, 5, 15, 60)


def weekday_open(t):
    return not C.is_closure(t) and not C.is_closure(t + 61 * M)


def tape_prints(book):
    out = []
    p = os.path.join(BT, "inputs", "pr5_2026-09-23", "trades", f"{book}.jsonl.gz")
    for l in gzip.open(p, "rt"):
        r = json.loads(l)
        if r["region"] == "UK":
            out.append((int(r["ts"]), float(r["price"]), float(r["qty"])))
    return sorted(out)


def series_from(prints):
    ts = [p[0] for p in prints]; px = [p[1] for p in prints]
    def last(t):
        i = bisect.bisect_left(ts, t) - 1
        return px[i] if i >= 0 and t - ts[i] <= 120 * M else None
    return last


def passthrough(last, X, t0, t1):
    out = {}
    rows = []
    for m in range(t0, t1, M):
        if not weekday_open(m):
            continue
        a, b = X(m), X(m + M)
        if not a or not b:
            continue
        d = math.log(b / a)
        if abs(d) < 2e-4:
            continue
        p0 = last(m + M)
        if not p0:
            continue
        rows.append((m, d, p0))
    for k in KS:
        xs, ys = [], []
        for m, d, p0 in rows:
            p1 = last(m + M + int(k * M))
            if p1:
                xs.append(d); ys.append(-math.log(p1 / p0))
        if len(xs) > 20:
            mx, my = st.fmean(xs), st.fmean(ys)
            sxx = sum((x - mx) ** 2 for x in xs)
            out[str(k)] = {"slope": round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx, 3), "n": len(xs)}
    return out


def main(out_path):
    E = RX.RxEx(os.environ["RX_EX"])
    X = lambda t: E.at(t)  # noqa: E731  (minute starts: offset 0)
    res = {}
    W = (ms(2026, 10, 10), ms(2026, 10, 28))
    fwd = D.load_prints()
    for b in ("USDC-GBP", "USDT-GBP"):
        rx = sorted(set(tape_prints(b)) | {(p[0], p[1] * D.TICK, p[2]) for p in fwd[b]})
        lr = series_from(rx)
        cbm = C.load_minutes(b)
        cbp = sorted((m * M + 59_999, r["last"], r["vol"]) for m, r in cbm.items() if r["last"])
        lc = series_from(cbp)
        res[b] = {"revx_10-10_10-28": passthrough(lr, X, *W), "coinbase_10-10_10-28": passthrough(lc, X, *W),
                  "revx_tape_2025-12-16_2026-09-23": passthrough(lr, X, ms(2025, 12, 16), ms(2026, 9, 23))}
        days = (W[1] - W[0]) / 86_400_000
        rmin = {p[0] // M for p in rx if W[0] <= p[0] < W[1]}
        res[b]["minutes_with_a_print_per_day"] = {"revx": round(len(rmin) / days, 1),
                                                  "coinbase": round(sum(1 for m, r in cbm.items() if W[0] <= m * M < W[1] and r["prints_n"] > 0) / days, 1)}
        res[b]["prints_per_day"] = {"revx": round(sum(1 for p in rx if W[0] <= p[0] < W[1]) / days, 1),
                                    "coinbase": round(sum(r["prints_n"] for m, r in cbm.items() if W[0] <= m * M < W[1]) / days, 1)}
        print(b, json.dumps(res[b]), flush=True)
    err = {}
    for name, go in (("revx_t+90", 90), ("coinbase_t+60", 60)):
        v = []
        for m in range(ms(2025, 12, 16), ms(2026, 10, 28), M):
            if not weekday_open(m):
                continue
            a = E.at(m - M + 28_000); b = E.at(m + go * 1000) if go % 60 == 0 else E.at(m + M + (go - 60) * 1000)
            if a and b:
                v.append(abs(math.log(b / a)) * 1e4)
        v.sort()
        q = lambda p: round(v[int(p * (len(v) - 1))], 3)  # noqa: E731
        err[name] = {"n": len(v), "median_bps": q(0.5), "p90": q(0.9), "p99": q(0.99), "share_over_5bps": round(sum(1 for x in v if x > 5) / len(v), 4),
                     "share_over_10bps": round(sum(1 for x in v if x > 10) / len(v), 5)}
    res["x_error_yahoo_vs_golive"] = err
    print(json.dumps(err), flush=True)
    json.dump(res, open(out_path, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1])
