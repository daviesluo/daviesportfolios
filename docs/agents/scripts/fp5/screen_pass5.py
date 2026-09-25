"""Two frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads docs/agents/scripts/fp5/funding_rule.txt and taker_rule.txt, checks the
sha256 frozen before any series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass5.json. Public Binance archives only.
Nothing here places an order or reads a key.

    python3 docs/agents/scripts/fp5/screen_pass5.py
    python3 docs/agents/scripts/fp5/screen_pass5.py --check
"""
import hashlib, json, os, random, sys, time, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass5")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass5.json")
VISION = "https://data.binance.vision/data/"

FUNDING_SHA = "3c2eb810b1310828cd1bbf0c0e572c88a2332f7728e5c339352a9cffb87e1870"
TAKER_SHA = "362c92162d6c273c511eb42872b7beea19198b88099280624f9da2db67ddae06"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def require_rules():
    funding = sha256_file(os.path.join(RULES, "funding_rule.txt"))
    taker = sha256_file(os.path.join(RULES, "taker_rule.txt"))
    if funding != FUNDING_SHA or taker != TAKER_SHA:
        raise SystemExit("rule text moved after the freeze: funding %s taker %s" % (funding, taker))
    return funding, taker


def ymd(dt):
    return dt.strftime("%Y-%m-%d")


def parse_ymd(s):
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def daterange(start, end):
    d = parse_ymd(start)
    last = parse_ymd(end)
    out = []
    while d <= last:
        out.append(ymd(d))
        d += timedelta(days=1)
    return out


def months(start_ym, end_ym):
    y, m = map(int, start_ym.split("-"))
    ey, em = map(int, end_ym.split("-"))
    out = []
    while (y, m) <= (ey, em):
        out.append("%04d-%02d" % (y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fp5-screen/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, dest)
            return
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit("fetch failed %s: %s" % (url, last))


def zip_text(path):
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        if len(names) != 1:
            raise SystemExit("expected one member in %s, got %s" % (path, names))
        return z.read(names[0]).decode("utf-8")


def ensure_inputs():
    jobs = []
    for sym in ("BTCUSDT", "ETHUSDT"):
        for ym in months("2020-12", "2021-12") + months("2023-12", "2024-12"):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = VISION + "spot/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", sym, name)))
    for ym in months("2020-10", "2021-12"):
        name = "BTCUSDT-fundingRate-%s.zip" % ym
        url = VISION + "futures/um/monthly/fundingRate/BTCUSDT/" + name
        jobs.append((url, os.path.join(INP, "funding", name)))
    for day in daterange("2023-10-01", "2024-12-31"):
        name = "BTCUSDT-metrics-%s.zip" % day
        url = VISION + "futures/um/daily/metrics/BTCUSDT/" + name
        jobs.append((url, os.path.join(INP, "metrics", name)))
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda job: fetch(*job), jobs))


def load_closes(sym):
    closes = {}
    folder = os.path.join(INP, "klines", sym)
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        for line in zip_text(os.path.join(folder, name)).splitlines():
            if not line or line.startswith("open"):
                continue
            parts = line.split(",")
            day = ymd(datetime.fromtimestamp(int(parts[0]) / 1000, timezone.utc))
            closes[day] = float(parts[4])
    return closes


def returns_between(closes, start, end):
    out = {}
    for day in daterange(start, end):
        prev = ymd(parse_ymd(day) - timedelta(days=1))
        if day in closes and prev in closes and closes[prev] > 0:
            out[day] = (closes[day] / closes[prev] - 1.0) * 10000.0
    return out


def load_funding_sums():
    by_day = {}
    folder = os.path.join(INP, "funding")
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        lines = zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if "last_funding_rate" not in header or "calc_time" not in header:
            raise SystemExit("funding header is not the locked columns: %s" % header)
        ti, ri = header.index("calc_time"), header.index("last_funding_rate")
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            day = ymd(datetime.fromtimestamp(int(parts[ti]) / 1000, timezone.utc))
            by_day.setdefault(day, []).append(float(parts[ri]))
    sums = {}
    for day, rates in by_day.items():
        if len(rates) >= 3:
            sums[day] = sum(rates)
    return sums


