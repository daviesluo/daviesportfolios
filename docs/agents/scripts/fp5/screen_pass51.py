"""Eight frozen Revolut X screens. Same-day spot weighted price, open to open.

Reads the eight rule texts hashed at 2026-09-25 10:48:48 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass51.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
Same-day trade-count rankings are not rerun. The ETH buy-below-open screen
is not a pass. The coin-margined three-day trade-count rise is not a pass.
No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass51.py
    python3 docs/agents/scripts/fp5/screen_pass51.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass51")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass51.json")
FROZEN = "2026-09-25 10:48:48 UTC"
SHA = {
    "btcvwap": "befb938b82dfbc91d83b7d207638bf6e0ca555efb1cc8c7447d0bb1e65c41184",
    "ethcross": "ae387e487188254a845516e647ab5e7102384faca872511eeb58536da5ef3652",
    "bnbnear": "5316a116f0d4c0f77c3d3bcc3769243966b4e48bb2b855032a4139be74565ecf",
    "ltcmid": "c9e60dd91b422c18fa17e673b9ce568ac2a9917cf12ea2d7efbe697c6019261e",
    "xrpfar": "ef0d306dcdac76a8b2fe7fb5c141a409e114cb07322f58f35d9591a826d13f10",
    "linkbody": "548f96e73b872e8acd1c2d725b2ffa59e4bc17306b8b1b8c07b568de4022f2e0",
    "adabody": "ba797570972d2768b0ae1454e6f623f69ad38181f0312552aae8d49ee8122903",
    "dotwick": "1ecf8eda23bec29895c3baed6582eaad8e0d94f73ad68e00574ec6ef24551cfc",
}
ORDER = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
COUNTED = {
    "btc_close_above_vwap_2021": 193,
    "eth_open_below_close_above_2021": 144,
    "bnb_close_closer_2021": 222,
    "ltc_vwap_below_mid_2021": 155,
    "xrp_close_farther_2021": 146,
    "link_body_above_2021": 72,
    "ada_body_below_2021": 68,
    "dot_vwap_outside_body_2021": 121,
}
COIN = {
    "btc_close_above_vwap_2021": "BTCUSDT",
    "eth_open_below_close_above_2021": "ETHUSDT",
    "bnb_close_closer_2021": "BNBUSDT",
    "ltc_vwap_below_mid_2021": "LTCUSDT",
    "xrp_close_farther_2021": "XRPUSDT",
    "link_body_above_2021": "LINKUSDT",
    "ada_body_below_2021": "ADAUSDT",
    "dot_vwap_outside_body_2021": "DOTUSDT",
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
    bars = {}
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 8:
            raise SystemExit("bar field gap in %s" % folder)
        day = p5.ymd(p30.stamp_of(int(parts[0])))
        o, h, l, c = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
        base, quote = float(parts[5]), float(parts[7])
        if day in bars:
            raise SystemExit("duplicate day %s %s" % (folder, day))
        if not (o > 0 and h > 0 and l > 0 and c > 0 and base > 0 and quote > 0):
            raise SystemExit("nonpositive bar %s %s" % (folder, day))
        if h < l or h < max(o, c) or l > min(o, c):
            raise SystemExit("bar order %s %s" % (folder, day))
        bars[day] = (o, h, l, c, quote / base)
    return bars


def btc_above(bar):
    _o, _h, _l, c, v = bar
    return c > v


def eth_cross(bar):
    o, _h, _l, c, v = bar
    return o < v < c


def bnb_near(bar):
    o, _h, _l, c, v = bar
    return abs(c - v) < abs(o - v)


def ltc_mid(bar):
    _o, h, l, _c, v = bar
    return (h - v) > (v - l)


def xrp_far(bar):
    o, _h, _l, c, v = bar
    return abs(c - v) > abs(o - v)


def link_body(bar):
    o, _h, _l, c, v = bar
    return min(o, c) > v


def ada_body(bar):
    o, _h, _l, c, v = bar
    return max(o, c) < v


def dot_wick(bar):
    o, h, l, c, v = bar
    outside = v < min(o, c) or v > max(o, c)
    return outside and l < v < h


PREDICATES = {
    "btc_close_above_vwap_2021": btc_above,
    "eth_open_below_close_above_2021": eth_cross,
    "bnb_close_closer_2021": bnb_near,
    "ltc_vwap_below_mid_2021": ltc_mid,
    "xrp_close_farther_2021": xrp_far,
    "link_body_above_2021": link_body,
    "ada_body_below_2021": ada_body,
    "dot_vwap_outside_body_2021": dot_wick,
}


def signals_for(name, books):
    pred = PREDICATES.get(name)
    coin = COIN.get(name)
    if pred is None or coin is None:
        raise SystemExit("unknown rule %s" % name)
    out = set()
    for day in p5.daterange("2020-12-31", "2021-12-30"):
        if any(day not in books[sym] for sym in ORDER):
            continue
        if pred(books[coin][day]):
            out.add(day)
    return out


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    above = (10.0, 12.0, 9.0, 11.0, 10.5)
    equal_close = (10.0, 12.0, 9.0, 10.5, 10.5)
    below = (10.0, 12.0, 9.0, 10.0, 10.5)
    if not btc_above(above) or btc_above(equal_close) or btc_above(below):
        raise SystemExit("btc above")
    crossed = (10.0, 13.0, 9.0, 12.0, 11.0)
    flat_open = (11.0, 13.0, 9.0, 12.0, 11.0)
    down_through = (12.0, 13.0, 9.0, 10.0, 11.0)
    if not eth_cross(crossed) or eth_cross(flat_open) or eth_cross(down_through):
        raise SystemExit("eth cross")
    nearer = (10.0, 12.0, 9.0, 11.0, 10.8)
    same_dist = (10.0, 13.0, 9.0, 12.0, 11.0)
    farther = (10.0, 14.0, 9.0, 13.0, 11.0)
    if not bnb_near(nearer) or bnb_near(same_dist) or bnb_near(farther):
        raise SystemExit("bnb near")
    if not xrp_far(farther) or xrp_far(same_dist) or xrp_far(nearer):
        raise SystemExit("xrp far")
    low_mid = (10.0, 12.0, 8.0, 11.0, 9.0)
    mid = (10.0, 12.0, 8.0, 11.0, 10.0)
    high_mid = (10.0, 12.0, 8.0, 11.0, 11.0)
    if not ltc_mid(low_mid) or ltc_mid(mid) or ltc_mid(high_mid):
        raise SystemExit("ltc mid")
    body_up = (11.0, 13.0, 9.0, 12.0, 10.0)
    body_split = (11.0, 13.0, 8.0, 9.0, 10.0)
    body_touch = (11.0, 13.0, 9.0, 12.0, 11.0)
    if not link_body(body_up) or link_body(body_split) or link_body(body_touch):
        raise SystemExit("link body")
    body_down = (8.0, 11.0, 7.0, 9.0, 10.0)
    body_up_ada = (11.0, 13.0, 9.0, 12.0, 10.0)
    body_touch_ada = (9.0, 11.0, 7.0, 8.0, 9.0)
    if not ada_body(body_down) or ada_body(body_up_ada) or ada_body(body_touch_ada):
        raise SystemExit("ada body")
    under = (10.0, 13.0, 8.0, 12.0, 9.0)
    inside = (10.0, 13.0, 8.0, 12.0, 11.0)
    on_low = (10.0, 13.0, 8.0, 12.0, 8.0)
    flat = (10.0, 12.0, 9.0, 10.0, 11.0)
    flat_on = (10.0, 12.0, 9.0, 10.0, 10.0)
    if not dot_wick(under) or dot_wick(inside) or dot_wick(on_low) or not dot_wick(flat) or dot_wick(flat_on):
        raise SystemExit("dot wick")


def input_jobs():
    jobs = []
    for sym in ORDER:
        end = "2022-01" if sym in ("BTCUSDT", "ETHUSDT") else "2021-12"
        for ym in p5.months("2020-12", end):
            name = "%s-1d-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "1d", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass51 inputs ready", flush=True)


def detail_for(name, bar):
    o, h, l, c, v = bar
    if name == "btc_close_above_vwap_2021":
        return "close %.8f vwap %.8f" % (c, v)
    if name == "eth_open_below_close_above_2021":
        return "open %.8f vwap %.8f close %.8f" % (o, v, c)
    if name == "bnb_close_closer_2021":
        return "open %.8f close %.8f vwap %.8f" % (o, c, v)
    if name == "ltc_vwap_below_mid_2021":
        return "high %.8f low %.8f vwap %.8f" % (h, l, v)
    if name == "xrp_close_farther_2021":
        return "open %.8f close %.8f vwap %.8f" % (o, c, v)
    if name == "link_body_above_2021":
        return "open %.8f close %.8f vwap %.8f" % (o, c, v)
    if name == "ada_body_below_2021":
        return "open %.8f close %.8f vwap %.8f" % (o, c, v)
    if name == "dot_vwap_outside_body_2021":
        return "open %.8f high %.8f low %.8f close %.8f vwap %.8f" % (o, h, l, c, v)
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
    for sym in ORDER:
        bars = load_bars(os.path.join(spot, sym, "1d"))
        missing = [day for day in span if day not in bars]
        if missing:
            raise SystemExit("daily bar gap %s %s" % (sym, missing))
        books[sym] = bars
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_close_above_vwap_2021", "btcvwap"),
        ("eth_open_below_close_above_2021", "ethcross"),
        ("bnb_close_closer_2021", "bnbnear"),
        ("ltc_vwap_below_mid_2021", "ltcmid"),
        ("xrp_close_farther_2021", "xrpfar"),
        ("link_body_above_2021", "linkbody"),
        ("ada_body_below_2021", "adabody"),
        ("dot_vwap_outside_body_2021", "dotwick"),
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
        print("FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f" % (
            name, signal, entries[0], detail_for(name, books[COIN[name]][signal]), entry, exit_px, move), flush=True)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 10:48:48 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin's Binance spot 1d bar. The weighted price is quote volume, field 7, divided by base volume, field 5. "
            "The open, the high, the low, and the close are fields 1 through 4. Trade count is not the signal. "
            "Taker-buy base and taker-buy quote are not the signal. The weighted price is not the taker-buy price. "
            "Comparing the taker-buy price with this weighted price is not this test. Yesterday is not read. "
            "The other seven coins are not the signal. This is not a ranking of which coin has more trades. "
            "The average trade size is not formed. The taker volume ratio is not formed. "
            "Same-day trade-count rankings are not rerun, and that ranking method is not changed. "
            "Hourly session blocks, clock-hour comparisons, and path length are not rerun, and that coin is not swapped. "
            "The taker-buy price against the open, the close, the high, or the low is not rerun. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
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
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "A numeric clear on this daily open is not a testing row. "
            "This weighted price is not a stand-in for trade-count rankings, for hourly session structure, for the taker-price family, for the eight-coin sign count, for index-versus-spot bars, for hourly price extremes, for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full spot hour set and stay missing on that hourly tape. The year is not started later. This screen does not read that tape. "
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
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2, to 19, to 3, to 20, to 35, to 58, to 9, to 25, to 32, to 17, to 11, to 8, or to 42, and no year is extended. "
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
            raise SystemExit("summary_pass51.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
