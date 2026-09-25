"""Eight frozen Revolut X screens. Leveraged-token tapes, eight mechanisms.

Reads the eight rule texts hashed at 2026-09-25 08:40:23 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass40.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
No comparison of one coin's N-day close return with another's is scored.
ETH funding is not in this run. BTC contract-count path shapes are not in this run.
The busiest-hour and quietest-hour family is not rerun on another coin.
USD-M metrics for the other coins, 2021 book depth, BTCDOMUSDT, and the BCH
leveraged tokens are not scored and are not replaced.
The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, or to 53,
and no screen year is extended. The separation of 11 is not lowered.

    python3 docs/agents/scripts/fp5/screen_pass40.py
    python3 docs/agents/scripts/fp5/screen_pass40.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass40")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass40.json")
SHA = {
    "btcflip": "835fc5a4acfd61266224066d9ae945ecf80ead4cf30a64955d37d74a1e5ee392",
    "ethrot": "2c01093107f0adb616f062abd9698ddb8f52ec1df66846fbdc03b6734172c16e",
    "bnbcross": "cf08fb7778ea33a9b35cae149d6796a73e7a684cbd6cddb8712482bd89eec8f1",
    "adagap": "5cefcc9df49d730aa28d2dacaf10696883e82ee6b723bb99673651dbed49125d",
    "linknew": "36fd9b2c2ef3f2ba0c9416503b54e040befdbf8df93349816edfd43132593489",
    "xrpsplit": "b80583c9aeace8e35b899d8d7168df37f306951ced3411c054887f8b9383ad45",
    "dotdip": "4e85a851feb6e78298d28503efa8355e0db68b678395be91c7fd760bfa3e9ba4",
    "ltcconv": "e5212fcae63cf4d5d0d4a5da7e332b9f2b136ab60a3ade5c942f944bdc4fb891",
}
PAIRS = (
    ("btcflip", "BTCUPUSDT", "BTCDOWNUSDT"),
    ("ethrot", "ETHUPUSDT", "ETHDOWNUSDT"),
    ("bnbcross", "BNBUPUSDT", "BNBDOWNUSDT"),
    ("adagap", "ADAUPUSDT", "ADADOWNUSDT"),
    ("linknew", "LINKUPUSDT", "LINKDOWNUSDT"),
    ("xrpsplit", "XRPUPUSDT", "XRPDOWNUSDT"),
    ("dotdip", "DOTUPUSDT", None),
    ("ltcconv", "LTCUPUSDT", "LTCDOWNUSDT"),
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


def load_qt(folder):
    """Quote volume at field 7 and trade count at field 8. One bar a day."""
    days = {}
    bad = set()
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 9:
            raise SystemExit("daily field gap in %s" % folder)
        day = p5.ymd(p30.stamp_of(int(parts[0])))
        value = (float(parts[7]), float(parts[8]))
        if day in days and days[day] != value:
            days[day] = None
            bad.add(day)
        elif day not in days:
            days[day] = value
    return {day: value for day, value in days.items() if value is not None and day not in bad}


def both_days(up, down):
    if down is None:
        return set(up)
    return set(up) & set(down)


def quote_flip(up, down):
    out = set()
    for day in both_days(up, down):
        prior = p30.shift(day, -1)
        if prior not in up or prior not in down:
            continue
        if up[day][0] > down[day][0] and down[prior][0] > up[prior][0]:
            out.add(day)
    return out


def trade_rotate(up, down):
    out = set()
    for day in both_days(up, down):
        prior = p30.shift(day, -1)
        if prior not in up or prior not in down:
            continue
        if up[day][1] > up[prior][1] and down[day][1] < down[prior][1]:
            out.add(day)
    return out


def quote_cross(up, down):
    out = set()
    for day in both_days(up, down):
        prior = p30.shift(day, -1)
        if prior not in up or prior not in down:
            continue
        if up[day][0] > down[prior][0] and down[day][0] > up[prior][0]:
            out.add(day)
    return out


def ratio_gap(up, down):
    out = set()
    for day in both_days(up, down):
        prior = p30.shift(day, -1)
        if prior not in up or prior not in down:
            continue
        if down[day][0] <= 0.0 or down[prior][0] <= 0.0:
            continue
        if down[day][1] <= 0.0 or down[prior][1] <= 0.0:
            continue
        quote_now = up[day][0] / down[day][0]
        quote_then = up[prior][0] / down[prior][0]
        trade_now = up[day][1] / down[day][1]
        trade_then = up[prior][1] / down[prior][1]
        if quote_now > quote_then and trade_now < trade_then:
            out.add(day)
    return out


def quote_new(up, down):
    out = set()
    for day in both_days(up, down):
        prior = p30.shift(day, -1)
        older = p30.shift(day, -2)
        if prior not in up or prior not in down or older not in up or older not in down:
            continue
        if (up[day][0] > up[prior][0] and up[day][0] > up[older][0]
                and down[day][0] < down[prior][0] and down[day][0] < down[older][0]):
            out.add(day)
    return out


def side_split(up, down):
    out = set()
    for day in both_days(up, down):
        if up[day][0] > down[day][0] and up[day][1] < down[day][1]:
            out.add(day)
    return out


def quote_dip(up):
    out = set()
    for day in up:
        prior = p30.shift(day, -1)
        older = p30.shift(day, -2)
        if prior not in up or older not in up:
            continue
        if up[prior][0] < up[older][0] and up[day][0] > up[older][0]:
            out.add(day)
    return out


def imbalance(up, down, day):
    left, right = up[day][0], down[day][0]
    total = left + right
    if total <= 0.0:
        return None
    return abs(left - right) / total


def quote_converge(up, down):
    out = set()
    for day in both_days(up, down):
        prior = p30.shift(day, -1)
        if prior not in up or prior not in down:
            continue
        today, yesterday = imbalance(up, down, day), imbalance(up, down, prior)
        if today is None or yesterday is None:
            continue
        if today < yesterday:
            out.add(day)
    return out


def signals_for(name, up, down):
    if name == "btc_token_flip_2021":
        return quote_flip(up, down)
    if name == "eth_token_rot_2021":
        return trade_rotate(up, down)
    if name == "bnb_token_cross_2021":
        return quote_cross(up, down)
    if name == "ada_token_gap_2021":
        return ratio_gap(up, down)
    if name == "link_token_new_2021":
        return quote_new(up, down)
    if name == "xrp_token_split_2021":
        return side_split(up, down)
    if name == "dot_token_dip_2021":
        return quote_dip(up)
    if name == "ltc_token_conv_2021":
        return quote_converge(up, down)
    raise SystemExit("no signal for %s" % name)


def self_check():
    p30.self_check()
    up = {
        "2021-01-01": (1.0, 5.0),
        "2021-01-02": (3.0, 6.0),
        "2021-01-03": (6.0, 2.0),
    }
    down = {
        "2021-01-01": (2.0, 5.0),
        "2021-01-02": (1.0, 4.0),
        "2021-01-03": (4.0, 9.0),
    }
    if quote_flip(up, down) != {"2021-01-02"}:
        raise SystemExit("flip")
    tied = dict(up)
    tied["2021-01-02"] = (1.0, 6.0)
    if quote_flip(tied, down):
        raise SystemExit("flip tie")
    if trade_rotate(up, down) != {"2021-01-02"}:
        raise SystemExit("rotate")
    flat = dict(down)
    flat["2021-01-02"] = (1.0, 5.0)
    if trade_rotate(up, flat):
        raise SystemExit("rotate tie")
    cross_up = {"2021-01-01": (10.0, 1.0), "2021-01-02": (4.0, 1.0)}
    cross_down = {"2021-01-01": (3.0, 1.0), "2021-01-02": (11.0, 1.0)}
    if quote_cross(cross_up, cross_down) != {"2021-01-02"}:
        raise SystemExit("cross")
    cross_up["2021-01-02"] = (3.0, 1.0)
    if quote_cross(cross_up, cross_down):
        raise SystemExit("cross tie")
    gap_up = {"2021-01-01": (2.0, 2.0), "2021-01-02": (4.0, 2.0)}
    gap_down = {"2021-01-01": (2.0, 1.0), "2021-01-02": (2.0, 2.0)}
    if ratio_gap(gap_up, gap_down) != {"2021-01-02"}:
        raise SystemExit("gap")
    gap_down["2021-01-02"] = (2.0, 1.0)
    if ratio_gap(gap_up, gap_down):
        raise SystemExit("gap same way")
    gap_down["2021-01-02"] = (0.0, 2.0)
    if ratio_gap(gap_up, gap_down):
        raise SystemExit("zero denominator")
    new_up = {
        "2021-01-01": (5.0, 1.0),
        "2021-01-02": (4.0, 1.0),
        "2021-01-03": (6.0, 1.0),
    }
    new_down = {
        "2021-01-01": (5.0, 1.0),
        "2021-01-02": (4.0, 1.0),
        "2021-01-03": (3.0, 1.0),
    }
    if quote_new(new_up, new_down) != {"2021-01-03"}:
        raise SystemExit("new")
    new_down["2021-01-03"] = (4.0, 1.0)
    if quote_new(new_up, new_down):
        raise SystemExit("new tie")
    split_up = {"2021-01-02": (5.0, 1.0)}
    split_down = {"2021-01-02": (3.0, 4.0)}
    if side_split(split_up, split_down) != {"2021-01-02"}:
        raise SystemExit("split")
    split_up["2021-01-02"] = (5.0, 4.0)
    if side_split(split_up, split_down):
        raise SystemExit("split tie")
    dip = {
        "2021-01-01": (5.0, 1.0),
        "2021-01-02": (4.0, 1.0),
        "2021-01-03": (6.0, 1.0),
    }
    if quote_dip(dip) != {"2021-01-03"}:
        raise SystemExit("dip")
    dip["2021-01-03"] = (5.0, 1.0)
    if quote_dip(dip):
        raise SystemExit("dip tie")
    dip["2021-01-02"] = (5.0, 1.0)
    dip["2021-01-03"] = (6.0, 1.0)
    if quote_dip(dip):
        raise SystemExit("dip without a fall")
    conv_up = {"2021-01-01": (9.0, 1.0), "2021-01-02": (6.0, 1.0)}
    conv_down = {"2021-01-01": (1.0, 1.0), "2021-01-02": (4.0, 1.0)}
    if quote_converge(conv_up, conv_down) != {"2021-01-02"}:
        raise SystemExit("converge")
    conv_up["2021-01-02"] = (9.0, 1.0)
    conv_down["2021-01-02"] = (1.0, 1.0)
    if quote_converge(conv_up, conv_down):
        raise SystemExit("converge tie")
    conv_up["2021-01-02"] = (0.0, 1.0)
    conv_down["2021-01-02"] = (0.0, 1.0)
    if quote_converge(conv_up, conv_down):
        raise SystemExit("zero sum")
    # A conflicting second row drops the day. Identical rows stay.
    kept = {}
    bad = set()
    rows = [("2021-04-25", (1.0, 2.0)), ("2021-04-25", (1.0, 2.0))]
    for day, value in rows:
        if day in kept and kept[day] != value:
            kept[day] = None
            bad.add(day)
        elif day not in kept:
            kept[day] = value
    if "2021-04-25" in bad:
        raise SystemExit("identical day dropped")
    rows.append(("2021-04-25", (1.0, 3.0)))
    for day, value in rows[2:]:
        if day in kept and kept[day] != value:
            kept[day] = None
            bad.add(day)
    if "2021-04-25" not in bad or kept["2021-04-25"] is not None:
        raise SystemExit("conflicting day kept")


def token_symbols():
    found = []
    for _key, up, down in PAIRS:
        found.append(up)
        if down is not None:
            found.append(down)
    return found


def input_jobs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2021-01", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for sym in token_symbols():
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass40 inputs ready", flush=True)


def describe(name, signal, btc_opens, up, down):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    prior = p30.shift(signal, -1)
    older = p30.shift(signal, -2)
    if name == "btc_token_flip_2021":
        detail = "up %.4f down %.4f, prior up %.4f down %.4f" % (
            up[signal][0], down[signal][0], up[prior][0], down[prior][0])
    elif name == "eth_token_rot_2021":
        detail = "up trades %.0f from %.0f, down trades %.0f from %.0f" % (
            up[signal][1], up[prior][1], down[signal][1], down[prior][1])
    elif name == "bnb_token_cross_2021":
        detail = "up %.4f over prior down %.4f, down %.4f over prior up %.4f" % (
            up[signal][0], down[prior][0], down[signal][0], up[prior][0])
    elif name == "ada_token_gap_2021":
        detail = "quote %.6f from %.6f, trades %.6f from %.6f" % (
            up[signal][0] / down[signal][0], up[prior][0] / down[prior][0],
            up[signal][1] / down[signal][1], up[prior][1] / down[prior][1])
    elif name == "link_token_new_2021":
        detail = "up %.4f above %.4f and %.4f, down %.4f below %.4f and %.4f" % (
            up[signal][0], up[prior][0], up[older][0],
            down[signal][0], down[prior][0], down[older][0])
    elif name == "xrp_token_split_2021":
        detail = "quote up %.4f down %.4f, trades up %.0f down %.0f" % (
            up[signal][0], down[signal][0], up[signal][1], down[signal][1])
    elif name == "dot_token_dip_2021":
        detail = "quote %.4f above %.4f after %.4f" % (
            up[signal][0], up[older][0], up[prior][0])
    elif name == "ltc_token_conv_2021":
        detail = "imbalance %.6f from %.6f" % (
            imbalance(up, down, signal), imbalance(up, down, prior))
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
    for key, up_name, down_name in PAIRS:
        up = load_qt(os.path.join(spot, up_name, "1d"))
        down = None if down_name is None else load_qt(os.path.join(spot, down_name, "1d"))
        for day in ("2020-12-30", "2020-12-31", "2021-01-01", "2021-12-31"):
            if day not in up:
                raise SystemExit("tape gap %s %s" % (up_name, day))
            if down is not None and day not in down:
                raise SystemExit("tape gap %s %s" % (down_name, day))
        year = [day for day in up if day.startswith("2021")]
        if len(year) != 365:
            raise SystemExit("up token year %s %d" % (up_name, len(year)))
        if down is not None and len([day for day in down if day.startswith("2021")]) != 365:
            raise SystemExit("down token year %s" % down_name)
        tapes[key] = (up, down)
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_token_flip_2021", "btcflip"),
        ("eth_token_rot_2021", "ethrot"),
        ("bnb_token_cross_2021", "bnbcross"),
        ("ada_token_gap_2021", "adagap"),
        ("link_token_new_2021", "linknew"),
        ("xrp_token_split_2021", "xrpsplit"),
        ("dot_token_dip_2021", "dotdip"),
        ("ltc_token_conv_2021", "ltcconv"),
    )
    kills = {}
    for name, key in specs:
        up, down = tapes[key]
        signals = signals_for(name, up, down)
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
        describe(name, p30.shift(entries[0], -1), btc_opens, up, down)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 08:40:23 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series are Binance leveraged-token spot 1d tapes. "
            "Open, high, low, close, base volume, and taker-buy fields are not the signal. "
            "DOTDOWN is not read. Hourly bars are not read. "
            "These tapes are not a stand-in for USD-M metrics or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "None of these is a busiest-hour or quietest-hour rule. "
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
            raise SystemExit("summary_pass40.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
