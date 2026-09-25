"""Eight frozen Revolut X screens. Hourly spot tapes, eight mechanisms.

Reads the eight rule texts hashed at 2026-09-25 08:29:12 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass39.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
ETH funding is not in this run. BTC contract-count path shapes are not in this run.
USD-M metrics for the other coins and 2021 book depth are not scored and are
not replaced by these tapes. The dollar open-interest column is not read.
The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, or to 53,
and no screen year is extended. The separation of 11 is not lowered.

    python3 docs/agents/scripts/fp5/screen_pass39.py
    python3 docs/agents/scripts/fp5/screen_pass39.py --check
"""
import hashlib, json, os, sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass39")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass39.json")
SHA = {
    "bchshare": "2f99bb06667af48430f0a73e6383a9a7073e0a7a80aaee94ee85ff989cf81c08",
    "etclate": "88a57021eac5cbdfcbfa38abe46a54f1e2c863da50a15b77b06df11d579258a4",
    "xlmlead": "596c6c9d7f499efc4f6f72f980094e169bb6f696b4b84cd34fa509f12412f5ec",
    "trxflat": "bdb43ffc2d7a33441bf32d55aa340d2429241c9dc5fdbe7a35b10f686096e9ed",
    "eosmiss": "22ab44576f5d34870022013e35fd15a7d0c681a1dc5783bddd5a7a75302d765b",
    "algonew": "9c0ed0c7e2221aab8fe7e0f8ec827fcbf340356ab611376b748d5703c484011d",
    "aavepeaks": "f5355c9046b264e0ec2b8519fb0a92655c421eb0c84b1bb1bbf6e58690899c21",
    "nearspan": "fa2f44dee64b26f856cda5e9def9472752509e311d0532256f94578f1312068d",
}
TAPES = (
    ("bchshare", "BCHUSDT"),
    ("etclate", "ETCUSDT"),
    ("xlmlead", "XLMUSDT"),
    ("trxflat", "TRXUSDT"),
    ("eosmiss", "EOSUSDT"),
    ("algonew", "ALGOUSDT"),
    ("aavepeaks", "AAVEUSDT"),
    ("nearspan", "NEARUSDT"),
)
SPAN = 11


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


def fold_rows(rows):
    """Keep a day only when hours 0-23 each appear once, on the hour."""
    slots = defaultdict(dict)
    bad = set()
    for day, hour, minute, second, quote, trades in rows:
        if minute != 0 or second != 0 or hour < 0 or hour > 23:
            bad.add(day)
            continue
        have = slots[day]
        value = (quote, trades)
        if hour in have and have[hour] != value:
            have[hour] = None
            bad.add(day)
        elif hour not in have:
            have[hour] = value
    out = {}
    for day, hours in slots.items():
        if day in bad:
            continue
        if set(hours) != set(range(24)):
            continue
        if any(hours[h] is None for h in range(24)):
            continue
        out[day] = [hours[h] for h in range(24)]
    return out


def column(day, index):
    return [bar[index] for bar in day]


def share_of(day):
    quotes = column(day, 0)
    total = sum(quotes)
    if total <= 0.0:
        return None
    return max(quotes) / total


def flatness(day):
    quotes = column(day, 0)
    low, high = min(quotes), max(quotes)
    if low <= 0.0 or high <= 0.0:
        return None
    return low / high


def unique_index(vals, want_max):
    target = max(vals) if want_max else min(vals)
    if vals.count(target) != 1:
        return None
    return vals.index(target)


def threshold_hour(vals):
    total = sum(vals)
    if total <= 0.0:
        return None
    running = 0.0
    for hour, value in enumerate(vals):
        running += value
        if running > total - running:
            return hour
    return None


def local_peaks(day):
    quotes = column(day, 0)
    count = 0
    if quotes[0] > quotes[1]:
        count += 1
    for hour in range(1, 23):
        if quotes[hour] > quotes[hour - 1] and quotes[hour] > quotes[hour + 1]:
            count += 1
    if quotes[23] > quotes[22]:
        count += 1
    return count


def rising_share(days):
    out = set()
    for day in days:
        prior = p30.shift(day, -1)
        if prior not in days:
            continue
        today, yesterday = share_of(days[day]), share_of(days[prior])
        if today is None or yesterday is None:
            continue
        if today > yesterday:
            out.add(day)
    return out


def later_trade_hour(days):
    out = set()
    for day in days:
        prior = p30.shift(day, -1)
        if prior not in days:
            continue
        today = unique_index(column(days[day], 1), True)
        yesterday = unique_index(column(days[prior], 1), True)
        if today is None or yesterday is None:
            continue
        if today > yesterday:
            out.add(day)
    return out


