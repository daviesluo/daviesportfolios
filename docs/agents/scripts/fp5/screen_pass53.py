"""Eight frozen Revolut X screens. Fifteen-minute weights, open to open.

Reads the eight rule texts hashed at 2026-09-25 11:07:55 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass53.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
The fifteen-minute up-bar count, the run length, and the new-high count are
not rerun. The difference of 6 is not changed. The weighted-price family is
not rerun. The ETH buy-below-open screen is not a pass. The LTC weighted
price below the midpoint is not a pass. The coin-margined three-day
trade-count rise is not a pass. No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass53.py
    python3 docs/agents/scripts/fp5/screen_pass53.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass53")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass53.json")
FROZEN = "2026-09-25 11:07:55 UTC"
SHA = {
    "btcqvw": "87d254819c096da7237ddefee64552d6dd9057d2d8431f2d8325f9260136aefd",
    "ethbweq": "0908d2b9ff622dbddbeff2ac0fa712367ac2debeccc053c12fa49f82596632da",
    "bnbrngq": "5ebed9f51162f9418a07b12bd468aafce283ede409564c3c5638a918635bdf05",
    "ltcrngn": "e9f03bcf0098aa7353015b81b22c43dcaa310cbf3a1accca70b65e92957f83a5",
    "xrptakw": "a1048db15e31c2b5a0a222c81decd6f72e3f10aa28ac059005ba20d9b87ac416",
    "linkqvb": "b183f75fed26d814c1a34e548b23acffed3ef592e9ee6c143febbf331caaa02d",
    "adatqtb": "c2fbf5f77aff186f4045da8df19c160afba880aa333c2663341e5d34ae9126e7",
    "dotqopn": "58e97c834c9ba1eea8f53e83c37cdaae470643a61ed857d71c59a78ab2ec503b",
}
ORDER = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
GAP = ("2021-02-11", "2021-03-06", "2021-04-20", "2021-04-25", "2021-08-13", "2021-09-29")
COUNTED = {
    "btc_quote_close_above_count_2021": 153,
    "eth_base_close_above_equal_2021": 156,
    "bnb_quote_range_above_equal_2021": 359,
    "ltc_count_range_above_equal_2021": 359,
    "xrp_taker_base_close_above_rest_2021": 319,
    "link_quote_close_above_base_2021": 359,
    "ada_taker_quote_close_above_base_2021": 359,
    "dot_quote_open_above_equal_2021": 194,
}
COIN = {
    "btc_quote_close_above_count_2021": "BTCUSDT",
    "eth_base_close_above_equal_2021": "ETHUSDT",
    "bnb_quote_range_above_equal_2021": "BNBUSDT",
    "ltc_count_range_above_equal_2021": "LTCUSDT",
    "xrp_taker_base_close_above_rest_2021": "XRPUSDT",
    "link_quote_close_above_base_2021": "LINKUSDT",
    "ada_taker_quote_close_above_base_2021": "ADAUSDT",
    "dot_quote_open_above_equal_2021": "DOTUSDT",
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
        if len(parts) < 11:
            raise SystemExit("bar field gap in %s" % folder)
        ts = p30.stamp_of(int(parts[0]))
        if ts.second != 0 or ts.microsecond != 0 or ts.minute not in (0, 15, 30, 45):
            raise SystemExit("off-grid bar in %s" % folder)
        day = p5.ymd(ts)
        slot = ts.hour * 4 + ts.minute // 15
        o, h, l, c = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
        base, quote, count = (float(parts[5]), float(parts[7]), float(parts[8]))
        taker_base, taker_quote = (float(parts[9]), float(parts[10]))
        if not (o > 0 and h > 0 and l > 0 and c > 0):
            raise SystemExit("nonpositive bar %s %s" % (folder, day))
        if h < l or h < max(o, c) or l > min(o, c):
            raise SystemExit("bar order %s %s" % (folder, day))
        weights = (base, quote, count, taker_base, taker_quote)
        if any(weight < 0 for weight in weights):
            raise SystemExit("negative weight %s %s" % (folder, day))
        if taker_base > base:
            raise SystemExit("taker base above base %s %s" % (folder, day))
        key = (day, slot)
        if key in got:
            raise SystemExit("duplicate slot %s %s %s" % (folder, day, slot))
        got[key] = (o, h, l, c, base, quote, count, taker_base, taker_quote)
    by_day = {}
    for (day, slot), bar in got.items():
        by_day.setdefault(day, {})[slot] = bar
    days = {}
    for day, slots in by_day.items():
        if len(slots) == 96 and all(i in slots for i in range(96)):
            days[day] = [slots[i] for i in range(96)]
    return days


def wmean(values, weights):
    total_w = 0.0
    total = 0.0
    for value, weight in zip(values, weights):
        if weight < 0:
            raise SystemExit("negative weight")
        total_w += weight
        total += value * weight
    if total_w <= 0:
        return None
    return total / total_w


def above(left, right):
    if left is None or right is None:
        return False
    return left > right


def btc_quote(rows):
    closes = [row[3] for row in rows]
    return above(wmean(closes, [row[5] for row in rows]), wmean(closes, [row[6] for row in rows]))


def eth_base(rows):
    closes = [row[3] for row in rows]
    return above(wmean(closes, [row[4] for row in rows]), wmean(closes, [1.0] * len(rows)))


def bnb_range(rows):
    spans = [row[1] - row[2] for row in rows]
    return above(wmean(spans, [row[5] for row in rows]), wmean(spans, [1.0] * len(rows)))


def ltc_range(rows):
    spans = [row[1] - row[2] for row in rows]
    return above(wmean(spans, [row[6] for row in rows]), wmean(spans, [1.0] * len(rows)))


def xrp_taker(rows):
    closes = [row[3] for row in rows]
    bought = [row[7] for row in rows]
    rest = [row[4] - row[7] for row in rows]
    return above(wmean(closes, bought), wmean(closes, rest))


def link_quote(rows):
    closes = [row[3] for row in rows]
    return above(wmean(closes, [row[5] for row in rows]), wmean(closes, [row[4] for row in rows]))


def ada_taker(rows):
    closes = [row[3] for row in rows]
    return above(wmean(closes, [row[8] for row in rows]), wmean(closes, [row[7] for row in rows]))


def dot_open(rows):
    opens = [row[0] for row in rows]
    return above(wmean(opens, [row[5] for row in rows]), wmean(opens, [1.0] * len(rows)))


PREDICATES = {
    "btc_quote_close_above_count_2021": btc_quote,
    "eth_base_close_above_equal_2021": eth_base,
    "bnb_quote_range_above_equal_2021": bnb_range,
    "ltc_count_range_above_equal_2021": ltc_range,
    "xrp_taker_base_close_above_rest_2021": xrp_taker,
    "link_quote_close_above_base_2021": link_quote,
    "ada_taker_quote_close_above_base_2021": ada_taker,
    "dot_quote_open_above_equal_2021": dot_open,
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


def bar(open_px, close, base, quote, count, taker_base, taker_quote, high=None, low=None):
    if high is None:
        high = max(open_px, close)
    if low is None:
        low = min(open_px, close)
    return (open_px, high, low, close, base, quote, count, taker_base, taker_quote)


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    if abs(wmean([10.0, 20.0], [1.0, 3.0]) - 17.5) > 1e-9:
        raise SystemExit("weighted mean")
    if wmean([10.0, 20.0], [0.0, 0.0]) is not None:
        raise SystemExit("zero weight sum")
    try:
        wmean([10.0], [-1.0])
    except SystemExit:
        pass
    else:
        raise SystemExit("negative weight")
    # (open, close, base, quote, count, taker base, taker quote). Order does not
    # change a weighted mean, so the miss puts the heavy weight on the low value.
    btc_yes = [bar(10.0, 20.0, 1.0, 3.0, 1.0, 0.0, 1.0), bar(10.0, 10.0, 1.0, 1.0, 3.0, 0.0, 1.0)]
    btc_no = [bar(10.0, 20.0, 1.0, 1.0, 3.0, 0.0, 1.0), bar(10.0, 10.0, 1.0, 3.0, 1.0, 0.0, 1.0)]
    if not btc_quote(btc_yes) or btc_quote(btc_no) or btc_quote([bar(10.0, 10.0, 1.0, 1.0, 1.0, 0.0, 1.0)] * 2):
        raise SystemExit("btc quote")
    eth_yes = [bar(10.0, 20.0, 3.0, 1.0, 1.0, 1.0, 1.0), bar(10.0, 10.0, 1.0, 1.0, 1.0, 0.0, 1.0)]
    eth_no = [bar(10.0, 20.0, 1.0, 1.0, 1.0, 0.0, 1.0), bar(10.0, 10.0, 3.0, 1.0, 1.0, 1.0, 1.0)]
    if not eth_base(eth_yes) or eth_base(eth_no):
        raise SystemExit("eth base")
    wide_heavy = bar(10.0, 10.0, 1.0, 3.0, 3.0, 1.0, 1.0, high=13.0, low=10.0)
    narrow_light = bar(10.0, 10.0, 1.0, 1.0, 1.0, 0.0, 1.0, high=11.0, low=10.0)
    wide_light = bar(10.0, 10.0, 1.0, 1.0, 1.0, 0.0, 1.0, high=13.0, low=10.0)
    narrow_heavy = bar(10.0, 10.0, 1.0, 3.0, 3.0, 1.0, 1.0, high=11.0, low=10.0)
    if not bnb_range([narrow_light, wide_heavy]) or bnb_range([narrow_heavy, wide_light]):
        raise SystemExit("bnb range")
    if not ltc_range([narrow_light, wide_heavy]) or ltc_range([narrow_heavy, wide_light]):
        raise SystemExit("ltc range")
    xrp_yes = [bar(10.0, 20.0, 10.0, 1.0, 1.0, 9.0, 1.0), bar(10.0, 10.0, 10.0, 1.0, 1.0, 1.0, 1.0)]
    xrp_no = [bar(10.0, 20.0, 10.0, 1.0, 1.0, 1.0, 1.0), bar(10.0, 10.0, 10.0, 1.0, 1.0, 9.0, 1.0)]
    if not xrp_taker(xrp_yes) or xrp_taker(xrp_no):
        raise SystemExit("xrp taker")
    link_yes = [bar(10.0, 20.0, 1.0, 3.0, 1.0, 0.0, 1.0), bar(10.0, 10.0, 3.0, 1.0, 1.0, 1.0, 1.0)]
    link_no = [bar(10.0, 20.0, 3.0, 1.0, 1.0, 1.0, 1.0), bar(10.0, 10.0, 1.0, 3.0, 1.0, 0.0, 1.0)]
    if not link_quote(link_yes) or link_quote(link_no):
        raise SystemExit("link quote")
    ada_yes = [bar(10.0, 20.0, 4.0, 1.0, 1.0, 1.0, 3.0), bar(10.0, 10.0, 4.0, 1.0, 1.0, 3.0, 1.0)]
    ada_no = [bar(10.0, 20.0, 4.0, 1.0, 1.0, 3.0, 1.0), bar(10.0, 10.0, 4.0, 1.0, 1.0, 1.0, 3.0)]
    if not ada_taker(ada_yes) or ada_taker(ada_no):
        raise SystemExit("ada taker")
    dot_yes = [bar(20.0, 10.0, 1.0, 3.0, 1.0, 0.0, 1.0), bar(10.0, 10.0, 1.0, 1.0, 1.0, 0.0, 1.0)]
    dot_no = [bar(20.0, 10.0, 1.0, 1.0, 1.0, 0.0, 1.0), bar(10.0, 10.0, 1.0, 3.0, 1.0, 0.0, 1.0)]
    if not dot_open(dot_yes) or dot_open(dot_no):
        raise SystemExit("dot open")


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
    print("pass53 inputs ready", flush=True)


def means_of(name, rows):
    if name == "btc_quote_close_above_count_2021":
        closes = [row[3] for row in rows]
        return wmean(closes, [row[5] for row in rows]), wmean(closes, [row[6] for row in rows])
    if name == "eth_base_close_above_equal_2021":
        closes = [row[3] for row in rows]
        return wmean(closes, [row[4] for row in rows]), wmean(closes, [1.0] * len(rows))
    if name == "bnb_quote_range_above_equal_2021":
        spans = [row[1] - row[2] for row in rows]
        return wmean(spans, [row[5] for row in rows]), wmean(spans, [1.0] * len(rows))
    if name == "ltc_count_range_above_equal_2021":
        spans = [row[1] - row[2] for row in rows]
        return wmean(spans, [row[6] for row in rows]), wmean(spans, [1.0] * len(rows))
    if name == "xrp_taker_base_close_above_rest_2021":
        closes = [row[3] for row in rows]
        return wmean(closes, [row[7] for row in rows]), wmean(closes, [row[4] - row[7] for row in rows])
    if name == "link_quote_close_above_base_2021":
        closes = [row[3] for row in rows]
        return wmean(closes, [row[5] for row in rows]), wmean(closes, [row[4] for row in rows])
    if name == "ada_taker_quote_close_above_base_2021":
        closes = [row[3] for row in rows]
        return wmean(closes, [row[8] for row in rows]), wmean(closes, [row[7] for row in rows])
    if name == "dot_quote_open_above_equal_2021":
        opens = [row[0] for row in rows]
        return wmean(opens, [row[5] for row in rows]), wmean(opens, [1.0] * len(rows))
    raise SystemExit("unknown means %s" % name)


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
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_quote_close_above_count_2021", "btcqvw"),
        ("eth_base_close_above_equal_2021", "ethbweq"),
        ("bnb_quote_range_above_equal_2021", "bnbrngq"),
        ("ltc_count_range_above_equal_2021", "ltcrngn"),
        ("xrp_taker_base_close_above_rest_2021", "xrptakw"),
        ("link_quote_close_above_base_2021", "linkqvb"),
        ("ada_taker_quote_close_above_base_2021", "adatqtb"),
        ("dot_quote_open_above_equal_2021", "dotqopn"),
    )
    kills = {}
    for name, _key in specs:
        signals = signals_for(name, books)
        if len(signals) != COUNTED[name]:
            raise SystemExit("pre-freeze count moved %s %d" % (name, len(signals)))
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
        left, right = means_of(name, books[COIN[name]][signal])
        print("FIRST %s signal %s exec %s left %.8f right %.8f BTC open %.2f -> %.2f %+.2f" % (
            name, signal, entries[0], left, right, entry, exit_px, move), flush=True)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 11:07:55 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin's Binance spot 15m bar. The open, the high, the low, and the close are fields 1 through 4. "
            "Base volume is field 5. Quote volume is field 7. Trade count is field 8. Taker-buy base is field 9. Taker-buy quote is field 10. "
            "A day needs each of the ninety-six slots from 00:00 through 23:45 once. "
            "A weight is the column named by the rule. The weighted mean is the sum of value times weight, divided by the sum of weights. "
            "A negative weight makes the file unusable. A nonpositive sum of weights makes that day missing. Equal means do not fire. "
            "Yesterday is not read. The other seven coins are not the signal. "
            "This is not a count of up bars, a run length, or a count of new highs. "
            "The difference of 6 is not changed. That family is not rerun and its coin is not swapped. "
            "This is not the unweighted median of closes against the unweighted median of opens. "
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
            "The premium index is not formed. The coin-margined versus USDT-margined premium is not formed. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Perpetual quote volume relative to the previous days is not rerun. "
            "Taker-buy base volume relative to its own previous days is not rerun. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "A numeric clear on this daily open is not a testing row. "
            "These fifteen-minute weights are not a stand-in for up-bar counts, for the session volume-weighted price, for trade-count rankings, for hourly session structure, for the taker-price family, for the eight-coin sign count, for index-versus-spot bars, for hourly price extremes, for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full spot hour set and lack a full spot fifteen-minute set. Those days stay missing. The year is not started later. This screen does not read the hourly tape. "
            "None of these is an up-bar count, a run length, or a new-high count. "
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
            raise SystemExit("summary_pass53.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
