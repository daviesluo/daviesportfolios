"""FX-SPEED-LONG: every Coinbase arm as it now runs, over two years of Coinbase's minutes and Exness's ticks, with today's
Yahoo-timed X against the X a switch to `fx_ticks` would give. Davies, 2026-10-29: "coinbase的所有策略用更多秒级数据更长时间再深度
回测验证下，如果还是正向优化的话把所有coinbase策略的汇率数据源从yahoo换为刚才研究的最佳秒级数据源+fallbacks".

THE ENGINE is PR5's frozen `pr5_sim.simulate` (`docs/agents/scripts/pr5/pr5_sim.py`, the function `stepMinute` is pinned to),
imported unchanged, on two records:
  * HISTORY, 2024-10-01 → 2026-10-09: SCQ-VENUES' Coinbase minute bars (`scq_venues/inputs`, proven to replay as the prints do,
    `bars.check_equivalence`) through `bars.BarBook`, as the CB/OKX fair-price study's `hist.py`;
  * PRODUCTION, 2026-10-10 (10-13 for the held arms) → 10-29: the engines' own minute record (`fair_price_cb_okx/inputs/prod`)
    through `cbpaper/scripts/replay.py`'s `MinuteBook`, as that study's `prod.py`, whose `cb_live` run on Yahoo reproduces the
    engine's trips (checked here again, `anchor`).
Only F (the fair array) differs between the X candidates of an arm and book; the darkness of a minute is the arm's own and the
same for every candidate.

THE ARMS, as they run from 2026-10-29 (cb_quotes.ts, cb_hold.ts, cb_usdc.ts, cb_nudge.ts):
  base   "with Euros": four books, $100 a rung, dark when the newest rate bar started more than 10 minutes before the minute;
  wk     "- 1": the same, the rate bar held up to 60 hours (`cbHoldBarAt`);
  usdc   "- 2": "- 1"'s rule on USDC-GBP and USDC-EUR at $50 a rung (`simulate(size=50)` is `stepMinute` on prints × 2);
  nudge  "- 3": "- 2"'s USDC-GBP with its fair nudged inside FX closures by Revolut X's USDC-GBP mid (`nudgeStep`, ported below).
         Revolut X's book is recorded only from 2026-10-09, so "- 3" runs on the production record alone; on the history it is
         "- 2"'s USDC-GBP outside closures, and the report says how much of that book's difference falls inside them.
Every arm: the coin at Coinbase's own value (`cb_live`: USDC 1, USDT Coinbase USDT-USD's newest one-minute close that started in
[t − 10, t − 1] min), dark when that value is more than 50 bps from Revolut X's F3 (from 2025-11-22, when Revolut X's USD hourly
closes give one; before that there is no reference and no guard), dark from one minute before to five after each scheduled
CPI, NFP, FOMC, ECB and BoE release (`cbreview/inputs/release_calendar.json`, the list `cb_releases.ts` was cut from; in the
production record the engine's own mask, which blacked out the 10-28 FOMC alone). A rung is dollars: the sizing X is the
book currency's dollar rate (Exness at the minute's start, carried), the same for every candidate; P&L comes back in dollars
and is turned into pounds at the GBP/USD of the trip's exit minute.

WHEN THE ENGINE DECIDES MINUTE t AND WHAT IT COULD READ. `stepMinute` prices minute t's orders and they go live at t + 60 s
(`live: t + M`), facing minute t + 1's prints. The paper call decides minute t after the recorder has covered it: production's
`cb_quote_state` showed minute 08:26 decided at 08:28:00.5 (t + 120.5 s, 2026-10-29). Today it reads Yahoo's bar labelled t − 1
(`fxBarAt`: 18,158 of 18,573 lit USDC-GBP minutes in 10-10 → 10-28 read that bar, the rest an older one), and that bar is about
the price of t − 32 s (§7.2: it matches Exness best 28 s into its minute). A switch to `fx_ticks` could read anything stored
by the time it runs, so the implementable rule must cap what it reads: the newest TrueFX (or fallback) read RECEIVED at or before
t + 58 s, two seconds before the orders go live. That read carries the source's own age: TrueFX's quote was a median 1.4 s old
on arrival (§2) and steps every 2–3 s. Modelled on Exness's ticks (about one every 2 s in London hours, so each instant
already carries a tick's age):
  a        today's input: Exness's mid at (t − 1 min) + 28 s, the bar labelled t − 1, at Yahoo's level (× (1 + 0.33 bps) for
           GBP/USD, × (1 + 2.82 bps) for EUR/USD, §7.2's offsets of 2026-09-20 → 10-28, taken as constant; Yahoo answered this
           machine 429, so its level before September could not be read). Bar L exists when Exness has a tick in [L, L + 60 s).
  a_raw    the same timing at Exness's level.
  L60      Exness at t (the history engine of the CB/OKX study read this: its minute close of bar t − 1).
  L5, L3, L2   Exness at t + 55 s, t + 57 s, t + 58 s, at Yahoo's level (aligned): the switch with 3, 1 and 0 s of source age
           behind the t + 58 s cut-off. **L3 is the implementable rule (b)**; L5 its slow edge, L2 FX-SPEED's primary.
  L3_raw, L2_raw, L0_raw   the same at Exness's level, which is TrueFX's (§2: Yahoo's EUR/USD +2.87 bps over TrueFX,
           +2.82 over Exness): what `fx_ticks` would give with no level carried over from Yahoo.
  L0       Exness at t + 60 s: the bound (c), the price as the orders go live.
A fast value missing (no tick for ten minutes) is the last one known; inside a closure every X is held as its arm holds it.

usage: python3 -I cb_long.py EXNESS_LONG.txt.gz OUT.json.gz   (about six minutes on four cores; its output is not committed,
cb_long_stats.py's is)
"""
import bisect, collections, datetime, gzip, json, multiprocessing as mp, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "fair_price_cb_okx", "scripts"))
sys.path.insert(0, os.path.join(BT, "cbpaper", "scripts"))
import numpy as np  # noqa: E402
import exness_long as EL  # noqa: E402
import fpc as C  # noqa: E402
import hist as HI  # noqa: E402  (the CB/OKX study's history engine: its loaders and Revolut X's hours)
import replay as R  # noqa: E402  (the faithfulness check's MinuteBook)

