"""Eight frozen Revolut X screens. Fifteen-minute trade counts, open to open.

Reads the eight rule texts hashed at 2026-09-25 11:44:56 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass56.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
The fifteen-minute close span, open span, mean, and median are not rerun.
The BNB close span wider than the open span is not a pass and its fill is not
changed. No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass56.py
    python3 docs/agents/scripts/fp5/screen_pass56.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass56")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass56.json")
FROZEN = "2026-09-25 11:44:56 UTC"
SHA = {
    "btcmass": "ad4d1216ba654e390dae5d9efffe4d1ff7a8e6b8d841b74d343a2d0bff1c1f60",
    "ethstep": "2b4bc2ee79f99e57e32a6bbba7a67b6f76ac43f26f72b796f40edd68b5f00f2c",
    "bnbend": "d21806a4e2c9a229bfccf3f1e98383eac22fff7d7476ab003a08e33b34b55eaa",
    "ltcpar": "2d3e34eece34f083bf852e386274fc2a9ebc3ddd6f227ceaaf2b260f2470f041",
    "xrpabv": "a7e06b79ffa86b44637b9066e4e94e88d4d956d82e5c0b78a2eee6fc9476b2c1",
    "linkl4": "0375771976be33d1c121a8369ddfda2d0974c1b6b3aa47e0c18882de302500b0",
    "adadiv": "a1fb9c9ffc32aba8f1bac3c97766c6b9c313d0ab9ea502562dedb64038a6787d",
    "dotstep": "e715a2fb365808afde2f72080263908fc1cd2a25a6391962a6939227981c3cd0",
}
ORDER = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
GAP = ("2021-02-11", "2021-03-06", "2021-04-20", "2021-04-25", "2021-08-13", "2021-09-29")
COUNTED = {
    "btc_up_trade_mass_above_down_2021": 173,
    "eth_trade_steps_up_above_down_2021": 20,
    "bnb_last_trades_above_first_2021": 75,
    "ltc_odd_slot_trades_above_even_2021": 84,
    "xrp_bars_above_first_trade_count_2021": 59,
    "link_lag4_trade_steps_up_above_down_2021": 69,
    "ada_base_up_trades_down_above_reverse_2021": 197,
    "dot_last_trade_step_above_first_2021": 21,
}
COIN = {
    "btc_up_trade_mass_above_down_2021": "BTCUSDT",
    "eth_trade_steps_up_above_down_2021": "ETHUSDT",
    "bnb_last_trades_above_first_2021": "BNBUSDT",
    "ltc_odd_slot_trades_above_even_2021": "LTCUSDT",
    "xrp_bars_above_first_trade_count_2021": "XRPUSDT",
    "link_lag4_trade_steps_up_above_down_2021": "LINKUSDT",
    "ada_base_up_trades_down_above_reverse_2021": "ADAUSDT",
    "dot_last_trade_step_above_first_2021": "DOTUSDT",
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
        if len(parts) < 9:
            raise SystemExit("bar field gap in %s" % folder)
        ts = p30.stamp_of(int(parts[0]))
        if ts.second != 0 or ts.microsecond != 0 or ts.minute not in (0, 15, 30, 45):
            raise SystemExit("off-grid bar in %s" % folder)
        day = p5.ymd(ts)
        slot = ts.hour * 4 + ts.minute // 15
        o, h, l, c = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
        base = float(parts[5])
        trades = float(parts[8])
        if not (o > 0 and h > 0 and l > 0 and c > 0):
            raise SystemExit("nonpositive bar %s %s" % (folder, day))
        if h < l or h < max(o, c) or l > min(o, c):
            raise SystemExit("bar order %s %s" % (folder, day))
        if base < 0 or trades < 0 or trades != int(trades):
            raise SystemExit("volume %s %s" % (folder, day))
        key = (day, slot)
        if key in got:
            raise SystemExit("duplicate slot %s %s %s" % (folder, day, slot))
        got[key] = (o, c, base, int(trades))
    by_day = {}
    for (day, slot), bar in got.items():
        by_day.setdefault(day, {})[slot] = bar
    days = {}
    for day, slots in by_day.items():
        if len(slots) == 96 and all(i in slots for i in range(96)):
            days[day] = [slots[i] for i in range(96)]
    return days


def btc_mass(rows):
    up = sum(row[3] for row in rows if row[1] > row[0])
    down = sum(row[3] for row in rows if row[1] < row[0])
    return up > down


def eth_steps(rows):
    trades = [row[3] for row in rows]
    up = down = 0
    for i in range(1, len(trades)):
        if trades[i] > trades[i - 1]:
            up += 1
        elif trades[i] < trades[i - 1]:
            down += 1
    return up > down


def bnb_end(rows):
    return rows[-1][3] > rows[0][3]


def ltc_parity(rows):
    if len(rows) % 2 != 0:
        raise SystemExit("parity length")
    odd = sum(rows[i][3] for i in range(1, len(rows), 2))
    even = sum(rows[i][3] for i in range(0, len(rows), 2))
    return odd > even


def xrp_above(rows):
    anchor = rows[0][3]
    above = below = 0
    for row in rows[1:]:
        if row[3] > anchor:
            above += 1
        elif row[3] < anchor:
            below += 1
    return above > below


def link_lag(rows):
    trades = [row[3] for row in rows]
    if len(trades) <= 4:
        raise SystemExit("lag length")
    up = down = 0
    for i in range(4, len(trades)):
        if trades[i] > trades[i - 4]:
            up += 1
        elif trades[i] < trades[i - 4]:
            down += 1
    return up > down


def ada_div(rows):
    left = right = 0
    for i in range(1, len(rows)):
        base_up = rows[i][2] > rows[i - 1][2]
        base_down = rows[i][2] < rows[i - 1][2]
        tr_up = rows[i][3] > rows[i - 1][3]
        tr_down = rows[i][3] < rows[i - 1][3]
        if base_up and tr_down:
            left += 1
        elif base_down and tr_up:
            right += 1
    return left > right


def dot_step(rows):
    trades = [row[3] for row in rows]
    if len(trades) < 3:
        raise SystemExit("step length")
    opening = trades[1] - trades[0]
    closing = trades[-1] - trades[-2]
    return opening > 0 and closing > opening


PREDICATES = {
    "btc_up_trade_mass_above_down_2021": btc_mass,
    "eth_trade_steps_up_above_down_2021": eth_steps,
    "bnb_last_trades_above_first_2021": bnb_end,
    "ltc_odd_slot_trades_above_even_2021": ltc_parity,
    "xrp_bars_above_first_trade_count_2021": xrp_above,
    "link_lag4_trade_steps_up_above_down_2021": link_lag,
    "ada_base_up_trades_down_above_reverse_2021": ada_div,
    "dot_last_trade_step_above_first_2021": dot_step,
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


def bar(open_px, close, base, trades):
    return (open_px, close, base, trades)


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    up = bar(10.0, 11.0, 1.0, 5)
    down = bar(10.0, 9.0, 1.0, 1)
    flat = bar(10.0, 10.0, 1.0, 100)
    if not btc_mass([up, down]) or btc_mass([bar(10.0, 11.0, 1.0, 1), bar(10.0, 9.0, 1.0, 5)]) or btc_mass([up, bar(10.0, 9.0, 1.0, 5), flat]):
        raise SystemExit("btc mass")
    if not eth_steps([bar(1, 1, 1, 1), bar(1, 1, 1, 2), bar(1, 1, 1, 3)]) or eth_steps([bar(1, 1, 1, 3), bar(1, 1, 1, 2), bar(1, 1, 1, 1)]) or eth_steps([bar(1, 1, 1, 1), bar(1, 1, 1, 2), bar(1, 1, 1, 1)]):
        raise SystemExit("eth steps")
    if not bnb_end([bar(1, 1, 1, 1), bar(1, 1, 1, 2)]) or bnb_end([bar(1, 1, 1, 2), bar(1, 1, 1, 1)]) or bnb_end([bar(1, 1, 1, 3), bar(1, 1, 1, 3)]):
        raise SystemExit("bnb end")
    odd = [bar(1, 1, 1, 1), bar(1, 1, 1, 5), bar(1, 1, 1, 1), bar(1, 1, 1, 5)]
    even = [bar(1, 1, 1, 5), bar(1, 1, 1, 1), bar(1, 1, 1, 5), bar(1, 1, 1, 1)]
    tied = [bar(1, 1, 1, 2), bar(1, 1, 1, 2), bar(1, 1, 1, 2), bar(1, 1, 1, 2)]
    if not ltc_parity(odd) or ltc_parity(even) or ltc_parity(tied):
        raise SystemExit("ltc parity")
    if not xrp_above([bar(1, 1, 1, 1), bar(1, 1, 1, 3), bar(1, 1, 1, 0), bar(1, 1, 1, 4)]) or xrp_above([bar(1, 1, 1, 5), bar(1, 1, 1, 1), bar(1, 1, 1, 2), bar(1, 1, 1, 4)]) or xrp_above([bar(1, 1, 1, 2), bar(1, 1, 1, 2), bar(1, 1, 1, 3), bar(1, 1, 1, 1)]):
        raise SystemExit("xrp above")
    ones = [bar(1, 1, 1, 1)] * 4
    threes = [bar(1, 1, 1, 3)] * 4
    if not link_lag(ones + threes) or link_lag(threes + ones) or link_lag(ones + ones):
        raise SystemExit("link lag")
    mixed = ones + [bar(1, 1, 1, 2), bar(1, 1, 1, 0), bar(1, 1, 1, 1), bar(1, 1, 1, 1)]
    if link_lag(mixed):
        raise SystemExit("link lag tie")
    rise_fall = [bar(1, 1, 1, 5), bar(1, 1, 2, 4)]
    fall_rise = [bar(1, 1, 2, 4), bar(1, 1, 1, 5)]
    same = [bar(1, 1, 1, 1), bar(1, 1, 2, 2)]
    if not ada_div(rise_fall) or ada_div(fall_rise) or ada_div(same):
        raise SystemExit("ada div")
    if not dot_step([bar(1, 1, 1, 10), bar(1, 1, 1, 12), bar(1, 1, 1, 11), bar(1, 1, 1, 20)]):
        raise SystemExit("dot step fire")
    if dot_step([bar(1, 1, 1, 10), bar(1, 1, 1, 15), bar(1, 1, 1, 11), bar(1, 1, 1, 16)]):
        raise SystemExit("dot step equal")
    if dot_step([bar(1, 1, 1, 10), bar(1, 1, 1, 15), bar(1, 1, 1, 11), bar(1, 1, 1, 14)]):
        raise SystemExit("dot step smaller")
    if dot_step([bar(1, 1, 1, 10), bar(1, 1, 1, 9), bar(1, 1, 1, 11), bar(1, 1, 1, 20)]):
        raise SystemExit("dot step negative open")
    if dot_step([bar(1, 1, 1, 10), bar(1, 1, 1, 12), bar(1, 1, 1, 20), bar(1, 1, 1, 19)]):
        raise SystemExit("dot step negative close")


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
    print("pass56 inputs ready", flush=True)


def detail_for(name, rows):
    if name == "btc_up_trade_mass_above_down_2021":
        up = sum(row[3] for row in rows if row[1] > row[0])
        down = sum(row[3] for row in rows if row[1] < row[0])
        return "up-mass %d down-mass %d" % (up, down)
    if name == "eth_trade_steps_up_above_down_2021":
        trades = [row[3] for row in rows]
        up = sum(1 for i in range(1, len(trades)) if trades[i] > trades[i - 1])
        down = sum(1 for i in range(1, len(trades)) if trades[i] < trades[i - 1])
        return "up-steps %d down-steps %d" % (up, down)
    if name == "bnb_last_trades_above_first_2021":
        return "last %d first %d" % (rows[-1][3], rows[0][3])
    if name == "ltc_odd_slot_trades_above_even_2021":
        odd = sum(rows[i][3] for i in range(1, len(rows), 2))
        even = sum(rows[i][3] for i in range(0, len(rows), 2))
        return "odd %d even %d" % (odd, even)
    if name == "xrp_bars_above_first_trade_count_2021":
        anchor = rows[0][3]
        above = sum(1 for row in rows[1:] if row[3] > anchor)
        below = sum(1 for row in rows[1:] if row[3] < anchor)
        return "above %d below %d anchor %d" % (above, below, anchor)
    if name == "link_lag4_trade_steps_up_above_down_2021":
        trades = [row[3] for row in rows]
        up = sum(1 for i in range(4, len(trades)) if trades[i] > trades[i - 4])
        down = sum(1 for i in range(4, len(trades)) if trades[i] < trades[i - 4])
        return "lag-up %d lag-down %d" % (up, down)
    if name == "ada_base_up_trades_down_above_reverse_2021":
        left = right = 0
        for i in range(1, len(rows)):
            if rows[i][2] > rows[i - 1][2] and rows[i][3] < rows[i - 1][3]:
                left += 1
            elif rows[i][2] < rows[i - 1][2] and rows[i][3] > rows[i - 1][3]:
                right += 1
        return "base-up-trades-down %d base-down-trades-up %d" % (left, right)
    if name == "dot_last_trade_step_above_first_2021":
        trades = [row[3] for row in rows]
        return "opening %d closing %d" % (trades[1] - trades[0], trades[-1] - trades[-2])
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
        ("btc_up_trade_mass_above_down_2021", "btcmass"),
        ("eth_trade_steps_up_above_down_2021", "ethstep"),
        ("bnb_last_trades_above_first_2021", "bnbend"),
        ("ltc_odd_slot_trades_above_even_2021", "ltcpar"),
        ("xrp_bars_above_first_trade_count_2021", "xrpabv"),
        ("link_lag4_trade_steps_up_above_down_2021", "linkl4"),
        ("ada_base_up_trades_down_above_reverse_2021", "adadiv"),
        ("dot_last_trade_step_above_first_2021", "dotstep"),
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
            "Each rule was hashed at 2026-09-25 11:44:56 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin's Binance spot 15m bar. Trade count is field 8. "
            "Base volume is field 5 and is read only by the ADA disagreement. "
            "The open and the close are fields 1 and 4 and are read only by the BTC trade-mass split. "
            "Quote volume and the taker-buy fields are not the signal. "
            "A day needs each of the ninety-six slots from 00:00 through 23:45 once. "
            "Yesterday is not read. The other seven coins are not the signal. "
            "None of these fires on every complete day. None of these had zero entries. "
            "A count of DOT bars sitting strictly inside the previous two trade counts had no entries, and the opposite fired on every complete day. Neither was frozen. "
            "The fifteen-minute close span, the open span, the mean, and the median are not formed. That family is not rerun and its coin is not swapped. "
            "The BNB close span strictly wider than the open span is not a pass and its fill is not changed. "
            "Which bar is the widest, which bar has the largest volume, and how long a wick is are not formed. May is not dropped from the LINK high-bar lower-wick rule, and 40% is not loosened. "
            "A volume-weighted mean against an equal-weighted mean is not formed. The four rules that fired on every complete fifteen-minute day are not signals. "
            "This is not a count of up bars, a run length, or a count of new highs. The difference of 6 is not changed. "
            "The average trade size is not formed. The taker volume ratio is not formed. The taker-buy price is not formed. "
            "Same-day trade-count rankings across the eight coins are not rerun. "
            "The session volume-weighted price is not formed. "
            "The LTC weighted price strictly below the midpoint is not a pass and its fill is not changed. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "A numeric clear on this daily open is not a testing row. "
            "Hourly session blocks, clock-hour comparisons, and path length are not rerun. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full spot fifteen-minute set. Those days stay missing. The year is not started later. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "The 60-trip gate is not lowered to 20, to 21, to 59, to 14, to 16, or to 40, and no year is extended. "
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
            raise SystemExit("summary_pass56.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
