"""Second-pass kills for the 2026-09-25 Revolut X search.

The first screen (screen.py) killed the snapshot and the July basis.
This one kills the mechanisms measured after that, on inputs frozen
under docs/agents/backtests/inputs/fp5_2026-09-25/pass2/. A kill that
stops holding exits non-zero. Nothing here places an order or reads a
key, and nothing in it is a pre-registered test: a candle fill and a
print markout can kill a rule, and neither is being asked to pass.

    python3 docs/agents/scripts/fp5/screen_pass2.py
    python3 docs/agents/scripts/fp5/screen_pass2.py --check
"""
import bisect, gzip, hashlib, json, math, os, statistics, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25")
P2 = os.path.join(INP, "pass2")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass2.json")
ROUND_TRIP_BPS = 20.0
DOUBLED_BPS = 40.0
TWO_LEG_BPS = 36.0


def load(path):
    if path.endswith(".gz"):
        with gzip.open(path, "rt") as f:
            return json.load(f)
    with open(path) as f:
        return json.load(f)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def num(x):
    if x is None or x == "":
        return 0.0
    return float(x)


def screen_dead(median, mean, n, med_bar=10.0, mean_bar=15.0, n_bar=40):
    """Dead when a typical trade, the average, or the sample misses the bar.

    The bars are a round trip (~20 bps, so 15 does not pay it) and a
    count below the trips a testing row has been asked for.
    """
    return n < n_bar or median < med_bar or mean < mean_bar


def pin_screen_direction():
    if not screen_dead(0.2, 0.2, 1000):
        raise SystemExit("pin: a sub-basis-point markout must stay dead")
    if screen_dead(12.0, 20.0, 80):
        raise SystemExit("pin: median 12, mean 20, n 80 must not be called dead by this screen")


def closes(rows):
    return {int(c["start"]): num(c["close"]) for c in rows}


def implied_devs(usd, gbp):
    common = sorted(set(usd) & set(gbp))
    imp = []
    for t in common:
        if usd[t] <= 0 or gbp[t] <= 0:
            continue
        imp.append((t, usd[t] / gbp[t]))
    by = dict(imp)
    ts = [t for t, _ in imp]
    out = []
    for i, t in enumerate(ts):
        win = [by[ts[j]] for j in range(max(0, i - 24), i)]
        if len(win) < 12:
            continue
        med = statistics.median(win)
        out.append((t, (by[t] / med - 1.0) * 1e4))
    return out


def corr(xs, ys):
    n = len(xs)
    mx, my = statistics.mean(xs), statistics.mean(ys)
    nume = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    dx = math.sqrt(sum((a - mx) ** 2 for a in xs))
    dy = math.sqrt(sum((b - my) ** 2 for b in ys))
    return nume / (dx * dy)


def t_of(xs):
    if len(xs) < 8:
        return None
    m = statistics.mean(xs)
    s = statistics.pstdev(xs)
    if s == 0:
        return None
    return m / (s / math.sqrt(len(xs))), m, len(xs)


def hour_returns(rows, close_of, start_of):
    cs = sorted(rows, key=lambda c: int(start_of(c)))
    out = []
    for a, b in zip(cs, cs[1:]):
        ta, tb = int(start_of(a)), int(start_of(b))
        if tb - ta != 3600000:
            continue
        ca, cb = close_of(a), close_of(b)
        if ca <= 0 or cb <= 0:
            continue
        out.append((time.gmtime(tb / 1000).tm_hour, (cb / ca - 1.0) * 1e4))
    return out


def pct(xs, p):
    s = sorted(xs)
    return s[int(p * (len(s) - 1))]


def as_prints(blob, book):
    rows = []
    for ts, price, qty, side in blob[book]:
        px, q = float(price), float(qty)
        rows.append((int(ts), px, side, px * q))
    rows.sort()
    return rows


def first_from(rows, ts, t0, t1=None):
    i = bisect.bisect_left(ts, t0)
    if i >= len(rows):
        return None
    if t1 is not None and rows[i][0] > t1:
        return None
    return rows[i]


