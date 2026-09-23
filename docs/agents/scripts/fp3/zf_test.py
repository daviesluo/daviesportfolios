"""Test ZF (prereg_zero_fee_quotes.md, frozen 2026-09-23T15:52:41Z): resting quotes on Binance's
zero-fee stablecoin books, fills from prints (aggTrades) strictly beyond the order price.

usage: python3 analysis/zf_test.py OUT.json
Reads data/aggtrades/<SYM>_min.json (per-minute last print and price levels with their notional),
data/bn_1m_eur/EURUSDT.json (1-minute klines), data/zf_spreads.json. Deterministic (fixed seed,
sorted iteration, rounded output)."""
import json, os, sys, math, random, bisect, datetime

S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(S, "results", "zf_run.json")
MIN = 60000
T_END = int(datetime.datetime(2026, 9, 22, tzinfo=datetime.timezone.utc).timestamp() * 1000)  # exclusive
OOS1 = (int(datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000),
        int(datetime.datetime(2026, 6, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000))
OOS2 = (OOS1[1], T_END)
BOOKS = {  # symbol: (family, tick, promotion start ms, quote is EUR-like)
    "EURIUSDT": ("E", 0.0001, "2024-08-28T10:00", False),
    "EUREURI": ("E", 0.0001, "2024-08-28T10:00", True),
    "UUSDT": ("U", 0.0001, "2026-01-13T08:00", False),
    "UUSDC": ("U", 0.0001, "2026-01-13T08:00", False),
    "RLUSDUSDT": ("U", 0.0001, "2026-01-22T08:00", False),
    "RLUSDU": ("U", 0.0001, "2026-01-22T08:00", False),
    "BFUSDUSDT": ("U", 0.0001, "2025-08-13T14:00", False),
    "XUSDUSDT": ("U", 0.0001, "2025-03-19T08:00", False),
    "USDTUSD": ("X", 0.00001, "2025-11-18T15:00", False),
    "USDCUSD": ("X", 0.00001, "2025-11-18T15:00", False),
}
PRIMARY = [b for b, v in BOOKS.items() if v[0] in ("E", "U")]
RUNGS = [2, 5, 10]
SIZE_USD = 100.0
SEED = 20260923
NULL_DRAWS = 2000
CAP = {"all": 8 * 2 * 3 * 100.0, "E": 2 * 2 * 3 * 100.0, "U": 6 * 2 * 3 * 100.0}


def iso_ms(s):
    return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def start_ms(book):
    """The later of 2024-09-01 and the first full UTC day after the promotion started."""
    p = datetime.datetime.fromisoformat(BOOKS[book][2]).replace(tzinfo=datetime.timezone.utc)
    d = (p + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(int(d.timestamp() * 1000), iso_ms("2024-09-01T00:00"))


def window_of(t):
    if t < OOS1[0]:
        return "IS"
    if t < OOS1[1]:
        return "OOS1"
    return "OOS2"


def floor_tick(x, tick):
    return round(math.floor(x / tick + 1e-9) * tick, 10)


def ceil_tick(x, tick):
    return round(math.ceil(x / tick - 1e-9) * tick, 10)


def load_eur():
    rows = json.load(open(os.path.join(S, "data", "bn_1m_eur", "EURUSDT.json")))
    return {r[0]: r[4] for r in rows}


def median(v):
    s = sorted(v)
    n = len(s)
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def build_book(book, eur, spreads):
    fam, tick, _, eur_quote = BOOKS[book]
    raw = json.load(open(os.path.join(S, "data", "aggtrades", f"{book}_min.json")))
    mins = {int(k): v for k, v in raw.items()}
    t0 = start_ms(book)
    # EUR reference close by minute, forward-filled
    eur_keys = sorted(eur)

    def eur_at(t):  # close of the last EURUSDT minute <= t
        i = bisect.bisect_right(eur_keys, t) - 1
        return eur[eur_keys[i]] if i >= 0 else None

    ts = list(range(t0, T_END, MIN))
    n = len(ts)
    last = [None] * n
    levels = [None] * n
    for i, t in enumerate(ts):
        v = mins.get(t)
        if v:
            last[i] = v[0]
            levels[i] = v[1]
    # hourly fair / basis from the 1,440 minutes BEFORE each hour start
    hour_val = {}
    for i, t in enumerate(ts):
        if t % 3600000:
            continue
        lo = max(0, i - 1440)
        vals = []
        for j in range(lo, i):
            if last[j] is None:
                continue
            if book == "EURIUSDT":
                e = eur.get(ts[j])
                if e:
                    vals.append(last[j] / e)
            else:
                vals.append(last[j])
        hour_val[t] = median(vals) if len(vals) >= 60 else None
    # data before t0 is not loaded, so the first day has no fair (quotes start after 60 prints)

    def fair_at(i):
        """Fair used by the order resting in minute i: priced during minute i-1 from data to the end of i-2."""
        if i < 2:
            return None
        tm1 = ts[i - 1]
        h = tm1 - tm1 % 3600000
        hv = hour_val.get(h)
        if hv is None:
            return None
        if book == "EURIUSDT":
            e = eur_at(ts[i - 2])
            return e * hv if e else None
        return hv

    fair = [fair_at(i) for i in range(n)]
    half = max(spreads.get(book, {}).get("median_spread_bps", 1.0) / 2.0, 0.5 * tick * 1e4) / 1e4
    return {"book": book, "fam": fam, "tick": tick, "eur_quote": eur_quote, "ts": ts, "last": last,
            "levels": levels, "fair": fair, "half": half, "eur_at": eur_at, "n": n}


def exit_tables(B, through_ticks):
    """next_up[i]: first minute j >= i where a print is strictly beyond ceil(fair[j]) by >= through_ticks ticks
    (a long's exit ask fills); next_dn[i] likewise for a short's exit bid. Also next_print[i]."""
    n, tick, fair, levels, last = B["n"], B["tick"], B["fair"], B["levels"], B["last"]
    up = [None] * (n + 1)
    dn = [None] * (n + 1)
    nxt = [None] * (n + 1)
    for i in range(n - 1, -1, -1):
        up[i], dn[i], nxt[i] = up[i + 1], dn[i + 1], nxt[i + 1]
        if last[i] is not None:
            nxt[i] = i
        f = fair[i]
        if f is None or levels[i] is None:
            continue
        a = ceil_tick(f, tick)
        b = floor_tick(f, tick)
        lv = levels[i]
        if lv[-1][0] >= a + through_ticks * tick - 1e-12:
            up[i] = i
        if lv[0][0] <= b - through_ticks * tick + 1e-12:
            dn[i] = i
    return up, dn, nxt


def close_trip(B, side, entry_i, entry_px, qty, tables, through_ticks, stop_extra_ticks, fee):
    """Exit from minute entry_i+1: at fair (strictly beyond), or the 24 h time stop. Returns (exit_i, exit_px, pnl_quote, kind)."""
    up, dn, nxt = tables
    n, tick = B["n"], B["tick"]
    j0 = entry_i + 1
    if j0 >= n:
        return None
    stop_i = entry_i + 1440
    cand = (up if side == "long" else dn)[j0]
    if cand is not None and cand < stop_i:
        f = B["fair"][cand]
        px = ceil_tick(f, tick) if side == "long" else floor_tick(f, tick)
        kind = "maker"
    else:
        k = nxt[stop_i] if stop_i < n else None
        if k is None:
            return None  # data ends before the stop: position still open (reported)
        cand = k
        lp = B["last"][k]
        if side == "long":
            px = lp * (1 - B["half"]) - stop_extra_ticks * tick
        else:
            px = lp * (1 + B["half"]) + stop_extra_ticks * tick
        kind = "stop"
    pnl = (px - entry_px) * qty if side == "long" else (entry_px - px) * qty
    pnl -= fee * (entry_px * qty + px * qty)
    return cand, px, pnl, kind


def usd(B, i, x_quote):
    if B["eur_quote"]:
        e = B["eur_at"](B["ts"][i])
        return x_quote * e
    return x_quote


def simulate(B, arm):
    """arm: dict(through=1|2, stop_extra=0|1, cap='beyond'|'ten', fee=0|0.001)."""
    tick, n = B["tick"], B["n"]
    tables = exit_tables(B, arm["through"])
    trips = []
    open_until = {}  # (side, d) -> index when the rung re-arms
    for i in range(n):
        f = B["fair"][i]
        lv = B["levels"][i]
        if f is None or lv is None:
            continue
        tot = sum(x[1] for x in lv)
        for d in RUNGS:
            for side in ("long", "short"):
                key = (side, d)
                if open_until.get(key, -1) >= i:
                    continue
                size_q = SIZE_USD / (B["eur_at"](B["ts"][i - 2]) if B["eur_quote"] else 1.0)
                if side == "long":
                    p = floor_tick(f * (1 - d / 1e4), tick)
                    thr = p - (arm["through"] - 1) * tick
                    if lv[0][0] >= thr - 1e-12:
                        continue
                    beyond = sum(x[1] for x in lv if x[0] < thr - 1e-12)
                else:
                    p = ceil_tick(f * (1 + d / 1e4), tick)
                    thr = p + (arm["through"] - 1) * tick
                    if lv[-1][0] <= thr + 1e-12:
                        continue
                    beyond = sum(x[1] for x in lv if x[0] > thr + 1e-12)
                if beyond <= 0:
                    continue
                notional = min(size_q, beyond) if arm["cap"] == "beyond" else min(size_q, 0.10 * tot)
                if notional <= 0:
                    continue
                qty = notional / p
                r = close_trip(B, side, i, p, qty, tables, arm["through"] - 1, arm["stop_extra"], arm["fee"])
                if r is None:
                    open_until[key] = n  # stays open to the end: not counted, reported
                    trips.append({"i": i, "side": side, "d": d, "open": True})
                    continue
                ei, epx, pnl_q, kind = r
                open_until[key] = ei
                trips.append({"i": i, "t": B["ts"][i], "side": side, "d": d, "entry": p, "exit": epx, "exit_i": ei,
                              "kind": kind, "notional_usd": usd(B, i, notional), "pnl": usd(B, ei, pnl_q),
                              "win": window_of(B["ts"][i]), "hold_min": ei - i})
    return trips, tables


def null_draws(books_state, primary_trips, draws):
    """Random-time twin for every OOS trip: same book, side, notional, window; entry at the last print of a
    uniformly drawn minute with a print (and a fair) in that window; same exit rule (primary arm).
    Per-$1 outcomes are precomputed for every candidate minute, so a draw is a sum of lookups."""
    rng = random.Random(SEED)
    unit = {}
    for b, (B, tables) in sorted(books_state.items()):
        for w in ("OOS1", "OOS2"):
            lo, hi = OOS1 if w == "OOS1" else OOS2
            pool = [i for i in range(B["n"]) if B["last"][i] is not None and lo <= B["ts"][i] < hi and B["fair"][i] is not None]
            for side in ("long", "short"):
                vals = []
                for i in pool:
                    px = B["last"][i]
                    size_q = 1.0 / (B["eur_at"](B["ts"][i]) if B["eur_quote"] else 1.0)
                    r = close_trip(B, side, i, px, size_q / px, tables, 0, 0, 0.0)
                    vals.append(usd(B, r[0], r[2]) if r is not None else 0.0)
                unit[(b, w, side)] = vals
    oos = [(b, t["win"], t["side"], t["notional_usd"]) for b, ts_ in sorted(primary_trips.items()) for t in ts_
           if not t.get("open") and t["win"] in ("OOS1", "OOS2")]
    totals = []
    for _ in range(draws):
        tot = 0.0
        for b, w, side, nus in oos:
            vals = unit[(b, w, side)]
            if vals:
                tot += nus * vals[rng.randrange(len(vals))]
        totals.append(tot)
    totals.sort()
    return totals


def month_of(t):
    return datetime.datetime.utcfromtimestamp(t / 1000).strftime("%Y-%m")


def summarize(trips_by_book, books, cap):
    out = {"IS": 0.0, "OOS1": 0.0, "OOS2": 0.0}
    cnt = {"IS": 0, "OOS1": 0, "OOS2": 0}
    months = {}
    open_n = 0
    stops = 0
    for b in books:
        for t in trips_by_book.get(b, []):
            if t.get("open"):
                open_n += 1
                continue
            out[t["win"]] += t["pnl"]
            cnt[t["win"]] += 1
            if t["kind"] == "stop" and t["win"] != "IS":
                stops += 1
            if t["win"] != "IS":
                m = month_of(t["t"])
                months[m] = months.get(m, 0.0) + t["pnl"]
    oos = out["OOS1"] + out["OOS2"]
    oos_days = (T_END - OOS1[0]) / 86400000
    best = max(months.values()) if months else 0.0
    return {"pnl": {k: round(v, 4) for k, v in out.items()}, "trips": cnt, "oos_pnl": round(oos, 4), "oos_trips": cnt["OOS1"] + cnt["OOS2"],
            "oos_stops": stops, "open_at_end": open_n, "oos_months": {k: round(v, 4) for k, v in sorted(months.items())},
            "best_month_share": round(best / oos, 4) if oos > 0 else None, "oos_without_best_month": round(oos - best, 4),
            "ann_return_on_locked": round(oos / cap * 365 / oos_days, 6), "oos_days": round(oos_days, 3)}


def main():
    spreads = json.load(open(os.path.join(S, "data", "zf_spreads.json")))
    eur = load_eur()
    arms = {"primary": {"through": 1, "stop_extra": 0, "cap": "beyond", "fee": 0.0},
            "stress_intended": {"through": 2, "stop_extra": 1, "cap": "beyond", "fee": 0.0},
            "stress_literal": {"through": 1, "stop_extra": 1, "cap": "beyond", "fee": 0.0},
            "capacity": {"through": 1, "stop_extra": 0, "cap": "ten", "fee": 0.0},
            "fee10bps": {"through": 1, "stop_extra": 0, "cap": "beyond", "fee": 0.001}}
    res = {"test": "ZF", "prereg_sha256": open(os.path.join(S, "prereg_zero_fee_quotes.sha256")).read().strip(), "arms": {}}
    state = {}
    trips_all = {a: {} for a in arms}
    per_book = {}
    for b in sorted(BOOKS):
        if not os.path.exists(os.path.join(S, "data", "aggtrades", f"{b}_min.json")):
            res.setdefault("missing_books", []).append(b)
            continue
        B = build_book(b, eur, spreads)
        for a, arm in arms.items():
            trips, tables = simulate(B, arm)
            trips_all[a][b] = trips
            if a == "primary":
                state[b] = (B, tables)
        # per-book / rung / side / window table (primary)
        tb = {}
        for t in trips_all["primary"][b]:
            if t.get("open"):
                continue
            k = f"{t['win']}|{t['side']}|{t['d']}"
            e = tb.setdefault(k, {"trips": 0, "pnl": 0.0, "stops": 0})
            e["trips"] += 1
            e["pnl"] += t["pnl"]
            e["stops"] += t["kind"] == "stop"
        per_book[b] = {k: {"trips": v["trips"], "pnl": round(v["pnl"], 4), "stops": v["stops"]} for k, v in sorted(tb.items())}
        per_book[b]["_meta"] = {"minutes": B["n"], "minutes_with_prints": sum(1 for x in B["last"] if x is not None),
                                "half_spread_bps": round(B["half"] * 1e4, 3), "first_minute": month_of(B["ts"][0])}
        del B["levels"]  # free memory
    res["per_book_primary"] = per_book
    fams = {"all": [b for b in PRIMARY], "E": [b for b in PRIMARY if BOOKS[b][0] == "E"], "U": [b for b in PRIMARY if BOOKS[b][0] == "U"]}
    for a in arms:
        res["arms"][a] = {f: summarize(trips_all[a], bl, CAP[f]) for f, bl in fams.items()}
        res["arms"][a]["secondary_X"] = summarize(trips_all[a], ["USDTUSD", "USDCUSD"], 1200.0)
    # null for the primary family 'all' and for each family
    prim = {b: trips_all["primary"][b] for b in PRIMARY if b in trips_all["primary"]}
    nulls = {}
    for f, bl in fams.items():
        st = {b: state[b] for b in bl if b in state}
        nt = null_draws(st, {b: prim[b] for b in bl if b in prim}, NULL_DRAWS)
        nulls[f] = {"draws": len(nt), "mean": round(sum(nt) / len(nt), 4) if nt else None, "p95": round(nt[int(0.95 * len(nt))], 4) if nt else None,
                    "p50": round(nt[len(nt) // 2], 4) if nt else None}
    res["null"] = nulls
    # the bar
    bars = {}
    for f in ("all", "E", "U"):
        p = res["arms"]["primary"][f]
        st_i = res["arms"]["stress_intended"][f]
        st_l = res["arms"]["stress_literal"][f]
        c1 = p["oos_pnl"] > 0 and p["pnl"]["OOS1"] > 0 and p["pnl"]["OOS2"] > 0
        c2 = nulls[f]["p95"] is not None and p["oos_pnl"] > nulls[f]["p95"]
        c3 = st_i["oos_pnl"] > 0
        c3l = st_l["oos_pnl"] > 0
        c4 = p["oos_trips"] >= 200
        c5 = p["best_month_share"] is not None and p["best_month_share"] <= 0.40 and p["oos_without_best_month"] > 0
        c6 = p["ann_return_on_locked"] > 0.04
        bars[f] = {"1_oos_positive_each": c1, "2_beats_null_p95": c2, "3_stress_intended": c3, "3b_stress_literal": c3l,
                   "4_min_200_trips": c4, "5_not_one_month": c5, "6_beats_cash": c6, "PASS": all([c1, c2, c3, c4, c5, c6])}
    res["bar"] = bars
    # a sample of trips for hand checks (first 15 OOS primary trips of each book, deterministic)
    sample = {}
    for b in sorted(prim):
        s = [t for t in prim[b] if not t.get("open") and t["win"] != "IS"][:15]
        sample[b] = [{k: (round(v, 8) if isinstance(v, float) else v) for k, v in t.items()} for t in s]
    res["sample_trips"] = sample
    json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
    print(json.dumps({"bar": bars, "primary_all": res["arms"]["primary"]["all"]["pnl"], "null": nulls}, indent=0))


if __name__ == "__main__":
    main()
