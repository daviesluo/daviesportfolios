"""Eight frozen Revolut X screens. Candles can kill a rule. They cannot pass one.

Reads the eight rule texts hashed at 2026-09-25 06:11:52 UTC, before any of
their series was joined to a return, and writes
docs/agents/backtests/fp5/summary_pass26.json. Public market archives only.
Nothing here places an order or reads a key. The OKX basis is not rerun.

    python3 docs/agents/scripts/fp5/screen_pass26.py
    python3 docs/agents/scripts/fp5/screen_pass26.py --check
"""
import hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import screen_pass5 as p5

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
RULES = os.path.join(ROOT, "docs/agents/scripts/fp5")
INP = os.path.join(ROOT, "docs/agents/backtests/inputs/fp5_2026-09-25/pass26")
OUT = os.path.join(ROOT, "docs/agents/backtests/fp5/summary_pass26.json")
SHA = {
    "bnbpx": "82cac544ed7b3ccfbb18a6c28b4e571508b3e0b4fc7ff1902a7983bfefe0a9fa",
    "dogepx": "fc158fae6847e5c3030290a80bc284dea391543fb7b576b4dc9ed67cbca2c84d",
    "ltcq": "dd9f8dbccd10f56e5e60a3a3b52425ede47b0d515f14a6d6d988e959cf45b991",
    "dotq": "acc17b836d5052c719be81f6ef140d5e56928511a3f77f3c576cdf563b635fd7",
    "bnbfund": "f870acf309a343aae932c7e5edef1f6a5425607e532880745c277a2487f6affe",
    "xrpfund": "478b3dbd20b5fa3d2131a6886cf19e8939663b03a99552d480e6ffe3dcb998fc",
    "bnbbasis": "68775d0bc6ad5fb601b7b6e5ef6b29372bca12833f87089c0557b4870677ce62",
    "ethbasis": "65715d7fb5841ab7af8d59bc371e80c71ebcb815df06422ce597100105d5dd47",
}


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
    for parts in iter_kline_rows(folder):
        if len(parts) < need:
            raise SystemExit("kline gap: field %d absent (%d fields)" % (need, len(parts)))
        day = p5.ymd(stamp_of(int(parts[0])))
        if day in values:
            raise SystemExit("duplicate day %s" % day)
        values[day] = float(parts[index])
    return values


