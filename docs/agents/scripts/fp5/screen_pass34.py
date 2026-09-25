"""Eight frozen Revolut X screens. New positioning, funding, and relative strength.

Reads the eight rule texts hashed at 2026-09-25 07:24:27 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass34.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
Liquidation snapshots are not scored and are not replaced.
The 60-trip gate is not lowered to 12, and no screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass34.py
    python3 docs/agents/scripts/fp5/screen_pass34.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass34")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass34.json")
SHA = {
    "ttstate": "41e9936fe94fd1d6535dade2964e8ecd0f23a0ca6a0af97190eba5ffc19407b6",
    "ttdecel": "207853399a2c0af6176bae5010dad263d359b97eda229c620abd413e8a33223b",
    "ttintra": "1aad6a60231aaae538409e9373eda2a0a055a3f51904436c68cad407675b60ee",
    "fundwidth": "e6b78888c5bc761e1e93da2ac6254cdb8d01dd1cc269d56db3a0af1df10664d7",
    "bnbpos": "d58a46e38c499c7b2e812c211b2a7cc7f5a2f5efa68a30693ae02a62991a3de4",
    "fundchg": "a7f041ebe9380cd80e1bebec8bc8bbf47d982ec4f5dba2a0130679c3550cc22e",
    "solflip": "5877e93281b7d170b31115b6243333ae8eac76048a9a680bd4fe0adba5f2ebb0",
    "ethdown": "39ddfd56682310a7cf66f555945725a9cbf1a8b5cb6b52248eac880526ca3d8c",
}
POS_COL = "sum_toptrader_long_short_ratio"
ACCT_COL = "count_toptrader_long_short_ratio"


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


def cell_float(text):
    text = text.strip().strip('"')
    if text == "":
        return None
    return float(text)


def state(pos, acct):
    out = set()
    for day, position in pos.items():
        account = acct.get(day)
        if account is None:
            continue
        if position * 100.0 > 100.0 and account * 100.0 < 100.0:
            out.add(day)
    return out


def decel(levels):
    out = set()
    for day, value in levels.items():
        prev = levels.get(p30.shift(day, -1))
        older = levels.get(p30.shift(day, -2))
        if prev is None or older is None:
            continue
        if value > prev and (value - prev) < (prev - older):
            out.add(day)
    return out


def intra(first, last):
    out = set()
    for day, end in last.items():
        start = first.get(day)
        if start is None:
            continue
        if end > start:
            out.add(day)
    return out


def width(lists):
    out = set()
    for day, rates in lists.items():
        if len(rates) < 3:
            continue
        if (max(rates) - min(rates)) * 10000.0 > 4.0:
            out.add(day)
    return out


def all_pos(lists):
    out = set()
    for day, rates in lists.items():
        if len(rates) >= 3 and all(rate > 0.0 for rate in rates):
            out.add(day)
    return out


def fund_change(eth, sol):
    out = set()
    for day, value in eth.items():
        prev = p30.shift(day, -1)
        yesterday = eth.get(prev)
        today_sol = sol.get(day)
        yesterday_sol = sol.get(prev)
        if None in (yesterday, today_sol, yesterday_sol):
            continue
        if value < yesterday and today_sol > yesterday_sol:
            out.add(day)
    return out


def flip(sol, btc):
    out = set()
    for day, sol_today in sol.items():
        yesterday = p30.shift(day, -1)
        older = p30.shift(day, -2)
        sol_y = sol.get(yesterday)
        sol_o = sol.get(older)
        btc_t = btc.get(day)
        btc_y = btc.get(yesterday)
        btc_o = btc.get(older)
        if None in (sol_y, sol_o, btc_t, btc_y, btc_o):
            continue
        if min(sol_today, sol_y, sol_o, btc_t, btc_y, btc_o) <= 0:
            continue
        if sol_y * btc_o > btc_y * sol_o and btc_t * sol_y > sol_today * btc_y and btc_t > btc_y:
            out.add(day)
    return out


def down_rs(eth, btc):
    out = set()
    for day, eth_today in eth.items():
        prev = p30.shift(day, -1)
        eth_prev = eth.get(prev)
        btc_today = btc.get(day)
        btc_prev = btc.get(prev)
        if None in (eth_prev, btc_today, btc_prev):
            continue
        if min(eth_today, eth_prev, btc_today, btc_prev) <= 0:
            continue
        if eth_today < eth_prev and btc_today < btc_prev and eth_today * btc_prev > btc_today * eth_prev:
            out.add(day)
    return out


def input_jobs():
    jobs = []
    spans = {
        "BTCUSDT": ("2017-08", "2022-01"),
        "ETHUSDT": ("2017-08", "2022-01"),
        "SOLUSDT": ("2020-08", "2021-12"),
    }
    for sym, (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for sym in ("ETHUSDT", "BNBUSDT", "SOLUSDT"):
        for ym in p5.months("2020-09", "2021-12"):
            name = "%s-fundingRate-%s.zip" % (sym, ym)
            url = p5.VISION + "futures/um/monthly/fundingRate/%s/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "funding", name)))
    for day in p5.daterange("2020-12-01", "2021-12-31"):
        name = "BTCUSDT-metrics-%s.zip" % day
        url = p5.VISION + "futures/um/daily/metrics/BTCUSDT/" + name
        jobs.append((url, os.path.join(INP, "metrics", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), input_jobs()))
    print("pass34 inputs ready", flush=True)


def load_metric_ends(folder):
    rows = {}
    order = 0
    names = sorted(n for n in os.listdir(folder) if n.endswith(".zip"))
    if not names:
        raise SystemExit("metrics gap: no files")
    for name in names:
        lines = p5.zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if POS_COL not in header or ACCT_COL not in header or "create_time" not in header:
            raise SystemExit("metrics gap: locked columns absent")
        ci = header.index("create_time")
        pi = header.index(POS_COL)
        ai = header.index(ACCT_COL)
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            day = parts[ci][:10]
            rows.setdefault(day, []).append((parts[ci], order, cell_float(parts[pi]), cell_float(parts[ai])))
            order += 1
    pos_first, pos_last, acct_last = {}, {}, {}
    for day, items in rows.items():
        items.sort()
        if items[0][2] is not None:
            pos_first[day] = items[0][2]
        if items[-1][2] is not None:
            pos_last[day] = items[-1][2]
        if items[-1][3] is not None:
            acct_last[day] = items[-1][3]
    return pos_first, pos_last, acct_last


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
    pos = {"2021-01-01": 1.01}
    acct = {"2021-01-01": 0.99}
    if state(pos, acct) != {"2021-01-01"}:
        raise SystemExit("state")
    pos["2021-01-01"] = 1.0
    if state(pos, acct):
        raise SystemExit("state position tie")
    pos["2021-01-01"] = 1.01
    acct["2021-01-01"] = 1.0
    if state(pos, acct):
        raise SystemExit("state account tie")
    levels = {"2021-01-01": 1.0, "2021-01-02": 1.2, "2021-01-03": 1.3}
    if decel(levels) != {"2021-01-03"}:
        raise SystemExit("decel")
    levels["2021-01-03"] = 1.4
    if decel(levels):
        raise SystemExit("decel tie")
    levels["2021-01-03"] = 1.1
    if decel(levels):
        raise SystemExit("decel decline")
    if intra({"2021-01-01": 1.1}, {"2021-01-01": 1.2}) != {"2021-01-01"}:
        raise SystemExit("intra")
    if intra({"2021-01-01": 1.2}, {"2021-01-01": 1.2}):
        raise SystemExit("intra tie")
    if 0.0004 * 10000.0 > 4.0 or not (0.00041 * 10000.0 > 4.0):
        raise SystemExit("width scale")
    if width({"2021-01-01": [0.0, 0.0002, 0.0004]}):
        raise SystemExit("width tie")
    if width({"2021-01-01": [0.0, 0.0002, 0.00041]}) != {"2021-01-01"}:
        raise SystemExit("width")
    if width({"2021-01-01": [0.0, 0.001]}):
        raise SystemExit("width short day")
    if all_pos({"2021-01-01": [0.0001, 0.0001, 0.0001]}) != {"2021-01-01"}:
        raise SystemExit("all positive")
    if all_pos({"2021-01-01": [0.0001, 0.0, 0.0001]}):
        raise SystemExit("all positive zero")
    eth = {"2021-01-01": 0.002, "2021-01-02": 0.001}
    sol = {"2021-01-01": 0.001, "2021-01-02": 0.002}
    if fund_change(eth, sol) != {"2021-01-02"}:
        raise SystemExit("fund change")
    eth["2021-01-02"] = 0.002
    if fund_change(eth, sol):
        raise SystemExit("fund change tie")
    sol_c = {"2021-01-01": 100.0, "2021-01-02": 110.0, "2021-01-03": 110.0}
    btc_c = {"2021-01-01": 100.0, "2021-01-02": 100.0, "2021-01-03": 110.0}
    if flip(sol_c, btc_c) != {"2021-01-03"}:
        raise SystemExit("flip")
    btc_c["2021-01-03"] = 100.0
    if flip(sol_c, btc_c):
        raise SystemExit("flip btc flat")
    eth_c = {"2021-01-01": 100.0, "2021-01-02": 90.0}
    btc_c = {"2021-01-01": 100.0, "2021-01-02": 80.0}
    if down_rs(eth_c, btc_c) != {"2021-01-02"}:
        raise SystemExit("down rs")
    eth_c["2021-01-02"] = 80.0
    if down_rs(eth_c, btc_c):
        raise SystemExit("down rs tie")
    eth_c["2021-01-02"] = 110.0
    if down_rs(eth_c, btc_c):
        raise SystemExit("down rs eth up")


def ret_text(closes, day):
    prev = closes[p30.shift(day, -1)]
    return (closes[day] / prev - 1.0) * 100.0


def describe(name, signal, btc_opens, series):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "btc_ttstate_2021":
        detail = "position %.8f account %.8f" % (series["pos"][signal], series["acct"][signal])
    elif name == "btc_ttdecel_2021":
        prev = p30.shift(signal, -1)
        older = p30.shift(signal, -2)
        detail = "position %.8f from %.8f from %.8f" % (
            series["pos"][signal], series["pos"][prev], series["pos"][older])
    elif name == "btc_ttintra_2021":
        detail = "position first %.8f last %.8f" % (series["pos_first"][signal], series["pos"][signal])
    elif name == "eth_fund_width_2021":
        rates = series["eth_f"][signal]
        detail = "ETH funding width %.8f" % (max(rates) - min(rates))
    elif name == "bnb_allpos_2021":
        detail = "BNB prints %s" % " ".join("%.8f" % rate for rate in series["bnb_f"][signal])
    elif name == "eth_sol_fchg_2021":
        prev = p30.shift(signal, -1)
        detail = "ETH %.8f from %.8f, SOL %.8f from %.8f" % (
            series["eth_sum"][signal], series["eth_sum"][prev],
            series["sol_sum"][signal], series["sol_sum"][prev])
    elif name == "sol_btc_flip_2021":
        prev = p30.shift(signal, -1)
        detail = "today SOL %+.4f%% BTC %+.4f%%, yesterday SOL %+.4f%% BTC %+.4f%%" % (
            ret_text(series["sol_c"], signal), ret_text(series["btc_c"], signal),
            ret_text(series["sol_c"], prev), ret_text(series["btc_c"], prev))
    elif name == "eth_down_rs_2021":
        detail = "ETH %+.4f%% BTC %+.4f%%" % (ret_text(series["eth_c"], signal), ret_text(series["btc_c"], signal))
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
    sol_c = p30.load_field(os.path.join(spot, "SOLUSDT", "1d"), 4, 5)
    for day in ("2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    p30.require_span("btc", btc_c, "2017-08-17", "2022-01-01", "2021-01-02")
    p30.require_span("eth", eth_c, "2017-08-17", "2022-01-01", "2021-01-02")
    p30.require_span("sol", sol_c, "2020-08-11", "2021-12-31", "2021-01-02")
    metrics = os.path.join(INP, "metrics")
    pos_first, pos, acct = load_metric_ends(metrics)
    if p5.parse_ymd("2021-01-02").weekday() != 5:
        raise SystemExit("saturday")
    for day in ("2020-12-01", "2020-12-31", "2021-01-02", "2021-12-29"):
        if day not in pos or day not in acct or day not in pos_first:
            raise SystemExit("metrics missing %s" % day)
    for day in ("2021-12-30", "2021-12-31"):
        path = os.path.join(metrics, "BTCUSDT-metrics-%s.zip" % day)
        if not os.path.exists(path) or day in pos or day in acct:
            raise SystemExit("empty last-row ratio was not dropped %s" % day)
    funding = os.path.join(INP, "funding")
    eth_f = load_funding_lists(funding, "ETHUSDT")
    bnb_f = load_funding_lists(funding, "BNBUSDT")
    sol_f = load_funding_lists(funding, "SOLUSDT")
    if min(sol_f) != "2020-09-13":
        raise SystemExit("SOL funding start %s" % min(sol_f))
    eth_sum = sums_of(eth_f)
    bnb_sum = sums_of(bnb_f)
    sol_sum = sums_of(sol_f)
    for day in ("2020-12-01", "2020-12-31", "2021-01-02", "2021-12-31"):
        if day not in eth_sum or day not in bnb_sum or day not in sol_sum:
            raise SystemExit("funding missing %s" % day)
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    series = {
        "pos": pos, "pos_first": pos_first, "acct": acct,
        "eth_f": eth_f, "bnb_f": bnb_f, "eth_sum": eth_sum, "sol_sum": sol_sum,
        "sol_c": sol_c, "btc_c": btc_c, "eth_c": eth_c,
    }
    specs = (
        ("btc_ttstate_2021", state(pos, acct), "2021-01-01", "2021-12-31"),
        ("btc_ttdecel_2021", decel(pos), "2021-01-01", "2021-12-31"),
        ("btc_ttintra_2021", intra(pos_first, pos), "2021-01-01", "2021-12-31"),
        ("eth_fund_width_2021", width(eth_f), "2021-01-01", "2021-12-31"),
        ("bnb_allpos_2021", all_pos(bnb_f), "2021-01-01", "2021-12-31"),
        ("eth_sol_fchg_2021", fund_change(eth_sum, sol_sum), "2021-01-01", "2021-12-31"),
        ("sol_btc_flip_2021", flip(sol_c, btc_c), "2021-01-01", "2021-12-31"),
        ("eth_down_rs_2021", down_rs(eth_c, btc_c), "2021-01-01", "2021-12-31"),
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
        if abs((row["pool_bps"] - row["stress_bps"]) - 40.0 * row["trips"]) > 0.05 + 0.05 * row["trips"]:
            raise SystemExit("rounded cost gap %s" % name)
        kills[name] = row
        describe(name, p30.shift(entries[0], -1), btc_opens, series)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 07:24:27 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None lowers 1.30, 0.001, the five-day funding window, or the 10% SOL excess. "
            "The 60-trip gate is not lowered to 12, and no year is extended. "
            "0.0004 is a funding-print width, not a lowered 0.0005 peak and not a lowered 0.001 sum. "
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
            raise SystemExit("summary_pass34.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