def quote_after_trades(days):
    out = set()
    for day, bars in days.items():
        quote_hour = threshold_hour(column(bars, 0))
        trade_hour = threshold_hour(column(bars, 1))
        if quote_hour is None or trade_hour is None:
            continue
        if quote_hour > trade_hour:
            out.add(day)
    return out


def flatter(days):
    out = set()
    for day in days:
        prior = p30.shift(day, -1)
        if prior not in days:
            continue
        today, yesterday = flatness(days[day]), flatness(days[prior])
        if today is None or yesterday is None:
            continue
        if today > yesterday:
            out.add(day)
    return out


def hours_disagree(days):
    out = set()
    for day, bars in days.items():
        quote_hour = unique_index(column(bars, 0), True)
        trade_hour = unique_index(column(bars, 1), True)
        if quote_hour is None or trade_hour is None:
            continue
        if quote_hour != trade_hour:
            out.add(day)
    return out


def new_peak_hour(days):
    out = set()
    for day in days:
        prior = p30.shift(day, -1)
        older = p30.shift(day, -2)
        if prior not in days or older not in days:
            continue
        today = unique_index(column(days[day], 0), True)
        yesterday = unique_index(column(days[prior], 0), True)
        before = unique_index(column(days[older], 0), True)
        if today is None or yesterday is None or before is None:
            continue
        if today != yesterday and today != before:
            out.add(day)
    return out


def more_peaks(days):
    out = set()
    for day in days:
        prior = p30.shift(day, -1)
        if prior not in days:
            continue
        if local_peaks(days[day]) > local_peaks(days[prior]):
            out.add(day)
    return out


def wide_span(days):
    out = set()
    for day, bars in days.items():
        quotes = column(bars, 0)
        busy = unique_index(quotes, True)
        quiet = unique_index(quotes, False)
        if busy is None or quiet is None:
            continue
        if abs(busy - quiet) > SPAN:
            out.add(day)
    return out


def full_day(quote, trades=None):
    if trades is None:
        trades = [1.0] * 24
    rows = [("2021-01-02", hour, 0, 0, quote[hour], trades[hour]) for hour in range(24)]
    folded = fold_rows(rows)
    return folded["2021-01-02"]