def level_changes(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels and levels[prev] > 0 and level > 0:
            changes[day] = level / levels[prev] - 1.0
    return changes


def level_diffs(levels):
    changes = {}
    for day, level in levels.items():
        prev = p5.ymd(p5.parse_ymd(day) - timedelta(days=1))
        if prev in levels:
            changes[day] = level - levels[prev]
    return changes


def basis_levels(other, binance):
    levels = {}
    for day, close in other.items():
        spot = binance.get(day)
        if close > 0 and spot is not None and spot > 0:
            levels[day] = close / spot - 1.0
    return levels


def parse_funding(symbol, first_calc):
    by_day = {}
    seen = None
    folder = os.path.join(INP, "funding")
    if not os.path.isdir(folder):
        raise SystemExit("missing funding")
    prefix = symbol + "-fundingRate-"
    names = sorted(name for name in os.listdir(folder) if name.startswith(prefix) and name.endswith(".zip"))
    if not names:
        raise SystemExit("missing %s funding" % symbol)
    for name in names:
        lines = p5.zip_text(os.path.join(folder, name)).splitlines()
        header = lines[0].split(",")
        if "last_funding_rate" not in header or "calc_time" not in header:
            raise SystemExit("funding header is not the locked columns: %s" % header)
        ti, ri = header.index("calc_time"), header.index("last_funding_rate")
        for line in lines[1:]:
            if not line:
                continue
            parts = line.split(",")
            day = p5.ymd(datetime.fromtimestamp(int(parts[ti]) / 1000, timezone.utc))
            if seen is None or day < seen:
                seen = day
            by_day.setdefault(day, []).append(float(parts[ri]))
    if seen != first_calc:
        raise SystemExit("%s funding does not start %s: %s" % (symbol, first_calc, seen))
    sums = {}
    for day, rates in by_day.items():
        if len(rates) >= 3:
            sums[day] = sum(rates)
    return sums


def kline_jobs():
    jobs = []
    spans = {
        ("spot", "BTCUSDT"): ("2017-08", "2021-12"),
        ("spot", "ETHUSDT"): ("2017-08", "2021-12"),
        ("spot", "BNBUSDT"): ("2017-11", "2021-12"),
        ("spot", "DOGEUSDT"): ("2019-07", "2020-12"),
        ("spot", "LTCUSDT"): ("2017-12", "2019-12"),
        ("spot", "DOTUSDT"): ("2020-08", "2021-12"),
    }
    for (market, sym), (start, end) in spans.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "%s/monthly/klines/%s/1d/%s" % (market, sym, name)
            jobs.append((url, os.path.join(INP, "klines", market, sym, "1d", name)))
    perps = {"BNBUSDT": ("2020-02", "2021-12"), "ETHUSDT": ("2020-01", "2021-12")}
    for sym, (start, end) in perps.items():
        for ym in p5.months(start, end):
            name = "%s-1d-%s.zip" % (sym, ym)
            url = p5.VISION + "futures/um/monthly/klines/%s/1d/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "klines", "um", sym, "1d", name)))
    funds = {"BNBUSDT": ("2020-02", "2021-12"), "XRPUSDT": ("2020-01", "2021-12")}
    for sym, (start, end) in funds.items():
        for ym in p5.months(start, end):
            name = "%s-fundingRate-%s.zip" % (sym, ym)
            url = p5.VISION + "futures/um/monthly/fundingRate/%s/%s" % (sym, name)
            jobs.append((url, os.path.join(INP, "funding", name)))
    return jobs


def ensure_inputs():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda job: p5.fetch(*job), kline_jobs()))
    print("pass26 inputs ready", flush=True)


def run_close(name, marked, btc, eth, floor):
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
    if base["trips"] < 1 or base["long_days"] < 1:
        raise SystemExit("no entries for %s" % name)
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
        "fill": "close_to_close",
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
    changes = level_changes({"2018-01-01": 10.0, "2018-01-02": 12.0, "2018-01-04": 15.0})
    if abs(changes.get("2018-01-02", 0) - 0.2) > 1e-9 or set(changes) != {"2018-01-02"}:
        raise SystemExit("level change")
    diffs = level_diffs({"2018-01-01": -1.0, "2018-01-02": 2.0})
    if abs(diffs.get("2018-01-02", 0) - 3.0) > 1e-9:
        raise SystemExit("level diff")
    basis = basis_levels({"2018-01-01": 110.0}, {"2018-01-01": 100.0})
    if abs(basis["2018-01-01"] - 0.1) > 1e-12:
        raise SystemExit("basis")


def require_history(name, changes, day):
    prior = sum(1 for item in changes if item < day)
    if prior < 90:
        raise SystemExit("%s has %d changes before %s" % (name, prior, day))


def require_span(name, levels, first, last, saturday):
    if not levels or min(levels) != first:
        raise SystemExit("%s start %s" % (name, min(levels) if levels else None))
    if last not in levels:
        raise SystemExit("%s missing %s" % (name, last))
    if saturday not in levels:
        raise SystemExit("%s dropped %s" % (name, saturday))


