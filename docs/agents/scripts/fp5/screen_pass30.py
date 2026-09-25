"""Eight frozen Revolut X screens. Eight new mechanisms, open to the next open.

Reads the eight rule texts hashed at 2026-09-25 06:43:51 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass30.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
The LINK quote-volume screen is not rerun, and its null is not loosened.
The DOGE 1% open gap is not rerun, and its threshold is not lowered.
The ETH two-up streak is not rerun, and its cost and month gate are not changed.
None of these rules is a trailing top quintile of a coin's own change.

    python3 docs/agents/scripts/fp5/screen_pass30.py
    python3 docs/agents/scripts/fp5/screen_pass30.py --check
"""
import hashlib, json, os, random, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass30")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass30.json")
SHA = {
    "btcsma": "9e9ad67962a81062435ba9762efbcfe6a1538736b2fd8e651b523a4b9daf0090",
    "ethbounce": "144c3c8b77683f2cfbae6524cc6a7b3b835a4af5922e0f64743e7e1a6c6cc275",
    "dogemean": "2d69057026683f8cc839c01f80f7db6fffaabf9a431c121faa891498fad23c8e",
    "xrpcheap": "690cd52d81aaf29568ef46f5c1f2f0d115f99366e88da64ad4d6b4b27d9232f5",
    "bnbspring": "8c884223f196d840b7217d93440661c25471faf3392bd2d4160e7c3da1a4999f",
    "dotlift": "e79803075689864a3267653c6edcd504f94bb46516ecd5f0f855a592f97a2af2",
    "btcpersist": "3bb37966cc67dcabcd05735d40d80d0442d270972bafd842f0fb528b36b94b20",
    "maticthrust": "7ad7957ff2480db620a081a677f00dd7b38f3d48fb0d671da39f4d42c31225b2",
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    found = {}
    for name, digest in SHA.items():
        have = sha256_file(os.path.join(RULES, name + "_rule.txt"))
        if have != digest:
            raise SystemExit("rule text moved after the freeze: %s %s" % (name, have))
        found[name] = have
    return found


def stamp_of(ts):
    ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
    return datetime.fromtimestamp(ts, timezone.utc)


def shift(day, n):
    return p5.ymd(p5.parse_ymd(day) + timedelta(days=n))


def iter_kline_rows(folder):
    if not os.path.isdir(folder):
        raise SystemExit("missing klines %s" % folder)
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            yield line.split(",")


def load_field(folder, index, need):
    values = {}
    for parts in iter_kline_rows(folder):
        if len(parts) < need:
            raise SystemExit("kline gap: field %d absent (%d fields)" % (need, len(parts)))
        day = p5.ymd(stamp_of(int(parts[0])))
        if day in values:
            raise SystemExit("duplicate day %s" % day)
        values[day] = float(parts[index])
    return values


def open_returns(opens, start, end):
    out = {}
    for day in p5.daterange(start, end):
        nxt = shift(day, 1)
        entry = opens.get(day)
        exit_px = opens.get(nxt)
        if entry is not None and exit_px is not None and entry > 0 and exit_px > 0:
            out[day] = (exit_px / entry - 1.0) * 10000.0
    return out


def score_open(entry_days, btc, eth, cost):
    """Each entry is its own trip: charge entry and exit, do not carry."""
    btc_pnl = 0.0
    eth_pnl = 0.0
    months = {}
    for day in entry_days:
        charge = cost + cost
        btc_pnl += btc[day] - charge
        eth_pnl += eth[day] - charge
        gross = (btc[day] + eth[day]) / 2.0
        month = day[:7]
        months[month] = months.get(month, 0.0) + gross - charge
    n = len(entry_days)
    return {
        "pool": (btc_pnl + eth_pnl) / 2.0,
        "btc": btc_pnl,
        "eth": eth_pnl,
        "trips": n,
        "long_days": n,
        "months": months,
    }


def hand_sum(entry_days, btc_opens, eth_opens):
    """Recompute the pool from raw opens. Does not call score_open."""
    pool = 0.0
    for day in entry_days:
        nxt = shift(day, 1)
        btc_bps = (btc_opens[nxt] / btc_opens[day] - 1.0) * 10000.0 - 40.0
        eth_bps = (eth_opens[nxt] / eth_opens[day] - 1.0) * 10000.0 - 40.0
        pool += (btc_bps + eth_bps) / 2.0
    return pool, len(entry_days)


def null_open(eligible, n_trips, btc, eth, cost):
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    rng = random.Random(20260925)
    pools = []
    for _ in range(500):
        chosen = rng.sample(eligible, n_trips)
        pools.append(score_open(chosen, btc, eth, cost)["pool"])
    pools.sort()
    p95 = pools[int(0.95 * len(pools)) - 1]
    p50 = (pools[249] + pools[250]) / 2.0
    return p50, p95


def window_values(levels, day, start_back, end_back):
    prior = []
    for k in range(start_back, end_back + 1):
        px = levels.get(shift(day, -k))
        if px is None:
            return None
        prior.append(px)
    return prior


def sma_cross(closes, window):
    out = set()
    for day, close in closes.items():
        today = window_values(closes, day, 0, window - 1)
        yesterday = window_values(closes, day, 1, window)
        if today is None or yesterday is None:
            continue
        if any(px <= 0 for px in today) or any(px <= 0 for px in yesterday):
            continue
        yclose = yesterday[0]
        if close > sum(today) / window and yclose <= sum(yesterday) / window:
            out.add(day)
    return out


def bounce_signals(closes, short, long):
    out = set()
    for day, close in closes.items():
        near = closes.get(shift(day, -short))
        far = closes.get(shift(day, -long))
        if close > 0 and near is not None and far is not None and near > 0 and far > 0:
            if close / near - 1.0 > 0 and close / far - 1.0 < 0:
                out.add(day)
    return out


def mean_multiple(quote, window, multiple):
    out = set()
    for day, vol in quote.items():
        prior = window_values(quote, day, 1, window)
        if vol <= 0 or prior is None or any(px <= 0 for px in prior):
            continue
        if vol > multiple * (sum(prior) / window):
            out.add(day)
    return out


def basis_map(perp, spot):
    out = {}
    for day, pc in perp.items():
        sc = spot.get(day)
        if pc > 0 and sc is not None and sc > 0:
            out[day] = pc / sc - 1.0
    return out


def below_mean(levels, window):
    out = set()
    for day, level in levels.items():
        prior = window_values(levels, day, 1, window)
        if prior is None:
            continue
        if level < sum(prior) / window:
            out.add(day)
    return out


def spring_signals(lows, closes):
    out = set()
    for day, low in lows.items():
        close = closes.get(day)
        prev = shift(day, -1)
        pl, pc = lows.get(prev), closes.get(prev)
        if None in (close, pl, pc):
            continue
        if low > 0 and close > 0 and pl > 0 and pc > 0 and low < pl and close > pc:
            out.add(day)
    return out


def lift_signals(highs, lows):
    out = set()
    for day, high in highs.items():
        low = lows.get(day)
        prev = shift(day, -1)
        ph, pl = highs.get(prev), lows.get(prev)
        if None in (low, ph, pl):
            continue
        if high > 0 and low > 0 and ph > 0 and pl > 0 and high > ph and low > pl:
            out.add(day)
    return out


def persist_signals(closes, ups, span):
    out = set()
    for day in closes:
        count = 0
        ok = True
        for k in range(span):
            left = closes.get(shift(day, -k))
            right = closes.get(shift(day, -k - 1))
            if left is None or right is None or left <= 0 or right <= 0:
                ok = False
                break
            if left > right:
                count += 1
        if ok and count >= ups:
            out.add(day)
    return out


def thrust_signals(opens, closes):
    """close/open - 1 > 0.05 in exact arithmetic: close * 20 > open * 21."""
    out = set()
    for day, close in closes.items():
        opened = opens.get(day)
        if close > 0 and opened is not None and opened > 0 and close * 20.0 > opened * 21.0:
            out.add(day)
    return out


def marked_for(signals, start, end):
    return [(day, shift(day, -1) in signals) for day in p5.daterange(start, end)]


def kline_jobs():
    jobs = []
    spans = {
        ("spot", "BTCUSDT"): ("2017-08", "2022-01"),
        ("spot", "ETHUSDT"): ("2017-08", "2022-01"),
        ("spot", "DOGEUSDT"): ("2019-07", "2021-12"),
        ("spot", "XRPUSDT"): ("2020-01", "2021-12"),
        ("spot", "BNBUSDT"): ("2017-11", "2019-12"),
        ("spot", "DOTUSDT"): ("2020-08", "2021-12"),
        ("spot", "MATICUSDT"): ("2019-04", "2020-12"),
    }
    for (market, sym), (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "%s/monthly/klines/%s/1d/%s" % (market, sym, name)
            jobs.append((url, os.path.join(INP, "klines", market, sym, "1d", name)))
    for ym in p5.months("2020-01", "2021-12"):
        name = "XRPUSDT-1d-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/klines/XRPUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "um", "XRPUSDT", "1d", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), kline_jobs()))
    print("pass30 inputs ready", flush=True)


def run_open(name, marked, btc, eth, floor):
    eligible, entries = [], []
    dropped = 0
    for day, take in marked:
        if day not in btc or day not in eth:
            if take:
                dropped += 1
            continue
        eligible.append(day)
        if take:
            entries.append(day)
    if not entries:
        raise SystemExit("no entries for %s" % name)
    base = score_open(entries, btc, eth, 20.0)
    stress = score_open(entries, btc, eth, 40.0)
    base["stress"] = stress["pool"]
    if abs((base["pool"] - base["stress"]) - 40.0 * base["trips"]) > 1e-6:
        raise SystemExit("cost gap %s" % name)
    p50, p95 = null_open(eligible, base["trips"], btc, eth, 20.0)
    reasons = []
    share, month, month_pnl = p5.month_share(base)
    if not base["pool"] > 0:
        reasons.append("pooled P&L is not positive")
    if not base["stress"] > 0:
        reasons.append("doubled cost is not positive")
    if base["trips"] < 60:
        reasons.append("fewer than 60 round trips")
    if not (base["btc"] > 0 and base["eth"] > 0):
        reasons.append("one book is not positive")
    if not base["pool"] > p95:
        reasons.append("does not beat the random-day null")
    if share is not None and share > 0.40:
        reasons.append("one month is more than 40% of P&L")
    if not base["pool"] > floor:
        reasons.append("pooled P&L does not exceed %d bps" % floor)
    return {
        "name": name,
        "fill": "open_to_next_open",
        "pool_bps": round(base["pool"], 1),
        "stress_bps": round(base["stress"], 1),
        "trips": base["trips"],
        "long_days": base["long_days"],
        "execution_days": len(eligible),
        "signals_without_open": dropped,
        "btc_bps": round(base["btc"], 1),
        "eth_bps": round(base["eth"], 1),
        "null_p50_bps": round(p50, 1),
        "null_p95_bps": round(p95, 1),
        "month_share": None if share is None else round(share, 3),
        "top_month": month,
        "top_month_bps": None if month_pnl is None else round(month_pnl, 1),
        "candle_bar_clear": len(reasons) == 0,
        "why": "; ".join(reasons) if reasons else "open-to-open numeric bar is clear",
        "_entries": entries,
        "_pool": base["pool"],
    }


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    btc_o = {"2020-01-01": 100.0, "2020-01-02": 110.0, "2020-01-03": 121.0}
    eth_o = {"2020-01-01": 10.0, "2020-01-02": 11.0, "2020-01-03": 9.0}
    btc_r = open_returns(btc_o, "2020-01-01", "2020-01-02")
    eth_r = open_returns(eth_o, "2020-01-01", "2020-01-02")
    one = score_open(["2020-01-01"], btc_r, eth_r, 20.0)
    if one["trips"] != 1 or abs(one["pool"] - 960.0) > 1e-9:
        raise SystemExit("one open trip")
    eth_day2 = (9.0 / 11.0 - 1.0) * 10000.0
    two = score_open(["2020-01-01", "2020-01-02"], btc_r, eth_r, 20.0)
    eth_hand = (1000.0 - 40.0) + (eth_day2 - 40.0)
    if two["trips"] != 2 or abs(two["btc"] - 1920.0) > 1e-6 or abs(two["eth"] - eth_hand) > 1e-6:
        raise SystemExit("two open trips are not two charges")
    stress = score_open(["2020-01-01", "2020-01-02"], btc_r, eth_r, 40.0)
    if abs((two["pool"] - stress["pool"]) - 80.0) > 1e-6:
        raise SystemExit("open stress gap")
    hand, n = hand_sum(["2020-01-01", "2020-01-02"], btc_o, eth_o)
    if n != 2 or abs(hand - two["pool"]) > 1e-6:
        raise SystemExit("hand sum")
    start = p5.parse_ymd("2020-01-01")
    flat = {p5.ymd(start + timedelta(days=i)): 100.0 for i in range(21)}
    last = p5.ymd(start + timedelta(days=20))
    if sma_cross(flat, 20):
        raise SystemExit("a tie is not an average cross")
    flat[last] = 101.0
    if sma_cross(flat, 20) != {last}:
        raise SystemExit("average cross")
    nxt = p5.ymd(start + timedelta(days=21))
    flat[nxt] = 102.0
    if sma_cross(flat, 20) != {last}:
        raise SystemExit("already above the average")
    bounce = {p5.ymd(start + timedelta(days=i)): 1.0 for i in range(21)}
    bounce[p5.ymd(start)] = 100.0
    bounce[p5.ymd(start + timedelta(days=15))] = 90.0
    bounce[last] = 95.0
    if bounce_signals(bounce, 5, 20) != {last}:
        raise SystemExit("bounce")
    bounce[last] = 90.0
    if bounce_signals(bounce, 5, 20):
        raise SystemExit("flat five-day bounce")
    bounce[last] = 110.0
    if bounce_signals(bounce, 5, 20):
        raise SystemExit("up twenty-day bounce")
    quote = {p5.ymd(start + timedelta(days=i)): 10.0 for i in range(21)}
    quote[last] = 20.0
    if mean_multiple(quote, 20, 2.0):
        raise SystemExit("volume mean tie")
    quote[last] = 21.0
    if mean_multiple(quote, 20, 2.0) != {last}:
        raise SystemExit("volume mean")
    levels = {p5.ymd(start + timedelta(days=i)): 0.01 for i in range(21)}
    levels[last] = 0.01
    if below_mean(levels, 20):
        raise SystemExit("basis mean tie")
    levels[last] = 0.009
    if below_mean(levels, 20) != {last}:
        raise SystemExit("basis below mean")
    prev, day = "2020-01-01", "2020-01-02"
    if spring_signals({prev: 5.0, day: 4.0}, {prev: 10.0, day: 11.0}) != {day}:
        raise SystemExit("spring")
    if spring_signals({prev: 5.0, day: 5.0}, {prev: 10.0, day: 11.0}):
        raise SystemExit("spring low tie")
    if spring_signals({prev: 5.0, day: 4.0}, {prev: 10.0, day: 10.0}):
        raise SystemExit("spring close tie")
    if lift_signals({prev: 10.0, day: 11.0}, {prev: 5.0, day: 6.0}) != {day}:
        raise SystemExit("lift")
    if lift_signals({prev: 10.0, day: 10.0}, {prev: 5.0, day: 6.0}):
        raise SystemExit("lift high tie")
    if lift_signals({prev: 10.0, day: 11.0}, {prev: 5.0, day: 5.0}):
        raise SystemExit("lift low tie")
    persist = {}
    for i in range(15):
        persist[p5.ymd(start + timedelta(days=i))] = float(i + 1 if i < 10 else 10)
    end = p5.ymd(start + timedelta(days=14))
    if persist_signals(persist, 10, 14):
        raise SystemExit("nine up days")
    persist[end] = 11.0
    if persist_signals(persist, 10, 14) != {end}:
        raise SystemExit("ten up days")
    if thrust_signals({day: 100.0}, {day: 105.0}):
        raise SystemExit("five percent tie")
    if thrust_signals({day: 100.0}, {day: 106.0}) != {day}:
        raise SystemExit("thrust")
    if thrust_signals({day: 100.0}, {day: 104.0}):
        raise SystemExit("thrust below")


def require_span(name, levels, first, last, saturday):
    if not levels or min(levels) != first:
        raise SystemExit("%s start %s" % (name, min(levels) if levels else None))
    if last not in levels:
        raise SystemExit("%s missing %s" % (name, last))
    if saturday not in levels:
        raise SystemExit("%s dropped %s" % (name, saturday))


def btc_open_text(opens, day):
    nxt = shift(day, 1)
    entry, exit_px = opens[day], opens[nxt]
    return entry, exit_px, (exit_px / entry - 1.0) * 10000.0


def describe(name, signal, btc_opens, series):
    entry, exit_px, move = btc_open_text(btc_opens, shift(signal, 1))
    if name == "btc_sma_2018":
        today = window_values(series["btc_close"], signal, 0, 19)
        yesterday = window_values(series["btc_close"], signal, 1, 20)
        detail = "close %.2f vs sma %.4f, prior close %.2f vs prior sma %.4f" % (
            series["btc_close"][signal], sum(today) / 20.0, yesterday[0], sum(yesterday) / 20.0)
    elif name == "eth_bounce_2018":
        close = series["eth_close"][signal]
        near = series["eth_close"][shift(signal, -5)]
        far = series["eth_close"][shift(signal, -20)]
        detail = "close %.2f vs 5d %.2f (%+.4f%%) vs 20d %.2f (%+.4f%%)" % (
            close, near, (close / near - 1.0) * 100.0, far, (close / far - 1.0) * 100.0)
    elif name == "doge_mean_2021":
        prior = window_values(series["doge_q"], signal, 1, 20)
        mean = sum(prior) / 20.0
        vol = series["doge_q"][signal]
        detail = "quote %.6f vs mean %.6f, ratio %.4f" % (vol, mean, vol / mean)
    elif name == "xrp_basis_mean_2021":
        prior = window_values(series["xrp_basis"], signal, 1, 20)
        mean = sum(prior) / 20.0
        level = series["xrp_basis"][signal]
        detail = "basis %+.8f vs mean %+.8f" % (level, mean)
    elif name == "bnb_spring_2019":
        prev = shift(signal, -1)
        detail = "low %.4f vs %.4f, close %.4f vs %.4f" % (
            series["bnb_low"][signal], series["bnb_low"][prev],
            series["bnb_close"][signal], series["bnb_close"][prev])
    elif name == "dot_lift_2021":
        prev = shift(signal, -1)
        detail = "high %.4f vs %.4f, low %.4f vs %.4f" % (
            series["dot_high"][signal], series["dot_high"][prev],
            series["dot_low"][signal], series["dot_low"][prev])
    elif name == "btc_persist_2018":
        count = 0
        for k in range(14):
            if series["btc_close"][shift(signal, -k)] > series["btc_close"][shift(signal, -k - 1)]:
                count += 1
        detail = "up changes %d of 14" % count
    elif name == "matic_thrust_2020":
        opened = series["matic_o"][signal]
        close = series["matic_c"][signal]
        detail = "open %.6f close %.6f, %+.4f%%" % (opened, close, (close / opened - 1.0) * 100.0)
    else:
        raise SystemExit("no description for %s" % name)
    print("FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f" % (
        name, signal, shift(signal, 1), detail, entry, exit_px, move), flush=True)


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    spot = os.path.join(INP, "klines", "spot")
    btc_opens = load_field(os.path.join(spot, "BTCUSDT", "1d"), 1, 2)
    eth_opens = load_field(os.path.join(spot, "ETHUSDT", "1d"), 1, 2)
    btc_close = load_field(os.path.join(spot, "BTCUSDT", "1d"), 4, 5)
    eth_close = load_field(os.path.join(spot, "ETHUSDT", "1d"), 4, 5)
    for day in ("2018-01-01", "2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    require_span("btc", btc_close, "2017-08-17", "2018-12-31", "2018-01-06")
    require_span("eth", eth_close, "2017-08-17", "2018-12-31", "2018-01-06")
    doge_q = load_field(os.path.join(spot, "DOGEUSDT", "1d"), 7, 8)
    xrp_spot = load_field(os.path.join(spot, "XRPUSDT", "1d"), 4, 5)
    xrp_perp = load_field(os.path.join(INP, "klines", "um", "XRPUSDT", "1d"), 4, 5)
    bnb_low = load_field(os.path.join(spot, "BNBUSDT", "1d"), 3, 4)
    bnb_close = load_field(os.path.join(spot, "BNBUSDT", "1d"), 4, 5)
    dot_high = load_field(os.path.join(spot, "DOTUSDT", "1d"), 2, 3)
    dot_low = load_field(os.path.join(spot, "DOTUSDT", "1d"), 3, 4)
    matic_o = load_field(os.path.join(spot, "MATICUSDT", "1d"), 1, 2)
    matic_c = load_field(os.path.join(spot, "MATICUSDT", "1d"), 4, 5)
    require_span("dogeq", doge_q, "2019-07-05", "2021-12-31", "2021-01-02")
    require_span("xrpspot", xrp_spot, "2020-01-01", "2021-12-31", "2021-01-02")
    require_span("xrpperp", xrp_perp, "2020-01-06", "2021-12-31", "2021-01-02")
    require_span("bnb", bnb_close, "2017-11-06", "2019-12-31", "2019-01-05")
    require_span("bnblow", bnb_low, "2017-11-06", "2019-12-31", "2019-01-05")
    require_span("dothigh", dot_high, "2020-08-18", "2021-12-31", "2021-01-02")
    require_span("dotlow", dot_low, "2020-08-18", "2021-12-31", "2021-01-02")
    require_span("matic", matic_c, "2019-04-26", "2020-12-31", "2020-01-04")
    xrp_basis = basis_map(xrp_perp, xrp_spot)
    require_span("xrpbasis", xrp_basis, "2020-01-06", "2021-12-31", "2021-01-02")
    btc_ret = open_returns(btc_opens, "2018-01-01", "2021-12-31")
    eth_ret = open_returns(eth_opens, "2018-01-01", "2021-12-31")
    for day in ("2018-12-31", "2019-12-31", "2020-12-31", "2021-12-31"):
        if day not in btc_ret or day not in eth_ret:
            raise SystemExit("%s has no next open" % day)
    series = {
        "btc_close": btc_close,
        "eth_close": eth_close,
        "doge_q": doge_q,
        "xrp_basis": xrp_basis,
        "bnb_low": bnb_low,
        "bnb_close": bnb_close,
        "dot_high": dot_high,
        "dot_low": dot_low,
        "matic_o": matic_o,
        "matic_c": matic_c,
    }
    specs = (
        ("btc_sma_2018", sma_cross(btc_close, 20), "2018-01-01", "2018-12-31"),
        ("eth_bounce_2018", bounce_signals(eth_close, 5, 20), "2018-01-01", "2018-12-31"),
        ("doge_mean_2021", mean_multiple(doge_q, 20, 2.0), "2021-01-01", "2021-12-31"),
        ("xrp_basis_mean_2021", below_mean(xrp_basis, 20), "2021-01-01", "2021-12-31"),
        ("bnb_spring_2019", spring_signals(bnb_low, bnb_close), "2019-01-01", "2019-12-31"),
        ("dot_lift_2021", lift_signals(dot_high, dot_low), "2021-01-01", "2021-12-31"),
        ("btc_persist_2018", persist_signals(btc_close, 10, 14), "2018-01-01", "2018-12-31"),
        ("matic_thrust_2020", thrust_signals(matic_o, matic_c), "2020-01-01", "2020-12-31"),
    )
    kills = {}
    for name, signals, start, end in specs:
        marked = marked_for(signals, start, end)
        row = run_open(name, marked, btc_ret, eth_ret, 400)
        entries = row.pop("_entries")
        raw_pool = row.pop("_pool")
        hand, n = hand_sum(entries, btc_opens, eth_opens)
        if n != row["trips"] or abs(hand - raw_pool) > 0.1 or abs(hand - row["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s %s %s %s" % (name, hand, raw_pool, row["pool_bps"]))
        kills[name] = row
        exec_day = entries[0]
        describe(name, shift(exec_day, -1), btc_opens, series)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed before its own result. "
            "Every fill is the execution-day open to the next open. "
            "None of these is a trailing top quintile of a coin's own change. "
            "The OKX basis is not in this run. "
            "The LINK quote-volume screen is not rerun and its null is not loosened. "
            "The DOGE 1% open gap is not rerun and its threshold is not lowered. "
            "The ETH two-up streak is not rerun and its cost and month gate are not changed. "
            "A numeric clear is the open-to-open arithmetic and is not adjusted for the venue."
        ),
        "rules": {name + "_rule_sha256": digest for name, digest in found.items()},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass30.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
