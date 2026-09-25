"""Eight frozen Revolut X screens. Funding mechanisms only.

Reads the eight rule texts hashed at 2026-09-25 07:57:00 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass37.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
The account-minus-position gap narrowing is not rerun at a different cost.
Liquidation snapshots are not scored and are not replaced.
The 60-trip gate is not lowered to 12, to 46, or to 56, and no screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass37.py
    python3 docs/agents/scripts/fp5/screen_pass37.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass37")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass37.json")
SHA = {
    "sumease": "ff35cac5f7ca2823317fbcc02f3a9670c61496c7f01b1aa53ca1ad1a72bb1088",
    "sumhalf": "1585d4b52c3e7e1c114bf9c960295bc5206842314c95b7ad31e3f03bf93fe4ba",
    "slotdiv": "e5a2451e6d0064af438b9f8f3fadfa6e614451da0d4c5807fd788c85a00c9d51",
    "slotall": "211e44584c3bed4bb6497b2837006197ac89996e610959bfc9f24fb678c80c82",
    "quiet16": "62f83b42ebbd6f7ccc239208a11d479a5d9349c225a6f911d8631d78fe7d6977",
    "wkndpos": "5962409bca7cd254c2608efc7543bc4f0cbe9e2c948413cdc2a9c4d8d38e3919",
    "stepup": "a5b17a5694c76bc3ed8bf3c73c4c5f49e748dbc78d905f2c1fa05f85f5188a94",
    "straddle": "74a5475d3becfdcb6bd98b28303dd5dd6a7ff1c800faa01793fa52234eabaa60",
}
HOURS = (0, 8, 16)


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


def hours_of(rows):
    found = {}
    for hour, rate in rows:
        if hour in found:
            return None
        found[hour] = rate
    if tuple(sorted(found)) != HOURS:
        return None
    return found


def ease(sums):
    out = set()
    for day, today in sums.items():
        yesterday = sums.get(p30.shift(day, -1))
        older = sums.get(p30.shift(day, -2))
        if yesterday is None or older is None:
            continue
        if today > 0.0 and yesterday > 0.0 and older > 0.0 and today < yesterday:
            out.add(day)
    return out


def half(sums):
    out = set()
    for day, today in sums.items():
        yesterday = sums.get(p30.shift(day, -1))
        if yesterday is None:
            continue
        if yesterday > 0.0 and today * 2.0 < yesterday:
            out.add(day)
    return out


def slot_split(hours):
    out = set()
    for day, today in hours.items():
        yesterday = hours.get(p30.shift(day, -1))
        if yesterday is None:
            continue
        if today[8] > yesterday[8] and today[16] < yesterday[16]:
            out.add(day)
    return out


def slot_rise(hours):
    out = set()
    for day, today in hours.items():
        yesterday = hours.get(p30.shift(day, -1))
        if yesterday is None:
            continue
        if all(today[hour] > yesterday[hour] for hour in HOURS):
            out.add(day)
    return out


def quiet(hours):
    out = set()
    for day, today in hours.items():
        close = abs(today[16])
        if close < abs(today[0]) and close < abs(today[8]):
            out.add(day)
    return out


def weekend(sums):
    out = set()
    for day, today in sums.items():
        if p5.parse_ymd(day).weekday() != 6:
            continue
        friday = sums.get(p30.shift(day, -2))
        saturday = sums.get(p30.shift(day, -1))
        if friday is None or saturday is None:
            continue
        if friday > 0.0 and saturday > 0.0 and today > 0.0:
            out.add(day)
    return out


def steps(hours):
    out = set()
    for day, today in hours.items():
        first, second = today[8] - today[0], today[16] - today[8]
        if first > 0.0 and second > 0.0 and second > first:
            out.add(day)
    return out


def both_signs(lists):
    out = set()
    for day, rates in lists.items():
        if len(rates) < 3:
            continue
        if min(rates) < 0.0 and max(rates) > 0.0:
            out.add(day)
    return out


def input_jobs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2017-08", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for ym in p5.months("2020-09", "2021-12"):
        name = "ETHUSDT-fundingRate-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/fundingRate/ETHUSDT/" + name
        jobs.append((url, os.path.join(INP, "funding", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass37 inputs ready", flush=True)


def load_funding(folder, prefix):
    names = sorted(n for n in os.listdir(folder) if n.startswith(prefix) and n.endswith(".zip"))
    if not names:
        raise SystemExit("funding gap: no %s files" % prefix)
    by_day = {}
    for name in names:
        lines = p5.zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if "last_funding_rate" not in header or "calc_time" not in header:
            raise SystemExit("funding header is not the locked columns: %s" % header)
        ti, ri = header.index("calc_time"), header.index("last_funding_rate")
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            ts = int(parts[ti])
            ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
            when = datetime.fromtimestamp(ts, timezone.utc)
            day = p5.ymd(when)
            by_day.setdefault(day, []).append((ts, when.hour, float(parts[ri])))
    lists, hours = {}, {}
    for day, rows in by_day.items():
        rows.sort()
        lists[day] = [rate for _, _, rate in rows]
        slot = hours_of([(hour, rate) for _, hour, rate in rows])
        if slot is not None:
            hours[day] = slot
    return lists, hours


def sums_of(lists):
    return {day: sum(rates) for day, rates in lists.items() if len(rates) >= 3}


def self_check():
    p30.self_check()
    sums = {"2021-01-01": 0.001, "2021-01-02": 0.002, "2021-01-03": 0.0015}
    if ease(sums) != {"2021-01-03"}:
        raise SystemExit("ease")
    sums["2021-01-03"] = 0.002
    if ease(sums):
        raise SystemExit("ease tie")
    sums["2021-01-03"] = 0.0
    if ease(sums):
        raise SystemExit("ease zero")
    sums = {"2021-01-01": 0.004, "2021-01-02": 0.001}
    if half(sums) != {"2021-01-02"}:
        raise SystemExit("half")
    sums["2021-01-02"] = 0.002
    if half(sums):
        raise SystemExit("half tie")
    sums["2021-01-01"] = 0.0
    sums["2021-01-02"] = -0.001
    if half(sums):
        raise SystemExit("half yesterday flat")
    yday = {0: 0.001, 8: 0.002, 16: 0.002}
    today = {0: 0.001, 8: 0.003, 16: 0.001}
    hours = {"2021-01-01": yday, "2021-01-02": today}
    if slot_split(hours) != {"2021-01-02"}:
        raise SystemExit("split")
    hours["2021-01-02"] = {0: 0.001, 8: 0.002, 16: 0.001}
    if slot_split(hours):
        raise SystemExit("split tie")
    hours["2021-01-02"] = {0: 0.002, 8: 0.003, 16: 0.004}
    if slot_rise(hours) != {"2021-01-02"}:
        raise SystemExit("rise")
    hours["2021-01-02"] = {0: 0.002, 8: 0.002, 16: 0.004}
    if slot_rise(hours):
        raise SystemExit("rise tie")
    hours = {"2021-01-01": {0: 0.003, 8: -0.002, 16: 0.001}}
    if quiet(hours) != {"2021-01-01"}:
        raise SystemExit("quiet")
    hours["2021-01-01"] = {0: 0.001, 8: 0.002, 16: 0.001}
    if quiet(hours):
        raise SystemExit("quiet tie")
    sums = {"2021-01-01": 0.001, "2021-01-02": 0.001, "2021-01-03": 0.001, "2021-01-04": 0.001}
    if weekend(sums) != {"2021-01-03"}:
        raise SystemExit("weekend")
    sums["2021-01-02"] = 0.0
    if weekend(sums):
        raise SystemExit("weekend zero")
    hours = {"2021-01-01": {0: 0.001, 8: 0.002, 16: 0.004}}
    if steps(hours) != {"2021-01-01"}:
        raise SystemExit("steps")
    hours["2021-01-01"] = {0: 0.001, 8: 0.003, 16: 0.004}
    if steps(hours):
        raise SystemExit("steps smaller")
    hours["2021-01-01"] = {0: 0.001, 8: 0.002, 16: 0.003}
    if steps(hours):
        raise SystemExit("steps tie")
    if both_signs({"2021-01-01": [0.001, -0.0001, 0.002]}) != {"2021-01-01"}:
        raise SystemExit("straddle")
    if both_signs({"2021-01-01": [0.001, 0.0, 0.002]}):
        raise SystemExit("straddle zero")
    if both_signs({"2021-01-01": [0.001, 0.002, 0.003]}):
        raise SystemExit("straddle positive")
    if both_signs({"2021-01-01": [-0.001, 0.002]}):
        raise SystemExit("straddle short")


def describe(name, signal, btc_opens, series):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "eth_sum_ease_2021":
        detail = "ETH sums %.8f < %.8f, older %.8f" % (
            series["sums"][signal],
            series["sums"][p30.shift(signal, -1)],
            series["sums"][p30.shift(signal, -2)])
    elif name == "eth_sum_half_2021":
        yesterday = series["sums"][p30.shift(signal, -1)]
        detail = "ETH sum %.8f under half of %.8f" % (series["sums"][signal], yesterday)
    elif name == "eth_slot_div_2021":
        today = series["hours"][signal]
        yesterday = series["hours"][p30.shift(signal, -1)]
        detail = "08:00 %.8f from %.8f, 16:00 %.8f from %.8f" % (
            today[8], yesterday[8], today[16], yesterday[16])
    elif name == "eth_slot_all_2021":
        today = series["hours"][signal]
        yesterday = series["hours"][p30.shift(signal, -1)]
        detail = "00:00 %.8f from %.8f, 08:00 %.8f from %.8f, 16:00 %.8f from %.8f" % (
            today[0], yesterday[0], today[8], yesterday[8], today[16], yesterday[16])
    elif name == "eth_quiet16_2021":
        today = series["hours"][signal]
        detail = "abs 16:00 %.8f under %.8f and %.8f" % (
            abs(today[16]), abs(today[0]), abs(today[8]))
    elif name == "eth_wknd_pos_2021":
        detail = "Fri %.8f Sat %.8f Sun %.8f" % (
            series["sums"][p30.shift(signal, -2)],
            series["sums"][p30.shift(signal, -1)],
            series["sums"][signal])
    elif name == "eth_step_up_2021":
        today = series["hours"][signal]
        detail = "prints %.8f %.8f %.8f steps %.8f then %.8f" % (
            today[0], today[8], today[16], today[8] - today[0], today[16] - today[8])
    elif name == "eth_straddle_2021":
        rates = series["lists"][signal]
        detail = "ETH low %.8f high %.8f" % (min(rates), max(rates))
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
    if p5.parse_ymd("2021-01-03").weekday() != 6:
        raise SystemExit("sunday")
    lists, hours = load_funding(os.path.join(INP, "funding"), "ETHUSDT")
    sums = sums_of(lists)
    for day in ("2020-12-30", "2020-12-31", "2021-01-01", "2021-01-02", "2021-01-03", "2021-12-31"):
        if day not in sums or day not in hours:
            raise SystemExit("ETH funding missing %s" % day)
    if hours["2021-01-02"].keys() != set(HOURS):
        raise SystemExit("2021-01-02 hours")
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    series = {"sums": sums, "hours": hours, "lists": lists}
    specs = (
        ("eth_sum_ease_2021", ease(sums), "2021-01-01", "2021-12-31"),
        ("eth_sum_half_2021", half(sums), "2021-01-01", "2021-12-31"),
        ("eth_slot_div_2021", slot_split(hours), "2021-01-01", "2021-12-31"),
        ("eth_slot_all_2021", slot_rise(hours), "2021-01-01", "2021-12-31"),
        ("eth_quiet16_2021", quiet(hours), "2021-01-01", "2021-12-31"),
        ("eth_wknd_pos_2021", weekend(sums), "2021-01-01", "2021-12-31"),
        ("eth_step_up_2021", steps(hours), "2021-01-01", "2021-12-31"),
        ("eth_straddle_2021", both_signs(lists), "2021-01-01", "2021-12-31"),
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
        kills[name] = row
        describe(name, p30.shift(entries[0], -1), btc_opens, series)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 07:57:00 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a top-trader position-ratio or account-ratio slice. "
            "None compares one coin's N-day close return with another's. "
            "The account-minus-position gap narrowing is not rerun. "
            "None lowers 1.30, 0.001, 0.0015, 0.002, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
            "The 60-trip gate is not lowered to 12, to 46, or to 56, and no year is extended. "
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
            raise SystemExit("summary_pass37.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
