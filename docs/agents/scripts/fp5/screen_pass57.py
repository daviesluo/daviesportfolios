"""Eight frozen Revolut X screens. Four-hour range facts, open to open.

Reads the eight rule texts hashed at 2026-09-25 12:00:12 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass57.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
Fifteen-minute bars are not read. The fifteen-minute trade-count family is not
rerun. January is not dropped from the LINK lag-4 trade-count rule, and that
null is not loosened. No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass57.py
    python3 docs/agents/scripts/fp5/screen_pass57.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass57")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass57.json")
FROZEN = "2026-09-25 12:00:12 UTC"
SHA = {
    "btcsep": "c70ced37098f3ce0613e2ac056767e05e2f753edf36c4617ba7a719635328e8a",
    "ethover": "b6ab93c14f072a7b929527ddae5fb8640d1fa8e50e31f06097e839c73da2aff6",
    "bnbcage": "6c2383d30f8ead2c0095640a4e4b475b0325aa59f77cb4f958d7e0ce17a696be",
    "ltcleave": "b13e2c91fba0f700cca7c99e9bf42f51683ca962700438af4d28ec9ed262836b",
    "xrpinv": "73b33af0a4df46ad17ce137b60d8ede6d0de0506d3a23e8a32ed0ea4b0731396",
    "linkfar": "b8c67edbeb7ef86eea051c55f06b42cd6e25bc10f9315730ca0ff2c26332a486",
    "adainbd": "599f8c481e195a98c14fee89e339f650dd6885d687dfe543fa2da5d40d9cf8e8",
    "dothigh": "bfcafed87861fe017d1d164f69377252e8ee572b33cd536b5cc1a97f3d86f810",
}
ORDER = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
HOURS = (0, 4, 8, 12, 16, 20)
COUNTED = {
    "btc_first_last_ranges_apart_2021": 152,
    "eth_last_body_above_first_high_2021": 123,
    "bnb_next_range_contains_current_2021": 56,
    "ltc_leave_range_above_enter_2021": 352,
    "xrp_close_inversions_at_least_8_2021": 179,
    "link_far_overlap_above_near_2021": 78,
    "ada_open_inside_body_above_outside_2021": 312,
    "dot_last_low_above_first_high_2021": 92,
}
COIN = {
    "btc_first_last_ranges_apart_2021": "BTCUSDT",
    "eth_last_body_above_first_high_2021": "ETHUSDT",
    "bnb_next_range_contains_current_2021": "BNBUSDT",
    "ltc_leave_range_above_enter_2021": "LTCUSDT",
    "xrp_close_inversions_at_least_8_2021": "XRPUSDT",
    "link_far_overlap_above_near_2021": "LINKUSDT",
    "ada_open_inside_body_above_outside_2021": "ADAUSDT",
    "dot_last_low_above_first_high_2021": "DOTUSDT",
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
        if len(parts) < 5:
            raise SystemExit("bar field gap in %s" % folder)
        ts = p30.stamp_of(int(parts[0]))
        if ts.second != 0 or ts.microsecond != 0 or ts.minute != 0 or ts.hour not in HOURS:
            raise SystemExit("off-grid bar in %s" % folder)
        day = p5.ymd(ts)
        o, h, l, c = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
        if not (o > 0 and h > 0 and l > 0 and c > 0):
            raise SystemExit("nonpositive bar %s %s" % (folder, day))
        if h < l or h < max(o, c) or l > min(o, c):
            raise SystemExit("bar order %s %s" % (folder, day))
        key = (day, ts.hour)
        if key in got:
            raise SystemExit("duplicate slot %s %s %s" % (folder, day, ts.hour))
        got[key] = (o, h, l, c)
    by_day = {}
    for (day, hour), bar in got.items():
        by_day.setdefault(day, {})[hour] = bar
    days = {}
    for day, slots in by_day.items():
        if len(slots) == 6 and all(hour in slots for hour in HOURS):
            days[day] = [slots[hour] for hour in HOURS]
    return days


def need_six(rows):
    if len(rows) != 6:
        raise SystemExit("four-hour length")


def btc_sep(rows):
    need_six(rows)
    first, last = rows[0], rows[-1]
    return last[2] > first[1] or last[1] < first[2]


def eth_over(rows):
    need_six(rows)
    body_low = min(rows[-1][0], rows[-1][3])
    return body_low > rows[0][1]


def bnb_cage(rows):
    need_six(rows)
    later = earlier = 0
    for i in range(len(rows) - 1):
        cur, nxt = rows[i], rows[i + 1]
        if nxt[2] < cur[2] and nxt[1] > cur[1]:
            later += 1
        elif cur[2] < nxt[2] and cur[1] > nxt[1]:
            earlier += 1
    return later > earlier


def ltc_leave(rows):
    need_six(rows)
    leave = enter = 0
    for i in range(1, len(rows)):
        prev, bar = rows[i - 1], rows[i]
        open_in = prev[2] < bar[0] < prev[1]
        open_out = bar[0] > prev[1] or bar[0] < prev[2]
        close_in = prev[2] < bar[3] < prev[1]
        close_out = bar[3] > prev[1] or bar[3] < prev[2]
        if open_in and close_out:
            leave += 1
        elif open_out and close_in:
            enter += 1
    return leave > enter


def inversions(rows):
    closes = [row[3] for row in rows]
    n = 0
    for i in range(len(closes)):
        for j in range(i + 1, len(closes)):
            if closes[i] > closes[j]:
                n += 1
    return n


def xrp_inv(rows):
    need_six(rows)
    return inversions(rows) >= 8


def overlap_len(a, b):
    span = min(a[1], b[1]) - max(a[2], b[2])
    return span if span > 0 else 0.0


def link_far(rows):
    need_six(rows)
    return overlap_len(rows[0], rows[-1]) > overlap_len(rows[2], rows[3])


def ada_in(rows):
    need_six(rows)
    inside = outside = 0
    for i in range(1, len(rows)):
        prev, bar = rows[i - 1], rows[i]
        blo, bhi = min(prev[0], prev[3]), max(prev[0], prev[3])
        if blo < bar[0] < bhi:
            inside += 1
        elif bar[0] > prev[1] or bar[0] < prev[2]:
            outside += 1
    return inside > outside


def dot_high(rows):
    need_six(rows)
    return rows[-1][2] > rows[0][1]


PREDICATES = {
    "btc_first_last_ranges_apart_2021": btc_sep,
    "eth_last_body_above_first_high_2021": eth_over,
    "bnb_next_range_contains_current_2021": bnb_cage,
    "ltc_leave_range_above_enter_2021": ltc_leave,
    "xrp_close_inversions_at_least_8_2021": xrp_inv,
    "link_far_overlap_above_near_2021": link_far,
    "ada_open_inside_body_above_outside_2021": ada_in,
    "dot_last_low_above_first_high_2021": dot_high,
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


def bar(o, h, l, c):
    return (o, h, l, c)


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    mid = bar(10, 11, 9, 10)
    first = bar(10, 12, 9, 11)
    try:
        btc_sep([first] * 5)
    except SystemExit as exc:
        if str(exc) != "four-hour length":
            raise
    else:
        raise SystemExit("short btc")
    apart = [first, mid, mid, mid, mid, bar(20, 22, 19, 21)]
    down = [first, mid, mid, mid, mid, bar(5, 8, 4, 6)]
    touch = [first, mid, mid, mid, mid, bar(12, 14, 12, 13)]
    overlap = [first, mid, mid, mid, mid, bar(11, 13, 10, 12)]
    if not btc_sep(apart) or not btc_sep(down) or btc_sep(touch) or btc_sep(overlap):
        raise SystemExit("btc sep")
    over = [first, mid, mid, mid, mid, bar(14, 16, 13, 15)]
    touch_body = [first, mid, mid, mid, mid, bar(13, 16, 11, 12)]
    if not eth_over(over) or eth_over(touch_body):
        raise SystemExit("eth over")
    wide = []
    narrow = []
    for k in range(6):
        wide.append(bar(10, 11 + k, 9 - k, 10))
        narrow.append(bar(10, 16 - k, 4 + k, 10))
    flat = [bar(10, 12, 8, 10)] * 6
    if not bnb_cage(wide) or bnb_cage(narrow) or bnb_cage(flat):
        raise SystemExit("bnb cage")
    leave = [bar(10, 12, 8, 11)]
    for k in range(5):
        leave.append(bar(10, 14 + 2 * k, 8, 13 + 2 * k))
    stay = [bar(10, 12, 8, 11)] * 6
    enter = [bar(10, 20, 5, 10)]
    for k in range(5):
        enter.append(bar(21 + 3 * k, 23 + 3 * k, 8, 12))
    if not ltc_leave(leave) or ltc_leave(stay) or ltc_leave(enter):
        raise SystemExit("ltc leave")
    down_c = [bar(1, 2, 1, 6 - i) for i in range(6)]
    up_c = [bar(1, 2, 1, i + 1) for i in range(6)]
    seven = [bar(1, 2, 1, px) for px in (4, 3, 2, 1, 6, 5)]
    eight = [bar(1, 2, 1, px) for px in (5, 3, 2, 1, 6, 4)]
    if inversions(seven) != 7 or inversions(eight) != 8 or inversions(down_c) != 15 or inversions(up_c) != 0:
        raise SystemExit("inversion count")
    if not xrp_inv(down_c) or not xrp_inv(eight) or xrp_inv(seven) or xrp_inv(up_c):
        raise SystemExit("xrp inv")
    far = [bar(1, 10, 0, 5), mid, bar(1, 3, 0, 2), bar(2, 4, 2, 3), mid, bar(2, 9, 1, 5)]
    near = [bar(1, 2, 0, 1), mid, bar(1, 10, 0, 5), bar(1, 10, 0, 5), mid, bar(1, 2, 1, 1)]
    same = [bar(1, 10, 0, 5), mid, bar(1, 10, 0, 5), bar(1, 10, 0, 5), mid, bar(1, 10, 0, 5)]
    if overlap_len(far[0], far[5]) <= overlap_len(far[2], far[3]):
        raise SystemExit("link lengths")
    if not link_far(far) or link_far(near) or link_far(same):
        raise SystemExit("link far")
    inside = [bar(10, 14, 8, 13)] + [bar(11, 14, 8, 13)] * 5
    outside = [bar(10 + 3 * i, 12 + 3 * i, 9 + 3 * i, 11 + 3 * i) for i in range(6)]
    if not ada_in(inside) or ada_in(outside) or ada_in(stay):
        raise SystemExit("ada in")
    if not dot_high(apart) or dot_high(touch) or dot_high(down):
        raise SystemExit("dot high")


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
            name = "%s-4h-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/4h/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "4h", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass57 inputs ready", flush=True)


def detail_for(name, rows):
    if name == "btc_first_last_ranges_apart_2021":
        return "first high %.8f first low %.8f last high %.8f last low %.8f" % (
            rows[0][1], rows[0][2], rows[-1][1], rows[-1][2])
    if name == "eth_last_body_above_first_high_2021":
        return "first high %.8f body low %.8f" % (rows[0][1], min(rows[-1][0], rows[-1][3]))
    if name == "bnb_next_range_contains_current_2021":
        later = earlier = 0
        for i in range(len(rows) - 1):
            cur, nxt = rows[i], rows[i + 1]
            if nxt[2] < cur[2] and nxt[1] > cur[1]:
                later += 1
            elif cur[2] < nxt[2] and cur[1] > nxt[1]:
                earlier += 1
        return "later-contains %d earlier-contains %d" % (later, earlier)
    if name == "ltc_leave_range_above_enter_2021":
        leave = enter = 0
        for i in range(1, len(rows)):
            prev, item = rows[i - 1], rows[i]
            if prev[2] < item[0] < prev[1] and (item[3] > prev[1] or item[3] < prev[2]):
                leave += 1
            elif (item[0] > prev[1] or item[0] < prev[2]) and prev[2] < item[3] < prev[1]:
                enter += 1
        return "leave %d enter %d" % (leave, enter)
    if name == "xrp_close_inversions_at_least_8_2021":
        return "inversions %d" % inversions(rows)
    if name == "link_far_overlap_above_near_2021":
        return "far %.8f near %.8f" % (overlap_len(rows[0], rows[-1]), overlap_len(rows[2], rows[3]))
    if name == "ada_open_inside_body_above_outside_2021":
        inside = outside = 0
        for i in range(1, len(rows)):
            prev, item = rows[i - 1], rows[i]
            blo, bhi = min(prev[0], prev[3]), max(prev[0], prev[3])
            if blo < item[0] < bhi:
                inside += 1
            elif item[0] > prev[1] or item[0] < prev[2]:
                outside += 1
        return "inside %d outside %d" % (inside, outside)
    if name == "dot_last_low_above_first_high_2021":
        return "last low %.8f first high %.8f" % (rows[-1][2], rows[0][1])
    raise SystemExit("unknown detail %s" % name)


def hand_parts(entry_days, btc_opens, eth_opens):
    """Recompute books and months from raw opens. Does not call score_open."""
    btc = eth = 0.0
    months = {}
    for day in entry_days:
        nxt = p30.shift(day, 1)
        b = (btc_opens[nxt] / btc_opens[day] - 1.0) * 10000.0 - 40.0
        e = (eth_opens[nxt] / eth_opens[day] - 1.0) * 10000.0 - 40.0
        btc += b
        eth += e
        month = day[:7]
        months[month] = months.get(month, 0.0) + (b + e) / 2.0
    return (btc + eth) / 2.0, btc, eth, months


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
    window = list(p5.daterange("2020-12-31", "2021-12-30"))
    for sym in ORDER:
        books[sym] = load_bars(os.path.join(spot, sym, "4h"))
        for day in window:
            if day not in books[sym]:
                raise SystemExit("four-hour gap %s %s" % (sym, day))
    counted = {}
    for name in COUNTED:
        counted[name] = signals_for(name, books)
        if len(counted[name]) != COUNTED[name]:
            raise SystemExit("pre-freeze count moved %s %d" % (name, len(counted[name])))
        if len(counted[name]) == 0 or len(counted[name]) >= 365:
            raise SystemExit("signal is empty or every complete day %s" % name)
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_first_last_ranges_apart_2021", "btcsep"),
        ("eth_last_body_above_first_high_2021", "ethover"),
        ("bnb_next_range_contains_current_2021", "bnbcage"),
        ("ltc_leave_range_above_enter_2021", "ltcleave"),
        ("xrp_close_inversions_at_least_8_2021", "xrpinv"),
        ("link_far_overlap_above_near_2021", "linkfar"),
        ("ada_open_inside_body_above_outside_2021", "adainbd"),
        ("dot_last_low_above_first_high_2021", "dothigh"),
    )
    kills = {}
    for name, _key in specs:
        signals = counted[name]
        row = p30.run_open(name, p30.marked_for(signals, "2021-01-01", "2021-12-31"), btc_ret, eth_ret, 400)
        entries = row.pop("_entries")
        raw_pool = row.pop("_pool")
        hand, n = p30.hand_sum(entries, btc_opens, eth_opens)
        pool, btc_book, eth_book, months = hand_parts(entries, btc_opens, eth_opens)
        if n != row["trips"] or abs(hand - raw_pool) > 0.1 or abs(hand - row["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s %s %s %s" % (name, hand, raw_pool, row["pool_bps"]))
        if abs(pool - raw_pool) > 0.1 or abs(btc_book - row["btc_bps"]) > 0.1 or abs(eth_book - row["eth_bps"]) > 0.1:
            raise SystemExit("hand books %s" % name)
        if raw_pool > 0:
            month, pnl = max(months.items(), key=lambda kv: kv[1])
            if month != row["top_month"] or abs(pnl - row["top_month_bps"]) > 0.1:
                raise SystemExit("hand month %s" % name)
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
            "Each rule was hashed at 2026-09-25 12:00:12 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin's Binance spot 4h bar. The open, the high, the low, and the close are fields 1 through 4. "
            "Volume columns and the trade count are not the signal. Fifteen-minute bars are not read. "
            "A day needs each of the six slots 00:00, 04:00, 08:00, 12:00, 16:00, and 20:00 once. "
            "Yesterday is not read. The other seven coins are not the signal. "
            "Each of the eight coins has all six slots on every day from 2020-12-31 through 2021-12-30. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 are present on this tape. They are not dropped. The fifteen-minute gaps are not filled. "
            "None of these fires on every complete day. None of these had zero entries. "
            "A BTC count of consecutive four-hour range gaps strictly above overlaps had no entries, and exactly one such gap had no entries. Neither was frozen. "
            "An ETH count of bodies strictly above the previous high had no entries, and so did the comparison with bodies strictly below the previous low. Neither was frozen. "
            "A LINK sum of consecutive overlap lengths strictly above the sum of consecutive gap lengths fired on every complete day. It was not frozen, it is not tightened, and it is not reversed. "
            "An ADA count of at least one open strictly outside the previous range had no entries and was not frozen. "
            "A DOT count of fifteen-minute bars sitting strictly inside the previous two trade counts is not in this run. "
            "The fifteen-minute trade-count family is not rerun and its coin is not swapped. January is not dropped from the LINK lag-4 trade-count rule, and that null is not loosened. "
            "The fifteen-minute close span, the open span, the mean, and the median are not formed. "
            "The BNB close span strictly wider than the open span is not a pass and its fill is not changed. "
            "Which bar is the widest, which bar has the largest volume, and how long a wick is are not formed. May is not dropped from the LINK high-bar lower-wick rule, and 40% is not loosened. "
            "A volume-weighted mean against an equal-weighted mean is not formed. "
            "This is not a count of up bars, a run length, or a count of new highs. "
            "The average trade size is not formed. The taker volume ratio is not formed. The taker-buy price is not formed. "
            "The LTC weighted price strictly below the midpoint is not a pass and its fill is not changed. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "A numeric clear on this daily open is not a testing row. "
            "Hourly session blocks, clock-hour comparisons, and path length are not rerun. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "The 60-trip gate is not lowered to 56, to 20, to 21, to 59, to 14, to 16, or to 40, and no year is extended. "
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
            raise SystemExit("summary_pass57.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
