"""Part 3a of the fair-price study: candidate fairs on Coinbase's four books over 2025-11-21 → 2026-10-09, PR5's frozen
simulator, the paper rows' fill model, one candidate at a time. In sample and out of sample by date:
IS 2025-11-21 → 2026-05-15, OOS 2026-05-15 → 2026-10-09. The production weeks after it are prod.py's.

Inputs, all committed and read-only: SCQ-VENUES' Coinbase minute bars (../../scq_venues/inputs/, proven equal to the prints),
CJ5's GBP/USD and SCQ-VENUES' EUR/USD (Exness minute closes to 2026-09-30, then Yahoo's, as the engine's), the stablecoins'
hourly dollar closes: Revolut X UK's USDC-USD / USDT-USD (../../inputs/pr5_2026-09-23/candles/ to 2026-09-23, then
../../cj5/inputs/revx_usd_hours_2026-09-16_10-09.json.gz): the ENGINE's source; Coinbase's USDT-USD and Bitstamp's USDC/USD
(CJ5's usd_hourly): the venue screen's source.

The simulator is `pr5_sim.simulate`, imported read-only through SCQ-VENUES' `BarBook`, called unchanged: £100 a rung through
the quote, 10 % of the minute, Coinbase's taker plus half the touch on the stop (as `sv_sim.py` and `cb_quotes.ts`). Only the
book's fair array `F` differs between candidates; the dark minutes are the engine's (no FX bar in the last ten minutes), or the
held rate's for the weekend arm. Every candidate input at minute t is a bar or close that ended before t (no look-ahead), but
for the row marked foresight, which reads the FX bar of minute t itself and bounds what a faster FX feed could ever bring.

Candidates (fair = fairU / FX × (1 + α · basis)):
  engine          fairU Revolut X UK's F3 (the median of the hourly closes of [t − 24 h, t − 1 h]): what the Coinbase rows run
  par             fairU = 1
  cb_own          USDC 1 (Coinbase converts USDC and USD 1:1 and lists no USDC-USD book); USDT Coinbase USDT-USD's F3
  screen          the venue screen's: USDC Bitstamp USDC/USD's F3, USDT Coinbase USDT-USD's F3 (the history the prereg read)
  *+bL_a          the base times (1 + a × the median of (last print / base fair − 1) over the minutes with prints in [t − L, t))
  venue_L         the median of the book's own last prints over [t − L, t): no FX at all (the "blend" at weight 1)
  cb_live         USDC 1; USDT Coinbase USDT-USD's last one-minute close (../inputs/cb_usdtusd_1m_hist.json.gz, fetch_cb_usdt.py)
  xbook           no Yahoo: the FX implied by the sibling book of the same currency and USDT-USD (USDC-XXX = USDT-XXX's last
                  print / USDT-USD; USDT-XXX = USDC-XXX's last print × USDT-USD), the sibling's print at most ten minutes old
  engine_fx_older the engine's, with the FX bar one minute older; engine_fx_foresight with the bar of minute t (look-ahead)
Every candidate also runs as the weekend arm ("hold:", the FX bar held up to 60 hours), but the two FX-timing rows.
usage: python3 -I hist.py OUT.json.gz   (about twenty minutes on four cores; its output is not committed, analyze.py's is)
"""
import bisect, collections, gzip, json, multiprocessing as mp, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "scq_venues", "scripts"))
import sv_inputs as SI  # noqa: E402
import bars as BR  # noqa: E402
import inputs as CI  # noqa: E402  (CJ5's)
import fpc as C  # noqa: E402
P = BR.P
M, H, DAY = 60000, 3600000, 86400000
T0, TS, T1 = CI.ms("2025-11-21T00:00"), CI.ms("2026-05-15T00:00"), CI.ms("2026-10-09T00:00")
KEYS = ["coinbase:USDC-GBP", "coinbase:USDT-GBP", "coinbase:USDC-EUR", "coinbase:USDT-EUR"]
TAKER = 0.000045
HOLD_MS = 60 * H
LS = {"1h": 60, "6h": 360, "24h": 1440, "72h": 4320}


def revx_hours():
    """Revolut X UK's hourly closes of USDC-USD and USDT-USD, as the engine reads them."""
    out = {}
    for sym in ("USDC-USD", "USDT-USD"):
        rows = json.load(gzip.open(os.path.join(BT, "inputs", "pr5_2026-09-23", "candles", f"{sym}_60.json.gz"), "rt"))["rows"]
        h = {int(r["start"]): float(r["close"]) for r in rows}
        extra = json.load(gzip.open(os.path.join(BT, "cj5", "inputs", "revx_usd_hours_2026-09-16_10-09.json.gz"), "rt"))[sym]["body"]["data"]
        for r in extra:
            h[int(r["start"])] = float(r["close"])
        out[sym[:4]] = sorted(h.items())
    return out


