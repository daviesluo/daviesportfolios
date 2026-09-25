"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads wallet_rule.txt and credit_rule.txt, checks the sha256 frozen before
any series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass14.json. Public Blockchain.com, FRED
and Binance archives only. Nothing here places an order or reads a key.

The mempool.space three-year lightning endpoint is not scored: two pulls
do not return the same days.

    python3 docs/agents/scripts/fp5/screen_pass14.py
    python3 docs/agents/scripts/fp5/screen_pass14.py --check
"""
import hashlib, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass14")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass14.json")
WALLET_SHA = "ce198c8c3cbe4355116966d5124935b4c8a1990a7c64434a3daa9333387fa6a2"
CREDIT_SHA = "757897258ae593025745cd20d0b9a3ece5e0b1ca43f5efd78245dc826adcb5f7"
WALLET_URL = "https://api.blockchain.info/charts/my-wallet-n-users?format=json&timespan=all&sampled=false"
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2&cosd=1996-01-01&coed=2026-09-25"
SPREAD_HEADER = "observation_date,BAMLH0A0HYM2"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    wallet = sha256_file(os.path.join(RULES, "wallet_rule.txt"))
    credit = sha256_file(os.path.join(RULES, "credit_rule.txt"))
    if wallet != WALLET_SHA or credit != CREDIT_SHA:
        raise SystemExit("rule text moved after the freeze: wallet %s credit %s" % (wallet, credit))
    return wallet, credit


def read_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fp5-screen/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def last_of_day(points):
    levels = {}
    seen = {}
    for ts, value in points:
        if value <= 0:
            continue
        day = p5.ymd(datetime.fromtimestamp(int(ts), timezone.utc))
        if day not in seen or ts >= seen[day]:
            seen[day] = ts
            levels[day] = float(value)
    return levels


def write_levels(dest, header, rows):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    lines = [header]
    for day, level in rows:
        lines.append("%s,%.10f" % (day, level))
    tmp = dest + ".part"
    with open(tmp, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, dest)


def fetch_wallets(dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    payload = read_json(WALLET_URL)
    if payload.get("unit") != "User Count" or payload.get("name") != "Blockchain Wallet Users":
        raise SystemExit("wallet chart is not the user count")
    points = []
    for point in payload.get("values") or []:
        if "x" not in point or "y" not in point:
            raise SystemExit("wallet point missing x or y")
        points.append((int(point["x"]), float(point["y"])))
    levels = last_of_day(points)
    if not levels or min(levels) != "2011-11-29":
        raise SystemExit("wallet archive does not start 2011-11-29")
    if "2018-12-31" not in levels:
        raise SystemExit("wallet archive does not cover 2018-12-31")
    write_levels(dest, "day,users", sorted(levels.items()))


def ensure_inputs():
    jobs = []
    for sym, start, end in (("BTCUSDT", "2017-12", "2018-12"), ("ETHUSDT", "2017-12", "2018-12"),
                            ("BTCUSDT", "2024-12", "2025-12"), ("ETHUSDT", "2024-12", "2025-12")):
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, name)))
    jobs.append((FRED_URL, os.path.join(INP, "bamlh0a0hym2.csv")))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    fetch_wallets(os.path.join(INP, "wallets.csv"))


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


def load_series(path, header, start_day):
    lines = open(path).read().splitlines()
    if not lines or lines[0] != header:
        raise SystemExit("header %s" % header)
    if lines[1].split(",")[0] != start_day:
        raise SystemExit("archive does not start %s" % start_day)
    levels = {}
    for line in lines[1:]:
        day, cell = line.split(",")
        levels[day] = float(cell)
    return levels


def spread_levels(lines):
    if not lines or lines[0] != SPREAD_HEADER:
        raise SystemExit("spread header")
    if lines[1].split(",")[0] != "2023-09-25":
        raise SystemExit("spread archive does not start 2023-09-25")
    if lines[-1].split(",")[0] < "2025-12-31":
        raise SystemExit("spread archive does not cover 2025")
    levels = {}
    for line in lines[1:]:
        day, cell = line.split(",")
        if cell in ("", "."):
            continue
        level = float(cell)
        if level > 0:
            levels[day] = level
    return levels


def load_spreads(path):
    return spread_levels(open(path).read().splitlines())


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
    kept = last_of_day([(1514764800, 1.0), (1514847600, 2.0), (1514851200, 3.0)])
    if kept.get("2018-01-01") != 2.0 or kept.get("2018-01-02") != 3.0:
        raise SystemExit("last of day: %s" % kept)
    changes = level_changes({"2018-01-01": 10.0, "2018-01-02": 11.0, "2018-01-04": 12.0})
    if abs(changes.get("2018-01-02", 0) - 0.1) > 1e-12 or set(changes) != {"2018-01-02"}:
        raise SystemExit("level change: %s" % changes)
    sample = spread_levels([
        SPREAD_HEADER,
        "2023-09-25,1.0",
        "2023-09-26,.",
        "2023-09-27,1.1",
        "2025-12-31,1.2",
    ])
    if set(sample) != {"2023-09-25", "2023-09-27", "2025-12-31"}:
        raise SystemExit("missing print is not a level: %s" % sorted(sample))
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    wallet_sha, credit_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    elif not os.path.isfile(os.path.join(INP, "wallets.csv")) or not os.path.isfile(os.path.join(INP, "bamlh0a0hym2.csv")):
        raise SystemExit("missing frozen inputs; run without --check first")
    btc = load_closes(os.path.join(INP, "klines", "BTCUSDT"))
    eth = load_closes(os.path.join(INP, "klines", "ETHUSDT"))
    btc_w = p5.returns_between(btc, "2018-01-01", "2018-12-31")
    eth_w = p5.returns_between(eth, "2018-01-01", "2018-12-31")
    btc_c = p5.returns_between(btc, "2025-01-01", "2025-12-31")
    eth_c = p5.returns_between(eth, "2025-01-01", "2025-12-31")
    wallet = level_changes(load_series(os.path.join(INP, "wallets.csv"), "day,users", "2011-11-29"))
    credit = level_changes(load_spreads(os.path.join(INP, "bamlh0a0hym2.csv")))
    wallet_marked = p5.long_days_for(wallet, "2018-01-01", "2018-12-31", 90, 71, False)
    credit_marked = p5.long_days_for(credit, "2025-01-01", "2025-12-31", 90, 71, False)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"wallet_rule_sha256": wallet_sha, "credit_rule_sha256": credit_sha},
        "kills": {
            "wallet_users_2018": run_rule("wallet_users_2018", wallet_marked, btc_w, eth_w, 400),
            "hy_oas_2025": run_rule("hy_oas_2025", credit_marked, btc_c, eth_c, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass14.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
