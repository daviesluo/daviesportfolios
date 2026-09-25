"""Eight frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads the eight rule texts hashed at 2026-09-25 05:53:33 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass24.json. Public market archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass24.py
    python3 docs/agents/scripts/fp5/screen_pass24.py --check
"""
import hashlib, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass24")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass24.json")
SHA = {
    "ethbtc": "4647622d3300173113c62441d62549bfb88d9c6c6c562fd7449df4d2c0a3f946",
    "btcquote": "3809c921fa95b0706e767dd16666b524ce55cbd57a65b09f2dcebfb00de1d698",
    "ethfund": "33db377993a20b8a4254ff5a58fa8e6f2d48bbbae8ae11e7c62f03a5f87507c9",
    "cbbasis": "8a2afa597a1d4579b5cf0ffe4f21b5cfa94affd2b73b2705955f7260fa790c59",
    "solpx": "063d6ccdbcdff6a0f5846702f3d6578d4a6de4ac7f4b487632b7b0e262da84d1",
    "dcost": "ceed0757ee899a8cdbcfa5918b897d097e1c982998fdf2d3652833924ce303a9",
    "ethpq": "b5f20ad02cb0154fe0689c10c236f2291773f54f45a2e02c0274c99ff2fa1b2a",
    "okxbasis": "787370af90c0b6eb9882da7e18d2f5edca5e3b08223314fdde392f89fcf6dbd2",
}
UA = {"User-Agent": "fp5-screen/1.0 (daviesluo@gmail.com)", "Accept": "application/json"}
DERIBIT = (
    "https://www.deribit.com/api/v2/public/get_tradingview_chart_data"
    "?instrument_name=BTC-PERPETUAL&resolution=1D&start_timestamp=%d&end_timestamp=%d"
)
OKX_FLOOR = 1515628800000  # 2018-01-11 00:00:00 UTC
OKX_AFTER = 1577836800000  # 2020-01-01 00:00:00 UTC


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


def fetch_json(url, timeout=60):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit("fetch failed %s: %s" % (url, last))


def agreed(pull, label):
    for _ in range(2):
        first, second = pull(), pull()
        if first == second:
            return first
    raise SystemExit("two pulls disagree: %s" % label)


def dump_levels(path, header, levels):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = [header]
    for day in sorted(levels):
        lines.append("%s,%s" % (day, format(levels[day], ".17g")))
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def load_levels(path, header, first_day, last_day=None, cover=None):
    lines = open(path).read().splitlines()
    if not lines or lines[0] != header:
        raise SystemExit("header %s" % header)
    levels = {}
    for line in lines[1:]:
        day, cell = line.split(",")
        if day in levels:
            raise SystemExit("duplicate day %s" % day)
        levels[day] = float(cell)
    if not levels or min(levels) != first_day:
        raise SystemExit("archive start %s: %s" % (path, min(levels) if levels else None))
    if last_day is not None and max(levels) != last_day:
        raise SystemExit("archive end %s: %s" % (path, max(levels)))
    if cover is not None and max(levels) < cover:
        raise SystemExit("archive %s does not cover %s" % (path, cover))
    return levels


