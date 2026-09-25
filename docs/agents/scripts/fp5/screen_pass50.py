"""Eight frozen Revolut X screens. Same-day spot trade counts, open to open.

Reads the eight rule texts hashed at 2026-09-25 10:30:19 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass50.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
Hourly session blocks, clock-hour comparisons, and path length are not rerun.
The ETH buy-below-open screen is not a pass. The coin-margined three-day
trade-count rise is not a pass. No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass50.py
    python3 docs/agents/scripts/fp5/screen_pass50.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass50")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass50.json")
FROZEN = "2026-09-25 10:30:19 UTC"
SHA = {
    "btcmost": "604616b99ef185cb6ac81d42ee3e6f03fc13b205a9ace1933f969484bc6b153b",
    "ethabove": "1f12ecedf03f5f8df05cf58de0a9e076d40b08e04622b5cfbbaaee23d8abadce",
    "bnbtween": "717d78f7df9ac4482e3bd5f591079c8dbe2b846e00dafa03f97b9fe720464fca",
    "ltcsum": "e570a1995fd37d018968b4efb1c885627de0cfe8333efcd97f341ab155e0c393",
    "xrpnear": "a75587213d06438fb29d2f57c7cf386d30ee7a4ceda7166f18b0e48aeeca4ce0",
    "linkrank": "0a6a6a3e98edd4c82193955457e35eaced443e210c82c946288b4429958b82eb",
    "adaleast": "aad88a32c43e77abc2402aa7b80a9e643c526483407fa95c3c490efdddbfc10e",
    "dotslot": "67b3aa7407528290a31de390be91ca7b2c209ad1b9f42499e61d35fb163bdcc5",
}
ORDER = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "LTCUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "DOTUSDT")
COUNTED = {
    "btc_unique_most_2021": 267,
    "eth_count_above_btc_2021": 42,
    "bnb_count_between_2021": 87,
    "ltc_count_above_sum_2021": 11,
    "xrp_closer_to_btc_2021": 42,
    "link_exactly_three_below_2021": 19,
    "ada_unique_least_2021": 8,
    "dot_count_between_2021": 62,
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


def load_counts(folder):
    values = {}
    for parts in p30.iter_kline_rows(folder):
        if len(parts) < 9:
            raise SystemExit("trade-count field gap in %s" % folder)
        day = p5.ymd(p30.stamp_of(int(parts[0])))
        count = float(parts[8])
        if count < 0 or count != int(count):
            raise SystemExit("trade count is not a whole number %s %s" % (folder, day))
        if day in values:
            raise SystemExit("duplicate day %s %s" % (folder, day))
        values[day] = int(count)
    return values


def btc_most(row):
    return row["BTCUSDT"] > max(row[sym] for sym in ORDER if sym != "BTCUSDT")


def eth_above(row):
    return row["ETHUSDT"] > row["BTCUSDT"]


def bnb_between(row):
    left, right = row["LTCUSDT"], row["XRPUSDT"]
    if left == right:
        return False
    return min(left, right) < row["BNBUSDT"] < max(left, right)


def ltc_sum(row):
    return row["LTCUSDT"] > row["LINKUSDT"] + row["ADAUSDT"]


def xrp_near(row):
    return abs(row["XRPUSDT"] - row["BTCUSDT"]) < abs(row["ETHUSDT"] - row["BTCUSDT"])


def link_rank(row):
    link = row["LINKUSDT"]
    below = sum(1 for sym in ORDER if sym != "LINKUSDT" and row[sym] < link)
    above = sum(1 for sym in ORDER if sym != "LINKUSDT" and row[sym] > link)
    return below == 3 and above == 4


def ada_least(row):
    return row["ADAUSDT"] < min(row[sym] for sym in ORDER if sym != "ADAUSDT")


def dot_slot(row):
    return row["BNBUSDT"] < row["DOTUSDT"] < row["ETHUSDT"]


PREDICATES = {
    "btc_unique_most_2021": btc_most,
    "eth_count_above_btc_2021": eth_above,
    "bnb_count_between_2021": bnb_between,
    "ltc_count_above_sum_2021": ltc_sum,
    "xrp_closer_to_btc_2021": xrp_near,
    "link_exactly_three_below_2021": link_rank,
    "ada_unique_least_2021": ada_least,
    "dot_count_between_2021": dot_slot,
}


def signals_for(name, books):
    pred = PREDICATES.get(name)
    if pred is None:
        raise SystemExit("unknown rule %s" % name)
    out = set()
    for day in p5.daterange("2020-12-31", "2021-12-30"):
        if any(day not in books[sym] for sym in ORDER):
            continue
        row = {sym: books[sym][day] for sym in ORDER}
        if pred(row):
            out.add(day)
    return out


def self_check():
    p5.self_check()
    if int(0.95 * 500) - 1 != 474:
        raise SystemExit("null index moved")
    base = {
        "BTCUSDT": 8, "ETHUSDT": 7, "BNBUSDT": 6, "LTCUSDT": 5,
        "XRPUSDT": 4, "LINKUSDT": 3, "ADAUSDT": 2, "DOTUSDT": 1,
    }
    if not btc_most(base):
        raise SystemExit("btc most")
    tied = dict(base)
    tied["ETHUSDT"] = 8
    if btc_most(tied):
        raise SystemExit("btc most tie")
    above = dict(base)
    above["ETHUSDT"] = 9
    if not eth_above(above) or eth_above(base):
        raise SystemExit("eth above")
    between = dict(base)
    between["LTCUSDT"] = 1
    between["XRPUSDT"] = 5
    between["BNBUSDT"] = 3
    outside = dict(between)
    outside["BNBUSDT"] = 6
    flat_pair = dict(between)
    flat_pair["XRPUSDT"] = 1
    flat_pair["BNBUSDT"] = 1
    if not bnb_between(between) or bnb_between(outside) or bnb_between(flat_pair):
        raise SystemExit("bnb between")
    summed = dict(base)
    summed["LTCUSDT"] = 10
    summed["LINKUSDT"] = 3
    summed["ADAUSDT"] = 4
    equal_sum = dict(summed)
    equal_sum["LTCUSDT"] = 7
    if not ltc_sum(summed) or ltc_sum(equal_sum):
        raise SystemExit("ltc sum")
    near = {"BTCUSDT": 100, "ETHUSDT": 50, "XRPUSDT": 90, "BNBUSDT": 1,
            "LTCUSDT": 1, "LINKUSDT": 1, "ADAUSDT": 1, "DOTUSDT": 1}
    far = dict(near)
    far["XRPUSDT"] = 40
    same = dict(near)
    same["XRPUSDT"] = 150
    if not xrp_near(near) or xrp_near(far) or xrp_near(same):
        raise SystemExit("xrp near")
    ranked = {
        "BTCUSDT": 1, "ETHUSDT": 2, "BNBUSDT": 3, "LTCUSDT": 5,
        "XRPUSDT": 6, "LINKUSDT": 4, "ADAUSDT": 7, "DOTUSDT": 8,
    }
    tied_link = dict(ranked)
    tied_link["LTCUSDT"] = 4
    if not link_rank(ranked) or link_rank(tied_link):
        raise SystemExit("link rank")
    least = dict(base)
    least["ADAUSDT"] = 0
    tied_ada = dict(least)
    tied_ada["DOTUSDT"] = 0
    if not ada_least(least) or ada_least(tied_ada) or ada_least(base):
        raise SystemExit("ada least")
    slot = dict(base)
    slot["BNBUSDT"] = 1
    slot["DOTUSDT"] = 2
    slot["ETHUSDT"] = 3
    flipped = dict(slot)
    flipped["BNBUSDT"] = 3
    flipped["ETHUSDT"] = 1
    if not dot_slot(slot) or dot_slot(flipped) or dot_slot(base):
        raise SystemExit("dot slot")


def input_jobs():
    jobs = []
    for sym in ORDER:
        end = "2022-01" if sym in ("BTCUSDT", "ETHUSDT") else "2021-12"
        for ym in p5.months("2020-12", end):
            name = "%s-1d-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name),
                os.path.join(INP, "klines", "spot", sym, "1d", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass50 inputs ready", flush=True)


def detail_for(name, row):
    if name == "btc_unique_most_2021":
        return "btc %d next %d" % (row["BTCUSDT"], max(row[sym] for sym in ORDER if sym != "BTCUSDT"))
    if name == "eth_count_above_btc_2021":
        return "eth %d btc %d" % (row["ETHUSDT"], row["BTCUSDT"])
    if name == "bnb_count_between_2021":
        return "bnb %d ltc %d xrp %d" % (row["BNBUSDT"], row["LTCUSDT"], row["XRPUSDT"])
    if name == "ltc_count_above_sum_2021":
        return "ltc %d link %d ada %d" % (row["LTCUSDT"], row["LINKUSDT"], row["ADAUSDT"])
    if name == "xrp_closer_to_btc_2021":
        return "xrp %d eth %d btc %d" % (row["XRPUSDT"], row["ETHUSDT"], row["BTCUSDT"])
    if name == "link_exactly_three_below_2021":
        link = row["LINKUSDT"]
        below = sum(1 for sym in ORDER if sym != "LINKUSDT" and row[sym] < link)
        above = sum(1 for sym in ORDER if sym != "LINKUSDT" and row[sym] > link)
        return "link %d below %d above %d" % (link, below, above)
    if name == "ada_unique_least_2021":
        return "ada %d next %d" % (row["ADAUSDT"], min(row[sym] for sym in ORDER if sym != "ADAUSDT"))
    if name == "dot_count_between_2021":
        return "bnb %d dot %d eth %d" % (row["BNBUSDT"], row["DOTUSDT"], row["ETHUSDT"])
    raise SystemExit("unknown detail %s" % name)


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
    span = p5.daterange("2020-12-31", "2021-12-31")
    books = {}
    for sym in ORDER:
        counts = load_counts(os.path.join(spot, sym, "1d"))
        missing = [day for day in span if day not in counts]
        if missing:
            raise SystemExit("daily trade-count gap %s %s" % (sym, missing))
        books[sym] = counts
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    specs = (
        ("btc_unique_most_2021", "btcmost", "BTCUSDT"),
        ("eth_count_above_btc_2021", "ethabove", "ETHUSDT"),
        ("bnb_count_between_2021", "bnbtween", "BNBUSDT"),
        ("ltc_count_above_sum_2021", "ltcsum", "LTCUSDT"),
        ("xrp_closer_to_btc_2021", "xrpnear", "XRPUSDT"),
        ("link_exactly_three_below_2021", "linkrank", "LINKUSDT"),
        ("ada_unique_least_2021", "adaleast", "ADAUSDT"),
        ("dot_count_between_2021", "dotslot", "DOTUSDT"),
    )
    kills = {}
    for name, key, _sym in specs:
        signals = signals_for(name, books)
        if len(signals) != COUNTED[name]:
            raise SystemExit("pre-freeze count moved %s %d" % (name, len(signals)))
        row = p30.run_open(name, p30.marked_for(signals, "2021-01-01", "2021-12-31"), btc_ret, eth_ret, 400)
        entries = row.pop("_entries")
        raw_pool = row.pop("_pool")
        hand, n = p30.hand_sum(entries, btc_opens, eth_opens)
        if n != row["trips"] or abs(hand - raw_pool) > 0.1 or abs(hand - row["pool_bps"]) > 0.1:
            raise SystemExit("hand sum mismatch %s %s %s %s" % (name, hand, raw_pool, row["pool_bps"]))
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
        counts = {sym: books[sym][signal] for sym in ORDER}
        entry, exit_px, move = p30.btc_open_text(btc_opens, entries[0])
        print("FIRST %s signal %s exec %s %s BTC open %.2f -> %.2f %+.2f" % (
            name, signal, entries[0], detail_for(name, counts), entry, exit_px, move), flush=True)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 10:30:19 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is the Binance spot 1d trade count, field 8, of BTC, ETH, BNB, LTC, XRP, LINK, ADA, and DOT. "
            "The open, the high, the low, the close, and every volume column are not the signal. Yesterday is not read. "
            "A zero count is a level of zero. This is not a coin's trade count against its own previous day. "
            "The average trade size is not formed. The taker volume ratio is not formed. "
            "Hourly session blocks, clock-hour comparisons, and path length are not rerun, and that coin is not swapped. "
            "The taker-buy price against the open, the close, the high, or the low is not rerun. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
            "The same-day count of which of the eight coins closed up or down is not formed, and that counting method is not changed. "
            "How an index body and a spot body nest is not formed. "
            "Which hour the high falls and which hour the low falls are not formed. "
            "The busiest hour and the quietest hour are not formed. "
            "A term-basis sign comparison is not formed. The no-entry ADA-positive DOT-positive LINK-negative rule is not in this run and its signs are not flipped. "
            "The premium index is not formed. The coin-margined versus USDT-margined premium is not formed. "
            "The coin-margined versus USDT-margined volume ratio is not formed. "
            "Perpetual quote volume relative to the previous days is not rerun. "
            "Taker-buy base volume relative to its own previous days is not rerun. "
            "Coin-margined trade-count rules are not rerun and their fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "A numeric clear on this daily open is not a testing row. "
            "These counts are not a stand-in for hourly session structure, for the taker-price family, for the eight-coin sign count, for index-versus-spot bars, for hourly price extremes, for leveraged-token pairs, for USD-M metrics, or for book depth. "
            "BTCDOMUSDT does not cover January 2021 and is not scored. "
            "BCHUPUSDT and BCHDOWNUSDT do not cover January 2021 and are not scored. "
            "CHZUSDT, SANDUSDT, and MANAUSDT USD-M perpetual files do not cover December 2020 and are not scored. "
            "ANTUSDT USD-M perpetual files do not cover December 2020 or January 2021 and are not scored. "
            "USDT-margined quarterly klines do not cover January 2021 and are not scored. "
            "Coin-margined EOSUSD, ETCUSD, FILUSD, and TRXUSD quarterlies stop at the March 2021 contract and are not scored. "
            "2021-02-11, 2021-03-06, 2021-04-20, 2021-04-25, 2021-08-13, and 2021-09-29 lack a full spot hour set and stay missing on that hourly tape. The year is not started later. This screen does not read that tape. "
            "None of these is an hourly session block, a clock-hour comparison, or a path length. "
            "None of these is a taker-buy price against the open, the close, the high, or the low. "
            "None of these is an eight-coin up or down count. "
            "None of these is an index-versus-spot body nesting. "
            "None of these is a leveraged-token up-versus-down pair. "
            "None of these is a busiest-hour or quietest-hour rule. "
            "None of these is an hourly price-extreme rule. "
            "None of these is a BTC contract-count path. "
            "None of these is ETH funding. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a top-trader position-ratio or account-ratio slice. "
            "None compares one coin's N-day close return with another's. "
            "The account-minus-position gap narrowing is not rerun. "
            "None lowers 1.30, 0.001, 0.0015, 0.002, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
            "The 60-trip gate is not lowered to 12, to 46, to 56, to 36, to 28, to 53, to 24, to 39, to 54, to 47, to 15, to 55, to 44, to 53, to 59, to 18, to 2, to 19, to 3, to 20, to 35, to 58, to 9, to 25, to 32, to 17, to 11, to 8, or to 42, and no year is extended. "
            "The three-hour neighborhood is not widened. The one-hour gap is not widened. Twelve is not lowered. "
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
            raise SystemExit("summary_pass50.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
