"""Eight frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads the eight rule texts hashed at 2026-09-25 03:17:32 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass19.json. Public archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass19.py
    python3 docs/agents/scripts/fp5/screen_pass19.py --check
"""
import hashlib, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass19")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass19.json")
SHA = {
    "usdcvol": "719af9ee92744428b67f24b46c572a4b87b5708ee447ca1c91a644ea3b32c502",
    "skew": "8d1bb481290d6379b92f3aad36e7668b6930fcf3631ca606cf2b65824b77abca",
    "gas": "5d860e2cdb031066b7130bf8ef5cd39ba74e46dcca753200bc218bc46043a2e4",
    "epu": "ffc895b35c8a2027a5d89de992e8252ce4626477668db238affc50295eae25ee",
    "ted": "970e288afe70fe53798cc89335c64d8b97a499ecdb2c310df8ad025e33d8cc71",
    "rrp": "3df4bf6e45be42c9d837e7e1352bbf674a0b9bea0cfec9108012d69d7c5439ee",
    "corr": "eef1fdd4e256980f41e79936546d2bd79e244d02087196240494937c89c5832e",
    "defi": "40b1f8b1f5ed0e1dcc243a5fbb0c5667b4b10d25f1607c082203cd807f181360",
}
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=1970-01-01&coed=2026-09-25"
SKEW_URL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/SKEW_History.csv"
CORR_URL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/COR3M_History.csv"


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


def fetch_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fp5-screen/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def agreed(url, parse):
    for _ in range(2):
        first, second = parse(fetch_bytes(url)), parse(fetch_bytes(url))
        if first == second:
            return first
    raise SystemExit("two pulls disagree: %s" % url)


def us_date(cell):
    month, day, year = cell.split("/")
    return "%04d-%02d-%02d" % (int(year), int(month), int(day))


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


def fred_levels(body, series, first_day):
    lines = body.decode("utf-8").splitlines()
    if not lines or lines[0] != "observation_date,%s" % series:
        raise SystemExit("fred header %s" % (lines[0] if lines else ""))
    if len(lines) < 2 or lines[1].split(",")[0] != first_day:
        raise SystemExit("fred does not start %s" % first_day)
    levels = {}
    for line in lines[1:]:
        day, cell = line.split(",")
        if cell in ("", "."):
            continue
        level = float(cell)
        if level > 0:
            levels[day] = level
    return levels


