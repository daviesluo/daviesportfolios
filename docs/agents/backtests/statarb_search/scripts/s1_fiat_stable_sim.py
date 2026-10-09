"""S1: PR5's mechanism, simplified, run identically on every stablecoin-against-currency book pulled by pull_fiat_stable.py.

Not PR5's frozen simulator (quotes.ts / pr5_sim.py): a screen, so every book is scored by the same rule and Revolut X's
UK GBP books, where PR5 is live, calibrate the rest. For each book and each rung q in {10, 20, 30} bps, each side:
  * fair = the stablecoin's dollar value / interbank (Yahoo 1-minute FX; USDT's dollar value from Coinbase USDT-USD),
    taken from the PREVIOUS minute (PR5 quotes one minute behind); no entry when the FX minute is over 10 minutes old
    (weekends, PR5's QUOTE_FX_LOOKBACK_MS); exits keep working on the last fair.
  * flat: a bid at fair(1-q) (an ask at fair(1+q)); filled when a trade prints strictly through it in the minute
    (prints for Revolut X and CoinJar; the trade-built 1-minute low/high for Coinbase and Bitstamp).
  * holding: an exit at the current fair, filled when a trade prints strictly through it; a 24-hour stop at the
    minute's close. Notional $100 a rung, or the print's own size when smaller (prints only), and for candles at most
    10 % of the minute's volume. The venue's maker fee on both legs.
Writes results/s1_fiat_stable.json; prints a table.
usage: python3 s1_fiat_stable_sim.py
"""
import bisect, gzip, json, os, statistics, time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN = os.path.join(HERE, "inputs", "fiat_stable")
A, Z = 1791504000 - 7 * 86400, 1791504000
RUNGS = (0.0010, 0.0020, 0.0030)
CAP = 100.0
FEE = {"revx": 0.0, "coinbase": 0.0, "coinjar": 0.0, "bitstamp": None}   # Bitstamp filled in from its schedule below


def load(n):
    return json.load(gzip.open(os.path.join(IN, n + ".json.gz")))


