"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads monday_rule.txt and oi_rule.txt, checks the sha256 frozen before any
series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass7.json. Public Binance archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass7.py
    python3 docs/agents/scripts/fp5/screen_pass7.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass7")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass7.json")
MONDAY_SHA = "9f15628a6905d7e787c4d6f33cc050e81eed2de97a3bec0f775cd1d13ba039c4"
OI_SHA = "0d14552aceb88c362d05994cbc2642a738bbd32e8b520476f5814fd663ea0873"
OI_COL = "sum_open_interest_value"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    monday = sha256_file(os.path.join(RULES, "monday_rule.txt"))
    oi = sha256_file(os.path.join(RULES, "oi_rule.txt"))
    if monday != MONDAY_SHA or oi != OI_SHA:
        raise SystemExit("rule text moved after the freeze: monday %s oi %s" % (monday, oi))
    return monday, oi


def ensure_inputs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2020-12", "2023-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, name)))
    # The public daily-metrics archive starts 2020-09-01. Earlier dates 404.
    for day in p5.daterange("2020-09-01", "2021-12-31"):
        name = "BTCUSDT-metrics-%s.zip" % day
        url = p5.VISION + "futures/um/daily/metrics/BTCUSDT/" + name
        jobs.append((url, os.path.join(INP, "metrics", name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))


def load_closes(sym):
    closes = {}
    folder = os.path.join(INP, "klines", sym)
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            ts = int(parts[0])
            ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
            day = p5.ymd(datetime.fromtimestamp(ts, timezone.utc))
            closes[day] = float(parts[4])
    return closes


def load_oi_levels():
    last = {}
    folder = os.path.join(INP, "metrics")
    names = sorted(n for n in os.listdir(folder) if n.endswith(".zip"))
    if not names:
        raise SystemExit("open-interest gap: no metrics files")
    for name in names:
        lines = p5.zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if OI_COL not in header or "create_time" not in header:
            raise SystemExit("open-interest gap: locked column %s absent in %s" % (OI_COL, header))
        ci, vi = header.index("create_time"), header.index(OI_COL)
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            day = parts[ci][:10]
            last[day] = float(parts[vi])
    return last


def oi_changes(levels):
    out = {}
    for day in sorted(levels):
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels and levels[prev] > 0:
            out[day] = levels[day] / levels[prev] - 1.0
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
    if p5.parse_ymd("2022-01-03").weekday() != 0 or p5.parse_ymd("2022-01-04").weekday() == 0:
        raise SystemExit("monday weekday")
    levels = {
        "2021-01-01": 100.0,
        "2021-01-02": 80.0,
        "2021-01-03": 80.0,
        "2021-01-05": 90.0,
        "2021-01-06": 0.0,
        "2021-01-07": 10.0,
    }
    changes = oi_changes(levels)
    if abs(changes["2021-01-02"] + 0.2) > 1e-12 or changes["2021-01-03"] != 0.0:
        raise SystemExit("oi change: %s" % changes)
    if "2021-01-01" in changes or "2021-01-05" in changes or "2021-01-07" in changes:
        raise SystemExit("oi change skipped a missing or non-positive previous level: %s" % changes)
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    monday_sha, oi_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    elif not os.path.isdir(os.path.join(INP, "metrics")):
        raise SystemExit("missing frozen inputs; run without --check first")
    btc = load_closes("BTCUSDT")
    eth = load_closes("ETHUSDT")
    btc_mon = p5.returns_between(btc, "2022-01-01", "2023-12-31")
    eth_mon = p5.returns_between(eth, "2022-01-01", "2023-12-31")
    btc_oi = p5.returns_between(btc, "2021-01-01", "2021-12-31")
    eth_oi = p5.returns_between(eth, "2021-01-01", "2021-12-31")
    monday_marked = []
    for day in p5.daterange("2022-01-01", "2023-12-31"):
        if day not in btc_mon or day not in eth_mon:
            continue
        monday_marked.append((day, p5.parse_ymd(day).weekday() == 0))
    oi_marked = p5.long_days_for(oi_changes(load_oi_levels()), "2021-01-01", "2021-12-31", 90, 17, True)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"monday_rule_sha256": monday_sha, "oi_rule_sha256": oi_sha},
        "kills": {
            "utc_monday_2022_2023": run_rule("utc_monday_2022_2023", monday_marked, btc_mon, eth_mon, 800),
            "oi_drop_bottom_quintile_2021": run_rule("oi_drop_bottom_quintile_2021", oi_marked, btc_oi, eth_oi, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass7.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
