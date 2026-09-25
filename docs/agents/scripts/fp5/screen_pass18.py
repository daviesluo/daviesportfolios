"""Six frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads the six rule texts hashed at 2026-09-25 03:07:25 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass18.json. Public archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass18.py
    python3 docs/agents/scripts/fp5/screen_pass18.py --check
"""
import hashlib, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass18")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass18.json")
SHA = {
    "trades": "2e76308852b4565c882be9780e87eb401f5dc362bcfe8c4a6832376eb0e376f3",
    "chainvol": "aa73064e10f3940b254ec3fa5edca3b0def433cbae9e6f53a2437089dd6b89d1",
    "walletvol": "09e5a8ff3f5d978a1b095b096a6b4bf3476e0626dd17149231f7a8da3dc8d4c6",
    "dollar": "c88f8df5b13d41be260594fb4ef40a0cc1924c7acc32ef402fd871e2d728e66c",
    "oil": "669e9fcd6a766d5aac4c1e5b7c260eb5ba227845b98c4da6536ef263da260d36",
    "putcall": "4f41ac0878f932f4c7a57a93039fdf989c3f4e59e64e6fd588538060e18e9337",
}
CHAIN_URL = "https://api.blockchain.info/charts/estimated-transaction-volume?format=json&timespan=all&sampled=false"
WALLET_URL = "https://api.blockchain.info/charts/my-wallet-transaction-volume?format=json&timespan=all&sampled=false"
DOLLAR_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS&cosd=1970-01-01&coed=2026-09-25"
OIL_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILWTICO&cosd=1970-01-01&coed=2026-09-25"
PC_URL = "https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/equitypc.csv"
PC_HEADER = "DATE,CALL,PUT,TOTAL,P/C Ratio"


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


def agreed_bytes(url):
    first, second = fetch_bytes(url), fetch_bytes(url)
    if first != second:
        raise SystemExit("two pulls disagree: %s" % url)
    return first


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


def load_levels(path, header, first_day, last_day):
    lines = open(path).read().splitlines()
    if not lines or lines[0] != header:
        raise SystemExit("header %s" % header)
    levels = {}
    for line in lines[1:]:
        day, cell = line.split(",")
        if day in levels:
            raise SystemExit("duplicate day %s" % day)
        levels[day] = float(cell)
    if not levels or min(levels) != first_day or max(levels) != last_day:
        raise SystemExit("archive bounds %s: %s .. %s" % (path, min(levels) if levels else None, max(levels) if levels else None))
    return levels


def chart_levels(body, unit, first_day, last_day):
    data = json.loads(body)
    if data.get("unit") != unit:
        raise SystemExit("chart unit %s" % data.get("unit"))
    levels = {}
    for row in data.get("values") or []:
        day = p5.ymd(datetime.fromtimestamp(int(row["x"]), timezone.utc))
        if row.get("y") is None:
            continue
        if day in levels:
            raise SystemExit("duplicate chart day %s" % day)
        levels[day] = float(row["y"])
    if min(levels) != first_day or max(levels) != last_day:
        raise SystemExit("chart bounds %s .. %s" % (min(levels), max(levels)))
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


