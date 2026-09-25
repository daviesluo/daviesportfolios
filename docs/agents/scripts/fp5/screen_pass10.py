"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads addr_rule.txt and wick_rule.txt, checks the sha256 frozen before any
series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass10.json. Public archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass10.py
    python3 docs/agents/scripts/fp5/screen_pass10.py --check
"""
import hashlib, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass10")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass10.json")
ADDR_JSON = os.path.join(INP, "addr.json")
ADDR_SHA = "60dfc936bb20f5df5850b8fe035239f8fb7853d3630b07ef1623e18f4473969c"
WICK_SHA = "f49c0b9d673b1bf594f6a4cea68cd7817502e274ab945ca9dafabde991d0bb09"
ADDR_URL = (
    "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
    "?assets=btc&metrics=AdrBalCnt&frequency=1d"
    "&start_time=2018-09-01&end_time=2020-01-02&page_size=10000"
)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    addr = sha256_file(os.path.join(RULES, "addr_rule.txt"))
    wick = sha256_file(os.path.join(RULES, "wick_rule.txt"))
    if addr != ADDR_SHA or wick != WICK_SHA:
        raise SystemExit("rule text moved after the freeze: addr %s wick %s" % (addr, wick))
    return addr, wick


def fetch_json(url):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fp5-screen/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit("fetch failed %s: %s" % (url, last))


def ensure_inputs():
    jobs = []
    for sym, start, end in (
        ("BTCUSDT", "2017-09", "2019-12"),
        ("ETHUSDT", "2017-12", "2019-12"),
    ):
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    rows = []
    url = ADDR_URL
    seen = 0
    while url:
        page = fetch_json(url)
        if "AdrBalCnt" not in json.dumps(page.get("data", [])[:1]):
            if not page.get("data"):
                raise SystemExit("address-count gap: AdrBalCnt absent")
        rows.extend(page.get("data") or [])
        token = page.get("next_page_token")
        url = page.get("next_page_url") if token else None
        seen += 1
        if seen > 10:
            raise SystemExit("address-count gap: pagination did not end")
    if not any("AdrBalCnt" in row for row in rows):
        raise SystemExit("address-count gap: AdrBalCnt absent")
    os.makedirs(INP, exist_ok=True)
    with open(ADDR_JSON, "w") as f:
        json.dump(rows, f, sort_keys=True)
        f.write("\n")


def day_of(ts):
    ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
    return p5.ymd(datetime.fromtimestamp(ts, timezone.utc))


def load_ohlc(sym):
    out = {}
    folder = os.path.join(INP, "klines", sym)
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            if len(parts) < 5:
                raise SystemExit("wick gap: kline has %d fields" % len(parts))
            out[day_of(int(parts[0]))] = tuple(float(parts[i]) for i in (1, 2, 3, 4))
    return out


def load_closes(ohlc):
    return {day: candle[3] for day, candle in ohlc.items()}


def level_changes(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels and levels[prev] > 0:
            changes[day] = level / levels[prev] - 1.0
    return changes


def load_addr_levels():
    with open(ADDR_JSON) as f:
        rows = json.load(f)
    levels = {}
    for row in rows:
        if "AdrBalCnt" not in row or row["AdrBalCnt"] in (None, ""):
            continue
        day = row["time"][:10]
        levels[day] = float(row["AdrBalCnt"])
    if len(levels) < 90:
        raise SystemExit("address-count gap: %d days" % len(levels))
    return levels


def wick_shares(ohlc):
    out = {}
    for day, (open_, high, low, close) in ohlc.items():
        if high > low:
            out[day] = (min(open_, close) - low) / (high - low)
    return out


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
    series = {p5.ymd(p5.parse_ymd("2019-01-01") + timedelta(days=i)): float(i) for i in range(100)}
    signal = p5.ymd(p5.parse_ymd("2019-01-01") + timedelta(days=90))
    if p5.trailing_threshold(series, signal, 90, 71) != 71.0:
        raise SystemExit("top-quintile index")
    changes = level_changes({
        "2019-01-01": 100.0,
        "2019-01-02": 110.0,
        "2019-01-04": 120.0,
        "2019-02-01": 0.0,
        "2019-02-02": 5.0,
    })
    if abs(changes.get("2019-01-02", 0) - 0.1) > 1e-12 or len(changes) != 1:
        raise SystemExit("address change: %s" % changes)
    shares = wick_shares({
        "2018-01-01": (10.0, 12.0, 8.0, 11.0),
        "2018-01-02": (5.0, 5.0, 5.0, 5.0),
        "2018-01-03": (9.0, 12.0, 8.0, 8.5),
    })
    if abs(shares["2018-01-01"] - 0.5) > 1e-12:
        raise SystemExit("wick share: %s" % shares)
    if "2018-01-02" in shares:
        raise SystemExit("flat candle kept a wick")
    # min(open, close) is the close: wick is 0.5, range is 4, share 0.125
    if abs(shares["2018-01-03"] - 0.125) > 1e-12:
        raise SystemExit("wick uses the lesser of open and close: %s" % shares)
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    addr_sha, wick_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    elif not os.path.isfile(ADDR_JSON):
        raise SystemExit("missing frozen inputs; run without --check first")
    btc_ohlc = load_ohlc("BTCUSDT")
    eth_ohlc = load_ohlc("ETHUSDT")
    btc = load_closes(btc_ohlc)
    eth = load_closes(eth_ohlc)
    btc_w = p5.returns_between(btc, "2018-01-01", "2018-12-31")
    eth_w = p5.returns_between(eth, "2018-01-01", "2018-12-31")
    btc_a = p5.returns_between(btc, "2019-01-01", "2019-12-31")
    eth_a = p5.returns_between(eth, "2019-01-01", "2019-12-31")
    addr_marked = p5.long_days_for(level_changes(load_addr_levels()), "2019-01-01", "2019-12-31", 90, 71, False)
    wick_marked = p5.long_days_for(wick_shares(btc_ohlc), "2018-01-01", "2018-12-31", 90, 71, False)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"addr_rule_sha256": addr_sha, "wick_rule_sha256": wick_sha},
        "kills": {
            "addr_balance_jump_2019": run_rule("addr_balance_jump_2019", addr_marked, btc_a, eth_a, 400),
            "lower_wick_2018": run_rule("lower_wick_2018", wick_marked, btc_w, eth_w, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass10.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
