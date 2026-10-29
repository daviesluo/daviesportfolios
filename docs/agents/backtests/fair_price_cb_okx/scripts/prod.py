"""Part 3b of the fair-price study: the same candidate fairs replayed on the Coinbase rows' own production record,
2026-10-10 → 10-29 ("with Euros") and 10-13 → 10-29 ("with Euros - 1", the rates held through a closure).

The replay is the pre-registered faithfulness check's (`../../cbpaper/scripts/replay.py`, imported read-only): PR5's frozen
`pr5_sim.simulate` on the engine's own minute record (each minute's four side extremes and last print, its volume), £/€100 a
rung in the book's own currency, Coinbase's stop cost. With the stored fair it must reproduce the engine's round trips
(checked first, printed as `reproduce`). Each candidate then replaces only the fair, minute for minute, where the engine had
one (so the dark minutes and the release blackout of 10-28 are the engine's); its inputs at minute m are bars and closes that
ended before m (Yahoo's stored GBP/USD and EUR/USD, Revolut X's stored hourly closes, Coinbase's USDT-USD one-minute candles,
the book's own last prints of earlier minutes).

P&L is in the book's currency per trip, turned into pounds at the book's pounds per unit (`x`) of the trip's exit minute (the
last known one in a closure), as the engine does. Halves: 10-10 (10-13) → 10-20 and 10-20 → 10-29, by entry minute.
usage: python3 -I prod.py OUT.json[.gz]
"""
import bisect, collections, datetime, gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "cbpaper", "scripts"))
import replay as R  # noqa: E402  (the faithfulness check's MinuteBook and its frozen simulator, read-only)
import fpc as C  # noqa: E402
import hist as HI  # noqa: E402  (the rolling basis and venue medians, the same functions as the history's)
P = R.P
M, H, DAY = C.M, C.H, C.DAY
T0 = {"base": C.iso_ms("2026-10-10T00:00:00Z"), "hold": C.iso_ms("2026-10-13T00:00:00Z")}
TS, T1 = C.iso_ms("2026-10-20T00:00:00Z"), C.iso_ms("2026-10-29T00:00:00Z")
LS = HI.LS


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat()


def rows_of(mm, t0, fair_key):
    """replay.py's rows from the parsed minute record: x as 1 where the engine had a rate (its money is the book's own)."""
    out = []
    for m in sorted(mm):
        t = m * M
        if not (t0 <= t < T1):
            continue
        r = mm[m]
        out.append({"minute": iso(t), "x": 1 if r[fair_key] is not None else None, "fair": r[fair_key], "prints_n": r["prints_n"], "vol": r["vol"],
                    "sell_lo": r["sell_lo"], "sell_hi": r["sell_hi"], "buy_lo": r["buy_lo"], "buy_hi": r["buy_hi"], "last": r["last"], "last_side": r["last_side"]})
    return out


def candidates(b, mm, t0, arm, fx, revx, cbu_t, cbu_v):
    """{name: [fair per minute of the window]} for one book and arm; None wherever the engine's own fair was None."""
    key = "fair" if arm == "base" else "hfair"
    ms = [m for m in sorted(mm) if t0 <= m * M < T1]
    n = len(ms)
    k = "GBPUSD" if C.QUOTE[b] == "GBP" else "EURUSD"
    lb = 10 * M if arm == "base" else HI.HOLD_MS
    xs = [C.bar_at(m * M, *fx[k], lookback=lb) for m in ms]
    x_old = [C.bar_at(m * M - M, *fx[k], lookback=lb) for m in ms]
    mask = [mm[m][key] is not None for m in ms]
    coin = C.COIN[b]
    f_rx = C.F3(revx[coin])
    f_cb = C.F3(C.hourly_from_minutes(cbu_t, cbu_v))
    U = {"engine": [f_rx(m * M) for m in ms], "par": [1.0] * n,
         "cb_own": [1.0] * n if coin == "USDC" else [f_cb(m * M) for m in ms],
         "cb_live": [1.0] * n if coin == "USDC" else [C.bar_at(m * M, cbu_t, cbu_v) for m in ms]}
    last = [mm[m]["last"] for m in ms]
    out = {"stored": [mm[m][key] for m in ms]}
    base = {}
    for u, uu in U.items():
        base[u] = [(uu[i] / xs[i]) if (mask[i] and uu[i] and xs[i]) else None for i in range(n)]
        out[u] = base[u]
    for u in ("engine", "cb_own", "cb_live"):
        for L, w in LS.items():
            adj = HI.rolling_basis(n, last, base[u], w)
            for a in (0.5, 1.0):
                out[f"{u}+b{L}_{a}"] = [(base[u][i] * (1 + a * adj[i])) if (base[u][i] and adj[i] is not None) else base[u][i] for i in range(n)]
    for L in ("1h", "6h", "24h"):
        v = HI.rolling_venue(n, last, LS[L])
        out[f"venue_{L}"] = [v[i] if mask[i] else None for i in range(n)]
    # cross-book: the FX implied by Coinbase's other book of the same currency and its USDT-USD book, no Yahoo at all.
    # USDC-XXX: the USDT-XXX book's last print of an earlier minute (at most ten old) over USDT-USD's last candle close;
    # USDT-XXX: the USDC-XXX book's last print times USDT-USD. Where either is missing, cb_live's (Yahoo) fair stands in.
    other = C.load_minutes(("USDT-" if coin == "USDC" else "USDC-") + C.QUOTE[b])
    xb, lo, lot = [None] * n, None, None
    for i, m in enumerate(ms):
        r = other.get(m - 1)
        if r and r["last"] is not None:
            lo, lot = r["last"], m - 1
        u = C.bar_at(m * M, cbu_t, cbu_v)
        if mask[i] and lo is not None and lot >= m - 10 and u:
            xb[i] = lo / u if coin == "USDC" else lo * u
        elif mask[i]:
            xb[i] = base["cb_live"][i]
    out["xbook"] = xb
    adj = HI.rolling_basis(n, last, xb, LS["6h"])
    out["xbook+b6h_1.0"] = [(xb[i] * (1 + adj[i])) if (xb[i] and adj[i] is not None) else xb[i] for i in range(n)]
    out["engine_fx_older"] = [(U["engine"][i] / x_old[i]) if (mask[i] and U["engine"][i] and x_old[i]) else None for i in range(n)]
    return ms, out


