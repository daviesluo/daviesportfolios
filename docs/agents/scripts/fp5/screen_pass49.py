"""Eight frozen Revolut X screens. Hourly session structure, open to open.

Reads the eight rule texts hashed at 2026-09-25 10:19:35 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass49.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
The taker-buy price is not read. The ETH buy-below-open screen is not a pass.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
The same-day count of which coins closed up is not rerun.
Which hour the high falls and which hour the low falls are not rerun.
ETH funding is not in this run. BTC contract-count path shapes are not in this run.
The busiest-hour and quietest-hour family is not rerun on another coin.
Index-versus-spot body nesting is not rerun.
Leveraged-token up-versus-down pairs are not rerun on another coin.
Coin-margined trade-count rules are not rerun, and their fill is not changed.
The coin-margined three-day trade-count rise is not a pass and is not armed.
Perpetual quote volume relative to the previous days is not rerun on another coin.
Taker-buy base volume relative to its own previous days is not rerun, and no
other volume column is swapped in for that writing.
The taker volume ratio is not formed. The average trade size is not formed.
Term-basis sign comparisons are not rerun, and the no-entry sign pattern is not flipped.
The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53,
to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2,
to 19, to 3, to 20, to 35, to 58, to 9, to 25, to 32, to 17, or to 11, and no
screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass49.py
    python3 docs/agents/scripts/fp5/screen_pass49.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass49")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass49.json")
FROZEN = "2026-09-25 10:19:35 UTC"
SHA = {
    "btcasia": "b9b6fecc59eb0e2376d33c1a19cebaaf13c3b3fb7a47b3f68927903f99fffc9e",
    "ethlast": "d0974f0973b1483095aae64f3f8c9b72e2c3a22fe2b1fa10238b71571282902e",
    "bnbapart": "99dc04733e1de21ae4d9b675dab87e9630f41d65fa5d7cc2efbea65e4087ce74",
    "ltcclimb": "823fdf228e805697010ab141667227be7d4a5b03f565977020e6708992b37e10",
    "xrppath": "dbe8041669a8b8fb06003e4eb60df730f4d9844449184e494983d38aa3dfccb4",
    "linkturn": "13ae9d247f66c55b42f3ce59ab28c3fa9f6c559fbd7e7539531d6fc36a621e9e",
    "adacover": "71bba5a3233b18da9a91f2c67f5d252c790efc3cc46706fb9c8e0ef8d5a6dea3",
    "dotends": "6aaad625dc6735eeab78390340a0304a14f0df2e93f9b3b444f9a809db508f1a",
}
COINS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
MISSING = frozenset((
    "2021-02-11", "2021-03-06", "2021-04-20", "2021-04-25", "2021-08-13", "2021-09-29",
))
COUNTED = {
    "btc_asia_widest_2021": 107,
    "eth_last_above_first_high_2021": 169,
    "bnb_asia_below_us_2021": 59,
    "ltc_block_closes_rising_2021": 93,
    "xrp_path_longer_than_net_2021": 359,
    "link_turns_outnumber_2021": 158,
    "ada_noon_covers_neighbors_2021": 11,
    "dot_last_range_wider_2021": 96,
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


def usable(row):
    opened, high, low, close = row
    return (opened > 0 and high > 0 and low > 0 and close > 0 and high >= low
            and high >= opened and high >= close and low <= opened and low <= close)


def load_hours(folder):
    raw = {}
    bad = set()
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 5:
            raise SystemExit("hourly field gap in %s" % folder)
        ts = p30.stamp_of(int(parts[0]))
        day, hour = p5.ymd(ts), ts.hour
        if hour < 0 or hour > 23:
            raise SystemExit("hour outside 0..23")
        row = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
        key = (day, hour)
        if key in raw and raw[key] != row:
            bad.add(day)
        else:
            raw[key] = row
    out = {}
    for day, _hour in raw:
        if day in bad or day in out:
            continue
        slot = {}
        ok = True
        for hour in range(24):
            row = raw.get((day, hour))
            if row is None or not usable(row):
                ok = False
                break
            slot[hour] = row
        if ok:
            out[day] = slot
    return out


def block_range(slot, start, end):
    return max(slot[hour][1] for hour in range(start, end)) - min(slot[hour][2] for hour in range(start, end))


def btc_asia(slot):
    asia = block_range(slot, 0, 8)
    europe = block_range(slot, 8, 16)
    us = block_range(slot, 16, 24)
    return asia > europe and asia > us


def eth_last(slot):
    return slot[23][3] > slot[0][1]


def bnb_apart(slot):
    asia_high = max(slot[hour][1] for hour in range(0, 8))
    us_low = min(slot[hour][2] for hour in range(16, 24))
    return asia_high < us_low


def ltc_climb(slot):
    return slot[7][3] < slot[15][3] < slot[23][3]


def xrp_path(slot):
    net = abs(slot[23][3] - slot[0][0])
    path = sum(abs(slot[hour][3] - slot[hour - 1][3]) for hour in range(1, 24))
    return path > net


def link_turn(slot):
    steps = []
    for hour in range(1, 24):
        step = slot[hour][3] - slot[hour - 1][3]
        if step != 0:
            steps.append(step)
    if len(steps) < 2:
        return False
    turns = sum(1 for i in range(1, len(steps)) if steps[i] * steps[i - 1] < 0)
    continuations = sum(1 for i in range(1, len(steps)) if steps[i] * steps[i - 1] > 0)
    return turns > continuations


def ada_cover(slot):
    return (slot[12][1] > slot[11][1] and slot[12][1] > slot[13][1]
            and slot[12][2] < slot[11][2] and slot[12][2] < slot[13][2])


def dot_ends(slot):
    return (slot[23][1] - slot[23][2]) > (slot[0][1] - slot[0][2])


PREDICATES = {
    "btc_asia_widest_2021": btc_asia,
    "eth_last_above_first_high_2021": eth_last,
    "bnb_asia_below_us_2021": bnb_apart,
    "ltc_block_closes_rising_2021": ltc_climb,
    "xrp_path_longer_than_net_2021": xrp_path,
    "link_turns_outnumber_2021": link_turn,
    "ada_noon_covers_neighbors_2021": ada_cover,
    "dot_last_range_wider_2021": dot_ends,
}


def signals_for(name, bars):
    pred = PREDICATES.get(name)
    if pred is None:
        raise SystemExit("unknown rule %s" % name)
    return {day for day, slot in bars.items() if "2020-12-31" <= day <= "2021-12-30" and pred(slot)}


def flat(price=100.0):
    return {hour: (price, price, price, price) for hour in range(24)}


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    wide = flat()
    wide[0] = (100.0, 110.0, 100.0, 100.0)
    if not btc_asia(wide):
        raise SystemExit("btc asia")
    tied = flat()
    tied[0] = (100.0, 110.0, 100.0, 100.0)
    tied[8] = (100.0, 110.0, 100.0, 100.0)
    if btc_asia(tied):
        raise SystemExit("btc asia tie")
    gap = flat()
    gap[0] = (100.0, 100.0, 100.0, 100.0)
    gap[23] = (100.0, 102.0, 100.0, 101.0)
    if not eth_last(gap) or eth_last(flat()):
        raise SystemExit("eth last")
    apart = flat(100.0)
    for hour in range(16, 24):
        apart[hour] = (101.0, 101.0, 101.0, 101.0)
    if not bnb_apart(apart) or bnb_apart(flat()):
        raise SystemExit("bnb apart")
    climb = flat()
    climb[7] = (100.0, 100.0, 100.0, 100.0)
    climb[15] = (101.0, 101.0, 101.0, 101.0)
    climb[23] = (102.0, 102.0, 102.0, 102.0)
    tied_climb = flat()
    tied_climb[7] = (100.0, 100.0, 100.0, 100.0)
    tied_climb[15] = (100.0, 100.0, 100.0, 100.0)
    tied_climb[23] = (101.0, 101.0, 101.0, 101.0)
    if not ltc_climb(climb) or ltc_climb(tied_climb):
        raise SystemExit("ltc climb")
    monotone = flat()
    for hour in range(24):
        monotone[hour] = (100.0 + hour, 100.0 + hour, 100.0 + hour, 100.0 + hour)
    bent = flat()
    bent[0] = (100.0, 100.0, 100.0, 100.0)
    bent[1] = (101.0, 101.0, 101.0, 101.0)
    bent[2] = (100.0, 100.0, 100.0, 100.0)
    if xrp_path(monotone) or not xrp_path(bent):
        raise SystemExit("xrp path")
    zigzag = flat()
    for hour in range(24):
        price = 100.0 + (hour % 2)
        zigzag[hour] = (price, price, price, price)
    same_way = flat()
    for hour in range(24):
        same_way[hour] = (100.0 + hour, 100.0 + hour, 100.0 + hour, 100.0 + hour)
    even = flat(99.0)
    even[0] = (100.0, 100.0, 100.0, 100.0)
    even[1] = (101.0, 101.0, 101.0, 101.0)
    even[2] = (100.0, 100.0, 100.0, 100.0)
    even[3] = (99.0, 99.0, 99.0, 99.0)
    if not link_turn(zigzag) or link_turn(same_way) or link_turn(even) or link_turn(flat()):
        raise SystemExit("link turn")
    cover = flat()
    cover[11] = (100.0, 105.0, 95.0, 100.0)
    cover[12] = (100.0, 106.0, 94.0, 100.0)
    cover[13] = (100.0, 105.0, 95.0, 100.0)
    touch = flat()
    touch[11] = (100.0, 106.0, 95.0, 100.0)
    touch[12] = (100.0, 106.0, 94.0, 100.0)
    touch[13] = (100.0, 105.0, 95.0, 100.0)
    if not ada_cover(cover) or ada_cover(touch):
        raise SystemExit("ada cover")
    ends = flat()
    ends[0] = (100.0, 104.0, 100.0, 100.0)
    ends[23] = (100.0, 105.0, 100.0, 100.0)
    if not dot_ends(ends) or dot_ends(flat()):
        raise SystemExit("dot ends")


def input_jobs():
    jobs = []
    for sym in COINS:
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-1h-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/1h/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "1h", name)))
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2021-01", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "1d", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass49 inputs ready", flush=True)


def fmt(value):
    return "%.8f" % value


def detail_for(name, slot):
    if name == "btc_asia_widest_2021":
        return "asia %s europe %s us %s" % (
            fmt(block_range(slot, 0, 8)), fmt(block_range(slot, 8, 16)), fmt(block_range(slot, 16, 24)))
    if name == "eth_last_above_first_high_2021":
        return "high0 %s close23 %s" % (fmt(slot[0][1]), fmt(slot[23][3]))
    if name == "bnb_asia_below_us_2021":
        asia_high = max(slot[hour][1] for hour in range(0, 8))
        us_low = min(slot[hour][2] for hour in range(16, 24))
        return "asia_high %s us_low %s" % (fmt(asia_high), fmt(us_low))
    if name == "ltc_block_closes_rising_2021":
        return "c7 %s c15 %s c23 %s" % (fmt(slot[7][3]), fmt(slot[15][3]), fmt(slot[23][3]))
    if name == "xrp_path_longer_than_net_2021":
        net = abs(slot[23][3] - slot[0][0])
        path = sum(abs(slot[hour][3] - slot[hour - 1][3]) for hour in range(1, 24))
        return "path %s net %s" % (fmt(path), fmt(net))
    if name == "link_turns_outnumber_2021":
        steps = [slot[hour][3] - slot[hour - 1][3] for hour in range(1, 24)]
        nonzero = [step for step in steps if step != 0]
        turns = sum(1 for i in range(1, len(nonzero)) if nonzero[i] * nonzero[i - 1] < 0)
        continuations = sum(1 for i in range(1, len(nonzero)) if nonzero[i] * nonzero[i - 1] > 0)
        return "turns %d continuations %d" % (turns, continuations)
    if name == "ada_noon_covers_neighbors_2021":
        return "h11 %s h12 %s h13 %s l11 %s l12 %s l13 %s" % (
            fmt(slot[11][1]), fmt(slot[12][1]), fmt(slot[13][1]),
            fmt(slot[11][2]), fmt(slot[12][2]), fmt(slot[13][2]))
    if name == "dot_last_range_wider_2021":
        return "r0 %s r23 %s" % (fmt(slot[0][1] - slot[0][2]), fmt(slot[23][1] - slot[23][2]))
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
    span = p5.daterange("2020-12-31", "2021-12-31")
    books = {}
    for sym in COINS:
        bars = load_hours(os.path.join(spot, sym, "1h"))
        missing = [day for day in span if day not in bars]
        if set(missing) != MISSING:
            raise SystemExit("hourly gap moved %s %s" % (sym, missing))
        books[sym] = bars
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_asia_widest_2021", "btcasia", "BTCUSDT"),
        ("eth_last_above_first_high_2021", "ethlast", "ETHUSDT"),
        ("bnb_asia_below_us_2021", "bnbapart", "BNBUSDT"),
        ("ltc_block_closes_rising_2021", "ltcclimb", "LTCUSDT"),
        ("xrp_path_longer_than_net_2021", "xrppath", "XRPUSDT"),
        ("link_turns_outnumber_2021", "linkturn", "LINKUSDT"),
        ("ada_noon_covers_neighbors_2021", "adacover", "ADAUSDT"),
        ("dot_last_range_wider_2021", "dotends", "DOTUSDT"),
    )
    kills = {}
    for name, key, sym in specs:
        signals = signals_for(name, books[sym])
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
        print("FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f" % (
            name, signal, entries[0], detail_for(name, books[sym][signal]), entry, exit_px, move), flush=True)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 10:19:35 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin's Binance spot 1h bar. Volume columns are not read. "
            "The open is field 1, the high is field 2, the low is field 3, and the close is field 4. "
            "Hour 0 is 00:00 UTC. The clock is not wrapped. Yesterday is not read. "
            "The taker-buy price is not formed. The taker-sell price is not formed. "
            "The taker-buy price against the open, the close, the high, or the low is not rerun. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
            "No volume is compared with a previous day. The taker volume ratio is not formed. The average trade size is not formed. "
            "The same-day count of which of the eight coins closed up or down is not formed, and that counting method is not changed. "
            "How an index body and a spot body nest is not formed. "
            "Which hour the high falls and which hour the low falls are not formed. "
            "The busiest hour and the quietest hour are not formed. "
            "A term-basis sign comparison is not formed. The no-entry ADA-positive DOT-positive LINK-negative rule is not in this run and its signs are not flipped. "
            "The premium index is not formed. The coin-margined versus USDT-margined premium is not formed. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Perpetual quote volume relative to the previous days is not rerun. "
            "Taker-buy base volume relative to its own previous days is not rerun. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "A numeric clear on this daily open is not a testing row. "
            "These hours are not a stand-in for the taker-price family, for the eight-coin sign count, for index-versus-spot bars, for hourly price extremes, for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full spot hour set and stay missing. The year is not started later. "
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
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2, to 19, to 3, to 20, to 35, to 58, to 9, to 25, to 32, to 17, or to 11, and no year is extended. "
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
            raise SystemExit("summary_pass49.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
