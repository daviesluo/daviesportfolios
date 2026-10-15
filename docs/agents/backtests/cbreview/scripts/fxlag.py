"""How far behind Coinbase's own prices is the engine's EUR/USD? (docs/agents/reviews/2026-10-15-coinbase-fast-move.md, section 3)

The engine's fair for a euro book is the USD stablecoin price over the interbank EUR/USD (Yahoo 1-minute bars, read at the
turn from the last COMPLETED bar). Coinbase's own books say what EUR/USD is as well: USDT-USD over USDT-EUR is a EUR/USD
the exchange itself is quoting, with no data vendor in between. This compares the two series minute by minute and finds the
shift that makes them agree: for each shift s (minutes), the RMS of (implied(t) - yahoo(t+s)), less its own rolling median
over +-60 minutes (which removes the standing basis: the stablecoin's price and the spread), in basis points. s > 0 means
the implied rate at t matches Yahoo's s minutes LATER, i.e. Yahoo is s minutes behind. Run over every minute, over minutes
within 15 minutes of a scheduled release (../inputs/events.json), and over the large-move minutes (Yahoo or implied
moved > 8 bp in 5 minutes). Reads ../inputs/cb_implied_eurusd.json.gz (minute candles' closes of Coinbase USDT-USD and
USDT-EUR, 2026-09-09 .. 2026-10-14, pulled keyless from api.exchange.coinbase.com by pull_cb_candles.py) and the screen's
Yahoo EUR/USD (to 2026-10-08 23:59 UTC). usage: python3 -I fxlag.py -> ../results/fxlag.json
"""
import bisect, gzip, json, os, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.normpath(os.path.join(ROOT, "..", "scq_venues", "scripts")))
import sv_sim as S  # noqa: E402

M = 60000


def load_implied():
    d = json.load(gzip.open(os.path.join(ROOT, "inputs", "cb_implied_eurusd.json.gz"), "rt"))
    t0 = d["t0"]
    out = {}
    for i, (u, e) in enumerate(zip(d["usd"], d["eur"])):
        if u is not None and e is not None:
            out[t0 + i * M] = u / e
    return out


def rolling_median_resid(t, x):
    """x minus the median of x over +-60 minutes of t (a plain window by timestamp)."""
    res = []
    for i in range(len(t)):
        lo, hi = bisect.bisect_left(t, t[i] - 60 * M), bisect.bisect_right(t, t[i] + 60 * M)
        res.append(x[i] - st.median(x[lo:hi]))
    return res


def rms(a):
    return (sum(v * v for v in a) / len(a)) ** 0.5 if a else None


