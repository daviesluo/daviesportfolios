"""Eight frozen Revolut X screens. New positioning, funding, and relative strength.

Reads the eight rule texts hashed at 2026-09-25 07:34:17 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass35.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not in this run.
No moving average, breakout, or candlestick pattern is scored.
Liquidation snapshots are not scored and are not replaced.
The 60-trip gate is not lowered to 12 or to 46, and no screen year is extended.

    python3 docs/agents/scripts/fp5/screen_pass35.py
    python3 docs/agents/scripts/fp5/screen_pass35.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import screen_pass5 as p5
import screen_pass30 as p30

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass35")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass35.json")
SHA = {
    "ttdip": "7666ab99972677d11d77d6fb3e1d53a40a68f75e560974ece93360d26fe72be7",
    "ttgap": "15c9a816899add12cafb656b552dd0b01a29ed0257e20ca1be7f9a6e5e069292",
    "ttweek": "8b8c1884647707849fceca69b527acfa371d50b4305b1c1bec44cec05986a27e",
    "ethcool": "4bf5a7446ff74780c404b02a13def07617beb946e2b7ece4d3ed4f1aa2a73780",
    "fundrise": "7c6135e4c07c3e9cb3d1431142c909aa93fda11cdf7f16ebf6ecd010709ea873",
    "ethkink": "8e0fb10ba70522f666fe5886f8fe79eaba5c60b3197dd679505f3322bcc8bbaa",
    "booksplit": "210bbeb1532ff1c272bf1a0f77f917cb8ceb5e8538d4d073e03a68a470b34048",
    "avaxdot": "a30de694f2e380339ca23fc234bf328e0c913ce2b817e85ae251770ad757d149",
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


def dip(levels):
    out = set()
    for day, value in levels.items():
        prev = levels.get(p30.shift(day, -1))
        older = levels.get(p30.shift(day, -3))
        if prev is None or older is None:
            continue
        if value < prev and value > older:
            out.add(day)
    return out


def narrow(pos, acct):
    out = set()
    for day, position in pos.items():
        prev = p30.shift(day, -1)
        account = acct.get(day)
        ppos = pos.get(prev)
        pacc = acct.get(prev)
        if None in (account, ppos, pacc):
            continue
        gap = account - position
        ygap = pacc - ppos
        if gap > 0.0 and gap < ygap:
            out.add(day)
    return out


def week(pos, acct):
    out = set()
    for day, position in pos.items():
        prev = p30.shift(day, -5)
        account = acct.get(day)
        ppos = pos.get(prev)
        pacc = acct.get(prev)
        if None in (account, ppos, pacc):
            continue
        if position > ppos and account < pacc:
            out.add(day)
    return out


def cool(lists):
    out = set()
    for day, rates in lists.items():
        if len(rates) < 3:
            continue
        if rates[-1] < rates[0] and sum(rates) > 0.0:
            out.add(day)
    return out


def both_rise(eth, sol):
    out = set()
    for day, value in eth.items():
        prev = p30.shift(day, -1)
        yesterday = eth.get(prev)
        today_sol = sol.get(day)
        yesterday_sol = sol.get(prev)
        if None in (yesterday, today_sol, yesterday_sol):
            continue
        if value > yesterday and today_sol > yesterday_sol and value > 0.0 and today_sol > 0.0:
            out.add(day)
    return out


def kink(eth, btc, bnb):
    out = set()
    for day, eth_today in eth.items():
        prev = p30.shift(day, -1)
        eth_prev = eth.get(prev)
        btc_today = btc.get(day)
        btc_prev = btc.get(prev)
        bnb_today = bnb.get(day)
        bnb_prev = bnb.get(prev)
        if None in (eth_prev, btc_today, btc_prev, bnb_today, bnb_prev):
            continue
        if min(eth_today, eth_prev, btc_today, btc_prev, bnb_today, bnb_prev) <= 0:
            continue
        if eth_today * btc_prev > btc_today * eth_prev and eth_today * bnb_prev > bnb_today * eth_prev:
            out.add(day)
    return out


def book_split(eth, btc):
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
        if btc_today > btc_prev and eth_today < eth_prev:
            out.add(day)
    return out


def alts_up(avax, dot, btc):
    out = set()
    for day, avax_today in avax.items():
        prev = p30.shift(day, -1)
        avax_prev = avax.get(prev)
        dot_today = dot.get(day)
        dot_prev = dot.get(prev)
        btc_today = btc.get(day)
        btc_prev = btc.get(prev)
        if None in (avax_prev, dot_today, dot_prev, btc_today, btc_prev):
            continue
        if min(avax_today, avax_prev, dot_today, dot_prev, btc_today, btc_prev) <= 0:
            continue
        if avax_today > avax_prev and dot_today > dot_prev and btc_today < btc_prev:
            out.add(day)
    return out


def input_jobs():
    jobs = []
    spans = {
        "BTCUSDT": ("2017-08", "2022-01"),
        "ETHUSDT": ("2017-08", "2022-01"),
        "BNBUSDT": ("2017-11", "2021-12"),
        "AVAXUSDT": ("2020-09", "2021-12"),
        "DOTUSDT": ("2020-08", "2021-12"),
    }
    for sym, (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for sym in ("ETHUSDT", "SOLUSDT"):
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
    print("pass35 inputs ready", flush=True)


def load_metric_last(folder, col):
    last = {}
    names = sorted(n for n in os.listdir(folder) if n.endswith(".zip"))
    if not names:
        raise SystemExit("metrics gap: no files")
    for name in names:
        lines = p5.zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if col not in header or "create_time" not in header:
            raise SystemExit("metrics gap: locked column %s absent" % col)
        ci, vi = header.index("create_time"), header.index(col)
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            day = parts[ci][:10]
            last[day] = cell_float(parts[vi])
    return {day: value for day, value in last.items() if value is not None}


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
    levels = {
        "2021-01-01": 1.0,
        "2021-01-02": 1.5,
        "2021-01-03": 1.4,
        "2021-01-04": 1.2,
    }
    if dip(levels) != {"2021-01-04"}:
        raise SystemExit("dip")
    levels["2021-01-04"] = 1.0
    if dip(levels):
        raise SystemExit("dip tie")
    levels["2021-01-04"] = 1.6
    if dip(levels):
        raise SystemExit("dip rise")
    pos = {"2021-01-01": 1.0, "2021-01-02": 1.2}
    acct = {"2021-01-01": 2.0, "2021-01-02": 2.1}
    if narrow(pos, acct) != {"2021-01-02"}:
        raise SystemExit("narrow")
    acct["2021-01-02"] = 2.2
    if narrow(pos, acct):
        raise SystemExit("narrow tie")
    acct["2021-01-02"] = 1.2
    if narrow(pos, acct):
        raise SystemExit("narrow zero")
    pos = {"2021-01-01": 1.0, "2021-01-06": 1.2}
    acct = {"2021-01-01": 2.0, "2021-01-06": 1.5}
    if week(pos, acct) != {"2021-01-06"}:
        raise SystemExit("week")
    pos["2021-01-06"] = 1.0
    if week(pos, acct):
        raise SystemExit("week tie")
    if cool({"2021-01-01": [0.001, 0.0005, 0.0002]}) != {"2021-01-01"}:
        raise SystemExit("cool")
    if cool({"2021-01-01": [0.001, 0.0005, 0.001]}):
        raise SystemExit("cool tie")
    if cool({"2021-01-01": [-0.0001, -0.0002, -0.0003]}):
        raise SystemExit("cool negative sum")
    if cool({"2021-01-01": [0.002, 0.001]}):
        raise SystemExit("cool short day")
    eth = {"2021-01-01": 0.001, "2021-01-02": 0.002}
    sol = {"2021-01-01": 0.001, "2021-01-02": 0.002}
    if both_rise(eth, sol) != {"2021-01-02"}:
        raise SystemExit("both rise")
    eth["2021-01-02"] = 0.001
    if both_rise(eth, sol):
        raise SystemExit("both rise tie")
    eth["2021-01-02"] = 0.0
    sol["2021-01-02"] = 0.002
    if both_rise(eth, sol):
        raise SystemExit("both rise zero")
    eth_c = {"2021-01-01": 100.0, "2021-01-02": 110.0}
    btc_c = {"2021-01-01": 100.0, "2021-01-02": 100.0}
    bnb_c = {"2021-01-01": 100.0, "2021-01-02": 105.0}
    if kink(eth_c, btc_c, bnb_c) != {"2021-01-02"}:
        raise SystemExit("kink")
    bnb_c["2021-01-02"] = 110.0
    if kink(eth_c, btc_c, bnb_c):
        raise SystemExit("kink tie")
    btc_c = {"2021-01-01": 100.0, "2021-01-02": 110.0}
    eth_c = {"2021-01-01": 100.0, "2021-01-02": 90.0}
    if book_split(eth_c, btc_c) != {"2021-01-02"}:
        raise SystemExit("split")
    btc_c["2021-01-02"] = 100.0
    if book_split(eth_c, btc_c):
        raise SystemExit("split btc flat")
    avax = {"2021-01-01": 100.0, "2021-01-02": 110.0}
    dot = {"2021-01-01": 100.0, "2021-01-02": 101.0}
    btc_c = {"2021-01-01": 100.0, "2021-01-02": 90.0}
    if alts_up(avax, dot, btc_c) != {"2021-01-02"}:
        raise SystemExit("alts")
    dot["2021-01-02"] = 100.0
    if alts_up(avax, dot, btc_c):
        raise SystemExit("alts tie")


def ret_text(closes, day):
    prev = closes[p30.shift(day, -1)]
    return (closes[day] / prev - 1.0) * 100.0


def describe(name, signal, btc_opens, series):
    entry, exit_px, move = p30.btc_open_text(btc_opens, p30.shift(signal, 1))
    if name == "btc_ttdip_2021":
        detail = "position %.8f < %.8f and above %.8f" % (
            series["pos"][signal],
            series["pos"][p30.shift(signal, -1)],
            series["pos"][p30.shift(signal, -3)])
    elif name == "btc_ttgap_2021":
        prev = p30.shift(signal, -1)
        gap = series["acct"][signal] - series["pos"][signal]
        ygap = series["acct"][prev] - series["pos"][prev]
        detail = "gap %.8f under %.8f" % (gap, ygap)
    elif name == "btc_ttweek_2021":
        prev = p30.shift(signal, -5)
        detail = "position %.8f from %.8f, account %.8f from %.8f" % (
            series["pos"][signal], series["pos"][prev],
            series["acct"][signal], series["acct"][prev])
    elif name == "eth_fund_cool_2021":
        rates = series["eth_f"][signal]
        detail = "ETH funding first %.8f last %.8f sum %.8f" % (rates[0], rates[-1], sum(rates))
    elif name == "eth_sol_rise_2021":
        prev = p30.shift(signal, -1)
        detail = "ETH %.8f from %.8f, SOL %.8f from %.8f" % (
            series["eth_sum"][signal], series["eth_sum"][prev],
            series["sol_sum"][signal], series["sol_sum"][prev])
    elif name == "eth_bnb_kink_2021":
        detail = "ETH %+.4f%% BTC %+.4f%% BNB %+.4f%%" % (
            ret_text(series["eth_c"], signal),
            ret_text(series["btc_c"], signal),
            ret_text(series["bnb_c"], signal))
    elif name == "btc_eth_split_2021":
        detail = "BTC %+.4f%% ETH %+.4f%%" % (
            ret_text(series["btc_c"], signal), ret_text(series["eth_c"], signal))
    elif name == "avax_dot_up_2021":
        detail = "AVAX %+.4f%% DOT %+.4f%% BTC %+.4f%%" % (
            ret_text(series["avax_c"], signal),
            ret_text(series["dot_c"], signal),
            ret_text(series["btc_c"], signal))
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
    avax_c = p30.load_field(os.path.join(spot, "AVAXUSDT", "1d"), 4, 5)
    dot_c = p30.load_field(os.path.join(spot, "DOTUSDT", "1d"), 4, 5)
    for day in ("2021-01-01", "2022-01-01"):
        if day not in btc_opens or day not in eth_opens:
            raise SystemExit("spot open does not cover %s" % day)
    p30.require_span("btc", btc_c, "2017-08-17", "2022-01-01", "2021-01-02")
    p30.require_span("eth", eth_c, "2017-08-17", "2022-01-01", "2021-01-02")
    p30.require_span("bnb", bnb_c, "2017-11-06", "2021-12-31", "2021-01-02")
    p30.require_span("avax", avax_c, "2020-09-22", "2021-12-31", "2021-01-02")
    p30.require_span("dot", dot_c, "2020-08-18", "2021-12-31", "2021-01-02")
    metrics = os.path.join(INP, "metrics")
    pos = load_metric_last(metrics, POS_COL)
    acct = load_metric_last(metrics, ACCT_COL)
    if p5.parse_ymd("2021-01-02").weekday() != 5:
        raise SystemExit("saturday")
    for day in ("2020-12-01", "2020-12-26", "2020-12-31", "2021-01-02", "2021-12-29"):
        if day not in pos or day not in acct:
            raise SystemExit("metrics missing %s" % day)
    for day in ("2021-12-30", "2021-12-31"):
        path = os.path.join(metrics, "BTCUSDT-metrics-%s.zip" % day)
        if not os.path.exists(path) or day in pos or day in acct:
            raise SystemExit("empty last-row ratio was not dropped %s" % day)
    funding = os.path.join(INP, "funding")
    eth_f = load_funding_lists(funding, "ETHUSDT")
    sol_f = load_funding_lists(funding, "SOLUSDT")
    if min(sol_f) != "2020-09-13":
        raise SystemExit("SOL funding start %s" % min(sol_f))
    eth_sum = sums_of(eth_f)
    sol_sum = sums_of(sol_f)
    for day in ("2020-12-01", "2020-12-31", "2021-01-02", "2021-12-31"):
        if day not in eth_sum or day not in sol_sum:
            raise SystemExit("funding missing %s" % day)
    btc_ret = p30.open_returns(btc_opens, "2021-01-01", "2021-12-31")
    eth_ret = p30.open_returns(eth_opens, "2021-01-01", "2021-12-31")
    if "2021-12-31" not in btc_ret or "2021-12-31" not in eth_ret:
        raise SystemExit("2021-12-31 has no next open")
    series = {
        "pos": pos, "acct": acct, "eth_f": eth_f,
        "eth_sum": eth_sum, "sol_sum": sol_sum,
        "btc_c": btc_c, "eth_c": eth_c, "bnb_c": bnb_c,
        "avax_c": avax_c, "dot_c": dot_c,
    }
    specs = (
        ("btc_ttdip_2021", dip(pos), "2021-01-01", "2021-12-31"),
        ("btc_ttgap_2021", narrow(pos, acct), "2021-01-01", "2021-12-31"),
        ("btc_ttweek_2021", week(pos, acct), "2021-01-01", "2021-12-31"),
        ("eth_fund_cool_2021", cool(eth_f), "2021-01-01", "2021-12-31"),
        ("eth_sol_rise_2021", both_rise(eth_sum, sol_sum), "2021-01-01", "2021-12-31"),
        ("eth_bnb_kink_2021", kink(eth_c, btc_c, bnb_c), "2021-01-01", "2021-12-31"),
        ("btc_eth_split_2021", book_split(eth_c, btc_c), "2021-01-01", "2021-12-31"),
        ("avax_dot_up_2021", alts_up(avax_c, dot_c, btc_c), "2021-01-01", "2021-12-31"),
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
        kills[name] = row
        describe(name, p30.shift(entries[0], -1), btc_opens, series)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed at 2026-09-25 07:34:17 UTC, before its own result. "
            "Every fill is the execution-day open to the next open. "
            "None of these is a moving average, a breakout, or a candlestick pattern. "
            "None lowers 1.30, 0.001, the five-day funding window, the 10% SOL excess, or the 0.0004 width. "
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
            raise SystemExit("summary_pass35.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