def run_book(b, rows, F, half):
    B = R.MinuteBook(b, rows, C.TICK[b])
    assert len(F) == B.n, (b, len(F), B.n)
    B.F = F
    saved = (P.TICK, P.FEE, P.HALF_SPREAD)
    try:
        P.TICK, P.FEE, P.HALF_SPREAD = C.TICK[b], R.TAKER, half
        tr, _ = P.simulate(B, size=100.0)
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD = saved
    return [x for x in tr if not (x["how"] == "taker" and x["t_exit"] - x["t_entry"] < 1440 * M)]


def main(out_path):
    fx = C.load_fx()
    revx = C.load_hours_revx()
    cbu_t, cbu_v = C.load_cb_usdt_1m()
    eng = collections.defaultdict(list)
    for x in C.load_trips():
        eng[(x["arm"], x["book"])].append(x)
    res = {"reproduce": {}, "runs": {}}
    for arm in ("base", "hold"):
        t0 = T0[arm]
        key = "fair" if arm == "base" else "hfair"
        for b in C.BOOKS:
            mm = C.load_minutes(b)
            xg = {m: r["x"] for m, r in mm.items()}
            rows = rows_of(mm, t0, key)
            half = R.BOOK[b][1]
            ms, cands = candidates(b, mm, t0, arm, fx, C.load_hours_revx(), cbu_t, cbu_v)
            lastx = {}
            lx = None
            for m in sorted(mm):
                if xg.get(m):
                    lx = xg[m]
                lastx[m] = lx
            # the engine's own trips in the book's currency (Deviation 1's export), entered in the window
            e = [x for x in eng[(arm, b)] if t0 <= x["t_entry_ms"] < T1]
            e_ccy = sum(float(x["pnl_gbp"]) * float(x["qty"]) * float(x["entry"]) / float(x["notional_gbp"]) for x in e)
            for name, F in cands.items():
                tr = run_book(b, rows, F, half)
                tr = [x for x in tr if x["t_entry"] < T1]
                slim = [[x["t_entry"], x["t_exit"], round(x["pnl_usd"], 6), round(x["notional_usd"], 4), x["how"][0], x["side"][0], x["k"],
                         round(x["pnl_usd"] * (lastx.get(x["t_exit"] // M) or 1.0), 6)] for x in tr]
                res["runs"][f"{arm}|{b}|{name}"] = slim
                if name == "stored":
                    held = [x for x in e if x["t_exit_ms"] < T1]
                    res["reproduce"][f"{arm}|{b}"] = {"engine_trips": len(held), "engine_pnl_ccy": round(sum(float(x["pnl_gbp"]) * float(x["qty"]) * float(x["entry"]) / float(x["notional_gbp"]) for x in held), 4),
                                                      "replay_trips": len(tr), "replay_pnl_ccy": round(sum(x["pnl_usd"] for x in tr), 4),
                                                      "engine_pnl_gbp": round(sum(float(x["pnl_gbp"]) for x in held), 4),
                                                      "replay_pnl_gbp": round(sum(s[7] for s in slim), 4)}
            print(arm, b, res["reproduce"][f"{arm}|{b}"], flush=True)
    json.dump(res, gzip.open(out_path, "wt") if out_path.endswith(".gz") else open(out_path, "w"))


if __name__ == "__main__":
    main(sys.argv[1])