def self_check():
    p30.self_check()
    if SPAN != 11:
        raise SystemExit("separation moved")
    base = [1.0] * 24
    peaked = [1.0] * 24
    peaked[0] = 10.0
    higher = [1.0] * 24
    higher[0] = 20.0
    share_days = {"2021-01-01": full_day(peaked), "2021-01-02": full_day(higher)}
    if rising_share(share_days) != {"2021-01-02"}:
        raise SystemExit("share")
    share_days["2021-01-02"] = full_day(peaked)
    if rising_share(share_days):
        raise SystemExit("share tie")
    zero = [0.0] * 24
    if share_of(full_day(zero)) is not None:
        raise SystemExit("zero share")
    early = [1.0] * 24
    early[1] = 5.0
    late = [1.0] * 24
    late[4] = 5.0
    tied = [1.0] * 24
    tied[4] = 5.0
    tied[6] = 5.0
    late_days = {
        "2021-01-01": full_day(base, early),
        "2021-01-02": full_day(base, late),
    }
    if later_trade_hour(late_days) != {"2021-01-02"}:
        raise SystemExit("late")
    late_days["2021-01-02"] = full_day(base, early)
    if later_trade_hour(late_days):
        raise SystemExit("late tie")
    late_days["2021-01-02"] = full_day(base, tied)
    if later_trade_hour(late_days):
        raise SystemExit("late double peak")
    trades_first = [0.0] * 24
    trades_first[0] = 10.0
    quotes_last = [0.0] * 24
    quotes_last[23] = 10.0
    lead_days = {"2021-01-02": full_day(quotes_last, trades_first)}
    if quote_after_trades(lead_days) != {"2021-01-02"}:
        raise SystemExit("lead")
    lead_days["2021-01-02"] = full_day(trades_first, quotes_last)
    if quote_after_trades(lead_days):
        raise SystemExit("lead flipped")
    if threshold_hour([0.0] * 24) is not None:
        raise SystemExit("empty threshold")
    quiet = [1.0] * 24
    quiet[3] = 4.0
    flatter_day = [2.0] * 24
    flatter_day[3] = 4.0
    flat_days = {"2021-01-01": full_day(quiet), "2021-01-02": full_day(flatter_day)}
    if not flatness(flat_days["2021-01-02"]) > flatness(flat_days["2021-01-01"]):
        raise SystemExit("flat ratio")
    if flatter(flat_days) != {"2021-01-02"}:
        raise SystemExit("flat")
    flat_days["2021-01-02"] = full_day(quiet)
    if flatter(flat_days):
        raise SystemExit("flat tie")
    dead = [1.0] * 24
    dead[2] = 0.0
    if flatness(full_day(dead)) is not None:
        raise SystemExit("zero hour stored")
    quote_peak = [1.0] * 24
    quote_peak[2] = 9.0
    trade_peak = [1.0] * 24
    trade_peak[5] = 9.0
    miss_days = {"2021-01-02": full_day(quote_peak, trade_peak)}
    if hours_disagree(miss_days) != {"2021-01-02"}:
        raise SystemExit("disagree")
    miss_days["2021-01-02"] = full_day(quote_peak, quote_peak)
    if hours_disagree(miss_days):
        raise SystemExit("same hour")
    miss_days["2021-01-02"] = full_day(tied, trade_peak)
    if hours_disagree(miss_days):
        raise SystemExit("disagree tie")
    hour_a = [1.0] * 24
    hour_a[1] = 8.0
    hour_b = [1.0] * 24
    hour_b[2] = 8.0
    hour_c = [1.0] * 24
    hour_c[3] = 8.0
    new_days = {
        "2021-01-01": full_day(hour_a),
        "2021-01-02": full_day(hour_b),
        "2021-01-03": full_day(hour_c),
    }
    if new_peak_hour(new_days) != {"2021-01-03"}:
        raise SystemExit("new hour")
    new_days["2021-01-03"] = full_day(hour_b)
    if new_peak_hour(new_days):
        raise SystemExit("repeats yesterday")
    new_days["2021-01-03"] = full_day(hour_a)
    if new_peak_hour(new_days):
        raise SystemExit("repeats the day before")
    climb = [float(hour + 1) for hour in range(24)]
    wavy = []
    for hour in range(24):
        wavy.append(3.0 if hour % 2 == 0 else 1.0)
    peak_days = {"2021-01-01": full_day(climb), "2021-01-02": full_day(wavy)}
    if local_peaks(peak_days["2021-01-01"]) != 1:
        raise SystemExit("endpoint peak")
    if more_peaks(peak_days) != {"2021-01-02"}:
        raise SystemExit("peaks")
    peak_days["2021-01-02"] = full_day(climb)
    if more_peaks(peak_days):
        raise SystemExit("peak tie")
    flat_neighbors = [1.0] * 24
    flat_neighbors[4] = 1.0
    if local_peaks(full_day([2.0, 2.0] + [1.0] * 22)) != 0:
        raise SystemExit("equal neighbor is a peak")
    span_quotes = [2.0] * 24
    span_quotes[0] = 9.0
    span_quotes[12] = 1.0
    span_days = {"2021-01-02": full_day(span_quotes)}
    if wide_span(span_days) != {"2021-01-02"}:
        raise SystemExit("span")
    span_quotes[12] = 2.0
    span_quotes[11] = 1.0
    span_days["2021-01-02"] = full_day(span_quotes)
    if wide_span(span_days):
        raise SystemExit("span of 11")
    span_quotes[11] = 2.0
    span_quotes[12] = 1.0
    span_quotes[13] = 1.0
    if unique_index(span_quotes, False) is not None:
        raise SystemExit("quiet tie")
    rows = [("2021-04-25", hour, 0, 0, 1.0, 1.0) for hour in range(21)]
    if "2021-04-25" in fold_rows(rows):
        raise SystemExit("short day")
    rows = [("2021-01-01", hour, 0, 0, 1.0, 1.0) for hour in range(24)]
    rows.append(("2021-01-01", 3, 0, 0, 1.0, 1.0))
    if "2021-01-01" not in fold_rows(rows):
        raise SystemExit("identical hour dropped")
    rows.append(("2021-01-01", 4, 0, 0, 2.0, 1.0))
    if "2021-01-01" in fold_rows(rows):
        raise SystemExit("conflicting hour kept")
    off = [("2021-01-03", hour, 0, 0, 1.0, 1.0) for hour in range(24)]
    off[0] = ("2021-01-03", 0, 30, 0, 1.0, 1.0)
    if "2021-01-03" in fold_rows(off):
        raise SystemExit("off-hour bar kept")


def input_jobs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2021-01", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for _key, sym in TAPES:
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-1h-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1h/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1h", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass39 inputs ready", flush=True)


def load_hours(folder):
    names = sorted(n for n in os.listdir(folder) if n.endswith(".zip"))
    if not names:
        raise SystemExit("hourly gap: %s" % folder)
    rows = []
    for name in names:
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            if len(parts) < 9:
                raise SystemExit("hourly field gap %s" % name)
            when = p30.stamp_of(int(parts[0]))
            rows.append((
                p5.ymd(when), when.hour, when.minute, when.second,
                float(parts[7]), float(parts[8])))
    return fold_rows(rows)


