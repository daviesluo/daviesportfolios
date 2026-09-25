"""Eight frozen Revolut X screens. Six-hour closes, open to open.

Reads the eight rule texts hashed at 2026-09-25 12:09:24 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass58.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
Fifteen-minute bars are not read. Four-hour bars are not read. The four-hour
range family is not rerun. January is not dropped from the XRP inversion rule,
and 8 is not changed. No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass58.py
    python3 docs/agents/scripts/fp5/screen_pass58.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass58")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass58.json")
FROZEN = "2026-09-25 12:09:24 UTC"
SHA = {
    "btcopp": "b1639361f121f43933ec4bcbd7c76f3c4237a1c2dba73d10792848d1ddcb29ca",
    "ethpair": "3a5a9b76b99bdcdf41c13903585bd051684df42fcb02672c6159c687f4951c46",
    "bnbsum": "77cbb75a0b9501ddbec4f5403f638a99f19b3fc39e38956b5a761d6d174590d3",
    "ltcnet": "a1f8f1e9d4d05eda4887dec9b3ab12cad6347da00c15e46954e1852a2372d5b2",
    "xrpzag": "ae1b3b6d382fd4c6b8e13d72c48d8cb00631ce6f4ef46c986b43ab91e825c1f7",
    "linkbtw": "86f2b1de6f92a59772efc98a1d58057b58b5f38d4007430ae5b7065242572822",
    "adaex2": "c71bc755ecbc7c96a2700fb48610e126880f3413fba840c1a4edad2d6df262f3",
    "dotlow": "65784491a6794b7d611d05689b3335261c285ac09c87026126916c1bfb324824",
}
ORDER = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
HOURS = (0, 6, 12, 18)
COUNTED = {
    "btc_end_steps_opposite_2021": 182,
    "eth_last_above_first_third_below_second_2021": 49,
    "bnb_middle_close_sum_above_ends_2021": 191,
    "ltc_net_close_above_middle_step_2021": 254,
    "xrp_up_down_up_under_local_high_2021": 26,
    "link_third_close_between_first_two_2021": 74,
    "ada_exactly_two_later_closes_above_first_2021": 67,
    "dot_first_close_below_other_three_2021": 120,
}
COIN = {
    "btc_end_steps_opposite_2021": "BTCUSDT",
    "eth_last_above_first_third_below_second_2021": "ETHUSDT",
    "bnb_middle_close_sum_above_ends_2021": "BNBUSDT",
    "ltc_net_close_above_middle_step_2021": "LTCUSDT",
    "xrp_up_down_up_under_local_high_2021": "XRPUSDT",
    "link_third_close_between_first_two_2021": "LINKUSDT",
    "ada_exactly_two_later_closes_above_first_2021": "ADAUSDT",
    "dot_first_close_below_other_three_2021": "DOTUSDT",
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
        if len(slots) == 4 and all(hour in slots for hour in HOURS):
            days[day] = [slots[hour] for hour in HOURS]
    return days


def closes(rows):
    if len(rows) != 4:
        raise SystemExit("six-hour length")
    return [row[3] for row in rows]


def btc_opp(rows):
    c0, c1, c2, c3 = closes(rows)
    return (c1 - c0) * (c3 - c2) < 0


def eth_pair(rows):
    c0, c1, c2, c3 = closes(rows)
    return c3 > c0 and c2 < c1


def bnb_mid(rows):
    c0, c1, c2, c3 = closes(rows)
    return c1 + c2 > c0 + c3


def ltc_net(rows):
    c0, c1, c2, c3 = closes(rows)
    return abs(c3 - c0) > abs(c2 - c1)


def xrp_zag(rows):
    c0, c1, c2, c3 = closes(rows)
    return c1 > c0 and c2 < c1 and c3 > c2 and c3 < c1


def link_btw(rows):
    c0, c1, c2, _c3 = closes(rows)
    return (c0 < c2 < c1) or (c1 < c2 < c0)


def ada_ex2(rows):
    c0, c1, c2, c3 = closes(rows)
    return sum(1 for close in (c1, c2, c3) if close > c0) == 2


def dot_low(rows):
    c0, c1, c2, c3 = closes(rows)
    return c0 < c1 and c0 < c2 and c0 < c3


PREDICATES = {
    "btc_end_steps_opposite_2021": btc_opp,
    "eth_last_above_first_third_below_second_2021": eth_pair,
    "bnb_middle_close_sum_above_ends_2021": bnb_mid,
    "ltc_net_close_above_middle_step_2021": ltc_net,
    "xrp_up_down_up_under_local_high_2021": xrp_zag,
    "link_third_close_between_first_two_2021": link_btw,
    "ada_exactly_two_later_closes_above_first_2021": ada_ex2,
    "dot_first_close_below_other_three_2021": dot_low,
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


def bar(close):
    return (close, close, close, close)


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    try:
        btc_opp([bar(1), bar(2), bar(3)])
    except SystemExit as exc:
        if str(exc) != "six-hour length":
            raise
    else:
        raise SystemExit("short btc")
    if not btc_opp([bar(1), bar(2), bar(3), bar(2)]):
        raise SystemExit("btc opposite")
    if btc_opp([bar(1), bar(2), bar(3), bar(4)]) or btc_opp([bar(2), bar(1), bar(4), bar(3)]):
        raise SystemExit("btc same sign")
    if btc_opp([bar(1), bar(2), bar(3), bar(3)]) or btc_opp([bar(1), bar(1), bar(2), bar(1)]):
        raise SystemExit("btc zero step")
    if not eth_pair([bar(1), bar(3), bar(2), bar(2)]):
        raise SystemExit("eth pair")
    if eth_pair([bar(1), bar(3), bar(2), bar(1)]) or eth_pair([bar(1), bar(2), bar(3), bar(4)]):
        raise SystemExit("eth miss")
    if eth_pair([bar(1), bar(2), bar(2), bar(3)]):
        raise SystemExit("eth touch")
    if not bnb_mid([bar(1), bar(4), bar(4), bar(1)]):
        raise SystemExit("bnb mid")
    if bnb_mid([bar(4), bar(1), bar(1), bar(4)]) or bnb_mid([bar(1), bar(2), bar(3), bar(4)]):
        raise SystemExit("bnb equal or under")
    if not ltc_net([bar(1), bar(5), bar(5), bar(3)]):
        raise SystemExit("ltc net")
    if ltc_net([bar(1), bar(2), bar(10), bar(3)]) or ltc_net([bar(10), bar(12), bar(14), bar(12)]):
        raise SystemExit("ltc under or equal")
    if not xrp_zag([bar(1), bar(4), bar(2), bar(3)]):
        raise SystemExit("xrp zag")
    if xrp_zag([bar(1), bar(4), bar(2), bar(4)]) or xrp_zag([bar(1), bar(4), bar(2), bar(2)]):
        raise SystemExit("xrp recover or flat")
    if xrp_zag([bar(1), bar(4), bar(5), bar(3)]) or xrp_zag([bar(5), bar(4), bar(2), bar(3)]):
        raise SystemExit("xrp other shape")
    if not link_btw([bar(1), bar(4), bar(2), bar(9)]) or not link_btw([bar(4), bar(1), bar(2), bar(9)]):
        raise SystemExit("link between")
    if link_btw([bar(1), bar(4), bar(4), bar(9)]) or link_btw([bar(1), bar(4), bar(5), bar(9)]):
        raise SystemExit("link outside")
    if not ada_ex2([bar(1), bar(2), bar(3), bar(0.5)]) or not ada_ex2([bar(1), bar(1), bar(2), bar(3)]):
        raise SystemExit("ada two")
    if ada_ex2([bar(1), bar(2), bar(3), bar(4)]) or ada_ex2([bar(1), bar(2), bar(0.5), bar(0.5)]):
        raise SystemExit("ada other count")
    if ada_ex2([bar(1), bar(0.5), bar(0.5), bar(0.5)]):
        raise SystemExit("ada zero")
    if not dot_low([bar(1), bar(2), bar(3), bar(4)]):
        raise SystemExit("dot low")
    if dot_low([bar(1), bar(2), bar(3), bar(1)]) or dot_low([bar(2), bar(1), bar(3), bar(4)]):
        raise SystemExit("dot not first")
    if dot_low([bar(1), bar(1), bar(2), bar(3)]):
        raise SystemExit("dot touch")


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
            name = "%s-6h-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/6h/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "6h", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass58 inputs ready", flush=True)


def detail_for(name, rows):
    c0, c1, c2, c3 = closes(rows)
    if name == "btc_end_steps_opposite_2021":
        return "first step %.8f last step %.8f" % (c1 - c0, c3 - c2)
    if name == "eth_last_above_first_third_below_second_2021":
        return "c0 %.8f c1 %.8f c2 %.8f c3 %.8f" % (c0, c1, c2, c3)
    if name == "bnb_middle_close_sum_above_ends_2021":
        return "middle %.8f ends %.8f" % (c1 + c2, c0 + c3)
    if name == "ltc_net_close_above_middle_step_2021":
        return "net %.8f middle %.8f" % (abs(c3 - c0), abs(c2 - c1))
    if name == "xrp_up_down_up_under_local_high_2021":
        return "c0 %.8f c1 %.8f c2 %.8f c3 %.8f" % (c0, c1, c2, c3)
    if name == "link_third_close_between_first_two_2021":
        return "c0 %.8f c2 %.8f c1 %.8f" % (c0, c2, c1)
    if name == "ada_exactly_two_later_closes_above_first_2021":
        above = sum(1 for close in (c1, c2, c3) if close > c0)
        return "later above %d" % above
    if name == "dot_first_close_below_other_three_2021":
        return "c0 %.8f c1 %.8f c2 %.8f c3 %.8f" % (c0, c1, c2, c3)
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
        books[sym] = load_bars(os.path.join(spot, sym, "6h"))
        for day in window:
            if day not in books[sym]:
                raise SystemExit("six-hour gap %s %s" % (sym, day))
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
        ("btc_end_steps_opposite_2021", "btcopp"),
        ("eth_last_above_first_third_below_second_2021", "ethpair"),
        ("bnb_middle_close_sum_above_ends_2021", "bnbsum"),
        ("ltc_net_close_above_middle_step_2021", "ltcnet"),
        ("xrp_up_down_up_under_local_high_2021", "xrpzag"),
        ("link_third_close_between_first_two_2021", "linkbtw"),
        ("ada_exactly_two_later_closes_above_first_2021", "adaex2"),
        ("dot_first_close_below_other_three_2021", "dotlow"),
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
            "Each rule was hashed at 2026-09-25 12:09:24 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin's Binance spot 6h close. The open time is field 0. The open, the high, the low, and the close are fields 1 through 4. "
            "The six-hour open, the high, and the low are checked and are not the signal. Volume columns and the trade count are not the signal. "
            "Fifteen-minute bars are not read. Four-hour bars are not read. "
            "A day needs each of the four slots 00:00, 06:00, 12:00, and 18:00 once. "
            "Yesterday is not read. The other seven coins are not the signal. "
            "Each of the eight coins has all four slots on every day from 2020-12-31 through 2021-12-30. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 are present on this tape. They are not dropped. The fifteen-minute gaps are not filled. "
            "None of these fires on every complete day. None of these had zero entries. "
            "On each coin, three further comparisons were counted in the same pass, before any return, and each already had an interior count, so none of them was frozen. None of those comparisons had zero days, so none was written as a rule. "
            "How four-hour ranges sit inside one another is not rerun, and its coin is not swapped. January is not dropped from the XRP inversion rule, and 8 is not changed. "
            "The fifteen-minute trade-count family is not rerun and its coin is not swapped. January is not dropped from the LINK lag-4 trade-count rule, and that null is not loosened. "
            "The fifteen-minute close span, the open span, the mean, and the median are not formed. "
            "The BNB close span strictly wider than the open span is not a pass and its fill is not changed. "
            "Which bar is the widest, which bar has the largest volume, and how long a wick is are not formed. May is not dropped from the LINK high-bar lower-wick rule, and 40% is not loosened. "
            "A volume-weighted mean against an equal-weighted mean is not formed. "
            "This is not a count of up bars, a run length, or a count of new highs. "
            "The three close-to-close steps are not summed. "
            "The average trade size is not formed. The taker volume ratio is not formed. The taker-buy price is not formed. "
            "The LTC weighted price strictly below the midpoint is not a pass and its fill is not changed. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "A numeric clear on this daily open is not a testing row. "
            "Hourly session blocks, clock-hour searches, and path length are not rerun. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "The 60-trip gate is not lowered to 56, to 20, to 21, to 59, to 14, to 16, to 40, to 26, or to 49, and no year is extended. "
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
            raise SystemExit("summary_pass58.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
