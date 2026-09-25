"""Eight frozen Revolut X screens. Coin-margined term basis, eight mechanisms.

Reads the eight rule texts hashed at 2026-09-25 09:25:01 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass44.json. Public market archives only.
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
Taker-buy base volume relative to its own previous days is not rerun, and no
other volume column is swapped in for that writing.
The taker ratio and the average trade size are not formed.
The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53,
to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, or to 18,
and no screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass44.py
    python3 docs/agents/scripts/fp5/screen_pass44.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass44")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass44.json")
SHA = {
    "btcpos": "4fb68c2db4a405bdc70f96f83777e7ece50f197cfee2ed5c7e0ba9ea594f167a",
    "ethsplit": "839234c0a3d4ac657951caef51aee2eaff38923d7d914635bc1cb2c47830dc16",
    "bnbrich": "45df81da265b52da498807c614bc37d93e210b74a62bbb2fef5f2323174ce50c",
    "ltcunder": "09ba8e47e071d984017e46bf6f7d70326f23ad40f7d20a98080f30f58bd6431d",
    "xrporder": "eb1df05e967ee6418307f1b982dadb9153a31d53a09937936094040b976cefcb",
    "dotinside": "8d36fd296ee6055c18381e61b1a4117416650192d69298652e41e6edfb18aa4b",
    "quadpos": "7ec5b3ccf2a316213b6244a597d00386a96a32d29817bede35cc328151023995",
    "adasplit": "c857220b9deb9e67880bd00ac48fae0abc84dc1170196b88cdc736111e34b406",
}
COINS = ("BTC", "ETH", "BNB", "LTC", "XRP", "LINK", "ADA", "DOT")
EXPIRIES = (
    ("2021-03-26", "210326"),
    ("2021-06-25", "210625"),
    ("2021-09-24", "210924"),
    ("2021-12-31", "211231"),
    ("2022-03-25", "220325"),
)
CONTRACT_MONTHS = {
    "210326": ("2020-12", "2021-01", "2021-02", "2021-03"),
    "210625": ("2021-03", "2021-04", "2021-05", "2021-06"),
    "210924": ("2021-06", "2021-07", "2021-08", "2021-09"),
    "211231": ("2021-09", "2021-10", "2021-11", "2021-12"),
    "220325": ("2021-12",),
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


def near_code(day):
    for expiry, code in EXPIRIES:
        if day < expiry:
            return code
    raise SystemExit("no quarterly after %s" % day)


def load_close(folder):
    """Daily close at field 4. Volume columns are not read."""
    days = {}
    bad = set()
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 5:
            raise SystemExit("daily field gap in %s" % folder)
        day = p5.ymd(p30.stamp_of(int(parts[0])))
        value = float(parts[4])
        if day in days and days[day] != value:
            days[day] = None
            bad.add(day)
        elif day not in days:
            days[day] = value
    return {day: value for day, value in days.items() if value is not None and day not in bad}


def basis_of(quarterly, perpetual):
    out = {}
    for day, qclose in quarterly.items():
        pclose = perpetual.get(day)
        if qclose > 0 and pclose is not None and pclose > 0:
            out[day] = qclose / pclose - 1.0
    return out


def defined(bases, day, coins):
    vals = []
    for coin in coins:
        level = bases[coin].get(day)
        if level is None:
            return None
        vals.append(level)
    return vals


def btc_positive(bases):
    out = set()
    for day in bases["BTC"]:
        if bases["BTC"][day] > 0:
            out.add(day)
    return out


def eth_split(bases):
    out = set()
    for day in bases["ETH"]:
        pair = defined(bases, day, ("ETH", "BTC"))
        if pair is not None and pair[0] < 0 and pair[1] > 0:
            out.add(day)
    return out


def bnb_rich(bases):
    out = set()
    for day in bases["BNB"]:
        trio = defined(bases, day, ("BNB", "BTC", "ETH"))
        if trio is not None and trio[0] > trio[1] and trio[0] > trio[2]:
            out.add(day)
    return out


def ltc_under(bases):
    out = set()
    for day in bases["LTC"]:
        trio = defined(bases, day, ("LTC", "BTC", "ETH"))
        if trio is not None and trio[0] < 0 and trio[0] < trio[1] and trio[0] < trio[2]:
            out.add(day)
    return out


def xrp_order(bases):
    out = set()
    for day in bases["XRP"]:
        trio = defined(bases, day, ("XRP", "LINK", "ADA"))
        if trio is not None and trio[0] > trio[1] > trio[2]:
            out.add(day)
    return out


def dot_inside(bases):
    out = set()
    for day in bases["DOT"]:
        trio = defined(bases, day, ("DOT", "BTC", "ETH"))
        if trio is None or trio[1] == trio[2]:
            continue
        low, high = (trio[1], trio[2]) if trio[1] < trio[2] else (trio[2], trio[1])
        if low < trio[0] < high:
            out.add(day)
    return out


def quad_positive(bases):
    out = set()
    for day in bases["BTC"]:
        four = defined(bases, day, ("BTC", "ETH", "BNB", "LTC"))
        if four is not None and all(level > 0 for level in four):
            out.add(day)
    return out


def ada_split(bases):
    out = set()
    for day in bases["ADA"]:
        trio = defined(bases, day, ("ADA", "DOT", "LINK"))
        if trio is not None and trio[0] > 0 and trio[1] > 0 and trio[2] < 0:
            out.add(day)
    return out


def signals_for(name, bases):
    if name == "btc_term_pos_2021":
        return btc_positive(bases)
    if name == "eth_term_split_2021":
        return eth_split(bases)
    if name == "bnb_term_rich_2021":
        return bnb_rich(bases)
    if name == "ltc_term_under_2021":
        return ltc_under(bases)
    if name == "xrp_term_order_2021":
        return xrp_order(bases)
    if name == "dot_term_inside_2021":
        return dot_inside(bases)
    if name == "quad_term_pos_2021":
        return quad_positive(bases)
    if name == "ada_term_split_2021":
        return ada_split(bases)
    raise SystemExit("unknown rule %s" % name)


def self_check():
    p5.self_check()
    if near_code("2020-12-31") != "210326" or near_code("2021-03-25") != "210326":
        raise SystemExit("march contract")
    if near_code("2021-03-26") != "210625" or near_code("2021-06-24") != "210625":
        raise SystemExit("june contract")
    if near_code("2021-06-25") != "210924" or near_code("2021-09-23") != "210924":
        raise SystemExit("september contract")
    if near_code("2021-09-24") != "211231" or near_code("2021-12-30") != "211231":
        raise SystemExit("december contract")
    if near_code("2021-12-31") != "220325":
        raise SystemExit("next march contract")
    day = "2021-01-01"
    bases = {
        "BTC": {day: 0.02},
        "ETH": {day: -0.01},
        "BNB": {day: 0.03},
        "LTC": {day: -0.04},
        "XRP": {day: 0.05},
        "LINK": {day: 0.04},
        "ADA": {day: 0.01},
        "DOT": {day: 0.005},
    }
    if btc_positive(bases) != {day}:
        raise SystemExit("btc positive")
    bases["BTC"][day] = 0.0
    if btc_positive(bases):
        raise SystemExit("btc flat")
    bases["BTC"][day] = 0.02
    if eth_split(bases) != {day}:
        raise SystemExit("eth split")
    bases["ETH"][day] = 0.01
    if eth_split(bases):
        raise SystemExit("eth split both positive")
    bases["ETH"][day] = -0.01
    if bnb_rich(bases) != {day}:
        raise SystemExit("bnb rich")
    bases["BNB"][day] = 0.02
    if bnb_rich(bases):
        raise SystemExit("bnb tie")
    bases["BNB"][day] = 0.03
    if ltc_under(bases) != {day}:
        raise SystemExit("ltc under")
    bases["LTC"][day] = 0.01
    if ltc_under(bases):
        raise SystemExit("ltc not negative")
    bases["LTC"][day] = -0.04
    if xrp_order(bases) != {day}:
        raise SystemExit("xrp order")
    bases["LINK"][day] = 0.05
    if xrp_order(bases):
        raise SystemExit("xrp tie")
    bases["LINK"][day] = 0.04
    if dot_inside(bases) != {day}:
        raise SystemExit("dot inside")
    bases["DOT"][day] = 0.02
    if dot_inside(bases):
        raise SystemExit("dot endpoint")
    bases["DOT"][day] = 0.005
    bases["ETH"][day] = 0.02
    if dot_inside(bases):
        raise SystemExit("dot equal ends")
    bases["ETH"][day] = -0.01
    if quad_positive(bases):
        raise SystemExit("quad with a negative")
    saved_eth, saved_ltc = bases["ETH"][day], bases["LTC"][day]
    bases["ETH"][day] = 0.01
    bases["LTC"][day] = 0.01
    if quad_positive(bases) != {day}:
        raise SystemExit("quad positive")
    bases["LTC"][day] = 0.0
    if quad_positive(bases):
        raise SystemExit("quad zero")
    bases["ETH"][day], bases["LTC"][day] = saved_eth, saved_ltc
    bases["ADA"][day] = 0.02
    bases["DOT"][day] = 0.01
    bases["LINK"][day] = -0.03
    if ada_split(bases) != {day}:
        raise SystemExit("ada split")
    bases["LINK"][day] = 0.0
    if ada_split(bases):
        raise SystemExit("ada split zero link")
    q = {"2021-01-01": 110.0, "2021-01-02": 100.0}
    p = {"2021-01-01": 100.0, "2021-01-02": 0.0}
    got = basis_of(q, p)
    if list(got) != ["2021-01-01"] or abs(got["2021-01-01"] - 0.1) > 1e-12:
        raise SystemExit("basis arithmetic")
    kept = {}
    bad = set()
    rows = [("2021-04-25", 2.0), ("2021-04-25", 2.0)]
    for one_day, value in rows:
        if one_day in kept and kept[one_day] != value:
            kept[one_day] = None
            bad.add(one_day)
        elif one_day not in kept:
            kept[one_day] = value
    if "2021-04-25" in bad:
        raise SystemExit("identical day dropped")
    if "2021-04-25" in kept and kept["2021-04-25"] != 3.0:
        kept["2021-04-25"] = None
        bad.add("2021-04-25")
    if "2021-04-25" not in bad or kept["2021-04-25"] is not None:
        raise SystemExit("conflicting day kept")


def input_jobs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2021-01", "2022-01"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for coin in COINS:
        perp = coin + "USD_PERP"
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-1d-%s.zip" % (perp, ym)
            url = p5.VISION + "futures/cm/monthly/klines/%s/1d/%s" % (perp, name)
            jobs.append((url, os.path.join(INP, "klines", "cm", perp, "1d", name)))
        for code, months in CONTRACT_MONTHS.items():
            sym = "%sUSD_%s" % (coin, code)
            for ym in months:
                name = "%s-1d-%s.zip" % (sym, ym)
                url = p5.VISION + "futures/cm/monthly/klines/%s/1d/%s" % (sym, name)
                jobs.append((url, os.path.join(INP, "klines", "cm", sym, "1d", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass44 inputs ready", flush=True)


def load_bases():
    bases = {}
    closes = {}
    for coin in COINS:
        perp = load_close(os.path.join(INP, "klines", "cm", coin + "USD_PERP", "1d"))
        quarterly = {}
        used = {}
        for code in CONTRACT_MONTHS:
            folder = os.path.join(INP, "klines", "cm", "%sUSD_%s" % (coin, code), "1d")
            book = load_close(folder)
            for day, close in book.items():
                if near_code(day) != code:
                    continue
                if day in quarterly:
                    raise SystemExit("two near closes %s %s" % (coin, day))
                quarterly[day] = close
                used[day] = code
        series = basis_of(quarterly, perp)
        for day in p5.daterange("2020-12-31", "2021-12-31"):
            if day not in series:
                raise SystemExit("basis gap %s %s" % (coin, day))
        bases[coin] = series
        closes[coin] = {"q": quarterly, "p": perp, "code": used}
    return bases, closes


def describe(name, signal, btc_opens, bases, closes):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "btc_term_pos_2021":
        coins = ("BTC",)
    elif name == "eth_term_split_2021":
        coins = ("ETH", "BTC")
    elif name == "bnb_term_rich_2021":
        coins = ("BNB", "BTC", "ETH")
    elif name == "ltc_term_under_2021":
        coins = ("LTC", "BTC", "ETH")
    elif name == "xrp_term_order_2021":
        coins = ("XRP", "LINK", "ADA")
    elif name == "dot_term_inside_2021":
        coins = ("DOT", "BTC", "ETH")
    elif name == "quad_term_pos_2021":
        coins = ("BTC", "ETH", "BNB", "LTC")
    elif name == "ada_term_split_2021":
        coins = ("ADA", "DOT", "LINK")
    else:
        raise SystemExit("no description for %s" % name)
    parts = []
    for coin in coins:
        qclose = closes[coin]["q"][signal]
        pclose = closes[coin]["p"][signal]
        parts.append("%s %s %.4f / %.4f = %+.6f" % (
            coin, closes[coin]["code"][signal], qclose, pclose, bases[coin][signal]))
    print("FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f" % (
        name, signal, p30.shift(signal, 1), "; ".join(parts), entry, exit_px, move), flush=True)


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
    bases, closes = load_bases()
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_term_pos_2021", "btcpos"),
        ("eth_term_split_2021", "ethsplit"),
        ("bnb_term_rich_2021", "bnbrich"),
        ("ltc_term_under_2021", "ltcunder"),
        ("xrp_term_order_2021", "xrporder"),
        ("dot_term_inside_2021", "dotinside"),
        ("quad_term_pos_2021", "quadpos"),
        ("ada_term_split_2021", "adasplit"),
    )
    kills = {}
    for name, key in specs:
        signals = signals_for(name, bases)
        if not signals:
            print("COST %s trips 0 gap 0.0 expected 0" % name, flush=True)
            print("FIRST %s no entry" % name, flush=True)
            kills[name] = {
                "name": name,
                "fill": "open_to_next_open",
                "pool_bps": None,
                "stress_bps": None,
                "trips": 0,
                "long_days": 0,
                "execution_days": 365,
                "signals_without_open": 0,
                "btc_bps": None,
                "eth_bps": None,
                "null_p50_bps": None,
                "null_p95_bps": None,
                "month_share": None,
                "top_month": None,
                "top_month_bps": None,
                "candle_bar_clear": False,
                "why": "no entries",
            }
            continue
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
        describe(name, p30.shift(entries[0], -1), btc_opens, bases, closes)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 09:25:01 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is the coin-margined term basis: the near quarterly close divided by the same coin's perpetual close, minus one. "
            "The close is field 4. Open, high, low, quote volume, base volume, trade count, taker-buy base volume, and taker-buy quote volume are not the signal. "
            "A basis is not compared with its own previous days. No volume column is compared with its own recent days. "
            "The taker ratio is not formed. The average trade size is not formed. "
            "No USD-M kline is read as the signal. No spot kline is read as the signal. "
            "The coin-margined versus USDT-margined premium is not formed. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Perpetual quote volume relative to the previous days is not rerun. "
            "Taker-buy base volume relative to its own previous days is not rerun. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "A numeric clear on this daily open is not a testing row. "
            "These tapes are not a stand-in for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "The eight coins that are scored have a basis on every day from 2020-12-31 through 2021-12-31. "
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
            raise SystemExit("summary_pass44.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("WROTE", OUT, flush=True)


if __name__ == "__main__":
    main()
