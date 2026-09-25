"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads wbtc_rule.txt and block_rule.txt, checks the sha256 frozen before any
series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass13.json. Public DefiLlama, Blockchain.com
and Binance archives only. Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass13.py
    python3 docs/agents/scripts/fp5/screen_pass13.py --check
"""
import hashlib, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass13")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass13.json")
WBTC_SHA = "33536e4448482bee4c793c2ff676eef0a28ba6812e15cb9f6ed46088a18610dd"
BLOCK_SHA = "0260e15cd49e45c3553aa197a6bf443d27077fa65939757a29a42af9978c0a3b"
WBTC_URL = "https://api.llama.fi/protocol/wbtc"
BLOCK_URL = "https://api.blockchain.info/charts/avg-block-size?format=json&timespan=all&sampled=false"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    wbtc = sha256_file(os.path.join(RULES, "wbtc_rule.txt"))
    block = sha256_file(os.path.join(RULES, "block_rule.txt"))
    if wbtc != WBTC_SHA or block != BLOCK_SHA:
        raise SystemExit("rule text moved after the freeze: wbtc %s block %s" % (wbtc, block))
    return wbtc, block


def read_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fp5-screen/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def wbtc_amount(row):
    tokens = row.get("tokens")
    if not isinstance(tokens, dict) or "WBTC" not in tokens:
        return None
    return float(tokens["WBTC"])


def write_levels(dest, header, rows):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    lines = [header]
    for day, level in rows:
        lines.append("%s,%.10f" % (day, level))
    tmp = dest + ".part"
    with open(tmp, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, dest)


def fetch_wbtc(dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    payload = read_json(WBTC_URL)
    if "tokens" not in payload or "tokensInUsd" not in payload:
        raise SystemExit("wbtc columns absent")
    levels = {}
    for row in payload["tokens"]:
        amount = wbtc_amount(row)
        if amount is None or amount <= 0 or "date" not in row:
            continue
        day = p5.ymd(datetime.fromtimestamp(int(row["date"]), timezone.utc))
        levels[day] = amount
    if not levels or min(levels) != "2019-01-31":
        raise SystemExit("wbtc archive does not start 2019-01-31")
    if "2020-12-31" not in levels:
        raise SystemExit("wbtc archive does not cover 2020-12-31")
    write_levels(dest, "day,wbtc", sorted(levels.items()))


def fetch_blocks(dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    payload = read_json(BLOCK_URL)
    if payload.get("unit") != "MB" or payload.get("name") != "Average Block Size":
        raise SystemExit("block chart is not average size in MB")
    levels = {}
    for point in payload.get("values") or []:
        if "x" not in point or "y" not in point:
            raise SystemExit("block point missing x or y")
        size = float(point["y"])
        if size <= 0:
            continue
        day = p5.ymd(datetime.fromtimestamp(int(point["x"]), timezone.utc))
        levels[day] = size
    if not levels or min(levels) != "2009-01-17":
        raise SystemExit("block archive does not start 2009-01-17")
    if "2018-12-31" not in levels:
        raise SystemExit("block archive does not cover 2018-12-31")
    write_levels(dest, "day,mb", sorted(levels.items()))


def ensure_inputs():
    jobs = []
    for sym, start, end in (("BTCUSDT", "2017-12", "2018-12"), ("ETHUSDT", "2017-12", "2018-12"),
                            ("BTCUSDT", "2019-12", "2020-12"), ("ETHUSDT", "2019-12", "2020-12")):
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    fetch_wbtc(os.path.join(INP, "wbtc.csv"))
    fetch_blocks(os.path.join(INP, "blocksize.csv"))


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
    if wbtc_amount({"date": 1548892800, "tokens": {"WBTC": 1.5}}) != 1.5:
        raise SystemExit("wbtc token key")
    if wbtc_amount({"date": 1548892800, "tokensInUsd": {"WBTC": 9.0}}) is not None:
        raise SystemExit("wbtc dollar column was accepted")
    if p5.ymd(datetime.fromtimestamp(1548892800, timezone.utc)) != "2019-01-31":
        raise SystemExit("wbtc date")
    changes = level_changes({"2018-01-01": 1.0, "2018-01-02": 1.1, "2018-01-04": 1.2, "2018-02-01": 0.0, "2018-02-02": 1.3})
    if abs(changes.get("2018-01-02", 0) - 0.1) > 1e-12 or set(changes) != {"2018-01-02"}:
        raise SystemExit("level change: %s" % changes)
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    wbtc_sha, block_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    elif not os.path.isfile(os.path.join(INP, "wbtc.csv")) or not os.path.isfile(os.path.join(INP, "blocksize.csv")):
        raise SystemExit("missing frozen inputs; run without --check first")
    btc = load_closes(os.path.join(INP, "klines", "BTCUSDT"))
    eth = load_closes(os.path.join(INP, "klines", "ETHUSDT"))
    btc_w = p5.returns_between(btc, "2020-01-01", "2020-12-31")
    eth_w = p5.returns_between(eth, "2020-01-01", "2020-12-31")
    btc_b = p5.returns_between(btc, "2018-01-01", "2018-12-31")
    eth_b = p5.returns_between(eth, "2018-01-01", "2018-12-31")
    wbtc = level_changes(load_series(os.path.join(INP, "wbtc.csv"), "day,wbtc", "2019-01-31"))
    block = level_changes(load_series(os.path.join(INP, "blocksize.csv"), "day,mb", "2009-01-17"))
    wbtc_marked = p5.long_days_for(wbtc, "2020-01-01", "2020-12-31", 90, 71, False)
    block_marked = p5.long_days_for(block, "2018-01-01", "2018-12-31", 90, 71, False)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"wbtc_rule_sha256": wbtc_sha, "block_rule_sha256": block_sha},
        "kills": {
            "wbtc_mint_2020": run_rule("wbtc_mint_2020", wbtc_marked, btc_w, eth_w, 400),
            "block_size_2018": run_rule("block_size_2018", block_marked, btc_b, eth_b, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass13.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
