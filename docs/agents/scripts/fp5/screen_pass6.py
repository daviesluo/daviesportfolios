"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads vix_rule.txt and etf_rule.txt, checks the sha256 frozen before any
series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass6.json. Public pages only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass6.py
    python3 docs/agents/scripts/fp5/screen_pass6.py --check
"""
import hashlib, json, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass6")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass6.json")
VIX_SHA = "f2a128d904e21563b4a06af7df493f2b2cc554f5b767c7ae217bd1c131565ede"
ETF_SHA = "097ba003a9bc896a189bd2460693ff9a2a0d6568fc57252b984747ba67dcd847"
MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    vix = sha256_file(os.path.join(RULES, "vix_rule.txt"))
    etf = sha256_file(os.path.join(RULES, "etf_rule.txt"))
    if vix != VIX_SHA or etf != ETF_SHA:
        raise SystemExit("rule text moved after the freeze: vix %s etf %s" % (vix, etf))
    return vix, etf


def ensure_inputs():
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in p5.months("2018-12", "2020-12") + p5.months("2024-12", "2025-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            p5.fetch(url, os.path.join(INP, "klines", sym, name))
    start = int(datetime(2017, 12, 1, tzinfo=timezone.utc).timestamp())
    end = int(datetime(2021, 1, 5, tzinfo=timezone.utc).timestamp())
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%%5EVIX?interval=1d&period1=%d&period2=%d" % (start, end)
    p5.fetch(url, os.path.join(INP, "vix.json"))
    p5.fetch("https://farside.co.uk/bitcoin-etf-flow-all-data/", os.path.join(INP, "farside.html"))


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
            # Binance daily files are milliseconds through 2024 and microseconds in 2025.
            ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
            day = p5.ymd(datetime.fromtimestamp(ts, timezone.utc))
            closes[day] = float(parts[4])
    return closes


def load_vix():
    with open(os.path.join(INP, "vix.json")) as f:
        data = json.load(f)
    result = data["chart"]["result"][0]
    closes = result["indicators"]["quote"][0]["close"]
    out = {}
    for ts, close in zip(result["timestamp"], closes):
        if close is None:
            continue
        day = p5.ymd(datetime.fromtimestamp(ts, timezone.utc))
        out[day] = float(close)
    return out


def parse_flow(text):
    if text is None:
        return None
    raw = text.strip()
    if raw in ("", "-", "—", "–"):
        return None
    neg = raw.startswith("(") and raw.endswith(")")
    raw = raw.strip("()")
    raw = raw.replace(",", "")
    try:
        value = float(raw)
    except ValueError:
        return None
    return -value if neg else value


def load_etf_total():
    with open(os.path.join(INP, "farside.html")) as f:
        html = f.read()
    tables = re.findall(r"<table[\s\S]*?</table>", html, re.I)
    if not tables:
        raise SystemExit("farside page has no table")
    table = max(tables, key=len)
    out = {}
    for row in re.findall(r"<tr[\s\S]*?</tr>", table, re.I):
        cells = re.findall(r"<td[\s\S]*?</td>", row, re.I)
        if len(cells) < 2:
            continue
        date_text = re.sub(r"<[^>]+>", " ", cells[0])
        date_text = re.sub(r"&nbsp;", " ", date_text)
        date_text = re.sub(r"\s+", " ", date_text).strip()
        match = re.match(r"(\d{1,2}) ([A-Za-z]{3}) (\d{4})$", date_text)
        if not match or match.group(2) not in MONTHS:
            continue
        day = "%04d-%02d-%02d" % (int(match.group(3)), MONTHS[match.group(2)], int(match.group(1)))
        total_html = cells[-1]
        neg = "redFont" in total_html
        total_text = re.sub(r"<[^>]+>", " ", total_html)
        total_text = re.sub(r"&nbsp;", " ", total_text)
        total_text = re.sub(r"\s+", " ", total_text).strip()
        value = parse_flow(total_text)
        if value is None:
            continue
        if neg and value > 0:
            value = -value
        out[day] = value
    if len(out) < 200:
        raise SystemExit("farside total column parsed %d sessions" % len(out))
    return out


def median_threshold(series, day):
    prev = [d for d in series if d < day]
    if len(prev) < 20:
        return None
    chunk = sorted(series[d] for d in prev[-20:])
    return (chunk[9] + chunk[10]) / 2.0


def flags_for(series, start, end, take_fn):
    marked = []
    for day in p5.daterange(start, end):
        signal = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if signal not in series:
            continue
        thresh = take_fn(series, signal)
        if thresh is None:
            continue
        marked.append((day, series[signal] > thresh))
    return marked


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
    series = {p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=i)): float(i + 1) for i in range(40)}
    signal = p5.ymd(p5.parse_ymd("2020-01-01") + timedelta(days=20))
    if median_threshold(series, signal) != 10.5:
        raise SystemExit("median threshold")
    if parse_flow("(12.5)") != -12.5 or parse_flow("3.0") != 3.0 or parse_flow("-") is not None:
        raise SystemExit("flow sign")
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    vix_sha, etf_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    elif not os.path.isfile(os.path.join(INP, "vix.json")):
        raise SystemExit("missing frozen inputs; run without --check first")
    btc = load_closes("BTCUSDT")
    eth = load_closes("ETHUSDT")
    vix = load_vix()
    etf = load_etf_total()
    btc_v = p5.returns_between(btc, "2019-01-01", "2020-12-31")
    eth_v = p5.returns_between(eth, "2019-01-01", "2020-12-31")
    btc_e = p5.returns_between(btc, "2025-01-01", "2025-12-31")
    eth_e = p5.returns_between(eth, "2025-01-01", "2025-12-31")
    vix_marked = flags_for(vix, "2019-01-01", "2020-12-31", lambda series, day: p5.trailing_threshold(series, day, 252, 201))
    etf_marked = flags_for(etf, "2025-01-01", "2025-12-31", median_threshold)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"vix_rule_sha256": vix_sha, "etf_rule_sha256": etf_sha},
        "kills": {
            "vix_above_p80_2019_2020": run_rule("vix_above_p80_2019_2020", vix_marked, btc_v, eth_v, 800),
            "etf_net_creation_above_median_2025": run_rule("etf_net_creation_above_median_2025", etf_marked, btc_e, eth_e, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass6.json does not match a fresh run")
        return
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