SI, BR, CI, P = HI.SI, HI.BR, HI.CI, HI.P
M, H, DAY = 60_000, 3_600_000, 86_400_000
ms = lambda s: int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
T0H, TSPLIT, T1H = ms("2024-10-01T00:00"), ms("2025-11-21T00:00"), ms("2026-10-09T00:00")
TP0 = {"base": ms("2026-10-10T00:00"), "hold": ms("2026-10-13T00:00")}
TP1 = ms("2026-10-29T00:00")
OFF = {"GBPUSD": 0.33e-4, "EURUSD": 2.82e-4}
TAKER = 0.000045
HOLD_MIN = 60 * 60
GUARD = 0.005
ARMS = {"base": (["USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR"], 100.0, False),
        "wk": (["USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR"], 100.0, True),
        "usdc": (["USDC-GBP", "USDC-EUR"], 50.0, True),
        "nudge": (["USDC-GBP"], 50.0, True)}
CANDS = ["a", "a_raw", "L60", "L5", "L3", "L2", "L0", "L3_raw", "L2_raw", "L0_raw"]
PAIR = {"GBP": "GBPUSD", "EUR": "EURUSD"}
EX = None   # the Exness arrays, loaded once in the parent and shared with the workers by fork


def in_quote_closure(t):
    """`inQuoteClosure` (quotes_weekend.ts): Friday 21:00 → Sunday 21:00 UTC, 24 Dec 21:00 → 25 Dec 21:00, 31 Dec 21:00 → 1 Jan 21:00."""
    d = datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc)
    wd, h, mo, day = (d.weekday() + 1) % 7, d.hour, d.month, d.day
    if (wd == 5 and h >= 21) or wd == 6 or (wd == 0 and h < 21):
        return True
    if mo == 12 and ((day == 24 and h >= 21) or (day == 25 and h < 21)):
        return True
    return (mo == 12 and day == 31 and h >= 21) or (mo == 1 and day == 1 and h < 21)


def releases():
    ev = json.load(open(os.path.join(BT, "cbreview", "inputs", "release_calendar.json")))["events"]
    return sorted(int(e["t"]) for e in ev)


