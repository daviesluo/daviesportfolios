"""Eight frozen Revolut X screens. USD-M quote volume, eight mechanisms.

Reads the eight rule texts hashed at 2026-09-25 09:00:49 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass42.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
ETH funding is not in this run. BTC contract-count path shapes are not in this run.
The busiest-hour and quietest-hour family is not rerun on another coin.
Leveraged-token up-versus-down pairs are not rerun on another coin.
Coin-margined trade-count rules are not rerun, and their fill is not changed.
The coin-margined three-day trade-count rise is not a pass and is not armed.
The coin-margined versus USDT-margined volume ratio is not formed.
The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53,
to 24, to 39, to 54, to 47, to 15, to 55, or to 44, and no screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass42.py
    python3 docs/agents/scripts/fp5/screen_pass42.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass42")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass42.json")
SHA = {
    "filsum": "18d6b716a7f6f16b9c05392b7c6d3859e2ef3ef2557d31a70d4484e5e9048781",
    "eosblock": "fe18b6294748e0638acb7e7430766ab5e9119a5bd834c6c1fa7b3acdc5377568",
    "trxlow": "738c8816fdcb41fdce1f371bbc1f753015cbad31f39927db12237270520c35a6",
    "bchskip": "28fb99711b998d71cec00bd085a8b2a2ba9b207a4eab50ebd9c81d9f5a4a8f87",
    "etcstep": "a8f935acdaee18b006270cc542fb9f468b969b050bfe9568d70ea469bc4b9e93",
    "xtzmix": "7cda1f14c8bfcdade01bff71cc99e6ef7fdabefde3466ff1987a08d086871e41",
    "xlm4": "ad72670d111f36de1b4791538907b244a7d7559180a783f95e6f6546eed8b357",
    "thetaone": "6c2ed550e5e128307f1187938d64183a42cbb73f49630914983741ad8969224a",
}
PAIRS = (
    ("filsum", "FILUSDT"),
    ("eosblock", "EOSUSDT"),
    ("trxlow", "TRXUSDT"),
    ("bchskip", "BCHUSDT"),
    ("etcstep", "ETCUSDT"),
    ("xtzmix", "XTZUSDT"),
    ("xlm4", "XLMUSDT"),
    ("thetaone", "THETAUSDT"),
)


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


def load_quote(folder):
    """Quote volume at field 7. Trade count is not read."""
    days = {}
    bad = set()
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 8:
            raise SystemExit("daily field gap in %s" % folder)
        day = p5.ymd(p30.stamp_of(int(parts[0])))
        value = float(parts[7])
        if day in days and days[day] != value:
            days[day] = None
            bad.add(day)
        elif day not in days:
            days[day] = value
    return {day: value for day, value in days.items() if value is not None and day not in bad}


def window(quotes, day, n):
    vals = []
    for i in range(n):
        prior = p30.shift(day, -i)
        if prior not in quotes:
            return None
        vals.append(quotes[prior])
    return vals


def sum_over(quotes):
    out = set()
    for day in quotes:
        vals = window(quotes, day, 3)
        if vals and vals[0] > vals[1] + vals[2]:
            out.add(day)
    return out


def block_over(quotes):
    out = set()
    for day in quotes:
        vals = window(quotes, day, 4)
        if vals and vals[0] + vals[1] > vals[2] + vals[3]:
            out.add(day)
    return out


def below_three(quotes):
    out = set()
    for day in quotes:
        vals = window(quotes, day, 4)
        if vals and vals[0] < vals[1] and vals[0] < vals[2] and vals[0] < vals[3]:
            out.add(day)
    return out


def every_other(quotes):
    out = set()
    for day in quotes:
        back2 = p30.shift(day, -2)
        back4 = p30.shift(day, -4)
        if day in quotes and back2 in quotes and back4 in quotes and quotes[day] > quotes[back2] > quotes[back4]:
            out.add(day)
    return out


def larger_step(quotes):
    out = set()
    for day in quotes:
        vals = window(quotes, day, 4)
        if not vals:
            continue
        older = vals[2] - vals[3]
        newer = vals[0] - vals[1]
        if older != 0 and newer != 0 and (older > 0) == (newer > 0) and abs(newer) > abs(older):
            out.add(day)
    return out


def outweighs(quotes):
    out = set()
    for day in quotes:
        vals = window(quotes, day, 3)
        if vals and vals[1] > 0 and vals[0] + vals[2] > 2 * vals[1]:
            out.add(day)
    return out


def four_sum(quotes):
    out = set()
    for day in quotes:
        vals = window(quotes, day, 8)
        if vals and sum(vals[0:4]) > sum(vals[4:8]):
            out.add(day)
    return out


def one_rise(quotes):
    out = set()
    for day in quotes:
        vals = window(quotes, day, 4)
        if not vals:
            continue
        steps = (vals[0] - vals[1], vals[1] - vals[2], vals[2] - vals[3])
        if all(step != 0 for step in steps) and sum(step > 0 for step in steps) == 1:
            out.add(day)
    return out


def signals_for(name, quotes):
    if name == "fil_um_sum_2021":
        return sum_over(quotes)
    if name == "eos_um_block_2021":
        return block_over(quotes)
    if name == "trx_um_low_2021":
        return below_three(quotes)
    if name == "bch_um_skip_2021":
        return every_other(quotes)
    if name == "etc_um_step_2021":
        return larger_step(quotes)
    if name == "xtz_um_mix_2021":
        return outweighs(quotes)
    if name == "xlm_um_four_2021":
        return four_sum(quotes)
    if name == "theta_um_one_2021":
        return one_rise(quotes)
    raise SystemExit("no signal for %s" % name)


def self_check():
    p30.self_check()
    summed = {"2021-01-01": 1.0, "2021-01-02": 2.0, "2021-01-03": 4.0}
    if sum_over(summed) != {"2021-01-03"}:
        raise SystemExit("sum")
    summed["2021-01-01"] = 2.0
    summed["2021-01-03"] = 4.0
    if sum_over(summed):
        raise SystemExit("sum tie")
    block = {"2021-01-01": 1.0, "2021-01-02": 1.0, "2021-01-03": 3.0, "2021-01-04": 3.0}
    if block_over(block) != {"2021-01-04"}:
        raise SystemExit("block")
    block["2021-01-03"] = 1.0
    block["2021-01-04"] = 1.0
    if "2021-01-04" in block_over(block):
        raise SystemExit("block tie")
    low = {"2021-01-01": 5.0, "2021-01-02": 4.0, "2021-01-03": 3.0, "2021-01-04": 2.0}
    if below_three(low) != {"2021-01-04"}:
        raise SystemExit("low")
    low["2021-01-04"] = 3.0
    if below_three(low):
        raise SystemExit("low tie")
    skip = {"2021-01-01": 1.0, "2021-01-03": 2.0, "2021-01-05": 3.0}
    if every_other(skip) != {"2021-01-05"}:
        raise SystemExit("skip")
    skip["2021-01-05"] = 2.0
    if every_other(skip):
        raise SystemExit("skip tie")
    step = {"2021-01-01": 1.0, "2021-01-02": 3.0, "2021-01-03": 2.0, "2021-01-04": 6.0}
    if larger_step(step) != {"2021-01-04"}:
        raise SystemExit("step")
    step["2021-01-03"] = 4.0
    step["2021-01-04"] = 6.0
    if larger_step(step):
        raise SystemExit("step tie")
    step["2021-01-01"] = 5.0
    step["2021-01-02"] = 1.0
    if larger_step(step):
        raise SystemExit("step opposite")
    step = {"2021-01-01": 1.0, "2021-01-02": 1.0, "2021-01-03": 2.0, "2021-01-04": 4.0}
    if larger_step(step):
        raise SystemExit("step zero")
    mix = {"2021-01-01": 1.0, "2021-01-02": 2.0, "2021-01-03": 4.0}
    if outweighs(mix) != {"2021-01-03"}:
        raise SystemExit("mix")
    mix["2021-01-03"] = 3.0
    if outweighs(mix):
        raise SystemExit("mix tie")
    mix["2021-01-02"] = 0.0
    mix["2021-01-03"] = 4.0
    if outweighs(mix):
        raise SystemExit("mix zero")
    four = {}
    for i, value in enumerate((1, 1, 1, 1, 2, 2, 2, 2), 1):
        four["2021-01-%02d" % i] = float(value)
    if four_sum(four) != {"2021-01-08"}:
        raise SystemExit("four")
    for i in range(5, 9):
        four["2021-01-%02d" % i] = 1.0
    if four_sum(four):
        raise SystemExit("four tie")
    one = {"2021-01-01": 1.0, "2021-01-02": 5.0, "2021-01-03": 4.0, "2021-01-04": 3.0}
    if one_rise(one) != {"2021-01-04"}:
        raise SystemExit("one")
    one["2021-01-04"] = 6.0
    if one_rise(one):
        raise SystemExit("one two rises")
    one = {"2021-01-01": 1.0, "2021-01-02": 5.0, "2021-01-03": 5.0, "2021-01-04": 3.0}
    if one_rise(one):
        raise SystemExit("one zero step")
    if sum_over({"2021-01-01": 1.0, "2021-01-03": 9.0}):
        raise SystemExit("missing day fired")
    kept = {}
    bad = set()
    rows = [("2021-04-25", 2.0), ("2021-04-25", 2.0)]
    for day, value in rows:
        if day in kept and kept[day] != value:
            kept[day] = None
            bad.add(day)
        elif day not in kept:
            kept[day] = value
    if "2021-04-25" in bad:
        raise SystemExit("identical day dropped")
    for day, value in (("2021-04-25", 3.0),):
        if day in kept and kept[day] != value:
            kept[day] = None
            bad.add(day)
    if "2021-04-25" not in bad or kept["2021-04-25"] is not None:
        raise SystemExit("conflicting day kept")


def input_jobs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2021-01", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for _key, sym in PAIRS:
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "futures/um/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "um", sym, "1d", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass42 inputs ready", flush=True)


def describe(name, signal, btc_opens, quotes):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "fil_um_sum_2021":
        vals = window(quotes, signal, 3)
        detail = "quote %.4f above %.4f + %.4f" % (vals[0], vals[1], vals[2])
    elif name == "eos_um_block_2021":
        vals = window(quotes, signal, 4)
        detail = "sum %.4f above %.4f" % (vals[0] + vals[1], vals[2] + vals[3])
    elif name == "trx_um_low_2021":
        vals = window(quotes, signal, 4)
        detail = "quote %.4f below %.4f %.4f %.4f" % (vals[0], vals[1], vals[2], vals[3])
    elif name == "bch_um_skip_2021":
        detail = "quote %.4f above %.4f above %.4f" % (
            quotes[signal], quotes[p30.shift(signal, -2)], quotes[p30.shift(signal, -4)])
    elif name == "etc_um_step_2021":
        vals = window(quotes, signal, 4)
        detail = "step %.4f after %.4f" % (vals[0] - vals[1], vals[2] - vals[3])
    elif name == "xtz_um_mix_2021":
        vals = window(quotes, signal, 3)
        detail = "%.4f + %.4f above twice %.4f" % (vals[0], vals[2], vals[1])
    elif name == "xlm_um_four_2021":
        vals = window(quotes, signal, 8)
        detail = "four %.4f above %.4f" % (sum(vals[0:4]), sum(vals[4:8]))
    elif name == "theta_um_one_2021":
        vals = window(quotes, signal, 4)
        detail = "steps %.4f %.4f %.4f" % (vals[0] - vals[1], vals[1] - vals[2], vals[2] - vals[3])
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
    for key, sym in PAIRS:
        quotes = load_quote(os.path.join(INP, "klines", "um", sym, "1d"))
        for day in ("2020-12-24", "2020-12-30", "2020-12-31", "2021-01-01", "2021-12-31"):
            if day not in quotes:
                raise SystemExit("tape gap %s %s" % (sym, day))
        year = [day for day in quotes if day.startswith("2021")]
        if len(year) != 365:
            raise SystemExit("um year %s %d" % (sym, len(year)))
        tapes[key] = quotes
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("fil_um_sum_2021", "filsum"),
        ("eos_um_block_2021", "eosblock"),
        ("trx_um_low_2021", "trxlow"),
        ("bch_um_skip_2021", "bchskip"),
        ("etc_um_step_2021", "etcstep"),
        ("xtz_um_mix_2021", "xtzmix"),
        ("xlm_um_four_2021", "xlm4"),
        ("theta_um_one_2021", "thetaone"),
    )
    kills = {}
    for name, key in specs:
        quotes = tapes[key]
        signals = signals_for(name, quotes)
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
        describe(name, p30.shift(entries[0], -1), btc_opens, quotes)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 09:00:49 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series are Binance USD-M perpetual 1d quote volumes, field 7. "
            "Open, high, low, close, base volume, trade count, and taker-buy fields are not the signal. "
            "No coin-margined kline is read as the signal. No spot kline is read as the signal. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "A numeric clear on this daily open is not a testing row. "
            "These tapes are not a stand-in for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "None of these is a leveraged-token up-versus-down pair. "
            "None of these is a busiest-hour or quietest-hour rule. "
            "None of these is a BTC contract-count path. "
            "None of these is ETH funding. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a top-trader position-ratio or account-ratio slice. "
            "None compares one coin's N-day close return with another's. "
            "The account-minus-position gap narrowing is not rerun. "
            "None lowers 1.30, 0.001, 0.0015, 0.002, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, to 55, or to 44, and no year is extended. "
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
            raise SystemExit("summary_pass42.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
