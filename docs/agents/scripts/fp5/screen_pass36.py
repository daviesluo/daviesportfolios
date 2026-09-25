"""Eight frozen Revolut X screens. Funding extremes and cross-asset relative strength.

Reads the eight rule texts hashed at 2026-09-25 07:46:41 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass36.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
No top-trader position-ratio or account-ratio slice is scored.
The account-minus-position gap narrowing is not rerun at a different cost.
Liquidation snapshots are not scored and are not replaced.
The 60-trip gate is not lowered to 12 or to 46, and no screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass36.py
    python3 docs/agents/scripts/fp5/screen_pass36.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass36")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass36.json")
SHA = {
    "ethhump": "418b42cc5c2ceb751496b646cbfa06e90784949ffafd287f451c016d5a9ac3ef",
    "fundgap": "fa41a2aa6c7aa4c16f0025c2c50ba8d1adeacd34e857f17b6b6072fd74f7e2ef",
    "ethgross": "6e916a302d39dca7d04e7e771c54bed1b1c72cde48d5bbd1847fa1dfe6890c29",
    "bnbwide": "85fe6496ad204c36198f6915c22a49d71ae4e4256cf4f0b4630b6ab37dfaea3b",
    "sol2dn": "2cfc71f2dec84af35a4a451ad14bcac02d3d31c6d9a689622051a11fec9d4e4d",
    "ethsol5": "319180fcbfb42ecb0766503732cc245dc27bc98459ae8117ee34ed2df1d31680",
    "pxfund": "ee6b01a52e0b1eaf1206b9a261f46f5949c631a4628e04e4c13e650b819add8c",
    "bnbhorz": "254222d065f30bd424425794a93d1e8c4521fd57936af63ebd223c11c2345b6d",
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


def hump(lists):
    out = set()
    for day, rates in lists.items():
        if len(rates) < 3:
            continue
        interior = max(rates[1:-1])
        if interior > rates[0] and interior > rates[-1]:
            out.add(day)
    return out


def funding_gap(eth, bnb):
    out = set()
    for day, eth_sum in eth.items():
        bnb_sum = bnb.get(day)
        if bnb_sum is None:
            continue
        if abs(eth_sum - bnb_sum) * 10000 > 20.0:
            out.add(day)
    return out


def gross_funding(lists):
    out = set()
    for day, rates in lists.items():
        if len(rates) < 3:
            continue
        if sum(abs(rate) for rate in rates) * 10000 > 15.0:
            out.add(day)
    return out


def widened(bnb, eth):
    out = set()
    for day in bnb:
        prev = p30.shift(day, -1)
        older = p30.shift(day, -2)
        values = (
            bnb.get(day), bnb.get(prev), bnb.get(older),
            eth.get(day), eth.get(prev), eth.get(older))
        if any(value is None or value <= 0 for value in values):
            continue
        bnb_t, bnb_p, bnb_o, eth_t, eth_p, eth_o = values
        excess = (bnb_t / bnb_p - 1.0) - (eth_t / eth_p - 1.0)
        yesterday = (bnb_p / bnb_o - 1.0) - (eth_p / eth_o - 1.0)
        if excess > 0.0 and excess > yesterday:
            out.add(day)
    return out


def sol_two_down(sol, btc, eth):
    out = set()
    for day, sol_today in sol.items():
        prev = p30.shift(day, -2)
        sol_prev = sol.get(prev)
        btc_today, btc_prev = btc.get(day), btc.get(prev)
        eth_today, eth_prev = eth.get(day), eth.get(prev)
        if None in (sol_prev, btc_today, btc_prev, eth_today, eth_prev):
            continue
        if min(sol_today, sol_prev, btc_today, btc_prev, eth_today, eth_prev) <= 0:
            continue
        if sol_today > sol_prev and btc_today < btc_prev and eth_today < eth_prev:
            out.add(day)
    return out


def eth_leads_sol_lags(eth, sol, btc):
    out = set()
    for day, eth_today in eth.items():
        prev = p30.shift(day, -5)
        eth_prev = eth.get(prev)
        sol_today, sol_prev = sol.get(day), sol.get(prev)
        btc_today, btc_prev = btc.get(day), btc.get(prev)
        if None in (eth_prev, sol_today, sol_prev, btc_today, btc_prev):
            continue
        if min(eth_today, eth_prev, sol_today, sol_prev, btc_today, btc_prev) <= 0:
            continue
        if eth_today * btc_prev > btc_today * eth_prev and sol_today * btc_prev < btc_today * sol_prev:
            out.add(day)
    return out


def price_and_funding(eth_c, btc_c, eth_sum, bnb_sum):
    out = set()
    for day, eth_today in eth_c.items():
        prev = p30.shift(day, -1)
        eth_prev = eth_c.get(prev)
        btc_today, btc_prev = btc_c.get(day), btc_c.get(prev)
        eth_f, bnb_f = eth_sum.get(day), bnb_sum.get(day)
        if None in (eth_prev, btc_today, btc_prev, eth_f, bnb_f):
            continue
        if min(eth_today, eth_prev, btc_today, btc_prev) <= 0:
            continue
        if eth_today * btc_prev > btc_today * eth_prev and eth_f < bnb_f:
            out.add(day)
    return out


def horizon(bnb, eth):
    out = set()
    for day, bnb_today in bnb.items():
        prev10 = p30.shift(day, -10)
        prev1 = p30.shift(day, -1)
        bnb_10, bnb_1 = bnb.get(prev10), bnb.get(prev1)
        eth_today, eth_10, eth_1 = eth.get(day), eth.get(prev10), eth.get(prev1)
        if None in (bnb_10, bnb_1, eth_today, eth_10, eth_1):
            continue
        if min(bnb_today, bnb_10, bnb_1, eth_today, eth_10, eth_1) <= 0:
            continue
        if bnb_today * eth_10 > eth_today * bnb_10 and bnb_today * eth_1 < eth_today * bnb_1:
            out.add(day)
    return out


def input_jobs():
    jobs = []
    spans = {
        "BTCUSDT": ("2017-08", "2022-01"),
        "ETHUSDT": ("2017-08", "2022-01"),
        "BNBUSDT": ("2017-11", "2021-12"),
        "SOLUSDT": ("2020-08", "2021-12"),
    }
    for sym, (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for sym, start in (("ETHUSDT", "2020-09"), ("SOLUSDT", "2020-09"), ("BNBUSDT", "2020-09")):
        for ym in p5.months(start, "2021-12"):
            name = "%s-fundingRate-%s.zip" % (sym, ym)
            url = p5.VISION + "futures/um/monthly/fundingRate/%s/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "funding", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass36 inputs ready", flush=True)


def load_funding_lists(folder, prefix):
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
            day = p5.ymd(datetime.fromtimestamp(ts, timezone.utc))
            by_day.setdefault(day, []).append((ts, float(parts[ri])))
    out = {}
    for day, rows in by_day.items():
        rows.sort()
        out[day] = [rate for _, rate in rows]
    return out


def sums_of(lists):
    return {day: sum(rates) for day, rates in lists.items() if len(rates) >= 3}


def self_check():
    p30.self_check()
    if hump({"2021-01-01": [0.001, 0.003, 0.002]}) != {"2021-01-01"}:
        raise SystemExit("hump")
    if hump({"2021-01-01": [0.001, 0.004, 0.003, 0.002]}) != {"2021-01-01"}:
        raise SystemExit("hump four")
    if hump({"2021-01-01": [0.003, 0.003, 0.001]}):
        raise SystemExit("hump tie")
    if hump({"2021-01-01": [0.001, 0.004, 0.002, 0.004]}):
        raise SystemExit("hump endpoint tie")
    if hump({"2021-01-01": [0.001, 0.002]}):
        raise SystemExit("hump short")
    eth = {"2021-01-01": 0.003}
    bnb = {"2021-01-01": 0.0005}
    if funding_gap(eth, bnb) != {"2021-01-01"}:
        raise SystemExit("gap")
    eth["2021-01-01"] = 0.0025
    if funding_gap(eth, bnb):
        raise SystemExit("gap exact")
    eth["2021-01-01"] = 0.0005
    if funding_gap(eth, bnb):
        raise SystemExit("gap zero")
    if gross_funding({"2021-01-01": [0.001, -0.001, 0.0001]}) != {"2021-01-01"}:
        raise SystemExit("gross")
    if gross_funding({"2021-01-01": [0.0005, 0.0005, 0.0005]}):
        raise SystemExit("gross exact")
    if gross_funding({"2021-01-01": [0.002, 0.002]}):
        raise SystemExit("gross short")
    bnb_c = {"2021-01-01": 100.0, "2021-01-02": 110.0, "2021-01-03": 130.0}
    eth_c = {"2021-01-01": 100.0, "2021-01-02": 100.0, "2021-01-03": 100.0}
    if widened(bnb_c, eth_c) != {"2021-01-03"}:
        raise SystemExit("wide")
    bnb_c["2021-01-03"] = 121.0
    if widened(bnb_c, eth_c):
        raise SystemExit("wide tie")
    bnb_c["2021-01-03"] = 100.0
    if widened(bnb_c, eth_c):
        raise SystemExit("wide not positive")
    sol = {"2021-01-01": 100.0, "2021-01-03": 110.0}
    btc = {"2021-01-01": 100.0, "2021-01-03": 90.0}
    eth_c = {"2021-01-01": 100.0, "2021-01-03": 90.0}
    if sol_two_down(sol, btc, eth_c) != {"2021-01-03"}:
        raise SystemExit("two day")
    btc["2021-01-03"] = 100.0
    if sol_two_down(sol, btc, eth_c):
        raise SystemExit("two day flat")
    eth_c = {"2021-01-01": 100.0, "2021-01-06": 120.0}
    btc = {"2021-01-01": 100.0, "2021-01-06": 110.0}
    sol = {"2021-01-01": 100.0, "2021-01-06": 105.0}
    if eth_leads_sol_lags(eth_c, sol, btc) != {"2021-01-06"}:
        raise SystemExit("five")
    sol["2021-01-06"] = 110.0
    if eth_leads_sol_lags(eth_c, sol, btc):
        raise SystemExit("five tie")
    eth_c = {"2021-01-01": 100.0, "2021-01-02": 110.0}
    btc = {"2021-01-01": 100.0, "2021-01-02": 100.0}
    if price_and_funding(eth_c, btc, {"2021-01-02": 0.001}, {"2021-01-02": 0.002}) != {"2021-01-02"}:
        raise SystemExit("pxfund")
    if price_and_funding(eth_c, btc, {"2021-01-02": 0.002}, {"2021-01-02": 0.002}):
        raise SystemExit("pxfund tie")
    btc["2021-01-02"] = 110.0
    if price_and_funding(eth_c, btc, {"2021-01-02": 0.001}, {"2021-01-02": 0.002}):
        raise SystemExit("pxfund price tie")
    bnb_c = {"2020-12-22": 100.0, "2020-12-31": 200.0, "2021-01-01": 180.0}
    eth_c = {"2020-12-22": 100.0, "2020-12-31": 100.0, "2021-01-01": 110.0}
    if horizon(bnb_c, eth_c) != {"2021-01-01"}:
        raise SystemExit("horizon")
    bnb_c = {"2020-12-22": 100.0, "2020-12-31": 110.0, "2021-01-01": 121.0}
    if horizon(bnb_c, eth_c):
        raise SystemExit("horizon tie")


def ret_over(closes, day, lag):
    prev = closes[p30.shift(day, -lag)]
    return (closes[day] / prev - 1.0) * 100.0


def describe(name, signal, btc_opens, series):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "eth_hump_2021":
        rates = series["eth_f"][signal]
        detail = "ETH interior %.8f first %.8f last %.8f" % (max(rates[1:-1]), rates[0], rates[-1])
    elif name == "eth_bnb_gap_2021":
        eth_sum = series["eth_sum"][signal]
        bnb_sum = series["bnb_sum"][signal]
        detail = "ETH sum %.8f BNB sum %.8f gap %.8f" % (eth_sum, bnb_sum, abs(eth_sum - bnb_sum))
    elif name == "eth_gross_2021":
        rates = series["eth_f"][signal]
        detail = "ETH gross %.8f" % sum(abs(rate) for rate in rates)
    elif name == "bnb_wide_2021":
        prev = p30.shift(signal, -1)
        older = p30.shift(signal, -2)
        excess = ret_over(series["bnb_c"], signal, 1) - ret_over(series["eth_c"], signal, 1)
        yesterday = ret_over(series["bnb_c"], prev, 1) - ret_over(series["eth_c"], prev, 1)
        if older not in series["bnb_c"]:
            raise SystemExit("wide missing older close")
        detail = "BNB excess %+.4f%% from %+.4f%%" % (excess, yesterday)
    elif name == "sol_2d_down_2021":
        detail = "SOL %+.4f%% BTC %+.4f%% ETH %+.4f%% over 2d" % (
            ret_over(series["sol_c"], signal, 2),
            ret_over(series["btc_c"], signal, 2),
            ret_over(series["eth_c"], signal, 2))
    elif name == "eth_sol_5d_2021":
        detail = "ETH %+.4f%% BTC %+.4f%% SOL %+.4f%% over 5d" % (
            ret_over(series["eth_c"], signal, 5),
            ret_over(series["btc_c"], signal, 5),
            ret_over(series["sol_c"], signal, 5))
    elif name == "eth_px_fund_2021":
        detail = "ETH %+.4f%% BTC %+.4f%% funding ETH %.8f BNB %.8f" % (
            ret_over(series["eth_c"], signal, 1),
            ret_over(series["btc_c"], signal, 1),
            series["eth_sum"][signal],
            series["bnb_sum"][signal])
    elif name == "bnb_horizon_2021":
        detail = "BNB 10d %+.4f%% ETH 10d %+.4f%% BNB 1d %+.4f%% ETH 1d %+.4f%%" % (
            ret_over(series["bnb_c"], signal, 10),
            ret_over(series["eth_c"], signal, 10),
            ret_over(series["bnb_c"], signal, 1),
            ret_over(series["eth_c"], signal, 1))
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
    eth_c = p30.load_field(os.path.join(spot, "ETHUSDT", "1d"), 4, 5)
    bnb_c = p30.load_field(os.path.join(spot, "BNBUSDT", "1d"), 4, 5)
    sol_c = p30.load_field(os.path.join(spot, "SOLUSDT", "1d"), 4, 5)
    for day in ("2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    p30.require_span("btc", btc_c, "2017-08-17", "2022-01-01", "2021-01-02")
    p30.require_span("eth", eth_c, "2017-08-17", "2022-01-01", "2021-01-02")
    p30.require_span("bnb", bnb_c, "2017-11-06", "2021-12-31", "2021-01-02")
    p30.require_span("sol", sol_c, "2020-08-11", "2021-12-31", "2021-01-02")
    if p5.parse_ymd("2021-01-02").weekday() != 5:
        raise SystemExit("saturday")
    funding = os.path.join(INP, "funding")
    eth_f = load_funding_lists(funding, "ETHUSDT")
    sol_f = load_funding_lists(funding, "SOLUSDT")
    bnb_f = load_funding_lists(funding, "BNBUSDT")
    if min(sol_f) != "2020-09-13":
        raise SystemExit("SOL funding start %s" % min(sol_f))
    if min(bnb_f) != "2020-09-01":
        raise SystemExit("BNB funding start %s" % min(bnb_f))
    eth_sum = sums_of(eth_f)
    bnb_sum = sums_of(bnb_f)
    for day in ("2020-12-01", "2020-12-31", "2021-01-02", "2021-12-31"):
        if day not in eth_sum or day not in bnb_sum:
            raise SystemExit("funding missing %s" % day)
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    series = {
        "eth_f": eth_f, "eth_sum": eth_sum, "bnb_sum": bnb_sum,
        "btc_c": btc_c, "eth_c": eth_c, "bnb_c": bnb_c, "sol_c": sol_c,
    }
    specs = (
        ("eth_hump_2021", hump(eth_f), "2021-01-01", "2021-12-31"),
        ("eth_bnb_gap_2021", funding_gap(eth_sum, bnb_sum), "2021-01-01", "2021-12-31"),
        ("eth_gross_2021", gross_funding(eth_f), "2021-01-01", "2021-12-31"),
        ("bnb_wide_2021", widened(bnb_c, eth_c), "2021-01-01", "2021-12-31"),
        ("sol_2d_down_2021", sol_two_down(sol_c, btc_c, eth_c), "2021-01-01", "2021-12-31"),
        ("eth_sol_5d_2021", eth_leads_sol_lags(eth_c, sol_c, btc_c), "2021-01-01", "2021-12-31"),
        ("eth_px_fund_2021", price_and_funding(eth_c, btc_c, eth_sum, bnb_sum), "2021-01-01", "2021-12-31"),
        ("bnb_horizon_2021", horizon(bnb_c, eth_c), "2021-01-01", "2021-12-31"),
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
        kills[name] = row
        describe(name, p30.shift(entries[0], -1), btc_opens, series)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 07:46:41 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None is a top-trader position-ratio or account-ratio slice. "
            "The account-minus-position gap narrowing is not rerun. "
            "None lowers 1.30, 0.001, 0.0015, 0.002, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
            "The 60-trip gate is not lowered to 12 or to 46, and no year is extended. "
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
            raise SystemExit("summary_pass36.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
