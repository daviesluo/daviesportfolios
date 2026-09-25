"""Eight frozen Revolut X screens. Spot open-to-close signs, eight mechanisms.

Reads the eight rule texts hashed at 2026-09-25 10:00:12 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass47.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
The size of one open-to-close move is not compared with another's.
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
Term-basis sign comparisons are not rerun, and the no-entry sign pattern is not flipped.
The taker ratio and the average trade size are not formed.
The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53,
to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2,
to 19, to 3, to 20, to 35, or to 58, and no screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass47.py
    python3 docs/agents/scripts/fp5/screen_pass47.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass47")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass47.json")
FROZEN = "2026-09-25 10:00:12 UTC"
SHA = {
    "btcsix": "29a28efd1132e61f32065f6e284668a5a3636624f5e11f76ebff13878b7e4b18",
    "ethlone": "b1067a37965496e5639a05ee0cd34093395defb976af34960e0143e8668c17d0",
    "bnbflip": "dd14ae78ec797f7b5626cd39c19d6013ea18b0f9bd2dfb02fa82a1634f1091fc",
    "ltchalf": "a55be157ff19602de163fbd39828a3a5b87d12932f26d3be5158d29cc7540e24",
    "xrpsep": "185de1407eeebe96a714c9822ba091abe3fba33ef5bdc4f07e02253141bd7850",
    "linkeven": "e6e5fa03371d96c8b0c8ea6eb488f38377b829a082786f8ccec268dbfb3ebae5",
    "adahead": "42e3fe07cf37d835227005fe25f530b7fcea0dabdd649c47d6a5b8f4efeb6317",
    "dotpair": "f8be2fdf9a9cc35ea87564a60db88558a8d39dcc0c4edbd0bbbba460ade4a16d",
}
ORDER = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")


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
    if row is None:
        return False
    opened, high, low, close = row
    return (opened > 0 and high > 0 and low > 0 and close > 0 and high >= low
            and high >= opened and high >= close and low <= opened and low <= close)


def load_ohlc(folder):
    """Open, high, low, close. The signal reads the open and the close."""
    grouped = {}
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 5:
            raise SystemExit("ohlc field gap in %s" % folder)
        day = p5.ymd(p30.stamp_of(int(parts[0])))
        row = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]))
        grouped.setdefault(day, []).append(row)
    bars = {}
    for day, group in grouped.items():
        if any(not usable(row) for row in group):
            continue
        opens = {row[0] for row in group}
        closes = {row[3] for row in group}
        if len(opens) != 1 or len(closes) != 1:
            continue
        bars[day] = group[0]
    return bars


def sign_of(row):
    opened, _high, _low, close = row
    if close > opened:
        return 1
    if close < opened:
        return -1
    return 0


def signs_of(rows):
    return [sign_of(row) for row in rows]


def btc_six(signs):
    return signs.count(1) == 6


def eth_lone(signs):
    if signs[0] == 0:
        return False
    return all(item == -signs[0] for item in signs[1:])


def bnb_flip(signs):
    if any(item == 0 for item in signs):
        return False
    return sum(signs[i] != signs[i + 1] for i in range(7)) == 1


def ltc_half(signs):
    first, last = signs[:4], signs[4:]
    return first.count(1) > first.count(-1) and last.count(-1) > last.count(1)


def xrp_sep(signs):
    if signs.count(1) < 1:
        return False
    return all(not (signs[i] == 1 and signs[i + 1] == 1) for i in range(7))


def link_even(signs):
    even = sum(1 for i in (0, 2, 4, 6) if signs[i] == 1)
    odd = sum(1 for i in (1, 3, 5, 7) if signs[i] == 1)
    return even > odd


def ada_head(signs):
    return all(item == 1 for item in signs[:4]) and any(item != 1 for item in signs[4:])


def dot_pair(signs):
    agrees = 0
    disagrees = 0
    for left, right in ((0, 1), (2, 3), (4, 5), (6, 7)):
        if signs[left] == 0 or signs[right] == 0:
            return False
        if signs[left] == signs[right]:
            agrees += 1
        elif signs[left] == -signs[right]:
            disagrees += 1
        else:
            return False
    return agrees == 3 and disagrees == 1


def signals_for(name, tape):
    pred = {
        "btc_exact_six_2021": btc_six,
        "eth_lone_sign_2021": eth_lone,
        "bnb_one_flip_2021": bnb_flip,
        "ltc_half_split_2021": ltc_half,
        "xrp_separated_2021": xrp_sep,
        "link_even_places_2021": link_even,
        "ada_head_up_2021": ada_head,
        "dot_three_pairs_2021": dot_pair,
    }.get(name)
    if pred is None:
        raise SystemExit("unknown rule %s" % name)
    return {day for day, rows in tape.items() if pred(signs_of(rows))}


def self_check():
    p5.self_check()
    six = [1, 1, 1, 1, 1, 1, -1, -1]
    if not btc_six(six) or btc_six([1, 1, 1, 1, 1, 1, 1, -1]) or btc_six([1, 1, 1, 1, 1, 0, -1, -1]):
        raise SystemExit("btc six")
    lone = [1, -1, -1, -1, -1, -1, -1, -1]
    if not eth_lone(lone) or not eth_lone([-item for item in lone]):
        raise SystemExit("eth lone")
    if eth_lone([1, -1, -1, -1, -1, -1, -1, 1]):
        raise SystemExit("eth lone broken")
    one = [1, 1, 1, 1, -1, -1, -1, -1]
    if not bnb_flip(one) or bnb_flip([1, -1, 1, -1, 1, -1, 1, -1]) or bnb_flip([1] * 8):
        raise SystemExit("bnb flip")
    if bnb_flip([1, 1, 0, -1, -1, -1, -1, -1]):
        raise SystemExit("bnb flat")
    half = [1, 1, 1, -1, -1, -1, -1, 1]
    if not ltc_half(half) or ltc_half([1, 1, -1, -1, -1, -1, -1, 1]) or ltc_half(half[::-1]):
        raise SystemExit("ltc half")
    sep = [1, -1, 1, -1, 1, -1, 1, -1]
    if not xrp_sep(sep) or xrp_sep([1, 1, -1, -1, -1, -1, -1, -1]) or xrp_sep([-1] * 8):
        raise SystemExit("xrp sep")
    if not link_even([1, -1, 1, -1, 1, 0, -1, -1]) or link_even([1, 1, 1, 1, -1, -1, -1, -1]):
        raise SystemExit("link even")
    if link_even([-1, 1, -1, 1, -1, 1, -1, 1]):
        raise SystemExit("link even reversed")
    head = [1, 1, 1, 1, 1, 1, 1, -1]
    if not ada_head(head) or ada_head([1] * 8) or ada_head([-1, 1, 1, 1, -1, -1, -1, -1]):
        raise SystemExit("ada head")
    pairs = [1, 1, -1, -1, 1, 1, 1, -1]
    if not dot_pair(pairs) or dot_pair([1, 1, -1, -1, 1, 1, 1, 1]) or dot_pair([1, 1, -1, -1, 1, -1, 1, -1]):
        raise SystemExit("dot pair")
    if dot_pair([1, 1, -1, -1, 1, 1, 1, 0]):
        raise SystemExit("dot flat")


def input_jobs():
    jobs = []
    for sym in ORDER:
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
    print("pass47 inputs ready", flush=True)


def fmt(value):
    return "%.8f" % value


def mark_of(row):
    opened, _high, _low, close = row
    if close > opened:
        return "+"
    if close < opened:
        return "-"
    return "0"


def describe(name, signal, btc_opens, rows):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    detail = " ".join(
        "%s %s/%s %s" % (sym[:3], fmt(row[0]), fmt(row[3]), mark_of(row))
        for sym, row in zip(ORDER, rows))
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
    books = {sym: load_ohlc(os.path.join(spot_root, sym, "1d")) for sym in ORDER}
    tape = {}
    for day in span:
        rows = []
        for sym in ORDER:
            row = books[sym].get(day)
            if row is None:
                raise SystemExit("spot gap %s %s" % (sym, day))
            rows.append(row)
        tape[day] = rows
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_exact_six_2021", "btcsix"),
        ("eth_lone_sign_2021", "ethlone"),
        ("bnb_one_flip_2021", "bnbflip"),
        ("ltc_half_split_2021", "ltchalf"),
        ("xrp_separated_2021", "xrpsep"),
        ("link_even_places_2021", "linkeven"),
        ("ada_head_up_2021", "adahead"),
        ("dot_three_pairs_2021", "dotpair"),
    )
    kills = {}
    for name, key in specs:
        signals = signals_for(name, tape)
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
        describe(name, p30.shift(entries[0], -1), btc_opens, tape[p30.shift(entries[0], -1)])
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 10:00:12 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is the Binance spot daily open and close, fields 1 and 4, for BTC, ETH, BNB, LTC, XRP, LINK, ADA, and DOT, in that order. "
            "The high, the low, and every volume column are not the signal. Yesterday is not read. "
            "An up sign is a close strictly above its own open. A down sign is a close strictly below its own open. "
            "The size of one open-to-close move is not compared with another's. "
            "How an index body and a spot body nest is not formed. "
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
            "These signs are not a stand-in for index-versus-spot bars, for hourly price extremes, for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full spot hour set and stay missing on that tape. The year is not started later. "
            "Each of these eight coins has a spot bar on every day from 2020-12-31 through 2021-12-31. "
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
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2, to 19, to 3, to 20, to 35, or to 58, and no year is extended. "
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
            raise SystemExit("summary_pass47.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