def load_taker_last():
    last = {}
    folder = os.path.join(INP, "metrics")
    col = "sum_taker_long_short_vol_ratio"
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".zip"):
            continue
        lines = zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if col not in header or "create_time" not in header:
            raise SystemExit("metrics header lacks the locked column: %s" % header)
        ci, vi = header.index("create_time"), header.index(col)
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            stamp = parts[ci]
            day = stamp[:10]
            last[day] = float(parts[vi])
    return last


def trailing_threshold(series, day, window, index):
    """Threshold from the previous `window` printed days, value at `index`."""
    prev = [d for d in series if d < day]
    if len(prev) < window:
        return None
    chunk = [series[d] for d in prev[-window:]]
    chunk.sort()
    return chunk[index]


def long_days_for(series, exec_start, exec_end, window, index, below):
    days = []
    for day in daterange(exec_start, exec_end):
        signal = ymd(parse_ymd(day) - timedelta(days=1))
        if signal not in series:
            continue
        thresh = trailing_threshold(series, signal, window, index)
        if thresh is None:
            continue
        value = series[signal]
        take = value < thresh if below else value > thresh
        days.append((day, take))
    return days


def score(exec_days, long_flags, btc, eth, cost):
    btc_pnl = 0.0
    eth_pnl = 0.0
    trips = 0
    prev = False
    months = {}
    long_days = 0
    for i, day in enumerate(exec_days):
        is_long = long_flags[i]
        charge = 0.0
        if is_long and not prev:
            trips += 1
            charge += cost
        if prev and not is_long:
            charge += cost
        if is_long:
            long_days += 1
            btc_pnl += btc[day]
            eth_pnl += eth[day]
        btc_pnl -= charge
        eth_pnl -= charge
        month = day[:7]
        gross = ((btc[day] + eth[day]) / 2.0) if is_long else 0.0
        months[month] = months.get(month, 0.0) + gross - charge
        prev = is_long
    if prev:
        btc_pnl -= cost
        eth_pnl -= cost
        month = exec_days[-1][:7]
        months[month] = months.get(month, 0.0) - cost
    pool = (btc_pnl + eth_pnl) / 2.0
    return {
        "pool": pool,
        "btc": btc_pnl,
        "eth": eth_pnl,
        "trips": trips,
        "long_days": long_days,
        "months": months,
    }


def null_band(exec_days, n_long, btc, eth, cost):
    rng = random.Random(20260925)
    pools = []
    for _ in range(500):
        chosen = set(rng.sample(exec_days, n_long))
        flags = [d in chosen for d in exec_days]
        pools.append(score(exec_days, flags, btc, eth, cost)["pool"])
    pools.sort()
    p95 = pools[int(0.95 * len(pools)) - 1]
    p50 = (pools[249] + pools[250]) / 2.0
    return p50, p95


def month_share(scored):
    if scored["pool"] <= 0:
        return None, None, None
    month, pnl = max(scored["months"].items(), key=lambda kv: kv[1])
    return pnl / scored["pool"], month, pnl


def kills(scored, p95):
    share, month, month_pnl = month_share(scored)
    reasons = []
    if not scored["pool"] > 0:
        reasons.append("pooled P&L is not positive")
    if not scored["stress"] > 0:
        reasons.append("doubled cost is not positive")
    if scored["trips"] < 60:
        reasons.append("fewer than 60 round trips")
    if not (scored["btc"] > 0 and scored["eth"] > 0):
        reasons.append("one book is not positive")
    if not scored["pool"] > p95:
        reasons.append("does not beat the random-day null")
    if share is not None and share > 0.40:
        reasons.append("one month is more than 40% of P&L")
    if not scored["pool"] > 400:
        reasons.append("pooled P&L does not exceed 400 bps")
    return reasons, share, month, month_pnl


