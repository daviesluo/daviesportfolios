"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads cmvol_rule.txt and pairvol_rule.txt, checks the sha256 frozen before
any series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass17.json. Public Binance archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass17.py
    python3 docs/agents/scripts/fp5/screen_pass17.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass17")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass17.json")
CMVOL_SHA = "4a3c8777c418c9f7f6da6fa5edff28ea161d2d597b935c32ec6c2c0dca1d991f"
PAIRVOL_SHA = "207fabcf3865fce002722935e07c4669f9df10522c892f236d27e9a64883cf84"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    cmvol = sha256_file(os.path.join(RULES, "cmvol_rule.txt"))
    pairvol = sha256_file(os.path.join(RULES, "pairvol_rule.txt"))
    if cmvol != CMVOL_SHA or pairvol != PAIRVOL_SHA:
        raise SystemExit("rule text moved after the freeze: cmvol %s pairvol %s" % (cmvol, pairvol))
    return cmvol, pairvol


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
    first = None
    for parts in iter_kline_rows(folder):
        if len(parts) < need:
            raise SystemExit("kline gap: field %d absent (%d fields)" % (need, len(parts)))
        day = p5.ymd(stamp_of(int(parts[0])))
        if day in values:
            raise SystemExit("duplicate day %s" % day)
        values[day] = float(parts[index])
        if first is None or day < first:
            first = day
    return first, values


def volume_ratios(numer, denom):
    ratios = {}
    for day, num in numer.items():
        if day in denom and num >= 0 and denom[day] > 0:
            ratios[day] = num / denom[day]
    return ratios


def level_changes(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels and levels[prev] > 0:
            changes[day] = level / levels[prev] - 1.0
    return changes


def ensure_inputs():
    jobs = []
    for ym in p5.months("2020-08", "2021-12"):
        name = "BTCUSD_PERP-1d-%s.zip" % ym
        url = p5.VISION + "futures/cm/monthly/klines/BTCUSD_PERP/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "futures", "cm", "BTCUSD_PERP", "1d", name)))
        name = "BTCUSDT-1d-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/klines/BTCUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "futures", "um", "BTCUSDT", "1d", name)))
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2017-08", "2018-12") + p5.months("2020-12", "2021-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
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
    ratios = volume_ratios(
        {"2020-08-11": 0.0, "2020-08-12": 10.0, "2020-08-13": 5.0, "2021-01-01": 10.0, "2021-01-02": 15.0},
        {"2020-08-11": 20.0, "2020-08-12": 10.0, "2020-08-13": 0.0, "2021-01-01": 10.0, "2021-01-02": 10.0},
    )
    if ratios.get("2020-08-11") != 0.0 or abs(ratios.get("2020-08-12", 0) - 1.0) > 1e-12:
        raise SystemExit("zero coin volume is a level: %s" % ratios)
    if "2020-08-13" in ratios or abs(ratios["2021-01-02"] - 1.5) > 1e-12:
        raise SystemExit("volume ratio: %s" % ratios)
    changes = level_changes({"2018-01-01": 1.0, "2018-01-02": 1.5, "2018-01-04": 3.0, "2020-08-11": 0.0, "2020-08-12": 1.0})
    if abs(changes.get("2018-01-02", 0) - 0.5) > 1e-12 or set(changes) != {"2018-01-02"}:
        raise SystemExit("ratio change skips a gap and a zero base: %s" % changes)
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    cmvol_sha, pairvol_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    cm_first, cm_vol = load_field(os.path.join(INP, "klines", "futures", "cm", "BTCUSD_PERP", "1d"), 7, 8)
    um_first, um_vol = load_field(os.path.join(INP, "klines", "futures", "um", "BTCUSDT", "1d"), 5, 6)
    btc_first, btc_quote = load_field(os.path.join(INP, "klines", "spot", "BTCUSDT", "1d"), 7, 8)
    eth_first, eth_quote = load_field(os.path.join(INP, "klines", "spot", "ETHUSDT", "1d"), 7, 8)
    _, btc_closes = load_field(os.path.join(INP, "klines", "spot", "BTCUSDT", "1d"), 4, 5)
    _, eth_closes = load_field(os.path.join(INP, "klines", "spot", "ETHUSDT", "1d"), 4, 5)
    if cm_first != "2020-08-11":
        raise SystemExit("coin-m archive does not start 2020-08-11")
    if um_first != "2020-08-01":
        raise SystemExit("usdt-m archive does not start 2020-08-01")
    if btc_first != "2017-08-17" or eth_first != "2017-08-17":
        raise SystemExit("spot archive does not start 2017-08-17")
    if "2021-12-31" not in btc_closes or "2021-12-31" not in eth_closes:
        raise SystemExit("spot closes do not cover 2021-12-31")
    if "2018-12-31" not in btc_closes or "2018-12-31" not in eth_closes:
        raise SystemExit("spot closes do not cover 2018-12-31")
    cm_marked = p5.long_days_for(
        level_changes(volume_ratios(cm_vol, um_vol)), "2021-01-01", "2021-12-31", 90, 71, False
    )
    pair_marked = p5.long_days_for(
        level_changes(volume_ratios(eth_quote, btc_quote)), "2018-01-01", "2018-12-31", 90, 71, False
    )
    btc_2021 = p5.returns_between(btc_closes, "2021-01-01", "2021-12-31")
    eth_2021 = p5.returns_between(eth_closes, "2021-01-01", "2021-12-31")
    btc_2018 = p5.returns_between(btc_closes, "2018-01-01", "2018-12-31")
    eth_2018 = p5.returns_between(eth_closes, "2018-01-01", "2018-12-31")
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"cmvol_rule_sha256": cmvol_sha, "pairvol_rule_sha256": pairvol_sha},
        "kills": {
            "cm_volume_ratio_2021": run_rule("cm_volume_ratio_2021", cm_marked, btc_2021, eth_2021, 400),
            "eth_btc_quote_2018": run_rule("eth_btc_quote_2018", pair_marked, btc_2018, eth_2018, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass17.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
