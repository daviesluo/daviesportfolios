"""Eight frozen Revolut X screens. Index versus spot, eight mechanisms.

Reads the eight rule texts hashed at 2026-09-25 09:47:42 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass46.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
ETH funding is not in this run. BTC contract-count path shapes are not in this run.
The busiest-hour and quietest-hour family is not rerun on another coin.
The hour of the unique high and the hour of the unique low are not rerun.
Leveraged-token up-versus-down pairs are not rerun on another coin.
Coin-margined trade-count rules are not rerun, and their fill is not changed.
The coin-margined three-day trade-count rise is not a pass and is not armed.
Perpetual quote volume relative to the previous days is not rerun on another coin.
Taker-buy base volume relative to its own previous days is not rerun, and no
other volume column is swapped in for that writing.
Term-basis sign comparisons are not rerun, and the no-entry sign pattern is not flipped.
The taker ratio and the average trade size are not formed.
The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53,
to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2,
to 19, to 3, to 20, or to 35, and no screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass46.py
    python3 docs/agents/scripts/fp5/screen_pass46.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass46")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass46.json")
FROZEN = "2026-09-25 09:47:42 UTC"
SHA = {
    "btccover": "88a269f3e2ee6f97fa4e6711b1649fd0713b2f53dabef6733ac67b8d1c09d6c7",
    "ethwiden": "f8fcc38590e5d5ff200df8bcde984ca416d608367cf569a94b6dc24c150cff27",
    "bnbnest": "4085789b2753bcd7b7af463acd07ccd3b0cebd79e269888d9904da229b1f0b2f",
    "ltcnest": "1feba9af031920121503f39219726cc4e7fa016044cce88783d841679f761cfb",
    "xrplap": "17d6765663faaf6a85f0a39cbb5787bd801a39794a5b3dc86a073a98fb884d64",
    "linkside": "5022b80c87367d6858df3f10933e8c930fe22aa463c83325230152e5bcbdca5c",
    "adathree": "8174df00da55170b916aa65419c2c2dfd9c28772b523eea87a8a36e9fdb49b0a",
    "dotbody": "9c340010d3f53c0a46b84caba1e8b366faabe716d053a5ae52f11e109b0ec695",
}
COINS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")


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


def load_ohlc(folder):
    """Open, high, low, close. Volume columns are not read."""
    bars = {}
    bad = set()
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 5:
            raise SystemExit("ohlc field gap in %s" % folder)
        day = p5.ymd(p30.stamp_of(int(parts[0])))
        row = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
        if day in bars and bars[day] != row:
            bad.add(day)
        else:
            bars[day] = row
    for day in bad:
        bars.pop(day, None)
    return bars


def usable(row):
    if row is None:
        return False
    opened, high, low, close = row
    return (opened > 0 and high > 0 and low > 0 and close > 0 and high >= low
            and high >= opened and high >= close and low <= opened and low <= close)


def paired(index_bars, spot_bars):
    out = {}
    for day in set(index_bars) | set(spot_bars):
        left, right = index_bars.get(day), spot_bars.get(day)
        if usable(left) and usable(right):
            out[day] = (left, right)
    return out


def btc_cover(book):
    out = set()
    for day, (index, spot) in book.items():
        if spot[1] > index[1] and spot[2] < index[2]:
            out.add(day)
    return out


def eth_widen(book):
    out = set()
    for day, (index, spot) in book.items():
        open_basis = abs(index[0] / spot[0] - 1.0)
        close_basis = abs(index[3] / spot[3] - 1.0)
        if close_basis > open_basis:
            out.add(day)
    return out


def bnb_nest(book):
    out = set()
    for day, (index, spot) in book.items():
        lo, hi = min(index[0], index[3]), max(index[0], index[3])
        if lo < spot[3] < hi:
            out.add(day)
    return out


def ltc_nest(book):
    out = set()
    for day, (index, spot) in book.items():
        lo, hi = min(spot[0], spot[3]), max(spot[0], spot[3])
        if lo < index[3] < hi:
            out.add(day)
    return out


def xrp_lap(book):
    out = set()
    for day, (index, spot) in book.items():
        lo_i, hi_i = min(index[0], index[3]), max(index[0], index[3])
        lo_s, hi_s = min(spot[0], spot[3]), max(spot[0], spot[3])
        overlap = lo_i < hi_s and lo_s < hi_i
        index_contains = lo_i <= lo_s and hi_s <= hi_i
        spot_contains = lo_s <= lo_i and hi_i <= hi_s
        if overlap and not index_contains and not spot_contains:
            out.add(day)
    return out


def link_side(book):
    out = set()
    for day, (index, spot) in book.items():
        high, low = index[1], index[2]
        if high <= low:
            continue
        close_near_high = (high - spot[3]) < (spot[3] - low)
        open_near_low = (spot[0] - low) < (high - spot[0])
        if close_near_high and open_near_low:
            out.add(day)
    return out


def ada_three(book):
    out = set()
    for day, (index, spot) in book.items():
        inside = sum(1 for px in index if spot[2] < px < spot[1])
        if inside == 3:
            out.add(day)
    return out


def dot_body(book):
    out = set()
    for day, (index, spot) in book.items():
        index_range = index[1] - index[2]
        spot_range = spot[1] - spot[2]
        index_body = abs(index[3] - index[0])
        spot_body = abs(spot[3] - spot[0])
        if index_range < spot_range and index_body > spot_body > 0:
            out.add(day)
    return out


def signals_for(name, book):
    if name == "btc_index_cover_2021":
        return btc_cover(book)
    if name == "eth_basis_widen_2021":
        return eth_widen(book)
    if name == "bnb_index_body_2021":
        return bnb_nest(book)
    if name == "ltc_spot_body_2021":
        return ltc_nest(book)
    if name == "xrp_body_lap_2021":
        return xrp_lap(book)
    if name == "link_side_2021":
        return link_side(book)
    if name == "ada_three_inside_2021":
        return ada_three(book)
    if name == "dot_body_range_2021":
        return dot_body(book)
    raise SystemExit("unknown rule %s" % name)


def self_check():
    p5.self_check()
    day = "2021-01-02"
    # tuple: open, high, low, close
    cover = {day: ((100.0, 105.0, 95.0, 102.0), (99.0, 110.0, 90.0, 101.0))}
    if btc_cover(cover) != {day}:
        raise SystemExit("btc cover")
    cover[day] = ((100.0, 110.0, 95.0, 102.0), (99.0, 110.0, 90.0, 101.0))
    if btc_cover(cover):
        raise SystemExit("btc equal high")
    widen = {day: ((100.0, 101.0, 99.0, 102.0), (100.0, 103.0, 99.0, 100.0))}
    if eth_widen(widen) != {day}:
        raise SystemExit("eth wider")
    widen[day] = ((102.0, 103.0, 99.0, 100.0), (100.0, 103.0, 99.0, 100.0))
    if eth_widen(widen):
        raise SystemExit("eth narrower")
    nest = {day: ((100.0, 112.0, 98.0, 110.0), (101.0, 120.0, 90.0, 105.0))}
    if bnb_nest(nest) != {day}:
        raise SystemExit("bnb inside")
    nest[day] = ((100.0, 112.0, 98.0, 110.0), (101.0, 120.0, 90.0, 100.0))
    if bnb_nest(nest):
        raise SystemExit("bnb endpoint")
    spot_body = {day: ((105.0, 112.0, 98.0, 106.0), (100.0, 120.0, 90.0, 110.0))}
    if ltc_nest(spot_body) != {day}:
        raise SystemExit("ltc inside")
    spot_body[day] = ((100.0, 112.0, 98.0, 100.0), (100.0, 120.0, 90.0, 110.0))
    if ltc_nest(spot_body):
        raise SystemExit("ltc endpoint")
    lap = {day: ((100.0, 130.0, 90.0, 120.0), (110.0, 140.0, 100.0, 130.0))}
    if xrp_lap(lap) != {day}:
        raise SystemExit("xrp overlap")
    lap[day] = ((100.0, 130.0, 90.0, 120.0), (105.0, 125.0, 95.0, 115.0))
    if xrp_lap(lap):
        raise SystemExit("xrp contained")
    lap[day] = ((100.0, 120.0, 90.0, 110.0), (110.0, 130.0, 100.0, 120.0))
    if xrp_lap(lap):
        raise SystemExit("xrp touch")
    side = {day: ((101.0, 110.0, 100.0, 109.0), (102.0, 112.0, 99.0, 108.0))}
    if link_side(side) != {day}:
        raise SystemExit("link sides")
    side[day] = ((101.0, 110.0, 100.0, 109.0), (105.0, 112.0, 99.0, 108.0))
    if link_side(side):
        raise SystemExit("link open midpoint")
    flat = {day: ((100.0, 100.0, 100.0, 100.0), (102.0, 112.0, 99.0, 108.0))}
    if not usable(flat[day][0]) or link_side(flat):
        raise SystemExit("link flat index")
    three = {day: ((100.0, 112.0, 95.0, 100.0), (99.0, 110.0, 90.0, 101.0))}
    if ada_three(three) != {day}:
        raise SystemExit("ada three")
    three[day] = ((100.0, 108.0, 95.0, 100.0), (99.0, 110.0, 90.0, 101.0))
    if ada_three(three):
        raise SystemExit("ada four")
    body = {day: ((100.0, 110.0, 100.0, 108.0), (100.0, 112.0, 100.0, 103.0))}
    if dot_body(body) != {day}:
        raise SystemExit("dot body")
    body[day] = ((100.0, 110.0, 100.0, 103.0), (100.0, 112.0, 100.0, 108.0))
    if dot_body(body):
        raise SystemExit("dot body reversed")
    body[day] = ((100.0, 110.0, 100.0, 100.0), (100.0, 112.0, 100.0, 103.0))
    if dot_body(body):
        raise SystemExit("dot zero body")


def input_jobs():
    jobs = []
    for sym in COINS:
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "futures/um/monthly/indexPriceKlines/%s/1d/%s" % (sym, name),
                os.path.join(INP, "klines", "index", sym, "1d", name)))
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for sym in ("BTCUSDT", "ETHUSDT"):
        name = "%s-1d-2022-01.zip" % sym
        jobs.append((
            p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name),
            os.path.join(INP, "klines", "spot", sym, "1d", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass46 inputs ready", flush=True)


def fmt(value):
    return "%.8f" % value


def describe(name, signal, btc_opens, tapes):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    index, spot = tapes[signal]
    if name == "btc_index_cover_2021":
        detail = "spot high %s low %s index high %s low %s" % (
            fmt(spot[1]), fmt(spot[2]), fmt(index[1]), fmt(index[2]))
    elif name == "eth_basis_widen_2021":
        detail = "close abs %s open abs %s" % (
            fmt(abs(index[3] / spot[3] - 1.0)), fmt(abs(index[0] / spot[0] - 1.0)))
    elif name == "bnb_index_body_2021":
        detail = "index open %s close %s spot close %s" % (fmt(index[0]), fmt(index[3]), fmt(spot[3]))
    elif name == "ltc_spot_body_2021":
        detail = "spot open %s close %s index close %s" % (fmt(spot[0]), fmt(spot[3]), fmt(index[3]))
    elif name == "xrp_body_lap_2021":
        detail = "index %s %s spot %s %s" % (fmt(index[0]), fmt(index[3]), fmt(spot[0]), fmt(spot[3]))
    elif name == "link_side_2021":
        detail = "index high %s low %s spot open %s close %s" % (
            fmt(index[1]), fmt(index[2]), fmt(spot[0]), fmt(spot[3]))
    elif name == "ada_three_inside_2021":
        detail = "index %s %s %s %s spot high %s low %s" % (
            fmt(index[0]), fmt(index[1]), fmt(index[2]), fmt(index[3]), fmt(spot[1]), fmt(spot[2]))
    elif name == "dot_body_range_2021":
        detail = "index range %s body %s spot range %s body %s" % (
            fmt(index[1] - index[2]), fmt(abs(index[3] - index[0])),
            fmt(spot[1] - spot[2]), fmt(abs(spot[3] - spot[0])))
    else:
        raise SystemExit("no description for %s" % name)
    print("FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f" % (
        name, signal, p30.shift(signal, 1), detail, entry, exit_px, move), flush=True)


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    spot_root = os.path.join(INP, "klines", "spot")
    index_root = os.path.join(INP, "klines", "index")
    btc_opens = p30.load_field(os.path.join(spot_root, "BTCUSDT", "1d"), 1, 2)
    eth_opens = p30.load_field(os.path.join(spot_root, "ETHUSDT", "1d"), 1, 2)
    for day in ("2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    if p5.parse_ymd("2021-01-02").weekday() != 5:
        raise SystemExit("saturday")
    span = p5.daterange("2020-12-31", "2021-12-31")
    tapes = {}
    for sym in COINS:
        book = paired(
            load_ohlc(os.path.join(index_root, sym, "1d")),
            load_ohlc(os.path.join(spot_root, sym, "1d")))
        missing = [day for day in span if day not in book]
        if missing:
            raise SystemExit("index spot gap %s %s" % (sym, missing[:3]))
        tapes[sym] = book
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_index_cover_2021", "btccover", "BTCUSDT"),
        ("eth_basis_widen_2021", "ethwiden", "ETHUSDT"),
        ("bnb_index_body_2021", "bnbnest", "BNBUSDT"),
        ("ltc_spot_body_2021", "ltcnest", "LTCUSDT"),
        ("xrp_body_lap_2021", "xrplap", "XRPUSDT"),
        ("link_side_2021", "linkside", "LINKUSDT"),
        ("ada_three_inside_2021", "adathree", "ADAUSDT"),
        ("dot_body_range_2021", "dotbody", "DOTUSDT"),
    )
    kills = {}
    for name, key, sym in specs:
        signals = signals_for(name, tapes[sym])
        if not signals:
            raise SystemExit("no signals for %s" % name)
        row = p30.run_open(name, p30.marked_for(signals, "2021-01-01", "2021-12-31"), btc_ret, eth_ret, 400)
        entries = row.pop("_entries")
        raw_pool = row.pop("_pool")
        hand, n = p30.hand_sum(entries, btc_opens, eth_opens)
        if n != row["trips"] or abs(hand - raw_pool) > 0.1 or abs(hand - row["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s %s %s %s" % (name, hand, raw_pool, row["pool_bps"]))
        if row["long_days"] != row["trips"]:
            raise SystemExit("open trip was carried %s" % name)
        if row["signals_without_open"] != 0:
            raise SystemExit("signal lacked an open %s" % name)
        if row["execution_days"] != 365:
            raise SystemExit("execution calendar %s" % name)
        if not entries:
            raise SystemExit("no entries for %s" % name)
        gap = row["pool_bps"] - row["stress_bps"]
        print("COST %s trips %d gap %.1f expected %d" % (name, row["trips"], gap, 40 * row["trips"]), flush=True)
        kills[name] = row
        describe(name, p30.shift(entries[0], -1), btc_opens, tapes[sym])
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 09:47:42 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is the same day's USD-M index bar and Binance spot bar. "
            "The open is field 1, the high is field 2, the low is field 3, and the close is field 4. "
            "Volume columns are not the signal. Yesterday is not read. "
            "Which hour the high falls and which hour the low falls are not formed. "
            "A term-basis sign comparison is not formed. The no-entry ADA-positive DOT-positive LINK-negative rule is not in this run and its signs are not flipped. "
            "The taker ratio is not formed. The average trade size is not formed. "
            "The premium index is not formed. The coin-margined versus USDT-margined premium is not formed. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Perpetual quote volume relative to the previous days is not rerun. "
            "Taker-buy base volume relative to its own previous days is not rerun. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "A numeric clear on this daily open is not a testing row. "
            "These bars are not a stand-in for hourly price extremes, for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full spot hour set and stay missing on that tape. The year is not started later. "
            "Each of these eight coins has an index bar and a spot bar on every day from 2020-12-31 through 2021-12-31. "
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
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2, to 19, to 3, to 20, or to 35, and no year is extended. "
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
            raise SystemExit("summary_pass46.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("WROTE", OUT, flush=True)


if __name__ == "__main__":
    main()