def production_lag(imp):
    """The engine's STORED fair (EUR books, 2026-10-11 23:01 .. 2026-10-15 00:00) against the exchange-implied rate: fair x implied EUR/USD is the
    stablecoin's dollar price (about 1.000) when they are the same instant, so the shift that makes it steadiest is the lag. The turn at the start of
    minute t has data up to t, i.e. the candle labelled t-1 is the freshest honest one: a best shift of -1 is no lag, -3 is two minutes behind."""
    import gzip as gz
    lines = json.load(gz.open(os.path.join(ROOT, "inputs", "lit_window_lines.json.gz"), "rt"))
    more = json.load(gz.open(os.path.join(ROOT, "inputs", "lit_lines_1012_1014.json.gz"), "rt"))
    start = 1791759660000
    # forward-fill the implied rate (USDT-EUR is thin) for up to 5 minutes, so a minute without a USDT-EUR print still has a rate
    filled, last_t, last_v = {}, None, None
    for t in range(min(imp), max(imp) + M, M):
        if t in imp:
            last_t, last_v = t, imp[t]
        if last_t is not None and t - last_t <= 5 * M:
            filled[t] = last_v
    imp = filled
    out = {}
    for book in ("USDC-EUR", "USDT-EUR"):
        fair = {}
        for part in (lines[book], more[book]):
            for ln in part.split(";"):
                f = ln.split(",")
                fair[start + int(f[0]) * M] = float(f[1])
        res = {}
        ts = sorted(t for t in fair if t in imp and t + M in imp)
        # moves: implied rate moved more than 8 bp over the 5 minutes to t
        big = [t for t in ts if (t - 5 * M) in imp and abs(imp[t] / imp[t - 5 * M] - 1) > 8e-4]
        import datetime as dt
        c0 = int(dt.datetime(2026, 10, 14, 12, 15, tzinfo=dt.timezone.utc).timestamp() * 1000)
        cpi = [t for t in fair if c0 <= t <= c0 + 30 * M]
        timeline = []
        for t in range(int(dt.datetime(2026, 10, 14, 12, 26, tzinfo=dt.timezone.utc).timestamp() * 1000), int(dt.datetime(2026, 10, 14, 12, 38, tzinfo=dt.timezone.utc).timestamp() * 1000), M):
            if t in fair and (t - M) in imp:
                timeline.append({"turn_utc": dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc).strftime("%H:%M"), "stored_fair": round(fair[t], 5),
                                 "implied_fair_from_candle_t-1": round(1 / imp[t - M], 5),
                                 "gap_bp": round((fair[t] * imp[t - M] - 1) * 1e4, 1)})
        res["cpi_timeline"] = timeline
        for name, sel in (("all_minutes", ts), ("large_move_minutes", big), ("cpi_2026-10-14_12:15-12:45", cpi)):
            res[name] = {"n": len(sel)}
            for s in range(-6, 3):
                pairs = [(t, fair[t] * imp[t + s * M] - 1) for t in sel if (t + s * M) in imp]
                if len(pairs) < 20:
                    continue
                r = rolling_median_resid([p[0] for p in pairs], [p[1] for p in pairs])
                res[name][str(s)] = {"rms_bp": round(rms(r) * 1e4, 3), "n": len(r)}
            ks = [k for k in res[name] if k != "n"]
            res[name]["best_shift_minutes"] = int(min(ks, key=lambda k: res[name][k]["rms_bp"])) if ks else None
        out[book] = res
    return out


def main():
    imp = load_implied()
    yt, yv = S.SI.load_eurusd()
    ymap = dict(zip(yt, yv))
    evs = json.load(open(os.path.join(ROOT, "inputs", "events.json")))["events"]
    near = [e["t"] for e in evs]
    nearset = lambda t: any(abs(t - e) <= 15 * M for e in near)
    lastY = max(yt)
    out = {"minutes_implied": len(imp), "yahoo_last_minute_utc": S.day_of(lastY)}
    ts = sorted(t for t in imp if t + 8 * M <= lastY)
    # large-move minutes: |implied(t) / implied(t-5) - 1| > 8 bp using the last implied value within 5 minutes
    big = set()
    for t in ts:
        a, b = ymap.get(t), ymap.get(t - 5 * M)
        if a and b and abs(a / b - 1) > 8e-4:
            big.add(t)
    sets = {"all_minutes": ts, "within_15min_of_a_release": [t for t in ts if nearset(t)], "large_move_minutes": sorted(big)}
    res = {}
    for name, sel in sets.items():
        res[name] = {"n": len(sel)}
        for s in range(-3, 6):
            pairs = [(t, imp[t] / ymap[t + s * M] - 1) for t in sel if (t + s * M) in ymap]
            if len(pairs) < 20:
                continue
            tt = [p[0] for p in pairs]
            r = rolling_median_resid(tt, [p[1] for p in pairs])
            res[name][str(s)] = {"rms_bp": round(rms(r) * 1e4, 3), "n": len(r)}
        best = min((k for k in res[name] if k != "n"), key=lambda k: res[name][k]["rms_bp"], default=None)
        res[name]["best_shift_minutes"] = int(best) if best is not None else None
    out["by_set"] = res
    out["production_stored_fair_vs_exchange_implied"] = production_lag(imp)
    json.dump(out, open(os.path.join(ROOT, "results", "fxlag.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(out, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