def main():
    check = "--check" in sys.argv
    found = require_rules()
    self_check()
    if not check:
        ensure_inputs()
    spot = os.path.join(INP, "klines", "spot")
    um = os.path.join(INP, "klines", "um")
    btc_closes = load_field(os.path.join(spot, "BTCUSDT", "1d"), 4, 5)
    eth_closes = load_field(os.path.join(spot, "ETHUSDT", "1d"), 4, 5)
    bnb = load_field(os.path.join(spot, "BNBUSDT", "1d"), 4, 5)
    doge = load_field(os.path.join(spot, "DOGEUSDT", "1d"), 4, 5)
    ltc_quote = load_field(os.path.join(spot, "LTCUSDT", "1d"), 7, 8)
    dot_quote = load_field(os.path.join(spot, "DOTUSDT", "1d"), 7, 8)
    bnb_perp = load_field(os.path.join(um, "BNBUSDT", "1d"), 4, 5)
    eth_perp = load_field(os.path.join(um, "ETHUSDT", "1d"), 4, 5)
    for day in ("2018-12-31", "2019-12-31", "2020-12-31", "2021-12-31"):
        if day not in btc_closes or day not in eth_closes:
            raise SystemExit("spot does not cover %s" % day)
    require_span("bnb", bnb, "2017-11-06", "2021-12-31", "2019-01-05")
    require_span("doge", doge, "2019-07-05", "2020-12-31", "2020-01-04")
    require_span("ltcq", ltc_quote, "2017-12-13", "2019-12-31", "2019-01-05")
    require_span("dotq", dot_quote, "2020-08-18", "2021-12-31", "2021-01-02")
    require_span("bnbperp", bnb_perp, "2020-02-10", "2021-12-31", "2021-01-02")
    require_span("ethperp", eth_perp, "2020-01-01", "2021-12-31", "2021-01-02")
    bnb_basis = basis_levels(bnb_perp, bnb)
    eth_basis = basis_levels(eth_perp, eth_closes)
    require_span("bnbbasis", bnb_basis, "2020-02-10", "2021-12-31", "2021-01-02")
    require_span("ethbasis", eth_basis, "2020-01-01", "2021-12-31", "2021-01-02")
    bnb_fund = parse_funding("BNBUSDT", "2020-02-10")
    xrp_fund = parse_funding("XRPUSDT", "2020-01-06")
    for name, levels in (("bnbfund", bnb_fund), ("xrpfund", xrp_fund)):
        if "2021-01-02" not in levels or "2021-12-31" not in levels:
            raise SystemExit("%s misses the screen" % name)
    btc19 = p5.returns_between(btc_closes, "2019-01-01", "2019-12-31")
    eth19 = p5.returns_between(eth_closes, "2019-01-01", "2019-12-31")
    btc20 = p5.returns_between(btc_closes, "2020-01-01", "2020-12-31")
    eth20 = p5.returns_between(eth_closes, "2020-01-01", "2020-12-31")
    btc21 = p5.returns_between(btc_closes, "2021-01-01", "2021-12-31")
    eth21 = p5.returns_between(eth_closes, "2021-01-01", "2021-12-31")
    specs = (
        ("bnb_close_2019", level_changes(bnb), "2019-01-01", "2019-12-31", btc19, eth19),
        ("doge_close_2020", level_changes(doge), "2020-01-01", "2020-12-31", btc20, eth20),
        ("ltc_quote_2019", level_changes(ltc_quote), "2019-01-01", "2019-12-31", btc19, eth19),
        ("dot_quote_2021", level_changes(dot_quote), "2021-01-01", "2021-12-31", btc21, eth21),
        ("bnb_funding_2021", level_diffs(bnb_fund), "2021-01-01", "2021-12-31", btc21, eth21),
        ("xrp_funding_2021", level_diffs(xrp_fund), "2021-01-01", "2021-12-31", btc21, eth21),
        ("bnb_basis_2021", level_diffs(bnb_basis), "2021-01-01", "2021-12-31", btc21, eth21),
        ("eth_basis_2021", level_diffs(eth_basis), "2021-01-01", "2021-12-31", btc21, eth21),
    )
    kills = {}
    for name, changes, start, end, btc, eth in specs:
        require_history(name, changes, start)
        marked = p5.long_days_for(changes, start, end, 90, 71, False)
        kills[name] = run_close(name, marked, btc, eth, 400)
    summary = {
        "reached_preregistration": False,
        "note": (
            "Each rule was hashed before its own result. "
            "The OKX basis is not rerun. "
            "Daily closes can kill a rule. None is a testing row."
        ),
        "rules": {name + "_rule_sha256": digest for name, digest in found.items()},
        "kills": kills,
    }
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if check:
        with open(OUT) as f:
            have = f.read()
        if have != text:
            raise SystemExit("summary_pass26.json does not match a fresh run")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)


if __name__ == "__main__":
    main()
