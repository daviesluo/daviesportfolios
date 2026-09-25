"""Eight frozen Revolut X screens. Taker prices versus the spot bar.

Reads the eight rule texts hashed at 2026-09-25 10:06:24 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass48.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
The same-day count of which coins closed up is not rerun.
ETH funding is not in this run. BTC contract-count path shapes are not in this run.
The busiest-hour and quietest-hour family is not rerun on another coin.
The hour of the unique high and the hour of the unique low are not rerun.
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
to 19, to 3, to 20, to 35, to 58, to 9, to 25, or to 32, and no screen year
is extended.

    python3 docs/agents/scripts/fp5/screen_pass48.py
    python3 docs/agents/scripts/fp5/screen_pass48.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass48")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass48.json")
FROZEN = "2026-09-25 10:06:24 UTC"
SHA = {
    "btcbuy": "a165e3ea0d79c005dad2fb22a1a54fcc64ca0bb00ee8a4da1c7a20cad441143a",
    "ethopen": "ad593b6c9753e0f1043f8758b381c41654c5512373d6590b994a929817a5579e",
    "bnbin": "1902f304241cd3677d6c832c4ed8d25b7dbc5144811982e33cd27fbf06ad5542",
    "ltcsides": "556051b10f215e7fcea791956c69da7eeefbed38150900a842be41927df41769",
    "xrpdist": "908a6b5bcfe5e56b4056417d629cae6d664552cf3c6fc5c0316a59e57011244a",
    "linknear": "d5b85f061d21797b86c3ddc68a4724a3f5bd25c8d704e5b5c4acf7062ccca4dc",
    "adaboth": "dd51144f425663e5216a7c3a1d24374813341eb96d536f0938f510e3558ebf14",
    "dotbuysell": "d5303e230f29bc180b96b240193e163cd24c8db19558626cc85d8a17eba01492",
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


def usable_bar(row):
    opened, high, low, close, base, quote, taker_base, taker_quote = row
    if not (opened > 0 and high > 0 and low > 0 and close > 0 and high >= low
            and high >= opened and high >= close and low <= opened and low <= close):
        return False
    if not (base > 0 and quote > 0 and taker_base > 0 and taker_quote > 0):
        return False
    sell_base = base - taker_base
    sell_quote = quote - taker_quote
    return sell_base > 0 and sell_quote > 0


def legs(row):
    opened, high, low, close, base, quote, taker_base, taker_quote = row
    buy = taker_quote / taker_base
    sell = (quote - taker_quote) / (base - taker_base)
    return opened, high, low, close, buy, sell


def load_bars(folder):
    grouped = {}
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 11:
            raise SystemExit("kline field gap in %s" % folder)
        day = p5.ymd(p30.stamp_of(int(parts[0])))
        row = tuple(float(parts[i]) for i in (1, 2, 3, 4, 5, 7, 9, 10))
        grouped.setdefault(day, []).append(row)
    bars = {}
    for day, group in grouped.items():
        if any(not usable_bar(row) for row in group):
            continue
        if len(set(group)) != 1:
            continue
        bars[day] = group[0]
    return bars


def btc_buy(legs_row):
    _opened, _high, _low, close, buy, _sell = legs_row
    return buy > close


def eth_open(legs_row):
    opened, _high, _low, _close, buy, _sell = legs_row
    return buy < opened


def bnb_in(legs_row):
    opened, _high, _low, close, buy, _sell = legs_row
    lower, upper = min(opened, close), max(opened, close)
    return lower < buy < upper


def ltc_sides(legs_row):
    _opened, high, low, _close, buy, sell = legs_row
    return (high - buy) < (buy - low) and (sell - low) < (high - sell)


def xrp_dist(legs_row):
    _opened, _high, _low, close, buy, sell = legs_row
    return abs(buy - close) > abs(sell - close)


def link_near(legs_row):
    opened, _high, _low, close, buy, _sell = legs_row
    return abs(buy - opened) < abs(buy - close)


def ada_both(legs_row):
    _opened, _high, _low, close, buy, sell = legs_row
    return buy > close and sell > close


def dot_lift(legs_row):
    _opened, _high, _low, _close, buy, sell = legs_row
    return buy > sell


def signals_for(name, bars):
    pred = {
        "btc_buy_above_close_2021": btc_buy,
        "eth_buy_below_open_2021": eth_open,
        "bnb_buy_inside_body_2021": bnb_in,
        "ltc_buy_high_sell_low_2021": ltc_sides,
        "xrp_buy_farther_2021": xrp_dist,
        "link_buy_near_open_2021": link_near,
        "ada_both_above_close_2021": ada_both,
        "dot_buy_above_sell_2021": dot_lift,
    }.get(name)
    if pred is None:
        raise SystemExit("unknown rule %s" % name)
    return {day for day, row in bars.items() if pred(legs(row))}


def self_check():
    p5.self_check()
    # open, high, low, close, buy, sell
    if not btc_buy((100, 110, 90, 100, 101, 99)) or btc_buy((100, 110, 90, 100, 100, 99)):
        raise SystemExit("btc buy")
    if not eth_open((100, 110, 90, 105, 99, 101)) or eth_open((100, 110, 90, 105, 100, 101)):
        raise SystemExit("eth open")
    if not bnb_in((100, 120, 80, 110, 105, 90)) or bnb_in((100, 120, 80, 110, 100, 90)):
        raise SystemExit("bnb inside")
    if bnb_in((100, 120, 80, 100, 100, 90)):
        raise SystemExit("bnb flat body")
    if not ltc_sides((100, 110, 100, 105, 108, 102)) or ltc_sides((100, 110, 100, 105, 105, 102)):
        raise SystemExit("ltc sides")
    if ltc_sides((100, 110, 100, 105, 108, 105)):
        raise SystemExit("ltc sell midpoint")
    if not xrp_dist((1, 2, 0.5, 1, 1.4, 1.1)) or xrp_dist((1, 2, 0.5, 1, 1.2, 0.8)):
        raise SystemExit("xrp dist")
    if not link_near((100, 110, 90, 110, 101, 100)) or link_near((100, 110, 90, 110, 105, 100)):
        raise SystemExit("link near")
    if not ada_both((100, 120, 90, 100, 101, 102)) or ada_both((100, 120, 90, 100, 101, 100)):
        raise SystemExit("ada both")
    if not dot_lift((100, 110, 90, 100, 102, 101)) or dot_lift((100, 110, 90, 100, 101, 101)):
        raise SystemExit("dot lift")


def input_jobs():
    jobs = []
    for sym in COINS:
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
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
    print("pass48 inputs ready", flush=True)


def fmt(value):
    return "%.8f" % value


def describe(name, signal, btc_opens, row):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    opened, high, low, close, buy, sell = legs(row)
    detail = "open %s high %s low %s close %s buy %s sell %s" % (
        fmt(opened), fmt(high), fmt(low), fmt(close), fmt(buy), fmt(sell))
    print("FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f" % (
        name, signal, p30.shift(signal, 1), detail, entry, exit_px, move), flush=True)


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    spot_root = os.path.join(INP, "klines", "spot")
    btc_opens = p30.load_field(os.path.join(spot_root, "BTCUSDT", "1d"), 1, 2)
    eth_opens = p30.load_field(os.path.join(spot_root, "ETHUSDT", "1d"), 1, 2)
    for day in ("2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    if p5.parse_ymd("2021-01-02").weekday() != 5:
        raise SystemExit("saturday")
    span = p5.daterange("2020-12-31", "2021-12-31")
    books = {}
    for sym in COINS:
        bars = load_bars(os.path.join(spot_root, sym, "1d"))
        missing = [day for day in span if day not in bars]
        if missing:
            raise SystemExit("spot gap %s %s" % (sym, missing[:3]))
        books[sym] = bars
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_buy_above_close_2021", "btcbuy", "BTCUSDT"),
        ("eth_buy_below_open_2021", "ethopen", "ETHUSDT"),
        ("bnb_buy_inside_body_2021", "bnbin", "BNBUSDT"),
        ("ltc_buy_high_sell_low_2021", "ltcsides", "LTCUSDT"),
        ("xrp_buy_farther_2021", "xrpdist", "XRPUSDT"),
        ("link_buy_near_open_2021", "linknear", "LINKUSDT"),
        ("ada_both_above_close_2021", "adaboth", "ADAUSDT"),
        ("dot_buy_above_sell_2021", "dotbuysell", "DOTUSDT"),
    )
    kills = {}
    for name, key, sym in specs:
        signals = signals_for(name, books[sym])
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
        signal = p30.shift(entries[0], -1)
        describe(name, signal, btc_opens, books[sym][signal])
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 10:06:24 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin's Binance spot daily bar. "
            "The buy price is taker-buy quote volume, field 10, divided by taker-buy base volume, field 9. "
            "The sell price is quote volume minus taker-buy quote volume, divided by base volume minus taker-buy base volume. "
            "Base volume is field 5 and quote volume is field 7. "
            "The open is field 1, the high is field 2, the low is field 3, and the close is field 4. "
            "No volume is compared with a previous day. The taker volume ratio is not formed. The average trade size is not formed. "
            "Yesterday is not read. "
            "The same-day count of which of the eight coins closed up or down is not formed, and that counting method is not changed. "
            "How an index body and a spot body nest is not formed. "
            "Which hour the high falls and which hour the low falls are not formed. "
            "A term-basis sign comparison is not formed. The no-entry ADA-positive DOT-positive LINK-negative rule is not in this run and its signs are not flipped. "
            "The premium index is not formed. The coin-margined versus USDT-margined premium is not formed. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Perpetual quote volume relative to the previous days is not rerun. "
            "Taker-buy base volume relative to its own previous days is not rerun. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "A numeric clear on this daily open is not a testing row. "
            "These prices are not a stand-in for the eight-coin sign count, for index-versus-spot bars, for hourly price extremes, for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full spot hour set and stay missing on that tape. The year is not started later. "
            "Each of these eight coins has a usable spot bar on every day from 2020-12-31 through 2021-12-31. "
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
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2, to 19, to 3, to 20, to 35, to 58, to 9, to 25, to 32, or to 17, and no year is extended. "
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
            raise SystemExit("summary_pass48.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
