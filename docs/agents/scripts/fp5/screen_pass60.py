"""Eight frozen Revolut X screens. Transaction fees, open to open.

Reads the eight rule texts hashed at 2026-09-25 12:39:55 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass60.json. Public archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
Fifteen-minute bars are not read. Six-hour bars are not read. Same-day kline
highs and lows are not compared. The confirmation-time family is not rerun.
The 60-trip gate is not lowered. No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass60.py
    python3 docs/agents/scripts/fp5/screen_pass60.py --check
"""
import hashlib, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass60")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass60.json")
CHART = os.path.join(INP, "transaction-fees.json")
CHART_URL = "https://api.blockchain.info/charts/transaction-fees?format=json&timespan=all&sampled=false"
FROZEN = "2026-09-25 12:39:55 UTC"
SHA = {
    "fee3h": "16ceb75f390341aa36f429be2f5aae33cbb50a9b266d5f94ca7e50c9ae8823b5",
    "feehalf": "4bf3cab8c96703fa434a84cdb0eabc01ab908486aa7ea77046c61d5be7ac575f",
    "feeweek": "68af1991e0ced815db546ea830c4093150fe73de6095a96b3bc8919c1d911c16",
    "feeblock": "4fc3374178fc4da773c9b800b07b2a1097835cdeed599bba1a6a1543dec38c69",
    "feeneg": "ffd6ea8907c0d2518565e20239574208bdf2d56578797ec53ea737baaee1c9f1",
    "feeratio": "b4ef536d31d115bb9e41b22e0239ebed8fdbffdffc535e3ba39f6c0add3fd5f4",
    "feemid": "5fb9b8bef8a543e4b00dacccd118dbc30e9a5139628a0675d16fd0129193abe1",
    "feepair": "f7b9eb3e5425d9008441bfd9317182c48729be96f6b31d3e5033bc90d8af8260",
}
COUNTED = {
    "fee_three_halves_2021": 26,
    "fee_below_half_2021": 2,
    "fee_week_flip_2021": 38,
    "fee_three_day_block_2021": 46,
    "fee_one_drop_2021": 63,
    "fee_deeper_fall_2021": 55,
    "fee_above_mean_below_five_2021": 60,
    "fee_pair_split_2021": 9,
}
LAGS = {
    "fee_three_halves_2021": (1,),
    "fee_below_half_2021": (1,),
    "fee_week_flip_2021": (1, 7, 8),
    "fee_three_day_block_2021": (1, 2, 3, 4, 5),
    "fee_one_drop_2021": (1, 2, 3, 4),
    "fee_deeper_fall_2021": (1, 2, 3),
    "fee_above_mean_below_five_2021": (1, 2, 3, 4, 5),
    "fee_pair_split_2021": (1, 2, 3),
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


def pull_chart():
    req = urllib.request.Request(CHART_URL, headers={"User-Agent": "fp5-screen/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def parse_chart(raw):
    payload = json.loads(raw)
    if payload.get("name") != "Total Transaction Fees" or payload.get("unit") != "BTC":
        raise SystemExit("chart is not total transaction fees in BTC")
    levels = {}
    seen = {}
    for point in payload.get("values") or []:
        if "x" not in point or "y" not in point:
            raise SystemExit("chart point missing x or y")
        ts = p30.stamp_of(int(point["x"]) * 1000)
        if ts.hour != 0 or ts.minute != 0 or ts.second != 0:
            raise SystemExit("chart stamp is not midnight")
        day = p5.ymd(ts)
        val = float(point["y"])
        if day in seen and seen[day] != val:
            raise SystemExit("duplicate day disagrees %s" % day)
        seen[day] = val
        # A nonpositive fee is not a level. It is not filled. The
        # 2009-2010 zeros sit outside the screen window. A zero inside
        # the lags this screen names fails the gap check below.
        if not val > 0:
            continue
        levels[day] = val
    return levels


def values_on(levels, day, lags):
    days = [day] + [p30.shift(day, -k) for k in lags]
    if any(item not in levels for item in days):
        return None
    return [levels[item] for item in days]


def fee_3h(vals):
    c0, c1 = vals
    return 2 * c0 > 3 * c1


def fee_half(vals):
    c0, c1 = vals
    return 2 * c0 < c1


def fee_week(vals):
    c0, c1, c7, c8 = vals
    return c0 > c7 and c1 < c8


def fee_block(vals):
    c0, c1, c2, c3, c4, c5 = vals
    return (c0 + c1 + c2) > (c3 + c4 + c5) and c0 < c3


def fee_neg(vals):
    c0, c1, c2, c3, c4 = vals
    steps = (c0 - c1, c1 - c2, c2 - c3, c3 - c4)
    if any(step == 0 for step in steps):
        return False
    return sum(1 for step in steps if step < 0) == 1


def fee_ratio(vals):
    c0, c1, c2, c3 = vals
    return c0 < c1 and c2 < c3 and c0 * c3 < c1 * c2


def fee_mid(vals):
    c0, c1, c2, c3, c4, c5 = vals
    return 4 * c0 > (c1 + c2 + c3 + c4) and c0 < c5


def fee_pair(vals):
    c0, c1, c2, c3 = vals
    return c0 > c2 and c1 < c3 and c0 < c1


PREDICATES = {
    "fee_three_halves_2021": fee_3h,
    "fee_below_half_2021": fee_half,
    "fee_week_flip_2021": fee_week,
    "fee_three_day_block_2021": fee_block,
    "fee_one_drop_2021": fee_neg,
    "fee_deeper_fall_2021": fee_ratio,
    "fee_above_mean_below_five_2021": fee_mid,
    "fee_pair_split_2021": fee_pair,
}


def signals_for(name, levels):
    pred = PREDICATES.get(name)
    lags = LAGS.get(name)
    if pred is None or lags is None:
        raise SystemExit("unknown rule %s" % name)
    out = set()
    eligible = 0
    for day in p5.daterange("2020-12-31", "2021-12-30"):
        vals = values_on(levels, day, lags)
        if vals is None:
            continue
        eligible += 1
        if pred(vals):
            out.add(day)
    return out, eligible


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    if not fee_3h((4, 2)) or fee_3h((3, 2)) or fee_3h((5, 4)):
        raise SystemExit("three halves")
    if not fee_half((1, 3)) or fee_half((2, 3)) or fee_half((1, 2)):
        raise SystemExit("half")
    if not fee_week((5, 1, 4, 2)) or fee_week((5, 3, 4, 2)):
        raise SystemExit("week")
    if not fee_block((1, 10, 10, 2, 1, 1)) or fee_block((3, 1, 1, 2, 1, 1)):
        raise SystemExit("block")
    if not fee_neg((5, 4, 6, 3, 2)) or fee_neg((5, 4, 3, 2, 1)) or fee_neg((5, 6, 4, 5, 3)) or fee_neg((5, 5, 4, 3, 2)):
        raise SystemExit("one drop")
    if not fee_ratio((1, 4, 3, 4)) or fee_ratio((3, 4, 1, 4)) or fee_ratio((5, 4, 3, 4)):
        raise SystemExit("deeper fall")
    if not fee_mid((10, 1, 1, 1, 1, 11)) or fee_mid((10, 1, 1, 1, 1, 9)) or fee_mid((1, 10, 10, 10, 10, 20)):
        raise SystemExit("mean")
    if not fee_pair((3, 4, 2, 5)) or fee_pair((5, 4, 2, 5)):
        raise SystemExit("pair")


def input_jobs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2020-12", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "1d", name)))
    return jobs


def ensure_inputs():
    os.makedirs(INP, exist_ok=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    first = pull_chart()
    second = pull_chart()
    if parse_chart(first) != parse_chart(second):
        raise SystemExit("transaction-fee pulls disagree")
    with open(CHART, "wb") as f:
        f.write(first)
    print("pass60 inputs ready", flush=True)


def detail_for(name, levels, day):
    vals = values_on(levels, day, LAGS[name])
    if vals is None:
        raise SystemExit("detail missing %s" % day)
    if name == "fee_one_drop_2021":
        c0, c1, c2, c3, c4 = vals
        downs = sum(1 for step in (c0 - c1, c1 - c2, c2 - c3, c3 - c4) if step < 0)
        return "downs %d btc %.8f %.8f %.8f %.8f %.8f" % (downs, c0, c1, c2, c3, c4)
    return "btc " + " ".join("%.8f" % val for val in vals)


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
    if not os.path.exists(CHART):
        raise SystemExit("transaction-fee file missing")
    with open(CHART, "rb") as f:
        levels = parse_chart(f.read())
    window = list(p5.daterange("2020-12-23", "2021-12-30"))
    for day in window:
        if day not in levels:
            raise SystemExit("transaction-fee gap %s" % day)
    counted = {}
    for name in COUNTED:
        signals, eligible = signals_for(name, levels)
        if eligible != 365:
            raise SystemExit("eligible days moved %s %d" % (name, eligible))
        if len(signals) != COUNTED[name]:
            raise SystemExit("pre-freeze count moved %s %d" % (name, len(signals)))
        if len(signals) == 0 or len(signals) >= 365:
            raise SystemExit("signal is empty or every complete day %s" % name)
        counted[name] = signals
    spot = os.path.join(INP, "klines", "spot")
    btc_opens = p30.load_field(os.path.join(spot, "BTCUSDT", "1d"), 1, 2)
    eth_opens = p30.load_field(os.path.join(spot, "ETHUSDT", "1d"), 1, 2)
    for day in ("2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    if p5.parse_ymd("2021-01-02").weekday() != 5:
        raise SystemExit("saturday")
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("fee_three_halves_2021", "fee3h"),
        ("fee_below_half_2021", "feehalf"),
        ("fee_week_flip_2021", "feeweek"),
        ("fee_three_day_block_2021", "feeblock"),
        ("fee_one_drop_2021", "feeneg"),
        ("fee_deeper_fall_2021", "feeratio"),
        ("fee_above_mean_below_five_2021", "feemid"),
        ("fee_pair_split_2021", "feepair"),
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
            name, signal, entries[0], detail_for(name, levels, signal), entry, exit_px, move), flush=True)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 12:39:55 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is Bitcoin's total transaction fees in BTC, one number per calendar day, from the Blockchain.com chart transaction-fees. "
            "The chart name is Total Transaction Fees and the unit is BTC. The description is fees paid to miners, not including the coinbase value of block rewards. "
            "Each stamp is midnight UTC and names that day. "
            "Two pulls matched before the file was kept. A day with two different values is unusable. A missing day is not filled. "
            "A nonpositive fee is left out and is not filled. Those zeros run from 2009-01-17 through 2010-11-28 and none of them sit in the screen window. "
            "This is not a kline. Fifteen-minute bars are not read. Six-hour bars are not read. Four-hour bars are not read. "
            "Same-day kline highs and lows are not compared. The order of six-hour closes is not rerun, and its coin is not swapped. "
            "How four-hour ranges sit inside one another is not rerun. "
            "Median confirmation time is not rerun, and the fall after a higher day is not flipped. "
            "The chart has a positive fee on every day from 2020-12-23 through 2021-12-30. "
            "None of these fires on every one of the 365 signal days. None of these had zero entries. "
            "Hash rate, the on-chain transaction count, average block size, address counts, and estimated transaction volume are not rerun. "
            "This is not a trailing quintile and not a 30-day median. "
            "The mempool-size chart is not scored: one day carries two different values. "
            "Fees more than twice yesterday, fees more than three times yesterday, today above the sum of the two previous days, fees below one third of yesterday, and today plus the day before yesterday below yesterday had no days and are not rules. "
            "January is not dropped from the XRP inversion rule, and 8 is not changed. "
            "January is not dropped from the confirmation-time rule with exactly two rising steps, and 2 is not changed. "
            "The 60-trip gate is not lowered to 49, to 26, to 33, to 9, or to 2. "
            "The confirmation-time fall after a higher day is not a pass and its fill is not changed. "
            "The BNB close span strictly wider than the open span is not a pass and its fill is not changed. "
            "The LTC weighted price strictly below the midpoint is not a pass and its fill is not changed. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "Those five numeric clears, and the confirmation-time fall after a higher day, are not paper testing. "
            "Their fills are Binance daily opens. The Revolut X archive does not contain those 2019 or 2021 fills. "
            "A numeric clear on this daily open is not a testing row and is not paper testing. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
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
            raise SystemExit("summary_pass60.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
