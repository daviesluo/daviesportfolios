"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads ushare_rule.txt and range_rule.txt, checks the sha256 frozen before
any series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass16.json. Public Binance archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass16.py
    python3 docs/agents/scripts/fp5/screen_pass16.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass16")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass16.json")
USHARE_SHA = "18d049e09c2af6e81f11d18c8df18e4e0851ef747161cf8ea5b94ee9839fd83e"
RANGE_SHA = "8deb88cf4671d678f3fe1d8b61d0b70b5a9bb46921927ee041d3445310070d16"
US_HOURS = (14, 15, 16, 17, 18, 19, 20)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    ushare = sha256_file(os.path.join(RULES, "ushare_rule.txt"))
    rng = sha256_file(os.path.join(RULES, "range_rule.txt"))
    if ushare != USHARE_SHA or rng != RANGE_SHA:
        raise SystemExit("rule text moved after the freeze: ushare %s range %s" % (ushare, rng))
    return ushare, rng


def stamp_of(ts):
    ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
    return datetime.fromtimestamp(ts, timezone.utc)


def share_from_hours(hours):
    if set(hours) != set(range(24)):
        return None
    total = sum(hours.values())
    if total <= 0:
        return None
    return sum(hours[h] for h in US_HOURS) / total


def range_of(high, low, close):
    if close <= 0 or high < low:
        return None
    return (high - low) / close


def level_changes(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels and levels[prev] > 0:
            changes[day] = level / levels[prev] - 1.0
    return changes


def iter_kline_rows(folder):
    if not os.path.isdir(folder):
        raise SystemExit("missing klines %s" % folder)
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            yield parts


def load_shares(folder):
    by_day = {}
    first = None
    for parts in iter_kline_rows(folder):
        if len(parts) < 8:
            raise SystemExit("hourly gap: field 8 absent (%d fields)" % len(parts))
        when = stamp_of(int(parts[0]))
        day = p5.ymd(when)
        hours = by_day.setdefault(day, {})
        if when.hour in hours:
            raise SystemExit("duplicate hour %s %d" % (day, when.hour))
        hours[when.hour] = float(parts[7])
        if first is None or day < first:
            first = day
    if first != "2017-08-17":
        raise SystemExit("hourly archive does not start 2017-08-17")
    shares = {}
    for day, hours in by_day.items():
        share = share_from_hours(hours)
        if share is not None:
            shares[day] = share
    if "2018-12-31" not in shares:
        raise SystemExit("volume share does not cover 2018-12-31")
    return shares


def load_daily(folder):
    closes = {}
    ranges = {}
    first = None
    for parts in iter_kline_rows(folder):
        if len(parts) < 5:
            raise SystemExit("daily gap: field 5 absent (%d fields)" % len(parts))
        day = p5.ymd(stamp_of(int(parts[0])))
        high, low, close = float(parts[2]), float(parts[3]), float(parts[4])
        closes[day] = close
        width = range_of(high, low, close)
        if width is not None:
            ranges[day] = width
        if first is None or day < first:
            first = day
    return first, closes, ranges


def ensure_inputs():
    jobs = []
    for ym in p5.months("2017-08", "2018-12"):
        name = "BTCUSDT-1h-%s.zip" % ym
        url = p5.VISION + "spot/monthly/klines/BTCUSDT/1h/" + name
        jobs.append((url, os.path.join(INP, "klines", "BTCUSDT", "1h", name)))
        name = "BTCUSDT-1d-%s.zip" % ym
        url = p5.VISION + "spot/monthly/klines/BTCUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "BTCUSDT", "1d", name)))
    for ym in p5.months("2017-12", "2018-12"):
        name = "ETHUSDT-1d-%s.zip" % ym
        url = p5.VISION + "spot/monthly/klines/ETHUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "ETHUSDT", "1d", name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))


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
    flat = {h: 1.0 for h in range(24)}
    if abs(share_from_hours(flat) - 7.0 / 24.0) > 1e-12:
        raise SystemExit("us share")
    short = dict(flat)
    del short[3]
    if share_from_hours(short) is not None or share_from_hours({h: 0.0 for h in range(24)}) is not None:
        raise SystemExit("incomplete day is not a share")
    if range_of(11.0, 9.0, 10.0) != 0.2 or range_of(9.0, 11.0, 10.0) is not None:
        raise SystemExit("range")
    changes = level_changes({"2018-01-01": 0.2, "2018-01-02": 0.3, "2018-01-04": 0.4})
    if abs(changes.get("2018-01-02", 0) - 0.5) > 1e-12 or set(changes) != {"2018-01-02"}:
        raise SystemExit("level change: %s" % changes)
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    ushare_sha, range_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    btc_first, btc_closes, ranges = load_daily(os.path.join(INP, "klines", "BTCUSDT", "1d"))
    eth_first, eth_closes, _eth_ranges = load_daily(os.path.join(INP, "klines", "ETHUSDT", "1d"))
    if btc_first != "2017-08-17":
        raise SystemExit("btc daily archive does not start 2017-08-17")
    if "2017-12-31" not in eth_closes or "2018-12-31" not in eth_closes:
        raise SystemExit("eth daily archive does not cover 2018")
    shares = load_shares(os.path.join(INP, "klines", "BTCUSDT", "1h"))
    btc = p5.returns_between(btc_closes, "2018-01-01", "2018-12-31")
    eth = p5.returns_between(eth_closes, "2018-01-01", "2018-12-31")
    share_marked = p5.long_days_for(level_changes(shares), "2018-01-01", "2018-12-31", 90, 71, False)
    range_marked = p5.long_days_for(level_changes(ranges), "2018-01-01", "2018-12-31", 90, 71, False)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"ushare_rule_sha256": ushare_sha, "range_rule_sha256": range_sha},
        "kills": {
            "us_volume_share_2018": run_rule("us_volume_share_2018", share_marked, btc, eth, 400),
            "btc_range_2018": run_rule("btc_range_2018", range_marked, btc, eth, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass16.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