def pc_levels(body):
    lines = body.decode("utf-8").splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.startswith("DATE,"):
            start = i
            break
    if start is None or lines[start] != PC_HEADER:
        raise SystemExit("put/call header")
    levels = {}
    for line in lines[start + 1:]:
        if not line.strip():
            continue
        parts = line.split(",")
        if len(parts) != 5:
            raise SystemExit("put/call columns")
        day = us_date(parts[0])
        if day in levels:
            raise SystemExit("duplicate put/call day %s" % day)
        levels[day] = float(parts[4])
    if min(levels) != "2006-11-01" or max(levels) != "2019-10-04":
        raise SystemExit("put/call bounds %s .. %s" % (min(levels), max(levels)))
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
        for ym in p5.months("2017-08", "2018-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, "1d", name)))
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), jobs))
    dump_levels(
        os.path.join(INP, "chainvol.csv"),
        "day,btc",
        chart_levels(agreed_bytes(CHAIN_URL), "BTC", "2010-08-28", "2026-09-24"),
    )
    dump_levels(
        os.path.join(INP, "walletvol.csv"),
        "day,btc",
        chart_levels(agreed_bytes(WALLET_URL), "Transaction Volume (BTC)", "2009-01-03", "2024-09-01"),
    )
    dump_levels(
        os.path.join(INP, "dollar.csv"),
        "day,index",
        fred_levels(agreed_bytes(DOLLAR_URL), "DTWEXBGS", "2006-01-02"),
    )
    dump_levels(
        os.path.join(INP, "oil.csv"),
        "day,usd",
        fred_levels(agreed_bytes(OIL_URL), "DCOILWTICO", "1986-01-02"),
    )
    dump_levels(os.path.join(INP, "putcall.csv"), "day,ratio", pc_levels(agreed_bytes(PC_URL)))


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
    if abs(changes.get("2018-01-02", 0) - 0.2) > 1e-9 or abs(changes.get("2018-01-05", 0) + 1.0) > 1e-12:
        raise SystemExit("level change: %s" % changes)
    if set(changes) != {"2018-01-02", "2018-01-05"}:
        raise SystemExit("level change skips a gap and a zero base: %s" % changes)
    if us_date("11/1/2006") != "2006-11-01" or us_date("10/04/2019") != "2019-10-04":
        raise SystemExit("us date")
    sample = pc_levels(b"preamble\nDATE,CALL,PUT,TOTAL,P/C Ratio\n11/1/2006,1,1,2,0.50\n10/04/2019,1,1,2,1.25\n")
    if abs(sample["2006-11-01"] - 0.5) > 1e-12 or abs(sample["2019-10-04"] - 1.25) > 1e-12:
        raise SystemExit("put/call column")
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def require_history(name, changes):
    prior = sum(1 for day in changes if day < "2018-01-01")
    if prior < 90:
        raise SystemExit("%s has %d changes before 2018, not 90" % (name, prior))


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    btc_first, trades = load_field(os.path.join(INP, "klines", "BTCUSDT", "1d"), 8, 9)
    _, btc_closes = load_field(os.path.join(INP, "klines", "BTCUSDT", "1d"), 4, 5)
    eth_first, eth_closes = load_field(os.path.join(INP, "klines", "ETHUSDT", "1d"), 4, 5)
    if btc_first != "2017-08-17" or eth_first != "2017-08-17":
        raise SystemExit("spot archive does not start 2017-08-17")
    chain = load_levels(os.path.join(INP, "chainvol.csv"), "day,btc", "2010-08-28", "2026-09-24")
    wallet = load_levels(os.path.join(INP, "walletvol.csv"), "day,btc", "2009-01-03", "2024-09-01")
    dollar = load_levels(os.path.join(INP, "dollar.csv"), "day,index", "2006-01-02", "2026-09-18")
    oil = load_levels(os.path.join(INP, "oil.csv"), "day,usd", "1986-01-02", "2026-09-22")
    putcall = load_levels(os.path.join(INP, "putcall.csv"), "day,ratio", "2006-11-01", "2019-10-04")
    btc = p5.returns_between(btc_closes, "2018-01-01", "2018-12-31")
    eth = p5.returns_between(eth_closes, "2018-01-01", "2018-12-31")
    series = {
        "btc_trade_count_2018": level_changes(trades),
        "chain_volume_btc_2018": level_changes(chain),
        "wallet_volume_btc_2018": level_changes(wallet),
        "broad_dollar_2018": level_changes(dollar),
        "wti_oil_2018": level_changes(oil),
        "equity_put_call_2018": level_changes(putcall),
    }
    for name, changes in series.items():
        require_history(name, changes)
    kills = {}
    for name, changes in series.items():
        marked = p5.long_days_for(changes, "2018-01-01", "2018-12-31", 90, 71, False)
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
            raise SystemExit("summary_pass18.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