def markouts(signals, book, notional_min, entry_lo, entry_hi, hold_ms):
    ts = [r[0] for r in book]
    out = []
    for t, _px, side, notional in signals:
        if notional < notional_min or side not in ("buy", "sell"):
            continue
        entry = first_from(book, ts, t + entry_lo, t + entry_hi if entry_hi else None)
        if entry is None:
            continue
        exit_ = first_from(book, ts, entry[0] + hold_ms, None)
        if exit_ is None:
            continue
        m = (exit_[1] / entry[1] - 1.0) * 1e4 if side == "buy" else (entry[1] / exit_[1] - 1.0) * 1e4
        out.append(m)
    return out


def summ(xs):
    if not xs:
        return {"n": 0, "mean": None, "median": None}
    return {"n": len(xs), "mean": round(statistics.mean(xs), 3), "median": round(statistics.median(xs), 3)}


def main():
    pin_screen_direction()
    july_r = load(os.path.join(INP, "july_revx_1h.json.gz"))["revx"]
    july_b = load(os.path.join(INP, "july_bn_1h.json.gz"))["bn"]
    tickers = load(os.path.join(INP, "tickers_uk.json.gz"))
    gbp_h = load(os.path.join(P2, "july_gbp_1h.json.gz"))
    daily = load(os.path.join(P2, "daily_usd.json.gz"))
    sol_bn = load(os.path.join(P2, "sol_bn_1d.json.gz"))
    prints_30 = load(os.path.join(P2, "prints_30m.json.gz"))
    prints_lead = load(os.path.join(P2, "prints_gbp_lead.json.gz"))
    books = load(os.path.join(P2, "books.json"))
    probes = load(os.path.join(P2, "probes.json"))

    # --- GBP books wander together; the cross-book residual is inside a round trip ---
    bases = ["BTC", "ETH", "XRP", "SOL", "SUI"]
    usd = {b: closes(july_r[b]) for b in bases}
    dev = {b: implied_devs(usd[b], closes(gbp_h[b])) for b in bases}
    btc = dict(dev["BTC"])
    residual = {}
    for b in bases:
        if b == "BTC":
            continue
        xs, ys, gap = [], [], []
        mb = dict(dev[b])
        for t, v in dev["BTC"]:
            if t not in mb:
                continue
            xs.append(v)
            ys.append(mb[t])
            gap.append(mb[t] - v)
        residual[b] = {
            "n": len(gap),
            "corr_with_btc": round(corr(xs, ys), 3),
            "abs_p95": round(pct([abs(g) for g in gap], 0.95), 2),
        }

    # --- the best July hour is 15:00 and it is Binance's hour ---
    hours = {}
    for base in ["BTC", "ETH", "SOL", "XRP"]:
        rr = hour_returns(july_r[base], lambda c: float(c["close"]), lambda c: c["start"])
        bb = hour_returns(july_b[base], lambda k: float(k[4]), lambda k: k[0])
        best = None
        for h in range(24):
            rt = t_of([r for hh, r in rr if hh == h])
            bt = t_of([r for hh, r in bb if hh == h])
            if not rt or not bt:
                continue
            if best is None or abs(rt[0]) > abs(best["revx_t"]):
                best = {"hour": h, "revx_t": round(rt[0], 2), "revx_mean": round(rt[1], 2),
                        "binance_t": round(bt[0], 2), "binance_mean": round(bt[1], 2), "n": rt[2]}
        hours[base] = best

    # --- a coin/BTC ratio displaced by a round trip does not come back within the hour ---
    ratio = {}
    btc_c = closes(july_r["BTC"])
    for alt in ["ETH", "SOL", "XRP", "LTC", "SUI", "PEPE"]:
        alt_c = closes(july_r[alt])
        common = sorted(set(btc_c) & set(alt_c))
        by = {}
        ts = []
        for t in common:
            if btc_c[t] <= 0 or alt_c[t] <= 0:
                continue
            by[t] = alt_c[t] / btc_c[t]
            ts.append(t)
        toward = []
        for i in range(24, len(ts) - 1):
            t, n = ts[i], ts[i + 1]
            if n - t != 3600000:
                continue
            med = statistics.median(by[ts[j]] for j in range(i - 24, i))
            d0 = (by[t] / med - 1.0) * 1e4
            d1 = (by[n] / med - 1.0) * 1e4
            if abs(d0) < DOUBLED_BPS:
                continue
            toward.append(-(d1 - d0) if d0 > 0 else (d1 - d0))
        ratio[alt] = {"n": len(toward), "median_toward_bps": round(statistics.median(toward), 2)}

    # --- cross-section: long the hour's worst coin, short the best ---
    names = ["BTC", "ETH", "SOL", "XRP", "LTC", "SUI"]
    C = {b: closes(july_r[b]) for b in names}
    times = sorted(set.intersection(*[set(C[b]) for b in names]))
    xs_pnl = []
    for i in range(1, len(times) - 1):
        p, a, n = times[i - 1], times[i], times[i + 1]
        if a - p != 3600000 or n - a != 3600000:
            continue
        if any(min(C[b][p], C[b][a], C[b][n]) <= 0 for b in names):
            continue
        sig = {b: (C[b][a] / C[b][p] - 1.0) * 1e4 for b in names}
        fut = {b: (C[b][n] / C[b][a] - 1.0) * 1e4 for b in names}
        worst, best = min(sig, key=sig.get), max(sig, key=sig.get)
        xs_pnl.append(fut[worst] - fut[best])

    # --- daily candles: autocorrelation, jumps, volume, ratio momentum, compression, weekend ---
    def drows(base):
        return sorted(daily[base], key=lambda c: int(c["start"]))

    daily_out = {}
    for base in ["BTC", "ETH", "SOL", "XRP", "LTC", "AVAX"]:
        rs = drows(base)
        rets = []
        for a, b in zip(rs, rs[1:]):
            if int(b["start"]) - int(a["start"]) != 86400000:
                continue
            ca, cb = num(a["close"]), num(b["close"])
            if ca <= 0 or cb <= 0:
                continue
            rets.append((cb / ca - 1.0) * 1e4)
        rho = corr(rets[:-1], rets[1:])
        toward = []
        for i in range(1, len(rs) - 1):
            a, b, c = rs[i - 1], rs[i], rs[i + 1]
            if int(b["start"]) - int(a["start"]) != 86400000 or int(c["start"]) - int(b["start"]) != 86400000:
                continue
            if num(b["volume"]) <= 0:
                continue
            pa, pb, pc = num(a["close"]), num(b["close"]), num(c["close"])
            if min(pa, pb, pc) <= 0:
                continue
            r = (pb / pa - 1.0) * 1e4
            nxt = (pc / pb - 1.0) * 1e4
            if abs(r) < 300:
                continue
            toward.append(-nxt if r > 0 else nxt)
        vols = [num(c["volume"]) for c in rs]
        signed = []
        for i in range(21, len(rs) - 1):
            if int(rs[i]["start"]) - int(rs[i - 1]["start"]) != 86400000:
                continue
            if int(rs[i + 1]["start"]) - int(rs[i]["start"]) != 86400000:
                continue
            window = vols[i - 20:i]
            if any(v <= 0 for v in window + [vols[i]]):
                continue
            if vols[i] < 2 * statistics.median(window):
                continue
            r = num(rs[i]["close"]) / num(rs[i - 1]["close"]) - 1.0
            nxt = (num(rs[i + 1]["close"]) / num(rs[i]["close"]) - 1.0) * 1e4
            if r == 0:
                continue
            signed.append(nxt if r > 0 else -nxt)
        ranges = []
        for i in range(10, len(rs) - 1):
            window = rs[i - 10:i]
            if any(int(window[j + 1]["start"]) - int(window[j]["start"]) != 86400000 for j in range(9)):
                continue
            if int(rs[i]["start"]) - int(window[-1]["start"]) != 86400000:
                continue
            hi, lo = max(num(c["high"]) for c in window), min(num(c["low"]) for c in window)
            mid = num(window[-1]["close"])
            if mid <= 0 or hi <= lo:
                continue
            nxt = abs(num(rs[i]["close"]) / mid - 1.0) * 1e4
            ranges.append(((hi - lo) / mid * 1e4, nxt))
        q1 = sorted(r for r, _ in ranges)[len(ranges) // 4]
        quiet = [n for r, n in ranges if r <= q1]
        alln = [n for _, n in ranges]
        cont = [-t for t in toward]
        daily_out[base] = {
            "rho1": round(rho, 3),
            "jump_n": len(toward),
            "jump_median_continuation_bps": None if not cont else round(statistics.median(cont), 2),
            "volume_n": len(signed),
            "volume_median_signed_bps": None if not signed else round(statistics.median(signed), 2),
            "quiet_excess_bps": round(statistics.median(quiet) - statistics.median(alln), 2),
        }

    pair = {}
    btc_d = {int(c["start"]): num(c["close"]) for c in drows("BTC")}
    for alt in ["ETH", "SOL", "XRP", "LTC", "AVAX"]:
        alt_d = {int(c["start"]): num(c["close"]) for c in drows(alt)}
        common = sorted(set(btc_d) & set(alt_d))
        horizon = 5
        picked = []
        last = -1
        for i in range(horizon, len(common) - horizon):
            t0, t1, t2 = common[i - horizon], common[i], common[i + horizon]
            if t1 - t0 != horizon * 86400000 or t2 - t1 != horizon * 86400000:
                continue
            if t1 < last:
                continue
            vals = [alt_d[t0], alt_d[t1], alt_d[t2], btc_d[t0], btc_d[t1], btc_d[t2]]
            if min(vals) <= 0:
                continue
            past = (alt_d[t1] / btc_d[t1]) / (alt_d[t0] / btc_d[t0]) - 1.0
            fut = (alt_d[t2] / btc_d[t2]) / (alt_d[t1] / btc_d[t1]) - 1.0
            if past == 0:
                continue
            picked.append(fut * 1e4 if past > 0 else -fut * 1e4)
            last = t1 + horizon * 86400000
        pair[alt] = {"n": len(picked), "median": round(statistics.median(picked), 2), "mean": round(statistics.mean(picked), 2)}

    bn_map = {int(t): num(c) for t, c in sol_bn}
    rs = drows("SOL")
    wk_r, we_r, wk_b, we_b = [], [], [], []
    for a, b in zip(rs, rs[1:]):
        ta, tb = int(a["start"]), int(b["start"])
        if tb - ta != 86400000 or ta not in bn_map or tb not in bn_map:
            continue
        ca, cb = num(a["close"]), num(b["close"])
        if ca <= 0 or cb <= 0 or bn_map[ta] <= 0 or bn_map[tb] <= 0:
            continue
        rr = (cb / ca - 1.0) * 1e4
        br = (bn_map[tb] / bn_map[ta] - 1.0) * 1e4
        bucket_r, bucket_b = (we_r, we_b) if time.gmtime(tb / 1000).tm_wday >= 5 else (wk_r, wk_b)
        bucket_r.append(rr)
        bucket_b.append(br)
    weekend = {
        "sol_revx_weekend_mean_bps": round(statistics.mean(we_r), 2),
        "sol_binance_weekend_mean_bps": round(statistics.mean(we_b), 2),
        "sol_revx_weekday_mean_bps": round(statistics.mean(wk_r), 2),
        "sol_binance_weekday_mean_bps": round(statistics.mean(wk_b), 2),
        "n_weekend": len(we_r),
    }

    # --- large prints, 30 minutes, 2026-09-11..14. Follow and fade both die on the median ---
    p30 = {}
    pool = []
    for book in ["BTC-USD", "ETH-USD", "XRP-USD"]:
        rows = as_prints(prints_30, book)
        # markout versus the same book's own later print, from the print itself
        xs = []
        j = 0
        for i, (t, px, side, notional) in enumerate(rows):
            if notional < 5000 or side not in ("buy", "sell"):
                continue
            while j < len(rows) and rows[j][0] < t + 30 * 60 * 1000:
                j += 1
            if j >= len(rows):
                continue
            fut = rows[j][1]
            m = (fut / px - 1.0) * 1e4 if side == "buy" else (px / fut - 1.0) * 1e4
            xs.append(m)
        p30[book] = summ(xs)
        pool.extend(xs)
    p30["pooled"] = summ(pool)

    # --- GBP prints do not lead the USD book, and BTC prints do not lead ETH ---
    lead = {}
    gbp_m, ctrl_m = [], []
    for base in ("BTC", "ETH"):
        g = as_prints(prints_lead, f"{base}-GBP")
        u = as_prints(prints_lead, f"{base}-USD")
        gbp_m.extend(markouts(g, u, 2000, 60_000, 5 * 60_000, 5 * 60_000))
        ctrl_m.extend(markouts(u, u, 5000, 60_000, 5 * 60_000, 5 * 60_000))
    gsum, csum = summ(gbp_m), summ(ctrl_m)
    lead["gbp_conditioned"] = gsum
    lead["usd_control"] = csum
    lead["mean_diff"] = round(gsum["mean"] - csum["mean"], 3)
    btc_u = as_prints(prints_lead, "BTC-USD")
    eth_u = as_prints(prints_lead, "ETH-USD")
    cross = markouts(btc_u, eth_u, 5000, 60_000, 5 * 60_000, 5 * 60_000) + markouts(eth_u, btc_u, 5000, 60_000, 5 * 60_000, 5 * 60_000)
    lead["cross_coin"] = summ(cross)

    # --- index versus mid, one ticker snapshot ---
    gbp_fx = 1.321145
    liq_clear = []
    for r in tickers:
        mid, b, a = num(r["mid"]), num(r["bid"]), num(r["ask"])
        idx = num(r["index_price"])
        if mid <= 0 or b <= 0 or a <= 0 or idx <= 0:
            continue
        base, quote = r["symbol"].split("/")
        qv = num(r["quote_volume_24h"]) * (gbp_fx if quote == "GBP" else 1.0)
        if qv <= 50000:
            continue
        spr = (a - b) / mid * 1e4
        gap = (mid / idx - 1.0) * 1e4
        if abs(gap) > spr / 2.0 + 9.0:
            liq_clear.append(r["symbol"])

    btc_book = next(b for b in books["books"] if b["sym"] == "BTC-USD")
    sui_book = next(b for b in books["books"] if b["sym"] == "SUI-USD")
    max_count = max(max(b["counts_seen"]) for b in books["books"])
    btc_imb = abs(btc_book["bid_notional_10bp"] - btc_book["ask_notional_10bp"]) / ((btc_book["bid_notional_10bp"] + btc_book["ask_notional_10bp"]) / 2.0)

    kills = {
        "gbp_cross_residual_inside_a_round_trip": all(
            residual[b]["abs_p95"] < ROUND_TRIP_BPS and residual[b]["corr_with_btc"] > 0.85
            for b in ("ETH", "XRP", "SOL")
        ),
        "best_hour_is_binances": all(
            hours[b]["hour"] == 15 and abs(hours[b]["revx_t"]) < 3 and abs(hours[b]["revx_mean"] - hours[b]["binance_mean"]) < 3
            for b in hours
        ),
        "ratio_does_not_revert_inside_an_hour": all(ratio[b]["median_toward_bps"] < 10 for b in ratio),
        "cross_section_reversal_under_a_round_trip": statistics.mean(xs_pnl) < 15,
        "daily_autocorr_is_noise": all(abs(daily_out[b]["rho1"]) < 0.15 for b in daily_out),
        "jump_continuation_misses_the_trip_or_the_stress_bar": all(
            not (daily_out[b]["jump_n"] >= 60 and (daily_out[b]["jump_median_continuation_bps"] or 0) >= DOUBLED_BPS)
            for b in daily_out
        ),
        "volume_surprise_under_doubled_costs": all(
            daily_out[b]["volume_median_signed_bps"] is None or daily_out[b]["volume_median_signed_bps"] < DOUBLED_BPS
            for b in ("BTC", "ETH", "SOL", "XRP")
        ),
        "five_day_ratio_momentum_misses_two_legs": all(
            not (pair[b]["mean"] > TWO_LEG_BPS and pair[b]["median"] > TWO_LEG_BPS) for b in pair
        ),
        "quiet_days_do_not_break_out": all(daily_out[b]["quiet_excess_bps"] < 0 for b in ("BTC", "ETH", "SOL", "XRP")),
        "sol_weekend_is_binances": abs(weekend["sol_revx_weekend_mean_bps"] - weekend["sol_binance_weekend_mean_bps"]) < 5,
        "large_print_30m_median_does_not_pay": screen_dead(p30["pooled"]["median"], p30["pooled"]["mean"], p30["pooled"]["n"])
            and p30["ETH-USD"]["mean"] < DOUBLED_BPS,
        "gbp_prints_do_not_lead_usd": screen_dead(gsum["median"], gsum["mean"], gsum["n"]) and lead["mean_diff"] < 10,
        "btc_and_eth_prints_do_not_lead_each_other": screen_dead(lead["cross_coin"]["median"], lead["cross_coin"]["mean"], lead["cross_coin"]["n"]),
        "probes_are_not_a_maker_edge": len(probes["m15_adverse_bps"]) < 30 and all(x > 20 for x in probes["m15_adverse_bps"]),
        "btc_book_is_balanced_and_the_queue_is_thin": btc_imb < 0.02 and max_count <= 4 and sui_book["spr"] > 20,
        "index_gap_clears_taker_on_at_most_one_liquid_book": len(liq_clear) <= 1,
    }
    if not all(kills.values()):
        failed = [k for k, v in kills.items() if not v]
        raise SystemExit("a kill flipped: " + ", ".join(failed))

    names_in = [
        "pass2/july_gbp_1h.json.gz", "pass2/daily_usd.json.gz", "pass2/sol_bn_1d.json.gz",
        "pass2/prints_30m.json.gz", "pass2/prints_gbp_lead.json.gz", "pass2/books.json", "pass2/probes.json",
        "july_revx_1h.json.gz", "july_bn_1h.json.gz", "tickers_uk.json.gz",
    ]
    summary = {
        "reached_preregistration": False,
        "kills": kills,
        "gbp_cross_residual": residual,
        "best_hour": hours,
        "ratio_toward_bps": ratio,
        "cross_section_reversal_mean_bps": round(statistics.mean(xs_pnl), 2),
        "daily": daily_out,
        "five_day_ratio": pair,
        "weekend_sol": weekend,
        "prints_30m": p30,
        "lead": lead,
        "index_gap_clears_taker": liq_clear,
        "book": {"btc_imbalance": round(btc_imb, 4), "max_orders_on_a_level": max_count, "sui_spread_bps": sui_book["spr"]},
        "probes_m15_adverse_bps": probes["m15_adverse_bps"],
        "inputs_sha256": {n: sha256(os.path.join(INP, n)) for n in names_in},
    }
    text = json.dumps(summary, indent=1, sort_keys=True) + "\n"
    if "--check" in sys.argv:
        with open(OUT) as f:
            if f.read() != text:
                raise SystemExit("summary_pass2.json does not match a fresh run")
        print("check ok")
        return
    with open(OUT, "w") as f:
        f.write(text)
    print("kills", sum(kills.values()), "/", len(kills))
    print("30m", p30["pooled"])
    print("lead", gsum, "diff", lead["mean_diff"], "cross", lead["cross_coin"])
    print("weekend", weekend)
    print("index", liq_clear)


if __name__ == "__main__":
    main()