def blackout_mask(t0, n, rel):
    """True for the minutes [T − 1, T + 5] of each release (`cbInBlackout`)."""
    out = np.zeros(n, dtype=bool)
    for T in rel:
        for i in range((T - M - t0 + M - 1) // M, (T + 5 * M - t0) // M + 1):     # minute starts s with T − 1 min ≤ s ≤ T + 5 min
            if 0 <= i < n:
                out[i] = True
    return out


def usdt_minutes():
    """Coinbase USDT-USD one-minute closes 2024-09-29 → 2026-10-29 (fetch_cb_usdt.py, three fetches)."""
    rows = {}
    for f in (os.path.join(HERE, "..", "data", "cb_usdtusd_1m_2024-09-29_2025-11-19.json.gz"),
              os.path.join(C.ROOT, "inputs", "cb_usdtusd_1m_hist.json.gz"), os.path.join(C.ROOT, "inputs", "cb_usdtusd_1m.json.gz")):
        for c in json.load(gzip.open(f, "rt"))["candles"]:
            rows[c[0]] = float(c[1])
    ks = sorted(rows)
    print("USDT-USD minutes", len(ks), ks[0] * M, ks[-1] * M, file=sys.stderr)
    return [k * M for k in ks], [rows[k] for k in ks]


def carry(a):
    """NaN filled by the last value before it (NaN until the first)."""
    out = a.copy()
    idx = np.where(~np.isnan(out), np.arange(len(out)), -1)
    np.maximum.accumulate(idx, out=idx)
    good = idx >= 0
    out[good] = out[idx[good]]
    return out


def x_columns(pair, hold):
    """{candidate: X per Exness minute index} and the lit mask, for an arm's rate rule (10 minutes, or held 60 hours)."""
    n_t = EX.n[pair]
    col = lambda s: EX.col(pair, s)
    N = len(n_t)
    idx = np.where(n_t > 0, np.arange(N), -1)
    np.maximum.accumulate(idx, out=idx)                 # the newest bar (a minute with a tick) at or before each minute
    j = np.concatenate(([-1], idx[:-1]))               # ... at or before t − 1 min
    look = HOLD_MIN if hold else 10
    lit = (j >= 0) & (np.arange(N) - j <= look)
    v28 = col(28)
    ya = np.where(lit, v28[np.clip(j, 0, None)], np.nan)
    o = 1 + OFF[pair]
    out = {"a": ya * o, "a_raw": ya}
    fast = {"L60": col(0), "L5": col(55), "L3": col(57), "L2": col(58), "L0": np.concatenate((col(0)[1:], [np.nan]))}
    for name, v in fast.items():
        c = carry(v)
        if name == "L60":
            out[name] = np.where(lit, c, np.nan)
            continue
        out[name] = np.where(lit, c * o, np.nan)
        if name in ("L3", "L2", "L0"):
            out[name + "_raw"] = np.where(lit, c, np.nan)
    return out, lit


def sizing():
    """Dollars per pound and per euro at each minute's start (Exness, carried): the sizing X and the pounds of a trip."""
    return {p: carry(EX.col(p, 0)) for p in EL.PAIRS}


def coin_value(coin, ts_minutes, ut, uv, rx_f3, rx_from):
    """cb_live with the de-peg guard: [value or None] for each minute start."""
    out = []
    for t in ts_minutes:
        v = 1.0 if coin == "USDC" else C.bar_at(t, ut, uv)
        if v is None:
            out.append(None); continue
        if t >= rx_from:
            r = rx_f3(t)
            if r is None or abs(v / r - 1) > GUARD:
                out.append(None); continue
        out.append(v)
    return out


def sim(B, F, size, tick, half):
    saved = (P.TICK, P.FEE, P.HALF_SPREAD)
    try:
        P.TICK, P.FEE, P.HALF_SPREAD = tick, TAKER, half
        B.F = F
        tr, _ = P.simulate(B, size=size)
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD = saved
    return tr


def slim(tr, gbp_at, t0x):
    """[t_entry, t_exit, pnl $, notional $, how, side, k, pnl £] (pounds at the exit minute's GBP/USD)."""
    out = []
    for x in tr:
        g = gbp_at[(x["t_exit"] - EL.FROM) // M]
        out.append([x["t_entry"], x["t_exit"], round(x["pnl_usd"], 6), round(x["notional_usd"], 4), x["how"][0], x["side"][0], x["k"],
                    round(x["pnl_usd"] / g, 6)])
    return out


def hist_task(book):
    key = "coinbase:" + book
    venue, name, quote, coin, tick = SI.BOOKS[key]
    bars, _ = SI.load_bars(key)
    B = BR.BarBook(key, {str(k): v for k, v in bars.items()}, T0H, T1H, [], [], [], [], tick, gbp=True)
    n = B.n
    i0 = (T0H - EL.FROM) // M
    pair = PAIR[quote]
    sz = sizing()
    B.X = [float(v) for v in sz[pair][i0:i0 + n]]
    gbp_at = sz["GBPUSD"]
    ut, uv = usdt_minutes()
    rx = HI.revx_hours()[coin]
    f3 = C.F3(rx)
    rx_from = rx[0][0] + DAY
    ts = [T0H + i * M for i in range(n)]
    U = coin_value(coin, ts, ut, uv, f3, rx_from)
    blk = blackout_mask(T0H, n, releases())
    half = json.load(open(os.path.join(BT, "scq_venues", "inputs", "touch.json")))[key]["half_spread"]
    res, meta = {}, {}
    for arm, (books, size, hold) in ARMS.items():
        if book not in books or arm == "nudge":
            continue
        xs, lit = x_columns(pair, hold)
        for c in CANDS:
            X = xs[c][i0:i0 + n]
            F = [None if (blk[i] or U[i] is None or np.isnan(X[i])) else U[i] / float(X[i]) for i in range(n)]
            res[f"{arm}|{book}|{c}"] = slim(sim(B, F, size, tick, half), gbp_at, i0)
            if c == "a":
                meta[f"{arm}|{book}"] = {"minutes": n, "lit": int(sum(1 for f in F if f)), "dark_guard": int(sum(1 for i in range(n) if U[i] is None)),
                                         "blackout": int(blk.sum()), "closure_minutes_lit": int(sum(1 for i in range(n) if F[i] and in_quote_closure(ts[i])))}
        print("hist", arm, book, {c: (len(res[f'{arm}|{book}|{c}']), round(sum(x[7] for x in res[f'{arm}|{book}|{c}']), 2)) for c in ("a", "L3", "L0")}, flush=True)
    return res, meta


# ------------------------------------------------------------------------------------------------- the production record
def rx_mids():
    """Revolut X's USDC-GBP mid as the nudge reads it (`rxMidAt`), per minute ms, from REVX-FAIR's prep (raw mid)."""
    out = {}
    with gzip.open(os.path.join(BT, "fair_price", "data", "rx_mid_USDC-GBP.txt.gz"), "rt") as f:
        for l in f:
            p = l.rstrip("\n").split("|")
            if len(p) >= 2 and p[1]:
                out[int(p[0])] = float(p[1])
    return out


def nudge_fair(ts, F, rx):
    """`nudgeStep` with scope "closures": the EMA of g = RX − fair (24 h half-life, time-weighted) moves in every lit minute with
    an RX; inside a closure the fair is fair + ½ (g − EMA) when |g − EMA| < 50 bps of fair."""
    ema, last, out = None, None, []
    for t, f in zip(ts, F):
        mid = rx.get(t)
        if not f or not mid:
            out.append(f); continue
        g = mid - f
        ema = g if (ema is None or last is None) else ema + (1 - 0.5 ** ((t - last) / M / 1440)) * (g - ema)
        last = t
        d = g - ema
        out.append(f + 0.5 * d if (in_quote_closure(t) and abs(d / f) < 0.005) else f)
    return out


def prod_rows(mm, t0, key, xs_usd):
    out = []
    for m in sorted(mm):
        t = m * M
        if not (t0 <= t < TP1):
            continue
        r = mm[m]
        out.append({"minute": datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).isoformat(), "x": xs_usd[(t - EL.FROM) // M],
                    "fair": r[key], "prints_n": r["prints_n"], "vol": r["vol"], "sell_lo": r["sell_lo"], "sell_hi": r["sell_hi"],
                    "buy_lo": r["buy_lo"], "buy_hi": r["buy_hi"], "last": r["last"], "last_side": r["last_side"]})
    return out


def prod_run(rx):
    fx = C.load_fx()
    ut, uv = usdt_minutes()
    revx = C.load_hours_revx()
    sz = sizing()
    gbp_at = sz["GBPUSD"]
    study = json.load(gzip.open(os.path.join(BT, "fair_price_cb_okx", "results", "prod_runs.json.gz"), "rt"))["runs"]
    res, anchor, meta = {}, {}, {}
    for arm, (books, size, hold) in ARMS.items():
        rec = "hold" if hold else "base"
        t0, key = TP0[rec], ("hfair" if hold else "fair")
        lb = HI.HOLD_MS if hold else 10 * M
        for b in books:
            mm = C.load_minutes(b)
            pair = PAIR[C.QUOTE[b]]
            rows = prod_rows(mm, t0, key, [float(v) for v in sz[pair]])
            B = R.MinuteBook(b, rows, C.TICK[b])
            half = R.BOOK[b][1]
            ms_ = [C.iso_ms(r["minute"]) for r in rows]
            f3 = C.F3(revx[C.COIN[b]])
            U = coin_value(C.COIN[b], ms_, ut, uv, f3, 0)
            mask = [r["fair"] is not None for r in rows]
            yx = [C.bar_at(t, *fx[pair], lookback=lb) for t in ms_]
            xs, _ = x_columns(pair, hold)
            cols = {"yahoo": yx}
            for c in CANDS:
                cols[c] = [None if np.isnan(xs[c][(t - EL.FROM) // M]) else float(xs[c][(t - EL.FROM) // M]) for t in ms_]
            for c, X in cols.items():
                F = [(U[i] / X[i]) if (mask[i] and U[i] and X[i]) else (U[i] / yx[i] if (mask[i] and U[i] and yx[i] and c != "yahoo" and X[i] is None) else None)
                     for i in range(len(rows))]
                if arm == "nudge":
                    F = nudge_fair(ms_, F, rx)
                tr = [x for x in sim(B, F, size, C.TICK[b], half) if x["t_entry"] < TP1]
                res[f"{arm}|{b}|{c}"] = slim(tr, gbp_at, 0)
            # the anchor: on the study's own terms (x 1, £/€100 a rung, Yahoo, cb_live) this must be its committed run, trip for trip
            if arm in ("base", "wk"):
                rows1 = [dict(r, x=(1 if r["fair"] is not None else None)) for r in rows]
                B1 = R.MinuteBook(b, rows1, C.TICK[b])
                u0 = [1.0 if C.COIN[b] == "USDC" else C.bar_at(t, ut, uv) for t in ms_]       # the study's cb_live had no guard
                F = [(u0[i] / yx[i]) if (mask[i] and u0[i] and yx[i]) else None for i in range(len(rows))]
                tr = [x for x in sim(B1, F, 100.0, C.TICK[b], half) if not (x["how"] == "taker" and x["t_exit"] - x["t_entry"] < 1440 * M)]
                tr = [x for x in tr if x["t_entry"] < TP1]
                ref = study.get(f"{rec}|{b}|cb_live")
                mine = [[x["t_entry"], x["t_exit"], round(x["pnl_usd"], 6)] for x in tr]
                anchor[f"{arm}|{b}"] = {"trips": len(mine), "study_trips": len(ref or []), "equal": ref is not None and [r[:3] for r in ref] == mine}
            meta[f"{arm}|{b}"] = {"minutes": len(rows), "lit_yahoo": sum(1 for i in range(len(rows)) if mask[i] and U[i] and yx[i]),
                                  "engine_lit": sum(mask), "guard_dark": sum(1 for i in range(len(rows)) if mask[i] and U[i] is None),
                                  "fallback_to_yahoo": {c: sum(1 for i in range(len(rows)) if mask[i] and cols[c][i] is None) for c in CANDS}}
            # how close each X is to the Yahoo bar the engine read, in bps over the lit minutes outside closures
            for c in ("a", "a_raw", "L60", "L3", "L3_raw"):
                d = [1e4 * (cols[c][i] / yx[i] - 1) for i in range(len(rows)) if mask[i] and yx[i] and cols[c][i] and not in_quote_closure(ms_[i])]
                meta[f"{arm}|{b}"][f"vs_yahoo_bps_{c}"] = {"n": len(d), "mean": round(float(np.mean(d)), 3), "mean_abs": round(float(np.mean(np.abs(d))), 3),
                                                           "p95_abs": round(float(np.percentile(np.abs(d), 95)), 3)} if d else None
            print("prod", arm, b, {c: (len(res[f'{arm}|{b}|{c}']), round(sum(x[7] for x in res[f'{arm}|{b}|{c}']), 2)) for c in ("yahoo", "a", "L3", "L0")},
                  anchor.get(f"{arm}|{b}"), flush=True)
    return res, anchor, meta


def main(ex_path, out):
    global EX
    EX = EL.Long(ex_path)
    print("exness loaded", flush=True)
    rx = rx_mids()
    prod, anchor, pmeta = prod_run(rx)
    with mp.get_context("fork").Pool(4) as pool:
        parts = pool.map(hist_task, ["USDC-GBP", "USDC-EUR", "USDT-GBP", "USDT-EUR"])
    hist, hmeta = {}, {}
    for r, m in parts:
        hist.update(r); hmeta.update(m)
    json.dump({"windows": {"T0H": T0H, "TSPLIT": TSPLIT, "T1H": T1H, "TP0": TP0, "TP1": TP1}, "cands": CANDS, "arms": {k: [v[0], v[1], v[2]] for k, v in ARMS.items()},
               "hist": hist, "hist_meta": hmeta, "prod": prod, "prod_meta": pmeta, "anchor": anchor}, gzip.open(out, "wt"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
