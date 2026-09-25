"""Eight frozen Revolut X screens. Median confirmation time, open to open.

Reads the eight rule texts hashed at 2026-09-25 12:23:37 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass59.json. Public archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
Fifteen-minute bars are not read. Six-hour bars are not read. Same-day kline
highs and lows are not compared. The six-hour close-order family is not rerun.
The 60-trip gate is not lowered. No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass59.py
    python3 docs/agents/scripts/fp5/screen_pass59.py --check
"""
import hashlib, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass59")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass59.json")
CHART = os.path.join(INP, "median-confirmation-time.json")
CHART_URL = "https://api.blockchain.info/charts/median-confirmation-time?format=json&timespan=all&sampled=false"
FROZEN = "2026-09-25 12:23:37 UTC"
SHA = {
    "medbnc": "ad2b5676f844c9ed1003292d46272610a68b5d24cda25e0c87501b19c5ae1829",
    "medgive": "4b601e0c9b5f557bcf0f2273d3715a27ea0f2faacd4cd8a15c6dcce5ef61daaa",
    "medbtw": "64b261f8e08f16e6b393f2b8d9689b370e01b0d2c2f6ab63fabcadbea03b4952",
    "medstep": "6bdb0adace736a3daecab2a335cd20fb555bcf19952a3b125974140d876d43ab",
    "medopp": "ea3b4d7d9f11bb1e5319dcb260dfa23c80e6dafd9cabb7a993860dab4c457a74",
    "medcap": "e23ac8eadb346b0ed6478e2e9ab76c08bc8eea519df786590a0ef57272acce06",
    "mednet": "de896c2d15aad55de24e3cd134c36318edbcd0884dc8f8ac3c9585711098f81a",
    "medtwo": "e8d97747d8b65771255b35b87441f156df1da2ec226868c48b07885a2fbf9d7d",
}
COUNTED = {
    "med_bounce_2021": 111,
    "med_giveback_2021": 109,
    "med_between_prior_two_2021": 114,
    "med_smaller_step_2021": 178,
    "med_opposite_step_2021": 220,
    "med_above_two_below_three_2021": 33,
    "med_three_day_span_above_middle_2021": 201,
    "med_exactly_two_rises_2021": 174,
}
LAGS = {
    "med_bounce_2021": (1, 2),
    "med_giveback_2021": (1, 2),
    "med_between_prior_two_2021": (1, 2),
    "med_smaller_step_2021": (1, 2),
    "med_opposite_step_2021": (1, 2),
    "med_above_two_below_three_2021": (1, 2, 3),
    "med_three_day_span_above_middle_2021": (1, 2, 3),
    "med_exactly_two_rises_2021": (1, 2, 3),
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
    if payload.get("name") != "Median Confirmation Time" or payload.get("unit") != "Minutes":
        raise SystemExit("chart is not median confirmation time in minutes")
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
        # A nonpositive minute is not a level. It is not filled. The
        # 2009-2011 zeros sit outside the screen window. A zero inside
        # 2020-12-28 through 2021-12-30 fails the gap check below.
        if not val > 0:
            continue
        levels[day] = val
    return levels


def values_on(levels, day, lags):
    days = [day] + [p30.shift(day, -k) for k in lags]
    if any(item not in levels for item in days):
        return None
    return [levels[item] for item in days]


def med_bounce(vals):
    c0, c1, c2 = vals
    return c0 > c1 and c1 < c2


def med_give(vals):
    c0, c1, c2 = vals
    return c0 < c1 and c1 > c2


def med_btw(vals):
    c0, c1, c2 = vals
    return (c2 < c0 < c1) or (c1 < c0 < c2)


def med_step(vals):
    c0, c1, c2 = vals
    return (c0 - c1) != 0 and (c1 - c2) != 0 and abs(c0 - c1) < abs(c1 - c2)


def med_opp(vals):
    c0, c1, c2 = vals
    return (c0 - c1) * (c1 - c2) < 0


def med_cap(vals):
    c0, c1, c2, c3 = vals
    return c0 > c1 and c0 > c2 and c0 < c3


def med_net(vals):
    c0, c1, c2, c3 = vals
    return abs(c0 - c3) > abs(c1 - c2)


def med_two(vals):
    c0, c1, c2, c3 = vals
    steps = (c0 - c1, c1 - c2, c2 - c3)
    if any(step == 0 for step in steps):
        return False
    return sum(1 for step in steps if step > 0) == 2


PREDICATES = {
    "med_bounce_2021": med_bounce,
    "med_giveback_2021": med_give,
    "med_between_prior_two_2021": med_btw,
    "med_smaller_step_2021": med_step,
    "med_opposite_step_2021": med_opp,
    "med_above_two_below_three_2021": med_cap,
    "med_three_day_span_above_middle_2021": med_net,
    "med_exactly_two_rises_2021": med_two,
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
    if not med_bounce((3, 1, 2)) or med_bounce((2, 1, 0)) or med_bounce((1, 2, 0)):
        raise SystemExit("bounce")
    if not med_give((1, 3, 2)) or med_give((3, 2, 1)):
        raise SystemExit("give")
    if not med_btw((2, 3, 1)) or not med_btw((2, 1, 3)) or med_btw((2, 2, 1)) or med_btw((4, 3, 1)):
        raise SystemExit("between")
    if not med_step((5, 4, 1)) or med_step((5, 1, 4)) or med_step((5, 5, 1)) or med_step((5, 3, 1)):
        raise SystemExit("step")
    if not med_opp((1, 3, 2)) or med_opp((1, 2, 3)) or med_opp((1, 1, 2)):
        raise SystemExit("opp")
    if not med_cap((5, 4, 3, 6)) or med_cap((5, 4, 3, 5)) or med_cap((5, 6, 3, 9)):
        raise SystemExit("cap")
    if not med_net((1, 4, 4, 10)) or med_net((5, 1, 9, 6)) or med_net((10, 1, 8, 3)):
        raise SystemExit("net")
    if not med_two((5, 3, 4, 2)) or not med_two((5, 6, 4, 3)):
        raise SystemExit("two rises")
    if med_two((5, 4, 3, 2)) or med_two((5, 6, 7, 4)) or med_two((5, 6, 7, 8)) or med_two((5, 5, 4, 3)):
        raise SystemExit("not two rises")


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
        raise SystemExit("confirmation-time pulls disagree")
    with open(CHART, "wb") as f:
        f.write(first)
    print("pass59 inputs ready", flush=True)


def detail_for(name, levels, day):
    vals = values_on(levels, day, LAGS[name])
    if vals is None:
        raise SystemExit("detail missing %s" % day)
    if name == "med_exactly_two_rises_2021":
        c0, c1, c2, c3 = vals
        ups = sum(1 for step in (c0 - c1, c1 - c2, c2 - c3) if step > 0)
        return "ups %d minutes %.8f %.8f %.8f %.8f" % (ups, c0, c1, c2, c3)
    return "minutes " + " ".join("%.8f" % val for val in vals)


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
        raise SystemExit("confirmation-time file missing")
    with open(CHART, "rb") as f:
        levels = parse_chart(f.read())
    window = list(p5.daterange("2020-12-31", "2021-12-30"))
    for day in window:
        if day not in levels:
            raise SystemExit("confirmation-time gap %s" % day)
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
        ("med_bounce_2021", "medbnc"),
        ("med_giveback_2021", "medgive"),
        ("med_between_prior_two_2021", "medbtw"),
        ("med_smaller_step_2021", "medstep"),
        ("med_opposite_step_2021", "medopp"),
        ("med_above_two_below_three_2021", "medcap"),
        ("med_three_day_span_above_middle_2021", "mednet"),
        ("med_exactly_two_rises_2021", "medtwo"),
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
            "Each rule was hashed at 2026-09-25 12:23:37 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is Bitcoin's median confirmation time in minutes, one number per calendar day, from the Blockchain.com chart median-confirmation-time. "
            "The chart name is Median Confirmation Time and the unit is Minutes. Each stamp is midnight UTC and names that day. "
            "Two pulls matched before the file was kept. A day with two different values is unusable. A missing day is not filled. "
            "A nonpositive minute is left out and is not filled. Those zeros run from 2009-01-03 through 2011-12-01 and none of them sit in the screen window. "
            "This is not a kline. Fifteen-minute bars are not read. Six-hour bars are not read. Four-hour bars are not read. "
            "Same-day kline highs and lows are not compared. The order of six-hour closes is not rerun, and its coin is not swapped. "
            "How four-hour ranges sit inside one another is not rerun. "
            "The chart has a point on every day from 2020-12-31 through 2021-12-30. "
            "None of these fires on every one of those 365 days. None of these had zero entries. "
            "Hash rate, the on-chain transaction count, average block size, and address counts are not rerun. "
            "This is not a trailing quintile and not a 30-day median. "
            "The mempool-size chart is not scored: one day carries two different values. "
            "January is not dropped from the XRP inversion rule, and 8 is not changed. "
            "The 60-trip gate is not lowered to 49, to 26, or to 33. "
            "The BNB close span strictly wider than the open span is not a pass and its fill is not changed. "
            "The LTC weighted price strictly below the midpoint is not a pass and its fill is not changed. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "A numeric clear on this daily open is not a testing row. "
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
            raise SystemExit("summary_pass59.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
