"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads mix_rule.txt and split_rule.txt, checks the sha256 frozen before any
series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass9.json. Public Binance archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass9.py
    python3 docs/agents/scripts/fp5/screen_pass9.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass9")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass9.json")
MIX_SHA = "da6fdaa337fa174f7f26131064fad2d81f69b4e36df85537ebdf29fb9d8b9df8"
SPLIT_SHA = "821f5cdb732a79b7f8f7a37dc274d3bcf1d7c8d7c180d39cb7d237d8eef7697e"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    mix = sha256_file(os.path.join(RULES, "mix_rule.txt"))
    split = sha256_file(os.path.join(RULES, "split_rule.txt"))
    if mix != MIX_SHA or split != SPLIT_SHA:
        raise SystemExit("rule text moved after the freeze: mix %s split %s" % (mix, split))
    return mix, split


def ensure_inputs():
    jobs = []
    for sym, start, end in (
        ("BTCUSDT", "2020-01", "2022-12"),
        ("ETHUSDT", "2020-12", "2022-12"),
    ):
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, name)))
    for ym in p5.months("2020-01", "2021-12"):
        name = "BTCUSDT-1d-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/klines/BTCUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "futures", name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))


def day_of(ts):
    ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
    return p5.ymd(datetime.fromtimestamp(ts, timezone.utc))


def load_field(folder, index):
    out = {}
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            if len(parts) <= index:
                raise SystemExit("kline gap: field %d absent (%d fields)" % (index + 1, len(parts)))
            out[day_of(int(parts[0]))] = float(parts[index])
    return out


def load_closes(sym):
    return load_field(os.path.join(INP, "klines", sym), 4)


def ratio_changes(spot, perp):
    ratios = {}
    for day, quote in spot.items():
        if day in perp and quote > 0 and perp[day] > 0:
            ratios[day] = quote / perp[day]
    changes = {}
    for day, ratio in ratios.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in ratios and ratios[prev] > 0:
            changes[day] = ratio / ratios[prev] - 1.0
    return changes


def divergences(btc, eth):
    out = {}
    for day in btc:
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if day in eth and prev in btc and prev in eth and btc[prev] > 0 and eth[prev] > 0:
            btc_ret = btc[day] / btc[prev] - 1.0
            eth_ret = eth[day] / eth[prev] - 1.0
            out[day] = abs(btc_ret - eth_ret)
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
    series = {p5.ymd(p5.parse_ymd("2021-01-01") + timedelta(days=i)): float(i) for i in range(100)}
    signal = p5.ymd(p5.parse_ymd("2021-01-01") + timedelta(days=90))
    if p5.trailing_threshold(series, signal, 90, 71) != 71.0:
        raise SystemExit("top-quintile index")
    changes = ratio_changes(
        {"2021-01-01": 10.0, "2021-01-02": 30.0, "2021-01-03": 0.0},
        {"2021-01-01": 5.0, "2021-01-02": 10.0, "2021-01-04": 2.0},
    )
    if abs(changes["2021-01-02"] - 0.5) > 1e-12 or len(changes) != 1:
        raise SystemExit("volume-mix change: %s" % changes)
    closes_btc = {"2022-01-01": 100.0, "2022-01-02": 110.0, "2022-01-03": 110.0}
    closes_eth = {"2022-01-01": 50.0, "2022-01-02": 50.0, "2022-01-03": 45.0}
    gaps = divergences(closes_btc, closes_eth)
    if abs(gaps["2022-01-02"] - 0.10) > 1e-12 or abs(gaps["2022-01-03"] - 0.10) > 1e-12:
        raise SystemExit("divergence: %s" % gaps)
    if "2022-01-01" in gaps:
        raise SystemExit("divergence without a previous close")
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    mix_sha, split_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    elif not os.path.isdir(os.path.join(INP, "futures")):
        raise SystemExit("missing frozen inputs; run without --check first")
    btc = load_closes("BTCUSDT")
    eth = load_closes("ETHUSDT")
    btc_m = p5.returns_between(btc, "2021-01-01", "2021-12-31")
    eth_m = p5.returns_between(eth, "2021-01-01", "2021-12-31")
    btc_s = p5.returns_between(btc, "2022-01-01", "2022-12-31")
    eth_s = p5.returns_between(eth, "2022-01-01", "2022-12-31")
    mix = ratio_changes(
        load_field(os.path.join(INP, "klines", "BTCUSDT"), 7),
        load_field(os.path.join(INP, "futures"), 7),
    )
    split = divergences(btc, eth)
    mix_marked = p5.long_days_for(mix, "2021-01-01", "2021-12-31", 90, 71, False)
    split_marked = p5.long_days_for(split, "2022-01-01", "2022-12-31", 90, 71, False)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"mix_rule_sha256": mix_sha, "split_rule_sha256": split_sha},
        "kills": {
            "spot_perp_volume_jump_2021": run_rule("spot_perp_volume_jump_2021", mix_marked, btc_m, eth_m, 400),
            "btc_eth_divergence_2022": run_rule("btc_eth_divergence_2022", split_marked, btc_s, eth_s, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass9.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