def series_fx(name, invert=False):
    d = load("yahoo_" + name)
    t, c = [], []
    for ts, v in zip(d["t"], d["close"]):
        if v:
            t.append(ts // 60 * 60); c.append(1 / v if invert else v)
    return t, c


def at(series, ts, maxage):
    t, c = series
    i = bisect.bisect_right(t, ts) - 1
    if i < 0 or ts - t[i] > maxage:
        return None
    return c[i]


GBPUSD = series_fx("GBPUSDX"); EURUSD = series_fx("EURUSDX"); AUDUSD = series_fx("AUDUSDX")
USDCAD = series_fx("CADX"); USDSGD = series_fx("SGDX")
_ut = load("coinbase_USDT-USD"); USDT = ([r[0] for r in _ut], [r[4] for r in _ut])

# quote currency per one unit of the stablecoin, and the quote currency's dollar value
BOOKS = {
    # name: (source, file, stable, fair(ts, fxage) -> quote per stable, usd per quote unit)
    "revx UK USDC-GBP": ("revx", "revx_USDC-GBP", "USDC", lambda t, g: (1 / g) if g else None, GBPUSD),
    "revx UK USDT-GBP": ("revx", "revx_USDT-GBP", "USDT", lambda t, g: (at(USDT, t, 3600) / g) if g and at(USDT, t, 3600) else None, GBPUSD),
    "revx EEA USDC-EUR": ("revx", "revx_USDC-EUR", "USDC", lambda t, g: (1 / g) if g else None, EURUSD),
    "coinbase USDC-GBP": ("coinbase", "coinbase_USDC-GBP", "USDC", lambda t, g: (1 / g) if g else None, GBPUSD),
    "coinbase USDT-GBP": ("coinbase", "coinbase_USDT-GBP", "USDT", lambda t, g: (at(USDT, t, 3600) / g) if g and at(USDT, t, 3600) else None, GBPUSD),
    "coinbase USDC-EUR": ("coinbase", "coinbase_USDC-EUR", "USDC", lambda t, g: (1 / g) if g else None, EURUSD),
    "coinbase USDT-EUR": ("coinbase", "coinbase_USDT-EUR", "USDT", lambda t, g: (at(USDT, t, 3600) / g) if g and at(USDT, t, 3600) else None, EURUSD),
    "coinbase EURC-USDC": ("coinbase", "coinbase_EURC-USDC", "EURC", lambda t, g: g, None),   # quote USDC per EURC = EURUSD
    "coinbase TGBP-USDC": ("coinbase", "coinbase_TGBP-USDC", "TGBP", lambda t, g: g, None),
    "coinbase USDC-AUD": ("coinbase", "coinbase_USDC-AUD", "USDC", lambda t, g: (1 / g) if g else None, AUDUSD),
    "coinbase USDC-CAD": ("coinbase", "coinbase_USDC-CAD", "USDC", lambda t, g: g, "CAD"),
    "coinbase USDC-SGD": ("coinbase", "coinbase_USDC-SGD", "USDC", lambda t, g: g, "SGD"),
    "bitstamp USDC-EUR": ("bitstamp", "bitstamp_usdceur", "USDC", lambda t, g: (1 / g) if g else None, EURUSD),
    "bitstamp USDT-EUR": ("bitstamp", "bitstamp_usdteur", "USDT", lambda t, g: (at(USDT, t, 3600) / g) if g and at(USDT, t, 3600) else None, EURUSD),
    "coinjar USDC-GBP": ("coinjar", "coinjar_USDCGBP", "USDC", lambda t, g: (1 / g) if g else None, GBPUSD),
    "coinjar USDT-GBP": ("coinjar", "coinjar_USDTGBP", "USDT", lambda t, g: (at(USDT, t, 3600) / g) if g and at(USDT, t, 3600) else None, GBPUSD),
    "coinjar USDC-AUD": ("coinjar", "coinjar_USDCAUD", "USDC", lambda t, g: (1 / g) if g else None, AUDUSD),
}
FXOF = {"revx UK USDC-GBP": GBPUSD, "revx UK USDT-GBP": GBPUSD, "revx EEA USDC-EUR": EURUSD, "coinbase USDC-GBP": GBPUSD,
        "coinbase USDT-GBP": GBPUSD, "coinbase USDC-EUR": EURUSD, "coinbase USDT-EUR": EURUSD, "coinbase EURC-USDC": EURUSD,
        "coinbase TGBP-USDC": GBPUSD, "coinbase USDC-AUD": AUDUSD, "coinbase USDC-CAD": USDCAD, "coinbase USDC-SGD": USDSGD,
        "bitstamp USDC-EUR": EURUSD, "bitstamp USDT-EUR": EURUSD, "coinjar USDC-GBP": GBPUSD, "coinjar USDT-GBP": GBPUSD,
        "coinjar USDC-AUD": AUDUSD}


def usd_per_quote(name, t):
    fx = FXOF[name]
    v = at(fx, t, 7 * 86400)
    if name.endswith(("GBP", "EUR", "AUD")) and not name.endswith(("USDC", )):
        return v                                  # GBPUSD / EURUSD / AUDUSD: USD per one quote unit
    if name.endswith(("CAD", "SGD")):
        return 1 / v                              # USDCAD / USDSGD: quote units per USD
    return 1.0                                    # quoted in USDC


def minutes(name, src, fname, start, end):
    """{minute: (low, high, close, quote_volume, [prices])} for [start, end)."""
    d = load(fname)
    m = {}
    if src in ("revx", "coinjar"):
        for r in d:
            if src == "revx":
                ts, p, q = r["timestamp"] / 1000, float(r["price"]), float(r["quantity"])
            else:
                import datetime
                ts = datetime.datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00")).timestamp()
                p, q = float(r["price"]), float(r["size"])
            if not (start <= ts < end):
                continue
            k = int(ts) // 60 * 60
            lo, hi, cl, v, ps = m.get(k, (p, p, p, 0.0, []))
            ps.append((p, p * q))
            m[k] = (min(lo, p), max(hi, p), p, v + p * q, ps)
    elif src == "coinbase":
        for t, lo, hi, op, cl, vol in d:
            if start <= t < end and vol > 0:
                m[t] = (lo, hi, cl, vol * cl, None)
    else:
        for r in d:
            t = int(r["timestamp"]); vol = float(r["volume"])
            if start <= t < end and vol > 0:
                m[t] = (float(r["low"]), float(r["high"]), float(r["close"]), vol * float(r["close"]), None)
    return m


def fair_at(name, t, fxmax):
    src, fname, stable, f, _ = BOOKS[name]
    g = at(FXOF[name], t, fxmax)
    return f(t, g) if g else None


def fillable(bar, level, below, cap_quote):
    """notional (quote units) a resting order at `level` gets in this minute: trades strictly through it."""
    lo, hi, cl, vol, ps = bar
    if ps is not None:
        through = [n for p, n in ps if (p < level if below else p > level)]
        return min(cap_quote, sum(through)) if through else 0.0
    if (lo < level) if below else (hi > level):
        return min(cap_quote, 0.10 * vol)
    return 0.0


def run(name, cap_usd=CAP, start=A, end=Z):
    src = BOOKS[name][0]
    fee = FEE[src] or 0.0
    bars = minutes(name, src, BOOKS[name][1], start - 86400, end + 86400)
    out = {"trips": 0, "pnl_usd": 0.0, "stops": 0, "per_rung": {}}
    byday = {}
    for q in RUNGS:
        for side in ("bid", "ask"):
            pos = None; trips = 0; pnl = 0.0; stops = 0
            for t in range(start, end, 60):
                bar = bars.get(t)
                upq = usd_per_quote(name, t)
                if pos is None:
                    f = fair_at(name, t - 60, 600)          # priced from the previous minute, FX at most 10 minutes old
                    if f is None or bar is None or not upq:
                        continue
                    lvl = f * (1 - q) if side == "bid" else f * (1 + q)
                    n = fillable(bar, lvl, side == "bid", cap_usd / upq)
                    if n > 0:
                        pos = (lvl, n / lvl, t)                # price, stable units, time
                    continue
                lvl0, units, t0 = pos
                f = fair_at(name, t - 60, 7 * 86400)
                if bar is not None and f is not None:
                    if t - t0 >= 86400:                         # 24-hour stop at the close
                        px = bar[2]; stops += 1
                    else:
                        n = fillable(bar, f, side == "ask", 1e18)
                        px = f if n >= units * f * 0.999 else None   # the exit needs the whole position through
                    if px is not None:
                        g = (px - lvl0) * units if side == "bid" else (lvl0 - px) * units
                        g -= fee * (lvl0 + px) * units
                        pnl += g * (upq or 0); trips += 1; pos = None
                        dk = time.strftime("%Y-%m-%d", time.gmtime(t)); byday[dk] = byday.get(dk, 0.0) + g * (upq or 0)
            out["per_rung"][f"{side}{int(q * 1e4)}"] = {"trips": trips, "pnl_usd": round(pnl, 4), "stops": stops}
            out["trips"] += trips; out["pnl_usd"] += pnl; out["stops"] += stops
    out["pnl_usd"] = round(out["pnl_usd"], 2)
    out["pnl_by_day"] = {k: round(v, 3) for k, v in sorted(byday.items())}
    pos_total = sum(v for v in byday.values() if v > 0)
    out["best_day_share"] = round(max(byday.values()) / out["pnl_usd"], 3) if byday and out["pnl_usd"] > 0 else None
    days = (end - start) / 86400
    out["pnl_usd_per_day"] = round(out["pnl_usd"] / days, 3)
    out["capital_usd"] = cap_usd * 2 * len(RUNGS)
    out["pct_per_year_on_capital"] = round(out["pnl_usd_per_day"] * 365 / out["capital_usd"] * 100, 1)
    # descriptive: how far from fair the book trades
    devs, vol_tot, vol_far = [], 0.0, {10: 0.0, 20: 0.0, 30: 0.0}
    for t, bar in bars.items():
        if not (start <= t < end):
            continue
        f = fair_at(name, t, 600)
        upq = usd_per_quote(name, t)
        if f is None or not upq:
            continue
        dv = (bar[2] / f - 1) * 1e4
        devs.append(abs(dv))
        vu = bar[3] * upq
        vol_tot += vu
        for k in vol_far:
            if abs(dv) >= k:
                vol_far[k] += vu
    out["traded_minutes_with_fx"] = len(devs)
    out["abs_dev_bps_median"] = round(statistics.median(devs), 2) if devs else None
    out["abs_dev_bps_p90"] = round(sorted(devs)[int(len(devs) * 0.9)], 2) if devs else None
    out["usd_volume_per_day_fx_minutes"] = round(vol_tot / days)
    out["share_of_volume_ge_bps"] = {k: round(v / vol_tot, 3) if vol_tot else None for k, v in vol_far.items()}
    return out


if __name__ == "__main__":
    FEE["bitstamp"] = float(os.environ.get("BITSTAMP_MAKER", "0"))
    res = {"window": "2026-10-02T00:00Z -> 2026-10-09T00:00Z", "rungs_bps": [10, 20, 30], "cap_usd_per_rung": CAP,
           "bitstamp_maker_fee_used": FEE["bitstamp"], "books": {}}
    for name in BOOKS:
        src = BOOKS[name][0]
        if src == "coinjar":   # CoinJar's 500 prints cover a shorter span: score the span they cover
            d = load(BOOKS[name][1])
            import datetime
            ts = [datetime.datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00")).timestamp() for r in d]
            s0 = max(A, int(min(ts)) // 60 * 60 + 60)
            r = run(name, start=s0, end=min(Z, int(max(ts)) // 60 * 60))
            r["span_days"] = round((min(Z, max(ts)) - s0) / 86400, 2)
        else:
            r = run(name)
        r["at_1000_usd_per_rung"] = run(name, cap_usd=1000.0, start=r.get("_s", A), end=Z)["pnl_usd_per_day"] if src != "coinjar" else None
        res["books"][name] = r
        print(f"{name:22s} trips {r['trips']:5d} stops {r['stops']:3d} ${r['pnl_usd']:9.2f} ${r['pnl_usd_per_day']:7.3f}/d "
              f"{r['pct_per_year_on_capital']:6.1f}%/yr best-day {r['best_day_share']}  @$1k/rung ${r['at_1000_usd_per_rung']}/d  |dev| med {r['abs_dev_bps_median']} p90 {r['abs_dev_bps_p90']} "
              f"vol ${r['usd_volume_per_day_fx_minutes']}/d  >=10/20/30bps {r['share_of_volume_ge_bps']}")
    json.dump(res, open(os.path.join(HERE, "results", "s1_fiat_stable.json"), "w"), indent=1, sort_keys=True)