def day_of_ms(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def stamp_of(ts):
    ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
    return datetime.fromtimestamp(ts, timezone.utc)


def iter_kline_rows(folder):
    if not os.path.isdir(folder):
        raise SystemExit("missing klines %s" % folder)
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            yield line.split(",")


def load_field(folder, index, need):
    values = {}
    for parts in iter_kline_rows(folder):
        if len(parts) < need:
            raise SystemExit("kline gap: field %d absent (%d fields)" % (need, len(parts)))
        day = p5.ymd(stamp_of(int(parts[0])))
        if day in values:
            raise SystemExit("duplicate day %s" % day)
        values[day] = float(parts[index])
    return values


def level_changes(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels and levels[prev] > 0 and level > 0:
            changes[day] = level / levels[prev] - 1.0
    return changes


def level_diffs(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels:
            changes[day] = level - levels[prev]
    return changes


def basis_levels(other, binance):
    levels = {}
    for day, close in other.items():
        spot = binance.get(day)
        if close > 0 and spot is not None and spot > 0:
            levels[day] = close / spot - 1.0
    return levels


def coinbase_closes():
    closes = {}
    cur = datetime(2017, 8, 1, tzinfo=timezone.utc)
    end = datetime(2019, 1, 2, tzinfo=timezone.utc)
    while cur < end:
        nxt = min(cur + timedelta(days=200), end)
        url = (
            "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400"
            "&start=%s&end=%s" % (cur.strftime("%Y-%m-%dT%H:%M:%SZ"), nxt.strftime("%Y-%m-%dT%H:%M:%SZ"))
        )
        for row in fetch_json(url):
            if len(row) < 5:
                raise SystemExit("coinbase candle width")
            day = datetime.fromtimestamp(int(row[0]), timezone.utc).strftime("%Y-%m-%d")
            close = float(row[4])
            if close <= 0:
                continue
            if day in closes and closes[day] != close:
                raise SystemExit("coinbase duplicate %s" % day)
            closes[day] = close
        cur = nxt
        time.sleep(0.2)
    return closes


def okx_closes():
    closes = {}
    after = OKX_AFTER
    while True:
        url = (
            "https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=1Dutc&limit=100&after=%d" % after
        )
        data = fetch_json(url)
        if str(data.get("code")) != "0":
            raise SystemExit("okx %s" % data.get("msg"))
        batch = data.get("data") or []
        if not batch:
            break
        oldest = min(int(row[0]) for row in batch)
        if oldest >= after:
            raise SystemExit("okx pagination did not move")
        for row in batch:
            if len(row) < 9 or row[8] != "1":
                continue
            close = float(row[4])
            if close <= 0:
                continue
            day = day_of_ms(int(row[0]))
            if day in closes and closes[day] != close:
                raise SystemExit("okx duplicate %s" % day)
            closes[day] = close
        if oldest <= OKX_FLOOR:
            break
        after = oldest
        time.sleep(0.15)
    return closes


def deribit_cost():
    levels = {}
    for ym in p5.months("2018-08", "2019-12"):
        year, month = (int(part) for part in ym.split("-"))
        start = datetime(year, month, 1, tzinfo=timezone.utc)
        if month == 12:
            end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
        url = DERIBIT % (int(start.timestamp() * 1000), int(end.timestamp() * 1000))
        result = fetch_json(url).get("result") or {}
        ticks = result.get("ticks") or []
        costs = result.get("cost") or []
        if len(ticks) != len(costs):
            raise SystemExit("deribit cost is not aligned")
        start_day = start.strftime("%Y-%m-%d")
        end_day = end.strftime("%Y-%m-%d")
        for ts, cost in zip(ticks, costs):
            day = day_of_ms(int(ts))
            if day < start_day or day >= end_day:
                continue
            value = float(cost)
            if value <= 0:
                continue
            if day in levels and levels[day] != value:
                raise SystemExit("deribit duplicate %s" % day)
            levels[day] = value
        time.sleep(0.12)
    return levels


def parse_eth_funding():
    by_day = {}
    folder = os.path.join(INP, "funding")
    if not os.path.isdir(folder):
        raise SystemExit("missing funding")
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        lines = p5.zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if "last_funding_rate" not in header or "calc_time" not in header:
            raise SystemExit("funding header is not the locked columns: %s" % header)
        ti, ri = header.index("calc_time"), header.index("last_funding_rate")
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            day = p5.ymd(datetime.fromtimestamp(int(parts[ti]) / 1000, timezone.utc))
            by_day.setdefault(day, []).append(float(parts[ri]))
    sums = {}
    for day, rates in by_day.items():
        if len(rates) >= 3:
            sums[day] = sum(rates)
    return sums


def kline_jobs():
    jobs = []
    spans = {
        ("spot", "BTCUSDT"): ("2017-08", "2019-12"),
        ("spot", "ETHUSDT"): ("2017-08", "2019-12"),
        ("spot", "ETHBTC"): ("2017-08", "2018-12"),
        ("spot", "SOLUSDT"): ("2020-08", "2021-12"),
    }
    for (market, sym), (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "%s/monthly/klines/%s/1d/%s" % (market, sym, name)
            jobs.append((url, os.path.join(INP, "klines", market, sym, "1d", name)))
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2020-12", "2021-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for ym in p5.months("2020-01", "2021-12"):
        name = "ETHUSDT-1d-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/klines/ETHUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "um", "ETHUSDT", "1d", name)))
        fname = "ETHUSDT-fundingRate-%s.zip" % ym
        furl = p5.VISION + "futures/um/monthly/fundingRate/ETHUSDT/" + fname
        jobs.append((furl, os.path.join(INP, "funding", fname)))
    return jobs


def ensure_inputs(btc_closes):
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), kline_jobs()))
    steps = (
        ("cbbasis.csv", "day,basis", lambda: basis_levels(agreed(coinbase_closes, "coinbase"), btc_closes)),
        ("okxbasis.csv", "day,basis", lambda: basis_levels(agreed(okx_closes, "okx"), btc_closes)),
        ("dcost.csv", "day,cost", lambda: agreed(deribit_cost, "deribit")),
        ("ethfund.csv", "day,sum", parse_eth_funding),
    )
    for name, header, pull in steps:
        path = os.path.join(INP, name)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            print("pass24 keep", name, flush=True)
            continue
        print("pass24 fetch", name, flush=True)
        dump_levels(path, header, pull())
    print("pass24 inputs ready", flush=True)


def run_rule(name, marked, btc, eth, floor):
    exec_days, flags = [], []
    for day, take in marked:
        if day not in btc or day not in eth:
            continue
        exec_days.append(day)
        flags.append(take)
    if not exec_days:
        raise SystemExit("no execution days for %s" % name)
    base = p5.score(exec_days, flags, btc, eth, 20.0)
    stress = p5.score(exec_days, flags, btc, eth, 40.0)
    base["stress"] = stress["pool"]
    if base["trips"] < 1 or base["long_days"] < 1:
        raise SystemExit("no entries for %s" % name)
    p50, p95 = p5.null_band(exec_days, base["long_days"], btc, eth, 20.0)
    reasons = []
    share, month, month_pnl = p5.month_share(base)
    if not base["pool"] > 0:
        reasons.append("pooled P&L is not positive")
    if not base["stress"] > 0:
        reasons.append("doubled cost is not positive")
    if base["trips"] < 60:
        reasons.append("fewer than 60 round trips")
    if not (base["btc"] > 0 and base["eth"] > 0):
        reasons.append("one book is not positive")
    if not base["pool"] > p95:
        reasons.append("does not beat the random-day null")
    if share is not None and share > 0.40:
        reasons.append("one month is more than 40% of P&L")
    if not base["pool"] > floor:
        reasons.append("pooled P&L does not exceed %d bps" % floor)
    return {
        "name": name,
        "pool_bps": round(base["pool"], 1),
        "stress_bps": round(base["stress"], 1),
        "trips": base["trips"],
        "long_days": base["long_days"],
        "execution_days": len(exec_days),
        "btc_bps": round(base["btc"], 1),
        "eth_bps": round(base["eth"], 1),
        "null_p50_bps": round(p50, 1),
        "null_p95_bps": round(p95, 1),
        "month_share": None if share is None else round(share, 3),
        "top_month": month,
        "top_month_bps": None if month_pnl is None else round(month_pnl, 1),
        "candle_bar_clear": len(reasons) == 0,
        "why": "; ".join(reasons) if reasons else "candle bar is clear; closes still cannot pass",
    }


def self_check():
    p5.self_check()
    series = {p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=i)): float(i + 1) for i in range(100)}
    signal = p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=90))
    if p5.trailing_threshold(series, signal, 90, 71) != 72.0:
        raise SystemExit("top-quintile index")
    changes = level_changes({"2018-01-01": 10.0, "2018-01-02": 12.0, "2018-01-04": 15.0})
    if abs(changes.get("2018-01-02", 0) - 0.2) > 1e-9 or set(changes) != {"2018-01-02"}:
        raise SystemExit("level change")
    diffs = level_diffs({"2018-01-01": -1.0, "2018-01-02": 2.0})
    if abs(diffs.get("2018-01-02", 0) - 3.0) > 1e-9:
        raise SystemExit("level diff")
    basis = basis_levels({"2018-01-01": 110.0}, {"2018-01-01": 100.0})
    if abs(basis["2018-01-01"] - 0.1) > 1e-12:
        raise SystemExit("basis")
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")
    if day_of_ms(OKX_FLOOR) != "2018-01-11" or day_of_ms(OKX_AFTER) != "2020-01-01":
        raise SystemExit("okx bounds")


