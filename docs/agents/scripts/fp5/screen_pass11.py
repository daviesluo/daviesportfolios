"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads usdc_rule.txt and basis_rule.txt, checks the sha256 frozen before any
series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass11.json. Public Binance archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass11.py
    python3 docs/agents/scripts/fp5/screen_pass11.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass11")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass11.json")
USDC_SHA = "7ba2d139afc46adc47ec02b4022ce9a2a36eab03804190050fde9252ab8e0880"
BASIS_SHA = "d9e8798327f9c8790688c4521d60e0b44184504c87ac1d5c741d7ce666aee2f1"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    usdc = sha256_file(os.path.join(RULES, "usdc_rule.txt"))
    basis = sha256_file(os.path.join(RULES, "basis_rule.txt"))
    if usdc != USDC_SHA or basis != BASIS_SHA:
        raise SystemExit("rule text moved after the freeze: usdc %s basis %s" % (usdc, basis))
    return usdc, basis


def ensure_inputs():
    jobs = []
    spot = (
        ("USDCUSDT", "2019-09", "2020-12"),
        ("BTCUSDT", "2019-12", "2021-12"),
        ("ETHUSDT", "2019-12", "2021-12"),
    )
    for sym, start, end in spot:
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, name)))
    for ym in p5.months("2020-08", "2021-12"):
        name = "BTCUSDT-1d-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/klines/BTCUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "um", name)))
        name = "BTCUSD_PERP-1d-%s.zip" % ym
        url = p5.VISION + "futures/cm/monthly/klines/BTCUSD_PERP/1d/" + name
        jobs.append((url, os.path.join(INP, "cm", name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))


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


def basis_ratios(coin, linear):
    ratios = {}
    for day, close in coin.items():
        if day in linear and close > 0 and linear[day] > 0:
            ratios[day] = close / linear[day]
    return ratios


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
    changes = level_changes({"2020-01-01": 1.0, "2020-01-02": 1.01, "2020-01-04": 1.02})
    if abs(changes.get("2020-01-02", 0) - 0.01) > 1e-12 or len(changes) != 1:
        raise SystemExit("close change: %s" % changes)
    ratios = basis_ratios({"2021-01-01": 100.0, "2021-01-02": 110.0}, {"2021-01-01": 50.0, "2021-01-02": 50.0})
    if abs(ratios["2021-01-01"] - 2.0) > 1e-12 or abs(ratios["2021-01-02"] - 2.2) > 1e-12:
        raise SystemExit("basis ratio: %s" % ratios)
    jumped = level_changes(ratios)
    if abs(jumped["2021-01-02"] - 0.1) > 1e-12:
        raise SystemExit("basis change: %s" % jumped)
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    usdc_sha, basis_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    elif not os.path.isdir(os.path.join(INP, "cm")):
        raise SystemExit("missing frozen inputs; run without --check first")
    btc = load_closes(os.path.join(INP, "klines", "BTCUSDT"))
    eth = load_closes(os.path.join(INP, "klines", "ETHUSDT"))
    btc_u = p5.returns_between(btc, "2020-01-01", "2020-12-31")
    eth_u = p5.returns_between(eth, "2020-01-01", "2020-12-31")
    btc_b = p5.returns_between(btc, "2021-01-01", "2021-12-31")
    eth_b = p5.returns_between(eth, "2021-01-01", "2021-12-31")
    usdc = level_changes(load_closes(os.path.join(INP, "klines", "USDCUSDT")))
    basis = level_changes(basis_ratios(
        load_closes(os.path.join(INP, "cm")),
        load_closes(os.path.join(INP, "um")),
    ))
    usdc_marked = p5.long_days_for(usdc, "2020-01-01", "2020-12-31", 90, 71, False)
    basis_marked = p5.long_days_for(basis, "2021-01-01", "2021-12-31", 90, 71, False)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"usdc_rule_sha256": usdc_sha, "basis_rule_sha256": basis_sha},
        "kills": {
            "usdc_richening_2020": run_rule("usdc_richening_2020", usdc_marked, btc_u, eth_u, 400),
            "coin_m_richening_2021": run_rule("coin_m_richening_2021", basis_marked, btc_b, eth_b, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass11.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