def dated_levels(body, header, value_at):
    lines = body.decode("utf-8").splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.startswith("DATE,"):
            start = i
            break
    if start is None or lines[start] != header:
        raise SystemExit("cboe header %s" % header)
    levels = {}
    for line in lines[start + 1:]:
        if not line.strip():
            continue
        parts = line.split(",")
        day = us_date(parts[0])
        if day in levels:
            raise SystemExit("duplicate cboe day %s" % day)
        levels[day] = float(parts[value_at])
    return levels


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
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2017-08", "2021-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "spot", sym, "1d", name)))
    for ym in p5.months("2018-12", "2020-12"):
        name = "BTCUSDC-1d-%s.zip" % ym
        url = p5.VISION + "spot/monthly/klines/BTCUSDC/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "spot", "BTCUSDC", "1d", name)))
    for ym in p5.months("2020-08", "2021-12"):
        name = "DEFIUSDT-1d-%s.zip" % ym
        url = p5.VISION + "futures/um/monthly/indexPriceKlines/DEFIUSDT/1d/" + name
        jobs.append((url, os.path.join(INP, "klines", "index", "DEFIUSDT", "1d", name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    dump_levels(os.path.join(INP, "gas.csv"), "day,usd", agreed(FRED % "DHHNGSP", lambda b: fred_levels(b, "DHHNGSP", "1997-01-07")))
    dump_levels(os.path.join(INP, "epu.csv"), "day,index", agreed(FRED % "USEPUINDXD", lambda b: fred_levels(b, "USEPUINDXD", "1985-01-01")))
    dump_levels(os.path.join(INP, "ted.csv"), "day,spread", agreed(FRED % "TEDRATE", lambda b: fred_levels(b, "TEDRATE", "1986-01-02")))
    dump_levels(os.path.join(INP, "rrp.csv"), "day,usd_bn", agreed(FRED % "RRPONTSYD", lambda b: fred_levels(b, "RRPONTSYD", "2003-02-07")))
    dump_levels(os.path.join(INP, "skew.csv"), "day,index", agreed(SKEW_URL, lambda b: dated_levels(b, "DATE,SKEW", 1)))
    dump_levels(os.path.join(INP, "corr.csv"), "day,close", agreed(CORR_URL, lambda b: dated_levels(b, "DATE,OPEN,HIGH,LOW,CLOSE", 4)))


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
    changes = level_changes({"2018-01-01": 10.0, "2018-01-02": 12.0, "2018-01-04": 15.0, "2018-01-05": 0.0, "2018-01-06": 1.0})
    if abs(changes.get("2018-01-02", 0) - 0.2) > 1e-9 or set(changes) != {"2018-01-02", "2018-01-05"}:
        raise SystemExit("level change: %s" % changes)
    ratios = volume_ratios({"2020-01-01": 0.0, "2020-01-02": 5.0}, {"2020-01-01": 10.0, "2020-01-02": 0.0})
    if ratios.get("2020-01-01") != 0.0 or "2020-01-02" in ratios:
        raise SystemExit("usdc ratio: %s" % ratios)
    if us_date("01/02/1990") != "1990-01-02" or us_date("1/3/2006") != "2006-01-03":
        raise SystemExit("us date")
    sample = dated_levels(b"DATE,OPEN,HIGH,LOW,CLOSE\n1/3/2006,1,3,0.5,2\n", "DATE,OPEN,HIGH,LOW,CLOSE", 4)
    if abs(sample["2006-01-03"] - 2.0) > 1e-12:
        raise SystemExit("corr close column")
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def require_history(name, changes, day):
    prior = sum(1 for item in changes if item < day)
    if prior < 90:
        raise SystemExit("%s has %d changes before %s" % (name, prior, day))


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    btc_first, btc_quote = load_field(os.path.join(INP, "klines", "spot", "BTCUSDT", "1d"), 7, 8)
    _, btc_closes = load_field(os.path.join(INP, "klines", "spot", "BTCUSDT", "1d"), 4, 5)
    eth_first, eth_closes = load_field(os.path.join(INP, "klines", "spot", "ETHUSDT", "1d"), 4, 5)
    usdc_first, usdc_quote = load_field(os.path.join(INP, "klines", "spot", "BTCUSDC", "1d"), 7, 8)
    defi_first, defi_close = load_field(os.path.join(INP, "klines", "index", "DEFIUSDT", "1d"), 4, 5)
    if btc_first != "2017-08-17" or eth_first != "2017-08-17":
        raise SystemExit("spot archive does not start 2017-08-17")
    if usdc_first != "2018-12-15":
        raise SystemExit("btcusdc does not start 2018-12-15")
    if defi_first != "2020-08-28":
        raise SystemExit("defi index does not start 2020-08-28")
    if "2020-12-31" not in usdc_quote or "2021-12-31" not in defi_close:
        raise SystemExit("screen year is not covered")
    gas = load_levels(os.path.join(INP, "gas.csv"), "day,usd", "1997-01-07", cover="2018-12-31")
    epu = load_levels(os.path.join(INP, "epu.csv"), "day,index", "1985-01-01", cover="2018-12-31")
    ted = load_levels(os.path.join(INP, "ted.csv"), "day,spread", "1986-01-02", last_day="2022-01-21")
    rrp = load_levels(os.path.join(INP, "rrp.csv"), "day,usd_bn", "2003-02-07", cover="2018-12-31")
    skew = load_levels(os.path.join(INP, "skew.csv"), "day,index", "1990-01-02", cover="2018-12-31")
    corr = load_levels(os.path.join(INP, "corr.csv"), "day,close", "2006-01-03", cover="2018-12-31")
    if "2018-01-06" not in epu:
        raise SystemExit("policy uncertainty dropped a Saturday")
    for name, levels in (("gas", gas), ("ted", ted), ("rrp", rrp), ("skew", skew), ("corr", corr)):
        if "2018-01-06" in levels:
            raise SystemExit("%s printed a Saturday" % name)
    btc_2018 = p5.returns_between(btc_closes, "2018-01-01", "2018-12-31")
    eth_2018 = p5.returns_between(eth_closes, "2018-01-01", "2018-12-31")
    btc_2020 = p5.returns_between(btc_closes, "2020-01-01", "2020-12-31")
    eth_2020 = p5.returns_between(eth_closes, "2020-01-01", "2020-12-31")
    btc_2021 = p5.returns_between(btc_closes, "2021-01-01", "2021-12-31")
    eth_2021 = p5.returns_between(eth_closes, "2021-01-01", "2021-12-31")
    specs = (
        ("usdc_quote_ratio_2020", level_changes(volume_ratios(usdc_quote, btc_quote)), "2020-01-01", "2020-12-31", btc_2020, eth_2020),
        ("cboe_skew_2018", level_changes(skew), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("henry_hub_2018", level_changes(gas), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("policy_uncertainty_2018", level_changes(epu), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("ted_spread_2018", level_changes(ted), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("reverse_repo_2018", level_changes(rrp), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("implied_corr_2018", level_changes(corr), "2018-01-01", "2018-12-31", btc_2018, eth_2018),
        ("defi_index_2021", level_changes(defi_close), "2021-01-01", "2021-12-31", btc_2021, eth_2021),
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
            raise SystemExit("summary_pass19.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
