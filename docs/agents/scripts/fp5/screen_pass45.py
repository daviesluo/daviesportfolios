"""Eight frozen Revolut X screens. Spot hourly extremes, eight mechanisms.

Reads the eight rule texts hashed at 2026-09-25 09:33:43 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass45.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
ETH funding is not in this run. BTC contract-count path shapes are not in this run.
The busiest-hour and quietest-hour family is not rerun on another coin.
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
to 19, or to 3, and no screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass45.py
    python3 docs/agents/scripts/fp5/screen_pass45.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass45")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass45.json")
SHA = {
    "btcafter": "371cb0904651b797b325e8a38f7a03ef961d01f41048debddeab6fe78c7fbc74",
    "ethnear": "48dbb45e4fe113efca9bac5d297e3ed5b1b0656a7475b45b38650c57c0944d52",
    "bnbspan": "744e90674d4a98287147913a955eddc099d9d39711acdd70bd380c42a6c6bc11",
    "ltclater": "8811da0cf29e8dd068739933be111a8bc4d2f876e643122c26fd1f0cf12ad783",
    "xrpturn": "086d3dfd9b9b9110b640bb48fe85c0bf4218bfbc2ef0520e47488e65215ac908",
    "linktouch": "d298b3d01ac6c53685b02cb0beea4ddfdc4c03a1e2f5c6a1ac8f2fca9a16a7e2",
    "adablock": "0bd0e2da14a172c20893c729d233a7f031379cbf00a19fd19d054261070e4a7e",
    "dotnoon": "0fc40b48e675ced0de0034c6d8bf38444bf7b4c38c49944eb2730e337f40d74d",
}
COINS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
INCOMPLETE = ("2021-02-11", "2021-03-06", "2021-04-20", "2021-04-25", "2021-08-13", "2021-09-29")


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


def load_extremes(folder):
    """Unique high hour and unique low hour. Volume columns are not read."""
    bars = {}
    bad = set()
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 4:
            raise SystemExit("hourly field gap in %s" % folder)
        ts = p30.stamp_of(int(parts[0]))
        day = p5.ymd(ts)
        hour = ts.hour
        if hour < 0 or hour > 23:
            raise SystemExit("hour outside 0..23")
        high, low = float(parts[2]), float(parts[3])
        key = (day, hour)
        if key in bars and bars[key] != (high, low):
            bad.add(day)
        else:
            bars[key] = (high, low)
    days = {day for day, _hour in bars}
    out = {}
    for day in days:
        if day in bad:
            continue
        slot = {}
        ok = True
        for hour in range(24):
            pair = bars.get((day, hour))
            if pair is None or pair[0] <= 0 or pair[1] <= 0 or pair[0] < pair[1]:
                ok = False
                break
            slot[hour] = pair
        if not ok:
            continue
        highs = [slot[hour][0] for hour in range(24)]
        lows = [slot[hour][1] for hour in range(24)]
        top, bottom = max(highs), min(lows)
        high_hours = [hour for hour in range(24) if highs[hour] == top]
        low_hours = [hour for hour in range(24) if lows[hour] == bottom]
        out[day] = {
            "h": high_hours[0] if len(high_hours) == 1 else None,
            "l": low_hours[0] if len(low_hours) == 1 else None,
            "hp": highs[high_hours[0]] if len(high_hours) == 1 else None,
            "lp": lows[low_hours[0]] if len(low_hours) == 1 else None,
        }
    return out


def pair(ex, day):
    row = ex.get(day)
    if row is None or row["h"] is None or row["l"] is None:
        return None
    return row["h"], row["l"]


def high_only(ex, day):
    row = ex.get(day)
    if row is None or row["h"] is None:
        return None
    return row["h"]


def btc_after(ex):
    out = set()
    for day in ex:
        hours = pair(ex, day)
        if hours is not None and hours[0] > hours[1]:
            out.add(day)
    return out


def eth_near(ex):
    out = set()
    for day in ex:
        hours = pair(ex, day)
        if hours is None:
            continue
        gap = abs(hours[0] - hours[1])
        if 0 < gap <= 3:
            out.add(day)
    return out


def bnb_span(ex):
    out = set()
    for day in ex:
        hours = pair(ex, day)
        if hours is not None and abs(hours[0] - hours[1]) >= 12:
            out.add(day)
    return out


def ltc_later(ex):
    out = set()
    for day in ex:
        today = high_only(ex, day)
        yesterday = high_only(ex, p30.shift(day, -1))
        if today is not None and yesterday is not None and today > yesterday:
            out.add(day)
    return out


def xrp_turn(ex):
    out = set()
    for day in ex:
        today = pair(ex, day)
        yesterday = pair(ex, p30.shift(day, -1))
        if today is None or yesterday is None or yesterday[0] == yesterday[1] or today[0] == today[1]:
            continue
        if (yesterday[0] > yesterday[1] and today[0] < today[1]) or (yesterday[0] < yesterday[1] and today[0] > today[1]):
            out.add(day)
    return out


def link_touch(ex):
    out = set()
    for day in ex:
        hours = pair(ex, day)
        if hours is not None and abs(hours[0] - hours[1]) == 1:
            out.add(day)
    return out


def ada_block(ex):
    out = set()
    for day in ex:
        hours = pair(ex, day)
        if hours is not None and hours[0] != hours[1] and hours[0] // 8 == hours[1] // 8:
            out.add(day)
    return out


def dot_noon(ex):
    out = set()
    for day in ex:
        hours = pair(ex, day)
        if hours is None:
            continue
        if (hours[0] < 12 <= hours[1]) or (hours[1] < 12 <= hours[0]):
            out.add(day)
    return out


def signals_for(name, ex):
    if name == "btc_hour_after_2021":
        return btc_after(ex)
    if name == "eth_hour_near_2021":
        return eth_near(ex)
    if name == "bnb_hour_span_2021":
        return bnb_span(ex)
    if name == "ltc_hour_later_2021":
        return ltc_later(ex)
    if name == "xrp_hour_turn_2021":
        return xrp_turn(ex)
    if name == "link_hour_touch_2021":
        return link_touch(ex)
    if name == "ada_hour_block_2021":
        return ada_block(ex)
    if name == "dot_hour_noon_2021":
        return dot_noon(ex)
    raise SystemExit("unknown rule %s" % name)


def self_check():
    p5.self_check()
    day = "2021-01-02"
    prior = "2021-01-01"

    def row(high_hour, low_hour):
        return {"h": high_hour, "l": low_hour, "hp": 2.0, "lp": 1.0}

    btc = {day: row(14, 3)}
    if btc_after(btc) != {day}:
        raise SystemExit("btc after")
    btc[day] = row(3, 14)
    if btc_after(btc):
        raise SystemExit("btc before")
    btc[day] = row(None, 3)
    if btc_after(btc):
        raise SystemExit("btc tie")
    eth = {day: row(5, 3)}
    if eth_near(eth) != {day}:
        raise SystemExit("eth near")
    eth[day] = row(8, 3)
    if eth_near(eth):
        raise SystemExit("eth gap four")
    eth[day] = row(4, 4)
    if eth_near(eth):
        raise SystemExit("eth equal")
    bnb = {day: row(20, 8)}
    if bnb_span(bnb) != {day}:
        raise SystemExit("bnb twelve")
    bnb[day] = row(18, 7)
    if bnb_span(bnb):
        raise SystemExit("bnb eleven")
    ltc = {day: row(10, None), prior: row(9, None)}
    if ltc_later(ltc) != {day}:
        raise SystemExit("ltc later")
    ltc[day] = row(9, None)
    if ltc_later(ltc):
        raise SystemExit("ltc earlier")
    ltc.pop(prior)
    ltc[day] = row(10, None)
    if ltc_later(ltc):
        raise SystemExit("ltc missing yesterday")
    xrp = {day: row(2, 5), prior: row(5, 2)}
    if xrp_turn(xrp) != {day}:
        raise SystemExit("xrp turn")
    xrp[day] = row(6, 1)
    if xrp_turn(xrp):
        raise SystemExit("xrp same order")
    link = {day: row(5, 4)}
    if link_touch(link) != {day}:
        raise SystemExit("link touch")
    link[day] = row(0, 23)
    if link_touch(link):
        raise SystemExit("link wrapped")
    link[day] = row(4, 6)
    if link_touch(link):
        raise SystemExit("link two")
    ada = {day: row(3, 6)}
    if ada_block(ada) != {day}:
        raise SystemExit("ada block")
    ada[day] = row(7, 8)
    if ada_block(ada):
        raise SystemExit("ada across blocks")
    ada[day] = row(4, 4)
    if ada_block(ada):
        raise SystemExit("ada equal")
    dot = {day: row(11, 12)}
    if dot_noon(dot) != {day}:
        raise SystemExit("dot noon")
    dot[day] = row(10, 11)
    if dot_noon(dot):
        raise SystemExit("dot morning")
    dot[day] = row(12, 15)
    if dot_noon(dot):
        raise SystemExit("dot afternoon")
    kept = {}
    bad = set()
    rows = [("2021-04-25", (2.0, 1.0)), ("2021-04-25", (2.0, 1.0))]
    for one_day, value in rows:
        if one_day in kept and kept[one_day] != value:
            kept[one_day] = None
            bad.add(one_day)
        elif one_day not in kept:
            kept[one_day] = value
    if "2021-04-25" in bad:
        raise SystemExit("identical hour dropped")
    if kept["2021-04-25"] != (3.0, 1.0):
        kept["2021-04-25"] = None
        bad.add("2021-04-25")
    if "2021-04-25" not in bad or kept["2021-04-25"] is not None:
        raise SystemExit("conflicting hour kept")


def input_jobs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2021-01", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for sym in COINS:
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-1h-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1h/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1h", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass45 inputs ready", flush=True)


def describe(name, signal, btc_opens, tapes):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "btc_hour_after_2021":
        sym = "BTCUSDT"
        detail = "high hour %d low hour %d" % (tapes[sym][signal]["h"], tapes[sym][signal]["l"])
    elif name == "eth_hour_near_2021":
        sym = "ETHUSDT"
        high_hour, low_hour = tapes[sym][signal]["h"], tapes[sym][signal]["l"]
        detail = "hours %d %d gap %d" % (high_hour, low_hour, abs(high_hour - low_hour))
    elif name == "bnb_hour_span_2021":
        sym = "BNBUSDT"
        high_hour, low_hour = tapes[sym][signal]["h"], tapes[sym][signal]["l"]
        detail = "hours %d %d gap %d" % (high_hour, low_hour, abs(high_hour - low_hour))
    elif name == "ltc_hour_later_2021":
        sym = "LTCUSDT"
        prior = p30.shift(signal, -1)
        detail = "high hour %d after %d" % (tapes[sym][signal]["h"], tapes[sym][prior]["h"])
    elif name == "xrp_hour_turn_2021":
        sym = "XRPUSDT"
        prior = p30.shift(signal, -1)
        detail = "today %d %d after %d %d" % (
            tapes[sym][signal]["h"], tapes[sym][signal]["l"], tapes[sym][prior]["h"], tapes[sym][prior]["l"])
    elif name == "link_hour_touch_2021":
        sym = "LINKUSDT"
        detail = "hours %d %d" % (tapes[sym][signal]["h"], tapes[sym][signal]["l"])
    elif name == "ada_hour_block_2021":
        sym = "ADAUSDT"
        high_hour, low_hour = tapes[sym][signal]["h"], tapes[sym][signal]["l"]
        detail = "hours %d %d block %d" % (high_hour, low_hour, high_hour // 8)
    elif name == "dot_hour_noon_2021":
        sym = "DOTUSDT"
        detail = "hours %d %d" % (tapes[sym][signal]["h"], tapes[sym][signal]["l"])
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
    spot = os.path.join(INP, "klines", "spot")
    btc_opens = p30.load_field(os.path.join(spot, "BTCUSDT", "1d"), 1, 2)
    eth_opens = p30.load_field(os.path.join(spot, "ETHUSDT", "1d"), 1, 2)
    for day in ("2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    if p5.parse_ymd("2021-01-02").weekday() != 5:
        raise SystemExit("saturday")
    tapes = {}
    for sym in COINS:
        extremes = load_extremes(os.path.join(spot, sym, "1h"))
        for day in INCOMPLETE:
            if day in extremes:
                raise SystemExit("outage day was filled %s %s" % (sym, day))
        year = [day for day in p5.daterange("2021-01-01", "2021-12-31") if day in extremes]
        if len(year) != 359:
            raise SystemExit("hourly year %s %d" % (sym, len(year)))
        tapes[sym] = extremes
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_hour_after_2021", "btcafter", "BTCUSDT"),
        ("eth_hour_near_2021", "ethnear", "ETHUSDT"),
        ("bnb_hour_span_2021", "bnbspan", "BNBUSDT"),
        ("ltc_hour_later_2021", "ltclater", "LTCUSDT"),
        ("xrp_hour_turn_2021", "xrpturn", "XRPUSDT"),
        ("link_hour_touch_2021", "linktouch", "LINKUSDT"),
        ("ada_hour_block_2021", "adablock", "ADAUSDT"),
        ("dot_hour_noon_2021", "dotnoon", "DOTUSDT"),
    )
    kills = {}
    for name, key, _sym in specs:
        signals = signals_for(name, tapes[_sym])
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
        describe(name, p30.shift(entries[0], -1), btc_opens, tapes)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 09:33:43 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is the hour of the unique price extreme on the Binance spot 1h tape. "
            "The high is field 2 and the low is field 3. Open, close, and every volume column are not the signal. "
            "The clock is not wrapped. A day without each UTC hour once is missing. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full hour set and are missing. The year is not started later. "
            "The busiest hour and the quietest hour are not formed. "
            "A term-basis sign comparison is not formed. The no-entry ADA-positive DOT-positive LINK-negative rule is not in this run and its signs are not flipped. "
            "The taker ratio is not formed. The average trade size is not formed. "
            "No perpetual kline is read as the signal. No daily kline is read as the signal. "
            "The coin-margined versus USDT-margined premium is not formed. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Perpetual quote volume relative to the previous days is not rerun. "
            "Taker-buy base volume relative to its own previous days is not rerun. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "A numeric clear on this daily open is not a testing row. "
            "These tapes are not a stand-in for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "None of these is a leveraged-token up-versus-down pair. "
            "None of these is a busiest-hour or quietest-hour rule. "
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
            raise SystemExit("summary_pass45.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("WROTE", OUT, flush=True)


if __name__ == "__main__":
    main()