def rolling_basis(n, last, base, L):
    """adj[i] = median over j in [i - L, i) with a print and a base fair of (last[j] / base[j] - 1); carried when the window
    holds fewer than five, None before any."""
    adj, win, srt = [None] * n, collections.deque(), []
    prev = None
    for i in range(n):
        while win and win[0][0] < i - L:
            _, v = win.popleft()
            del srt[bisect.bisect_left(srt, v)]
        if len(srt) >= 5:
            k = len(srt)
            prev = srt[k // 2] if k % 2 else (srt[k // 2 - 1] + srt[k // 2]) / 2
        adj[i] = prev
        if last[i] is not None and base[i]:
            v = last[i] / base[i] - 1
            win.append((i, v)); bisect.insort(srt, v)
    return adj


def rolling_venue(n, last, L):
    out, win, srt, prev = [None] * n, collections.deque(), [], None
    for i in range(n):
        while win and win[0][0] < i - L:
            _, v = win.popleft()
            del srt[bisect.bisect_left(srt, v)]
        if len(srt) >= 5:
            k = len(srt)
            prev = srt[k // 2] if k % 2 else (srt[k // 2 - 1] + srt[k // 2]) / 2
        out[i] = prev
        if last[i] is not None:
            win.append((i, last[i])); bisect.insort(srt, last[i])
    return out


def build(key):
    venue, name, quote, coin, tick = SI.BOOKS[key]
    bars, _ = SI.load_bars(key)
    gb_t, gb_v = CI.load_fx()
    eu_t, eu_v = SI.load_eurusd()
    ax_t, ax_v = (gb_t, gb_v) if quote == "GBP" else (eu_t, eu_v)
    rx = revx_hours()[coin]
    B = BR.BarBook(key, {str(k): v for k, v in bars.items()}, T0, T1, ax_t, ax_v, [h[0] for h in rx], [h[1] for h in rx], tick, gbp=True)
    n = B.n
    for i in range(n):                       # a EUR book's X: its pounds per euro (sv_sim.build_book)
        if quote == "EUR":
            g = C.bar_at(T0 + i * M, gb_t, gb_v)
            B.X[i] = (B.Xreal[i] / g) if (B.X[i] and g) else None
    # the FX bar of minute t itself (foresight) and one minute older, and the rate held through a closure (the weekend arm)
    xs_t = {t: v for t, v in zip(ax_t, ax_v) if T0 - 70 * M <= t < T1}
    last = [None] * n
    for k, b in bars.items():
        t = int(k) * M
        if T0 <= t < T1:
            last[(t - T0) // M] = b[5] / 1e8
    S = {"n": n, "quote": quote, "coin": coin, "tick": tick, "last": last, "Xreal": list(B.Xreal), "X": list(B.X)}
    S["x_now"] = [xs_t.get(T0 + i * M) for i in range(n)]
    S["x_old"] = [B.Xreal[i - 1] if i > 0 else None for i in range(n)]
    # hold: carry the last bar's value through a gap of up to 60 h since that bar started
    xh, Xh, lastbar, lastX, lastXt = [None] * n, [None] * n, None, None, None
    k = bisect.bisect_left(ax_t, T0 - HOLD_MS)
    for i in range(n):
        t = T0 + i * M
        while k < len(ax_t) and ax_t[k] <= t - M:
            lastbar = (ax_t[k], ax_v[k]); k += 1
        if lastbar and lastbar[0] >= t - HOLD_MS:
            xh[i] = lastbar[1]
        if B.X[i]:
            lastX, lastXt = B.X[i], t
        Xh[i] = B.X[i] if B.X[i] else (lastX if (lastX and xh[i] is not None) else None)
    S["x_hold"], S["X_hold"] = xh, Xh
    # the sibling book of the same currency (USDC-GBP's is USDT-GBP, and so on): its last print each minute, for `xbook`
    sib = "coinbase:" + ("USDT-" if coin == "USDC" else "USDC-") + quote
    sb, _ = SI.load_bars(sib)
    S["sib_last"] = [None] * n
    for k, b in sb.items():
        t = int(k) * M
        if T0 <= t < T1:
            S["sib_last"][(t - T0) // M] = b[5] / 1e8
    return B, S


def cb_usdt_minutes():
    """Coinbase USDT-USD one-minute closes over the history window (fetch_cb_usdt.py), or None when not fetched."""
    p = os.path.join(C.ROOT, "inputs", "cb_usdtusd_1m_hist.json.gz")
    if not os.path.exists(p):
        return None
    rows = {}
    for f in (p, os.path.join(C.ROOT, "inputs", "cb_usdtusd_1m.json.gz")):    # 2025-11-19 → 10-08, then 10-08 → 10-29
        for c in json.load(gzip.open(f, "rt"))["candles"]:
            rows[c[0]] = float(c[1])
    ks = sorted(rows)
    return [k * M for k in ks], [rows[k] for k in ks]


def fairs(S, hours):
    """{name: (F array, X array)} for every candidate on one book."""
    n, coin = S["n"], S["coin"]
    rx, cbu = hours["revx"][coin], hours["screen"][coin]
    f_rx, f_cb = C.F3(rx), C.F3(cbu)
    t_of = lambda i: T0 + i * M
    U = {"engine": [f_rx(t_of(i)) for i in range(n)],
         "par": [1.0] * n,
         "cb_own": [1.0] * n if coin == "USDC" else [f_cb(t_of(i)) for i in range(n)],
         "screen": [f_cb(t_of(i)) for i in range(n)]}
    out = {}
    for arm, xr, X in (("", S["Xreal"], S["X"]), ("hold:", S["x_hold"], S["X_hold"])):
        base = {}
        for u, uu in U.items():
            base[u] = [(uu[i] / xr[i]) if (uu[i] and xr[i]) else None for i in range(n)]
            out[arm + u] = (base[u], X)
        for u in ("engine", "cb_own"):
            for L, w in LS.items():
                adj = rolling_basis(n, S["last"], base[u], w)
                for a in (0.5, 1.0):
                    out[f"{arm}{u}+b{L}_{a}"] = ([(base[u][i] * (1 + a * adj[i])) if (base[u][i] and adj[i] is not None) else base[u][i] for i in range(n)], X)
        for L in ("1h", "6h", "24h"):
            v = rolling_venue(n, S["last"], LS[L])
            out[f"{arm}venue_{L}"] = ([v[i] if base["engine"][i] else None for i in range(n)], X)
        cu = hours.get("cb_usdt_1m")
        if cu:
            # cb_live: USDT's dollar price from Coinbase USDT-USD's last one-minute close (USDC 1), over the engine's FX bar
            ut, uv = cu
            ul = [C.bar_at(t_of(i), ut, uv) for i in range(n)]
            live = [(((1.0 if coin == "USDC" else ul[i]) or 0) / xr[i]) if (xr[i] and (coin == "USDC" or ul[i])) else None for i in range(n)]
            out[arm + "cb_live"] = (live, X)
            # xbook: the FX implied by the sibling book and USDT-USD, no Yahoo: USDC-XXX = USDT-XXX's last print / USDT-USD,
            # USDT-XXX = USDC-XXX's last print × USDT-USD; the sibling's print at most ten minutes old, else cb_live stands in
            xb, lo, lot = [None] * n, None, None
            for i in range(n):
                if i > 0 and S["sib_last"][i - 1] is not None:
                    lo, lot = S["sib_last"][i - 1], i - 1
                if live[i] is None:
                    continue
                if lo is not None and lot >= i - 10 and ul[i]:
                    xb[i] = lo / ul[i] if coin == "USDC" else lo * ul[i]
                else:
                    xb[i] = live[i]
            out[arm + "xbook"] = (xb, X)
            for L, a in (("6h", 0.5), ("6h", 1.0), ("24h", 0.5)):
                adj = rolling_basis(n, S["last"], xb, LS[L])
                out[f"{arm}xbook+b{L}_{a}"] = ([(xb[i] * (1 + a * adj[i])) if (xb[i] and adj[i] is not None) else xb[i] for i in range(n)], X)
        if arm == "":
            eng = U["engine"]
            out["engine_fx_older"] = ([(eng[i] / S["x_old"][i]) if (eng[i] and S["x_old"][i] and xr[i]) else None for i in range(n)], X)
            out["engine_fx_foresight"] = ([(eng[i] / S["x_now"][i]) if (eng[i] and S["x_now"][i] and xr[i]) else None for i in range(n)], X)
    return out


def task(key):
    B, S = build(key)
    hours = {"revx": revx_hours(), "screen": {c: v for c, v in CI.load_usd().items() if c in ("USDC", "USDT")}, "cb_usdt_1m": cb_usdt_minutes()}
    half = json.load(open(os.path.join(BT, "scq_venues", "inputs", "touch.json")))[key]["half_spread"]
    F0, X0 = list(B.F), list(B.X)
    res = {}
    fs = fairs(S, hours)
    # the engine's fair as BarBook built it must be the one rebuilt here
    assert all((a is None and b is None) or (a is not None and b is not None and abs(a - b) < 1e-12) for a, b in zip(F0, fs["engine"][0])), key
    saved = (P.TICK, P.FEE, P.HALF_SPREAD)
    try:
        P.TICK, P.FEE, P.HALF_SPREAD = S["tick"], TAKER, half
        for name, (F, X) in fs.items():
            B.F, B.X = F, X
            trips, orders = P.simulate(B, size=100.0)
            res[name] = {"orders": sum(orders.values()),
                         "trips": [[x["t_entry"], x["t_exit"], round(x["pnl_usd"], 6), round(x["notional_usd"], 4), x["how"][0], x["side"][0], x["k"]] for x in trips]}
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD = saved
        B.F, B.X = F0, X0
    lit = sum(1 for f in F0 if f)
    print("done", key, len(fs), flush=True)
    return key, res, {"minutes": S["n"], "lit_engine": lit}


def main(out):
    with mp.Pool(4) as pool:
        rs = pool.map(task, KEYS)
    json.dump({"window": {"T0": T0, "TS": TS, "T1": T1}, "books": {k: {"runs": r, "meta": m} for k, r, m in rs}}, gzip.open(out, "wt"))


if __name__ == "__main__":
    main(sys.argv[1])
