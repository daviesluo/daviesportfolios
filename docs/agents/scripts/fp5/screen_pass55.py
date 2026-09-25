"""Eight frozen Revolut X screens. Fifteen-minute path facts, open to open.

Reads the eight rule texts hashed at 2026-09-25 11:29:49 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass55.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
Which bar is the widest, which bar has the largest volume, and how long a wick
is are not rerun. May is not dropped and 40% is not loosened. A volume-weighted
mean against an equal-weighted mean is not rerun. The four rules that fired on
every complete fifteen-minute day are not signals. The fifteen-minute up-bar
count, the run length, and the new-high count are not rerun. The difference of
6 is not changed. The weighted-price family is not rerun. The ETH buy-below-open
screen is not a pass. The LTC weighted price below the midpoint is not a pass.
The coin-margined three-day trade-count rise is not a pass. No testing row is
opened.

    python3 docs/agents/scripts/fp5/screen_pass55.py
    python3 docs/agents/scripts/fp5/screen_pass55.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass55")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass55.json")
FROZEN = "2026-09-25 11:29:49 UTC"
SHA = {
    "btcskew": "1bc936d835e63951afda5b2bfcc643edbe72a86ed5c6e8cc3088bf0f8aaf5c2d",
    "ethrngs": "0b77f396901f5e2bca05e259c240936a0a1de8ecdfc00254f56e6cdabb9d7579",
    "bnbcspn": "4c3b4259c11e3d845cc30384cb8798069d5758d38d17ff2a3613e7d1940204d1",
    "ltcbody": "00f097b1e7ed02009491f80fc2ac2b4d2895bff13e8ed90f32e5d31721eb0f7c",
    "xrpcov": "ebfeae1b219603f7e65718978fe15ce70f0c21c49b37523cdbf46644bda44338",
    "linkpk": "21c7e33681d5d43096edecf80bd194624d62cffe4d4c2bc4e9dda50a7324809b",
    "adastp": "76703e3cd6681e8fa1b5ff0ff690cafef13a6e165a9865fcad6cd50325ac1953",
    "dotminud": "14b287d6142eb42d40bd4e8a1872113f0ba0fc802638b82409b9c4478a9c2251",
}
ORDER = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
GAP = ("2021-02-11", "2021-03-06", "2021-04-20", "2021-04-25", "2021-08-13", "2021-09-29")
COUNTED = {
    "btc_close_mean_above_median_2021": 174,
    "eth_up_range_above_down_2021": 181,
    "bnb_close_span_above_open_2021": 151,
    "ltc_close_sum_above_open_2021": 193,
    "xrp_change_product_positive_2021": 150,
    "link_peaks_above_troughs_2021": 91,
    "ada_net_above_max_change_2021": 243,
    "dot_min_up_above_min_down_2021": 145,
}
COIN = {
    "btc_close_mean_above_median_2021": "BTCUSDT",
    "eth_up_range_above_down_2021": "ETHUSDT",
    "bnb_close_span_above_open_2021": "BNBUSDT",
    "ltc_close_sum_above_open_2021": "LTCUSDT",
    "xrp_change_product_positive_2021": "XRPUSDT",
    "link_peaks_above_troughs_2021": "LINKUSDT",
    "ada_net_above_max_change_2021": "ADAUSDT",
    "dot_min_up_above_min_down_2021": "DOTUSDT",
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
        path = os.path.join(RULES, name + "_rule.txt")
        have = sha256_file(path)
        if have != digest:
            raise SystemExit("rule text moved after the freeze: %s %s" % (name, have))
        stamp = open(os.path.join(RULES, name + "_rule.frozen_at")).read().strip()
        if stamp != FROZEN:
            raise SystemExit("freeze stamp moved: %s" % name)
        found[name] = have
    return found


def load_bars(folder):
    got = {}
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 8:
            raise SystemExit("bar field gap in %s" % folder)
        ts = p30.stamp_of(int(parts[0]))
        if ts.second != 0 or ts.microsecond != 0 or ts.minute not in (0, 15, 30, 45):
            raise SystemExit("off-grid bar in %s" % folder)
        day = p5.ymd(ts)
        slot = ts.hour * 4 + ts.minute // 15
        o, h, l, c = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
        quote = float(parts[7])
        if not (o > 0 and h > 0 and l > 0 and c > 0):
            raise SystemExit("nonpositive bar %s %s" % (folder, day))
        if h < l or h < max(o, c) or l > min(o, c):
            raise SystemExit("bar order %s %s" % (folder, day))
        if quote < 0:
            raise SystemExit("negative quote %s %s" % (folder, day))
        key = (day, slot)
        if key in got:
            raise SystemExit("duplicate slot %s %s %s" % (folder, day, slot))
        got[key] = (o, h, l, c, quote)
    by_day = {}
    for (day, slot), bar in got.items():
        by_day.setdefault(day, {})[slot] = bar
    days = {}
    for day, slots in by_day.items():
        if len(slots) == 96 and all(i in slots for i in range(96)):
            days[day] = [slots[i] for i in range(96)]
    return days


def changes_of(rows):
    return [rows[i][3] - rows[i - 1][3] for i in range(1, len(rows))]


def median_even(values):
    if len(values) % 2 != 0:
        raise SystemExit("median count")
    ordered = sorted(values)
    mid = len(ordered) // 2
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def btc_skew(rows):
    closes = [row[3] for row in rows]
    mean = sum(closes) / float(len(closes))
    return mean > median_even(closes)


def eth_ranges(rows):
    up = sum(row[1] - row[2] for row in rows if row[3] > row[0])
    down = sum(row[1] - row[2] for row in rows if row[3] < row[0])
    return up > down


def bnb_span(rows):
    close_span = max(row[3] for row in rows) - min(row[3] for row in rows)
    open_span = max(row[0] for row in rows) - min(row[0] for row in rows)
    return close_span > open_span


def ltc_body(rows):
    return sum(row[3] for row in rows) > sum(row[0] for row in rows)


def xrp_cov(rows):
    changes = changes_of(rows)
    product = sum(changes[i] * changes[i - 1] for i in range(1, len(changes)))
    return product > 0


def link_peaks(rows):
    closes = [row[3] for row in rows]
    peaks = 0
    troughs = 0
    for i in range(1, len(closes) - 1):
        if closes[i] > closes[i - 1] and closes[i] > closes[i + 1]:
            peaks += 1
        elif closes[i] < closes[i - 1] and closes[i] < closes[i + 1]:
            troughs += 1
    return peaks > troughs


def ada_step(rows):
    changes = changes_of(rows)
    net = abs(rows[-1][3] - rows[0][0])
    return net > max(abs(change) for change in changes)


def dot_min(rows):
    changes = changes_of(rows)
    positive = [change for change in changes if change > 0]
    negative = [-change for change in changes if change < 0]
    if not positive or not negative:
        return False
    return min(positive) > min(negative)


PREDICATES = {
    "btc_close_mean_above_median_2021": btc_skew,
    "eth_up_range_above_down_2021": eth_ranges,
    "bnb_close_span_above_open_2021": bnb_span,
    "ltc_close_sum_above_open_2021": ltc_body,
    "xrp_change_product_positive_2021": xrp_cov,
    "link_peaks_above_troughs_2021": link_peaks,
    "ada_net_above_max_change_2021": ada_step,
    "dot_min_up_above_min_down_2021": dot_min,
}


def signals_for(name, books):
    pred = PREDICATES.get(name)
    coin = COIN.get(name)
    if pred is None or coin is None:
        raise SystemExit("unknown rule %s" % name)
    out = set()
    for day in p5.daterange("2020-12-31", "2021-12-30"):
        rows = books[coin].get(day)
        if rows is None:
            continue
        if pred(rows):
            out.add(day)
    return out


def bar(open_px, high, low, close, quote=1.0):
    return (open_px, high, low, close, quote)


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    # Closes 1, 1, 1, 10. Mean 3.25, median 1.
    right = [bar(1.0, 1.0, 1.0, 1.0), bar(1.0, 1.0, 1.0, 1.0), bar(1.0, 1.0, 1.0, 1.0), bar(1.0, 10.0, 1.0, 10.0)]
    # Closes 1, 10, 10, 10. Mean 7.75, median 10.
    left = [bar(1.0, 1.0, 1.0, 1.0), bar(10.0, 10.0, 10.0, 10.0), bar(10.0, 10.0, 10.0, 10.0), bar(10.0, 10.0, 10.0, 10.0)]
    flat = [bar(1.0, 1.0, 1.0, 1.0), bar(1.0, 1.0, 1.0, 1.0), bar(1.0, 1.0, 1.0, 1.0), bar(1.0, 1.0, 1.0, 1.0)]
    if not btc_skew(right) or btc_skew(left) or btc_skew(flat):
        raise SystemExit("btc skew")
    up_wide = bar(10.0, 15.0, 10.0, 14.0)
    down_narrow = bar(10.0, 11.0, 10.0, 9.0)
    down_wide = bar(10.0, 15.0, 10.0, 9.0)
    up_narrow = bar(10.0, 11.0, 10.0, 11.0)
    if not eth_ranges([up_wide, down_narrow]) or eth_ranges([up_narrow, down_wide]) or eth_ranges([bar(10.0, 12.0, 10.0, 11.0), bar(12.0, 14.0, 12.0, 11.0)]):
        raise SystemExit("eth ranges")
    if not bnb_span([bar(10.0, 12.0, 9.0, 9.0), bar(11.0, 12.0, 9.0, 12.0)]) or bnb_span([bar(9.0, 14.0, 9.0, 10.0), bar(14.0, 14.0, 10.0, 11.0)]) or bnb_span([bar(10.0, 13.0, 10.0, 11.0), bar(12.0, 13.0, 11.0, 13.0)]):
        raise SystemExit("bnb span")
    if not ltc_body([bar(10.0, 13.0, 8.0, 13.0), bar(10.0, 10.0, 8.0, 8.0)]) or ltc_body([bar(10.0, 10.0, 8.0, 8.0), bar(10.0, 10.0, 8.0, 9.0)]) or ltc_body([bar(10.0, 12.0, 8.0, 12.0), bar(10.0, 10.0, 8.0, 8.0)]):
        raise SystemExit("ltc body")
    cov_up = [bar(10.0, 12.0, 10.0, 10.0), bar(10.0, 12.0, 10.0, 12.0), bar(12.0, 15.0, 12.0, 15.0)]
    cov_down = [bar(10.0, 12.0, 10.0, 10.0), bar(10.0, 12.0, 10.0, 12.0), bar(12.0, 12.0, 9.0, 9.0)]
    cov_zero = [bar(10.0, 12.0, 10.0, 10.0), bar(10.0, 12.0, 10.0, 12.0), bar(12.0, 12.0, 12.0, 12.0)]
    if not xrp_cov(cov_up) or xrp_cov(cov_down) or xrp_cov(cov_zero):
        raise SystemExit("xrp cov")
    peak = [bar(1.0, 3.0, 1.0, 1.0), bar(1.0, 3.0, 1.0, 3.0), bar(3.0, 3.0, 1.0, 1.0)]
    trough = [bar(3.0, 3.0, 1.0, 3.0), bar(3.0, 3.0, 1.0, 1.0), bar(1.0, 3.0, 1.0, 3.0)]
    tied_turns = [
        bar(1.0, 3.0, 1.0, 1.0), bar(1.0, 3.0, 1.0, 3.0), bar(3.0, 3.0, 1.0, 1.0),
        bar(1.0, 4.0, 1.0, 4.0), bar(4.0, 4.0, 0.0, 0.0), bar(0.0, 2.0, 0.0, 2.0),
    ]
    if not link_peaks(peak) or link_peaks(trough) or link_peaks(tied_turns):
        raise SystemExit("link peaks")
    stepped = [bar(10.0, 11.0, 10.0, 11.0), bar(11.0, 13.0, 11.0, 13.0), bar(13.0, 16.0, 13.0, 16.0)]
    spiked = [bar(10.0, 11.0, 10.0, 11.0), bar(11.0, 20.0, 11.0, 20.0), bar(20.0, 20.0, 12.0, 12.0)]
    matched = [bar(10.0, 10.0, 10.0, 10.0), bar(10.0, 12.0, 10.0, 12.0)]
    if not ada_step(stepped) or ada_step(spiked) or ada_step(matched):
        raise SystemExit("ada step")
    small_down = [bar(10.0, 14.0, 10.0, 10.0), bar(10.0, 14.0, 10.0, 14.0), bar(14.0, 19.0, 14.0, 19.0), bar(19.0, 19.0, 18.0, 18.0)]
    small_up = [bar(10.0, 11.0, 10.0, 10.0), bar(10.0, 11.0, 10.0, 11.0), bar(11.0, 15.0, 11.0, 15.0), bar(15.0, 15.0, 12.0, 12.0)]
    equal_step = [bar(10.0, 12.0, 10.0, 10.0), bar(10.0, 12.0, 10.0, 12.0), bar(12.0, 12.0, 10.0, 10.0)]
    one_side = [bar(10.0, 11.0, 10.0, 10.0), bar(10.0, 11.0, 10.0, 11.0), bar(11.0, 13.0, 11.0, 13.0)]
    if not dot_min(small_down) or dot_min(small_up) or dot_min(equal_step) or dot_min(one_side):
        raise SystemExit("dot min")


def input_jobs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2020-12", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for sym in ORDER:
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-15m-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/15m/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "15m", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass55 inputs ready", flush=True)


def detail_for(name, rows):
    if name == "btc_close_mean_above_median_2021":
        closes = [row[3] for row in rows]
        return "mean %.8f median %.8f" % (sum(closes) / float(len(closes)), median_even(closes))
    if name == "eth_up_range_above_down_2021":
        up = sum(row[1] - row[2] for row in rows if row[3] > row[0])
        down = sum(row[1] - row[2] for row in rows if row[3] < row[0])
        return "up %.8f down %.8f" % (up, down)
    if name == "bnb_close_span_above_open_2021":
        return "close-span %.8f open-span %.8f" % (
            max(row[3] for row in rows) - min(row[3] for row in rows),
            max(row[0] for row in rows) - min(row[0] for row in rows))
    if name == "ltc_close_sum_above_open_2021":
        return "close-sum %.8f open-sum %.8f" % (sum(row[3] for row in rows), sum(row[0] for row in rows))
    if name == "xrp_change_product_positive_2021":
        changes = changes_of(rows)
        product = sum(changes[i] * changes[i - 1] for i in range(1, len(changes)))
        return "product %.8f" % product
    if name == "link_peaks_above_troughs_2021":
        closes = [row[3] for row in rows]
        peaks = troughs = 0
        for i in range(1, len(closes) - 1):
            if closes[i] > closes[i - 1] and closes[i] > closes[i + 1]:
                peaks += 1
            elif closes[i] < closes[i - 1] and closes[i] < closes[i + 1]:
                troughs += 1
        return "peaks %d troughs %d" % (peaks, troughs)
    if name == "ada_net_above_max_change_2021":
        changes = changes_of(rows)
        return "net %.8f max-change %.8f" % (abs(rows[-1][3] - rows[0][0]), max(abs(change) for change in changes))
    if name == "dot_min_up_above_min_down_2021":
        changes = changes_of(rows)
        positive = [change for change in changes if change > 0]
        negative = [-change for change in changes if change < 0]
        return "min-up %.8f min-down %.8f" % (min(positive), min(negative))
    raise SystemExit("unknown detail %s" % name)


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    spot = os.path.join(INP, "klines", "spot")
    btc_opens = p30.load_field(os.path.join(spot, "BTCUSDT", "1d"), 1, 2)
    eth_opens = p30.load_field(os.path.join(spot, "ETHUSDT", "1d"), 1, 2)
    for day in ("2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    if p5.parse_ymd("2021-01-02").weekday() != 5:
        raise SystemExit("saturday")
    books = {}
    for sym in ORDER:
        books[sym] = load_bars(os.path.join(spot, sym, "15m"))
        for day in p5.daterange("2020-12-31", "2021-12-30"):
            have = day in books[sym]
            if day in GAP and have:
                raise SystemExit("filled a missing fifteen-minute day %s %s" % (sym, day))
            if day not in GAP and not have:
                raise SystemExit("fifteen-minute gap %s %s" % (sym, day))
    counted = {}
    for name in COUNTED:
        counted[name] = signals_for(name, books)
        if len(counted[name]) != COUNTED[name]:
            raise SystemExit("pre-freeze count moved %s %d" % (name, len(counted[name])))
        if len(counted[name]) == 0 or len(counted[name]) >= 359:
            raise SystemExit("signal is empty or every complete day %s" % name)
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_close_mean_above_median_2021", "btcskew"),
        ("eth_up_range_above_down_2021", "ethrngs"),
        ("bnb_close_span_above_open_2021", "bnbcspn"),
        ("ltc_close_sum_above_open_2021", "ltcbody"),
        ("xrp_change_product_positive_2021", "xrpcov"),
        ("link_peaks_above_troughs_2021", "linkpk"),
        ("ada_net_above_max_change_2021", "adastp"),
        ("dot_min_up_above_min_down_2021", "dotminud"),
    )
    kills = {}
    for name, _key in specs:
        signals = counted[name]
        row = p30.run_open(name, p30.marked_for(signals, "2021-01-01", "2021-12-31"), btc_ret, eth_ret, 400)
        entries = row.pop("_entries")
        raw_pool = row.pop("_pool")
        hand, n = p30.hand_sum(entries, btc_opens, eth_opens)
        if n != row["trips"] or abs(hand - raw_pool) > 0.1 or abs(hand - row["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s %s %s %s" % (name, hand, raw_pool, row["pool_bps"]))
        if row["long_days"] != row["trips"] or row["trips"] != COUNTED[name]:
            raise SystemExit("open trip count %s" % name)
        if row["signals_without_open"] != 0:
            raise SystemExit("signal lacked an open %s" % name)
        if row["execution_days"] != 365:
            raise SystemExit("execution calendar %s" % name)
        gap = row["pool_bps"] - row["stress_bps"]
        print("COST %s trips %d gap %.1f expected %d" % (name, row["trips"], gap, 40 * row["trips"]), flush=True)
        kills[name] = row
        signal = p30.shift(entries[0], -1)
        entry, exit_px, move = p30.btc_open_text(btc_opens, entries[0])
        print("FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f" % (
            name, signal, entries[0], detail_for(name, books[COIN[name]][signal]), entry, exit_px, move), flush=True)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 11:29:49 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin's Binance spot 15m bar. The open, the high, the low, and the close are fields 1 through 4. "
            "Quote volume is field 7 and is not the signal. It does not name a bar. "
            "A day needs each of the ninety-six slots from 00:00 through 23:45 once. "
            "Yesterday is not read. The other seven coins are not the signal. "
            "None of these fires on every complete day. "
            "Which bar is the widest, which bar has the largest volume, and how long a wick is are not formed. That family is not rerun and its coin is not swapped. May is not dropped from the LINK high-bar lower-wick rule, and 40% is not loosened. "
            "The maximum of the closes against the maximum of the opens, the minimum of the closes against the minimum of the opens, the mean of close-to-close changes against their median, the sum of absolute open gaps against the absolute net move, and the sign of the unique largest close-to-close change are not rerun and their coins are not swapped. "
            "A volume-weighted mean against an equal-weighted mean is not formed. "
            "The four rules that fired on every complete fifteen-minute day are not signals. They are not tightened and they are not reversed. "
            "This is not a count of up bars, a run length, or a count of new highs. "
            "The difference of 6 is not changed. That family is not rerun and its coin is not swapped. "
            "The session volume-weighted price, quote volume divided by base volume, is not formed and is not compared with the open, the close, the high, or the low. "
            "The BNB close closer to that price than the open is not rerun at a different cost. "
            "The LTC weighted price strictly below the midpoint is not a pass and its fill is not changed. "
            "The average trade size is not formed. The taker volume ratio is not formed. The taker-buy price is not formed. "
            "Same-day trade-count rankings are not rerun, and that ranking method is not changed. "
            "Hourly session blocks, clock-hour comparisons, and path length are not rerun, and that coin is not swapped. "
            "The taker-buy price against the open, the close, the high, or the low is not rerun. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
            "The same-day count of which of the eight coins closed up or down is not formed, and that counting method is not changed. "
            "How an index body and a spot body nest is not formed. "
            "Which hour the high falls and which hour the low falls are not formed. "
            "The busiest hour and the quietest hour are not formed. "
            "A term-basis sign comparison is not formed. The no-entry ADA-positive DOT-positive LINK-negative rule is not in this run and its signs are not flipped. "
            "A positive sum of fifteen-minute bodies with a negative net move had no entries and is not in this run. "
            "The 2018 lower-wick share against the previous ninety days is not rerun, and the upper wick is not substituted into that share. "
            "The premium index is not formed. The coin-margined versus USDT-margined premium is not formed. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Perpetual quote volume relative to the previous days is not rerun. "
            "Taker-buy base volume relative to its own previous days is not rerun. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "A numeric clear on this daily open is not a testing row. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full spot hour set and lack a full spot fifteen-minute set. Those days stay missing. The year is not started later. This screen does not read the hourly tape. "
            "None of these is which bar is the widest, which bar has the largest volume, or how long a wick is. "
            "None of these is an up-bar count, a run length, or a new-high count. "
            "None of these is a volume-weighted mean against an equal-weighted mean. "
            "None of these is a session volume-weighted price against the open, the close, the high, or the low. "
            "None of these is a same-day trade-count ranking. "
            "None of these is an hourly session block, a clock-hour comparison, or a path length. "
            "None of these is a taker-buy price against the open, the close, the high, or the low. "
            "None of these is an eight-coin up or down count. "
            "None of these is an index-versus-spot body nesting. "
            "None of these is a leveraged-token up-versus-down pair. "
            "None of these is a busiest-hour or quietest-hour rule. "
            "None of these is an hourly price-extreme rule. "
            "None of these is a BTC contract-count path. "
            "None of these is ETH funding. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a top-trader position-ratio or account-ratio slice. "
            "None compares one coin's N-day close return with another's. "
            "The account-minus-position gap narrowing is not rerun. "
            "None lowers 1.30, 0.001, 0.0015, 0.002, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2, to 19, to 3, to 20, to 35, to 58, to 9, to 25, to 32, to 17, to 11, to 8, to 42, to 14, to 16, or to 40, and no year is extended. "
            "The three-hour neighborhood is not widened. The one-hour gap is not widened. Twelve is not lowered. "
            "The separation of 11 is not lowered. "
            "The funding-sum half and the funding hour comparison are not changed. "
            "The interior funding peak is not rescored. "
            "The OKX basis is not in this run. "
            "Liquidation snapshots are not in this run and are not replaced. "
            "The LINK quote-volume screen is not rerun and its null is not loosened. "
            "The LTC quote-volume screen that clears the previous three days is not rerun. "
            "The DOGE 1% open gap is not rerun and its threshold is not lowered. "
            "The ETH two-up streak is not rerun and its cost and month gate are not changed. "
            "The DOGE quote-volume mean screen is not extended and its 60-trip gate is not lowered to 45. "
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
            raise SystemExit("summary_pass55.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
