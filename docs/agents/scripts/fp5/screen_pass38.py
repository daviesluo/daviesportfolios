"""Eight frozen Revolut X screens. BTC contract-count paths only.

Reads the eight rule texts hashed at 2026-09-25 08:11:38 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass38.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
ETH funding is not in this run. The dollar open-interest column is not read.
The account-minus-position gap narrowing is not rerun at a different cost.
Liquidation snapshots are not scored and are not replaced.
The 60-trip gate is not lowered to 12, to 46, to 56, to 36, or to 28,
and no screen year is extended. The funding-sum half and the funding hour
comparison are not changed.

    python3 docs/agents/scripts/fp5/screen_pass38.py
    python3 docs/agents/scripts/fp5/screen_pass38.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass38")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass38.json")
SHA = {
    "oipath": "dc116a51ba7212a1c1b31ce6b2ff8c2e6d6970676ce96dd2d6db4aa8ec1fe91f",
    "oichurn": "0f9fe05603a512a8a381b99c4ea414043f02c8c06ea8f48ee365e19101ae0c4f",
    "oiburst": "cd67afad3e629d4d6bb97e994b994167cfdb4adc39eb3830abc734dcfc54a900",
    "oiorder": "ae5b8c10218c753c9e1fa8b1a094820c423b69ae944fb4c69301897ddcf2912d",
    "oiskew": "6c2b39159d7e8e5df97da3d6153139c71309d867236b007075078706d4b1eea8",
    "oiasia": "8fc1be0b55fef0d1255859ce679a47c049a0c6035368b49d359201d086a887f8",
    "oiruns": "3a846b72f9466fa7c75e50340584f69f6725ab0a0d30e7e6b14af3e2b8af421f",
    "oigap": "9b1335d8f38772333a3b653bbf1369b6537d31b3f4e1869997728e1dc782f890",
}
MIN_PRINTS = 200
MIN_SPAN = 20 * 3600
ASIA_STEPS = 10


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


def steps_of(seq):
    return [(seq[i][0], seq[i][1] - seq[i - 1][1]) for i in range(1, len(seq))]


def path_len(seq):
    return sum(abs(delta) for _, delta in steps_of(seq))


def reversals(seq):
    prev = 0
    count = 0
    for _, delta in steps_of(seq):
        if delta == 0.0:
            continue
        sign = 1 if delta > 0.0 else -1
        if prev != 0 and sign != prev:
            count += 1
        prev = sign
    return count


def burst_share(seq):
    sizes = [abs(delta) for _, delta in steps_of(seq)]
    total = sum(sizes)
    if total <= 0.0:
        return None
    return max(sizes) / total


def max_step(seq):
    return max(abs(delta) for _, delta in steps_of(seq))


def unique_extreme(seq):
    values = [value for _, value in seq]
    low, high = min(values), max(values)
    if values.count(low) != 1 or values.count(high) != 1:
        return None
    t_low = next(when for when, value in seq if value == low)
    t_high = next(when for when, value in seq if value == high)
    return t_low, t_high


def mean_median(seq):
    values = sorted(value for _, value in seq)
    count = len(values)
    if count % 2:
        mid = values[count // 2]
    else:
        mid = (values[count // 2 - 1] + values[count // 2]) / 2.0
    return sum(values) / count, mid


def hour_of(when):
    return when.hour + when.minute / 60.0 + when.second / 3600.0


def window_path(seq, start_hour, end_hour):
    total = 0.0
    count = 0
    for when, delta in steps_of(seq):
        hour = hour_of(when)
        if start_hour <= hour < end_hour:
            total += abs(delta)
            count += 1
    return total, count


def longest_run(seq, positive):
    best = current = 0
    for _, delta in steps_of(seq):
        ok = delta > 0.0 if positive else delta < 0.0
        if ok:
            current += 1
            if current > best:
                best = current
        else:
            current = 0
    return best


def rising_path(days):
    out = set()
    for day in days:
        yesterday = p30.shift(day, -1)
        older = p30.shift(day, -2)
        if yesterday not in days or older not in days:
            continue
        today_path = path_len(days[day])
        prior = path_len(days[yesterday])
        before = path_len(days[older])
        if today_path > prior > before:
            out.add(day)
    return out


def more_reversals(days):
    out = set()
    for day in days:
        yesterday = p30.shift(day, -1)
        if yesterday not in days:
            continue
        if reversals(days[day]) > reversals(days[yesterday]):
            out.add(day)
    return out


def larger_share(days):
    out = set()
    for day in days:
        yesterday = p30.shift(day, -1)
        if yesterday not in days:
            continue
        today = burst_share(days[day])
        prior = burst_share(days[yesterday])
        if today is None or prior is None:
            continue
        if today > prior:
            out.add(day)
    return out


def extreme_flip(days):
    out = set()
    for day in days:
        yesterday = p30.shift(day, -1)
        if yesterday not in days:
            continue
        today = unique_extreme(days[day])
        prior = unique_extreme(days[yesterday])
        if today is None or prior is None:
            continue
        if today[0] < today[1] and prior[1] < prior[0]:
            out.add(day)
    return out


def skew_flip(days):
    out = set()
    for day in days:
        yesterday = p30.shift(day, -1)
        if yesterday not in days:
            continue
        today_mean, today_mid = mean_median(days[day])
        prior_mean, prior_mid = mean_median(days[yesterday])
        if today_mean > today_mid and prior_mean < prior_mid:
            out.add(day)
    return out


def asia_flip(days):
    out = set()
    for day in days:
        yesterday = p30.shift(day, -1)
        if yesterday not in days:
            continue
        today_early, today_early_n = window_path(days[day], 0, 4)
        today_late, today_late_n = window_path(days[day], 4, 8)
        prior_early, prior_early_n = window_path(days[yesterday], 0, 4)
        prior_late, prior_late_n = window_path(days[yesterday], 4, 8)
        if min(today_early_n, today_late_n, prior_early_n, prior_late_n) < ASIA_STEPS:
            continue
        if today_early > today_late and prior_early < prior_late:
            out.add(day)
    return out


def longer_runs(days):
    out = set()
    for day in days:
        yesterday = p30.shift(day, -1)
        if yesterday not in days:
            continue
        if (longest_run(days[day], True) > longest_run(days[yesterday], True)
                and longest_run(days[day], False) > longest_run(days[yesterday], False)):
            out.add(day)
    return out


def larger_step(days):
    out = set()
    for day in days:
        yesterday = p30.shift(day, -1)
        if yesterday not in days:
            continue
        if max_step(days[day]) > max_step(days[yesterday]):
            out.add(day)
    return out


def complete(seq):
    if len(seq) < MIN_PRINTS:
        return False
    return (seq[-1][0] - seq[0][0]).total_seconds() >= MIN_SPAN


def at(hour, minute, value, second=0):
    return datetime(2021, 1, 1, hour, minute, second, tzinfo=timezone.utc), value


def self_check():
    p30.self_check()
    short = [(datetime(2021, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=5 * i), float(i))
             for i in range(199)]
    if complete(short):
        raise SystemExit("199 prints")
    span = [(datetime(2021, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=i * MIN_SPAN / 199), float(i))
            for i in range(200)]
    if not complete(span):
        raise SystemExit("20 hour span")
    early = [(datetime(2021, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=i * (MIN_SPAN - 1) / 199), float(i))
             for i in range(200)]
    if complete(early):
        raise SystemExit("span short of 20 hours")
    path_days = {
        "2021-01-01": [at(0, 0, 0), at(0, 5, 1)],
        "2021-01-02": [at(0, 0, 0), at(0, 5, 3)],
        "2021-01-03": [at(0, 0, 0), at(0, 5, 6)],
    }
    if rising_path(path_days) != {"2021-01-03"}:
        raise SystemExit("path")
    path_days["2021-01-03"] = [at(0, 0, 0), at(0, 5, 3)]
    if rising_path(path_days):
        raise SystemExit("path tie")
    churn_days = {
        "2021-01-01": [at(0, 0, 0), at(0, 5, 1), at(0, 10, 2)],
        "2021-01-02": [at(0, 0, 0), at(0, 5, 1), at(0, 10, 0)],
    }
    if more_reversals(churn_days) != {"2021-01-02"}:
        raise SystemExit("churn")
    flat_zero = {
        "2021-01-01": [at(0, 0, 0), at(0, 5, 1), at(0, 10, 2), at(0, 15, 1)],
        "2021-01-02": [at(0, 0, 0), at(0, 5, 1), at(0, 10, 1), at(0, 15, 0)],
    }
    if reversals(flat_zero["2021-01-01"]) != 1 or reversals(flat_zero["2021-01-02"]) != 1:
        raise SystemExit("zero step")
    if more_reversals(flat_zero):
        raise SystemExit("churn tie")
    burst_days = {
        "2021-01-01": [at(0, 0, 0), at(0, 5, 1), at(0, 10, 2)],
        "2021-01-02": [at(0, 0, 0), at(0, 5, 3), at(0, 10, 4)],
    }
    if larger_share(burst_days) != {"2021-01-02"}:
        raise SystemExit("burst")
    burst_days["2021-01-02"] = [at(0, 0, 0), at(0, 5, 1), at(0, 10, 2)]
    if larger_share(burst_days):
        raise SystemExit("burst tie")
    order_days = {
        "2021-01-01": [at(0, 0, 2), at(0, 5, 0), at(0, 10, 1)],
        "2021-01-02": [at(0, 0, 1), at(0, 5, 0), at(0, 10, 2)],
    }
    if extreme_flip(order_days) != {"2021-01-02"}:
        raise SystemExit("order")
    order_days["2021-01-02"] = [at(0, 0, 1), at(0, 5, 0), at(0, 10, 0)]
    if extreme_flip(order_days):
        raise SystemExit("order tie")
    skew_days = {
        "2021-01-01": [at(0, 0, 1), at(0, 5, 3), at(0, 10, 3)],
        "2021-01-02": [at(0, 0, 1), at(0, 5, 1), at(0, 10, 4)],
    }
    if skew_flip(skew_days) != {"2021-01-02"}:
        raise SystemExit("skew")
    skew_days["2021-01-02"] = [at(0, 0, 1), at(0, 5, 2), at(0, 10, 3)]
    if skew_flip(skew_days):
        raise SystemExit("skew tie")
    even = [at(0, i * 5, value) for i, value in enumerate((1, 2, 3, 10))]
    if mean_median(even) != (4.0, 2.5):
        raise SystemExit("even median")
    boundary = [at(3, 55, 0), at(4, 0, 10)]
    early_sum, early_n = window_path(boundary, 0, 4)
    late_sum, late_n = window_path(boundary, 4, 8)
    if early_n != 0 or late_n != 1 or late_sum != 10.0:
        raise SystemExit("04:00 boundary")
    today = [at(0, 5 * i, float(i)) for i in range(12)]
    today += [at(4, 5 * i, 11.0 + 0.1 * i) for i in range(12)]
    yesterday = [at(0, 5 * i, 0.1 * i) for i in range(12)]
    yesterday += [at(4, 5 * i, float(i)) for i in range(12)]
    asia_days = {"2021-01-01": yesterday, "2021-01-02": today}
    if asia_flip(asia_days) != {"2021-01-02"}:
        raise SystemExit("asia")
    asia_days["2021-01-02"] = yesterday
    if asia_flip(asia_days):
        raise SystemExit("asia tie")
    run_days = {
        "2021-01-01": [at(0, 0, 0), at(0, 5, 1), at(0, 10, 0)],
        "2021-01-02": [at(0, 0, 0), at(0, 5, 1), at(0, 10, 2), at(0, 15, 1), at(0, 20, 0)],
    }
    if longer_runs(run_days) != {"2021-01-02"}:
        raise SystemExit("runs")
    run_days["2021-01-02"] = [at(0, 0, 0), at(0, 5, 1), at(0, 10, 1), at(0, 15, 0)]
    if longest_run(run_days["2021-01-02"], True) != 1:
        raise SystemExit("zero breaks a run")
    if longer_runs(run_days):
        raise SystemExit("runs tie")
    gap_days = {
        "2021-01-01": [at(0, 0, 0), at(0, 5, 4)],
        "2021-01-02": [at(0, 0, 0), at(0, 5, 5)],
    }
    if larger_step(gap_days) != {"2021-01-02"}:
        raise SystemExit("gap")
    gap_days["2021-01-02"] = [at(0, 0, 0), at(0, 5, 4)]
    if larger_step(gap_days):
        raise SystemExit("gap tie")


def input_jobs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2017-08", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for day in p5.daterange("2020-12-01", "2021-12-31"):
        name = "BTCUSDT-metrics-%s.zip" % day
        url = p5.VISION + "futures/um/daily/metrics/BTCUSDT/" + name
        jobs.append((url, os.path.join(INP, "metrics", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass38 inputs ready", flush=True)


def load_contracts(folder):
    names = sorted(n for n in os.listdir(folder) if n.startswith("BTCUSDT-metrics-") and n.endswith(".zip"))
    if not names:
        raise SystemExit("contract-count gap: no metrics files")
    days = {}
    for name in names:
        lines = p5.zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if "sum_open_interest" not in header or "create_time" not in header:
            raise SystemExit("contract column absent: %s" % header)
        if "sum_open_interest_value" not in header:
            raise SystemExit("dollar column missing; do not substitute another column")
        ti = header.index("create_time")
        oi = header.index("sum_open_interest")
        if header[oi] != "sum_open_interest":
            raise SystemExit("contract column moved")
        if oi == header.index("sum_open_interest_value"):
            raise SystemExit("contract column collapsed into the dollar column")
        seen = {}
        conflict = False
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            raw = parts[oi]
            if raw == "":
                continue
            stamp = parts[ti]
            value = float(raw)
            if stamp in seen and seen[stamp] != value:
                conflict = True
                break
            seen[stamp] = value
        file_day = name.split("metrics-")[1][:10]
        if conflict or not seen:
            continue
        seq = []
        for stamp, value in seen.items():
            when = datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            seq.append((when, value))
        seq.sort()
        if p5.ymd(seq[0][0]) != file_day and p5.ymd(seq[-1][0]) != file_day:
            raise SystemExit("metrics day mismatch %s" % name)
        if complete(seq):
            days[file_day] = seq
    return days


def describe(name, signal, btc_opens, days):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    today = days[signal]
    yesterday = days[p30.shift(signal, -1)]
    if name == "btc_oi_path_2021":
        older = days[p30.shift(signal, -2)]
        detail = "path %.4f > %.4f > %.4f" % (path_len(today), path_len(yesterday), path_len(older))
    elif name == "btc_oi_churn_2021":
        detail = "reversals %d from %d" % (reversals(today), reversals(yesterday))
    elif name == "btc_oi_burst_2021":
        detail = "share %.6f from %.6f" % (burst_share(today), burst_share(yesterday))
    elif name == "btc_oi_order_2021":
        low, high = unique_extreme(today)
        prior_low, prior_high = unique_extreme(yesterday)
        detail = "low %s high %s, prior high %s low %s" % (
            low.strftime("%H:%M:%S"), high.strftime("%H:%M:%S"),
            prior_high.strftime("%H:%M:%S"), prior_low.strftime("%H:%M:%S"))
    elif name == "btc_oi_skew_2021":
        today_mean, today_mid = mean_median(today)
        prior_mean, prior_mid = mean_median(yesterday)
        detail = "mean %.4f median %.4f, prior mean %.4f median %.4f" % (
            today_mean, today_mid, prior_mean, prior_mid)
    elif name == "btc_oi_asia_2021":
        early, _ = window_path(today, 0, 4)
        late, _ = window_path(today, 4, 8)
        prior_early, _ = window_path(yesterday, 0, 4)
        prior_late, _ = window_path(yesterday, 4, 8)
        detail = "00-04 %.4f over 04-08 %.4f, prior %.4f under %.4f" % (
            early, late, prior_early, prior_late)
    elif name == "btc_oi_runs_2021":
        detail = "up %d from %d, down %d from %d" % (
            longest_run(today, True), longest_run(yesterday, True),
            longest_run(today, False), longest_run(yesterday, False))
    elif name == "btc_oi_gap_2021":
        detail = "step %.4f from %.4f" % (max_step(today), max_step(yesterday))
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
    days = load_contracts(os.path.join(INP, "metrics"))
    if "2021-06-22" in days:
        raise SystemExit("short metrics day was treated as complete")
    if "2021-01-01" not in days or len(days["2021-01-01"]) != 288:
        raise SystemExit("2021-01-01 contract path")
    if "2020-12-31" not in days or "2021-12-31" not in days:
        raise SystemExit("contract path does not cover the year boundary")
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_oi_path_2021", rising_path(days), "2021-01-01", "2021-12-31"),
        ("btc_oi_churn_2021", more_reversals(days), "2021-01-01", "2021-12-31"),
        ("btc_oi_burst_2021", larger_share(days), "2021-01-01", "2021-12-31"),
        ("btc_oi_order_2021", extreme_flip(days), "2021-01-01", "2021-12-31"),
        ("btc_oi_skew_2021", skew_flip(days), "2021-01-01", "2021-12-31"),
        ("btc_oi_asia_2021", asia_flip(days), "2021-01-01", "2021-12-31"),
        ("btc_oi_runs_2021", longer_runs(days), "2021-01-01", "2021-12-31"),
        ("btc_oi_gap_2021", larger_step(days), "2021-01-01", "2021-12-31"),
    )
    kills = {}
    for name, signals, start, end in specs:
        row = p30.run_open(name, p30.marked_for(signals, start, end), btc_ret, eth_ret, 400)
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
        describe(name, p30.shift(entries[0], -1), btc_opens, days)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 08:11:38 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is BTCUSDT sum_open_interest. The dollar column is not read. "
            "None of these is ETH funding. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a top-trader position-ratio or account-ratio slice. "
            "None compares one coin's N-day close return with another's. "
            "The account-minus-position gap narrowing is not rerun. "
            "None lowers 1.30, 0.001, 0.0015, 0.002, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, or to 28, and no year is extended. "
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
            raise SystemExit("summary_pass38.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
