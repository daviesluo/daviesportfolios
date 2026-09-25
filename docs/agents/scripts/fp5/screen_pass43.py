"""Eight frozen Revolut X screens. USD-M taker-buy base, eight mechanisms.

Reads the eight rule texts hashed at 2026-09-25 09:11:49 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass43.json. Public market archives only.
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
The taker ratio and the average trade size are not formed.
The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53,
to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, or to 18,
and no screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass43.py
    python3 docs/agents/scripts/fp5/screen_pass43.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass43")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass43.json")
SHA = {
    "neoweek": "5523d2603a51b3b5a5c84c38b8beeea7bd9e7c7191b61c1c493916b180509a26",
    "iotagap": "487f857826e07c39a897d76b2e9a5d103f484f682b7341e2c162d4945bd55a12",
    "vetpair": "0fa027cb662dedb321f121975ee8add59b64c6a70a493a7920933b6c90712ef2",
    "onttrough": "9e1b2e1d4f4d6887c3995d656d56694c1d492156765a5ebb8a1acb404500ba2a",
    "zilweight": "30e4b0532d3236f7b18e0524201710fd494fc4d152251f574e8860321997fdd2",
    "batinside": "4f9fd29254025a021178fff80d31ae531c326554f2aad0cb031b44562cd1d193",
    "enjzig": "e392057c7f47a3182a1a97a5dca6fd987b4cb3cfb906a6ca9f815f3a5413e24d",
    "grtpeak": "441b98c69b6a533478ad06f0e398025238e4a4122e58582c95bb19d2fb7df05b",
}
PAIRS = (
    ("neoweek", "NEOUSDT"),
    ("iotagap", "IOTAUSDT"),
    ("vetpair", "VETUSDT"),
    ("onttrough", "ONTUSDT"),
    ("zilweight", "ZILUSDT"),
    ("batinside", "BATUSDT"),
    ("enjzig", "ENJUSDT"),
    ("grtpeak", "GRTUSDT"),
)
EARLIEST = {
    "neoweek": "2020-12-17",
    "iotagap": "2020-12-28",
    "vetpair": "2020-12-27",
    "onttrough": "2020-12-27",
    "zilweight": "2020-12-26",
    "batinside": "2020-12-28",
    "enjzig": "2020-12-28",
    "grtpeak": "2020-12-21",
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
        have = sha256_file(os.path.join(RULES, name + "_rule.txt"))
        if have != digest:
            raise SystemExit("rule text moved after the freeze: %s %s" % (name, have))
        found[name] = have
    return found


def load_taker(folder):
    """Taker-buy base volume at field 9. Quote volume is not read."""
    days = {}
    bad = set()
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 10:
            raise SystemExit("daily field gap in %s" % folder)
        day = p5.ymd(p30.stamp_of(int(parts[0])))
        value = float(parts[9])
        if day in days and days[day] != value:
            days[day] = None
            bad.add(day)
        elif day not in days:
            days[day] = value
    return {day: value for day, value in days.items() if value is not None and day not in bad}


def window(series, day, n):
    vals = []
    for i in range(n):
        prior = p30.shift(day, -i)
        if prior not in series:
            return None
        vals.append(series[prior])
    return vals


def week_ladder(series):
    out = set()
    for day in series:
        back7 = p30.shift(day, -7)
        back14 = p30.shift(day, -14)
        if back7 in series and back14 in series and series[day] > series[back7] > series[back14]:
            out.add(day)
    return out


def smaller_far(series):
    out = set()
    for day in series:
        back1 = p30.shift(day, -1)
        back3 = p30.shift(day, -3)
        if back1 not in series or back3 not in series:
            continue
        near = abs(series[day] - series[back1])
        far = abs(series[back1] - series[back3])
        if near != 0 and far != 0 and near < far:
            out.add(day)
    return out


def rising_pair(series):
    out = set()
    for day in series:
        vals = window(series, day, 5)
        if not vals:
            continue
        newest_first = [vals[i] - vals[i + 1] for i in range(4)]
        if any(step == 0 for step in newest_first):
            continue
        time_order = list(reversed(newest_first))
        runs = []
        cur = 0
        for step in time_order:
            if step > 0:
                cur += 1
            else:
                if cur:
                    runs.append(cur)
                cur = 0
        if cur:
            runs.append(cur)
        if runs == [2]:
            out.add(day)
    return out


def interior_trough(series):
    out = set()
    for day in series:
        vals = window(series, day, 5)
        if vals and vals[2] < vals[0] and vals[2] < vals[1] and vals[2] < vals[3] and vals[2] < vals[4]:
            out.add(day)
    return out


def front_weight(series):
    out = set()
    for day in series:
        vals = window(series, day, 6)
        if vals and 3 * vals[0] + 2 * vals[1] + vals[2] > vals[3] + 2 * vals[4] + 3 * vals[5]:
            out.add(day)
    return out


def upper_half(series):
    out = set()
    for day in series:
        vals = window(series, day, 4)
        if not vals:
            continue
        lo = min(vals[1:])
        hi = max(vals[1:])
        if hi > lo and lo < vals[0] < hi and 2 * vals[0] > lo + hi:
            out.add(day)
    return out


def down_up_down(series):
    out = set()
    for day in series:
        vals = window(series, day, 4)
        if vals and vals[0] < vals[1] and vals[1] > vals[2] and vals[2] < vals[3]:
            out.add(day)
    return out


def peak_six(series):
    out = set()
    for day in series:
        vals = window(series, day, 11)
        if not vals:
            continue
        peak = vals[6]
        others = vals[1:6] + vals[7:11]
        if all(peak > other for other in others) and vals[0] > vals[1]:
            out.add(day)
    return out


def signals_for(name, series):
    if name == "neo_tb_week_2021":
        return week_ladder(series)
    if name == "iota_tb_gap_2021":
        return smaller_far(series)
    if name == "vet_tb_pair_2021":
        return rising_pair(series)
    if name == "ont_tb_trough_2021":
        return interior_trough(series)
    if name == "zil_tb_weight_2021":
        return front_weight(series)
    if name == "bat_tb_inside_2021":
        return upper_half(series)
    if name == "enj_tb_zig_2021":
        return down_up_down(series)
    if name == "grt_tb_peak_2021":
        return peak_six(series)
    raise SystemExit("no signal for %s" % name)


def self_check():
    p30.self_check()
    week = {"2021-01-01": 1.0, "2021-01-08": 2.0, "2021-01-15": 3.0}
    if week_ladder(week) != {"2021-01-15"}:
        raise SystemExit("week")
    week["2021-01-15"] = 2.0
    if week_ladder(week):
        raise SystemExit("week tie")
    gap = {"2021-01-01": 10.0, "2021-01-03": 1.0, "2021-01-04": 4.0}
    if smaller_far(gap) != {"2021-01-04"}:
        raise SystemExit("gap")
    gap["2021-01-04"] = 10.0
    if smaller_far(gap):
        raise SystemExit("gap tie")
    gap["2021-01-04"] = 1.0
    if smaller_far(gap):
        raise SystemExit("gap zero")
    pair = {"2021-01-01": 5.0, "2021-01-02": 4.0, "2021-01-03": 3.0, "2021-01-04": 4.0, "2021-01-05": 5.0}
    if rising_pair(pair) != {"2021-01-05"}:
        raise SystemExit("pair")
    triple = {"2021-01-01": 1.0, "2021-01-02": 2.0, "2021-01-03": 3.0, "2021-01-04": 4.0, "2021-01-05": 3.0}
    if rising_pair(triple):
        raise SystemExit("pair three")
    alone = {"2021-01-01": 3.0, "2021-01-02": 2.0, "2021-01-03": 3.0, "2021-01-04": 2.0, "2021-01-05": 1.0}
    if rising_pair(alone):
        raise SystemExit("pair one")
    zero = {"2021-01-01": 1.0, "2021-01-02": 1.0, "2021-01-03": 2.0, "2021-01-04": 3.0, "2021-01-05": 4.0}
    if rising_pair(zero):
        raise SystemExit("pair zero")
    low = {"2021-01-01": 5.0, "2021-01-02": 4.0, "2021-01-03": 1.0, "2021-01-04": 3.0, "2021-01-05": 2.0}
    if interior_trough(low) != {"2021-01-05"}:
        raise SystemExit("trough")
    low["2021-01-03"] = 2.0
    if interior_trough(low):
        raise SystemExit("trough tie")
    weighted = {}
    for i, value in enumerate((1, 1, 1, 1, 2, 3), 1):
        weighted["2021-01-%02d" % i] = float(value)
    if front_weight(weighted) != {"2021-01-06"}:
        raise SystemExit("weight")
    for i in range(1, 7):
        weighted["2021-01-%02d" % i] = 1.0
    if front_weight(weighted):
        raise SystemExit("weight tie")
    inside = {"2021-01-01": 1.0, "2021-01-02": 5.0, "2021-01-03": 3.0, "2021-01-04": 4.0}
    if upper_half(inside) != {"2021-01-04"}:
        raise SystemExit("inside")
    inside["2021-01-04"] = 3.0
    if upper_half(inside):
        raise SystemExit("inside mid")
    inside["2021-01-04"] = 5.0
    if upper_half(inside):
        raise SystemExit("inside end")
    flat = {"2021-01-01": 2.0, "2021-01-02": 2.0, "2021-01-03": 2.0, "2021-01-04": 2.0}
    if upper_half(flat):
        raise SystemExit("inside flat")
    zig = {"2021-01-01": 5.0, "2021-01-02": 3.0, "2021-01-03": 4.0, "2021-01-04": 2.0}
    if down_up_down(zig) != {"2021-01-04"}:
        raise SystemExit("zig")
    zig = {"2021-01-01": 1.0, "2021-01-02": 3.0, "2021-01-03": 2.0, "2021-01-04": 4.0}
    if down_up_down(zig):
        raise SystemExit("zig flip")
    peak = {}
    for i in range(1, 12):
        peak["2021-01-%02d" % i] = 1.0
    peak["2021-01-05"] = 10.0
    peak["2021-01-10"] = 2.0
    peak["2021-01-11"] = 3.0
    if peak_six(peak) != {"2021-01-11"}:
        raise SystemExit("peak")
    peak["2021-01-07"] = 10.0
    if peak_six(peak):
        raise SystemExit("peak tie")
    peak["2021-01-07"] = 1.0
    peak["2021-01-11"] = 2.0
    if peak_six(peak):
        raise SystemExit("peak flat step")
    if smaller_far({"2021-01-01": 9.0, "2021-01-04": 1.0}):
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
    print("pass43 inputs ready", flush=True)


def describe(name, signal, btc_opens, series):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "neo_tb_week_2021":
        detail = "taker %.4f above %.4f above %.4f" % (
            series[signal], series[p30.shift(signal, -7)], series[p30.shift(signal, -14)])
    elif name == "iota_tb_gap_2021":
        near = abs(series[signal] - series[p30.shift(signal, -1)])
        far = abs(series[p30.shift(signal, -1)] - series[p30.shift(signal, -3)])
        detail = "gap %.4f under %.4f" % (near, far)
    elif name == "vet_tb_pair_2021":
        vals = window(series, signal, 5)
        steps = list(reversed([vals[i] - vals[i + 1] for i in range(4)]))
        detail = "steps %.4f %.4f %.4f %.4f" % tuple(steps)
    elif name == "ont_tb_trough_2021":
        vals = window(series, signal, 5)
        detail = "trough %.4f under %.4f %.4f %.4f %.4f" % (vals[2], vals[0], vals[1], vals[3], vals[4])
    elif name == "zil_tb_weight_2021":
        vals = window(series, signal, 6)
        detail = "front %.4f above %.4f" % (
            3 * vals[0] + 2 * vals[1] + vals[2], vals[3] + 2 * vals[4] + 3 * vals[5])
    elif name == "bat_tb_inside_2021":
        vals = window(series, signal, 4)
        detail = "taker %.4f inside %.4f %.4f" % (vals[0], min(vals[1:]), max(vals[1:]))
    elif name == "enj_tb_zig_2021":
        vals = window(series, signal, 4)
        detail = "taker %.4f %.4f %.4f %.4f" % tuple(vals)
    elif name == "grt_tb_peak_2021":
        vals = window(series, signal, 11)
        detail = "peak %.4f six back, today %.4f above %.4f" % (vals[6], vals[0], vals[1])
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
        series = load_taker(os.path.join(INP, "klines", "um", sym, "1d"))
        for day in (EARLIEST[key], "2020-12-31", "2021-01-01", "2021-12-31"):
            if day not in series:
                raise SystemExit("tape gap %s %s" % (sym, day))
        year = [day for day in series if day.startswith("2021")]
        if len(year) != 365:
            raise SystemExit("um year %s %d" % (sym, len(year)))
        tapes[key] = series
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("neo_tb_week_2021", "neoweek"),
        ("iota_tb_gap_2021", "iotagap"),
        ("vet_tb_pair_2021", "vetpair"),
        ("ont_tb_trough_2021", "onttrough"),
        ("zil_tb_weight_2021", "zilweight"),
        ("bat_tb_inside_2021", "batinside"),
        ("enj_tb_zig_2021", "enjzig"),
        ("grt_tb_peak_2021", "grtpeak"),
    )
    kills = {}
    for name, key in specs:
        series = tapes[key]
        signals = signals_for(name, series)
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
        describe(name, p30.shift(entries[0], -1), btc_opens, series)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 09:11:49 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series are Binance USD-M perpetual 1d taker-buy base volumes, field 9. "
            "Open, high, low, close, quote volume, base volume, trade count, and taker-buy quote volume are not the signal. "
            "The taker ratio is not formed. The average trade size is not formed. "
            "No coin-margined kline is read as the signal. No spot kline is read as the signal. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Perpetual quote volume relative to the previous days is not rerun. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "A numeric clear on this daily open is not a testing row. "
            "These tapes are not a stand-in for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "GRTUSDT daily bars begin on 2020-12-19. The 2021 calendar is complete and the ten-day lookback is present, so the year is not started later. "
            "None of these is a leveraged-token up-versus-down pair. "
            "None of these is a busiest-hour or quietest-hour rule. "
            "None of these is a BTC contract-count path. "
            "None of these is ETH funding. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a top-trader position-ratio or account-ratio slice. "
            "None compares one coin's N-day close return with another's. "
            "The account-minus-position gap narrowing is not rerun. "
            "None lowers 1.30, 0.001, 0.0015, 0.002, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, or to 18, and no year is extended. "
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
            raise SystemExit("summary_pass43.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