def run_rule(name, series, exec_start, exec_end, window, index, btc_ret, eth_ret):
    marked = long_days_for(series, exec_start, exec_end, window, index, below=True)
    exec_days = []
    flags = []
    for day, take in marked:
        if day not in btc_ret or day not in eth_ret:
            continue
        exec_days.append(day)
        flags.append(take)
    base = score(exec_days, flags, btc_ret, eth_ret, 20.0)
    stress = score(exec_days, flags, btc_ret, eth_ret, 40.0)
    base["stress"] = stress["pool"]
    p50, p95 = null_band(exec_days, base["long_days"], btc_ret, eth_ret, 20.0)
    reasons, share, month, month_pnl = kills(base, p95)
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
    days = ["2021-01-01", "2021-01-02", "2021-01-03"]
    btc = {"2021-01-01": 100.0, "2021-01-02": -50.0, "2021-01-03": 200.0}
    eth = {"2021-01-01": 0.0, "2021-01-02": 50.0, "2021-01-03": 100.0}
    two = score(days, [True, True, False], btc, eth, 20.0)
    if two["btc"] != 10 or two["eth"] != 10 or two["pool"] != 10 or two["trips"] != 1:
        raise SystemExit("fixture two-day long: %s" % two)
    stress = score(days, [True, True, False], btc, eth, 40.0)
    if stress["pool"] != -30 or stress["trips"] != 1:
        raise SystemExit("fixture stress: %s" % stress)
    held = score(days, [True, True, True], btc, eth, 20.0)
    if held["btc"] != 210 or held["eth"] != 110 or held["pool"] != 160 or held["trips"] != 1:
        raise SystemExit("fixture held through the end: %s" % held)
    mid = score(days, [False, True, False], btc, eth, 20.0)
    if mid["pool"] != -40 or mid["trips"] != 1 or mid["long_days"] != 1:
        raise SystemExit("fixture middle day: %s" % mid)
    series = {ymd(parse_ymd("2021-01-01") + timedelta(days=i)): float(i) for i in range(100)}
    # signal day is the 91st printed day (index 90): previous 90 are 0..89, index 8 is 8.
    signal = ymd(parse_ymd("2021-01-01") + timedelta(days=90))
    thresh = trailing_threshold(series, signal, 90, 8)
    if thresh != 8.0:
        raise SystemExit("threshold index: %s" % thresh)
    taker_thresh = trailing_threshold(series, signal, 90, 17)
    if taker_thresh != 17.0:
        raise SystemExit("taker threshold index: %s" % taker_thresh)


def main():
    check = "--check" in sys.argv
    funding_sha, taker_sha = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    elif not os.path.isdir(os.path.join(INP, "metrics")):
        raise SystemExit("missing frozen inputs; run without --check first")
    funding = load_funding_sums()
    taker = load_taker_last()
    btc = load_closes("BTCUSDT")
    eth = load_closes("ETHUSDT")
    btc_2021 = returns_between(btc, "2021-01-01", "2021-12-31")
    eth_2021 = returns_between(eth, "2021-01-01", "2021-12-31")
    btc_2024 = returns_between(btc, "2024-01-01", "2024-12-31")
    eth_2024 = returns_between(eth, "2024-01-01", "2024-12-31")
    funding_result = run_rule("funding_bottom_decile_2021", funding, "2021-01-01", "2021-12-31", 90, 8, btc_2021, eth_2021)
    taker_result = run_rule("taker_ratio_bottom_quintile_2024", taker, "2024-01-01", "2024-12-31", 90, 17, btc_2024, eth_2024)
    # A candle that clears still is not a pre-registered pass.
    reached = False
    summary = {
        "reached_preregistration": reached,
        "note": "Each rule was hashed before its own result. Daily closes can kill a rule. Neither is a pass.",
        "rules": {
            "funding_rule_sha256": funding_sha,
            "taker_rule_sha256": taker_sha,
        },
        "kills": {
            "funding_bottom_decile_2021": funding_result,
            "taker_ratio_bottom_quintile_2024": taker_result,
        },
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass5.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
