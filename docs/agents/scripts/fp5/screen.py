"""Arithmetic screen for a Revolut X search on 2026-09-25.

Reads the frozen public inputs beside this repository and writes
docs/agents/backtests/fp5/summary.json. Nothing here places an order
or reads a key. A candidate reaches a pre-registered test only if a
kill below stops being true; this run's job is to show they hold.

    python3 docs/agents/scripts/fp5/screen.py
    python3 docs/agents/scripts/fp5/screen.py --check
"""
import gzip, hashlib, json, math, os, statistics, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary.json")
MAKER_H_OVER_SIGMA = 2.7  # fp2: a once-a-minute quote needs the half-spread at least this many 1-minute sigmas
TAKER_BPS = 9.0
HOUR_T_BONFERRONI = 3.0  # about 24 hourly looks, two-sided 5%


def load(name):
    path = os.path.join(INP, name)
    if name.endswith(".gz"):
        with gzip.open(path, "rt") as f:
            return json.load(f)
    with open(path) as f:
        return json.load(f)


def sha256(name):
    h = hashlib.sha256()
    with open(os.path.join(INP, name), "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def num(x):
    if x is None or x == "":
        return 0.0
    return float(x)


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
        hour = time.gmtime(tb / 1000).tm_hour
        out.append((hour, (cb / ca - 1.0) * 1e4))
    return out


def t_of(xs):
    if len(xs) < 2:
        return None
    m = statistics.mean(xs)
    s = statistics.pstdev(xs)
    if s == 0:
        return None
    return m / (s / math.sqrt(len(xs))), m, s, len(xs)


def sigma_1m(candles):
    cs = sorted(candles, key=lambda c: int(c["start"]))
    rets = []
    prev = None
    traded = 0
    for c in cs:
        cl = float(c["close"])
        if float(c["volume"]) > 0:
            traded += 1
        if prev and prev > 0 and cl > 0:
            rets.append((cl / prev - 1.0) * 1e4)
        prev = cl
    if len(rets) < 10:
        return None, traded, len(cs)
    return statistics.pstdev(rets), traded, len(cs)


def clears_maker_budget(half_spread_bps, sigma_bps, bar=MAKER_H_OVER_SIGMA):
    """True when a once-a-minute quote is inside its own spread long enough to be worth testing."""
    if sigma_bps <= 0:
        return False
    return (half_spread_bps / sigma_bps) >= bar


def pin_threshold_direction():
    """The bar must still be able to say yes. A book 6 sigmas wide clears; a book 1 sigma wide does not."""
    if not clears_maker_budget(30.0, 5.0):
        raise SystemExit("pin: a 30 bp half-spread against a 5 bp minute no longer clears 2.7")
    if clears_maker_budget(10.0, 10.0):
        raise SystemExit("pin: a half-spread equal to one minute of movement must not clear 2.7")


def main():
    pin_threshold_direction()
    tickers = load("tickers_uk.json.gz")
    pairs = load("pairs.json.gz")
    kr = load("kraken_ticker.json.gz")["result"]
    july_r = load("july_revx_1h.json.gz")["revx"]
    july_b = load("july_bn_1h.json.gz")["bn"]
    live = load("live_reads.json")
    basis = load("basis_agg.json")

    bid, ask = float(kr["ZGBPZUSD"]["b"][0]), float(kr["ZGBPZUSD"]["a"][0])
    gbp = (bid + ask) / 2.0

    books = []
    for r in tickers:
        mid, b, a = num(r["mid"]), num(r["bid"]), num(r["ask"])
        if mid <= 0 or b <= 0 or a <= 0:
            continue
        base, quote = r["symbol"].split("/")
        qv = num(r["quote_volume_24h"])
        qv_usd = qv * gbp if quote == "GBP" else qv
        books.append({
            "sym": r["symbol"], "base": base, "quote": quote,
            "spr": (a - b) / mid * 1e4, "qv": qv_usd, "mid": mid,
        })
    usd = {b["base"]: b for b in books if b["quote"] == "USD"}
    gbp_abs = []
    for b in books:
        if b["quote"] != "GBP" or b["base"] not in usd:
            continue
        imp = usd[b["base"]]["mid"] / b["mid"]
        gbp_abs.append(abs(imp / gbp - 1.0) * 1e4)
    gbp_abs.sort()

    wide_names = ["NEON", "ALEO", "AURORA", "NEAR", "VVV", "STRK", "QNT", "FET"]
    wide = []
    for base in wide_names:
        sig, traded, bars = sigma_1m(load(f"m1/{base}.json.gz"))
        spr = usd[base]["spr"]
        ratio = (spr / 2.0) / sig
        wide.append({
            "base": base, "half_spread_bps": round(spr / 2.0, 2), "sigma_1m_bps": round(sig, 2),
            "h_over_sigma": round(ratio, 3), "clears": clears_maker_budget(spr / 2.0, sig),
            "traded_minutes": traded, "bars": bars, "qv_usd": round(usd[base]["qv"], 0),
        })

    def gaps(base):
        rm = {int(c["start"]): float(c["close"]) for c in july_r[base]}
        bm = {int(k[0]): float(k[4]) for k in july_b[base]}
        common = sorted(set(rm) & set(bm))
        return [(rm[t] / bm[t] - 1.0) * 1e4 for t in common]

    def next_hour_toward(base, thr):
        rm = {int(c["start"]): float(c["close"]) for c in july_r[base]}
        bm = {int(k[0]): float(k[4]) for k in july_b[base]}
        common = sorted(set(rm) & set(bm))
        toward = []
        for a, b in zip(common, common[1:]):
            if b - a != 3600000:
                continue
            g0 = (rm[a] / bm[a] - 1.0) * 1e4
            g1 = (rm[b] / bm[b] - 1.0) * 1e4
            if abs(g0) < thr:
                continue
            d = g1 - g0
            toward.append(-d if g0 > 0 else d)
        if not toward:
            return None, 0
        return statistics.median(toward), len(toward)

    july = {}
    for base in ["BTC", "ETH", "SOL", "XRP", "LTC", "SUI", "PEPE"]:
        g = gaps(base)
        sg = sorted(g)
        n = len(sg)
        med40, n40 = next_hour_toward(base, 40)
        july[base] = {
            "n": n,
            "median_bps": round(statistics.median(g), 2),
            "p05": round(sg[int(0.05 * (n - 1))], 2),
            "p95": round(sg[int(0.95 * (n - 1))], 2),
            "n_abs_ge_40": n40,
            "median_next_hour_toward_zero_when_abs_ge_40": None if med40 is None else round(med40, 2),
        }

    hours = {}
    for base in ["BTC", "ETH", "SOL", "XRP"]:
        rr = hour_returns(july_r[base], lambda c: float(c["close"]), lambda c: c["start"])
        bb = hour_returns(july_b[base], lambda k: float(k[4]), lambda k: k[0])
        rt = t_of([r for h, r in rr if h == 15])
        bt = t_of([r for h, r in bb if h == 15])
        hours[base] = {
            "revx_mean_bps": round(rt[1], 2), "revx_t": round(rt[0], 2), "revx_n": rt[3],
            "binance_mean_bps": round(bt[1], 2), "binance_t": round(bt[0], 2),
        }

    quotes = {}
    for k, v in pairs.items():
        quotes[v["quote"]] = quotes.get(v["quote"], 0) + 1
    stables = sorted(b["sym"] for b in books if b["base"] in ("USDC", "USDT", "PAXG", "XAUT"))
    usdc_qv = round(sum(b["qv"] for b in books if b["quote"] == "USDC"), 0)

    sui = basis["sui_tight_revert"]
    unhedged_after_one_taker = sui["med_abs_basis_shrink_bps"] - sui["revx_taker_bps"]

    kills = {
        "gbp_implied_fx_inside_a_few_bps": statistics.median(gbp_abs) < 5.0,
        "no_wide_book_clears_maker_budget": all(not w["clears"] for w in wide),
        "july_major_basis_under_a_round_trip": july["BTC"]["n_abs_ge_40"] <= 5 and abs(july["BTC"]["median_bps"]) < 15,
        "pepe_reversion_fails_doubled_costs": (
            july["PEPE"]["median_next_hour_toward_zero_when_abs_ge_40"] is not None
            and july["PEPE"]["median_next_hour_toward_zero_when_abs_ge_40"] < 40
        ),
        "hour_15_is_not_a_revolut_edge": all(
            hours[b]["revx_t"] < HOUR_T_BONFERRONI and abs(hours[b]["revx_mean_bps"] - hours[b]["binance_mean_bps"]) < 3
            for b in hours
        ),
        "kraken_touch_basis_does_not_pay_a_hedge": all(
            row["p95"] < 15 and row["n_ge_40"] <= 1 for row in basis["by_symbol"] if row["symbol"] != "SUI/USD"
        ),
        "sui_revert_is_smaller_than_the_move": sui["med_abs_mid_move_bps"] > unhedged_after_one_taker and sui["n"] < 30,
        "fresh_xrp_gap_is_not_45bps": abs(live["revx_vs_binance_bps"]["XRP/USD"]) < 10,
        "eur_books_are_not_on_the_uk_region": "Couldn't find" in live["eur_on_uk"],
        "deribit_carry_under_a_round_trip": live["deribit_btc_perp_funding_value"]["value"] * 1e4 < TAKER_BPS,
    }
    if not all(kills.values()):
        failed = [k for k, v in kills.items() if not v]
        raise SystemExit("a kill flipped, so this is no longer an arithmetic rejection: " + ", ".join(failed))

    names = [
        "tickers_uk.json.gz", "pairs.json.gz", "kraken_ticker.json.gz",
        "july_revx_1h.json.gz", "july_bn_1h.json.gz", "live_reads.json", "basis_agg.json",
    ] + [f"m1/{b}.json.gz" for b in wide_names]
    summary = {
        "reached_preregistration": False,
        "maker_bar_h_over_sigma": MAKER_H_OVER_SIGMA,
        "kills": kills,
        "universe": {"pairs": len(pairs), "uk_tickers": len(tickers), "quotes": quotes, "usdc_quote_volume_usd": usdc_qv, "stables_and_gold": stables},
        "gbp_implied_abs_bps": {"n": len(gbp_abs), "median": round(statistics.median(gbp_abs), 2), "p90": round(gbp_abs[int(0.9 * (len(gbp_abs) - 1))], 2), "max": round(gbp_abs[-1], 2)},
        "wide_books_2026_09_23": wide,
        "july_2026_hourly_vs_binance_bps": july,
        "july_hour_15_utc": hours,
        "inputs_sha256": {n: sha256(n) for n in names},
    }
    text = json.dumps(summary, indent=1, sort_keys=True) + "\n"
    if "--check" in sys.argv:
        with open(OUT) as f:
            if f.read() != text:
                raise SystemExit("summary.json does not match a fresh run")
        print("check ok")
        return
    with open(OUT, "w") as f:
        f.write(text)
    print(text)


if __name__ == "__main__":
    main()
