"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads trade_rule.txt and depth_rule.txt, checks the sha256 frozen before any
series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass8.json. Public Binance archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass8.py
    python3 docs/agents/scripts/fp5/screen_pass8.py --check
"""
import hashlib, io, json, os, sys, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass8")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass8.json")
DEPTH_CSV = os.path.join(INP, "bookdepth_last.csv")
TRADE_SHA = "acbb5417b54c64801105c97f907cd89001dac78036ec502708ef5816e5887b14"
DEPTH_SHA = "fa1a63d3c37f6a31045a87bde3c3d98303ae8c7420f1199dd5aa0d70bb095c68"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    trade = sha256_file(os.path.join(RULES, "trade_rule.txt"))
    depth = sha256_file(os.path.join(RULES, "depth_rule.txt"))
    if trade != TRADE_SHA or depth != DEPTH_SHA:
        raise SystemExit("rule text moved after the freeze: trade %s depth %s" % (trade, depth))
    return trade, depth


def fetch_bytes(url):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fp5-screen/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = e
            time.sleep(1.5 * (attempt + 1))
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit("fetch failed %s: %s" % (url, last))


def ensure_klines():
    jobs = []
    for sym, start, end in (
        ("BTCUSDT", "2022-09", "2023-12"),
        ("ETHUSDT", "2022-12", "2023-12"),
        ("BTCUSDT", "2023-12", "2024-12"),
        ("ETHUSDT", "2023-12", "2024-12"),
    ):
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, name)))
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


def load_trade_size():
    size = {}
    folder = os.path.join(INP, "klines", "BTCUSDT")
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in p5.zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            if len(parts) < 9:
                raise SystemExit("trade-size gap: kline has %d fields" % len(parts))
            ts = int(parts[0])
            ts = ts / 1_000_000 if ts > 10**14 else ts / 1000
            day = p5.ymd(datetime.fromtimestamp(ts, timezone.utc))
            trades = float(parts[8])
            if trades > 0:
                size[day] = float(parts[7]) / trades
    return size


def ratios_from_lines(lines):
    if not lines:
        raise SystemExit("book-depth gap: empty file")
    header = lines[0].split(",")
    for col in ("timestamp", "percentage", "notional"):
        if col not in header:
            raise SystemExit("book-depth gap: locked column %s absent in %s" % (col, header))
    ti, pi, ni = header.index("timestamp"), header.index("percentage"), header.index("notional")
    last = {}
    saw_band = False
    for line in lines[1:]:
        if not line:
            continue
        parts = line.split(",")
        pct = parts[pi]
        if pct not in ("-1", "1"):
            continue
        saw_band = True
        ts = parts[ti]
        day = ts[:10]
        rec = last.get(day)
        if rec is None or ts > rec[0]:
            rec = [ts, None, None]
            last[day] = rec
        elif ts < rec[0]:
            continue
        if pct == "-1":
            rec[1] = parts[ni]
        else:
            rec[2] = parts[ni]
    return last, saw_band


def reduce_depth_blob(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        if len(names) != 1:
            raise SystemExit("expected one member, got %s" % names)
        text = z.read(names[0]).decode("utf-8")
    return ratios_from_lines(text.splitlines())


def build_depth_csv():
    days = p5.daterange("2023-10-01", "2024-12-31")

    def one(day):
        url = p5.VISION + "futures/um/daily/bookDepth/BTCUSDT/BTCUSDT-bookDepth-%s.zip" % day
        blob = fetch_bytes(url)
        if blob is None:
            return day, None
        return day, reduce_depth_blob(blob)

    with ThreadPoolExecutor(max_workers=12) as pool:
        got = list(pool.map(one, days))
    rows = {}
    saw_band = False
    for day, parsed in got:
        if parsed is None:
            continue
        last, band = parsed
        saw_band = saw_band or band
        for d, rec in last.items():
            prev = rows.get(d)
            if prev is None or rec[0] > prev[0]:
                rows[d] = rec
    if not saw_band:
        raise SystemExit("book-depth gap: ±1 band absent")
    os.makedirs(INP, exist_ok=True)
    with open(DEPTH_CSV, "w") as f:
        f.write("day,timestamp,bid_notional,ask_notional\n")
        for day in sorted(rows):
            ts, bid, ask = rows[day]
            if bid is None or ask is None:
                continue
            if float(ask) <= 0:
                continue
            f.write("%s,%s,%s,%s\n" % (day, ts, bid, ask))


def load_depth_ratio():
    ratio = {}
    with open(DEPTH_CSV) as f:
        header = f.readline().strip().split(",")
        if header != ["day", "timestamp", "bid_notional", "ask_notional"]:
            raise SystemExit("book-depth gap: csv header %s" % header)
        for line in f:
            day, _ts, bid, ask = line.rstrip("\n").split(",")
            ask_f = float(ask)
            if ask_f <= 0:
                continue
            ratio[day] = float(bid) / ask_f
    if len(ratio) < 90:
        raise SystemExit("book-depth gap: %d printed ratios" % len(ratio))
    return ratio


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
    series = {p5.ymd(p5.parse_ymd("2024-01-01") + timedelta(days=i)): float(i) for i in range(100)}
    signal = p5.ymd(p5.parse_ymd("2024-01-01") + timedelta(days=90))
    if p5.trailing_threshold(series, signal, 90, 71) != 71.0:
        raise SystemExit("top-quintile index")
    lines = [
        "timestamp,percentage,depth,notional",
        "2024-01-01 00:00:01,-1,1,10",
        "2024-01-01 00:00:01,1,1,5",
        "2024-01-01 00:00:01,5,9,999",
        "2024-01-01 23:00:00,-1,1,30",
        "2024-01-01 23:00:00,1,1,10",
        "2024-01-02 00:00:01,-1,1,4",
        "2024-01-02 00:00:01,1,1,0",
    ]
    last, saw = ratios_from_lines(lines)
    if not saw or last["2024-01-01"] != ["2024-01-01 23:00:00", "30", "10"]:
        raise SystemExit("depth snapshot: %s" % last)
    if float(last["2024-01-02"][2]) != 0.0:
        raise SystemExit("depth zero ask")
    us = datetime.fromtimestamp(1735689600000000 / 1_000_000, timezone.utc)
    ms = datetime.fromtimestamp(1606780800000 / 1000, timezone.utc)
    if p5.ymd(us) != "2025-01-01" or p5.ymd(ms) != "2020-12-01":
        raise SystemExit("kline timestamp unit")


def main():
    check = "--check" in sys.argv
    trade_sha, depth_sha = require_rules()
    self_check()
    if not check:
        ensure_klines()
        build_depth_csv()
    elif not os.path.isfile(DEPTH_CSV):
        raise SystemExit("missing frozen inputs; run without --check first")
    btc = load_closes("BTCUSDT")
    eth = load_closes("ETHUSDT")
    btc_t = p5.returns_between(btc, "2023-01-01", "2023-12-31")
    eth_t = p5.returns_between(eth, "2023-01-01", "2023-12-31")
    btc_d = p5.returns_between(btc, "2024-01-01", "2024-12-31")
    eth_d = p5.returns_between(eth, "2024-01-01", "2024-12-31")
    trade_marked = p5.long_days_for(load_trade_size(), "2023-01-01", "2023-12-31", 90, 71, False)
    depth_marked = p5.long_days_for(load_depth_ratio(), "2024-01-01", "2024-12-31", 90, 71, False)
    summary = {
        "reached_preregistration": False,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {"trade_rule_sha256": trade_sha, "depth_rule_sha256": depth_sha},
        "kills": {
            "large_avg_trade_2023": run_rule("large_avg_trade_2023", trade_marked, btc_t, eth_t, 400),
            "bid_depth_top_quintile_2024": run_rule("bid_depth_top_quintile_2024", depth_marked, btc_d, eth_d, 400),
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass8.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
