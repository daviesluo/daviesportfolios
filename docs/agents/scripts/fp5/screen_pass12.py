"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads dvol_rule.txt and yield_rule.txt, checks the sha256 frozen before any
series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass12.json. Public Deribit, FRED and
Binance archives only. Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass12.py
    python3 docs/agents/scripts/fp5/screen_pass12.py --check
"""
import hashlib, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass12")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass12.json")
DVOL_SHA = "c82440b675421ff2cfa6eba028915cfb432b6f943557fbacffa544603501278f"
YIELD_SHA = "48f9ff102ddb5189c03f59e5385f7d8409b554a72959922a2a7fa9176627c8ad"
DVOL_URL = "https://www.deribit.com/api/v2/public/get_volatility_index_data"
DVOL_START = 1616544000000  # 2021-03-24, first daily bar
DVOL_END = 1672531200000  # 2023-01-01, exclusive
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    dvol = sha256_file(os.path.join(RULES, "dvol_rule.txt"))
    yld = sha256_file(os.path.join(RULES, "yield_rule.txt"))
    if dvol != DVOL_SHA or yld != YIELD_SHA:
        raise SystemExit("rule text moved after the freeze: dvol %s yield %s" % (dvol, yld))
    return dvol, yld


def dvol_close(row):
    if len(row) != 5:
        raise SystemExit("dvol row width %d" % len(row))
    ts, opened, high, low, close = (int(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]))
    if not (high >= opened and high >= close and low <= opened and low <= close and high >= low and close > 0):
        raise SystemExit("dvol ohlc order")
    return ts, close


def fetch_dvol(dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    start = DVOL_START
    rows = []
    seen = set()
    for _ in range(30):
        url = "%s?currency=BTC&start_timestamp=%d&end_timestamp=%d&resolution=86400" % (DVOL_URL, start, DVOL_END)
        req = urllib.request.Request(url, headers={"User-Agent": "fp5-screen/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = json.load(r)
        result = payload["result"]
        data = result["data"]
        if "continuation" not in result:
            raise SystemExit("dvol continuation field absent")
        if not data:
            break
        for row in data:
            ts, close = dvol_close(row)
            if ts < DVOL_START or ts >= DVOL_END or ts in seen:
                continue
            seen.add(ts)
            rows.append((ts, close))
        cont = result["continuation"]
        if not cont or int(cont) == start:
            break
        start = int(cont)
    if not rows:
        raise SystemExit("dvol empty")
    rows.sort()
    lines = ["day,close"]
    for ts, close in rows:
        day = p5.ymd(datetime.fromtimestamp(ts / 1000, timezone.utc))
        lines.append("%s,%.10f" % (day, close))
    if lines[1].split(",")[0] != "2021-03-24":
        raise SystemExit("dvol archive does not start 2021-03-24")
    tmp = dest + ".part"
    with open(tmp, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, dest)


def ensure_inputs():
    jobs = []
    for sym, start, end in (("BTCUSDT", "2017-12", "2018-12"), ("ETHUSDT", "2017-12", "2018-12"),
                            ("BTCUSDT", "2021-12", "2022-12"), ("ETHUSDT", "2021-12", "2022-12")):
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, name)))
    jobs.append((FRED_URL, os.path.join(INP, "dgs10.csv")))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    fetch_dvol(os.path.join(INP, "dvol.csv"))


def day_of(ts):
    ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
    return p5.ymd(datetime.fromtimestamp(ts, timezone.utc))


def load_closes(folder):
    out = {}
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            if len(parts) < 5:
                raise SystemExit("kline gap: field 5 absent (%d fields)" % len(parts))
            out[day_of(int(parts[0]))] = float(parts[4])
    return out


def level_changes(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels and levels[prev] > 0:
            changes[day] = level / levels[prev] - 1.0
    return changes


def load_dvol(path):
    lines = open(path).read().splitlines()
    if not lines or lines[0] != "day,close":
        raise SystemExit("dvol header")
    if lines[1].split(",")[0] != "2021-03-24":
        raise SystemExit("dvol archive does not start 2021-03-24")
    levels = {}
    for line in lines[1:]:
        day, cell = line.split(",")
        levels[day] = float(cell)
    return levels


def load_yields(path):
    lines = open(path).read().splitlines()
    if not lines or lines[0] != "observation_date,DGS10":
        raise SystemExit("yield header")
    if lines[1].split(",")[0] != "1962-01-02":
        raise SystemExit("yield archive does not start 1962-01-02")
    levels = {}
    for line in lines[1:]:
        day, cell = line.split(",")
        if cell in ("", "."):
            continue
        level = float(cell)
        if level > 0:
            levels[day] = level
    return levels


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
    if dvol_close([1600000000000, 1.0, 3.0, 0.5, 2.0]) != (1600000000000, 2.0):
        raise SystemExit("dvol close index")
    changes = level_changes({"2018-01-01": 2.0, "2018-01-02": 2.1, "2018-01-04": 2.2, "2018-02-01": 0.0, "2018-02-02": 2.3})
    if abs(changes.get("2018-01-02", 0) - 0.05) > 1e-12 or set(changes) != {"2018-01-02"}:
        raise SystemExit("yield change: %s" % changes)
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    dvol_sha, yld_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    elif not os.path.isfile(os.path.join(INP, "dvol.csv")) or not os.path.isfile(os.path.join(INP, "dgs10.csv")):
        raise SystemExit("missing frozen inputs; run without --check first")
    btc = load_closes(os.path.join(INP, "klines", "BTCUSDT"))
    eth = load_closes(os.path.join(INP, "klines", "ETHUSDT"))
    btc_d = p5.returns_between(btc, "2022-01-01", "2022-12-31")
    eth_d = p5.returns_between(eth, "2022-01-01", "2022-12-31")
    btc_y = p5.returns_between(btc, "2018-01-01", "2018-12-31")
    eth_y = p5.returns_between(eth, "2018-01-01", "2018-12-31")
    dvol = level_changes(load_dvol(os.path.join(INP, "dvol.csv")))
    yld = level_changes(load_yields(os.path.join(INP, "dgs10.csv")))
    dvol_marked = p5.long_days_for(dvol, "2022-01-01", "2022-12-31", 90, 71, False)
    yld_marked = p5.long_days_for(yld, "2018-01-01", "2018-12-31", 90, 71, False)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"dvol_rule_sha256": dvol_sha, "yield_rule_sha256": yld_sha},
        "kills": {
            "dvol_jump_2022": run_rule("dvol_jump_2022", dvol_marked, btc_d, eth_d, 400),
            "yield_jump_2018": run_rule("yield_jump_2018", yld_marked, btc_y, eth_y, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass12.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