def signals_for(name, days):
    if name == "bch_share_2021":
        return rising_share(days)
    if name == "etc_late_2021":
        return later_trade_hour(days)
    if name == "xlm_lead_2021":
        return quote_after_trades(days)
    if name == "trx_flat_2021":
        return flatter(days)
    if name == "eos_miss_2021":
        return hours_disagree(days)
    if name == "algo_new_2021":
        return new_peak_hour(days)
    if name == "aave_peaks_2021":
        return more_peaks(days)
    if name == "near_span_2021":
        return wide_span(days)
    raise SystemExit("no signal for %s" % name)


def describe(name, signal, btc_opens, days):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    today = days[signal]
    prior_day = p30.shift(signal, -1)
    yesterday = days.get(prior_day)
    if name == "btc_bch_share_2021":
        detail = "share %.6f from %.6f" % (share_of(today), share_of(yesterday))
    elif name == "btc_etc_late_2021":
        detail = "trade hour %d from %d" % (
            unique_index(column(today, 1), True), unique_index(column(yesterday, 1), True))
    elif name == "btc_xlm_lead_2021":
        detail = "quote hour %d after trade hour %d" % (
            threshold_hour(column(today, 0)), threshold_hour(column(today, 1)))
    elif name == "btc_trx_flat_2021":
        detail = "flat %.6f from %.6f" % (flatness(today), flatness(yesterday))
    elif name == "btc_eos_miss_2021":
        detail = "quote hour %d trade hour %d" % (
            unique_index(column(today, 0), True), unique_index(column(today, 1), True))
    elif name == "btc_algo_new_2021":
        older = days[p30.shift(signal, -2)]
        detail = "hour %d not %d or %d" % (
            unique_index(column(today, 0), True),
            unique_index(column(yesterday, 0), True),
            unique_index(column(older, 0), True))
    elif name == "btc_aave_peaks_2021":
        detail = "peaks %d from %d" % (local_peaks(today), local_peaks(yesterday))
    elif name == "btc_near_span_2021":
        quotes = column(today, 0)
        detail = "quiet %d busy %d" % (unique_index(quotes, False), unique_index(quotes, True))
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
    for key, sym in TAPES:
        days = load_hours(os.path.join(spot, sym, "1h"))
        if "2021-04-25" in days:
            raise SystemExit("short hourly day was treated as complete %s" % sym)
        if "2021-01-01" not in days or len(days["2021-01-01"]) != 24:
            raise SystemExit("2021-01-01 hourly tape %s" % sym)
        if "2020-12-31" not in days or "2021-12-31" not in days:
            raise SystemExit("hourly tape does not cover the year boundary %s" % sym)
        tapes[key] = days
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_bch_share_2021", "bchshare", "bch_share_2021"),
        ("btc_etc_late_2021", "etclate", "etc_late_2021"),
        ("btc_xlm_lead_2021", "xlmlead", "xlm_lead_2021"),
        ("btc_trx_flat_2021", "trxflat", "trx_flat_2021"),
        ("btc_eos_miss_2021", "eosmiss", "eos_miss_2021"),
        ("btc_algo_new_2021", "algonew", "algo_new_2021"),
        ("btc_aave_peaks_2021", "aavepeaks", "aave_peaks_2021"),
        ("btc_near_span_2021", "nearspan", "near_span_2021"),
    )
    kills = {}
    for name, key, signal_name in specs:
        signals = signals_for(signal_name, tapes[key])
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
        if not entries:
            raise SystemExit("no entries for %s" % name)
        gap = row["pool_bps"] - row["stress_bps"]
        print("COST %s trips %d gap %.1f expected %d" % (name, row["trips"], gap, 40 * row["trips"]), flush=True)
        kills[name] = row
        describe(name, p30.shift(entries[0], -1), btc_opens, tapes[key])
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 08:29:12 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series are BCH, ETC, XLM, TRX, EOS, ALGO, AAVE, and NEAR spot 1h tapes. "
            "Open, high, low, close, base volume, and taker-buy fields are not the signal. "
            "These tapes are not a stand-in for USD-M metrics or for book depth. "
            "None of these is a BTC contract-count path. "
            "None of these is ETH funding. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a top-trader position-ratio or account-ratio slice. "
            "None compares one coin's N-day close return with another's. "
            "The account-minus-position gap narrowing is not rerun. "
            "None lowers 1.30, 0.001, 0.0015, 0.002, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, or to 53, and no year is extended. "
            "The separation of 11 is not lowered. "
            "The funding-sum half and the funding hour comparison are not changed. "
            "The interior funding peak is not rescored. "
            "The OKX basis is not in this run. "
            "Liquidation snapshots are not in this run and are not replaced. "
            "The LINK quote-volume screen is not rerun and its null is not loosened. "
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
            raise SystemExit("summary_pass39.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