def require_history(name, changes, day):
    prior = sum(1 for item in changes if item < day)
    if prior < 90:
        raise SystemExit("%s has %d changes before %s" % (name, prior, day))


def require_span(name, levels, first, last, saturday):
    if not levels or min(levels) != first:
        raise SystemExit("%s start %s" % (name, min(levels) if levels else None))
    if last not in levels:
        raise SystemExit("%s missing %s" % (name, last))
    if saturday not in levels:
        raise SystemExit("%s dropped %s" % (name, saturday))


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    spot_btc = os.path.join(INP, "klines", "spot", "BTCUSDT", "1d")
    spot_eth = os.path.join(INP, "klines", "spot", "ETHUSDT", "1d")
    if not check:
        # Binance closes are an input to the basis, downloaded before the join.
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda job: p5.fetch(*job), [job for job in kline_jobs() if "/klines/BTCUSDT/" in job[0]]))
        btc_for_basis = load_field(spot_btc, 4, 5)
        ensure_inputs(btc_for_basis)
    btc_closes = load_field(spot_btc, 4, 5)
    eth_closes = load_field(spot_eth, 4, 5)
    ethbtc = load_field(os.path.join(INP, "klines", "spot", "ETHBTC", "1d"), 4, 5)
    btc_quote = load_field(spot_btc, 7, 8)
    sol = load_field(os.path.join(INP, "klines", "spot", "SOLUSDT", "1d"), 4, 5)
    eth_perp_quote = load_field(os.path.join(INP, "klines", "um", "ETHUSDT", "1d"), 7, 8)
    for day in ("2017-12-31", "2018-12-31", "2019-12-31", "2020-12-31", "2021-12-31"):
        if day not in btc_closes or day not in eth_closes:
            raise SystemExit("spot does not cover %s" % day)
    require_span("ethbtc", ethbtc, "2017-08-01", "2018-12-31", "2018-01-06")
    require_span("btcquote", btc_quote, "2017-08-17", "2018-12-31", "2018-01-06")
    require_span("sol", sol, "2020-08-11", "2021-12-31", "2021-01-02")
    require_span("ethpq", eth_perp_quote, "2020-01-01", "2021-12-31", "2021-01-02")
    cbbasis = load_levels(os.path.join(INP, "cbbasis.csv"), "day,basis", "2017-08-17", cover="2018-12-31")
    okxbasis = load_levels(os.path.join(INP, "okxbasis.csv"), "day,basis", "2018-01-11", cover="2019-12-31")
    dcost = load_levels(os.path.join(INP, "dcost.csv"), "day,cost", "2018-08-14", cover="2019-12-31")
    ethfund = load_levels(os.path.join(INP, "ethfund.csv"), "day,sum", "2020-01-01", cover="2021-12-31")
    for name, levels, saturday in (
        ("cbbasis", cbbasis, "2018-01-06"),
        ("okxbasis", okxbasis, "2019-01-05"),
        ("dcost", dcost, "2019-01-05"),
        ("ethfund", ethfund, "2021-01-02"),
    ):
        if saturday not in levels:
            raise SystemExit("%s dropped %s" % (name, saturday))
    btc18 = p5.returns_between(btc_closes, "2018-01-01", "2018-12-31")
    eth18 = p5.returns_between(eth_closes, "2018-01-01", "2018-12-31")
    btc19 = p5.returns_between(btc_closes, "2019-01-01", "2019-12-31")
    eth19 = p5.returns_between(eth_closes, "2019-01-01", "2019-12-31")
    btc21 = p5.returns_between(btc_closes, "2021-01-01", "2021-12-31")
    eth21 = p5.returns_between(eth_closes, "2021-01-01", "2021-12-31")
    specs = (
        ("ethbtc_close_2018", level_changes(ethbtc), "2018-01-01", "2018-12-31", btc18, eth18),
        ("btc_spot_quote_2018", level_changes(btc_quote), "2018-01-01", "2018-12-31", btc18, eth18),
        ("eth_funding_2021", level_diffs(ethfund), "2021-01-01", "2021-12-31", btc21, eth21),
        ("coinbase_basis_2018", level_diffs(cbbasis), "2018-01-01", "2018-12-31", btc18, eth18),
        ("sol_close_2021", level_changes(sol), "2021-01-01", "2021-12-31", btc21, eth21),
        ("deribit_cost_2019", level_changes(dcost), "2019-01-01", "2019-12-31", btc19, eth19),
        ("eth_perp_quote_2021", level_changes(eth_perp_quote), "2021-01-01", "2021-12-31", btc21, eth21),
        ("okx_basis_2019", level_diffs(okxbasis), "2019-01-01", "2019-12-31", btc19, eth19),
    )
    kills = {}
    for name, changes, start, end, btc, eth in specs:
        require_history(name, changes, start)
        marked = p5.long_days_for(changes, start, end, 90, 71, False)
        kills[name] = run_rule(name, marked, btc, eth, 400)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. None is a pass.",
        "rules": {name + "_rule_sha256": digest for name, digest in found.items()},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass24.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
