"""Eight frozen Revolut X screens. Fifteen-minute bar facts, open to open.

Reads the eight rule texts hashed at 2026-09-25 11:19:10 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass54.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
A volume-weighted mean against an equal-weighted mean is not rerun. The four
rules that fired on every complete fifteen-minute day are not signals. The
fifteen-minute up-bar count, the run length, and the new-high count are not
rerun. The difference of 6 is not changed. The weighted-price family is not
rerun. The ETH buy-below-open screen is not a pass. The LTC weighted price
below the midpoint is not a pass. The coin-margined three-day trade-count
rise is not a pass. No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass54.py
    python3 docs/agents/scripts/fp5/screen_pass54.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass54")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass54.json")
FROZEN = "2026-09-25 11:19:10 UTC"
SHA = {
    "btcwide": "6058b89f86f941ecabc9eb147013ca965490d5981591edd20184453abe6f9d06",
    "ethheavy": "a40863eced5f58df6e72f102dc5b48b8495b7500a52b0c5a3a3d7a8383ac6dc0",
    "bnbmaxc": "0dbcac5a45f76fd621226ced7d97a32ed56b963e240e3943dc54e80dc2d8e698",
    "ltcminc": "8f70cf5e231097c13dda163c8c5a72bf921aa1811a2d5364a80b5fa1e50d05e5",
    "xrpmean": "ac17a18f73553848602307a5d442d1512c98089a2ced500c4608e59cdeaa7eec",
    "linkhiwk": "c227455c2661b8b00d2c0d69ac0cbba34530c866991588c50401db72c252ebff",
    "adagapn": "702d48ae07545a98587ee6cd33e3ce5dd8c70d5b42b5251cf7cefb9103e89a61",
    "dotbigm": "fdfa0c7c1aa858a89e1d8aa3954f9c1f9b6c15086bada488b8e58abca77b52c1",
}
ORDER = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
GAP = ("2021-02-11", "2021-03-06", "2021-04-20", "2021-04-25", "2021-08-13", "2021-09-29")
COUNTED = {
    "btc_widest_bar_up_2021": 188,
    "eth_heaviest_bar_down_2021": 192,
    "bnb_max_close_above_open_2021": 116,
    "ltc_min_close_above_open_2021": 111,
    "xrp_mean_change_above_median_2021": 170,
    "link_high_bar_lower_wick_2021": 89,
    "ada_gap_sum_above_net_2021": 82,
    "dot_largest_change_up_2021": 197,
}
COIN = {
    "btc_widest_bar_up_2021": "BTCUSDT",
    "eth_heaviest_bar_down_2021": "ETHUSDT",
    "bnb_max_close_above_open_2021": "BNBUSDT",
    "ltc_min_close_above_open_2021": "LTCUSDT",
    "xrp_mean_change_above_median_2021": "XRPUSDT",
    "link_high_bar_lower_wick_2021": "LINKUSDT",
    "ada_gap_sum_above_net_2021": "ADAUSDT",
    "dot_largest_change_up_2021": "DOTUSDT",
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


def unique_max(values):
    top = max(values)
    found = None
    for i, value in enumerate(values):
        if value == top:
            if found is not None:
                return None
            found = i
    return found


def changes_of(rows):
    return [rows[i][3] - rows[i - 1][3] for i in range(1, len(rows))]


def btc_wide(rows):
    i = unique_max([row[1] - row[2] for row in rows])
    if i is None:
        return False
    return rows[i][3] > rows[i][0]


def eth_heavy(rows):
    i = unique_max([row[4] for row in rows])
    if i is None:
        return False
    return rows[i][3] < rows[i][0]


def bnb_max(rows):
    return max(row[3] for row in rows) > max(row[0] for row in rows)


def ltc_min(rows):
    return min(row[3] for row in rows) > min(row[0] for row in rows)


def xrp_mean(rows):
    changes = changes_of(rows)
    if len(changes) % 2 != 1:
        raise SystemExit("change count")
    mean = sum(changes) / float(len(changes))
    median = sorted(changes)[len(changes) // 2]
    return mean > median


def link_wick(rows):
    i = unique_max([row[1] for row in rows])
    if i is None:
        return False
    o, h, l, c, _quote = rows[i]
    upper = h - max(o, c)
    lower = min(o, c) - l
    return lower > upper


def ada_gap(rows):
    gaps = sum(abs(rows[i][0] - rows[i - 1][3]) for i in range(1, len(rows)))
    net = abs(rows[-1][3] - rows[0][0])
    return gaps > net


def dot_big(rows):
    changes = changes_of(rows)
    i = unique_max([abs(change) for change in changes])
    if i is None:
        return False
    return changes[i] > 0


PREDICATES = {
    "btc_widest_bar_up_2021": btc_wide,
    "eth_heaviest_bar_down_2021": eth_heavy,
    "bnb_max_close_above_open_2021": bnb_max,
    "ltc_min_close_above_open_2021": ltc_min,
    "xrp_mean_change_above_median_2021": xrp_mean,
    "link_high_bar_lower_wick_2021": link_wick,
    "ada_gap_sum_above_net_2021": ada_gap,
    "dot_largest_change_up_2021": dot_big,
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
    wide_up = bar(10.0, 13.0, 10.0, 12.0)
    wide_down = bar(12.0, 13.0, 10.0, 11.0)
    narrow = bar(10.0, 11.0, 10.0, 10.5)
    tied = bar(10.0, 13.0, 10.0, 12.0)
    if not btc_wide([narrow, wide_up]) or btc_wide([narrow, wide_down]) or btc_wide([tied, wide_up]):
        raise SystemExit("btc wide")
    heavy_down = bar(12.0, 12.0, 10.0, 11.0, 5.0)
    heavy_up = bar(10.0, 12.0, 10.0, 11.0, 5.0)
    light = bar(10.0, 11.0, 10.0, 10.5, 1.0)
    if not eth_heavy([light, heavy_down]) or eth_heavy([light, heavy_up]) or eth_heavy([heavy_down, bar(12.0, 12.0, 10.0, 11.0, 5.0)]):
        raise SystemExit("eth heavy")
    if not bnb_max([bar(2.0, 3.0, 1.0, 3.0), bar(2.0, 2.0, 1.0, 1.0)]) or bnb_max([bar(3.0, 3.0, 1.0, 2.0), bar(2.0, 2.0, 1.0, 2.0)]):
        raise SystemExit("bnb max")
    if not ltc_min([bar(3.0, 6.0, 3.0, 4.0), bar(6.0, 6.0, 4.0, 5.0)]) or ltc_min([bar(2.0, 4.0, 1.0, 1.0), bar(3.0, 4.0, 2.0, 4.0)]):
        raise SystemExit("ltc min")
    # Three changes: 1, 2, 9. Mean 4, median 2.
    up_path = [bar(10.0, 10.0, 10.0, 10.0), bar(10.0, 11.0, 10.0, 11.0), bar(11.0, 13.0, 11.0, 13.0), bar(13.0, 22.0, 13.0, 22.0)]
    flat_path = [bar(10.0, 10.0, 10.0, 10.0), bar(10.0, 11.0, 10.0, 11.0), bar(11.0, 13.0, 11.0, 13.0), bar(13.0, 13.0, 12.0, 12.0)]
    if not xrp_mean(up_path) or xrp_mean(flat_path):
        raise SystemExit("xrp mean")
    # High 12, open 10, close 11, low 8: upper 1, lower 2.
    spiked = bar(10.0, 12.0, 8.0, 11.0)
    rejected = bar(10.0, 12.0, 9.0, 10.0)
    twin = bar(9.0, 12.0, 9.0, 11.0)
    if not link_wick([spiked, bar(10.0, 11.0, 10.0, 10.5)]) or link_wick([rejected]) or link_wick([spiked, twin]):
        raise SystemExit("link wick")
    gapped = [bar(10.0, 10.0, 10.0, 10.0), bar(12.0, 12.0, 12.0, 12.0), bar(12.0, 12.0, 11.0, 11.0)]
    smooth = [bar(10.0, 10.0, 10.0, 10.0), bar(12.0, 14.0, 12.0, 14.0)]
    if not ada_gap(gapped) or ada_gap(smooth):
        raise SystemExit("ada gap")
    big_up = [bar(10.0, 10.0, 10.0, 10.0), bar(10.0, 11.0, 10.0, 11.0), bar(11.0, 15.0, 11.0, 15.0), bar(15.0, 15.0, 13.0, 13.0)]
    big_down = [bar(10.0, 10.0, 10.0, 10.0), bar(10.0, 11.0, 10.0, 11.0), bar(11.0, 11.0, 7.0, 7.0), bar(7.0, 9.0, 7.0, 9.0)]
    tied_move = [bar(10.0, 10.0, 10.0, 10.0), bar(10.0, 13.0, 10.0, 13.0), bar(13.0, 13.0, 10.0, 10.0)]
    if not dot_big(big_up) or dot_big(big_down) or dot_big(tied_move):
        raise SystemExit("dot big")


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
    print("pass54 inputs ready", flush=True)


def detail_for(name, rows):
    if name == "btc_widest_bar_up_2021":
        i = unique_max([row[1] - row[2] for row in rows])
        return "range %.8f open %.8f close %.8f" % (rows[i][1] - rows[i][2], rows[i][0], rows[i][3])
    if name == "eth_heaviest_bar_down_2021":
        i = unique_max([row[4] for row in rows])
        return "quote %.8f open %.8f close %.8f" % (rows[i][4], rows[i][0], rows[i][3])
    if name == "bnb_max_close_above_open_2021":
        return "max-close %.8f max-open %.8f" % (max(row[3] for row in rows), max(row[0] for row in rows))
    if name == "ltc_min_close_above_open_2021":
        return "min-close %.8f min-open %.8f" % (min(row[3] for row in rows), min(row[0] for row in rows))
    if name == "xrp_mean_change_above_median_2021":
        changes = changes_of(rows)
        mean = sum(changes) / float(len(changes))
        median = sorted(changes)[len(changes) // 2]
        return "mean %.8f median %.8f" % (mean, median)
    if name == "link_high_bar_lower_wick_2021":
        i = unique_max([row[1] for row in rows])
        o, h, l, c, _quote = rows[i]
        return "lower %.8f upper %.8f" % (min(o, c) - l, h - max(o, c))
    if name == "ada_gap_sum_above_net_2021":
        gaps = sum(abs(rows[i][0] - rows[i - 1][3]) for i in range(1, len(rows)))
        net = abs(rows[-1][3] - rows[0][0])
        return "gaps %.8f net %.8f" % (gaps, net)
    if name == "dot_largest_change_up_2021":
        changes = changes_of(rows)
        i = unique_max([abs(change) for change in changes])
        return "change %.8f" % changes[i]
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
        ("btc_widest_bar_up_2021", "btcwide"),
        ("eth_heaviest_bar_down_2021", "ethheavy"),
        ("bnb_max_close_above_open_2021", "bnbmaxc"),
        ("ltc_min_close_above_open_2021", "ltcminc"),
        ("xrp_mean_change_above_median_2021", "xrpmean"),
        ("link_high_bar_lower_wick_2021", "linkhiwk"),
        ("ada_gap_sum_above_net_2021", "adagapn"),
        ("dot_largest_change_up_2021", "dotbigm"),
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
            "Each rule was hashed at 2026-09-25 11:19:10 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin's Binance spot 15m bar. The open, the high, the low, and the close are fields 1 through 4. "
            "Quote volume is field 7 and names one bar. It is not a weight in a mean. "
            "A day needs each of the ninety-six slots from 00:00 through 23:45 once. "
            "Yesterday is not read. The other seven coins are not the signal. "
            "None of these fires on every complete day. "
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
            raise SystemExit("summary_pass54.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
