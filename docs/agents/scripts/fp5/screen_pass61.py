"""Eight frozen Revolut X screens. Coin-margined mark closes, open to open.

Reads the eight rule texts hashed at 2026-09-25 12:54:29 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass61.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
Fifteen-minute bars are not read. Six-hour bars are not read. Four-hour bars
are not read. Same-day kline highs and lows are not compared. On-chain series
and calendar sequences are not read. Transaction fees are not rerun. The
60-trip gate is not lowered. No testing row is opened.

    python3 docs/agents/scripts/fp5/screen_pass61.py
    python3 docs/agents/scripts/fp5/screen_pass61.py --check
"""
import hashlib, json, os, sys, zipfile
from concurrent.futures import ThreadPoolExecutor

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass61")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass61.json")
FROZEN = "2026-09-25 12:54:29 UTC"
SHA = {
    "cmbtc": "5587d7b20572c8ff56979e60c60b12fc539f44a36af30693f2cf053ab3220d55",
    "cmeth": "36daa8dba3f4a1ae1d52387375051632a422d8da5286a66ac1e8cba48e19e017",
    "cmbnb": "2087213d9b848d5b2b6e8761eca27529999f37e85b87bc2ee8001bab74c2fc8b",
    "cmltc": "dcf5f789d9dbac351173c905f3f74d26cf164b857f00667290c5713faf23ae42",
    "cmxrp": "fa244ff5eba58e94ff2afaed66073acc87d7831212207472f3977260f1972033",
    "cmada": "c94e1cada9cfe82a67b1a8625d52363a4559d5d2f57179ef30f48b8d92c2b7ac",
    "cmlink": "3d880fc05c7175f46e09b6a1b32a4567d44f4a2c9c011cec9eb9e640fd226777",
    "cmdot": "35c0061ac41f9151ebba52726af2ed23097023cf693698aa75a0a0c4cca17da0",
}
SYMBOL = {
    "btc_mark_decel_2021": "BTCUSD_PERP",
    "eth_mark_order_2021": "ETHUSD_PERP",
    "bnb_mark_stagger_2021": "BNBUSD_PERP",
    "ltc_mark_sum_2021": "LTCUSD_PERP",
    "xrp_mark_one_rise_2021": "XRPUSD_PERP",
    "ada_mark_accel_2021": "ADAUSD_PERP",
    "link_mark_under_high_2021": "LINKUSD_PERP",
    "dot_mark_peak_2021": "DOTUSD_PERP",
}
COUNTED = {
    "btc_mark_decel_2021": 4,
    "eth_mark_order_2021": 46,
    "bnb_mark_stagger_2021": 12,
    "ltc_mark_sum_2021": 84,
    "xrp_mark_one_rise_2021": 138,
    "ada_mark_accel_2021": 46,
    "link_mark_under_high_2021": 89,
    "dot_mark_peak_2021": 27,
}
BACKUP = {
    "btc_mark_decel_2021": 43,
    "eth_mark_order_2021": 65,
    "bnb_mark_stagger_2021": 11,
    "ltc_mark_sum_2021": 80,
    "xrp_mark_one_rise_2021": 85,
    "ada_mark_accel_2021": 47,
    "link_mark_under_high_2021": 42,
    "dot_mark_peak_2021": 44,
}
LAGS = {
    "btc_mark_decel_2021": 3,
    "eth_mark_order_2021": 2,
    "bnb_mark_stagger_2021": 5,
    "ltc_mark_sum_2021": 5,
    "xrp_mark_one_rise_2021": 3,
    "ada_mark_accel_2021": 2,
    "link_mark_under_high_2021": 3,
    "dot_mark_peak_2021": 3,
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


def mark_btc(v):
    c0, c1, c2, c3 = v
    return c0 > c1 and c1 > c2 and (c0 - c1) < (c1 - c2) and c0 < c3


def mark_btc_backup(v):
    c0, c1, c2, c3 = v
    return c0 > c1 and c1 > c2 and (c0 - c1) < (c1 - c2)


def mark_eth(v):
    c0, c1, c2 = v
    return c0 < c2 and c2 < c1


def mark_eth_backup(v):
    c0, c1, c2 = v
    return c0 < c1 and c1 < c2


def mark_bnb(v):
    c0, c1, c2, c3, c4, c5 = v
    return c0 > c3 and c1 < c4 and c2 > c5


def mark_bnb_backup(v):
    c0, c1, c2, c3, c4, c5 = v
    return c0 < c3 and c1 > c4 and c2 < c5


def mark_ltc(v):
    c0, c1, c2, c3, c4, c5 = v
    return (c0 + c1 + c2) < (c3 + c4 + c5) and c0 > c1


def mark_ltc_backup(v):
    c0, c1, c2, c3, c4, c5 = v
    return (c0 + c1 + c2) > (c3 + c4 + c5) and c0 < c1


def rising_steps(v, nsteps):
    steps = [v[i] - v[i + 1] for i in range(nsteps)]
    if any(step == 0 for step in steps):
        return None
    return sum(1 for step in steps if step > 0)


def mark_xrp(v):
    return rising_steps(v, 3) == 1


def mark_xrp_backup(v):
    return rising_steps(v, 4) == 1


def mark_ada(v):
    c0, c1, c2 = v
    return c0 > c1 and c1 > c2 and (c0 - c1) * c2 > (c1 - c2) * c1


def mark_ada_backup(v):
    c0, c1, c2 = v
    return c0 > c1 and c1 > c2 and (c0 - c1) * c2 < (c1 - c2) * c1


def mark_link(v):
    c0, c1, c2, c3 = v
    if c2 >= c3:
        return c0 > c1 and c0 < c2
    return c0 > c1 and c0 < c3


def mark_link_backup(v):
    c0, c1, c2, c3 = v
    return c0 > c1 and c0 < c2 and c0 < c3


def mark_dot(v):
    c0, c1, c2, c3 = v
    return c2 > c0 and c2 > c1 and c2 > c3 and c0 > c1


def mark_dot_backup(v):
    c0, c1, c2, c3 = v
    return c2 > c0 and c2 > c1 and c2 > c3 and c0 < c1


PRIMARY = {
    "btc_mark_decel_2021": mark_btc,
    "eth_mark_order_2021": mark_eth,
    "bnb_mark_stagger_2021": mark_bnb,
    "ltc_mark_sum_2021": mark_ltc,
    "xrp_mark_one_rise_2021": mark_xrp,
    "ada_mark_accel_2021": mark_ada,
    "link_mark_under_high_2021": mark_link,
    "dot_mark_peak_2021": mark_dot,
}
SECOND = {
    "btc_mark_decel_2021": (mark_btc_backup, 3),
    "eth_mark_order_2021": (mark_eth_backup, 2),
    "bnb_mark_stagger_2021": (mark_bnb_backup, 5),
    "ltc_mark_sum_2021": (mark_ltc_backup, 5),
    "xrp_mark_one_rise_2021": (mark_xrp_backup, 4),
    "ada_mark_accel_2021": (mark_ada_backup, 2),
    "link_mark_under_high_2021": (mark_link_backup, 3),
    "dot_mark_peak_2021": (mark_dot_backup, 3),
}


def self_check():
    if not mark_btc((25, 20, 10, 100)) or mark_btc((30, 20, 10, 100)) or mark_btc((25, 20, 10, 20)):
        raise SystemExit("btc mark")
    if not mark_eth((10, 30, 20)) or mark_eth((25, 30, 20)) or mark_eth((10, 20, 30)):
        raise SystemExit("eth mark")
    if not mark_bnb((5, 1, 4, 3, 2, 1)) or mark_bnb((5, 3, 4, 3, 2, 1)):
        raise SystemExit("bnb mark")
    if not mark_ltc((3, 1, 1, 4, 4, 4)) or mark_ltc((1, 2, 3, 4, 5, 6)) or mark_ltc((3, 1, 1, 1, 1, 1)):
        raise SystemExit("ltc mark")
    if not mark_xrp((5, 4, 6, 7)) or mark_xrp((5, 4, 3, 6)) or mark_xrp((5, 5, 4, 3)):
        raise SystemExit("xrp mark")
    if not mark_ada((10, 6, 4)) or mark_ada((7, 6, 4)):
        raise SystemExit("ada mark")
    if not mark_link((5, 4, 9, 1)) or mark_link((5, 4, 3, 2)) or mark_link((5, 6, 9, 1)):
        raise SystemExit("link mark")
    if not mark_dot((5, 4, 9, 3)) or mark_dot((3, 4, 9, 3)):
        raise SystemExit("dot mark")
    if mark_link((5, 4, 6, 6)) != (5 > 4 and 5 < 6):
        raise SystemExit("link tie")


def input_jobs():
    jobs = []
    for sym in (
        "BTCUSD_PERP", "ETHUSD_PERP", "BNBUSD_PERP", "LTCUSD_PERP",
        "XRPUSD_PERP", "ADAUSD_PERP", "LINKUSD_PERP", "DOTUSD_PERP",
    ):
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            jobs.append((
                p5.VISION + "futures/cm/monthly/markPriceKlines/%s/1d/%s" % (sym, name),
                os.path.join(INP, "mark", sym, name)))
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
    print("pass61 inputs ready", flush=True)


def load_mark(folder):
    levels = {}
    if not os.path.isdir(folder):
        raise SystemExit("missing mark %s" % folder)
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        path = os.path.join(folder, name)
        with zipfile.ZipFile(path) as zipped:
            raw = zipped.read(zipped.namelist()[0]).decode()
        for line in raw.splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            if len(parts) < 6:
                raise SystemExit("mark gap: field absent %s" % name)
            stamp = p30.stamp_of(int(parts[0]))
            if stamp.hour != 0 or stamp.minute != 0 or stamp.second != 0:
                raise SystemExit("mark stamp is not midnight %s" % name)
            day = p5.ymd(stamp)
            close = float(parts[4])
            if not close > 0:
                raise SystemExit("nonpositive mark %s %s" % (name, day))
            if float(parts[5]) != 0:
                raise SystemExit("mark volume is not zero %s %s" % (name, day))
            if day in levels and levels[day] != close:
                raise SystemExit("duplicate day disagrees %s" % day)
            levels[day] = close
    return levels


def values_on(levels, day, lag):
    days = [day] + [p30.shift(day, -k) for k in range(1, lag + 1)]
    if any(item not in levels for item in days):
        return None
    return [levels[item] for item in days]


def signals_for(name, levels, predicate, lag):
    signals = []
    eligible = 0
    for day in p5.daterange("2020-12-31", "2021-12-30"):
        vals = values_on(levels, day, lag)
        if vals is None:
            continue
        eligible += 1
        if predicate(vals):
            signals.append(day)
    return signals, eligible


def detail_for(name, levels, day):
    vals = values_on(levels, day, LAGS[name])
    if vals is None:
        raise SystemExit("detail missing %s" % day)
    if name == "xrp_mark_one_rise_2021":
        ups = rising_steps(vals, 3)
        return "ups %d mark %s" % (ups, " ".join("%.8f" % val for val in vals))
    return "mark " + " ".join("%.8f" % val for val in vals)


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
    marks = {}
    for sym in (
        "BTCUSD_PERP", "ETHUSD_PERP", "BNBUSD_PERP", "LTCUSD_PERP",
        "XRPUSD_PERP", "ADAUSD_PERP", "LINKUSD_PERP", "DOTUSD_PERP",
    ):
        levels = load_mark(os.path.join(INP, "mark", sym))
        for day in p5.daterange("2020-12-26", "2021-12-31"):
            if day not in levels:
                raise SystemExit("mark gap %s %s" % (sym, day))
        marks[sym] = levels
    counted = {}
    for name, predicate in PRIMARY.items():
        signals, eligible = signals_for(name, marks[SYMBOL[name]], predicate, LAGS[name])
        if eligible != 365:
            raise SystemExit("eligible days moved %s %d" % (name, eligible))
        if len(signals) != COUNTED[name]:
            raise SystemExit("pre-freeze count moved %s %d" % (name, len(signals)))
        if len(signals) == 0 or len(signals) >= 365:
            raise SystemExit("signal is empty or every complete day %s" % name)
        backup, backup_lag = SECOND[name]
        backup_signals, backup_eligible = signals_for(name, marks[SYMBOL[name]], backup, backup_lag)
        if backup_eligible != 365 or len(backup_signals) != BACKUP[name]:
            raise SystemExit("backup count moved %s %d" % (name, len(backup_signals)))
        if len(backup_signals) == 0 or len(backup_signals) >= 365:
            raise SystemExit("backup is empty or every complete day %s" % name)
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
        ("btc_mark_decel_2021", "cmbtc"),
        ("eth_mark_order_2021", "cmeth"),
        ("bnb_mark_stagger_2021", "cmbnb"),
        ("ltc_mark_sum_2021", "cmltc"),
        ("xrp_mark_one_rise_2021", "cmxrp"),
        ("ada_mark_accel_2021", "cmada"),
        ("link_mark_under_high_2021", "cmlink"),
        ("dot_mark_peak_2021", "cmdot"),
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
            name, signal, entries[0], detail_for(name, marks[SYMBOL[name]], signal), entry, exit_px, move), flush=True)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 12:54:29 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "The series is one coin-margined perpetual's daily mark close, field 4 of markPriceKlines, midnight UTC. "
            "The eight contracts are BTCUSD_PERP, ETHUSD_PERP, BNBUSD_PERP, LTCUSD_PERP, XRPUSD_PERP, ADAUSD_PERP, LINKUSD_PERP, and DOTUSD_PERP. "
            "Each contract is its own rule. The open, the high, the low, and the volume column are not the signal. "
            "The volume column is zero on every bar that was kept. "
            "The last-traded close is not the signal. The trade count is not the signal. A term basis is not formed. "
            "USDT-margined mark files that miss 2021-07-01 and 2021-07-24 through 2021-07-27 are not read and are not filled. "
            "Each coin-margined mark has a bar on every day from 2020-12-26 through 2021-12-31. "
            "This is not an on-chain series and not a calendar sequence. "
            "Fifteen-minute bars are not read. Six-hour bars are not read. Four-hour bars are not read. "
            "Same-day kline highs and lows are not compared. The order of six-hour closes is not rerun. "
            "How four-hour ranges sit inside one another is not rerun. "
            "Median confirmation time is not rerun, and the fall after a higher day is not flipped. "
            "Transaction fees are not rerun, and the 60-trip gate is not lowered to 38. "
            "None of these fires on every one of the 365 signal days. None of these had zero entries. "
            "Each primary already had an interior count, so its pre-specified backup was not frozen. "
            "Those backup counts are 43, 65, 11, 80, 85, 47, 42, and 44. "
            "January is not dropped from the XRP inversion rule, and 8 is not changed. "
            "January is not dropped from the confirmation-time rule with exactly two rising steps, and 2 is not changed. "
            "The count of 1 on the XRP mark rule is not changed. "
            "The 60-trip gate is not lowered to 49, to 26, to 33, to 38, to 4, to 46, to 12, or to 27. "
            "The confirmation-time fall after a higher day is not a pass and its fill is not changed. "
            "The BNB close span strictly wider than the open span is not a pass and its fill is not changed. "
            "The LTC weighted price strictly below the midpoint is not a pass and its fill is not changed. "
            "The ETH taker-buy price strictly below the open is not a pass and its fill is not changed. "
            "The coin-margined BTC three-day trade-count rise is not a pass and is not armed. "
            "The OKX-minus-Binance basis is not a pass and is not in this run. "
            "Those five numeric clears, and the confirmation-time fall after a higher day, are not paper testing. "
            "Their fills are Binance daily opens. The Revolut X archive does not contain those 2019 or 2021 fills. "
            "A numeric clear on this daily open is void. It is not a testing row, it is not paper testing, and it is not close to a pass. "
            "A nearby signal with this same open is not a basis for those clears. "
            "The repository's Revolut X minute tape is docs/agents/backtests/inputs/first_principles_2026-09-23/revx_hist. "
            "BTC-USD_1m.json.gz runs from 2026-08-26 00:00 UTC through 2026-09-23 11:04 UTC, 29 calendar days, 40,983 bars. "
            "There is no ETH-USD file in that folder. "
            "Of the 29 UTC midnight bars, 5 have volume above zero and 24 have volume zero, so the midnight price is often not a trade. "
            "Twenty-nine days cannot make 60 daily trips. The 60-trip gate is not lowered because of that tape. "
            "The other files there are BTC-GBP and four stablecoin pairs. They are not an ETH book. "
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
            raise SystemExit("summary_pass61.json does not match a fresh run")
        print("CHECK_OK", flush=True)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", OUT, flush=True)


if __name__ == "__main__":
    main()
