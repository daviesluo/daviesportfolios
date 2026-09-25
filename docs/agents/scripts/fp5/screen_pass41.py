"""Eight frozen Revolut X screens. Coin-margined trade counts, eight mechanisms.

Reads the eight rule texts hashed at 2026-09-25 08:52:52 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass41.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
ETH funding is not in this run. BTC contract-count path shapes are not in this run.
The busiest-hour and quietest-hour family is not rerun on another coin.
Leveraged-token up-versus-down pairs are not rerun on another coin.
The coin-margined versus USDT-margined volume ratio is not formed.
The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53,
to 24, to 39, to 54, to 47, to 15, or to 55, and no screen year is extended.
The separation of 11 is not lowered.

    python3 docs/agents/scripts/fp5/screen_pass41.py
    python3 docs/agents/scripts/fp5/screen_pass41.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass41")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass41.json")
SHA = {
    "btcrise": "b1217dfca777956c0ae6fe3cdaa7fab3032e60ff16ea812f4a10d334839d074d",
    "ethslide": "961398d437f64ce367f89192cf969c7b05e7b1a07897b2c0cfa10f278df3d88a",
    "xrphold": "035f39498d284305559f50cfacbdec6d1fc4e507e70e64ad51c4c9af996ecd05",
    "linktight": "72c39683bc79c2798fb1cb30f1c12d18fbc0085ef44815f1badd862f4f541a06",
    "ltcinside": "c13c8df0868ac79880ce39a0cb3ee2741c569c4c4723222bff06428b63551885",
    "adapeak": "bfa2e68a5ecb782860eab67f8be48495b382d5d862a845b085a46dbf8e8a6f99",
    "dotclose": "1b6434da8de20aa72db5d08df847306337802bb210657324bc6d19a6eea2d101",
    "bnbturn": "7e6e08ae5bdb3d351b02498e3ea6b6b8207f39515ea605a106e0372400eeb757",
}
PAIRS = (
    ("btcrise", "BTCUSD_PERP"),
    ("ethslide", "ETHUSD_PERP"),
    ("xrphold", "XRPUSD_PERP"),
    ("linktight", "LINKUSD_PERP"),
    ("ltcinside", "LTCUSD_PERP"),
    ("adapeak", "ADAUSD_PERP"),
    ("dotclose", "DOTUSD_PERP"),
    ("bnbturn", "BNBUSD_PERP"),
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


def load_count(folder):
    """Trade count at field 8. One bar a day. Quote volume is not read."""
    days = {}
    bad = set()
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 9:
            raise SystemExit("daily field gap in %s" % folder)
        day = p5.ymd(p30.stamp_of(int(parts[0])))
        value = float(parts[8])
        if day in days and days[day] != value:
            days[day] = None
            bad.add(day)
        elif day not in days:
            days[day] = value
    return {day: value for day, value in days.items() if value is not None and day not in bad}


def triple(counts, day):
    prior = p30.shift(day, -1)
    older = p30.shift(day, -2)
    if day not in counts or prior not in counts or older not in counts:
        return None
    return counts[older], counts[prior], counts[day]


def rising(counts):
    out = set()
    for day in counts:
        row = triple(counts, day)
        if row and row[2] > row[1] > row[0]:
            out.add(day)
    return out


def falling(counts):
    out = set()
    for day in counts:
        row = triple(counts, day)
        if row and row[2] < row[1] < row[0]:
            out.add(day)
    return out


def hold_below(counts):
    out = set()
    for day in counts:
        row = triple(counts, day)
        if row and row[1] < row[0] and row[2] > row[1] and row[2] < row[0]:
            out.add(day)
    return out


def tighter(counts):
    out = set()
    for day in counts:
        row = triple(counts, day)
        if not row:
            continue
        first = row[1] - row[0]
        second = row[2] - row[1]
        if first != 0 and second != 0 and abs(second) < abs(first):
            out.add(day)
    return out


def inside(counts):
    out = set()
    for day in counts:
        row = triple(counts, day)
        if not row or row[0] == row[1]:
            continue
        low = row[0] if row[0] < row[1] else row[1]
        high = row[1] if row[0] < row[1] else row[0]
        if low < row[2] < high:
            out.add(day)
    return out


def left_peak(counts):
    out = set()
    for day in counts:
        row = triple(counts, day)
        if row and row[1] > row[0] and row[1] > row[2]:
            out.add(day)
    return out


def closer(counts):
    out = set()
    for day in counts:
        row = triple(counts, day)
        if row and abs(row[2] - row[0]) < abs(row[1] - row[0]):
            out.add(day)
    return out


def turned(counts):
    out = set()
    for day in counts:
        row = triple(counts, day)
        if not row:
            continue
        first = row[1] - row[0]
        second = row[2] - row[1]
        if first != 0 and second != 0 and (first > 0) != (second > 0):
            out.add(day)
    return out


def signals_for(name, counts):
    if name == "btc_cm_rise_2021":
        return rising(counts)
    if name == "eth_cm_slide_2021":
        return falling(counts)
    if name == "xrp_cm_hold_2021":
        return hold_below(counts)
    if name == "link_cm_tight_2021":
        return tighter(counts)
    if name == "ltc_cm_inside_2021":
        return inside(counts)
    if name == "ada_cm_peak_2021":
        return left_peak(counts)
    if name == "dot_cm_close_2021":
        return closer(counts)
    if name == "bnb_cm_turn_2021":
        return turned(counts)
    raise SystemExit("no signal for %s" % name)


def self_check():
    p30.self_check()
    rise = {"2021-01-01": 1.0, "2021-01-02": 2.0, "2021-01-03": 3.0}
    if rising(rise) != {"2021-01-03"}:
        raise SystemExit("rise")
    rise["2021-01-03"] = 2.0
    if rising(rise):
        raise SystemExit("rise tie")
    zero = {"2021-01-01": 0.0, "2021-01-02": 1.0, "2021-01-03": 2.0}
    if rising(zero) != {"2021-01-03"}:
        raise SystemExit("zero is a level")
    fall = {"2021-01-01": 3.0, "2021-01-02": 2.0, "2021-01-03": 1.0}
    if falling(fall) != {"2021-01-03"}:
        raise SystemExit("fall")
    fall["2021-01-03"] = 2.0
    if falling(fall):
        raise SystemExit("fall tie")
    held = {"2021-01-01": 5.0, "2021-01-02": 1.0, "2021-01-03": 3.0}
    if hold_below(held) != {"2021-01-03"}:
        raise SystemExit("hold")
    held["2021-01-03"] = 6.0
    if hold_below(held):
        raise SystemExit("hold cleared")
    held["2021-01-03"] = 5.0
    if hold_below(held):
        raise SystemExit("hold tie")
    tight = {"2021-01-01": 1.0, "2021-01-02": 5.0, "2021-01-03": 4.0}
    if tighter(tight) != {"2021-01-03"}:
        raise SystemExit("tight")
    tight["2021-01-03"] = 9.0
    if tighter(tight):
        raise SystemExit("tight tie")
    tight["2021-01-02"] = 1.0
    tight["2021-01-03"] = 2.0
    if tighter(tight):
        raise SystemExit("tight zero change")
    inner = {"2021-01-01": 1.0, "2021-01-02": 5.0, "2021-01-03": 3.0}
    if inside(inner) != {"2021-01-03"}:
        raise SystemExit("inside")
    inner["2021-01-03"] = 1.0
    if inside(inner):
        raise SystemExit("inside edge")
    inner["2021-01-01"] = 4.0
    inner["2021-01-02"] = 4.0
    inner["2021-01-03"] = 4.0
    if inside(inner):
        raise SystemExit("inside flat priors")
    peak = {"2021-01-01": 1.0, "2021-01-02": 5.0, "2021-01-03": 2.0}
    if left_peak(peak) != {"2021-01-03"}:
        raise SystemExit("peak")
    peak["2021-01-03"] = 5.0
    if left_peak(peak):
        raise SystemExit("peak tie")
    near = {"2021-01-01": 10.0, "2021-01-02": 14.0, "2021-01-03": 11.0}
    if closer(near) != {"2021-01-03"}:
        raise SystemExit("closer")
    near["2021-01-03"] = 6.0
    if closer(near):
        raise SystemExit("closer tie")
    near["2021-01-03"] = 10.0
    if closer(near) != {"2021-01-03"}:
        raise SystemExit("exact return is closer")
    turn = {"2021-01-01": 1.0, "2021-01-02": 4.0, "2021-01-03": 2.0}
    if turned(turn) != {"2021-01-03"}:
        raise SystemExit("turn")
    turn["2021-01-03"] = 6.0
    if turned(turn):
        raise SystemExit("turn same way")
    turn["2021-01-03"] = 4.0
    if turned(turn):
        raise SystemExit("turn zero")
    gap = {"2021-01-01": 1.0, "2021-01-03": 3.0}
    if rising(gap):
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
            url = p5.VISION + "futures/cm/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "cm", sym, "1d", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass41 inputs ready", flush=True)


def describe(name, signal, btc_opens, counts):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    older, prior, today = triple(counts, signal)
    if name == "btc_cm_rise_2021":
        detail = "count %.0f above %.0f above %.0f" % (today, prior, older)
    elif name == "eth_cm_slide_2021":
        detail = "count %.0f below %.0f below %.0f" % (today, prior, older)
    elif name == "xrp_cm_hold_2021":
        detail = "count %.0f after %.0f under %.0f" % (today, prior, older)
    elif name == "link_cm_tight_2021":
        detail = "change %.0f after %.0f" % (today - prior, prior - older)
    elif name == "ltc_cm_inside_2021":
        detail = "count %.0f between %.0f and %.0f" % (today, older, prior)
    elif name == "ada_cm_peak_2021":
        detail = "prior %.0f above %.0f and %.0f" % (prior, older, today)
    elif name == "dot_cm_close_2021":
        detail = "gap %.0f after %.0f from %.0f" % (abs(today - older), abs(prior - older), older)
    elif name == "bnb_cm_turn_2021":
        detail = "count %.0f after %.0f from %.0f" % (today, prior, older)
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
        counts = load_count(os.path.join(INP, "klines", "cm", sym, "1d"))
        for day in ("2020-12-30", "2020-12-31", "2021-01-01", "2021-12-31"):
            if day not in counts:
                raise SystemExit("tape gap %s %s" % (sym, day))
        year = [day for day in counts if day.startswith("2021")]
        if len(year) != 365:
            raise SystemExit("cm year %s %d" % (sym, len(year)))
        tapes[key] = counts
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_cm_rise_2021", "btcrise"),
        ("eth_cm_slide_2021", "ethslide"),
        ("xrp_cm_hold_2021", "xrphold"),
        ("link_cm_tight_2021", "linktight"),
        ("ltc_cm_inside_2021", "ltcinside"),
        ("ada_cm_peak_2021", "adapeak"),
        ("dot_cm_close_2021", "dotclose"),
        ("bnb_cm_turn_2021", "bnbturn"),
    )
    kills = {}
    for name, key in specs:
        counts = tapes[key]
        signals = signals_for(name, counts)
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
        describe(name, p30.shift(entries[0], -1), btc_opens, counts)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 08:52:52 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series are Binance coin-margined perpetual 1d trade counts, field 8. "
            "Open, high, low, close, base volume, quote volume, and taker-buy fields are not the signal. "
            "No USD-M kline is read as the signal. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "These tapes are not a stand-in for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "XTZUSD_PERP, YFIUSD_PERP, ZECUSD_PERP, and XMRUSD_PERP have no 2021-01 daily file and are not scored. "
            "ATOMUSD_PERP, UNIUSD_PERP, AAVEUSD_PERP, DOGEUSD_PERP, SOLUSD_PERP, and XLMUSD_PERP do not cover January 2021 and are not scored. "
            "None of these is a leveraged-token up-versus-down pair. "
            "None of these is a busiest-hour or quietest-hour rule. "
            "None of these is a BTC contract-count path. "
            "None of these is ETH funding. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a top-trader position-ratio or account-ratio slice. "
            "None compares one coin's N-day close return with another's. "
            "The account-minus-position gap narrowing is not rerun. "
            "None lowers 1.30, 0.001, 0.0015, 0.002, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, or to 55, and no year is extended. "
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
            raise SystemExit("summary_pass41.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
