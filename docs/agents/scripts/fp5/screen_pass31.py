"""Eight frozen Revolut X screens. Eight new mechanisms, open to the next open.

Reads the eight rule texts hashed at 2026-09-25 06:51:19 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass31.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
The DOGE 1% open gap is not rerun. The ETH two-up streak is not rerun.
The DOGE quote-volume mean screen is not extended, and 60 is not lowered to 45.
None of these rules is a trailing top quintile of a coin's own change.

    python3 docs/agents/scripts/fp5/screen_pass31.py
    python3 docs/agents/scripts/fp5/screen_pass31.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass31")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass31.json")
SHA = {
    "btcthru": "d70178e3817eba29910fc2e785dcdd6aaaaeb513b4d86dc16d62e94d9da7813a",
    "ethaccel": "3435520da9068a2a827c2ce68cf0f5d54316794763eec4b60aef53197815fa72",
    "ltcvol3": "d6c43ab8568e3c664cbcfc4c4a62b6451de51057a5d5d155109da49030afe81b",
    "adareclaim": "8b610ceae14b0635da92d7be24e37761eb34cc7d9b32780ffcd6309149f7f94e",
    "solpull": "06e9f35bd837f3d59d4be27016e963317651c25ecce8f9ca18240b9d6dc18d2b",
    "linkzig": "54bee32467360ad1a103a7279386fb7696ca6a503fc935df63697444f66907c5",
    "unibody": "155235d43f3e738fcc285c5111a8d5c44528f78e8b775d39a1ec70fc4ed3995a",
    "bnbmid": "1afc1d5d5e4b54ec4512857494a9424d1f4e81390b577e2548e555923e613958",
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


def thru_signals(closes, highs):
    out = set()
    for day, close in closes.items():
        prev = highs.get(p30.shift(day, -1))
        if close > 0 and prev is not None and prev > 0 and close > prev:
            out.add(day)
    return out


def accel_signals(closes):
    out = set()
    for day, close in closes.items():
        c1 = closes.get(p30.shift(day, -1))
        c2 = closes.get(p30.shift(day, -2))
        if close > 0 and c1 is not None and c2 is not None and c1 > 0 and c2 > 0:
            prev = c1 - c2
            if prev > 0 and (close - c1) > prev:
                out.add(day)
    return out


def vol_high_signals(quote, window):
    out = set()
    for day, vol in quote.items():
        prior = []
        ok = vol > 0
        for k in range(1, window + 1):
            prev = quote.get(p30.shift(day, -k))
            if prev is None or prev <= 0:
                ok = False
                break
            prior.append(prev)
        if ok and vol > max(prior):
            out.add(day)
    return out


def reclaim_signals(opens, closes):
    out = set()
    for day, close in closes.items():
        opened = opens.get(day)
        prev = closes.get(p30.shift(day, -1))
        if close > 0 and opened is not None and prev is not None and opened > 0 and prev > 0:
            if opened < prev and close > opened:
                out.add(day)
    return out


def pull_signals(closes, short, long):
    out = set()
    for day, close in closes.items():
        if close <= 0:
            continue
        longs = []
        ok = True
        for k in range(long):
            px = closes.get(p30.shift(day, -k))
            if px is None or px <= 0:
                ok = False
                break
            longs.append(px)
        if not ok:
            continue
        if close > sum(longs) / long and close < sum(longs[:short]) / short:
            out.add(day)
    return out


def zig_signals(closes):
    out = set()
    for day, close in closes.items():
        c1 = closes.get(p30.shift(day, -1))
        c2 = closes.get(p30.shift(day, -2))
        if close > 0 and c1 is not None and c2 is not None and c1 > 0 and c2 > 0:
            if close > c1 and c1 < c2 and close > c2:
                out.add(day)
    return out


def body_signals(opens, closes):
    out = set()
    for day, close in closes.items():
        opened = opens.get(day)
        prev = p30.shift(day, -1)
        pc, po = closes.get(prev), opens.get(prev)
        if None in (opened, pc, po):
            continue
        if min(close, opened, pc, po) > 0 and close > opened and abs(close - opened) > abs(pc - po):
            out.add(day)
    return out


def mid_signals(closes, highs, lows):
    out = set()
    for day, close in closes.items():
        prev = p30.shift(day, -1)
        ph, pl = highs.get(prev), lows.get(prev)
        if close > 0 and ph is not None and pl is not None and ph > pl > 0 and close * 2.0 > ph + pl:
            out.add(day)
    return out


def kline_jobs():
    jobs = []
    spans = {
        ("spot", "BTCUSDT"): ("2017-08", "2022-01"),
        ("spot", "ETHUSDT"): ("2017-08", "2022-01"),
        ("spot", "LTCUSDT"): ("2017-12", "2018-12"),
        ("spot", "ADAUSDT"): ("2018-04", "2019-12"),
        ("spot", "SOLUSDT"): ("2020-08", "2021-12"),
        ("spot", "LINKUSDT"): ("2019-01", "2020-12"),
        ("spot", "UNIUSDT"): ("2020-09", "2021-12"),
        ("spot", "BNBUSDT"): ("2017-11", "2018-12"),
    }
    for (market, sym), (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "%s/monthly/klines/%s/1d/%s" % (market, sym, name)
            jobs.append((url, os.path.join(INP, "klines", market, sym, "1d", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), kline_jobs()))
    print("pass31 inputs ready", flush=True)


def self_check():
    p30.self_check()
    prev, day, older = "2020-01-01", "2020-01-02", "2019-12-31"
    if thru_signals({day: 11.0, prev: 10.0}, {prev: 10.0, day: 12.0}) != {day}:
        raise SystemExit("through prior high")
    if thru_signals({day: 10.0}, {prev: 10.0}):
        raise SystemExit("through prior high tie")
    closes = {older: 10.0, prev: 11.0, day: 13.0}
    if accel_signals(closes) != {day}:
        raise SystemExit("acceleration")
    closes[day] = 12.0
    if accel_signals(closes):
        raise SystemExit("equal increment")
    closes = {older: 10.0, prev: 12.0, day: 13.0}
    if accel_signals(closes):
        raise SystemExit("smaller increment")
    quote = {"2019-12-30": 5.0, "2019-12-31": 4.0, "2020-01-01": 3.0, "2020-01-02": 5.0}
    if vol_high_signals(quote, 3):
        raise SystemExit("volume high tie")
    quote["2020-01-02"] = 6.0
    if vol_high_signals(quote, 3) != {"2020-01-02"}:
        raise SystemExit("volume high")
    if reclaim_signals({day: 99.0}, {prev: 100.0, day: 100.0}) != {day}:
        raise SystemExit("reclaim")
    if reclaim_signals({day: 100.0}, {prev: 100.0, day: 101.0}):
        raise SystemExit("reclaim open tie")
    if reclaim_signals({day: 99.0}, {prev: 100.0, day: 99.0}):
        raise SystemExit("reclaim close tie")
    if zig_signals({older: 10.0, prev: 8.0, day: 11.0}) != {day}:
        raise SystemExit("zigzag")
    if zig_signals({older: 10.0, prev: 8.0, day: 9.0}):
        raise SystemExit("zigzag short")
    if zig_signals({older: 10.0, prev: 12.0, day: 13.0}):
        raise SystemExit("zigzag no dip")
    if body_signals({prev: 10.0, day: 10.0}, {prev: 11.0, day: 12.0}) != {day}:
        raise SystemExit("larger body")
    if body_signals({prev: 10.0, day: 10.0}, {prev: 11.0, day: 11.0}):
        raise SystemExit("body tie")
    if body_signals({prev: 10.0, day: 12.0}, {prev: 11.0, day: 9.0}):
        raise SystemExit("down body")
    if mid_signals({day: 7.0}, {prev: 10.0}, {prev: 2.0}) != {day}:
        raise SystemExit("midpoint")
    if mid_signals({day: 6.0}, {prev: 10.0}, {prev: 2.0}):
        raise SystemExit("midpoint tie")
    if mid_signals({day: 6.0}, {prev: 5.0}, {prev: 5.0}):
        raise SystemExit("flat prior bar")
    start = p5.parse_ymd("2020-01-01")
    series = {}
    for i in range(60):
        series[p5.ymd(start + timedelta(days=i))] = 100.0
    if pull_signals(series, 10, 50):
        raise SystemExit("flat averages")
    last = p5.ymd(start + timedelta(days=59))
    for i in range(50, 59):
        series[p5.ymd(start + timedelta(days=i))] = 200.0
    series[last] = 150.0
    if last not in pull_signals(series, 10, 50):
        raise SystemExit("pullback")
    series[last] = 200.0
    if last in pull_signals(series, 10, 50):
        raise SystemExit("above both averages")


def describe(name, signal, btc_opens, series):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "btc_through_2018":
        detail = "close %.2f vs prior high %.2f" % (series["btc_c"][signal], series["btc_h"][p30.shift(signal, -1)])
    elif name == "eth_accel_2018":
        c0 = series["eth_c"][signal]
        c1 = series["eth_c"][p30.shift(signal, -1)]
        c2 = series["eth_c"][p30.shift(signal, -2)]
        detail = "changes %+.4f then %+.4f" % (c1 - c2, c0 - c1)
    elif name == "ltc_vol3_2018":
        prior = [series["ltc_q"][p30.shift(signal, -k)] for k in range(1, 4)]
        detail = "quote %.4f vs max3 %.4f" % (series["ltc_q"][signal], max(prior))
    elif name == "ada_reclaim_2019":
        detail = "open %.6f vs prior close %.6f, close %.6f" % (
            series["ada_o"][signal], series["ada_c"][p30.shift(signal, -1)], series["ada_c"][signal])
    elif name == "sol_pull_2021":
        closes = series["sol_c"]
        short = [closes[p30.shift(signal, -k)] for k in range(10)]
        long = [closes[p30.shift(signal, -k)] for k in range(50)]
        detail = "close %.4f vs sma10 %.4f vs sma50 %.4f" % (
            closes[signal], sum(short) / 10.0, sum(long) / 50.0)
    elif name == "link_zig_2020":
        c0 = series["link_c"][signal]
        c1 = series["link_c"][p30.shift(signal, -1)]
        c2 = series["link_c"][p30.shift(signal, -2)]
        detail = "closes %.4f, %.4f, %.4f" % (c2, c1, c0)
    elif name == "uni_body_2021":
        detail = "body %.4f vs prior %.4f" % (
            abs(series["uni_c"][signal] - series["uni_o"][signal]),
            abs(series["uni_c"][p30.shift(signal, -1)] - series["uni_o"][p30.shift(signal, -1)]))
    elif name == "bnb_mid_2018":
        prev = p30.shift(signal, -1)
        detail = "close %.4f vs midpoint %.4f" % (
            series["bnb_c"][signal], (series["bnb_h"][prev] + series["bnb_l"][prev]) / 2.0)
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
    btc_c = p30.load_field(os.path.join(spot, "BTCUSDT", "1d"), 4, 5)
    btc_h = p30.load_field(os.path.join(spot, "BTCUSDT", "1d"), 2, 3)
    eth_c = p30.load_field(os.path.join(spot, "ETHUSDT", "1d"), 4, 5)
    for day in ("2018-01-01", "2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    p30.require_span("btc", btc_c, "2017-08-17", "2018-12-31", "2018-01-06")
    p30.require_span("btchigh", btc_h, "2017-08-17", "2018-12-31", "2018-01-06")
    p30.require_span("eth", eth_c, "2017-08-17", "2018-12-31", "2018-01-06")
    ltc_q = p30.load_field(os.path.join(spot, "LTCUSDT", "1d"), 7, 8)
    ada_o = p30.load_field(os.path.join(spot, "ADAUSDT", "1d"), 1, 2)
    ada_c = p30.load_field(os.path.join(spot, "ADAUSDT", "1d"), 4, 5)
    sol_c = p30.load_field(os.path.join(spot, "SOLUSDT", "1d"), 4, 5)
    link_c = p30.load_field(os.path.join(spot, "LINKUSDT", "1d"), 4, 5)
    uni_o = p30.load_field(os.path.join(spot, "UNIUSDT", "1d"), 1, 2)
    uni_c = p30.load_field(os.path.join(spot, "UNIUSDT", "1d"), 4, 5)
    bnb_c = p30.load_field(os.path.join(spot, "BNBUSDT", "1d"), 4, 5)
    bnb_h = p30.load_field(os.path.join(spot, "BNBUSDT", "1d"), 2, 3)
    bnb_l = p30.load_field(os.path.join(spot, "BNBUSDT", "1d"), 3, 4)
    p30.require_span("ltcq", ltc_q, "2017-12-13", "2018-12-31", "2018-01-06")
    p30.require_span("ada", ada_c, "2018-04-17", "2019-12-31", "2019-01-05")
    p30.require_span("adao", ada_o, "2018-04-17", "2019-12-31", "2019-01-05")
    p30.require_span("sol", sol_c, "2020-08-11", "2021-12-31", "2021-01-02")
    p30.require_span("link", link_c, "2019-01-16", "2020-12-31", "2020-01-04")
    p30.require_span("uni", uni_c, "2020-09-17", "2021-12-31", "2021-01-02")
    p30.require_span("bnb", bnb_c, "2017-11-06", "2018-12-31", "2018-01-06")
    p30.require_span("bnbh", bnb_h, "2017-11-06", "2018-12-31", "2018-01-06")
    p30.require_span("bnbl", bnb_l, "2017-11-06", "2018-12-31", "2018-01-06")
    btc_ret = p30.open_returns(btc_opens, "2018-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2018-01-01", "2021-12-31")
    for day in ("2018-12-31", "2019-12-31", "2020-12-31", "2021-12-31"):
        if day not in btc_ret or day not in eth_ret:
            raise SystemExit("%s has no next open" % day)
    series = {
        "btc_c": btc_c, "btc_h": btc_h, "eth_c": eth_c, "ltc_q": ltc_q,
        "ada_o": ada_o, "ada_c": ada_c, "sol_c": sol_c, "link_c": link_c,
        "uni_o": uni_o, "uni_c": uni_c, "bnb_c": bnb_c, "bnb_h": bnb_h, "bnb_l": bnb_l,
    }
    specs = (
        ("btc_through_2018", thru_signals(btc_c, btc_h), "2018-01-01", "2018-12-31"),
        ("eth_accel_2018", accel_signals(eth_c), "2018-01-01", "2018-12-31"),
        ("ltc_vol3_2018", vol_high_signals(ltc_q, 3), "2018-01-01", "2018-12-31"),
        ("ada_reclaim_2019", reclaim_signals(ada_o, ada_c), "2019-01-01", "2019-12-31"),
        ("sol_pull_2021", pull_signals(sol_c, 10, 50), "2021-01-01", "2021-12-31"),
        ("link_zig_2020", zig_signals(link_c), "2020-01-01", "2020-12-31"),
        ("uni_body_2021", body_signals(uni_o, uni_c), "2021-01-01", "2021-12-31"),
        ("bnb_mid_2018", mid_signals(bnb_c, bnb_h, bnb_l), "2018-01-01", "2018-12-31"),
    )
    kills = {}
    for name, signals, start, end in specs:
        row = p30.run_open(name, p30.marked_for(signals, start, end), btc_ret, eth_ret, 400)
        entries = row.pop("_entries")
        raw_pool = row.pop("_pool")
        hand, n = p30.hand_sum(entries, btc_opens, eth_opens)
        if n != row["trips"] or abs(hand - raw_pool) > 0.1 or abs(hand - row["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s %s %s %s" % (name, hand, raw_pool, row["pool_bps"]))
        kills[name] = row
        describe(name, p30.shift(entries[0], -1), btc_opens, series)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed before its own result. "
            "Every fill is the execution-day open to the next open. "
            "None of these is a trailing top quintile of a coin's own change. "
            "The OKX basis is not in this run. "
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
            raise SystemExit("summary_pass31.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
